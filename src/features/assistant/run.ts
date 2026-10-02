// Carries out a confirmed proposal through the same business actions the rest of the app uses,
// then reads the data back to make sure the change is really there before reporting it.
import { act, getSnapshot } from '@/store/store';
import { addClientPayment, addNote, createLead, createTask, setJobStatus, setTaskStatus, updateLead } from '@/domain/actions';
import { byId, jobMoney } from '@/domain/selectors';
import { money2 } from '@/lib/money';
import { check, type Env, type Proposal } from './engine';

export interface Outcome { ok: boolean; text: string; link?: { label: string; to: string }; /** Names of the automation rules that ran because of the change. */ rules?: string[] }

export function execute(p: Proposal, env: Env): Outcome {
  const { t } = env;
  const blocked = check(p, env);
  if (blocked) return { ok: false, text: t('asst.state.failed', { why: blocked }) };
  const seen = new Set(getSnapshot().data.automation.runs.map((r) => r.id));
  const failed: Outcome = { ok: false, text: t('asst.state.failed', { why: t('asst.failed.generic') }) };
  let out: Outcome = failed;
  try {
    switch (p.kind) {
      case 'task': {
        const task = act(createTask, { title: p.title, due: p.due, assignee: p.assignee, pri: 'medium' });
        if (byId(getSnapshot().data.tasks, task.id)) out = { ok: true, text: t('asst.done.task'), link: { label: t('asst.open.task'), to: `/tasks?task=${task.id}` } };
        break;
      }
      case 'lead': {
        const lead = act(createLead, { name: p.name, phone: p.phone, email: '', address: '', type: p.type, source: 'other', pri: 'medium', ownerId: env.actor, value: null });
        if (byId(getSnapshot().data.leads, lead.id)) out = { ok: true, text: t('asst.done.lead'), link: { label: t('asst.open.lead'), to: `/leads/${lead.id}` } };
        break;
      }
      case 'note': {
        const holder = () => { const d = getSnapshot().data; return p.ref.type === 'lead' ? byId(d.leads, p.ref.id) : p.ref.type === 'client' ? byId(d.clients, p.ref.id) : byId(d.jobs, p.ref.id); };
        const before = holder()?.notes.length ?? 0;
        act(addNote, p.ref, 'note', p.text);
        const now = holder();
        if (now && now.notes.length === before + 1) out = { ok: true, text: t('asst.done.note', { name: now.name }), link: { label: t('asst.open.record'), to: p.ref.type === 'lead' ? `/leads/${p.ref.id}` : p.ref.type === 'client' ? `/clients/${p.ref.id}` : `/jobs/${p.ref.id}` } };
        break;
      }
      case 'taskDone': {
        act(setTaskStatus, p.taskId, 'done');
        const task = byId(getSnapshot().data.tasks, p.taskId);
        if (task?.status === 'done') out = { ok: true, text: t('asst.done.taskDone'), link: { label: t('asst.open.task'), to: `/tasks?task=${task.id}` } };
        break;
      }
      case 'jobStatus': {
        act(setJobStatus, p.jobId, p.status);
        const job = byId(getSnapshot().data.jobs, p.jobId);
        if (job?.status === p.status) out = { ok: true, text: t('asst.done.jobStatus', { name: job.name, status: t('st_' + job.status) }), link: { label: t('asst.open.job'), to: `/jobs/${job.id}` } };
        break;
      }
      case 'payment': {
        const before = byId(getSnapshot().data.jobs, p.jobId)?.received.length ?? 0;
        act(addClientPayment, p.jobId, { amount: p.amount, date: p.date, method: p.method, ref: '' });
        const d = getSnapshot().data; const job = byId(d.jobs, p.jobId);
        if (job && job.received.length === before + 1) out = { ok: true, text: t('asst.done.payment', { amount: money2(p.amount), name: job.name, balance: money2(Math.max(0, jobMoney(d, job).clientOwes)) }), link: { label: t('asst.open.job'), to: `/jobs/${job.id}` } };
        break;
      }
      case 'visit': {
        act(updateLead, p.leadId, { apptDate: p.date, apptTime: p.time });
        const lead = byId(getSnapshot().data.leads, p.leadId);
        if (lead && lead.apptDate === p.date) out = { ok: true, text: t('asst.done.visit', { name: lead.name, date: env.day(p.date) + (p.time ? `, ${env.time(p.time)}` : '') }), link: { label: t('asst.open.lead'), to: `/leads/${lead.id}` } };
        break;
      }
    }
  } catch {
    return failed;
  }
  if (out.ok) {
    const ran = getSnapshot().data.automation.runs.filter((r) => !seen.has(r.id)).map((r) => t(`auto.${r.ruleId}.name`));
    if (ran.length) out.rules = [...new Set(ran)];
  }
  return out;
}
