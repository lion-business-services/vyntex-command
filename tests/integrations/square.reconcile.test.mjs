// The rules behind the payment and accounting adapters, with no database and no network:
// money in whole cents, matching a customer to a client, placing a payment, the insert-only catalog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTestEnv } from '../server/helpers.mjs';

setTestEnv();
const { toCents, centsToDecimal, squareMoney, sumCents } = await import('../../api/_lib/integrations/finance/money.js');
const { matchCustomer, linkState, normPhone } = await import('../../api/_lib/integrations/finance/match.js');
const { reconcilePayment, reconcileRefund, refCode, parseRefs } = await import('../../api/_lib/integrations/finance/reconcile.js');
const { planSquarePush, assertInsertOnly, proposeFromRemote, slimSquareItem } = await import('../../api/_lib/integrations/finance/catalog.js');
const { memoryFinance } = await import('../../api/_lib/integrations/finance/memory.js');

const A1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const A2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const J1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const C1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const C2 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
const appt = (id, due, extra = {}) => ({ kind: 'appointment', id, clientId: C1, dueCents: due, paidCents: 0, open: true, ...extra });
const pay = (extra = {}) => ({ externalId: 'pay_1', status: 'completed', cents: 7500, currency: 'USD', orderId: null, referenceId: '', note: '', ...extra });

test('money: whole cents in and out, and nothing that is not exact gets through', () => {
  assert.equal(toCents('12.34'), 1234); assert.equal(toCents('12.3'), 1230); assert.equal(toCents('12'), 1200); assert.equal(toCents(100.5), 10050); assert.equal(toCents('-0.05'), -5);
  assert.equal(toCents(0.1 + 0.2), null, 'a float that is not an exact amount is refused, not rounded');
  for (const bad of ['12.345', '1e3', '', 'abc', NaN, Infinity, null, undefined, {}, '12,34']) assert.equal(toCents(bad), null);
  assert.equal(centsToDecimal(1234), '12.34'); assert.equal(centsToDecimal(5), '0.05'); assert.equal(centsToDecimal(-150), '-1.50'); assert.equal(centsToDecimal(0), '0.00');
  assert.throws(() => centsToDecimal(12.5)); assert.throws(() => sumCents([100, 0.5]));
  assert.equal(sumCents([1999, 1, 8000]), 10000);
  assert.deepEqual(squareMoney({ amount: 7500, currency: 'USD' }), { cents: 7500, currency: 'USD' });
  assert.equal(squareMoney({ amount: 75.5, currency: 'USD' }), null); assert.equal(squareMoney({ amount: 7500 }), null); assert.equal(squareMoney(null), null);
  // the classic float trap: 0.1 + 0.2 dollars. In cents it is exactly 30.
  assert.equal(sumCents([toCents('0.10'), toCents('0.20')]), 30);
});

test('references: the code on an order names one record and survives being typed inside other text', () => {
  const code = refCode('appointment', A1);
  assert.equal(code.length, 35); assert.ok(code.length <= 40, 'fits the reference field of a Square order');
  assert.deepEqual(parseRefs(`for ${code} thank you`), [{ kind: 'appointment', id: A1 }]);
  assert.deepEqual(parseRefs(`${refCode('job', J1)} ${refCode('job', J1)}`), [{ kind: 'job', id: J1 }]);
  assert.deepEqual(parseRefs('INV-2041 nothing of ours'), []);
  assert.throws(() => refCode('appointment', 'not-an-id')); assert.throws(() => refCode('client', A1));
});

test('reconcile: exact match by the stored order of a payment link', () => {
  const d = reconcilePayment(pay({ orderId: 'ord_1' }), { currency: 'USD', clientId: null, intents: [{ orderId: 'ord_1', kind: 'appointment', id: A1 }], contexts: [appt(A1, 7500)] });
  assert.deepEqual(d, { outcome: 'matched', rule: 'order', context: { kind: 'appointment', id: A1 }, appliedCents: 7500, balanceCents: 0, overpaidCents: 0, settles: true, payerDiffers: false });
});

