// A task, in full: what it is, its type, who it is for, and the conversation about it. Used by editions that have more than
// one type of task (the professional-services edition); the others keep the short form in src/app/forms.tsx.
// Writing @Name in a comment tells that person: the mention shows in their notifications.
import { useMemo, useRef, useState } from 'react';
import { LuAtSign, LuSend, LuTrash2 } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { act } from '@/store/store';
import { Avatar, Button, Field, IconButton, Modal, cx, toast } from '@/ui';
import { TASK_STATUSES } from '@/app/forms';
import { addTaskComment, createTask, deleteTask, deleteTaskComment, editTaskComment, updateTask } from '@/domain/actions';
import { taskTypesOf } from '@/domain/config';
import { actorName, byId, isClientRequest, jobsOfClient, requestAge } from '@/domain/selectors';
import { visibleClients } from '@/domain/access';
import type { MessageChannel, Priority, Task, TaskComment, TaskStatus, TeamUser } from '@/domain/types';
import { today } from '@/lib/dates';
import { REQUEST_CHANNELS } from './request';

const PRIORITIES: Priority[] = ['high', 'medium', 'low'];
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A comment's text with the people it mentions set apart. */
function CommentText({ c, users }: { c: TaskComment; users: TeamUser[] }) {
  const names = (c.mentions ?? []).map((id) => byId(users, id)).filter(Boolean).flatMap((u) => [u!.name, u!.name.split(/\s+/)[0]]);
  if (!names.length) return <>{c.text}</>;
  const parts = c.text.split(new RegExp(`(@(?:${names.sort((a, b) => b.length - a.length).map(escapeRe).join('|')}))`, 'i'));
  return <>{parts.map((p, i) => (p.startsWith('@') && i % 2 === 1 ? <b key={i} className="tasks-mention">{p}</b> : p))}</>;
}

/** The conversation on a task. Read-only people read it; everyone else can add to it. */
export function TaskComments({ task }: { task: Task }) {
  const { t, data, can, user, dateTime } = useApp();
  const [text, setText] = useState(''); const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const team = data.users.filter((u) => u.active !== false);
  // what is being typed after the last @, to offer the people it could be
  const typing = /(?:^|\s)@([^\s@]*)$/.exec(text)?.[1];
  const offers = typing === undefined ? [] : team.filter((u) => u.id !== user?.id && u.name.toLowerCase().includes(typing.toLowerCase())).slice(0, 6);
  const mention = (u: TeamUser) => { setText(typing === undefined ? `${text}${text && !/\s$/.test(text) ? ' ' : ''}@${u.name} ` : text.replace(/@([^\s@]*)$/, `@${u.name} `)); box.current?.focus(); };
  const send = () => { const c = act(addTaskComment, task.id, text); if (c) { setText(''); if (c.mentions?.length) toast(t('tasks.c.told', { names: c.mentions.map((id) => byId(data.users, id)?.name.split(' ')[0]).filter(Boolean).join(', ') })); } };
  const saveEdit = () => { if (editing && act(editTaskComment, task.id, editing.id, editing.text)) setEditing(null); };
  const mayDelete = (c: TaskComment) => c.by === user?.id || user?.role === 'owner' || user?.role === 'manager';
  const list = task.comments ?? [];
  return (
    <section className="tasks-comments" aria-label={t('tasks.c.title')} data-testid="tasks-comments">
      <h3>{t('tasks.c.title')}{list.length > 0 && <span className="count">{list.length}</span>}</h3>
      {list.length ? (
        <ol className="tasks-thread">
          {list.map((c) => { const who = actorName(data, c.by) ?? t('common.system'); return (
            <li key={c.id} data-comment={c.id}>
              <Avatar name={who} size="sm" />
              <div className="grow">
                <div className="xs muted"><b className="tasks-cwho">{who}</b> · {dateTime(c.at)}</div>
                {editing?.id === c.id ? (
                  <div className="stack tight"><textarea className="input" rows={2} value={editing.text} onChange={(e) => setEditing({ id: c.id, text: e.target.value })} aria-label={t('common.edit')} /><span className="row tight"><Button size="sm" variant="primary" onClick={saveEdit} disabled={!editing.text.trim()}>{t('common.save')}</Button><Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{t('common.cancel')}</Button></span></div>
                ) : <p className="tasks-ctext"><CommentText c={c} users={data.users} /></p>}
              </div>
              {can('write') && editing?.id !== c.id && (
                <span className="row tight nowrap tasks-cact">
                  {c.by === user?.id && <button type="button" className="linkbtn xs" onClick={() => setEditing({ id: c.id, text: c.text })}>{t('common.edit')}</button>}
                  {mayDelete(c) && <IconButton size="sm" label={`${t('common.delete')}: ${who}`} onClick={() => { act(deleteTaskComment, task.id, c.id); }}><LuTrash2 /></IconButton>}
                </span>
              )}
            </li>
          ); })}
        </ol>
      ) : <p className="small muted">{t('tasks.c.empty')}</p>}
      {can('write') && (
        <div className="tasks-cform">
          <textarea ref={box} className="input" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('tasks.c.ph')} aria-label={t('tasks.c.ph')} data-testid="tasks-comment-text"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) { e.preventDefault(); send(); } }} />
          {offers.length > 0 && <div className="tasks-offers" role="listbox" aria-label={t('tasks.c.mention')}>{offers.map((u) => <button type="button" key={u.id} role="option" aria-selected="false" onClick={() => mention(u)}><Avatar name={u.name} size="sm" />{u.name}</button>)}</div>}
          <div className="row between">
            <button type="button" className="linkbtn small tasks-at" onClick={() => { setText(`${text}${text && !/\s$/.test(text) ? ' ' : ''}@`); box.current?.focus(); }} data-testid="tasks-comment-at"><LuAtSign aria-hidden="true" />{t('tasks.c.mention')}</button>
            <Button size="sm" variant="primary" icon={<LuSend aria-hidden="true" />} onClick={send} disabled={!text.trim()} data-testid="tasks-comment-send">{t('tasks.c.send')}</Button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Add or change a task, with its type and its client. An existing task also shows its conversation. */
