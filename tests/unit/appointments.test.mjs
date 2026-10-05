// Unit tests for appointments and credits: nobody is booked twice (minutes kept free and days away included), the prepay
// deadline, the release of unpaid appointments, credits (issued, used once, expiring, voided) and exact cent arithmetic.
// Run with `npm run test:unit` (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, blank } from './bundle.mjs';

const m = await load(`
  export { bookAppointment } from '@/domain/actions';
  export * from '@/domain/actions/appointments';
  export { PACKS } from '@/packs';
  export { makeT } from '@/i18n';
`);
const { bookAppointment, rescheduleAppointment, confirmAppointment, completeAppointment, markNoShow, acceptAppointment, updateAppointment, payAppointment, cancelAppointment,
  applyCredit, voidCredit, sweepAppointments, sweepDue, freeSlots, busyAt, payByFor, creditState, creditBalance, creditsExpiringSoon, cancelOutcome, rescheduleCount, earlierSlots,
  wasMoved, noShowCount, movesBlocked, saveApptType, deleteApptType, saveApptRules, apptPolicy, hoursOf, toCents, sumMoney, apptBalance, startOf, PACKS, makeT } = m;

const pad = (n) => String(n).padStart(2, '0');
const iso = (x) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
const day = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return iso(x); };
const hhmm = (x) => `${pad(x.getHours())}:${pad(x.getMinutes())}`;
const user = (id, role, more = {}) => ({ id, name: 'Person ' + id, role, email: id + '@example.com', active: true, officeIds: ['o1'], ...more });
const client = (id, more = {}) => ({ id, name: 'Client ' + id, phone: '609-555-0100', email: id + '@example.com', addresses: [], since: '2025-01-01', notes: [], ...more });

function world(rules) {
  const pack = PACKS.practice;
  const d = blank(pack);
  d.users = [user('u1', 'owner'), user('u2', 'manager'), user('u3', 'staff')];
  d.offices = [{ id: 'o1', name: 'Sample office', address: '1 Sample Way' }];
  d.clients = [client('c1'), client('c2')];
  d.leads = [{ id: 'l1', ticket: 'VP-1001', name: 'Lead One', phone: '609-555-0101', email: 'l1@example.com', address: '', type: 'tax', source: 'phone', status: 'new', pri: 'medium', ownerId: 'u2', value: null, created: day(-1), notes: [] }];
  d.apptTypes = [
    { id: 'free', name: { en: 'First consultation', es: 'Primera consulta' }, minutes: 30, fee: 0, prepay: false, mode: 'office', buffer: 10, active: true },
    { id: 'paid', name: { en: 'Planning session', es: 'Sesión de planeación' }, minutes: 45, fee: 75, prepay: true, mode: 'video', active: true },
    { id: 'later', name: { en: 'Working session', es: 'Sesión de trabajo' }, minutes: 60, fee: 40, prepay: false, mode: 'office', active: true },
  ];
  if (rules) d.config.appointments = { noDoubleBooking: true, prepayHours: 24, creditDays: 0, ...rules };
  const ctx = { pack, lang: 'en', t: makeT('en', pack), actor: 'u2' };
  return { d, ctx };
}
const book = (w, o) => bookAppointment(w.d, w.ctx, { typeId: 'free', staffId: 'u2', clientId: 'c1', date: day(3), time: '10:00', ...o });
/** A paid appointment three days out, the usual starting point of the money tests. */
function paidAppt(w, o = {}) {
  const r = book(w, { typeId: 'paid', ...o }); assert.ok(r.ok);
  const p = payAppointment(w.d, w.ctx, r.appointment.id, { method: 'check', ref: '1001', amount: r.appointment.fee });
  assert.ok(p.ok);
  return r.appointment;
}

/* ---------- double booking ---------- */

test('the same person is not booked twice, and the minutes kept free after an appointment count', () => {
  const w = world();
  assert.ok(book(w).ok, '10:00 to 10:30, then 10 minutes kept free');
  const clash = book(w, { clientId: 'c2', time: '10:15' });
  assert.deepEqual([clash.ok, clash.reason, clash.detail], [false, 'double_booked', 'overlap']);
  assert.equal(book(w, { clientId: 'c2', time: '10:30' }).reason, 'double_booked', '10:30 is inside the 10 minutes kept free');
  assert.ok(book(w, { clientId: 'c2', time: '10:40' }).ok, '10:40 is free');
  // the new appointment's own free minutes are protected too: 9:30 to 10:00 plus 10 runs into the 10:00 one
  assert.equal(book(w, { clientId: 'c2', time: '09:30' }).reason, 'double_booked');
  assert.ok(book(w, { clientId: 'c2', time: '09:20' }).ok, '9:20 to 9:50 plus 10 ends exactly at 10:00');
});

