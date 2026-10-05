// The Dialpad adapter, tested with mocked provider responses. Nothing is called or sent anywhere.
// Not proven against the live service: no Dialpad account exists in this build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { setTestEnv, ORIGIN } from '../server/helpers.mjs';

const HOOK_SECRET = 'dp_hook_' + randomBytes(16).toString('hex');
const CLIENT_SECRET = 'dp_secret_' + randomBytes(16).toString('hex');
setTestEnv({ DIALPAD_CLIENT_ID: 'dp-client', DIALPAD_CLIENT_SECRET: CLIENT_SECRET, DIALPAD_WEBHOOK_SECRET: HOOK_SECRET });
for (const k of ['DIALPAD_AUTH_MODE', 'DIALPAD_API_KEY', 'DIALPAD_APPROVED', 'DIALPAD_ENVIRONMENT', 'DIALPAD_SMS_ENABLED', 'DIALPAD_WEBHOOK_MAX_AGE_S']) delete process.env[k];
const mod = await import('../../api/_lib/integrations/providers/dialpad.js');
const dialpad = mod.default;
const { hookSecret, hookUrl, callToMessage } = mod;
const { ProviderError } = await import('../../api/_lib/integrations/oauth.js');
const { configState } = await import('../../api/_lib/integrations/core.js');
const { ingestInbound } = await import('../../api/_lib/integrations/messaging/ingest.js');
const { env } = await import('../../api/_lib/env.js');

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const CLIENT = '+15555550142';
const OFFICE = '+15555550100';
const LEAK = 'User sample.owner@example.com (5550001) on plan Standard may not do this';
const reply = (status, body) => new Response(JSON.stringify(body), { status });
const consent = (over = {}) => ({ status: 'opted_in', channel: 'text', address: CLIENT, grantedAt: '2026-01-02T10:00:00.000Z', ...over });

function ctxWith(responder, more = {}) {
  const calls = []; const stored = [];
  const ctx = {
    provider: 'dialpad', tenantId: TENANT, env, now: () => Date.now(), redirectUri: ORIGIN + '/api/integrations/dialpad/callback', tokens: { access_token: 'dp-access', refresh_token: 'dp-refresh', scope: 'calls:list offline_access' }, connection: null,
    rpc: async (name, args) => { stored.push({ name, args }); return { ok: true, data: {} }; },
    fetch: async (url, init = {}) => { const u = new URL(String(url)); calls.push({ url: String(url), path: u.pathname, q: Object.fromEntries(u.searchParams), init, body: init.body }); return responder(u.pathname, init, u); }, ...more,
  };
  return { ctx, calls, stored };
}
const rejects = (p, code, extra = () => true) => assert.rejects(p, (e) => e instanceof ProviderError && e.code === code && !String(e.message).includes('example.com') && extra(e), code);
const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
const jwt = (payload, secret, alg = 'HS256') => { const head = b64({ alg, typ: 'JWT' }) + '.' + b64(payload); return head + '.' + (alg === 'none' ? '' : createHmac('sha256', secret).update(head).digest('base64url')); };
const hook = (token, tenant = TENANT) => { const raw = Buffer.from(token); return [new Request(ORIGIN + '/api/webhooks/dialpad' + (tenant ? '?t=' + tenant : ''), { method: 'POST', headers: { 'content-type': 'application/jwt' }, body: raw }), raw]; };
const hctx = { provider: 'dialpad', env, now: () => Date.now() };
const secretFor = (t) => hookSecret(hctx, t);
const callEvent = (over = {}) => ({ call_id: 5068687212453888, state: 'hangup', direction: 'inbound', external_number: CLIENT, internal_number: OFFICE, date_started: Date.now() - 200000, date_connected: Date.now() - 190000, date_ended: Date.now() - 65000, event_timestamp: Date.now(), target: { id: 5550001, type: 'user', name: 'Sample Owner', email: 'Sample.Owner@example.com' }, contact: { name: 'Sample Person', phone: CLIENT }, ...over });
const smsEvent = (over = {}) => ({ id: 6001, direction: 'inbound', from_number: CLIENT, to_number: [OFFICE], text: 'Can I come by at three?', message_status: 'success', created_date: Date.now(), event_timestamp: Date.now(), ...over });

