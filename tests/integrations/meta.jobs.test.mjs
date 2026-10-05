// The background work of the messaging adapters (api/_lib/jobs/messaging.js): scheduled posts, queued messages with
// retry, and the renewal of Meta's long-lived token. The database and the providers are stand-ins: nothing is sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTestEnv } from '../server/helpers.mjs';

setTestEnv({});
const jobs = await import('../../api/_lib/jobs/messaging.js');
const { deps, sendQueued, publishPost, renewToken, messagingTick, messagingDaily } = jobs;
const { JobError, registeredKinds } = await import('../../api/_lib/jobs.js');
const { ProviderError } = await import('../../api/_lib/integrations/oauth.js');

const TENANT = '11111111-1111-4111-8111-111111111111';
const original = { ...deps };
/** Replaces the outside world for one test: `db` answers database functions by name, `adapters` are stand-in adapters. */
function world({ db = {}, adapters = {}, media = null, row = null, tokens = null, refresh = null } = {}) {
  const log = [];
  Object.assign(deps, original, {
    rpc: async (name, args) => { log.push({ name, args }); const f = db[name]; return f === undefined ? { ok: false, status: 404 } : { ok: true, status: 200, data: typeof f === 'function' ? f(args) : f }; },
    adapter: async (id) => adapters[id] || null,
    ctx: async (adapter, tenantId) => ({ provider: adapter.id, tenantId }),
    media: async () => media, row: async () => row, tokens: async () => tokens,
    refresh: refresh || (async () => { throw new Error('not expected'); }),
  });
  return log;
}
const job = (payload, over = {}) => ({ id: 'j1', tenant_id: TENANT, payload, attempts: 1, max_attempts: 5, ...over });
const fails = (p, code, permanent) => assert.rejects(p, (e) => e instanceof JobError && e.code === code && e.permanent === permanent, `${code} permanent=${permanent}`);
const results = (log, name) => log.filter((l) => l.name === name).map((l) => l.args);
const consent = { status: 'opted_in', channel: 'text', address: '+15555550142', grantedAt: '2026-01-02T10:00:00.000Z' };
const queued = (over = {}) => ({ message: { id: 'm1', channel: 'text', to: '+15555550142', body: 'Your order is ready.', status: 'queued', ...over }, consent, quietHours: null, lastInboundAt: null });

test('the job kinds are registered by importing the file', () => {
  for (const k of ['messaging.send', 'social.publish', 'messaging.token_renew']) assert.ok(registeredKinds().includes(k), k);
});

test('a queued text is sent with the consent record from the store, and the result is written once', async () => {
  const seen = [];
  const log = world({ db: { messaging_outbox_get: queued(), messaging_send_result: true }, adapters: { sms: { id: 'sms', actions: { send: async (ctx, msg) => { seen.push(msg); return { id: 'SM1', status: 'queued', segments: 1, segmentsSource: 'provider', cost: null, backend: 'twilio' }; } } } } });
  assert.deepEqual(await sendQueued(job({ message: 'm1' })), { sent: true, id: 'SM1' });
  assert.deepEqual(seen[0].consent, consent, 'the adapter gets the consent record and decides');
  assert.deepEqual(results(log, 'messaging_send_result'), [{ p_tenant: TENANT, p_id: 'm1', p_status: 'queued', p_external_id: 'SM1', p_error: null, p_meta: { segments: 1, segmentsSource: 'provider', cost: null, backend: 'twilio' } }]);
});

test('a message that already went out, or is no longer waiting, is not sent again', async () => {
  let sends = 0;
  const adapters = { sms: { id: 'sms', actions: { send: async () => { sends += 1; return { id: 'x' }; } } } };
  world({ db: { messaging_outbox_get: queued({ externalId: 'SM1' }) }, adapters });
  assert.deepEqual(await sendQueued(job({ message: 'm1' })), { skipped: true });
  world({ db: { messaging_outbox_get: queued({ status: 'sent' }) }, adapters });
  assert.deepEqual(await sendQueued(job({ message: 'm1' })), { skipped: true });
  world({ db: { messaging_outbox_get: null }, adapters });
  assert.deepEqual(await sendQueued(job({ message: 'm1' })), { skipped: true });
  assert.equal(sends, 0);
});

