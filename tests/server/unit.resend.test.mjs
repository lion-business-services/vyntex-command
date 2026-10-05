// The Resend adapter (system email), tested with mocked provider responses. Nothing is sent anywhere.
// Not proven against the live service: no key exists in this build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setTestEnv, svixHeaders, ORIGIN } from './helpers.mjs';

const KEY = 're_test_' + randomBytes(16).toString('hex');
const WH = 'whsec_' + randomBytes(24).toString('base64');
setTestEnv({ RESEND_API_KEY: KEY, SYSTEM_EMAIL_FROM: 'VYNTEX Command <system@mail.example.com>', RESEND_WEBHOOK_SECRET: WH });
const resend = (await import('../../api/_lib/integrations/providers/resend.js')).default;
const { ProviderError } = await import('../../api/_lib/integrations/oauth.js');
const { env } = await import('../../api/_lib/env.js');
const { sendSystemEmail, inviteEmail, resetEmail, alertEmail } = await import('../../api/_lib/mail.js');
const TENANT = '11111111-1111-4111-8111-111111111111';

function ctxWith(responder) {
  const calls = [];
  const ctx = { provider: 'resend', tenantId: TENANT, env, now: () => Date.now(), fetch: async (url, init) => { calls.push({ url: String(url), init }); return responder(String(url), init); } };
  return { ctx, calls };
}
const reply = (status, body) => new Response(JSON.stringify(body), { status });
const LEAK = 'Your account acct_9912 on plan Pro has key ending 7f3a';

test('shape of the adapter', () => {
  assert.equal(resend.id, 'resend'); assert.equal(resend.kind, 'key');
  assert.deepEqual(resend.env, ['RESEND_API_KEY', 'SYSTEM_EMAIL_FROM']);
  for (const fn of ['authUrl', 'exchange', 'refresh', 'revoke', 'status', 'health', 'sync']) assert.equal(typeof resend[fn], 'function', fn);
  assert.equal(typeof resend.webhook.verify, 'function'); assert.equal(typeof resend.webhook.handle, 'function');
  assert.equal(typeof resend.actions.sendEmail, 'function');
});

test('status: a verified sending domain means the connection is real', async () => {
  const { ctx, calls } = ctxWith(() => reply(200, { data: [{ id: 'dom_1', name: 'mail.example.com', status: 'verified' }, { id: 'dom_2', name: 'other.example.com', status: 'pending' }] }));
  const s = await resend.status(ctx);
  assert.deepEqual(s, { ok: true, account: { label: 'system@mail.example.com', ref: 'dom_1' }, scopes: ['send'] });
  assert.equal(calls[0].url, 'https://api.resend.com/domains');
  assert.equal(calls[0].init.headers.authorization, 'Bearer ' + KEY);
});

test('status: every way it can be wrong gives a reason, never "connected"', async () => {
  const cases = [
    [() => reply(200, { data: [{ id: 'd', name: 'mail.example.com', status: 'pending' }] }), 'domain_not_verified'],
    [() => reply(200, { data: [{ id: 'd', name: 'someone-else.example.com', status: 'verified' }] }), 'domain_not_found'],
    [() => reply(200, { data: [] }), 'domain_not_found'],
    [() => reply(403, { statusCode: 403, name: 'invalid_api_key', message: LEAK }), 'invalid_key'],
    [() => reply(401, { statusCode: 401, name: 'missing_api_key', message: LEAK }), 'invalid_key'],
    [() => reply(429, { name: 'rate_limit_exceeded', message: LEAK }), 'rate_limited'],
    [() => reply(500, { message: LEAK }), 'provider_error'],
    [() => new Response('<html>bad gateway</html>', { status: 502 }), 'provider_error'],
  ];
  for (const [responder, reason] of cases) {
    const s = await resend.status(ctxWith(responder).ctx);
    assert.equal(s.ok, false); assert.equal(s.reason, reason);
    assert.ok(!JSON.stringify(s).includes('acct_9912'), 'the provider text is not kept');
  }
  await assert.rejects(resend.status(ctxWith(() => { throw new TypeError('fetch failed'); }).ctx), (e) => e instanceof ProviderError && e.code === 'provider_unreachable');
});

test('status: a key limited to sending is a real key (Resend says so by name)', async () => {
  const s = await resend.status(ctxWith(() => reply(401, { statusCode: 401, name: 'restricted_api_key', message: 'This API key is restricted to only send emails' })).ctx);
  assert.deepEqual(s, { ok: true, account: { label: 'system@mail.example.com', ref: null }, scopes: ['send'] });
});

