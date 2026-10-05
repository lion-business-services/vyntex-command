// Client requests: something a client asked for. Recorded with who asked and how it arrived, and followed in its own view
// with its age and status. A request is a task of type `client_request`, so it also lives on the board and in the lists.
// `ClientRequestModal` is what other screens open to record one (the client page, the home screen).
import { useMemo, useState } from 'react';
import { LuInbox, LuPlus } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { act } from '@/store/store';
import { Badge, Button, Card, Empty, FormModal, Modal, Seg, cx, toast, type FieldDef } from '@/ui';
import { DueBadge, PriorityBadge } from '@/app/shared';
import { TASK_STATUSES } from '@/app/forms';
import { createClientRequest, setTaskStatus } from '@/domain/actions';
import { assigneeName, byId, isClientRequest, isOpenTask, isOverdue, jobsOfClient, requestAge } from '@/domain/selectors';
import { visibleClients } from '@/domain/access';
import type { MessageChannel, Priority, Task, TaskStatus } from '@/domain/types';
import { addDays } from '@/lib/dates';

/** How a request can arrive. `system` stands for a visit to the office or anything that is not one of the channels. */
export const REQUEST_CHANNELS: MessageChannel[] = ['call', 'email', 'text', 'whatsapp', 'facebook', 'instagram', 'system'];
const PRIORITIES: Priority[] = ['high', 'medium', 'low'];

/** Records a client request. `clientId`, `jobId` and `apptId` pre-fill where the request came up. */
export function ClientRequestModal({ clientId, jobId, apptId, onClose }: { clientId?: string; jobId?: string; apptId?: string; onClose: () => void }) {
  const { t, data, user, perms } = useApp();
  const clients = visibleClients(data, user, perms);
  if (!clients.length) return <Modal title={t('tasks.req.new')} onClose={onClose} size="narrow" labelClose={t('common.close')}><p className="muted">{t('tasks.req.noClients')}</p></Modal>;
  const client = byId(clients, clientId);
  const jobs = client ? jobsOfClient(data, client.id).filter((j) => j.status !== 'done' || j.id === jobId) : [];
  const fields: FieldDef[] = [
    ...(clientId ? [] : [{ k: 'clientId', label: t('tasks.f.client'), type: 'select' as const, req: true, full: true, options: [['', t('tasks.req.pickClient')] as [string, string], ...clients.map((c) => [c.id, c.company ? `${c.name} · ${c.company}` : c.name] as [string, string])] }]),
    { k: 'title', label: t('tasks.req.what'), req: true, full: true, placeholder: t('tasks.req.whatPh') },
    { k: 'requestedBy', label: t('tasks.req.by'), placeholder: t('tasks.req.byPh') },
    { k: 'channel', label: t('tasks.req.channel'), type: 'select', options: REQUEST_CHANNELS.map((c) => [c, t('tasks.ch.' + c)]) },
    { k: 'assignee', label: t('common.assignedTo'), type: 'select', options: [['', t('tasks.req.assignAuto')], ...data.users.filter((u) => u.active !== false).map((u) => ['u:' + u.id, u.name] as [string, string])] },
    { k: 'due', label: t('tasks.req.due'), type: 'date' },
    { k: 'pri', label: t('common.priority'), type: 'select', options: PRIORITIES.map((p) => [p, t('pr.' + p)]) },
    ...(clientId ? [{ k: 'jobId', label: t('project'), type: 'select' as const, options: [['', t('form.task.noJob')] as [string, string], ...jobs.map((j) => [j.id, j.name] as [string, string])] }] : []),
    { k: 'description', label: `${t('common.details')} (${t('common.optional')})`, type: 'textarea' },
  ];
  return (
    <FormModal title={t('tasks.req.new')} fields={fields} initial={{ clientId: '', channel: 'call', assignee: '', due: addDays(1), pri: 'medium', jobId: jobId ?? '', requestedBy: client?.name ?? '' }} onClose={onClose}
      saveLabel={t('tasks.req.save')} cancelLabel={t('common.cancel')} requiredMsg={t('common.required')}
      onSave={(v) => {
        const made = act(createClientRequest, { title: v.title, clientId: clientId ?? v.clientId, requestedBy: v.requestedBy || '', channel: v.channel as MessageChannel, assignee: v.assignee || undefined, due: v.due || undefined, pri: v.pri as Priority, jobId: v.jobId || jobId, apptId, description: v.description });
        toast(made ? t('tasks.req.saved', { name: assigneeName(data, made.assignee) }) : t('tasks.req.failed'), !made);
      }} />
  );
}

