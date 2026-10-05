// The Square adapter against mocked Square responses. Nothing here reaches Square: any call that is not answered by
// the mock fails the test. Not proven against the live service: no credentials exist in this build.
// The matrix of the brief, section 98: connect, disconnect, reconnect, expired token, revoked permission, wrong
// account, webhook (valid, bad signature, duplicate event), outage, rate limit, malformed payload, successful sync.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { setTestEnv, ORIGIN } from '../server/helpers.mjs';

const SECRET = 'sq0csp-' + randomBytes(16).toString('hex');
const SIGKEY = randomBytes(16).toString('hex');
setTestEnv({ SQUARE_APPLICATION_ID: 'sandbox-sq0idb-test', SQUARE_APPLICATION_SECRET: SECRET, SQUARE_ENVIRONMENT: 'sandbox', SQUARE_WEBHOOK_SIGNATURE_KEY: SIGKEY });
for (const k of ['SQUARE_OAUTH_FLOW', 'SQUARE_API_VERSION', 'SQUARE_WEBHOOK_URL', 'SQUARE_EXPECTED_MERCHANT_ID']) delete process.env[k];
const square = (await import('../../api/_lib/integrations/providers/square.js')).default;
const { slimPayment } = await import('../../api/_lib/integrations/providers/square.js');
const { ProviderError } = await import('../../api/_lib/integrations/oauth.js');
const { env } = await import('../../api/_lib/env.js');
const { memoryFinance } = await import('../../api/_lib/integrations/finance/memory.js');
const { refCode } = await import('../../api/_lib/integrations/finance/reconcile.js');

const TENANT = '11111111-1111-4111-8111-111111111111';
const A1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const C1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const HOST = 'https://connect.squareupsandbox.com';
const TOKENS = { access_token: 'EAAA-access-' + randomBytes(8).toString('hex'), refresh_token: 'EQAA-refresh-' + randomBytes(8).toString('hex'), expires_at: new Date(Date.now() + 86400000).toISOString(), scope: '', token_type: 'Bearer', merchant_id: 'MERCHANT_1' };
const LEAK = 'Seller Sample Person at 12 Sample Street card ending 4242';
const reply = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const sqError = (status, code, category = 'AUTHENTICATION_ERROR') => reply(status, { errors: [{ category, code, detail: LEAK }] });

/** A context whose fetch is answered by `routes`: { 'GET /v2/...': (url, init) => Response }. An unknown call fails. */
function ctxWith(routes, extra = {}) {
  const calls = []; const cursors = new Map(extra.cursors || []);
  const ctx = {
    provider: 'square', tenantId: TENANT, tokens: TOKENS, connection: null, env, now: () => Date.now(), redirectUri: ORIGIN + '/api/integrations/square/callback',
    cursor: { get: async (k) => cursors.get(k) ?? null, set: async (k, v) => { cursors.set(k, v); return true; } },
    fetch: async (url, init = {}) => {
      const u = new URL(String(url)); const key = `${init.method || 'GET'} ${u.pathname}`;
      calls.push({ key, url: String(url), init, body: init.body ? JSON.parse(init.body) : null });
      assert.equal(u.origin, HOST, 'only the sandbox host is called');
      const route = typeof routes === 'function' ? routes : routes[key];
      if (!route) throw new Error('unexpected call: ' + key);
      return route(u, init);
    },
    ...extra,
  };
  return { ctx, calls, cursors };
}
const merchant = (id = 'MERCHANT_1') => () => reply(200, { merchant: { id, business_name: 'Sample Business', country: 'US', currency: 'USD', status: 'ACTIVE' } });
const payment = (extra = {}) => ({ id: 'pay_1', status: 'COMPLETED', amount_money: { amount: 7500, currency: 'USD' }, order_id: 'ord_1', customer_id: 'CUST_1', created_at: '2026-01-05T15:00:00Z',
  card_details: { card: { last_4: '4242', card_brand: 'VISA', fingerprint: 'sq-1-fingerprint' } }, buyer_email_address: 'buyer@example.com', receipt_url: 'https://squareup.example/receipt', note: 'thanks from Sample Person', ...extra });
function signed(body, { key = SIGKEY, url = ORIGIN + '/api/webhooks/square' } = {}) {
  const raw = Buffer.from(JSON.stringify(body));
  const sig = createHmac('sha256', key).update(url).update(raw).digest('base64');
  return [new Request(url, { method: 'POST', headers: { 'x-square-hmacsha256-signature': sig }, body: raw }), raw];
}
const event = (extra = {}) => ({ merchant_id: 'MERCHANT_1', type: 'payment.updated', event_id: 'evt_1', created_at: new Date().toISOString(), data: { type: 'payment', id: 'pay_1', object: { payment: payment() } }, ...extra });
const vctx = { provider: 'square', env, now: () => Date.now() };

