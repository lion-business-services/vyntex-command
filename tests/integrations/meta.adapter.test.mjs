// The Meta adapter (Facebook Pages and Instagram), tested with mocked provider responses. Nothing is sent anywhere.
// Not proven against the live service: no Meta app and no credentials exist in this build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { setTestEnv, ORIGIN } from '../server/helpers.mjs';

const SECRET = 'appsecret_' + randomBytes(16).toString('hex');
const VERIFY = 'verify_' + randomBytes(12).toString('hex');
setTestEnv({ META_APP_ID: '900100200300', META_APP_SECRET: SECRET, META_WEBHOOK_VERIFY_TOKEN: VERIFY });
for (const k of ['META_APPROVED', 'META_LOGIN_CONFIG_ID', 'META_GRAPH_VERSION', 'META_WEBHOOK_MAX_AGE_S']) delete process.env[k];
const meta = (await import('../../api/_lib/integrations/providers/meta.js')).default;
const { ProviderError } = await import('../../api/_lib/integrations/oauth.js');
const { configState } = await import('../../api/_lib/integrations/core.js');
const { env } = await import('../../api/_lib/env.js');

const TENANT = '11111111-1111-4111-8111-111111111111';
const G = 'https://graph.facebook.com/v23.0';
const LEAK = 'Sample Person (psid 7788) on Page Sample Bakery token EAAB-secret-text';
const reply = (status, body) => new Response(JSON.stringify(body), { status });
const gerr = (status, code, sub) => reply(status, { error: { message: LEAK, type: 'OAuthException', code, ...(sub ? { error_subcode: sub } : {}), fbtrace_id: 'x' } });
const PAGE = { id: '1000000001', name: 'Sample Bakery (sample)', token: 'page-token-1', ig: { id: '1780000001', username: 'sample_bakery' } };
const PAGE2 = { id: '1000000002', name: 'Second Page (sample)', token: 'page-token-2', ig: null };
const tokensWith = (pages) => ({ access_token: 'user-long', refresh_token: 'user-long', expires_at: new Date(Date.now() + 50 * 86400000).toISOString(), scope: '', token_type: 'Bearer', pages });

function ctxWith(responder, more = {}) {
  const calls = [];
  const stored = [];
  const ctx = {
    provider: 'meta', tenantId: TENANT, env, now: () => Date.now(), redirectUri: ORIGIN + '/api/integrations/meta/callback', tokens: tokensWith([PAGE]), connection: null,
    sleep: async () => {}, rpc: async (name, args) => { stored.push({ name, args }); return { ok: true, status: 200, data: { stored: true } }; },
    fetch: async (url, init = {}) => { const u = new URL(String(url)); calls.push({ url: String(url), path: u.pathname.replace('/v23.0', ''), q: Object.fromEntries(u.searchParams), init, body: typeof init.body === 'string' ? init.body : init.body }); return responder(u.pathname.replace('/v23.0', ''), init, u); },
    ...more,
  };
  return { ctx, calls, stored };
}
const rejects = (p, code, extra = () => true) => assert.rejects(p, (e) => e instanceof ProviderError && e.code === code && !String(e.message).includes('psid') && extra(e), code);
const sign = (raw) => 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex');
const hook = (payload, { sig, method = 'POST' } = {}) => { const raw = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)); return [new Request(ORIGIN + '/api/webhooks/meta', { method, headers: { 'x-hub-signature-256': sig === undefined ? sign(raw) : sig }, body: raw }), raw]; };
const hctx = { provider: 'meta', env, now: () => Date.now() };
const msgEvent = (over = {}) => ({ object: 'page', entry: [{ id: PAGE.id, time: Date.now(), messaging: [{ sender: { id: '7788990011' }, recipient: { id: PAGE.id }, timestamp: Date.now(), message: { mid: 'm_abc123', text: 'Private words from a person' } }] }], ...over });

