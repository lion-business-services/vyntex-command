// The QuickBooks Online adapter against mocked Intuit responses. Nothing here reaches Intuit: any call that is not
// answered by the mock fails the test. Not proven against the live service: no credentials exist in this build.
// The matrix of the brief, section 98: connect, disconnect, reconnect, expired token, revoked permission, wrong
// account, webhook (valid, bad signature, duplicate event), outage, rate limit, malformed payload, successful sync.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { setTestEnv, ORIGIN } from '../server/helpers.mjs';

const SECRET = 'qb-secret-' + randomBytes(16).toString('hex');
const VERIFIER = randomBytes(18).toString('hex');
setTestEnv({ QUICKBOOKS_CLIENT_ID: 'qb-client-test', QUICKBOOKS_CLIENT_SECRET: SECRET, QUICKBOOKS_ENVIRONMENT: 'sandbox', QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN: VERIFIER, QUICKBOOKS_APPROVED: 'true' });
delete process.env.QUICKBOOKS_MINOR_VERSION;
const qbo = (await import('../../api/_lib/integrations/providers/quickbooks.js')).default;
const { ProviderError } = await import('../../api/_lib/integrations/oauth.js');
const { env } = await import('../../api/_lib/env.js');
const { memoryFinance } = await import('../../api/_lib/integrations/finance/memory.js');
const { runPush, financeTick, NEEDS_PERSON } = await import('../../api/_lib/jobs/finance.js');
const { JobError } = await import('../../api/_lib/jobs.js');

const TENANT = '11111111-1111-4111-8111-111111111111';
const C1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const J1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const P1 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const REALM = '9341453000000001';
const API = 'https://sandbox-quickbooks.api.intuit.com';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const TOKENS = { access_token: 'qb-access-' + randomBytes(8).toString('hex'), refresh_token: 'qb-refresh-1-' + randomBytes(8).toString('hex'), expires_at: new Date(Date.now() + 3600000).toISOString(), scope: 'com.intuit.quickbooks.accounting', token_type: 'bearer', realm_id: REALM };
const LEAK = 'Customer Sample Person owes 1,250.00 on invoice 1041';
const reply = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const fault = (status, code) => reply(status, { Fault: { Error: [{ Message: LEAK, Detail: LEAK, code: String(code) }], type: 'ValidationFault' }, time: new Date().toISOString() });

function ctxWith(routes, extra = {}) {
  const calls = []; const cursors = new Map(extra.cursors || []);
  const ctx = {
    provider: 'quickbooks', tenantId: TENANT, tokens: TOKENS, connection: null, env, now: () => Date.now(), redirectUri: ORIGIN + '/api/integrations/quickbooks/callback',
    cursor: { get: async (k) => cursors.get(k) ?? null, set: async (k, v) => { cursors.set(k, v); return true; } },
    fetch: async (url, init = {}) => {
      const u = new URL(String(url));
      const path = u.origin === API ? u.pathname.replace(`/v3/company/${REALM}`, '') : u.origin + u.pathname;
      const key = `${init.method || 'GET'} ${path}`;
      let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch { body = Object.fromEntries(new URLSearchParams(init.body)); }
      calls.push({ key, url: u, init, body });
      const route = routes[key];
      if (!route) throw new Error('unexpected call: ' + key);
      return route(u, init);
    },
    ...extra,
  };
  return { ctx, calls, cursors };
}
const company = () => reply(200, { CompanyInfo: { Id: '1', CompanyName: 'Sample Books LLC', Country: 'US' }, time: new Date().toISOString() });
function signed(body, key = VERIFIER) {
  const raw = Buffer.from(JSON.stringify(body));
  return [new Request(ORIGIN + '/api/webhooks/quickbooks', { method: 'POST', headers: { 'intuit-signature': createHmac('sha256', key).update(raw).digest('base64') }, body: raw }), raw];
}
const notice = (extra = {}) => ({ eventNotifications: [{ realmId: REALM, dataChangeEvent: { entities: [{ name: 'Invoice', id: '145', operation: 'Update', lastUpdated: new Date().toISOString() }, { name: 'Customer', id: '58', operation: 'Create', lastUpdated: new Date().toISOString() }] } }], ...extra });
const vctx = { provider: 'quickbooks', env, now: () => Date.now() };