test('shape of the adapter', () => {
  assert.equal(square.id, 'square'); assert.equal(square.kind, 'oauth'); assert.equal(square.approval, null);
  assert.deepEqual(square.env, ['SQUARE_APPLICATION_ID', 'SQUARE_APPLICATION_SECRET', 'SQUARE_ENVIRONMENT', 'SQUARE_WEBHOOK_SIGNATURE_KEY']);
  for (const fn of ['authUrl', 'exchange', 'refresh', 'revoke', 'status', 'health', 'sync']) assert.equal(typeof square[fn], 'function', fn);
  assert.equal(typeof square.webhook.verify, 'function'); assert.equal(typeof square.webhook.handle, 'function'); assert.equal(typeof square.actions.createPaymentLink, 'function');
  assert.ok(!square.scopes.some((s) => /BANK|EMPLOYEE|PAYOUT|CARDS|GIFTCARD/.test(s)), 'no scope beyond what is built');
});

test('connect: the consent address, the server-side exchange, and the real call that earns "connected"', async () => {
  const { ctx, calls } = ctxWith({
    'POST /oauth2/token': () => reply(200, { access_token: TOKENS.access_token, token_type: 'bearer', expires_at: TOKENS.expires_at, merchant_id: 'MERCHANT_1', refresh_token: TOKENS.refresh_token }),
    'GET /v2/merchants/me': merchant(),
  });
  const url = new URL(square.authUrl({ ...ctx, state: 'state-abc', challenge: 'challenge-xyz' }));
  assert.equal(url.origin + url.pathname, HOST + '/oauth2/authorize');
  assert.equal(url.searchParams.get('client_id'), 'sandbox-sq0idb-test'); assert.equal(url.searchParams.get('state'), 'state-abc');
  assert.equal(url.searchParams.get('redirect_uri'), ORIGIN + '/api/integrations/square/callback');
  assert.equal(url.searchParams.get('scope'), square.scopes.join(' '));
  assert.ok(!url.toString().includes(SECRET), 'the secret never goes to the browser');
  const tokens = await square.exchange({ ...ctx, tokens: null, verifier: 'verifier-123' }, 'code-1');
  assert.deepEqual(tokens, { access_token: TOKENS.access_token, refresh_token: TOKENS.refresh_token, expires_at: TOKENS.expires_at, scope: '', token_type: 'Bearer', merchant_id: 'MERCHANT_1' });
  assert.deepEqual(calls[0].body, { client_id: 'sandbox-sq0idb-test', grant_type: 'authorization_code', code: 'code-1', redirect_uri: ORIGIN + '/api/integrations/square/callback', client_secret: SECRET });
  const s = await square.status({ ...ctx, tokens });
  assert.deepEqual(s, { ok: true, account: { label: 'Sample Business (sandbox)', ref: 'MERCHANT_1' }, scopes: square.scopes });
  assert.equal(calls[1].init.headers.authorization, 'Bearer ' + TOKENS.access_token);
  assert.match(calls[1].init.headers['square-version'], /^\d{4}-\d{2}-\d{2}$/);
});

test('connect with PKCE: the challenge goes out, the verifier replaces the secret', async () => {
  process.env.SQUARE_OAUTH_FLOW = 'pkce';
  const { ctx, calls } = ctxWith({ 'POST /oauth2/token': () => reply(200, { access_token: 'a', expires_at: TOKENS.expires_at, merchant_id: 'MERCHANT_1', refresh_token: 'r2' }) });
  const url = new URL(square.authUrl({ ...ctx, state: 's', challenge: 'challenge-xyz' }));
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-xyz'); assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  await square.exchange({ ...ctx, verifier: 'verifier-123' }, 'code-1');
  assert.equal(calls[0].body.code_verifier, 'verifier-123'); assert.equal(calls[0].body.client_secret, undefined);
  // the refresh token rotates in this flow: the new one is the one kept
  const next = await square.refresh(ctx, { ...TOKENS, refresh_token: 'r1' });
  assert.equal(next.refresh_token, 'r2'); assert.equal(calls[1].body.client_secret, undefined); assert.equal(next.merchant_id, 'MERCHANT_1');
  delete process.env.SQUARE_OAUTH_FLOW;
});

