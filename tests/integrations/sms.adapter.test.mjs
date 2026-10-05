// The text message adapter (Twilio and Dialpad back ends) and the shared consent rules, tested with mocked provider
// responses. Nothing is sent anywhere. Not proven against a live service: no account exists in this build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { setTestEnv, ORIGIN } from '../server/helpers.mjs';

const SID = 'AC' + randomBytes(16).toString('hex');
const AUTH = 'tw_auth_' + randomBytes(16).toString('hex');
const OFFICE = '+15555550100';
const CLIENT = '+15555550142';
setTestEnv({ SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: AUTH, SMS_FROM_NUMBER: OFFICE, DIALPAD_WEBHOOK_SECRET: 'dp_hook_secret_for_tests_0123' });
for (const k of ['SMS_APPROVED', 'TWILIO_MESSAGING_SERVICE_SID', 'DIALPAD_AUTH_MODE', 'DIALPAD_API_KEY', 'DIALPAD_CLIENT_ID', 'DIALPAD_CLIENT_SECRET']) delete process.env[k];
const mod = await import('../../api/_lib/integrations/providers/sms.js');
const sms = mod.default;
const { twilioSignature } = mod;
const { ProviderError } = await import('../../api/_lib/integrations/oauth.js');
const { configState } = await import('../../api/_lib/integrations/core.js');
const { ingestInbound } = await import('../../api/_lib/integrations/messaging/ingest.js');
const { keyword, consentChange, assertConsent, inQuietHours, insideWindow } = await import('../../api/_lib/integrations/messaging/consent.js');
const { smsSegments, e164, toMessage, advances } = await import('../../api/_lib/integrations/messaging/normalize.js');
const { env } = await import('../../api/_lib/env.js');

const TENANT = '11111111-1111-4111-8111-111111111111';
const MSID = 'SM' + 'a1'.repeat(16);
const LEAK = 'The number +15555550142 for account Sample Bakery is unsubscribed';
const reply = (status, body) => new Response(JSON.stringify(body), { status });
const consent = (over = {}) => ({ status: 'opted_in', channel: 'text', address: CLIENT, grantedAt: '2026-01-02T10:00:00.000Z', ...over });
function ctxWith(responder, more = {}) {
  const calls = [];
  const ctx = { provider: 'sms', tenantId: TENANT, env, now: () => Date.now(), tokens: null, connection: null, fetch: async (url, init = {}) => { const u = new URL(String(url)); calls.push({ url: String(url), path: u.pathname, q: Object.fromEntries(u.searchParams), init, body: init.body }); return responder(u.pathname, init, u); }, ...more };
  return { ctx, calls };
}
const rejects = (p, code, extra = () => true) => assert.rejects(p, (e) => e instanceof ProviderError && e.code === code && !String(e.message).includes('5555550142') && extra(e), code);
const hctx = { provider: 'sms', env, now: () => Date.now() };
function hook(fields, { sig, query = '', token = AUTH, origin = ORIGIN } = {}) {
  const body = new URLSearchParams(fields).toString();
  const url = ORIGIN + '/api/webhooks/sms' + query;
  const signature = sig === undefined ? createHmac('sha1', token).update(origin + '/api/webhooks/sms' + query + Object.keys(fields).sort().map((k) => k + fields[k]).join('')).digest('base64') : sig;
  const raw = Buffer.from(body);
  return [new Request(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(signature ? { 'x-twilio-signature': signature } : {}) }, body: raw }), raw];
}
const inboundFields = (over = {}) => ({ MessageSid: MSID, SmsSid: MSID, AccountSid: SID, From: CLIENT, To: OFFICE, Body: 'What time do you close?', NumSegments: '1', NumMedia: '0', SmsStatus: 'received', ...over });
const statusFields = (over = {}) => ({ MessageSid: MSID, AccountSid: SID, From: OFFICE, To: CLIENT, MessageStatus: 'delivered', ...over });