test('shape of the adapter', () => {
  assert.equal(qbo.id, 'quickbooks'); assert.equal(qbo.kind, 'oauth'); assert.deepEqual(qbo.scopes, ['com.intuit.quickbooks.accounting']);
  assert.deepEqual(qbo.env, ['QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET', 'QUICKBOOKS_ENVIRONMENT', 'QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN']);
  assert.equal(qbo.approval.needed, true); assert.equal(qbo.approval.flag, 'QUICKBOOKS_APPROVED');
  for (const fn of ['authUrl', 'exchange', 'refresh', 'revoke', 'status', 'health', 'sync']) assert.equal(typeof qbo[fn], 'function', fn);
  for (const a of ['createCustomer', 'pushInvoice', 'pushPayment']) assert.equal(typeof qbo.actions[a], 'function', a);
});

test('connect: consent address, server-side exchange with the realm id, and the real call that earns "connected"', async () => {
  const { ctx, calls } = ctxWith({
    [`POST ${TOKEN_URL}`]: () => reply(200, { access_token: TOKENS.access_token, refresh_token: TOKENS.refresh_token, expires_in: 3600, x_refresh_token_expires_in: 8726400, token_type: 'bearer' }),
    [`GET /companyinfo/${REALM}`]: company,
  });
  const url = new URL(qbo.authUrl({ ...ctx, state: 'state-abc', challenge: 'c' }));
  assert.equal(url.origin + url.pathname, 'https://appcenter.intuit.com/connect/oauth2');
  assert.equal(url.searchParams.get('scope'), 'com.intuit.quickbooks.accounting'); assert.equal(url.searchParams.get('state'), 'state-abc');
  assert.ok(!url.toString().includes(SECRET));
  const tokens = await qbo.exchange({ ...ctx, tokens: null, params: { realmId: REALM } }, 'code-1');
  assert.equal(tokens.realm_id, REALM); assert.equal(tokens.access_token, TOKENS.access_token); assert.ok(tokens.expires_at);
  assert.equal(calls[0].init.headers.authorization, 'Basic ' + Buffer.from(`qb-client-test:${SECRET}`).toString('base64'));
  assert.deepEqual(calls[0].body, { grant_type: 'authorization_code', code: 'code-1', redirect_uri: ORIGIN + '/api/integrations/quickbooks/callback' });
  const s = await qbo.status({ ...ctx, tokens });
  assert.deepEqual(s, { ok: true, account: { label: 'Sample Books LLC (sandbox)', ref: REALM }, scopes: ['com.intuit.quickbooks.accounting'] });
  assert.equal(calls[1].url.searchParams.get('minorversion'), '75');
  // without the realm id there is no company to connect to: refused before any call
  const none = ctxWith({});
  await assert.rejects(qbo.exchange({ ...none.ctx, params: {} }, 'code-1'), (e) => e.code === 'realm_missing');
  await assert.rejects(qbo.exchange({ ...none.ctx, params: { realmId: '../other' } }, 'code-1'), (e) => e.code === 'realm_missing');
  assert.equal(none.calls.length, 0);
});