test('shape, minimum scopes, and pending approval until the flag says approved', () => {
  assert.equal(meta.id, 'meta'); assert.equal(meta.kind, 'oauth');
  assert.deepEqual(meta.env, ['META_APP_ID', 'META_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN']);
  for (const fn of ['authUrl', 'exchange', 'refresh', 'revoke', 'status', 'health', 'sync']) assert.equal(typeof meta[fn], 'function', fn);
  for (const fn of ['verify', 'handle', 'challenge']) assert.equal(typeof meta.webhook[fn], 'function', fn);
  for (const fn of ['listPages', 'selectPage', 'subscribePage', 'publishPagePost', 'publishInstagram', 'sendMessage']) assert.equal(typeof meta.actions[fn], 'function', fn);
  assert.deepEqual(meta.approval.needed, true); assert.equal(meta.approval.flag, 'META_APPROVED');
  assert.deepEqual(configState({ ...meta, built: true }), { state: 'pending_approval', reason: 'provider_review', missing: [] });
  process.env.META_APPROVED = 'true';
  assert.equal(configState({ ...meta, built: true }).state, 'setup');
  delete process.env.META_APPROVED;
  const keep = process.env.META_APP_SECRET; delete process.env.META_APP_SECRET;
  assert.deepEqual(configState({ ...meta, built: true }), { state: 'not_connected', reason: 'not_configured', missing: ['META_APP_SECRET'] });
  process.env.META_APP_SECRET = keep;
});

test('connect: the consent address, then code -> long-lived token -> Page tokens, all server side', async () => {
  const { ctx, calls } = ctxWith((path, init) => {
    if (path === '/oauth/access_token') { const f = new URLSearchParams(init.body); return reply(200, f.get('grant_type') === 'fb_exchange_token' ? { access_token: 'user-long', token_type: 'bearer', expires_in: 5184000 } : { access_token: 'user-short', token_type: 'bearer', expires_in: 3600 }); }
    if (path === '/me/accounts') return reply(200, { data: [{ id: PAGE.id, name: PAGE.name, access_token: PAGE.token, instagram_business_account: PAGE.ig }, { id: 'bad', access_token: 'x' }] });
    return reply(404, {});
  });
  const url = new URL(meta.authUrl({ ...ctx, state: 'st.ate', challenge: 'chal' }));
  assert.equal(url.origin + url.pathname, 'https://www.facebook.com/v23.0/dialog/oauth');
  assert.equal(url.searchParams.get('client_id'), '900100200300'); assert.equal(url.searchParams.get('state'), 'st.ate');
  assert.equal(url.searchParams.get('redirect_uri'), ORIGIN + '/api/integrations/meta/callback');
  assert.ok(url.searchParams.get('scope').includes('pages_messaging'));
  assert.ok(!url.toString().includes(SECRET), 'the app secret is never in an address the browser sees');

  const tokens = await meta.exchange({ ...ctx, verifier: 'ver' }, 'the-code');
  assert.equal(tokens.access_token, 'user-long'); assert.equal(tokens.refresh_token, 'user-long');
  assert.ok(Date.parse(tokens.expires_at) > Date.now() + 59 * 86400000);
  assert.deepEqual(tokens.pages, [PAGE]);
  const first = new URLSearchParams(calls[0].body);
  assert.equal(calls[0].init.method, 'POST'); assert.equal(first.get('code'), 'the-code'); assert.equal(first.get('code_verifier'), 'ver'); assert.equal(first.get('client_secret'), SECRET);
  assert.ok(calls.every((c) => !c.url.includes(SECRET) && !c.url.includes('user-')), 'no secret and no token in any address');
  assert.equal(calls[2].init.headers.authorization, 'Bearer user-long');
  assert.equal(calls[2].q.appsecret_proof, createHmac('sha256', SECRET).update('user-long').digest('hex'));
});

