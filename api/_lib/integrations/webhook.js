// Webhook helpers shared by the provider adapters and by api/webhooks.js.
// A webhook is a request from the internet that claims to come from a provider. Nothing in it is believed until the
// signature over the RAW body (the exact bytes received) matches, and the time stamp inside the signed part is recent.
import { createHmac } from 'node:crypto';
import { sameString, sha256Hex } from '../crypto.js';

/** How far a signed time stamp may be from now, in seconds. Older or newer is treated as a replay. */
export const REPLAY_WINDOW_S = 300;

export const fresh = (timestampSeconds, now = Date.now(), windowS = REPLAY_WINDOW_S) =>
  Number.isFinite(timestampSeconds) && Math.abs(Math.floor(now / 1000) - timestampSeconds) <= windowS;

export const hmac = (key, data, encoding = 'hex', algo = 'sha256') => createHmac(algo, key).update(data).digest(encoding);
export const payloadHash = (raw) => sha256Hex(raw);

/**
 * Svix-style signatures (used by Resend and others):
 *   headers  svix-id, svix-timestamp, svix-signature ("v1,<base64>" entries separated by spaces)
 *   signed   "<id>.<timestamp>.<raw body>" with HMAC-SHA256, key = base64 part of the "whsec_..." secret
 * Returns { ok: true, id, timestamp } or { ok: false, reason }.
 */
export function verifySvix(secret, headers, raw, now = Date.now()) {
  const id = headers.get('svix-id') || headers.get('webhook-id') || '';
  const ts = headers.get('svix-timestamp') || headers.get('webhook-timestamp') || '';
  const sig = headers.get('svix-signature') || headers.get('webhook-signature') || '';
  if (!secret || !id || !ts || !sig) return { ok: false, reason: 'signature_missing' };
  if (!/^\d{9,11}$/.test(ts)) return { ok: false, reason: 'bad_timestamp' };
  let key;
  try { key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64'); } catch { return { ok: false, reason: 'not_configured' }; }
  if (key.length < 16) return { ok: false, reason: 'not_configured' };
  const expected = createHmac('sha256', key).update(`${id}.${ts}.`).update(raw).digest('base64');
  const given = sig.split(' ').map((s) => s.split(',')).filter((p) => p.length === 2 && p[0] === 'v1').map((p) => p[1]);
  if (!given.some((g) => sameString(g, expected))) return { ok: false, reason: 'bad_signature' };
  // The time stamp is checked only after the signature: it is part of what was signed, so it cannot be forged alone.
  if (!fresh(Number(ts), now)) return { ok: false, reason: 'stale' };
  return { ok: true, id, timestamp: Number(ts) };
}

/**
 * The plain "t=<seconds>,v1=<hex>" scheme (one header, HMAC-SHA256 over "<t>.<raw body>").
 * Returns { ok: true, timestamp } or { ok: false, reason }.
 */
export function verifyTimestamped(secret, headerValue, raw, now = Date.now()) {
  if (!secret || !headerValue) return { ok: false, reason: 'signature_missing' };
  const parts = Object.fromEntries(String(headerValue).split(',').map((p) => p.trim().split('=')).filter((p) => p.length === 2));
  if (!/^\d{9,11}$/.test(parts.t || '') || !/^[0-9a-f]{64}$/.test(parts.v1 || '')) return { ok: false, reason: 'bad_signature' };
  const expected = createHmac('sha256', secret).update(`${parts.t}.`).update(raw).digest('hex');
  if (!sameString(parts.v1, expected)) return { ok: false, reason: 'bad_signature' };
  if (!fresh(Number(parts.t), now)) return { ok: false, reason: 'stale' };
  return { ok: true, timestamp: Number(parts.t) };
}

/** Parses the raw body as JSON after the signature passed. Null when it is not a JSON object. */
export function parseJson(raw) {
  try { const v = JSON.parse(raw.toString('utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}