test('another staff member, another day, or a cancelled appointment do not block', () => {
  const w = world();
  const first = book(w); assert.ok(first.ok);
  assert.ok(book(w, { clientId: 'c2', staffId: 'u3' }).ok, 'another person at the same time');
  assert.ok(book(w, { clientId: 'c2', date: day(4) }).ok, 'the same time on another day');
  assert.ok(cancelAppointment(w.d, w.ctx, first.appointment.id, 'client', 'Cannot make it').ok);
  assert.ok(book(w, { clientId: 'c2' }).ok, 'the slot is free again after the cancellation');
});

test('a day the person is away is refused, whatever the double-booking rule says', () => {
  const w = world({ noDoubleBooking: false });
  w.d.users[1].away = { from: day(2), to: day(5) };
  const r = book(w);
  assert.deepEqual([r.ok, r.reason, r.detail], [false, 'double_booked', 'away']);
  assert.ok(book(w, { date: day(6) }).ok);
});

test('a company that allows double booking can overlap, but the same booking twice is still refused', () => {
  const w = world({ noDoubleBooking: false });
  assert.ok(book(w).ok);
  assert.ok(book(w, { clientId: 'c2', time: '10:15' }).ok, 'overlap allowed by the company rule');
  const again = book(w);
  assert.deepEqual([again.ok, again.reason, again.detail], [false, 'double_booked', 'duplicate'], 'a second click does not create a second appointment');
  assert.equal(w.d.appointments.length, 2);
});

test('past times, unknown types and incomplete input are refused', () => {
  const w = world();
  assert.equal(book(w, { date: day(-1) }).reason, 'past');
  assert.equal(book(w, { typeId: 'nope' }).reason, 'unknown_type');
  assert.equal(book(w, { clientId: undefined }).reason, 'invalid', 'needs a client or a lead');
  assert.equal(book(w, { clientId: 'ghost' }).reason, 'invalid');
  assert.equal(book(w, { staffId: 'ghost' }).reason, 'invalid');
  assert.equal(book(w, { time: '25:00' }).reason, 'invalid');
  assert.equal(book(w, { time: '23:50' }).reason, 'invalid', 'an appointment does not run past midnight');
  assert.equal(w.d.appointments.length, 0);
});

test('booking for a lead keeps the lead in step and a cancellation takes the date off again', () => {
  const w = world();
  const r = book(w, { clientId: undefined, leadId: 'l1' }); assert.ok(r.ok);
  assert.equal(w.d.leads[0].apptDate, day(3)); assert.equal(w.d.leads[0].apptTime, '10:00');
  assert.equal(w.d.leads[0].status, 'appointment', 'the lead moved to the stage that means an appointment is set');
  cancelAppointment(w.d, w.ctx, r.appointment.id, 'staff', 'Office closed');
  assert.equal(w.d.leads[0].apptDate, undefined);
});

/* ---------- prepayment ---------- */

test('a free type is scheduled; a prepaid type waits for payment until the company hours before the start', () => {
  const w = world();
  const free = book(w); assert.equal(free.appointment.status, 'scheduled'); assert.equal(free.appointment.payBy, undefined);
  const paid = book(w, { typeId: 'paid', clientId: 'c2', time: '13:00' });
  assert.equal(paid.appointment.status, 'awaiting_payment');
  assert.equal(new Date(paid.appointment.payBy).getTime(), startOf(paid.appointment).getTime() - 24 * 3600000);
  // a type with a fee that is not prepaid is simply scheduled
  assert.equal(book(w, { typeId: 'later', clientId: 'c2', date: day(5) }).appointment.status, 'scheduled');
});

test('the pay-by moment follows the company rule, and a late booking is due by its start', () => {
  const w = world({ prepayHours: 48 });
  const r = book(w, { typeId: 'paid', date: day(6) });
  assert.equal(new Date(r.appointment.payBy).getTime(), startOf(r.appointment).getTime() - 48 * 3600000);
  // booked three hours ahead: 48 hours before is already gone, so it is due by the start itself
  const soon = new Date(Date.now() + 3 * 3600000);
  if (iso(soon) === day(0) || soon.getHours() < 23) {
    const late = book(w, { typeId: 'paid', clientId: 'c2', date: iso(soon), time: hhmm(soon) });
    if (late.ok) assert.equal(new Date(late.appointment.payBy).getTime(), startOf(late.appointment).getTime());
  }
  const slot = { date: day(1), time: '09:00' };
  assert.equal(payByFor(w.d, slot, new Date(startOf(slot).getTime() - 2 * 3600000)), startOf(slot).toISOString());
});

