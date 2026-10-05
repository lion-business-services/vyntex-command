// Unit tests for the practice operations: deadlines that roll forward, client requests, comments and mentions,
// the notices each person gets, balances and their age, and the client links. Run with `npm run test:unit`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, blank } from './bundle.mjs';

const m = await load(`
  export { createClientRequest, addTaskComment, editTaskComment, deleteTaskComment, reassignTasks, createTask, saveDeadline, completeDeadline, setDeadlineStatus, importDeadlines } from '@/domain/actions';
  export { mentionsIn } from '@/domain/actions/tasks';
  export { nextDue, safeUrl, quickLinksOf, saveQuickLink, removeQuickLink, lineSettings, saveLineSettings } from '@/domain/actions/ops';
  export { notices, deadlineState, openBalances, agingTotals, agingBucket, appointmentMoney, isOverdue, requestAge } from '@/domain/selectors';
  export { glance } from '@/features/dashboard/glance';
  export { buildPracticeReport, PRACTICE_TABS, PRACTICE_VIEWS } from '@/features/reports/practice';
  export { PACKS } from '@/packs';
  export { makeT } from '@/i18n';
  export { seed } from '@/packs/practice/seed';
`);
const { createClientRequest, addTaskComment, editTaskComment, deleteTaskComment, reassignTasks, createTask, saveDeadline, completeDeadline, setDeadlineStatus, importDeadlines, mentionsIn,
  nextDue, safeUrl, quickLinksOf, saveQuickLink, removeQuickLink, lineSettings, saveLineSettings, notices, deadlineState, openBalances, agingTotals, agingBucket, appointmentMoney, isOverdue, requestAge,
  glance, buildPracticeReport, PRACTICE_TABS, PRACTICE_VIEWS, PACKS, makeT, seed } = m;

const day = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const user = (id, name, role, more = {}) => ({ id, name, role, email: id + '@example.com', active: true, ...more });
const client = (id, o = {}) => ({ id, name: 'Client ' + id, phone: '', email: '', addresses: [], since: '2025-01-01', notes: [], ...o });
const job = (id, clientId, o = {}) => ({ id, number: 'J-' + id, name: 'Engagement ' + id, clientId, address: '', type: 'tax', status: 'progress', price: 0, start: day(-10), end: '', scope: '', payTerms: '', managerId: 'u2', assign: [], expenses: [], received: [], log: [], notes: [], created: day(-12), ...o });
function world() {
  const pack = PACKS.practice; const d = blank(pack);
  d.users = [user('u1', 'Marisol Vega', 'owner'), user('u2', 'Daniel Okafor', 'manager'), user('u3', 'Ana Lucía Paredes', 'staff'), user('u4', 'Daniel Reyes', 'staff'), user('u5', 'Tomás Rivera', 'readonly')];
  d.clients = [client('c1', { assignedTo: 'u3' }), client('c2')];
  const ctx = (actor = 'u2') => ({ pack, lang: 'en', t: makeT('en', pack), actor });
  return { d, ctx, pack };
}
const ALL = PACKS.practice.rolePermissions.owner, MANAGER = PACKS.practice.rolePermissions.manager, STAFF = PACKS.practice.rolePermissions.staff;
const kinds = (list) => list.map((n) => n.kind);

/* ---------- deadlines ---------- */
test('the next date of a repeating deadline follows the calendar', () => {
  assert.equal(nextDue('2026-01-15', 'monthly'), '2026-02-15');
  assert.equal(nextDue('2026-01-31', 'monthly'), '2026-02-28', 'a short month ends the series on its last day');
  assert.equal(nextDue('2026-02-28', 'monthly', 31), '2026-03-31', 'and the 31st comes back after it');
  assert.equal(nextDue('2028-02-29', 'yearly'), '2029-02-28');
  assert.equal(nextDue('2026-11-30', 'quarterly'), '2027-02-28');
  assert.equal(nextDue('2026-03-03', 'weekly'), '2026-03-10');
  assert.equal(nextDue('2026-03-03', 'biweekly'), '2026-03-17');
  assert.equal(nextDue('2026-12-15', 'monthly'), '2027-01-15');
});