test('status: a sender that is not an address is refused before any call', async () => {
  const keep = process.env.SYSTEM_EMAIL_FROM;
  process.env.SYSTEM_EMAIL_FROM = 'not an address';
  const { ctx, calls } = ctxWith(() => reply(200, {}));
  assert.deepEqual(await resend.status(ctx), { ok: false, reason: 'sender_invalid' });
  assert.equal(calls.length, 0);
  process.env.SYSTEM_EMAIL_FROM = keep;
});

test('health: ok when status is ok, and asks for a new key when the key is refused', async () => {
  assert.deepEqual(await resend.health(ctxWith(() => reply(200, { data: [{ id: 'd', name: 'mail.example.com', status: 'verified' }] })).ctx), { ok: true, health: 'ok' });
  assert.deepEqual(await resend.health(ctxWith(() => reply(403, { name: 'invalid_api_key' })).ctx), { ok: false, reason: 'invalid_key', reauth: true });
});

test('sendEmail: the request Resend receives', async () => {
  const { ctx, calls } = ctxWith(() => reply(200, { id: 'email_123' }));
  const out = await resend.actions.sendEmail(ctx, { to: 'client@example.com', subject: 'Hello\r\nBcc: other@example.com', text: 'Body', replyTo: 'office@example.com', idempotencyKey: 'invite:abc' });
  assert.deepEqual(out, { id: 'email_123' });
  const { url, init } = calls[0];
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.authorization, 'Bearer ' + KEY);
  assert.equal(init.headers['idempotency-key'], 'invite:abc');
  const body = JSON.parse(init.body);
  assert.equal(body.from, 'VYNTEX Command <system@mail.example.com>');
  assert.deepEqual(body.to, ['client@example.com']);
  assert.equal(body.subject, 'Hello Bcc: other@example.com', 'line breaks cannot be used to add headers');
  assert.equal(body.reply_to, 'office@example.com');
  assert.deepEqual(body.tags, [{ name: 'vx_tenant', value: TENANT }]);
});

test('sendEmail: bad input is refused before any call', async () => {
  const { ctx, calls } = ctxWith(() => reply(200, { id: 'x' }));
  await assert.rejects(resend.actions.sendEmail(ctx, { to: 'not-an-address', subject: 's', text: 't' }), (e) => e.code === 'recipient_invalid');
  await assert.rejects(resend.actions.sendEmail(ctx, { to: [], subject: 's', text: 't' }), (e) => e.code === 'recipient_invalid');
  await assert.rejects(resend.actions.sendEmail(ctx, { to: 'a@example.com', subject: '', text: 't' }), (e) => e.code === 'message_invalid');
  await assert.rejects(resend.actions.sendEmail(ctx, { to: 'a@example.com', subject: 's' }), (e) => e.code === 'message_invalid');
  assert.equal(calls.length, 0);
});

test('sendEmail: provider failures become codes and the provider text is dropped', async () => {
  const cases = [[403, { name: 'invalid_api_key', message: LEAK }, 'invalid_key'], [403, { name: 'validation_error', message: LEAK }, 'sender_not_allowed'], [422, { name: 'validation_error', message: LEAK }, 'message_rejected'], [429, { name: 'rate_limit_exceeded', message: LEAK }, 'rate_limited'], [500, { message: LEAK }, 'provider_error'], [200, { no_id: true }, 'provider_error']];
  for (const [status, body, code] of cases) {
    await assert.rejects(resend.actions.sendEmail(ctxWith(() => reply(status, body)).ctx, { to: 'a@example.com', subject: 's', text: 't' }),
      (e) => e instanceof ProviderError && e.code === code && !e.message.includes('acct_9912') && !JSON.stringify(e).includes('acct_9912'), `${status} ${code}`);
  }
});

test('sendSystemEmail never throws and says honestly when nothing was sent', async () => {
  const good = await sendSystemEmail({ to: 'a@example.com', subject: 's', text: 't', fetchFn: async () => reply(200, { id: 'email_9' }) });
  assert.deepEqual(good, { delivered: true, id: 'email_9' });
  const bad = await sendSystemEmail({ to: 'a@example.com', subject: 's', text: 't', fetchFn: async () => reply(500, { message: LEAK }) });
  assert.deepEqual(bad, { delivered: false, reason: 'provider_error' });
  const keep = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  let called = false;
  const none = await sendSystemEmail({ to: 'a@example.com', subject: 's', text: 't', fetchFn: async () => { called = true; return reply(200, {}); } });
  assert.deepEqual(none, { delivered: false, reason: 'not_configured' });
  assert.equal(called, false);
  process.env.RESEND_API_KEY = keep;
});