test('paying confirms the appointment, once', () => {
  const w = world();
  const r = book(w, { typeId: 'paid' });
  assert.equal(payAppointment(w.d, w.ctx, r.appointment.id, { method: 'cash', ref: '', amount: 50 }).reason, 'too_small', 'less than the fee is not a payment');
  const p = payAppointment(w.d, w.ctx, r.appointment.id, { method: 'cash', ref: ' R-1 ', amount: 75 });
  assert.ok(p.ok); assert.equal(p.appointment.status, 'confirmed');
  assert.deepEqual([p.appointment.paid.method, p.appointment.paid.ref, p.appointment.paid.amount], ['cash', 'R-1', 75]);
  assert.equal(apptBalance(p.appointment), 0);
  assert.equal(payAppointment(w.d, w.ctx, r.appointment.id, { method: 'cash', ref: '', amount: 75 }).reason, 'conflict', 'a second click does not pay twice');
  assert.equal(w.d.credits.length, 0, 'paying mints no credit');
  assert.equal(payAppointment(w.d, w.ctx, book(w, { clientId: 'c2', time: '14:00' }).appointment.id, { method: 'cash', ref: '', amount: 10 }).reason, 'invalid', 'a free appointment has nothing to pay');
});

/* ---------- release of unpaid appointments ---------- */

test('an unpaid appointment is released when its pay-by moment passes, once', () => {
  const w = world();
  const unpaid = book(w, { typeId: 'paid' }).appointment;
  const settled = paidAppt(w, { clientId: 'c2', time: '13:00' });
  const before = new Date(new Date(unpaid.payBy).getTime() - 60000); const after = new Date(new Date(unpaid.payBy).getTime() + 60000);
  assert.equal(sweepDue(w.d, before), false);
  assert.equal(sweepAppointments(w.d, w.ctx, before).released.length, 0, 'not yet');
  assert.equal(unpaid.status, 'awaiting_payment');
  assert.equal(sweepDue(w.d, after), true);
  const out = sweepAppointments(w.d, w.ctx, after);
  assert.deepEqual(out.released.map((a) => a.id), [unpaid.id]);
  assert.equal(unpaid.status, 'cancelled_unpaid');
  assert.equal(settled.status, 'confirmed', 'a paid appointment is never released');
  assert.equal(sweepAppointments(w.d, w.ctx, after).released.length, 0, 'running it again changes nothing');
  assert.equal(w.d.activity.filter((x) => x.kind === 'appointment.unpaid').length, 1);
  assert.equal(w.d.credits.length, 0);
  // the slot is free for someone else
  assert.ok(book(w, { typeId: 'paid', clientId: 'c2' }).ok);
});

test('the sweep reports what is on today and what still needs an outcome', () => {
  const w = world();
  const now = new Date();
  const past = { id: 'old', typeId: 'free', clientId: 'c1', staffId: 'u2', date: day(-2), time: '10:00', minutes: 30, mode: 'office', status: 'scheduled', fee: 0, created: now.toISOString(), createdBy: 'u2' };
  const done = { ...past, id: 'done', status: 'completed' };
  const today = { ...past, id: 'today', date: day(0), time: '23:00', status: 'confirmed' };
  w.d.appointments.push(past, done, today);
  const out = sweepAppointments(w.d, w.ctx, now);
  assert.deepEqual(out.unresolved.map((a) => a.id), now.getHours() === 23 && now.getMinutes() > 30 ? ['old', 'today'] : ['old']);
  assert.deepEqual(out.today.map((a) => a.id), ['today']);
});

/* ---------- credits ---------- */

test('the office cancelling a paid appointment issues a credit for what was paid', () => {
  const w = world();
  const a = paidAppt(w);
  const out = cancelAppointment(w.d, w.ctx, a.id, 'staff', 'The associate is out sick');
  assert.ok(out.ok); assert.equal(a.status, 'cancelled_staff'); assert.equal(a.cancelReason, 'The associate is out sick');
  assert.deepEqual([out.credit.clientId, out.credit.amount, out.credit.reason, out.credit.fromApptId, out.credit.by], ['c1', 75, 'cancel_staff', a.id, 'u2']);
  assert.equal(creditBalance(w.d, 'c1'), 75);
  assert.equal(cancelAppointment(w.d, w.ctx, a.id, 'staff', 'again').reason, 'conflict', 'cancelling twice issues nothing more');
  assert.equal(w.d.credits.length, 1);
});