test('shape: the back end is a setting, and each one names its own settings', () => {
  assert.equal(sms.id, 'sms'); assert.equal(sms.kind, 'key');
  assert.deepEqual(sms.env, ['SMS_PROVIDER', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'SMS_FROM_NUMBER']);
  for (const fn of ['status', 'health', 'refresh', 'revoke', 'sync']) assert.equal(typeof sms[fn], 'function', fn);
  for (const fn of ['verify', 'handle', 'inbound', 'reply']) assert.equal(typeof sms.webhook[fn], 'function', fn);
  for (const fn of ['send', 'cost', 'segments']) assert.equal(typeof sms.actions[fn], 'function', fn);
  assert.equal(configState({ ...sms, built: true }).state, 'pending_approval');
  process.env.SMS_APPROVED = 'true';
  assert.equal(configState({ ...sms, built: true }).state, 'setup');
  delete process.env.SMS_APPROVED;
  process.env.SMS_PROVIDER = 'dialpad';
  assert.deepEqual(sms.env, ['SMS_PROVIDER', 'SMS_FROM_NUMBER', 'DIALPAD_CLIENT_ID', 'DIALPAD_CLIENT_SECRET', 'DIALPAD_WEBHOOK_SECRET']);
  delete process.env.SMS_PROVIDER;
  assert.deepEqual(configState({ ...sms, built: true }), { state: 'not_connected', reason: 'not_configured', missing: ['SMS_PROVIDER'] });
  process.env.SMS_PROVIDER = 'twilio';
});

test('connect (Twilio): the account is active and the sending number belongs to it', async () => {
  const { ctx, calls } = ctxWith((path) => path.endsWith(`/Accounts/${SID}.json`) ? reply(200, { sid: SID, status: 'active', friendly_name: 'Sample' }) : reply(200, { incoming_phone_numbers: [{ phone_number: OFFICE, sid: 'PN1' }] }));
  assert.deepEqual(await sms.status(ctx), { ok: true, account: { label: OFFICE, ref: OFFICE }, scopes: ['send', 'receive'], backend: 'twilio' });
  assert.equal(calls[0].url, `https://api.twilio.com/2010-04-01/Accounts/${SID}.json`);
  assert.equal(calls[0].init.headers.authorization, 'Basic ' + Buffer.from(`${SID}:${AUTH}`).toString('base64'));
  assert.equal(calls[1].q.PhoneNumber, OFFICE);
  assert.ok(calls.every((c) => !c.url.includes(AUTH)));
  assert.deepEqual(await sms.health(ctx), { ok: true, health: 'ok' });
});

test('status: bad key, suspended account, wrong account, number of someone else, outage, rate limit, unknown back end', async () => {
  await rejects(sms.status(ctxWith(() => reply(401, { code: 20003, message: LEAK, status: 401 })).ctx), 'invalid_key', (e) => e.reauth === true);
  assert.deepEqual(await sms.health(ctxWith(() => reply(401, { code: 20003 })).ctx), { ok: false, reason: 'invalid_key', reauth: true });
  assert.deepEqual(await sms.status(ctxWith(() => reply(200, { sid: SID, status: 'suspended' })).ctx), { ok: false, reason: 'account_not_active' });
  assert.deepEqual(await sms.status(ctxWith(() => reply(200, { sid: 'AC' + '0'.repeat(32), status: 'active' })).ctx), { ok: false, reason: 'wrong_account' });
  assert.deepEqual(await sms.status(ctxWith((p) => p.endsWith(`${SID}.json`) ? reply(200, { sid: SID, status: 'active' }) : reply(200, { incoming_phone_numbers: [] })).ctx), { ok: false, reason: 'sender_not_found' });
  await rejects(sms.status(ctxWith(() => { throw new TypeError('fetch failed'); }).ctx), 'provider_unreachable');
  await rejects(sms.status(ctxWith(() => new Response('bad gateway', { status: 502 })).ctx), 'provider_error');
  await rejects(sms.status(ctxWith(() => reply(429, { code: 20429, message: LEAK })).ctx), 'rate_limited');
  process.env.SMS_PROVIDER = 'carrier-pigeon';
  const none = ctxWith(() => reply(200, {}));
  assert.deepEqual(await sms.status(none.ctx), { ok: false, reason: 'provider_unknown' }); assert.equal(none.calls.length, 0);
  await rejects(sms.actions.send(none.ctx, { to: CLIENT, text: 'x', consent: consent() }), 'provider_unknown');
  process.env.SMS_PROVIDER = 'twilio';
});

