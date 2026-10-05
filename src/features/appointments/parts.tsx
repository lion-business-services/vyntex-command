// Pieces shared by the appointment screens (list, agenda, appointment page, client tab, credits): who may see what,
// status and payment badges, and the dialogs that book, move, pay and cancel.
// Money never moves here: a "payment" is a record of what the office took, with its method and reference.
import { useEffect, useMemo, useState } from 'react';
import { LuBuilding2, LuPhone, LuVideo } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { PAY_METHODS } from '@/app/forms';
import { act } from '@/store/store';
import { gateway, type Outcome } from '@/platform/gateway';
import { Badge, Button, Field, FormModal, Modal, Note, Seg, cx, toast, type Tone } from '@/ui';
import { pick } from '@/i18n';
import { bookAppointment } from '@/domain/actions';
import {
  activeCredits, busyAt, cancelOutcome, creditState, freeSlots, hoursOf, minutesOf, movesBlocked, noShowCount, payByFor, personOf, rescheduleAppointment, toCents,
  typeOfAppt, visibleAppointments, wasMoved, apptPolicy, type BookResult, type ChangeResult, type CreditState, type Slot,
} from '@/domain/actions/appointments';
import { appointmentRules, leadIsOpen } from '@/domain/config';
import { visibleClients, visibleLeads } from '@/domain/access';
import type { Appointment, AppointmentType, ApptStatus, ConnState, Credit, PayMethod, ProviderId } from '@/domain/types';
import { money2, parseMoney } from '@/lib/money';
import { parseDate, today } from '@/lib/dates';

/* ---------- who sees which appointment ---------- */

/** Appointments the viewer may open: the same office rule as clients and leads. */
export function useAppointments(): Appointment[] {
  const { data, user, perms } = useApp();
  return useMemo(() => visibleAppointments(data, user, perms), [data, user, perms]);
}
/** The team members an appointment can be with: active people who do client work. */
export function useStaff() {
  const { data } = useApp();
  return useMemo(() => data.users.filter((u) => u.active !== false && u.role !== 'readonly'), [data.users]);
}
export const byWhen = (a: Appointment, b: Appointment) => (a.date + a.time).localeCompare(b.date + b.time);

/* ---------- small display pieces ---------- */

const STATUS_TONE: Record<ApptStatus, Tone> = {
  requested: 'info', scheduled: 'accent', awaiting_payment: 'warn', confirmed: 'ok', completed: 'neutral', no_show: 'bad',
  cancelled_unpaid: 'neutral', cancelled_client: 'neutral', cancelled_staff: 'neutral',
};
/** The status of an appointment. The record of an earlier slot reads "Moved", because that is what happened to it. */
export function ApptStatusBadge({ appt }: { appt: Appointment }) {
  const { t, data } = useApp();
  if (wasMoved(data, appt)) return <Badge outline>{t('appointments.st.moved')}</Badge>;
  return <Badge tone={STATUS_TONE[appt.status]} outline={appt.status.startsWith('cancelled')}>{t('appointments.st.' + appt.status)}</Badge>;
}
const CREDIT_TONE: Record<CreditState, Tone> = { active: 'ok', used: 'neutral', void: 'neutral', expired: 'warn' };
export function CreditStateBadge({ credit }: { credit: Credit }) {
  const { t } = useApp();
  const s = creditState(credit);
  return <Badge tone={CREDIT_TONE[s]} outline={s === 'void'}>{t('appointments.cr.st.' + s)}</Badge>;
}
export function ModeIcon({ mode }: { mode: Appointment['mode'] }) {
  return mode === 'video' ? <LuVideo aria-hidden="true" /> : mode === 'phone' ? <LuPhone aria-hidden="true" /> : <LuBuilding2 aria-hidden="true" />;
}
export function useTypeName() {
  const { data, lang, t } = useApp();
  return (a: Pick<Appointment, 'typeId'> | AppointmentType | undefined): string => {
    if (!a) return t('appointments.type.gone');
    const type = 'name' in a ? a : typeOfAppt(data, a);
    return type ? pick(type.name, lang) : t('appointments.type.gone');
  };
}
/** The person an appointment is with, linked to their record. */
export function PersonLink({ appt, className }: { appt: Appointment; className?: string }) {
  const { data, t } = useApp();
  const p = personOf(data, appt);
  if (!p) return <span className="dim">{t('appointments.noPerson')}</span>;
  return <A to={`/${p.kind === 'client' ? 'clients' : 'leads'}/${p.id}`} className={className}>{p.name}</A>;
}
/** Fee and payment in one short line: "Free", "$75.00 paid", "$75.00 to pay". */
export function FeeLine({ appt }: { appt: Appointment }) {
  const { t } = useApp();
  if (!(appt.fee > 0)) return <span className="dim">{t('appointments.free')}</span>;
  if (appt.paid) return <span className="appointments-paid">{money2(appt.fee)} <span className="xs">{t(appt.paid.method === 'credit' ? 'appointments.paidCredit' : 'appointments.paidShort')}</span></span>;
  return <span>{money2(appt.fee)} <span className="xs dim">{t('appointments.unpaidShort')}</span></span>;
}