test('connect: a code that is no longer good, an outage and a refusal give codes', async () => {
  await rejects(meta.exchange({ ...ctxWith(() => gerr(400, 100)).ctx, verifier: 'v' }, 'c'), 'token_exchange_failed');
  await rejects(meta.exchange({ ...ctxWith(() => { throw new TypeError('fetch failed'); }).ctx, verifier: 'v' }, 'c'), 'provider_unreachable');
  await rejects(meta.exchange({ ...ctxWith(() => gerr(400, 4)).ctx, verifier: 'v' }, 'c'), 'rate_limited');
});

test('status: a real call is the only way to "connected"; it answers for the Page', async () => {
  const { ctx, calls } = ctxWith((path) => path === '/me' ? reply(200, { id: '5550001', name: 'Sample Owner' }) : path === '/me/permissions' ? reply(200, { data: [{ permission: 'pages_show_list', status: 'granted' }, { permission: 'pages_messaging', status: 'granted' }, { permission: 'instagram_basic', status: 'declined' }] }) : reply(200, { id: PAGE.id, name: PAGE.name }));
  const s = await meta.status(ctx);
  assert.deepEqual(s, { ok: true, account: { label: PAGE.name, ref: PAGE.id }, scopes: ['pages_show_list', 'pages_messaging'] });
  assert.deepEqual(calls.map((c) => c.path), ['/me', '/me/permissions', '/' + PAGE.id]);
  assert.equal(calls[2].init.headers.authorization, 'Bearer ' + PAGE.token, 'the Page is asked with its own token');
  assert.deepEqual(await meta.status({ ...ctx, tokens: null }), { ok: false, reason: 'not_connected' });
  assert.equal(calls.length, 3, 'no tokens, no call, never connected');
});

test('status: several Pages and none chosen is said as it is; choosing one makes a real call', async () => {
  const ok = (path) => path === '/me' ? reply(200, { id: '5550001', name: 'Sample Owner' }) : path === '/me/permissions' ? reply(200, { data: [{ permission: 'pages_show_list', status: 'granted' }] }) : reply(200, { id: path.slice(1), name: 'Second Page (sample)' });
  const { ctx } = ctxWith(ok, { tokens: tokensWith([PAGE, PAGE2]) });
  const s = await meta.status(ctx);
  assert.equal(s.ok, true); assert.equal(s.account.ref, null); assert.equal(s.needs, 'page_selection');
  await rejects(meta.actions.sendMessage(ctx, { channel: 'facebook', to: '7788990011', text: 'hi', lastInboundAt: new Date().toISOString() }), 'page_not_selected');
  assert.deepEqual(meta.actions.listPages(ctx), [{ id: PAGE.id, name: PAGE.name, instagram: PAGE.ig }, { id: PAGE2.id, name: PAGE2.name, instagram: null }]);
  assert.ok(!JSON.stringify(meta.actions.listPages(ctx)).includes('page-token'), 'the picker never gets a token');
  const picked = await meta.actions.selectPage(ctx, { pageId: PAGE2.id });
  assert.deepEqual(picked, { settings: { page_id: PAGE2.id, page_name: PAGE2.name, ig_account_id: '', ig_username: '' }, account: { label: 'Second Page (sample)', ref: PAGE2.id } });
  await rejects(meta.actions.selectPage(ctx, { pageId: '999999999' }), 'wrong_account');
  const chosen = await meta.status({ ...ctx, connection: { settings: picked.settings, account_ref: PAGE2.id } });
  assert.equal(chosen.account.ref, PAGE2.id);
});

