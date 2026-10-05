// Background work for the payment and accounting connections (Square, QuickBooks Online).
//
//   finance.push     sends one approved record to the accounting system: { provider, action, id } where action is
//                    one of the adapter's push actions. Queued when a person approves it, never on a timer, so
//                    nothing reaches the books that nobody asked for. A result that needs a person (a conflict, a
//                    missing link, a missing approval) stops the job at once instead of retrying into the same wall.
//   tick hook        once an hour, for every company connected to Square: the payments since the last run go
//                    through the reconciliation rules again. This is the net under the webhooks; a payment that
//                    was already recorded is a duplicate and changes nothing.
//
// Registered from api/_lib/jobs/handlers.js with: registerFinance({ register, hooks });
import { JobError } from '../jobs.js';
import { serviceRpc } from '../supabase.js';
import { getAdapter } from '../integrations/providers/index.js';
import { connectionCtx } from '../integrations/core.js';
import { ProviderError } from '../integrations/oauth.js';
import { log } from '../respond.js';

/** The push actions a job may run, by provider. Anything else in a payload is refused. */
export const PUSH_ACTIONS = { quickbooks: ['createCustomer', 'pushInvoice', 'pushPayment'] };
const ARG = { createCustomer: 'clientId', pushInvoice: 'jobId', pushPayment: 'paymentId' };

/** Codes that mean "a person has to look": retrying cannot help. */
export const NEEDS_PERSON = new Set(['sync_conflict', 'approval_required', 'customer_not_linked', 'item_not_mapped', 'invoice_not_pushed', 'duplicate_name', 'duplicate_document',
  'not_found', 'nothing_due', 'invalid_request', 'not_connected', 'realm_missing', 'environment_invalid', 'finance_not_installed']);

export async function runPush(job, { adapterOf = getAdapter, ctxOf = connectionCtx } = {}) {
  const provider = String(job.payload?.provider || '');
  const action = String(job.payload?.action || '');
  if (!job.tenant_id) throw new JobError('no_company', { permanent: true });
  if (!(PUSH_ACTIONS[provider] || []).includes(action)) throw new JobError('unknown_action', { permanent: true });
  const adapter = await adapterOf(provider);
  if (!adapter || !adapter.actions || typeof adapter.actions[action] !== 'function') throw new JobError('unknown_provider', { permanent: true });
  try {
    const ctx = await ctxOf(adapter, job.tenant_id);
    const out = await adapter.actions[action](ctx, { [ARG[action]]: String(job.payload?.id || '') });
    log('finance', 'push_done', { provider, action, outcome: String(out?.outcome || 'ok') });
    return out;
  } catch (e) {
    const code = e instanceof ProviderError ? e.code : 'push_failed';
    throw new JobError(code, { permanent: (e instanceof ProviderError && e.reauth) || NEEDS_PERSON.has(code) });
  }
}

/** Queues the hourly payment check for every company connected to Square. One job per company and hour. */
export async function financeTick({ enqueue }, { rpc = serviceRpc, now = Date.now() } = {}) {
  const conns = await rpc('conn_connected', { p_limit: 500 });
  const hour = new Date(now).toISOString().slice(0, 13);
  let queued = 0;
  for (const c of conns.ok ? conns.data || [] : []) {
    if (c.provider !== 'square') continue;
    if (await enqueue('integration.sync', { provider: 'square', what: 'payments' }, { tenant: c.tenant_id, idem: `${c.tenant_id}:square:payments:${hour}` })) queued += 1;
  }
  return queued;
}

export function registerFinance({ register, hooks }) {
  register('finance.push', (job) => runPush(job));
  hooks.tick.push((tools) => financeTick(tools));
}
