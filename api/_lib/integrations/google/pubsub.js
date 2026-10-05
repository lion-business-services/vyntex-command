// Checks that a push notification really comes from Google Cloud Pub/Sub (Gmail uses it to say "this mailbox changed").
// Pub/Sub signs each push with an OpenID Connect token in the Authorization header: a JWT signed by Google (RS256),
// made out to the audience configured on the subscription and naming the service account chosen there.
// Nothing in the body is believed until: the signature verifies against Google's published keys, the issuer is
// Google, the audience is ours, the service account is the one we configured, and the token has not expired.
import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { sameString } from '../../crypto.js';

export const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const SKEW_S = 60;

let cache = { keys: new Map(), until: 0 };
export function resetKeyCache() { cache = { keys: new Map(), until: 0 }; }

/** Google's signing keys by key id. Kept for as long as Google's cache header allows (at most a day, at least a minute). */
async function googleKeys(fetchFn, now, force = false) {
  if (!force && cache.until > now && cache.keys.size) return cache.keys;
  const res = await fetchFn(GOOGLE_CERTS, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error('certs');
  const data = await res.json();
  const keys = new Map();
  for (const k of Array.isArray(data?.keys) ? data.keys : []) {
    if (k && k.kty === 'RSA' && typeof k.kid === 'string' && (!k.alg || k.alg === 'RS256')) keys.set(k.kid, k);
  }
  const age = /max-age=(\d{1,7})/.exec(res.headers.get('cache-control') || '');
  cache = { keys, until: now + Math.max(60, Math.min(86400, age ? Number(age[1]) : 3600)) * 1000 };
  return keys;
}

const part = (s) => { try { return JSON.parse(Buffer.from(s, 'base64url').toString('utf8')); } catch { return null; } };

/**
 * Returns { ok: true, claims } or { ok: false, reason }.
 * reason: signature_missing, bad_signature, stale (expired token), wrong_audience, wrong_sender, keys_unavailable.
 */
export async function verifyGoogleOidc(authorization, { audience, email, fetchFn, now = Date.now() }) {
  const m = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(authorization || '').trim());
  if (!m) return { ok: false, reason: 'signature_missing' };
  const header = part(m[1]);
  const claims = part(m[2]);
  // Only RS256 is accepted: "none" and the HMAC family would let anyone who knows a public value sign a token.
  if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string' || !claims || typeof claims !== 'object') return { ok: false, reason: 'bad_signature' };
  let jwk;
  try {
    jwk = (await googleKeys(fetchFn, now)).get(header.kid);
    // An unknown key id usually means Google rotated its keys since the copy was fetched: look once more.
    if (!jwk) jwk = (await googleKeys(fetchFn, now, true)).get(header.kid);
  } catch {
    return { ok: false, reason: 'keys_unavailable' };
  }
  if (!jwk) return { ok: false, reason: 'bad_signature' };
  let good = false;
  try {
    good = verifySignature('RSA-SHA256', Buffer.from(`${m[1]}.${m[2]}`), createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' }), Buffer.from(m[3], 'base64url'));
  } catch { good = false; }
  if (!good) return { ok: false, reason: 'bad_signature' };
  // Everything below is read from the signed part, so it is checked only after the signature held.
  if (!ISSUERS.has(claims.iss)) return { ok: false, reason: 'bad_signature' };
  const nowS = Math.floor(now / 1000);
  if (!Number.isFinite(claims.exp) || claims.exp + SKEW_S < nowS) return { ok: false, reason: 'stale' };
  if (Number.isFinite(claims.iat) && claims.iat - SKEW_S > nowS) return { ok: false, reason: 'stale' };
  if (typeof claims.aud !== 'string' || !sameString(claims.aud, audience)) return { ok: false, reason: 'wrong_audience' };
  if (claims.email_verified !== true || typeof claims.email !== 'string' || !sameString(claims.email.toLowerCase(), String(email).toLowerCase())) return { ok: false, reason: 'wrong_sender' };
  return { ok: true, claims: { iat: claims.iat, exp: claims.exp } };
}