test('completing a repeating deadline keeps it as done and opens the next one', () => {
  const { d, ctx } = world();
  const a = saveDeadline(d, ctx(), { title: 'Quarterly filing (sample)', kind: 'filing', due: '2026-01-31', repeat: 'monthly', clientId: 'c1', assignee: 'u3', remind: [7, 30, 7, 999] });
  assert.deepEqual(a.remind, [30, 7], 'reminders are distinct, within a year, furthest first');
  const next = completeDeadline(d, ctx(), a.id);
  assert.equal(d.complianceItems.length, 2);
  assert.equal(a.status, 'done'); assert.ok(a.doneAt);
  assert.equal(next.status, 'open'); assert.equal(next.due, '2026-02-28'); assert.equal(next.clientId, 'c1'); assert.equal(next.doneAt, undefined);
  const third = completeDeadline(d, ctx(), next.id);
  assert.equal(third.due, '2026-03-31', 'the series remembers it started on the 31st');
  assert.equal(completeDeadline(d, ctx(), a.id), null, 'done once');
  const once = saveDeadline(d, ctx(), { title: 'One time (sample)', kind: 'other', due: day(3) });
  assert.equal(completeDeadline(d, ctx(), once.id), null, 'an item that does not repeat adds nothing');
  assert.equal(d.complianceItems.length, 4);
});

test('a deadline needs a title, a real date and a known kind; an unknown client is refused', () => {
  const { d, ctx } = world();
  assert.equal(saveDeadline(d, ctx(), { title: ' ', kind: 'filing', due: day(1) }), null);
  assert.equal(saveDeadline(d, ctx(), { title: 'x', kind: 'filing', due: '2026-13-01' }), null);
  assert.equal(saveDeadline(d, ctx(), { title: 'x', kind: 'tax_table', due: day(1) }), null);
  assert.equal(saveDeadline(d, ctx(), { title: 'x', kind: 'filing', due: day(1), clientId: 'nobody' }), null);
  assert.equal(d.complianceItems.length, 0);
  const n = importDeadlines(d, ctx(), [{ title: 'A (sample)', kind: 'license', due: day(10), clientId: 'c2' }, { title: '', kind: 'license', due: day(10) }, { title: 'B (sample)', kind: 'renewal', due: 'soon' }]);
  assert.equal(n, 1); assert.equal(d.complianceItems[0].title, 'A (sample)');
});

test('a deadline is overdue, due soon inside its reminder window, or upcoming', () => {
  const it = (o) => ({ id: 'x', title: 't', kind: 'filing', status: 'open', due: day(0), ...o });
  assert.equal(deadlineState(it({ due: day(-1) })), 'overdue');
  assert.equal(deadlineState(it({ due: day(0) })), 'soon');
  assert.equal(deadlineState(it({ due: day(7) })), 'soon');
  assert.equal(deadlineState(it({ due: day(8) })), 'upcoming');
  assert.equal(deadlineState(it({ due: day(20), remind: [30] })), 'soon', 'its own reminder widens the window');
  assert.equal(deadlineState(it({ due: day(-9), status: 'done' })), 'done');
  const { d, ctx } = world();
  const a = saveDeadline(d, ctx(), { title: 'x', kind: 'filing', due: day(-2) });
  setDeadlineStatus(d, ctx(), a.id, 'waived'); assert.equal(deadlineState(a), 'waived');
  setDeadlineStatus(d, ctx(), a.id, 'open'); assert.equal(deadlineState(a), 'overdue');
});

