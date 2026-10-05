// The sealed session cookie: sealing, tampering, idle timeout, absolute lifetime, key rotation, refresh rotation.
// No database. Supabase Auth is replaced by a function that records what it was asked.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setTestEnv, ORIGIN } from './helpers.mjs';

setTestEnv({ SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_ANON_KEY: 'anon-key-for-tests', SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-tests' });
const S = await import('../../api/_lib/session.js');
const { HttpError } = await import('../../api/_lib/respond.js');

const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const nowS = () => Math.floor(Date.now() / 1000);
const grant = (over = {}) => ({
  access_token: jwt({ sub: 'user-1', email: 'person@example.com', exp: nowS() + 3600, aal: 'aal1', session_id: '11111111-1111-4111-8111-111111111111', ...over }),
  refresh_token: 'refresh-token-ORIGINAL-0001', expires_in: 3600, user: { id: 'user-1', email: 'person@example.com' },
});
const cookieHeader = (setCookies) => setCookies.filter((c) => !/Max-Age=0/.test(c)).map((c) => c.split(';')[0]).join('; ');
const requestWith = (session, headers = {}) => new Request(ORIGIN + '/api/x', { headers: { cookie: cookieHeader(S.sessionCookies(session)), ...headers } });
const fresh = () => { const s = S.newSession(grant()); s.m = 'ok'; return s; };

let fetchCalls = [];
const realFetch = globalThis.fetch;
beforeEach(() => { fetchCalls = []; globalThis.fetch = realFetch; });
const mockFetch = (fn) => { globalThis.fetch = async (url, init) => { fetchCalls.push({ url: String(url), init }); return fn(String(url), init); }; };

test('the cookie is HttpOnly, SameSite=Lax, Path=/ and holds nothing readable', () => {
  const s = fresh();
  const cookies = S.sessionCookies(s);
  const main = cookies[0];
  assert.match(main, /^vx=s1\./);
  assert.match(main, /; HttpOnly/); assert.match(main, /; SameSite=Lax/); assert.match(main, /Path=\//);
  assert.ok(!/Domain=/i.test(main));
  for (const c of cookies) {
    assert.ok(!c.includes('refresh-token-ORIGINAL'), 'the refresh token is not readable in the cookie');
    assert.ok(!c.includes(s.at.split('.')[1]), 'the access token is not readable in the cookie');
    assert.ok(!c.includes('person@example.com'));
  }
});

test('in production the cookie is __Host-vx with Secure', () => {
  process.env.VX_ENV = 'production';
  try {
    const c = S.sessionCookies(fresh())[0];
    assert.match(c, /^__Host-vx=/);
    assert.match(c, /; Secure/); assert.match(c, /; HttpOnly/); assert.match(c, /; SameSite=Lax/); assert.match(c, /Path=\//);
    assert.ok(!/Domain=/i.test(c), 'a __Host- cookie must not name a domain');
    assert.equal(S.cookieName(), '__Host-vx');
    for (const cleared of S.clearCookies()) assert.match(cleared, /^__Host-vx\d?=; .*Secure.*Max-Age=0|^__Host-vx\d?=; .*Max-Age=0/);
  } finally { process.env.VX_ENV = 'test'; }
});

test('a sealed session opens again', () => {
  const s = fresh();
  const out = S.openSession(requestWith(s));
  assert.deepEqual(out.session, s);
});

test('no cookie means no session', () => {
  assert.deepEqual(S.openSession(new Request(ORIGIN + '/api/x')), { session: null, why: 'none' });
});

test('a tampered cookie is rejected', () => {
  const s = fresh();
  const header = cookieHeader(S.sessionCookies(s));
  const value = header.slice(3);
  const parts = value.split('.');
  for (const i of [1, 2, 3, 4]) {
    const p = [...parts];
    p[i] = p[i].slice(0, -2) + (p[i].endsWith('AA') ? 'BB' : 'AA');
    const out = S.openSession(new Request(ORIGIN + '/api/x', { headers: { cookie: 'vx=' + p.join('.') } }));
    assert.equal(out.session, null); assert.equal(out.why, 'tampered');
  }
});

test('a cookie made by hand, or sealed with another secret, is rejected', () => {
  const forged = 's1.00000000.' + Buffer.from('iv').toString('base64url') + '.' + Buffer.from('tag').toString('base64url') + '.' + Buffer.from(JSON.stringify({ v: 1, uid: 'admin', at: 'x', rt: 'y', iat: nowS(), last: nowS() })).toString('base64url');
  assert.equal(S.openSession(new Request(ORIGIN + '/api/x', { headers: { cookie: 'vx=' + forged } })).why, 'tampered');
  assert.equal(S.openSession(new Request(ORIGIN + '/api/x', { headers: { cookie: 'vx=' + Buffer.from(JSON.stringify({ v: 1, uid: 'admin' })).toString('base64url') } })).why, 'tampered');
  const header = cookieHeader(S.sessionCookies(fresh()));
  const keep = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'another-secret-entirely-0123456789abcdef';
  assert.equal(S.openSession(new Request(ORIGIN + '/api/x', { headers: { cookie: header } })).why, 'tampered');
  process.env.SESSION_SECRET = keep;
});

test('idle timeout: no activity for longer than the company allows ends the session', () => {
  const s = fresh();
  s.last = nowS() - 29 * 60;
  assert.ok(S.openSession(requestWith(s)).session, '29 minutes idle with a 30 minute limit is still open');
  s.last = nowS() - 31 * 60;
  assert.equal(S.openSession(requestWith(s)).why, 'idle');
  s.idle = 5; s.last = nowS() - 6 * 60;
  assert.equal(S.openSession(requestWith(s)).why, 'idle', 'a company with a 5 minute limit');
  s.idle = 100000; s.last = nowS() - 13 * 3600; s.iat = nowS() - 1;
  assert.equal(S.openSession(requestWith(s)).why, 'idle', 'the idle limit is never longer than 12 hours, whatever the cookie says');
});

test('absolute lifetime: a session ends after SESSION_MAX_HOURS whatever the activity', () => {
  const s = fresh();
  s.iat = nowS() - 12 * 3600 - 5; s.last = nowS();
  assert.equal(S.openSession(requestWith(s)).why, 'expired');
  process.env.SESSION_MAX_HOURS = '1';
  s.iat = nowS() - 3700;
  assert.equal(S.openSession(requestWith(s)).why, 'expired');
  delete process.env.SESSION_MAX_HOURS;
});

test('secret rotation: cookies sealed with the previous secret still open and are re-sealed with the new one', () => {
  const s = fresh();
  const oldHeader = cookieHeader(S.sessionCookies(s));
  const oldSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'new-session-secret-0123456789-abcdefghij';
  assert.equal(S.openSession(new Request(ORIGIN + '/api/x', { headers: { cookie: oldHeader } })).why, 'tampered', 'without the previous secret the old cookie is refused');
  process.env.SESSION_SECRET_PREVIOUS = oldSecret;
  const opened = S.openSession(new Request(ORIGIN + '/api/x', { headers: { cookie: oldHeader } }));
  assert.deepEqual(opened.session, s);
  const newHeader = cookieHeader(S.sessionCookies(opened.session));
  assert.notEqual(newHeader.split('.')[1], oldHeader.split('.')[1], 'the new cookie names the new key');
  delete process.env.SESSION_SECRET_PREVIOUS;
  assert.deepEqual(S.openSession(new Request(ORIGIN + '/api/x', { headers: { cookie: newHeader } })).session, s);
  process.env.SESSION_SECRET = oldSecret;
});

test('a short secret is treated as not configured', () => {
  const keep = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'short';
  assert.throws(() => S.sessionCookies(fresh()), (e) => e instanceof HttpError && e.code === 'not_configured');
  process.env.SESSION_SECRET = keep;
});

test('a large session is split over several cookies and put back together', () => {
  const s = fresh();
  s.at = jwt({ sub: 'user-1', exp: nowS() + 3600, pad: 'x'.repeat(6000) });
  const cookies = S.sessionCookies(s).filter((c) => !/Max-Age=0/.test(c));
  assert.ok(cookies.length >= 2 && cookies.length <= 4);
  for (const c of cookies) assert.ok(c.length < 4096, 'each part fits in one cookie');
  assert.deepEqual(S.openSession(requestWith(s)).session, s);
});

test('refresh rotation: an access token about to expire is exchanged, and the old refresh token is replaced', async () => {
  const s = fresh();
  s.exp = nowS() + 20;
  mockFetch((url, init) => {
    assert.match(url, /\/auth\/v1\/token\?grant_type=refresh_token$/);
    assert.equal(JSON.parse(init.body).refresh_token, 'refresh-token-ORIGINAL-0001');
    return new Response(JSON.stringify({ ...grant({ aal: 'aal1' }), refresh_token: 'refresh-token-ROTATED-0002' }), { status: 200 });
  });
  const out = await S.requireSession(requestWith(s));
  assert.equal(fetchCalls.length, 1);
  assert.equal(out.session.rt, 'refresh-token-ROTATED-0002');
  assert.ok(out.session.exp > nowS() + 3000);
  assert.ok(out.cookies.length > 0, 'the cookie is re-sealed');
  const reopened = S.openSession(new Request(ORIGIN + '/api/x', { headers: { cookie: cookieHeader(out.cookies) } })).session;
  assert.equal(reopened.rt, 'refresh-token-ROTATED-0002');
  assert.equal(reopened.iat, s.iat, 'the start of the session does not move: a refresh does not extend the absolute lifetime');
  assert.equal(reopened.csrf, s.csrf);
});

test('a refused refresh token ends the session and clears the cookie', async () => {
  const s = fresh();
  s.exp = nowS() - 5;
  mockFetch(() => new Response(JSON.stringify({ code: 400, error_code: 'refresh_token_already_used', msg: 'Invalid Refresh Token: Already Used' }), { status: 400 }));
  await assert.rejects(S.requireSession(requestWith(s)), (e) => e instanceof HttpError && e.status === 401 && e.code === 'session_expired' && e.extra.cookies.every((c) => /Max-Age=0/.test(c)));
});

test('when Supabase Auth cannot be reached the session is kept and the request fails for now', async () => {
  const s = fresh();
  s.exp = nowS() - 5;
  mockFetch(() => { throw new TypeError('fetch failed'); });
  await assert.rejects(S.requireSession(requestWith(s)), (e) => e instanceof HttpError && e.status === 503 && e.code === 'auth_unavailable' && !e.extra.cookies);
});

test('a token that is not close to expiry is not refreshed', async () => {
  mockFetch(() => { throw new Error('must not be called'); });
  const out = await S.requireSession(requestWith(fresh()));
  assert.equal(fetchCalls.length, 0);
  assert.deepEqual(out.cookies, [], 'and the cookie is not rewritten on every request');
});

test('activity moves the idle stamp at most once a minute; background polling never does', async () => {
  const s = fresh();
  s.last = nowS() - 120;
  const active = await S.requireSession(requestWith(s));
  assert.ok(active.session.last >= nowS() - 1);
  assert.ok(active.cookies.length > 0);
  const s2 = fresh(); s2.last = nowS() - 120;
  const passive = await S.requireSession(requestWith(s2, { 'x-vx-passive': '1' }));
  assert.equal(passive.session.last, s2.last, 'a passive request does not extend the session');
  assert.deepEqual(passive.cookies, []);
});

test('requests without a session get 401 with a reason', async () => {
  await assert.rejects(S.requireSession(new Request(ORIGIN + '/api/x')), (e) => e.status === 401 && e.code === 'not_signed_in');
  const idle = fresh(); idle.last = nowS() - 3600;
  await assert.rejects(S.requireSession(requestWith(idle)), (e) => e.status === 401 && e.code === 'session_idle' && e.extra.cookies.length > 0);
  const old = fresh(); old.iat = nowS() - 13 * 3600;
  await assert.rejects(S.requireSession(requestWith(old)), (e) => e.status === 401 && e.code === 'session_expired');
});

test('the fresh identity check lasts five minutes', () => {
  const s = fresh();
  assert.equal(S.steppedUp(s), false);
  s.su = nowS() - 10; assert.equal(S.steppedUp(s), true);
  s.su = nowS() - 299; assert.equal(S.steppedUp(s), true);
  s.su = nowS() - 301; assert.equal(S.steppedUp(s), false);
});

test('new tokens after the second step raise the assurance level in the session', () => {
  const s = fresh();
  assert.equal(s.aal, 'aal1');
  S.adoptTokens(s, { access_token: jwt({ sub: 'user-1', exp: nowS() + 3600, aal: 'aal2', session_id: s.sid }), refresh_token: 'r2' });
  assert.equal(s.aal, 'aal2');
  S.adoptTokens(s, { access_token: jwt({ sub: 'user-1', exp: nowS() + 3600, aal: 'something-else' }), refresh_token: 'r3' });
  assert.equal(s.aal, 'aal1', 'an unknown value is never treated as aal2');
});

test('rotated cookies reach the browser even when the handler ends in an error or a redirect', async () => {
  const { entry, HttpError: HE } = await import('../../api/_lib/respond.js');
  const rotating = () => { const s = fresh(); s.exp = nowS() + 5; return s; };
  mockFetch(() => new Response(JSON.stringify({ ...grant(), refresh_token: 'refresh-token-ROTATED-0003' }), { status: 200 }));
  const rtOf = (res) => S.openSession(new Request(ORIGIN + '/api/x', { headers: { cookie: cookieHeader(res.headers.getSetCookie()) } })).session?.rt;

  const failing = entry('x', async (request) => { await S.requireSession(request); throw new HE(403, 'forbidden'); });
  const r1 = await failing(requestWith(rotating()));
  assert.equal(r1.status, 403);
  assert.equal(rtOf(r1), 'refresh-token-ROTATED-0003', 'the new refresh token is not lost with the error');

  const crashing = entry('x', async (request) => { await S.requireSession(request); throw new Error('boom'); });
  assert.equal(rtOf(await crashing(requestWith(rotating()))), 'refresh-token-ROTATED-0003');

  const redirecting = entry('x', async (request) => { await S.requireSession(request); return new Response(null, { status: 302, headers: { location: '/' } }); });
  assert.equal(rtOf(await redirecting(requestWith(rotating()))), 'refresh-token-ROTATED-0003');

  // a handler that sets the session cookie itself (after the second step, say) keeps its own, newer value
  const own = entry('x', async (request) => {
    const { session } = await S.requireSession(request);
    session.rt = 'refresh-token-NEWER-0004';
    return new Response('{}', { status: 200, headers: [['set-cookie', S.sessionCookies(session)[0]]] });
  });
  const r4 = await own(requestWith(rotating()));
  assert.equal(r4.headers.getSetCookie().filter((c) => c.startsWith('vx=')).length, 1);
  assert.equal(rtOf(r4), 'refresh-token-NEWER-0004');
});
