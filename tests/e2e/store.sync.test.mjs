// The live half of the store (src/store/store.ts) without a browser or a server: the store is started the way a live
// workspace starts it, with a stand-in for the function that sends changes, and what it does with each kind of answer is
// checked: accepted rows, refused rows, a stale edit, a list the workspace does not have yet, rows the server stored
// differently, a request refused as a whole, a session that ends with changes unsaved, and what reaches browser storage.
//   node --test tests/e2e/store.sync.test.mjs      (part of npm run test:e2e)
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../unit/bundle.mjs';

// a browser storage to watch: live records must never land in it
const stored = new Map();
globalThis.localStorage = { getItem: (k) => (stored.has(k) ? stored.get(k) : null), setItem: (k, v) => { stored.set(k, String(v)); }, removeItem: (k) => { stored.delete(k); } };

const S = await load(`
  export * from '@/store/store';
  export { syncStatus } from '@/platform/live/status';
  export { heldCount, takeHeld, whoKey, SessionEnded, track, clearInFlight } from '@/platform/live/carry';
  export { batchesOf, normalisePatch } from '@/platform/live/sync';
  export { isLive, session } from '@/platform/session';
`);

const who = { mode: 'workspace', slug: 'sample-co', tenantId: '11111111-1111-4111-8111-111111111111', industry: 'practice', planId: 'quoted', role: 'owner', actorId: 'u1', email: 'owner@example.com', name: 'Sample Owner' };
const server = () => ({
  pack: 'practice', company: { name: 'Sample Practice Office', initials: '', license: '', phone: '', email: '' }, config: {}, settings: {}, readNotifications: [],
  users: [{ id: 'u1', name: 'Sample Owner', role: 'owner', email: 'owner@example.com', active: true }],
  clients: [{ id: 'c1', name: 'Rowan Sample', notes: [], updatedAt: 'v1' }, { id: 'c2', name: 'Harper Sample', notes: [], updatedAt: 'v1' }],
  leads: [{ id: 'l1', name: 'Quinn Sample', status: 'new', updatedAt: 'v1' }],
  jobs: [], tasks: [], workers: [], workerPays: [], docs: [], activity: [], messages: [], automation: { enabled: {}, runs: [] },
});
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
/** Starts a live workspace whose "server" is the function given. Returns the list of requests it received. */
function boot(answer) {
  const sent = [];
  S.bootLive(server(), who, async (ops) => { sent.push(ops); return answer(ops, sent.length); });
  return sent;
}
const accept = (ops) => ({ ok: true, applied: ops.length, rejected: [], server: {}, versions: {} });
const data = () => S.getSnapshot().data;
async function change(fn) { S.mutate(fn); S.syncNow(); await tick(); }

test('a live workspace starts from the server\'s records, with the role of the session and the edition of the company', () => {
  boot(accept);
  assert.equal(S.isLive(), true);
  assert.deepEqual(data().clients.map((c) => c.name), ['Rowan Sample', 'Harper Sample']);
  assert.equal(S.getSnapshot().prefs.viewAs, 'owner');
  assert.equal(S.getSnapshot().prefs.pack, 'practice');
  assert.equal(data().company.initials, 'SP', 'initials are worked out for the menu when the company has none');
  assert.ok(data().rules.length > 0, 'the automations the edition ships are there until the company changes them');
  assert.equal(S.hasUnsaved(), false, 'and none of that counts as a change to send');
  assert.deepEqual(S.syncStatus().state, 'saved');
});

test('an accepted change becomes the acknowledged copy, with the version the server answered', async () => {
  const sent = boot((ops) => ({ ...accept(ops), versions: { clients: { c1: 'v2' } } }));
  await change((d) => { d.clients[0].name = 'Rowan Sample Jr'; });
  assert.deepEqual(sent.map((ops) => ops.map((o) => `${o.c}:${o.op}:${o.id}`)), [['clients:upsert:c1']]);
  assert.equal(sent[0][0].row.updatedAt, 'v1', 'the row went out with the version it had');
  assert.equal(data().clients[0].updatedAt, 'v2', 'and now carries the new one');
  assert.equal(S.hasUnsaved(), false);
  assert.equal(S.syncStatus().state, 'saved');
  await change((d) => { d.clients[0].name = 'Rowan Again'; });
  assert.equal(sent[1][0].row.updatedAt, 'v2', 'the next change sends it back');
});