test('disconnect and reconnect: the key belongs to the deployment, nothing is exchanged', async () => {
  const { ctx, calls } = ctxWith(() => reply(200, {}));
  assert.deepEqual(await sms.refresh(ctx, null), null); await sms.revoke(ctx, null);
  assert.deepEqual(await sms.sync(ctx), { ok: true, skipped: 'nothing_to_sync' });
  assert.equal(calls.length, 0);
});

test('successful send (Twilio): the request, the segments the provider reports, and no invented cost', async () => {
  const { ctx, calls } = ctxWith(() => reply(201, { sid: MSID, status: 'queued', num_segments: '1', price: null, price_unit: 'USD' }));
  const sent = await sms.actions.send(ctx, { to: '(555) 555-0142', text: 'Your order is ready.', consent: consent(), statusCallback: ORIGIN.replace('http:', 'https:') + '/api/webhooks/sms?t=' + TENANT });
  assert.equal(sent.id, MSID); assert.equal(sent.status, 'queued'); assert.equal(sent.backend, 'twilio');
  assert.equal(sent.segments, 1); assert.equal(sent.segmentsSource, 'provider');
  assert.equal(sent.cost, null, 'no price was reported, so none is stated');
  assert.equal(sent.message.status, 'queued'); assert.equal(sent.message.to, CLIENT); assert.equal(sent.message.from, OFFICE); assert.equal(sent.message.provider, 'sms');
  assert.equal(calls[0].url, `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`);
  const form = new URLSearchParams(calls[0].body);
  assert.deepEqual(Object.fromEntries(form), { To: CLIENT, Body: 'Your order is ready.', From: OFFICE, StatusCallback: 'https://localhost:4620/api/webhooks/sms?t=' + TENANT });
  // The provider says nothing about segments: the count is our arithmetic and is marked as an estimate.
  const est = await sms.actions.send(ctxWith(() => reply(201, { sid: MSID, status: 'accepted' })).ctx, { to: CLIENT, text: 'x'.repeat(161), consent: consent() });
  assert.equal(est.segments, 2); assert.equal(est.segmentsSource, 'estimate'); assert.equal(est.cost, null);
  // A price is passed on only as the provider states it.
  const priced = await sms.actions.send(ctxWith(() => reply(201, { sid: MSID, status: 'sent', num_segments: '2', price: '-0.01580', price_unit: 'usd' })).ctx, { to: CLIENT, text: 'x', consent: consent() });
  assert.deepEqual(priced.cost, { amount: 0.0158, currency: 'USD' }); assert.equal(priced.status, 'sent');
  const c = ctxWith(() => reply(200, { sid: MSID, price: '-0.00790', price_unit: 'USD' }));
  assert.deepEqual(await sms.actions.cost(c.ctx, MSID), { amount: 0.0079, currency: 'USD' });
  assert.equal(c.calls[0].path, `/2010-04-01/Accounts/${SID}/Messages/${MSID}.json`);
  assert.equal(await sms.actions.cost(ctxWith(() => reply(200, { sid: MSID, price: null, price_unit: 'USD' })).ctx, MSID), null);
});

