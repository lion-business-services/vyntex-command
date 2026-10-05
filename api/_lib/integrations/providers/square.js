// Square: the payments a company takes from its own clients (never the platform's subscription billing).
// OAuth, customers, the item catalog, payments, invoices, refunds, a payment link for an appointment fee.
//
// What this adapter will and will not do:
//   customers  read from Square and matched to clients (stored id, then email, then phone). A match is a link. No
//              local field is overwritten; a difference is reported as "needs review".
//   catalog    read from Square as proposals. Pushing to Square is INSERT ONLY: new objects with an idempotency key.
//              Nothing that exists at Square is ever updated or deleted; what would be an update is reported.
//   payments   a payment is recorded once, by its Square payment id, against the record the fixed rules name
//              (finance/reconcile.js). What the rules cannot place goes to the unmatched list for a person.
//   refunds    read only: recorded when Square reports them. This platform never issues a refund.
//   cards      no card data is requested, read, logged or stored. The card fields Square returns with a payment are
//              dropped the moment the answer is read (slimPayment).
// Bulk writes (linking many clients, creating catalog objects) run as a preview first; "apply" is a separate,
// explicit run that is refused when no recent preview exists.
//
// Settings: SQUARE_APPLICATION_ID, SQUARE_APPLICATION_SECRET, SQUARE_ENVIRONMENT ("sandbox" or "production", nothing
//           else is accepted and there is no default), SQUARE_WEBHOOK_SIGNATURE_KEY.
//           Optional: SQUARE_OAUTH_FLOW ("code", the default, or "pkce"), SQUARE_API_VERSION, SQUARE_WEBHOOK_URL (the
//           exact notification address registered at Square when it differs from APP_ORIGIN + /api/webhooks/square),
//           SQUARE_EXPECTED_MERCHANT_ID (a deployment that serves one company can refuse any other Square account).
// Not proven against Square: no credentials exist in this build. Written from Square's public API and tested with
// mocked responses only.
import { createHmac } from 'node:crypto';
import { ProviderError } from '../oauth.js';
import { fresh, parseJson } from '../webhook.js';
import { sameString } from '../../crypto.js';
import { log } from '../../respond.js';
import { squareMoney } from '../finance/money.js';
import { matchCustomer, linkState } from '../finance/match.js';
import { reconcilePayment, reconcileRefund, parseRefs, refCode } from '../finance/reconcile.js';
import { slimSquareItem, proposeFromRemote, planSquarePush, assertInsertOnly } from '../finance/catalog.js';
import { financeOf } from '../finance/port.js';