test('reconcile: the rule order is fixed (order, then reference, then note, then client and amount)', () => {
  const world = { currency: 'USD', clientId: C1, intents: [{ orderId: 'ord_1', kind: 'appointment', id: A1 }], contexts: [appt(A1, 7500)] };
  assert.equal(reconcilePayment(pay({ orderId: 'ord_1', referenceId: refCode('appointment', A1), note: refCode('appointment', A1) }), world).rule, 'order');
  assert.equal(reconcilePayment(pay({ referenceId: refCode('appointment', A1), note: refCode('appointment', A1) }), world).rule, 'reference');
  assert.equal(reconcilePayment(pay({ note: 'paid ' + refCode('appointment', A1) }), world).rule, 'note');
  assert.equal(reconcilePayment(pay(), world).rule, 'client');
  // the same input gives the same answer, every time
  assert.deepEqual(reconcilePayment(pay(), world), reconcilePayment(pay(), world));
});

test('reconcile: a part payment with a reference is applied and leaves a balance', () => {
  const d = reconcilePayment(pay({ cents: 2500, referenceId: refCode('appointment', A1) }), { currency: 'USD', clientId: null, intents: [], contexts: [appt(A1, 7500)] });
  assert.equal(d.outcome, 'matched'); assert.equal(d.appliedCents, 2500); assert.equal(d.balanceCents, 5000); assert.equal(d.settles, false); assert.equal(d.overpaidCents, 0);
  // the second part settles it
  const d2 = reconcilePayment(pay({ externalId: 'pay_2', cents: 5000, referenceId: refCode('appointment', A1) }), { currency: 'USD', clientId: null, intents: [], contexts: [appt(A1, 7500, { paidCents: 2500 })] });
  assert.equal(d2.balanceCents, 0); assert.equal(d2.settles, true);
});

test('reconcile: an overpayment with a reference is applied and the extra is named, to the cent', () => {
  const d = reconcilePayment(pay({ cents: 8001, referenceId: refCode('appointment', A1) }), { currency: 'USD', clientId: null, intents: [], contexts: [appt(A1, 7500)] });
  assert.equal(d.outcome, 'matched'); assert.equal(d.balanceCents, 0); assert.equal(d.overpaidCents, 501); assert.equal(d.settles, true);
});

test('reconcile: without a reference only an exact amount counts, and a part amount is not guessed', () => {
  const world = { currency: 'USD', clientId: C1, intents: [], contexts: [appt(A1, 7500)] };
  assert.deepEqual(reconcilePayment(pay({ cents: 2500 }), world), { outcome: 'unmatched', reason: 'no_candidate' });
  assert.deepEqual(reconcilePayment(pay({ cents: 9000 }), world), { outcome: 'unmatched', reason: 'no_candidate' });
  assert.deepEqual(reconcilePayment(pay(), { ...world, clientId: null }), { outcome: 'unmatched', reason: 'no_reference' });
});

test('reconcile: two candidates are never guessed between', () => {
  const world = { currency: 'USD', clientId: C1, intents: [], contexts: [appt(A2, 7500), appt(A1, 7500), { kind: 'job', id: J1, clientId: C1, dueCents: 90000, paidCents: 0, open: true }] };
  const d = reconcilePayment(pay(), world);
  assert.equal(d.outcome, 'ambiguous'); assert.equal(d.reason, 'several_candidates');
  assert.deepEqual(d.candidates, [{ kind: 'appointment', id: A1 }, { kind: 'appointment', id: A2 }], 'both are listed for the person, in a fixed order');
  // references that contradict each other are ambiguous too
  const c = reconcilePayment(pay({ referenceId: refCode('appointment', A1), note: refCode('job', J1) }), world);
  assert.equal(c.outcome, 'ambiguous'); assert.equal(c.reason, 'conflicting_references'); assert.equal(c.candidates.length, 2);
});