test('a cancellation needs a reason, and an unpaid one issues no credit', () => {
  const w = world();
  const a = book(w, { typeId: 'paid' }).appointment;
  assert.equal(cancelAppointment(w.d, w.ctx, a.id, 'staff', '  ').reason, 'invalid');
  const out = cancelAppointment(w.d, w.ctx, a.id, 'staff', 'Double booked by mistake');
  assert.ok(out.ok); assert.equal(out.credit, undefined); assert.equal(w.d.credits.length, 0);
});

test('a client cancelling: a credit, unless it is late and the company keeps late cancellations', () => {
  // default rule: the client keeps the money as a credit, even late
  const w = world();
  assert.equal(apptPolicy(w.d).clientCancel, 'credit');
  const a = paidAppt(w);
  const late = new Date(startOf(a).getTime() - 2 * 3600000);
  assert.deepEqual(cancelOutcome(w.d, a, 'client', late), { kind: 'credit', amount: 75 });
  const out = cancelAppointment(w.d, w.ctx, a.id, 'client', 'Changed plans', late);
  assert.equal(a.status, 'cancelled_client'); assert.equal(out.credit.reason, 'reschedule'); assert.equal(out.credit.amount, 75);

  // company rule "forfeit": late keeps the payment, early still gives the credit, and the office cancelling always gives it
  const f = world(); f.d.settings.appointments = { clientCancel: 'forfeit', noShowLimit: 2 };
  const b = paidAppt(f); const lateB = new Date(startOf(b).getTime() - 2 * 3600000); const earlyB = new Date(startOf(b).getTime() - 30 * 3600000);
  assert.equal(cancelOutcome(f.d, b, 'client', earlyB).kind, 'credit');
  assert.equal(cancelOutcome(f.d, b, 'staff', lateB).kind, 'credit');
  const kept = cancelAppointment(f.d, f.ctx, b.id, 'client', 'Changed plans', lateB);
  assert.ok(kept.ok); assert.equal(kept.credit, undefined); assert.equal(kept.kept, 'forfeit'); assert.equal(f.d.credits.length, 0);
  assert.equal(b.paid.amount, 75, 'the payment stays on record');
});

test('someone who is not a client yet cannot hold a credit, and the result says so', () => {
  const w = world();
  const a = book(w, { typeId: 'paid', clientId: undefined, leadId: 'l1' }).appointment;
  assert.equal(payAppointment(w.d, w.ctx, a.id, { method: 'cash', ref: '', amount: 80 }).reason, 'invalid', 'no client record to keep the extra for');
  assert.ok(payAppointment(w.d, w.ctx, a.id, { method: 'cash', ref: '', amount: 75 }).ok);
  const out = cancelAppointment(w.d, w.ctx, a.id, 'staff', 'Office closed');
  assert.equal(out.kept, 'no_client'); assert.equal(w.d.credits.length, 0);
});

test('a credit pays one appointment, once', () => {
  const w = world();
  const cancelled = paidAppt(w);
  const credit = cancelAppointment(w.d, w.ctx, cancelled.id, 'staff', 'Office closed').credit;
  const next = book(w, { typeId: 'paid', date: day(5) }).appointment;
  const other = book(w, { typeId: 'paid', date: day(6) }).appointment;
  const used = applyCredit(w.d, w.ctx, credit.id, next.id);
  assert.ok(used.ok); assert.equal(next.status, 'confirmed');
  assert.deepEqual([next.paid.method, next.paid.ref, next.paid.amount, next.creditId], ['credit', credit.id, 75, credit.id]);
  assert.equal(credit.used.apptId, next.id); assert.equal(creditState(credit), 'used');
  assert.equal(applyCredit(w.d, w.ctx, credit.id, other.id).reason, 'conflict', 'spent credits are not spent again');
  assert.equal(other.paid, undefined);
  assert.equal(creditBalance(w.d, 'c1'), 0);
  // cancelling the appointment the credit paid for gives the value back as a new entry; the spent one is not reopened
  const back = cancelAppointment(w.d, w.ctx, next.id, 'staff', 'Associate unavailable');
  assert.equal(back.credit.amount, 75); assert.notEqual(back.credit.id, credit.id); assert.equal(creditState(credit), 'used');
  assert.equal(w.d.credits.length, 2);
});

test('a credit belongs to one client, must cover the fee, and cannot pay what is already paid', () => {
  const w = world();
  const credit = cancelAppointment(w.d, w.ctx, paidAppt(w).id, 'staff', 'Office closed').credit;
  const theirs = book(w, { typeId: 'paid', clientId: 'c2', date: day(5) }).appointment;
  assert.equal(applyCredit(w.d, w.ctx, credit.id, theirs.id).reason, 'invalid', 'another client');
  const dear = book(w, { typeId: 'paid', date: day(6), fee: 120 }).appointment;
  assert.equal(applyCredit(w.d, w.ctx, credit.id, dear.id).reason, 'too_small');
  const paid = paidAppt(w, { date: day(7) });
  assert.equal(applyCredit(w.d, w.ctx, credit.id, paid.id).reason, 'conflict');
  assert.equal(applyCredit(w.d, w.ctx, 'ghost', paid.id).reason, 'not_found');
  assert.equal(creditState(credit), 'active', 'nothing was spent by the refused attempts');
});