test('sandbox or production is a setting with no default', async () => {
  process.env.QUICKBOOKS_ENVIRONMENT = 'production';
  const { ctx, calls } = ctxWith({});
  ctx.fetch = async (url) => { calls.push(String(url)); return company(); };
  await qbo.status(ctx);
  assert.match(calls[0], /^https:\/\/quickbooks\.api\.intuit\.com\/v3\/company\//);
  for (const bad of ['', 'live', 'prod']) { process.env.QUICKBOOKS_ENVIRONMENT = bad; await assert.rejects(qbo.status(ctx), (e) => e.code === 'environment_invalid'); }
  process.env.QUICKBOOKS_ENVIRONMENT = 'sandbox';
});

test('refresh: Intuit rotates the refresh token; the new one is kept, with the realm', async () => {
  const { ctx, calls } = ctxWith({ [`POST ${TOKEN_URL}`]: () => reply(200, { access_token: 'new-access', refresh_token: 'qb-refresh-2', expires_in: 3600, token_type: 'bearer' }) });
  const next = await qbo.refresh(ctx, TOKENS);
  assert.equal(next.refresh_token, 'qb-refresh-2'); assert.equal(next.access_token, 'new-access'); assert.equal(next.realm_id, REALM);
  assert.deepEqual(calls[0].body, { grant_type: 'refresh_token', refresh_token: TOKENS.refresh_token });
  // an answer without a new refresh token keeps the one in hand
  const same = await qbo.refresh(ctxWith({ [`POST ${TOKEN_URL}`]: () => reply(200, { access_token: 'a2', expires_in: 3600 }) }).ctx, TOKENS);
  assert.equal(same.refresh_token, TOKENS.refresh_token);
});

test('expired or revoked: the refresh token is refused, the person connects again; the provider text is dropped', async () => {
  await assert.rejects(qbo.refresh(ctxWith({ [`POST ${TOKEN_URL}`]: () => reply(400, { error: 'invalid_grant', error_description: LEAK }) }).ctx, TOKENS),
    (e) => e instanceof ProviderError && e.code === 'invalid_grant' && e.reauth === true && !JSON.stringify(e).includes('Sample'));
  await assert.rejects(qbo.sync(ctxWith({ 'GET /query': () => fault(401, 3200) }).ctx, 'items'), (e) => e.code === 'token_rejected' && e.reauth === true && !e.message.includes('Sample'));
  await assert.rejects(qbo.sync(ctxWith({ 'GET /query': () => fault(403, 3100) }).ctx, 'items'), (e) => e.code === 'permission_revoked' && e.reauth === true);
  await assert.rejects(qbo.status({ ...ctxWith({}).ctx, tokens: { ...TOKENS, realm_id: null } }), (e) => e.code === 'realm_missing' && e.reauth === true);
  await assert.rejects(qbo.status({ ...ctxWith({}).ctx, tokens: null }), (e) => e instanceof ProviderError);
});

test('wrong account and reconnect: QuickBooks refuses a token for another company, and another realm is not accepted', async () => {
  assert.deepEqual(await qbo.status(ctxWith({ [`GET /companyinfo/${REALM}`]: () => fault(403, 3100) }).ctx), { ok: false, reason: 'wrong_account' });
  assert.equal((await qbo.status(ctxWith({ [`GET /companyinfo/${REALM}`]: company }, { connection: { account_ref: REALM } }).ctx)).ok, true, 'the same company again');
  assert.deepEqual(await qbo.status(ctxWith({ [`GET /companyinfo/${REALM}`]: company }, { connection: { account_ref: '9341453000000999' } }).ctx), { ok: false, reason: 'wrong_account' });
  assert.deepEqual(await qbo.health(ctxWith({ [`GET /companyinfo/${REALM}`]: () => fault(403, 3100) }).ctx), { ok: false, reason: 'wrong_account', reauth: true });
  assert.deepEqual(await qbo.health(ctxWith({ [`GET /companyinfo/${REALM}`]: company }).ctx), { ok: true, health: 'ok' });
});

test('disconnect: the token is revoked at Intuit', async () => {
  const { ctx, calls } = ctxWith({ 'POST https://developer.api.intuit.com/v2/oauth2/tokens/revoke': () => reply(200, '') });
  await qbo.revoke(ctx, TOKENS);
  assert.deepEqual(calls[0].body, { token: TOKENS.refresh_token }); assert.match(calls[0].init.headers.authorization, /^Basic /);
  await assert.rejects(qbo.revoke(ctxWith({ 'POST https://developer.api.intuit.com/v2/oauth2/tokens/revoke': () => reply(400, {}) }).ctx, TOKENS), (e) => e.code === 'revoke_failed');
});

test('outage, rate limit and malformed answers become codes; status never says ok without an answer', async () => {
  const route = `GET /companyinfo/${REALM}`;
  const cases = [
    [() => { throw new TypeError('fetch failed'); }, 'provider_unreachable'],
    [() => reply(503, '<html>down</html>'), 'provider_error'],
    [() => reply(429, { Fault: { Error: [{ Message: LEAK, code: '3001' }] } }), 'rate_limited'],
    [() => reply(200, 'not json'), 'bad_response'],
    [() => reply(200, { Fault: { Error: [{ Message: LEAK, code: '2020' }] } }), 'request_rejected'],
  ];
  for (const [responder, code] of cases) await assert.rejects(qbo.status(ctxWith({ [route]: responder }).ctx), (e) => e instanceof ProviderError && e.code === code && !e.message.includes('Sample'), code);
  assert.deepEqual(await qbo.status(ctxWith({ [route]: () => reply(200, { time: 'x' }) }).ctx), { ok: false, reason: 'account_unknown' });
  await assert.rejects(qbo.refresh(ctxWith({ [`POST ${TOKEN_URL}`]: () => reply(503, 'down') }).ctx, TOKENS), (e) => e.code === 'token_exchange_failed' && e.reauth === false, 'an outage does not throw the connection away');
});

test('webhook: a signed notification is accepted and reduced to realms, names and counts', () => {
  const [request, raw] = signed(notice());
  const v = qbo.webhook.verify(request, raw, vctx);
  assert.equal(v.ok, true); assert.equal(v.type, 'data_change'); assert.equal(v.accountRef, REALM); assert.match(v.eventId, /^qbo_[0-9a-f]{48}$/);
  assert.deepEqual(v.redacted, { type: 'data_change', realms: [REALM], entities: 2, names: ['Invoice', 'Customer'] });
  assert.ok(!/"id"|lastUpdated|operation/.test(JSON.stringify(v.redacted)), 'no entity id or detail is kept');
  // two companies in one delivery: no single company is named, both are in the record
  const two = notice(); two.eventNotifications.push({ realmId: '9341453000000002', dataChangeEvent: { entities: [{ name: 'Payment', id: '9', operation: 'Create', lastUpdated: new Date().toISOString() }] } });
  const [r2, raw2] = signed(two);
  const v2 = qbo.webhook.verify(r2, raw2, vctx);
  assert.equal(v2.accountRef, null); assert.deepEqual(v2.redacted.realms, [REALM, '9341453000000002']);
});

test('webhook: bad signature, changed body, missing header, no token, malformed, stale', () => {
  let [request, raw] = signed(notice(), 'another-token');
  assert.equal(qbo.webhook.verify(request, raw, vctx).reason, 'bad_signature');
  [request, raw] = signed(notice());
  assert.equal(qbo.webhook.verify(request, Buffer.from(raw.toString().replace('"145"', '"146"')), vctx).reason, 'bad_signature');
  assert.equal(qbo.webhook.verify(new Request(ORIGIN + '/x', { method: 'POST', body: raw }), raw, vctx).reason, 'signature_missing');
  const keep = process.env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN; delete process.env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN;
  assert.equal(qbo.webhook.verify(request, raw, vctx).reason, 'not_configured');
  process.env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN = keep;
  for (const bad of [{}, { eventNotifications: [] }, { eventNotifications: [{ realmId: 'abc' }] }, { eventNotifications: 'x' }]) { const [rq, b] = signed(bad); assert.equal(qbo.webhook.verify(rq, b, vctx).reason, 'bad_payload'); }
  const old = notice(); old.eventNotifications[0].dataChangeEvent.entities.forEach((e) => { e.lastUpdated = new Date(Date.now() - 3 * 86400000).toISOString(); });
  const [rq, b] = signed(old);
  assert.equal(qbo.webhook.verify(rq, b, vctx).reason, 'stale');
});

test('webhook: the same delivery twice has the same id; handling starts one change run per company', async () => {
  const body = notice();
  const [r1, raw1] = signed(body); const [r2, raw2] = signed(body);
  const a = qbo.webhook.verify(r1, raw1, vctx); const b = qbo.webhook.verify(r2, raw2, vctx);
  assert.equal(a.eventId, b.eventId, 'a repeat is recognised by the event log');
  const other = notice(); other.eventNotifications[0].dataChangeEvent.entities[0].id = '146';
  const [r3, raw3] = signed(other);
  assert.notEqual(qbo.webhook.verify(r3, raw3, vctx).eventId, a.eventId);
  const queued = []; const seen = new Set();
  const ctx = { ...ctxWith({}).ctx, tenantOfAccount: async (realm) => (realm === REALM ? TENANT : null), enqueue: async (kind, payload, opts) => { if (seen.has(opts.idem)) return null; seen.add(opts.idem); queued.push({ kind, payload, opts }); return 'job-1'; } };
  const event = { event_id: a.eventId, redacted: { ...a.redacted, realms: [REALM, '9341453000000002'] } };
  assert.deepEqual(await qbo.webhook.handle(ctx, event), { ok: true, ignored: false, queued: 1 });
  assert.deepEqual(queued[0], { kind: 'integration.sync', payload: { provider: 'quickbooks', what: 'changes' }, opts: { tenant: TENANT, idem: `qbo:${TENANT}:${a.eventId}` } });
  assert.deepEqual(await qbo.webhook.handle(ctx, event), { ok: true, ignored: true, queued: 0 }, 'processing it again queues nothing new');
  assert.deepEqual(await qbo.webhook.handle(ctx, { redacted: { realms: [] } }), { ok: true, ignored: true });
});

test('sync, customers: matched and proposed in a preview; apply links and never overwrites', async () => {
  const finance = memoryFinance({ clients: [{ id: C1, name: 'Sample Person One', email: 'one@example.com', phone: '609-555-0101' }] });
  const page = { QueryResponse: { Customer: [{ Id: '58', SyncToken: '2', DisplayName: 'Sample Person One', PrimaryEmailAddr: { Address: 'one@example.com' }, PrimaryPhone: { FreeFormNumber: '(609) 555-0101' } }, { Id: '59', SyncToken: '0', DisplayName: 'Nobody Here' }], startPosition: 1, maxResults: 2 }, time: new Date().toISOString() };
  const { ctx, calls } = ctxWith({ 'GET /query': () => reply(200, page) }, { finance });
  await assert.rejects(qbo.sync(ctx, 'customers:apply'), (e) => e.code === 'preview_required');
  assert.deepEqual((await qbo.sync(ctx, 'customers')).counts.customers, { seen: 2, linked: 0, proposed: 1, needsReview: 0, unlinked: 1, applied: 0, complete: true, mode: 'preview' });
  assert.match(calls[0].url.searchParams.get('query'), /^select \* from Customer where Active = true orderby Id startposition 1 maxresults 100$/);
  assert.deepEqual(finance.state.clients[0].externalIds, {});
  assert.equal((await qbo.sync(ctx, 'customers:apply')).counts.customers.applied, 1);
  assert.equal(finance.state.clients[0].externalIds.quickbooks, '58');
  assert.equal((await finance.linkByExternal('quickbooks', 'customer', '58')).syncToken, '2');
  await assert.rejects(qbo.sync(ctx, 'payments'), (e) => e.code === 'sync_unknown');
});

test('sync, changes: change data capture from the stored moment; a moved SyncToken is a conflict, never overwritten', async () => {
  const finance = memoryFinance();
  await finance.linkPut({ provider: 'quickbooks', kind: 'invoice', externalId: '145', localId: J1, state: 'linked', rule: 'push', syncToken: '0', hash: 'h0' });
  await finance.linkPut({ provider: 'quickbooks', kind: 'customer', externalId: '58', localId: C1, state: 'linked', rule: 'email', syncToken: '2' });
  await finance.linkPut({ provider: 'quickbooks', kind: 'payment', externalId: '300', localId: P1, state: 'linked', rule: 'push', syncToken: '0' });
  const since = new Date(Date.now() - 3600000).toISOString(); const stamp = new Date().toISOString();
  const cdc = { CDCResponse: [{ QueryResponse: [{ Customer: [{ Id: '58', SyncToken: '2' }, { Id: '77', SyncToken: '0' }] }, { Invoice: [{ Id: '145', SyncToken: '1', TotalAmt: 999.99 }] }, { Payment: [{ Id: '300', status: 'Deleted' }] }] }], time: stamp };
  const first = ctxWith({ 'GET /cdc': () => reply(200, cdc) }, { finance });
  assert.deepEqual((await qbo.sync(first.ctx, 'changes')).counts.changes, { seen: 0, unchanged: 0, conflict: 0, unlinked: 0, windowExceeded: false, started: true });
  assert.equal(first.calls.length, 0, 'the first run only sets the starting moment');
  const { ctx, calls, cursors } = ctxWith({ 'GET /cdc': () => reply(200, cdc) }, { finance, cursors: [['cdc.since', since]] });
  assert.deepEqual((await qbo.sync(ctx, 'changes')).counts.changes, { seen: 4, unchanged: 1, conflict: 2, unlinked: 1, windowExceeded: false });
  assert.equal(calls[0].url.searchParams.get('changedSince'), since); assert.equal(calls[0].url.searchParams.get('entities'), 'Customer,Invoice,Payment');
  assert.equal(cursors.get('cdc.since'), stamp);
  const inv = await finance.linkByExternal('quickbooks', 'invoice', '145');
  assert.equal(inv.state, 'conflict'); assert.equal(inv.rule, 'remote_changed'); assert.equal(inv.syncToken, '0', 'the stored token is not moved forward, so nothing sent later can overwrite the change');
  assert.equal((await finance.linkByExternal('quickbooks', 'payment', '300')).rule, 'remote_deleted');
  assert.deepEqual(finance.state.audit.map((a) => `${a.action}:${a.outcome}:${a.code}`), ['invoice.conflict:conflict:remote_changed', 'payment.conflict:conflict:remote_deleted']);
  await assert.rejects(qbo.actions.pushInvoice({ ...ctx, finance: Object.assign(finance, { pushSource: async () => ({ id: J1, number: 'E-1', cents: 5000, customerExternalId: '58', itemExternalId: '7' }) }) }, { jobId: J1 }), (e) => e.code === 'sync_conflict');
  assert.equal(calls.length, 1, 'a conflict sends nothing');
  // a stored moment older than the capture window is said, not silently trusted
  const old = ctxWith({ 'GET /cdc': () => reply(200, { CDCResponse: [], time: stamp }) }, { finance: memoryFinance(), cursors: [['cdc.since', new Date(Date.now() - 60 * 86400000).toISOString()]] });
  assert.equal((await qbo.sync(old.ctx, 'changes')).counts.changes.windowExceeded, true);
  // an outage does not move the stored moment
  const down = ctxWith({ 'GET /cdc': () => reply(503, 'down') }, { finance, cursors: [['cdc.since', since]] });
  await assert.rejects(qbo.sync(down.ctx, 'changes'), (e) => e.code === 'provider_error'); assert.equal(down.cursors.get('cdc.since'), since);
});

test('sync, items: QuickBooks service items become proposals to link catalog services', async () => {
  const finance = memoryFinance({ services: [{ id: 's1', name: 'Bookkeeping', tiers: [] }] });
  const { ctx } = ctxWith({ 'GET /query': () => reply(200, { QueryResponse: { Item: [{ Id: '7', Name: 'bookkeeping', Type: 'Service' }, { Id: '8', Name: 'Payroll', Type: 'Service' }] } }) }, { finance });
  assert.deepEqual((await qbo.sync(ctx, 'items')).counts.items, { seen: 2, linked: 0, proposed: 1, needsReview: 0, unlinked: 1, mode: 'proposals' });
  assert.deepEqual(finance.state.services[0].externalIds, {}, 'a proposal is not a link until a person approves it');
});

test('push invoice: created once with a request id, exact cents, and an audit record', async () => {
  const src = { id: J1, number: 'E-1041', cents: 125050, date: '2026-01-05', customerExternalId: '58', itemExternalId: '7' };
  const finance = memoryFinance({ sources: { invoice: { [J1]: src } } });
  const { ctx, calls } = ctxWith({ 'POST /invoice': () => reply(200, { Invoice: { Id: '145', SyncToken: '0', TotalAmt: 1250.5 }, time: 'x' }) }, { finance });
  assert.deepEqual(await qbo.actions.pushInvoice(ctx, { jobId: J1 }), { outcome: 'created', externalId: '145' });
  const rid = calls[0].url.searchParams.get('requestid');
  assert.match(rid, /^vxi[0-9a-f]{40}$/); assert.ok(rid.length <= 50);
  assert.deepEqual(calls[0].body, { CustomerRef: { value: '58' }, DocNumber: 'E-1041', TxnDate: '2026-01-05', Line: [{ Amount: 1250.5, DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: '7' }, Qty: 1 } }] });
  assert.equal(calls[0].init.body.includes('"Amount":1250.5'), true);
  assert.deepEqual(await qbo.actions.pushInvoice(ctx, { jobId: J1 }), { outcome: 'unchanged', externalId: '145' });
  assert.equal(calls.length, 1, 'a second push of the same figures sends nothing');
  assert.deepEqual(finance.state.audit, [{ provider: 'quickbooks', direction: 'out', outcome: 'ok', action: 'invoice.create', entity: 'invoice', localId: J1, requestId: rid, externalId: '145' }]);
  // what must be in place first
  const need = async (patch, code) => assert.rejects(qbo.actions.pushInvoice(ctxWith({}, { finance: memoryFinance({ sources: { invoice: { [J1]: { ...src, ...patch } } } }) }).ctx, { jobId: J1 }), (e) => e.code === code, code);
  await need({ customerExternalId: null }, 'customer_not_linked'); await need({ itemExternalId: null }, 'item_not_mapped'); await need({ cents: 0 }, 'nothing_due'); await need({ cents: 12.5 }, 'nothing_due');
  await assert.rejects(qbo.actions.pushInvoice(ctx, { jobId: P1 }), (e) => e.code === 'not_found');
});

