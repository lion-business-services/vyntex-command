// Answers and request reading shared by the server functions.
// The rule this file enforces: what goes back to the browser is a short code from a fixed vocabulary, never a message
// written by the database, by Supabase Auth or by a provider, and never a stack trace. Those can describe tables,
// accounts and keys. The detail is logged on the server as a code and a status, nothing else.
import { ConfigError } from './env.js';

const BASE_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

/** A JSON answer that is never cached. `cookies` is a list of complete Set-Cookie values. */
export function json(status, body, { headers, cookies } = {}) {
  const h = new Headers({ ...BASE_HEADERS, ...(headers || {}) });
  for (const c of cookies || []) h.append('set-cookie', c);
  return new Response(JSON.stringify(body), { status, headers: h });
}
export const ok = (body = {}, extra) => json(200, { ok: true, ...body }, extra);
export const fail = (status, code, more = {}, extra) => json(status, { ok: false, error: code, ...more }, extra);

/** Thrown anywhere below a handler to end the request with a status and a code. */
export class HttpError extends Error {
  constructor(status, code, more = {}, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.more = more;
    this.extra = extra;
  }
}

/** One log line: where, what code, and a few safe facts (numbers and codes). Never a value typed by a person. */
export function log(scope, code, facts = {}) {
  const safe = Object.entries(facts).filter(([, v]) => typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && /^[A-Za-z0-9_.:-]{0,60}$/.test(v)));
  console.error(`[${scope}] ${code}${safe.length ? ' ' + safe.map(([k, v]) => `${k}=${v}`).join(' ') : ''}`);
}

/**
 * The part of the address after /api/<base>/. Vercel rewrites /api/<base>/<anything> to the one function file; depending
 * on the runtime the function sees the original address or the rewritten one, so both are understood: the path itself,
 * or the "vxpath" value the rewrite adds. Only simple segments are accepted.
 */
export function subPath(request, base) {
  const url = new URL(request.url);
  const prefix = `/api/${base}/`;
  let rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : (url.searchParams.get('vxpath') || '');
  rest = rest.replace(/^\/+|\/+$/g, '');
  if (rest && !/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+){0,4}$/.test(rest)) return null;
  return rest;
}

/** Reads the body as bytes and gives up as soon as it is larger than allowed. Returns null when it is too large. */
export async function readRaw(request, limit) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { try { await reader.cancel(); } catch { /* already closed */ } return null; }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** Reads a JSON object body. Throws the right HttpError for a wrong type, a body that is too large, or bad JSON. */
export async function readJson(request, limit = 64 * 1024) {
  if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) throw new HttpError(415, 'unsupported_media_type');
  let raw;
  try { raw = await readRaw(request, limit); } catch { throw new HttpError(400, 'invalid_body'); }
  if (raw === null) throw new HttpError(413, 'too_large');
  let body;
  try { body = JSON.parse(raw.toString('utf8') || '{}'); } catch { throw new HttpError(400, 'invalid_json'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'invalid_json');
  return body;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID.test(v);
export const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Turns a failed database or auth call (the shape returned by api/_lib/supabase.js) into a status and a code.
 * Only the SQLSTATE, the HTTP status and a few known words are looked at. The upstream text is dropped.
 */
export function upstreamError(res) {
  const s = res.sqlstate || '';
  if (s === 'VX401') return new HttpError(401, 'session_revoked');
  if (s === 'VX402') return new HttpError(403, 'mfa_required');
  if (s === 'VX403') return new HttpError(403, 'stepup_required');
  if (s === 'VX429') return new HttpError(429, 'rate_limited');
  if (s === '42501') return new HttpError(403, 'forbidden');
  if (s === '23505') return new HttpError(409, 'conflict', res.word ? { reason: res.word } : {});
  if (s === '23503' || s === '23514' || s === '23502' || s.startsWith('22')) return new HttpError(400, 'invalid', res.word ? { reason: res.word } : {});
  if (s === 'P0001') return new HttpError(409, 'rejected', res.word ? { reason: res.word } : {});
  if (s === '42883' || s === 'PGRST202') return new HttpError(501, 'not_available');
  if (res.status === 401) return new HttpError(401, 'session_expired');
  if (res.status === 403) return new HttpError(403, 'forbidden');
  if (res.status === 404) return new HttpError(404, 'not_found');
  if (res.status === 429) return new HttpError(429, 'rate_limited');
  if (res.status === 0) return new HttpError(503, 'upstream_unreachable');
  return new HttpError(502, 'upstream_error');
}

/**
 * Session cookies that were re-sealed while a request was being handled (the tokens were rotated, or the activity
 * stamp moved) and still have to reach the browser. api/_lib/session.js puts them here; entry() below adds them to
 * whatever answer the handler gives, so a rotated refresh token is never lost on an error path or a redirect.
 */
export const pendingCookies = new WeakMap();

function withPending(request, response) {
  const pending = pendingCookies.get(request);
  if (!pending || !pending.length) return response;
  const already = response.headers.getSetCookie().map((c) => c.slice(0, c.indexOf('=')));
  // A handler that set the session cookie itself has the newer value: leave its cookies alone.
  if (pending.some((c) => already.includes(c.slice(0, c.indexOf('='))))) return response;
  try { for (const c of pending) response.headers.append('set-cookie', c); } catch { /* headers of this response cannot be changed */ }
  return response;
}

/**
 * Wraps the handler of one api file: finds the sub-path, runs the handler, and turns anything thrown into a coded
 * answer. An unexpected error becomes 500 "server_error" and its name is logged; its message and stack are not sent.
 */
export function entry(base, handler) {
  return async function handle(request) {
    try {
      const path = subPath(request, base);
      if (path === null) return fail(404, 'not_found');
      return withPending(request, await handler(request, path));
    } catch (e) {
      if (e instanceof HttpError) return withPending(request, fail(e.status, e.code, e.more, e.extra));
      if (e instanceof ConfigError) { log(base, 'not_configured', { variable: e.variable }); return fail(503, 'not_configured'); }
      log(base, 'unhandled', { name: e && e.name ? String(e.name).slice(0, 40) : 'Error' });
      return withPending(request, fail(500, 'server_error'));
    }
  };
}

export const methodNotAllowed = (allow) => fail(405, 'method_not_allowed', {}, { headers: { allow } });