test('sandbox or production is a setting with no default, and production is a different host', async () => {
  process.env.SQUARE_ENVIRONMENT = 'production';
  const u = new URL(square.authUrl({ env, redirectUri: 'https://app.example.com/cb', state: 's', challenge: 'c' }));
  assert.equal(u.origin, 'https://connect.squareup.com'); assert.equal(u.searchParams.get('session'), 'false');
  for (const bad of ['', 'live', 'prod', 'PRODUCTION ']) {
    process.env.SQUARE_ENVIRONMENT = bad;
    if (bad.trim().toLowerCase() === 'production') continue;
    assert.throws(() => square.authUrl({ env, redirectUri: 'x', state: 's', challenge: 'c' }), (e) => e.code === 'environment_invalid', `"${bad}" is not guessed`);
  }
  process.env.SQUARE_ENVIRONMENT = 'sandbox';
});

test('disconnect: the token is revoked at Square with the application secret', async () => {
  const { ctx, calls } = ctxWith({ 'POST /oauth2/revoke': () => reply(200, { success: true }) });
  await square.revoke(ctx, TOKENS);
  assert.equal(calls[0].init.headers.authorization, 'Client ' + SECRET);
  assert.deepEqual(calls[0].body, { client_id: 'sandbox-sq0idb-test', access_token: TOKENS.access_token });
  await assert.rejects(square.revoke(ctxWith({ 'POST /oauth2/revoke': () => sqError(401, 'UNAUTHORIZED') }).ctx, TOKENS), (e) => e instanceof ProviderError);
});

test('reconnect: the same Square account is accepted, another one is refused as the wrong account', async () => {
  const before = { account_ref: 'MERCHANT_1' };
  assert.equal((await square.status(ctxWith({ 'GET /v2/merchants/me': merchant('MERCHANT_1') }, { connection: before }).ctx)).ok, true);
  assert.deepEqual(await square.status(ctxWith({ 'GET /v2/merchants/me': merchant('MERCHANT_OTHER') }, { connection: before }).ctx), { ok: false, reason: 'wrong_account' });
  assert.deepEqual(await square.health(ctxWith({ 'GET /v2/merchants/me': merchant('MERCHANT_OTHER') }, { connection: before }).ctx), { ok: false, reason: 'wrong_account', reauth: true });
  // a deployment that serves one company can name the only account it accepts
  process.env.SQUARE_EXPECTED_MERCHANT_ID = 'MERCHANT_LBS';
  assert.deepEqual(await square.status(ctxWith({ 'GET /v2/merchants/me': merchant('MERCHANT_1') }).ctx), { ok: false, reason: 'wrong_account' });
  delete process.env.SQUARE_EXPECTED_MERCHANT_ID;
  assert.deepEqual(await square.status(ctxWith({ 'GET /v2/merchants/me': () => reply(200, { merchant: { id: 'M', status: 'INACTIVE' } }) }).ctx), { ok: false, reason: 'account_inactive' });
});

test('expired token and revoked permission: a code and "connect again", never the provider text', async () => {
  const cases = [
    [() => sqError(401, 'ACCESS_TOKEN_EXPIRED'), 'token_expired', true],
    [() => sqError(401, 'ACCESS_TOKEN_REVOKED'), 'token_revoked', true],
    [() => sqError(401, 'UNAUTHORIZED'), 'token_rejected', true],
    [() => sqError(403, 'INSUFFICIENT_SCOPES', 'AUTHENTICATION_ERROR'), 'permission_revoked', true],
    [() => sqError(403, 'FORBIDDEN'), 'forbidden', false],
  ];
  for (const [responder, code, reauth] of cases) {
    await assert.rejects(square.status(ctxWith({ 'GET /v2/merchants/me': responder }).ctx),
      (e) => e instanceof ProviderError && e.code === code && e.reauth === reauth && !e.message.includes('Sample') && !JSON.stringify(e).includes('4242'), code);
  }
  // the refresh token itself is refused: the person has to connect again
  await assert.rejects(square.refresh(ctxWith({ 'POST /oauth2/token': () => reply(401, { message: LEAK, type: 'service.not_authorized' }) }).ctx, TOKENS), (e) => e.code === 'token_revoked' && e.reauth === true);
  await assert.rejects(square.exchange(ctxWith({ 'POST /oauth2/token': () => reply(400, { message: LEAK }) }).ctx, 'used-code'), (e) => e.code === 'token_exchange_failed' && e.reauth === false);
  await assert.rejects(square.status({ ...ctxWith({}).ctx, tokens: null }), (e) => e.code === 'not_connected');
});

