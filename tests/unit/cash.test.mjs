// Unit tests for petty cash: arithmetic in whole cents, the running balance, what the drawer should hold at the close,
// the lock on days that were counted, and who may approve a count. Run with `npm run test:unit` (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, blank } from './bundle.mjs';

const m = await load(`
  export { addCashEntry, updateCashEntry, deleteCashEntry, transferCash, approveCashClose } from '@/domain/actions';
  export { canApproveClose, cashCategories, saveCashCategories, DEFAULT_CASH_CATEGORIES } from '@/domain/actions/ops';
  export { cashExpected, cashBalance, cashLedger, cashLockedThrough, isCashLocked, cents, dollars, total } from '@/domain/selectors';
  export { PACKS } from '@/packs';
  export { makeT } from '@/i18n';
`);
const { addCashEntry, updateCashEntry, deleteCashEntry, transferCash, approveCashClose, canApproveClose, cashCategories, saveCashCategories, DEFAULT_CASH_CATEGORIES,
  cashExpected, cashBalance, cashLedger, cashLockedThrough, isCashLocked, cents, dollars, total, PACKS, makeT } = m;

const day = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const user = (id, role) => ({ id, name: 'Person ' + id, role, email: id + '@example.com', active: true });
function world() {
  const pack = PACKS.practice; const d = blank(pack);
  d.users = [user('u1', 'owner'), user('u2', 'manager'), user('u3', 'staff'), user('u5', 'readonly')];
  d.offices = [{ id: 'o1', name: 'North', address: '1 Sample Way' }, { id: 'o2', name: 'South', address: '2 Sample Way' }];
  const ctx = (actor = 'u3') => ({ pack, lang: 'en', t: makeT('en', pack), actor });
  return { d, ctx };
}
const entry = (o = {}) => ({ date: day(-2), officeId: 'o1', dir: 'in', amount: 10, category: 'supplies', memo: '', ...o });
/** What gateway().protected.cashClose does in a sample workspace, without the store: count, compare, lock. */
function close(d, date, officeId, counted, by = 'u3') {
  const expected = cashExpected(d, date, officeId);
  const c = { id: 'cc-' + date + (officeId ?? ''), date, officeId, expected, counted, diff: dollars(cents(counted) - cents(expected)), by, at: new Date().toISOString() };
  d.cashCloses.unshift(c);
  for (const e of d.cash) if (e.date <= date && !e.closeId && (e.officeId ?? '') === (officeId ?? '')) e.closeId = c.id;
  return c;
}

test('amounts are added in whole cents: ten dimes are one dollar, 0.1 + 0.2 is 0.30', () => {
  assert.equal(total(Array(10).fill({ a: 0.1 }), (x) => x.a), 1);
  assert.equal(total([{ a: 0.1 }, { a: 0.2 }], (x) => x.a), 0.3);
  assert.equal(cents(19.99), 1999);
  assert.equal(cents(1.005), 100, 'a half cent that floating point stores just below is not rounded up into a cent that was never there');
  assert.equal(dollars(cents(0.29) + cents(0.57)), 0.86);
});

test('the running balance follows every entry, in order', () => {
  const { d, ctx } = world();
  addCashEntry(d, ctx(), entry({ date: day(-3), amount: 200, category: 'change_fund' }));
  addCashEntry(d, ctx(), entry({ date: day(-2), dir: 'out', amount: 18.45 }));
  addCashEntry(d, ctx(), entry({ date: day(-2), dir: 'out', amount: 9.9 }));
  addCashEntry(d, ctx(), entry({ date: day(-1), amount: 0.1 }));
  addCashEntry(d, ctx(), entry({ date: day(-1), amount: 0.2 }));
  const lines = cashLedger(d, 'o1');
  assert.deepEqual(lines.map((l) => l.balance), [200, 181.55, 171.65, 171.75, 171.95]);
  assert.equal(cashBalance(d, 'o1'), 171.95);
  assert.equal(cashBalance(d, 'o2'), 0, 'the other office has its own drawer');
});