test('credits expire by the company rule, and an expired credit pays nothing', () => {
  const w = world({ creditDays: 30 });
  const credit = cancelAppointment(w.d, w.ctx, paidAppt(w).id, 'staff', 'Office closed').credit;
  assert.equal(credit.expires, day(30));
  assert.equal(creditState(credit, day(30)), 'active', 'usable on its last day');
  assert.equal(creditState(credit, day(31)), 'expired');
  assert.equal(creditBalance(w.d, 'c1', day(31)), 0);
  assert.equal(creditsExpiringSoon(w.d, 7, day(25)).length, 1); assert.equal(creditsExpiringSoon(w.d, 7, day(1)).length, 0);
  const next = book(w, { typeId: 'paid', date: day(5) }).appointment;
  const after = new Date(); after.setDate(after.getDate() + 31);
  assert.equal(applyCredit(w.d, w.ctx, credit.id, next.id, after).reason, 'expired');
  assert.equal(voidCredit(w.d, w.ctx, credit.id, 'cleanup', after).reason, 'expired');
  // no expiry when the rule says 0 days
  const n = world({ creditDays: 0 });
  assert.equal(cancelAppointment(n.d, n.ctx, paidAppt(n).id, 'staff', 'Office closed').credit.expires, undefined);
});

test('a credit is voided with a reason and stays in the ledger', () => {
  const w = world();
  const credit = cancelAppointment(w.d, w.ctx, paidAppt(w).id, 'staff', 'Office closed').credit;
  assert.equal(voidCredit(w.d, w.ctx, credit.id, ' ').reason, 'invalid', 'a reason is required');
  const out = voidCredit(w.d, { ...w.ctx, actor: 'u1' }, credit.id, 'Issued by mistake');
  assert.ok(out.ok); assert.deepEqual([credit.void.by, credit.void.reason], ['u1', 'Issued by mistake']);
  assert.equal(creditState(credit), 'void'); assert.equal(creditBalance(w.d, 'c1'), 0);
  assert.equal(w.d.credits.length, 1, 'the entry is kept');
  assert.equal(voidCredit(w.d, w.ctx, credit.id, 'again').reason, 'conflict');
  const next = book(w, { typeId: 'paid', date: day(5) }).appointment;
  assert.equal(applyCredit(w.d, w.ctx, credit.id, next.id).reason, 'conflict', 'a voided credit pays nothing');
  // a used credit cannot be voided either
  const w2 = world();
  const c2 = cancelAppointment(w2.d, w2.ctx, paidAppt(w2).id, 'staff', 'Office closed').credit;
  applyCredit(w2.d, w2.ctx, c2.id, book(w2, { typeId: 'paid', date: day(5) }).appointment.id);
  assert.equal(voidCredit(w2.d, w2.ctx, c2.id, 'too late').reason, 'conflict');
});

/* ---------- cents ---------- */

test('money is added and compared in cents', () => {
  assert.notEqual(0.1 + 0.2, 0.3, 'plain addition is not exact');
  assert.equal(sumMoney([0.1, 0.2], (x) => x), 0.3);
  assert.equal(sumMoney([19.99, 0.01, 33.35, 66.65], (x) => x), 120);
  assert.equal(toCents(1.15), 115); assert.equal(toCents(8.2), 820); assert.equal(toCents('x'), 0);

  // paying more than the fee keeps the exact difference as a credit
  const w = world();
  const a = book(w, { typeId: 'paid', fee: 33.35 }).appointment;
  const p = payAppointment(w.d, w.ctx, a.id, { method: 'check', ref: '77', amount: 100.1 });
  assert.equal(p.credit.amount, 66.75); assert.equal(p.credit.reason, 'overpayment');
  // on cancellation the credit is for the fee, not for the part already given back
  const c = cancelAppointment(w.d, w.ctx, a.id, 'staff', 'Office closed').credit;
  assert.equal(c.amount, 33.35);
  assert.equal(creditBalance(w.d, 'c1'), 100.1, '66.75 + 33.35, to the cent');

  // a credit larger than the fee: spent whole, and the exact rest comes back as a new entry with the same expiry
  const x = world({ creditDays: 60 });
  const big = cancelAppointment(x.d, x.ctx, paidAppt(x, { fee: 75.1 }).id, 'staff', 'Office closed').credit;
  const cheap = book(x, { typeId: 'paid', date: day(5), fee: 75 }).appointment;
  const used = applyCredit(x.d, x.ctx, big.id, cheap.id);
  assert.equal(cheap.paid.amount, 75); assert.equal(used.remainder.amount, 0.1); assert.equal(used.remainder.expires, big.expires);
  assert.equal(creditBalance(x.d, 'c1'), 0.1);
  // three credits of ten cents add up to thirty cents exactly
  x.d.credits.push({ ...used.remainder, id: 'r2' }, { ...used.remainder, id: 'r3' });
  assert.equal(creditBalance(x.d, 'c1'), 0.3);
});