test('outage, rate limit and malformed answers become codes; status never says ok without an answer', async () => {
  const cases = [
    [() => { throw new TypeError('fetch failed'); }, 'provider_unreachable'],
    [() => reply(503, '<html>Service Unavailable</html>'), 'provider_error'],
    [() => sqError(429, 'RATE_LIMITED', 'RATE_LIMIT_ERROR'), 'rate_limited'],
    [() => reply(200, '<html>not json</html>'), 'bad_response'],
    [() => reply(200, '[]'), 'bad_response'],
  ];
  for (const [responder, code] of cases) await assert.rejects(square.status(ctxWith({ 'GET /v2/merchants/me': responder }).ctx), (e) => e instanceof ProviderError && e.code === code && e.reauth === false, code);
  assert.deepEqual(await square.status(ctxWith({ 'GET /v2/merchants/me': () => reply(200, { merchant: {} }) }).ctx), { ok: false, reason: 'account_unknown' });
  await assert.rejects(square.refresh(ctxWith({ 'POST /oauth2/token': () => reply(429, {}) }).ctx, TOKENS), (e) => e.code === 'rate_limited' && e.reauth === false, 'a rate limit on refresh does not throw the connection away');
  await assert.rejects(square.refresh(ctxWith({ 'POST /oauth2/token': () => reply(502, 'bad gateway') }).ctx, TOKENS), (e) => e.code === 'provider_error' && e.reauth === false);
});

test('webhook: a signed event is accepted and reduced to its type and ids', () => {
  const [request, raw] = signed(event());
  const v = square.webhook.verify(request, raw, vctx);
  assert.equal(v.ok, true); assert.equal(v.eventId, 'evt_1'); assert.equal(v.type, 'payment.updated'); assert.equal(v.accountRef, 'MERCHANT_1');
  assert.deepEqual(Object.keys(v.redacted).sort(), ['created_at', 'object_id', 'object_type', 'type']);
  assert.equal(v.redacted.object_id, 'pay_1');
  const kept = JSON.stringify(v);
  for (const secret of ['4242', '7500', 'buyer@example.com', 'Sample Person', 'fingerprint']) assert.ok(!kept.includes(secret), `"${secret}" is not kept`);
});

test('webhook: a bad signature, another address, a changed body, a missing header, no key', () => {
  const body = event();
  let [request, raw] = signed(body, { key: 'another-key' });
  assert.equal(square.webhook.verify(request, raw, vctx).reason, 'bad_signature');
  [request, raw] = signed(body, { url: 'https://attacker.example.com/api/webhooks/square' });
  assert.equal(square.webhook.verify(new Request(ORIGIN + '/api/webhooks/square', { method: 'POST', headers: request.headers, body: raw }), raw, vctx).reason, 'bad_signature', 'the address is part of what is signed');
  [request, raw] = signed(body);
  assert.equal(square.webhook.verify(request, Buffer.from(raw.toString().replace('7500', '1')), vctx).reason, 'bad_signature');
  assert.equal(square.webhook.verify(new Request(ORIGIN + '/x', { method: 'POST', body: raw }), raw, vctx).reason, 'signature_missing');
  const keep = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY; delete process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  assert.equal(square.webhook.verify(request, raw, vctx).reason, 'not_configured');
  process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = keep;
  // the registered address can be set when it differs from the site address
  process.env.SQUARE_WEBHOOK_URL = 'https://hooks.example.com/sq';
  [request, raw] = signed(body, { url: 'https://hooks.example.com/sq' });
  assert.equal(square.webhook.verify(request, raw, vctx).ok, true);
  delete process.env.SQUARE_WEBHOOK_URL;
});

test('webhook: malformed payloads and old events are refused even when correctly signed', () => {
  for (const bad of [{ type: 'payment.updated' }, { ...event(), event_id: '' }, { ...event(), merchant_id: null }, { ...event(), type: 'DROP TABLE' }, [1, 2]]) {
    const [request, raw] = signed(bad);
    assert.equal(square.webhook.verify(request, raw, vctx).reason, 'bad_payload');
  }
  const raw = Buffer.from('not json at all'); const sig = createHmac('sha256', SIGKEY).update(ORIGIN + '/api/webhooks/square').update(raw).digest('base64');
  assert.equal(square.webhook.verify(new Request(ORIGIN + '/x', { method: 'POST', headers: { 'x-square-hmacsha256-signature': sig }, body: raw }), raw, vctx).reason, 'bad_payload');
  let [request, body] = signed(event({ created_at: new Date(Date.now() - 3 * 86400000).toISOString() }));
  assert.equal(square.webhook.verify(request, body, vctx).reason, 'stale');
  [request, body] = signed(event({ created_at: new Date(Date.now() - 6 * 3600000).toISOString() }));
  assert.equal(square.webhook.verify(request, body, vctx).ok, true, 'a retry Square sends hours later is still accepted');
  [request, body] = signed(event({ created_at: 'yesterday' }));
  assert.equal(square.webhook.verify(request, body, vctx).reason, 'stale');
});

