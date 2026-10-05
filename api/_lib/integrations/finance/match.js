// Matching a customer of a connected system to a local client. Pure: no database, no network.
//
// The order is fixed and the same every time:
//   1. the id this system already stored on a client (the link exists)
//   2. the email, compared without case and outer spaces
//   3. the phone, compared by its digits (a leading country code 1 is dropped for ten digit numbers)
// A step counts only when it finds exactly one client. Two clients with the same email (a family, a couple) is not a
// match: it goes to a person. A match creates a link and nothing else. Fields that differ are named, never copied:
// the local record is not overwritten and the differing values are not kept anywhere.

export const normEmail = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
export function normPhone(v) {
  const d = typeof v === 'string' ? v.replace(/\D+/g, '') : '';
  const local = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  return local.length >= 7 ? local : '';
}
export const normName = (v) => (typeof v === 'string' ? v.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim() : '');

/** Names of the fields whose values differ between the two records. A field one side leaves empty is not a difference. */
export function differences(remote, local) {
  const out = [];
  const pairs = [['name', normName], ['email', normEmail], ['phone', normPhone]];
  for (const [field, norm] of pairs) {
    const a = norm(remote[field]); const b = norm(local[field]);
    if (a && b && a !== b) out.push(field);
  }
  return out;
}

/**
 * remote  { id, name, email, phone }                         the provider's customer
 * locals  [{ id, name, email, phone, externalId }]           the company's clients, externalId = this provider's id or null
 * Answer  { outcome, rule, clientId, candidates, differences }
 *   linked     the client already carries this id
 *   link       exactly one client matched by email or phone and is free to link
 *   ambiguous  more than one client matched: a person chooses (candidates holds their ids)
 *   conflict   the one client that matched is already linked to a different customer of this system
 *   new        nobody matched: a proposal to create a client, never created here
 */
export function matchCustomer(remote, locals) {
  const id = String(remote.id || '');
  const stored = locals.filter((c) => c.externalId && c.externalId === id);
  if (stored.length === 1) return { outcome: 'linked', rule: 'stored_id', clientId: stored[0].id, candidates: [], differences: differences(remote, stored[0]) };
  for (const [rule, norm, field] of [['email', normEmail, 'email'], ['phone', normPhone, 'phone']]) {
    const key = norm(remote[field]);
    if (!key) continue;
    const hits = locals.filter((c) => norm(c[field]) === key);
    if (!hits.length) continue;
    if (hits.length > 1) return { outcome: 'ambiguous', rule, clientId: null, candidates: hits.map((c) => c.id).sort(), differences: [] };
    const one = hits[0];
    if (one.externalId && one.externalId !== id) return { outcome: 'conflict', rule, clientId: one.id, candidates: [one.id], differences: [] };
    return { outcome: 'link', rule, clientId: one.id, candidates: [], differences: differences(remote, one) };
  }
  return { outcome: 'new', rule: 'none', clientId: null, candidates: [], differences: [] };
}

/** What the link row says for a match: the state a person sees. A link with differing fields is linked and flagged. */
export function linkState(match) {
  if (match.outcome === 'linked') return match.differences.length ? 'needs_review' : 'linked';
  if (match.outcome === 'link') return 'proposed';
  if (match.outcome === 'new') return 'unlinked';
  return 'needs_review';
}