test('shape: OAuth by default, pending approval until the flag says approved', () => {
  assert.equal(dialpad.id, 'dialpad'); assert.equal(dialpad.kind, 'oauth');
  assert.deepEqual(dialpad.env, ['DIALPAD_CLIENT_ID', 'DIALPAD_CLIENT_SECRET', 'DIALPAD_WEBHOOK_SECRET']);
  assert.deepEqual(dialpad.scopes, ['calls:list', 'offline_access']);
  for (const fn of ['authUrl', 'exchange', 'refresh', 'revoke', 'status', 'health', 'sync']) assert.equal(typeof dialpad[fn], 'function', fn);
  for (const fn of ['verify', 'handle', 'inbound']) assert.equal(typeof dialpad.webhook[fn], 'function', fn);
  for (const fn of ['listUsers', 'listNumbers', 'subscribeEvents', 'clickToCall', 'sendSms']) assert.equal(typeof dialpad.actions[fn], 'function', fn);
  assert.equal(configState({ ...dialpad, built: true }).state, 'pending_approval');
  process.env.DIALPAD_APPROVED = 'true';
  assert.equal(configState({ ...dialpad, built: true }).state, 'setup');
  delete process.env.DIALPAD_APPROVED;
});

test('shape: with an admin API key it is a key connection, with its own settings and no app review', async () => {
  process.env.DIALPAD_AUTH_MODE = 'api_key';
  assert.equal(dialpad.kind, 'key'); assert.deepEqual(dialpad.env, ['DIALPAD_API_KEY', 'DIALPAD_WEBHOOK_SECRET']); assert.equal(dialpad.approval, null);
  assert.deepEqual(configState({ ...dialpad, built: true }), { state: 'not_connected', reason: 'not_configured', missing: ['DIALPAD_API_KEY'] });
  process.env.DIALPAD_API_KEY = 'dp-admin-key';
  assert.equal(configState({ ...dialpad, built: true }).state, 'setup');
  const { ctx, calls } = ctxWith(() => reply(200, { id: 4400001, name: 'Sample Bakery (sample)', domain: 'example.com' }), { tokens: null });
  assert.deepEqual(await dialpad.status(ctx), { ok: true, account: { label: 'Sample Bakery (sample)', ref: '4400001' }, scopes: [] });
  assert.equal(calls[0].init.headers.authorization, 'Bearer dp-admin-key');
  assert.deepEqual(await dialpad.refresh(ctx, { access_token: 'k' }), { access_token: 'k' });
  delete process.env.DIALPAD_AUTH_MODE; delete process.env.DIALPAD_API_KEY;
  await rejects(dialpad.status(ctxWith(() => reply(200, {}), { tokens: null }).ctx), 'not_connected');
});

