// Forms of the jobs module: the job itself, a team assignment, an expense and a work update.
import { useId, useState } from 'react';
import { useApp } from '@/app/hooks';
import { A, go } from '@/app/router';
import { act, actorId, mutate } from '@/store/store';
import { Button, Field, FormModal, Modal, cx, toast, type FieldDef } from '@/ui';
import { PAY_TYPES } from '@/app/forms';
import { addExpense, addWorkLog, createJob, saveAssignment, saveClient, updateJob } from '@/domain/actions';
import { byId } from '@/domain/selectors';
import type { Assignment, AssignStatus, Job, JobStatus, PayType, Repeat } from '@/domain/types';
import { money2, parseMoney } from '@/lib/money';
import { today } from '@/lib/dates';
import { REPEATS, autoLines, withRuns, type AutoLine } from './parts';

const NEW = '__new';
export const ASSIGN_STATUSES: AssignStatus[] = ['pending', 'progress', 'done'];

/* ---------- new / edit job ---------- */
export function JobForm({ job, clientId, onClose, onSaved }: { job?: Job; clientId?: string; onClose: () => void; onSaved?: (lines: AutoLine[]) => void }) {
  const { t, data, pack, can } = useApp();
  const uid = useId();
  const showMoney = can('money');
  const [v, setV] = useState(() => {
    const first = job?.clientId ?? byId(data.clients, clientId)?.id ?? data.clients[0]?.id ?? NEW;
    const me = actorId();
    return {
      clientId: first, newName: '', newPhone: '', newEmail: '',
      name: job?.name ?? '', type: job?.type ?? pack.serviceTypes[0]?.id ?? '',
      address: job ? job.address : byId(data.clients, first)?.addresses[0] ?? '',
      price: job && job.price ? String(job.price) : '',
      start: job?.start ?? '', end: job?.end ?? '', repeat: (job?.repeat ?? 'once') as Repeat,
      scope: job?.scope ?? '', payTerms: job?.payTerms ?? '',
      managerId: job?.managerId ?? (byId(data.users, me) ? me : data.users[0]?.id ?? ''),
      status: (job?.status ?? 'estimate') as JobStatus,
    };
  });
  const [err, setErr] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));
  const isNew = v.clientId === NEW;
  const client = byId(data.clients, v.clientId);
  const id = (k: string) => uid + k;

  /** The address follows the client until someone types a different one. */
  const pickClient = (next: string) => {
    const follows = !v.address.trim() || (client?.addresses ?? []).includes(v.address);
    setV((s) => ({ ...s, clientId: next, address: follows ? byId(data.clients, next)?.addresses[0] ?? '' : s.address }));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const bad: string[] = [];
    if (!v.name.trim()) bad.push('name');
    if (isNew && !v.newName.trim()) bad.push('newName');
    if (bad.length) { setErr(bad); setMsg(t('common.required')); return; }
    if (v.start && v.end && v.end < v.start) { setErr(['end']); setMsg(t('jobs.f.datesErr')); return; }
    const address = v.address.trim();
    const name = v.name.trim();
    const before = job?.clientId;
    const { out: jobId, runs } = withRuns(() => {
      const cid = isNew ? act(saveClient, { name: v.newName.trim(), phone: v.newPhone.trim(), email: v.newEmail.trim(), addresses: address ? [address] : [] }).id : v.clientId;
      const patch = {
        name, clientId: cid, type: v.type, address, start: v.start, end: v.end, repeat: v.repeat, scope: v.scope.trim(), payTerms: v.payTerms.trim(), managerId: v.managerId, status: v.status,
        ...(showMoney ? { price: Math.max(0, parseMoney(v.price) ?? 0) } : {}),
      };
      if (!job) return act(createJob, patch).id;
      act(updateJob, job.id, patch);
      // tasks and documents of the job follow it to the new client
      if (cid !== before) mutate((d) => { for (const x of d.tasks) if (x.jobId === job.id) x.clientId = cid; for (const x of d.docs) if (x.jobId === job.id) x.clientId = cid; });
      return job.id;
    });
    const lines = autoLines(t, runs, jobId);
    toast([job ? t('jobs.saved') : t('jobs.created', { name }), ...lines.map((l) => l.text)].join(' '));
    onClose();
    if (job) onSaved?.(lines); else go(`/jobs/${jobId}`);
  };

  const repeatField = pack.recurring ? (
    <Field label={t('jobs.repeat')} full hint={v.repeat !== 'once' ? t('jobs.f.repeatHint') : undefined}>
      <div className="seg jobs-seg" role="group" aria-label={t('jobs.repeat')} data-testid="jobs-f-repeat">
        {REPEATS.map((r) => <button key={r} type="button" aria-pressed={v.repeat === r} onClick={() => set('repeat', r)}>{t('jobs.rp.' + r)}</button>)}
      </div>
    </Field>
  ) : (
    <Field label={t('jobs.repeat')} htmlFor={id('repeat')} hint={v.repeat !== 'once' ? t('jobs.f.repeatHint') : undefined}>
      <select id={id('repeat')} value={v.repeat} onChange={(e) => set('repeat', e.target.value as Repeat)} data-testid="jobs-f-repeat">{REPEATS.map((r) => <option key={r} value={r}>{t('jobs.rp.' + r)}</option>)}</select>
    </Field>
  );

  return (
    <Modal title={job ? t('jobs.edit') : t('newProject')} onClose={onClose} labelClose={t('common.close')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" type="submit" form={id('form')} data-testid="jobs-save">{t('common.save')}</Button></>}>
      <form id={id('form')} onSubmit={submit} noValidate>
        <div className="fgrid">
          {pack.recurring && repeatField}
          <Field label={t('client')} htmlFor={id('client')} full>
            <select id={id('client')} value={v.clientId} onChange={(e) => pickClient(e.target.value)} data-testid="jobs-f-client">
              {data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` · ${c.company}` : ''}</option>)}
              <option value={NEW}>+ {t('jobs.f.newClient')}</option>
            </select>
          </Field>
          {isNew && (
            <div className="full jobs-newclient">
              <div className="fgrid">
                <Field label={<>{t('jobs.f.newName')}<span aria-hidden="true"> *</span></>} htmlFor={id('newName')} error={err.includes('newName')} full>
                  <input id={id('newName')} value={v.newName} onChange={(e) => set('newName', e.target.value)} aria-required="true" aria-invalid={err.includes('newName') || undefined} data-testid="jobs-f-newname" />
                </Field>
                <Field label={t('common.phone')} htmlFor={id('newPhone')}><input id={id('newPhone')} type="tel" value={v.newPhone} onChange={(e) => set('newPhone', e.target.value)} data-testid="jobs-f-newphone" /></Field>
                <Field label={t('common.email')} htmlFor={id('newEmail')}><input id={id('newEmail')} type="email" value={v.newEmail} onChange={(e) => set('newEmail', e.target.value)} data-testid="jobs-f-newemail" /></Field>
              </div>
            </div>
          )}
          <Field label={<>{t('name')}<span aria-hidden="true"> *</span></>} htmlFor={id('name')} error={err.includes('name')}>
            <input id={id('name')} value={v.name} onChange={(e) => set('name', e.target.value)} aria-required="true" aria-invalid={err.includes('name') || undefined} data-testid="jobs-f-name" />
          </Field>
          <Field label={t('type')} htmlFor={id('type')}>
            <select id={id('type')} value={v.type} onChange={(e) => set('type', e.target.value)} data-testid="jobs-f-type">{pack.serviceTypes.map((s) => <option key={s.id} value={s.id}>{t('ty_' + s.id)}</option>)}</select>
          </Field>
          <Field label={t('address')} htmlFor={id('address')} full hint={!job && !isNew && client?.addresses.length ? t('jobs.f.addressHint') : undefined}>
            <input id={id('address')} value={v.address} onChange={(e) => set('address', e.target.value)} list={id('addresses')} autoComplete="off" data-testid="jobs-f-address" />
            <datalist id={id('addresses')}>{(client?.addresses ?? []).map((a) => <option key={a} value={a} />)}</datalist>
          </Field>
          <Field label={t('start')} htmlFor={id('start')}><input id={id('start')} type="date" value={v.start} onChange={(e) => set('start', e.target.value)} data-testid="jobs-f-start" /></Field>
          <Field label={t('end')} htmlFor={id('end')} error={err.includes('end')}><input id={id('end')} type="date" value={v.end} min={v.start || undefined} onChange={(e) => set('end', e.target.value)} data-testid="jobs-f-end" /></Field>
          {!pack.recurring && repeatField}
          {showMoney && (
            <Field label={t('contract')} htmlFor={id('price')} hint={!job ? t('jobs.f.priceHint') : undefined}>
              <input id={id('price')} type="number" min={0} step="0.01" inputMode="decimal" value={v.price} onChange={(e) => set('price', e.target.value)} data-testid="jobs-f-price" />
            </Field>
          )}
          <Field label={t('common.status')} htmlFor={id('status')}>
            <select id={id('status')} value={v.status} onChange={(e) => set('status', e.target.value as JobStatus)} data-testid="jobs-f-status">{pack.jobStatuses.map((s) => <option key={s} value={s}>{t('st_' + s)}</option>)}</select>
          </Field>
          {/* the last of the short fields takes the whole row when it would otherwise sit alone */}
          <Field label={t('jobs.manager')} htmlFor={id('manager')} full={pack.recurring === showMoney}>
            <select id={id('manager')} value={v.managerId} onChange={(e) => set('managerId', e.target.value)} data-testid="jobs-f-manager">{data.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          </Field>
          <Field label={t('scope')} htmlFor={id('scope')} full><textarea id={id('scope')} rows={3} value={v.scope} onChange={(e) => set('scope', e.target.value)} data-testid="jobs-f-scope" /></Field>
          {showMoney && <Field label={t('payTerms')} htmlFor={id('payTerms')} full><textarea id={id('payTerms')} rows={3} value={v.payTerms} onChange={(e) => set('payTerms', e.target.value)} data-testid="jobs-f-terms" /></Field>}
        </div>
        {msg && <p className="small neg" role="alert" style={{ marginTop: 10 }}>{msg}</p>}
      </form>
    </Modal>
  );
}