test('refused rows go back to the server\'s copy: a new row disappears, a changed row is restored, a removed row returns to its place', async () => {
  const sent = boot((ops) => ({ ok: false, applied: 0, rejected: ops.map((o) => ({ c: o.c, id: o.id, reason: 'forbidden' })), server: {}, versions: {} }));
  await change((d) => { d.clients[0].name = 'Changed'; d.clients.push({ id: 'c9', name: 'New', notes: [] }); d.clients.splice(1, 1); d.company.name = 'Renamed'; d.readNotifications.push('n1'); d.automation.enabled.x = false; });
  assert.equal(sent.length, 1, 'one request, and no second attempt for what was refused');
  assert.deepEqual(data().clients.map((c) => [c.id, c.name]), [['c1', 'Rowan Sample'], ['c2', 'Harper Sample']]);
  assert.equal(data().company.name, 'Sample Practice Office');
  assert.deepEqual(data().readNotifications, []);
  assert.deepEqual(data().automation.enabled, {});
  assert.equal(S.hasUnsaved(), false);
  assert.equal(S.syncStatus().state, 'saved');
});

test('only the refused rows are rolled back: the rest of the same request is kept', async () => {
  boot((ops) => ({ ok: false, applied: 1, rejected: [{ c: 'clients', id: 'c2', reason: 'invalid' }], server: {}, versions: { clients: { c1: 'v2' } } }));
  await change((d) => { d.clients[0].name = 'Kept'; d.clients[1].name = 'Refused'; });
  assert.deepEqual(data().clients.map((c) => c.name), ['Kept', 'Harper Sample']);
  assert.equal(S.hasUnsaved(), false);
});

test('a stale edit is replaced by the row the server has now', async () => {
  boot(() => ({ ok: false, applied: 0, rejected: [{ c: 'leads', id: 'l1', reason: 'stale' }], server: { leads: [{ id: 'l1', name: 'Changed by a colleague', status: 'contacted', updatedAt: 'v7' }] }, versions: {} }));
  await change((d) => { d.leads[0].name = 'My edit'; });
  assert.deepEqual(data().leads, [{ id: 'l1', name: 'Changed by a colleague', status: 'contacted', updatedAt: 'v7' }]);
  assert.equal(S.hasUnsaved(), false);
});

test('a list the workspace does not have yet: the rows stay on screen, leave the queue, and the status names the list once', async () => {
  const sent = boot((ops) => ({ ok: false, applied: ops.filter((o) => o.c !== 'appointments').length, rejected: ops.filter((o) => o.c === 'appointments').map((o) => ({ c: o.c, id: o.id, reason: 'not_ready' })), server: {}, versions: {} }));
  await change((d) => { d.appointments.push({ id: 'ap1' }, { id: 'ap2' }, { id: 'ap3' }); d.clients[0].name = 'Still saved'; });
  assert.deepEqual(data().appointments.map((a) => a.id), ['ap1', 'ap2', 'ap3'], 'kept on screen');
  assert.deepEqual(S.syncStatus().unavailable, ['appointments']);
  assert.equal(S.hasUnsaved(), false, 'and no longer waiting to be sent');
  await change((d) => { d.appointments.push({ id: 'ap4' }); d.clients[0].name = 'Saved again'; });
  assert.deepEqual(sent[1].map((o) => o.c), ['clients'], 'the list is left out of later requests');
  // a newer copy from the server does not wipe what was typed there
  assert.equal(S.refreshLive({ ...server(), appointments: [] }), true);
  assert.equal(data().appointments.length, 4);
});