test('webhook: payment.updated is read from Square by id, placed by the rules and recorded once', async () => {
  const finance = memoryFinance({ clients: [{ id: C1, externalIds: { square: 'CUST_1' } }], contexts: [{ kind: 'appointment', id: A1, clientId: C1, dueCents: 7500 }] });
  await finance.intentPut({ provider: 'square', orderId: 'ord_1', kind: 'appointment', id: A1, cents: 7500 });
  const { ctx, calls } = ctxWith({ 'GET /v2/payments/pay_1': () => reply(200, { payment: payment() }) }, { finance });
  const stored = { event_id: 'evt_1', redacted: { type: 'payment.updated', object_type: 'payment', object_id: 'pay_1' } };
  const out = await square.webhook.handle(ctx, stored);
  assert.equal(out.ok, true); assert.equal(out.ignored, false);
  assert.deepEqual(out.result, { outcome: 'matched', rule: 'order', reason: null, balanceCents: 0, context: { kind: 'appointment', id: A1 } });
  assert.deepEqual(finance.state.contexts[0].paid, { method: 'card', ref: 'square:pay_1', cents: 7500 });
  // Square sends payment.updated several times for one payment, and may repeat a delivery: nothing is counted twice
  const again = await square.webhook.handle(ctx, { ...stored, event_id: 'evt_2' });
  assert.equal(again.result.outcome, 'duplicate');
  await square.webhook.handle(ctx, stored);
  assert.equal(finance.state.payments.size, 1); assert.equal(finance.state.contexts[0].paidCents, 7500); assert.equal(calls.length, 3);
  const row = JSON.stringify([...finance.state.payments.values()]);
  for (const secret of ['4242', 'VISA', 'fingerprint', 'buyer@example.com', 'Sample Person', 'receipt']) assert.ok(!row.includes(secret), `"${secret}" never reaches the ledger`);
});

test('webhook: pending payments wait, unknown payments go to the unmatched list, other events are ignored', async () => {
  const finance = memoryFinance({ contexts: [{ kind: 'appointment', id: A1, clientId: C1, dueCents: 7500 }] });
  const mk = (p) => ctxWith({ 'GET /v2/payments/pay_1': () => reply(200, { payment: p }) }, { finance }).ctx;
  const stored = { event_id: 'evt_1', redacted: { type: 'payment.updated', object_id: 'pay_1' } };
  assert.deepEqual(await square.webhook.handle(mk(payment({ status: 'APPROVED' })), stored), { ok: true, ignored: true, result: { outcome: 'ignored', reason: 'not_completed' } });
  assert.equal(finance.state.payments.size, 0);
  const out = await square.webhook.handle(mk(payment({ order_id: 'ord_unknown', customer_id: 'CUST_UNKNOWN' })), stored);
  assert.equal(out.result.outcome, 'unmatched'); assert.equal(out.result.reason, 'no_reference');
  assert.deepEqual(await finance.unmatched('square'), [{ externalId: 'pay_1', cents: 7500, status: 'unmatched', reason: 'no_reference', candidates: [] }]);
  assert.equal(finance.state.contexts[0].paidCents, 0);
  assert.deepEqual(await square.webhook.handle(mk(payment()), { redacted: { type: 'customer.created', object_id: 'CUST_1' } }), { ok: true, ignored: true });
  // a malformed payment from Square is an error to retry, not a zero payment
  await assert.rejects(square.webhook.handle(mk({ id: 'pay_1', status: 'COMPLETED', amount_money: { amount: '75.00', currency: 'USD' } }), stored), (e) => e.code === 'bad_response');
  await assert.rejects(square.webhook.handle({ ...mk(payment()), tokens: null }, stored), (e) => e.code === 'not_connected');
  await assert.rejects(square.webhook.handle(mk(payment()), { redacted: { type: 'payment.updated', object_id: null } }), (e) => e.code === 'bad_payload');
});

