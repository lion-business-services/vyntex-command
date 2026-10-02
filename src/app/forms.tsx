// Forms that several modules open: add or edit a task, record a client payment, pay a worker.
// Kept here so every module records these the same way.
import { useMemo, useState } from 'react';
import { LuPlus, LuX } from 'react-icons/lu';
import { useApp } from './hooks';
import { act } from '@/store/store';
import { Button, Field, FormModal, IconButton, Modal, toast, type FieldDef } from '@/ui';
import { addClientPayment, createTask, deleteTask, payWorker, updateTask } from '@/domain/actions';
import { byId, jobMoney, workerMoney } from '@/domain/selectors';
import type { PayMethod, PayType, Priority, Task, TaskStatus } from '@/domain/types';
import { money2 } from '@/lib/money';
import { addDays, today } from '@/lib/dates';

export const PAY_METHODS: PayMethod[] = ['cash', 'check', 'transfer', 'zelle', 'card'];
export const PAY_TYPES: PayType[] = ['project', 'milestone', 'daily', 'weekly', 'monthly', 'hourly'];
export const TASK_STATUSES: TaskStatus[] = ['todo', 'doing', 'waiting', 'review', 'done'];
const PRIORITIES: Priority[] = ['high', 'medium', 'low'];

/** Add or edit a task. Pass `task` to edit; otherwise `defaults` pre-fill a new one (job, lead, assignee, due date). */
export function TaskFormModal({ task, defaults, onClose }: { task?: Task; defaults?: Partial<Task>; onClose: () => void }) {
  const { t, data, can } = useApp();
  const jobId = task?.jobId ?? defaults?.jobId;
  const job = byId(data.jobs, jobId);
  // people on the job first, then the rest of the team
  const onJob = job ? job.assign.map((a) => a.workerId) : [];
  const workers = [...data.workers.filter((w) => onJob.includes(w.id)), ...data.workers.filter((w) => !onJob.includes(w.id) && w.active !== false)];
  const fields: FieldDef[] = [
    { k: 'title', label: t('form.task.title'), req: true, full: true },
    { k: 'description', label: `${t('common.details')} (${t('common.optional')})`, type: 'textarea' },
    { k: 'assignee', label: t('common.assignedTo'), type: 'select', options: [...data.users.map((u) => ['u:' + u.id, u.name] as [string, string]), ...workers.map((w) => ['w:' + w.id, `${w.name} · ${w.trade}`] as [string, string])] },
    { k: 'due', label: t('common.due'), type: 'date' },
    { k: 'pri', label: t('common.priority'), type: 'select', options: PRIORITIES.map((p) => [p, t('pr.' + p)]) },
    { k: 'status', label: t('common.status'), type: 'select', options: TASK_STATUSES.map((s) => [s, t('ts.' + s)]) },
    { k: 'jobId', label: t('project'), type: 'select', options: [['', t('form.task.noJob')], ...data.jobs.filter((j) => j.status !== 'done' || j.id === jobId).map((j) => [j.id, `${byId(data.clients, j.clientId)?.name ?? ''} · ${j.name}`] as [string, string])] },
  ];
  const initial = task ? { ...task, jobId: task.jobId ?? '' } : { assignee: 'u:' + (data.users[0]?.id ?? 'u1'), due: today(), pri: 'medium', status: 'todo', jobId: '', ...defaults };
  const remove = task && can('delete') ? <button type="button" className="linkbtn small neg" style={{ marginTop: 12 }} onClick={() => { act(deleteTask, task.id); toast(t('common.deleted')); onClose(); }}>{t('form.task.delete')}</button> : null;
  return (
    <FormModal title={t(task ? 'form.task.edit' : 'form.task.new')} fields={fields} initial={initial} onClose={onClose} saveLabel={t('common.save')} cancelLabel={t('common.cancel')} requiredMsg={t('common.required')} extra={remove}
      onSave={(v) => {
        const j = byId(data.jobs, v.jobId);
        const patch = { title: v.title, description: v.description || undefined, assignee: v.assignee, due: v.due || undefined, pri: v.pri as Priority, status: v.status as TaskStatus, jobId: v.jobId || undefined, clientId: j?.clientId ?? task?.clientId ?? defaults?.clientId, leadId: task?.leadId ?? defaults?.leadId };
        if (task) act(updateTask, task.id, patch); else act(createTask, patch);
        toast(t('common.saved'));
      }} />
  );
}

