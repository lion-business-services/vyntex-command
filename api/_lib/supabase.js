// The server's client for Supabase: plain fetch, no SDK. Three surfaces:
//   Auth      /auth/v1/*      sign-in, token refresh, the second sign-in step, sign-out, and a few admin calls
//   Database  /rest/v1/rpc/*  database functions, called with the PERSON'S token so row level security decides
//   Storage   /storage/v1/*   private files, also with the person's token
//
// Two keys, used very differently:
//   anon key          identifies the project. Sent with every call made on a person's behalf, next to their token.
//   service role key  bypasses row level security. Used only by the functions in the "service" part below, and each
//                     one says why a person's token cannot do that job. Everything else goes through userRpc().
//
// A failed call returns { ok: false, status, sqlstate, code, word }. Nothing else from the upstream answer is kept:
// its text can describe tables, accounts and keys, so it is not returned, not logged, and never reaches a browser.
import { need, env } from './env.js';

const TIMEOUT_MS = 8000;
const base = () => need('SUPABASE_URL').replace(/\/+$/, '');

/** Words a database function of this project raises on purpose. Only these are passed on as a reason. */
const KNOWN_WORDS = new Set([
  'already_member', 'invite_invalid', 'invalid_role', 'invalid_email', 'invalid_token', 'not_a_member',
  'mfa_required', 'stepup_required', 'session_revoked',
  // refusals of the module and provider functions (0030 to 0048): what was wrong, as one word and nothing more
  'not_found', 'expired', 'conflict', 'locked', 'needs_other_person', 'too_small', 'invalid',
]);

function failure(status, payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const sqlstate = typeof p.code === 'string' && /^[0-9A-Z]{5}$|^PGRST\d{3}$/.test(p.code) ? p.code : '';
  const code = [p.error_code, p.code, p.error].find((v) => typeof v === 'string' && /^[a-z][a-z0-9_]{2,60}$/.test(v)) || '';
  const message = typeof p.message === 'string' ? p.message : typeof p.msg === 'string' ? p.msg : '';
  const word = KNOWN_WORDS.has(message) ? message : '';
  return { ok: false, status, sqlstate, code, word };
}