test('webhook: refund.updated and invoice.payment_made', async () => {
  const finance = memoryFinance({ contexts: [{ kind: 'appointment', id: A1, clientId: C1, dueCents: 7500 }] });
  const routes = {
    'GET /v2/payments/pay_1': () => reply(200, { payment: payment({ order_id: 'ord_inv', reference_id: refCode('appointment', A1) }) }),
    'GET /v2/invoices/inv_1': () => reply(200, { invoice: { id: 'inv_1', order_id: 'ord_inv', status: 'PAID' } }),
    'GET /v2/orders/ord_inv': () => reply(200, { order: { id: 'ord_inv', tenders: [{ id: 'pay_1', payment_id: 'pay_1' }] } }),
    'GET /v2/refunds/ref_1': () => reply(200, { refund: { id: 'ref_1', status: 'COMPLETED', payment_id: 'pay_1', amount_money: { amount: 2500, currency: 'USD' } } }),
  };
  const { ctx } = ctxWith(routes, { finance });
  const inv = await square.webhook.handle(ctx, { event_id: 'evt_i', redacted: { type: 'invoice.payment_made', object_id: 'inv_1' } });
  assert.equal(inv.result[0].outcome, 'matched'); assert.equal(inv.result[0].rule, 'reference');
  assert.equal((await square.webhook.handle(ctx, { event_id: 'evt_p', redacted: { type: 'payment.updated', object_id: 'pay_1' } })).result.outcome, 'duplicate', 'the payment event for the same money');
  const ref = await square.webhook.handle(ctx, { event_id: 'evt_r', redacted: { type: 'refund.updated', object_id: 'ref_1' } });
  assert.deepEqual(ref.result, { outcome: 'recorded', reason: null, balanceCents: 2500 });
  assert.equal((await square.webhook.handle(ctx, { event_id: 'evt_r2', redacted: { type: 'refund.updated', object_id: 'ref_1' } })).result.outcome, 'duplicate');
  assert.equal(finance.state.contexts[0].paidCents, 5000);
});

test('sync, customers: a preview links nothing; apply needs the preview and never overwrites', async () => {
  const finance = memoryFinance({ clients: [{ id: C1, name: 'Sample Person One', email: 'one@example.com', phone: '609-555-0101' }] });
  const pages = [{ customers: [{ id: 'CUST_1', given_name: 'Sample', family_name: 'Person One', email_address: 'ONE@example.com', phone_number: '+16095550199' }], cursor: 'next-1' }, { customers: [{ id: 'CUST_2', given_name: 'Nobody', email_address: 'none@example.com' }] }];
  let n = 0;
  const { ctx, calls, cursors } = ctxWith({ 'POST /v2/customers/search': () => reply(200, pages[n++ % 2]) }, { finance });
  await assert.rejects(square.sync(ctx, 'customers:apply'), (e) => e.code === 'preview_required');
  assert.equal(calls.length, 0, 'refused before any call');
  const preview = (await square.sync(ctx, 'customers')).counts.customers;
  assert.deepEqual(preview, { seen: 2, linked: 0, proposed: 1, needsReview: 0, unlinked: 1, applied: 0, complete: true, mode: 'preview' });
  assert.equal(calls[1].body.cursor, 'next-1');
  assert.deepEqual(finance.state.clients[0].externalIds, {}, 'a preview writes nothing on the client');
  assert.ok(cursors.get('customers.preview_at'));
  const since = cursors.get('customers.since');
  const applied = (await square.sync(ctx, 'customers:apply')).counts.customers;
  assert.equal(applied.applied, 1); assert.equal(applied.mode, 'apply');
  assert.equal(finance.state.clients[0].externalIds.square, 'CUST_1');
  assert.equal(finance.state.clients[0].phone, '609-555-0101', 'the local phone is not replaced by the one Square has');
  assert.equal(finance.state.clients[0].name, 'Sample Person One');
  assert.deepEqual((await finance.linkByExternal('square', 'customer', 'CUST_1')).differences, ['phone']);
  assert.equal((await finance.linkByExternal('square', 'customer', 'CUST_1')).state, 'needs_review');
  assert.ok(since); assert.equal(calls[0].body.query.filter, undefined, 'the first run reads everything');
  assert.equal(calls[2].body.query.filter.updated_at.start_at, since, 'the next run asks only for what changed since');
  await assert.rejects(square.sync(ctx, 'everything'), (e) => e.code === 'sync_unknown');
});

