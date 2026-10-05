// What each kind of background job does. Imported by api/cron.js (and by the tests), which is what registers them.
//
// To add a kind: write the handler in its own file in this folder and register it here. To add something that should
// simply happen on every scheduled run (reminders, recurring engagements), push a function onto hooks.tick or
// hooks.daily: it receives { enqueue } and should queue jobs rather than do long work itself.
import { register, enqueue, JobError } from '../jobs.js';
import { serviceRpc } from '../supabase.js';
import { getAdapter } from '../integrations/providers/index.js';
import { connectionCtx, refreshTokens, runSync, makeCtx } from '../integrations/core.js';
import * as store from '../integrations/store.js';
import { ProviderError } from '../integrations/oauth.js';
import { sendSystemEmail, alertEmail } from '../mail.js';
import { log } from '../respond.js';
import { env } from '../env.js';
import { deliverJob, queueWaiting } from '../pipeline/deliver.js';
import { summaryEmail } from '../pipeline/summary.js';

export const hooks = { tick: [], daily: [] };

const providerFailure = (e, fallback) => new JobError(e instanceof ProviderError ? e.code : fallback, { permanent: e instanceof ProviderError && (e.reauth || e.code === 'not_connected') });

async function adapterFor(job) {
  const adapter = await getAdapter(String(job.payload?.provider || ''));
  if (!adapter) throw new JobError('unknown_provider', { permanent: true });
  if (!job.tenant_id) throw new JobError('no_company', { permanent: true });
  return adapter;
}

/** Exchanges a connection's refresh token before the access token runs out. */
register('integration.refresh', async (job) => {
  const adapter = await adapterFor(job);
  const row = await store.getRow(job.tenant_id, adapter.id);
  if (!row || !row.token_enc) return;
  const tokens = await store.tokensOf(row);
  if (!tokens) throw new JobError('token_unreadable', { permanent: true });
  try { await refreshTokens(adapter, job.tenant_id, tokens); } catch (e) { throw providerFailure(e, 'refresh_failed'); }
});

/** Pulls changes from a provider for one company. */
register('integration.sync', async (job) => {
  const adapter = await adapterFor(job);
  try { await runSync(adapter, job.tenant_id, String(job.payload?.what || 'all')); } catch (e) { throw providerFailure(e, 'sync_failed'); }
});

/** Acts on a webhook event that already passed the signature check and was logged. */
register('webhook.process', async (job) => {
  const id = String(job.payload?.event || '');
  const r = await serviceRpc('webhook_get', { p_id: id });
  if (!r.ok) throw new JobError('event_unavailable');
  const event = r.data;
  if (!event) throw new JobError('event_missing', { permanent: true });
  if (event.status === 'processed' || event.status === 'ignored') return;
  const adapter = await getAdapter(event.provider);
  if (!adapter || !adapter.webhook) { await serviceRpc('webhook_mark', { p_id: id, p_status: 'ignored', p_error: 'no_handler' }); return; }
  try {
    let ctx = makeCtx(adapter, { tenantId: event.tenant_id });
    // An adapter that needs the provider's API to act on the event gets a context with working tokens.
    if (event.tenant_id && adapter.kind === 'oauth') { try { ctx = await connectionCtx(adapter, event.tenant_id); } catch { /* handled below by the adapter */ } }
    const out = await adapter.webhook.handle(ctx, event);
    await serviceRpc('webhook_mark', { p_id: id, p_status: out && out.ignored ? 'ignored' : 'processed', p_error: null });
  } catch (e) {
    const failure = providerFailure(e, 'processing_failed');
    await serviceRpc('webhook_mark', { p_id: id, p_status: 'failed', p_error: failure.code });
    throw failure;
  }
});

/** Removes rows that have no further use (past counters, used states, expired keys, old gateway request keys). */
register('maintenance.sweep', async () => {
  const r = await serviceRpc('server_sweep', {});
  if (!r.ok) throw new JobError('sweep_failed');
  // The gateway range keeps its own idempotency keys and offers this cleanup. Absent on a database without that range.
  const g = await serviceRpc('ws_purge_requests', { p_days: 7 });
  if (!g.ok && g.status !== 404) log('jobs', 'gateway_sweep_skipped', { status: g.status });
});