test('connect: consent address with PKCE, code exchanged server side, status answers for the company', async () => {
  const { ctx, calls } = ctxWith((path) => path === '/oauth2/token' ? reply(200, { access_token: 'dp-access', refresh_token: 'dp-refresh', expires_in: 3600, token_type: 'bearer' }) : reply(200, { id: 4400001, name: 'Sample Bakery (sample)' }));
  const url = new URL(dialpad.authUrl({ ...ctx, state: 'st.ate', challenge: 'chal' }));
  assert.equal(url.origin + url.pathname, 'https://dialpad.com/oauth2/authorize');
  assert.equal(url.searchParams.get('code_challenge'), 'chal'); assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.equal(url.searchParams.get('scope'), 'calls:list offline_access');
  assert.ok(!url.toString().includes(CLIENT_SECRET));
  const tokens = await dialpad.exchange({ ...ctx, verifier: 'ver' }, 'the-code');
  assert.equal(tokens.access_token, 'dp-access'); assert.equal(tokens.refresh_token, 'dp-refresh'); assert.ok(Date.parse(tokens.expires_at) > Date.now());
  const form = new URLSearchParams(calls[0].body);
  assert.equal(form.get('code_verifier'), 'ver'); assert.equal(form.get('client_secret'), CLIENT_SECRET); assert.equal(form.get('grant_type'), 'authorization_code');
  const s = await dialpad.status({ ...ctx, tokens });
  assert.deepEqual(s, { ok: true, account: { label: 'Sample Bakery (sample)', ref: '4400001' }, scopes: ['calls:list', 'offline_access'] });
  assert.equal(calls[1].url, 'https://dialpad.com/api/v2/company'); assert.equal(calls[1].init.headers.authorization, 'Bearer dp-access');
  process.env.DIALPAD_ENVIRONMENT = 'sandbox';
  assert.ok(dialpad.authUrl({ ...ctx, state: 's', challenge: 'c' }).startsWith('https://sandbox.dialpad.com/oauth2/authorize'));
  delete process.env.DIALPAD_ENVIRONMENT;
});

test('reconnect: the refresh token is exchanged and a rotated one is kept; disconnect ends the grant', async () => {
  const { ctx, calls } = ctxWith((path) => path === '/oauth2/token' ? reply(200, { access_token: 'dp-access-2', refresh_token: 'dp-refresh-2', expires_in: 3600 }) : reply(200, {}));
  const next = await dialpad.refresh(ctx, { access_token: 'old', refresh_token: 'dp-refresh', scope: 'calls:list offline_access' });
  assert.equal(next.access_token, 'dp-access-2'); assert.equal(next.refresh_token, 'dp-refresh-2'); assert.equal(next.scope, 'calls:list offline_access');
  assert.equal(new URLSearchParams(calls[0].body).get('refresh_token'), 'dp-refresh');
  await dialpad.revoke(ctx, { access_token: 'dp-access-2' });
  assert.equal(calls[1].url, 'https://dialpad.com/oauth2/deauthorize'); assert.equal(calls[1].init.headers.authorization, 'Bearer dp-access-2');
  await rejects(dialpad.revoke(ctxWith(() => reply(500, {})).ctx, { access_token: 'x' }), 'revoke_failed');
});

test('expired token, revoked permission, wrong account, outage, rate limit, malformed answer', async () => {
  await rejects(dialpad.refresh(ctxWith(() => reply(400, { error: 'invalid_grant', error_description: LEAK })).ctx, { refresh_token: 'dead' }), 'invalid_grant', (e) => e.reauth === true);
  await rejects(dialpad.status(ctxWith(() => reply(401, { error: { message: LEAK } })).ctx), 'token_rejected', (e) => e.reauth === true);
  assert.deepEqual(await dialpad.health(ctxWith(() => reply(401, {})).ctx), { ok: false, reason: 'token_rejected', reauth: true });
  await rejects(dialpad.status(ctxWith(() => reply(403, { error: { message: LEAK } })).ctx), 'not_allowed', (e) => e.reauth === false);
  assert.deepEqual(await dialpad.status(ctxWith(() => reply(200, { id: 4400002, name: 'Another company' }), { connection: { account_ref: '4400001' } }).ctx), { ok: false, reason: 'wrong_account' });
  assert.deepEqual(await dialpad.status(ctxWith(() => reply(200, { name: 'no id' })).ctx), { ok: false, reason: 'account_unknown' });
  await rejects(dialpad.status(ctxWith(() => { throw new TypeError('fetch failed'); }).ctx), 'provider_unreachable');
  await rejects(dialpad.status(ctxWith(() => new Response('bad gateway', { status: 502 })).ctx), 'provider_error');
  await rejects(dialpad.status(ctxWith(() => reply(429, { error: LEAK })).ctx), 'rate_limited');
  await rejects(dialpad.status(ctxWith(() => new Response('<html>ok</html>', { status: 200 })).ctx), 'provider_error');
});

