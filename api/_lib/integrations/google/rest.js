// One way to call a Google REST API with a connection's access token.
// What it guarantees to the adapters:
//   errors are codes     Google's message text is never kept or passed on, only a code from the short list below
//   outage               a 5xx answer or a network failure is retried with a growing wait, for calls that are safe to
//                        repeat, then reported as provider_down
//   rate limit           a 429 (or Google's 403 "rate limit" reasons) is reported as rate_limited with the number of
//                        seconds Google asked to wait (error.retryAfter), never retried in a tight loop
//   permission           401 means the token is no longer accepted (connect again); a missing scope says so
import { ProviderError } from '../oauth.js';

const WAITS_MS = [250, 750];
const RATE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded', 'RESOURCE_EXHAUSTED']);
const SCOPE_REASONS = new Set(['insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT', 'insufficientScope']);
const DISABLED_REASONS = new Set(['accessNotConfigured', 'SERVICE_DISABLED', 'API_KEY_SERVICE_BLOCKED']);

const sleepFor = (ctx, ms) => (ctx.sleep ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));

/** Seconds from a Retry-After header (a number or a date), limited to one hour. Null when there is none. */
export function retryAfterSeconds(res, now = Date.now()) {
  const v = res.headers.get('retry-after');
  if (!v) return null;
  const n = /^\d{1,6}$/.test(v.trim()) ? Number(v) : Math.ceil((Date.parse(v) - now) / 1000);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 3600) : null;
}

/** The machine reason inside a Google error body: a fixed word, never free text. */
function reasonOf(data) {
  const e = data && data.error;
  if (!e || typeof e !== 'object') return '';
  const first = Array.isArray(e.errors) && e.errors[0] && typeof e.errors[0].reason === 'string' ? e.errors[0].reason : '';
  const detail = Array.isArray(e.details) ? e.details.find((d) => d && typeof d.reason === 'string')?.reason : '';
  const word = first || detail || (typeof e.status === 'string' ? e.status : '');
  return /^[A-Za-z_]{2,60}$/.test(word) ? word : '';
}

function failure(res, data, now) {
  const reason = reasonOf(data);
  const s = res.status;
  let err;
  if (s === 401) err = new ProviderError('token_rejected', { reauth: true, status: s });
  else if (s === 429 || (s === 403 && RATE_REASONS.has(reason))) { err = new ProviderError('rate_limited', { status: s }); err.retryAfter = retryAfterSeconds(res, now) ?? 60; }
  else if (s === 403 && SCOPE_REASONS.has(reason)) err = new ProviderError('scope_missing', { reauth: true, status: s });
  else if (s === 403 && DISABLED_REASONS.has(reason)) err = new ProviderError('api_not_enabled', { status: s });
  else if (s === 403) err = new ProviderError('forbidden', { status: s });
  else if (s === 404) err = new ProviderError('not_found', { status: s });
  else if (s === 409) err = new ProviderError('conflict', { status: s });
  else if (s === 410) err = new ProviderError('gone', { status: s });
  else if (s === 412) err = new ProviderError('changed_meanwhile', { status: s });
  else if (s >= 500) err = new ProviderError('provider_down', { status: s });
  else err = new ProviderError('request_rejected', { status: s });
  err.googleReason = reason;
  return err;
}

/**
 * opts: query (object, array values repeat the name), body (object, sent as JSON), raw + contentType (a Buffer sent as
 * it is), headers, auth ('bearer' default, or 'none' for key based calls), repeatable (default: true for everything
 * but POST; a POST that carries its own request id passes true).
 * Returns the parsed JSON answer ({} for an empty one). Throws ProviderError.
 */
export async function gapi(ctx, method, url, opts = {}) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(opts.query || {})) {
    if (v === undefined || v === null || v === '') continue;
    for (const one of Array.isArray(v) ? v : [v]) u.searchParams.append(k, String(one));
  }
  const headers = { accept: 'application/json', ...(opts.headers || {}) };
  if (opts.auth !== 'none') {
    if (!ctx.tokens || !ctx.tokens.access_token) throw new ProviderError('not_connected');
    headers.authorization = 'Bearer ' + ctx.tokens.access_token;
  }
  let body;
  if (opts.raw) { body = opts.raw; headers['content-type'] = opts.contentType || 'application/octet-stream'; }
  else if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers['content-type'] = 'application/json'; }
  const repeatable = opts.repeatable ?? method !== 'POST';
  const tries = repeatable ? WAITS_MS.length + 1 : 1;
  let last = new ProviderError('provider_unreachable');
  for (let i = 0; i < tries; i += 1) {
    if (i > 0) await sleepFor(ctx, WAITS_MS[i - 1]);
    let res;
    try {
      res = await ctx.fetch(u.toString(), { method, headers, body, signal: AbortSignal.timeout(opts.timeoutMs || 10000) });
    } catch {
      last = new ProviderError('provider_unreachable');
      continue;
    }
    let data = null;
    try { const text = await res.text(); data = text ? JSON.parse(text) : {}; } catch { data = null; }
    if (res.ok) {
      if (data === null || typeof data !== 'object') throw new ProviderError('bad_answer', { status: res.status });
      return data;
    }
    last = failure(res, data, ctx.now ? ctx.now() : Date.now());
    if (last.code !== 'provider_down') throw last;
  }
  throw last;
}

/** A value that is safe to put in a path segment of a Google address, or a thrown invalid_id. */
export function seg(value, pattern = /^[A-Za-z0-9_.@-]{1,200}$/) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new ProviderError('invalid_id');
  return encodeURIComponent(value);
}
