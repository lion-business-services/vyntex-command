// Sends ordinary changes to POST /api/ws/apply and brings the answer back in the shape the store works with.
//
//   batches      a change list is cut into requests the server accepts (at most 400 operations and well under 1 MB),
//                in the order the list came in: the difference is already sorted so a record travels before what points at it
//   retry        every request has an idempotency key. When the server cannot be reached the same request, with the same
//                key, is sent again (2 s, 5 s, 10 s, then every 30 s, and at once when the browser says it is online):
//                the server answers a key it has seen with the stored answer, so nothing is applied twice
//   status       saving while a request is out, offline while it is being repeated; the store says "saved"
//   no retry     a request the server refused as a whole (the session ended, the request is not acceptable) is not
//                repeated: the caller hears about it
import type { Op } from '../diff';
import type { ApplyResult, ServerPatch, SyncFn } from '../gateway';
import { post, isTransient, sessionEnded, type Fail } from './http';
import { setSyncStatus } from './status';
import { SessionEnded, SyncCancelled, newKey, track, untrack, clearInFlight, type Batch } from './carry';

const MAX_OPS = 400;                 // the server takes 500 per request
const MAX_BYTES = 700 * 1024;        // the server takes 1 MB per request
const WAITS_MS = [2000, 5000, 10000, 30000];

/** Thrown when the server refused a whole request for a reason a retry does not change. `code` is the server's. */
export class SyncRefused extends Error { constructor(public code: string) { super(code); this.name = 'SyncRefused'; } }

let epoch = 0;
/** Stops every waiting retry: the workspace closed. Requests already answered are unaffected. */
export function stopSync(): void { epoch += 1; clearInFlight(); wake?.(); }

let wake: (() => void) | null = null;
/** Waits, and returns early when the browser reports a connection again or the workspace closes. */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); window.removeEventListener('online', done); wake = null; resolve(); };
    const timer = setTimeout(done, ms);
    window.addEventListener('online', done);
    wake = done;
  });
}
/** Lets the person try now instead of waiting for the next attempt (the indicator's "try again"). */
export function retryNow(): void { wake?.(); }

const size = (op: Op): number => JSON.stringify(op).length;
/** Cuts a change list into requests, keeping its order. */
export function batchesOf(ops: Op[]): Batch[] {
  const out: Batch[] = []; let cur: Op[] = []; let bytes = 0;
  for (const op of ops) {
    const n = size(op);
    if (cur.length && (cur.length >= MAX_OPS || bytes + n > MAX_BYTES)) { out.push({ ops: cur, idem: newKey() }); cur = []; bytes = 0; }
    cur.push(op); bytes += n;
  }
  if (cur.length) out.push({ ops: cur, idem: newKey() });
  return out;
}

const first = <T,>(v: unknown): T | undefined => (Array.isArray(v) ? v[0] as T : v as T | undefined);
/**
 * The server lists what it stored differently per collection, single parts included, each as a list.
 * The store wants the single parts as the records they are, and the automation history under its collection name.
 */