type Scope = 'open' | 'done' | 'all';
/** The view of client requests: oldest open first, each with who asked, how, for which client, how long ago, and where it stands. */
export function RequestsView({ tasks, onOpen, onNew }: { tasks: Task[]; onOpen: (id: string) => void; onNew?: () => void }) {
  const { t, data, can } = useApp();
  const [scope, setScope] = useState<Scope>('open');
  const all = useMemo(() => tasks.filter(isClientRequest), [tasks]);
  const open = all.filter(isOpenTask); const done = all.filter((x) => !isOpenTask(x));
  const rows = (scope === 'open' ? open : scope === 'done' ? done : all).slice().sort((a, b) => Number(!isOpenTask(a)) - Number(!isOpenTask(b)) || (isOpenTask(a) ? a.created.localeCompare(b.created) : (b.doneAt ?? '').localeCompare(a.doneAt ?? '')));
  const oldest = open.reduce((m, x) => Math.max(m, requestAge(x)), 0);
  const avg = done.length ? Math.round((done.reduce((a, x) => a + requestAge(x), 0) / done.length) * 10) / 10 : null;
  const move = (x: Task, to: TaskStatus) => { if (x.status !== to) { act(setTaskStatus, x.id, to); toast(t('tasks.moved', { status: t('ts.' + to) })); } };
  const days = (n: number) => t(n === 1 ? 'tasks.req.day' : 'tasks.req.days', { n });
  return (
    <div className="stack" data-testid="tasks-requests">
      <div className="tasks-reqbar">
        <p className="small muted tasks-reqsum" data-testid="tasks-requests-summary">
          <b>{t('tasks.req.sum.open', { n: open.length })}</b>
          {open.length > 0 && <> · {t('tasks.req.sum.oldest', { age: days(oldest) })}</>}
          {avg !== null && <> · {t('tasks.req.sum.avg', { n: done.length, age: days(avg) })}</>}
        </p>
        <Seg label={t('common.status')} value={scope} onChange={setScope} options={[{ value: 'open', label: t('tasks.req.scope.open'), count: open.length }, { value: 'done', label: t('tasks.req.scope.done'), count: done.length }, { value: 'all', label: t('common.all') }]} />
      </div>
      <Card flush>
        {!rows.length ? (
          <Empty title={t(all.length ? (scope === 'open' ? 'tasks.req.noneOpen' : 'tasks.req.noneDone') : 'tasks.req.empty')} action={onNew && scope !== 'done' ? <Button variant="primary" icon={<LuPlus aria-hidden="true" />} onClick={onNew}>{t('tasks.req.new')}</Button> : undefined}>{all.length ? undefined : t('tasks.req.emptyHint')}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="tbl stackable tasks-reqtbl">
              <thead><tr><th>{t('tasks.req.col.what')}</th><th>{t('tasks.f.client')}</th><th>{t('tasks.req.col.by')}</th><th>{t('common.assignedTo')}</th><th>{t('tasks.req.col.age')}</th><th>{t('common.due')}</th><th>{t('common.status')}</th></tr></thead>
              <tbody>
                {rows.map((x) => {
                  const c = byId(data.clients, x.clientId); const age = requestAge(x); const closed = !isOpenTask(x);
                  return (
                    <tr key={x.id} data-task={x.id} className={cx(closed && 'tasks-reqdone')}>
                      <td className="t1"><button type="button" className="linkbtn tasks-reqtitle" onClick={() => onOpen(x.id)}><LuInbox aria-hidden="true" />{x.title}</button> {!closed && <PriorityBadge pri={x.pri} />}{(x.comments?.length ?? 0) > 0 && <span className="xs dim tasks-reqc">{t(x.comments!.length === 1 ? 'tasks.c.count.one' : 'tasks.c.count', { n: x.comments!.length })}</span>}</td>
                      <td data-label={t('tasks.f.client')}>{c ? <A to={`/clients/${c.id}/tasks`}>{c.name}</A> : null}</td>
                      <td data-label={t('tasks.req.col.by')} className="small"><span>{x.requestedBy || c?.name || ''}{x.channel && <span className="dim"> · {t('tasks.ch.' + x.channel)}</span>}</span></td>
                      <td data-label={t('common.assignedTo')} className="small">{assigneeName(data, x.assignee) || t('common.unassigned')}</td>
                      <td data-label={t('tasks.req.col.age')}>{closed ? <span className="small muted">{t('tasks.req.took', { age: days(age) })}</span> : <Badge tone={age >= 5 || isOverdue(x) ? 'bad' : age >= 2 ? 'warn' : 'neutral'}>{days(age)}</Badge>}</td>
                      <td data-label={t('common.due')}><DueBadge due={x.due} done={closed} /></td>
                      <td data-label={t('common.status')}>
                        {can('write') ? <select className="tasks-rowmove" value={x.status} onChange={(e) => move(x, e.target.value as TaskStatus)} aria-label={`${t('tasks.moveTo')}: ${x.title}`}>{TASK_STATUSES.map((o) => <option key={o} value={o}>{t('ts.' + o)}</option>)}</select> : t('ts.' + x.status)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
