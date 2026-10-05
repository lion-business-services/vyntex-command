// Rate limits and the sign-in lockout, from memory (the fallback used when the database cannot be reached).
// The same rules in the database are tested in tests/server/sql/server_core_test.sql and in the end-to-end tests.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { setTestEnv, ORIGIN } from './helpers.mjs';

setTestEnv();   // no SUPABASE_URL: the database is "not configured", so everything below runs on the memory fallback
const R = await import('../../api/_lib/ratelimit.js');
const { HttpError } = await import('../../api/_lib/respond.js');

test('what is counted is a keyed hash, never the address or the email', () => {
  const k = R.keyHash('addr', '203.0.113.7');
  assert.match(k, /^[0-9a-f]{64}$/);
  assert.ok(!k.includes('203'));
  assert.equal(k, R.keyHash('addr', '203.0.113.7'));
  assert.notEqual(k, R.keyHash('ip', '203.0.113.7'), 'the same value hashed for another purpose gives another key');
  assert.equal(R.accountKey('Person@Example.com '), R.accountKey('person@example.com'));
  const req = new Request(ORIGIN, { headers: { 'x-real-ip': '203.0.113.7' } });
  assert.equal(R.addressKey(req), k);
  assert.match(R.ipHash(req), /^[0-9a-f]{64}$/);
  assert.equal(R.ipHash(new Request(ORIGIN)), null);
  const keep = process.env.IP_HASH_SALT;
  process.env.IP_HASH_SALT = 'another-salt-0123456789abcdef';
  assert.notEqual(R.keyHash('addr', '203.0.113.7'), k, 'the hash depends on the secret salt');
  process.env.IP_HASH_SALT = keep;
});

test('a limit allows up to the limit and then refuses with a wait', async () => {
  R.resetMemoryLimits();
  for (let i = 0; i < 3; i++) assert.equal((await R.hit('t.bucket', 'k1', 3, 60)).allowed, true);
  const over = await R.hit('t.bucket', 'k1', 3, 60);
  assert.equal(over.allowed, false);
  assert.ok(over.retryAfter >= 1 && over.retryAfter <= 60);
  assert.equal(over.source, 'memory');
  assert.equal((await R.hit('t.bucket', 'k2', 3, 60)).allowed, true, 'another key has its own count');
  await assert.rejects(R.limit('t.bucket', 'k1', 3, 60), (e) => e instanceof HttpError && e.status === 429 && e.code === 'rate_limited' && Number(e.extra.headers['retry-after']) >= 1);
});

test('a new window starts from zero', async () => {
  R.resetMemoryLimits();
  mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  try {
    for (let i = 0; i < 2; i++) await R.hit('t.win', 'k', 2, 60);
    assert.equal((await R.hit('t.win', 'k', 2, 60)).allowed, false);
    mock.timers.tick(61_000);
    assert.equal((await R.hit('t.win', 'k', 2, 60)).allowed, true);
  } finally { mock.timers.reset(); }
});

test('sign-in: five failures lock that account for that address, with a lock that doubles', async () => {
  R.resetMemoryLimits();
  mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  try {
    const addr = R.keyHash('addr', '198.51.100.9'); const acct = R.accountKey('person@example.com');
    for (let i = 1; i <= 4; i++) {
      assert.equal((await R.signinGate(addr, acct)).allowed, true);
      assert.equal((await R.signinResult(addr, acct, false, 'person@example.com', null)).locked, false, `failure ${i}`);
    }
    const fifth = await R.signinResult(addr, acct, false, 'person@example.com', null);
    assert.equal(fifth.locked, true);
    assert.equal(fifth.retryAfter, 60);
    const gate = await R.signinGate(addr, acct);
    assert.equal(gate.allowed, false);
    assert.ok(gate.retryAfter > 0 && gate.retryAfter <= 60);

    // not a way to lock someone out: the same account from another address still gets through
    assert.equal((await R.signinGate(R.keyHash('addr', '198.51.100.10'), acct)).allowed, true);
    // and another account from the first address too
    assert.equal((await R.signinGate(addr, R.accountKey('other@example.com'))).allowed, true);

    mock.timers.tick(61_000);
    assert.equal((await R.signinGate(addr, acct)).allowed, true, 'the lock ends by itself');
    for (let i = 0; i < 4; i++) await R.signinResult(addr, acct, false, 'person@example.com', null);
    const again = await R.signinResult(addr, acct, false, 'person@example.com', null);
    assert.equal(again.retryAfter, 120, 'the second lock is twice as long');
    mock.timers.tick(121_000);
    await R.signinResult(addr, acct, true, 'person@example.com', null);
    for (let i = 0; i < 4; i++) await R.signinResult(addr, acct, false, 'person@example.com', null);
    assert.equal((await R.signinResult(addr, acct, false, 'person@example.com', null)).retryAfter, 240, 'a success in between does not reset the backoff');
  } finally { mock.timers.reset(); }
});

