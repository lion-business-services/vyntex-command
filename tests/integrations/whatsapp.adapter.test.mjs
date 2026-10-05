// The WhatsApp Business adapter (Cloud API), tested with mocked provider responses. Nothing is sent anywhere.
// Not proven against the live service: no WhatsApp Business account exists in this build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { setTestEnv, ORIGIN } from '../server/helpers.mjs';

const SECRET = 'appsecret_' + randomBytes(16).toString('hex');
const VERIFY = 'verify_' + randomBytes(12).toString('hex');
const TOKEN = 'sysuser_' + randomBytes(16).toString('hex');
const PHONE_ID = '106540352242922';
const WABA = '102290129340398';
setTestEnv({ META_APP_SECRET: SECRET, WHATSAPP_WEBHOOK_VERIFY_TOKEN: VERIFY, WHATSAPP_SYSTEM_USER_TOKEN: TOKEN, WHATSAPP_PHONE_NUMBER_ID: PHONE_ID, WHATSAPP_BUSINESS_ACCOUNT_ID: WABA });
for (const k of ['WHATSAPP_APPROVED', 'META_GRAPH_VERSION', 'WHATSAPP_WEBHOOK_MAX_AGE_S']) delete process.env[k];
const wa = (await import('../../api/_lib/integrations/providers/whatsapp.js')).default;
const { ProviderError } = await import('../../api/_lib/integrations/oauth.js');
const { configState } = await import('../../api/_lib/integrations/core.js');
const { ingestInbound } = await import('../../api/_lib/integrations/messaging/ingest.js');
const { env } = await import('../../api/_lib/env.js');

const TENANT = '11111111-1111-4111-8111-111111111111';
const CLIENT = '+15555550142';
const LEAK = 'Recipient 15555550142 of account Sample Bakery is not reachable';
const reply = (status, body) => new Response(JSON.stringify(body), { status });
const gerr = (status, code, sub) => reply(status, { error: { message: LEAK, type: 'OAuthException', code, ...(sub ? { error_subcode: sub } : {}), error_data: { details: LEAK } } });
const consent = (over = {}) => ({ status: 'opted_in', channel: 'whatsapp', address: CLIENT, grantedAt: '2026-01-02T10:00:00.000Z', recordId: 'c1', ...over });
const TEMPLATES = { data: [
  { name: 'appointment_reminder', language: 'en_US', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'Hello {{1}}, your appointment is on {{2}}.' }] },
  { name: 'appointment_reminder', language: 'es', status: 'PENDING', category: 'UTILITY', components: [{ type: 'BODY', text: 'Hola {{1}}, su cita es el {{2}}.' }] },
  { name: 'spring_offer', language: 'en_US', status: 'REJECTED', category: 'MARKETING', components: [{ type: 'BODY', text: 'No parameters here.' }] },
  { name: 'hours_notice', language: 'en_US', status: 'PAUSED', category: 'UTILITY', components: [] },
] };

function ctxWith(responder, more = {}) {
  const calls = [];
  const ctx = { provider: 'whatsapp', tenantId: TENANT, env, now: () => Date.now(), tokens: null, connection: null, fetch: async (url, init = {}) => { const u = new URL(String(url)); calls.push({ url: String(url), path: u.pathname.replace('/v23.0', ''), q: Object.fromEntries(u.searchParams), init, body: init.body }); return responder(u.pathname.replace('/v23.0', ''), init, u); }, ...more };
  return { ctx, calls };
}
const rejects = (p, code, extra = () => true) => assert.rejects(p, (e) => e instanceof ProviderError && e.code === code && !String(e.message).includes('5555550142') && extra(e), code);
const sign = (raw) => 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex');
const hook = (payload, sig) => { const raw = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)); return [new Request(ORIGIN + '/api/webhooks/whatsapp', { method: 'POST', headers: { 'x-hub-signature-256': sig === undefined ? sign(raw) : sig }, body: raw }), raw]; };
const hctx = { provider: 'whatsapp', env, now: () => Date.now() };
const ts = () => String(Math.floor(Date.now() / 1000));
const value = (more) => ({ object: 'whatsapp_business_account', entry: [{ id: WABA, changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '15555550100', phone_number_id: PHONE_ID }, ...more } }] }] });
const WAMID = 'wamid.HBgLMTU1NTU1NTAxNDIVAgASGBQzQTdBNjU5';
const inboundEvent = (text = 'Is my return ready?', type = 'text') => value({ contacts: [{ profile: { name: 'Sample Person' }, wa_id: '15555550142' }], messages: [{ from: '15555550142', id: WAMID, timestamp: ts(), type, ...(type === 'text' ? { text: { body: text } } : { image: { id: 'media_778899', mime_type: 'image/jpeg', sha256: 'abc', caption: text } }) }] });

