// Tasks: one board (five fixed columns) and one grouped list over the same filtered set.
import { useEffect, useMemo, useState } from 'react';
import { LuPlus, LuKanban, LuList, LuZap, LuArrowRightLeft, LuChevronDown } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, appPath, navigate, useRoute } from '@/app/router';
import type { PageProps } from '@/app/routes';
import { act, actorId } from '@/store/store';
import { Avatar, Button, Card, Empty, PageHeader, SearchBox, Seg, cx, toast } from '@/ui';
import { DueBadge, PriorityBadge, TaskRow } from '@/app/shared';
import { TASK_STATUSES, TaskFormModal } from '@/app/forms';
import { setTaskStatus } from '@/domain/actions';
import { assigneeName, byId, isDueToday, isOpenTask, isOverdue } from '@/domain/selectors';
import type { Priority, Task, TaskStatus } from '@/domain/types';
import { addDays, today } from '@/lib/dates';
import '@/features/leads/work.css';
import '@/features/leads/board.css';
import './tasks.css';

const PRIORITIES: Priority[] = ['high', 'medium', 'low'];
const PRI_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
type Due = '' | 'overdue' | 'today' | 'week';
type Group = 'overdue' | 'today' | 'upcoming' | 'nodate' | 'done';
const GROUPS: Group[] = ['overdue', 'today', 'upcoming', 'nodate', 'done'];
/** How many completed tasks show before "Show all". */
const DONE_LIMIT = 6;

/** Sunday to Saturday of the current week, as the original calendar counted it. */
function thisWeek(): [string, string] { const dow = new Date().getDay(); return [addDays(-dow), addDays(6 - dow)]; }
const byDue = (a: Task, b: Task) => (a.due || '9999').localeCompare(b.due || '9999') || PRI_RANK[a.pri] - PRI_RANK[b.pri] || a.title.localeCompare(b.title);
const byDone = (a: Task, b: Task) => (b.doneAt || b.due || '').localeCompare(a.doneAt || a.due || '');