test('an entry needs a positive amount, a real date that is not in the future, and a category', () => {
  const { d, ctx } = world();
  assert.equal(addCashEntry(d, ctx(), entry({ amount: 0 })).ok, false);
  assert.equal(addCashEntry(d, ctx(), entry({ amount: -5 })).ok, false);
  assert.equal(addCashEntry(d, ctx(), entry({ amount: Number.NaN })).ok, false);
  assert.equal(addCashEntry(d, ctx(), entry({ date: day(1) })).reason, 'invalid');
  assert.equal(addCashEntry(d, ctx(), entry({ date: '2026-02-31' })).reason, 'invalid');
  assert.equal(addCashEntry(d, ctx(), entry({ category: '  ' })).reason, 'invalid');
  assert.equal(addCashEntry(d, ctx(), entry({ officeId: 'nope' })).reason, 'invalid');
  assert.equal(d.cash.length, 0);
  const ok = addCashEntry(d, ctx(), entry({ amount: 12.345 }));
  assert.equal(ok.ok, true); assert.equal(ok.value.amount, 12.35, 'stored to the cent'); assert.equal(ok.value.by, 'u3');
});

test('the close compares the count with the last count plus what moved since', () => {
  const { d, ctx } = world();
  addCashEntry(d, ctx(), entry({ date: day(-5), amount: 200 }));
  addCashEntry(d, ctx(), entry({ date: day(-5), dir: 'out', amount: 18.45 }));
  assert.equal(cashExpected(d, day(-5), 'o1'), 181.55);
  const c1 = close(d, day(-5), 'o1', 180.05);
  assert.equal(c1.diff, -1.5);
  // after a close the drawer holds what was counted, not what the entries added up to
  assert.equal(cashBalance(d, 'o1'), 180.05);
  addCashEntry(d, ctx(), entry({ date: day(-3), amount: 75 }));
  addCashEntry(d, ctx(), entry({ date: day(-2), dir: 'out', amount: 25.5 }));
  assert.equal(cashExpected(d, day(-2), 'o1'), 229.55, '180.05 counted + 75 - 25.50');
  assert.equal(cashExpected(d, day(-3), 'o1'), 255.05, 'a close on an earlier day leaves later entries out');
  const lines = cashLedger(d, 'o1');
  assert.deepEqual(lines.map((l) => [l.kind, l.balance]), [['entry', 200], ['entry', 181.55], ['close', 180.05], ['entry', 255.05], ['entry', 229.55]]);
});

test('a closed day is locked: nothing is added to it, changed in it or removed from it', () => {
  const { d, ctx } = world();
  const a = addCashEntry(d, ctx(), entry({ date: day(-4), amount: 50 })).value;
  close(d, day(-3), 'o1', 50);
  assert.equal(cashLockedThrough(d, 'o1'), day(-3));
  assert.equal(isCashLocked(d, a), true);
  assert.equal(addCashEntry(d, ctx(), entry({ date: day(-4) })).reason, 'locked', 'not on a day before the close');
  assert.equal(addCashEntry(d, ctx(), entry({ date: day(-3) })).reason, 'locked', 'not on the closed day itself');
  assert.equal(updateCashEntry(d, ctx(), a.id, { amount: 5 }).reason, 'locked');
  assert.equal(deleteCashEntry(d, ctx(), a.id).reason, 'locked');
  assert.equal(d.cash.find((e) => e.id === a.id).amount, 50);
  // the day after is open, and so is the other office's drawer
  const b = addCashEntry(d, ctx(), entry({ date: day(-2), amount: 5 }));
  assert.equal(b.ok, true);
  assert.equal(addCashEntry(d, ctx(), entry({ date: day(-4), officeId: 'o2' })).ok, true);
  // an open entry cannot be moved into the locked days
  assert.equal(updateCashEntry(d, ctx(), b.value.id, { date: day(-3) }).reason, 'locked');
  assert.equal(updateCashEntry(d, ctx(), b.value.id, { amount: 7.5, memo: ' corrected ' }).ok, true);
  assert.equal(d.cash.find((e) => e.id === b.value.id).memo, 'corrected');
  assert.equal(deleteCashEntry(d, ctx(), b.value.id).ok, true);
});