test('users and numbers', async () => {
  const u = ctxWith(() => reply(200, { cursor: 'next1', items: [{ id: 5550001, display_name: 'Sample Owner', emails: ['Sample.Owner@example.com'], phone_numbers: ['+15555550101'], state: 'active' }, { id: 5550002, first_name: 'Sample', last_name: 'Staff', emails: [], phone_numbers: [] }] }));
  assert.deepEqual(await dialpad.actions.listUsers(u.ctx), { cursor: 'next1', users: [{ id: '5550001', name: 'Sample Owner', email: 'sample.owner@example.com', numbers: ['+15555550101'], state: 'active' }, { id: '5550002', name: 'Sample Staff', email: '', numbers: [], state: '' }] });
  assert.equal(u.calls[0].path, '/api/v2/users');
  const n = ctxWith(() => reply(200, { items: [{ number: OFFICE, status: 'office', target_type: 'office', target_id: 77 }, { number: 'bad' }] }));
  assert.deepEqual(await dialpad.actions.listNumbers(n.ctx), { cursor: '', numbers: [{ number: OFFICE, status: 'office', targetType: 'office', targetId: '77' }] });
});

test('call log normalization: direction, from, to, duration, state, voicemail reference, user', () => {
  const answered = callToMessage(callEvent());
  assert.deepEqual(answered.message, { at: answered.message.at, channel: 'call', to: OFFICE, subject: 'answered', body: '', status: 'received', dir: 'in', from: CLIENT, provider: 'dialpad', externalId: '5068687212453888', threadId: 'call:' + CLIENT, read: false, seconds: 125 });
  assert.deepEqual(answered.match, { phone: CLIENT, phoneKey: '5555550142', agent: { id: '5550001', email: 'sample.owner@example.com', name: 'Sample Owner' }, name: 'Sample Person' });
  assert.deepEqual(answered.extra, { state: 'hangup', outcome: 'answered', target: { type: 'user', id: '5550001' } });
  const vm = callToMessage(callEvent({ state: 'voicemail', date_connected: null, voicemail_link: 'https://dialpad.com/v/abc', voicemail_recording_id: 'rec_9' }));
  assert.equal(vm.message.subject, 'voicemail'); assert.deepEqual(vm.extra.voicemail, { ref: 'rec_9' }); assert.equal(vm.message.seconds, 0);
  const missed = callToMessage(callEvent({ state: 'missed', date_connected: null, date_ended: null }));
  assert.equal(missed.message.subject, 'missed');
  const out = callToMessage(callEvent({ direction: 'outbound', date_connected: null, date_ended: null, duration: 61000, target: { id: 9, type: 'office' } }));
  assert.equal(out.message.dir, 'out'); assert.equal(out.message.status, 'sent'); assert.equal(out.message.from, OFFICE); assert.equal(out.message.to, CLIENT); assert.equal(out.message.seconds, 61); assert.equal(out.message.subject, 'no_answer');
  assert.equal(out.match.agent, undefined, 'a call taken by an office line is not attributed to a person');
});

test('webhook: a call event signed with the company\'s secret is accepted and reduced to ids', () => {
  const [rq, raw] = hook(jwt(callEvent(), secretFor(TENANT)));
  const v = dialpad.webhook.verify(rq, raw, hctx);
  assert.equal(v.ok, true); assert.equal(v.tenantId, TENANT); assert.equal(v.type, 'call.hangup'); assert.equal(v.eventId, 'call:5068687212453888:hangup');
  assert.deepEqual(v.redacted, { type: 'call', call_id: '5068687212453888', state: 'hangup', direction: 'inbound', seconds: 125 });
  const stored = JSON.stringify(v);
  assert.ok(!stored.includes('5555550142') && !stored.includes('5555550100'), 'no phone number in what is stored');
  assert.ok(!stored.includes('Sample') && !stored.includes('example.com'), 'no name and no email in what is stored');
  assert.equal(hookUrl('https://app.example.com', TENANT), 'https://app.example.com/api/webhooks/dialpad?t=' + TENANT);
  // Without a company in the address, the deployment's own secret is the one that must match.
  const [r0, w0] = hook(jwt(callEvent({ company_id: 4400001 }), HOOK_SECRET), null);
  const v0 = dialpad.webhook.verify(r0, w0, hctx);
  assert.equal(v0.ok, true); assert.equal(v0.tenantId, null); assert.equal(v0.accountRef, '4400001');
});