test('a row the server stored differently replaces the one on screen, unless the person has changed it again meanwhile', async () => {
  let release;
  const sent = [];
  S.bootLive(server(), who, (ops) => { sent.push(ops); return new Promise((resolve) => { release = () => resolve({ ...accept(ops), server: { leads: ops.filter((o) => o.c === 'leads').map((o) => ({ ...o.row, ticket: 'VP-1001', updatedAt: 'v2' })) }, versions: { leads: Object.fromEntries(ops.map((o) => [o.id, 'v2'])) } }); }); });
  S.mutate((d) => { d.leads.push({ id: 'l2', name: 'Avery Sample', ticket: 'VP-0000' }); }); S.syncNow(); await tick();
  release(); await tick();
  assert.equal(data().leads.find((l) => l.id === 'l2').ticket, 'VP-1001', 'the number the database assigned');
  assert.equal(S.hasUnsaved(), false);
  // changed again while the request is out
  S.mutate((d) => { d.leads.find((l) => l.id === 'l2').name = 'First edit'; }); S.syncNow(); await tick();
  S.mutate((d) => { d.leads.find((l) => l.id === 'l2').name = 'Second edit, typed while saving'; });
  release(); await tick();
  assert.equal(data().leads.find((l) => l.id === 'l2').name, 'Second edit, typed while saving', 'the newer text is not overwritten');
  assert.equal(S.hasUnsaved(), true, 'and is sent next');
  S.syncNow(); await tick(); release(); await tick();
  assert.equal(sent.at(-1)[0].row.name, 'Second edit, typed while saving');
  assert.equal(sent.at(-1)[0].row.updatedAt, 'v2');
});

test('several quick changes travel together, and a change made while a request is out goes in the next one', async () => {
  let release; const sent = [];
  S.bootLive(server(), who, (ops) => { sent.push(ops); return new Promise((resolve) => { release = () => resolve(accept(ops)); }); });
  S.mutate((d) => { d.clients[0].name = 'One'; });
  S.mutate((d) => { d.clients[1].name = 'Two'; });
  S.mutate((d) => { d.tasks.push({ id: 't1', title: 'Three' }); });
  assert.equal(S.syncStatus().state, 'saving');
  await tick(500);          // the short wait before sending
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].map((o) => o.c), ['clients', 'clients', 'tasks']);
  S.mutate((d) => { d.clients[0].name = 'Four'; });
  await tick(500);
  assert.equal(sent.length, 1, 'never two requests at once');
  release(); await tick(600);
  assert.equal(sent.length, 2);
  release(); await tick();
  assert.equal(S.syncStatus().state, 'saved');
});

test('a request refused as a whole is not repeated in a loop: the status says so and the change stays on screen', async () => {
  let fail = true; const sent = [];
  S.bootLive(server(), who, async (ops) => { sent.push(ops); if (fail) throw Object.assign(new Error('invalid_ops'), { name: 'SyncRefused', code: 'invalid_ops' }); return accept(ops); });
  await change((d) => { d.clients[0].name = 'Waiting'; });
  assert.equal(S.syncStatus().state, 'problem');
  assert.equal(data().clients[0].name, 'Waiting');
  await tick(700);
  assert.equal(sent.length, 1);
  fail = false;
  S.syncNow(); await tick();
  assert.equal(S.syncStatus().state, 'saved');
});

test('a session that ends with changes unsaved: they are held for the same person and company, in memory only', async () => {
  S.bootLive(server(), who, () => new Promise(() => undefined));     // the request never comes back
  S.mutate((d) => { d.clients[0].name = 'In the request that was out'; }); S.syncNow(); await tick();
  S.track({ ops: [{ c: 'clients', op: 'upsert', id: 'c1', row: { id: 'c1', name: 'In the request that was out', notes: [] } }], idem: 'key-of-the-request-out' });
  S.mutate((d) => { d.tasks.push({ id: 't5', title: 'Typed after it' }); });
  assert.equal(S.parkUnsaved(), 2);
  S.endLive(); S.clearInFlight();
  assert.equal(S.isLive(), false);
  assert.deepEqual(data().clients, [], 'the records left memory');
  assert.equal(S.takeHeld(S.whoKey('someone-else@example.com', who.tenantId)).length, 0, 'someone else signing in gets nothing');
  assert.equal(S.heldCount(), 0, 'and it is gone');
  // the same again, taken by the right person
  S.bootLive(server(), who, () => new Promise(() => undefined));
  S.mutate((d) => { d.tasks.push({ id: 't6', title: 'Mine' }); });
  S.parkUnsaved(); S.endLive();
  const mine = S.takeHeld(S.whoKey('OWNER@example.com', who.tenantId));
  assert.deepEqual(mine.map((b) => b.ops.map((o) => o.id)), [['t6']]);
  assert.match(mine[0].idem, /^[A-Za-z0-9_-]{8,80}$/);
});