test('sync, catalog: proposals in; the push is insert only, previewed first, with idempotency keys', async () => {
  const finance = memoryFinance({ services: [
    { id: 's1', name: 'Tax return', externalIds: { square: 'ITEM_1' }, tiers: [{ id: 't1', name: 'Standard', priceCents: 17500, externalIds: { square: 'VAR_1' } }] },
    { id: 's2', name: 'Notary', tiers: [{ id: 't2', name: 'Per signature', priceCents: 1500 }] },
  ] });
  const routes = {
    'GET /v2/catalog/list': () => reply(200, { objects: [{ type: 'ITEM', id: 'ITEM_1', version: 3, item_data: { name: 'Tax return', variations: [{ type: 'ITEM_VARIATION', id: 'VAR_1', item_variation_data: { name: 'Standard', price_money: { amount: 15000, currency: 'USD' } } }] } }] }),
    'GET /v2/locations/main': () => reply(200, { location: { id: 'LOC_1', currency: 'USD' } }),
    'POST /v2/catalog/object': () => reply(200, { catalog_object: { type: 'ITEM', id: 'ITEM_NEW', version: 1 }, id_mappings: [{ client_object_id: '#vx-item', object_id: 'ITEM_NEW' }, { client_object_id: '#vx-tier-0', object_id: 'VAR_NEW' }] }),
  };
  const { ctx, calls } = ctxWith(routes, { finance });
  assert.deepEqual((await square.sync(ctx, 'catalog')).counts.catalog, { seen: 1, linked: 0, proposed: 0, needsReview: 1, unlinked: 0, complete: true, mode: 'proposals' });
  assert.equal(finance.state.services[0].tiers[0].priceCents, 17500, 'the local price is not changed by what Square has');
  await assert.rejects(square.sync(ctx, 'catalog_push:apply'), (e) => e.code === 'preview_required');
  const preview = (await square.sync(ctx, 'catalog_push')).counts.catalogPush;
  assert.equal(preview.mode, 'preview'); assert.equal(preview.create, 1); assert.equal(preview.created, 0);
  assert.deepEqual(preview.refusedList, [{ serviceId: 's1', reason: 'would_update', fields: ['price'] }]);
  assert.ok(!calls.some((c) => c.key === 'POST /v2/catalog/object'), 'a preview sends nothing');
  const done = (await square.sync(ctx, 'catalog_push:apply')).counts.catalogPush;
  assert.equal(done.created, 1); assert.equal(done.refused, 1);
  const writes = calls.filter((c) => c.init.method === 'POST');
  assert.equal(writes.length, 1, 'one create, and no call at all for the service that would have been an update');
  assert.match(writes[0].body.idempotency_key, /^vx-cat-[0-9a-f]{32}$/);
  assert.equal(writes[0].body.object.id, '#vx-item'); assert.ok(!JSON.stringify(writes[0].body).includes('ITEM_1')); assert.ok(!('version' in writes[0].body.object));
  assert.ok(!calls.some((c) => c.init.method === 'DELETE' || c.init.method === 'PUT'));
  assert.equal(finance.state.services[1].externalIds.square, 'ITEM_NEW'); assert.equal(finance.state.services[1].tiers[0].externalIds.square, 'VAR_NEW');
  assert.equal(finance.state.services[0].externalIds.square, 'ITEM_1');
  const audit = finance.state.audit.map((a) => `${a.action}:${a.outcome}:${a.code || ''}`);
  assert.ok(audit.includes('catalog.update_refused:refused:would_update')); assert.ok(audit.includes('catalog.create:ok:'));
});

test('sync, payments: the net under the webhooks goes through the same rules and is safe to repeat', async () => {
  const finance = memoryFinance({ contexts: [{ kind: 'appointment', id: A1, clientId: C1, dueCents: 7500 }] });
  const list = { payments: [payment({ reference_id: refCode('appointment', A1), order_id: null }), payment({ id: 'pay_2', order_id: null, customer_id: null }), payment({ id: 'pay_3', status: 'FAILED' })] };
  const { ctx, calls, cursors } = ctxWith({ 'GET /v2/payments': () => reply(200, list) }, { finance });
  assert.deepEqual((await square.sync(ctx, 'payments')).counts.payments, { seen: 3, matched: 1, unmatched: 1, ambiguous: 0, duplicate: 0, ignored: 1, complete: true });
  assert.deepEqual((await square.sync(ctx, 'payments')).counts.payments, { seen: 3, matched: 0, unmatched: 0, ambiguous: 0, duplicate: 2, ignored: 1, complete: true });
  assert.equal(finance.state.contexts[0].paidCents, 7500);
  assert.ok(cursors.get('payments.since')); assert.match(calls[1].url, /begin_time=/);
  // an outage in the middle fails the run and does not move the window
  const broken = ctxWith({ 'GET /v2/payments': () => reply(503, 'down') }, { finance, cursors: [['payments.since', '2026-01-01T00:00:00.000Z']] });
  await assert.rejects(square.sync(broken.ctx, 'payments'), (e) => e.code === 'provider_error');
  assert.equal(broken.cursors.get('payments.since'), '2026-01-01T00:00:00.000Z');
});

