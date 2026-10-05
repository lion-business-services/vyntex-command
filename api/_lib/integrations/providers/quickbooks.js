// QuickBooks Online: the company's books. One connection per company, to one QuickBooks company (its realm id).
//
// What this adapter will and will not do:
//   customers  read and matched to clients (stored id, then email, then phone). A match is a link. A customer is
//              created in QuickBooks only for a client a person approved for it.
//   invoices   pushed from an engagement, once, with QuickBooks' "requestid" so a retry cannot create a second one.
//   payments   pushed against the pushed invoice, once, the same way. A payment is never changed after it is sent.
//   changes    read with change data capture from a stored point in time. When QuickBooks holds a newer version of
//              something this platform sent (its SyncToken moved), the record is marked "conflict" for a person.
//              Nothing in QuickBooks is ever overwritten to win a conflict: an update goes out with the SyncToken
//              that was stored, and when QuickBooks answers "stale", that is the end of it until a person decides.
//   audit      every write to QuickBooks, done, refused or failed, leaves a record with its request id.
//
// Settings: QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET, QUICKBOOKS_ENVIRONMENT ("sandbox" or "production",
//           nothing else is accepted and there is no default), QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN.
//           QUICKBOOKS_APPROVED must be "true" before anyone can connect (Intuit reviews an app for production).
//           Optional: QUICKBOOKS_MINOR_VERSION.
// Intuit sends the company's realm id back on the callback address next to the code; the framework has to hand the
// callback's query to exchange() as ctx.params (see docs/integrations/square-quickbooks.md).
// Not proven against Intuit: no credentials exist in this build. Written from Intuit's public API and tested with
// mocked responses only.
import { createHash, createHmac } from 'node:crypto';
import { tokenRequest, normaliseTokens, ProviderError } from '../oauth.js';
import { fresh, parseJson } from '../webhook.js';
import { sameString, sha256Hex } from '../../crypto.js';
import { log } from '../../respond.js';
import { serviceRpc } from '../../supabase.js';
import { enqueue } from '../../jobs.js';
import { toCents, centsToDecimal } from '../finance/money.js';
import { matchCustomer, linkState } from '../finance/match.js';
import { proposeFromRemote } from '../finance/catalog.js';
import { financeOf } from '../finance/port.js';

const AUTHORIZE = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REVOKE = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const HOSTS = { sandbox: 'https://sandbox-quickbooks.api.intuit.com', production: 'https://quickbooks.api.intuit.com' };
const DEFAULT_MINOR = '75';
const REALM = /^\d{6,24}$/;
const QID = /^[A-Za-z0-9:_-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 100;
const PAGES_PER_RUN = 20;
const PREVIEW_HOURS = 24;
// Change data capture reaches back 30 days at most. Past that the stored point is no use and the run says so.
const CDC_MAX_DAYS = 29;
const EVENT_WINDOW_S = 25 * 3600;

export function environment(ctx) {
  const v = String(ctx.env('QUICKBOOKS_ENVIRONMENT') || '').trim().toLowerCase();
  if (v !== 'sandbox' && v !== 'production') throw new ProviderError('environment_invalid');
  return v;
}
const basic = (ctx) => ({ id: ctx.env('QUICKBOOKS_CLIENT_ID'), secret: ctx.env('QUICKBOOKS_CLIENT_SECRET') });
const minor = (ctx) => (/^\d{1,3}$/.test(ctx.env('QUICKBOOKS_MINOR_VERSION') || '') ? ctx.env('QUICKBOOKS_MINOR_VERSION') : DEFAULT_MINOR);
const qid = (v) => (typeof v === 'string' && QID.test(v) ? v : typeof v === 'number' && Number.isSafeInteger(v) ? String(v) : null);
const realmOf = (ctx) => { const r = ctx.tokens && ctx.tokens.realm_id; if (!r || !REALM.test(r)) throw new ProviderError('realm_missing', { reauth: true }); return r; };
/** At most 50 characters, the same for the same thing: QuickBooks answers a repeated request id with the first result. */
const requestId = (prefix, ...parts) => prefix + createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 40);

