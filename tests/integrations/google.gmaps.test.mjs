// Google Maps geocoding, tested with mocked provider responses. Nothing reaches Google.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setGoogleEnv, ctxFor, reply, leaks, MAPS_KEY } from './google.helpers.mjs';

setGoogleEnv({ GOOGLE_MAPS_API_KEY: MAPS_KEY });
const gmaps = (await import('../../api/_lib/integrations/providers/gmaps.js')).default;
const { ProviderError } = await import('../../api/_lib/integrations/oauth.js');
const { configState } = await import('../../api/_lib/integrations/core.js');

const hit = { formatted_address: '100 Sample Ave, Northfield, NJ 08225, USA', place_id: 'ChIJsample', geometry: { location: { lat: 39.37, lng: -74.55 }, location_type: 'ROOFTOP' } };
const geo = (body, status = 200) => ['GET', 'maps.googleapis.com/maps/api/geocode/json', () => reply(status, body)];
const quota = (allowed = true) => { const seen = []; return { seen, quota: async (cap) => { seen.push(cap); return allowed; } }; };
const rejects = (p, code, more = () => true) => assert.rejects(p, (e) => e instanceof ProviderError && e.code === code && !leaks(e) && !String(e.message + JSON.stringify(e)).includes(MAPS_KEY) && more(e), code);

test('shape: key based, no approval step, no sign-in, no webhook', async () => {
  assert.equal(gmaps.id, 'gmaps'); assert.equal(gmaps.kind, 'platform'); assert.equal(gmaps.approval, null); assert.equal(gmaps.webhook, null);
  assert.deepEqual(gmaps.env, ['GOOGLE_MAPS_API_KEY']);
  assert.equal(configState({ ...gmaps, built: true }).state, 'setup');
  const keep = process.env.GOOGLE_MAPS_API_KEY; delete process.env.GOOGLE_MAPS_API_KEY;
  assert.deepEqual(configState({ ...gmaps, built: true }), { state: 'not_connected', reason: 'not_configured', missing: ['GOOGLE_MAPS_API_KEY'] });
  process.env.GOOGLE_MAPS_API_KEY = keep;
  assert.throws(() => gmaps.authUrl({}), (e) => e.code === 'not_oauth');
  await assert.rejects(gmaps.exchange({}, 'c'), (e) => e.code === 'not_oauth');
});

test('connect: the key is proven with a real call for a fixed public address, and never appears in an answer', async () => {
  const { ctx, calls } = ctxFor(gmaps, { tokens: null, routes: [geo({ status: 'OK', results: [hit] })] });
  const s = await gmaps.status(ctx);
  assert.deepEqual(s, { ok: true, account: { label: 'Geocoding', ref: null }, scopes: ['geocode'] });
  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get('key'), MAPS_KEY); assert.match(u.searchParams.get('address'), /Amphitheatre/);
  assert.ok(!('authorization' in calls[0].init.headers), 'no person\'s token is involved');
  assert.ok(!JSON.stringify(s).includes(MAPS_KEY));
  assert.deepEqual(await gmaps.health(ctx), { ok: true, health: 'ok' });
});

test('a refused or wrong key, an outage, a rate limit and a malformed answer each have a code', async () => {
  const st = (body, status) => gmaps.status(ctxFor(gmaps, { tokens: null, routes: [geo(body, status)] }).ctx);
  assert.deepEqual(await st({ status: 'REQUEST_DENIED', error_message: 'The provided API key is invalid. private.person' }), { ok: false, reason: 'invalid_key' });
  assert.deepEqual(await gmaps.health(ctxFor(gmaps, { tokens: null, routes: [geo({ status: 'REQUEST_DENIED' })] }).ctx), { ok: false, reason: 'invalid_key', reauth: true });
  assert.deepEqual(await st({ status: 'OVER_QUERY_LIMIT', error_message: 'exceeded quota 991122' }), { ok: false, reason: 'rate_limited' });
  assert.deepEqual(await st({ status: 'UNKNOWN_ERROR' }), { ok: false, reason: 'provider_down' });
  assert.deepEqual(await st({ status: 'SOMETHING_NEW' }), { ok: false, reason: 'bad_answer' });
  assert.deepEqual(await st({ status: 'ZERO_RESULTS', results: [] }), { ok: false, reason: 'bad_answer' });
  assert.deepEqual(await st('<html>', 200), { ok: false, reason: 'bad_answer' });
  const down = ctxFor(gmaps, { tokens: null, routes: [geo('x', 503)] });
  assert.deepEqual(await gmaps.status(down.ctx), { ok: false, reason: 'provider_down' });
  assert.deepEqual(down.waits, [250, 750]); assert.equal(down.calls.length, 3);
  const slow = ctxFor(gmaps, { tokens: null, ...quota(), routes: [['GET', '/geocode/', () => reply(429, { error_message: 'slow down' }, { 'retry-after': '20' })]] });
  await rejects(gmaps.actions.geocode(slow.ctx, '100 Sample Ave, Northfield NJ'), 'rate_limited', (e) => e.retryAfter === 20);
  await rejects(gmaps.status(ctxFor(gmaps, { tokens: null, routes: [['GET', '/geocode/', () => { throw new TypeError('fetch failed'); }]] }).ctx), 'provider_unreachable');
});