/* ---------- client requests, comments, mentions ---------- */
test('a client request records who asked and how, and goes to whoever looks after the client', () => {
  const { d, ctx } = world();
  const r = createClientRequest(d, ctx('u2'), { title: ' Copy of the return ', clientId: 'c1', requestedBy: '', channel: 'whatsapp', due: day(1) });
  assert.equal(r.type, 'client_request'); assert.equal(r.title, 'Copy of the return'); assert.equal(r.requestedBy, 'Client c1'); assert.equal(r.channel, 'whatsapp');
  assert.equal(r.assignee, 'u:u3', 'the person assigned to the client');
  const r2 = createClientRequest(d, ctx('u2'), { title: 'A letter', clientId: 'c2', requestedBy: 'Their office manager', channel: 'call' });
  assert.equal(r2.assignee, 'u:u2', 'nobody looks after this client: the person who recorded it');
  assert.equal(createClientRequest(d, ctx(), { title: 'x', clientId: 'nobody', requestedBy: '', channel: 'call' }), null);
  assert.equal(createClientRequest(d, ctx(), { title: '  ', clientId: 'c1', requestedBy: '', channel: 'call' }), null);
  assert.equal(d.tasks.length, 2);
  assert.equal(d.activity[0].ref.type, 'client');
  assert.equal(requestAge({ ...r, created: day(-4) }), 4);
  assert.equal(requestAge({ ...r, created: day(-9), status: 'done', doneAt: day(-6) }), 3, 'an answered request took the days until it was completed');
});

test('a mention needs a name that points at one person', () => {
  const { d } = world();
  assert.deepEqual(mentionsIn(d.users, 'ask @Marisol Vega to sign'), ['u1']);
  assert.deepEqual(mentionsIn(d.users, '@marisol can you look?'), ['u1'], 'a first name is enough when only one person has it');
  assert.deepEqual(mentionsIn(d.users, '@Daniel please check'), [], 'two people are called Daniel: the first name alone tells nobody');
  assert.deepEqual(mentionsIn(d.users, '@Daniel Okafor please check'), ['u2']);
  assert.deepEqual(mentionsIn(d.users, 'gracias @ana lucia paredes y @Tomás'), ['u3', 'u5'], 'accents and capitals do not matter');
  assert.deepEqual(mentionsIn(d.users, 'write to marisol@example.com'), [], 'an email address is not a mention');
  assert.deepEqual(mentionsIn(d.users, '@Marisolita'), []);
});

test('a comment that mentions someone reaches that person, and only an author changes their words', () => {
  const { d, ctx } = world();
  const t = createTask(d, ctx('u2'), { title: 'Review the draft', assignee: 'u:u3', pri: 'medium', clientId: 'c1' });
  const c = addTaskComment(d, ctx('u2'), t.id, ' @Marisol Vega it needs your signature ');
  assert.deepEqual(c.mentions, ['u1']); assert.equal(c.by, 'u2'); assert.equal(c.text, '@Marisol Vega it needs your signature');
  assert.equal(addTaskComment(d, ctx('u2'), t.id, '   '), null);
  const mine = (id, perms) => notices(d, { compliance: false, viewer: { id, perms } }).filter((n) => n.kind === 'mention');
  assert.equal(mine('u1', ALL).length, 1, 'the person mentioned');
  assert.equal(mine('u1', ALL)[0].ref.id, t.id);
  assert.equal(mine('u3', STAFF).length, 0, 'not the assignee');
  assert.equal(mine('u2', MANAGER).length, 0, 'not the author');
  assert.equal(notices(d, { compliance: false }).filter((n) => n.kind === 'mention').length, 0, 'nobody in particular looking: no personal notices');
  assert.equal(editTaskComment(d, ctx('u1'), t.id, c.id, 'changed'), false, 'someone else cannot change it');
  assert.equal(editTaskComment(d, ctx('u2'), t.id, c.id, 'never mind'), true);
  assert.equal(mine('u1', ALL).length, 0, 'the mention went away with the edit');
  assert.equal(deleteTaskComment(d, ctx('u3'), t.id, c.id), false, 'staff cannot remove a colleague\'s comment');
  assert.equal(deleteTaskComment(d, ctx('u1'), t.id, c.id), true, 'the owner can');
  assert.equal(t.comments.length, 0);
});

test('several open tasks are handed to one person at once', () => {
  const { d, ctx } = world();
  const a = createTask(d, ctx(), { title: 'A', assignee: 'u:u3', pri: 'medium' });
  const b = createTask(d, ctx(), { title: 'B', assignee: 'u:u4', pri: 'medium' });
  const c = createTask(d, ctx(), { title: 'C', assignee: 'u:u3', pri: 'medium', status: 'done' });
  assert.equal(reassignTasks(d, ctx('u2'), [a.id, b.id, c.id], 'u:u4'), 1, 'B already had it, C is done');
  assert.equal(a.assignee, 'u:u4'); assert.equal(c.assignee, 'u:u3');
  assert.equal(reassignTasks(d, ctx('u2'), [a.id], 'u:nobody'), 0);
});

