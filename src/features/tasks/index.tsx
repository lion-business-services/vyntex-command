// Tasks: one board and one grouped list over the same filtered set.
// Every edition has the status board (five fixed columns) and the list grouped by what is due.
// An edition with several task types (professional services) adds: the type and the client of a task, boards by person
// and by type, lists by person, client, engagement and type, the view of client requests, the conversation on a task,
// and handing several tasks to one person at once.
import { useEffect, useMemo, useState } from 'react';
import { LuPlus, LuKanban, LuList, LuZap, LuArrowRightLeft, LuChevronDown, LuInbox, LuMessageSquare, LuUsers } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, appPath, navigate, useRoute } from '@/app/router';
import type { PageProps } from '@/app/routes';
import { act, actorId } from '@/store/store';
import { Avatar, Badge, Button, Card, Empty, PageHeader, SearchBox, Seg, cx, toast } from '@/ui';
import { DueBadge, PriorityBadge, TaskRow, CanWrite } from '@/app/shared';
import { TASK_STATUSES, TaskFormModal } from '@/app/forms';
import { reassignTasks, setTaskStatus, updateTask } from '@/domain/actions';
import { taskTypesOf } from '@/domain/config';
import { CLIENT_REQUEST, assigneeName, byId, isDueToday, isOpenTask, isOverdue } from '@/domain/selectors';
import { visibleClientIds } from '@/domain/access';
import type { Priority, Task, TaskStatus } from '@/domain/types';
import { addDays, today } from '@/lib/dates';
import { ExportCsv } from '@/features/cash/parts';
import { TaskDialog } from './detail';
import { ClientRequestModal, RequestsView } from './request';
import '@/features/leads/work.css';
import '@/features/leads/board.css';
import './tasks.css';

const PRIORITIES: Priority[] = ['high', 'medium', 'low'];
const PRI_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
type Due = '' | 'overdue' | 'today' | 'week' | 'now';
type Group = 'overdue' | 'today' | 'upcoming' | 'nodate' | 'done';
const GROUPS: Group[] = ['overdue', 'today', 'upcoming', 'nodate', 'done'];
/** What the columns of the board are. */
type Cols = 'status' | 'person' | 'type';
/** What the list is grouped by. */
type By = 'due' | 'person' | 'client' | 'job' | 'type';
const BYS: By[] = ['due', 'person', 'client', 'job', 'type'];
/** How many completed tasks show before "Show all". */
const DONE_LIMIT = 6;

/** Sunday to Saturday of the current week, as the original calendar counted it. */
function thisWeek(): [string, string] { const dow = new Date().getDay(); return [addDays(-dow), addDays(6 - dow)]; }
const byDue = (a: Task, b: Task) => (a.due || '9999').localeCompare(b.due || '9999') || PRI_RANK[a.pri] - PRI_RANK[b.pri] || a.title.localeCompare(b.title);
const byDone = (a: Task, b: Task) => (b.doneAt || b.due || '').localeCompare(a.doneAt || a.due || '');
const isDue = (v: string | null): v is Due => v === 'overdue' || v === 'today' || v === 'week' || v === 'now';