test('shape, a key connection, and pending approval until the flag says approved', () => {
  assert.equal(wa.id, 'whatsapp'); assert.equal(wa.kind, 'key');
  for (const fn of ['authUrl', 'exchange', 'refresh', 'revoke', 'status', 'health', 'sync']) assert.equal(typeof wa[fn], 'function', fn);
  for (const fn of ['verify', 'handle', 'challenge', 'inbound']) assert.equal(typeof wa.webhook[fn], 'function', fn);
  for (const fn of ['listTemplates', 'sendTemplate', 'sendText', 'send', 'downloadMedia']) assert.equal(typeof wa.actions[fn], 'function', fn);
  assert.equal(configState({ ...wa, built: true }).state, 'pending_approval');
  process.env.WHATSAPP_APPROVED = 'true';
  assert.equal(configState({ ...wa, built: true }).state, 'setup');
  delete process.env.WHATSAPP_APPROVED;
  const keep = process.env.WHATSAPP_PHONE_NUMBER_ID; delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  assert.deepEqual(configState({ ...wa, built: true }).missing, ['WHATSAPP_PHONE_NUMBER_ID']);
  process.env.WHATSAPP_PHONE_NUMBER_ID = keep;
  assert.throws(() => wa.authUrl(), (e) => e.code === 'not_oauth');
});

