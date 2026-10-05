// Appointments: booking, moving, outcomes, prepayment and client credits.
//
// The rules were ported from the earlier internal system and tightened where its audit found holes:
//   a staff member is never in two places (other appointments, the minutes kept free after each, and days away);
//   a type that must be paid in advance starts as "awaiting payment" with a pay-by moment, and is released when it passes;
//   paying is recorded once (a second click is refused), and never mints a second credit;
//   a credit is a ledger entry: it is used once or voided with a reason, and never edited;
//   no-shows are counted per person, not per appointment row.
// Everything here is a plain function over the workspace, so the sample workspace, the tests and the server jobs run the same code.
//
// Ordinary changes (book, move, confirm, complete, no-show, edit) run through `act()`. The four money operations at the end
// (`payAppointment`, `cancelAppointment`, `applyCredit`, `voidCredit`) are protected: the screens call them through
// `gateway().protected`, and only the sample implementation (src/platform/sample.ts) calls them directly.
// No card is charged anywhere in this file: "paid" records a payment a person took, with its method and reference.
import type { Appointment, AppointmentType, ApptStatus, Client, Credit, DemoState, ISODate, ISODateTime, Lead, PayMethod, Ref, TeamUser } from '../types';
import { type Ctx, logActivity } from '../context';
import { appointmentRules, leadIsOpen } from '../config';
import { canSeeLead, visibleClientIds } from '../access';
import type { Permission } from '../permissions';
import { emit, type RuleSubject } from '../rules/engine';
import { updateLead } from './leads';
import { addDaysFrom, fmtDay, fmtTime, toISODate } from '@/lib/dates';
import { uid } from '@/lib/id';

/* ---------- contract with the other modules ---------- */

export interface NewAppointment {
  typeId: string; staffId: string; date: string; time: string;
  clientId?: string; leadId?: string; jobId?: string; officeId?: string; notes?: string;
  /** Overrides from the appointment type, when the person booking changed them. */
  minutes?: number; mode?: Appointment['mode']; fee?: number; location?: string;
}
/** Why a slot is not free, in more detail than `reason`. `away`: the person is out that day. `duplicate`: the same booking already exists. */
export type BusyDetail = 'overlap' | 'away' | 'duplicate';
export type BookResult =
  | { ok: true; appointment: Appointment }
  | { ok: false; reason: 'double_booked' | 'unknown_type' | 'invalid' | 'past'; detail?: BusyDetail; conflict?: Appointment };

/* ---------- time and money, kept exact ---------- */

const pad = (n: number) => String(n).padStart(2, '0');
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Minutes since midnight of an HH:MM time. */
export const minutesOf = (time: string): number => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };
export const timeOf = (minutes: number): string => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
/** The moment an appointment starts, on the clock of whoever is looking (dates and times are stored as the office reads them). */
export function startOf(a: Pick<Appointment, 'date' | 'time'>): Date {
  const [y, m, d] = a.date.split('-').map(Number); const [h, mi] = a.time.split(':').map(Number);
  return new Date(y, m - 1, d, h, mi, 0, 0);
}
export const endOf = (a: Pick<Appointment, 'date' | 'time' | 'minutes'>): Date => new Date(startOf(a).getTime() + a.minutes * 60000);

/** Dollars to whole cents. Every sum and comparison of money in this file is done in cents, so 0.1 + 0.2 never happens. */
export const toCents = (n: number | null | undefined): number => Math.round((Number(n) || 0) * 100);
export const fromCents = (c: number): number => c / 100;
/** Adds amounts exactly. */
export const sumMoney = <T,>(list: T[], pick: (x: T) => number | null | undefined): number => fromCents(list.reduce((n, x) => n + toCents(pick(x)), 0));

/* ---------- company rules ---------- */

/**
 * The choices that are not part of `config.appointments`: kept under `settings.appointments`, the place a module keeps its own
 * small settings. `clientCancel` decides what happens to the money when a client cancels a paid appointment late (inside the
 * prepay window): `credit` keeps it for them as a credit, `forfeit` keeps it for the business. The default is `credit`, because
 * a credit can still be voided by someone allowed to, while a forfeited payment cannot be given back from this screen.
 * `noShowLimit`: after this many no-shows a person's appointments can no longer be moved (0 switches the rule off).
 */
