// Google Business Profile, tested with mocked provider responses. Nothing reaches Google.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setGoogleEnv, ctxFor, reply, gerr, memCursor, memSink, goodTokens, leaks, CLIENT_SECRET } from './google.helpers.mjs';

setGoogleEnv();
const gbp = (await import('../../api/_lib/integrations/providers/gbp.js')).default;
const { ProviderError } = await import('../../api/_lib/integrations/oauth.js');
const { configState } = await import('../../api/_lib/integrations/core.js');

const ACCT = 'accounts/1001', LOC = 'locations/2002';
const REVIEW = `${ACCT}/${LOC}/reviews/rev-1`;
const conn = { account_label: 'Sample Business', account_ref: 'sub-9', state: 'connected' };
const userinfo = (sub = 'sub-9') => ['GET', 'openidconnect.googleapis.com/v1/userinfo', () => reply(200, { sub, email: 'owner@example.com' })];
const accounts = (list = [{ name: ACCT, accountName: 'Sample Business', type: 'LOCATION_GROUP' }]) => ['GET', 'mybusinessaccountmanagement.googleapis.com/v1/accounts', () => reply(200, { accounts: list })];
const locations = ['GET', `mybusinessbusinessinformation.googleapis.com/v1/${ACCT}/locations`, (u) => { assert.equal(u.searchParams.get('readMask'), 'name,title,metadata'); return reply(200, { locations: [{ name: LOC, title: 'Sample Office', metadata: { placeId: 'ChIJsample123', mapsUri: 'https://maps.google.com/?cid=1', newReviewUri: 'https://g.page/r/sample/review' } }, { name: 'locations/2003', title: 'Second', metadata: { placeId: 'ChIJsecond456' } }, { name: 'bad name' }] }); }];
const reviews = (list) => ['GET', '/reviews', () => reply(200, { reviews: list, averageRating: 4.5, totalReviewCount: list.length })];
const rv = (id, updateTime, extra = {}) => ({ reviewId: id, name: `${ACCT}/${LOC}/reviews/${id}`, starRating: 'FIVE', comment: 'Private opinion text', reviewer: { displayName: 'Private Reviewer' }, createTime: '2026-01-01T00:00:00Z', updateTime, ...extra });
const rejects = (p, code, more = () => true) => assert.rejects(p, (e) => e instanceof ProviderError && e.code === code && !leaks(e) && more(e), code);

test('shape and "pending approval" until Google granted API access to the project', () => {
  assert.equal(gbp.id, 'gbp'); assert.equal(gbp.kind, 'oauth'); assert.equal(gbp.webhook, null);
  assert.deepEqual(gbp.scopes, ['openid', 'email', 'https://www.googleapis.com/auth/business.manage']);
  assert.deepEqual(configState({ ...gbp, built: true }), { state: 'pending_approval', reason: 'provider_review', missing: [] });
  process.env.GOOGLE_GBP_APPROVED = 'true';
  assert.equal(configState({ ...gbp, built: true }).state, 'setup');
});

test('connect, callback exchange, refresh on expiry, revoked permission', async () => {
  const u = new URL(gbp.authUrl(ctxFor(gbp, { state: 's', challenge: 'c' }).ctx));
  assert.equal(u.searchParams.get('scope'), gbp.scopes.join(' ')); assert.equal(u.searchParams.get('redirect_uri'), 'https://app.example.com/api/integrations/gbp/callback');
  const ex = ctxFor(gbp, { tokens: null, verifier: 'v1', routes: [['POST', 'oauth2.googleapis.com/token', () => reply(200, { access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: gbp.scopes.join(' ') })]] });
  const t = await gbp.exchange(ex.ctx, 'code-9');
  assert.equal(new URLSearchParams(ex.calls[0].body).get('code'), 'code-9'); assert.equal(new URLSearchParams(ex.calls[0].body).get('client_secret'), CLIENT_SECRET);
  const r = await gbp.refresh(ctxFor(gbp, { routes: [['POST', '/token', () => reply(200, { access_token: 'b', expires_in: 3600 })]] }).ctx, t);
  assert.equal(r.access_token, 'b'); assert.equal(r.refresh_token, 'r');
  await rejects(gbp.refresh(ctxFor(gbp, { routes: [['POST', '/token', () => reply(400, { error: 'invalid_grant' })]] }).ctx, t), 'invalid_grant', (e) => e.reauth === true);
  await rejects(gbp.status(ctxFor(gbp, { routes: [['GET', '/userinfo', () => gerr(401, 'authError')]] }).ctx), 'token_rejected', (e) => e.reauth === true);
});

