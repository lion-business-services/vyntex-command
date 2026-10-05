// The service catalog and a connected system's item list. Pure: no database, no network.
//
// Two directions, both careful:
//   pull   the provider's items become PROPOSALS (link to an existing service, or a new service to approve). Nothing
//          is written to the catalog here, and a linked service whose name or price differs is reported, not changed.
//   push   INSERT ONLY. A local service the provider does not have yet becomes a new object. Anything that would
//          change or remove an object that exists at the provider is refused and reported. Square has one endpoint
//          for create and update (it updates when the object id is a real id), so the rule is enforced on the request
//          itself: assertInsertOnly() lets through only objects whose every id is a temporary "#" id and that carry
//          no version.
import { createHash } from 'node:crypto';
import { isCents, squareMoney } from './money.js';
import { normName } from './match.js';
import { ProviderError } from '../oauth.js';

/** A Square ITEM object reduced to what the catalog needs. Null for anything else, or deleted. */
export function slimSquareItem(o) {
  if (!o || o.type !== 'ITEM' || o.is_deleted || typeof o.id !== 'string' || !o.item_data) return null;
  const tiers = (Array.isArray(o.item_data.variations) ? o.item_data.variations : [])
    .filter((v) => v && v.type === 'ITEM_VARIATION' && !v.is_deleted && typeof v.id === 'string' && v.item_variation_data)
    .map((v) => ({ externalId: v.id, name: String(v.item_variation_data.name || '').slice(0, 200), priceCents: squareMoney(v.item_variation_data.price_money)?.cents ?? null }));
  return { externalId: o.id, name: String(o.item_data.name || '').slice(0, 200), tiers };
}

/** Field names that differ between a local service and the provider's item. Prices are compared tier by linked tier. */
export function serviceDifferences(local, remote) {
  const out = [];
  if (normName(local.name) !== normName(remote.name)) out.push('name');
  const remoteTiers = new Map(remote.tiers.map((t) => [t.externalId, t]));
  for (const t of local.tiers || []) {
    if (!t.externalId) { out.push('tier_added'); continue; }
    const r = remoteTiers.get(t.externalId);
    if (!r) { out.push('tier_missing'); continue; }
    if (r.priceCents !== t.priceCents) out.push('price');
    if (normName(r.name) !== normName(t.name)) out.push('tier_name');
  }
  if (remote.tiers.some((r) => !(local.tiers || []).some((t) => t.externalId === r.externalId))) out.push('tier_remote_only');
  return [...new Set(out)];
}

/**
 * remoteItems   [{ externalId, name, tiers }]   (slimSquareItem, or the same shape from another system)
 * localServices [{ id, name, active, externalId, tiers: [{ id, name, priceCents, externalId }] }]
 * Answer: one proposal per remote item: { externalId, state, rule, localId, differences, proposal? }
 *   linked        already linked, nothing differs
 *   needs_review  linked and something differs, or the name matches more than one local service
 *   proposed      one local service has the same name and no link: a person approves the link
 *   unlinked      no local service: `proposal` holds the name and prices for a person to approve as a new service
 */
export function proposeFromRemote(remoteItems, localServices) {
  return remoteItems.map((r) => {
    const linked = localServices.find((s) => s.externalId === r.externalId);
    if (linked) {
      const diff = serviceDifferences(linked, r);
      return { externalId: r.externalId, state: diff.length ? 'needs_review' : 'linked', rule: 'stored_id', localId: linked.id, differences: diff };
    }
    const same = localServices.filter((s) => !s.externalId && normName(s.name) && normName(s.name) === normName(r.name));
    if (same.length === 1) return { externalId: r.externalId, state: 'proposed', rule: 'name', localId: same[0].id, differences: serviceDifferences({ ...same[0], tiers: [] }, { ...r, tiers: [] }) };
    if (same.length > 1) return { externalId: r.externalId, state: 'needs_review', rule: 'ambiguous', localId: null, differences: [] };
    return { externalId: r.externalId, state: 'unlinked', rule: 'none', localId: null, differences: [], proposal: { name: r.name, tiers: r.tiers.map((t) => ({ name: t.name, priceCents: t.priceCents })) } };
  });
}

/** The same key for the same service of the same company, every time: a repeated push cannot create a second object. */
export const pushKey = (tenantId, serviceId) => 'vx-cat-' + createHash('sha256').update(`${tenantId}|${serviceId}`).digest('hex').slice(0, 32);

/**
 * What a push to Square would do. Nothing is sent here.
 * Answer { create: [{ serviceId, idempotencyKey, object, tierIds }], refused: [{ serviceId, reason, fields }], unchanged: [serviceId] }
 *   refused reasons: would_update (linked and different), remote_missing (linked, the object is gone at the provider),
 *                    name_exists (not linked, the provider already has an item with this name), invalid_price
 */
export function planSquarePush(localServices, remoteItems, { tenantId, currency }) {
  const byId = new Map(remoteItems.map((r) => [r.externalId, r]));
  const names = new Set(remoteItems.map((r) => normName(r.name)).filter(Boolean));
  const plan = { create: [], refused: [], unchanged: [] };
  for (const s of localServices) {
    if (s.active === false) continue;
    if (s.externalId) {
      const remote = byId.get(s.externalId);
      if (!remote) { plan.refused.push({ serviceId: s.id, reason: 'remote_missing', fields: [] }); continue; }
      const diff = serviceDifferences(s, remote);
      if (diff.length) plan.refused.push({ serviceId: s.id, reason: 'would_update', fields: diff }); else plan.unchanged.push(s.id);
      continue;
    }
    if (names.has(normName(s.name))) { plan.refused.push({ serviceId: s.id, reason: 'name_exists', fields: ['name'] }); continue; }
    const tiers = (s.tiers && s.tiers.length ? s.tiers : []);
    if (!tiers.length || tiers.some((t) => !isCents(t.priceCents) || t.priceCents < 0)) { plan.refused.push({ serviceId: s.id, reason: 'invalid_price', fields: ['price'] }); continue; }
    const tierIds = tiers.map((t, i) => ({ tierId: t.id, clientId: `#vx-tier-${i}` }));
    plan.create.push({
      serviceId: s.id, idempotencyKey: pushKey(tenantId, s.id), tierIds,
      object: {
        type: 'ITEM', id: '#vx-item',
        item_data: {
          name: String(s.name).slice(0, 255),
          variations: tiers.map((t, i) => ({
            type: 'ITEM_VARIATION', id: `#vx-tier-${i}`,
            item_variation_data: { item_id: '#vx-item', name: String(t.name).slice(0, 255), pricing_type: 'FIXED_PRICING', price_money: { amount: t.priceCents, currency } },
          })),
        },
      },
    });
  }
  return plan;
}

/**
 * The last check before a catalog object leaves for Square: every id in it is temporary ("#...", which Square always
 * treats as a new object) and nothing carries a version (which only an update has). Throws update_refused otherwise.
 */
export function assertInsertOnly(object) {
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    if ('version' in v || v.is_deleted === true) throw new ProviderError('update_refused');
    if ('id' in v && !(typeof v.id === 'string' && /^#[A-Za-z0-9_-]{1,60}$/.test(v.id))) throw new ProviderError('update_refused');
    Object.values(v).forEach(walk);
  };
  if (!object || typeof object !== 'object' || !('id' in object)) throw new ProviderError('update_refused');
  walk(object);
  return object;
}