test('status: expired token, revoked permission, wrong account, no Pages, outage, rate limit', async () => {
  await rejects(meta.status(ctxWith(() => gerr(400, 190, 463)).ctx), 'token_expired', (e) => e.reauth === true);
  await rejects(meta.status(ctxWith(() => gerr(400, 190, 460)).ctx), 'token_revoked', (e) => e.reauth === true);
  await rejects(meta.status(ctxWith(() => gerr(400, 190, 458)).ctx), 'permission_revoked', (e) => e.reauth === true);
  await rejects(meta.status(ctxWith((p) => p === '/me' ? reply(200, { id: '5550001', name: 'x' }) : gerr(403, 200)).ctx), 'permission_revoked', (e) => e.reauth === true);
  const base = (path) => path === '/me' ? reply(200, { id: '5550001', name: 'Sample Owner' }) : reply(200, { data: [{ permission: 'pages_show_list', status: 'granted' }] });
  assert.deepEqual(await meta.status(ctxWith(base, { connection: { account_ref: '4444444444', settings: {} } }).ctx), { ok: false, reason: 'wrong_account' });
  assert.deepEqual(await meta.status(ctxWith(base, { tokens: tokensWith([]) }).ctx), { ok: false, reason: 'no_pages' });
  assert.deepEqual(await meta.status(ctxWith((p) => p === '/me' ? reply(200, { id: '5550001' }) : reply(200, { data: [{ permission: 'pages_show_list', status: 'declined' }] })).ctx), { ok: false, reason: 'permission_missing' });
  await rejects(meta.status(ctxWith(() => { throw new TypeError('fetch failed'); }).ctx), 'provider_unreachable');
  await rejects(meta.status(ctxWith(() => new Response('<html>bad gateway</html>', { status: 502 })).ctx), 'provider_error');
  await rejects(meta.status(ctxWith(() => gerr(400, 4)).ctx), 'rate_limited', (e) => e.reauth === false);
  const h = await meta.health(ctxWith(() => gerr(400, 190, 463)).ctx);
  assert.deepEqual(h, { ok: false, reason: 'token_expired', reauth: true });
});

test('reconnect and disconnect: the long-lived token is renewed while valid; a dead one asks to connect again; revoke removes the permissions', async () => {
  const { ctx, calls } = ctxWith((path, init) => path === '/oauth/access_token' ? reply(200, { access_token: 'user-long-2', expires_in: 5184000 }) : path === '/me/accounts' ? reply(200, { data: [{ id: PAGE.id, name: PAGE.name, access_token: 'page-token-new' }] }) : reply(200, { success: true }));
  const next = await meta.refresh(ctx, tokensWith([PAGE]));
  assert.equal(next.access_token, 'user-long-2'); assert.equal(next.refresh_token, 'user-long-2'); assert.equal(next.pages[0].token, 'page-token-new'); assert.equal(next.pages[0].ig, null);
  assert.equal(new URLSearchParams(calls[0].body).get('fb_exchange_token'), 'user-long');
  await rejects(meta.refresh(ctxWith(() => gerr(400, 190, 463)).ctx, tokensWith([PAGE])), 'token_expired', (e) => e.reauth === true);
  const r = ctxWith(() => reply(200, { success: true }));
  await meta.revoke(r.ctx, tokensWith([PAGE]));
  assert.equal(r.calls[0].path, '/me/permissions'); assert.equal(r.calls[0].init.method, 'DELETE'); assert.equal(r.calls[0].init.headers.authorization, 'Bearer user-long');
});

test('publish to the Page: text, photo by address, photo as bytes', async () => {
  let { ctx, calls } = ctxWith(() => reply(200, { id: PAGE.id + '_501' }));
  assert.deepEqual(await meta.actions.publishPagePost(ctx, { text: 'Open on Saturday' }), { id: PAGE.id + '_501', channel: 'facebook' });
  assert.equal(calls[0].path, `/${PAGE.id}/feed`); assert.deepEqual(JSON.parse(calls[0].body), { message: 'Open on Saturday' }); assert.equal(calls[0].init.headers.authorization, 'Bearer ' + PAGE.token);
  ({ ctx, calls } = ctxWith(() => reply(200, { id: '601', post_id: PAGE.id + '_601' })));
  assert.equal((await meta.actions.publishPagePost(ctx, { text: 'Photo', photoUrl: 'https://files.example.com/a.jpg' })).id, PAGE.id + '_601');
  assert.equal(calls[0].path, `/${PAGE.id}/photos`); assert.deepEqual(JSON.parse(calls[0].body), { url: 'https://files.example.com/a.jpg', caption: 'Photo' });
  ({ ctx, calls } = ctxWith(() => reply(200, { id: '602', post_id: PAGE.id + '_602' })));
  await meta.actions.publishPagePost(ctx, { text: 'Bytes', photoBytes: Buffer.from([0xff, 0xd8, 0xff]), photoMime: 'image/jpeg' });
  assert.ok(calls[0].init.body instanceof FormData); assert.equal(calls[0].init.body.get('caption'), 'Bytes'); assert.equal(calls[0].init.body.get('source').size, 3);
  await rejects(meta.actions.publishPagePost(ctx, { text: '' }), 'message_invalid');
  await rejects(meta.actions.publishPagePost(ctx, { text: 'x', photoUrl: 'http://plain.example.com/a.jpg' }), 'media_invalid');
  await rejects(meta.actions.publishPagePost(ctxWith(() => gerr(400, 200)).ctx, { text: 'x' }), 'permission_revoked', (e) => e.reauth === true);
  await rejects(meta.actions.publishPagePost(ctxWith(() => gerr(400, 32)).ctx, { text: 'x' }), 'rate_limited');
});