test('no consent is refused before any call', async () => {
  const { ctx, calls } = ctxWith(() => reply(201, { sid: MSID, status: 'queued' }));
  await rejects(sms.actions.send(ctx, { to: CLIENT, text: 'hi' }), 'consent_missing');
  await rejects(sms.actions.send(ctx, { to: CLIENT, text: 'hi', consent: { status: 'opted_in', channel: 'text', address: CLIENT } }), 'consent_missing');
  await rejects(sms.actions.send(ctx, { to: CLIENT, text: 'hi', consent: consent({ address: '+15555550199' }) }), 'consent_mismatch');
  await rejects(sms.actions.send(ctx, { to: CLIENT, text: 'hi', consent: consent({ channel: 'whatsapp' }) }), 'consent_mismatch');
  await rejects(sms.actions.send(ctx, { to: CLIENT, text: 'hi', consent: consent({ expiresAt: '2026-01-03T00:00:00Z' }) }), 'consent_expired');
  await rejects(sms.actions.send(ctx, { to: 'abc', text: 'hi', consent: consent() }), 'recipient_invalid');
  await rejects(sms.actions.send(ctx, { to: CLIENT, text: '   ', consent: consent() }), 'message_invalid');
  assert.equal(calls.length, 0);
});

test('STOP handling: the word becomes an opt-out, and nothing is sent after it', async () => {
  const [rq, raw] = hook(inboundFields({ Body: 'Stop' }));
  const [g] = sms.webhook.inbound(rq, raw, hctx);
  assert.deepEqual(g.consent.map((c) => [c.action, c.channel, c.address, c.source, c.keyword]), [['opt_out', 'text', CLIENT, 'keyword', 'stop']]);
  assert.equal(g.messages[0].message.body, 'Stop', 'the message itself is still part of the conversation');
  const stored = [];
  await ingestInbound({ ...sms, built: true }, { request: rq, raw, ctx: hctx, rpc: async (name, args) => { stored.push({ name, args }); return name === 'conn_by_account' ? { ok: true, data: { tenant_id: TENANT } } : { ok: true, data: {} }; } });
  assert.equal(stored[0].args.p_account_ref, OFFICE, 'the company is found by its own number');
  assert.equal(stored[1].args.p_batch.consent[0].action, 'opt_out');
  // The store applied the opt-out: the record the caller passes now is opted out, and every send is refused.
  const { ctx, calls } = ctxWith(() => reply(201, { sid: MSID, status: 'queued' }));
  const after = consent({ status: 'opted_out', revokedAt: g.consent[0].at });
  await rejects(sms.actions.send(ctx, { to: CLIENT, text: 'One last offer' }), 'consent_missing');
  await rejects(sms.actions.send(ctx, { to: CLIENT, text: 'One last offer', consent: after }), 'consent_revoked');
  await rejects(sms.actions.send(ctx, { to: CLIENT, text: 'One last offer', consent: { ...consent(), revokedAt: g.consent[0].at } }), 'consent_revoked');
  assert.equal(calls.length, 0, 'never sent after STOP');
  // The carrier's own block list says the same thing with its own number.
  await rejects(sms.actions.send(ctxWith(() => reply(400, { code: 21610, message: LEAK, status: 400 })).ctx, { to: CLIENT, text: 'x', consent: consent() }), 'recipient_opted_out');
  const [rs, ws] = hook(statusFields({ MessageStatus: 'failed', ErrorCode: '21610' }));
  const [gs] = sms.webhook.inbound(rs, ws, hctx);
  assert.deepEqual([gs.statuses[0].status, gs.statuses[0].error], ['failed', 'recipient_opted_out']);
  assert.deepEqual([gs.consent[0].action, gs.consent[0].address, gs.consent[0].source], ['opt_out', CLIENT, 'provider']);
});

