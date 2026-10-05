// The integration framework: one way to connect, check, refresh, sync and disconnect any provider.
// Screens never talk to a provider and never contain provider logic. They call /api/integrations/*; this file runs
// the common steps and hands the provider-specific part to an adapter (providers/<id>.js).
//
// Honest states (ConnState in src/domain/types.ts). The server is the only source of them:
//   not_connected     reason not_built        the adapter does not exist yet
//                     reason not_configured   the deployment lacks a setting the adapter needs (names in `missing`)
//   pending_approval  reason provider_review  the provider has not approved this app yet
//   setup             reason ready_to_connect configured, nobody connected it in this company
//   connected         only after the provider answered a real status call for the account
//   attention         it works but something needs a look (a failed check, a missing scope)
//   reauth            the provider no longer accepts the stored tokens: the person must connect again
//   error             the last attempt failed for another reason (code in lastError)
import { env, has, appOrigin } from '../env.js';
import { userRpc } from '../supabase.js';
import { HttpError, upstreamError, log } from '../respond.js';
import { securityEvent } from '../audit.js';
import * as store from './store.js';
import { newState, stateHash, stateMatches, sealVerifier, openVerifier, redirectUri, ProviderError } from './oauth.js';
import { catalog, getAdapter } from './providers/index.js';
import { serviceRpc } from '../supabase.js';

const REFRESH_MARGIN_MS = 120000;

/** What the deployment's settings alone say about a provider, before looking at any company. */
export function configState(entry) {
  if (!entry.built) return { state: 'not_connected', reason: 'not_built', missing: entry.env.filter((n) => !has(n)) };
  const missing = entry.env.filter((n) => !has(n));
  if (missing.length) return { state: 'not_connected', reason: 'not_configured', missing };
  if (entry.approval && entry.approval.needed && !/^(1|true|yes)$/i.test(env(entry.approval.flag || ''))) {
    return { state: 'pending_approval', reason: 'provider_review', missing: [] };
  }
  return { state: 'setup', reason: 'ready_to_connect', missing: [] };
}

/** One card of the Integrations screen: the deployment's side merged with the company's stored connection. */
export function describe(entry, row) {
  const cfg = configState(entry);
  const base = { id: entry.id, name: entry.name, kind: entry.kind, built: !!entry.built, scopes: entry.scopes || [], approval: entry.approval ? { needed: !!entry.approval.needed, note: entry.approval.note || '' } : null };
  if (cfg.state !== 'setup') {
    // Not usable on this deployment. A stored "connected" is not repeated: without the settings nothing can be verified.
    return { ...base, state: row && cfg.reason === 'not_configured' ? 'error' : cfg.state, reason: cfg.reason, missing: cfg.missing };
  }
  if (!row) return { ...base, state: 'setup', reason: 'ready_to_connect', missing: [] };
  return {
    ...base, missing: [],
    state: row.state, reason: row.reason || (row.state === 'connected' ? 'verified' : row.lastError || 'unknown'),
    account: row.account, scopes: row.scopes && row.scopes.length ? row.scopes : base.scopes,
    connectedAt: row.connectedAt, lastSyncAt: row.lastSyncAt, lastError: row.lastError, lastErrorAt: row.lastErrorAt,
    health: row.health, healthCheckedAt: row.healthCheckedAt, by: row.by,
  };
}

/** Every provider with its state for one company. Read with the person's token: the database decides who may look. */
export async function listFor(session, tenantId) {
  const r = await userRpc(session.at, 'connections_list', { p_tenant: tenantId });
  if (!r.ok) throw upstreamError(r);
  const rows = new Map((r.data || []).map((c) => [c.id, c]));
  return (await catalog()).map((entry) => describe(entry, rows.get(entry.id)));
}

/** What an adapter gets to work with. `fetch` can be replaced in tests; `env` reads settings by name. */
export function makeCtx(adapter, { tenantId, origin = '', tokens = null, row = null, fetchFn } = {}) {
  return {
    provider: adapter.id, tenantId, tokens, connection: row,
    env, fetch: fetchFn || ((...a) => globalThis.fetch(...a)),
    redirectUri: origin ? redirectUri(origin, adapter.id) : '',
    now: () => Date.now(),
  };
}

