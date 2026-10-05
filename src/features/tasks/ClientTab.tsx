// A client's work on the client page: what they asked for, the tasks open for them, and the dates being watched for them.
// Registered in src/features/clients/tabs.ts.
import { useState } from 'react';
import { LuInbox, LuPlus } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { TaskFormModal } from '@/app/forms';
import { TaskRow } from '@/app/shared';
import { taskTypesOf, moduleOn } from '@/domain/config';
import { CLIENT_REQUEST, byId, deadlinesOfClient, isClientRequest, isOpenTask, jobsOfClient } from '@/domain/selectors';
import { Button, Card } from '@/ui';
import type { ComplianceItem } from '@/domain/types';
import type { ClientTabProps } from '@/features/clients/tabs';
import { DeadlineFormModal, DeadlineRow } from '@/features/deadlines/parts';
import { TaskDialog } from './detail';
import { ClientRequestModal, RequestsView } from './request';
import './tasks.css';

export default function TasksClientTab({ client }: ClientTabProps) {
  const { t, data, pack, can } = useApp();
  const [adding, setAdding] = useState(false);
  const [asking, setAsking] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [deadline, setDeadline] = useState<{ item?: ComplianceItem } | null>(null);
  const types = taskTypesOf(data, pack); const rich = types.length > 1;
  const hasRequests = rich && types.some((x) => x.id === CLIENT_REQUEST);
  const write = can('write');
  // a task belongs to the client directly, or through one of the client's engagements
  const jobIds = new Set(jobsOfClient(data, client.id).map((j) => j.id));
  const all = data.tasks.filter((x) => x.clientId === client.id || (!!x.jobId && jobIds.has(x.jobId)));
  const tasks = all.filter((x) => !hasRequests || !isClientRequest(x)).sort((a, b) => Number(!isOpenTask(a)) - Number(!isOpenTask(b)) || (a.due || '9').localeCompare(b.due || '9'));
  const showDeadlines = moduleOn(data, pack, 'deadlines') && can('deadlines');
  const deadlines = showDeadlines ? deadlinesOfClient(data, client.id) : [];
  const openTask = byId(data.tasks, editing ?? undefined);
  return (
    <div className="stack">
      {hasRequests && (
        <section aria-label={t('tasks.view.requests')}>
          <div className="row between tasks-tabh"><h2>{t('tasks.view.requests')}</h2>{write && <Button size="sm" variant="primary" icon={<LuInbox aria-hidden="true" />} onClick={() => setAsking(true)} data-testid="clients-request-add">{t('tasks.req.new')}</Button>}</div>
          <RequestsView tasks={all} onOpen={setEditing} onNew={write ? () => setAsking(true) : undefined} />
        </section>
      )}
      <Card title={<>{t('nav.tasks')} <span className="count">{tasks.filter(isOpenTask).length}</span></>} actions={write ? <Button size="sm" icon={<LuPlus aria-hidden="true" />} onClick={() => setAdding(true)} data-testid="clients-task-add">{t('form.task.new')}</Button> : undefined}>
        {tasks.length ? <div className="list">{tasks.map((x) => <TaskRow key={x.id} task={x} showJob onEdit={() => setEditing(x.id)} />)}</div> : <p className="muted small">{t('clients.noTasks')}</p>}
      </Card>
      {showDeadlines && (
        <Card title={<>{t('deadlines.client.title')} <span className="count">{deadlines.filter((i) => i.status === 'open').length}</span></>} actions={<>
          <A to={`/deadlines?client=${client.id}`} className="btn sm ghost">{t('nav.deadlines')}</A>
          {write && <Button size="sm" icon={<LuPlus aria-hidden="true" />} onClick={() => setDeadline({})} data-testid="clients-deadline-add">{t('deadlines.new')}</Button>}
        </>}>
          {deadlines.length ? <div className="list">{deadlines.map((i) => <DeadlineRow key={i.id} item={i} showClient={false} onEdit={(item) => setDeadline({ item })} />)}</div> : <p className="muted small">{t('deadlines.client.none')}</p>}
        </Card>
      )}
      {adding && (rich ? <TaskDialog defaults={{ clientId: client.id, assignee: client.assignedTo ? 'u:' + client.assignedTo : undefined }} onClose={() => setAdding(false)} /> : <TaskFormModal defaults={{ clientId: client.id }} onClose={() => setAdding(false)} />)}
      {asking && <ClientRequestModal clientId={client.id} onClose={() => setAsking(false)} />}
      {openTask && (rich ? <TaskDialog key={openTask.id} task={openTask} onClose={() => setEditing(null)} /> : <TaskFormModal task={openTask} onClose={() => setEditing(null)} />)}
      {deadline && <DeadlineFormModal key={deadline.item?.id ?? 'new'} item={deadline.item} defaults={{ clientId: client.id }} onClose={() => setDeadline(null)} />}
    </div>
  );
}
