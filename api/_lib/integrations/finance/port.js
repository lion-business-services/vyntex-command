// The finance store, backed by the database: thin calls to the server-only functions of the finance migration
// (fin_*). The adapters never write a table. Every rule that must hold whatever the caller does (a payment recorded
// once, totals in exact cents, a link that fills an empty slot and never replaces a value) is enforced inside those
// functions, in one transaction each. memory.js is the same interface without a database.
//
// Service role: payments and webhooks arrive with nobody signed in, and a person must not be able to write a
// provider payment by hand. What a person does (assigning an unmatched payment) has its own function that checks them.
import { serviceRpc } from '../../supabase.js';
import { ProviderError } from '../oauth.js';

async function rpc(name, args) {
  const r = await serviceRpc(name, args);
  // 404: the finance migration is not installed on this database yet. Said as it is, never papered over.
  if (!r.ok) throw new ProviderError(r.status === 404 ? 'finance_not_installed' : 'store_unavailable');
  return r.data;
}
const ctxView = (c) => (c ? { kind: c.kind, id: c.id, clientId: c.client_id || null, dueCents: Number(c.due_cents), paidCents: Number(c.paid_cents), open: !!c.open, currency: c.currency || undefined } : null);

export function dbFinance(tenantId) {
  const t = { p_tenant: tenantId };
  return {
    async clients(provider) { return ((await rpc('fin_clients', { ...t, p_provider: provider })) || []).map((c) => ({ id: c.id, name: c.name || '', email: c.email || '', phone: c.phone || '', externalId: c.external_id || null })); },
    async services(provider) {
      return ((await rpc('fin_services', { ...t, p_provider: provider })) || []).map((s) => ({ id: s.id, name: s.name, active: !!s.active, externalId: s.external_id || null,
        tiers: (s.tiers || []).map((x) => ({ id: x.id, name: x.name, priceCents: Number(x.price_cents), externalId: x.external_id || null })) }));
    },
    async linkPut(l) {
      return rpc('fin_link_put', { ...t, p_provider: l.provider, p_kind: l.kind, p_external_id: l.externalId, p_local_id: l.localId || null, p_state: l.state, p_rule: l.rule || 'none',
        p_differences: l.differences || [], p_sync_token: l.syncToken ?? null, p_hash: l.hash ?? null, p_proposal: l.proposal || null });
    },
    async linkGet(provider, kind, localId) { const l = await rpc('fin_link_get', { ...t, p_provider: provider, p_kind: kind, p_local_id: localId, p_external_id: null }); return l ? { externalId: l.external_id, localId: l.local_id, state: l.state, syncToken: l.sync_token, hash: l.hash } : null; },
    async linkByExternal(provider, kind, externalId) { const l = await rpc('fin_link_get', { ...t, p_provider: provider, p_kind: kind, p_local_id: null, p_external_id: externalId }); return l ? { externalId: l.external_id, localId: l.local_id, state: l.state, syncToken: l.sync_token, hash: l.hash } : null; },
    /** states: which link states are written onto the local rows. "proposed" for a bulk apply a person asked for, "created" for what a push just made. */
    async linksApply({ provider, kind, states = ['proposed'] }) { return { applied: Number(await rpc('fin_links_apply', { ...t, p_provider: provider, p_kind: kind, p_states: states })) || 0 }; },
    async candidates({ provider, refs = [], orderId = null, customerId = null }) {
      const d = (await rpc('fin_candidates', { ...t, p_provider: provider, p_refs: refs, p_order_id: orderId, p_customer_id: customerId })) || {};
      return { currency: d.currency || 'USD', clientId: d.client_id || null, intents: (d.intents || []).map((i) => ({ orderId: i.order_id, kind: i.kind, id: i.id })), contexts: (d.contexts || []).map(ctxView) };
    },
    async context(kind, id) { return ctxView(await rpc('fin_context', { ...t, p_kind: kind, p_id: id })); },
    async paymentRecord({ provider, externalId, cents, currency, occurredAt = null, decision, clientId = null, eventId = null }) {
      const d = await rpc('fin_payment_record', { ...t, p_provider: provider, p_external_id: externalId, p_cents: cents, p_currency: currency, p_occurred_at: occurredAt,
        p_status: decision.outcome, p_rule: decision.rule || null, p_reason: decision.reason || null, p_kind: decision.context ? decision.context.kind : null, p_context_id: decision.context ? decision.context.id : null,
        p_client: clientId, p_candidates: decision.candidates || [], p_event: eventId });
      return { fresh: !!d.fresh, status: d.status, balanceCents: d.balance_cents === null || d.balance_cents === undefined ? null : Number(d.balance_cents), settled: !!d.settled };
    },
    async paymentGet(provider, externalId) {
      const p = await rpc('fin_payment_get', { ...t, p_provider: provider, p_external_id: externalId });
      return p ? { cents: Number(p.cents), refundedCents: Number(p.refunded_cents), currency: p.currency, status: p.status, context: p.kind ? { kind: p.kind, id: p.context_id } : null } : null;
    },
    async refundRecord({ provider, externalId, paymentExternalId, cents, currency, decision, eventId = null }) {
      const d = await rpc('fin_refund_record', { ...t, p_provider: provider, p_external_id: externalId, p_payment_external_id: paymentExternalId, p_cents: cents, p_currency: currency, p_status: decision.outcome, p_reason: decision.reason || null, p_event: eventId });
      return { fresh: !!d.fresh, status: d.status, balanceCents: d.balance_cents === null || d.balance_cents === undefined ? null : Number(d.balance_cents) };
    },
    async intentPut(i) { await rpc('fin_intent_put', { ...t, p_provider: i.provider, p_order_id: i.orderId, p_link_id: i.linkId || null, p_kind: i.kind, p_context_id: i.id, p_cents: i.cents }); return true; },
    async audit(e) {
      await rpc('fin_audit', { ...t, p_provider: e.provider, p_direction: e.direction || 'out', p_action: e.action, p_entity: e.entity, p_local_id: e.localId || null, p_external_id: e.externalId || null, p_request_id: e.requestId || null, p_outcome: e.outcome || 'ok', p_code: e.code || null });
      return true;
    },
    async pushSource({ provider, kind, id }) {
      const d = await rpc('fin_push_source', { ...t, p_provider: provider, p_kind: kind, p_id: id });
      if (!d) return null;
      return { id: d.id, number: d.number || '', cents: Number(d.cents), date: d.date || null, customerExternalId: d.customer_external_id || null, itemExternalId: d.item_external_id || null,
        invoiceExternalId: d.invoice_external_id || null, clientId: d.client_id || null, name: d.name || '', email: d.email || '', phone: d.phone || '', approved: !!d.approved };
    },
  };
}

/** The store an adapter call uses: the one a test or a preview put on the context, else the database. */
export const financeOf = (ctx) => ctx.finance || dbFinance(ctx.tenantId);