/* ---------- connections, read honestly ---------- */

/** The state of the outside connections, as the gateway reports them. In a sample workspace nothing is ever connected. */
export function useConnections(): (id: ProviderId) => ConnState {
  const [list, setList] = useState<{ id: ProviderId; state: ConnState }[]>([]);
  useEffect(() => {
    let on = true;
    gateway().integrations.list().then((l) => { if (on) setList(l); }, () => undefined);
    return () => { on = false; };
  }, []);
  return (id) => list.find((c) => c.id === id)?.state ?? 'not_connected';
}
/** A plain maps search for an address: a link, no key and nobody's location. */
export const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

/* ---------- results of the actions, in words ---------- */

export function useProblemText() {
  const { t, day, time } = useApp();
  return (r: Exclude<BookResult | ChangeResult, { ok: true }>): string => {
    if (r.reason === 'double_booked') {
      if (r.detail === 'away') return t('appointments.err.away');
      if (r.detail === 'duplicate') return t('appointments.err.duplicate');
      return r.conflict ? t('appointments.err.overlapWith', { date: day(r.conflict.date), time: time(r.conflict.time) }) : t('appointments.err.overlap');
    }
    return t('appointments.err.' + r.reason);
  };
}
/** Runs a protected operation and says what happened. Returns true when it went through. */
export function useProtected() {
  const { t } = useApp();
  return async <T,>(op: Promise<Outcome<T>>, done: string | ((data: T) => string)): Promise<boolean> => {
    let out: Outcome<T>;
    try { out = await op; } catch { toast(t('appointments.err.failed'), true); return false; }
    if (!out.ok) { const key = 'appointments.err.' + out.reason; toast(t(key) === key ? t('appointments.err.failed') : t(key), true); return false; }
    toast(typeof done === 'function' ? done(out.data) : done);
    return true;
  };
}

/* ---------- the next free times ---------- */

function SlotPicker({ slots, value, onPick }: { slots: Slot[]; value: Slot; onPick: (s: Slot) => void }) {
  const { t, day, time } = useApp();
  if (!slots.length) return <p className="small muted">{t('appointments.slots.none')}</p>;
  return (
    <div className="appointments-slots" role="group" aria-label={t('appointments.slots.title')} data-testid="appointments-slots">
      {slots.map((s) => (
        <button key={s.date + s.time} type="button" className="appointments-slot" aria-pressed={s.date === value.date && s.time === value.time} onClick={() => onPick(s)}>
          <span>{day(s.date)}</span><b>{time(s.time)}</b>
        </button>
      ))}
    </div>
  );
}

/* ---------- book ---------- */

