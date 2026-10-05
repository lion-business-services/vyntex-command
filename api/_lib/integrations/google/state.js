// What the Google adapters remember between runs, and where they hand over what they found.
//   cursors   small values per company and provider (a Gmail history id, a Calendar sync token, a watch channel).
//             Kept in app.sync_cursors through the framework. Inside a sync the framework supplies ctx.cursor; a
//             webhook job does not, so the same store is reached directly.
//   links     which local record is which Google Calendar event, with the versions both sides had when they last
//             agreed. This is what prevents duplicates and what lets a conflict be seen instead of overwritten.
//   inbound   changes found at Google (a new email, a moved event, a new review). The adapter never writes workspace
//             records: it puts a small row here and the module that owns the records applies it.
// The last two need the tables in the migration given in docs/integrations/google.md. Tests pass their own stores
// (ctx.links, ctx.sink) and nothing here is called.
import { createHash, createHmac } from 'node:crypto';
import { ProviderError } from '../oauth.js';

const rpc = async (name, args) => (await import('../../supabase.js')).serviceRpc(name, args);

export function cursorOf(ctx) {
  if (ctx.cursor) return ctx.cursor;
  return {
    get: async (resource) => (await import('../store.js')).cursorGet(ctx.tenantId, ctx.provider, resource),
    set: async (resource, value) => (await import('../store.js')).cursorSet(ctx.tenantId, ctx.provider, resource, value),
  };
}
export async function cursorJson(cursor, resource) {
  const v = await cursor.get(resource);
  if (!v) return null;
  try { const o = JSON.parse(v); return o && typeof o === 'object' ? o : null; } catch { return null; }
}

/** The stored map of local id to Google event. Row: { local_id, calendar_id, event_id, etag, remote_updated, local_updated, hash }. */
export function linksOf(ctx) {
  if (ctx.links) return ctx.links;
  const call = async (name, args) => {
    const r = await rpc(name, { p_tenant: ctx.tenantId, ...args });
    if (!r.ok) throw new ProviderError('links_unavailable');
    return r.data || null;
  };
  return {
    get: (localId) => call('gcal_link_get', { p_local: localId }),
    byEvent: (eventId) => call('gcal_link_by_event', { p_event: eventId }),
    put: (row) => call('gcal_link_put', { p_row: row }),
    remove: (localId) => call('gcal_link_delete', { p_local: localId }),
  };
}

/**
 * Hands one found change to the workspace. item: { kind, ref, data }. `ref` identifies the change at the provider, so
 * the same change arriving twice (a webhook and the daily sync, a retried job) is stored once.
 */
export function sinkOf(ctx) {
  if (ctx.sink) return ctx.sink;
  return async (item) => {
    const r = await rpc('google_inbound_put', { p_tenant: ctx.tenantId, p_provider: ctx.provider, p_kind: item.kind, p_ref: item.ref, p_data: item.data || {} });
    if (!r.ok) throw new ProviderError('inbound_unavailable');
    return r.data;
  };
}

/** A stable id made from parts, so the same write always carries the same id and Google can refuse the repeat. */
export const stableId = (...parts) => createHash('sha256').update(parts.join('|')).digest('hex');

const B32HEX = '0123456789abcdefghijklmnopqrstuv';
/** Google Calendar accepts caller chosen event ids made of the letters a to v and digits (base32hex). 26 bytes give 42 of them. */
export function eventIdFor(tenantId, localId) {
  const bytes = createHash('sha256').update(`vx-gcal|${tenantId}|${localId}`).digest().subarray(0, 26);
  let bits = 0, value = 0, out = '';
  for (const b of bytes) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32HEX[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) out += B32HEX[(value << (5 - bits)) & 31];
  return out;
}

/** The token a Calendar watch channel carries back with every notice: the company, bound to the channel by an HMAC. */
export function channelToken(secret, tenantId, channelId) {
  return `v1.${tenantId}.${createHmac('sha256', secret).update(`gcal-channel|${tenantId}|${channelId}`).digest('hex')}`;
}