export function normalisePatch(server: unknown): ServerPatch {
  const out: Record<string, unknown> = {};
  if (!server || typeof server !== 'object') return out as ServerPatch;
  for (const [key, value] of Object.entries(server as Record<string, unknown>)) {
    if (key === 'company' || key === 'config' || key === 'settings' || key === 'automation') { const v = first<object>(value); if (v && typeof v === 'object') out[key] = v; }
    else if (key === 'readNotifications') { const v = Array.isArray(value) && Array.isArray(value[0]) ? value[0] : value; if (Array.isArray(v)) out[key] = v; }
    else if (Array.isArray(value)) out[key] = value.filter((r) => r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string');
  }
  return out as ServerPatch;
}
function merge(into: ApplyResult, next: ApplyResult): void {
  into.ok = into.ok && next.ok;
  into.applied += next.applied;
  into.rejected.push(...next.rejected);
  if (next.replayed) into.replayed = true;
  const s = (into.server ??= {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(next.server ?? {})) s[k] = Array.isArray(v) && Array.isArray(s[k]) && k !== 'readNotifications' ? [...(s[k] as unknown[]), ...v] : v;
  const ver = (into.versions ??= {});
  for (const [c, rows] of Object.entries(next.versions ?? {})) ver[c] = { ...(ver[c] ?? {}), ...rows };
}
type RawAnswer = { ok?: boolean; applied?: number; rejected?: ApplyResult['rejected']; server?: unknown; versions?: ApplyResult['versions']; replayed?: boolean };
const shaped = (raw: RawAnswer): ApplyResult => ({
  ok: raw.ok !== false, applied: Number(raw.applied) || 0, rejected: Array.isArray(raw.rejected) ? raw.rejected : [],
  server: normalisePatch(raw.server), versions: raw.versions ?? {}, replayed: raw.replayed === true,
});
/** The gateway's own answer arrives as the body, with `ok: false` when it refused any row: that is still an answer. */
const answered = (a: Fail): RawAnswer | null => (a.status === 200 && Array.isArray(a.data.rejected) ? a.data as RawAnswer : null);

/** One request, repeated with the same key until the server answers it. */
async function deliver(tenantId: string, batch: Batch, started: number, forever: boolean): Promise<ApplyResult> {
  for (let attempt = 0; ; attempt++) {
    if (started !== epoch) throw new SyncCancelled();
    const a = await post<RawAnswer>('/api/ws/apply', { tenant: tenantId, ops: batch.ops, idem: batch.idem }, { stepUp: false, session: true, timeoutMs: 45000 });
    if (started !== epoch) throw new SyncCancelled();
    if (a.ok) return shaped(a.data);
    const body = answered(a);
    if (body) return shaped(body);
    if (sessionEnded(a.code) || a.code === 'mfa_required') throw new SessionEnded(a.code);
    if (!isTransient(a) || (!forever && attempt >= 2)) throw new SyncRefused(a.code);
    setSyncStatus({ state: 'offline' });
    await pause(WAITS_MS[Math.min(attempt, WAITS_MS.length - 1)]);
  }
}

/**
 * A request the server would not take because of its size, although it was cut to fit: one very large row.
 * It was never applied (the size is checked before the database sees it), so each half can go again under a new key,
 * and a single row that is too large by itself comes back as refused.
 */
async function deliverSplit(tenantId: string, batch: Batch, started: number): Promise<ApplyResult> {
  try { return await deliver(tenantId, batch, started, true); } catch (e) {
    if (!(e instanceof SyncRefused) || e.code !== 'too_large') throw e;
    if (batch.ops.length === 1) return { ok: false, applied: 0, rejected: [{ c: batch.ops[0].c, id: batch.ops[0].id, reason: 'too_large' }] };
    const half = Math.ceil(batch.ops.length / 2);
    const out = await deliverSplit(tenantId, { ops: batch.ops.slice(0, half), idem: newKey() }, started);
    merge(out, await deliverSplit(tenantId, { ops: batch.ops.slice(half), idem: newKey() }, started));
    return out;
  }
}

/** Sends requests one after the other, each until it is answered. Resolves with the answers put together. */
export async function send(tenantId: string, batches: Batch[]): Promise<ApplyResult> {
  const started = epoch;
  batches.forEach(track);
  const total: ApplyResult = { ok: true, applied: 0, rejected: [], server: {}, versions: {} };
  try {
    for (const b of batches) {
      setSyncStatus({ state: 'saving' });
      merge(total, await deliverSplit(tenantId, b, started));
      untrack(b);
    }
    return total;
  } catch (e) {
    // a request the server refused outright will not be sent again; one cut short by the session ending stays listed
    // so it can be sent after the person signs in again
    if (!(e instanceof SessionEnded)) batches.forEach(untrack);
    throw e;
  }
}
/** The function the store calls after a change. Resolves when every operation was answered. */
export const makeSync = (tenantId: string): SyncFn => (ops) => send(tenantId, batchesOf(ops));
/** One request list under a key the caller chose, when it fits one request; otherwise cut up with keys of its own. */
export const applyWithKey = (tenantId: string, ops: Op[], idem?: string): Promise<ApplyResult> =>
  send(tenantId, idem && ops.length <= MAX_OPS && JSON.stringify(ops).length <= MAX_BYTES ? [{ ops, idem }] : batchesOf(ops));

/**
 * Sends what was held when a session ended (src/platform/live/carry.ts), with the keys it already had. A few attempts
 * only: the person is waiting for the workspace to open. Returns what was applied and refused, and what could not be sent.
 */
export async function sendHeld(tenantId: string, batches: Batch[]): Promise<{ result: ApplyResult; unsent: Batch[] }> {
  const total: ApplyResult = { ok: true, applied: 0, rejected: [], server: {}, versions: {} };
  const started = epoch;
  for (let i = 0; i < batches.length; i++) {
    try { merge(total, await deliver(tenantId, batches[i], started, false)); } catch { return { result: total, unsent: batches.slice(i) }; }
  }
  return { result: total, unsent: [] };
}