/* ---------- who does which part of the work, and how it is paid ---------- */
export function AssignmentForm({ job, assignment, onClose }: { job: Job; assignment?: Assignment; onClose: () => void }) {
  const { t, data, can } = useApp();
  const uid = useId();
  const people = data.workers.filter((w) => w.active !== false || w.id === assignment?.workerId);
  const [v, setV] = useState(() => {
    const w = assignment ? undefined : people[0];
    return {
      workerId: assignment?.workerId ?? w?.id ?? '', scope: assignment?.scope ?? '',
      payType: (assignment?.payType ?? w?.payType ?? 'project') as PayType,
      rate: assignment ? String(assignment.rate ?? assignment.price ?? '') : w?.rate ? String(w.rate) : '',
      qty: String(assignment?.qty ?? 1), status: (assignment?.status ?? 'pending') as AssignStatus,
    };
  });
  const [err, setErr] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const id = (k: string) => uid + k;
  const fixed = v.payType === 'project' || v.payType === 'milestone';
  const qty = fixed ? 1 : Number(v.qty) > 0 ? Number(v.qty) : 1;
  const rate = Number(v.rate) || 0;
  const total = Math.round(rate * qty * 100) / 100;
  const worker = byId(data.workers, v.workerId);

  if (!people.length) {
    return (
      <Modal title={t('addAssign')} onClose={onClose} size="narrow" labelClose={t('common.close')}>
        <p className="muted">{t('form.pay.noWorkers')}</p>
        {can('team') && <p style={{ marginTop: 12 }}><A to="/team" className="btn primary">{t('jobs.team.openTeam')}</A></p>}
      </Modal>
    );
  }
  /** A new assignment starts from the way this person is usually paid. */
  const pickWorker = (wid: string) => {
    const w = byId(data.workers, wid);
    setV((s) => (assignment ? { ...s, workerId: wid } : { ...s, workerId: wid, payType: w?.payType ?? s.payType, rate: w?.rate ? String(w.rate) : s.rate }));
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const bad: string[] = [];
    if (!v.scope.trim()) bad.push('scope');
    if (v.rate === '' || !(rate >= 0)) bad.push('rate');
    if (bad.length) { setErr(bad); setMsg(bad.includes('scope') ? t('common.required') : t('jobs.as.rateErr')); return; }
    act(saveAssignment, job.id, { workerId: v.workerId, scope: v.scope.trim(), price: total, payType: v.payType, rate, qty, status: v.status }, assignment?.id);
    toast(t('jobs.team.saved')); onClose();
  };
  return (
    <Modal title={assignment ? t('jobs.team.edit') : t('addAssign')} onClose={onClose} labelClose={t('common.close')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" type="submit" form={id('form')} data-testid="jobs-as-save">{t('common.save')}</Button></>}>
      <form id={id('form')} onSubmit={submit} noValidate>
        <div className="fgrid">
          <Field label={t('sub')} htmlFor={id('worker')} full hint={worker?.rate && worker.payType && worker.payType !== 'project' && worker.payType !== 'milestone' ? t('rateHint', { rate: money2(worker.rate), unit: t('pu_' + worker.payType) }) : undefined}>
            <select id={id('worker')} value={v.workerId} onChange={(e) => pickWorker(e.target.value)} data-testid="jobs-as-worker">{people.map((w) => <option key={w.id} value={w.id}>{w.name} · {w.trade}</option>)}</select>
          </Field>
          <Field label={<>{t('part')}<span aria-hidden="true"> *</span></>} htmlFor={id('scope')} full error={err.includes('scope')}>
            <input id={id('scope')} value={v.scope} onChange={(e) => setV({ ...v, scope: e.target.value })} aria-required="true" aria-invalid={err.includes('scope') || undefined} data-testid="jobs-as-scope" />
          </Field>
          <Field label={t('form.pay.type')} htmlFor={id('payType')}>
            <select id={id('payType')} value={v.payType} onChange={(e) => setV({ ...v, payType: e.target.value as PayType })} data-testid="jobs-as-paytype">{PAY_TYPES.map((x) => <option key={x} value={x}>{t('jobs.pt.' + x)}</option>)}</select>
          </Field>
          <Field label={<>{fixed ? t('jobs.as.price') : t('jobs.as.rate', { unit: t('pu_' + v.payType) })}<span aria-hidden="true"> *</span></>} htmlFor={id('rate')} error={err.includes('rate')}>
            <input id={id('rate')} type="number" min={0} step="0.01" inputMode="decimal" value={v.rate} onChange={(e) => setV({ ...v, rate: e.target.value })} aria-required="true" aria-invalid={err.includes('rate') || undefined} data-testid="jobs-as-rate" />
          </Field>
          {!fixed && (
            <Field label={t('jobs.as.qty.' + v.payType)} htmlFor={id('qty')}>
              <input id={id('qty')} type="number" min={0} step="0.5" inputMode="decimal" value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value })} data-testid="jobs-as-qty" />
            </Field>
          )}
          <Field label={t('common.status')} htmlFor={id('status')}>
            <select id={id('status')} value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as AssignStatus })} data-testid="jobs-as-status">{ASSIGN_STATUSES.map((s) => <option key={s} value={s}>{t('a_' + s)}</option>)}</select>
          </Field>
        </div>
        <div className={cx('jobs-total', !fixed && 'calc')} aria-live="polite">
          <span>{t('jobs.as.total')}{!fixed && <span className="muted small"> · {money2(rate)} × {qty}</span>}</span>
          <b data-testid="jobs-as-total">{money2(total)}</b>
        </div>
        {msg && <p className="small neg" role="alert" style={{ marginTop: 10 }}>{msg}</p>}
      </form>
    </Modal>
  );
}