test('refusals stop at once and are recorded with their code: no consent, STOP, window, template', async () => {
  for (const code of ['consent_missing', 'consent_revoked', 'outside_messaging_window', 'template_not_approved', 'recipient_opted_out']) {
    const log = world({ db: { messaging_outbox_get: queued({ channel: 'whatsapp' }), messaging_send_result: true }, adapters: { whatsapp: { id: 'whatsapp', actions: { send: async () => { throw new ProviderError(code); } } } } });
    await fails(sendQueued(job({ message: 'm1' })), code, true);
    assert.deepEqual(results(log, 'messaging_send_result').map((r) => [r.p_status, r.p_error]), [['failed', code]]);
  }
});

test('retry of failed sends: an outage or a rate limit is tried again, and recorded as failed only after the last attempt', async () => {
  for (const code of ['provider_unreachable', 'rate_limited', 'provider_error']) {
    const log = world({ db: { messaging_outbox_get: queued(), messaging_send_result: true }, adapters: { sms: { id: 'sms', actions: { send: async () => { throw new ProviderError(code); } } } } });
    await fails(sendQueued(job({ message: 'm1' }, { attempts: 2 })), code, false);
    assert.equal(results(log, 'messaging_send_result').length, 0, 'still queued, nothing recorded as failed');
    await fails(sendQueued(job({ message: 'm1' }, { attempts: 5 })), code, true);
    assert.deepEqual(results(log, 'messaging_send_result').map((r) => [r.p_status, r.p_error]), [['failed', code]]);
  }
  // Quiet hours end by themselves: held, not failed.
  const log = world({ db: { messaging_outbox_get: queued(), messaging_send_result: true }, adapters: { sms: { id: 'sms', actions: { send: async () => { throw new ProviderError('quiet_hours'); } } } } });
  await fails(sendQueued(job({ message: 'm1' })), 'quiet_hours', false);
  assert.equal(results(log, 'messaging_send_result').length, 0);
  // A token the provider no longer accepts will not get better by waiting.
  world({ db: { messaging_outbox_get: queued({ channel: 'facebook' }), messaging_send_result: true }, adapters: { meta: { id: 'meta', actions: { sendMessage: async () => { throw new ProviderError('token_expired', { reauth: true }); } } } } });
  await fails(sendQueued(job({ message: 'm1' })), 'token_expired', true);
});

test('a send whose result cannot be recorded is not repeated; a missing database function is said as it is', async () => {
  let sends = 0;
  world({ db: { messaging_outbox_get: queued() }, adapters: { sms: { id: 'sms', actions: { send: async () => { sends += 1; return { id: 'SM1', status: 'queued' }; } } } } });
  await fails(sendQueued(job({ message: 'm1' })), 'result_not_recorded', true);
  assert.equal(sends, 1);
  world({ db: {} });
  await fails(sendQueued(job({ message: 'm1' })), 'not_installed', false);
  await fails(sendQueued(job({})), 'bad_job', true);
  world({ db: { messaging_outbox_get: queued({ channel: 'email' }), messaging_send_result: true } });
  await fails(sendQueued(job({ message: 'm1' })), 'channel_not_available', true);
  world({ db: { messaging_outbox_get: queued(), messaging_send_result: true } });
  await fails(sendQueued(job({ message: 'm1' })), 'not_built', true);
});