async function call(path, { method = 'GET', key = 'anon', token, body, raw, contentType, headers } = {}) {
  const apikey = key === 'service' ? need('SUPABASE_SERVICE_ROLE_KEY') : need('SUPABASE_ANON_KEY');
  const h = { apikey, authorization: 'Bearer ' + (token || apikey), ...(headers || {}) };
  let payload;
  if (raw !== undefined) { payload = raw; h['content-type'] = contentType || 'application/octet-stream'; }
  else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
  let res;
  try {
    res = await fetch(base() + path, { method, headers: h, body: payload, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return { ok: false, status: 0, sqlstate: '', code: 'unreachable', word: '' };
  }
  return res;
}

async function jsonCall(path, opts) {
  const res = await call(path, opts);
  if (!(res instanceof Response)) return res;
  let data = null;
  try { const text = await res.text(); data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) return failure(res.status, data);
  return { ok: true, status: res.status, data };
}

// ---------------------------------------------------------------------------------------------------------------------
// Auth, as the person
// ---------------------------------------------------------------------------------------------------------------------
export const auth = {
  /** Email and password. Returns the session ({ access_token, refresh_token, expires_in, user }). */
  password: (email, password) => jsonCall('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } }),
  /** Exchanges a refresh token for a new pair. The old refresh token stops working (rotation). */
  refresh: (refreshToken) => jsonCall('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: refreshToken } }),
  user: (token) => jsonCall('/auth/v1/user', { token }),
  updateUser: (token, attrs) => jsonCall('/auth/v1/user', { method: 'PUT', token, body: attrs }),
  /** scope: 'local' (this session), 'others', or 'global' (every session of the person). */
  logout: (token, scope = 'local') => jsonCall('/auth/v1/logout?scope=' + encodeURIComponent(scope), { method: 'POST', token }),
  enrollTotp: (token, friendlyName, issuer) => jsonCall('/auth/v1/factors', { method: 'POST', token, body: { factor_type: 'totp', friendly_name: friendlyName, issuer } }),
  unenroll: (token, factorId) => jsonCall('/auth/v1/factors/' + encodeURIComponent(factorId), { method: 'DELETE', token }),
  challenge: (token, factorId) => jsonCall(`/auth/v1/factors/${encodeURIComponent(factorId)}/challenge`, { method: 'POST', token, body: {} }),
  /** A correct code upgrades the session: the answer is a new token pair at assurance level aal2. */
  verify: (token, factorId, challengeId, code) => jsonCall(`/auth/v1/factors/${encodeURIComponent(factorId)}/verify`, { method: 'POST', token, body: { challenge_id: challengeId, code } }),
  /** Exchanges the one-time token from a password reset email for a session. */
  verifyRecovery: (tokenHash) => jsonCall('/auth/v1/verify', { method: 'POST', body: { type: 'recovery', token_hash: tokenHash } }),
};

// ---------------------------------------------------------------------------------------------------------------------
// Database and storage, as the person. Row level security and the capability checks inside the functions decide.
// ---------------------------------------------------------------------------------------------------------------------
const FN = /^[a-z][a-z0-9_]{1,62}$/;

export function userRpc(token, name, args = {}) {
  if (!FN.test(name)) return Promise.resolve({ ok: false, status: 400, sqlstate: '', code: 'bad_function', word: '' });
  return jsonCall('/rest/v1/rpc/' + name, { method: 'POST', token, body: args });
}

const storagePath = (bucket, path) => `${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`;

export const storage = {
  upload: (token, bucket, path, bytes, contentType) =>
    jsonCall('/storage/v1/object/' + storagePath(bucket, path), { method: 'POST', token, raw: bytes, contentType, headers: { 'x-upsert': 'false' } }),
  /** Returns the fetch Response itself (the body is streamed on to the browser), or a failure object. */
  async download(token, bucket, path) {
    const res = await call('/storage/v1/object/authenticated/' + storagePath(bucket, path), { token });
    if (!(res instanceof Response)) return res;
    if (!res.ok) { try { await res.arrayBuffer(); } catch { /* drop the body */ } return failure(res.status, null); }
    return { ok: true, status: 200, response: res };
  },
  remove: (token, bucket, path) => jsonCall('/storage/v1/object/' + storagePath(bucket, path), { method: 'DELETE', token }),
};

// ---------------------------------------------------------------------------------------------------------------------
// Service role. Each function here exists because there is no person's token that could do the job.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Database functions granted to the server only: rate limits, the job queue, webhook events, sealed provider tokens,
 * security events, accepting an invitation. They run before anyone is signed in (sign-in limits, invitations,
 * webhooks, scheduled jobs) or must not be writable by the person they concern (their own security events,
 * the stamp that says they passed a fresh identity check, the state of a connection).
 */
export function serviceRpc(name, args = {}) {
  if (!FN.test(name)) return Promise.resolve({ ok: false, status: 400, sqlstate: '', code: 'bad_function', word: '' });
  return jsonCall('/rest/v1/rpc/' + name, { method: 'POST', key: 'service', body: args });
}

export const admin = {
  /**
   * Creates the sign-in account for an accepted invitation. There is no sign-up, so nobody has a token yet at this
   * point. The address counts as confirmed because the invitation token was delivered to that mailbox.
   */
  createUser: (email, password) => jsonCall('/auth/v1/admin/users', { method: 'POST', key: 'service', body: { email, password, email_confirm: true } }),
  /** Removes an account that was created a moment ago for an invitation that then could not be completed. */
  deleteUser: (userId) => jsonCall('/auth/v1/admin/users/' + encodeURIComponent(userId), { method: 'DELETE', key: 'service' }),
  /** Removes an authenticator after a recovery code was used: the person cannot produce a code to do it themselves. */
  deleteFactor: (userId, factorId) => jsonCall(`/auth/v1/admin/users/${encodeURIComponent(userId)}/factors/${encodeURIComponent(factorId)}`, { method: 'DELETE', key: 'service' }),
  /** Lists a person's authenticators (same reason as above). */
  listFactors: (userId) => jsonCall(`/auth/v1/admin/users/${encodeURIComponent(userId)}/factors`, { key: 'service' }),
  /**
   * Makes a one-time password reset token without Supabase sending its own email, so the link in OUR email points at
   * this site and the browser never talks to Supabase. The person asking is, by definition, not signed in.
   */
  recoveryLink: (email) => jsonCall('/auth/v1/admin/generate_link', { method: 'POST', key: 'service', body: { type: 'recovery', email } }),
  /** Supabase's own invitation email. Not used by the invitation flow of this product; kept for the operator's tools. */
  invite: (email, data) => jsonCall('/auth/v1/invite', { method: 'POST', key: 'service', body: { email, data: data || {} } }),
};

/** True when the three values every call needs are present. */
export const configured = () => !!(env('SUPABASE_URL') && env('SUPABASE_ANON_KEY') && env('SUPABASE_SERVICE_ROLE_KEY'));

/**
 * Reads the claims of an access token without checking its signature. Safe for how it is used: the token was handed to
 * this server by Supabase Auth over TLS and has been inside the sealed cookie since, so nobody else could have written
 * it. Supabase and the database check the signature again on every call that uses it.
 */
export function peekClaims(accessToken) {
  try {
    const part = String(accessToken).split('.')[1];
    const claims = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return claims && typeof claims === 'object' ? claims : {};
  } catch {
    return {};
  }
}