/** Record money received from a client for a job. The balance and the invoice status update by themselves. */
export function ClientPaymentModal({ jobId, onClose }: { jobId?: string; onClose: () => void }) {
  const { t, data } = useApp();
  const open = data.jobs.filter((j) => j.status !== 'estimate');
  const owing = (j: (typeof open)[number]) => jobMoney(data, j).clientOwes > 0;
  const pick = byId(data.jobs, jobId) ?? open.find((j) => (j.status === 'progress' || j.status === 'done') && owing(j)) ?? open.find(owing) ?? open[0];
  const label = (id: string) => { const j = byId(data.jobs, id); return j ? `${byId(data.clients, j.clientId)?.name ?? ''} · ${j.name} (${t('form.pay.owes', { amount: money2(jobMoney(data, j).clientOwes) })})` : ''; };
  const fields: FieldDef[] = [
    ...(jobId ? [] : [{ k: 'jobId', label: t('project'), type: 'select' as const, options: open.map((j) => [j.id, label(j.id)] as [string, string]), full: true, req: true }]),
    { k: 'amount', label: t('common.amount'), type: 'money', req: true }, { k: 'date', label: t('common.date'), type: 'date', req: true },
    { k: 'method', label: t('common.method'), type: 'select', options: PAY_METHODS.map((m) => [m, t('m_' + m)]) }, { k: 'ref', label: t('form.pay.ref') },
  ];
  if (!pick) return <Modal title={t('form.pay.client')} onClose={onClose} size="narrow" labelClose={t('common.close')}><p className="muted">{t('form.pay.noJobs')}</p></Modal>;
  return (
    <FormModal title={t('form.pay.client')} fields={fields} initial={{ jobId: pick.id, date: today(), method: 'check', amount: '' }} onClose={onClose} saveLabel={t('form.pay.record')} cancelLabel={t('common.cancel')} requiredMsg={t('common.required')}
      validate={(v) => {
        const j = byId(data.jobs, jobId ?? v.jobId); if (!j) return t('common.required');
        if (!(v.amount > 0)) return t('form.pay.positive');
        const owes = jobMoney(data, j).clientOwes;
        return v.amount > owes + 0.005 ? t('form.pay.tooMuch', { amount: money2(owes) }) : null;
      }}
      onSave={(v) => { act(addClientPayment, jobId ?? v.jobId, { amount: v.amount, date: v.date, method: v.method as PayMethod, ref: v.ref || '' }); toast(t('form.pay.recorded', { amount: money2(v.amount) })); }} />
  );
}