/* ---------- moving, outcomes, slots, settings ---------- */

test('moving an appointment keeps its id and payment, links the earlier slot, and checks the new time', () => {
  const w = world();
  const a = paidAppt(w);
  const blocker = book(w, { clientId: 'c2', date: day(4), time: '11:00' }); assert.ok(blocker.ok);
  assert.equal(rescheduleAppointment(w.d, w.ctx, a.id, { date: day(4), time: '11:15', askedBy: 'client' }).reason, 'double_booked');
  assert.equal(rescheduleAppointment(w.d, w.ctx, a.id, { date: day(-1), time: '11:15', askedBy: 'client' }).reason, 'past');
  assert.equal(rescheduleAppointment(w.d, w.ctx, a.id, { date: a.date, time: a.time, askedBy: 'client' }).reason, 'invalid', 'the same slot is not a move');
  const id = a.id;
  const out = rescheduleAppointment(w.d, w.ctx, a.id, { date: day(4), time: '14:00', askedBy: 'client', reason: 'Work trip' });
  assert.ok(out.ok); assert.equal(out.appointment.id, id);
  assert.deepEqual([a.date, a.time, a.status, a.paid.amount], [day(4), '14:00', 'confirmed', 75]);
  const earlier = earlierSlots(w.d, a);
  assert.equal(earlier.length, 1); assert.equal(a.rescheduledFrom, earlier[0].id);
  assert.deepEqual([earlier[0].date, earlier[0].time, earlier[0].status, earlier[0].paid, earlier[0].cancelReason], [day(3), '10:00', 'cancelled_client', undefined, 'Work trip']);
  assert.equal(wasMoved(w.d, earlier[0]), true); assert.equal(wasMoved(w.d, a), false);
  assert.equal(w.d.credits.length, 0, 'moving is not cancelling: no credit');
  rescheduleAppointment(w.d, w.ctx, a.id, { date: day(5), time: '09:00', staffId: 'u3', askedBy: 'staff' });
  assert.equal(rescheduleCount(w.d, a), 2); assert.equal(a.staffId, 'u3');
  // the first slot is free again
  assert.ok(book(w, { clientId: 'c2' }).ok);
});

test('an unpaid prepaid appointment gets a new pay-by moment when it moves; a client must confirm a new time again', () => {
  const w = world();
  const a = book(w, { typeId: 'paid' }).appointment;
  rescheduleAppointment(w.d, w.ctx, a.id, { date: day(8), time: '10:00', askedBy: 'staff' });
  assert.equal(new Date(a.payBy).getTime(), startOf(a).getTime() - 24 * 3600000);
  const f = book(w, { clientId: 'c2', time: '15:00' }).appointment;
  assert.ok(confirmAppointment(w.d, w.ctx, f.id).ok); assert.equal(f.status, 'confirmed');
  rescheduleAppointment(w.d, w.ctx, f.id, { date: day(9), time: '15:00', askedBy: 'staff' });
  assert.equal(f.status, 'scheduled');
});

test('outcomes wait for the start; no-shows are counted per person and stop further moves at the company limit', () => {
  const w = world();
  const future = book(w).appointment;
  assert.equal(completeAppointment(w.d, w.ctx, future.id).reason, 'early');
  assert.equal(markNoShow(w.d, w.ctx, future.id).reason, 'early');
  const past = (id, status = 'confirmed') => ({ id, typeId: 'free', clientId: 'c1', staffId: 'u2', date: day(-3), time: '10:00', minutes: 30, mode: 'office', status, fee: 0, created: new Date().toISOString(), createdBy: 'u2' });
  w.d.appointments.push(past('p1'), past('p2'), past('p3', 'scheduled'));
  assert.ok(completeAppointment(w.d, w.ctx, 'p3').ok);
  assert.equal(completeAppointment(w.d, w.ctx, 'p3').reason, 'closed');
  assert.ok(markNoShow(w.d, w.ctx, 'p1').ok);
  assert.equal(movesBlocked(w.d, future), false, 'one no-show is under the limit of two');
  assert.ok(markNoShow(w.d, w.ctx, 'p2').ok);
  assert.equal(noShowCount(w.d, { clientId: 'c1' }), 2); assert.equal(noShowCount(w.d, { clientId: 'c2' }), 0);
  assert.equal(rescheduleAppointment(w.d, w.ctx, future.id, { date: day(6), time: '10:00', askedBy: 'client' }).reason, 'no_show_limit');
  w.d.settings.appointments = { clientCancel: 'credit', noShowLimit: 0 };
  assert.ok(rescheduleAppointment(w.d, w.ctx, future.id, { date: day(6), time: '10:00', askedBy: 'client' }).ok, 'limit switched off');
});

