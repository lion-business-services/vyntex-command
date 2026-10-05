// The one place that talks to this site's own /api addresses (docs/SERVER.md, section 6). The browser never talks to the
// database or to an outside service, and nothing here is kept in browser storage: the session is an HttpOnly cookie the
// page cannot read.
//
// What every call gets:
//   * `x-vx-csrf` on anything but a GET, with the value the server handed out (a request without it is refused)
//   * `x-vx-passive: 1` on background polling, so looking at the screen does not keep a session alive by itself
//   * an answer that is never thrown: { ok: true, data } or { ok: false, code } with the server's short code
//   * a fresh identity check when the server asks for one: the shared prompt opens, and the call is repeated once
//   * one place that hears when the session ended (idle, expired, signed out elsewhere)

export interface Ok<T> { ok: true; status: number; data: T }
export interface Fail { ok: false; status: number; code: string; data: Record<string, unknown> }
export type Answer<T> = Ok<T> | Fail;

export interface CallOptions {
  /** Background polling: the server does not count it as activity. */
  passive?: boolean;
  /** Ask for the code or password when the server wants a fresh identity check, then repeat the call. Default true. */
  stepUp?: boolean;
  /** A 401 on this call means the session ended (default for /api/ws and /api/integrations). */
  session?: boolean;
  headers?: Record<string, string>;
  /** A body that is not JSON: an uploaded file. `content-type` then comes from `headers`. */
  raw?: Blob | ArrayBuffer;
  timeoutMs?: number;
}

/** Codes that mean nobody is signed in any more. `mfa_required` is not one: the session is open and owes its second step. */
const ENDED = ['not_signed_in', 'session_idle', 'session_expired', 'session_revoked'];
export const sessionEnded = (code: string): boolean => ENDED.includes(code);
/** Codes that mean "the server could not be reached or is not answering": worth trying again, nothing was refused. */
export const isTransient = (a: Fail): boolean => a.status === 0 || a.status === 429 || a.status >= 500 || a.code === 'in_progress';

let csrf = '';
export const setCsrf = (value: unknown): void => { if (typeof value === 'string' && value) csrf = value; };

let askStepUp: (() => Promise<boolean>) | null = null;
/** The interface registers the prompt that asks for the code or the password (src/features/auth/stepup.tsx). */
export function setStepUpPrompt(fn: (() => Promise<boolean>) | null): void { askStepUp = fn; }
/** Opens the prompt directly, for a screen that wants the check done before it starts something. */
export const requestStepUp = (): Promise<boolean> => (askStepUp ? askStepUp() : Promise.resolve(false));

let onEnded: ((code: string) => void) | null = null;
/** Called once per ended session with the server's code (src/platform/live/workspace.ts decides what happens next). */
export function setSessionEndedHandler(fn: ((code: string) => void) | null): void { onEnded = fn; }

async function once<T>(method: string, path: string, body: unknown, o: CallOptions): Promise<Answer<T>> {
  const headers: Record<string, string> = { accept: 'application/json', ...(o.headers ?? {}) };
  if (o.passive) headers['x-vx-passive'] = '1';
  let payload: BodyInit | undefined;
  if (method !== 'GET') {
    headers['x-vx-csrf'] = csrf;
    if (o.raw !== undefined) payload = o.raw;
    else { headers['content-type'] = 'application/json'; payload = JSON.stringify(body ?? {}); }
  }
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), o.timeoutMs ?? 30000);
  try {
    const res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin', cache: 'no-store', signal: stop.signal, redirect: 'error' });
    let json: Record<string, unknown> | null = null;
    try { const parsed = await res.json() as unknown; if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) json = parsed as Record<string, unknown>; } catch { /* not JSON: a page shell or an empty body */ }
    if (json) setCsrf(json.csrf);
    // an answer that is not ours (a static host answering /api with its page shell) reads as "this address is not here"
    if (!json) return { ok: false, status: res.status, code: res.ok ? 'not_available' : res.status === 404 ? 'not_found' : 'server_error', data: {} };
    if (res.ok && json.ok !== false) return { ok: true, status: res.status, data: json as T };
    return { ok: false, status: res.status, code: typeof json.error === 'string' ? json.error : 'server_error', data: json };
  } catch {
    // no connection, a timeout, or the browser refused the request: nothing reached the screen from the server
    return { ok: false, status: 0, code: 'offline', data: {} };
  } finally {
    clearTimeout(timer);
  }
}