/** Tells a company's owners when recent security events crossed a line (many failed sign-ins, a lockout, a role change). */
register('security.alerts', async (job) => {
  const minutes = 60;
  const r = await serviceRpc('security_alerts_due', { p_minutes: minutes });
  if (!r.ok) throw new JobError('alerts_unavailable');
  const hour = new Date().toISOString().slice(0, 13);
  for (const a of r.data || []) {
    const owners = Array.isArray(a.owners) ? a.owners.filter((x) => typeof x === 'string' && x.includes('@')) : [];
    if (!owners.length) continue;
    const mail = alertEmail({ kind: a.kind, count: a.count, minutes });
    // One notice per company, kind and hour, however often this job runs.
    await sendSystemEmail({ to: owners, subject: mail.subject, text: mail.text, tenant: a.tenant_id, idem: `alert:${a.tenant_id}:${a.kind}:${hour}` });
  }
  void job;
});

/** Queues what a scheduled "tick" should start: token refreshes that are due, the hourly security notice, then whatever the hooks add. */
export async function onTick() {
  const due = await serviceRpc('conn_due_refresh', { p_within_seconds: 900, p_limit: 50 });
  const bucket = Math.floor(Date.now() / 600000);
  let queued = 0;
  for (const c of due.ok ? due.data || [] : []) {
    if (await enqueue('integration.refresh', { provider: c.provider }, { tenant: c.tenant_id, idem: `${c.tenant_id}:${c.provider}:${bucket}` })) queued += 1;
  }
  // The security notice looks at the last hour, so it is queued once an hour (the key makes it once, however often this runs).
  await enqueue('security.alerts', {}, { idem: 'alerts:' + new Date().toISOString().slice(0, 13), maxAttempts: 2 });
  for (const hook of hooks.tick) await hook({ enqueue });
  return { refreshQueued: queued };
}

/** Queues the once-a-day work: housekeeping, a sync of every connected provider, the daily hooks. */
export async function onDaily() {
  const day = new Date().toISOString().slice(0, 10);
  await enqueue('maintenance.sweep', {}, { idem: 'sweep:' + day, maxAttempts: 3 });
  const conns = await serviceRpc('conn_connected', { p_limit: 500 });
  let queued = 0;
  for (const c of conns.ok ? conns.data || [] : []) {
    if (await enqueue('integration.sync', { provider: c.provider, what: 'all' }, { tenant: c.tenant_id, idem: `${c.tenant_id}:${c.provider}:${day}` })) queued += 1;
  }
  for (const hook of hooks.daily) await hook({ enqueue });
  return { syncQueued: queued };
}

// ---------------------------------------------------------------------------------------------------------------------
// Public endpoints and server-side workflows (round three): outgoing messages, signature requests, the daily passes.
// The signing code loads the bundled domain rules, which are large, so it is imported only when one of its jobs runs.
// ---------------------------------------------------------------------------------------------------------------------

/** True when the database function is not installed: a database that stops before this range (the isolated test set). */
const absent = (r) => r.status === 404 || r.sqlstate === '42883' || r.sqlstate === 'PGRST202';

/** Hands one queued message to its provider (api/_lib/pipeline/deliver.js). */
register('messages.deliver', deliverJob);

/** A signer's email that could not be sent at once. The payload is sealed: no link token or address sits in the queue. */
register('esign.notify', async (job) => {
  const { openNotice, sendNotice } = await import('../esign/emails.js');
  const n = openNotice(job.payload?.sealed);
  if (!n) throw new JobError('payload_unreadable', { permanent: true });
  const sent = await sendNotice(n, env('APP_ORIGIN').replace(/\/+$/, ''));
  if (!sent.delivered) throw new JobError(sent.reason || 'send_failed', { permanent: sent.reason === 'not_configured' || sent.reason === 'recipient_invalid' });
});

/** The signed copy of a completed request, when it could not be made while the last signer waited. */
register('esign.finalize', async (job) => {
  const { finalize } = await import('../esign/signing.js');
  const out = await finalize(job.tenant_id, String(job.payload?.envelope || ''));
  if (out === 'failed') throw new JobError('signed_copy_failed');
});

/** Once a day: expire the requests whose time is up, remind where a reminder is due, make signed copies still missing. */
register('esign.sweep', async () => {
  const { sweepAll } = await import('../esign/send.js');
  await sweepAll();
});

