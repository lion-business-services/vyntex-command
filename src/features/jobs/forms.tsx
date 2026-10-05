// Forms of the jobs module: the job itself (an engagement in the professional-services edition), a team assignment, an expense and a work update.
import { useId, useState } from 'react';
import { useApp } from '@/app/hooks';
import { A, go } from '@/app/router';
import { act, actorId, ctx as currentCtx, getSnapshot, mutate } from '@/store/store';
import { Button, Field, FormModal, Modal, cx, toast, type FieldDef } from '@/ui';
import { PAY_TYPES } from '@/app/forms';
import { addExpense, addWorkLog, createJob, saveAssignment, saveClient, updateJob } from '@/domain/actions';
import { type Service, TIER_UNITS, playbookTasks, serviceName } from '@/domain/actions/catalog';
import { type Engagement, fromService, periodFor } from '@/domain/actions/jobs';
import { visibleClients } from '@/domain/access';
import { byId } from '@/domain/selectors';
import type { Assignment, AssignStatus, CatalogTier, Job, JobStatus, PayType, Repeat } from '@/domain/types';
import { categoriesOf, categoryLabel, tierPrice } from '@/features/catalog/parts';
import { money2, parseMoney } from '@/lib/money';
import { today } from '@/lib/dates';
import { repeatsOf, autoLines, withRuns, type AutoLine } from './parts';

type Unit = CatalogTier['unit'];

const NEW = '__new';
export const ASSIGN_STATUSES: AssignStatus[] = ['pending', 'progress', 'done'];

/* ---------- new / edit job ---------- */
/**
 * The form of a job. Where the company keeps a service catalog the work can be started from a service and one of its price
 * tiers: name, price, unit and rhythm are filled in from it and stay editable. In the professional-services edition the
 * job is an engagement, so it also has a period and an office and no work address. A company without a catalog sees the
 * form it always had.
 */