/** Intuit's fault codes that mean something here. Only the number is read, never the message or the detail. */
function failure(status, data) {
  const code = String((data?.Fault?.Error || data?.fault?.error || [])[0]?.code || '');
  if (status === 401) return new ProviderError('token_rejected', { reauth: true, status });
  if (status === 403) return new ProviderError('permission_revoked', { reauth: true, status });
  if (status === 429) return new ProviderError('rate_limited', { status });
  if (code === '5010') return new ProviderError('sync_conflict', { status });
  if (code === '6240') return new ProviderError('duplicate_name', { status });
  if (code === '6140') return new ProviderError('duplicate_document', { status });
  if (code === '610') return new ProviderError('not_found', { status });
  if (status >= 500) return new ProviderError('provider_error', { status });
  return new ProviderError('request_rejected', { status });
}

async function api(ctx, method, path, { body, query = {} } = {}) {
  if (!ctx.tokens || !ctx.tokens.access_token) throw new ProviderError('not_connected');
  const u = new URL(`${HOSTS[environment(ctx)]}/v3/company/${realmOf(ctx)}${path}`);
  for (const [k, v] of Object.entries({ ...query, minorversion: minor(ctx) })) u.searchParams.set(k, String(v));
  let res;
  try {
    res = await ctx.fetch(u.toString(), {
      method, headers: { authorization: 'Bearer ' + ctx.tokens.access_token, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new ProviderError('provider_unreachable');
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw failure(res.status, data);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ProviderError('bad_response', { status: res.status });
  // QuickBooks can answer 200 with a fault inside.
  if (data.Fault || data.fault) throw failure(400, data);
  return data;
}

const customerOf = (c) => ({ id: qid(c.Id), name: String(c.DisplayName || c.CompanyName || ''), email: String(c.PrimaryEmailAddr?.Address || ''), phone: String(c.PrimaryPhone?.FreeFormNumber || ''), syncToken: qid(c.SyncToken) });

function parseWhat(what) {
  const [resource, mode] = String(what || 'all').split(':');
  if (!['all', 'customers', 'items', 'changes'].includes(resource) || (mode !== undefined && mode !== 'apply' && mode !== 'preview')) throw new ProviderError('sync_unknown');
  return { resource, apply: mode === 'apply' };
}

async function syncCustomers(ctx, apply, asked) {
  const fin = financeOf(ctx);
  const started = new Date(ctx.now()).toISOString();
  if (apply) {
    const at = Date.parse((await ctx.cursor.get('customers.preview_at')) || '');
    if (!Number.isFinite(at) || ctx.now() - at > PREVIEW_HOURS * 3600000) throw new ProviderError('preview_required');
  }
  let position = Number((await ctx.cursor.get('customers.position')) || 1);
  if (!Number.isSafeInteger(position) || position < 1) position = 1;
  const locals = await fin.clients('quickbooks');
  const counts = { seen: 0, linked: 0, proposed: 0, needsReview: 0, unlinked: 0, applied: 0 };
  let pages = 0; let done = false;
  while (pages < PAGES_PER_RUN) {
    const page = await api(ctx, 'GET', '/query', { query: { query: `select * from Customer where Active = true orderby Id startposition ${position} maxresults ${PAGE}` } });
    pages += 1;
    const rows = Array.isArray(page.QueryResponse?.Customer) ? page.QueryResponse.Customer : [];
    for (const raw of rows) {
      const c = customerOf(raw);
      if (!c.id) continue;
      counts.seen += 1;
      const m = matchCustomer(c, locals);
      const state = linkState(m);
      await fin.linkPut({ provider: 'quickbooks', kind: 'customer', externalId: c.id, localId: m.clientId, state, rule: m.rule === 'none' ? 'none' : m.outcome === 'ambiguous' ? 'ambiguous' : m.outcome === 'conflict' ? 'already_linked' : m.rule, differences: m.differences, syncToken: c.syncToken });
      counts[state === 'needs_review' ? 'needsReview' : state] += 1;
    }
    if (rows.length < PAGE) { done = true; break; }
    position += rows.length;
  }
  // A finished pass starts again from the top next time; an unfinished one continues where it stopped.
  await ctx.cursor.set('customers.position', String(done ? 1 : position));
  if (apply) counts.applied = (await fin.linksApply({ provider: 'quickbooks', kind: 'customer' })).applied;
  // Only a preview a person asked for opens the way to an apply. The scheduled run ("all") does not count as one.
  else if (asked) await ctx.cursor.set('customers.preview_at', started);
  return { ...counts, complete: done, mode: apply ? 'apply' : 'preview' };
}

/** QuickBooks service items as proposals to link catalog services (an invoice line needs the item of its service). */
async function syncItems(ctx) {
  const fin = financeOf(ctx);
  const page = await api(ctx, 'GET', '/query', { query: { query: `select * from Item where Type = 'Service' and Active = true orderby Id startposition 1 maxresults 1000` } });
  const items = (Array.isArray(page.QueryResponse?.Item) ? page.QueryResponse.Item : []).filter((i) => qid(i.Id)).map((i) => ({ externalId: qid(i.Id), name: String(i.Name || '').slice(0, 200), tiers: [] }));
  const locals = (await fin.services('quickbooks')).map((s) => ({ ...s, tiers: [] }));
  const counts = { seen: items.length, linked: 0, proposed: 0, needsReview: 0, unlinked: 0 };
  for (const p of proposeFromRemote(items, locals)) {
    await fin.linkPut({ provider: 'quickbooks', kind: 'service', externalId: p.externalId, localId: p.localId, state: p.state, rule: p.rule, differences: p.differences, proposal: p.proposal ? { name: p.proposal.name, tiers: [] } : null });
    counts[p.state === 'needs_review' ? 'needsReview' : p.state] += 1;
  }
  return { ...counts, mode: 'proposals' };
}

/**
 * Change data capture: what moved in QuickBooks since the stored moment. For something this platform is linked to,
 * a SyncToken other than the stored one means QuickBooks holds a version this platform did not write: "conflict".
 * The stored token is left as it is, so no later update from here can go out looking current and overwrite it.
 */
async function syncChanges(ctx) {
  const fin = financeOf(ctx);
  const now = ctx.now();
  let since = (await ctx.cursor.get('cdc.since')) || '';
  const counts = { seen: 0, unchanged: 0, conflict: 0, unlinked: 0, windowExceeded: false };
  if (!Number.isFinite(Date.parse(since))) {
    // Nothing stored yet: changes are followed from now on. What existed before is read by the customer and item runs.
    await ctx.cursor.set('cdc.since', new Date(now).toISOString());
    return { ...counts, started: true };
  }
  if (now - Date.parse(since) > CDC_MAX_DAYS * 86400000) { since = new Date(now - CDC_MAX_DAYS * 86400000).toISOString(); counts.windowExceeded = true; }
  const data = await api(ctx, 'GET', '/cdc', { query: { entities: 'Customer,Invoice,Payment', changedSince: since } });
  const groups = (Array.isArray(data.CDCResponse) ? data.CDCResponse : []).flatMap((r) => (Array.isArray(r.QueryResponse) ? r.QueryResponse : []));
  for (const [name, kind] of [['Customer', 'customer'], ['Invoice', 'invoice'], ['Payment', 'payment']]) {
    for (const g of groups) for (const e of Array.isArray(g[name]) ? g[name] : []) {
      const id = qid(e.Id);
      if (!id) continue;
      counts.seen += 1;
      const link = await fin.linkByExternal('quickbooks', kind, id);
      if (!link || !link.localId) { counts.unlinked += 1; continue; }
      const deleted = e.status === 'Deleted';
      if (!deleted && link.syncToken !== null && link.syncToken !== undefined && qid(e.SyncToken) === String(link.syncToken)) { counts.unchanged += 1; continue; }
      await fin.linkPut({ provider: 'quickbooks', kind, externalId: id, localId: link.localId, state: 'conflict', rule: deleted ? 'remote_deleted' : 'remote_changed', differences: [], syncToken: link.syncToken, hash: link.hash });
      await fin.audit({ provider: 'quickbooks', direction: 'in', action: `${kind}.conflict`, entity: kind, localId: link.localId, externalId: id, outcome: 'conflict', code: deleted ? 'remote_deleted' : 'remote_changed' });
      counts.conflict += 1;
    }
  }
  const stamp = typeof data.time === 'string' && Number.isFinite(Date.parse(data.time)) ? new Date(data.time).toISOString() : new Date(now).toISOString();
  await ctx.cursor.set('cdc.since', stamp);
  return counts;
}

/** One write to QuickBooks with its audit record, whatever happens. `run` makes the call and returns the entity. */
async function audited(ctx, entry, run) {
  const fin = financeOf(ctx);
  try {
    const out = await run();
    await fin.audit({ provider: 'quickbooks', direction: 'out', outcome: 'ok', ...entry, externalId: qid(out?.Id) || entry.externalId || null });
    return out;
  } catch (e) {
    const code = e instanceof ProviderError ? e.code : 'failed';
    await fin.audit({ provider: 'quickbooks', direction: 'out', outcome: code === 'sync_conflict' ? 'conflict' : code.startsWith('duplicate') ? 'refused' : 'failed', code, ...entry });
    throw e;
  }
}

const invoiceBody = (src) => ({
  CustomerRef: { value: src.customerExternalId },
  ...(src.number ? { DocNumber: String(src.number).slice(0, 21) } : {}),
  ...(src.date ? { TxnDate: src.date } : {}),
  Line: [{ Amount: Number(centsToDecimal(src.cents)), DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: src.itemExternalId }, Qty: 1 } }],
});

export default {
  id: 'quickbooks',
  name: 'QuickBooks Online',
  kind: 'oauth',
  env: ['QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET', 'QUICKBOOKS_ENVIRONMENT', 'QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN'],
  scopes: ['com.intuit.quickbooks.accounting'],
  approval: { needed: true, flag: 'QUICKBOOKS_APPROVED', note: 'Intuit reviews an app before it may connect to real company books. Sandbox companies work with development keys.' },

  /** Intuit's consent page. The exchange is authenticated with the client secret from the server; the signed state is single use. */
  authUrl(ctx) {
    environment(ctx);
    const u = new URL(AUTHORIZE);
    for (const [k, v] of Object.entries({ client_id: ctx.env('QUICKBOOKS_CLIENT_ID'), response_type: 'code', scope: this.scopes.join(' '), redirect_uri: ctx.redirectUri, state: ctx.state })) u.searchParams.set(k, v);
    return u.toString();
  },

  /** Code for tokens, server side. The realm id (which company) came back on the callback address and is sealed with the tokens. */
  async exchange(ctx, code) {
    const realm = String((ctx.params && (ctx.params.realmId || ctx.params.realmid)) || '');
    if (!REALM.test(realm)) throw new ProviderError('realm_missing');
    const raw = await tokenRequest(ctx.fetch, TOKEN, { grant_type: 'authorization_code', code, redirect_uri: ctx.redirectUri }, { basic: basic(ctx) });
    return { ...normaliseTokens(raw, {}, ctx.now()), scope: this.scopes.join(' '), realm_id: realm };
  },

  /**
   * Intuit sends a new refresh token with (almost) every refresh and stops accepting the old one a day later.
   * normaliseTokens takes the new one, and the framework stores the pair before anything else uses it.
   */
  async refresh(ctx, tokens) {
    const raw = await tokenRequest(ctx.fetch, TOKEN, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token }, { basic: basic(ctx) });
    return { ...normaliseTokens(raw, tokens, ctx.now()), scope: tokens.scope || this.scopes.join(' '), realm_id: tokens.realm_id };
  },

  async revoke(ctx, tokens) {
    const b = basic(ctx);
    let res;
    try {
      res = await ctx.fetch(REVOKE, { method: 'POST', headers: { authorization: 'Basic ' + Buffer.from(`${b.id}:${b.secret}`).toString('base64'), 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ token: tokens.refresh_token || tokens.access_token }), signal: AbortSignal.timeout(10000) });
    } catch { throw new ProviderError('provider_unreachable'); }
    if (!res.ok) throw new ProviderError('revoke_failed', { status: res.status });
  },

  /**
   * The verified call behind "connected": QuickBooks answers with the company for this realm. A token that belongs
   * to another company is refused by QuickBooks here (403), which is how a wrong or altered realm id is caught.
   */
  async status(ctx) {
    const mode = environment(ctx);
    const realm = realmOf(ctx);
    let data;
    try { data = await api(ctx, 'GET', '/companyinfo/' + realm); } catch (e) {
      if (e instanceof ProviderError && e.code === 'permission_revoked') return { ok: false, reason: 'wrong_account' };
      throw e;
    }
    if (!data.CompanyInfo || !qid(data.CompanyInfo.Id)) return { ok: false, reason: 'account_unknown' };
    const before = ctx.connection && ctx.connection.account_ref;
    if (before && before !== realm) return { ok: false, reason: 'wrong_account' };
    return { ok: true, account: { label: `${String(data.CompanyInfo.CompanyName || 'QuickBooks').slice(0, 80)} (${mode})`, ref: realm }, scopes: this.scopes };
  },

  async health(ctx) {
    const s = await this.status(ctx);
    return s.ok ? { ok: true, health: 'ok' } : { ok: false, reason: s.reason, reauth: s.reason === 'wrong_account' };
  },

  /** what: "all" (customers preview, item proposals, changes), "customers", "customers:apply", "items", "changes". */
  async sync(ctx, what) {
    const { resource, apply } = parseWhat(what);
    const counts = {};
    if (resource === 'customers' || resource === 'all') counts.customers = await syncCustomers(ctx, apply && resource === 'customers', resource === 'customers');
    if (resource === 'items' || resource === 'all') counts.items = await syncItems(ctx);
    if (resource === 'changes' || resource === 'all') counts.changes = await syncChanges(ctx);
    return { counts };
  },

  webhook: {
    /**
     * Intuit signs the raw body with the app's verifier token (HMAC-SHA256, base64, header intuit-signature).
     * A notification has no id of its own, so the hash of the signed body is used: the same delivery sent again has
     * the same hash and is recorded once. What is kept: realm ids, entity names and counts. No entity id, no content.
     */
    verify(request, raw, ctx) {
      const key = ctx.env('QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN');
      if (!key) return { ok: false, reason: 'not_configured' };
      const given = request.headers.get('intuit-signature') || '';
      if (!given) return { ok: false, reason: 'signature_missing' };
      if (!sameString(given, createHmac('sha256', key).update(raw).digest('base64'))) return { ok: false, reason: 'bad_signature' };
      const body = parseJson(raw);
      const list = body && Array.isArray(body.eventNotifications) ? body.eventNotifications : null;
      if (!list || !list.length || !list.every((n) => n && REALM.test(String(n.realmId || '')))) return { ok: false, reason: 'bad_payload' };
      const entities = list.flatMap((n) => (Array.isArray(n.dataChangeEvent?.entities) ? n.dataChangeEvent.entities : []));
      const newest = Math.max(...entities.map((e) => Date.parse(e && e.lastUpdated)).filter(Number.isFinite), -Infinity);
      // The change times are inside the signed body. A delivery whose newest change is more than a day old is a
      // replay or a very late retry; the scheduled change run covers what it carried.
      if (!fresh(Math.floor(newest / 1000), ctx.now(), EVENT_WINDOW_S)) return { ok: false, reason: 'stale' };
      const realms = [...new Set(list.map((n) => String(n.realmId)))];
      return {
        ok: true, eventId: 'qbo_' + sha256Hex(raw).slice(0, 48), type: 'data_change', accountRef: realms.length === 1 ? realms[0] : null,
        redacted: { type: 'data_change', realms: realms.slice(0, 50), entities: entities.length, names: [...new Set(entities.map((e) => String(e?.name || '')).filter((n) => /^[A-Za-z]{2,40}$/.test(n)))].slice(0, 20) },
      };
    },

    /**
     * A notification says "something changed", not what the books now hold. So it starts the change run for each
     * company it names, and the change run reads the truth from QuickBooks with that company's own token.
     */
    async handle(ctx, event) {
      const realms = Array.isArray(event.redacted?.realms) ? event.redacted.realms.filter((r) => REALM.test(String(r))) : [];
      if (!realms.length) return { ok: true, ignored: true };
      const tenantOf = ctx.tenantOfAccount || (async (realm) => { const c = await serviceRpc('conn_by_account', { p_provider: 'quickbooks', p_account_ref: realm }); return c.ok && c.data ? c.data.tenant_id : null; });
      const queue = ctx.enqueue || enqueue;
      const eventId = String(event.event_id || event.id || '').slice(0, 60);
      let queued = 0;
      for (const realm of realms) {
        const tenant = await tenantOf(realm);
        if (!tenant) continue;
        if (await queue('integration.sync', { provider: 'quickbooks', what: 'changes' }, { tenant, idem: `qbo:${tenant}:${eventId}` })) queued += 1;
      }
      log('quickbooks', 'changes_queued', { queued });
      return { ok: true, ignored: queued === 0, queued };
    },
  },

  actions: {
    /** Creates the QuickBooks customer for a client a person approved for it, and links the two. Once. */
    async createCustomer(ctx, { clientId }) {
      const fin = financeOf(ctx);
      if (!UUID.test(String(clientId || ''))) throw new ProviderError('invalid_request');
      const src = await fin.pushSource({ provider: 'quickbooks', kind: 'customer', id: clientId });
      if (!src) throw new ProviderError('not_found');
      if (src.customerExternalId) return { outcome: 'unchanged', externalId: src.customerExternalId };
      if (!src.approved) throw new ProviderError('approval_required');
      const key = requestId('vxc', ctx.tenantId, clientId);
      const body = { DisplayName: String(src.name).slice(0, 500), ...(src.email ? { PrimaryEmailAddr: { Address: src.email } } : {}), ...(src.phone ? { PrimaryPhone: { FreeFormNumber: src.phone } } : {}) };
      const out = await audited(ctx, { action: 'customer.create', entity: 'customer', localId: clientId, requestId: key }, async () => (await api(ctx, 'POST', '/customer', { body, query: { requestid: key } })).Customer);
      const id = qid(out?.Id);
      if (!id) throw new ProviderError('bad_response');
      await fin.linkPut({ provider: 'quickbooks', kind: 'customer', externalId: id, localId: clientId, state: 'created', rule: 'push', differences: [], syncToken: qid(out.SyncToken) });
      await fin.linksApply({ provider: 'quickbooks', kind: 'customer', states: ['created'] });
      return { outcome: 'created', externalId: id };
    },

    /**
     * Sends the invoice of one engagement. First time: created, with a request id. Later, when the local figures
     * changed: one update carrying the SyncToken stored at the last send. If QuickBooks holds a newer version it
     * answers "stale"; the record becomes "conflict" and nothing further is sent until a person decides.
     */
    async pushInvoice(ctx, { jobId }) {
      const fin = financeOf(ctx);
      if (!UUID.test(String(jobId || ''))) throw new ProviderError('invalid_request');
      const src = await fin.pushSource({ provider: 'quickbooks', kind: 'invoice', id: jobId });
      if (!src) throw new ProviderError('not_found');
      if (!src.customerExternalId) throw new ProviderError('customer_not_linked');
      if (!src.itemExternalId) throw new ProviderError('item_not_mapped');
      if (!Number.isSafeInteger(src.cents) || src.cents <= 0) throw new ProviderError('nothing_due');
      const hash = sha256Hex(`${src.customerExternalId}|${src.itemExternalId}|${src.cents}|${src.number}|${src.date || ''}`);
      const link = await fin.linkGet('quickbooks', 'invoice', jobId);
      if (link && link.state === 'conflict') throw new ProviderError('sync_conflict');
      if (link && link.hash === hash) return { outcome: 'unchanged', externalId: link.externalId };
      if (!link) {
        const key = requestId('vxi', ctx.tenantId, jobId);
        const out = await audited(ctx, { action: 'invoice.create', entity: 'invoice', localId: jobId, requestId: key }, async () => (await api(ctx, 'POST', '/invoice', { body: invoiceBody(src), query: { requestid: key } })).Invoice);
        const id = qid(out?.Id);
        if (!id) throw new ProviderError('bad_response');
        await fin.linkPut({ provider: 'quickbooks', kind: 'invoice', externalId: id, localId: jobId, state: 'linked', rule: 'push', differences: [], syncToken: qid(out.SyncToken), hash });
        return { outcome: 'created', externalId: id };
      }
      const key = requestId('vxu', ctx.tenantId, jobId, hash);
      try {
        const out = await audited(ctx, { action: 'invoice.update', entity: 'invoice', localId: jobId, externalId: link.externalId, requestId: key },
          async () => (await api(ctx, 'POST', '/invoice', { body: { ...invoiceBody(src), Id: link.externalId, SyncToken: String(link.syncToken), sparse: true }, query: { requestid: key } })).Invoice);
        await fin.linkPut({ provider: 'quickbooks', kind: 'invoice', externalId: link.externalId, localId: jobId, state: 'linked', rule: 'push', differences: [], syncToken: qid(out?.SyncToken), hash });
        return { outcome: 'updated', externalId: link.externalId };
      } catch (e) {
        if (e instanceof ProviderError && e.code === 'sync_conflict') {
          // Never read the newer token and try again: that would overwrite what somebody changed in the books.
          await fin.linkPut({ provider: 'quickbooks', kind: 'invoice', externalId: link.externalId, localId: jobId, state: 'conflict', rule: 'stale_token', differences: [], syncToken: link.syncToken, hash: link.hash });
        }
        throw e;
      }
    },

    /** Sends one received payment against its pushed invoice. Created once; a payment already sent is never changed. */
    async pushPayment(ctx, { paymentId }) {
      const fin = financeOf(ctx);
      if (!UUID.test(String(paymentId || ''))) throw new ProviderError('invalid_request');
      const src = await fin.pushSource({ provider: 'quickbooks', kind: 'payment', id: paymentId });
      if (!src) throw new ProviderError('not_found');
      const link = await fin.linkGet('quickbooks', 'payment', paymentId);
      if (link) return { outcome: 'unchanged', externalId: link.externalId };
      if (!src.customerExternalId) throw new ProviderError('customer_not_linked');
      if (!src.invoiceExternalId) throw new ProviderError('invoice_not_pushed');
      if (!Number.isSafeInteger(src.cents) || src.cents <= 0) throw new ProviderError('nothing_due');
      const key = requestId('vxp', ctx.tenantId, paymentId);
      const amount = Number(centsToDecimal(src.cents));
      const body = { CustomerRef: { value: src.customerExternalId }, TotalAmt: amount, ...(src.date ? { TxnDate: src.date } : {}), Line: [{ Amount: amount, LinkedTxn: [{ TxnId: src.invoiceExternalId, TxnType: 'Invoice' }] }] };
      const out = await audited(ctx, { action: 'payment.create', entity: 'payment', localId: paymentId, requestId: key }, async () => (await api(ctx, 'POST', '/payment', { body, query: { requestid: key } })).Payment);
      const id = qid(out?.Id);
      if (!id) throw new ProviderError('bad_response');
      // What QuickBooks says it booked must be what was sent, to the cent. Anything else is for a person.
      const booked = toCents(out.TotalAmt);
      await fin.linkPut({ provider: 'quickbooks', kind: 'payment', externalId: id, localId: paymentId, state: booked === src.cents ? 'linked' : 'conflict', rule: booked === src.cents ? 'push' : 'amount_differs', differences: [], syncToken: qid(out.SyncToken) });
      return { outcome: 'created', externalId: id };
    },
  },
};
