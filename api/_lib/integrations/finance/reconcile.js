// Reconciliation: which local record does a payment taken in a connected system belong to? Pure: no database, no
// network. The same input always gives the same answer, and when the rules cannot tell, the answer is "a person
// decides", never a guess.
//
// Rule order (the first rule that names exactly one record wins):
//   1. order      the provider order was created by this platform for one record (a payment link): the stored order id
//   2. reference  the payment's reference id carries this platform's code for a record
//   3. note       the payment's note carries that code
//   4. client     the payer is linked to a client who has exactly one open record whose balance equals the amount
// Rules 1 to 3 are explicit: somebody (this platform, or a person typing the code) said what the money is for, so a
// part payment or an overpayment is accepted. Rule 4 is an inference, so it accepts an exact amount only.
// Explicit rules that name two different records contradict each other: ambiguous. A payment for a record that is
// closed or already paid in full is not applied: unmatched, for a person.
//
// Amounts are whole cents. A refund lowers what was received on the payment it belongs to and is otherwise read only.
import { isCents } from './money.js';

const HEX32 = /^[0-9a-f]{32}$/;
const KINDS = { A: 'appointment', J: 'job' };
const LETTER = { appointment: 'A', job: 'J' };

/** The code this platform puts on a provider order for a record: "VXA" or "VXJ" plus the id without dashes (35 characters, within Square's 40). */
export function refCode(kind, id) {
  const hex = String(id || '').replace(/-/g, '').toLowerCase();
  if (!LETTER[kind] || !HEX32.test(hex)) throw new TypeError('bad_reference');
  return `VX${LETTER[kind]}${hex}`;
}
const uuidOf = (hex) => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

/** Every code found in a text, as [{ kind, id }] without repeats, in the order found. */
export function parseRefs(text) {
  const out = []; const seen = new Set();
  for (const m of String(text || '').matchAll(/\bVX([AJ])([0-9a-fA-F]{32})\b/g)) {
    const ref = { kind: KINDS[m[1]], id: uuidOf(m[2].toLowerCase()) };
    const key = ref.kind + ':' + ref.id;
    if (!seen.has(key)) { seen.add(key); out.push(ref); }
  }
  return out;
}

const key = (c) => `${c.kind}:${c.id}`;
const balanceOf = (c) => c.dueCents - c.paidCents;

/**
 * payment  { externalId, status: 'completed' | other, cents, currency, orderId, referenceId, note }
 * world    { currency, clientId, intents: [{ orderId, kind, id }], contexts: [{ kind, id, clientId, dueCents, paidCents, open }] }
 *          clientId: the local client linked to the payer, or null. contexts: the records the references name, plus
 *          the open records of that client.
 * Answer   { outcome: 'matched', rule, context: { kind, id }, appliedCents, balanceCents, overpaidCents, settles, payerDiffers }
 *          { outcome: 'ambiguous', reason, candidates: [{ kind, id }] }
 *          { outcome: 'unmatched', reason }
 *          { outcome: 'ignored', reason }      nothing to record (not completed, no amount)
 */
export function reconcilePayment(payment, world) {
  if (payment.status !== 'completed') return { outcome: 'ignored', reason: 'not_completed' };
  if (!isCents(payment.cents) || payment.cents <= 0) return { outcome: 'ignored', reason: 'no_amount' };
  if (world.currency && payment.currency !== world.currency) return { outcome: 'unmatched', reason: 'currency_mismatch' };
  const contexts = new Map((world.contexts || []).filter((c) => isCents(c.dueCents) && isCents(c.paidCents)).map((c) => [key(c), c]));

  // Explicit references, strongest first. Each names at most one record that exists.
  const named = [];
  const intent = payment.orderId ? (world.intents || []).find((i) => i.orderId === payment.orderId) : null;
  if (intent && contexts.has(key(intent))) named.push({ rule: 'order', c: contexts.get(key(intent)) });
  for (const [rule, text] of [['reference', payment.referenceId], ['note', payment.note]]) {
    for (const ref of parseRefs(text)) if (contexts.has(key(ref))) named.push({ rule, c: contexts.get(key(ref)) });
  }
  const distinct = [...new Map(named.map((n) => [key(n.c), n])).values()];
  if (distinct.length > 1) {
    return { outcome: 'ambiguous', reason: 'conflicting_references', candidates: distinct.map((n) => ({ kind: n.c.kind, id: n.c.id })).sort((a, b) => key(a).localeCompare(key(b))) };
  }
  if (distinct.length === 1) {
    const { rule, c } = named.find((n) => key(n.c) === key(distinct[0].c));
    if (!c.open) return { outcome: 'unmatched', reason: 'context_closed' };
    if (balanceOf(c) <= 0) return { outcome: 'unmatched', reason: 'already_settled' };
    return applied(payment, c, rule, world);
  }

  // No explicit reference. The payer's own open records, exact amount, exactly one.
  if (!world.clientId) return { outcome: 'unmatched', reason: 'no_reference' };
  const exact = [...contexts.values()].filter((c) => c.clientId === world.clientId && c.open && balanceOf(c) === payment.cents);
  if (exact.length === 1) return applied(payment, exact[0], 'client', world);
  if (exact.length > 1) {
    return { outcome: 'ambiguous', reason: 'several_candidates', candidates: exact.map((c) => ({ kind: c.kind, id: c.id })).sort((a, b) => key(a).localeCompare(key(b))) };
  }
  return { outcome: 'unmatched', reason: 'no_candidate' };
}

function applied(payment, c, rule, world) {
  const before = balanceOf(c);
  const after = before - payment.cents;
  return {
    outcome: 'matched', rule, context: { kind: c.kind, id: c.id },
    appliedCents: payment.cents,
    balanceCents: Math.max(after, 0),
    overpaidCents: Math.max(-after, 0),
    settles: after <= 0,
    // The payer is linked to another client than the record's. Still applied (people pay for each other), and said.
    payerDiffers: !!(world.clientId && c.clientId && world.clientId !== c.clientId),
  };
}

/**
 * refund   { externalId, paymentExternalId, status: 'completed' | other, cents, currency }
 * payment  the recorded payment it belongs to: { cents, refundedCents, currency, context: { kind, id } | null } or null
 * Answer   { outcome: 'recorded', netCents, context }   the payment's received amount after this refund
 *          { outcome: 'unmatched', reason } | { outcome: 'ignored', reason }
 * A refund never changes the local record by itself: the received total drops and a person sees it.
 */
export function reconcileRefund(refund, payment) {
  if (refund.status !== 'completed') return { outcome: 'ignored', reason: 'not_completed' };
  if (!isCents(refund.cents) || refund.cents <= 0) return { outcome: 'ignored', reason: 'no_amount' };
  if (!payment) return { outcome: 'unmatched', reason: 'payment_unknown' };
  if (payment.currency && refund.currency !== payment.currency) return { outcome: 'unmatched', reason: 'currency_mismatch' };
  const net = payment.cents - (payment.refundedCents || 0) - refund.cents;
  if (net < 0) return { outcome: 'unmatched', reason: 'refund_exceeds_payment' };
  return { outcome: 'recorded', netCents: net, context: payment.context || null };
}