test('push invoice: a stale SyncToken becomes "conflict" for a person and is never forced', async () => {
  const src = { id: J1, number: 'E-1041', cents: 125050, customerExternalId: '58', itemExternalId: '7' };
  const finance = memoryFinance({ sources: { invoice: { [J1]: src } } });
  let answer = () => reply(200, { Invoice: { Id: '145', SyncToken: '0' } });
  const { ctx, calls } = ctxWith({ 'POST /invoice': (u, init) => answer(u, init) }, { finance });
  await qbo.actions.pushInvoice(ctx, { jobId: J1 });
  // the local figure changes: one update goes out, carrying the token stored at the last send
  src.cents = 130000;
  answer = () => reply(200, { Invoice: { Id: '145', SyncToken: '1' } });
  assert.deepEqual(await qbo.actions.pushInvoice(ctx, { jobId: J1 }), { outcome: 'updated', externalId: '145' });
  assert.equal(calls[1].body.Id, '145'); assert.equal(calls[1].body.SyncToken, '0'); assert.equal(calls[1].body.sparse, true);
  assert.notEqual(calls[1].url.searchParams.get('requestid'), calls[0].url.searchParams.get('requestid'));
  // somebody edits the invoice in QuickBooks; the next local change meets a stale token
  src.cents = 140000;
  answer = () => fault(400, 5010);
  await assert.rejects(qbo.actions.pushInvoice(ctx, { jobId: J1 }), (e) => e.code === 'sync_conflict' && !e.message.includes('Sample'));
  assert.equal(calls[2].body.SyncToken, '1');
  const link = await finance.linkGet('quickbooks', 'invoice', J1);
  assert.equal(link.state, 'conflict'); assert.equal(link.rule, 'stale_token'); assert.equal(link.syncToken, '1');
  assert.equal(finance.state.audit.at(-1).outcome, 'conflict'); assert.equal(finance.state.audit.at(-1).code, 'sync_conflict');
  // and from here nothing more is sent, however often it is tried
  answer = () => { throw new Error('nothing may be sent while in conflict'); };
  await assert.rejects(qbo.actions.pushInvoice(ctx, { jobId: J1 }), (e) => e.code === 'sync_conflict');
  await assert.rejects(qbo.actions.pushInvoice(ctx, { jobId: J1 }), (e) => e.code === 'sync_conflict');
  assert.equal(calls.length, 3, 'no read of the newer token, no second attempt');
});