test('keywords: STOP, START and HELP in English and Spanish, only as the whole message', () => {
  for (const w of ['STOP', 'stop', ' Stop. ', 'STOPALL', 'unsubscribe', 'Cancel', 'END', 'quit', 'ALTO', 'Parar', 'baja', 'CANCELAR']) assert.equal(keyword(w), 'stop', w);
  for (const w of ['START', 'unstop', 'Yes', 'INICIAR']) assert.equal(keyword(w), 'start', w);
  for (const w of ['HELP', 'info', 'AYUDA', '¡Ayuda!']) assert.equal(keyword(w), 'help', w);
  for (const w of ['', 'please stop calling me', 'stop by at three', 'yes please', 'I need help with my order', 'ok']) assert.equal(keyword(w), null, w);
  assert.deepEqual(consentChange('START', { channel: 'text', from: '5555550142', at: '2026-01-05T00:00:00.000Z' }), { action: 'opt_in', channel: 'text', address: CLIENT, at: '2026-01-05T00:00:00.000Z', source: 'keyword', keyword: 'start' });
  assert.equal(consentChange('HELP', { channel: 'text', from: CLIENT }).action, 'help');
  assert.equal(consentChange('hello', { channel: 'text', from: CLIENT }), null);
  assert.equal(assertConsent(consent(), { channel: 'text', to: '555-555-0142' }), true);
});

test('quiet hours are the caller\'s: inside them a send is refused, outside it goes', async () => {
  const quiet = { start: '21:00', end: '08:00', timeZone: 'America/New_York' };
  assert.equal(inQuietHours(quiet, Date.parse('2026-01-05T03:30:00Z')), true);    // 22:30 in New York
  assert.equal(inQuietHours(quiet, Date.parse('2026-01-05T12:30:00Z')), true);    // 07:30
  assert.equal(inQuietHours(quiet, Date.parse('2026-01-05T15:00:00Z')), false);   // 10:00
  assert.equal(inQuietHours({ start: '12:00', end: '13:00', timeZone: 'UTC' }, Date.parse('2026-01-05T12:30:00Z')), true);
  assert.equal(inQuietHours(null, Date.now()), false);
  const night = ctxWith(() => reply(201, { sid: MSID, status: 'queued' }), { now: () => Date.parse('2026-01-05T03:30:00Z') });
  await rejects(sms.actions.send(night.ctx, { to: CLIENT, text: 'hi', consent: consent(), quietHours: quiet }), 'quiet_hours');
  assert.equal(night.calls.length, 0);
  const day = ctxWith(() => reply(201, { sid: MSID, status: 'queued' }), { now: () => Date.parse('2026-01-05T15:00:00Z') });
  assert.equal((await sms.actions.send(day.ctx, { to: CLIENT, text: 'hi', consent: consent(), quietHours: quiet })).id, MSID);
  await rejects(sms.actions.send(day.ctx, { to: CLIENT, text: 'hi', consent: consent(), quietHours: { start: '21:00', end: '08:00', timeZone: 'Not/AZone' } }), 'quiet_hours_invalid');
});

test('segments: counted from the standard, never a price', () => {
  assert.deepEqual(smsSegments(''), { segments: 0, encoding: 'gsm7', units: 0 });
  assert.deepEqual(smsSegments('a'.repeat(160)), { segments: 1, encoding: 'gsm7', units: 160 });
  assert.deepEqual(smsSegments('a'.repeat(161)), { segments: 2, encoding: 'gsm7', units: 161 });
  assert.deepEqual(smsSegments('a'.repeat(306)), { segments: 2, encoding: 'gsm7', units: 306 });
  assert.deepEqual(smsSegments('a'.repeat(307)), { segments: 3, encoding: 'gsm7', units: 307 });
  assert.deepEqual(smsSegments('{' + 'a'.repeat(159)), { segments: 2, encoding: 'gsm7', units: 161 }, 'a brace counts twice');
  assert.deepEqual(smsSegments('Su cita es mañana'), { segments: 1, encoding: 'gsm7', units: 17 });
  assert.deepEqual(smsSegments('Á' + 'a'.repeat(69)), { segments: 1, encoding: 'ucs2', units: 70 });
  assert.deepEqual(smsSegments('Á' + 'a'.repeat(70)), { segments: 2, encoding: 'ucs2', units: 71 });
  assert.equal(smsSegments('See you soon 🙂').encoding, 'ucs2');
  assert.deepEqual(sms.actions.segments(null, 'hello'), { segments: 1, encoding: 'gsm7', units: 5 });
  assert.ok(!Object.keys(smsSegments('x')).some((k) => /cost|price|rate/.test(k)));
});