test('reconcile: closed, already paid, wrong currency, not completed', () => {
  const ref = refCode('appointment', A1);
  assert.deepEqual(reconcilePayment(pay({ referenceId: ref }), { currency: 'USD', intents: [], contexts: [appt(A1, 7500, { open: false })] }), { outcome: 'unmatched', reason: 'context_closed' });
  assert.deepEqual(reconcilePayment(pay({ referenceId: ref }), { currency: 'USD', intents: [], contexts: [appt(A1, 7500, { paidCents: 7500 })] }), { outcome: 'unmatched', reason: 'already_settled' });
  assert.deepEqual(reconcilePayment(pay({ referenceId: ref, currency: 'CAD' }), { currency: 'USD', intents: [], contexts: [appt(A1, 7500)] }), { outcome: 'unmatched', reason: 'currency_mismatch' });
  assert.deepEqual(reconcilePayment(pay({ referenceId: ref, status: 'pending' }), { currency: 'USD', intents: [], contexts: [appt(A1, 7500)] }), { outcome: 'ignored', reason: 'not_completed' });
  assert.deepEqual(reconcilePayment(pay({ referenceId: ref, cents: 75.5 }), { currency: 'USD', intents: [], contexts: [appt(A1, 7500)] }), { outcome: 'ignored', reason: 'no_amount' });
  // a reference to a record that does not exist falls through to the unmatched list
  assert.deepEqual(reconcilePayment(pay({ referenceId: refCode('appointment', A2) }), { currency: 'USD', clientId: null, intents: [], contexts: [] }), { outcome: 'unmatched', reason: 'no_reference' });
  // somebody else pays for the client: applied, and said
  assert.equal(reconcilePayment(pay({ referenceId: ref }), { currency: 'USD', clientId: C2, intents: [], contexts: [appt(A1, 7500)] }).payerDiffers, true);
});

test('ledger: a payment is recorded once; the duplicate webhook changes nothing', async () => {
  const fin = memoryFinance({ contexts: [appt(A1, 7500)] });
  const decision = reconcilePayment(pay({ referenceId: refCode('appointment', A1) }), await fin.candidates({ provider: 'square', refs: [{ kind: 'appointment', id: A1 }] }));
  const first = await fin.paymentRecord({ provider: 'square', externalId: 'pay_1', cents: 7500, currency: 'USD', decision });
  assert.deepEqual(first, { fresh: true, status: 'matched', balanceCents: 0, settled: true });
  for (let i = 0; i < 3; i += 1) {
    const again = await fin.paymentRecord({ provider: 'square', externalId: 'pay_1', cents: 7500, currency: 'USD', decision });
    assert.equal(again.fresh, false); assert.equal(again.balanceCents, 0);
  }
  assert.equal(fin.state.payments.size, 1);
  assert.equal(fin.state.contexts[0].paidCents, 7500, 'counted once');
  assert.deepEqual(fin.state.contexts[0].paid, { method: 'card', ref: 'square:pay_1', cents: 7500 }, 'the Square payment id is the reference');
  assert.equal(fin.state.credits.length, 0);
});

test('ledger: part payments add up in cents, the second one settles, an overpayment becomes a credit', async () => {
  const fin = memoryFinance({ contexts: [appt(A1, 10000)] });
  const ref = refCode('appointment', A1);
  const run = async (id, cents) => {
    const d = reconcilePayment(pay({ externalId: id, cents, referenceId: ref }), await fin.candidates({ provider: 'square', refs: parseRefs(ref) }));
    return { d, r: d.outcome === 'matched' ? await fin.paymentRecord({ provider: 'square', externalId: id, cents, currency: 'USD', decision: d }) : null };
  };
  let x = await run('p1', 3333); assert.equal(x.r.balanceCents, 6667); assert.equal(x.r.settled, false); assert.equal(fin.state.contexts[0].paid, undefined);
  x = await run('p2', 3333); assert.equal(x.r.balanceCents, 3334);
  x = await run('p3', 3400); assert.equal(x.r.balanceCents, 0); assert.equal(x.r.settled, true);
  assert.deepEqual(fin.state.credits, [{ clientId: C1, cents: 66, reason: 'overpayment', from: 'square:p3' }]);
  // a fourth payment for a settled record is not applied: it goes to a person
  x = await run('p4', 500); assert.deepEqual(x.d, { outcome: 'unmatched', reason: 'already_settled' });
});