/* ---------- notices by person ---------- */
test('each person gets the notices they can act on', () => {
  const { d, ctx } = world();
  createClientRequest(d, ctx('u2'), { title: 'Copy of the return', clientId: 'c1', requestedBy: '', channel: 'call', due: day(3) });
  d.reveals = [{ id: 'r1', clientId: 'c1', field: 'tax_id', requestedBy: 'u3', reason: 'filing', at: new Date().toISOString(), status: 'pending' }, { id: 'r2', clientId: 'c2', field: 'tax_id', requestedBy: 'u2', reason: 'filing', at: new Date().toISOString(), status: 'pending' }];
  d.accessRequests = [{ id: 'a1', userId: 'u3', clientId: 'c2', reason: 'covering', at: new Date().toISOString(), status: 'pending' }];
  d.appointments = [{ id: 'p1', typeId: 't', clientId: 'c1', staffId: 'u3', date: day(1), time: '10:00', minutes: 30, mode: 'office', status: 'awaiting_payment', fee: 75, payBy: new Date(Date.now() + 3 * 3600000).toISOString(), created: new Date().toISOString(), createdBy: 'u3' },
    { id: 'p2', typeId: 't', clientId: 'c1', staffId: 'u3', date: day(9), time: '10:00', minutes: 30, mode: 'office', status: 'awaiting_payment', fee: 75, payBy: new Date(Date.now() + 8 * 86400000).toISOString(), created: new Date().toISOString(), createdBy: 'u3' }];
  d.envelopes = [{ id: 'e1', docId: 'x', title: 'Letter', status: 'completed', ordered: false, signers: [], fields: [], created: new Date().toISOString(), createdBy: 'u3', completedAt: new Date().toISOString(), events: [] },
    { id: 'e2', docId: 'y', title: 'Consent', status: 'declined', ordered: false, signers: [], fields: [], created: new Date().toISOString(), createdBy: 'u4', events: [{ at: new Date().toISOString(), kind: 'declined' }] }];
  d.automation.runs = [{ id: 'run1', at: new Date().toISOString(), ruleId: 'x', steps: [], status: 'failed', error: 'no template' }, { id: 'run2', at: new Date().toISOString(), ruleId: 'x', steps: [] }];
  saveDeadline(d, ctx(), { title: 'License renewal (sample)', kind: 'license', due: day(-1), assignee: 'u3' });
  saveDeadline(d, ctx(), { title: 'Annual report (sample)', kind: 'filing', due: day(3) });
  const of = (id, perms) => kinds(notices(d, { compliance: false, viewer: { id, perms } }));

  const staff = of('u3', STAFF);
  assert.ok(staff.includes('requestMine'), 'the request assigned to her');
  assert.equal(staff.filter((k) => k === 'apptUnpaid').length, 1, 'her appointment that is due for payment within a day, not the one next week');
  assert.ok(staff.includes('envelopeDone'), 'the signature request she sent');
  assert.ok(!staff.includes('envelopeDeclined'), 'not a colleague\'s');
  assert.ok(staff.includes('deadlineOverdue'), 'her own deadline');
  assert.ok(!staff.includes('deadlineSoon'), 'an unassigned deadline is for people who oversee the firm');
  assert.ok(!staff.includes('revealPending') && !staff.includes('accessPending') && !staff.includes('autoFailed'), 'no approvals and no automation failures for staff');

  const manager = of('u2', MANAGER);
  assert.equal(manager.filter((k) => k === 'revealPending').length, 1, 'the request of someone else, never their own (two-person rule)');
  assert.ok(manager.includes('autoFailed') && manager.includes('envelopeDeclined') && manager.includes('deadlineSoon'));
  assert.ok(!manager.includes('accessPending'), 'access to other offices is decided by people who see all clients');
  assert.ok(!manager.includes('requestMine'));

  const owner = of('u1', ALL);
  assert.equal(owner.filter((k) => k === 'revealPending').length, 2);
  assert.ok(owner.includes('accessPending'));
  const money = notices(d, { compliance: false, viewer: { id: 'u1', perms: ALL } }).find((n) => n.kind === 'apptUnpaid');
  assert.equal(money.amount, 75);
  assert.equal(notices(d, { compliance: false, viewer: { id: 'u3', perms: STAFF.filter((p) => p !== 'money') } }).find((n) => n.kind === 'apptUnpaid').amount, undefined, 'no amount for someone who may not see money');
  // every notice has its own id, so "read" is tracked one by one
  const ids = notices(d, { compliance: false, viewer: { id: 'u1', perms: ALL } }).map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length);
});