test('payment link: the balance of one appointment, in cents, with a stable key and the order remembered', async () => {
  const finance = memoryFinance({ contexts: [{ kind: 'appointment', id: A1, clientId: C1, dueCents: 7500, paidCents: 2500 }] });
  const routes = {
    'GET /v2/locations/main': () => reply(200, { location: { id: 'LOC_1', currency: 'USD' } }),
    'POST /v2/online-checkout/payment-links': () => reply(200, { payment_link: { id: 'LINK_1', version: 1, order_id: 'ord_77', url: 'https://sandbox.square.link/u/abc' } }),
  };
  const { ctx, calls } = ctxWith(routes, { finance });
  const out = await square.actions.createPaymentLink(ctx, { appointmentId: A1 });
  assert.deepEqual(out, { url: 'https://sandbox.square.link/u/abc', orderId: 'ord_77', linkId: 'LINK_1', cents: 5000, currency: 'USD' });
  const body = calls[1].body;
  assert.deepEqual(body.order.line_items, [{ name: 'Appointment fee', quantity: '1', base_price_money: { amount: 5000, currency: 'USD' } }]);
  assert.equal(body.order.reference_id, refCode('appointment', A1)); assert.equal(body.order.location_id, 'LOC_1');
  assert.equal(body.idempotency_key, `vx-pl-${refCode('appointment', A1)}-5000`);
  await square.actions.createPaymentLink(ctx, { appointmentId: A1 });
  assert.equal(calls[3].body.idempotency_key, body.idempotency_key, 'a second click asks Square for the same link');
  assert.equal(finance.state.intents.length, 1);
  assert.ok(!JSON.stringify(body).match(/card|cvv|pan|Sample/i), 'no card field and no name is sent');
  assert.equal(finance.state.audit[0].action, 'payment_link.create'); assert.equal(finance.state.audit[0].outcome, 'ok');
  // the payment that follows is placed by the stored order
  const paid = ctxWith({ 'GET /v2/payments/pay_9': () => reply(200, { payment: payment({ id: 'pay_9', order_id: 'ord_77', customer_id: null, amount_money: { amount: 5000, currency: 'USD' } }) }) }, { finance });
  assert.equal((await square.webhook.handle(paid.ctx, { redacted: { type: 'payment.updated', object_id: 'pay_9' } })).result.rule, 'order');
  await assert.rejects(square.actions.createPaymentLink(ctx, { appointmentId: A1 }), (e) => e.code === 'nothing_due');
  await assert.rejects(square.actions.createPaymentLink(ctx, { appointmentId: 'nope' }), (e) => e.code === 'invalid_request');
  await assert.rejects(square.actions.createPaymentLink(ctx, { appointmentId: C1 }), (e) => e.code === 'not_found');
  const failing = ctxWith({ ...routes, 'POST /v2/online-checkout/payment-links': () => sqError(429, 'RATE_LIMITED') }, { finance: memoryFinance({ contexts: [{ kind: 'appointment', id: A1, dueCents: 100 }] }) });
  await assert.rejects(square.actions.createPaymentLink(failing.ctx, { appointmentId: A1 }), (e) => e.code === 'rate_limited');
  assert.equal(failing.ctx.finance.state.audit[0].outcome, 'failed'); assert.equal(failing.ctx.finance.state.intents.length, 0);
});

test('no card data: what is kept of a payment has no card, buyer or receipt field', () => {
  const p = slimPayment(payment({ note: 'thanks ' + refCode('appointment', A1) + ' from Sample Person' }));
  assert.deepEqual(Object.keys(p).sort(), ['cents', 'currency', 'customerId', 'externalId', 'note', 'occurredAt', 'orderId', 'referenceId', 'status']);
  assert.equal(p.note, refCode('appointment', A1), 'only the code is taken out of the free text');
  assert.throws(() => slimPayment({ id: 'x', status: 'COMPLETED' }), (e) => e.code === 'bad_response');
});