test('ledger: an unmatched payment waits on the list until a person assigns it, once', async () => {
  const fin = memoryFinance({ contexts: [appt(A1, 7500), { kind: 'job', id: J1, clientId: C1, dueCents: 90000, paidCents: 0, open: true }] });
  const d = reconcilePayment(pay({ externalId: 'p9' }), await fin.candidates({ provider: 'square' }));
  assert.deepEqual(d, { outcome: 'unmatched', reason: 'no_reference' });
  await fin.paymentRecord({ provider: 'square', externalId: 'p9', cents: 7500, currency: 'USD', decision: d });
  assert.deepEqual(await fin.unmatched('square'), [{ externalId: 'p9', cents: 7500, status: 'unmatched', reason: 'no_reference', candidates: [] }]);
  assert.equal(fin.state.contexts[0].paidCents, 0, 'nothing was applied by guessing');
  assert.deepEqual(await fin.paymentAssign({ provider: 'square', externalId: 'p9', kind: 'job', id: J1 }), { ok: true, balanceCents: 82500, settled: false });
  assert.deepEqual(fin.state.localPayments, [{ jobId: J1, cents: 7500, method: 'card', ref: 'square:p9' }]);
  assert.deepEqual(await fin.paymentAssign({ provider: 'square', externalId: 'p9', kind: 'appointment', id: A1 }), { ok: false, reason: 'conflict' }, 'a second assignment is refused');
  assert.deepEqual(await fin.unmatched('square'), []);
});

test('refund: lowers what was received once, never below zero, and flags the record for a person', async () => {
  const fin = memoryFinance({ contexts: [appt(A1, 7500)] });
  const d = reconcilePayment(pay({ referenceId: refCode('appointment', A1) }), await fin.candidates({ provider: 'square', refs: [{ kind: 'appointment', id: A1 }] }));
  await fin.paymentRecord({ provider: 'square', externalId: 'pay_1', cents: 7500, currency: 'USD', decision: d });
  const refund = { externalId: 'ref_1', paymentExternalId: 'pay_1', status: 'completed', cents: 2500, currency: 'USD' };
  const rd = reconcileRefund(refund, await fin.paymentGet('square', 'pay_1'));
  assert.deepEqual(rd, { outcome: 'recorded', netCents: 5000, context: { kind: 'appointment', id: A1 } });
  assert.deepEqual(await fin.refundRecord({ provider: 'square', ...refund, decision: rd }), { fresh: true, status: 'recorded', balanceCents: 2500 });
  assert.equal((await fin.refundRecord({ provider: 'square', ...refund, decision: rd })).fresh, false, 'the same refund again changes nothing');
  assert.equal(fin.state.contexts[0].paidCents, 5000);
  assert.deepEqual(fin.state.contexts[0].paid, { method: 'card', ref: 'square:pay_1', cents: 7500 }, 'the local payment mark is not rewritten');
  assert.equal(fin.state.reviews.length, 1);
  assert.deepEqual(reconcileRefund({ ...refund, externalId: 'ref_2', cents: 5001 }, await fin.paymentGet('square', 'pay_1')), { outcome: 'unmatched', reason: 'refund_exceeds_payment' });
  assert.deepEqual(reconcileRefund(refund, null), { outcome: 'unmatched', reason: 'payment_unknown' });
  assert.deepEqual(reconcileRefund({ ...refund, status: 'pending' }, await fin.paymentGet('square', 'pay_1')), { outcome: 'ignored', reason: 'not_completed' });
});