test('webhook: bad signature, another company\'s secret, unsigned token, duplicate event, malformed payload, replay', () => {
  let [rq, raw] = hook(jwt(callEvent(), 'not-the-secret'));
  assert.equal(dialpad.webhook.verify(rq, raw, hctx).reason, 'bad_signature');
  // Signed for one company and sent to another company's address: the claim in the address is not believed.
  [rq, raw] = hook(jwt(callEvent(), secretFor(OTHER_TENANT)), TENANT);
  assert.equal(dialpad.webhook.verify(rq, raw, hctx).reason, 'bad_signature');
  [rq, raw] = hook(jwt(callEvent(), secretFor(TENANT), 'none'));
  assert.equal(dialpad.webhook.verify(rq, raw, hctx).ok, false);
  [rq, raw] = hook(b64({ alg: 'none' }) + '.' + b64(callEvent()) + '.AAAA');
  assert.equal(dialpad.webhook.verify(rq, raw, hctx).reason, 'bad_signature');
  [rq, raw] = hook(JSON.stringify(callEvent()));
  assert.equal(dialpad.webhook.verify(rq, raw, hctx).reason, 'signature_missing', 'an event that is not a signed token is refused');

  const ev = callEvent();
  const [a, ra] = hook(jwt(ev, secretFor(TENANT))); const [b, rb] = hook(jwt({ ...ev, event_timestamp: Date.now() + 5 }, secretFor(TENANT)));
  assert.equal(dialpad.webhook.verify(a, ra, hctx).eventId, dialpad.webhook.verify(b, rb, hctx).eventId, 'the same call in the same state is one event');
  const [c, rc] = hook(jwt({ ...ev, state: 'voicemail' }, secretFor(TENANT)));
  assert.notEqual(dialpad.webhook.verify(a, ra, hctx).eventId, dialpad.webhook.verify(c, rc, hctx).eventId);

  for (const bad of [{ event_timestamp: Date.now() }, { call_id: 1, state: 'Bad State!', event_timestamp: Date.now() }, { text: 'x', event_timestamp: Date.now() }]) {
    [rq, raw] = hook(jwt(bad, secretFor(TENANT)));
    assert.equal(dialpad.webhook.verify(rq, raw, hctx).reason, 'bad_payload', JSON.stringify(bad));
  }
  const head = b64({ alg: 'HS256' }) + '.' + Buffer.from('[1,2]').toString('base64url');
  [rq, raw] = hook(head + '.' + createHmac('sha256', secretFor(TENANT)).update(head).digest('base64url'));
  assert.equal(dialpad.webhook.verify(rq, raw, hctx).reason, 'bad_payload');
  [rq, raw] = hook(jwt(callEvent({ event_timestamp: Date.now() - 20 * 60000 }), secretFor(TENANT)));
  assert.equal(dialpad.webhook.verify(rq, raw, hctx).reason, 'stale');
  [rq, raw] = hook(jwt({ ...callEvent(), exp: Math.floor(Date.now() / 1000) - 10 }, secretFor(TENANT)));
  assert.equal(dialpad.webhook.verify(rq, raw, hctx).reason, 'stale');
  const keep = process.env.DIALPAD_WEBHOOK_SECRET; delete process.env.DIALPAD_WEBHOOK_SECRET;
  [rq, raw] = hook(jwt(callEvent(), 'x'));
  assert.equal(dialpad.webhook.verify(rq, raw, hctx).reason, 'not_configured');
  process.env.DIALPAD_WEBHOOK_SECRET = keep;
});