test('status: two real calls, and every wrong account is named', async () => {
  const ok = ctxFor(gbp, { routes: [userinfo(), accounts()] });
  assert.deepEqual(await gbp.status(ok.ctx), { ok: true, account: { label: 'Sample Business', ref: 'sub-9' }, scopes: gbp.scopes });
  assert.equal(ok.calls.length, 2);
  // A Google account that manages no business profile.
  assert.deepEqual(await gbp.status(ctxFor(gbp, { routes: [userinfo(), accounts([])] }).ctx), { ok: false, reason: 'no_business_account' });
  assert.deepEqual(await gbp.status(ctxFor(gbp, { tokens: goodTokens(gbp, { scope: 'openid email' }) }).ctx), { ok: false, reason: 'scope_missing' });
  process.env.GOOGLE_ALLOWED_DOMAINS = 'other.example';
  assert.deepEqual(await gbp.status(ctxFor(gbp, { routes: [userinfo(), accounts()] }).ctx), { ok: false, reason: 'wrong_account' });
  delete process.env.GOOGLE_ALLOWED_DOMAINS;
  assert.deepEqual(await gbp.health(ctxFor(gbp, { connection: conn, routes: [userinfo('sub-other'), accounts()] }).ctx), { ok: false, reason: 'wrong_account', reauth: true });
  assert.deepEqual(await gbp.health(ctxFor(gbp, { connection: conn, routes: [userinfo(), accounts()] }).ctx), { ok: true, health: 'ok' });
  // The project has no access to the API yet: said as such, not as a broken token.
  await rejects(gbp.status(ctxFor(gbp, { routes: [userinfo(), ['GET', '/accounts', () => gerr(403, 'SERVICE_DISABLED')]] }).ctx), 'access_not_granted', (e) => e.reauth === false);
});

test('locations, the review link, reviews and a reply', async () => {
  const l = await gbp.actions.listLocations(ctxFor(gbp, { connection: conn, routes: [locations] }).ctx, ACCT);
  assert.equal(l.locations.length, 2, 'an entry without a proper name is dropped');
  assert.deepEqual(l.locations[0], { name: LOC, title: 'Sample Office', placeId: 'ChIJsample123', mapsUri: 'https://maps.google.com/?cid=1', reviewLink: 'https://g.page/r/sample/review' });
  assert.equal(l.locations[1].reviewLink, 'https://search.google.com/local/writereview?placeid=ChIJsecond456');
  const link = await gbp.actions.reviewLink(ctxFor(gbp, { connection: conn, routes: [['GET', `/v1/${LOC}`, () => reply(200, { name: LOC, title: 'Sample Office', metadata: { placeId: 'ChIJsample123' } })]] }).ctx, ACCT, LOC);
  assert.deepEqual(link, { location: LOC, reviewLink: 'https://search.google.com/local/writereview?placeid=ChIJsample123' });
  await rejects(gbp.actions.reviewLink(ctxFor(gbp, { connection: conn, routes: [['GET', `/v1/${LOC}`, () => reply(200, { name: LOC, metadata: {} })]] }).ctx, ACCT, LOC), 'review_link_unavailable');
  const r = await gbp.actions.listReviews(ctxFor(gbp, { connection: conn, routes: [reviews([rv('rev-1', '2026-02-01T00:00:00Z'), rv('rev-2', '2026-02-02T00:00:00Z', { starRating: 'TWO', reviewReply: { comment: 'Thank you', updateTime: '2026-02-03T00:00:00Z' } })])] }).ctx, ACCT, LOC);
  assert.equal(r.total, 2); assert.equal(r.average, 4.5); assert.equal(r.reviews[0].stars, 5); assert.equal(r.reviews[1].stars, 2);
  assert.deepEqual(r.reviews[1].reply, { text: 'Thank you', updatedAt: '2026-02-03T00:00:00Z' });
  const put = ctxFor(gbp, { connection: conn, routes: [['PUT', `/v4/${REVIEW}/reply`, (u, init) => { assert.deepEqual(JSON.parse(init.body), { comment: 'Gracias por su visita.' }); return reply(200, { comment: 'Gracias por su visita.', updateTime: '2026-02-04T00:00:00Z' }); }]] });
  assert.deepEqual(await gbp.actions.replyToReview(put.ctx, REVIEW, '  Gracias por su visita. '), { replied: true, updatedAt: '2026-02-04T00:00:00Z' });
  assert.equal(put.calls[0].method, 'PUT', 'PUT replaces the reply: the same reply twice leaves one reply');
  const none = ctxFor(gbp, { connection: conn });
  await rejects(gbp.actions.replyToReview(none.ctx, REVIEW, ' '), 'reply_invalid');
  await rejects(gbp.actions.replyToReview(none.ctx, 'accounts/1/locations/2/reviews/../../x', 'hi'), 'invalid_id');
  await rejects(gbp.actions.listLocations(none.ctx, 'accounts/1/../../v1/secrets'), 'invalid_id');
  assert.equal(none.calls.length, 0);
});