test('phone numbers, the message shape and the order of delivery states', () => {
  assert.equal(e164('(555) 555-0142'), CLIENT); assert.equal(e164('1 555 555 0142'), CLIENT); assert.equal(e164('+44 20 7946 0958'), '+442079460958'); assert.equal(e164('whatsapp:+15555550142'), CLIENT);
  assert.equal(e164('12345'), ''); assert.equal(e164(''), ''); assert.equal(e164(null), '');
  assert.throws(() => toMessage({ channel: 'fax' }), TypeError);
  assert.equal(advances('sent', 'delivered'), true); assert.equal(advances('delivered', 'sent'), false); assert.equal(advances('queued', 'failed'), true);
  assert.equal(insideWindow(new Date(Date.now() - 1000).toISOString()), true); assert.equal(insideWindow(null), false); assert.equal(insideWindow(new Date(Date.now() + 60000).toISOString()), false);
});

test('provider failures on send become codes: rate limit, outage, bad number, blocked', async () => {
  const send = (responder) => sms.actions.send(ctxWith(responder).ctx, { to: CLIENT, text: 'x', consent: consent() });
  await rejects(send(() => reply(429, { code: 20429, message: LEAK })), 'rate_limited');
  await rejects(send(() => { throw new TypeError('fetch failed'); }), 'provider_unreachable');
  await rejects(send(() => new Response('unavailable', { status: 503 })), 'provider_error');
  await rejects(send(() => reply(400, { code: 21211, message: LEAK })), 'recipient_invalid');
  await rejects(send(() => reply(400, { code: 30034, message: LEAK })), 'sender_not_registered');
  await rejects(send(() => reply(400, { code: 99999, message: LEAK })), 'message_rejected');
  await rejects(send(() => reply(401, { code: 20003, message: LEAK })), 'invalid_key', (e) => e.reauth === true);
  await rejects(send(() => reply(201, { status: 'queued' })), 'provider_error');
});