/* ---------- balances ---------- */
test('open balances are exact to the cent and sorted into age buckets', () => {
  const { d } = world();
  d.jobs = [
    job('j1', 'c1', { price: 100.1, received: [{ id: 'p1', date: day(-5), method: 'cash', ref: '', amount: 33.4 }, { id: 'p2', date: day(-2), method: 'cash', ref: '', amount: 33.3 }], start: day(-45) }),
    job('j2', 'c1', { price: 50, start: day(-100), status: 'done', end: day(-95) }),
    job('j3', 'c2', { price: 80, received: [{ id: 'p3', date: day(-1), method: 'check', ref: '1', amount: 80 }] }),
    job('j4', 'c2', { price: 500, status: 'estimate' }),
    job('j5', 'c2', { price: 20, start: day(-70) }),
  ];
  d.docs = [{ id: 'd1', kind: 'invoice', number: 'I-1', title: '', jobId: 'j2', clientId: 'c1', status: 'sent', created: day(-20), updated: day(-20) }];
  const open = openBalances(d);
  assert.deepEqual(open.map((b) => [b.job.id, b.balance, b.bucket]), [['j2', 50, 'd0'], ['j1', 33.4, 'd31'], ['j5', 20, 'd61']], 'paid in full and proposals are left out; the invoice date sets the age');
  const a = agingTotals(open);
  assert.deepEqual([a.d0.amount, a.d31.amount, a.d61.amount, a.d91.amount], [50, 33.4, 20, 0]);
  assert.deepEqual([0, 30, 31, 60, 61, 90, 91].map(agingBucket), ['d0', 'd0', 'd31', 'd31', 'd61', 'd61', 'd91']);
});

test('appointment money separates fees received, fees covered by a credit and fees still waiting', () => {
  const { d } = world();
  const ap = (id, o) => ({ id, typeId: 't', clientId: 'c1', staffId: 'u3', date: day(-1), time: '10:00', minutes: 30, mode: 'office', status: 'completed', fee: 75, created: '', createdBy: 'u3', ...o });
  d.appointments = [ap('a1', { paid: { at: new Date().toISOString(), method: 'cash', ref: '', amount: 75 } }), ap('a2', { paid: { at: new Date().toISOString(), method: 'credit', ref: 'cr1', amount: 75 } }), ap('a3', { status: 'awaiting_payment', fee: 40.5 }), ap('a4', { status: 'cancelled_unpaid' })];
  d.credits = [{ id: 'cr1', clientId: 'c1', amount: 75, reason: 'cancel_staff', at: '', by: 'u3', used: { apptId: 'a2', at: '' } }, { id: 'cr2', clientId: 'c1', amount: 30, reason: 'goodwill', at: '', by: 'u1' }, { id: 'cr3', clientId: 'c1', amount: 10, reason: 'goodwill', at: '', by: 'u1', expires: day(-1) }];
  const am = appointmentMoney(d);
  assert.deepEqual([am.feesReceived, am.creditsApplied, am.unpaidFees, am.creditsOpen], [75, 75, 40.5, 30]);
});

