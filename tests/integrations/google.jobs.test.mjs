// The Google job handlers and the shared call helper, with stand-ins for the queue and the store. No database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setGoogleEnv, ctxFor, reply, gerr, TENANT } from './google.helpers.mjs';

setGoogleEnv();
const { runGoogleJob, runGoogleRefresh, registerGoogleJobs, googleTick, googleDaily, GOOGLE_JOBS } = await import('../../api/_lib/jobs/google.js');
const { JobError } = await import('../../api/_lib/jobs.js');
const { ProviderError } = await import('../../api/_lib/integrations/oauth.js');
const { gapi, retryAfterSeconds, seg } = await import('../../api/_lib/integrations/google/rest.js');
const gmail = (await import('../../api/_lib/integrations/providers/gmail.js')).default;

function deps(over = {}) {
  const log = { sync: [], queued: [], put: [], refreshed: [] };
  const rows = over.rows || {};
  return { log, deps: {
    now: () => 1_800_000_000_000,
    runSync: async (adapter, tenant, what) => { log.sync.push([adapter.id, tenant, what]); if (over.syncError) throw over.syncError; return { ok: true, counts: { messages: 1 } }; },
    refreshTokens: async (adapter, tenant) => { log.refreshed.push([adapter.id, tenant]); if (over.refreshError) throw over.refreshError; return {}; },
    enqueue: async (kind, payload, opts) => { log.queued.push({ kind, payload, ...opts }); return 'job-1'; },
    store: { getRow: async (t, p) => rows[p] || null, putRow: async (t, p, patch) => { log.put.push([p, patch]); return patch; }, tokensOf: async (row) => (row.token_enc === 'unreadable' ? null : { refresh_token: 'r' }) },
  } };
}
const job = (kind, payload = {}) => ({ id: 'j1', tenant_id: TENANT, kind, payload });
const fails = (p, code, permanent) => assert.rejects(p, (e) => e instanceof JobError && e.code === code && e.permanent === permanent, code);

test('each kind runs the right adapter with the right scope of work', async () => {
  assert.deepEqual(Object.keys(GOOGLE_JOBS), ['google.gmail.sync', 'google.gmail.watch', 'google.calendar.sync', 'google.calendar.watch']);
  const d = deps();
  for (const kind of Object.keys(GOOGLE_JOBS)) await runGoogleJob(job(kind), d.deps);
  assert.deepEqual(d.log.sync, [['gmail', TENANT, 'inbox'], ['gmail', TENANT, 'watch'], ['gcal', TENANT, 'events'], ['gcal', TENANT, 'watch']]);
  const kinds = [];
  registerGoogleJobs((kind, fn) => { kinds.push(kind); assert.equal(typeof fn, 'function'); });
  assert.deepEqual(kinds, [...Object.keys(GOOGLE_JOBS), 'google.refresh']);
  await fails(runGoogleJob(job('google.unknown'), d.deps), 'unknown_kind', true);
  await fails(runGoogleJob({ kind: 'google.gmail.sync', payload: {} }, d.deps), 'no_company', true);
});

test('rate limit: the work is queued again for when Google said, instead of failing', async () => {
  const err = new ProviderError('rate_limited', { status: 429 }); err.retryAfter = 120;
  const d = deps({ syncError: err });
  assert.deepEqual(await runGoogleJob(job('google.gmail.sync'), d.deps), { deferred: true, retryAfter: 120 });
  assert.equal(d.log.queued.length, 1);
  const q = d.log.queued[0];
  assert.equal(q.kind, 'google.gmail.sync'); assert.equal(q.tenant, TENANT); assert.equal(q.runAt, 1_800_000_000_000 + 120000);
  assert.match(q.idem, new RegExp(`^${TENANT}:google\\.gmail\\.sync:after:\\d+$`));
  const long = new ProviderError('rate_limited'); long.retryAfter = 999999;
  const d2 = deps({ syncError: long });
  await runGoogleJob(job('google.calendar.sync'), d2.deps);
  assert.equal(d2.log.queued[0].runAt, 1_800_000_000_000 + 3600000, 'never further than an hour');
});

test('outage: retried by the queue; revoked permission: stops for good and Meet stops saying "connected"', async () => {
  await fails(runGoogleJob(job('google.gmail.sync'), deps({ syncError: new ProviderError('provider_down', { status: 503 }) }).deps), 'provider_down', false);
  await fails(runGoogleJob(job('google.gmail.sync'), deps({ syncError: new Error('boom with private text') }).deps), 'google_job_failed', false);
  await fails(runGoogleJob(job('google.gmail.sync'), deps({ syncError: new ProviderError('not_connected') }).deps), 'not_connected', true);
  const d = deps({ syncError: new ProviderError('invalid_grant', { reauth: true }), rows: { gmeet: { state: 'connected' } } });
  await fails(runGoogleJob(job('google.calendar.sync'), d.deps), 'invalid_grant', true);
  assert.deepEqual(d.log.put, [['gmeet', { state: 'attention', reason: 'calendar_reauth', last_error: 'calendar_reauth', health: 'down' }]]);
  const g = deps({ syncError: new ProviderError('invalid_grant', { reauth: true }), rows: { gmeet: { state: 'connected' } } });
  await fails(runGoogleJob(job('google.gmail.sync'), g.deps), 'invalid_grant', true);
  assert.deepEqual(g.log.put, [], 'a Gmail problem does not touch Meet');
});