test('the slot finder proposes free times inside the office hours only', () => {
  const w = world();
  w.d.config.hours = { days: [0, 1, 2, 3, 4, 5, 6], open: '09:00', close: '12:00' };
  const from = day(2);
  w.d.appointments.push({ id: 'b1', typeId: 'free', clientId: 'c1', staffId: 'u2', date: from, time: '09:00', minutes: 30, mode: 'office', status: 'confirmed', fee: 0, created: '', createdBy: 'u2' });
  const slots = freeSlots(w.d, { staffId: 'u2', typeId: 'free', from, count: 8, perDay: 10 });
  const first = slots.filter((s) => s.date === from).map((s) => s.time);
  // 9:00 is taken and kept free until 9:40, so the first half hour that fits is 10:00; the last that ends by noon is 11:30
  assert.deepEqual(first, ['10:00', '10:30', '11:00', '11:30']);
  for (const s of slots) assert.equal(busyAt(w.d, { staffId: 'u2', date: s.date, time: s.time, minutes: 30, typeId: 'free' }), null);
  // away days and closed days are skipped
  w.d.users[1].away = { from, to: from };
  assert.equal(freeSlots(w.d, { staffId: 'u2', typeId: 'free', from, count: 3 })[0].date, day(3));
  const closed = new Date(); closed.setDate(closed.getDate() + 3);
  w.d.config.hours = { days: [0, 1, 2, 3, 4, 5, 6].filter((x) => x !== closed.getDay()), open: '09:00', close: '12:00' };
  assert.ok(freeSlots(w.d, { staffId: 'u2', typeId: 'free', from: day(3), count: 3 }).every((s) => s.date !== day(3)));
  // never a time that has already passed
  assert.ok(freeSlots(w.d, { staffId: 'u3', typeId: 'free', count: 4 }).every((s) => startOf(s).getTime() > Date.now()));
});

test('a request holds no time until the office accepts it, and accepting applies the same checks', () => {
  const w = world();
  const req = { id: 'r1', typeId: 'paid', clientId: 'c1', staffId: 'u2', date: day(3), time: '10:00', minutes: 45, mode: 'video', status: 'requested', fee: 75, created: '', createdBy: 'system' };
  w.d.appointments.push(req);
  assert.ok(book(w, { clientId: 'c2', time: '10:15' }).ok, 'a request does not block the calendar');
  assert.equal(acceptAppointment(w.d, w.ctx, 'r1').reason, 'double_booked');
  cancelAppointment(w.d, w.ctx, w.d.appointments[0].id, 'staff', 'Moved');
  const ok = acceptAppointment(w.d, w.ctx, 'r1');
  assert.ok(ok.ok); assert.equal(req.status, 'awaiting_payment'); assert.ok(req.payBy);
});

