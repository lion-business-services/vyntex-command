// The integration framework, end to end: honest states, OAuth with PKCE and single-use state, sealed tokens,
// refresh, disconnect, webhooks, the job queue and the scheduled runner.
// Real handlers, the local PostgreSQL, the TEST DOUBLE of the Supabase HTTP surface, and a stand-in OAuth provider
// (tests/server/mock_provider.mjs). No real provider is contacted: this proves the framework, not any provider.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHmac } from 'node:crypto';
import { startStack, assertNoLeak, secrets, ORIGIN, svixHeaders, mockSignature } from './helpers.mjs';

let st; let a; let b;
const count = async (sqlText, data) => Number(await st.sql(`select '@@R@@' || (${sqlText})::text;`, data));
const row = (tenant, provider = 'mock') => st.sql(`select '@@R@@' || coalesce((select to_jsonb(c) from app.integration_connections c where c.tenant_id = (select v from _in where k = 't')::uuid and c.provider = (select v from _in where k = 'p'))::text, 'null');`, { t: tenant, p: provider });
const card = async (browser, tenant, id = 'mock') => (await browser.get('/api/integrations?tenant=' + tenant)).json.connections.find((c) => c.id === id);
const cronCall = (path, secret = process.env.CRON_SECRET) => st.browser().get('/api/cron/' + path, { headers: { authorization: 'Bearer ' + secret } });
const rememberProviderSecrets = () => {
  for (const t of [...st.provider.access.keys(), ...st.provider.refresh.keys()]) secrets.add(t);
  for (const c of st.provider.calls) { if (c.form.code_verifier) secrets.add(c.form.code_verifier); if (c.form.refresh_token) secrets.add(c.form.refresh_token); }
};

/** Clicks "Connect" and follows the provider's consent page. Returns the address the provider sends the browser back to. */
async function startConnect(co, { returnTo, browser = co.owner } = {}) {
  await st.stepUp(browser, co.password);
  const r = await browser.post('/api/integrations/mock/connect', { tenant: co.tenantId, returnTo });
  assert.equal(r.status, 200, r.text);
  const consent = await fetch(r.json.url, { redirect: 'manual' });
  assert.equal(consent.status, 302);
  const back = new URL(consent.headers.get('location'));
  return { authorizeUrl: new URL(r.json.url), callback: back.pathname + back.search, back };
}
/** Runs the callback in a browser and returns where it was sent and with what result. */
async function finish(browser, callback) {
  const r = await browser.get(callback);
  assert.equal(r.status, 302, r.text);
  const to = new URL(r.headers.get('location'));
  return { path: to.pathname, result: to.searchParams.get('result'), reason: to.searchParams.get('reason'), provider: to.searchParams.get('integration'), origin: to.origin };
}

before(async () => { st = await startStack(); a = await st.company(); b = await st.company(); });
after(async () => { await st.stop(); });

// ---------------------------------------------------------------------------------------------------------------------
test('the list tells the truth about every provider, and nothing is connected', async () => {
  const r = await a.owner.get('/api/integrations?tenant=' + a.tenantId);
  assert.equal(r.status, 200);
  const list = r.json.connections;
  assert.deepEqual(list.map((c) => c.id), ['gmail', 'resend', 'gcal', 'gmeet', 'gbp', 'gmaps', 'square', 'quickbooks', 'whatsapp', 'meta', 'dialpad', 'sms', 'ai', 'mock']);
  assert.ok(list.every((c) => c.state !== 'connected'), 'no provider is shown as connected');
  for (const c of list.filter((x) => !['resend', 'mock'].includes(x.id))) {
    assert.deepEqual([c.state, c.reason, c.built], ['not_connected', 'not_configured', true], c.id);
    assert.ok(c.missing.length > 0 && c.missing.every((n) => /^[A-Z][A-Z0-9_]+$/.test(n)), c.id + ' names the settings that are missing');
  }
  assert.deepEqual([list[1].state, list[1].reason], ['setup', 'ready_to_connect']);
  assert.deepEqual([list.at(-1).state, list.at(-1).reason], ['setup', 'ready_to_connect']);
  assert.equal(list[0].approval.needed, true);
  // another company cannot ask for this company's list
  assert.deepEqual((await b.owner.get('/api/integrations?tenant=' + a.tenantId)).json, { ok: false, error: 'forbidden' });
  assert.equal((await a.owner.get('/api/integrations')).json.error, 'tenant_required');
});