test('webhook processing: a finished call is read by id and stored once as a call record', async () => {
  const { ctx, calls, stored } = ctxWith(() => reply(200, callEvent({ state: undefined })));
  assert.deepEqual(await dialpad.webhook.handle(ctx, { redacted: { type: 'call', call_id: '5068687212453888', state: 'hangup' } }), { ok: true, stored: 1 });
  assert.equal(calls[0].path, '/api/v2/call/5068687212453888');
  const m = stored[0].args.p_batch.messages[0];
  assert.equal(stored[0].name, 'messaging_ingest'); assert.equal(stored[0].args.p_provider, 'dialpad');
  assert.equal(m.message.channel, 'call'); assert.equal(m.message.externalId, '5068687212453888'); assert.equal(m.message.seconds, 125); assert.equal(m.message.from, CLIENT); assert.equal(m.match.agent.email, 'sample.owner@example.com');
  const still = ctxWith(() => reply(200, {}));
  assert.deepEqual(await dialpad.webhook.handle(still.ctx, { redacted: { type: 'call', call_id: '1', state: 'ringing' } }), { ok: true, ignored: true });
  assert.deepEqual(await dialpad.webhook.handle(still.ctx, { redacted: { type: 'sms', id: '6001' } }), { ok: true, ignored: true });
  assert.equal(still.calls.length, 0);
  await rejects(dialpad.webhook.handle(ctxWith(() => reply(401, {})).ctx, { redacted: { type: 'call', call_id: '1', state: 'hangup' } }), 'token_rejected', (e) => e.reauth === true);
});

test('successful sync: the call log is read from where the last run stopped', async () => {
  const cursor = new Map([['calls', '1767600000000']]);
  const { ctx, calls, stored } = ctxWith((path, init, u) => reply(200, u.searchParams.get('cursor') ? { items: [callEvent({ call_id: 3, date_started: 1767600300000 })] } : { cursor: 'page2', items: [callEvent({ call_id: 1, date_started: 1767600100000 }), callEvent({ call_id: 2, date_started: 1767600200000, state: 'missed' })] }), { cursor: { get: async (r) => cursor.get(r) || null, set: async (r, v) => { cursor.set(r, v); return true; } } });
  assert.deepEqual(await dialpad.sync(ctx, 'all'), { counts: { calls: 3 } });
  assert.equal(calls[0].q.started_after, '1767600000000'); assert.equal(calls[1].q.cursor, 'page2');
  assert.deepEqual(stored[0].args.p_batch.messages.map((m) => m.message.externalId), ['1', '2', '3']);
  assert.equal(cursor.get('calls'), '1767600300000');
  await rejects(dialpad.sync(ctxWith(() => reply(403, {})).ctx), 'not_allowed');
});