export default function TasksPage(_: PageProps) {
  const { t, data, pack, can, user, perms } = useApp();
  const route = useRoute();
  const types = taskTypesOf(data, pack);
  /** An edition with several task types gets the fuller task: type, client, conversation, requests. */
  const rich = types.length > 1;
  const hasRequests = rich && types.some((x) => x.id === CLIENT_REQUEST);
  const asked = route.query.get('view');
  const view = asked === 'list' ? 'list' : asked === 'requests' && hasRequests ? 'requests' : 'board';
  const urlTask = route.query.get('task');
  const me = 'u:' + actorId();
  const [q, setQ] = useState('');
  // a link from the home screen arrives with its filters: /tasks?view=list&who=me&due=now
  const [who, setWho] = useState(() => route.query.get('who') ?? '');
  const [job, setJob] = useState('');
  const [pri, setPri] = useState<'' | Priority>('');
  const [due, setDue] = useState<Due>(() => { const d = route.query.get('due'); return isDue(d) ? d : ''; });
  const [type, setType] = useState(() => route.query.get('type') ?? '');
  const [client, setClient] = useState(() => route.query.get('client') ?? '');
  const [cols, setCols] = useState<Cols>('status');
  const [by, setBy] = useState<By>('due');
  const [form, setForm] = useState(false);
  const [request, setRequest] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const pathFor = (v: string) => (v === 'list' ? '/tasks?view=list' : v === 'requests' ? '/tasks?view=requests' : '/tasks');
  const editing = byId(data.tasks, editId ?? urlTask ?? undefined);
  const closeEdit = () => { setEditId(null); if (urlTask) navigate(appPath(pathFor(view)), { replace: true }); };
  // a link to a task that was deleted since: say so and tidy the address
  useEffect(() => {
    if (urlTask && !byId(data.tasks, urlTask)) { toast(t('tasks.gone'), true); navigate(appPath(pathFor(view)), { replace: true }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTask]);

  // work for a client of another office is not shown to someone who may not open that client
  const mine = useMemo(() => visibleClientIds(data, user, perms), [data, user, perms]);
  const all = useMemo(() => data.tasks.filter((x) => { const c = x.clientId ?? byId(data.jobs, x.jobId)?.clientId; return !c || mine.has(c); }), [data, mine]);
  const clientOf = (x: Task) => byId(data.clients, x.clientId ?? byId(data.jobs, x.jobId)?.clientId);

  /** Everything except the due-date filter, so the summary line counts the same people and jobs the board shows. */
  const scope = useMemo(() => {
    const s = q.trim().toLowerCase();
    const whoCode = who === 'me' ? me : who;
    return all.filter((x) => {
      if (whoCode && x.assignee !== whoCode) return false;
      if (job === 'none' ? !!x.jobId : job && x.jobId !== job) return false;
      if (pri && x.pri !== pri) return false;
      if (type && (x.type ?? 'todo') !== type) return false;
      if (client && (x.clientId ?? byId(data.jobs, x.jobId)?.clientId) !== client) return false;
      if (!s) return true;
      const j = byId(data.jobs, x.jobId); const l = byId(data.leads, x.leadId);
      return [x.title, x.description, j?.name, byId(data.clients, j?.clientId ?? x.clientId)?.name, l?.name, assigneeName(data, x.assignee), x.requestedBy].some((v) => v && v.toLowerCase().includes(s));
    });
  }, [all, data, q, who, job, pri, type, client, me]);
  const rows = useMemo(() => {
    if (!due) return scope;
    const [from, to] = thisWeek();
    return scope.filter((x) => (due === 'overdue' ? isOverdue(x) : due === 'today' ? isDueToday(x) : due === 'now' ? isOverdue(x) || isDueToday(x) : isOpenTask(x) && !!x.due && x.due >= from && x.due <= to));
  }, [scope, due]);

  const open = scope.filter(isOpenTask).length; const late = scope.filter(isOverdue).length; const now = scope.filter(isDueToday).length;
  const filtered = !!(q || who || job || pri || due || type || client);
  const clear = () => { setQ(''); setWho(''); setJob(''); setPri(''); setDue(''); setType(''); setClient(''); };
  const jobsWithTasks = data.jobs.filter((j) => all.some((x) => x.jobId === j.id));
  const clientsWithTasks = data.clients.filter((c) => mine.has(c.id) && all.some((x) => (x.clientId ?? byId(data.jobs, x.jobId)?.clientId) === c.id));
  const workers = data.workers.filter((w) => w.active !== false || data.tasks.some((x) => x.assignee === 'w:' + w.id));
  const meName = assigneeName(data, me);
  const move = (task: Task, to: TaskStatus) => { if (task.status === to) return; act(setTaskStatus, task.id, to); toast(t('tasks.moved', { status: t('ts.' + to) })); };
  /** Handing work to someone else is a manager's call. */
  const canAssign = can('write') && can('assignLeads');
  const typeName = (id: string | undefined) => t('tt_' + (id ?? 'todo'));
  const csvRows = () => [
    [t('common.title'), t('common.type'), t('common.status'), t('common.priority'), t('common.due'), t('common.assignedTo'), t('tasks.f.client'), t('project'), t('tasks.req.by'), t('tasks.req.channel')],
    ...rows.map((x) => [x.title, typeName(x.type), t('ts.' + x.status), t('pr.' + x.pri), x.due ?? '', assigneeName(data, x.assignee), clientOf(x)?.name ?? '', byId(data.jobs, x.jobId)?.name ?? '', x.requestedBy ?? '', x.channel ? t('tasks.ch.' + x.channel) : '']),
  ];

  const summary = (
    <p className="small muted tasks-sum" data-testid="tasks-summary">
      <b>{t('tasks.sum.open', { n: open })}</b>
      {' · '}<button type="button" className={cx('tasks-sumbtn', late > 0 && 'neg')} onClick={() => setDue(due === 'overdue' ? '' : 'overdue')} aria-pressed={due === 'overdue'}>{t('tasks.sum.overdue', { n: late })}</button>
      {' · '}<button type="button" className={cx('tasks-sumbtn', now > 0 && 'warn')} onClick={() => setDue(due === 'today' ? '' : 'today')} aria-pressed={due === 'today'}>{t('tasks.sum.today', { n: now })}</button>
    </p>
  );

  return (
    <>
      <PageHeader title={t('nav.tasks')} sub={t('tasks.sub')} actions={<>
        <span data-testid="tasks-view">
          <Seg label={t('tasks.view')} value={view} onChange={(v) => { setPicking(false); navigate(appPath(pathFor(v))); }} options={[
            { value: 'board', label: <><LuKanban aria-hidden="true" />{t('tasks.view.board')}</> }, { value: 'list', label: <><LuList aria-hidden="true" />{t('tasks.view.list')}</> },
            ...(hasRequests ? [{ value: 'requests' as const, label: <><LuInbox aria-hidden="true" />{t('tasks.view.requestsShort')}</>, count: all.filter((x) => x.type === CLIENT_REQUEST && isOpenTask(x)).length }] : [])]} />
        </span>
        {hasRequests && <CanWrite><Button icon={<LuInbox aria-hidden="true" />} onClick={() => setRequest(true)} data-testid="tasks-new-request">{t('tasks.req.new')}</Button></CanWrite>}
        <CanWrite><Button variant={data.tasks.length ? 'primary' : 'default'} icon={<LuPlus />} onClick={() => setForm(true)} data-testid="tasks-new">{t('tasks.new')}</Button></CanWrite>
      </>} />

      {!all.length ? (
        <Card className="work-none"><Empty title={t('tasks.empty')} action={<CanWrite><Button variant="primary" icon={<LuPlus />} onClick={() => setForm(true)}>{t('tasks.new')}</Button></CanWrite>}>{t('tasks.emptyHint')}</Empty></Card>
      ) : (
        <>
          <div className="filters tasks-filters">
            <SearchBox value={q} onChange={setQ} placeholder={t('tasks.search')} />
            <select value={who} onChange={(e) => setWho(e.target.value)} aria-label={t('common.assignedTo')} data-testid="tasks-filter-assignee">
              <option value="">{t('tasks.who.all')}</option>
              <option value="me">{meName ? t('tasks.who.me', { name: meName.split(' ')[0] }) : t('common.me')}</option>
              <optgroup label={t('tasks.who.office')}>{data.users.map((u) => <option key={u.id} value={'u:' + u.id}>{u.name}</option>)}</optgroup>
              {workers.length > 0 && <optgroup label={t('nav.team')}>{workers.map((w) => <option key={w.id} value={'w:' + w.id}>{w.name}</option>)}</optgroup>}
            </select>
            {rich && view !== 'requests' && (
              <select value={type} onChange={(e) => setType(e.target.value)} aria-label={t('common.type')} data-testid="tasks-filter-type">
                <option value="">{t('tasks.type.all')}</option>{types.map((o) => <option key={o.id} value={o.id}>{t('tt_' + o.id)}</option>)}
              </select>
            )}
            {rich && (
              <select value={client} onChange={(e) => setClient(e.target.value)} aria-label={t('tasks.f.client')} data-testid="tasks-filter-client">
                <option value="">{t('tasks.client.all')}</option>{clientsWithTasks.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <select value={job} onChange={(e) => setJob(e.target.value)} aria-label={t('project')} data-testid="tasks-filter-job">
              <option value="">{t('tasks.job.all')}</option>
              <option value="none">{t('form.task.noJob')}</option>
              {jobsWithTasks.map((j) => <option key={j.id} value={j.id}>{byId(data.clients, j.clientId)?.name ?? ''} · {j.name}</option>)}
            </select>
            <select value={pri} onChange={(e) => setPri(e.target.value as Priority | '')} aria-label={t('common.priority')} data-testid="tasks-filter-priority">
              <option value="">{t('tasks.pri.all')}</option>{PRIORITIES.map((p) => <option key={p} value={p}>{t('pr.' + p)}</option>)}
            </select>
            <select value={due} onChange={(e) => setDue(e.target.value as Due)} aria-label={t('common.due')} data-testid="tasks-filter-due">
              <option value="">{t('tasks.due.all')}</option>{rich && <option value="now">{t('tasks.due.now')}</option>}<option value="overdue">{t('tasks.due.overdue')}</option><option value="today">{t('tasks.due.today')}</option><option value="week">{t('tasks.due.week')}</option>
            </select>
            {filtered && <button type="button" className="linkbtn small" onClick={clear} data-testid="tasks-clear">{t('common.clearFilters')}</button>}
          </div>

          {rich ? (
            <div className="tasks-bar">
              {summary}
              <div className="row tight tasks-tools">
                {view === 'board' && <label className="tasks-by"><span>{t('tasks.cols')}</span><select value={cols} onChange={(e) => setCols(e.target.value as Cols)} data-testid="tasks-cols"><option value="status">{t('common.status')}</option><option value="person">{t('tasks.by.person')}</option><option value="type">{t('common.type')}</option></select></label>}
                {view === 'list' && !picking && <label className="tasks-by"><span>{t('tasks.groupBy')}</span><select value={by} onChange={(e) => setBy(e.target.value as By)} data-testid="tasks-group">{BYS.map((b) => <option key={b} value={b}>{t('tasks.by.' + b)}</option>)}</select></label>}
                {view !== 'board' && canAssign && !picking && <Button size="sm" icon={<LuUsers aria-hidden="true" />} onClick={() => setPicking(true)} data-testid="tasks-bulk">{t('tasks.bulk')}</Button>}
                <ExportCsv size="sm" name={t('tasks.file')} rows={csvRows} kind="tasks" testId="tasks-csv" />
              </div>
            </div>
          ) : summary}

          {picking && view !== 'board' ? (
            <BulkReassign tasks={(view === 'requests' ? rows.filter((x) => x.type === CLIENT_REQUEST) : rows).filter(isOpenTask)} onClose={() => setPicking(false)} />
          ) : view === 'requests' ? (
            <RequestsView tasks={rows} onOpen={setEditId} onNew={can('write') ? () => setRequest(true) : undefined} />
          ) : !rows.length ? (
            <Card className="work-none"><Empty title={t('common.noResults')} action={<Button onClick={clear}>{t('common.clearFilters')}</Button>} /></Card>
          ) : view === 'board' ? (
            cols === 'status' || !rich ? <Board tasks={rows} onMove={move} onEdit={setEditId} rich={rich} /> : <BoardBy tasks={rows.filter(isOpenTask)} by={cols} onEdit={setEditId} canAssign={canAssign} />
          ) : by === 'due' || !rich ? (
            <GroupedList tasks={rows} onMove={move} onEdit={setEditId} />
          ) : (
            <ListBy tasks={rows} by={by} onMove={move} onEdit={setEditId} />
          )}
        </>
      )}

      {form && (rich ? <TaskDialog defaults={{ assignee: me, clientId: client || undefined, type: type || undefined }} onClose={() => setForm(false)} /> : <TaskFormModal defaults={{ assignee: me }} onClose={() => setForm(false)} />)}
      {request && <ClientRequestModal clientId={client || undefined} onClose={() => setRequest(false)} />}
      {editing && (rich ? <TaskDialog key={editing.id} task={editing} onClose={closeEdit} /> : <TaskFormModal key={editing.id} task={editing} onClose={closeEdit} />)}
    </>
  );
}

/** What a card or a row says about the task beyond its title: the engagement, the lead, or the client it is for. */
function TaskRef({ task }: { task: Task }) {
  const { t, data } = useApp();
  const job = byId(data.jobs, task.jobId); const lead = byId(data.leads, task.leadId); const client = byId(data.clients, task.clientId);
  if (job) return <A to={`/jobs/${job.id}`} className="small muted tasks-ref">{byId(data.clients, job.clientId)?.name ? `${byId(data.clients, job.clientId)?.name} · ` : ''}{job.name}</A>;
  if (lead) return <A to={`/leads/${lead.id}`} className="small muted tasks-ref">{t('tasks.leadTag')}: {lead.name}</A>;
  if (client) return <A to={`/clients/${client.id}/tasks`} className="small muted tasks-ref">{client.name}</A>;
  return null;
}
/** Type and conversation marks of a card, for editions that have them. */
function TaskMarks({ task }: { task: Task }) {
  const { t } = useApp();
  const n = task.comments?.length ?? 0;
  if ((!task.type || task.type === 'todo') && !n) return null;
  return <span className="tasks-marks">{task.type && task.type !== 'todo' && <Badge tone={task.type === CLIENT_REQUEST ? 'accent' : 'neutral'} outline>{t('tt_' + task.type)}</Badge>}{n > 0 && <span className="xs dim tasks-cn" title={t(n === 1 ? 'tasks.c.count.one' : 'tasks.c.count', { n })}><LuMessageSquare aria-hidden="true" />{n}</span>}</span>;
}

/* ---------- board: drag a card, or use "Move to" on it ---------- */
function Board({ tasks, onMove, onEdit, rich }: { tasks: Task[]; onMove: (task: Task, to: TaskStatus) => void; onEdit: (id: string) => void; rich?: boolean }) {
  const { t, data } = useApp();
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [allDone, setAllDone] = useState(false);
  /** The card that was just moved and where to, so it can settle once in its new column. */
  const [landed, setLanded] = useState<{ id: string; to: TaskStatus } | null>(null);
  const moveTo = (task: Task, to: TaskStatus) => { if (task.status !== to) setLanded({ id: task.id, to }); onMove(task, to); };
  return (
    <div className="kanban tasks-board" data-testid="tasks-board">
      {TASK_STATUSES.map((s) => {
        const all = tasks.filter((x) => x.status === s).sort(s === 'done' ? byDone : byDue);
        const col = s === 'done' && !allDone ? all.slice(0, DONE_LIMIT) : all;
        return (
          <section key={s} className={cx('kcol', over === s && 'over')} aria-label={t('ts.' + s)} data-status={s}
            onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
            onDrop={(e) => { e.preventDefault(); setOver(null); const task = tasks.find((x) => x.id === (e.dataTransfer.getData('text/plain') || dragging)); if (task) moveTo(task, s); setDragging(null); }}>
            <div className="kcol-h"><span className="row tight"><i className={cx('tasks-dot', s)} aria-hidden="true" />{t('ts.' + s)} <span className="count">{all.length}</span></span></div>
            <div className="kcol-b">
              {col.map((x) => {
                const who = assigneeName(data, x.assignee); const done = x.status === 'done';
                return (
                  <article key={x.id} className={cx('kcard tasks-card', done && 'done', dragging === x.id && 'drag', landed?.id === x.id && landed.to === x.status && 'landed')} draggable data-task={x.id}
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', x.id); e.dataTransfer.effectAllowed = 'move'; setDragging(x.id); }} onDragEnd={() => { setDragging(null); setOver(null); }}>
                    <div className="row between nowrap top">
                      <button type="button" className="t tasks-title" onClick={() => onEdit(x.id)}>{x.title}</button>
                      {!done && <PriorityBadge pri={x.pri} />}
                    </div>
                    <TaskRef task={rich ? x : { ...x, clientId: undefined }} />
                    {rich && <TaskMarks task={x} />}
                    <div className="tasks-meta">
                      <span className="small tasks-who" title={who || undefined}>{who ? <><Avatar name={who} size="sm" /><span className="clip">{who}</span></> : <span className="dim">{t('common.unassigned')}</span>}</span>
                      <DueBadge due={x.due} done={done} />
                    </div>
                    {x.auto && <span className="tasks-auto" title={t('tasks.autoHint')}><LuZap aria-hidden="true" />{t('tasks.auto')}</span>}
                    <label className="tasks-move"><span><LuArrowRightLeft aria-hidden="true" />{t('tasks.moveTo')}<LuChevronDown aria-hidden="true" /></span>
                      <select value={x.status} onChange={(e) => moveTo(x, e.target.value as TaskStatus)} aria-label={`${t('tasks.moveTo')}: ${x.title}`}>
                        {TASK_STATUSES.map((o) => <option key={o} value={o}>{o === x.status ? t('ts.' + o) : `${t('tasks.moveTo')}: ${t('ts.' + o)}`}</option>)}
                      </select>
                    </label>
                  </article>
                );
              })}
              {!all.length && <p className="xs dim tasks-drop">{t('tasks.drop')}</p>}
              {s === 'done' && all.length > DONE_LIMIT && <button type="button" className="linkbtn small tasks-more" onClick={() => setAllDone((v) => !v)}>{allDone ? t('tasks.showLess') : t('tasks.showAll', { n: all.length })}</button>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* ---------- board by person or by type: open tasks only; dropping a card hands it over or changes its type ---------- */
function BoardBy({ tasks, by, onEdit, canAssign }: { tasks: Task[]; by: 'person' | 'type'; onEdit: (id: string) => void; canAssign: boolean }) {
  const { t, data, pack, can } = useApp();
  const [over, setOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const keyOf = (x: Task) => (by === 'person' ? x.assignee || '' : x.type ?? 'todo');
  const keys = by === 'type' ? taskTypesOf(data, pack).map((o) => o.id)
    : [...new Set([...data.users.filter((u) => u.active !== false && u.role !== 'readonly').map((u) => 'u:' + u.id), ...tasks.map((x) => x.assignee || '')])];
  const label = (k: string) => (by === 'type' ? t('tt_' + k) : assigneeName(data, k) || t('common.unassigned'));
  // dropping on a person hands the task over (a manager's call); dropping on a type changes what kind of task it is
  const mayDrop = by === 'person' ? canAssign : can('write');
  const drop = (task: Task, k: string) => {
    if (keyOf(task) === k || !mayDrop) return;
    if (by === 'person') { if (act(reassignTasks, [task.id], k)) toast(t('tasks.bulk.done', { n: 1, name: label(k) })); }
    else { act(updateTask, task.id, { type: k }); toast(t('tasks.typed', { type: label(k) })); }
  };
  return (
    <>
      <div className="kanban tasks-board by" data-testid="tasks-board-by" data-by={by}>
        {keys.map((k) => {
          const col = tasks.filter((x) => keyOf(x) === k).sort(byDue);
          return (
            <section key={k || 'none'} className={cx('kcol', over === k && 'over')} aria-label={label(k)} data-col={k}
              onDragOver={(e) => { if (mayDrop) { e.preventDefault(); setOver(k); } }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
              onDrop={(e) => { e.preventDefault(); setOver(null); const task = tasks.find((x) => x.id === (e.dataTransfer.getData('text/plain') || dragging)); if (task) drop(task, k); setDragging(null); }}>
              <div className="kcol-h"><span className="row tight">{by === 'person' && <Avatar name={label(k)} size="sm" />}<span className="clip">{label(k)}</span> <span className="count">{col.length}</span></span></div>
              <div className="kcol-b">
                {col.map((x) => (
                  <article key={x.id} className={cx('kcard tasks-card', dragging === x.id && 'drag')} draggable={mayDrop} data-task={x.id}
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', x.id); e.dataTransfer.effectAllowed = 'move'; setDragging(x.id); }} onDragEnd={() => { setDragging(null); setOver(null); }}>
                    <div className="row between nowrap top"><button type="button" className="t tasks-title" onClick={() => onEdit(x.id)}>{x.title}</button><PriorityBadge pri={x.pri} /></div>
                    <TaskRef task={x} />
                    {by === 'person' && <TaskMarks task={x} />}
                    <div className="tasks-meta">
                      <span className="small tasks-who">{by === 'type' ? <><Avatar name={assigneeName(data, x.assignee) || '?'} size="sm" /><span className="clip">{assigneeName(data, x.assignee) || t('common.unassigned')}</span></> : <Badge tone="neutral">{t('ts.' + x.status)}</Badge>}</span>
                      <DueBadge due={x.due} />
                    </div>
                  </article>
                ))}
                {!col.length && <p className="xs dim tasks-drop">{t(mayDrop ? 'tasks.drop' : 'tasks.none')}</p>}
              </div>
            </section>
          );
        })}
      </div>
      <p className="xs dim tasks-bynote">{t(by === 'person' ? (canAssign ? 'tasks.by.personNote' : 'tasks.by.personNoteRead') : 'tasks.by.typeNote')}</p>
    </>
  );
}

/* ---------- list: grouped by what needs attention first ---------- */
function GroupedList({ tasks, onMove, onEdit }: { tasks: Task[]; onMove: (task: Task, to: TaskStatus) => void; onEdit: (id: string) => void }) {
  const { t } = useApp();
  const [allDone, setAllDone] = useState(false);
  const td = today();
  const groups: Record<Group, Task[]> = {
    overdue: tasks.filter(isOverdue).sort(byDue),
    today: tasks.filter(isDueToday).sort(byDue),
    upcoming: tasks.filter((x) => isOpenTask(x) && !!x.due && x.due > td).sort(byDue),
    nodate: tasks.filter((x) => isOpenTask(x) && !x.due).sort(byDue),
    done: tasks.filter((x) => !isOpenTask(x)).sort(byDone),
  };
  return (
    <div className="stack" data-testid="tasks-list">
      {GROUPS.filter((g) => groups[g].length).map((g) => {
        const all = groups[g]; const shown = g === 'done' && !allDone ? all.slice(0, DONE_LIMIT) : all;
        return (
          <Card key={g} title={<><span className={cx(g === 'overdue' && 'neg')}>{t('tasks.g.' + g)}</span> <span className="count">{all.length}</span></>} className={cx('tasks-group', g === 'overdue' && 'raised')}>
            <div className="list" data-group={g}>
              {shown.map((x) => (
                <TaskRow key={x.id} task={x} showJob onEdit={() => onEdit(x.id)} actions={
                  <select className="tasks-rowmove" value={x.status} onChange={(e) => onMove(x, e.target.value as TaskStatus)} aria-label={`${t('tasks.moveTo')}: ${x.title}`}>
                    {TASK_STATUSES.map((o) => <option key={o} value={o}>{t('ts.' + o)}</option>)}
                  </select>} />
              ))}
            </div>
            {g === 'done' && all.length > DONE_LIMIT && <button type="button" className="linkbtn small tasks-more" onClick={() => setAllDone((v) => !v)}>{allDone ? t('tasks.showLess') : t('tasks.showAll', { n: all.length })}</button>}
          </Card>
        );
      })}
    </div>
  );
}

/* ---------- list by person, client, engagement or type: open work first inside each group ---------- */
function ListBy({ tasks, by, onMove, onEdit }: { tasks: Task[]; by: Exclude<By, 'due'>; onMove: (task: Task, to: TaskStatus) => void; onEdit: (id: string) => void }) {
  const { t, data } = useApp();
  const clientId = (x: Task) => x.clientId ?? byId(data.jobs, x.jobId)?.clientId ?? '';
  const keyOf = (x: Task) => (by === 'person' ? x.assignee || '' : by === 'client' ? clientId(x) : by === 'job' ? x.jobId ?? '' : x.type ?? 'todo');
  const label = (k: string) => (by === 'person' ? assigneeName(data, k) || t('common.unassigned') : by === 'client' ? byId(data.clients, k)?.name ?? t('tasks.f.noClient') : by === 'job' ? byId(data.jobs, k)?.name ?? t('form.task.noJob') : t('tt_' + k));
  const sub = (k: string) => (by === 'job' ? byId(data.clients, byId(data.jobs, k)?.clientId)?.name : undefined);
  const keys = [...new Set(tasks.map(keyOf))].sort((a, b) => Number(!a) - Number(!b) || label(a).localeCompare(label(b)));
  return (
    <div className="stack" data-testid="tasks-list-by" data-by={by}>
      {keys.map((k) => {
        const list = tasks.filter((x) => keyOf(x) === k).sort((a, b) => Number(!isOpenTask(a)) - Number(!isOpenTask(b)) || byDue(a, b));
        const open = list.filter(isOpenTask).length; const late = list.filter(isOverdue).length;
        return (
          <Card key={k || 'none'} className="tasks-group" title={<>{label(k)}{sub(k) && <span className="small muted tasks-gsub"> · {sub(k)}</span>} <span className="count">{open}</span>{late > 0 && <span className="count bad" title={t('tasks.sum.overdue', { n: late })}>{late}</span>}</>}>
            <div className="list" data-group={k}>
              {list.map((x) => (
                <TaskRow key={x.id} task={x} showJob={by !== 'job'} onEdit={() => onEdit(x.id)} actions={
                  <select className="tasks-rowmove" value={x.status} onChange={(e) => onMove(x, e.target.value as TaskStatus)} aria-label={`${t('tasks.moveTo')}: ${x.title}`}>
                    {TASK_STATUSES.map((o) => <option key={o} value={o}>{t('ts.' + o)}</option>)}
                  </select>} />
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* ---------- hand several open tasks to one person ---------- */
function BulkReassign({ tasks, onClose }: { tasks: Task[]; onClose: () => void }) {
  const { t, data } = useApp();
  const [ids, setIds] = useState<string[]>([]);
  const people = data.users.filter((u) => u.active !== false && u.role !== 'readonly');
  const [to, setTo] = useState('');
  const toggle = (id: string) => setIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  const allOn = tasks.length > 0 && ids.length === tasks.length;
  const run = () => {
    const n = act(reassignTasks, ids, to);
    toast(n ? t('tasks.bulk.done', { n, name: assigneeName(data, to) }) : t('tasks.bulk.nothing'), !n);
    if (n) onClose();
  };
  return (
    <Card className="tasks-bulk" title={t('tasks.bulk')} actions={<Button size="sm" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>}>
      <div className="tasks-bulkbar" data-testid="tasks-bulk-bar">
        <label className="check"><input type="checkbox" checked={allOn} onChange={() => setIds(allOn ? [] : tasks.map((x) => x.id))} /><span>{t('tasks.bulk.all', { n: tasks.length })}</span></label>
        <span className="grow" />
        <select className="input tasks-bulkto" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t('tasks.bulk.to')} data-testid="tasks-bulk-to">
          <option value="">{t('tasks.bulk.to')}</option>{people.map((u) => <option key={u.id} value={'u:' + u.id}>{u.name}</option>)}
        </select>
        <Button variant="primary" onClick={run} disabled={!ids.length || !to} data-testid="tasks-bulk-apply">{t('tasks.bulk.apply', { n: ids.length })}</Button>
      </div>
      {tasks.length ? (
        <div className="list">
          {tasks.slice().sort(byDue).map((x) => (
            <label key={x.id} className={cx('item tasks-pick', ids.includes(x.id) && 'on')}>
              <input type="checkbox" checked={ids.includes(x.id)} onChange={() => toggle(x.id)} aria-label={x.title} />
              <span className="grow"><span className="t">{x.title}</span><span className="small muted tasks-pickwho">{assigneeName(data, x.assignee) || t('common.unassigned')}{byId(data.clients, x.clientId ?? byId(data.jobs, x.jobId)?.clientId)?.name ? ` · ${byId(data.clients, x.clientId ?? byId(data.jobs, x.jobId)?.clientId)?.name}` : ''}</span></span>
              <DueBadge due={x.due} />
            </label>
          ))}
        </div>
      ) : <p className="muted small">{t('tasks.bulk.none')}</p>}
    </Card>
  );
}
