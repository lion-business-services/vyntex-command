// Where normalized messages go: the company's own records (public.messages), through one server-only database
// function, messaging_ingest (its SQL is in docs/integrations/messaging.md until the migration is added).
//
// Why this exists next to the webhook log: the webhook log keeps a redacted copy only (no message text, no phone
// numbers). Some providers (WhatsApp, Twilio, Dialpad text messages) deliver the text in the webhook and offer no
// way to fetch it again by id. For those, the text must be stored in the company's records while the request is
// still in hand, or it is lost. So the adapter's webhook.inbound() returns the normalized messages, and
// ingestInbound() below stores them before the webhook is answered. Storing is repeatable: the provider's message id
// is unique per company and provider, so a provider sending the same webhook twice adds nothing.
import { serviceRpc } from '../../supabase.js';
import { ProviderError } from '../oauth.js';

const MAX_ITEMS = 200;

/** Stores one company's batch: { messages: [{ message, match, extra }], statuses: [...], consent: [...] }. */
export async function ingest(tenantId, provider, batch, { rpc = serviceRpc } = {}) {
  const b = { messages: (batch.messages || []).slice(0, MAX_ITEMS), statuses: (batch.statuses || []).slice(0, MAX_ITEMS), consent: (batch.consent || []).slice(0, MAX_ITEMS) };
  if (!b.messages.length && !b.statuses.length && !b.consent.length) return { ok: true, stored: 0 };
  if (!tenantId) throw new ProviderError('no_company');
  const r = await rpc('messaging_ingest', { p_tenant: tenantId, p_provider: provider, p_batch: b });
  // 404: the database function is not installed yet. Said as it is, so the job or the webhook is tried again later.
  if (!r.ok) throw new ProviderError(r.status === 404 ? 'ingest_not_installed' : 'ingest_unavailable');
  return { ok: true, stored: b.messages.length + b.statuses.length + b.consent.length, result: r.data || null };
}

/**
 * Called by api/webhooks.js after the signature passed and before the event is recorded.
 * `known` is the company the webhook already resolved (may be null). An adapter's inbound() answers with one entry
 * per provider account, because one webhook can carry messages for more than one connected account.
 * Returns { ok, stored } and never throws: on { ok: false } the webhook must answer with an error so the provider
 * sends it again.
 */
export async function ingestInbound(adapter, { request, raw, tenant: known = null, ctx, rpc = serviceRpc }) {
  if (!adapter.webhook || typeof adapter.webhook.inbound !== 'function') return { ok: true, stored: 0 };
  let groups;
  try { groups = await adapter.webhook.inbound(request, raw, ctx); } catch { return { ok: false, reason: 'bad_payload' }; }
  let stored = 0; let skipped = 0;
  for (const g of Array.isArray(groups) ? groups : []) {
    let tenant = g.tenantId || null;
    if (!tenant && g.accountRef) {
      const c = await rpc('conn_by_account', { p_provider: adapter.id, p_account_ref: g.accountRef });
      if (!c.ok) return { ok: false, reason: 'unavailable' };
      tenant = c.data ? c.data.tenant_id : null;
    }
    tenant = tenant || known;
    // No connected company for this account: nothing can be stored, and sending it again would not change that.
    if (!tenant) { skipped += 1; continue; }
    try { stored += (await ingest(tenant, adapter.id, g, { rpc })).stored; } catch (e) { return { ok: false, reason: e instanceof ProviderError ? e.code : 'unavailable' }; }
  }
  return { ok: true, stored, skipped };
}
