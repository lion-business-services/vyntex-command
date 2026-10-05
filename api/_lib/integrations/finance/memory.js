// The finance store, held in memory. Same methods and same rules as the database-backed store (port.js and the
// functions of the finance migration), with nothing behind it. Two uses:
//   tests      the adapters and the reconciliation rules run against it, so no database is needed to prove them
//   previews   a sync can be run against a copy to show what it would change before anything is written
// The rules that matter are here exactly as in the database: a provider payment is recorded once by its id, a
// repeat changes nothing, totals are whole cents, and a local field is never overwritten by a link.
import { isCents } from './money.js';

const k = (...parts) => parts.join('|');

export function memoryFinance(seed = {}) {
  const s = {
    currency: seed.currency || 'USD',
    clients: (seed.clients || []).map((c) => ({ externalIds: {}, ...c })),
    services: (seed.services || []).map((x) => ({ externalIds: {}, active: true, ...x, tiers: (x.tiers || []).map((t) => ({ externalIds: {}, ...t })) })),
    contexts: (seed.contexts || []).map((c) => ({ open: true, paidCents: 0, clientId: null, ...c })),
    sources: seed.sources || {},
    links: new Map(), payments: new Map(), refunds: new Map(), intents: [], audit: [], credits: [], localPayments: [], reviews: [],
  };
  const ctxOf = (kind, id) => s.contexts.find((c) => c.kind === kind && c.id === id) || null;
  const view = (c) => (c ? { kind: c.kind, id: c.id, clientId: c.clientId, dueCents: c.dueCents, paidCents: c.paidCents, open: c.open } : null);

  function apply(row, kind, id, cents) {
    const c = ctxOf(kind, id);
    if (!c) return null;
    const before = c.dueCents - c.paidCents;
    c.paidCents += cents;
    if (kind === 'job') s.localPayments.push({ jobId: id, cents, method: 'card', ref: `${row.provider}:${row.externalId}` });
    if (kind === 'appointment' && c.paidCents >= c.dueCents && !c.paid) c.paid = { method: 'card', ref: `${row.provider}:${row.externalId}`, cents: c.paidCents };
    const over = Math.max(cents - Math.max(before, 0), 0);
    if (over > 0 && c.clientId) s.credits.push({ clientId: c.clientId, cents: over, reason: 'overpayment', from: `${row.provider}:${row.externalId}` });
    return { balanceCents: Math.max(c.dueCents - c.paidCents, 0), settled: c.paidCents >= c.dueCents };
  }

  const api = {
    state: s,
    async clients(provider) { return s.clients.map((c) => ({ id: c.id, name: c.name || '', email: c.email || '', phone: c.phone || '', externalId: c.externalIds[provider] || null })); },
    async services(provider) {
      return s.services.map((x) => ({ id: x.id, name: x.name, active: x.active !== false, externalId: x.externalIds[provider] || null, jobItem: x.jobItem || null,
        tiers: x.tiers.map((t) => ({ id: t.id, name: t.name, priceCents: t.priceCents, externalId: t.externalIds[provider] || null })) }));
    },
    async linkPut(link) {
      const key = k(link.provider, link.kind, link.externalId);
      const had = s.links.get(key);
      // A link that was applied or decided by a person is not put back to "proposed" by a later sync.
      const state = had && had.appliedAt && link.state === 'proposed' ? had.state : link.state;
      s.links.set(key, { differences: [], rule: 'none', localId: null, syncToken: null, hash: null, ...had, ...link, state });
      return { fresh: !had };
    },
    async linkGet(provider, kind, localId) { return [...s.links.values()].find((l) => l.provider === provider && l.kind === kind && l.localId === localId) || null; },
    async linkByExternal(provider, kind, externalId) { return s.links.get(k(provider, kind, externalId)) || null; },
    /** Writes the ids of proposed links onto the local rows. Only an empty slot is filled: an id that is there stays. */
    async linksApply({ provider, kind, states = ['proposed'] }) {
      let applied = 0;
      for (const l of s.links.values()) {
        if (l.provider !== provider || l.kind !== kind || l.appliedAt || !l.localId || !states.includes(l.state)) continue;
        const rows = kind === 'customer' ? s.clients : kind === 'service' ? s.services : s.services.flatMap((x) => x.tiers);
        const row = rows.find((r) => r.id === l.localId);
        if (!row || row.externalIds[provider]) { l.state = 'needs_review'; l.rule = 'already_linked'; continue; }
        if (rows.some((r) => r.externalIds[provider] === l.externalId)) { l.state = 'needs_review'; l.rule = 'already_linked'; continue; }
        row.externalIds[provider] = l.externalId;
        l.appliedAt = 'applied'; l.state = l.differences.length ? 'needs_review' : 'linked'; applied += 1;
      }
      return { applied };
    },
    async candidates({ provider, refs = [], orderId, customerId }) {
      const client = customerId ? s.clients.find((c) => c.externalIds[provider] === customerId) : null;
      const intents = s.intents.filter((i) => i.provider === provider && orderId && i.orderId === orderId).map((i) => ({ orderId: i.orderId, kind: i.kind, id: i.id }));
      const wanted = new Set([...refs, ...intents].map((r) => k(r.kind, r.id)));
      const contexts = s.contexts.filter((c) => wanted.has(k(c.kind, c.id)) || (client && c.clientId === client.id && c.open)).map(view);
      return { currency: s.currency, clientId: client ? client.id : null, intents, contexts };
    },
    async context(kind, id) { const c = view(ctxOf(kind, id)); return c ? { ...c, currency: s.currency } : null; },
    /** Records a provider payment once. A second call with the same id answers fresh: false and changes nothing. */
    async paymentRecord({ provider, externalId, cents, currency, occurredAt = null, decision, clientId = null, eventId = null }) {
      if (!isCents(cents) || cents <= 0) throw new TypeError('not_cents');
      const key = k(provider, externalId);
      const had = s.payments.get(key);
      if (had) return { fresh: false, status: had.status, balanceCents: had.context ? Math.max(ctxOf(had.context.kind, had.context.id).dueCents - ctxOf(had.context.kind, had.context.id).paidCents, 0) : null };
      const row = { provider, externalId, cents, refundedCents: 0, currency, occurredAt, clientId, eventId, status: decision.outcome, rule: decision.rule || null, reason: decision.reason || null, context: decision.outcome === 'matched' ? decision.context : null, candidates: decision.candidates || [] };
      s.payments.set(key, row);
      const out = row.context ? apply(row, row.context.kind, row.context.id, cents) : null;
      return { fresh: true, status: row.status, balanceCents: out ? out.balanceCents : null, settled: out ? out.settled : false };
    },
    async paymentGet(provider, externalId) { const p = s.payments.get(k(provider, externalId)); return p ? { cents: p.cents, refundedCents: p.refundedCents, currency: p.currency, status: p.status, context: p.context } : null; },
    /** A person gives an unmatched payment its record. Once: a payment that has a record is not moved here. */
    async paymentAssign({ provider, externalId, kind, id }) {
      const row = s.payments.get(k(provider, externalId));
      if (!row) return { ok: false, reason: 'not_found' };
      if (row.status === 'matched') return { ok: false, reason: 'conflict' };
      if (!ctxOf(kind, id)) return { ok: false, reason: 'not_found' };
      row.status = 'matched'; row.rule = 'person'; row.context = { kind, id }; row.reason = null;
      return { ok: true, ...apply(row, kind, id, row.cents - row.refundedCents) };
    },
    async unmatched(provider) { return [...s.payments.values()].filter((p) => p.provider === provider && p.status !== 'matched').map((p) => ({ externalId: p.externalId, cents: p.cents, status: p.status, reason: p.reason, candidates: p.candidates })); },
    /** Records a refund once. The payment's received amount drops; the local record is flagged, not rewritten. */
    async refundRecord({ provider, externalId, paymentExternalId, cents, currency, decision, eventId = null }) {
      const key = k(provider, externalId);
      if (s.refunds.has(key)) return { fresh: false, status: s.refunds.get(key).status };
      s.refunds.set(key, { provider, externalId, paymentExternalId, cents, currency, status: decision.outcome, reason: decision.reason || null, eventId });
      if (decision.outcome !== 'recorded') return { fresh: true, status: decision.outcome, balanceCents: null };
      const p = s.payments.get(k(provider, paymentExternalId));
      p.refundedCents += cents;
      let balance = null;
      if (p.context) {
        const c = ctxOf(p.context.kind, p.context.id);
        c.paidCents -= cents; balance = Math.max(c.dueCents - c.paidCents, 0);
        s.reviews.push({ kind: 'refund', externalId, context: p.context });
      }
      return { fresh: true, status: 'recorded', balanceCents: balance };
    },
    async intentPut(intent) { if (!s.intents.some((i) => i.provider === intent.provider && i.orderId === intent.orderId)) s.intents.push({ ...intent }); return true; },
    async audit(entry) { s.audit.push({ ...entry }); return true; },
    /** What an accounting push needs about one local record. Seeded by the test, read from the database in production. */
    async pushSource({ kind, id }) { return (s.sources[kind] || {})[id] || null; },
  };
  return api;
}
