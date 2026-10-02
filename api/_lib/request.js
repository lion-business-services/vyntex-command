// Shared helpers for the server functions in api/. Files in a folder that starts with "_" are not turned into
// endpoints by Vercel, so nothing here is reachable from the internet on its own.
import { createHmac } from 'node:crypto';

const BASE_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

/** A JSON answer that is never cached. */
export function json(status, body, extra) {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...(extra || {}) } });
}

/** The caller's network address as Vercel reports it, or '' when it is not known. */
export function clientAddress(request) {
  const real = request.headers.get('x-real-ip');
  const forwarded = request.headers.get('x-forwarded-for');
  return (real || (forwarded ? forwarded.split(',')[0] : '') || '').trim().slice(0, 64);
}

/**
 * Keyed hash (HMAC-SHA256, hex) of a network address, for columns such as demo_requests.source_ip_hash.
 * The address itself is never stored. Returns null when there is no address or IP_HASH_SALT is not set:
 * a plain hash of an address can be reversed by trying every address, so without the salt nothing is stored.
 */
export function hashAddress(address, salt = process.env.IP_HASH_SALT) {
  if (!address || typeof salt !== 'string' || salt.length < 16) return null;
  return createHmac('sha256', salt).update(address).digest('hex');
}

/** True when the named environment variable holds a value. Never returns or logs the value itself. */
export function isSet(name) {
  const v = process.env[name];
  return typeof v === 'string' && v.trim().length > 0;
}