/** Asks the database, with the person's token, whether they may do this to a connection. Returns their member id. */
async function authorize(session, tenantId, action) {
  const r = await userRpc(session.at, 'integration_authorize', { p_tenant: tenantId, p_action: action });
  if (!r.ok) throw upstreamError(r);
  return r.data;
}

function usable(entry) {
  if (!entry || !entry.built) throw new HttpError(409, 'not_built');
  const cfg = configState(entry);
  if (cfg.state === 'not_connected') throw new HttpError(409, 'not_configured', { missing: cfg.missing });
  if (cfg.state === 'pending_approval') throw new HttpError(409, 'pending_approval');
}

// ---------------------------------------------------------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------------------------------------------------------

/** OAuth providers: returns { url } to send the browser to. Key and platform providers: verifies now and returns the card. */
export async function startConnect({ adapter, session, tenantId, request, returnTo = '/' }) {
  usable(adapter);
  const origin = appOrigin(request);
  if (adapter.kind !== 'oauth') {
    const memberId = await authorize(session, tenantId, 'connect');
    return { card: await verifyAndStore({ adapter, tenantId, memberId, tokens: null, origin, request, user: session.uid }) };
  }
  const st = newState(adapter.id, tenantId);
  // The state row is written with the person's token: the database checks membership, the capability and the fresh
  // identity check, and records who started this.
  const r = await userRpc(session.at, 'oauth_state_put', {
    p_tenant: tenantId, p_provider: adapter.id, p_state_hash: st.hash,
    p_verifier_enc: sealVerifier(st.verifier, adapter.id, tenantId), p_return_to: returnTo,
  });
  if (!r.ok) throw upstreamError(r);
  const ctx = makeCtx(adapter, { tenantId, origin });
  return { url: adapter.authUrl({ ...ctx, state: st.state, challenge: st.challenge }) };
}

/**
 * The provider sent the browser back. Returns { returnTo, result, reason } for the redirect. Never throws for a
 * provider or state problem: the person is sent back to the screen with a reason code.
 */
export async function finishConnect({ adapter, request, session, code, state, params = {} }) {
  const fallback = { returnTo: '/', result: 'error' };
  const hash = stateHash(state);
  if (!hash || !code || typeof code !== 'string' || code.length > 2000) return { ...fallback, reason: 'bad_state' };
  // Used up in the same statement that finds it: a state works once. Service role, because the row is not the
  // person's to mark as used (and the callback must fail closed even if their session changed meanwhile).
  const taken = await serviceRpc('oauth_state_take', { p_state_hash: hash, p_provider: adapter.id });
  if (!taken.ok) return { ...fallback, reason: 'unavailable' };
  const row = taken.data;
  if (!row) return { ...fallback, reason: 'bad_state' };
  const back = { returnTo: row.return_to || '/', result: 'error' };
  if (!stateMatches(state, adapter.id, row.tenant_id)) return { ...back, reason: 'bad_state' };
  // The browser that finishes must be signed in as the person who started. Otherwise someone could be made to attach
  // an account they did not choose.
  if (row.user_id !== session.uid) return { ...back, reason: 'wrong_person' };
  const verifier = openVerifier(row.verifier_enc, adapter.id, row.tenant_id);
  if (!verifier) return { ...back, reason: 'bad_state' };
  const origin = appOrigin(request);
  const ctx = makeCtx(adapter, { tenantId: row.tenant_id, origin });
  let tokens;
  try {
    // `params` is the whole query of the provider's redirect: some providers say there which account was chosen
    // (QuickBooks sends the company's realm id next to the code).
    tokens = await adapter.exchange({ ...ctx, verifier, params }, code);
  } catch (e) {
    const reason = e instanceof ProviderError ? e.code : 'token_exchange_failed';
    await securityEvent({ tenant: row.tenant_id, user: session.uid, kind: 'integration.connect_failed', outcome: 'failed', request, meta: { provider: adapter.id, reason } });
    return { ...back, reason };
  }
  try {
    await verifyAndStore({ adapter, tenantId: row.tenant_id, memberId: row.member_id, tokens, origin, request, user: session.uid });
  } catch (e) {
    return { ...back, reason: e instanceof HttpError ? (e.more && e.more.reason) || e.code : 'verify_failed' };
  }
  return { returnTo: row.return_to || '/', result: 'connected' };
}