export interface ApptPolicy { clientCancel: 'credit' | 'forfeit'; noShowLimit: number }
export const APPT_POLICY: ApptPolicy = { clientCancel: 'credit', noShowLimit: 2 };
export function apptPolicy(d: Pick<DemoState, 'settings'>): ApptPolicy {
  const own = (d.settings?.appointments ?? {}) as Partial<ApptPolicy>;
  return {
    clientCancel: own.clientCancel === 'forfeit' ? 'forfeit' : APPT_POLICY.clientCancel,
    noShowLimit: Number.isInteger(own.noShowLimit) && (own.noShowLimit as number) >= 0 ? (own.noShowLimit as number) : APPT_POLICY.noShowLimit,
  };
}
export interface OfficeHours { days: number[]; open: string; close: string }
/** When the office takes appointments: the company's own hours, or Monday to Friday, 9 to 5, until it sets them. */
export const OFFICE_HOURS: OfficeHours = { days: [1, 2, 3, 4, 5], open: '09:00', close: '17:00' };
export function hoursOf(d: Pick<DemoState, 'config'>): OfficeHours {
  const h = d.config?.hours;
  if (!h || !Array.isArray(h.days) || !h.days.length || !TIME_RE.test(h.open) || !TIME_RE.test(h.close) || h.close <= h.open) return OFFICE_HOURS;
  return h;
}
export interface ApptRulesInput { noDoubleBooking: boolean; prepayHours: number; creditDays: number; clientCancel: ApptPolicy['clientCancel']; noShowLimit: number; hours: OfficeHours }
/** Saves the company's appointment rules. Run it with `mutate(..., 'config')`: only someone who may configure the company changes them. */
export function saveApptRules(d: DemoState, _ctx: Ctx, r: ApptRulesInput): boolean {
  const whole = (n: number, max: number) => Number.isInteger(n) && n >= 0 && n <= max;
  if (!whole(r.prepayHours, 720) || !whole(r.creditDays, 3650) || !whole(r.noShowLimit, 20)) return false;
  if (!TIME_RE.test(r.hours.open) || !TIME_RE.test(r.hours.close) || r.hours.close <= r.hours.open || !r.hours.days.length) return false;
  d.config = { ...d.config, appointments: { noDoubleBooking: !!r.noDoubleBooking, prepayHours: r.prepayHours, creditDays: r.creditDays }, hours: { days: [...new Set(r.hours.days)].filter((x) => x >= 0 && x <= 6).sort(), open: r.hours.open, close: r.hours.close } };
  d.settings = { ...d.settings, appointments: { clientCancel: r.clientCancel === 'forfeit' ? 'forfeit' : 'credit', noShowLimit: r.noShowLimit } };
  return true;
}

/* ---------- appointment types ---------- */

export type ApptTypeInput = Omit<AppointmentType, 'id'> & { id?: string };
/** Adds or changes an appointment type. Returns null when a value is missing or out of range. */
export function saveApptType(d: DemoState, _ctx: Ctx, input: ApptTypeInput): AppointmentType | null {
  const en = input.name.en.trim(); const es = input.name.es.trim();
  const fee = fromCents(toCents(input.fee));
  if (!en || !es || !Number.isInteger(input.minutes) || input.minutes < 5 || input.minutes > 600 || fee < 0) return null;
  const buffer = Number.isInteger(input.buffer) && (input.buffer as number) > 0 ? Math.min(input.buffer as number, 240) : undefined;
  const type: AppointmentType = {
    id: input.id ?? uid('at'), name: { ...input.name, en, es }, minutes: input.minutes, fee,
    // asking for payment in advance only means something when there is a fee
    prepay: !!input.prepay && fee > 0, mode: input.mode, buffer, active: input.active !== false, serviceId: input.serviceId || undefined,
  };
  const at = d.apptTypes.findIndex((x) => x.id === type.id);
  if (at >= 0) d.apptTypes[at] = type; else d.apptTypes.push(type);
  return type;
}
/** Removes a type nobody ever booked. One that has appointments is switched off instead, so their history keeps its name. */
export function deleteApptType(d: DemoState, _ctx: Ctx, id: string): 'deleted' | 'switched_off' | 'not_found' {
  const type = d.apptTypes.find((x) => x.id === id); if (!type) return 'not_found';
  if (d.appointments.some((a) => a.typeId === id)) { type.active = false; return 'switched_off'; }
  d.apptTypes = d.apptTypes.filter((x) => x.id !== id);
  return 'deleted';
}

/* ---------- reading appointments ---------- */

/** Statuses that hold the staff member's time. A request holds nothing until the office accepts it. */
const HOLDING: ApptStatus[] = ['scheduled', 'awaiting_payment', 'confirmed'];
export const holdsSlot = (a: Pick<Appointment, 'status'>): boolean => HOLDING.includes(a.status);
/** Still ahead of the office: a request, or a slot that is held. */
export const isOpenAppt = (a: Pick<Appointment, 'status'>): boolean => a.status === 'requested' || holdsSlot(a);
export const isCancelled = (a: Pick<Appointment, 'status'>): boolean => a.status.startsWith('cancelled');
export const typeOfAppt = (d: Pick<DemoState, 'apptTypes'>, a: Pick<Appointment, 'typeId'>): AppointmentType | undefined => d.apptTypes.find((x) => x.id === a.typeId);
const bufferOf = (d: Pick<DemoState, 'apptTypes'>, typeId: string): number => d.apptTypes.find((x) => x.id === typeId)?.buffer ?? 0;

/** Who the appointment is with: the client when there is one, otherwise the lead. */
export function personOf(d: Pick<DemoState, 'clients' | 'leads'>, a: Pick<Appointment, 'clientId' | 'leadId'>): { kind: 'client' | 'lead'; id: string; name: string; company?: string; phone: string; email: string; record: Client | Lead } | null {
  const c = a.clientId ? d.clients.find((x) => x.id === a.clientId) : undefined;
  if (c) return { kind: 'client', id: c.id, name: c.name, company: c.company, phone: c.phone, email: c.email, record: c };
  const l = a.leadId ? d.leads.find((x) => x.id === a.leadId) : undefined;
  return l ? { kind: 'lead', id: l.id, name: l.name, company: l.company, phone: l.phone, email: l.email, record: l } : null;
}
/**
 * The appointments a person may open. They follow the person they are with: an appointment of a client or a lead of another
 * office is not shown, the same rule as the client and lead lists (src/domain/access.ts).
 */