test('a scheduled post is published to each channel and marked published only after the provider answered', async () => {
  const seen = [];
  const meta = { id: 'meta', actions: { publishPagePost: async (ctx, p) => { seen.push(['facebook', p]); return { id: '100_1', channel: 'facebook' }; }, publishInstagram: async (ctx, p) => { seen.push(['instagram', p]); return { id: '179_1', channel: 'instagram' }; } } };
  const post = { id: 'p1', status: 'scheduled', text: 'Open on Saturday', channels: ['facebook', 'instagram'], media: [{ name: 'a.jpg', path: 't/a.jpg', mime: 'image/jpeg', size: 10 }], published: {} };
  const log = world({ db: { social_post_claim: post, social_post_result: true }, adapters: { meta }, media: { url: 'https://files.example.com/signed/a.jpg' } });
  assert.deepEqual(await publishPost(job({ post: 'p1' })), { published: ['facebook', 'instagram'] });
  assert.deepEqual(seen, [['facebook', { text: 'Open on Saturday', photoUrl: 'https://files.example.com/signed/a.jpg' }], ['instagram', { imageUrl: 'https://files.example.com/signed/a.jpg', caption: 'Open on Saturday' }]]);
  assert.deepEqual(results(log, 'social_post_result').map((r) => [r.p_status, r.p_published]), [['scheduled', { facebook: '100_1' }], ['scheduled', { facebook: '100_1', instagram: '179_1' }], ['published', { facebook: '100_1', instagram: '179_1' }]]);
});

test('a post is never published twice: a retry skips the channel that already went out', async () => {
  let fb = 0; let ig = 0;
  const meta = { id: 'meta', actions: { publishPagePost: async () => { fb += 1; return { id: '100_1' }; }, publishInstagram: async () => { ig += 1; if (ig === 1) throw new ProviderError('media_processing'); return { id: '179_1' }; } } };
  const post = { id: 'p1', status: 'scheduled', text: 'x', channels: ['facebook', 'instagram'], media: [{ path: 'a' }], published: {} };
  let log = world({ db: { social_post_claim: post, social_post_result: true }, adapters: { meta }, media: { url: 'https://files.example.com/a.jpg' } });
  await fails(publishPost(job({ post: 'p1' })), 'media_processing', false);
  assert.deepEqual(results(log, 'social_post_result').map((r) => r.p_status), ['scheduled'], 'not failed yet: it is tried again');
  log = world({ db: { social_post_claim: { ...post, published: { facebook: '100_1' } }, social_post_result: true }, adapters: { meta }, media: { url: 'https://files.example.com/a.jpg' } });
  assert.deepEqual(await publishPost(job({ post: 'p1' }, { attempts: 2 })), { published: ['facebook', 'instagram'] });
  assert.equal(fb, 1, 'the Page post went out once');
});

test('a post that cannot go out is marked failed with the code; a text-only post needs no media', async () => {
  const post = { id: 'p1', status: 'scheduled', text: 'x', channels: ['facebook'], media: null, published: {} };
  let log = world({ db: { social_post_claim: post, social_post_result: true }, adapters: { meta: { id: 'meta', actions: { publishPagePost: async () => { throw new ProviderError('permission_revoked', { reauth: true }); } } } } });
  await fails(publishPost(job({ post: 'p1' })), 'permission_revoked', true);
  assert.deepEqual(results(log, 'social_post_result').map((r) => [r.p_status, r.p_error]), [['failed', 'permission_revoked']]);
  // The file of a post cannot be handed to a provider yet (no media resolver): said as it is, never published without it.
  log = world({ db: { social_post_claim: { ...post, media: [{ path: 'a' }] }, social_post_result: true }, adapters: { meta: { id: 'meta', actions: { publishPagePost: async () => ({ id: 'never' }) } } } });
  await fails(publishPost(job({ post: 'p1' })), 'media_unavailable', true);
  log = world({ db: { social_post_claim: { ...post, channels: ['instagram'] }, social_post_result: true }, adapters: { meta: { id: 'meta', actions: {} } } });
  await fails(publishPost(job({ post: 'p1' })), 'media_unavailable', true);
  log = world({ db: { social_post_claim: { ...post, channels: ['gbp'] }, social_post_result: true } });
  await fails(publishPost(job({ post: 'p1' })), 'not_built', true);
  world({ db: { social_post_claim: { ...post, status: 'published' } } });
  assert.deepEqual(await publishPost(job({ post: 'p1' })), { skipped: true });
  world({ db: { social_post_claim: post, social_post_result: true }, adapters: { meta: { id: 'meta', actions: { publishPagePost: async () => { throw new ProviderError('rate_limited'); } } } } });
  await fails(publishPost(job({ post: 'p1' }, { attempts: 5 })), 'rate_limited', true);
});