/** Pay a worker. One payment can be split across several jobs, or left "not tied to a job". */
export function PayWorkerModal({ workerId, jobId, onClose }: { workerId?: string; jobId?: string; onClose: () => void }) {
  const { t, data } = useApp();
  const job = byId(data.jobs, jobId);
  const people = useMemo(() => {
    const active = data.workers.filter((w) => w.active !== false || w.id === workerId);
    if (!job) return active;
    const on = job.assign.map((a) => a.workerId);
    return [...active.filter((w) => on.includes(w.id)), ...active.filter((w) => !on.includes(w.id))];
  }, [data.workers, job, workerId]);
  const [who, setWho] = useState(workerId ?? people[0]?.id ?? '');
  const worker = byId(data.workers, who);
  const firstJob = (id: string) => jobId ?? data.jobs.find((j) => j.status !== 'done' && j.assign.some((a) => a.workerId === id))?.id ?? '';
  const [type, setType] = useState<PayType>(worker?.payType ?? 'project');
  const [date, setDate] = useState(today());
  const [from, setFrom] = useState(''); const [to, setTo] = useState(today());
  const [qty, setQty] = useState(''); const [rate, setRate] = useState(worker?.rate ? String(worker.rate) : '');
  const [method, setMethod] = useState<PayMethod>('check'); const [ref, setRef] = useState('');
  const [lines, setLines] = useState<{ jobId: string; amount: string }[]>([{ jobId: firstJob(who), amount: '' }]);
  const [err, setErr] = useState('');
  const periodic = type !== 'project' && type !== 'milestone';
  const total = lines.reduce((a, l) => a + (Number(l.amount) || 0), 0);
  const owed = worker ? workerMoney(data, worker.id).owed : 0;

  const pickWorker = (id: string) => { const w = byId(data.workers, id); setWho(id); setType(w?.payType ?? 'project'); setRate(w?.rate ? String(w.rate) : ''); setLines([{ jobId: firstJob(id), amount: '' }]); };
  const pickType = (ty: PayType) => { setType(ty); const span = { daily: 0, weekly: 6, monthly: 29, hourly: 0, project: 0, milestone: 0 }[ty]; setFrom(ty === 'project' || ty === 'milestone' ? '' : addDays(-span)); };
  const calc = (q: string, r: string) => { setQty(q); setRate(r); if (Number(q) && Number(r) && lines.length === 1) setLines([{ ...lines[0], amount: (Number(q) * Number(r)).toFixed(2) }]); };
  const mine = data.jobs.filter((j) => j.assign.some((a) => a.workerId === who));
  const jobOptions = [...mine, ...data.jobs.filter((j) => !mine.includes(j))];
  const save = () => {
    const clean = lines.map((l) => ({ jobId: l.jobId, amount: Math.round((Number(l.amount) || 0) * 100) / 100 }));
    const ok = act(payWorker, { workerId: who, date, method, ref, payType: type, from: periodic ? from || undefined : undefined, to: periodic ? to || undefined : undefined }, clean);
    if (!ok) { setErr(t('form.pay.linesErr')); return; }
    toast(t('form.pay.paid', { amount: money2(total), worker: worker?.name ?? '' })); onClose();
  };
  if (!people.length) return <Modal title={t('form.pay.worker')} onClose={onClose} size="narrow" labelClose={t('common.close')}><p className="muted">{t('form.pay.noWorkers')}</p></Modal>;
  return (
    <Modal title={t('form.pay.worker')} onClose={onClose} labelClose={t('common.close')} footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={save} data-testid="pay-worker-save">{t('form.pay.record')}</Button></>}>
      <div className="fgrid">
        <Field label={t('sub')} full hint={worker ? `${t('form.pay.stillOwed', { amount: money2(Math.max(0, owed)) })}${worker.rate && worker.payType && worker.payType !== 'project' ? ' · ' + t('rateHint', { rate: money2(worker.rate), unit: t('pu_' + worker.payType) }) : ''}` : undefined}>
          <select value={who} onChange={(e) => pickWorker(e.target.value)} data-testid="pay-worker-who">{people.map((w) => <option key={w.id} value={w.id}>{w.name} · {w.trade}</option>)}</select>
        </Field>
        <Field label={t('form.pay.type')}><select value={type} onChange={(e) => pickType(e.target.value as PayType)}>{PAY_TYPES.map((x) => <option key={x} value={x}>{t('pt_' + x)}</option>)}</select></Field>
        <Field label={t('common.date')}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {periodic && <>
          <Field label={`${t('form.pay.period')}: ${t('common.from').toLowerCase()}`}><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={t('common.to')}><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label={t('form.pay.qty')}><input type="number" min={0} step="0.5" inputMode="decimal" value={qty} onChange={(e) => calc(e.target.value, rate)} /></Field>
          <Field label={t('form.pay.rate')}><input type="number" min={0} step="0.01" inputMode="decimal" value={rate} onChange={(e) => calc(qty, e.target.value)} /></Field>
        </>}
        <Field label={t('common.method')} hint={method === 'card' ? t('form.pay.cardHint') : undefined}><select value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>{PAY_METHODS.map((m) => <option key={m} value={m}>{t('m_' + m)}</option>)}</select></Field>
        <Field label={t('form.pay.ref')}><input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      </div>
      <h3 style={{ margin: '18px 0 8px' }}>{t('form.pay.forJobs')}</h3>
      <div className="stack tight">
        {lines.map((l, i) => (
          <div className="row nowrap" key={i}>
            <select className="input grow" value={l.jobId} onChange={(e) => setLines(lines.map((x, n) => (n === i ? { ...x, jobId: e.target.value } : x)))} aria-label={t('project')}>
              {jobOptions.map((j) => <option key={j.id} value={j.id}>{byId(data.clients, j.clientId)?.name} · {j.name}</option>)}
              <option value="">{t('form.pay.noJob')}</option>
            </select>
            <input className="input" style={{ width: 120, flex: 'none' }} type="number" min={0} step="0.01" inputMode="decimal" placeholder={t('common.amount')} aria-label={t('common.amount')} value={l.amount} onChange={(e) => { setErr(''); setLines(lines.map((x, n) => (n === i ? { ...x, amount: e.target.value } : x))); }} data-testid="pay-worker-amount" />
            {lines.length > 1 && <IconButton size="sm" label={t('common.delete')} onClick={() => setLines(lines.filter((_, n) => n !== i))}><LuX /></IconButton>}
          </div>
        ))}
      </div>
      <button type="button" className="linkbtn small" style={{ marginTop: 8 }} onClick={() => setLines([...lines, { jobId: '', amount: '' }])}><LuPlus aria-hidden="true" style={{ verticalAlign: '-2px' }} /> {t('form.pay.split')}</button>
      <div className="row between" style={{ borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 10 }}><b>{t('common.total')}</b><b>{money2(total)}</b></div>
      {err && <p className="small neg" role="alert" style={{ marginTop: 8 }}>{err}</p>}
    </Modal>
  );
}