export function visibleAppointments(d: Pick<DemoState, 'appointments' | 'clients' | 'leads' | 'grants'>, user: TeamUser | undefined, perms: Permission[]): Appointment[] {
  if (perms.includes('allClients')) return d.appointments;
  const mine = visibleClientIds(d, user, perms);
  return d.appointments.filter((a) => {
    if (a.clientId) return mine.has(a.clientId);
    const lead = a.leadId ? d.leads.find((l) => l.id === a.leadId) : undefined;
    return lead ? canSeeLead(user, perms, lead) : true;
  });
}
const samePerson = (a: Pick<Appointment, 'clientId' | 'leadId'>, b: Pick<Appointment, 'clientId' | 'leadId'>): boolean =>
  (!!a.clientId && a.clientId === b.clientId) || (!!a.leadId && a.leadId === b.leadId);

/** The record of the earlier slot of an appointment that was moved (see `rescheduleAppointment`). It is history, not a cancellation. */
export const wasMoved = (d: Pick<DemoState, 'appointments'>, a: Pick<Appointment, 'id'>): boolean => d.appointments.some((x) => x.rescheduledFrom === a.id);
export const movedTo = (d: Pick<DemoState, 'appointments'>, a: Pick<Appointment, 'id'>): Appointment | undefined => d.appointments.find((x) => x.rescheduledFrom === a.id);
/** The earlier slots of an appointment, latest first. */
export function earlierSlots(d: Pick<DemoState, 'appointments'>, a: Appointment): Appointment[] {
  const out: Appointment[] = []; const seen = new Set<string>([a.id]);
  let from = a.rescheduledFrom;
  while (from && !seen.has(from)) { seen.add(from); const prev = d.appointments.find((x) => x.id === from); if (!prev) break; out.push(prev); from = prev.rescheduledFrom; }
  return out;
}
/** How many times an appointment was moved. */
export const rescheduleCount = (d: Pick<DemoState, 'appointments'>, a: Appointment): number => earlierSlots(d, a).length;
/** No-shows on record for the same person, across all their appointments. */
export const noShowCount = (d: Pick<DemoState, 'appointments'>, who: Pick<Appointment, 'clientId' | 'leadId'>): number =>
  d.appointments.filter((x) => x.status === 'no_show' && samePerson(x, who)).length;
/** True when the company's no-show rule stops this person's appointments from being moved. */
export function movesBlocked(d: Pick<DemoState, 'appointments' | 'settings'>, who: Pick<Appointment, 'clientId' | 'leadId'>): boolean {
  const limit = apptPolicy(d).noShowLimit;
  return limit > 0 && noShowCount(d, who) >= limit;
}
/** What is still to pay on an appointment, in dollars. */
export const apptBalance = (a: Pick<Appointment, 'fee' | 'paid'>): number => fromCents(Math.max(0, toCents(a.fee) - toCents(a.paid?.amount)));

/* ---------- is the person free? ---------- */

export interface SlotQuery { staffId: string; date: ISODate; time: string; minutes: number; typeId?: string; buffer?: number }
export type Busy = { detail: 'overlap' | 'duplicate'; conflict: Appointment } | { detail: 'away'; conflict?: undefined };
const awayOn = (u: TeamUser | undefined, date: ISODate): boolean => !!u?.away && u.away.from <= date && date <= u.away.to;

/**
 * Why a staff member cannot take a slot, or null when they can. Two appointments collide when one starts before the other
 * has ended and its minutes kept free have passed. `ignoreId` leaves out the appointment being moved.
 */
export function busyAt(d: Pick<DemoState, 'appointments' | 'apptTypes' | 'users'>, q: SlotQuery, ignoreId?: string): Busy | null {
  if (awayOn(d.users.find((u) => u.id === q.staffId), q.date)) return { detail: 'away' };
  const start = minutesOf(q.time); const end = start + q.minutes + (q.buffer ?? (q.typeId ? bufferOf(d, q.typeId) : 0));
  for (const a of d.appointments) {
    if (a.id === ignoreId || a.staffId !== q.staffId || a.date !== q.date || !holdsSlot(a)) continue;
    const s = minutesOf(a.time); const e = s + a.minutes + bufferOf(d, a.typeId);
    if (start < e && s < end) return { detail: 'overlap', conflict: a };
  }
  return null;
}

export interface Slot { date: ISODate; time: string }
export interface SlotSearch { staffId: string; typeId?: string; minutes?: number; from?: ISODate; count?: number; perDay?: number; horizonDays?: number; ignoreId?: string }
/**
 * The next free times of a staff member for an appointment type, inside the company's hours: on the half hour, never in the
 * past, never on a day the person is away, and never touching another appointment or the minutes kept free after it.
 * A few per day, so the list reaches across several days instead of filling up with one morning.
 */
export function freeSlots(d: Pick<DemoState, 'appointments' | 'apptTypes' | 'users' | 'config'>, q: SlotSearch, now: Date = new Date()): Slot[] {
  const type = q.typeId ? d.apptTypes.find((x) => x.id === q.typeId) : undefined;
  const minutes = q.minutes ?? type?.minutes ?? 30;
  const hours = hoursOf(d); const open = minutesOf(hours.open); const close = minutesOf(hours.close);
  const count = q.count ?? 6; const perDay = q.perDay ?? 3; const today = toISODate(now);
  const out: Slot[] = [];
  let date = q.from && q.from > today ? q.from : today;
  for (let i = 0; i < (q.horizonDays ?? 45) && out.length < count; i++, date = addDaysFrom(date, 1)) {
    const [y, m, dd] = date.split('-').map(Number);
    if (!hours.days.includes(new Date(y, m - 1, dd).getDay())) continue;
    let found = 0;
    for (let t = open; t + minutes <= close && found < perDay && out.length < count; t += 30) {
      const time = timeOf(t);
      if (startOf({ date, time }).getTime() <= now.getTime()) continue;
      const busy = busyAt(d, { staffId: q.staffId, date, time, minutes, typeId: q.typeId }, q.ignoreId);
      if (busy?.detail === 'away') break;
      if (!busy) { out.push({ date, time }); found++; }
    }
  }
  return out;
}