export default function TasksPage(_: PageProps) {
  const { t, data } = useApp();
  const route = useRoute();
  const view = route.query.get('view') === 'list' ? 'list' : 'board';
  const urlTask = route.query.get('task');
  const [q, setQ] = useState('');
  const [who, setWho] = useState('');
  const [job, setJob] = useState('');
  const [pri, setPri] = useState<'' | Priority>('');
  const [due, setDue] = useState<Due>('');
  const [form, setForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const me = 'u:' + actorId();
  const pathFor = (v: string) => (v === 'list' ? '/tasks?view=list' : '/tasks');
  const editing = byId(data.tasks, editId ?? urlTask ?? undefined);
  const closeEdit = () => { setEditId(null); if (urlTask) navigate(appPath(pathFor(view)), { replace: true }); };
  // a link to a task that was deleted since: say so and tidy the address
  useEffect(() => {
    if (urlTask && !byId(data.tasks, urlTask)) { toast(t('tasks.gone'), true); navigate(appPath(pathFor(view)), { replace: true }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTask]);

  /** Everything except the due-date filter, so the summary line counts the same people and jobs the board shows. */
  const scope = useMemo(() => {
    const s = q.trim().toLowerCase();
    const whoCode = who === 'me' ? me : who;
    return data.tasks.filter((x) => {
      if (whoCode && x.assignee !== whoCode) return false;
      if (job === 'none' ? !!x.jobId : job && x.jobId !== job) return false;
      if (pri && x.pri !== pri) return false;
      if (!s) return true;
      const j = byId(data.jobs, x.jobId); const l = byId(data.leads, x.leadId);
      return [x.title, x.description, j?.name, byId(data.clients, j?.clientId ?? x.clientId)?.name, l?.name, assigneeName(data, x.assignee)].some((v) => v && v.toLowerCase().includes(s));
    });
  }, [data, q, who, job, pri, me]);
  const rows = useMemo(() => {
    if (!due) return scope;
    const [from, to] = thisWeek();
    return scope.filter((x) => (due === 'overdue' ? isOverdue(x) : due === 'today' ? isDueToday(x) : isOpenTask(x) && !!x.due && x.due >= from && x.due <= to));
  }, [scope, due]);

  const open = scope.filter(isOpenTask).length; const late = scope.filter(isOverdue).length; const now = scope.filter(isDueToday).length;
  const filtered = !!(q || who || job || pri || due);
  const clear = () => { setQ(''); setWho(''); setJob(''); setPri(''); setDue(''); };
  const jobsWithTasks = data.jobs.filter((j) => data.tasks.some((x) => x.jobId === j.id));
  const workers = data.workers.filter((w) => w.active !== false || data.tasks.some((x) => x.assignee === 'w:' + w.id));
  const meName = assigneeName(data, me);
  const move = (task: Task, to: TaskStatus) => { if (task.status === to) return; act(setTaskStatus, task.id, to); toast(t('tasks.moved', { status: t('ts.' + to) })); };

  return (
    <>
      <PageHeader title={t('nav.tasks')} sub={t('tasks.sub')} actions={<>
        <span data-testid="tasks-view">
          <Seg label={t('tasks.view')} value={view} onChange={(v) => navigate(appPath(pathFor(v)))} options={[
            { value: 'board', label: <><LuKanban aria-hidden="true" />{t('tasks.view.board')}</> }, { value: 'list', label: <><LuList aria-hidden="true" />{t('tasks.view.list')}</> }]} />
        </span>
        <Button variant={data.tasks.length ? 'primary' : 'default'} icon={<LuPlus />} onClick={() => setForm(true)} data-testid="tasks-new">{t('tasks.new')}</Button>
      </>} />

      {!data.tasks.length ? (
        <Card className="work-none"><Empty title={t('tasks.empty')} action={<Button variant="primary" icon={<LuPlus />} onClick={() => setForm(true)}>{t('tasks.new')}</Button>}>{t('tasks.emptyHint')}</Empty></Card>
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
            <select value={job} onChange={(e) => setJob(e.target.value)} aria-label={t('project')} data-testid="tasks-filter-job">
              <option value="">{t('tasks.job.all')}</option>
              <option value="none">{t('form.task.noJob')}</option>
              {jobsWithTasks.map((j) => <option key={j.id} value={j.id}>{byId(data.clients, j.clientId)?.name ?? ''} · {j.name}</option>)}
            </select>
            <select value={pri} onChange={(e) => setPri(e.target.value as Priority | '')} aria-label={t('common.priority')} data-testid="tasks-filter-priority">
              <option value="">{t('tasks.pri.all')}</option>{PRIORITIES.map((p) => <option key={p} value={p}>{t('pr.' + p)}</option>)}
            </select>
            <select value={due} onChange={(e) => setDue(e.target.value as Due)} aria-label={t('common.due')} data-testid="tasks-filter-due">
              <option value="">{t('tasks.due.all')}</option><option value="overdue">{t('tasks.due.overdue')}</option><option value="today">{t('tasks.due.today')}</option><option value="week">{t('tasks.due.week')}</option>
            </select>
            {filtered && <button type="button" className="linkbtn small" onClick={clear} data-testid="tasks-clear">{t('common.clearFilters')}</button>}
          </div>

          <p className="small muted tasks-sum" data-testid="tasks-summary">
            <b>{t('tasks.sum.open', { n: open })}</b>
            {' · '}<button type="button" className={cx('tasks-sumbtn', late > 0 && 'neg')} onClick={() => setDue(due === 'overdue' ? '' : 'overdue')} aria-pressed={due === 'overdue'}>{t('tasks.sum.overdue', { n: late })}</button>
            {' · '}<button type="button" className={cx('tasks-sumbtn', now > 0 && 'warn')} onClick={() => setDue(due === 'today' ? '' : 'today')} aria-pressed={due === 'today'}>{t('tasks.sum.today', { n: now })}</button>
          </p>

          {!rows.length ? (
            <Card className="work-none"><Empty title={t('common.noResults')} action={<Button onClick={clear}>{t('common.clearFilters')}</Button>} /></Card>
          ) : view === 'board' ? (
            <Board tasks={rows} onMove={move} onEdit={setEditId} />
          ) : (
            <GroupedList tasks={rows} onMove={move} onEdit={setEditId} />
          )}
        </>
      )}

      {form && <TaskFormModal defaults={{ assignee: me }} onClose={() => setForm(false)} />}
      {editing && <TaskFormModal key={editing.id} task={editing} onClose={closeEdit} />}
    </>
  );
}

/* ---------- board: drag a card, or use "Move to" on it ---------- */
function Board({ tasks, onMove, onEdit }: { tasks: Task[]; onMove: (task: Task, to: TaskStatus) => void; onEdit: (id: string) => void }) {
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
                const job = byId(data.jobs, x.jobId); const lead = byId(data.leads, x.leadId);
                const who = assigneeName(data, x.assignee); const done = x.status === 'done';
                return (
                  <article key={x.id} className={cx('kcard tasks-card', done && 'done', dragging === x.id && 'drag', landed?.id === x.id && landed.to === x.status && 'landed')} draggable data-task={x.id}
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', x.id); e.dataTransfer.effectAllowed = 'move'; setDragging(x.id); }} onDragEnd={() => { setDragging(null); setOver(null); }}>
                    <div className="row between nowrap top">
                      <button type="button" className="t tasks-title" onClick={() => onEdit(x.id)}>{x.title}</button>
                      {!done && <PriorityBadge pri={x.pri} />}
                    </div>
                    {job ? <A to={`/jobs/${job.id}`} className="small muted tasks-ref">{byId(data.clients, job.clientId)?.name ? `${byId(data.clients, job.clientId)?.name} · ` : ''}{job.name}</A>
                      : lead ? <A to={`/leads/${lead.id}`} className="small muted tasks-ref">{t('tasks.leadTag')}: {lead.name}</A> : null}
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
