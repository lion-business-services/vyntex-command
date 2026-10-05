// What the Meta adapter (Facebook Pages, Instagram) and the WhatsApp adapter have in common: the Graph API call,
// the mapping of Meta's error numbers to this platform's codes, and the two webhook checks Meta asks for.
//
// Tokens travel in the Authorization header, never in the address, so they cannot end up in a log of requested
// addresses. Meta's error text is never kept: it can name the account, the Page or the person.
import { ProviderError } from '../oauth.js';
import { hmac } from '../webhook.js';
import { sameString } from '../../crypto.js';

export const graphVersion = (ctx) => (/^v\d{1,3}\.\d$/.test(ctx.env('META_GRAPH_VERSION')) ? ctx.env('META_GRAPH_VERSION') : 'v23.0');
export const graphBase = (ctx) => 'https://graph.facebook.com/' + graphVersion(ctx);

// Meta's numbers, from its published error reference. Sub codes say more than codes, so they are looked at first.
const WINDOW_SUBCODES = new Set([2018278, 2534022, 2018108]);
const WINDOW_CODES = new Set([131047, 10903]);
const RATE_CODES = new Set([4, 17, 32, 341, 613, 80001, 80002, 80004, 80006, 80007, 130429, 131048, 131056, 133016]);
const TEMPLATE_STATE_CODES = new Set([132001, 132015, 132016]);

/** The code this platform uses for a Meta error object ({ code, error_subcode, type }). */
export function graphErrorCode(e = {}, status = 0) {
  const code = Number(e.code); const sub = Number(e.error_subcode);
  if (WINDOW_SUBCODES.has(sub) || WINDOW_CODES.has(code)) return { code: 'outside_messaging_window' };
  if (code === 190) {
    // 458: the person removed the app. 460: the password changed. 463 and 467: the token ran out or was ended.
    if (sub === 458) return { code: 'permission_revoked', reauth: true };
    return { code: sub === 460 ? 'token_revoked' : 'token_expired', reauth: true };
  }
  if (code === 102) return { code: 'token_expired', reauth: true };
  if (RATE_CODES.has(code) || status === 429) return { code: 'rate_limited' };
  if (TEMPLATE_STATE_CODES.has(code)) return { code: code === 132001 ? 'template_not_found' : 'template_not_approved' };
  if (code === 132000 || code === 132012) return { code: 'template_params_invalid' };
  if (code === 131026) return { code: 'recipient_unreachable' };
  if (code === 131050) return { code: 'recipient_opted_out' };
  if (code === 131031 || code === 368) return { code: 'account_restricted' };
  if (code === 131045 || code === 133010) return { code: 'number_not_registered' };
  // 10 and 200 to 299: the token is good but this permission is not (or no longer) granted for it.
  if (code === 10 || code === 3 || (code >= 200 && code <= 299)) return { code: 'permission_revoked', reauth: true };
  if (code === 100 || code === 33) return { code: 'request_rejected' };
  if (status >= 500 || code === 1 || code === 2) return { code: 'provider_error' };
  return { code: status === 401 ? 'token_expired' : 'provider_error', reauth: status === 401 };
}

/**
 * One Graph API call. `token` goes in the header. Returns the parsed answer or throws ProviderError.
 * `form` sends a multipart body (a photo upload); `body` sends JSON; `query` is added to the address.
 */
export async function graph(ctx, path, { method = 'GET', token, query, body, form, timeoutMs = 10000 } = {}) {
  const url = new URL(/^https:\/\//.test(path) ? path : graphBase(ctx) + path);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  if (body) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await ctx.fetch(url.toString(), { method, headers, body: form || (body ? JSON.stringify(body) : undefined), signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new ProviderError('provider_unreachable');
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok || (data && data.error)) {
    const mapped = graphErrorCode(data && typeof data.error === 'object' ? data.error : {}, res.status);
    throw new ProviderError(mapped.code, { reauth: !!mapped.reauth, status: res.status });
  }
  if (!data || typeof data !== 'object') throw new ProviderError('provider_error', { status: res.status });
  return data;
}

/** Meta signs each webhook: "x-hub-signature-256: sha256=<hex>", HMAC-SHA256 of the raw body with the app secret. */
export function verifyHubSignature(appSecret, headerValue, raw) {
  if (!appSecret) return { ok: false, reason: 'not_configured' };
  const m = /^sha256=([0-9a-f]{64})$/.exec(String(headerValue || '').trim());
  if (!m) return { ok: false, reason: headerValue ? 'bad_signature' : 'signature_missing' };
  return sameString(m[1], hmac(appSecret, raw)) ? { ok: true } : { ok: false, reason: 'bad_signature' };
}

/**
 * The check Meta makes once, when the webhook address is saved in its dashboard: a GET with hub.mode=subscribe,
 * the verify token typed there, and a challenge to send back as plain text.
 * Returns { ok: true, body } or { ok: false, reason }.
 */
export function hubChallenge(request, verifyToken) {
  if (!verifyToken) return { ok: false, reason: 'not_configured' };
  let q;
  try { q = new URL(request.url).searchParams; } catch { return { ok: false, reason: 'bad_request' }; }
  const challenge = q.get('hub.challenge') || '';
  if (q.get('hub.mode') !== 'subscribe' || !/^[A-Za-z0-9_.-]{1,200}$/.test(challenge)) return { ok: false, reason: 'bad_request' };
  if (!sameString(q.get('hub.verify_token') || '', verifyToken)) return { ok: false, reason: 'bad_verify_token' };
  return { ok: true, status: 200, contentType: 'text/plain; charset=utf-8', body: challenge };
}

/**
 * Meta's signature carries no time stamp of its own, but the signed body does (entry[].time). Meta sends a failed
 * delivery again for a long time, so a repeat is stopped by the event id, and this window only refuses a body
 * older than the longest retry. Seconds; a deployment can narrow it with the named variable.
 */
export function maxAgeSeconds(ctx, name, fallback) {
  const v = ctx.env(name);
  return /^\d{2,8}$/.test(v) ? Number(v) : fallback;
}
export const withinAge = (iso, now, maxAgeS) => { const t = Date.parse(iso || ''); return Number.isFinite(t) && now - t <= maxAgeS * 1000 && t - now <= 300000; };