/* ---------- client links and module settings ---------- */
test('a link address must be a web address, and a shipped link without one stays empty', () => {
  assert.equal(safeUrl('https://example.com/pay'), 'https://example.com/pay');
  assert.equal(safeUrl('example.com/pay'), 'https://example.com/pay');
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('mailto:a@example.com'), '');
  assert.equal(safeUrl('not a link'), '');
  assert.equal(safeUrl(''), '');
  const shipped = [{ id: 'bookkeeping', label: { en: 'Bookkeeping client link', es: 'Enlace' }, url: '' }, { id: 'payroll', label: { en: 'Payroll client link', es: 'Enlace' }, url: 'https://payroll.example.com/' }];
  const { d } = world();
  assert.deepEqual(quickLinksOf(d, shipped).map((l) => [l.id, l.url, l.fixed]), [['bookkeeping', '', true], ['payroll', 'https://payroll.example.com/', true]], 'nothing is made up for the empty one');
  assert.equal(saveQuickLink(d, { id: 'bookkeeping', url: 'javascript:alert(1)' }), false);
  assert.equal(saveQuickLink(d, { id: 'bookkeeping', url: 'books.example.com/portal' }), true);
  assert.equal(saveQuickLink(d, { label: 'Document upload', url: 'https://upload.example.com' }), true);
  assert.equal(saveQuickLink(d, { label: '', url: 'https://upload.example.com' }), false, 'a link of the company needs a name');
  const all = quickLinksOf(d, shipped);
  assert.deepEqual(all.map((l) => l.url), ['https://books.example.com/portal', 'https://payroll.example.com/', 'https://upload.example.com/']);
  assert.equal(all[0].label.en, 'Bookkeeping client link', 'a shipped link keeps its name');
  removeQuickLink(d, all[2].id);
  assert.equal(quickLinksOf(d, shipped).length, 2);
  saveLineSettings(d, 'payroll', { category: 'payroll', staffUrl: 'javascript:void(0)' });
  assert.deepEqual(lineSettings(d, 'payroll'), { category: 'payroll', staffUrl: undefined });
  saveLineSettings(d, 'payroll', { staffUrl: 'https://staff.example.com' });
  assert.deepEqual(lineSettings(d, 'payroll'), { category: 'payroll', staffUrl: 'https://staff.example.com/' });
});

/* ---------- the sample business, the home screen and the reports ---------- */
test('the sample business has every task type, requests, mentions, and deadlines marked as samples', () => {
  for (const lang of ['en', 'es']) {
    const s = seed(lang);
    const types = new Set(s.tasks.map((t) => t.type));
    for (const ty of PACKS.practice.taskTypes) assert.ok(types.has(ty.id), `a task of type ${ty.id} (${lang})`);
    const reqs = s.tasks.filter((t) => t.type === 'client_request');
    assert.ok(reqs.length >= 4 && reqs.every((r) => r.requestedBy && r.channel && r.clientId));
    assert.ok(reqs.some((r) => r.status === 'done' && r.doneAt) && reqs.some((r) => r.status !== 'done'));
    const users = new Set(s.users.map((u) => u.id)); const clients = new Set(s.clients.map((c) => c.id));
    const comments = s.tasks.flatMap((t) => t.comments ?? []);
    assert.ok(comments.some((c) => c.mentions?.length));
    for (const c of comments) { assert.ok(users.has(c.by)); for (const id of c.mentions ?? []) assert.ok(users.has(id)); assert.deepEqual(mentionsIn(s.users, c.text), c.mentions ?? [], 'the mention list matches what the text says'); }
    assert.ok(s.complianceItems.length >= 6);
    for (const i of s.complianceItems) {
      assert.match(i.title, lang === 'es' ? /\(muestra\)$/ : /\(sample\)$/, 'every sample deadline says it is a sample');
      assert.ok(!i.clientId || clients.has(i.clientId)); assert.ok(!i.assignee || users.has(i.assignee));
      assert.doesNotMatch(`${i.title} ${i.authority ?? ''} ${i.note ?? ''}`, /\b(IRS|1040|941|940|1099|W-2|Form \d|Division of Taxation|April 15|15 de abril)\b/i, 'no real form, agency or date');
    }
    for (const e of s.cash) { assert.ok(users.has(e.by)); assert.ok(e.amount > 0); }
  }
});