/** Releases appointments that were not paid by their deadline (the database function of 0033 does the work and the audit). */
register('appointments.sweep', async () => {
  const r = await serviceRpc('appt_release_unpaid', { p_limit: 200 });
  if (!r.ok && !absent(r)) throw new JobError('sweep_failed');
});

/** Closes approvals to reveal protected data that were not used in time (0034). */
register('vault.expire', async () => {
  const r = await serviceRpc('vault_expire', {});
  if (!r.ok && !absent(r)) throw new JobError('sweep_failed');
});

/** Removes links that stopped working long ago. Rate limit counters and idempotency keys are purged by maintenance.sweep. */
register('public.purge', async () => {
  const r = await serviceRpc('public_links_purge', { p_days: 90 });
  if (!r.ok && !absent(r)) throw new JobError('sweep_failed');
});

/** The daily note to a company's owners: counts from its records. No client is named, in the subject or anywhere else. */
register('owner.summary', async () => {
  const r = await serviceRpc('owner_summary_due', { p_limit: 500 });
  if (!r.ok && absent(r)) return;
  if (!r.ok) throw new JobError('summary_unavailable');
  const day = new Date().toISOString().slice(0, 10);
  for (const t of r.data || []) {
    const owners = Array.isArray(t.owners) ? t.owners.filter((x) => typeof x === 'string' && x.includes('@')) : [];
    const mail = summaryEmail(t.counts || {});
    // a day with nothing to report sends nothing
    if (!owners.length || !mail) continue;
    await sendSystemEmail({ to: owners, subject: mail.subject, text: mail.text, tenant: t.tenantId, idem: `summary:${t.tenantId}:${day}` });
  }
});

hooks.tick.push(async ({ enqueue: q }) => {
  await queueWaiting(q);
  // unpaid appointments are released within ten minutes of their deadline
  await q('appointments.sweep', {}, { idem: 'appt:' + Math.floor(Date.now() / 600000), maxAttempts: 2 });
});
hooks.daily.push(async ({ enqueue: q }) => {
  const day = new Date().toISOString().slice(0, 10);
  await q('esign.sweep', {}, { idem: 'esign.sweep:' + day, maxAttempts: 3 });
  await q('vault.expire', {}, { idem: 'vault:' + day, maxAttempts: 3 });
  await q('public.purge', {}, { idem: 'purge:' + day, maxAttempts: 3 });
  await q('owner.summary', {}, { idem: 'summary:' + day, maxAttempts: 2 });
});

// ---------------------------------------------------------------------------------------------------------------------
// PROVIDER JOBS: registration lines from the provider engineers go below this line, one block per provider.
// Keep each block to: the import of the provider's job file, its register(...) calls, and its hooks.tick / hooks.daily
// pushes. Nothing above this line needs to change for a new provider.
// ---------------------------------------------------------------------------------------------------------------------

// Google: mailbox and calendar syncs, push notice renewal, token refresh (api/_lib/jobs/google.js).
import { registerGoogleJobs, googleTick, googleDaily } from './google.js';
registerGoogleJobs(register);
hooks.tick.push(({ enqueue: q }) => googleTick({ enqueue: q }));
hooks.daily.push(({ enqueue: q }) => googleDaily({ enqueue: q }));

// Square and QuickBooks: pushes to the books, and the hourly payment check (api/_lib/jobs/finance.js).
import { registerFinance } from './finance.js';
registerFinance({ register, hooks });

// Messaging: queued outgoing messages, scheduled posts, renewal of Meta's tokens (api/_lib/jobs/messaging.js).
// Its job kinds register themselves when the file is imported.
// One sender per message: queued texts, WhatsApp, Facebook and Instagram messages go out through the pipeline above
// ("messages.deliver"), which fills in the link of a review request and checks consent from the client's record
// before the adapter checks the number's. The messaging file's own "messaging.send" job would pick up the same
// queued rows, so its tick is not allowed to queue them here; the job kind stays registered for a direct call.
import { messagingTick, messagingDaily } from './messaging.js';
hooks.tick.push(({ enqueue: q }) => messagingTick({ enqueue: (kind, ...rest) => (kind === 'messaging.send' ? false : q(kind, ...rest)) }));
hooks.daily.push(messagingDaily);