/** When a prepaid appointment must be paid: the company's hours before the start, or the start itself when it was booked later than that. */
export function payByFor(d: Pick<DemoState, 'config'>, slot: Pick<Appointment, 'date' | 'time'>, now: Date = new Date()): ISODateTime {
  const start = startOf(slot);
  const due = new Date(start.getTime() - appointmentRules(d).prepayHours * 3600000);
  return (due.getTime() > now.getTime() ? due : start).toISOString();
}

/* ---------- history and automations ---------- */

const refOf = (a: Appointment): Ref => ({ type: 'appointment', id: a.id });
const alsoOf = (a: Appointment): Ref[] => [...(a.clientId ? [{ type: 'client' as const, id: a.clientId }] : []), ...(a.leadId ? [{ type: 'lead' as const, id: a.leadId }] : [])];
function note(d: DemoState, ctx: Ctx, by: string, kind: string, a: Appointment) {
  const who = personOf(d, a)?.name ?? '';
  logActivity(d, by, 'appointment.' + kind, refOf(a), { who, date: `${fmtDay(a.date, ctx.lang)}, ${fmtTime(a.time, ctx.lang)}` }, alsoOf(a));
}
/** What a rule gets to read about an appointment. */
function subjectOf(d: DemoState, a: Appointment, extra?: RuleSubject['extra']): RuleSubject {
  return {
    ref: refOf(a), appointment: a,
    client: a.clientId ? d.clients.find((c) => c.id === a.clientId) : undefined,
    lead: a.leadId ? d.leads.find((l) => l.id === a.leadId) : undefined,
    job: a.jobId ? d.jobs.find((j) => j.id === a.jobId) : undefined,
    extra,
  };
}
/** A lead shows its appointment date on its own page and in the pipeline, so the two are kept in step while the lead is open. */
function syncLead(d: DemoState, ctx: Ctx, a: Appointment, was?: Pick<Appointment, 'date' | 'time'>) {
  const l = a.leadId ? d.leads.find((x) => x.id === a.leadId) : undefined;
  if (!l || !leadIsOpen(d, l)) return;
  if (holdsSlot(a)) { if (l.apptDate !== a.date || l.apptTime !== a.time) updateLead(d, ctx, l.id, { apptDate: a.date, apptTime: a.time }); }
  // the appointment is off: take its date off the lead, unless the lead already points at another date
  else if (l.apptDate === (was ?? a).date && (!l.apptTime || l.apptTime === (was ?? a).time)) { l.apptDate = undefined; l.apptTime = undefined; }
}

/* ---------- booking ---------- */

/** Books an appointment after checking the staff member is free. Prepaid types start as `awaiting_payment` with a pay-by time. */
export function bookAppointment(d: DemoState, ctx: Ctx, input: NewAppointment): BookResult {
  const now = new Date();
  const type = d.apptTypes.find((x) => x.id === input.typeId);
  if (!type) return { ok: false, reason: 'unknown_type' };
  const staff = d.users.find((u) => u.id === input.staffId);
  const client = input.clientId ? d.clients.find((c) => c.id === input.clientId) : undefined;
  const lead = input.leadId ? d.leads.find((l) => l.id === input.leadId) : undefined;
  const minutes = input.minutes ?? type.minutes;
  const fee = fromCents(toCents(input.fee ?? type.fee));
  if (!staff || staff.active === false || (!client && !lead) || (input.clientId && !client) || (input.leadId && !lead)) return { ok: false, reason: 'invalid' };
  if (!DATE_RE.test(input.date) || !TIME_RE.test(input.time) || !Number.isInteger(minutes) || minutes < 5 || minutesOf(input.time) + minutes > 1440 || fee < 0) return { ok: false, reason: 'invalid' };
  if (startOf(input).getTime() <= now.getTime()) return { ok: false, reason: 'past' };

  // the same booking twice (a second click, a retry) is refused whatever the company's rule says
  const twin = d.appointments.find((a) => holdsSlot(a) && a.staffId === input.staffId && a.date === input.date && a.time === input.time && samePerson(a, input));
  if (twin) return { ok: false, reason: 'double_booked', detail: 'duplicate', conflict: twin };
  const busy = busyAt(d, { staffId: input.staffId, date: input.date, time: input.time, minutes, typeId: type.id });
  if (busy && (busy.detail === 'away' || appointmentRules(d).noDoubleBooking)) return { ok: false, reason: 'double_booked', detail: busy.detail, conflict: busy.conflict };

  const mode = input.mode ?? type.mode;
  const officeId = input.officeId ?? client?.officeId ?? lead?.officeId ?? staff.officeIds?.[0];
  const prepaid = type.prepay && fee > 0;
  const a: Appointment = {
    id: uid('ap'), typeId: type.id, clientId: client?.id, leadId: lead?.id, jobId: input.jobId, staffId: staff.id, officeId,
    date: input.date, time: input.time, minutes, mode,
    // where to go: only an office appointment has a place, and it is the office's own address unless one was typed
    location: input.location?.trim() || (mode === 'office' ? d.offices.find((o) => o.id === officeId)?.address : undefined),
    status: prepaid ? 'awaiting_payment' : 'scheduled', fee, payBy: prepaid ? payByFor(d, input, now) : undefined,
    notes: input.notes?.trim() || undefined, created: now.toISOString(), createdBy: ctx.actor,
  };
  d.appointments.unshift(a);
  note(d, ctx, ctx.actor, 'booked', a);
  syncLead(d, ctx, a);
  emit(d, ctx, 'appointment.booked', subjectOf(d, a));
  return { ok: true, appointment: a };
}