test('customers: stored id, then email, then phone; a shared email is for a person; fields are never copied', () => {
  const locals = [
    { id: C1, name: 'Sample Person One', email: 'one@example.com', phone: '(609) 555-0101', externalId: null },
    { id: C2, name: 'Sample Person Two', email: 'two@example.com', phone: '609-555-0102', externalId: 'CUST_2' },
  ];
  assert.deepEqual(matchCustomer({ id: 'CUST_2', name: 'Sample Person Two', email: 'other@example.com', phone: '' }, locals), { outcome: 'linked', rule: 'stored_id', clientId: C2, candidates: [], differences: ['email'] });
  const byEmail = matchCustomer({ id: 'CUST_1', name: 'S. Person One', email: ' ONE@Example.com ', phone: '+1 609 555 0199' }, locals);
  assert.deepEqual(byEmail, { outcome: 'link', rule: 'email', clientId: C1, candidates: [], differences: ['name', 'phone'] });
  assert.equal(linkState(byEmail), 'proposed');
  assert.equal(matchCustomer({ id: 'CUST_1', name: '', email: '', phone: '+1 (609) 555-0101' }, locals).rule, 'phone');
  assert.equal(normPhone('+1 (609) 555-0101'), '6095550101');
  assert.equal(matchCustomer({ id: 'CUST_9', name: 'x', email: 'two@example.com', phone: '' }, locals).outcome, 'conflict', 'that client already has another Square customer');
  assert.equal(matchCustomer({ id: 'CUST_8', name: 'Nobody', email: 'none@example.com', phone: '' }, locals).outcome, 'new');
  const family = [...locals, { id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3', name: 'Sample Person Three', email: 'one@example.com', phone: '', externalId: null }];
  const amb = matchCustomer({ id: 'CUST_1', name: 'x', email: 'one@example.com', phone: '' }, family);
  assert.equal(amb.outcome, 'ambiguous'); assert.equal(amb.clientId, null); assert.equal(amb.candidates.length, 2); assert.equal(linkState(amb), 'needs_review');
  assert.ok(!JSON.stringify(byEmail).includes('609'), 'a difference names the field, it never carries the value');
});

test('catalog: pushing is insert only. A linked service that differs is refused and reported, never updated', () => {
  const remote = [{ externalId: 'ITEM_1', name: 'Tax return', tiers: [{ externalId: 'VAR_1', name: 'Standard', priceCents: 15000 }] }, { externalId: 'ITEM_2', name: 'Bookkeeping', tiers: [] }];
  const local = [
    { id: 's1', name: 'Tax return', active: true, externalId: 'ITEM_1', tiers: [{ id: 't1', name: 'Standard', priceCents: 17500, externalId: 'VAR_1' }] },   // price changed locally
    { id: 's2', name: 'Notary', active: true, externalId: null, tiers: [{ id: 't2', name: 'Per signature', priceCents: 1500, externalId: null }] },             // new
    { id: 's3', name: 'bookkeeping', active: true, externalId: null, tiers: [{ id: 't3', name: 'Monthly', priceCents: 30000, externalId: null }] },             // same name exists at Square
    { id: 's4', name: 'Gone', active: true, externalId: 'ITEM_404', tiers: [] },                                                                                // linked, removed at Square
    { id: 's5', name: 'Retired', active: false, externalId: null, tiers: [{ id: 't5', name: 'x', priceCents: 100, externalId: null }] },                        // inactive: not pushed
  ];
  const plan = planSquarePush(local, remote, { tenantId: 'T', currency: 'USD' });
  assert.deepEqual(plan.refused, [
    { serviceId: 's1', reason: 'would_update', fields: ['price'] },
    { serviceId: 's3', reason: 'name_exists', fields: ['name'] },
    { serviceId: 's4', reason: 'remote_missing', fields: [] },
  ]);
  assert.equal(plan.create.length, 1); assert.equal(plan.create[0].serviceId, 's2');
  const obj = plan.create[0].object;
  assert.equal(obj.id, '#vx-item'); assert.deepEqual(obj.item_data.variations[0].item_variation_data.price_money, { amount: 1500, currency: 'USD' });
  assert.equal(plan.create[0].idempotencyKey, planSquarePush(local, remote, { tenantId: 'T', currency: 'USD' }).create[0].idempotencyKey, 'the same key every time');
  assert.doesNotThrow(() => assertInsertOnly(obj));
  // the guard on the request itself: a real id, a version or a delete mark never leaves
  assert.throws(() => assertInsertOnly({ ...obj, id: 'ITEM_1' }), (e) => e.code === 'update_refused');
  assert.throws(() => assertInsertOnly({ ...obj, version: 1712345 }), (e) => e.code === 'update_refused');
  assert.throws(() => assertInsertOnly({ ...obj, item_data: { ...obj.item_data, variations: [{ type: 'ITEM_VARIATION', id: 'VAR_1', item_variation_data: {} }] } }), (e) => e.code === 'update_refused');
  assert.throws(() => assertInsertOnly({ ...obj, is_deleted: true }), (e) => e.code === 'update_refused');
  assert.throws(() => assertInsertOnly({ type: 'ITEM', item_data: {} }), (e) => e.code === 'update_refused');
});

test('catalog: what Square has comes in as proposals, and a linked service that differs is only reported', () => {
  const item = slimSquareItem({ type: 'ITEM', id: 'ITEM_1', version: 9, item_data: { name: 'Tax return', variations: [{ type: 'ITEM_VARIATION', id: 'VAR_1', item_variation_data: { name: 'Standard', price_money: { amount: 15000, currency: 'USD' } } }] } });
  assert.deepEqual(item, { externalId: 'ITEM_1', name: 'Tax return', tiers: [{ externalId: 'VAR_1', name: 'Standard', priceCents: 15000 }] });
  assert.equal(slimSquareItem({ type: 'ITEM', id: 'X', is_deleted: true, item_data: {} }), null); assert.equal(slimSquareItem({ type: 'CATEGORY', id: 'X' }), null);
  const local = [{ id: 's1', name: 'Tax return', externalId: 'ITEM_1', tiers: [{ id: 't1', name: 'Standard', priceCents: 17500, externalId: 'VAR_1' }] }, { id: 's2', name: 'Payroll', externalId: null, tiers: [] }];
  const out = proposeFromRemote([item, { externalId: 'ITEM_2', name: 'payroll', tiers: [] }, { externalId: 'ITEM_3', name: 'Notary', tiers: [{ externalId: 'V3', name: 'Each', priceCents: 1500 }] }], local);
  assert.deepEqual(out[0], { externalId: 'ITEM_1', state: 'needs_review', rule: 'stored_id', localId: 's1', differences: ['price'] });
  assert.deepEqual(out[1], { externalId: 'ITEM_2', state: 'proposed', rule: 'name', localId: 's2', differences: [] });
  assert.deepEqual(out[2], { externalId: 'ITEM_3', state: 'unlinked', rule: 'none', localId: null, differences: [], proposal: { name: 'Notary', tiers: [{ name: 'Each', priceCents: 1500 }] } });
});

test('links: applying fills an empty slot and never replaces an id that is there', async () => {
  const fin = memoryFinance({ clients: [{ id: C1, email: 'one@example.com', externalIds: {} }, { id: C2, email: 'two@example.com', externalIds: { square: 'CUST_OLD' } }] });
  await fin.linkPut({ provider: 'square', kind: 'customer', externalId: 'CUST_1', localId: C1, state: 'proposed', rule: 'email', differences: ['name'] });
  await fin.linkPut({ provider: 'square', kind: 'customer', externalId: 'CUST_NEW', localId: C2, state: 'proposed', rule: 'email', differences: [] });
  assert.deepEqual(await fin.linksApply({ provider: 'square', kind: 'customer' }), { applied: 1 });
  assert.equal(fin.state.clients[0].externalIds.square, 'CUST_1');
  assert.equal(fin.state.clients[1].externalIds.square, 'CUST_OLD', 'not overwritten');
  assert.equal((await fin.linkByExternal('square', 'customer', 'CUST_1')).state, 'needs_review', 'linked, and the differing field is flagged');
  assert.equal((await fin.linkByExternal('square', 'customer', 'CUST_NEW')).state, 'needs_review');
  assert.deepEqual(await fin.linksApply({ provider: 'square', kind: 'customer' }), { applied: 0 }, 'a second apply does nothing');
});
