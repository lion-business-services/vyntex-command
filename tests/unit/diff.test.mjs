// Unit tests for src/platform/diff.ts: the list of operations that turns one copy of a workspace into another, in the
// shapes the database gateway takes (docs/DATABASE.md, section 7), and the reverse (applying operations to a copy).
// Run with `npm run test:unit` (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, blank } from './bundle.mjs';

const { diffState, applyOps, COLLECTIONS, SINGLES, READ_ONLY, APPEND_ONLY, APPLY_ORDER, PACKS } = await load(
  `export { diffState, applyOps, COLLECTIONS, SINGLES, READ_ONLY, APPEND_ONLY, APPLY_ORDER } from '@/platform/diff'; export { PACKS } from '@/packs';`);
const copy = (v) => JSON.parse(JSON.stringify(v));
const base = () => { const d = blank(PACKS.practice); d.clients = [{ id: 'c1', name: 'A', notes: [] }, { id: 'c2', name: 'B', notes: [] }]; d.leads = [{ id: 'l1', name: 'L', status: 'new' }]; return d; };
const names = (ops) => ops.map((o) => `${o.c}:${o.op}:${o.id}`);
const sorted = (d) => { const out = copy(d); for (const c of COLLECTIONS) out[c].sort((a, b) => a.id.localeCompare(b.id)); out.automation.runs.sort((a, b) => a.id.localeCompare(b.id)); return out; };

test('nothing changed: no operations, even when every row was rebuilt', () => {
  const a = base();
  assert.deepEqual(diffState(a, a), []);
  assert.deepEqual(diffState(a, copy(a)), [], 'rows are compared by value, not by identity');
});

test('a new row and a changed row are upserts, a missing row is a delete; deletes come last', () => {
  const a = base(); const b = copy(a);
  b.clients[0].name = 'A changed';
  b.clients.push({ id: 'c3', name: 'C', notes: [] });
  b.clients = b.clients.filter((c) => c.id !== 'c2');
  b.leads = [];
  const ops = diffState(a, b);
  assert.deepEqual(names(ops), ['clients:upsert:c1', 'clients:upsert:c3', 'leads:delete:l1', 'clients:delete:c2'], 'every write first, then removals in the opposite order');
  assert.equal(ops[0].row.name, 'A changed');
  assert.equal('row' in ops[3], false, 'a delete carries the id only');
});

test('an operation carries its own copy of the row: later changes on screen do not alter what was sent', () => {
  const a = base(); const b = copy(a);
  b.clients[0].name = 'Sent';
  const ops = diffState(a, b);
  b.clients[0].name = 'Typed afterwards'; b.clients[0].notes.push({ id: 'n9' });
  assert.equal(ops[0].row.name, 'Sent');
  assert.deepEqual(ops[0].row.notes, []);
});

test('a change deep inside a row is seen', () => {
  const a = base(); const b = copy(a);
  b.clients[1].notes.push({ id: 'n1', text: 'hello' });
  assert.deepEqual(names(diffState(a, b)), ['clients:upsert:c2']);
});

test('writes travel in the order of the database: a client before the lead, the job and the task that point at it', () => {
  const a = base(); const b = copy(a);
  b.tasks.push({ id: 't1', jobId: 'j1' }); b.jobs.push({ id: 'j1', clientId: 'c9' }); b.leads.push({ id: 'l9', clientId: 'c9' }); b.clients.push({ id: 'c9', name: 'New' }); b.offices.push({ id: 'o1' });
  assert.deepEqual(diffState(a, b).map((o) => o.c), ['offices', 'clients', 'leads', 'jobs', 'tasks']);
});

test('lists the server keeps are never sent: people, grants, credits, connections, tax ID requests and their log, the audit trail', () => {
  const a = base(); const b = copy(a);
  for (const c of READ_ONLY) b[c].push({ id: 'x-' + c });
  assert.deepEqual([...READ_ONLY].sort(), ['audit', 'connections', 'credits', 'grants', 'reveals', 'secureLog', 'users']);
  assert.deepEqual(diffState(a, b), []);
  a.users.push({ id: 'u1', name: 'Was here' });
  assert.deepEqual(diffState(a, b), [], 'and never deleted');
});

test('history is append-only: a new entry is sent, a trimmed or changed one is not', () => {
  const a = base();
  a.activity = [{ id: 'a1', kind: 'x', at: '2026-01-01T00:00:00Z', by: 'u1' }, { id: 'a2', kind: 'y', at: '2026-01-02T00:00:00Z', by: 'u1' }];
  a.automation.runs = [{ id: 'r1', ruleId: 'lead-intake', steps: [] }];
  const b = copy(a);
  b.activity = [{ id: 'a3', kind: 'z' }, { ...b.activity[0], at: 'changed on screen' }];   // a2 was trimmed, a1 was touched, a3 is new
  b.automation.runs = [{ id: 'r2', ruleId: 'lead-intake', steps: [] }];                     // r1 was trimmed
  assert.deepEqual(names(diffState(a, b)), ['activity:upsert:a3', 'automationRuns:upsert:r2']);
  assert.deepEqual([...APPEND_ONLY].sort(), ['activity', 'automationRuns']);
});

test('company, config and settings are single operations that carry the whole record, and they go first', () => {
  const a = base(); const b = copy(a);
  b.company.name = 'Renamed'; b.config.routing = { mode: 'round_robin', pool: ['u1'], cursor: 0, exclude: [], skipAway: true }; b.settings.something = 1;
  b.clients.push({ id: 'c3', name: 'C' });
  const ops = diffState(a, b);
  assert.deepEqual(names(ops), ['company:upsert:company', 'config:upsert:config', 'settings:upsert:settings', 'clients:upsert:c3']);
  assert.equal(ops[0].row.name, 'Renamed');
  assert.equal(ops[1].row.routing.mode, 'round_robin');
});