test('push payment and customer: once, against the pushed invoice, only when approved', async () => {
  const finance = memoryFinance({ sources: {
    payment: { [P1]: { id: P1, cents: 50025, date: '2026-01-06', customerExternalId: '58', invoiceExternalId: '145' } },
    customer: { [C1]: { id: C1, name: 'Sample Person One', email: 'one@example.com', phone: '609-555-0101', approved: false } },
  }, clients: [{ id: C1, name: 'Sample Person One', email: 'one@example.com' }] });
  const { ctx, calls } = ctxWith({
    'POST /payment': () => reply(200, { Payment: { Id: '300', SyncToken: '0', TotalAmt: 500.25 } }),
    'POST /customer': () => reply(200, { Customer: { Id: '90', SyncToken: '0', DisplayName: 'Sample Person One' } }),
  }, { finance });
  assert.deepEqual(await qbo.actions.pushPayment(ctx, { paymentId: P1 }), { outcome: 'created', externalId: '300' });
  assert.deepEqual(calls[0].body, { CustomerRef: { value: '58' }, TotalAmt: 500.25, TxnDate: '2026-01-06', Line: [{ Amount: 500.25, LinkedTxn: [{ TxnId: '145', TxnType: 'Invoice' }] }] });
  assert.match(calls[0].url.searchParams.get('requestid'), /^vxp[0-9a-f]{40}$/);
  assert.deepEqual(await qbo.actions.pushPayment(ctx, { paymentId: P1 }), { outcome: 'unchanged', externalId: '300' });
  assert.equal(calls.length, 1, 'a payment is sent once and never changed');
  assert.equal((await finance.linkGet('quickbooks', 'payment', P1)).state, 'linked');
  // a customer is created only for a client a person approved
  await assert.rejects(qbo.actions.createCustomer(ctx, { clientId: C1 }), (e) => e.code === 'approval_required');
  assert.equal(calls.length, 1);
  finance.state.sources.customer[C1].approved = true;
  assert.deepEqual(await qbo.actions.createCustomer(ctx, { clientId: C1 }), { outcome: 'created', externalId: '90' });
  assert.equal(finance.state.clients[0].externalIds.quickbooks, '90');
  assert.match(calls[1].url.searchParams.get('requestid'), /^vxc[0-9a-f]{40}$/);
  // QuickBooks already has that name: reported, nothing forced
  const dup = ctxWith({ 'POST /customer': () => fault(400, 6240) }, { finance: memoryFinance({ sources: { customer: { [C1]: { id: C1, name: 'Sample Person One', approved: true } } } }) });
  await assert.rejects(qbo.actions.createCustomer(dup.ctx, { clientId: C1 }), (e) => e.code === 'duplicate_name');
  assert.equal(dup.ctx.finance.state.audit[0].outcome, 'refused');
  // QuickBooks booked another amount than was sent: for a person
  const off = ctxWith({ 'POST /payment': () => reply(200, { Payment: { Id: '301', SyncToken: '0', TotalAmt: 500.2 } }) }, { finance: memoryFinance({ sources: { payment: { [P1]: { id: P1, cents: 50025, customerExternalId: '58', invoiceExternalId: '145' } } } }) });
  await qbo.actions.pushPayment(off.ctx, { paymentId: P1 });
  assert.equal((await off.ctx.finance.linkGet('quickbooks', 'payment', P1)).state, 'conflict');
});