export interface BookDefaults { clientId?: string; leadId?: string; staffId?: string; typeId?: string; date?: string; time?: string; jobId?: string }
export function BookModal({ defaults, onClose, onBooked }: { defaults?: BookDefaults; onClose: () => void; onBooked?: (a: Appointment) => void }) {
  const { t, data, user, perms, can, dateTime, time: clock } = useApp();
  const staff = useStaff(); const typeName = useTypeName(); const problem = useProblemText();
  const clients = useMemo(() => [...visibleClients(data, user, perms)].sort((a, b) => a.name.localeCompare(b.name)), [data, user, perms]);
  const leads = useMemo(() => visibleLeads(data, user, perms).filter((l) => leadIsOpen(data, l)).sort((a, b) => a.name.localeCompare(b.name)), [data, user, perms]);
  const types = data.apptTypes.filter((x) => x.active);
  const [kind, setKind] = useState<'client' | 'lead'>(defaults?.leadId && !defaults.clientId ? 'lead' : clients.length || !leads.length ? 'client' : 'lead');
  const [personId, setPersonId] = useState(defaults?.clientId ?? defaults?.leadId ?? '');
  const [typeId, setTypeId] = useState(defaults?.typeId && types.some((x) => x.id === defaults.typeId) ? defaults.typeId : types[0]?.id ?? '');
  const person = kind === 'client' ? clients.find((c) => c.id === personId) : leads.find((l) => l.id === personId);
  const ownerOf = (id: string) => { const c = clients.find((x) => x.id === id); const l = leads.find((x) => x.id === id); return (kind === 'client' ? c?.assignedTo : l?.ownerId) ?? ''; };
  const pickStaff = (id: string) => (staff.some((u) => u.id === id) ? id : '');
  const [staffId, setStaffId] = useState(pickStaff(defaults?.staffId ?? '') || pickStaff(ownerOf(personId)) || pickStaff(user?.id ?? '') || staff[0]?.id || '');
  const [officeId, setOfficeId] = useState('');
  const [date, setDate] = useState(defaults?.date ?? '');
  const [time, setTime] = useState(defaults?.time ?? '');
  const type = types.find((x) => x.id === typeId);
  const [fee, setFee] = useState<string>(type ? String(type.fee) : '0');
  const [jobId, setJobId] = useState(defaults?.jobId ?? '');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState('');
  const [bad, setBad] = useState<string[]>([]);

  const choosePerson = (id: string) => { setPersonId(id); setErr(''); const own = pickStaff(ownerOf(id)); if (own && !defaults?.staffId) setStaffId(own); setJobId(''); };
  const chooseType = (id: string) => { setTypeId(id); setErr(''); const x = types.find((y) => y.id === id); if (x) setFee(String(x.fee)); };
  const jobs = kind === 'client' && personId ? data.jobs.filter((j) => j.clientId === personId) : [];
  const office = officeId || (person && 'officeId' in person ? person.officeId : undefined) || data.users.find((u) => u.id === staffId)?.officeIds?.[0] || '';
  const feeNum = parseMoney(fee) ?? 0;
  const slots = useMemo(() => (staffId && type ? freeSlots(data, { staffId, typeId: type.id, from: date && date > today() ? date : undefined, count: 6 }) : []), [data, staffId, type, date]);
  const who = kind === 'client' ? { clientId: personId || undefined } : { leadId: personId || undefined };

  // what the person booking should know before saving
  const hours = hoursOf(data);
  const ready = !!date && !!time && !!type;
  const outside = ready && (!hours.days.includes(parseDate(date).getDay()) || time < hours.open || minutesOf(time) + type.minutes > minutesOf(hours.close));
  const busy = ready && staffId ? busyAt(data, { staffId, date, time, minutes: type.minutes, typeId: type.id }) : null;
  const prepaid = !!type?.prepay && feeNum > 0;
  const limit = apptPolicy(data).noShowLimit; const misses = personId ? noShowCount(data, who) : 0;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const missing = [!personId && 'person', !typeId && 'type', !staffId && 'staff', !date && 'date', !time && 'time'].filter(Boolean) as string[];
    setBad(missing);
    if (missing.length) { setErr(t('common.required')); return; }
    const r = act(bookAppointment, { typeId, staffId, date, time, ...who, officeId: office || undefined, jobId: jobId || undefined, notes, fee: can('money') ? feeNum : undefined });
    if (!r.ok) { setErr(problem(r)); return; }
    toast(t(r.appointment.status === 'awaiting_payment' ? 'appointments.bookedAwaiting' : 'appointments.booked'));
    onBooked?.(r.appointment); onClose();
  };

  if (!types.length) {
    return (
      <Modal title={t('appointments.book')} onClose={onClose} size="narrow" labelClose={t('common.close')} footer={<Button onClick={onClose}>{t('common.close')}</Button>}>
        <p className="muted">{t('appointments.noTypes')}</p>
        {can('config') && can('settings') && <p style={{ marginTop: 10 }}><A to="/settings/appointments" className="btn sm">{t('appointments.openSettings')}</A></p>}
      </Modal>
    );
  }
  return (
    <Modal title={t('appointments.book')} onClose={onClose} size="wide" labelClose={t('common.cancel')}>
      <form onSubmit={save} noValidate data-testid="appointments-book-form">
        <div className="fgrid">
          <div className="field full">
            <span className="label">{t('appointments.f.with')}</span>
            <div className="appointments-who">
              {clients.length > 0 && leads.length > 0 && <Seg label={t('appointments.f.with')} value={kind} onChange={(k) => { setKind(k); setPersonId(''); setJobId(''); }} options={[{ value: 'client', label: t('client') }, { value: 'lead', label: t('appointments.lead') }]} />}
              <select value={personId} onChange={(e) => choosePerson(e.target.value)} aria-label={t('appointments.f.with')} aria-invalid={bad.includes('person') || undefined} data-testid="appointments-f-person" data-autofocus>
                <option value="">{t(kind === 'client' ? 'appointments.f.pickClient' : 'appointments.f.pickLead')}</option>
                {(kind === 'client' ? clients : leads).map((p) => <option key={p.id} value={p.id}>{p.name}{p.company ? ` · ${p.company}` : ''}</option>)}
              </select>
            </div>
          </div>
          <Field label={t('common.type')} error={bad.includes('type')}>
            <select value={typeId} onChange={(e) => chooseType(e.target.value)} data-testid="appointments-f-type">
              {types.map((x) => <option key={x.id} value={x.id}>{typeName(x)} · {t('appointments.minutes', { n: x.minutes })}{x.fee > 0 ? ` · ${money2(x.fee)}` : ''}</option>)}
            </select>
          </Field>
          <Field label={t('common.assignedTo')} error={bad.includes('staff')}>
            <select value={staffId} onChange={(e) => { setStaffId(e.target.value); setErr(''); }} data-testid="appointments-f-staff">
              {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <div className="field full">
            <span className="label">{t('appointments.slots.title')}</span>
            <SlotPicker slots={slots} value={{ date, time }} onPick={(s) => { setDate(s.date); setTime(s.time); setErr(''); }} />
            <span className="hint">{t('appointments.slots.hint', { open: clock(hours.open), close: clock(hours.close) })}</span>
          </div>
          <Field label={t('common.date')} error={bad.includes('date')}><input type="date" className="input" value={date} min={today()} onChange={(e) => { setDate(e.target.value); setErr(''); }} data-testid="appointments-f-date" /></Field>
          <Field label={t('appointments.f.time')} error={bad.includes('time')}><input type="time" className="input" value={time} step={300} onChange={(e) => { setTime(e.target.value); setErr(''); }} data-testid="appointments-f-time" /></Field>
          {data.offices.length > 1 && (
            <Field label={t('appointments.f.office')}>
              <select value={office} onChange={(e) => setOfficeId(e.target.value)} data-testid="appointments-f-office">{data.offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
            </Field>
          )}
          {can('money') && <Field label={t('appointments.f.fee')} hint={type && toCents(type.fee) !== toCents(feeNum) ? t('appointments.f.feeChanged', { amount: money2(type.fee) }) : undefined}>
            <input className="input" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} data-testid="appointments-f-fee" />
          </Field>}
          {jobs.length > 0 && (
            <Field label={`${t('project')} (${t('common.optional')})`}>
              <select value={jobId} onChange={(e) => setJobId(e.target.value)}><option value="">{t('common.none')}</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.name} · {j.number}</option>)}</select>
            </Field>
          )}
          <Field label={`${t('common.notes')} (${t('common.optional')})`} full><textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        <div className="stack tight appointments-formnotes">
          {prepaid && ready && <Note>{t('appointments.f.prepayNote', { amount: money2(feeNum), when: dateTime(payByFor(data, { date, time })) })}</Note>}
          {busy?.detail === 'away' && <Note tone="warn">{t('appointments.err.away')}</Note>}
          {busy?.detail === 'overlap' && <Note tone="warn">{t(appointmentRules(data).noDoubleBooking ? 'appointments.f.overlapBlocks' : 'appointments.f.overlapAllowed')}</Note>}
          {outside && !busy && <Note tone="warn">{t('appointments.f.outside')}</Note>}
          {limit > 0 && misses >= limit && <Note tone="warn">{t('appointments.f.noShows', { n: misses })}</Note>}
        </div>
        {err && <p className="small neg" role="alert" style={{ marginTop: 10 }} data-testid="appointments-book-error">{err}</p>}
        <div className="modal-f" style={{ margin: '18px -18px -18px' }}>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" data-testid="appointments-book-save">{t('appointments.book')}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- move ---------- */

