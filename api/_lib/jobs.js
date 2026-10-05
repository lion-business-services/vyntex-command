// Background jobs: the server side of the queue in supabase/migrations/0025.
// A job is a row with a kind and a small payload. /api/cron/tick claims due jobs one at a time, runs the handler
// registered for the kind, and reports back. The database gives the guarantees:
//   lock         a claimed job belongs to one runner until it finishes or its lock time passes
//   retry        a failed job returns to the queue with a growing wait (30 s, 1 min, 2 min ... up to an hour)
//   dead letter  after its last attempt, or on a failure the handler marks as permanent, the job stops as "dead"
//   idempotency  the same (kind, idempotency key) is queued once
// Handlers must be safe to run twice: a runner can die after doing the work and before saying so.
//
// The service role is used throughout: jobs run from a scheduled call, with nobody signed in.
import { randomUUID } from 'node:crypto';
import { serviceRpc } from './supabase.js';
import { log } from './respond.js';

const handlers = new Map();

/** A failure a handler raises on purpose. `permanent` skips the remaining attempts. The code is what gets stored. */
export class JobError extends Error {
  constructor(code, { permanent = false } = {}) {
    super(code);
    this.code = /^[a-z][a-z0-9_.]{1,60}$/.test(code) ? code : 'failed';
    this.permanent = permanent;
  }
}

/** Registers the handler for a kind: async (job) => void. job = { id, tenant_id, kind, payload, attempts, max_attempts }. */
export function register(kind, handler) {
  handlers.set(kind, handler);
}
export const registeredKinds = () => [...handlers.keys()];

/** Queues a job. Returns its id, or null when the queue could not be reached. */
export async function enqueue(kind, payload = {}, { tenant = null, runAt = null, idem = null, maxAttempts = 5 } = {}) {
  const r = await serviceRpc('job_enqueue', {
    p_kind: kind, p_payload: payload, p_run_at: runAt ? new Date(runAt).toISOString() : null,
    p_tenant: tenant, p_idem: idem, p_max_attempts: maxAttempts,
  });
  if (!r.ok) { log('jobs', 'enqueue_failed', { kind, status: r.status }); return null; }
  return r.data;
}

/**
 * Runs due jobs until none is left, `max` were run, or the time budget is used up. One job is claimed at a time, so
 * a job is never taken and then left waiting behind a slow one.
 */
export async function runDue({ max = 25, budgetMs = 20000, lockSeconds = 120, worker = 'cron-' + randomUUID().slice(0, 8) } = {}) {
  const started = Date.now();
  const out = { claimed: 0, done: 0, retried: 0, dead: 0, worker };
  while (out.claimed < max && Date.now() - started < budgetMs) {
    const c = await serviceRpc('job_claim', { p_worker: worker, p_limit: 1, p_lock_seconds: lockSeconds });
    if (!c.ok) { log('jobs', 'claim_failed', { status: c.status }); out.error = 'queue_unavailable'; break; }
    const job = Array.isArray(c.data) ? c.data[0] : null;
    if (!job) break;
    out.claimed += 1;
    const handler = handlers.get(job.kind);
    let failure = null;
    if (!handler) failure = new JobError('unknown_kind', { permanent: true });
    else {
      try { await handler(job); } catch (e) {
        failure = e instanceof JobError ? e : new JobError('handler_error');
        if (!(e instanceof JobError)) log('jobs', 'handler_threw', { kind: job.kind, name: e && e.name ? String(e.name).slice(0, 40) : 'Error' });
      }
    }
    if (!failure) {
      const f = await serviceRpc('job_finish', { p_id: job.id, p_worker: worker });
      if (f.ok && f.data === true) out.done += 1; else log('jobs', 'finish_not_recorded', { kind: job.kind });
      continue;
    }
    const f = await serviceRpc('job_fail', { p_id: job.id, p_worker: worker, p_error: failure.code, p_base_seconds: failure.permanent ? -1 : 30 });
    if (f.ok && f.data && f.data.status === 'dead') { out.dead += 1; log('jobs', 'dead_letter', { kind: job.kind, error: failure.code }); }
    else out.retried += 1;
  }
  return out;
}