test('geocode: an address becomes a point; nothing found is an answer, not an error', async () => {
  const q = quota();
  const { ctx, calls } = ctxFor(gmaps, { tokens: null, ...q, routes: [geo({ status: 'OK', results: [{ ...hit, partial_match: true }, { formatted_address: 'second' }] })] });
  const out = await gmaps.actions.geocode(ctx, '  100   Sample Ave,\n Northfield NJ ');
  assert.deepEqual(out, { found: true, formatted: '100 Sample Ave, Northfield, NJ 08225, USA', lat: 39.37, lng: -74.55, placeId: 'ChIJsample', precision: 'ROOFTOP', partial: true, mapsLink: 'https://www.google.com/maps/search/?api=1&query=100%20Sample%20Ave%2C%20Northfield%2C%20NJ%2008225%2C%20USA' });
  assert.equal(new URL(calls[0].url).searchParams.get('address'), '100 Sample Ave, Northfield NJ');
  assert.ok(!JSON.stringify(out).includes(MAPS_KEY), 'the key never comes back');
  assert.deepEqual(await gmaps.actions.geocode(ctxFor(gmaps, { tokens: null, ...quota(), routes: [geo({ status: 'ZERO_RESULTS', results: [] })] }).ctx, 'nowhere at all 99999'), { found: false });
  assert.deepEqual(await gmaps.actions.geocode(ctxFor(gmaps, { tokens: null, ...quota(), routes: [geo({ status: 'OK', results: [{ geometry: { location: { lat: 'x' } } }] })] }).ctx, 'odd answer street 1'), { found: false });
  await rejects(gmaps.actions.geocode(ctxFor(gmaps, { tokens: null, ...quota(), routes: [geo({ status: 'INVALID_REQUEST' })] }).ctx, 'something odd'), 'address_invalid');
  const none = ctxFor(gmaps, { tokens: null, ...quota() });
  await rejects(gmaps.actions.geocode(none.ctx, 'abc'), 'address_invalid');
  await rejects(gmaps.actions.geocode(none.ctx, 'x'.repeat(301)), 'address_invalid');
  assert.equal(none.calls.length, 0);
});

test('the cap per company and day stops calls before they are made', async () => {
  const open = quota(true);
  await gmaps.actions.geocode(ctxFor(gmaps, { tokens: null, ...open, routes: [geo({ status: 'OK', results: [hit] })] }).ctx, '100 Sample Ave, Northfield NJ');
  assert.deepEqual(open.seen, [200], 'default cap');
  process.env.GOOGLE_MAPS_DAILY_CAP = '25';
  const shut = quota(false);
  const s = ctxFor(gmaps, { tokens: null, ...shut });
  await rejects(gmaps.actions.geocode(s.ctx, '100 Sample Ave, Northfield NJ'), 'daily_cap_reached', (e) => e.retryAfter === 86400);
  assert.deepEqual(shut.seen, [25]); assert.equal(s.calls.length, 0);
  delete process.env.GOOGLE_MAPS_DAILY_CAP;
  // Without an injected counter the framework's own rate limiter is used (in memory here, the database when deployed).
  process.env.GOOGLE_MAPS_DAILY_CAP = '2';
  const real = (tenantId) => ctxFor(gmaps, { tokens: null, tenantId, routes: [geo({ status: 'OK', results: [hit] })] }).ctx;
  const t = '33333333-3333-4333-8333-333333333333';
  await gmaps.actions.geocode(real(t), '100 Sample Ave, Northfield NJ'); await gmaps.actions.geocode(real(t), '100 Sample Ave, Northfield NJ');
  await rejects(gmaps.actions.geocode(real(t), '100 Sample Ave, Northfield NJ'), 'daily_cap_reached');
  assert.equal((await gmaps.actions.geocode(real('44444444-4444-4444-8444-444444444444'), '100 Sample Ave, Northfield NJ')).found, true, 'another company has its own count');
  delete process.env.GOOGLE_MAPS_DAILY_CAP;
});

test('mapsLink needs no key and makes no call', () => {
  assert.equal(gmaps.actions.mapsLink(' 1 Main St,\n Sampletown '), 'https://www.google.com/maps/search/?api=1&query=1%20Main%20St%2C%20Sampletown');
  assert.equal(gmaps.actions.mapsLink(''), null);
});
