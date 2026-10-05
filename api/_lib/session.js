// The session: a sealed cookie, nothing in browser storage, nothing the page's scripts can read.
//
// After sign-in the Supabase access token and refresh token are sealed (AES-256-GCM, key derived from
// SESSION_SECRET) together with a few stamps and put in one cookie:
//   production   __Host-vx   HttpOnly; Secure; SameSite=Lax; Path=/     (the __Host- prefix pins it to this exact host)
//   local, test  vx          the same without Secure, because a local run is plain http
// The browser holds an opaque value. It cannot read the tokens, change the stamps, or build a cookie of its own:
// a value that was not sealed with the server's key does not open.
//
// What the stamps enforce, on the server, for every request:
//   idle timeout       `last` is the time of the last real activity. Past the company's idle minutes the session ends.
//   absolute lifetime  `iat` is when the person signed in. Past SESSION_MAX_HOURS (default 12) the session ends.
//   refresh rotation   when the access token is about to expire it is exchanged with the refresh token, and the
//                      refresh token is replaced by the new one. An old refresh token never works twice.
//   fresh check        `su` is when the person last proved who they are again (code or password). Protected
//                      operations demand it within five minutes; the database keeps its own stamp for the same rule.
// Key rotation: set a new SESSION_SECRET and move the old value to SESSION_SECRET_PREVIOUS. Cookies sealed with
// either open; every answer re-seals with the new one.
import { need, has, env, envInt, secureCookies } from './env.js';
import { sealWith, openWith, deriveKey, randomToken } from './crypto.js';
import { auth, peekClaims } from './supabase.js';
import { HttpError, pendingCookies } from './respond.js';

const CHUNK = 3600;            // a cookie holds about 4096 bytes including its name and attributes
const MAX_CHUNKS = 4;
const TOUCH_EVERY_S = 60;      // the cookie is not rewritten more often than this
const REFRESH_MARGIN_S = 60;   // exchange the access token this long before it expires
export const STEPUP_SECONDS = 300;

export const cookieName = () => (secureCookies() ? '__Host-vx' : 'vx');
const attrs = () => `Path=/; HttpOnly; SameSite=Lax${secureCookies() ? '; Secure' : ''}`;
const nowS = () => Math.floor(Date.now() / 1000);

function keys() {
  // A short secret is treated as no secret: sealing with it would only look safe.
  if (need('SESSION_SECRET').length < 32) throw new HttpError(503, 'not_configured');
  const list = [deriveKey(need('SESSION_SECRET'), 'vx-session-v1')];
  if (has('SESSION_SECRET_PREVIOUS')) list.push(deriveKey(env('SESSION_SECRET_PREVIOUS'), 'vx-session-v1'));
  return list;
}