test('webhook: a signed event is accepted and reduced to ids and types', async () => {
  const body = JSON.stringify({ type: 'email.bounced', created_at: '2026-01-01T00:00:00Z', data: { email_id: 'e_77', to: ['private-person@example.com'], subject: 'Private subject', tags: { vx_tenant: TENANT } } });
  const request = new Request(ORIGIN + '/api/webhooks/resend', { method: 'POST', headers: svixHeaders(WH, body, { id: 'msg_55' }), body });
  const v = resend.webhook.verify(request, Buffer.from(body), { env, now: () => Date.now() });
  assert.equal(v.ok, true); assert.equal(v.eventId, 'msg_55'); assert.equal(v.type, 'email.bounced'); assert.equal(v.tenantId, TENANT);
  assert.deepEqual(v.redacted, { type: 'email.bounced', email_id: 'e_77', created_at: '2026-01-01T00:00:00Z' });
  assert.ok(!JSON.stringify(v).includes('private-person'), 'no recipient in what is stored');
  assert.ok(!JSON.stringify(v).includes('Private subject'), 'no subject in what is stored');
});

test('webhook: tags as a list, a missing company, a bad signature, no secret', async () => {
  const mk = (payload, headers) => { const b = JSON.stringify(payload); return [new Request(ORIGIN + '/x', { method: 'POST', headers: headers || svixHeaders(WH, b), body: b }), Buffer.from(b)]; };
  const ctx = { env, now: () => Date.now() };
  let [rq, raw] = mk({ type: 'email.sent', data: { email_id: 'e', tags: [{ name: 'vx_tenant', value: TENANT }] } });
  assert.equal(resend.webhook.verify(rq, raw, ctx).tenantId, TENANT);
  [rq, raw] = mk({ type: 'email.sent', data: { email_id: 'e', tags: { vx_tenant: 'not-a-uuid' } } });
  assert.equal(resend.webhook.verify(rq, raw, ctx).tenantId, null);
  [rq, raw] = mk({ type: 'email.sent', data: {} }, { ...svixHeaders(WH, '{}'), });
  assert.equal(resend.webhook.verify(rq, raw, ctx).reason, 'bad_signature');
  const b = 'not json'; const r2 = new Request(ORIGIN + '/x', { method: 'POST', headers: svixHeaders(WH, b), body: b });
  assert.equal(resend.webhook.verify(r2, Buffer.from(b), ctx).reason, 'bad_payload');
  const keep = process.env.RESEND_WEBHOOK_SECRET; delete process.env.RESEND_WEBHOOK_SECRET;
  [rq, raw] = mk({ type: 'email.sent', data: {} });
  assert.equal(resend.webhook.verify(rq, raw, ctx).reason, 'not_configured');
  process.env.RESEND_WEBHOOK_SECRET = keep;
});

test('system email wording: both languages, the link, no dash characters', () => {
  const samples = [
    inviteEmail({ lang: 'en', company: 'Sample Company', inviter: 'Sample Owner', link: 'https://app.example.com/invite/tok', hours: 72 }),
    inviteEmail({ lang: 'es', company: 'Sample Company', inviter: 'Sample Owner', link: 'https://app.example.com/invite/tok', hours: 72 }),
    resetEmail({ lang: 'en', link: 'https://app.example.com/reset-password#token=t' }),
    resetEmail({ lang: 'es', link: 'https://app.example.com/reset-password#token=t' }),
    alertEmail({ kind: 'signin.failed', count: 12, minutes: 60 }),
    alertEmail({ kind: 'export.requested', count: 5, minutes: 60 }),
  ];
  for (const m of samples) {
    assert.ok(m.subject.length > 5 && m.text.length > 40);
    assert.ok(!/[\u2013\u2014]/.test(m.subject + m.text), 'no em or en dashes');
  }
  assert.match(samples[0].text, /https:\/\/app\.example\.com\/invite\/tok/);
  assert.match(samples[1].text, /le invitó/); assert.match(samples[1].text, /vence en 72 horas/);
  assert.match(samples[3].text, /Si usted no lo solicitó/);
  assert.match(samples[4].text, /12 failed sign-in attempts/); assert.match(samples[4].text, /12 intentos fallidos/);
});