test('a count is approved by the owner or a manager, never by whoever counted it', () => {
  const { d, ctx } = world();
  addCashEntry(d, ctx(), entry({ date: day(-2), amount: 40 }));
  const byStaff = close(d, day(-2), 'o1', 40, 'u3');
  assert.equal(canApproveClose(d, 'u3', byStaff), false, 'staff does not approve');
  assert.equal(canApproveClose(d, 'u5', byStaff), false, 'read only does not approve');
  assert.equal(approveCashClose(d, ctx('u3'), byStaff.id).reason, 'needs_other_person');
  assert.equal(approveCashClose(d, ctx('u5'), byStaff.id).reason, 'not_allowed');
  assert.equal(approveCashClose(d, ctx('u2'), byStaff.id).ok, true);
  assert.equal(d.cashCloses[0].approvedBy, 'u2');
  assert.equal(approveCashClose(d, ctx('u1'), byStaff.id).reason, 'invalid', 'approved once');
  // a manager who counted the drawer needs the other senior person
  addCashEntry(d, ctx(), entry({ date: day(-1), amount: 1 }));
  const byManager = close(d, day(-1), 'o1', 41, 'u2');
  assert.equal(approveCashClose(d, ctx('u2'), byManager.id).reason, 'needs_other_person');
  assert.equal(approveCashClose(d, ctx('u1'), byManager.id).ok, true);
  // a firm with one senior person has nobody else to ask
  const solo = { users: [user('u1', 'owner'), user('u3', 'staff')] };
  assert.equal(canApproveClose(solo, 'u1', { id: 'x', by: 'u1' }), true);
});

test('moving cash between offices is one entry out and one entry in', () => {
  const { d, ctx } = world();
  addCashEntry(d, ctx(), entry({ date: day(-1), amount: 100 }));
  const out = transferCash(d, ctx('u1'), { date: day(0), from: 'o1', to: 'o2', amount: 30.25 });
  assert.equal(out.ok, true);
  assert.equal(cashBalance(d, 'o1'), 69.75); assert.equal(cashBalance(d, 'o2'), 30.25);
  assert.equal(transferCash(d, ctx('u1'), { date: day(0), from: 'o1', to: 'o1', amount: 5 }).reason, 'invalid');
  close(d, day(0), 'o2', 30.25);
  assert.equal(transferCash(d, ctx('u1'), { date: day(0), from: 'o1', to: 'o2', amount: 5 }).reason, 'locked', 'the receiving drawer is closed for today');
  assert.equal(cashBalance(d, 'o1'), 69.75, 'nothing left the first drawer');
});

test('the list of categories belongs to the company and falls back to the starting list', () => {
  const { d } = world();
  assert.deepEqual(cashCategories(d), DEFAULT_CASH_CATEGORIES);
  saveCashCategories(d, [' Supplies ', 'Courier', 'Courier', '']);
  assert.deepEqual(cashCategories(d), ['Supplies', 'Courier']);
  saveCashCategories(d, []);
  assert.deepEqual(cashCategories(d), DEFAULT_CASH_CATEGORIES);
});

test('the sample business closes one day and its figures add up', async () => {
  const s = await load(`export { seed } from '@/packs/practice/seed';`);
  for (const lang of ['en', 'es']) {
    const data = { ...blank(PACKS.practice), ...s.seed(lang) };
    assert.equal(data.cashCloses.length, 1);
    const c = data.cashCloses[0];
    const closed = data.cash.filter((e) => e.closeId === c.id);
    assert.ok(closed.length > 0 && closed.every((e) => e.officeId === c.officeId && e.date <= c.date));
    const sum = closed.reduce((a, e) => a + cents(e.amount) * (e.dir === 'in' ? 1 : -1), 0);
    assert.equal(cents(c.expected), sum, 'expected is what the closed entries add up to');
    assert.equal(cents(c.diff), cents(c.counted) - cents(c.expected));
    assert.ok(data.cash.some((e) => !e.closeId && e.officeId === c.officeId), 'entries after the close are still open');
    assert.ok(c.approvedBy && c.approvedBy !== c.by);
  }
});