export function TaskDialog({ task, defaults, onClose }: { task?: Task; defaults?: Partial<Task>; onClose: () => void }) {
  const { t, data, pack, can, user, perms, date } = useApp();
  const types = taskTypesOf(data, pack);
  const clients = useMemo(() => visibleClients(data, user, perms), [data, user, perms]);
  const base = task ?? defaults ?? {};
  const [title, setTitle] = useState(base.title ?? '');
  const [type, setType] = useState(base.type ?? types[0]?.id ?? 'todo');
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'todo');
  const [assignee, setAssignee] = useState(base.assignee ?? 'u:' + (user?.id ?? data.users[0]?.id ?? ''));
  const [due, setDue] = useState(task ? task.due ?? '' : defaults?.due ?? today());
  const [pri, setPri] = useState<Priority>(base.pri ?? 'medium');
  const [jobId, setJobId] = useState(base.jobId ?? '');
  const [clientId, setClientId] = useState(base.clientId ?? byId(data.jobs, base.jobId)?.clientId ?? '');
  const [description, setDescription] = useState(base.description ?? '');
  const [requestedBy, setRequestedBy] = useState(base.requestedBy ?? '');
  const [channel, setChannel] = useState<MessageChannel>(base.channel ?? 'call');
  const [err, setErr] = useState(false);
  const write = can('write');
  const request = type === 'client_request';
  const jobs = (clientId ? jobsOfClient(data, clientId) : data.jobs.filter((j) => clients.some((c) => c.id === j.clientId))).filter((j) => j.status !== 'done' || j.id === jobId);
  const lead = byId(data.leads, base.leadId);
  const live = task ? byId(data.tasks, task.id) : undefined;

  const save = () => {
    if (!title.trim() || (request && !clientId)) { setErr(true); return; }
    const j = byId(data.jobs, jobId);
    const patch = {
      title: title.trim(), type, status, assignee, due: due || undefined, pri, jobId: jobId || undefined, clientId: j?.clientId ?? (clientId || undefined), leadId: base.leadId, description: description.trim() || undefined,
      requestedBy: request ? requestedBy.trim() || byId(data.clients, clientId)?.name : undefined, channel: request ? channel : undefined,
    };
    if (task) act(updateTask, task.id, patch); else act(createTask, patch);
    toast(t('common.saved')); onClose();
  };
  const remove = () => { if (task) { act(deleteTask, task.id); toast(t('common.deleted')); onClose(); } };
  return (
    <Modal title={t(task ? (request ? 'tasks.req.edit' : 'form.task.edit') : 'form.task.new')} onClose={onClose} labelClose={t('common.close')} size={task ? 'wide' : undefined}>
      <div className={cx('tasks-dialog', task && 'two')}>
        <form onSubmit={(e) => { e.preventDefault(); if (write) save(); }} noValidate>
        <fieldset disabled={!write} className="tasks-fields">
          <div className="fgrid">
            <Field label={<>{t('form.task.title')}<span aria-hidden="true"> *</span></>} htmlFor="task-title" full error={err && !title.trim()}><input id="task-title" value={title} onChange={(e) => { setTitle(e.target.value); setErr(false); }} aria-required="true" data-testid="tasks-title" /></Field>
            <Field label={t('common.type')} htmlFor="task-type"><select id="task-type" value={type} onChange={(e) => setType(e.target.value)} data-testid="tasks-type">{types.map((o) => <option key={o.id} value={o.id}>{t('tt_' + o.id)}</option>)}</select></Field>
            <Field label={t('common.status')} htmlFor="task-status"><select id="task-status" value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>{TASK_STATUSES.map((s) => <option key={s} value={s}>{t('ts.' + s)}</option>)}</select></Field>
            <Field label={t('common.assignedTo')} htmlFor="task-who"><select id="task-who" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              {data.users.filter((u) => u.active !== false || 'u:' + u.id === assignee).map((u) => <option key={u.id} value={'u:' + u.id}>{u.name}</option>)}
              {pack.usesWorkers && data.workers.filter((w) => w.active !== false || 'w:' + w.id === assignee).map((w) => <option key={w.id} value={'w:' + w.id}>{w.name} · {w.trade}</option>)}
            </select></Field>
            <Field label={t('common.due')} htmlFor="task-due"><input id="task-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
            <Field label={t('common.priority')} htmlFor="task-pri"><select id="task-pri" value={pri} onChange={(e) => setPri(e.target.value as Priority)}>{PRIORITIES.map((p) => <option key={p} value={p}>{t('pr.' + p)}</option>)}</select></Field>
            <Field label={<>{t('tasks.f.client')}{request && <span aria-hidden="true"> *</span>}</>} htmlFor="task-client" error={err && request && !clientId}><select id="task-client" value={clientId} onChange={(e) => { setClientId(e.target.value); setJobId(''); setErr(false); }} data-testid="tasks-client">
              <option value="">{t('tasks.f.noClient')}</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.company ? `${c.name} · ${c.company}` : c.name}</option>)}
            </select></Field>
            <Field label={t('project')} htmlFor="task-job" full><select id="task-job" value={jobId} onChange={(e) => { setJobId(e.target.value); const j = byId(data.jobs, e.target.value); if (j) setClientId(j.clientId); }}>
              <option value="">{t('form.task.noJob')}</option>{jobs.map((j) => <option key={j.id} value={j.id}>{clientId ? j.name : `${byId(data.clients, j.clientId)?.name ?? ''} · ${j.name}`}</option>)}
            </select></Field>
            {request && <>
              <Field label={t('tasks.req.by')} htmlFor="task-by"><input id="task-by" value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} placeholder={t('tasks.req.byPh')} /></Field>
              <Field label={t('tasks.req.channel')} htmlFor="task-ch"><select id="task-ch" value={channel} onChange={(e) => setChannel(e.target.value as MessageChannel)}>{REQUEST_CHANNELS.map((c) => <option key={c} value={c}>{t('tasks.ch.' + c)}</option>)}</select></Field>
            </>}
            <Field label={`${t('common.details')} (${t('common.optional')})`} htmlFor="task-desc" full><textarea id="task-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          </div>
          {lead && <p className="small muted tasks-dnote">{t('tasks.leadTag')}: <A to={`/leads/${lead.id}`}>{lead.name}</A></p>}
          {task && isClientRequest(task) && <p className="small muted tasks-dnote">{t('tasks.req.opened', { date: date(task.created), age: t(requestAge(task) === 1 ? 'tasks.req.day' : 'tasks.req.days', { n: requestAge(task) }) })}</p>}
          {err && <p className="small neg" role="alert">{t(request && !clientId ? 'tasks.req.needClient' : 'common.required')}</p>}
        </fieldset>
        <div className="tasks-dfoot">
          {task && can('delete') && write ? <button type="button" className="linkbtn small neg" onClick={remove}>{t('form.task.delete')}</button> : <span />}
          <span className="row tight">{write ? <><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" type="submit" data-testid="tasks-save">{t('common.save')}</Button></> : <Button onClick={onClose}>{t('common.close')}</Button>}</span>
        </div>
        </form>
        {live && <TaskComments task={live} />}
      </div>
    </Modal>
  );
}