export function JobForm({ job, clientId, serviceId, onClose, onSaved }: { job?: Engagement; clientId?: string; serviceId?: string; onClose: () => void; onSaved?: (lines: AutoLine[]) => void }) {
  const { t, data, pack, can, lang, user, perms } = useApp();
  const uid = useId();
  const showMoney = can('money');
  const office = pack.family === 'practice';
  // a person only picks among the clients they may open
  const clients = visibleClients(data, user, perms);
  const services = (data.catalog ?? []).filter((x) => x.active || x.id === job?.serviceId);
  const hasCatalog = services.length > 0;
  const [v, setV] = useState(() => {
    const first = job?.clientId ?? byId(clients, clientId)?.id ?? clients[0]?.id ?? NEW;
    const me = actorId();
    const start = byId(services, serviceId);
    const from = start && !job ? fromService(data, currentCtx(), start.id) : null;
    const c = byId(data.clients, first);
    return {
      clientId: first, newName: '', newPhone: '', newEmail: '',
      serviceId: job?.serviceId ?? from?.serviceId ?? '', tierId: job?.tierId ?? from?.tierId ?? '',
      name: job?.name ?? from?.name ?? '', type: job?.type ?? from?.type ?? pack.serviceTypes[0]?.id ?? '',
      address: job ? job.address : office ? '' : c?.addresses[0] ?? '',
      price: job && job.price ? String(job.price) : from?.price ? String(from.price) : '',
      unit: (job?.unit ?? from?.unit ?? 'flat') as Unit,
      start: job?.start ?? '', end: job?.end ?? '', repeat: (job?.repeat ?? from?.repeat ?? 'once') as Repeat,
      period: job?.period ?? (office && from ? periodFor(from.repeat, today(), lang) : ''),
      officeId: job ? job.officeId ?? '' : c?.officeId ?? '',
      scope: job?.scope ?? '', payTerms: job?.payTerms ?? '',
      managerId: job?.managerId ?? (office && c?.assignedTo && byId(data.users, c.assignedTo) ? c.assignedTo : byId(data.users, me) ? me : data.users[0]?.id ?? ''),
      status: (job?.status ?? 'estimate') as JobStatus,
    };
  });
  const [err, setErr] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));
  const isNew = v.clientId === NEW;
  const client = byId(data.clients, v.clientId);
  const service = byId(services, v.serviceId) as Service | undefined;
  const id = (k: string) => uid + k;

  /** The address follows the client until someone types a different one. In an office, so do the office and the person responsible on a new engagement. */
  const pickClient = (next: string) => {
    const follows = !v.address.trim() || (client?.addresses ?? []).includes(v.address);
    const c = byId(data.clients, next);
    setV((s) => ({
      ...s, clientId: next, address: office ? s.address : follows ? c?.addresses[0] ?? '' : s.address,
      ...(office && !job && c ? { officeId: c.officeId ?? s.officeId, managerId: c.assignedTo && byId(data.users, c.assignedTo) ? c.assignedTo : s.managerId } : {}),
    }));
  };
  /** Picking a service fills in what the catalog knows. The name follows the service until someone writes their own. */
  const pickService = (next: string, tierId?: string) => {
    const from = next ? fromService(data, currentCtx(), next, tierId) : null;
    if (!from) { setV((s) => ({ ...s, serviceId: '', tierId: '' })); return; }
    const before = service ? serviceName(service, lang) : '';
    setV((s) => {
      const sameService = s.serviceId === next;
      const autoPeriod = !s.period.trim() || s.period === periodFor(s.repeat, s.start || today(), lang);
      return {
        ...s, serviceId: next, tierId: from.tierId ?? '', price: showMoney ? (from.price ? String(from.price) : '') : s.price, unit: (from.unit ?? 'flat') as Unit,
        name: !s.name.trim() || s.name === before ? from.name ?? s.name : s.name,
        ...(sameService ? {} : { type: from.type ?? s.type, repeat: (from.repeat ?? 'once') as Repeat, period: office && autoPeriod ? periodFor(from.repeat, s.start || today(), lang) : s.period }),
      };
    });
  };
  /** The period follows the rhythm until someone writes their own. */
  const pickRepeat = (r: Repeat) => setV((s) => ({ ...s, repeat: r, period: office && (!s.period.trim() || s.period === periodFor(s.repeat, s.start || today(), lang)) ? periodFor(r, s.start || today(), lang) : s.period }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const bad: string[] = [];
    if (!v.name.trim()) bad.push('name');
    if (isNew && !v.newName.trim()) bad.push('newName');
    if (bad.length) { setErr(bad); setMsg(t('common.required')); return; }
    if (v.start && v.end && v.end < v.start) { setErr(['end']); setMsg(t('jobs.f.datesErr')); return; }
    const price = v.price.trim() ? parseMoney(v.price) : 0;
    if (showMoney && (price === null || price < 0)) { setErr(['price']); setMsg(t('jobs.f.priceErr')); return; }
    const address = v.address.trim();
    const name = v.name.trim();
    const before = job?.clientId;
    const known = getSnapshot().data; const hadTasks = job ? playbookTasks(known, job.id).length : 0;
    const { out: jobId, runs } = withRuns(() => {
      const cid = isNew ? act(saveClient, { name: v.newName.trim(), phone: v.newPhone.trim(), email: v.newEmail.trim(), addresses: address ? [address] : [], ...(office && v.officeId ? { officeId: v.officeId } : {}) }).id : v.clientId;
      const patch: Partial<Engagement> & { name: string; clientId: string } = {
        name, clientId: cid, type: v.type, address, start: v.start, end: v.end, repeat: v.repeat, scope: v.scope.trim(), payTerms: v.payTerms.trim(), managerId: v.managerId, status: v.status,
        ...(showMoney ? { price: price ?? 0 } : {}),
        // what ties the work to the catalog; left as it was on a company that keeps none
        ...(hasCatalog || job?.serviceId ? { serviceId: v.serviceId || undefined, tierId: v.serviceId ? v.tierId || undefined : undefined, unit: v.serviceId || office ? v.unit : undefined } : {}),
        ...(office ? { period: v.period.trim() || undefined, officeId: v.officeId || undefined } : {}),
      };
      if (!job) return act(createJob, patch).id;
      act(updateJob, job.id, patch);
      // tasks and documents of the job follow it to the new client
      if (cid !== before) mutate((d) => { for (const x of d.tasks) if (x.jobId === job.id) x.clientId = cid; for (const x of d.docs) if (x.jobId === job.id) x.clientId = cid; });
      return job.id;
    });
    const lines = autoLines(t, runs, jobId);
    const started = playbookTasks(getSnapshot().data, jobId).length - hadTasks;
    if (started > 0) lines.push({ kind: 'tasks', text: t('jobs.auto.playbook', { n: started }) });
    toast([job ? t('jobs.saved') : t('jobs.created', { name }), ...lines.map((l) => l.text)].join(' '));
    onClose();
    if (job) onSaved?.(lines); else go(`/jobs/${jobId}`);
  };

  const repeatField = pack.recurring ? (
    <Field label={t('jobs.repeat')} full hint={v.repeat !== 'once' ? t(office ? 'jobs.f.rollHint' : 'jobs.f.repeatHint') : undefined}>
      <div className="seg jobs-seg" role="group" aria-label={t('jobs.repeat')} data-testid="jobs-f-repeat">
        {repeatsOf(pack).map((r) => <button key={r} type="button" aria-pressed={v.repeat === r} onClick={() => pickRepeat(r)}>{t('jobs.rp.' + r)}</button>)}
      </div>
    </Field>
  ) : (
    <Field label={t('jobs.repeat')} htmlFor={id('repeat')} hint={v.repeat !== 'once' ? t('jobs.f.repeatHint') : undefined}>
      <select id={id('repeat')} value={v.repeat} onChange={(e) => pickRepeat(e.target.value as Repeat)} data-testid="jobs-f-repeat">{repeatsOf(pack).map((r) => <option key={r} value={r}>{t('jobs.rp.' + r)}</option>)}</select>
    </Field>
  );
  // the short fields sit two to a row; when their number is odd the last one takes the whole row
  const short = 2 /* name, type */ + (hasCatalog && service && service.tiers.length > 1 ? 2 : hasCatalog ? 1 : 0) + 2 /* start, end */ + (pack.recurring ? 0 : 1) + (showMoney ? 1 : 0) + (showMoney && (office || !!v.serviceId) ? 1 : 0)
    + (office ? 1 : 0) + (office && data.offices.length > 0 ? 1 : 0) + 2 /* status, manager */;
  const groups = categoriesOf(pack, services);

  return (
    <Modal title={job ? t('jobs.edit') : t('newProject')} onClose={onClose} labelClose={t('common.close')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" type="submit" form={id('form')} data-testid="jobs-save">{t('common.save')}</Button></>}>
      <form id={id('form')} onSubmit={submit} noValidate>
        <div className="fgrid">
          {pack.recurring && repeatField}
          <Field label={t('client')} htmlFor={id('client')} full>
            <select id={id('client')} value={v.clientId} onChange={(e) => pickClient(e.target.value)} data-testid="jobs-f-client">
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` · ${c.company}` : ''}</option>)}
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
          {hasCatalog && (
            <Field label={t('jobs.f.service')} htmlFor={id('service')} hint={!job && !v.serviceId ? t('jobs.f.serviceHint') : service && !service.active ? t('jobs.f.serviceRetired') : undefined}>
              <select id={id('service')} value={v.serviceId} onChange={(e) => pickService(e.target.value)} data-testid="jobs-f-service">
                <option value="">{t('jobs.f.noService')}</option>
                {groups.map((g) => (
                  <optgroup key={g} label={categoryLabel(t, pack, g)}>
                    {services.filter((x) => x.category === g).map((x) => <option key={x.id} value={x.id}>{serviceName(x, lang)}{x.active ? '' : ` (${t('catalog.retired').toLowerCase()})`}</option>)}
                  </optgroup>
                ))}
              </select>
            </Field>
          )}
          {hasCatalog && service && service.tiers.length > 1 && (
            <Field label={t('jobs.f.tier')} htmlFor={id('tier')}>
              <select id={id('tier')} value={v.tierId} onChange={(e) => pickService(service.id, e.target.value)} data-testid="jobs-f-tier">
                {service.tiers.map((x) => <option key={x.id} value={x.id}>{x.name}{showMoney ? ` · ${tierPrice(t, x)}` : ''}</option>)}
              </select>
            </Field>
          )}
          <Field label={<>{t('name')}<span aria-hidden="true"> *</span></>} htmlFor={id('name')} error={err.includes('name')}>
            <input id={id('name')} value={v.name} onChange={(e) => set('name', e.target.value)} aria-required="true" aria-invalid={err.includes('name') || undefined} data-testid="jobs-f-name" />
          </Field>
          <Field label={t('type')} htmlFor={id('type')}>
            <select id={id('type')} value={v.type} onChange={(e) => set('type', e.target.value)} data-testid="jobs-f-type">{pack.serviceTypes.map((s) => <option key={s.id} value={s.id}>{t('ty_' + s.id)}</option>)}</select>
          </Field>
          {!office && (
            <Field label={t('address')} htmlFor={id('address')} full hint={!job && !isNew && client?.addresses.length ? t('jobs.f.addressHint') : undefined}>
              <input id={id('address')} value={v.address} onChange={(e) => set('address', e.target.value)} list={id('addresses')} autoComplete="off" data-testid="jobs-f-address" />
              <datalist id={id('addresses')}>{(client?.addresses ?? []).map((a) => <option key={a} value={a} />)}</datalist>
            </Field>
          )}
          {office && (
            <Field label={t('jobs.f.period')} htmlFor={id('period')} hint={t('jobs.f.periodHint')}>
              <input id={id('period')} value={v.period} onChange={(e) => set('period', e.target.value)} data-testid="jobs-f-period" />
            </Field>
          )}
          {office && data.offices.length > 0 && (
            <Field label={t('jobs.f.office')} htmlFor={id('office')}>
              <select id={id('office')} value={v.officeId} onChange={(e) => set('officeId', e.target.value)} data-testid="jobs-f-office">
                <option value="">{t('jobs.f.noOffice')}</option>{data.offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>
          )}
          <Field label={t('start')} htmlFor={id('start')}><input id={id('start')} type="date" value={v.start} onChange={(e) => set('start', e.target.value)} data-testid="jobs-f-start" /></Field>
          <Field label={t('end')} htmlFor={id('end')} error={err.includes('end')}><input id={id('end')} type="date" value={v.end} min={v.start || undefined} onChange={(e) => set('end', e.target.value)} data-testid="jobs-f-end" /></Field>
          {!pack.recurring && repeatField}
          {showMoney && (
            <Field label={t('contract')} htmlFor={id('price')} error={err.includes('price')} hint={service && !err.includes('price') ? t('jobs.f.priceFrom') : !job ? t('jobs.f.priceHint') : undefined}>
              <input id={id('price')} type="number" min={0} step="0.01" inputMode="decimal" value={v.price} onChange={(e) => set('price', e.target.value)} data-testid="jobs-f-price" />
            </Field>
          )}
          {showMoney && (office || !!v.serviceId) && (
            <Field label={t('jobs.f.unit')} htmlFor={id('unit')}>
              <select id={id('unit')} value={v.unit} onChange={(e) => set('unit', e.target.value as Unit)} data-testid="jobs-f-unit">{TIER_UNITS.map((u) => <option key={u} value={u}>{t('catalog.unit.' + u)}</option>)}</select>
            </Field>
          )}
          <Field label={t('common.status')} htmlFor={id('status')}>
            <select id={id('status')} value={v.status} onChange={(e) => set('status', e.target.value as JobStatus)} data-testid="jobs-f-status">{pack.jobStatuses.map((s) => <option key={s} value={s}>{t('st_' + s)}</option>)}</select>
          </Field>
          {/* the last of the short fields takes the whole row when it would otherwise sit alone */}
          <Field label={t('jobs.manager')} htmlFor={id('manager')} full={short % 2 === 1}>
            <select id={id('manager')} value={v.managerId} onChange={(e) => set('managerId', e.target.value)} data-testid="jobs-f-manager">{data.users.filter((u) => u.active !== false || u.id === v.managerId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
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