test('missing settings and a pending provider review are shown as such, and block connecting', async () => {
  await st.stepUp(a.owner, a.password);
  const keep = process.env.MOCK_CLIENT_SECRET;
  delete process.env.MOCK_CLIENT_SECRET;
  try {
    const c = await card(a.owner, a.tenantId);
    assert.deepEqual([c.state, c.reason, c.missing], ['not_connected', 'not_configured', ['MOCK_CLIENT_SECRET']]);
    const r = await a.owner.post('/api/integrations/mock/connect', { tenant: a.tenantId });
    assert.deepEqual([r.status, r.json], [409, { ok: false, error: 'not_configured', missing: ['MOCK_CLIENT_SECRET'] }]);
  } finally { process.env.MOCK_CLIENT_SECRET = keep; }
  process.env.MOCK_NEEDS_APPROVAL = '1';
  try {
    const c = await card(a.owner, a.tenantId);
    assert.deepEqual([c.state, c.reason], ['pending_approval', 'provider_review']);
    const r = await a.owner.post('/api/integrations/mock/connect', { tenant: a.tenantId });
    assert.deepEqual([r.status, r.json], [409, { ok: false, error: 'pending_approval' }]);
    process.env.MOCK_APPROVED = 'true';
    assert.equal((await card(a.owner, a.tenantId)).state, 'setup');
  } finally { delete process.env.MOCK_NEEDS_APPROVAL; delete process.env.MOCK_APPROVED; }
  const unknown = await a.owner.post('/api/integrations/stripe/connect', { tenant: a.tenantId });
  assert.deepEqual([unknown.status, unknown.json], [404, { ok: false, error: 'unknown_provider' }]);
  // a real provider with no settings: refused the same way as the test provider, and nothing is stored
  const bare = await a.owner.post('/api/integrations/gmail/connect', { tenant: a.tenantId });
  assert.deepEqual([bare.status, bare.json], [409, { ok: false, error: 'not_configured', missing: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] }]);
  for (const id of ['square', 'quickbooks', 'whatsapp', 'meta', 'dialpad', 'sms', 'ai', 'gcal', 'gmeet', 'gbp', 'gmaps']) {
    const r = await a.owner.post(`/api/integrations/${id}/connect`, { tenant: a.tenantId });
    assert.deepEqual([id, r.status, r.json.error], [id, 409, 'not_configured']);
  }
  assert.equal(await count('select count(*) from app.integration_connections'), 0, 'none of this stored anything');
});

test('connecting needs a fresh identity check and the capability', async () => {
  const fresh = (await st.signIn(a.email, a.password)).browser;
  assert.deepEqual((await fresh.post('/api/integrations/mock/connect', { tenant: a.tenantId })).json, { ok: false, error: 'stepup_required' });
  assert.deepEqual((await fresh.post('/api/integrations/mock/disconnect', { tenant: a.tenantId })).json, { ok: false, error: 'stepup_required' });
  const staff = await st.addMember(a, 'staff');
  await st.stepUp(staff.browser, staff.password);
  for (const action of ['connect', 'disconnect', 'sync', 'test']) {
    const r = await staff.browser.post(`/api/integrations/mock/${action}`, { tenant: a.tenantId });
    assert.deepEqual([r.status, r.json], [403, { ok: false, error: 'forbidden' }], action);
  }
  assert.equal((await card(staff.browser, a.tenantId)).state, 'setup', 'staff may see the states');
  await st.stepUp(a.owner, a.password);
  assert.deepEqual((await a.owner.post('/api/integrations/mock/connect', { tenant: b.tenantId })).json, { ok: false, error: 'forbidden' }, 'not for another company');
});