export type ChangeReason = 'not_found' | 'closed' | 'invalid' | 'past' | 'early' | 'double_booked' | 'no_show_limit';
export type ChangeResult = { ok: true; appointment: Appointment } | { ok: false; reason: ChangeReason; detail?: BusyDetail; conflict?: Appointment };
const find = (d: DemoState, id: string) => d.appointments.find((a) => a.id === id);

/** The office takes a request: it becomes a booking, with the same checks. */
export function acceptAppointment(d: DemoState, ctx: Ctx, id: string): ChangeResult {
  const a = find(d, id); if (!a) return { ok: false, reason: 'not_found' };
  if (a.status !== 'requested') return { ok: false, reason: 'closed' };
  if (startOf(a).getTime() <= Date.now()) return { ok: false, reason: 'past' };
  const busy = busyAt(d, { staffId: a.staffId, date: a.date, time: a.time, minutes: a.minutes, typeId: a.typeId }, a.id);
  if (busy && (busy.detail === 'away' || appointmentRules(d).noDoubleBooking)) return { ok: false, reason: 'double_booked', detail: busy.detail, conflict: busy.conflict };
  const prepaid = !!typeOfAppt(d, a)?.prepay && a.fee > 0 && !a.paid;
  a.status = prepaid ? 'awaiting_payment' : 'scheduled'; a.payBy = prepaid ? payByFor(d, a) : undefined;
  note(d, ctx, ctx.actor, 'booked', a);
  syncLead(d, ctx, a);
  emit(d, ctx, 'appointment.booked', subjectOf(d, a));
  return { ok: true, appointment: a };
}

export interface MoveInput { date: ISODate; time: string; staffId?: string; officeId?: string; /** Who asked for the change. */ askedBy: 'client' | 'staff'; reason?: string }
/**
 * Moves an appointment to another time, person or office. The appointment keeps its id, its payment and its links; a copy
 * of the earlier slot stays behind as history and `rescheduledFrom` points at it, so the chain shows every move.
 */
export function rescheduleAppointment(d: DemoState, ctx: Ctx, id: string, to: MoveInput): ChangeResult {
  const a = find(d, id); if (!a) return { ok: false, reason: 'not_found' };
  if (!holdsSlot(a)) return { ok: false, reason: 'closed' };
  if (movesBlocked(d, a)) return { ok: false, reason: 'no_show_limit' };
  const staffId = to.staffId ?? a.staffId; const staff = d.users.find((u) => u.id === staffId);
  if (!staff || staff.active === false || !DATE_RE.test(to.date) || !TIME_RE.test(to.time) || minutesOf(to.time) + a.minutes > 1440) return { ok: false, reason: 'invalid' };
  if (to.date === a.date && to.time === a.time && staffId === a.staffId) return { ok: false, reason: 'invalid' };
  if (startOf(to).getTime() <= Date.now()) return { ok: false, reason: 'past' };
  const busy = busyAt(d, { staffId, date: to.date, time: to.time, minutes: a.minutes, typeId: a.typeId }, a.id);
  if (busy && (busy.detail === 'away' || appointmentRules(d).noDoubleBooking)) return { ok: false, reason: 'double_booked', detail: busy.detail, conflict: busy.conflict };

  // the earlier slot, kept as history: it holds no time, no payment and no link to an outside calendar
  const earlier: Appointment = {
    ...a, id: uid('ap'), status: to.askedBy === 'client' ? 'cancelled_client' : 'cancelled_staff', cancelReason: to.reason?.trim() || undefined,
    paid: undefined, payBy: undefined, creditId: undefined, meetUrl: undefined, externalIds: undefined,
  };
  d.appointments.splice(d.appointments.indexOf(a) + 1, 0, earlier);
  const was = { date: a.date, time: a.time };
  a.rescheduledFrom = earlier.id; a.date = to.date; a.time = to.time; a.staffId = staffId;
  if (to.officeId && to.officeId !== a.officeId) { a.officeId = to.officeId; if (a.mode === 'office') a.location = d.offices.find((o) => o.id === to.officeId)?.address ?? a.location; }
  // a client who had said yes to the old time has not said yes to the new one; a paid appointment stays confirmed
  if (a.status === 'confirmed' && !a.paid) a.status = 'scheduled';
  if (a.status === 'awaiting_payment') a.payBy = payByFor(d, a);
  note(d, ctx, ctx.actor, 'moved', a);
  syncLead(d, ctx, a, was);
  emit(d, ctx, 'appointment.booked', subjectOf(d, a, { rescheduled: true, moves: rescheduleCount(d, a) }));
  return { ok: true, appointment: a };
}