test('webhook (Twilio): a signed delivery report is accepted and reduced to ids', () => {
  const [rq, raw] = hook(statusFields(), { query: '?t=' + TENANT });
  const v = sms.webhook.verify(rq, raw, hctx);
  assert.equal(v.ok, true); assert.equal(v.tenantId, TENANT); assert.equal(v.type, 'sms.status'); assert.equal(v.eventId, MSID + ':delivered');
  assert.deepEqual(v.redacted, { type: 'sms.status', sid: MSID, status: 'delivered', error_code: null, segments: null });
  const [ri, wi] = hook(inboundFields());
  const vi = sms.webhook.verify(ri, wi, hctx);
  assert.equal(vi.type, 'sms.inbound'); assert.equal(vi.tenantId, null); assert.equal(vi.accountRef, OFFICE); assert.equal(vi.eventId, MSID + ':received');
  const stored = JSON.stringify(vi.redacted) + JSON.stringify(v.redacted);
  assert.ok(!stored.includes('5555550142') && !stored.includes('5555550100'), 'no phone number in what is stored');
  assert.ok(!stored.includes('What time'), 'no message text in what is stored');
  assert.equal(twilioSignature('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', new URLSearchParams({ CallSid: 'CA1234567890ABCDE', Caller: '+12349013030', Digits: '1234', From: '+12349013030', To: '+18005551212' })), '0/KCTR6DLpKmkAf8muzZqo1nDgQ=', 'the worked example from Twilio\'s own documentation');
  assert.deepEqual(sms.webhook.reply(), { status: 200, contentType: 'text/xml; charset=utf-8', body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>' });
});

test('webhook (Twilio): bad signature, changed body, changed address, duplicate, malformed, another account', () => {
  let [rq, raw] = hook(statusFields(), { sig: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=' });
  assert.equal(sms.webhook.verify(rq, raw, hctx).reason, 'bad_signature');
  [rq, raw] = hook(statusFields(), { sig: '' });
  assert.equal(sms.webhook.verify(rq, raw, hctx).reason, 'signature_missing');
  [rq, raw] = hook(statusFields(), { token: 'someone-elses-token' });
  assert.equal(sms.webhook.verify(rq, raw, hctx).reason, 'bad_signature');
  // Signed for one body, delivered with another.
  const [good] = hook(statusFields());
  const changed = Buffer.from(new URLSearchParams(statusFields({ MessageStatus: 'failed' })).toString());
  assert.equal(sms.webhook.verify(new Request(good.url, { method: 'POST', headers: good.headers, body: changed }), changed, hctx).reason, 'bad_signature');
  // Signed for the address without a company, delivered to an address that names one.
  const [plain, plainRaw] = hook(statusFields());
  assert.equal(sms.webhook.verify(new Request(plain.url + '?t=' + TENANT, { method: 'POST', headers: plain.headers, body: plainRaw }), plainRaw, hctx).reason, 'bad_signature');
  // Signed for another site's address.
  [rq, raw] = hook(statusFields(), { origin: 'https://other.example.com' });
  assert.equal(sms.webhook.verify(rq, raw, hctx).reason, 'bad_signature');

  const [a, ra] = hook(statusFields()); const [b, rb] = hook(statusFields());
  assert.equal(sms.webhook.verify(a, ra, hctx).eventId, sms.webhook.verify(b, rb, hctx).eventId, 'the same report twice is one event');
  const [c, rc] = hook(statusFields({ MessageStatus: 'sent' }));
  assert.notEqual(sms.webhook.verify(a, ra, hctx).eventId, sms.webhook.verify(c, rc, hctx).eventId);

  [rq, raw] = hook({ AccountSid: SID, MessageStatus: 'sent' });
  assert.equal(sms.webhook.verify(rq, raw, hctx).reason, 'bad_payload');
  [rq, raw] = hook(statusFields({ MessageSid: 'not-a-sid' }));
  assert.equal(sms.webhook.verify(rq, raw, hctx).reason, 'bad_payload');
  [rq, raw] = hook(statusFields({ AccountSid: 'AC' + '9'.repeat(32) }));
  assert.equal(sms.webhook.verify(rq, raw, hctx).reason, 'wrong_account');
  // A forged body gives nothing to store.
  [rq, raw] = hook(inboundFields(), { sig: 'AAAA' });
  assert.deepEqual(sms.webhook.inbound(rq, raw, hctx), []);
  process.env.SMS_PROVIDER = 'dialpad';
  [rq, raw] = hook(statusFields());
  assert.equal(sms.webhook.verify(rq, raw, hctx).reason, 'not_configured', 'with Dialpad carrying the texts, events arrive at the Dialpad webhook');
  process.env.SMS_PROVIDER = 'twilio';
});

test('inbound (Twilio): the message and the delivery report in the platform shape', () => {
  let [rq, raw] = hook(inboundFields());
  let [g] = sms.webhook.inbound(rq, raw, hctx);
  assert.deepEqual(g.messages[0].message, { at: g.messages[0].message.at, channel: 'text', to: OFFICE, subject: '', body: 'What time do you close?', status: 'received', dir: 'in', from: CLIENT, provider: 'sms', externalId: MSID, threadId: 'text:' + CLIENT, read: false });
  assert.deepEqual(g.messages[0].match, { phone: CLIENT, phoneKey: '5555550142' });
  assert.deepEqual(g.messages[0].extra, { segments: 1, backend: 'twilio', media: 0 });
  [rq, raw] = hook(statusFields({ MessageStatus: 'undelivered', ErrorCode: '30003' }), { query: '?t=' + TENANT });
  [g] = sms.webhook.inbound(rq, raw, hctx);
  assert.equal(g.tenantId, TENANT);
  assert.deepEqual([g.statuses[0].externalId, g.statuses[0].status, g.statuses[0].error], [MSID, 'failed', 'recipient_unreachable']);
});

test('Dialpad as the back end: status and send go through the Dialpad adapter with the same rules', async () => {
  process.env.SMS_PROVIDER = 'dialpad';
  const dctx = (responder) => { const calls = []; return { calls, ctx: { provider: 'dialpad', tenantId: TENANT, env, now: () => Date.now(), tokens: { access_token: 'dp-access' }, connection: null, fetch: async (url, init = {}) => { calls.push({ path: new URL(String(url)).pathname, init, body: init.body }); return responder(new URL(String(url)).pathname, init); } } }; };
  let d = dctx((path) => path.endsWith('/company') ? reply(200, { id: 4400001, name: 'Sample Bakery (sample)' }) : reply(200, { items: [{ number: OFFICE, status: 'office' }] }));
  assert.deepEqual(await sms.status({ ...ctxWith(() => reply(500, {})).ctx, dialpad: d.ctx }), { ok: true, account: { label: OFFICE, ref: OFFICE }, scopes: ['send', 'receive'], backend: 'dialpad' });
  assert.deepEqual(d.calls.map((c) => c.path), ['/api/v2/company', '/api/v2/numbers']);
  d = dctx((path) => path.endsWith('/company') ? reply(200, { id: 4400001 }) : reply(200, { items: [{ number: '+15555550177' }] }));
  assert.deepEqual(await sms.status({ ...ctxWith(() => reply(500, {})).ctx, dialpad: d.ctx }), { ok: false, reason: 'sender_not_found' });

  d = dctx(() => reply(200, { id: 7001 }));
  const sent = await sms.actions.send({ ...ctxWith(() => reply(500, {})).ctx, dialpad: d.ctx }, { to: CLIENT, text: 'Ready at three.', consent: consent() });
  assert.deepEqual({ id: sent.id, status: sent.status, backend: sent.backend, segments: sent.segments, segmentsSource: sent.segmentsSource, cost: sent.cost }, { id: '7001', status: 'queued', backend: 'dialpad', segments: 1, segmentsSource: 'estimate', cost: null });
  assert.equal(sent.message.provider, 'sms'); assert.equal(sent.message.channel, 'text');
  assert.deepEqual(JSON.parse(d.calls[0].body), { to_numbers: [CLIENT], text: 'Ready at three.', infer_country_code: false, from_number: OFFICE });
  d = dctx(() => reply(200, { id: 1 }));
  await rejects(sms.actions.send({ ...ctxWith(() => reply(500, {})).ctx, dialpad: d.ctx }, { to: CLIENT, text: 'x' }), 'consent_missing');
  await rejects(sms.actions.send({ ...ctxWith(() => reply(500, {})).ctx, dialpad: d.ctx }, { to: CLIENT, text: 'x', consent: consent({ status: 'opted_out' }) }), 'consent_revoked');
  assert.equal(d.calls.length, 0);
  assert.equal(await sms.actions.cost(ctxWith(() => reply(200, {})).ctx, '7001'), null, 'Dialpad reports no price per message, so none is stated');
  process.env.SMS_PROVIDER = 'twilio';
});

test('Dialpad as the back end when the Dialpad connection cannot be read: a code, and nothing is sent', async () => {
  process.env.SMS_PROVIDER = 'dialpad';
  // No ctx.dialpad here: the adapter asks the framework for the company's Dialpad connection. This test run has no
  // database, so the connection cannot be read and the answer is dialpad_unavailable. (With a database and no
  // Dialpad connection the code is dialpad_not_connected; that branch needs the end-to-end stack to prove.)
  const { ctx, calls } = ctxWith(() => reply(200, { id: 1 }));
  await rejects(sms.status(ctx), 'dialpad_unavailable');
  await rejects(sms.actions.send(ctx, { to: CLIENT, text: 'x', consent: consent() }), 'dialpad_unavailable');
  assert.deepEqual(await sms.health(ctx), { ok: false, reason: 'dialpad_unavailable', reauth: false });
  assert.equal(calls.length, 0);
  process.env.SMS_PROVIDER = 'twilio';
});
