// Where connections are kept: the rows of app.integration_connections (supabase/migrations/0026), reached through
// server-only database functions. Tokens are sealed here, before they leave the server, with the company and the
// provider bound into the seal, so the database only ever holds an envelope it cannot open and a token sealed for
// one company's row does not open on another's.
//
// The service role is used because the server is the only writer of connection state ("connected" is a statement
// the server makes after checking with the provider), and because jobs and webhooks run with nobody signed in.
import { serviceRpc } from '../supabase.js';
import { sealToken, openToken, needsReseal } from '../crypto.js';
import { log } from '../respond.js';

const aad = (tenantId, provider) => `conn:${tenantId}:${provider}`;

export const sealTokens = (tenantId, provider, tokens) => sealToken(tokens, aad(tenantId, provider));
export const openTokens = (tenantId, provider, envelope) => (envelope ? openToken(envelope, aad(tenantId, provider)) : null);

/** The stored row (with the sealed token blob), or null. */
export async function getRow(tenantId, provider) {
  const r = await serviceRpc('conn_get', { p_tenant: tenantId, p_provider: provider });
  if (!r.ok) { log('integrations', 'store_read_failed', { provider, status: r.status }); return null; }
  return r.data || null;
}

/** Creates or updates the row. `patch` uses the column names of the table; tokens are passed separately and sealed. */
export async function putRow(tenantId, provider, patch = {}, tokens) {
  const p = { ...patch };
  if (tokens !== undefined) {
    p.token_enc = tokens ? sealTokens(tenantId, provider, tokens) : null;
    p.token_expires_at = tokens && tokens.expires_at ? tokens.expires_at : null;
  }
  const r = await serviceRpc('conn_put', { p_tenant: tenantId, p_provider: provider, p_patch: p });
  if (!r.ok) { log('integrations', 'store_write_failed', { provider, status: r.status, sqlstate: r.sqlstate }); return null; }
  return r.data;
}

export async function deleteRow(tenantId, provider) {
  const r = await serviceRpc('conn_delete', { p_tenant: tenantId, p_provider: provider });
  return r.ok;
}

/** Opens the tokens of a row. When they were sealed with the previous key they are sealed again with the current one. */
export async function tokensOf(row) {
  if (!row || !row.token_enc) return null;
  const tokens = openTokens(row.tenant_id, row.provider, row.token_enc);
  if (tokens && needsReseal(row.token_enc)) await putRow(row.tenant_id, row.provider, {}, tokens);
  return tokens;
}

export async function cursorGet(tenantId, provider, resource) {
  const r = await serviceRpc('cursor_get', { p_tenant: tenantId, p_provider: provider, p_resource: resource });
  return r.ok ? r.data : null;
}
export async function cursorSet(tenantId, provider, resource, cursor) {
  const r = await serviceRpc('cursor_set', { p_tenant: tenantId, p_provider: provider, p_resource: resource, p_cursor: cursor });
  return r.ok;
}
