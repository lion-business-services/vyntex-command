// Cross-site request protection: the Origin check and the double-submit value. No database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTestEnv, ORIGIN } from './helpers.mjs';

setTestEnv();
const { assertSameOrigin, assertCsrf, csrfToken, csrfCookie, csrfCookieName } = await import('../../api/_lib/csrf.js');
const { HttpError } = await import('../../api/_lib/respond.js');

const req = (headers) => new Request(ORIGIN + '/api/auth/signin', { method: 'POST', headers });
const refuses = (fn, code) => assert.throws(fn, (e) => e instanceof HttpError && e.status === 403 && e.code === code);

test('a request from this site passes the Origin check', () => {
  assertSameOrigin(req({ origin: ORIGIN }));
});

test('a request from another site, or with no Origin, is refused', () => {
  refuses(() => assertSameOrigin(req({})), 'bad_origin');
  refuses(() => assertSameOrigin(req({ origin: 'https://evil.example.com' })), 'bad_origin');
  refuses(() => assertSameOrigin(req({ origin: 'null' })), 'bad_origin');
  refuses(() => assertSameOrigin(req({ origin: 'http://localhost:9999' })), 'bad_origin');
  refuses(() => assertSameOrigin(req({ origin: 'https://localhost:4620' })), 'bad_origin');
  refuses(() => assertSameOrigin(req({ origin: ORIGIN + '.evil.example.com' })), 'bad_origin');
  refuses(() => assertSameOrigin(req({ origin: 'not a url' })), 'bad_origin');
});

test('the allowed origin is APP_ORIGIN, not whatever Host header the request carries', () => {
  refuses(() => assertSameOrigin(new Request('http://evil.example.com/api/auth/signin', { method: 'POST', headers: { origin: 'http://evil.example.com', host: 'evil.example.com' } })), 'bad_origin');
});

test('the double-submit value must be present in both places, equal, and signed by the server', () => {
  const token = csrfToken();
  const name = csrfCookieName();
  assertCsrf(req({ origin: ORIGIN, 'x-vx-csrf': token, cookie: `${name}=${token}` }), null);
  refuses(() => assertCsrf(req({ origin: ORIGIN, cookie: `${name}=${token}` }), null), 'bad_csrf');
  refuses(() => assertCsrf(req({ origin: ORIGIN, 'x-vx-csrf': token }), null), 'bad_csrf');
  refuses(() => assertCsrf(req({ origin: ORIGIN, 'x-vx-csrf': token, cookie: `${name}=${csrfToken()}` }), null), 'bad_csrf');
  // a value planted by someone else: equal in both places, but not signed by this server
  const planted = 'planted-value-0123456789.00000000000000000000000000000000';
  refuses(() => assertCsrf(req({ origin: ORIGIN, 'x-vx-csrf': planted, cookie: `${name}=${planted}` }), null), 'bad_csrf');
  refuses(() => assertCsrf(req({ origin: ORIGIN, 'x-vx-csrf': 'x', cookie: `${name}=x` }), null), 'bad_csrf');
  // the Origin check comes first
  refuses(() => assertCsrf(req({ origin: 'https://evil.example.com', 'x-vx-csrf': token, cookie: `${name}=${token}` }), null), 'bad_origin');
});

test('once signed in, the value must be the one sealed in that session', () => {
  const session = { csrf: 'seed-of-this-session-0001' };
  const mine = csrfToken(session.csrf);
  const name = csrfCookieName();
  assertCsrf(req({ origin: ORIGIN, 'x-vx-csrf': mine, cookie: `${name}=${mine}` }), session);
  const other = csrfToken('seed-of-another-session');
  refuses(() => assertCsrf(req({ origin: ORIGIN, 'x-vx-csrf': other, cookie: `${name}=${other}` }), session), 'bad_csrf');
  const anonymous = csrfToken();
  refuses(() => assertCsrf(req({ origin: ORIGIN, 'x-vx-csrf': anonymous, cookie: `${name}=${anonymous}` }), session), 'bad_csrf');
});

test('a value signed with another secret is refused', () => {
  const token = csrfToken();
  const keep = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'a-different-secret-0123456789abcdefghij';
  refuses(() => assertCsrf(req({ origin: ORIGIN, 'x-vx-csrf': token, cookie: `${csrfCookieName()}=${token}` }), null), 'bad_csrf');
  process.env.SESSION_SECRET = keep;
});

test('the csrf cookie is readable by the page (no HttpOnly) and SameSite=Lax', () => {
  const c = csrfCookie(csrfToken());
  assert.ok(!/HttpOnly/i.test(c));
  assert.match(c, /SameSite=Lax/); assert.match(c, /Path=\//);
  process.env.VX_ENV = 'production';
  try { assert.match(csrfCookie('x'), /^__Host-vx-csrf=x; .*Secure/); } finally { process.env.VX_ENV = 'test'; }
});