const HOSTS = { sandbox: 'https://connect.squareupsandbox.com', production: 'https://connect.squareup.com' };
const DEFAULT_VERSION = '2025-01-23';
const ID = /^[A-Za-z0-9_:#-]{1,192}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGES_PER_RUN = 20;
const PREVIEW_HOURS = 24;
// Square repeats a delivery that was not answered for about a day, with the same signed creation time. The event id
// is what stops a replay (an id is recorded once), so the window here only has to cover Square's own retries.
const EVENT_WINDOW_S = 25 * 3600;

/** "sandbox" or "production". Anything else is a configuration mistake and never falls back to production. */
export function environment(ctx) {
  const v = String(ctx.env('SQUARE_ENVIRONMENT') || '').trim().toLowerCase();
  if (v !== 'sandbox' && v !== 'production') throw new ProviderError('environment_invalid');
  return v;
}
const host = (ctx) => HOSTS[environment(ctx)];
const flow = (ctx) => (String(ctx.env('SQUARE_OAUTH_FLOW') || '').toLowerCase() === 'pkce' ? 'pkce' : 'code');
const version = (ctx) => (/^\d{4}-\d{2}-\d{2}$/.test(ctx.env('SQUARE_API_VERSION') || '') ? ctx.env('SQUARE_API_VERSION') : DEFAULT_VERSION);
const safeId = (v) => (typeof v === 'string' && ID.test(v) ? v : null);

/** Square names its errors ({ errors: [{ category, code }] }). Only the code is read, never the detail text. */
function failure(status, data) {
  const code = Array.isArray(data?.errors) && typeof data.errors[0]?.code === 'string' ? data.errors[0].code : '';
  if (status === 401) return new ProviderError(code === 'ACCESS_TOKEN_EXPIRED' ? 'token_expired' : code === 'ACCESS_TOKEN_REVOKED' ? 'token_revoked' : 'token_rejected', { reauth: true, status });
  if (status === 403) return new ProviderError(code === 'INSUFFICIENT_SCOPES' ? 'permission_revoked' : 'forbidden', { reauth: code === 'INSUFFICIENT_SCOPES', status });
  if (status === 429) return new ProviderError('rate_limited', { status });
  if (status === 404) return new ProviderError('not_found', { status });
  if (status === 409) return new ProviderError('conflict', { status });
  if (status >= 500) return new ProviderError('provider_error', { status });
  return new ProviderError('request_rejected', { status });
}

async function send(ctx, method, path, { body, auth } = {}) {
  let res;
  try {
    res = await ctx.fetch(host(ctx) + path, {
      method,
      headers: { authorization: auth || 'Bearer ' + (ctx.tokens && ctx.tokens.access_token), 'square-version': version(ctx), accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new ProviderError('provider_unreachable');
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw failure(res.status, data);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ProviderError('bad_response', { status: res.status });
  return data;
}
function api(ctx, method, path, body) {
  if (!ctx.tokens || !ctx.tokens.access_token) throw new ProviderError('not_connected');
  return send(ctx, method, path, { body });
}

/** Square's token answer in the framework's shape. Square sends the expiry as a time, not as a number of seconds. */
function tokensFrom(raw, previous = {}) {
  if (!raw || typeof raw.access_token !== 'string' || !raw.access_token) throw new ProviderError('token_exchange_failed');
  const at = typeof raw.expires_at === 'string' && Number.isFinite(Date.parse(raw.expires_at)) ? new Date(raw.expires_at).toISOString() : null;
  return {
    access_token: raw.access_token,
    // In the PKCE flow Square rotates the refresh token on every use; in the code flow it stays. Either way: keep the newest.
    refresh_token: String(raw.refresh_token || previous.refresh_token || ''),
    expires_at: at, scope: previous.scope || '', token_type: 'Bearer',
    merchant_id: safeId(raw.merchant_id) || previous.merchant_id || null,
  };
}

async function tokenCall(ctx, body, { refreshing = false } = {}) {
  let res;
  try {
    res = await ctx.fetch(host(ctx) + '/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'square-version': version(ctx) }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  } catch {
    throw new ProviderError('provider_unreachable');
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (res.ok && data && typeof data.access_token === 'string' && data.access_token) return data;
  if (res.status === 429) throw new ProviderError('rate_limited', { status: 429 });
  if (res.status >= 500) throw new ProviderError('provider_error', { status: res.status });
  // 400 or 401 on a refresh: Square no longer accepts this refresh token (revoked by the seller, or used twice).
  if (refreshing) throw new ProviderError('token_revoked', { reauth: true, status: res.status });
  throw new ProviderError('token_exchange_failed', { status: res.status });
}

/** A Square payment reduced to what reconciliation needs. Card details, receipt links and buyer fields are not kept. */
export function slimPayment(raw) {
  const money = squareMoney(raw && raw.amount_money);
  if (!raw || !safeId(raw.id) || !money || typeof raw.status !== 'string') throw new ProviderError('bad_response');
  const status = { COMPLETED: 'completed', APPROVED: 'pending', PENDING: 'pending', CANCELED: 'cancelled', FAILED: 'failed' }[raw.status] || 'unknown';
  return {
    externalId: raw.id, status, cents: money.cents, currency: money.currency,
    orderId: safeId(raw.order_id), customerId: safeId(raw.customer_id),
    referenceId: typeof raw.reference_id === 'string' ? raw.reference_id.slice(0, 60) : '',
    // Only this platform's codes are taken out of the note. The note itself (free text typed by a person) is not kept.
    note: parseRefs(raw.note).map((r) => refCode(r.kind, r.id)).join(' '),
    occurredAt: typeof raw.created_at === 'string' && Number.isFinite(Date.parse(raw.created_at)) ? new Date(raw.created_at).toISOString() : null,
  };
}

/** One payment through the rules and into the ledger. Safe to call any number of times for the same payment. */
export async function reconcileOne(ctx, raw, eventId = null) {
  const fin = financeOf(ctx);
  const p = slimPayment(raw);
  const world = await fin.candidates({ provider: 'square', refs: parseRefs(`${p.referenceId} ${p.note}`), orderId: p.orderId, customerId: p.customerId });
  const decision = reconcilePayment(p, world);
  if (decision.outcome === 'ignored') return { outcome: 'ignored', reason: decision.reason };
  const rec = await fin.paymentRecord({ provider: 'square', externalId: p.externalId, cents: p.cents, currency: p.currency, occurredAt: p.occurredAt, decision, clientId: world.clientId, eventId });
  // Ids and outcomes only: no name, and no amount next to anything that identifies a person.
  log('square', 'payment_reconciled', { payment: p.externalId, outcome: rec.fresh ? decision.outcome : 'duplicate', rule: decision.rule || decision.reason || '' });
  return { outcome: rec.fresh ? decision.outcome : 'duplicate', rule: decision.rule || null, reason: decision.reason || null, balanceCents: rec.balanceCents, context: decision.context || null };
}

async function reconcileRefundOne(ctx, raw, eventId = null) {
  const fin = financeOf(ctx);
  const money = squareMoney(raw && raw.amount_money);
  if (!raw || !safeId(raw.id) || !safeId(raw.payment_id) || !money) throw new ProviderError('bad_response');
  const refund = { externalId: raw.id, paymentExternalId: raw.payment_id, status: raw.status === 'COMPLETED' ? 'completed' : 'pending', cents: money.cents, currency: money.currency };
  const decision = reconcileRefund(refund, await fin.paymentGet('square', refund.paymentExternalId));
  if (decision.outcome === 'ignored') return { outcome: 'ignored', reason: decision.reason };
  const rec = await fin.refundRecord({ provider: 'square', ...refund, decision, eventId });
  log('square', 'refund_recorded', { refund: refund.externalId, outcome: rec.fresh ? decision.outcome : 'duplicate' });
  return { outcome: rec.fresh ? decision.outcome : 'duplicate', reason: decision.reason || null, balanceCents: rec.balanceCents };
}

/** "customers", "catalog:apply" ... -> { resource, apply }. Unknown words are refused rather than read as "all". */
function parseWhat(what) {
  const [resource, mode] = String(what || 'all').split(':');
  if (!['all', 'customers', 'catalog', 'catalog_push', 'payments'].includes(resource) || (mode !== undefined && mode !== 'apply' && mode !== 'preview')) throw new ProviderError('sync_unknown');
  return { resource, apply: mode === 'apply' };
}

/** An apply run needs a preview of the same resource from the last day: nobody writes in bulk what nobody looked at. */
async function requirePreview(ctx, resource) {
  const at = Date.parse((await ctx.cursor.get(resource + '.preview_at')) || '');
  if (!Number.isFinite(at) || ctx.now() - at > PREVIEW_HOURS * 3600000) throw new ProviderError('preview_required');
}

async function syncCustomers(ctx, apply, asked) {
  const fin = financeOf(ctx);
  if (apply) await requirePreview(ctx, 'customers');
  const started = new Date(ctx.now()).toISOString();
  const since = (await ctx.cursor.get('customers.since')) || null;
  let cursor = (await ctx.cursor.get('customers.cursor')) || null;
  const locals = await fin.clients('square');
  const counts = { seen: 0, linked: 0, proposed: 0, needsReview: 0, unlinked: 0, applied: 0 };
  let pages = 0; let done = false;
  while (pages < PAGES_PER_RUN) {
    const body = { limit: 100, query: { sort: { field: 'CREATED_AT', order: 'ASC' }, ...(since ? { filter: { updated_at: { start_at: since } } } : {}) }, ...(cursor ? { cursor } : {}) };
    let page;
    try { page = await api(ctx, 'POST', '/v2/customers/search', body); } catch (e) {
      // A cursor from an earlier run that Square no longer accepts: start this window again instead of failing forever.
      if (cursor && e instanceof ProviderError && e.code === 'request_rejected') { cursor = null; await ctx.cursor.set('customers.cursor', ''); continue; }
      throw e;
    }
    pages += 1;
    for (const c of Array.isArray(page.customers) ? page.customers : []) {
      if (!c || !safeId(c.id)) continue;
      counts.seen += 1;
      const remote = { id: c.id, name: [c.given_name, c.family_name].filter(Boolean).join(' ') || c.company_name || '', email: c.email_address || '', phone: c.phone_number || '' };
      const m = matchCustomer(remote, locals);
      const state = linkState(m);
      await fin.linkPut({ provider: 'square', kind: 'customer', externalId: c.id, localId: m.clientId, state, rule: m.rule === 'none' ? 'none' : m.outcome === 'ambiguous' ? 'ambiguous' : m.outcome === 'conflict' ? 'already_linked' : m.rule, differences: m.differences });
      counts[state === 'needs_review' ? 'needsReview' : state] += 1;
    }
    cursor = typeof page.cursor === 'string' && page.cursor ? page.cursor : null;
    if (!cursor) { done = true; break; }
  }
  await ctx.cursor.set('customers.cursor', cursor || '');
  if (done) await ctx.cursor.set('customers.since', started);
  if (apply) counts.applied = (await fin.linksApply({ provider: 'square', kind: 'customer' })).applied;
  // Only a preview a person asked for opens the way to an apply. The scheduled run ("all") does not count as one.
  else if (asked) await ctx.cursor.set('customers.preview_at', started);
  return { ...counts, complete: done, mode: apply ? 'apply' : 'preview' };
}

async function listCatalog(ctx) {
  const items = []; let cursor = null; let pages = 0;
  do {
    const page = await api(ctx, 'GET', '/v2/catalog/list?types=ITEM' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
    for (const o of Array.isArray(page.objects) ? page.objects : []) { const s = slimSquareItem(o); if (s) items.push(s); }
    cursor = typeof page.cursor === 'string' && page.cursor ? page.cursor : null;
    pages += 1;
  } while (cursor && pages < PAGES_PER_RUN);
  // A push decides what is new from this list. A list that was cut short could make an existing item look new.
  return { items, complete: !cursor };
}

async function syncCatalog(ctx) {
  const fin = financeOf(ctx);
  const { items, complete } = await listCatalog(ctx);
  const proposals = proposeFromRemote(items, await fin.services('square'));
  const counts = { seen: items.length, linked: 0, proposed: 0, needsReview: 0, unlinked: 0 };
  for (const p of proposals) {
    await fin.linkPut({ provider: 'square', kind: 'service', externalId: p.externalId, localId: p.localId, state: p.state, rule: p.rule, differences: p.differences, proposal: p.proposal || null });
    counts[p.state === 'needs_review' ? 'needsReview' : p.state] += 1;
  }
  return { ...counts, complete, mode: 'proposals' };
}

/** Local services to Square, insert only. Preview by default; "catalog_push:apply" creates, after a preview. */
async function pushCatalog(ctx, apply) {
  const fin = financeOf(ctx);
  if (apply) await requirePreview(ctx, 'catalog_push');
  const { items, complete } = await listCatalog(ctx);
  if (!complete) throw new ProviderError('catalog_too_large');
  const main = await api(ctx, 'GET', '/v2/locations/main');
  const currency = typeof main.location?.currency === 'string' && /^[A-Z]{3}$/.test(main.location.currency) ? main.location.currency : null;
  if (!currency) throw new ProviderError('bad_response');
  const plan = planSquarePush(await fin.services('square'), items, { tenantId: ctx.tenantId, currency });
  const counts = { create: plan.create.length, refused: plan.refused.length, unchanged: plan.unchanged.length, created: 0, mode: apply ? 'apply' : 'preview' };
  for (const r of plan.refused) {
    // Reported every time, done never: this is the "would be an update" list a person reads.
    await fin.audit({ provider: 'square', direction: 'out', action: 'catalog.update_refused', entity: 'service', localId: r.serviceId, outcome: 'refused', code: r.reason });
  }
  if (!apply) { await ctx.cursor.set('catalog_push.preview_at', new Date(ctx.now()).toISOString()); return { ...counts, refusedList: plan.refused }; }
  for (const c of plan.create) {
    const object = assertInsertOnly(c.object);
    let out;
    try {
      out = await api(ctx, 'POST', '/v2/catalog/object', { idempotency_key: c.idempotencyKey, object });
    } catch (e) {
      await fin.audit({ provider: 'square', direction: 'out', action: 'catalog.create', entity: 'service', localId: c.serviceId, requestId: c.idempotencyKey, outcome: 'failed', code: e instanceof ProviderError ? e.code : 'failed' });
      throw e;
    }
    const newId = safeId(out.catalog_object?.id);
    if (!newId || newId.startsWith('#')) throw new ProviderError('bad_response');
    await fin.linkPut({ provider: 'square', kind: 'service', externalId: newId, localId: c.serviceId, state: 'created', rule: 'push', differences: [] });
    const map = new Map((Array.isArray(out.id_mappings) ? out.id_mappings : []).map((m) => [m.client_object_id, m.object_id]));
    for (const t of c.tierIds) {
      const tid = safeId(map.get(t.clientId));
      if (tid) await fin.linkPut({ provider: 'square', kind: 'tier', externalId: tid, localId: t.tierId, state: 'created', rule: 'push', differences: [] });
    }
    await fin.audit({ provider: 'square', direction: 'out', action: 'catalog.create', entity: 'service', localId: c.serviceId, externalId: newId, requestId: c.idempotencyKey, outcome: 'ok' });
    counts.created += 1;
  }
  // Only what this run created is written onto the catalog. A link that was merely proposed by name stays a proposal.
  await fin.linksApply({ provider: 'square', kind: 'service', states: ['created'] });
  await fin.linksApply({ provider: 'square', kind: 'tier', states: ['created'] });
  return { ...counts, refusedList: plan.refused };
}

/** The safety net under the webhooks: payments since the last run, through the same rules. A repeat changes nothing. */
async function syncPayments(ctx) {
  const started = new Date(ctx.now()).toISOString();
  const since = (await ctx.cursor.get('payments.since')) || new Date(ctx.now() - 7 * 86400000).toISOString();
  const counts = { seen: 0, matched: 0, unmatched: 0, ambiguous: 0, duplicate: 0, ignored: 0 };
  let cursor = null; let pages = 0;
  do {
    const page = await api(ctx, 'GET', `/v2/payments?sort_order=ASC&limit=100&begin_time=${encodeURIComponent(since)}` + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
    for (const raw of Array.isArray(page.payments) ? page.payments : []) {
      counts.seen += 1;
      const r = await reconcileOne(ctx, raw);
      counts[r.outcome] = (counts[r.outcome] || 0) + 1;
    }
    cursor = typeof page.cursor === 'string' && page.cursor ? page.cursor : null;
    pages += 1;
  } while (cursor && pages < PAGES_PER_RUN);
  // The window only moves forward when every page of it was read: a payment is never skipped by a cut-off run.
  if (!cursor) await ctx.cursor.set('payments.since', started);
  return { ...counts, complete: !cursor };
}

export default {
  id: 'square',
  name: 'Square',
  kind: 'oauth',
  env: ['SQUARE_APPLICATION_ID', 'SQUARE_APPLICATION_SECRET', 'SQUARE_ENVIRONMENT', 'SQUARE_WEBHOOK_SIGNATURE_KEY'],
  // The least that covers what is built: reading the merchant, customers, items, payments, orders and invoices;
  // ITEMS_WRITE only for the insert-only catalog push; PAYMENTS_WRITE and ORDERS_WRITE only for payment links.
  scopes: ['MERCHANT_PROFILE_READ', 'CUSTOMERS_READ', 'ITEMS_READ', 'ITEMS_WRITE', 'PAYMENTS_READ', 'PAYMENTS_WRITE', 'ORDERS_READ', 'ORDERS_WRITE', 'INVOICES_READ'],
  approval: null,

  /**
   * Square has two flows. "code" (the default) is for a server that keeps a secret: the exchange is authenticated
   * with the application secret. "pkce" is Square's flow without a secret: the challenge goes out here and the
   * verifier replaces the secret at the exchange. The signed, single-use state is sent in both.
   */
  authUrl(ctx) {
    const u = new URL(host(ctx) + '/oauth2/authorize');
    u.searchParams.set('client_id', ctx.env('SQUARE_APPLICATION_ID'));
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', this.scopes.join(' '));
    u.searchParams.set('state', ctx.state);
    u.searchParams.set('redirect_uri', ctx.redirectUri);
    // Production: the seller always signs in on Square's page, so the account they attach is the one they chose.
    if (environment(ctx) === 'production') u.searchParams.set('session', 'false');
    if (flow(ctx) === 'pkce') { u.searchParams.set('code_challenge', ctx.challenge); u.searchParams.set('code_challenge_method', 'S256'); }
    return u.toString();
  },

  async exchange(ctx, code) {
    const body = { client_id: ctx.env('SQUARE_APPLICATION_ID'), grant_type: 'authorization_code', code, redirect_uri: ctx.redirectUri };
    if (flow(ctx) === 'pkce') body.code_verifier = ctx.verifier; else body.client_secret = ctx.env('SQUARE_APPLICATION_SECRET');
    return tokensFrom(await tokenCall(ctx, body));
  },

  async refresh(ctx, tokens) {
    const body = { client_id: ctx.env('SQUARE_APPLICATION_ID'), grant_type: 'refresh_token', refresh_token: tokens.refresh_token };
    if (flow(ctx) !== 'pkce') body.client_secret = ctx.env('SQUARE_APPLICATION_SECRET');
    return tokensFrom(await tokenCall(ctx, body, { refreshing: true }), tokens);
  },

  async revoke(ctx, tokens) {
    await send(ctx, 'POST', '/oauth2/revoke', { auth: 'Client ' + ctx.env('SQUARE_APPLICATION_SECRET'), body: { client_id: ctx.env('SQUARE_APPLICATION_ID'), access_token: tokens.access_token } });
  },

  /**
   * The verified call behind "connected": Square says which merchant this token belongs to. The environment is part
   * of the label, so a sandbox connection can never be mistaken for a live one on the screen.
   */
  async status(ctx) {
    const mode = environment(ctx);
    const me = await api(ctx, 'GET', '/v2/merchants/me');
    const id = safeId(me.merchant?.id);
    if (!id) return { ok: false, reason: 'account_unknown' };
    if (me.merchant.status && me.merchant.status !== 'ACTIVE') return { ok: false, reason: 'account_inactive' };
    const expected = ctx.env('SQUARE_EXPECTED_MERCHANT_ID');
    const before = ctx.connection && ctx.connection.account_ref;
    if ((expected && expected !== id) || (before && before !== id)) return { ok: false, reason: 'wrong_account' };
    return { ok: true, account: { label: `${String(me.merchant.business_name || 'Square').slice(0, 80)} (${mode})`, ref: id }, scopes: this.scopes };
  },

  async health(ctx) {
    const s = await this.status(ctx);
    return s.ok ? { ok: true, health: 'ok' } : { ok: false, reason: s.reason, reauth: s.reason === 'wrong_account' };
  },

  /**
   * what: "all" (customers preview, catalog proposals, payments), "customers", "customers:apply", "catalog",
   *       "catalog_push", "catalog_push:apply", "payments". The scheduled run uses "all", which writes no client
   *       and no catalog row: it proposes, and it reconciles payments (each recorded once).
   */
  async sync(ctx, what) {
    const { resource, apply } = parseWhat(what);
    const counts = {};
    if (resource === 'customers' || resource === 'all') counts.customers = await syncCustomers(ctx, apply && resource === 'customers', resource === 'customers');
    if (resource === 'catalog' || resource === 'all') counts.catalog = await syncCatalog(ctx);
    if (resource === 'catalog_push') counts.catalogPush = await pushCatalog(ctx, apply);
    if (resource === 'payments' || resource === 'all') counts.payments = await syncPayments(ctx);
    return { counts };
  },

  webhook: {
    /**
     * Square signs the notification address followed by the raw body (HMAC-SHA256, base64, header
     * x-square-hmacsha256-signature). The address must be the one registered at Square, character for character.
     * What is kept: the event type and Square's ids. No amount, no buyer, no card.
     */
    verify(request, raw, ctx) {
      const key = ctx.env('SQUARE_WEBHOOK_SIGNATURE_KEY');
      const url = ctx.env('SQUARE_WEBHOOK_URL') || (ctx.env('APP_ORIGIN') ? ctx.env('APP_ORIGIN').replace(/\/+$/, '') + '/api/webhooks/square' : '');
      if (!key || !url) return { ok: false, reason: 'not_configured' };
      const given = request.headers.get('x-square-hmacsha256-signature') || '';
      if (!given) return { ok: false, reason: 'signature_missing' };
      const expected = createHmac('sha256', key).update(url).update(raw).digest('base64');
      if (!sameString(given, expected)) return { ok: false, reason: 'bad_signature' };
      const body = parseJson(raw);
      if (!body || !safeId(body.event_id) || typeof body.type !== 'string' || !/^[a-z_.]{3,60}$/.test(body.type) || !safeId(body.merchant_id)) return { ok: false, reason: 'bad_payload' };
      // The creation time is inside the signed body, so it can be trusted once the signature passed.
      if (!fresh(Math.floor(Date.parse(body.created_at || '') / 1000), ctx.now(), EVENT_WINDOW_S)) return { ok: false, reason: 'stale' };
      return {
        ok: true, eventId: body.event_id, type: body.type, accountRef: body.merchant_id,
        redacted: { type: body.type, object_type: typeof body.data?.type === 'string' ? body.data.type.slice(0, 40) : null, object_id: safeId(body.data?.id), created_at: new Date(body.created_at).toISOString() },
      };
    },

    /** Acts on a recorded event. The details are read from Square by id with the company's own token, never from the event. */
    async handle(ctx, event) {
      const type = event.redacted?.type || '';
      const id = safeId(event.redacted?.object_id);
      if (!['payment.created', 'payment.updated', 'invoice.payment_made', 'refund.created', 'refund.updated'].includes(type)) return { ok: true, ignored: true };
      if (!id) throw new ProviderError('bad_payload');
      if (!ctx.tokens) throw new ProviderError('not_connected');
      const eventId = event.event_id || event.id || null;
      if (type.startsWith('payment.')) {
        const r = await reconcileOne(ctx, (await api(ctx, 'GET', '/v2/payments/' + encodeURIComponent(id))).payment, eventId);
        return { ok: true, ignored: r.outcome === 'ignored', result: r };
      }
      if (type.startsWith('refund.')) {
        const r = await reconcileRefundOne(ctx, (await api(ctx, 'GET', '/v2/refunds/' + encodeURIComponent(id))).refund, eventId);
        return { ok: true, ignored: r.outcome === 'ignored', result: r };
      }
      // An invoice was paid: the money is a payment on the invoice's order. Each tender of that order goes through
      // the same rules; a payment already recorded by its own event is a duplicate and changes nothing.
      const invoice = (await api(ctx, 'GET', '/v2/invoices/' + encodeURIComponent(id))).invoice;
      const orderId = safeId(invoice?.order_id);
      if (!orderId) throw new ProviderError('bad_response');
      const order = (await api(ctx, 'GET', '/v2/orders/' + encodeURIComponent(orderId))).order;
      const results = [];
      for (const tender of Array.isArray(order?.tenders) ? order.tenders : []) {
        const pid = safeId(tender?.payment_id) || safeId(tender?.id);
        if (pid) results.push(await reconcileOne(ctx, (await api(ctx, 'GET', '/v2/payments/' + encodeURIComponent(pid))).payment, eventId));
      }
      return { ok: true, ignored: results.length === 0, result: results };
    },
  },

  actions: {
    /**
     * A Square checkout page for what is still owed on one appointment. Returns { url, orderId, linkId, cents }.
     * The order carries this platform's code for the appointment, and the order id is stored, so the payment that
     * follows is matched by rule 1. The same appointment and amount always use the same idempotency key: a second
     * click gets the same link, not a second order. The page is Square's: no card field exists on this platform.
     */
    async createPaymentLink(ctx, { appointmentId }) {
      const fin = financeOf(ctx);
      if (!UUID.test(String(appointmentId || ''))) throw new ProviderError('invalid_request');
      const a = await fin.context('appointment', appointmentId);
      if (!a) throw new ProviderError('not_found');
      if (!a.open) throw new ProviderError('context_closed');
      const cents = a.dueCents - a.paidCents;
      if (!Number.isSafeInteger(cents) || cents <= 0) throw new ProviderError('nothing_due');
      const main = await api(ctx, 'GET', '/v2/locations/main');
      const locationId = safeId(main.location?.id);
      const currency = typeof main.location?.currency === 'string' && /^[A-Z]{3}$/.test(main.location.currency) ? main.location.currency : null;
      if (!locationId || !currency) throw new ProviderError('bad_response');
      if (a.currency && a.currency !== currency) throw new ProviderError('currency_mismatch');
      const ref = refCode('appointment', appointmentId);
      const key = `vx-pl-${ref}-${cents}`;
      let out;
      try {
        out = await api(ctx, 'POST', '/v2/online-checkout/payment-links', {
          idempotency_key: key, payment_note: ref,
          order: { location_id: locationId, reference_id: ref, line_items: [{ name: 'Appointment fee', quantity: '1', base_price_money: { amount: cents, currency } }] },
        });
      } catch (e) {
        await fin.audit({ provider: 'square', direction: 'out', action: 'payment_link.create', entity: 'appointment', localId: appointmentId, requestId: key, outcome: 'failed', code: e instanceof ProviderError ? e.code : 'failed' });
        throw e;
      }
      const link = out.payment_link || {};
      const orderId = safeId(link.order_id);
      if (!orderId || typeof link.url !== 'string' || !/^https:\/\//.test(link.url)) throw new ProviderError('bad_response');
      await fin.intentPut({ provider: 'square', orderId, linkId: safeId(link.id), kind: 'appointment', id: appointmentId, cents });
      await fin.audit({ provider: 'square', direction: 'out', action: 'payment_link.create', entity: 'appointment', localId: appointmentId, externalId: orderId, requestId: key, outcome: 'ok' });
      return { url: link.url, orderId, linkId: safeId(link.id), cents, currency };
    },
  },
};