test('read marks and automation switches have their own operations; the automation history is the collection automationRuns', () => {
  const a = base(); a.automation.enabled = { 'job-kickoff': true };
  const b = copy(a);
  b.automation.runs.push({ id: 'r1', at: '2026-01-01T00:00:00Z', ruleId: 'lead-intake', steps: [] });
  b.automation.enabled['lead-intake'] = false; b.readNotifications.push('n1', 'n2'); b.touched = true;
  const ops = diffState(a, b);
  assert.deepEqual(names(ops), ['readNotifications:upsert:readNotifications', 'automationRuns:upsert:r1', 'automation:upsert:lead-intake']);
  assert.deepEqual(ops[0].row, { ids: ['n1', 'n2'] });
  assert.deepEqual(ops[2].row, { enabled: false });
  assert.ok(!ops.some((o) => o.c === 'runs'), 'never under the old name');
});

test('what the server owns is never a change: versions, tax ID markers, signature evidence, provider fields, the rotation turn, the consent record', () => {
  const a = base();
  a.clients[0].updatedAt = '2026-01-01T00:00:00Z';
  a.docs = [{ id: 'd1', title: 'Agreement' }]; a.messages = [{ id: 'm1', text: 'Hello' }];
  a.config = { routing: { mode: 'round_robin', pool: [], cursor: 3 } }; a.settings = { consent1099: { id: 'k1' }, other: 1 };
  const b = copy(a);
  delete b.clients[0].updatedAt;
  b.clients[1].taxIdType = 'ssn'; b.clients[1].taxIdLast4 = '1234';
  b.docs[0].esign = { status: 'signed' };
  Object.assign(b.messages[0], { provider: 'resend', externalId: 'x1', error: 'bounced' });
  b.config.routing.cursor = 9; b.settings.consent1099 = { id: 'k2' };
  assert.deepEqual(diffState(a, b), []);
  // a real change next to them is still sent, with the version the server last gave the row
  b.clients[0].name = 'A changed'; b.config.routing.mode = 'manual';
  const ops = diffState(a, b);
  assert.deepEqual(names(ops), ['config:upsert:config', 'clients:upsert:c1']);
  assert.equal(ops[1].row.updatedAt, '2026-01-01T00:00:00Z', 'the version goes back, so the server can tell a stale edit');
});

test('collections this workspace does not have yet are left out when asked', () => {
  const a = base(); const b = copy(a);
  b.appointments.push({ id: 'ap1' }); b.clients.push({ id: 'c3' });
  assert.deepEqual(names(diffState(a, b, { skip: new Set(['appointments']) })), ['clients:upsert:c3']);
});

test('every list of the workspace is either sent in a known order or kept by the server', () => {
  const d = blank(PACKS.practice);
  const lists = Object.keys(d).filter((k) => Array.isArray(d[k]) && k !== 'readNotifications');
  assert.deepEqual([...COLLECTIONS].sort(), lists.sort());
  const writable = COLLECTIONS.filter((c) => !READ_ONLY.includes(c));
  assert.deepEqual([...APPLY_ORDER].filter((c) => c !== 'automationRuns').sort(), [...writable].sort(), 'APPLY_ORDER names every list the browser may write, once');
  assert.equal(new Set(APPLY_ORDER).size, APPLY_ORDER.length);
  const b = copy(d);
  for (const c of COLLECTIONS) b[c].push({ id: 'x-' + c });
  assert.equal(diffState(d, b).length, writable.length);
});

test('round trip: applying the operations to the old copy gives the new copy', () => {
  const a = base(); const b = copy(a);
  b.clients = [{ id: 'c2', name: 'B2', notes: [] }, { id: 'c7', name: 'New', notes: [] }];
  b.leads = []; b.tasks.push({ id: 't1', title: 'x' }); b.company.phone = '609-555-0100'; b.automation.runs.push({ id: 'r9', ruleId: 'x', steps: [] });
  b.automation.enabled.x = false; b.readNotifications = ['n1']; b.settings = { a: 1 };
  const ops = diffState(a, b);
  const got = applyOps(a, ops);
  assert.deepEqual(sorted(got), sorted(b));
  assert.deepEqual(diffState(got, b), [], 'nothing left to send');
});

test('applyOps changes nothing in place and stamps the versions the server answered with', () => {
  const a = base(); const before = copy(a);
  const lists = { clients: a.clients, leads: a.leads };
  const out = applyOps(a, [
    { c: 'clients', op: 'upsert', id: 'c1', row: { id: 'c1', name: 'A2', notes: [] } },
    { c: 'clients', op: 'upsert', id: 'c5', row: { id: 'c5', name: 'E' } },
    { c: 'leads', op: 'delete', id: 'l1' },
  ], { clients: { c1: '2026-02-02T00:00:00Z' } });
  assert.deepEqual(a, before, 'the copy that was acknowledged is untouched');
  assert.ok(a.clients === lists.clients && a.leads === lists.leads);
  assert.deepEqual(out.clients.map((c) => [c.id, c.name, c.updatedAt]), [['c1', 'A2', '2026-02-02T00:00:00Z'], ['c2', 'B', undefined], ['c5', 'E', undefined]]);
  assert.deepEqual(out.leads, []);
  assert.ok(out.tasks === a.tasks, 'a list that was not touched is the same list');
});

test('a missing list on either side is read as empty', () => {
  const a = base(); const b = copy(a);
  delete a.posts; delete b.cash;
  assert.deepEqual(diffState(a, b), []);
});