/** The client said they are coming. */
export function confirmAppointment(d: DemoState, ctx: Ctx, id: string): ChangeResult {
  const a = find(d, id); if (!a) return { ok: false, reason: 'not_found' };
  if (a.status !== 'scheduled') return { ok: false, reason: 'closed' };
  a.status = 'confirmed';
  note(d, ctx, ctx.actor, 'confirmed', a);
  return { ok: true, appointment: a };
}
/** The appointment took place. It can only be said once it has started. */
export function completeAppointment(d: DemoState, ctx: Ctx, id: string): ChangeResult {
  const a = find(d, id); if (!a) return { ok: false, reason: 'not_found' };
  if (a.status !== 'scheduled' && a.status !== 'confirmed') return { ok: false, reason: 'closed' };
  if (startOf(a).getTime() > Date.now()) return { ok: false, reason: 'early' };
  a.status = 'completed';
  note(d, ctx, ctx.actor, 'completed', a);
  syncLead(d, ctx, a);
  emit(d, ctx, 'appointment.completed', subjectOf(d, a));
  return { ok: true, appointment: a };
}
/** The person did not come. A payment already taken stays with the appointment: no credit is created. */
export function markNoShow(d: DemoState, ctx: Ctx, id: string): ChangeResult {
  const a = find(d, id); if (!a) return { ok: false, reason: 'not_found' };
  if (!holdsSlot(a)) return { ok: false, reason: 'closed' };
  if (startOf(a).getTime() > Date.now()) return { ok: false, reason: 'early' };
  a.status = 'no_show';
  note(d, ctx, ctx.actor, 'no_show', a);
  syncLead(d, ctx, a);
  const count = noShowCount(d, a);
  emit(d, ctx, 'appointment.no_show', subjectOf(d, a, { noShows: count, movesBlocked: movesBlocked(d, a) }));
  return { ok: true, appointment: a };
}
export type ApptPatch = Partial<Pick<Appointment, 'notes' | 'location' | 'jobId' | 'fee' | 'mode' | 'minutes'>>;
/** Small corrections. The fee can change until a payment is recorded; the length only when the person stays free. */
export function updateAppointment(d: DemoState, _ctx: Ctx, id: string, patch: ApptPatch): ChangeResult {
  const a = find(d, id); if (!a) return { ok: false, reason: 'not_found' };
  if (!isOpenAppt(a)) {
    // a closed appointment keeps what happened; only its notes can still be written
    if (Object.keys(patch).some((k) => k !== 'notes')) return { ok: false, reason: 'closed' };
    a.notes = patch.notes?.trim() || undefined;
    return { ok: true, appointment: a };
  }
  if (patch.fee !== undefined) {
    const fee = fromCents(toCents(patch.fee));
    if (a.paid || fee < 0) return { ok: false, reason: 'invalid' };
    a.fee = fee;
    // nothing left to pay in advance: the slot no longer waits for money
    if (a.status === 'awaiting_payment' && fee === 0) { a.status = 'scheduled'; a.payBy = undefined; }
  }
  if (patch.minutes !== undefined && patch.minutes !== a.minutes) {
    if (!Number.isInteger(patch.minutes) || patch.minutes < 5 || minutesOf(a.time) + patch.minutes > 1440) return { ok: false, reason: 'invalid' };
    const busy = holdsSlot(a) ? busyAt(d, { staffId: a.staffId, date: a.date, time: a.time, minutes: patch.minutes, typeId: a.typeId }, a.id) : null;
    if (busy?.detail === 'overlap' && appointmentRules(d).noDoubleBooking) return { ok: false, reason: 'double_booked', detail: 'overlap', conflict: busy.conflict };
    a.minutes = patch.minutes;
  }
  if (patch.mode !== undefined) { a.mode = patch.mode; if (patch.mode !== 'office' && patch.location === undefined) a.location = undefined; }
  if (patch.location !== undefined) a.location = patch.location.trim() || undefined;
  if (patch.notes !== undefined) a.notes = patch.notes.trim() || undefined;
  if (patch.jobId !== undefined) a.jobId = patch.jobId || undefined;
  return { ok: true, appointment: a };
}

/* ---------- credits: a ledger ---------- */

export type CreditState = 'active' | 'used' | 'void' | 'expired';
/** Where a credit stands today. An entry is never edited: it is used once, voided with a reason, or it runs out on its date. */
export function creditState(c: Credit, today: ISODate = toISODate(new Date())): CreditState {
  if (c.void) return 'void';
  if (c.used) return 'used';
  return c.expires && c.expires < today ? 'expired' : 'active';
}
export const activeCredits = (d: Pick<DemoState, 'credits'>, clientId: string, today?: ISODate): Credit[] =>
  d.credits.filter((c) => c.clientId === clientId && creditState(c, today) === 'active').sort((a, b) => (a.expires ?? '9999').localeCompare(b.expires ?? '9999') || a.at.localeCompare(b.at));
/** What a client can still spend, added in cents. */
export const creditBalance = (d: Pick<DemoState, 'credits'>, clientId: string, today?: ISODate): number => sumMoney(activeCredits(d, clientId, today), (c) => c.amount);
/** Credits that run out within the given days and can still be used. */
export function creditsExpiringSoon(d: Pick<DemoState, 'credits'>, days = 7, today: ISODate = toISODate(new Date())): Credit[] {
  const until = addDaysFrom(today, days);
  return d.credits.filter((c) => creditState(c, today) === 'active' && !!c.expires && c.expires <= until);
}
/** The expiry date of a credit issued today, or none when the company's credits do not run out. */
function expiryFrom(d: Pick<DemoState, 'config'>, now: Date): ISODate | undefined {
  const days = appointmentRules(d).creditDays;
  return days > 0 ? addDaysFrom(toISODate(now), days) : undefined;
}
function issueCredit(d: DemoState, ctx: Ctx, c: Pick<Credit, 'clientId' | 'amount' | 'reason' | 'fromApptId' | 'expires'>, now: Date): Credit {
  const credit: Credit = { id: uid('cr'), clientId: c.clientId, amount: fromCents(toCents(c.amount)), reason: c.reason, fromApptId: c.fromApptId, at: now.toISOString(), by: ctx.actor, expires: c.expires };
  d.credits.unshift(credit);
  return credit;
}

/* ---------- protected money operations (sample implementation; the server has its own) ---------- */