test('every count of the home screen is the length of the list behind it, for every role', () => {
  const pack = PACKS.practice; const t = makeT('en', pack);
  const d = { ...blank(pack), ...seed('en') };
  for (const u of d.users.filter((x) => x.active !== false)) {
    const perms = pack.rolePermissions[u.role];
    for (const scope of ['mine', 'firm']) {
      const tiles = glance({ data: d, pack, t, lang: 'en', can: (p) => perms.includes(p), perms, user: u, scope, date: (x) => x ?? '', time: (x) => x ?? '' });
      assert.ok(tiles.length >= 6, `${u.role} sees the tiles`);
      for (const tile of tiles) { assert.equal(tile.count, tile.rows.length, `${tile.id} for ${u.name} (${scope})`); assert.ok(tile.rows.every((r) => r.to.startsWith('/') && r.title)); }
    }
  }
  const tiles = glance({ data: d, pack, t, lang: 'en', can: () => true, perms: pack.rolePermissions.owner, user: d.users[0], scope: 'firm', date: (x) => x ?? '', time: (x) => x ?? '' });
  const requests = tiles.find((x) => x.id === 'requests');
  assert.equal(requests.count, d.tasks.filter((x) => x.type === 'client_request' && x.status !== 'done').length);
  const tasks = tiles.find((x) => x.id === 'tasks');
  assert.equal(tasks.count, d.tasks.filter((x) => x.status !== 'done' && x.due && x.due <= day(0)).length);
  assert.equal(tiles.find((x) => x.id === 'balances').amount, openBalances(d).reduce((a, b) => a + Math.round(b.balance * 100), 0) / 100);
});

test('every practice report builds from the sample, and from nothing, without inventing a figure', () => {
  const pack = PACKS.practice; const t = makeT('en', pack);
  const full = { ...blank(pack), ...seed('en') }; const empty = blank(pack);
  for (const tab of PRACTICE_TABS) for (const view of PRACTICE_VIEWS[tab]) {
    for (const period of ['all', 'month']) {
      const r = buildPracticeReport(tab, view, { data: full, t, lang: 'en', pack, period });
      assert.ok(r.title && !/^reports\./.test(r.title), `${tab}/${view} has a title`);
      for (const f of r.figures) assert.ok(!/^reports\./.test(f.label) && !/NaN|undefined|Infinity/.test(f.value + (f.hint ?? '')), `${tab}/${view}: ${f.label} = ${f.value}`);
      for (const row of r.rows) for (const c of r.cols) assert.ok(c.key in row.cells, `${tab}/${view}: column ${c.key}`);
      for (const row of r.rows) for (const v of Object.values(row.cells)) assert.ok(!(typeof v === 'number' && !Number.isFinite(v)));
    }
    const none = buildPracticeReport(tab, view, { data: empty, t, lang: 'en', pack, period: 'all' });
    assert.equal(none.rows.length, 0, `${tab}/${view}: no records, no rows`);
  }
  // revenue by month adds up to the payments recorded
  const rev = buildPracticeReport('money', 'month', { data: full, t, lang: 'en', pack, period: 'all' });
  const paid = full.jobs.flatMap((j) => j.received).reduce((a, r) => a + Math.round(r.amount * 100), 0) + (full.appointments ?? []).filter((a) => a.paid && a.paid.method !== 'credit').reduce((a, x) => a + Math.round(x.paid.amount * 100), 0);
  assert.equal(Math.round(rev.total.amount * 100), paid);
  assert.equal(Math.round(rev.rows.reduce((a, r) => a + r.cells.amount, 0) * 100), paid);
  for (const view of ['service', 'category', 'person']) assert.equal(Math.round(buildPracticeReport('money', view, { data: full, t, lang: 'en', pack, period: 'all' }).rows.reduce((a, r) => a + r.cells.amount, 0) * 100), paid, `revenue by ${view} adds up to the same total`);
  const aging = buildPracticeReport('money', 'aging', { data: full, t, lang: 'en', pack, period: 'all' });
  assert.equal(Math.round(aging.total.amount * 100), Math.round(openBalances(full).reduce((a, b) => a + b.balance * 100, 0)));
  // an average rating exists only when someone rated
  const noRatings = { ...full, reviews: [{ id: 'r1', clientId: full.clients[0].id, at: new Date().toISOString(), channel: 'email', status: 'demo', by: 'u1' }] };
  const rv = buildPracticeReport('growth', 'reviews', { data: noRatings, t, lang: 'en', pack, period: 'all' });
  assert.equal(rv.figures[2].value, t('reports.na'));
});