test('publish to Instagram: container, wait until ready, publish', async () => {
  let looks = 0;
  const { ctx, calls } = ctxWith((path, init) => path === `/${PAGE.ig.id}/media` ? reply(200, { id: '17900001' }) : path === '/17900001' ? reply(200, { status_code: (looks += 1) < 2 ? 'IN_PROGRESS' : 'FINISHED' }) : path === `/${PAGE.ig.id}/media_publish` ? reply(200, { id: '17900099' }) : reply(404, {}));
  assert.deepEqual(await meta.actions.publishInstagram(ctx, { imageUrl: 'https://files.example.com/a.jpg', caption: 'New hours' }), { id: '17900099', channel: 'instagram' });
  assert.deepEqual(calls.map((c) => c.path), [`/${PAGE.ig.id}/media`, '/17900001', '/17900001', `/${PAGE.ig.id}/media_publish`]);
  assert.deepEqual(JSON.parse(calls[0].body), { image_url: 'https://files.example.com/a.jpg', caption: 'New hours' });
  assert.deepEqual(JSON.parse(calls[3].body), { creation_id: '17900001' });
  await rejects(meta.actions.publishInstagram(ctxWith((p) => p.endsWith('/media') ? reply(200, { id: '1' }) : reply(200, { status_code: 'ERROR' })).ctx, { imageUrl: 'https://files.example.com/a.jpg' }), 'media_rejected');
  await rejects(meta.actions.publishInstagram(ctxWith((p) => p.endsWith('/media') ? reply(200, { id: '1' }) : reply(200, { status_code: 'IN_PROGRESS' })).ctx, { imageUrl: 'https://files.example.com/a.jpg' }), 'media_processing');
  await rejects(meta.actions.publishInstagram(ctxWith(() => reply(200, {}), { tokens: tokensWith([{ ...PAGE, ig: null }]) }).ctx, { imageUrl: 'https://files.example.com/a.jpg' }), 'instagram_not_linked');
  await rejects(meta.actions.publishInstagram(ctx, { caption: 'no picture' }), 'media_invalid');
});

