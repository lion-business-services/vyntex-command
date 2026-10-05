// Protection against requests forged by another site. Two independent checks on every request that changes something:
//
//   1. Origin. The browser states which site made the request. It must be this site (APP_ORIGIN). A form or script
//      on another site cannot change that header.
//   2. Double submit. The page reads a value from a cookie only this site can read and sends it back in the
//      "x-vx-csrf" header. Another site can make the browser send the cookie but cannot read it, so it cannot fill
//      the header. The value is signed by the server (so a value planted by a sibling subdomain does not pass) and,
//      once a person is signed in, it must also equal the value sealed inside their session cookie.
//
// The session cookie is SameSite=Lax as well, which already keeps it off cross-site POSTs in current browsers.
// These checks do not rely on that.
// Not covered here on purpose: webhooks (signed by the provider), scheduled calls (secret header), and the OAuth
// return address (a GET protected by the one-time state value).
import { need, appOrigin, secureCookies } from './env.js';
import { deriveKey, hmacHex, randomToken, sameString } from './crypto.js';
import { readCookies } from './session.js';
import { HttpError } from './respond.js';

export const csrfCookieName = () => (secureCookies() ? '__Host-vx-csrf' : 'vx-csrf');
const key = () => deriveKey(need('SESSION_SECRET'), 'vx-csrf-v1').key;
const sign = (value) => hmacHex(key(), value).slice(0, 32);

/** A signed value: <random>.<signature>. `seed` reuses the random part sealed in a session. */
export function csrfToken(seed) {
  const value = seed || randomToken(24);
  return `${value}.${sign(value)}`;
}

/** Readable by the page's script on purpose (no HttpOnly): the page must copy it into the header. It holds no secret. */
export function csrfCookie(token) {
  return `${csrfCookieName()}=${token}; Path=/; SameSite=Lax${secureCookies() ? '; Secure' : ''}; Max-Age=43200`;
}

const validToken = (token) => {
  if (typeof token !== 'string' || token.length > 200) return false;
  const i = token.lastIndexOf('.');
  return i > 0 && sameString(token.slice(i + 1), sign(token.slice(0, i)));
};

/** Refuses a state-changing request that does not come from this site's own pages. */
export function assertSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') throw new HttpError(403, 'bad_origin');
  let got;
  try { got = new URL(origin).origin; } catch { throw new HttpError(403, 'bad_origin'); }
  if (got !== new URL(appOrigin(request)).origin) throw new HttpError(403, 'bad_origin');
}

/** Both checks. `session` is the open session when the route needs one, or null for the routes used before sign-in. */
export function assertCsrf(request, session) {
  assertSameOrigin(request);
  const header = request.headers.get('x-vx-csrf') || '';
  const cookie = readCookies(request)[csrfCookieName()] || '';
  if (!header || !cookie || !sameString(header, cookie) || !validToken(header)) throw new HttpError(403, 'bad_csrf');
  if (session && !sameString(header, csrfToken(session.csrf))) throw new HttpError(403, 'bad_csrf');
}