test('subscribing to call events: a webhook with the company\'s own secret, then the subscription', async () => {
  const { ctx, calls } = ctxWith((path) => path.endsWith('/webhooks') ? reply(200, { id: 9001, hook_url: 'x' }) : reply(200, { id: 9002 }));
  assert.deepEqual(await dialpad.actions.subscribeEvents(ctx, { origin: 'https://app.example.com' }), { settings: { webhook_id: '9001', call_subscription_id: '9002', sms_subscription_id: '' } });
  assert.deepEqual(JSON.parse(calls[0].body), { hook_url: 'https://app.example.com/api/webhooks/dialpad?t=' + TENANT, secret: secretFor(TENANT) });
  assert.notEqual(secretFor(TENANT), HOOK_SECRET, 'the deployment secret itself is never handed to Dialpad per company');
  assert.notEqual(secretFor(TENANT), secretFor(OTHER_TENANT));
  assert.deepEqual(JSON.parse(calls[1].body), { webhook_id: '9001', call_states: ['hangup', 'missed', 'voicemail', 'voicemail_uploaded'], enabled: true });
  assert.equal(calls.length, 2, 'text events are not asked for unless enabled');
  process.env.DIALPAD_SMS_ENABLED = 'true';
  const refused = ctxWith((path) => path.endsWith('/webhooks') ? reply(200, { id: 1 }) : path.endsWith('/subscriptions/sms') ? reply(403, { error: LEAK }) : reply(200, { id: 2 }));
  assert.deepEqual((await dialpad.actions.subscribeEvents(refused.ctx, { origin: 'https://app.example.com' })).settings, { webhook_id: '1', call_subscription_id: '2', sms_subscription_id: '', sms_refused: 'not_allowed' });
  delete process.env.DIALPAD_SMS_ENABLED;
  await rejects(dialpad.actions.subscribeEvents(ctx, { origin: 'http://plain.example.com' }), 'request_rejected');
});

test('click to call: through the API where allowed, otherwise a link that is flagged as a link', async () => {
  const ok = ctxWith(() => reply(200, { device: { id: 'd1' } }));
  assert.deepEqual(await dialpad.actions.clickToCall(ok.ctx, { to: '(555) 555-0142', userId: '5550001' }), { placed: true, mode: 'api', deepLink: false });
  assert.equal(ok.calls[0].path, '/api/v2/users/5550001/initiate_call'); assert.deepEqual(JSON.parse(ok.calls[0].body), { phone_number: CLIENT });
  for (const [status, reason] of [[403, 'not_allowed'], [404, 'not_found'], [402, 'plan_not_supported']]) {
    assert.deepEqual(await dialpad.actions.clickToCall(ctxWith(() => reply(status, { error: LEAK })).ctx, { to: CLIENT, userId: '5550001' }), { placed: false, mode: 'deep_link', deepLink: true, link: 'dialpad://+15555550142', tel: 'tel:+15555550142', reason });
  }
  const none = ctxWith(() => reply(200, {}));
  assert.deepEqual(await dialpad.actions.clickToCall(none.ctx, { to: CLIENT }), { placed: false, mode: 'deep_link', deepLink: true, link: 'dialpad://+15555550142', tel: 'tel:+15555550142', reason: 'no_user' });
  assert.equal((await dialpad.actions.clickToCall(none.ctx, { to: CLIENT, userId: '5550001', viaApi: false })).placed, false);
  assert.equal(none.calls.length, 0);
  // An outage or an expired token is not dressed up as a link: the caller hears about it.
  await rejects(dialpad.actions.clickToCall(ctxWith(() => reply(401, {})).ctx, { to: CLIENT, userId: '5550001' }), 'token_rejected');
  await rejects(dialpad.actions.clickToCall(ctxWith(() => reply(503, {})).ctx, { to: CLIENT, userId: '5550001' }), 'provider_error');
  await rejects(dialpad.actions.clickToCall(none.ctx, { to: 'nope' }), 'recipient_invalid');
});