test('reply inside the messaging window is sent; outside it is refused before any call', async () => {
  const now = Date.now();
  let { ctx, calls } = ctxWith(() => reply(200, { recipient_id: '7788990011', message_id: 'm_out_1' }));
  const sent = await meta.actions.sendMessage(ctx, { channel: 'facebook', to: '7788990011', text: 'We open at nine.', lastInboundAt: new Date(now - 2 * 3600000).toISOString() });
  assert.equal(sent.id, 'm_out_1'); assert.equal(sent.message.status, 'sent'); assert.equal(sent.message.channel, 'facebook'); assert.equal(sent.message.threadId, 'facebook:7788990011');
  assert.equal(calls[0].path, `/${PAGE.id}/messages`);
  assert.deepEqual(JSON.parse(calls[0].body), { recipient: { id: '7788990011' }, message: { text: 'We open at nine.' }, messaging_type: 'RESPONSE' });

  ({ ctx, calls } = ctxWith(() => reply(200, { message_id: 'never' })));
  await rejects(meta.actions.sendMessage(ctx, { channel: 'facebook', to: '7788990011', text: 'late', lastInboundAt: new Date(now - 25 * 3600000).toISOString() }), 'outside_messaging_window');
  await rejects(meta.actions.sendMessage(ctx, { channel: 'instagram', to: '7788990011', text: 'never wrote' }), 'outside_messaging_window');
  await rejects(meta.actions.sendMessage(ctx, { channel: 'facebook', to: '7788990011', text: 'too old even for the tag', humanAgent: true, lastInboundAt: new Date(now - 8 * 86400000).toISOString() }), 'outside_messaging_window');
  assert.equal(calls.length, 0, 'refused without a call to Meta');
  await meta.actions.sendMessage(ctx, { channel: 'facebook', to: '7788990011', text: 'a person answers', humanAgent: true, lastInboundAt: new Date(now - 3 * 86400000).toISOString() });
  assert.equal(JSON.parse(calls[0].body).tag, 'HUMAN_AGENT');
  // Meta's own refusal (its clock, not ours) gives the same code.
  await rejects(meta.actions.sendMessage(ctxWith(() => gerr(400, 10, 2018278)).ctx, { channel: 'facebook', to: '7788990011', text: 'x', lastInboundAt: new Date(now - 1000).toISOString() }), 'outside_messaging_window', (e) => e.reauth === false);
  await rejects(meta.actions.sendMessage(ctx, { channel: 'facebook', to: 'not-an-id', text: 'x', lastInboundAt: new Date().toISOString() }), 'recipient_invalid');
  await rejects(meta.actions.sendMessage(ctx, { channel: 'facebook', to: '7788990011', text: '', lastInboundAt: new Date().toISOString() }), 'message_invalid');
});