test('successful sync: only reviews newer than the last run are handed over, without the reviewer or the text', async () => {
  const cursor = memCursor({ reviews: '2026-02-01T00:00:00Z' }), inbox = memSink();
  const routes = [accounts(), reviews([rv('rev-3', '2026-02-05T00:00:00Z'), rv('rev-2', '2026-02-02T00:00:00Z', { reviewReply: { comment: 'x' } }), rv('rev-1', '2026-02-01T00:00:00Z')]), ['GET', `/${ACCT}/locations`, () => reply(200, { locations: [{ name: LOC, title: 'Sample Office', metadata: {} }] })]];
  const out = await gbp.sync(ctxFor(gbp, { connection: conn, cursor, sink: inbox.sink, routes }).ctx);
  assert.deepEqual(out, { counts: { locations: 1, reviews: 2 } }); assert.equal(cursor.data.get('reviews'), '2026-02-05T00:00:00Z');
  assert.deepEqual(inbox.list()[1], { kind: 'gbp.review', ref: 'gbp:rev-2:2026-02-02T00:00:00Z', data: { review: `${ACCT}/${LOC}/reviews/rev-2`, location: LOC, stars: 5, updatedAt: '2026-02-02T00:00:00Z', replied: true } });
  assert.ok(!JSON.stringify(inbox.list()).includes('Private'), 'no reviewer name and no review text in what is stored');
  const again = await gbp.sync(ctxFor(gbp, { connection: conn, cursor, sink: inbox.sink, routes }).ctx);
  assert.equal(again.counts.reviews, 0); assert.equal(inbox.items.size, 2);
});

test('provider outage, rate limit, malformed answers', async () => {
  const flaky = ctxFor(gbp, { connection: conn, routes: [['GET', '/accounts', (u, i, n) => (n < 2 ? reply(500, 'x') : reply(200, { accounts: [{ name: ACCT, accountName: 'S' }] }))]] });
  assert.equal((await gbp.actions.listAccounts(flaky.ctx)).accounts.length, 1); assert.deepEqual(flaky.waits, [250]);
  await rejects(gbp.actions.listAccounts(ctxFor(gbp, { connection: conn, routes: [['GET', '/accounts', () => reply(503, 'x')]] }).ctx), 'provider_down');
  await rejects(gbp.actions.listReviews(ctxFor(gbp, { connection: conn, routes: [['GET', '/reviews', () => gerr(429, 'RESOURCE_EXHAUSTED', { 'retry-after': '77' })]] }).ctx, ACCT, LOC), 'rate_limited', (e) => e.retryAfter === 77);
  await rejects(gbp.actions.listAccounts(ctxFor(gbp, { connection: conn, routes: [['GET', '/accounts', () => reply(200, 'oops')]] }).ctx), 'bad_answer');
  assert.deepEqual(await gbp.actions.listAccounts(ctxFor(gbp, { connection: conn, routes: [['GET', '/accounts', () => reply(200, { accounts: 'nope' })]] }).ctx), { accounts: [] });
  const r = await gbp.actions.listReviews(ctxFor(gbp, { connection: conn, routes: [reviews([{ name: 'weird' }, null])] }).ctx, ACCT, LOC);
  assert.deepEqual(r.reviews, []);
});