// ---------------------------------------------------------------------------------------------------------------------
test('OAuth: PKCE, signed single-use state, server-side exchange, and "connected" only after a verified call', async () => {
  const callsBefore = st.provider.calls.length;
  const { authorizeUrl, callback, back } = await startConnect(a, { returnTo: `/${a.slug}/integrations` });
  // what the browser was sent to
  const q = authorizeUrl.searchParams;
  assert.equal(authorizeUrl.origin + authorizeUrl.pathname, st.provider.base + '/authorize');
  assert.equal(q.get('response_type'), 'code');
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.match(q.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.match(q.get('state'), /^[A-Za-z0-9_-]{43}\.[0-9a-f]{40}$/);
  assert.equal(q.get('redirect_uri'), `${ORIGIN}/api/integrations/mock/callback`);
  assert.ok(!authorizeUrl.toString().includes(process.env.MOCK_CLIENT_SECRET), 'the client secret never goes to the browser');
  assert.equal(back.origin, ORIGIN);
  // before the callback: a state row exists (hash only), and nothing is connected
  assert.equal(await count(`select count(*) from app.oauth_states where state_hash = (select v from _in where k = 's')`, { s: q.get('state') }), 0, 'the state itself is not stored');
  assert.equal(await count(`select count(*) from app.oauth_states where used_at is null and tenant_id = (select v from _in where k = 't')::uuid`, { t: a.tenantId }), 1);
  assert.equal((await card(a.owner, a.tenantId)).state, 'setup', 'still not connected: nothing has been verified');

  const done = await finish(a.owner, callback);
  assert.deepEqual(done, { path: `/${a.slug}/integrations`, result: 'connected', reason: null, provider: 'mock', origin: ORIGIN });

  // the provider saw a server-side exchange with the verifier that matches the challenge, then a status call
  const calls = st.provider.calls.slice(callsBefore);
  const exchange = calls.find((c) => c.path === '/token');
  assert.equal(exchange.form.grant_type, 'authorization_code');
  assert.equal(exchange.form.client_secret, process.env.MOCK_CLIENT_SECRET);
  assert.match(exchange.form.code_verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.ok(calls.findIndex((c) => c.path === '/userinfo') > calls.indexOf(exchange), 'the account was verified after the exchange');
  rememberProviderSecrets();

  const c = await card(a.owner, a.tenantId);
  assert.deepEqual([c.state, c.reason, c.account, c.health], ['connected', 'verified', 'connected-account@example.com', 'ok']);
  assert.ok(c.connectedAt && c.healthCheckedAt && c.by);
  assert.deepEqual(c.scopes, ['profile', 'items.read']);

  // what is stored: an envelope the database cannot open
  const stored = await row(a.tenantId);
  assert.match(stored.token_enc, /^v1\.[0-9a-f]{8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.ok(!stored.token_enc.includes('mock-at-') && !stored.token_enc.includes('mock-rt-'));
  assert.ok(!Buffer.from(stored.token_enc.split('.')[4], 'base64url').toString('latin1').includes('mock-'), 'not readable after base64 decoding either');
  assert.equal(stored.account_ref, 'acct_mock_1');
  assert.equal(stored.state, 'connected');
  const { openTokens } = await import('../../api/_lib/integrations/store.js');
  assert.match(openTokens(a.tenantId, 'mock', stored.token_enc).access_token, /^mock-at-/, 'the server, which holds the key, can open it');
  assert.equal(openTokens(b.tenantId, 'mock', stored.token_enc), null, 'and it does not open as another company\'s token');
  assert.ok(await count(`select count(*) from public.audit_log where action = 'integration.connected' and tenant_id = (select v from _in where k = 't')::uuid`, { t: a.tenantId }) >= 1);

  // company B is untouched
  assert.equal((await card(b.owner, b.tenantId)).state, 'setup');

  // ---- the same callback again: the state works once ----
  const tokenCalls = st.provider.calls.filter((x) => x.path === '/token').length;
  const replay = await finish(a.owner, callback);
  assert.deepEqual([replay.result, replay.reason], ['error', 'bad_state']);
  assert.equal(st.provider.calls.filter((x) => x.path === '/token').length, tokenCalls, 'no second exchange was attempted');
});

test('OAuth: a tampered, foreign, unknown or expired state is refused and nothing is exchanged', async () => {
  const c = await st.company();
  const { callback } = await startConnect(c);
  const url = new URL(ORIGIN + callback);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const tokenCalls = () => st.provider.calls.filter((x) => x.path === '/token').length;
  const before = tokenCalls();
  const tryState = async (s, browser = c.owner) => finish(browser, `/api/integrations/mock/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(s)}`);
  const [nonce, sig] = state.split('.');
  for (const [label, s] of [['changed value', nonce.slice(0, -1) + (nonce.endsWith('A') ? 'B' : 'A') + '.' + sig], ['changed signature', nonce + '.' + '0'.repeat(40)], ['made up', randomBytes(32).toString('base64url') + '.' + randomBytes(20).toString('hex')], ['empty', ''], ['garbage', 'x']]) {
    const r = await tryState(s);
    assert.deepEqual([r.result, r.reason], ['error', 'bad_state'], label);
  }
  assert.equal(tokenCalls(), before, 'the provider was never asked');
  assert.equal(await count(`select count(*) from app.oauth_states where used_at is null and tenant_id = (select v from _in where k = 't')::uuid`, { t: c.tenantId }), 1, 'and the real state is still unused');

  // somebody else's browser finishes the flow with the right state and code: refused, and the state is used up
  const other = await finish(b.owner, callback);
  assert.deepEqual([other.result, other.reason], ['error', 'wrong_person']);
  assert.equal(tokenCalls(), before);
  const late = await finish(c.owner, callback);
  assert.deepEqual([late.result, late.reason], ['error', 'bad_state'], 'after that attempt the state is gone for everyone');
  assert.equal((await card(c.owner, c.tenantId)).state, 'setup');
  assert.equal((await card(b.owner, b.tenantId)).state, 'setup', 'nothing was attached to the other person\'s company');

  // nobody signed in
  const anon = await finish(st.browser(), callback);
  assert.deepEqual([anon.path, anon.result, anon.reason], ['/signin', 'error', 'not_signed_in']);

  // older than ten minutes
  const second = await startConnect(c);
  await st.sql(`update app.oauth_states set created_at = now() - interval '11 minutes', expires_at = now() - interval '1 minute' where used_at is null; select '@@R@@' || '1';`);
  const expired = await finish(c.owner, second.callback);
  assert.deepEqual([expired.result, expired.reason], ['error', 'bad_state']);
  assert.equal(tokenCalls(), before);

  // the person said no on the provider's page
  const third = await startConnect(c);
  const st3 = new URL(ORIGIN + third.callback).searchParams.get('state');
  const denied = await finish(c.owner, `/api/integrations/mock/callback?error=access_denied&state=${encodeURIComponent(st3)}`);
  assert.deepEqual([denied.result, denied.reason], ['error', 'denied_at_provider']);
  assert.equal(await count(`select count(*) from app.oauth_states where used_at is null and expires_at > now() and tenant_id = (select v from _in where k = 't')::uuid`, { t: c.tenantId }), 0, 'that state is used up too');

  // the return address can only be a path on this site
  await st.stepUp(c.owner, c.password);
  for (const returnTo of ['https://evil.example.com/x', '//evil.example.com', 'javascript:alert(1)']) {
    const r = await c.owner.post('/api/integrations/mock/connect', { tenant: c.tenantId, returnTo });
    const consent = await fetch(r.json.url, { redirect: 'manual' });
    const back = new URL(consent.headers.get('location'));
    const out = await finish(c.owner, back.pathname + back.search);
    assert.deepEqual([out.origin, out.path, out.result], [ORIGIN, '/', 'connected'], returnTo);
    await st.stepUp(c.owner, c.password);
    await c.owner.post('/api/integrations/mock/disconnect', { tenant: c.tenantId });
  }
  rememberProviderSecrets();
});

test('OAuth: when the provider cannot confirm the account, nothing is stored as connected', async () => {
  const c = await st.company();
  const { callback } = await startConnect(c);
  st.provider.settings.failUserinfo = true;
  let out;
  try { out = await finish(c.owner, callback); } finally { st.provider.settings.failUserinfo = false; }
  assert.deepEqual([out.result, out.reason], ['error', 'provider_error']);
  const cardNow = await card(c.owner, c.tenantId);
  assert.deepEqual([cardNow.state, cardNow.lastError], ['error', 'provider_error']);
  const stored = await row(c.tenantId);
  assert.equal(stored.token_enc, null, 'the tokens of an unverified account are not kept');
  assert.equal(stored.connected_at, null);
  assert.ok(await count(`select count(*) from app.security_events where kind = 'integration.connect_failed' and tenant_id = (select v from _in where k = 't')::uuid`, { t: c.tenantId }) >= 1);
  rememberProviderSecrets();
});

// ---------------------------------------------------------------------------------------------------------------------
test('tokens are refreshed before they expire, a rotated refresh token is stored, and a dead one asks to reconnect', async () => {
  const c = await st.company();
  st.provider.settings.expiresIn = 60;   // inside the refresh margin: every use refreshes first
  try {
    const { callback } = await startConnect(c);
    assert.equal((await finish(c.owner, callback)).result, 'connected');
    const before = await row(c.tenantId);
    const refreshCalls = () => st.provider.calls.filter((x) => x.path === '/token' && x.form.grant_type === 'refresh_token').length;
    const n = refreshCalls();
    const t = await c.owner.post('/api/integrations/mock/test', { tenant: c.tenantId });
    assert.deepEqual(t.json, { ok: true, working: true, health: 'ok', reason: null });
    assert.equal(refreshCalls(), n + 1, 'the access token was refreshed before use');
    const after = await row(c.tenantId);
    assert.notEqual(after.token_enc, before.token_enc, 'the new pair replaced the old one');
    rememberProviderSecrets();

    // the scheduled runner finds tokens that are about to run out and refreshes them
    const tick = await cronCall('tick');
    assert.equal(tick.status, 200);
    assert.ok(tick.json.refreshQueued >= 1 && tick.json.done >= 1, JSON.stringify(tick.json));
    assert.equal(refreshCalls(), n + 2);
    assert.equal(await count(`select count(*) from app.jobs where kind = 'integration.refresh' and status = 'done' and tenant_id = (select v from _in where k = 't')::uuid`, { t: c.tenantId }), 1);
    const again = await cronCall('tick');
    assert.equal(again.json.refreshQueued >= 0 && again.status === 200, true);
    assert.equal(await count(`select count(*) from app.jobs where kind = 'integration.refresh' and tenant_id = (select v from _in where k = 't')::uuid`, { t: c.tenantId }), 1, 'the same refresh is not queued twice inside ten minutes');
    rememberProviderSecrets();

    // the provider no longer accepts the refresh token (revoked on their side)
    st.provider.refresh.clear();
    const dead = await c.owner.post('/api/integrations/mock/test', { tenant: c.tenantId });
    assert.deepEqual([dead.json.working, dead.json.reason], [false, 'invalid_grant']);
    const cardNow = await card(c.owner, c.tenantId);
    assert.deepEqual([cardNow.state, cardNow.reason], ['reauth', 'invalid_grant']);
    assert.equal((await row(c.tenantId)).token_enc, null, 'useless tokens are dropped');
    assert.ok(await count(`select count(*) from app.security_events where kind = 'integration.error' and tenant_id = (select v from _in where k = 't')::uuid`, { t: c.tenantId }) >= 1);
  } finally { st.provider.settings.expiresIn = 3600; }
});

test('sync runs through the job queue, once per click, and remembers where it stopped', async () => {
  const r1 = await a.owner.post('/api/integrations/mock/sync', { tenant: a.tenantId });
  const r2 = await a.owner.post('/api/integrations/mock/sync', { tenant: a.tenantId });
  assert.equal(r1.status, 200);
  assert.equal(r2.json.job, r1.json.job, 'a second click inside the minute returns the job already queued');
  assert.equal((await a.owner.post('/api/integrations/mock/sync', { tenant: b.tenantId })).json.error, 'forbidden');
  assert.equal((await card(a.owner, a.tenantId)).lastSyncAt, undefined);
  const ran = await cronCall('tick');
  assert.ok(ran.json.done >= 1);
  assert.ok((await card(a.owner, a.tenantId)).lastSyncAt);
  assert.equal(await st.sql(`select '@@R@@' || to_jsonb((select cursor from app.sync_cursors where tenant_id = (select v from _in where k = 't')::uuid and provider = 'mock' and resource = 'items'))::text;`, { t: a.tenantId }), '2');
  const log = await a.owner.post('/api/ws/rpc/jobs_log', { tenant: a.tenantId, args: {} });
  assert.ok(log.json.result.some((j) => j.kind === 'integration.sync' && j.status === 'done'));
  assert.ok(!(await b.owner.post('/api/ws/rpc/jobs_log', { tenant: b.tenantId, args: {} })).json.result.some((j) => j.id === r1.json.job), 'company B does not see the job');
});

// ---------------------------------------------------------------------------------------------------------------------
const hook = (body, { secret = process.env.MOCK_WEBHOOK_SECRET, at, signature, address } = {}) => {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return st.browser({ address }).call('POST', '/api/webhooks/mock', { raw: Buffer.from(raw), origin: false, csrf: '', headers: { 'content-type': 'application/json', 'x-mock-signature': signature ?? mockSignature(secret, raw, at) } });
};

test('webhooks: a signed event is logged, matched to its company and queued; a repeat of the same id does nothing', async () => {
  const id = 'evt_' + randomBytes(6).toString('hex');
  const body = { id, type: 'item.created', account: 'acct_mock_1', item: 'item-9', personal: { name: 'Sample Person', email: 'person@example.com' } };
  const r = await hook(body);
  assert.deepEqual([r.status, r.json], [200, { ok: true, received: true }]);
  const ev = await st.sql(`select '@@R@@' || to_jsonb(e)::text from app.webhook_events e where e.event_id = (select v from _in where k = 'id');`, { id });
  assert.deepEqual([ev.provider, ev.signature_ok, ev.status, ev.tenant_id], ['mock', true, 'queued', a.tenantId], 'matched to the company through the provider account id');
  assert.deepEqual(ev.redacted, { type: 'item.created', item: 'item-9' });
  assert.ok(!JSON.stringify(ev).includes('person@example.com'), 'personal data in the body is not stored');
  assert.match(ev.payload_hash, /^[0-9a-f]{64}$/);

  const again = await hook(body);
  assert.deepEqual([again.status, again.json], [200, { ok: true, duplicate: true }]);
  assert.equal(await count(`select count(*) from app.webhook_events where event_id = (select v from _in where k = 'id')`, { id }), 1);
  assert.equal(await count(`select count(*) from app.jobs where kind = 'webhook.process' and idem_key = (select v from _in where k = 'k')`, { k: 'mock:' + id }), 1, 'one job, however often the provider retries');

  const ran = await cronCall('tick');
  assert.ok(ran.json.done >= 1);
  const processed = await st.sql(`select '@@R@@' || to_jsonb(e)::text from app.webhook_events e where e.event_id = (select v from _in where k = 'id');`, { id });
  assert.deepEqual([processed.status, processed.attempts, processed.error], ['processed', 1, null]);
  assert.ok(processed.processed_at);
  const third = await hook(body);
  assert.deepEqual(third.json, { ok: true, duplicate: true }, 'a repeat after processing is still a repeat');
  const log = await a.owner.post('/api/ws/rpc/webhook_log', { tenant: a.tenantId, args: {} });
  assert.ok(log.json.result.some((e) => e.event_id === id && e.status === 'processed'));
  assert.ok(!(await b.owner.post('/api/ws/rpc/webhook_log', { tenant: b.tenantId, args: {} })).json.result.some((e) => e.event_id === id));
});

test('webhooks: a bad signature, a changed body, a stale time stamp and an oversized body are refused', async () => {
  const id = 'evt_' + randomBytes(6).toString('hex');
  const body = JSON.stringify({ id, type: 'item.created', account: 'acct_mock_1' });
  const eventsBefore = await count(`select count(*) from app.webhook_events where signature_ok`);
  const jobsBefore = await count(`select count(*) from app.jobs where kind = 'webhook.process'`);

  const wrongSecret = await hook(body, { secret: 'not-the-secret-0123456789' });
  assert.deepEqual([wrongSecret.status, wrongSecret.json], [401, { ok: false, error: 'bad_signature' }]);
  const now = Math.floor(Date.now() / 1000);
  const changed = await hook(body.replace('item.created', 'item.deleted'), { signature: mockSignature(process.env.MOCK_WEBHOOK_SECRET, body, now) });
  assert.equal(changed.status, 401, 'a body that was changed after signing');
  assert.equal((await hook(body, { signature: '' })).status, 401, 'no signature at all');
  assert.equal((await hook(body, { signature: 't=1,v1=zz' })).status, 401);
  const stale = await hook(body, { at: now - 301 });
  assert.deepEqual([stale.status, stale.json], [400, { ok: false, error: 'stale' }], 'correctly signed, but older than the replay window');
  assert.equal((await hook(body, { at: now + 400 })).status, 400);
  const moved = await hook(body, { signature: mockSignature(process.env.MOCK_WEBHOOK_SECRET, body, now - 4000).replace(/t=\d+/, 't=' + now) });
  assert.equal(moved.status, 401, 'changing the time stamp without re-signing does not help');
  const huge = await hook(JSON.stringify({ id, pad: 'x'.repeat(1024 * 1024 + 10) }));
  assert.deepEqual([huge.status, huge.json], [413, { ok: false, error: 'too_large' }]);
  assert.equal((await hook('not json at all')).status, 401, 'signed, but not an event');

  assert.equal(await count(`select count(*) from app.webhook_events where signature_ok`), eventsBefore, 'none of them was recorded as an event');
  assert.equal(await count(`select count(*) from app.jobs where kind = 'webhook.process'`), jobsBefore, 'none of them was queued');
  assert.ok(await count(`select count(*) from app.webhook_events where not signature_ok and status = 'rejected' and redacted is null and event_id is null`) >= 5, 'rejections are logged with a hash only');
  assert.ok(await count(`select count(*) from app.security_events where kind = 'webhook.rejected'`) >= 5);

  // someone sending junk cannot fill the log: after 20 a minute from one address the rest is refused without a row
  const before = await count(`select count(*) from app.webhook_events where not signature_ok`);
  for (let i = 0; i < 25; i++) await hook(body, { secret: 'junk-secret-' + i, address: '203.0.113.150' });
  assert.equal(await count(`select count(*) from app.webhook_events where not signature_ok`) - before, 20);
});

test('webhooks: processing that keeps failing is retried with a growing wait and then parked as dead', async () => {
  const id = 'evt_' + randomBytes(6).toString('hex');
  await hook({ id, type: 'always.fails', account: 'acct_mock_1' });
  const job = () => st.sql(`select '@@R@@' || to_jsonb(j)::text from app.jobs j where j.idem_key = (select v from _in where k = 'k');`, { k: 'mock:' + id });
  const waits = [];
  for (let attempt = 1; attempt <= 6; attempt++) {
    const ran = await cronCall('tick');
    assert.equal(ran.status, 200);
    const j = await job();
    assert.equal(j.attempts, attempt);
    if (attempt < 6) {
      assert.deepEqual([j.status, j.last_error], ['queued', 'mock_processing_failed']);
      waits.push(Math.round((Date.parse(j.run_at) - Date.now()) / 1000));
      // nothing runs before its time
      const early = await cronCall('tick');
      assert.equal((await job()).attempts, attempt, 'a job is not picked up before its wait is over');
      void early;
      await st.sql(`update app.jobs set run_at = now() - interval '1 second' where idem_key = (select v from _in where k = 'k'); select '@@R@@' || '1';`, { k: 'mock:' + id });
    } else {
      assert.deepEqual([j.status, j.last_error, j.locked_by], ['dead', 'mock_processing_failed', null], 'after the last attempt it stops');
    }
  }
  for (const [i, expected] of [30, 60, 120, 240, 480].entries()) assert.ok(Math.abs(waits[i] - expected) <= 3, `wait ${i + 1} is about ${expected} s (was ${waits[i]})`);
  const ev = await st.sql(`select '@@R@@' || to_jsonb(e)::text from app.webhook_events e where e.event_id = (select v from _in where k = 'id');`, { id });
  assert.deepEqual([ev.status, ev.attempts, ev.error], ['failed', 6, 'mock_processing_failed']);
  const more = await cronCall('tick');
  assert.equal((await job()).attempts, 6, 'a dead job is not run again');
  void more;
});

test('jobs: a runner that died holds nothing once its lock time has passed', async () => {
  const id = 'evt_' + randomBytes(6).toString('hex');
  await hook({ id, type: 'item.updated', account: 'acct_mock_1' });
  const key = 'mock:' + id;
  // another runner claims the job and disappears
  const claimed = await st.sql(`select '@@R@@' || app.job_claim('runner-that-dies', 50, 120)::text;`);
  assert.ok(claimed.some((j) => j.payload.event));
  const held = await cronCall('tick');
  assert.equal(held.json.claimed, 0, 'while the lock holds, nobody else gets the job');
  await st.sql(`update app.jobs set locked_until = now() - interval '1 second' where idem_key = (select v from _in where k = 'k'); select '@@R@@' || '1';`, { k: key });
  const ran = await cronCall('tick');
  assert.equal(ran.json.done, 1);
  const j = await st.sql(`select '@@R@@' || to_jsonb(j)::text from app.jobs j where j.idem_key = (select v from _in where k = 'k');`, { k: key });
  assert.deepEqual([j.status, j.attempts], ['done', 2]);
  assert.notEqual(j.locked_by, 'runner-that-dies');
});

test('webhooks: Resend delivery events (Svix signature) are verified, logged without personal data, and marked as not acted on', async () => {
  const body = JSON.stringify({ type: 'email.delivered', created_at: '2026-01-01T00:00:00Z', data: { email_id: 'email_abc', to: ['private-recipient@example.com'], subject: 'Private subject line', tags: { vx_tenant: a.tenantId } } });
  const post = (headers, raw = body) => st.browser().call('POST', '/api/webhooks/resend', { raw: Buffer.from(raw), origin: false, csrf: '', headers });
  const good = svixHeaders(process.env.RESEND_WEBHOOK_SECRET, body, { id: 'msg_e2e_1' });
  assert.deepEqual((await post(good)).json, { ok: true, received: true });
  assert.deepEqual((await post(good)).json, { ok: true, duplicate: true });
  assert.equal((await post(svixHeaders('whsec_' + randomBytes(24).toString('base64'), body))).status, 401);
  assert.equal((await post(svixHeaders(process.env.RESEND_WEBHOOK_SECRET, body, { at: Math.floor(Date.now() / 1000) - 3600 }))).status, 400);
  assert.equal((await post(good, body + ' ')).status, 401);
  const ev = await st.sql(`select '@@R@@' || to_jsonb(e)::text from app.webhook_events e where e.event_id = 'msg_e2e_1';`);
  assert.equal(ev.tenant_id, a.tenantId);
  assert.deepEqual(ev.redacted, { type: 'email.delivered', email_id: 'email_abc', created_at: '2026-01-01T00:00:00Z' });
  assert.ok(!JSON.stringify(ev).includes('private-recipient') && !JSON.stringify(ev).includes('Private subject'));
  await cronCall('tick');
  assert.equal(await st.sql(`select '@@R@@' || to_jsonb((select status from app.webhook_events where event_id = 'msg_e2e_1'))::text;`), 'ignored', 'the communications module is not built: the event is logged, and honestly marked as not acted on');
  const keep = process.env.RESEND_WEBHOOK_SECRET; delete process.env.RESEND_WEBHOOK_SECRET;
  try { assert.deepEqual((await post(good)).json, { ok: false, error: 'not_configured' }); } finally { process.env.RESEND_WEBHOOK_SECRET = keep; }
});

test('webhooks: a provider that checks the address first gets its challenge back only with the right word', async () => {
  const get = (q) => st.browser({ address: '203.0.113.' + (60 + Math.floor(Math.random() * 100)) }).call('GET', '/api/webhooks/meta' + q);
  const good = '?hub.mode=subscribe&hub.challenge=1158201444&hub.verify_token=';
  assert.deepEqual([(await get(good + 'anything')).status, (await get(good + 'anything')).json], [503, { ok: false, error: 'not_configured' }], 'no word set on this deployment: nothing is confirmed');
  const word = 'verify-' + randomBytes(12).toString('hex');
  // The word travels in the address of the provider's own request, so it is not on the list the leak search uses
  // (that search includes the addresses called). The answers are checked for it here instead.
  process.env.META_WEBHOOK_VERIFY_TOKEN = word;
  try {
    const ok = await get(good + word);
    assert.deepEqual([ok.status, ok.text, ok.headers.get('content-type'), ok.headers.get('cache-control')], [200, '1158201444', 'text/plain; charset=utf-8', 'no-store']);
    assert.deepEqual([(await get(good + 'wrong-word')).status, (await get(good + 'wrong-word')).json], [403, { ok: false, error: 'forbidden' }]);
    assert.ok(!ok.text.includes(word) && !(await get(good + 'wrong-word')).text.includes(word), 'no answer repeats the word');
    assert.equal((await get('?hub.mode=subscribe&hub.verify_token=' + word)).status, 400, 'no challenge to give back');
    assert.equal((await get('?hub.mode=subscribe&hub.challenge=<script>&hub.verify_token=' + word)).status, 400, 'only a plain challenge is echoed');
    // guessing the word is slowed down like any other rejected call
    const one = st.browser({ address: '203.0.113.59' });
    const codes = [];
    for (let i = 0; i < 22; i += 1) codes.push((await one.call('GET', '/api/webhooks/meta' + good + 'guess' + i)).status);
    assert.deepEqual([codes.filter((c) => c === 403).length, codes.filter((c) => c === 429).length], [20, 2]);
  } finally { delete process.env.META_WEBHOOK_VERIFY_TOKEN; }
  // a provider without such a step still answers GET with "wrong method"
  assert.equal((await st.browser().call('GET', '/api/webhooks/resend')).status, 405);
  assert.equal((await st.browser().call('GET', '/api/webhooks/mock')).status, 405);
  assert.equal((await st.browser().call('PUT', '/api/webhooks/meta', { raw: Buffer.from('{}'), origin: false, csrf: '' })).status, 405);
});

test('webhooks: a message that cannot be stored is not recorded, and the provider is told to send it again', async () => {
  // This database stops before the messaging range, so the text of an incoming message has nowhere to go.
  const sid = 'AC' + randomBytes(16).toString('hex'); const token = randomBytes(16).toString('hex');
  Object.assign(process.env, { SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, SMS_FROM_NUMBER: '+15555550100' }); secrets.add(token);
  try {
    const msid = 'SM' + randomBytes(16).toString('hex');
    const fields = { MessageSid: msid, SmsSid: msid, AccountSid: sid, From: '+15555550142', To: '+15555550100', Body: 'A sample question', NumSegments: '1', NumMedia: '0' };
    const q = '?t=' + a.tenantId;
    const sign = (key) => createHmac('sha1', key).update(ORIGIN + '/api/webhooks/sms' + q + Object.keys(fields).sort().map((k) => k + fields[k]).join('')).digest('base64');
    const post = (signature) => st.browser().call('POST', '/api/webhooks/sms' + q, { raw: Buffer.from(new URLSearchParams(fields).toString()), origin: false, csrf: '', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature } });
    assert.equal((await post(sign('another-token'))).status, 401);
    const r = await post(sign(token));
    assert.deepEqual([r.status, r.json], [503, { ok: false, error: 'unavailable' }]);
    assert.equal(await count(`select count(*) from app.webhook_events where signature_ok and provider = 'sms'`), 0, 'not recorded, so the next attempt is not taken for a repeat');
    assert.equal(await count(`select count(*) from app.jobs where kind = 'webhook.process' and idem_key like 'sms:%'`), 0);
  } finally { for (const k of ['SMS_PROVIDER', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'SMS_FROM_NUMBER']) delete process.env[k]; }
});

// ---------------------------------------------------------------------------------------------------------------------
test('a key provider (system email) is connected only after its key and sending domain were checked', async () => {
  const c = await st.company();
  await st.stepUp(c.owner, c.password);
  st.mail.domains = [{ id: 'dom_1', name: 'mail.example.com', status: 'pending' }];
  let r = await c.owner.post('/api/integrations/resend/connect', { tenant: c.tenantId });
  assert.deepEqual([r.status, r.json], [502, { ok: false, error: 'verify_failed', reason: 'domain_not_verified' }]);
  let cd = await card(c.owner, c.tenantId, 'resend');
  assert.deepEqual([cd.state, cd.lastError], ['error', 'domain_not_verified']);
  st.mail.domainsStatus = 403; st.mail.domainsBody = { statusCode: 403, name: 'invalid_api_key', message: 'API key is invalid: internal detail that must not leak' };
  r = await c.owner.post('/api/integrations/resend/connect', { tenant: c.tenantId });
  assert.deepEqual(r.json, { ok: false, error: 'verify_failed', reason: 'invalid_key' });
  st.mail.domainsStatus = 200; st.mail.domainsBody = null; st.mail.domains = [{ id: 'dom_1', name: 'mail.example.com', status: 'verified' }];
  r = await c.owner.post('/api/integrations/resend/connect', { tenant: c.tenantId });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.connection.state, r.json.connection.account, r.json.connection.health], ['connected', 'system@mail.example.com', 'ok']);
  assert.equal((await row(c.tenantId, 'resend')).token_enc, null, 'a deployment key is never copied into a company row');
  const t = await c.owner.post('/api/integrations/resend/test', { tenant: c.tenantId });
  assert.equal(t.json.working, true);
  st.mail.domainsStatus = 500;
  const down = await c.owner.post('/api/integrations/resend/test', { tenant: c.tenantId });
  st.mail.domainsStatus = 200;
  assert.deepEqual([down.json.working, down.json.reason], [false, 'provider_error']);
  cd = await card(c.owner, c.tenantId, 'resend');
  assert.deepEqual([cd.state, cd.health], ['attention', 'down'], 'a failed check shows as "attention", not as connected');
  assert.equal((await c.owner.post('/api/integrations/resend/test', { tenant: c.tenantId })).json.working, true);
  assert.equal((await card(c.owner, c.tenantId, 'resend')).state, 'connected');
  assert.equal((await c.owner.get('/api/integrations/resend/callback?code=x&state=y')).status, 404, 'a key provider has no OAuth return address');
});

test('disconnect revokes at the provider and deletes the tokens', async () => {
  const stored = await row(a.tenantId);
  assert.ok(stored.token_enc);
  const revokesBefore = st.provider.calls.filter((x) => x.path === '/revoke').length;
  // company B cannot disconnect company A
  await st.stepUp(b.owner, b.password);
  assert.deepEqual((await b.owner.post('/api/integrations/mock/disconnect', { tenant: a.tenantId })).json, { ok: false, error: 'forbidden' });
  assert.deepEqual((await b.owner.post('/api/integrations/mock/disconnect', { tenant: b.tenantId })).json, { ok: true, removed: false, revokedAtProvider: false });
  assert.ok((await row(a.tenantId)).token_enc, 'still there');
  await st.stepUp(a.owner, a.password);
  const r = await a.owner.post('/api/integrations/mock/disconnect', { tenant: a.tenantId });
  assert.deepEqual(r.json, { ok: true, removed: true, revokedAtProvider: true });
  assert.equal(st.provider.calls.filter((x) => x.path === '/revoke').length, revokesBefore + 1);
  assert.equal(await row(a.tenantId), null, 'the row and its sealed tokens are gone');
  assert.deepEqual([(await card(a.owner, a.tenantId)).state, (await card(a.owner, a.tenantId)).reason], ['setup', 'ready_to_connect']);
  assert.ok(await count(`select count(*) from public.audit_log where action = 'integration.disconnected' and tenant_id = (select v from _in where k = 't')::uuid`, { t: a.tenantId }) >= 1);
  assert.deepEqual((await a.owner.post('/api/integrations/mock/test', { tenant: a.tenantId })).json, { ok: true, working: false, health: 'unknown', reason: 'not_connected' });
});

test('the scheduled addresses run only with the secret, and the daily run queues housekeeping', async () => {
  assert.equal((await cronCall('tick', 'wrong-secret')).status, 401);
  assert.equal((await st.browser().get('/api/cron/daily')).status, 401);
  const daily = await cronCall('daily');
  assert.equal(daily.status, 200);
  assert.equal(daily.json.job, 'daily');
  assert.equal(await count(`select count(*) from app.jobs where kind = 'maintenance.sweep' and status = 'done'`), 1);
  assert.ok(await count(`select count(*) from app.jobs where kind = 'security.alerts' and status = 'done'`) >= 1, 'the hourly security notice ran with an earlier tick');
  const second = await cronCall('daily');
  assert.equal(second.status, 200);
  assert.equal(await count(`select count(*) from app.jobs where kind = 'maintenance.sweep'`), 1, 'the same day\'s housekeeping is queued once');
  const deep = await st.browser().get('/api/health?deep=1', { headers: { authorization: 'Bearer ' + process.env.CRON_SECRET } });
  assert.equal(deep.json.database.reachable, true);
  assert.ok(deep.json.jobs.dead >= 1, 'the health answer shows the dead job from the test above');
});

test('nothing sent to a browser in this file contains a provider token, a verifier, a secret, a stack trace or database text', () => {
  rememberProviderSecrets();
  assert.ok(secrets.size > 20);
  assertNoLeak(assert);
});