test('webhook: the verification challenge', () => {
  const get = (q) => new Request(ORIGIN + '/api/webhooks/meta?' + new URLSearchParams(q), { method: 'GET' });
  assert.deepEqual(meta.webhook.challenge(get({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '1158201444' }), hctx), { ok: true, status: 200, contentType: 'text/plain; charset=utf-8', body: '1158201444' });
  assert.deepEqual(meta.webhook.challenge(get({ 'hub.mode': 'subscribe', 'hub.verify_token': 'guess', 'hub.challenge': '1' }), hctx), { ok: false, reason: 'bad_verify_token' });
  assert.equal(meta.webhook.challenge(get({ 'hub.mode': 'unsubscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '1' }), hctx).reason, 'bad_request');
  assert.equal(meta.webhook.challenge(get({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '<script>' }), hctx).reason, 'bad_request');
  const keep = process.env.META_WEBHOOK_VERIFY_TOKEN; delete process.env.META_WEBHOOK_VERIFY_TOKEN;
  assert.equal(meta.webhook.challenge(get({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '1' }), hctx).reason, 'not_configured');
  process.env.META_WEBHOOK_VERIFY_TOKEN = keep;
});

test('webhook: a signed event is accepted and reduced to ids and counts', () => {
  const [rq, raw] = hook(msgEvent());
  const v = meta.webhook.verify(rq, raw, hctx);
  assert.equal(v.ok, true); assert.equal(v.type, 'page.message'); assert.equal(v.accountRef, PAGE.id);
  assert.deepEqual(v.redacted, { object: 'page', account: PAGE.id, type: 'message', counts: { message: 1, echo: 0, delivery: 0, read: 0, postback: 0, change: 0 }, mids: ['m_abc123'] });
  const stored = JSON.stringify(v);
  assert.ok(!stored.includes('Private words'), 'no message text in what is stored');
  assert.ok(!stored.includes('7788990011'), 'no sender id in what is stored');
  const [rq2, raw2] = hook({ object: 'instagram', entry: [{ id: PAGE.ig.id, time: Math.floor(Date.now() / 1000), messaging: [{ sender: { id: '1' }, recipient: { id: PAGE.ig.id }, read: { mid: 'x' } }] }] });
  const v2 = meta.webhook.verify(rq2, raw2, hctx);
  assert.equal(v2.type, 'instagram.read'); assert.equal(v2.accountRef, PAGE.ig.id);
});

test('webhook: bad signature, missing signature, duplicate event, malformed payload, stale body, no secret', () => {
  const [rq, raw] = hook(msgEvent(), { sig: 'sha256=' + 'a'.repeat(64) });
  assert.deepEqual(meta.webhook.verify(rq, raw, hctx), { ok: false, reason: 'bad_signature' });
  const [rqm, rawm] = hook(msgEvent(), { sig: '' });
  assert.equal(meta.webhook.verify(rqm, rawm, hctx).reason, 'signature_missing');
  // A body signed with another app's secret.
  const other = Buffer.from(JSON.stringify(msgEvent()));
  assert.equal(meta.webhook.verify(new Request(ORIGIN + '/x', { method: 'POST', headers: { 'x-hub-signature-256': 'sha256=' + createHmac('sha256', 'other-secret').update(other).digest('hex') }, body: other }), other, hctx).reason, 'bad_signature');

  // The same delivery sent twice has the same event id: the event log records it once and answers the second "ok".
  const payload = JSON.stringify(msgEvent());
  const [a, rawA] = hook(payload); const [b, rawB] = hook(payload);
  const [c, rawC] = hook(msgEvent({ entry: [{ id: PAGE.id, time: Date.now(), messaging: [{ sender: { id: '1' }, recipient: { id: PAGE.id }, message: { mid: 'm_other', text: 'x' } }] }] }));
  assert.equal(meta.webhook.verify(a, rawA, hctx).eventId, meta.webhook.verify(b, rawB, hctx).eventId);
  assert.notEqual(meta.webhook.verify(a, rawA, hctx).eventId, meta.webhook.verify(c, rawC, hctx).eventId);
  assert.match(meta.webhook.verify(a, rawA, hctx).eventId, /^h[0-9a-f]{48}$/);

  for (const bad of ['not json', '[]', { object: 'user', entry: [{ id: PAGE.id, time: Date.now() }] }, { object: 'page', entry: [] }, { object: 'page' }, { object: 'page', entry: [{ id: 'abc', time: Date.now() }] }]) {
    const [r, w] = hook(bad);
    assert.equal(meta.webhook.verify(r, w, hctx).reason, 'bad_payload', JSON.stringify(bad));
  }
  const [rs, ws] = hook(msgEvent({ entry: [{ id: PAGE.id, time: Date.now() - 40 * 3600 * 1000, messaging: [] }] }));
  assert.equal(meta.webhook.verify(rs, ws, hctx).reason, 'stale');
  const keep = process.env.META_APP_SECRET; delete process.env.META_APP_SECRET;
  const [rn, wn] = hook(msgEvent(), { sig: 'sha256=' + 'a'.repeat(64) });
  assert.equal(meta.webhook.verify(rn, wn, hctx).reason, 'not_configured');
  process.env.META_APP_SECRET = keep;
});

test('webhook processing: the message is fetched by id and stored once in the platform shape', async () => {
  const { ctx, calls, stored } = ctxWith(() => reply(200, { id: 'm_abc123', created_time: '2026-01-05T15:00:00+0000', from: { id: '7788990011', name: 'Sample Person' }, to: { data: [{ id: PAGE.id, name: PAGE.name }] }, message: 'Do you open on Sunday?' }));
  const out = await meta.webhook.handle(ctx, { redacted: { object: 'page', mids: ['m_abc123'] } });
  assert.deepEqual(out, { ok: true, stored: 1 });
  assert.equal(calls[0].path, '/m_abc123'); assert.equal(calls[0].init.headers.authorization, 'Bearer ' + PAGE.token);
  assert.equal(stored[0].name, 'messaging_ingest'); assert.equal(stored[0].args.p_tenant, TENANT); assert.equal(stored[0].args.p_provider, 'meta');
  const m = stored[0].args.p_batch.messages[0];
  assert.deepEqual(m.message, { at: '2026-01-05T15:00:00.000Z', channel: 'facebook', to: PAGE.name, subject: '', body: 'Do you open on Sunday?', status: 'received', dir: 'in', from: 'Sample Person', provider: 'meta', externalId: 'm_abc123', threadId: 'facebook:7788990011', read: false });
  assert.deepEqual(m.match, { handle: { kind: 'facebook', id: '7788990011' }, name: 'Sample Person' });
  assert.deepEqual(await meta.webhook.handle(ctx, { redacted: { object: 'page', mids: [] } }), { ok: true, ignored: true });
  await rejects(meta.webhook.handle({ ...ctx, tokens: null }, { redacted: { object: 'page', mids: ['m_1'] } }), 'not_connected');
  await rejects(meta.webhook.handle(ctxWith(() => gerr(400, 190, 463)).ctx, { redacted: { object: 'page', mids: ['m_1'] } }), 'token_expired', (e) => e.reauth === true);
  // The store is not installed yet: the job fails with a code and is tried again, nothing is dropped silently.
  await rejects(meta.webhook.handle({ ...ctx, rpc: async () => ({ ok: false, status: 404 }) }, { redacted: { object: 'page', mids: ['m_abc123'] } }), 'ingest_not_installed');
});

test('successful sync: new conversations are read from where the last run stopped', async () => {
  const cursor = new Map([['conversations.messenger', '2026-01-05T10:00:00.000Z']]);
  const { ctx, calls, stored } = ctxWith((path, init, u) => reply(200, { data: u.searchParams.get('platform') === 'messenger' ? [
    { id: 't_1', updated_time: '2026-01-05T12:00:00+0000', messages: { data: [{ id: 'm_1', created_time: '2026-01-05T12:00:00+0000', from: { id: PAGE.id, name: PAGE.name }, to: { data: [{ id: '7788990011', name: 'Sample Person' }] }, message: 'Yes, until two.' }] } },
    { id: 't_old', updated_time: '2026-01-05T09:00:00+0000', messages: { data: [{ id: 'm_old', created_time: '2026-01-05T09:00:00+0000', from: { id: '1' }, message: 'old' }] } },
  ] : [] }), { cursor: { get: async (r) => cursor.get(r) || null, set: async (r, v) => { cursor.set(r, v); return true; } } });
  const out = await meta.sync(ctx, 'all');
  assert.deepEqual(out, { counts: { messenger: 1, instagram: 0 } });
  assert.equal(calls.length, 2); assert.equal(calls[0].q.platform, 'messenger'); assert.equal(calls[1].q.platform, 'instagram');
  const m = stored[0].args.p_batch.messages[0].message;
  assert.equal(m.dir, 'out'); assert.equal(m.status, 'sent'); assert.equal(m.externalId, 'm_1'); assert.equal(m.threadId, 'facebook:7788990011');
  assert.equal(cursor.get('conversations.messenger'), '2026-01-05T12:00:00.000Z');
  assert.deepEqual(await meta.sync(ctxWith(() => reply(200, { data: [] }), { tokens: tokensWith([PAGE, PAGE2]) }).ctx), { skipped: 'page_not_selected' });
  await rejects(meta.sync(ctxWith(() => gerr(500, 2)).ctx), 'provider_error');
});

test('subscribing the Page to the webhook', async () => {
  const { ctx, calls } = ctxWith(() => reply(200, { success: true }));
  assert.deepEqual(await meta.actions.subscribePage(ctx), { subscribed: true });
  assert.equal(calls[0].path, `/${PAGE.id}/subscribed_apps`); assert.ok(JSON.parse(calls[0].body).subscribed_fields.includes('messages'));
  await rejects(meta.actions.subscribePage(ctxWith(() => reply(200, { success: false })).ctx), 'subscribe_failed');
});