test('token refresh: Meta\'s long-lived token is renewed a week ahead, left alone before, and a dead one asks to connect again', async () => {
  const now = Date.parse('2026-03-01T00:00:00Z');
  const row = { state: 'connected', token_enc: 'sealed' };
  let renewed = 0;
  const refresh = async () => { renewed += 1; return {}; };
  world({ adapters: { meta: { id: 'meta' } }, row, tokens: { access_token: 'a', expires_at: '2026-03-05T00:00:00Z' }, refresh });
  assert.deepEqual(await renewToken(job({ provider: 'meta' }), now), { renewed: true });
  world({ adapters: { meta: { id: 'meta' } }, row, tokens: { access_token: 'a', expires_at: '2026-04-20T00:00:00Z' }, refresh });
  assert.deepEqual(await renewToken(job({ provider: 'meta' }), now), { skipped: 'not_due' });
  world({ adapters: { meta: { id: 'meta' } }, row: null, refresh });
  assert.deepEqual(await renewToken(job({ provider: 'meta' }), now), { skipped: 'not_connected' });
  assert.equal(renewed, 1);
  world({ adapters: { meta: { id: 'meta' } }, row, tokens: { access_token: 'a', expires_at: '2026-03-02T00:00:00Z' }, refresh: async () => { throw new ProviderError('token_expired', { reauth: true }); } });
  await fails(renewToken(job({ provider: 'meta' }), now), 'token_expired', true);
  world({ adapters: { meta: { id: 'meta' } }, row, tokens: { access_token: 'a', expires_at: '2026-03-02T00:00:00Z' }, refresh: async () => { throw new ProviderError('provider_unreachable'); } });
  await fails(renewToken(job({ provider: 'meta' }), now), 'provider_unreachable', false);
  world({ adapters: { meta: { id: 'meta' } }, row, tokens: null });
  await fails(renewToken(job({ provider: 'meta' }), now), 'token_unreadable', true);
});

test('scheduled runs queue each due post and message once, and the daily run looks at Meta connections only', async () => {
  const queuedJobs = [];
  const enqueue = async (kind, payload, opts) => { queuedJobs.push({ kind, payload, opts }); return 'job-id'; };
  world({ db: { social_posts_due: [{ id: 'p1', tenant_id: TENANT, scheduled_for: '2026-03-01T15:00:00Z' }], messaging_outbox_due: [{ id: 'm1', tenant_id: TENANT }, { id: 'm2', tenant_id: TENANT }], conn_connected: [{ tenant_id: TENANT, provider: 'meta' }, { tenant_id: TENANT, provider: 'resend' }] } });
  assert.deepEqual(await messagingTick({ enqueue }), { posts: 1, messages: 2 });
  assert.deepEqual(queuedJobs.map((j) => [j.kind, j.payload, j.opts.tenant, j.opts.idem]), [['social.publish', { post: 'p1' }, TENANT, 'post:p1:2026-03-01T15:00:00Z'], ['messaging.send', { message: 'm1' }, TENANT, 'msg:m1'], ['messaging.send', { message: 'm2' }, TENANT, 'msg:m2']]);
  queuedJobs.length = 0;
  assert.deepEqual(await messagingDaily({ enqueue }), { renewQueued: 1 });
  assert.equal(queuedJobs[0].kind, 'messaging.token_renew'); assert.deepEqual(queuedJobs[0].payload, { provider: 'meta' });
  // The database functions are not installed yet: the run does nothing and does not throw.
  world({ db: {} });
  assert.deepEqual(await messagingTick({ enqueue }), { posts: 0, messages: 0 });
});