test('connect: status makes two real calls and answers for the number', async () => {
  const { ctx, calls } = ctxWith((path) => path === '/' + PHONE_ID ? reply(200, { id: PHONE_ID, display_phone_number: '+1 555-555-0100', verified_name: 'Sample Bakery', quality_rating: 'GREEN' }) : reply(200, { data: [{ id: '999000111222' }, { id: PHONE_ID }] }));
  assert.deepEqual(await wa.status(ctx), { ok: true, account: { label: 'Sample Bakery +1 555-555-0100', ref: PHONE_ID }, scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'] });
  assert.deepEqual(calls.map((c) => c.path), ['/' + PHONE_ID, `/${WABA}/phone_numbers`]);
  assert.ok(calls.every((c) => c.init.headers.authorization === 'Bearer ' + TOKEN && !c.url.includes(TOKEN)), 'the token is in the header, never in the address');
  assert.deepEqual(await wa.health(ctx), { ok: true, health: 'ok' });
});

test('reconnect with the connection\'s own credentials: they win over the deployment settings', async () => {
  const { ctx, calls } = ctxWith((path) => path === '/200000000001' ? reply(200, { id: '200000000001', verified_name: 'Other Sample Co' }) : reply(200, { data: [{ id: '200000000001' }] }), { tokens: { access_token: 'company-token', phone_number_id: '200000000001', business_account_id: '300000000001' } });
  const s = await wa.status(ctx);
  assert.equal(s.account.ref, '200000000001');
  assert.equal(calls[0].init.headers.authorization, 'Bearer company-token'); assert.equal(calls[1].path, '/300000000001/phone_numbers');
});

test('status: expired or revoked token, wrong account, outage, rate limit, missing settings', async () => {
  await rejects(wa.status(ctxWith(() => gerr(401, 190, 463)).ctx), 'token_expired', (e) => e.reauth === true);
  await rejects(wa.status(ctxWith(() => gerr(403, 200)).ctx), 'permission_revoked', (e) => e.reauth === true);
  assert.deepEqual(await wa.health(ctxWith(() => gerr(401, 190)).ctx), { ok: false, reason: 'token_expired', reauth: true });
  // The number exists but belongs to another WhatsApp Business account.
  assert.deepEqual(await wa.status(ctxWith((p) => p === '/' + PHONE_ID ? reply(200, { id: PHONE_ID }) : reply(200, { data: [{ id: '999000111222' }] })).ctx), { ok: false, reason: 'wrong_account' });
  // The connection was made for another number than the one configured now.
  assert.deepEqual(await wa.status(ctxWith((p) => p === '/' + PHONE_ID ? reply(200, { id: PHONE_ID }) : reply(200, { data: [{ id: PHONE_ID }] }), { connection: { account_ref: '555000111222', settings: {} } }).ctx), { ok: false, reason: 'wrong_account' });
  await rejects(wa.status(ctxWith(() => { throw new TypeError('fetch failed'); }).ctx), 'provider_unreachable');
  await rejects(wa.status(ctxWith(() => new Response('upstream down', { status: 503 })).ctx), 'provider_error');
  await rejects(wa.status(ctxWith(() => gerr(429, 130429)).ctx), 'rate_limited');
  const keep = process.env.WHATSAPP_SYSTEM_USER_TOKEN; delete process.env.WHATSAPP_SYSTEM_USER_TOKEN;
  const none = ctxWith(() => reply(200, {}));
  assert.deepEqual(await wa.status(none.ctx), { ok: false, reason: 'not_configured' }); assert.equal(none.calls.length, 0);
  process.env.WHATSAPP_SYSTEM_USER_TOKEN = keep;
});

test('disconnect and refresh: nothing to exchange for a system user token', async () => {
  const { ctx, calls } = ctxWith(() => reply(200, {}));
  assert.deepEqual(await wa.refresh(ctx, { access_token: 'x' }), { access_token: 'x' });
  await wa.revoke(ctx, {});
  assert.equal(calls.length, 0);
});

test('templates: listed with their approval state (successful sync)', async () => {
  const { ctx, calls } = ctxWith(() => reply(200, TEMPLATES));
  assert.deepEqual(await wa.actions.listTemplates(ctx), [
    { name: 'appointment_reminder', language: 'en_US', status: 'approved', category: 'utility', params: 2 },
    { name: 'appointment_reminder', language: 'es', status: 'pending', category: 'utility', params: 2 },
    { name: 'spring_offer', language: 'en_US', status: 'rejected', category: 'marketing', params: 0 },
    { name: 'hours_notice', language: 'en_US', status: 'paused', category: 'utility', params: 0 },
  ]);
  assert.equal(calls[0].path, `/${WABA}/message_templates`);
  assert.deepEqual(await wa.sync(ctx), { counts: { templates: 4, approved: 1 } });
});

test('send template: an approved template goes out with the consent record', async () => {
  const { ctx, calls } = ctxWith((path) => path.endsWith('/message_templates') ? reply(200, TEMPLATES) : reply(200, { messaging_product: 'whatsapp', contacts: [{ wa_id: '15555550142' }], messages: [{ id: 'wamid.OUT1' }] }));
  const sent = await wa.actions.sendTemplate(ctx, { to: '(555) 555-0142', template: { name: 'appointment_reminder', language: 'en_US' }, params: ['Sample Person', 'Monday at 10'], consent: consent() });
  assert.equal(sent.id, 'wamid.OUT1'); assert.equal(sent.message.status, 'sent'); assert.equal(sent.message.to, CLIENT); assert.equal(sent.message.subject, 'appointment_reminder');
  assert.equal(calls[0].q.name, 'appointment_reminder', 'the approval is read from Meta at send time');
  assert.equal(calls[1].path, `/${PHONE_ID}/messages`);
  assert.deepEqual(JSON.parse(calls[1].body), { messaging_product: 'whatsapp', recipient_type: 'individual', to: '15555550142', type: 'template', template: { name: 'appointment_reminder', language: { code: 'en_US' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Sample Person' }, { type: 'text', text: 'Monday at 10' }] }] } });
});

test('template not approved is refused: pending, rejected, paused, unknown, wrong parameters', async () => {
  const { ctx, calls } = ctxWith((path) => path.endsWith('/message_templates') ? reply(200, TEMPLATES) : reply(200, { messages: [{ id: 'never' }] }));
  const send = (template, params = []) => wa.actions.sendTemplate(ctx, { to: CLIENT, template, params, consent: consent() });
  await rejects(send({ name: 'appointment_reminder', language: 'es' }, ['a', 'b']), 'template_not_approved');
  await rejects(send({ name: 'spring_offer', language: 'en_US' }), 'template_not_approved');
  await rejects(send({ name: 'hours_notice', language: 'en_US' }), 'template_not_approved');
  await rejects(send({ name: 'does_not_exist', language: 'en_US' }), 'template_not_found');
  await rejects(send({ name: 'appointment_reminder', language: 'en_US' }, ['only one']), 'template_params_invalid');
  await rejects(send({ name: 'Bad Name!', language: 'en_US' }), 'template_invalid');
  assert.ok(calls.every((c) => !c.path.endsWith('/messages')), 'no message call was made for any of them');
  // Meta's own refusal at send time gives the same code.
  await rejects(wa.actions.sendTemplate(ctxWith((p) => p.endsWith('/message_templates') ? reply(200, TEMPLATES) : gerr(400, 132015)).ctx, { to: CLIENT, template: { name: 'appointment_reminder', language: 'en_US' }, params: ['a', 'b'], consent: consent() }), 'template_not_approved');
});

test('no consent is refused before any call: missing, revoked, expired, another number, another channel', async () => {
  const { ctx, calls } = ctxWith(() => reply(200, { messages: [{ id: 'never' }] }));
  const recent = new Date(Date.now() - 3600000).toISOString();
  await rejects(wa.actions.sendText(ctx, { to: CLIENT, text: 'hi', lastInboundAt: recent }), 'consent_missing');
  await rejects(wa.actions.sendText(ctx, { to: CLIENT, text: 'hi', lastInboundAt: recent, consent: consent({ status: 'opted_out' }) }), 'consent_revoked');
  await rejects(wa.actions.sendText(ctx, { to: CLIENT, text: 'hi', lastInboundAt: recent, consent: consent({ revokedAt: '2026-02-01T00:00:00Z' }) }), 'consent_revoked');
  await rejects(wa.actions.sendText(ctx, { to: CLIENT, text: 'hi', lastInboundAt: recent, consent: consent({ expiresAt: '2026-01-03T00:00:00Z' }) }), 'consent_expired');
  await rejects(wa.actions.sendText(ctx, { to: CLIENT, text: 'hi', lastInboundAt: recent, consent: consent({ address: '+15555550199' }) }), 'consent_mismatch');
  await rejects(wa.actions.sendText(ctx, { to: CLIENT, text: 'hi', lastInboundAt: recent, consent: consent({ channel: 'text' }) }), 'consent_mismatch');
  await rejects(wa.actions.sendTemplate(ctx, { to: CLIENT, template: { name: 'appointment_reminder', language: 'en_US' }, params: ['a', 'b'] }), 'consent_missing');
  await rejects(wa.actions.send(ctx, { to: CLIENT, text: 'hi', lastInboundAt: recent, consent: { status: 'opted_in', channel: 'whatsapp', address: CLIENT } }), 'consent_missing');
  assert.equal(calls.length, 0);
});

test('messaging window: free text inside 24 hours is sent, outside it is refused', async () => {
  let { ctx, calls } = ctxWith(() => reply(200, { messages: [{ id: 'wamid.OUT2' }] }));
  const sent = await wa.actions.send(ctx, { to: CLIENT, text: 'Yes, it is ready.', consent: consent(), lastInboundAt: new Date(Date.now() - 23 * 3600000).toISOString() });
  assert.equal(sent.id, 'wamid.OUT2'); assert.equal(sent.message.body, 'Yes, it is ready.'); assert.equal(sent.message.threadId, 'whatsapp:' + CLIENT);
  assert.deepEqual(JSON.parse(calls[0].body), { messaging_product: 'whatsapp', recipient_type: 'individual', to: '15555550142', type: 'text', text: { body: 'Yes, it is ready.', preview_url: false } });
  ({ ctx, calls } = ctxWith(() => reply(200, { messages: [{ id: 'never' }] })));
  await rejects(wa.actions.sendText(ctx, { to: CLIENT, text: 'late', consent: consent(), lastInboundAt: new Date(Date.now() - 25 * 3600000).toISOString() }), 'outside_messaging_window');
  await rejects(wa.actions.sendText(ctx, { to: CLIENT, text: 'never wrote', consent: consent() }), 'outside_messaging_window');
  assert.equal(calls.length, 0);
  await rejects(wa.actions.sendText(ctxWith(() => gerr(400, 131047)).ctx, { to: CLIENT, text: 'x', consent: consent(), lastInboundAt: new Date().toISOString() }), 'outside_messaging_window');
  await rejects(wa.actions.sendText(ctxWith(() => gerr(400, 131026)).ctx, { to: CLIENT, text: 'x', consent: consent(), lastInboundAt: new Date().toISOString() }), 'recipient_unreachable');
  await rejects(wa.actions.sendText(ctxWith(() => gerr(429, 131056)).ctx, { to: CLIENT, text: 'x', consent: consent(), lastInboundAt: new Date().toISOString() }), 'rate_limited');
  await rejects(wa.actions.sendText(ctx, { to: 'abc', text: 'x', consent: consent() }), 'recipient_invalid');
});

test('webhook: the verification challenge', () => {
  const get = (q) => new Request(ORIGIN + '/api/webhooks/whatsapp?' + new URLSearchParams(q));
  assert.equal(wa.webhook.challenge(get({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '998877' }), hctx).body, '998877');
  assert.equal(wa.webhook.challenge(get({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '998877' }), hctx).reason, 'bad_verify_token');
});

test('webhook: a signed message is accepted; what is stored has no text, no phone number, no message id', () => {
  const [rq, raw] = hook(inboundEvent());
  const v = wa.webhook.verify(rq, raw, hctx);
  assert.equal(v.ok, true); assert.equal(v.type, 'whatsapp.message'); assert.equal(v.accountRef, PHONE_ID);
  assert.deepEqual(Object.keys(v.redacted), ['type', 'phone_number_id', 'accounts', 'messages', 'statuses', 'refs']);
  assert.equal(v.redacted.messages, 1); assert.match(v.redacted.refs[0], /^[0-9a-f]{24}$/);
  const stored = JSON.stringify(v);
  assert.ok(!stored.includes('Is my return ready'), 'no message text');
  assert.ok(!stored.includes('5555550142') && !stored.includes('5555550100'), 'no phone number');
  assert.ok(!stored.includes(WAMID), 'the message id carries the phone number, so only its hash is kept');
  assert.ok(!stored.includes('Sample Person'), 'no name');
});

test('webhook: bad signature, duplicate event, malformed payload, stale body', () => {
  const [rq, raw] = hook(inboundEvent(), 'sha256=' + 'b'.repeat(64));
  assert.equal(wa.webhook.verify(rq, raw, hctx).reason, 'bad_signature');
  const [rq0, raw0] = hook(inboundEvent(), '');
  assert.equal(wa.webhook.verify(rq0, raw0, hctx).reason, 'signature_missing');
  const payload = JSON.stringify(inboundEvent());
  const [a, ra] = hook(payload); const [b, rb] = hook(payload);
  assert.equal(wa.webhook.verify(a, ra, hctx).eventId, wa.webhook.verify(b, rb, hctx).eventId, 'the same delivery has the same event id');
  for (const bad of ['{{', { object: 'page', entry: [{ id: '1' }] }, { object: 'whatsapp_business_account', entry: [] }, { object: 'whatsapp_business_account', entry: [{ id: WABA, changes: [{ field: 'messages', value: { metadata: {} } }] }] }, { object: 'whatsapp_business_account', entry: [{ id: WABA, changes: [{ field: 'account_update', value: {} }] }] }]) {
    const [r, w] = hook(bad);
    assert.equal(wa.webhook.verify(r, w, hctx).reason, 'bad_payload', JSON.stringify(bad));
  }
  const old = value({ messages: [{ from: '15555550142', id: WAMID, timestamp: String(Math.floor(Date.now() / 1000) - 8 * 86400), type: 'text', text: { body: 'x' } }] });
  const [rs, ws] = hook(old);
  assert.equal(wa.webhook.verify(rs, ws, hctx).reason, 'stale');
});

test('inbound: a message, a file and a delivery report in the platform shape', () => {
  let [rq, raw] = hook(inboundEvent());
  let [g] = wa.webhook.inbound(rq, raw, hctx);
  assert.equal(g.accountRef, PHONE_ID);
  assert.deepEqual(g.messages[0].message, { at: g.messages[0].message.at, channel: 'whatsapp', to: '+15555550100', subject: '', body: 'Is my return ready?', status: 'received', dir: 'in', from: CLIENT, provider: 'whatsapp', externalId: WAMID, threadId: 'whatsapp:' + CLIENT, read: false });
  assert.deepEqual(g.messages[0].match, { phone: CLIENT, phoneKey: '5555550142', name: 'Sample Person' });
  assert.deepEqual(g.consent, []);
  [rq, raw] = hook(inboundEvent('The receipt', 'image'));
  [g] = wa.webhook.inbound(rq, raw, hctx);
  assert.equal(g.messages[0].message.body, 'The receipt');
  assert.deepEqual(g.messages[0].extra, { type: 'image', media: { id: 'media_778899', mime: 'image/jpeg', kind: 'image', name: '' } });
  [rq, raw] = hook(value({ statuses: [{ id: 'wamid.OUT1', status: 'delivered', timestamp: ts(), recipient_id: '15555550142' }, { id: 'wamid.OUT2', status: 'failed', timestamp: ts(), recipient_id: '15555550142', errors: [{ code: 131047, title: LEAK }] }, { id: 'wamid.OUT3', status: 'read', timestamp: ts() }] }));
  const v = wa.webhook.verify(rq, raw, hctx);
  assert.equal(v.type, 'whatsapp.status'); assert.deepEqual(v.redacted.statuses, { delivered: 1, failed: 1, read: 1 });
  [g] = wa.webhook.inbound(rq, raw, hctx);
  assert.deepEqual(g.statuses.map((s) => [s.externalId, s.status, s.error || '']), [['wamid.OUT1', 'delivered', ''], ['wamid.OUT2', 'failed', 'outside_messaging_window'], ['wamid.OUT3', 'delivered', '']]);
  assert.ok(!JSON.stringify(g).includes('not reachable'), 'the provider text of a failure is not kept');
});

test('STOP on WhatsApp becomes a consent change, and the next send is refused', async () => {
  const [rq, raw] = hook(inboundEvent('  Stop. '));
  const [g] = wa.webhook.inbound(rq, raw, hctx);
  assert.deepEqual(g.consent.map((c) => [c.action, c.channel, c.address, c.source]), [['opt_out', 'whatsapp', CLIENT, 'keyword']]);
  // The store applied it: the record the caller now passes says opted out.
  const { ctx, calls } = ctxWith(() => reply(200, { messages: [{ id: 'never' }] }));
  await rejects(wa.actions.sendText(ctx, { to: CLIENT, text: 'One more thing', lastInboundAt: new Date().toISOString(), consent: consent({ status: 'opted_out', revokedAt: g.consent[0].at }) }), 'consent_revoked');
  assert.equal(calls.length, 0);
});

test('inbound storage: stored for the company the number belongs to, before the webhook is answered', async () => {
  const [rq, raw] = hook(inboundEvent());
  const seen = [];
  const rpc = async (name, args) => { seen.push({ name, args }); return name === 'conn_by_account' ? { ok: true, data: args.p_account_ref === PHONE_ID ? { tenant_id: TENANT } : null } : { ok: true, data: { messages: 1 } }; };
  assert.deepEqual(await ingestInbound({ ...wa, built: true }, { request: rq, raw, ctx: hctx, rpc }), { ok: true, stored: 1, skipped: 0 });
  assert.deepEqual(seen.map((s) => s.name), ['conn_by_account', 'messaging_ingest']);
  assert.equal(seen[1].args.p_tenant, TENANT); assert.equal(seen[1].args.p_provider, 'whatsapp'); assert.equal(seen[1].args.p_batch.messages[0].message.externalId, WAMID);
  // A number nobody connected: nothing is stored and the provider is not asked to send it again.
  assert.deepEqual(await ingestInbound({ ...wa, built: true }, { request: rq, raw, ctx: hctx, rpc: async (name) => (name === 'conn_by_account' ? { ok: true, data: null } : { ok: true }) }), { ok: true, stored: 0, skipped: 1 });
  // The store cannot be reached: the answer says so, so the webhook answers with an error and Meta sends it again.
  assert.deepEqual(await ingestInbound({ ...wa, built: true }, { request: rq, raw, ctx: hctx, rpc: async (name) => (name === 'conn_by_account' ? { ok: true, data: { tenant_id: TENANT } } : { ok: false, status: 503 }) }), { ok: false, reason: 'ingest_unavailable' });
  assert.deepEqual(await wa.webhook.handle(), { ok: true, ignored: true });
});

test('media: downloaded through the server with the token, only from Meta\'s own addresses', async () => {
  const bytes = Buffer.from('fake image bytes');
  let { ctx, calls } = ctxWith((path, init, u) => u.hostname === 'graph.facebook.com' ? reply(200, { url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', mime_type: 'image/jpeg', sha256: 'abc', file_size: bytes.length, id: 'media_778899' }) : new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } }));
  const file = await wa.actions.downloadMedia(ctx, 'media_778899');
  assert.deepEqual({ mime: file.mime, size: file.size, sha256: file.sha256 }, { mime: 'image/jpeg', size: bytes.length, sha256: 'abc' });
  assert.ok(file.bytes.equals(bytes));
  assert.equal(calls[1].init.headers.authorization, 'Bearer ' + TOKEN);
  ({ ctx, calls } = ctxWith(() => reply(200, { url: 'https://files.attacker.example.com/x', mime_type: 'image/jpeg', file_size: 3 })));
  await rejects(wa.actions.downloadMedia(ctx, 'media_778899'), 'media_unavailable');
  assert.equal(calls.length, 1, 'the token is never sent to an address that is not Meta\'s');
  await rejects(wa.actions.downloadMedia(ctxWith(() => reply(200, { url: 'https://lookaside.fbsbx.com/x', file_size: 50 * 1024 * 1024 })).ctx, 'media_778899'), 'media_too_large');
  await rejects(wa.actions.downloadMedia(ctx, '../../etc'), 'media_invalid');
  await rejects(wa.actions.downloadMedia(ctxWith(() => gerr(400, 100)).ctx, 'media_778899'), 'request_rejected');
});