test('nothing of a live workspace is written to browser storage; the choices of the sample workspace are left as they were', async () => {
  stored.clear();
  boot(accept);
  await change((d) => { d.clients[0].name = 'Private name that must not be stored'; d.clients[0].taxIdLast4 = '9999'; });
  S.setPrefs({ theme: 'light' });
  const everything = [...stored].map(([k, v]) => k + '=' + v).join('\n');
  assert.deepEqual([...stored.keys()], ['vyntex.prefs']);
  assert.ok(!everything.includes('Private name') && !everything.includes('9999') && !everything.includes('Rowan'));
  const prefs = JSON.parse(stored.get('vyntex.prefs'));
  assert.equal(prefs.theme, 'light', 'the person\'s own choices are kept');
  assert.notEqual(prefs.pack, 'practice', 'the company\'s edition is not written over the sample choice');
  S.endLive();
  assert.equal(S.getSnapshot().prefs.pack, prefs.pack);
  assert.equal(S.getSnapshot().prefs.theme, 'light');
});

test('the role cannot be switched from the browser while signed in, and a read-only session cannot change records', () => {
  S.bootLive(server(), { ...who, role: 'readonly', actorId: 'u2' }, async (ops) => accept(ops));
  S.setPrefs({ viewAs: 'owner', pack: 'build' });
  assert.equal(S.getSnapshot().prefs.viewAs, 'readonly');
  assert.equal(S.getSnapshot().prefs.pack, 'practice');
  assert.throws(() => S.mutate((d) => { d.clients[0].name = 'x'; }), /cannot change records/);
  assert.equal(data().clients[0].name, 'Rowan Sample');
  S.endLive();
});

test('requests are cut to what the server accepts and keep their order; the server\'s single parts arrive as lists and are unwrapped', () => {
  const ops = Array.from({ length: 950 }, (_, i) => ({ c: 'tasks', op: 'upsert', id: 't' + i, row: { id: 't' + i, title: 'Sample task ' + i } }));
  const batches = S.batchesOf(ops);
  assert.deepEqual(batches.map((b) => b.ops.length), [400, 400, 150]);
  assert.deepEqual(batches.flatMap((b) => b.ops.map((o) => o.id)), ops.map((o) => o.id));
  assert.equal(new Set(batches.map((b) => b.idem)).size, 3, 'one key per request');
  const big = S.batchesOf(Array.from({ length: 5 }, (_, i) => ({ c: 'docs', op: 'upsert', id: 'd' + i, row: { id: 'd' + i, body: 'x'.repeat(300 * 1024) } })));
  assert.ok(big.length >= 3 && big.every((b) => JSON.stringify(b.ops).length < 1024 * 1024), 'each request stays under the size the server takes');
  assert.deepEqual(S.normalisePatch({ config: [{ routing: { cursor: 2 } }], automation: [{ runs: [], enabled: { a: false } }], readNotifications: [['n1', 'n2']], clients: [{ id: 'c1', name: 'A' }, 'junk'], company: [{ name: 'X' }] }),
    { config: { routing: { cursor: 2 } }, automation: { runs: [], enabled: { a: false } }, readNotifications: ['n1', 'n2'], clients: [{ id: 'c1', name: 'A' }], company: { name: 'X' } });
});