test('sign-in: an address that tries many accounts is limited as a whole', async () => {
  R.resetMemoryLimits();
  const addr = R.keyHash('addr', '198.51.100.77');
  let refused = 0;
  for (let i = 0; i < 35; i++) if (!(await R.signinGate(addr, R.accountKey(`person${i}@example.com`))).allowed) refused += 1;
  assert.equal(refused, 5, '30 attempts per address in ten minutes, whatever the accounts');
});

test('sign-in: twenty failures across many addresses lock the account for a short time only', async () => {
  R.resetMemoryLimits();
  const acct = R.accountKey('target@example.com');
  let out;
  for (let i = 0; i < 20; i++) out = await R.signinResult(R.keyHash('addr', '203.0.113.' + i), acct, false, 'target@example.com', null);
  assert.equal(out.locked, true);
  assert.ok(out.retryAfter <= 900, 'never longer than 15 minutes: a lock is not a way to keep the real person out for good');
  assert.equal((await R.signinGate(R.keyHash('addr', '203.0.113.200'), acct)).allowed, false);
});

test('a lock for other guesses (codes, the fresh check) works the same way', async () => {
  R.resetMemoryLimits();
  for (let i = 0; i < 4; i++) assert.equal((await R.failLock('t.code', 'u1', 5, 900, 60, 1800)).locked, false);
  assert.equal((await R.failLock('t.code', 'u1', 5, 900, 60, 1800)).locked, true);
  await assert.rejects(R.assertNotLocked('t.code', 'u1'), (e) => e.status === 429 && e.code === 'locked');
  await R.assertNotLocked('t.code', 'u2');
});

test('the assistant limits how often one address may ask', async () => {
  R.resetMemoryLimits();
  process.env.ANTHROPIC_API_KEY = 'test-key-for-the-assistant-0123456789';
  const real = globalThis.fetch;
  let upstream = 0;
  globalThis.fetch = async () => { upstream += 1; return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Sample answer' }] }), { status: 200 }); };
  try {
    const assistant = await import('../../api/assistant.js');
    const ask = (ip) => assistant.POST(new Request(ORIGIN + '/api/assistant', { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip }, body: JSON.stringify({ messages: [{ role: 'user', content: 'How many open tasks are there?' }] }) }));
    const statuses = [];
    for (let i = 0; i < 32; i++) statuses.push((await ask('198.51.100.5')).status);
    assert.deepEqual([...new Set(statuses.slice(0, 30))], [200]);
    assert.deepEqual(statuses.slice(30), [429, 429]);
    assert.equal(upstream, 30, 'a refused question is not sent on');
    assert.equal((await ask('198.51.100.6')).status, 200, 'another address is not affected');
    assert.deepEqual(await (await assistant.GET()).json(), { ok: true, configured: true });
  } finally { globalThis.fetch = real; delete process.env.ANTHROPIC_API_KEY; }
});

test('with no settings at all (the public demo) hashing still works, from a salt made up at start', async () => {
  const keep = { a: process.env.IP_HASH_SALT, b: process.env.SESSION_SECRET };
  delete process.env.IP_HASH_SALT; delete process.env.SESSION_SECRET;
  try {
    assert.match(R.keyHash('addr', '203.0.113.7'), /^[0-9a-f]{64}$/);
    assert.equal((await R.hit('t.demo', R.keyHash('addr', '203.0.113.7'), 1, 60)).allowed, true);
  } finally { process.env.IP_HASH_SALT = keep.a; process.env.SESSION_SECRET = keep.b; }
});