/** A csrf value before the first changing request of a visit. The session answer carries it (and sets the cookie). */
async function ensureCsrf(): Promise<void> { if (!csrf) await once('GET', '/api/auth/session', undefined, { passive: true }); }

/**
 * One call. Never throws. `path` starts with /api/. GET bodies are ignored.
 * A refused csrf value is fetched again once (a cookie that expired in an open tab); a demanded identity check opens the
 * prompt once; a session that ended is reported to the handler and comes back as its code.
 */
export async function call<T = Record<string, unknown>>(method: 'GET' | 'POST', path: string, body?: unknown, options: CallOptions = {}): Promise<Answer<T>> {
  if (method !== 'GET') await ensureCsrf();
  let a = await once<T>(method, path, body, options);
  if (!a.ok && a.code === 'bad_csrf') { csrf = ''; await ensureCsrf(); a = await once<T>(method, path, body, options); }
  if (!a.ok && a.code === 'stepup_required' && options.stepUp !== false && askStepUp) {
    if (!(await askStepUp())) return { ok: false, status: a.status, code: 'stepup_cancelled', data: {} };
    a = await once<T>(method, path, body, options);
  }
  const watched = options.session ?? (path.startsWith('/api/ws/') || path.startsWith('/api/integrations'));
  // a session that is open but owes its second step again (the company now requires it) is handled at the same door
  if (!a.ok && watched && ((a.status === 401 && sessionEnded(a.code)) || a.code === 'mfa_required')) onEnded?.(a.code);
  return a;
}
export const get = <T = Record<string, unknown>>(path: string, options?: CallOptions) => call<T>('GET', path, undefined, options);
export const post = <T = Record<string, unknown>>(path: string, body?: unknown, options?: CallOptions) => call<T>('POST', path, body, options);

/**
 * The server's code as one of the reasons the screens word (src/platform/gateway.ts, `Outcome`):
 * `not_allowed`, `not_found`, `invalid`, `conflict`, `locked`, `expired`, `needs_other_person`, `not_available`,
 * `too_large`, `rate_limited`, `offline`, `cancelled`, `session`, plus a few the server words itself and a screen may
 * want to tell apart (`email_not_configured`, `delivery_failed`, `verify_failed`, `pending_approval`, `not_configured`).
 */
export function reasonOf(a: Fail): string {
  const word = typeof a.data.reason === 'string' && /^[a-z_]{2,40}$/.test(a.data.reason) ? a.data.reason : '';
  switch (a.code) {
    case 'offline': case 'upstream_unreachable': case 'auth_unavailable': case 'queue_unavailable': case 'store_unavailable': case 'upstream_error': case 'server_error': return 'offline';
    case 'forbidden': case 'bad_origin': case 'bad_csrf': case 'tenant_mismatch': case 'link_invalid': return 'not_allowed';
    case 'mfa_required': case 'not_signed_in': case 'session_idle': case 'session_expired': case 'session_revoked': return 'session';
    case 'stepup_required': case 'stepup_cancelled': return 'cancelled';
    case 'not_found': case 'unknown_provider': return 'not_found';
    case 'unknown_operation': case 'not_available': case 'not_built': case 'method_not_allowed': return 'not_available';
    // the database refused with a word of its own (needs_other_person, expired, locked, ...): the screens know those
    case 'rejected': return word || 'conflict';
    case 'conflict': case 'in_progress': case 'idem_mismatch': case 'account_exists': case 'already_enrolled': case 'not_enrolled': return 'conflict';
    case 'locked': case 'rate_limited': return 'rate_limited';
    case 'too_large': return 'too_large';
    case 'invalid_code': case 'invalid_credentials': return 'invalid';
    case 'unsupported_media_type': case 'type_not_allowed': case 'type_mismatch': return 'invalid_type';
    case 'email_not_configured': case 'delivery_failed': case 'verify_failed': case 'pending_approval': case 'not_configured': case 'weak_password': case 'invite_invalid': case 'reset_invalid': case 'code_required': case 'password_required': return a.code;
    default: return a.status === 400 || a.status === 415 ? 'invalid' : a.status === 403 ? 'not_allowed' : a.status === 404 ? 'not_found' : 'offline';
  }
}