export function MoveModal({ appt, onClose }: { appt: Appointment; onClose: () => void }) {
  const { t, data } = useApp();
  const staff = useStaff(); const problem = useProblemText();
  const [date, setDate] = useState(appt.date < today() ? today() : appt.date);
  const [time, setTime] = useState(appt.time);
  const [staffId, setStaffId] = useState(appt.staffId);
  const [officeId, setOfficeId] = useState(appt.officeId ?? '');
  const [askedBy, setAskedBy] = useState<'client' | 'staff'>('client');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const slots = useMemo(() => freeSlots(data, { staffId, typeId: appt.typeId, minutes: appt.minutes, from: date > today() ? date : undefined, count: 6, ignoreId: appt.id }), [data, staffId, appt, date]);
  const blocked = movesBlocked(data, appt);
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !time) { setErr(t('common.required')); return; }
    const r = act(rescheduleAppointment, appt.id, { date, time, staffId, officeId: officeId || undefined, askedBy, reason });
    if (!r.ok) { setErr(r.reason === 'invalid' && date === appt.date && time === appt.time && staffId === appt.staffId ? t('appointments.err.sameSlot') : problem(r)); return; }
    toast(t('appointments.moved')); onClose();
  };
  return (
    <Modal title={t('appointments.move')} onClose={onClose} labelClose={t('common.cancel')}>
      <form onSubmit={save} noValidate data-testid="appointments-move-form">
        {blocked && <Note tone="warn">{t('appointments.err.no_show_limit')}</Note>}
        <div className="fgrid" style={blocked ? { marginTop: 12 } : undefined}>
          <div className="field full">
            <span className="label">{t('appointments.slots.title')}</span>
            <SlotPicker slots={slots} value={{ date, time }} onPick={(s) => { setDate(s.date); setTime(s.time); setErr(''); }} />
          </div>
          <Field label={t('common.date')}><input type="date" className="input" value={date} min={today()} onChange={(e) => { setDate(e.target.value); setErr(''); }} data-testid="appointments-move-date" /></Field>
          <Field label={t('appointments.f.time')}><input type="time" className="input" value={time} step={300} onChange={(e) => { setTime(e.target.value); setErr(''); }} data-testid="appointments-move-time" /></Field>
          <Field label={t('common.assignedTo')}><select value={staffId} onChange={(e) => { setStaffId(e.target.value); setErr(''); }}>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
          {data.offices.length > 1 && <Field label={t('appointments.f.office')}><select value={officeId} onChange={(e) => setOfficeId(e.target.value)}><option value="">{t('common.none')}</option>{data.offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>}
          <div className="field full">
            <span className="label">{t('appointments.f.askedBy')}</span>
            <div><Seg label={t('appointments.f.askedBy')} value={askedBy} onChange={setAskedBy} options={[{ value: 'client', label: t('appointments.by.client') }, { value: 'staff', label: t('appointments.by.staff') }]} /></div>
          </div>
          <Field label={`${t('appointments.f.reason')} (${t('common.optional')})`} full><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
        <p className="xs dim" style={{ marginTop: 10 }}>{t(appt.paid ? 'appointments.move.keepsPaid' : 'appointments.move.keeps')}</p>
        {err && <p className="small neg" role="alert" style={{ marginTop: 10 }} data-testid="appointments-move-error">{err}</p>}
        <div className="modal-f" style={{ margin: '18px -18px -18px' }}>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" disabled={blocked} data-testid="appointments-move-save">{t('appointments.move')}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- record a payment ---------- */

export function PayModal({ appt, onClose }: { appt: Appointment; onClose: () => void }) {
  const { t } = useApp();
  const run = useProtected();
  return (
    <FormModal title={t('appointments.pay.title')} onClose={onClose} saveLabel={t('appointments.pay.save')} cancelLabel={t('common.cancel')} requiredMsg={t('common.required')}
      initial={{ amount: appt.fee, method: 'check', ref: '' }}
      fields={[
        { k: 'amount', label: t('common.amount'), type: 'money', req: true },
        { k: 'method', label: t('common.method'), type: 'select', options: PAY_METHODS.map((m) => [m, t('m_' + m)]) },
        { k: 'ref', label: `${t('common.reference')} (${t('common.optional')})`, full: true, placeholder: t('appointments.pay.refPh') },
      ]}
      extra={<p className="xs dim" style={{ marginTop: 10 }}>{t('appointments.pay.honest')}</p>}
      validate={(v) => {
        if (toCents(v.amount) < toCents(appt.fee)) return t('appointments.pay.tooSmall', { amount: money2(appt.fee) });
        if (toCents(v.amount) > toCents(appt.fee) && !appt.clientId) return t('appointments.pay.noOver');
        return null;
      }}
      onSave={(v) => {
        const over = toCents(v.amount) - toCents(appt.fee);
        void run(gateway().protected.apptMarkPaid(appt.id, { method: v.method as PayMethod, ref: v.ref || '', amount: v.amount }),
          over > 0 ? t('appointments.pay.doneOver', { amount: money2(over / 100) }) : t('appointments.pay.done'));
      }} />
  );
}

/* ---------- cancel ---------- */

export function CancelModal({ appt, onClose }: { appt: Appointment; onClose: () => void }) {
  const { t, data, can } = useApp();
  const run = useProtected();
  const [by, setBy] = useState<'client' | 'staff'>('client');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const person = personOf(data, appt);
  const outcome = cancelOutcome(data, appt, by);
  const days = appointmentRules(data).creditDays;
  const save = async () => {
    if (!reason.trim()) { setErr(t('appointments.cancel.needReason')); return; }
    setBusy(true);
    const done = await run(gateway().protected.apptCancel(appt.id, by, reason), (d) => (d.credit ? t('appointments.cancel.doneCredit', { amount: money2(d.credit.amount) }) : t('appointments.cancel.done')));
    setBusy(false);
    if (done) onClose();
  };
  return (
    <Modal title={t('appointments.cancel.title')} onClose={onClose} labelClose={t('common.close')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('appointments.cancel.keep')}</Button><Button variant="danger" onClick={save} disabled={busy} data-testid="appointments-cancel-save">{t('appointments.cancel.title')}</Button></>}>
      <div className="stack">
        <div className="field">
          <span className="label">{t('appointments.cancel.who')}</span>
          <div><Seg label={t('appointments.cancel.who')} value={by} onChange={setBy} options={[{ value: 'client', label: t('appointments.by.client') }, { value: 'staff', label: t('appointments.by.staff') }]} /></div>
        </div>
        <Field label={t('appointments.f.reason')} htmlFor="appt-cancel-reason" error={!!err}>
          <textarea id="appt-cancel-reason" className="input" rows={3} value={reason} onChange={(e) => { setReason(e.target.value); setErr(''); }} aria-invalid={!!err || undefined} data-testid="appointments-cancel-reason" data-autofocus />
        </Field>
        {can('money') && outcome.kind !== 'none' && (
          <Note tone={outcome.kind === 'credit' ? undefined : 'warn'}>
            <span data-testid="appointments-cancel-outcome" data-outcome={outcome.kind}>
              {t('appointments.cancel.' + outcome.kind, { amount: money2(outcome.amount), name: person?.name ?? '' })}
              {outcome.kind === 'credit' ? ' ' + t(days > 0 ? 'appointments.cancel.expires' : 'appointments.cancel.noExpiry', { n: days }) : ''}
            </span>
          </Note>
        )}
        {err && <p className="small neg" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

/* ---------- pay with a credit ---------- */

export function CreditModal({ appt, onClose }: { appt: Appointment; onClose: () => void }) {
  const { t, data, date } = useApp();
  const run = useProtected();
  const credits = appt.clientId ? activeCredits(data, appt.clientId) : [];
  const covers = (c: Credit) => toCents(c.amount) >= toCents(appt.fee);
  const [id, setId] = useState(credits.find(covers)?.id ?? '');
  const [busy, setBusy] = useState(false);
  const chosen = credits.find((c) => c.id === id);
  const left = chosen ? (toCents(chosen.amount) - toCents(appt.fee)) / 100 : 0;
  const save = async () => {
    if (!chosen) return;
    setBusy(true);
    const done = await run(gateway().protected.creditApply(chosen.id, appt.id), t('appointments.cr.applied'));
    setBusy(false);
    if (done) onClose();
  };
  return (
    <Modal title={t('appointments.cr.use')} onClose={onClose} labelClose={t('common.close')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={save} disabled={!chosen || busy} data-testid="appointments-credit-save">{t('appointments.cr.useFor', { amount: money2(appt.fee) })}</Button></>}>
      {!credits.length ? <p className="muted">{t('appointments.cr.noneFor')}</p> : (
        <div className="stack tight" role="radiogroup" aria-label={t('appointments.cr.use')}>
          {credits.map((c) => (
            <label key={c.id} className={cx('appointments-pick', !covers(c) && 'off')}>
              <input type="radio" name="credit" value={c.id} checked={id === c.id} disabled={!covers(c)} onChange={() => setId(c.id)} />
              <span className="grow"><b>{money2(c.amount)}</b> <span className="small muted">{t('appointments.cr.why.' + c.reason)} · {c.expires ? t('appointments.cr.expiresOn', { date: date(c.expires) }) : t('appointments.cr.noExpiry')}</span>
                {!covers(c) && <span className="xs dim appointments-block">{t('appointments.cr.tooSmall', { amount: money2(appt.fee) })}</span>}</span>
            </label>
          ))}
          {left > 0 && <p className="xs dim">{t('appointments.cr.remainder', { amount: money2(left) })}</p>}
          <p className="xs dim">{t('appointments.cr.once')}</p>
        </div>
      )}
    </Modal>
  );
}