export interface ApptPayment { method: PayMethod; ref: string; amount: number }
export type MoneyReason = 'not_found' | 'conflict' | 'invalid' | 'expired' | 'too_small';

/** Why a payment cannot be recorded, or null when it can. */
export function payProblem(d: Pick<DemoState, 'appointments'>, id: string, p: ApptPayment): MoneyReason | null {
  const a = d.appointments.find((x) => x.id === id); if (!a) return 'not_found';
  // paid once: a second click or a retry never records a second payment
  if (a.paid || isCancelled(a) || a.status === 'no_show' || a.status === 'requested') return 'conflict';
  if (toCents(a.fee) <= 0 || !(toCents(p.amount) > 0)) return 'invalid';
  if (toCents(p.amount) < toCents(a.fee)) return 'too_small';
  // more than the fee is kept for the client as a credit, which needs a client record
  if (toCents(p.amount) > toCents(a.fee) && !a.clientId) return 'invalid';
  return null;
}
export type PayResult = { ok: true; appointment: Appointment; credit?: Credit } | { ok: false; reason: MoneyReason };
/** Records a payment someone took and confirms the appointment. Anything above the fee becomes a credit for the client. */
export function payAppointment(d: DemoState, ctx: Ctx, id: string, p: ApptPayment, now: Date = new Date()): PayResult {
  const why = payProblem(d, id, p); if (why) return { ok: false, reason: why };
  const a = find(d, id) as Appointment;
  a.paid = { at: now.toISOString(), method: p.method, ref: p.ref.trim(), amount: fromCents(toCents(p.amount)) };
  if (a.status === 'awaiting_payment' || a.status === 'scheduled') a.status = 'confirmed';
  const over = toCents(p.amount) - toCents(a.fee);
  const credit = over > 0 && a.clientId ? issueCredit(d, ctx, { clientId: a.clientId, amount: fromCents(over), reason: 'overpayment', fromApptId: a.id, expires: expiryFrom(d, now) }, now) : undefined;
  note(d, ctx, ctx.actor, 'paid', a);
  emit(d, ctx, 'appointment.paid', { ...subjectOf(d, a, { method: p.method }), payment: { id: a.id, date: toISODate(now), method: p.method, ref: a.paid.ref, amount: a.paid.amount } });
  return { ok: true, appointment: a, credit };
}

export function cancelProblem(d: Pick<DemoState, 'appointments'>, id: string, reason: string): MoneyReason | null {
  const a = d.appointments.find((x) => x.id === id); if (!a) return 'not_found';
  if (!isOpenAppt(a)) return 'conflict';
  return reason.trim() ? null : 'invalid';
}
/** True when the appointment starts sooner than the company's prepay hours from now. */
export const insideWindow = (d: Pick<DemoState, 'config'>, a: Pick<Appointment, 'date' | 'time'>, now: Date = new Date()): boolean =>
  startOf(a).getTime() - now.getTime() < appointmentRules(d).prepayHours * 3600000;
/**
 * What happens to the money of a paid appointment when it is cancelled, before anyone confirms:
 * `credit` (the client keeps it as a credit), `forfeit` (the company's rule keeps it), `no_client` (paid by someone who is
 * not a client yet, so no credit can be written), or `none` (nothing was paid).
 */
export function cancelOutcome(d: Pick<DemoState, 'config' | 'settings'>, a: Appointment, by: 'client' | 'staff', now: Date = new Date()): { kind: 'credit' | 'forfeit' | 'no_client' | 'none'; amount: number } {
  // the part above the fee already became a credit when it was paid
  const held = fromCents(Math.min(toCents(a.paid?.amount), toCents(a.fee)));
  if (!a.paid || held <= 0) return { kind: 'none', amount: 0 };
  if (by === 'client' && insideWindow(d, a, now) && apptPolicy(d).clientCancel === 'forfeit') return { kind: 'forfeit', amount: held };
  return { kind: a.clientId ? 'credit' : 'no_client', amount: held };
}
export type CancelResult = { ok: true; appointment: Appointment; credit?: Credit; kept?: 'forfeit' | 'no_client' } | { ok: false; reason: MoneyReason };
/**
 * Cancels an appointment. When the office cancels one that was paid, the client holds a credit for it. When the client
 * cancels, they also get a credit, except inside the prepay window when the company chose to keep late cancellations.
 * No money is sent back from here: nothing was charged by this system in the first place.
 */
export function cancelAppointment(d: DemoState, ctx: Ctx, id: string, by: 'client' | 'staff', reason: string, now: Date = new Date()): CancelResult {
  const why = cancelProblem(d, id, reason); if (why) return { ok: false, reason: why };
  const a = find(d, id) as Appointment;
  const money = cancelOutcome(d, a, by, now);
  a.status = by === 'staff' ? 'cancelled_staff' : 'cancelled_client'; a.cancelReason = reason.trim();
  const credit = money.kind === 'credit' && a.clientId
    ? issueCredit(d, ctx, { clientId: a.clientId, amount: money.amount, reason: by === 'staff' ? 'cancel_staff' : 'reschedule', fromApptId: a.id, expires: expiryFrom(d, now) }, now) : undefined;
  note(d, ctx, ctx.actor, by === 'staff' ? 'cancelled_staff' : 'cancelled_client', a);
  syncLead(d, ctx, a);
  emit(d, ctx, 'appointment.cancelled', subjectOf(d, a, { by, credit: credit?.amount ?? 0 }));
  return { ok: true, appointment: a, credit, kept: money.kind === 'forfeit' || money.kind === 'no_client' ? money.kind : undefined };
}