test('jobs: a push that needs a person stops at once; an outage is retried; the hourly Square check is queued once', async () => {
  const adapterOf = async () => qbo;
  const mk = (finance, routes = {}) => async () => ctxWith(routes, { finance }).ctx;
  const job = (payload) => ({ tenant_id: TENANT, payload });
  const src = { id: J1, number: 'E-1', cents: 5000, customerExternalId: null, itemExternalId: '7' };
  await assert.rejects(runPush(job({ provider: 'quickbooks', action: 'pushInvoice', id: J1 }), { adapterOf, ctxOf: mk(memoryFinance({ sources: { invoice: { [J1]: src } } })) }), (e) => e instanceof JobError && e.code === 'customer_not_linked' && e.permanent === true);
  const ok = { ...src, customerExternalId: '58' };
  await assert.rejects(runPush(job({ provider: 'quickbooks', action: 'pushInvoice', id: J1 }), { adapterOf, ctxOf: mk(memoryFinance({ sources: { invoice: { [J1]: ok } } }), { 'POST /invoice': () => reply(503, 'down') }) }), (e) => e.code === 'provider_error' && e.permanent === false);
  await assert.rejects(runPush(job({ provider: 'quickbooks', action: 'pushInvoice', id: J1 }), { adapterOf, ctxOf: mk(memoryFinance({ sources: { invoice: { [J1]: ok } } }), { 'POST /invoice': () => reply(429, {}) }) }), (e) => e.code === 'rate_limited' && e.permanent === false);
  assert.deepEqual(await runPush(job({ provider: 'quickbooks', action: 'pushInvoice', id: J1 }), { adapterOf, ctxOf: mk(memoryFinance({ sources: { invoice: { [J1]: ok } } }), { 'POST /invoice': () => reply(200, { Invoice: { Id: '1', SyncToken: '0' } }) }) }), { outcome: 'created', externalId: '1' });
  await assert.rejects(runPush(job({ provider: 'quickbooks', action: 'revoke', id: J1 }), { adapterOf }), (e) => e.code === 'unknown_action' && e.permanent);
  await assert.rejects(runPush(job({ provider: 'square', action: 'pushInvoice', id: J1 }), { adapterOf }), (e) => e.code === 'unknown_action' && e.permanent);
  await assert.rejects(runPush({ payload: { provider: 'quickbooks', action: 'pushInvoice' } }, { adapterOf }), (e) => e.code === 'no_company');
  assert.ok(NEEDS_PERSON.has('sync_conflict'));
  const queued = [];
  const rpc = async () => ({ ok: true, data: [{ tenant_id: TENANT, provider: 'square' }, { tenant_id: TENANT, provider: 'quickbooks' }, { tenant_id: '22222222-2222-4222-8222-222222222222', provider: 'square' }] });
  const n = await financeTick({ enqueue: async (kind, payload, opts) => { queued.push({ kind, payload, opts }); return 'j'; } }, { rpc, now: Date.parse('2026-01-05T15:20:00Z') });
  assert.equal(n, 2); assert.deepEqual(queued[0], { kind: 'integration.sync', payload: { provider: 'square', what: 'payments' }, opts: { tenant: TENANT, idem: `${TENANT}:square:payments:2026-01-05T15` } });
});

test('the scheduled run ("all") proposes and reads, and does not count as the preview an apply needs', async () => {
  const finance = memoryFinance({ clients: [{ id: C1, name: 'Sample Person One', email: 'one@example.com' }] });
  const { ctx, cursors } = ctxWith({
    'GET /query': (u) => reply(200, { QueryResponse: /from Customer/.test(u.searchParams.get('query')) ? { Customer: [{ Id: '58', SyncToken: '0', DisplayName: 'Sample Person One', PrimaryEmailAddr: { Address: 'one@example.com' } }] } : {} }),
  }, { finance });
  const out = (await qbo.sync(ctx, 'all')).counts;
  assert.equal(out.customers.proposed, 1); assert.equal(out.customers.mode, 'preview'); assert.equal(out.items.seen, 0); assert.equal(out.changes.started, true);
  assert.deepEqual(finance.state.clients[0].externalIds, {}, 'no client row is written by the scheduled run');
  assert.equal(cursors.get('customers.preview_at'), undefined);
  await assert.rejects(qbo.sync(ctx, 'customers:apply'), (e) => e.code === 'preview_required');
});