export function readCookies(request) {
  const out = {};
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** The Set-Cookie values that store a session (one or more parts, plus clears for parts no longer needed). */
export function sessionCookies(session) {
  const sealed = sealWith(keys(), session, 'vx-session', 's1');
  const parts = [];
  for (let i = 0; i < sealed.length; i += CHUNK) parts.push(sealed.slice(i, i + CHUNK));
  if (parts.length > MAX_CHUNKS) throw new HttpError(500, 'session_too_large');
  const name = cookieName();
  const maxAge = Math.max(60, envInt('SESSION_MAX_HOURS', 12, 1, 72) * 3600 - (nowS() - session.iat));
  const out = parts.map((p, i) => `${name}${i ? i : ''}=${p}; ${attrs()}; Max-Age=${maxAge}`);
  for (let i = parts.length; i < MAX_CHUNKS; i++) out.push(`${name}${i ? i : ''}=; ${attrs()}; Max-Age=0`);
  return out;
}

export function clearCookies() {
  const name = cookieName();
  return Array.from({ length: MAX_CHUNKS }, (_, i) => `${name}${i ? i : ''}=; ${attrs()}; Max-Age=0`);
}

/** Opens the cookie. { session } or { session: null, why } with why = none | tampered | expired | idle. */
export function openSession(request) {
  const jar = readCookies(request);
  const name = cookieName();
  let sealed = jar[name] || '';
  if (!sealed) return { session: null, why: 'none' };
  for (let i = 1; i < MAX_CHUNKS && jar[name + i]; i++) sealed += jar[name + i];
  const s = openWith(keys(), sealed, 'vx-session', 's1');
  if (!s || s.v !== 1 || typeof s.uid !== 'string' || typeof s.at !== 'string' || typeof s.rt !== 'string') return { session: null, why: 'tampered' };
  const now = nowS();
  if (now - s.iat > envInt('SESSION_MAX_HOURS', 12, 1, 72) * 3600) return { session: null, why: 'expired' };
  if (now - s.last > Math.max(5, Math.min(720, Number(s.idle) || 30)) * 60) return { session: null, why: 'idle' };
  return { session: s };
}

/** A new session from what Supabase Auth returned at sign-in. */
export function newSession(grant, { idle = 30 } = {}) {
  const claims = peekClaims(grant.access_token);
  const now = nowS();
  return {
    v: 1,
    uid: String(grant.user?.id || claims.sub || ''),
    email: String(grant.user?.email || claims.email || ''),
    at: grant.access_token,
    rt: grant.refresh_token,
    exp: Number(claims.exp) || now + (Number(grant.expires_in) || 3600),
    sid: typeof claims.session_id === 'string' ? claims.session_id : '',
    aal: claims.aal === 'aal2' ? 'aal2' : 'aal1',
    iat: now,
    last: now,
    idle,
    su: 0,
    csrf: randomToken(24),
  };
}

/** Puts a new token pair (after a refresh or after the second step) into the session. The start time and csrf value stay. */
export function adoptTokens(session, grant) {
  const claims = peekClaims(grant.access_token);
  session.at = grant.access_token;
  session.rt = grant.refresh_token;
  session.exp = Number(claims.exp) || nowS() + (Number(grant.expires_in) || 3600);
  session.aal = claims.aal === 'aal2' ? 'aal2' : 'aal1';
  if (typeof claims.session_id === 'string') session.sid = claims.session_id;
  return session;
}

/**
 * The signed-in session behind a request, with fresh tokens. Throws 401 with a code that says why there is none.
 * Returns { session, cookies }: `cookies` must be sent with the answer whenever it is not empty (the cookie was
 * re-sealed because tokens were rotated or the activity stamp moved).
 * A request marked "x-vx-passive: 1" (background polling) does not count as activity and never extends the session.
 */
export async function requireSession(request) {
  const { session, why } = openSession(request);
  if (!session) {
    const code = why === 'idle' ? 'session_idle' : why === 'expired' ? 'session_expired' : 'not_signed_in';
    throw new HttpError(401, code, {}, why === 'none' ? {} : { cookies: clearCookies() });
  }
  const now = nowS();
  let changed = false;
  if (session.exp - now < REFRESH_MARGIN_S) {
    const r = await auth.refresh(session.rt);
    if (!r.ok) {
      // The refresh token was refused (revoked, reused, or the person signed out everywhere): the session is over.
      // When Supabase could not be reached at all the session is kept and the request fails for now.
      if (r.status === 0 || r.status >= 500) throw new HttpError(503, 'auth_unavailable');
      throw new HttpError(401, 'session_expired', {}, { cookies: clearCookies() });
    }
    adoptTokens(session, r.data);
    changed = true;
  }
  const passive = request.headers.get('x-vx-passive') === '1';
  if (!passive && now - session.last >= TOUCH_EVERY_S) { session.last = now; changed = true; }
  const cookies = changed ? sessionCookies(session) : [];
  if (cookies.length) pendingCookies.set(request, cookies);
  return { session, cookies };
}

/** True while the fresh identity check is still good. */
export const steppedUp = (session) => !!session.su && nowS() - session.su <= STEPUP_SECONDS;