test('appointment types and rules are validated before they are saved', () => {
  const w = world();
  assert.equal(saveApptType(w.d, w.ctx, { name: { en: 'X', es: '' }, minutes: 30, fee: 0, prepay: false, mode: 'office', active: true }), null, 'both languages are required');
  assert.equal(saveApptType(w.d, w.ctx, { name: { en: 'X', es: 'X' }, minutes: 2, fee: 0, prepay: false, mode: 'office', active: true }), null);
  const t = saveApptType(w.d, w.ctx, { name: { en: 'Review', es: 'Revisión' }, minutes: 30, fee: 0, prepay: true, mode: 'phone', buffer: 5, active: true });
  assert.equal(t.prepay, false, 'nothing to prepay without a fee');
  assert.equal(deleteApptType(w.d, w.ctx, t.id), 'deleted');
  assert.ok(book(w).ok);
  assert.equal(deleteApptType(w.d, w.ctx, 'free'), 'switched_off', 'a type with history is switched off, not removed');
  assert.equal(w.d.apptTypes.find((x) => x.id === 'free').active, false);
  const rules = { noDoubleBooking: true, prepayHours: 48, creditDays: 90, clientCancel: 'forfeit', noShowLimit: 3, hours: { days: [1, 2, 3], open: '08:00', close: '16:00' } };
  assert.equal(saveApptRules(w.d, w.ctx, { ...rules, prepayHours: -1 }), false);
  assert.equal(saveApptRules(w.d, w.ctx, { ...rules, hours: { days: [1], open: '10:00', close: '09:00' } }), false);
  assert.equal(saveApptRules(w.d, w.ctx, rules), true);
  assert.deepEqual(w.d.config.appointments, { noDoubleBooking: true, prepayHours: 48, creditDays: 90 });
  assert.deepEqual(apptPolicy(w.d), { clientCancel: 'forfeit', noShowLimit: 3 });
  assert.deepEqual(hoursOf(w.d), { days: [1, 2, 3], open: '08:00', close: '16:00' });
  // a fee can change until it is paid; a closed appointment keeps everything but its notes
  const a = book(w, { typeId: 'paid', date: day(5) }).appointment;
  assert.ok(updateAppointment(w.d, w.ctx, a.id, { fee: 60 }).ok); assert.equal(a.fee, 60);
  payAppointment(w.d, w.ctx, a.id, { method: 'cash', ref: '', amount: 60 });
  assert.equal(updateAppointment(w.d, w.ctx, a.id, { fee: 10 }).reason, 'invalid');
});

/* ---------- the sample business ---------- */

test('the sample firm: every status, nobody booked twice or while away, credits that add up', async () => {
  const s = await load(`export { seed } from '@/packs/practice/seed'; export { busyAt, holdsSlot, creditState, creditBalance, wasMoved } from '@/domain/actions/appointments';`);
  for (const lang of ['en', 'es']) {
    const d = { ...blank(PACKS.practice), ...s.seed(lang) };
    const ids = new Set(d.appointments.map((a) => a.id));
    assert.equal(ids.size, d.appointments.length, 'unique ids');
    for (const st of ['requested', 'scheduled', 'awaiting_payment', 'confirmed', 'completed', 'no_show', 'cancelled_unpaid', 'cancelled_client', 'cancelled_staff']) assert.ok(d.appointments.some((a) => a.status === st), `${lang}: a sample in status ${st}`);
    for (const a of d.appointments) {
      assert.ok(d.apptTypes.some((x) => x.id === a.typeId), `${a.id}: known type`);
      assert.ok(d.users.some((u) => u.id === a.staffId && u.active !== false), `${a.id}: active staff member`);
      assert.ok(a.clientId ? d.clients.some((c) => c.id === a.clientId) : d.leads.some((l) => l.id === a.leadId), `${a.id}: a client or a lead`);
      if (a.jobId) assert.ok(d.jobs.some((j) => j.id === a.jobId && j.clientId === a.clientId), `${a.id}: the engagement belongs to the client`);
      if (a.rescheduledFrom) assert.ok(ids.has(a.rescheduledFrom), `${a.id}: the earlier slot exists`);
      if (s.holdsSlot(a)) assert.equal(s.busyAt(d, { staffId: a.staffId, date: a.date, time: a.time, minutes: a.minutes, typeId: a.typeId }, a.id), null, `${lang} ${a.id}: the person is free`);
      if (a.status === 'awaiting_payment') assert.ok(a.payBy > new Date().toISOString() && !a.paid, `${a.id}: the pay-by moment is still ahead`);
      if (a.paid) assert.ok(a.paid.at >= a.created, `${a.id}: paid after it was booked`);
    }
    // the lead that carries an appointment date has the booking behind it
    for (const l of d.leads.filter((x) => x.apptDate)) assert.ok(d.appointments.some((a) => a.leadId === l.id && a.date === l.apptDate && a.time === l.apptTime), `lead ${l.id} has its appointment`);
    const used = d.credits.find((c) => c.used); const open = d.credits.find((c) => !c.used);
    assert.equal(s.creditState(used), 'used'); assert.equal(s.creditState(open), 'active');
    const paidBy = d.appointments.find((a) => a.id === used.used.apptId);
    assert.deepEqual([paidBy.paid.method, paidBy.paid.ref, paidBy.creditId, paidBy.clientId], ['credit', used.id, used.id, used.clientId]);
    for (const c of d.credits) { const from = d.appointments.find((a) => a.id === c.fromApptId); assert.deepEqual([from.status, from.clientId, from.paid.amount], ['cancelled_staff', c.clientId, c.amount]); }
    assert.equal(s.creditBalance(d, open.clientId), open.amount); assert.equal(s.creditBalance(d, used.clientId), 0);
    assert.equal(d.appointments.filter((a) => s.wasMoved(d, a)).length, 1, 'one earlier slot of a moved appointment');
  }
});