/** Uses a state up without exchanging anything (the person refused on the provider's page). */
export async function discardState(adapter, state) {
  const hash = stateHash(state);
  if (hash) await serviceRpc('oauth_state_take', { p_state_hash: hash, p_provider: adapter.id });
}

/**
 * The step that earns "connected": a real status call to the provider with the credentials just obtained.
 * Only when it succeeds is the row written as connected, with the account it answered for. On failure nothing is
 * stored as connected and the tokens are not kept.
 */
async function verifyAndStore({ adapter, tenantId, memberId, tokens, origin, request, user }) {
  // The adapter sees the row that is already there, so it can refuse a second sign-in that answers for another
  // account than the one this company connected (its records would otherwise be mixed with a stranger's).
  const existing = await store.getRow(tenantId, adapter.id);
  const ctx = makeCtx(adapter, { tenantId, origin, tokens, row: existing });
  let status;
  try { status = await adapter.status(ctx); } catch (e) { status = { ok: false, reason: e instanceof ProviderError ? e.code : 'status_failed' }; }
  if (!status || status.ok !== true) {
    const reason = (status && status.reason) || 'status_failed';
    // A refused sign-in says nothing about the tokens already stored: a working connection stays as it is. Only a
    // connection that has no tokens of its own (a key or platform provider), or none that works, is written as failed.
    const keep = adapter.kind === 'oauth' && existing && existing.token_enc && ['connected', 'attention'].includes(existing.state);
    if (!keep) await store.putRow(tenantId, adapter.id, { state: 'error', reason, last_error: reason, health: 'down' }, null);
    await securityEvent({ tenant: tenantId, user, kind: 'integration.connect_failed', outcome: 'failed', request, meta: { provider: adapter.id, reason } });
    throw new HttpError(502, 'verify_failed', { reason });
  }
  const now = new Date().toISOString();
  const saved = await store.putRow(tenantId, adapter.id, {
    state: 'connected', reason: 'verified', last_error: null, health: 'ok',
    account_label: status.account?.label || null, account_ref: status.account?.ref || null,
    scopes: status.scopes || (tokens && tokens.scope ? tokens.scope.split(/[\s,]+/).filter(Boolean) : adapter.scopes || []),
    connected_at: now, connected_by: memberId,
  }, tokens);
  if (!saved) throw new HttpError(503, 'store_unavailable');
  await securityEvent({ tenant: tenantId, user, kind: 'integration.connected', outcome: 'ok', request, meta: { provider: adapter.id } });
  return describe(adapter, saved);
}

// ---------------------------------------------------------------------------------------------------------------------
// Using a connection
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A context with working tokens for a stored connection, refreshing them first when they are about to expire.
 * Throws ProviderError('not_connected') when there is nothing to use, and marks the row "reauth" when the provider
 * refuses the refresh token.
 */
export async function connectionCtx(adapter, tenantId, { fetchFn, origin = '' } = {}) {
  const row = await store.getRow(tenantId, adapter.id);
  if (!row || !['connected', 'attention'].includes(row.state)) throw new ProviderError('not_connected');
  if (adapter.kind !== 'oauth') return makeCtx(adapter, { tenantId, origin, row, fetchFn });
  let tokens = await store.tokensOf(row);
  if (!tokens) {
    await store.putRow(tenantId, adapter.id, { state: 'reauth', reason: 'token_unreadable', last_error: 'token_unreadable' }, null);
    throw new ProviderError('token_unreadable', { reauth: true });
  }
  const expires = tokens.expires_at ? Date.parse(tokens.expires_at) : 0;
  if (expires && expires - Date.now() < REFRESH_MARGIN_MS) tokens = await refreshTokens(adapter, tenantId, tokens, { fetchFn });
  return makeCtx(adapter, { tenantId, origin, tokens, row, fetchFn });
}