export function creditProblem(d: Pick<DemoState, 'appointments' | 'credits'>, creditId: string, apptId: string, now: Date = new Date()): MoneyReason | null {
  const c = d.credits.find((x) => x.id === creditId); const a = d.appointments.find((x) => x.id === apptId);
  if (!c || !a) return 'not_found';
  const state = creditState(c, toISODate(now));
  // single use: a credit that was spent or voided is never spent again
  if (state === 'used' || state === 'void') return 'conflict';
  if (state === 'expired') return 'expired';
  if (a.paid || isCancelled(a) || a.status === 'no_show' || a.status === 'requested') return 'conflict';
  if (a.clientId !== c.clientId || toCents(a.fee) <= 0) return 'invalid';
  // one payment per appointment: a credit that does not cover the fee cannot be part of it
  return toCents(c.amount) < toCents(a.fee) ? 'too_small' : null;
}
export type CreditResult = { ok: true; credit: Credit; appointment: Appointment; remainder?: Credit } | { ok: false; reason: MoneyReason };
/** Pays an appointment's fee with a credit. The credit is spent whole; what the fee did not use comes back as a new entry with the same expiry. */
export function applyCredit(d: DemoState, ctx: Ctx, creditId: string, apptId: string, now: Date = new Date()): CreditResult {
  const why = creditProblem(d, creditId, apptId, now); if (why) return { ok: false, reason: why };
  const c = d.credits.find((x) => x.id === creditId) as Credit; const a = find(d, apptId) as Appointment;
  c.used = { apptId, at: now.toISOString() };
  a.paid = { at: now.toISOString(), method: 'credit', ref: c.id, amount: fromCents(toCents(a.fee)) }; a.creditId = c.id;
  if (a.status === 'awaiting_payment' || a.status === 'scheduled') a.status = 'confirmed';
  const left = toCents(c.amount) - toCents(a.fee);
  const remainder = left > 0 ? issueCredit(d, ctx, { clientId: c.clientId, amount: fromCents(left), reason: 'overpayment', fromApptId: a.id, expires: c.expires }, now) : undefined;
  note(d, ctx, ctx.actor, 'paid_credit', a);
  emit(d, ctx, 'appointment.paid', subjectOf(d, a, { method: 'credit' }));
  return { ok: true, credit: c, appointment: a, remainder };
}

export function voidProblem(d: Pick<DemoState, 'credits'>, creditId: string, reason: string, now: Date = new Date()): MoneyReason | null {
  const c = d.credits.find((x) => x.id === creditId); if (!c) return 'not_found';
  const state = creditState(c, toISODate(now));
  if (state === 'used' || state === 'void') return 'conflict';
  if (state === 'expired') return 'expired';
  return reason.trim() ? null : 'invalid';
}
export type VoidResult = { ok: true; credit: Credit } | { ok: false; reason: MoneyReason };
/** Takes a credit out of use, with the reason and who did it. The entry stays in the ledger. */
export function voidCredit(d: DemoState, ctx: Ctx, creditId: string, reason: string, now: Date = new Date()): VoidResult {
  const why = voidProblem(d, creditId, reason, now); if (why) return { ok: false, reason: why };
  const c = d.credits.find((x) => x.id === creditId) as Credit;
  c.void = { at: now.toISOString(), by: ctx.actor, reason: reason.trim() };
  logActivity(d, ctx.actor, 'credit.void', { type: 'client', id: c.clientId });
  return { ok: true, credit: c };
}

/* ---------- the sweep: run when the screen opens and by the daily job ---------- */

export interface SweepResult {
  /** Prepaid appointments released because the pay-by moment passed. */
  released: Appointment[];
  /** Appointments that take place today and are still on. */
  today: Appointment[];
  /** Appointments whose time has passed and nobody said what happened: completed, or no-show. */
  unresolved: Appointment[];
  /** Credits that can still be used and run out within a week. */
  expiring: Credit[];
}
/**
 * Releases unpaid appointments whose pay-by moment has passed (`cancelled_unpaid`, announced as `appointment.unpaid`) and
 * reports what needs attention today. Safe to run as often as wanted: an appointment is released once.
 */
export function sweepAppointments(d: DemoState, ctx: Ctx, now: Date = new Date()): SweepResult {
  const stamp = now.toISOString(); const today = toISODate(now);
  const released: Appointment[] = [];
  for (const a of d.appointments) {
    if (a.status !== 'awaiting_payment' || a.paid || !a.payBy || a.payBy > stamp) continue;
    a.status = 'cancelled_unpaid';
    released.push(a);
    note(d, ctx, 'automation', 'unpaid', a);
    syncLead(d, ctx, a);
    emit(d, ctx, 'appointment.unpaid', subjectOf(d, a));
  }
  const byTime = (x: Appointment, y: Appointment) => (x.date + x.time).localeCompare(y.date + y.time);
  return {
    released,
    today: d.appointments.filter((a) => a.date === today && holdsSlot(a)).sort(byTime),
    unresolved: d.appointments.filter((a) => holdsSlot(a) && endOf(a).getTime() < now.getTime()).sort(byTime),
    expiring: creditsExpiringSoon(d, 7, today),
  };
}
/** True when a sweep would change something. Lets a screen skip the write when there is nothing to release. */
export const sweepDue = (d: Pick<DemoState, 'appointments'>, now: Date = new Date()): boolean => {
  const stamp = now.toISOString();
  return d.appointments.some((a) => a.status === 'awaiting_payment' && !a.paid && !!a.payBy && a.payBy <= stamp);
};