test('text messages: sent with consent, refused without it and in quiet hours', async () => {
  const { ctx, calls } = ctxWith(() => reply(200, { id: 7001, message_status: 'pending' }));
  const sent = await dialpad.actions.sendSms(ctx, { to: CLIENT, text: 'Your order is ready.', consent: consent(), fromNumber: OFFICE });
  assert.equal(sent.id, '7001'); assert.equal(sent.status, 'queued'); assert.equal(sent.message.status, 'queued'); assert.equal(sent.message.channel, 'text');
  assert.equal(calls[0].path, '/api/v2/sms'); assert.deepEqual(JSON.parse(calls[0].body), { to_numbers: [CLIENT], text: 'Your order is ready.', infer_country_code: false, from_number: OFFICE });
  const none = ctxWith(() => reply(200, { id: 1 }));
  await rejects(dialpad.actions.sendSms(none.ctx, { to: CLIENT, text: 'x', fromNumber: OFFICE }), 'consent_missing');
  await rejects(dialpad.actions.sendSms(none.ctx, { to: CLIENT, text: 'x', fromNumber: OFFICE, consent: consent({ status: 'opted_out' }) }), 'consent_revoked');
  await rejects(dialpad.actions.sendSms(none.ctx, { to: CLIENT, text: 'x', fromNumber: OFFICE, consent: consent({ channel: 'whatsapp' }) }), 'consent_mismatch');
  await rejects(dialpad.actions.sendSms({ ...none.ctx, now: () => Date.parse('2026-01-05T03:30:00Z') }, { to: CLIENT, text: 'x', fromNumber: OFFICE, consent: consent(), quietHours: { start: '21:00', end: '08:00', timeZone: 'America/New_York' } }), 'quiet_hours');
  await rejects(dialpad.actions.sendSms(none.ctx, { to: CLIENT, text: 'x', consent: consent() }), 'sender_invalid');
  assert.equal(none.calls.length, 0);
  await rejects(dialpad.actions.sendSms(ctxWith(() => reply(403, { error: LEAK })).ctx, { to: CLIENT, text: 'x', consent: consent(), fromNumber: OFFICE }), 'not_allowed');
});

test('text events: an incoming text and STOP are returned for storage; the event log keeps ids only', async () => {
  let [rq, raw] = hook(jwt(smsEvent(), secretFor(TENANT)));
  const v = dialpad.webhook.verify(rq, raw, hctx);
  assert.equal(v.type, 'sms.inbound'); assert.equal(v.eventId, 'sms:6001:success'); assert.deepEqual(v.redacted, { type: 'sms', id: '6001', direction: 'inbound', status: 'success' });
  assert.ok(!JSON.stringify(v).includes('come by') && !JSON.stringify(v).includes('5555550142'));
  let [g] = dialpad.webhook.inbound(rq, raw, hctx);
  assert.equal(g.tenantId, TENANT); assert.equal(g.messages[0].message.body, 'Can I come by at three?'); assert.equal(g.messages[0].message.from, CLIENT); assert.equal(g.messages[0].message.channel, 'text'); assert.deepEqual(g.consent, []);
  [rq, raw] = hook(jwt(smsEvent({ id: 6002, text: 'STOP' }), secretFor(TENANT)));
  [g] = dialpad.webhook.inbound(rq, raw, hctx);
  assert.deepEqual(g.consent.map((c) => [c.action, c.channel, c.address]), [['opt_out', 'text', CLIENT]]);
  const seen = [];
  assert.deepEqual(await ingestInbound({ ...dialpad, built: true }, { request: rq, raw, ctx: hctx, rpc: async (name, args) => { seen.push({ name, args }); return { ok: true, data: {} }; } }), { ok: true, stored: 2, skipped: 0 });
  assert.deepEqual(seen.map((s) => s.name), ['messaging_ingest'], 'the company comes from the signed address, no lookup needed');
  assert.equal(seen[0].args.p_tenant, TENANT);
  [rq, raw] = hook(jwt(smsEvent({ id: 7001, direction: 'outbound', message_status: 'failed' }), secretFor(TENANT)));
  [g] = dialpad.webhook.inbound(rq, raw, hctx);
  assert.deepEqual([g.statuses[0].externalId, g.statuses[0].status, g.statuses[0].error], ['7001', 'failed', 'delivery_failed']);
  // A forged body gives nothing to store, and a call event has no text to store here.
  [rq, raw] = hook(jwt(smsEvent(), 'wrong'));
  assert.deepEqual(dialpad.webhook.inbound(rq, raw, hctx), []);
  [rq, raw] = hook(jwt(callEvent(), secretFor(TENANT)));
  assert.deepEqual(dialpad.webhook.inbound(rq, raw, hctx), []);
});