/** Exchanges the refresh token. The new pair replaces the old one (a rotated refresh token is stored at once). */
export async function refreshTokens(adapter, tenantId, tokens, { fetchFn } = {}) {
  if (!tokens.refresh_token) {
    await store.putRow(tenantId, adapter.id, { state: 'reauth', reason: 'token_expired', last_error: 'token_expired' }, null);
    throw new ProviderError('token_expired', { reauth: true });
  }
  try {
    const next = await adapter.refresh(makeCtx(adapter, { tenantId, tokens, fetchFn }), tokens);
    await store.putRow(tenantId, adapter.id, { last_error: null }, next);
    return next;
  } catch (e) {
    const err = e instanceof ProviderError ? e : new ProviderError('refresh_failed');
    if (err.reauth) {
      // The stored tokens are no use any more: drop them and ask the person to connect again.
      await store.putRow(tenantId, adapter.id, { state: 'reauth', reason: err.code, last_error: err.code, health: 'down' }, null);
      await securityEvent({ tenant: tenantId, kind: 'integration.error', outcome: 'failed', meta: { provider: adapter.id, reason: err.code } });
    } else {
      await store.putRow(tenantId, adapter.id, { last_error: err.code });
    }
    throw err;
  }
}

/** A real call that tells whether the connection works right now. Writes the outcome on the row. */
export async function checkHealth(adapter, tenantId, opts = {}) {
  let result;
  try {
    const ctx = await connectionCtx(adapter, tenantId, opts);
    result = await (adapter.health ? adapter.health(ctx) : adapter.status(ctx));
  } catch (e) {
    const err = e instanceof ProviderError ? e : new ProviderError('health_failed');
    if (err.code === 'not_connected') return { ok: false, health: 'unknown', reason: 'not_connected' };
    result = { ok: false, reason: err.code, reauth: err.reauth };
  }
  if (result && result.ok) {
    await store.putRow(tenantId, adapter.id, { state: 'connected', reason: 'verified', health: result.health || 'ok', last_error: null });
    return { ok: true, health: result.health || 'ok' };
  }
  const reason = (result && result.reason) || 'health_failed';
  if (!(result && result.reauth)) await store.putRow(tenantId, adapter.id, { state: 'attention', reason, health: 'down', last_error: reason });
  await securityEvent({ tenant: tenantId, kind: 'integration.error', outcome: 'failed', meta: { provider: adapter.id, reason } });
  return { ok: false, health: 'down', reason };
}

/** Runs the adapter's sync and stamps the row. Called by the job runner. */
export async function runSync(adapter, tenantId, what = 'all', opts = {}) {
  if (!adapter.sync) return { ok: true, skipped: 'no_sync' };
  const ctx = await connectionCtx(adapter, tenantId, opts);
  ctx.cursor = { get: (resource) => store.cursorGet(tenantId, adapter.id, resource), set: (resource, value) => store.cursorSet(tenantId, adapter.id, resource, value) };
  try {
    const out = await adapter.sync(ctx, what);
    await store.putRow(tenantId, adapter.id, { last_sync_at: new Date().toISOString(), last_error: null });
    return { ok: true, ...(out || {}) };
  } catch (e) {
    const err = e instanceof ProviderError ? e : new ProviderError('sync_failed');
    await store.putRow(tenantId, adapter.id, err.reauth ? { state: 'reauth', reason: err.code, last_error: err.code } : { last_error: err.code });
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------------------------------------------------

/** Tells the provider to revoke the tokens (best effort), then deletes them and the row. */
export async function disconnect({ adapter, session, tenantId, request }) {
  await authorize(session, tenantId, 'disconnect');
  const row = await store.getRow(tenantId, adapter.id);
  if (!row) return { removed: false, revoked: false };
  let revoked = false;
  const tokens = await store.tokensOf(row);
  if (tokens && adapter.revoke) {
    try { await adapter.revoke(makeCtx(adapter, { tenantId, tokens, row }), tokens); revoked = true; } catch { log('integrations', 'revoke_failed', { provider: adapter.id }); }
  }
  // Deleted whether or not the provider answered: after "Disconnect" nothing usable stays in the database.
  const removed = await store.deleteRow(tenantId, adapter.id);
  if (!removed) throw new HttpError(503, 'store_unavailable');
  await securityEvent({ tenant: tenantId, user: session.uid, kind: 'integration.disconnected', outcome: 'ok', request, meta: { provider: adapter.id, revoked } });
  return { removed: true, revoked };
}

export { authorize, getAdapter };