test('token refresh: done for a connected provider, skipped without tokens, permanent when revoked', async () => {
  const d = deps({ rows: { gcal: { token_enc: 'sealed' } } });
  assert.deepEqual(await runGoogleRefresh(job('google.refresh', { provider: 'gcal' }), d.deps), { refreshed: true });
  assert.deepEqual(d.log.refreshed, [['gcal', TENANT]]);
  assert.deepEqual(await runGoogleRefresh(job('google.refresh', { provider: 'gmail' }), deps().deps), { skipped: 'not_connected' });
  await fails(runGoogleRefresh(job('google.refresh', { provider: 'gmaps' }), deps().deps), 'unknown_provider', true);
  await fails(runGoogleRefresh(job('google.refresh', { provider: 'gmail' }), deps({ rows: { gmail: { token_enc: 'unreadable' } } }).deps), 'token_unreadable', true);
  const r = deps({ rows: { gcal: { token_enc: 'sealed' }, gmeet: { state: 'connected' } }, refreshError: new ProviderError('invalid_grant', { reauth: true }) });
  await fails(runGoogleRefresh(job('google.refresh', { provider: 'gcal' }), r.deps), 'invalid_grant', true);
  assert.equal(r.log.put[0][0], 'gmeet');
});

test('scheduled work: one sync per connection and quarter hour, one renewal check per day', async () => {
  const list = async () => [{ tenant_id: TENANT, provider: 'gmail' }, { tenant_id: TENANT, provider: 'gcal' }];
  const queued = [];
  const enqueue = async (kind, payload, opts) => { queued.push([kind, opts.tenant, opts.idem]); return 'j'; };
  const now = Date.UTC(2026, 0, 5, 10, 7);
  assert.deepEqual(await googleTick({ enqueue, list, now }), { queued: 2 });
  await googleTick({ enqueue, list, now: now + 5 * 60000 });
  assert.equal(queued[0][2], queued[2][2], 'the same quarter hour gives the same key, so the queue keeps one');
  assert.deepEqual(queued.slice(0, 2).map((q) => q[0]), ['google.gmail.sync', 'google.calendar.sync']);
  queued.length = 0;
  assert.deepEqual(await googleDaily({ enqueue, list, now }), { queued: 2 });
  assert.deepEqual(queued.map((q) => [q[0], q[2]]), [['google.gmail.watch', `${TENANT}:google.gmail.watch:2026-01-05`], ['google.calendar.watch', `${TENANT}:google.calendar.watch:2026-01-05`]]);
});

test('the call helper: codes for every kind of refusal, and safe path segments', async () => {
  const call = (res, method = 'GET', opts) => { const c = ctxFor(gmail, { routes: [[method, 'api.example', () => res()]] }); return gapi(c.ctx, method, 'https://api.example/x', opts).then((v) => ({ v, c }), (e) => ({ e, c })); };
  const code = async (res, method, opts) => (await call(res, method, opts)).e?.code;
  assert.equal(await code(() => gerr(401, 'authError')), 'token_rejected');
  assert.equal(await code(() => gerr(403, 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')), 'scope_missing');
  assert.equal(await code(() => gerr(403, 'accessNotConfigured')), 'api_not_enabled');
  assert.equal(await code(() => gerr(403, 'forbidden')), 'forbidden');
  assert.equal(await code(() => gerr(404, 'notFound')), 'not_found');
  assert.equal(await code(() => gerr(409, 'duplicate')), 'conflict');
  assert.equal(await code(() => gerr(410, 'deleted')), 'gone');
  assert.equal(await code(() => gerr(412, 'conditionNotMet')), 'changed_meanwhile');
  assert.equal(await code(() => gerr(400, 'invalid')), 'request_rejected');
  const post = await call(() => reply(503, 'x'), 'POST', { body: { a: 1 } });
  assert.equal(post.e.code, 'provider_down'); assert.equal(post.c.calls.length, 1, 'a POST without its own request id is not repeated');
  const empty = await call(() => new Response(null, { status: 204 }), 'DELETE');
  assert.deepEqual(empty.v, {});
  await assert.rejects(gapi(ctxFor(gmail, { tokens: null }).ctx, 'GET', 'https://api.example/x'), (e) => e.code === 'not_connected');
  assert.equal(retryAfterSeconds(new Response('', { headers: { 'retry-after': '99999' } })), 3600);
  assert.equal(retryAfterSeconds(new Response('')), null);
  assert.equal(seg('abc_DEF-1.2@x'), 'abc_DEF-1.2%40x');
  for (const bad of ['../x', 'a/b', 'a b', '', 5, 'a?b=c']) assert.throws(() => seg(bad), (e) => e.code === 'invalid_id');
});
