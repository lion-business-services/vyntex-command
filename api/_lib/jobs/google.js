// Background work for the Google connections (Gmail, Calendar, Meet, Business Profile).
//   google.refresh          exchange a refresh token before the access token runs out
//   google.gmail.sync       read what is new in the connected mailbox (history id)
//   google.gmail.watch      renew Gmail's push notices (they last 7 days)
//   google.calendar.sync    read what changed in the calendar (sync token; a 410 starts over)
//   google.calendar.watch   renew the Calendar watch channel
//
// Every handler is safe to run twice: the adapters hand over each change once (by its provider id) and move their
// position only after the hand over. When Google says "slow down" with a wait time, the job is queued again for that
// moment instead of being retried on the queue's own shorter schedule.
//
// Registration (api/_lib/jobs/handlers.js, three lines):
//   import { registerGoogleJobs, googleTick, googleDaily } from './google.js';
//   registerGoogleJobs();
//   hooks.tick.push(googleTick); hooks.daily.push(googleDaily);
import { register, enqueue, JobError } from '../jobs.js';
import { serviceRpc } from '../supabase.js';
import { ProviderError } from '../integrations/oauth.js';
import { runSync, refreshTokens } from '../integrations/core.js';
import * as store from '../integrations/store.js';
import gmail from '../integrations/providers/gmail.js';
import gcal from '../integrations/providers/gcal.js';
import gbp from '../integrations/providers/gbp.js';

const ADAPTERS = { gmail, gcal, gbp };
export const GOOGLE_JOBS = {
  'google.gmail.sync': { adapter: 'gmail', what: 'inbox' },
  'google.gmail.watch': { adapter: 'gmail', what: 'watch' },
  'google.calendar.sync': { adapter: 'gcal', what: 'events' },
  'google.calendar.watch': { adapter: 'gcal', what: 'watch' },
};
const POLL_MINUTES = 15;

const defaults = { runSync, refreshTokens, store, enqueue, now: () => Date.now() };

/** Meet has no tokens of its own. When Calendar needs the person again, Meet's card must stop saying "connected". */
async function markMeet(deps, tenantId, reason) {
  const row = await deps.store.getRow(tenantId, 'gmeet');
  if (row && row.state === 'connected') await deps.store.putRow(tenantId, 'gmeet', { state: 'attention', reason, last_error: reason, health: 'down' });
}

/**
 * Turns an adapter failure into what the queue should do. Rate limited with a wait: queue the same work for later and
 * finish this job. Needs the person again, or nothing connected: stop for good. Anything else: retry with backoff.
 */
async function settle(deps, job, e) {
  const err = e instanceof ProviderError ? e : null;
  if (err && err.code === 'rate_limited' && Number(err.retryAfter) > 0) {
    const at = deps.now() + Math.min(3600, Number(err.retryAfter)) * 1000;
    // One follow up per company, kind and minute it is due: several rate limited runs do not pile up.
    await deps.enqueue(job.kind, job.payload || {}, { tenant: job.tenant_id, runAt: at, idem: `${job.tenant_id}:${job.kind}:after:${Math.floor(at / 60000)}` });
    return { deferred: true, retryAfter: Number(err.retryAfter) };
  }
  if (err && err.reauth && (job.kind.startsWith('google.calendar') || job.payload?.provider === 'gcal')) await markMeet(deps, job.tenant_id, 'calendar_reauth');
  throw new JobError(err ? err.code : 'google_job_failed', { permanent: !!err && (err.reauth || err.code === 'not_connected') });
}

/** One sync or watch job. Exported for the tests, which pass their own `deps`. */
export async function runGoogleJob(job, deps = defaults) {
  const spec = GOOGLE_JOBS[job.kind];
  if (!spec) throw new JobError('unknown_kind', { permanent: true });
  if (!job.tenant_id) throw new JobError('no_company', { permanent: true });
  try {
    return await deps.runSync(ADAPTERS[spec.adapter], job.tenant_id, spec.what);
  } catch (e) {
    return settle(deps, job, e);
  }
}

/** Refreshes one Google connection. payload: { provider: 'gmail' | 'gcal' | 'gbp' }. */
export async function runGoogleRefresh(job, deps = defaults) {
  const adapter = ADAPTERS[String(job.payload?.provider || '')];
  if (!adapter) throw new JobError('unknown_provider', { permanent: true });
  if (!job.tenant_id) throw new JobError('no_company', { permanent: true });
  const row = await deps.store.getRow(job.tenant_id, adapter.id);
  if (!row || !row.token_enc) return { skipped: 'not_connected' };
  const tokens = await deps.store.tokensOf(row);
  if (!tokens) throw new JobError('token_unreadable', { permanent: true });
  try {
    await deps.refreshTokens(adapter, job.tenant_id, tokens);
    return { refreshed: true };
  } catch (e) {
    return settle(deps, job, e);
  }
}

export function registerGoogleJobs(reg = register) {
  for (const kind of Object.keys(GOOGLE_JOBS)) reg(kind, (job) => runGoogleJob(job));
  reg('google.refresh', (job) => runGoogleRefresh(job));
}

async function connected(limit = 500) {
  const r = await serviceRpc('conn_connected', { p_limit: limit });
  return (r.ok ? r.data || [] : []).filter((c) => c.provider === 'gmail' || c.provider === 'gcal');
}

/**
 * Every scheduled run: a sync of each connected mailbox and calendar, at most once per quarter of an hour. Push
 * notices make this faster when they are set up; this is what keeps things right when a notice is lost or push is off.
 */
export async function googleTick({ enqueue: queue = enqueue, list = connected, now = Date.now() } = {}) {
  const bucket = Math.floor(now / (POLL_MINUTES * 60000));
  let queued = 0;
  for (const c of await list()) {
    const kind = c.provider === 'gmail' ? 'google.gmail.sync' : 'google.calendar.sync';
    if (await queue(kind, {}, { tenant: c.tenant_id, idem: `${c.tenant_id}:${kind}:${bucket}` })) queued += 1;
  }
  return { queued };
}

/** Once a day: renew push notices that are close to their end (the adapters skip the ones that still have time). */
export async function googleDaily({ enqueue: queue = enqueue, list = connected, now = Date.now() } = {}) {
  const day = new Date(now).toISOString().slice(0, 10);
  let queued = 0;
  for (const c of await list()) {
    const kind = c.provider === 'gmail' ? 'google.gmail.watch' : 'google.calendar.watch';
    if (await queue(kind, {}, { tenant: c.tenant_id, idem: `${c.tenant_id}:${kind}:${day}` })) queued += 1;
  }
  return { queued };
}