/* ---------- an expense on the job ---------- */
export function ExpenseForm({ job, onClose }: { job: Job; onClose: () => void }) {
  const { t } = useApp();
  const fields: FieldDef[] = [
    { k: 'desc', label: t('desc'), req: true, full: true }, { k: 'vendor', label: t('vendor') },
    { k: 'amount', label: t('common.amount'), type: 'money', req: true }, { k: 'date', label: t('common.date'), type: 'date', req: true },
  ];
  return (
    <FormModal title={t('addPurch')} fields={fields} initial={{ date: today() }} onClose={onClose} saveLabel={t('common.save')} cancelLabel={t('common.cancel')} requiredMsg={t('common.required')}
      validate={(v) => (v.amount > 0 ? null : t('form.pay.positive'))}
      onSave={(v) => { act(addExpense, job.id, { desc: v.desc, vendor: v.vendor || '', amount: v.amount, date: v.date }); toast(t('jobs.money.expAdded')); }} />
  );
}

/* ---------- a work update, written by the office or on behalf of someone on the job ---------- */
export function LogForm({ job, onClose }: { job: Job; onClose: () => void }) {
  const { t, data } = useApp();
  const me = byId(data.users, actorId());
  const onJob = job.assign.map((a) => a.workerId);
  const workers = [...data.workers.filter((w) => onJob.includes(w.id)), ...data.workers.filter((w) => !onJob.includes(w.id) && w.active !== false)];
  const who: [string, string][] = [...(me ? [[me.id, t('jobs.log.you', { name: me.name })] as [string, string]] : []), ...workers.map((w) => [w.id, `${w.name} · ${w.trade}`] as [string, string])];
  const fields: FieldDef[] = [
    { k: 'who', label: t('jobs.log.who'), type: 'select', options: who, full: true },
    { k: 'text', label: t('jobs.log.what'), type: 'textarea', req: true },
  ];
  return (
    <FormModal title={t('jobs.log.add')} fields={fields} initial={{ who: who[0]?.[0] ?? '' }} onClose={onClose} saveLabel={t('common.save')} cancelLabel={t('common.cancel')} requiredMsg={t('common.required')}
      onSave={(v) => { act(addWorkLog, job.id, v.who, v.text); toast(t('jobs.log.added')); }} />
  );
}
