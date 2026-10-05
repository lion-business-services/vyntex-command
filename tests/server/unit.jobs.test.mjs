// The job runner: what it tells the queue after a handler finishes, fails, fails for good, or does not exist.
// The queue itself (locks, backoff, lock expiry, dead letter) lives in the database and is tested there
// (tests/server/sql/server_core_test.sql) and end to end. Here the database is replaced by a recorder.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setTestEnv } from './helpers.mjs';

setTestEnv({ SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_ANON_KEY: 'anon-key-for-unit-tests', SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-unit-tests-0123456789' });
const J = await import('../../api/_lib/jobs.js');

let queue = []; let calls = [];
const realFetch = globalThis.fetch;
beforeEach(() => {
  queue = []; calls = [];
  globalThis.fetch = async (url, init) => {
    const fn = String(url).split('/rpc/')[1];
    const args = JSON.parse(init.body);
    calls.push({ fn, args, auth: init.headers.authorization });
    if (fn === 'job_claim') return new Response(JSON.stringify(queue.length ? [queue.shift()] : []), { status: 200 });
    if (fn === 'job_finish') return new Response('true', { status: 200 });
    if (fn === 'job_fail') return new Response(JSON.stringify({ status: args.p_base_seconds < 0 ? 'dead' : 'queued' }), { status: 200 });
    if (fn === 'job_enqueue') return new Response(JSON.stringify('33333333-3333-4333-8333-333333333333'), { status: 200 });
    return new Response('null', { status: 200 });
  };
});
test.after(() => { globalThis.fetch = realFetch; });
const job = (kind, payload = {}) => ({ id: 'job-' + Math.random().toString(16).slice(2), tenant_id: null, kind, payload, attempts: 1, max_attempts: 5 });

test('a job whose handler finishes is reported as done, by the runner that claimed it', async () => {
  const ran = [];
  J.register('t.ok', async (j) => { ran.push(j.payload.n); });
  queue.push(job('t.ok', { n: 1 }), job('t.ok', { n: 2 }));
  const out = await J.runDue({ worker: 'w-test' });
  assert.deepEqual(ran, [1, 2]);
  assert.equal(out.claimed, 2); assert.equal(out.done, 2); assert.equal(out.retried, 0); assert.equal(out.dead, 0);
  const finishes = calls.filter((c) => c.fn === 'job_finish');
  assert.equal(finishes.length, 2);
  assert.ok(finishes.every((c) => c.args.p_worker === 'w-test'));
  assert.ok(calls.every((c) => c.auth === 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY), 'the queue is reached with the server key');
  assert.ok(calls.filter((c) => c.fn === 'job_claim').every((c) => c.args.p_limit === 1), 'one job is claimed at a time');
});

test('a failing handler sends the job back for a retry with a code, not with the error text', async () => {
  J.register('t.fail', async () => { throw new J.JobError('provider_down'); });
  J.register('t.throw', async () => { throw new Error('secret detail: token=abc123 at /srv/handler.js:10'); });
  queue.push(job('t.fail'), job('t.throw'));
  const out = await J.runDue({ worker: 'w-test' });
  assert.equal(out.retried, 2); assert.equal(out.done, 0);
  const fails = calls.filter((c) => c.fn === 'job_fail');
  assert.deepEqual(fails.map((c) => [c.args.p_error, c.args.p_base_seconds]), [['provider_down', 30], ['handler_error', 30]]);
  assert.ok(!JSON.stringify(fails).includes('abc123'), 'the text of an unexpected error is not stored');
});

test('a permanent failure and an unknown kind go straight to the dead letter state', async () => {
  J.register('t.perm', async () => { throw new J.JobError('bad_payload', { permanent: true }); });
  queue.push(job('t.perm'), job('t.nobody.handles.this'));
  const out = await J.runDue({ worker: 'w-test' });
  assert.equal(out.dead, 2);
  assert.deepEqual(calls.filter((c) => c.fn === 'job_fail').map((c) => [c.args.p_error, c.args.p_base_seconds]), [['bad_payload', -1], ['unknown_kind', -1]]);
});

test('the runner stops at its limits', async () => {
  J.register('t.slow', async () => { await new Promise((r) => setTimeout(r, 30)); });
  for (let i = 0; i < 10; i++) queue.push(job('t.slow'));
  const byCount = await J.runDue({ worker: 'w', max: 3 });
  assert.equal(byCount.claimed, 3);
  const byTime = await J.runDue({ worker: 'w', budgetMs: 50 });
  assert.ok(byTime.claimed >= 1 && byTime.claimed <= 3, 'it stops claiming once the time budget is used');
  assert.equal(queue.length, 10 - 3 - byTime.claimed, 'jobs that were not claimed stay in the queue for the next run');
});

test('when the queue cannot be reached nothing is claimed and the run says so', async () => {
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const out = await J.runDue({ worker: 'w' });
  assert.equal(out.claimed, 0); assert.equal(out.error, 'queue_unavailable');
  assert.equal(await J.enqueue('t.ok', {}), null);
});

test('enqueue passes the company, the idempotency key and the time', async () => {
  const id = await J.enqueue('integration.sync', { provider: 'mock' }, { tenant: '11111111-1111-4111-8111-111111111111', idem: 'k-1', runAt: '2030-01-01T00:00:00Z', maxAttempts: 3 });
  assert.equal(id, '33333333-3333-4333-8333-333333333333');
  assert.deepEqual(calls[0].args, { p_kind: 'integration.sync', p_payload: { provider: 'mock' }, p_run_at: '2030-01-01T00:00:00.000Z', p_tenant: '11111111-1111-4111-8111-111111111111', p_idem: 'k-1', p_max_attempts: 3 });
});

test('a job error code is always a short code', () => {
  assert.equal(new J.JobError('Some long human text!').code, 'failed');
  assert.equal(new J.JobError('sync_failed').permanent, false);
});
