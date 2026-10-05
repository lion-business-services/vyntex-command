// Dialpad: the company's business phone. Users and numbers, the call log, call events as they happen, click to call,
// and text messages where the account has them.
//
// Two ways to connect, behind one adapter. Which one applies is a setting, because it depends on the Dialpad account:
//   DIALPAD_AUTH_MODE=oauth    (default) an OAuth app registered with Dialpad. Each company signs in at Dialpad.
//   DIALPAD_AUTH_MODE=api_key  a company admin's API key, held by the deployment (DIALPAD_API_KEY).
// What an account may do (list calls, subscribe to call events, start a call through the API, send texts, read text
// content) is decided by its Dialpad plan and by the scopes Dialpad granted. This adapter does not assume any of it:
// a call Dialpad refuses comes back as a code, and click to call falls back to a link that the Dialpad app or the
// phone opens, marked as a link and never reported as a call that was placed.
//
// Settings: DIALPAD_CLIENT_ID, DIALPAD_CLIENT_SECRET (oauth) or DIALPAD_API_KEY (api_key), DIALPAD_WEBHOOK_SECRET,
//           DIALPAD_APPROVED (oauth), DIALPAD_ENVIRONMENT (optional: sandbox), DIALPAD_SMS_ENABLED (optional: true),
//           DIALPAD_WEBHOOK_MAX_AGE_S (optional).
// Not proven against the live service: no account exists in this build. Tested with mocked responses.
import { authorizeUrl, tokenRequest, normaliseTokens, ProviderError } from '../oauth.js';
import { hmac, fresh, REPLAY_WINDOW_S } from '../webhook.js';
import { sameString } from '../../crypto.js';
import { env } from '../../env.js';
import { toMessage, toStatus, e164, isoTime } from '../messaging/normalize.js';
import { assertConsent, assertNotQuiet, consentChange } from '../messaging/consent.js';
import { ingest } from '../messaging/ingest.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const keyMode = (read = env) => read('DIALPAD_AUTH_MODE').toLowerCase() === 'api_key';
const smsOn = (read = env) => /^(1|true|yes)$/i.test(read('DIALPAD_SMS_ENABLED'));
const host = (ctx) => (ctx.env('DIALPAD_ENVIRONMENT').toLowerCase() === 'sandbox' ? 'https://sandbox.dialpad.com' : 'https://dialpad.com');
// The states after which a call is over and worth one record. Earlier states (ringing, connected) are not stored.
const FINAL_STATES = new Set(['hangup', 'missed', 'voicemail', 'voicemail_uploaded', 'abandoned', 'blocked', 'recap_summary']);
const CALL_STATES = ['hangup', 'missed', 'voicemail', 'voicemail_uploaded'];
const DENIED = new Set(['not_allowed', 'not_found', 'plan_not_supported']);

async function api(ctx, method, path, body) {
  const token = (ctx.tokens && ctx.tokens.access_token) || ctx.env('DIALPAD_API_KEY');
  if (!token) throw new ProviderError('not_connected');
  let res;
  try {
    res = await ctx.fetch(host(ctx) + '/api/v2' + path, {
      method, headers: { authorization: 'Bearer ' + token, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000),
    });
  } catch { throw new ProviderError('provider_unreachable'); }
  // Dialpad's error text can name users and numbers. Only the status is read.
  if (res.status === 401) throw new ProviderError('token_rejected', { reauth: true, status: 401 });
  if (res.status === 402) throw new ProviderError('plan_not_supported', { status: 402 });
  if (res.status === 403) throw new ProviderError('not_allowed', { status: 403 });
  if (res.status === 404) throw new ProviderError('not_found', { status: 404 });
  if (res.status === 429) throw new ProviderError('rate_limited', { status: 429 });
  if (res.status === 400 || res.status === 422) throw new ProviderError('request_rejected', { status: res.status });
  if (!res.ok) throw new ProviderError('provider_error', { status: res.status });
  if (res.status === 204) return {};
  try { const data = await res.json(); if (data && typeof data === 'object') return data; } catch { /* below */ }
  throw new ProviderError('provider_error', { status: res.status });
}

/** Each company gets its own webhook secret, made from the deployment's secret and the company id. */
export const hookSecret = (ctx, tenantId) => hmac(ctx.env('DIALPAD_WEBHOOK_SECRET'), 'dialpad-hook:' + tenantId);
/** The address Dialpad is told to call for one company. The company id in it is proven by the secret above. */
export const hookUrl = (origin, tenantId) => `${origin}/api/webhooks/dialpad?t=${tenantId}`;

/** Dialpad signs a webhook by sending the whole event as a JWT (HS256) made with the webhook's secret. */
function verifyJwt(secret, raw) {
  const parts = raw.toString('utf8').trim().split('.');
  if (parts.length !== 3 || !parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p))) return { ok: false, reason: 'signature_missing' };
  let header; let payload;
  try { header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'bad_signature' }; }
  // Only the algorithm this server signs with is accepted. "none" or any other is refused outright.
  if (!header || header.alg !== 'HS256') return { ok: false, reason: 'bad_signature' };
  if (!sameString(parts[2], hmac(secret, parts[0] + '.' + parts[1], 'base64url'))) return { ok: false, reason: 'bad_signature' };
  try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'bad_payload' }; }
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? { ok: true, payload } : { ok: false, reason: 'bad_payload' };
}

function tenantOf(request) {
  try { const t = new URL(request.url).searchParams.get('t') || ''; return UUID.test(t) ? t.toLowerCase() : null; } catch { return null; }
}
function openEvent(request, raw, ctx) {
  const base = ctx.env('DIALPAD_WEBHOOK_SECRET');
  if (!base) return { ok: false, reason: 'not_configured' };
  const tenantId = tenantOf(request);
  const v = verifyJwt(tenantId ? hookSecret(ctx, tenantId) : base, raw);
  return v.ok ? { ...v, tenantId } : v;
}

const isSms = (p) => typeof p.text !== 'undefined' || typeof p.message_status === 'string' || Array.isArray(p.to_number);
const secondsOf = (c) => {
  const a = Number(c.date_connected); const b = Number(c.date_ended);
  if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b >= a) return Math.round((b - a) / 1000);
  const d = Number(c.duration);
  return Number.isFinite(d) && d > 0 ? Math.round(d / 1000) : 0;
};

/** A Dialpad call (an event or a row of the call log) as a `Message` with channel "call". */
export function callToMessage(c) {
  const inbound = String(c.direction || '').toLowerCase() === 'inbound';
  const state = String(c.state || '').toLowerCase().slice(0, 40);
  const seconds = secondsOf(c);
  const voicemail = state.startsWith('voicemail') || !!c.voicemail_link || !!c.voicemail_recording_id;
  const outcome = voicemail ? 'voicemail' : state === 'missed' || state === 'abandoned' || (inbound && state === 'hangup' && !Number(c.date_connected)) ? 'missed' : state === 'hangup' ? (Number(c.date_connected) ? 'answered' : 'no_answer') : state || 'call';
  const user = c.target && String(c.target.type || '').toLowerCase() === 'user' ? c.target : null;
  return toMessage({
    channel: 'call', provider: 'dialpad', externalId: String(c.call_id ?? c.id ?? ''), at: c.date_started || c.date_rang || c.event_timestamp, dir: inbound ? 'in' : 'out',
    status: inbound ? 'received' : 'sent', from: e164(inbound ? c.external_number : c.internal_number), to: e164(inbound ? c.internal_number : c.external_number),
    subject: outcome, body: '', seconds, threadId: e164(c.external_number) ? 'call:' + e164(c.external_number) : undefined,
    agent: user ? { id: String(user.id ?? ''), email: user.email, name: user.name } : null, name: c.contact?.name || '',
    extra: { state, outcome, ...(voicemail ? { voicemail: { ref: String(c.voicemail_recording_id || c.voicemail_link || '').slice(0, 500) } } : {}), ...(c.was_recorded ? { recorded: true } : {}), ...(c.target ? { target: { type: String(c.target.type || '').slice(0, 30), id: String(c.target.id ?? '') } } : {}) },
  });
}

function smsToMessage(p) {
  const inbound = String(p.direction || '').toLowerCase() === 'inbound';
  const to = Array.isArray(p.to_number) ? p.to_number[0] : p.to_number;
  const other = e164(inbound ? p.from_number : to);
  return toMessage({ channel: 'text', provider: 'dialpad', externalId: String(p.id ?? ''), at: p.created_date || p.event_timestamp, dir: inbound ? 'in' : 'out', status: inbound ? 'received' : 'sent', from: e164(p.from_number), to: e164(to), body: typeof p.text === 'string' ? p.text : '', threadId: other ? 'text:' + other : undefined, name: p.contact?.name || '' });
}

export default {
  id: 'dialpad',
  name: 'Dialpad',
  get kind() { return keyMode() ? 'key' : 'oauth'; },
  get env() { return keyMode() ? ['DIALPAD_API_KEY', 'DIALPAD_WEBHOOK_SECRET'] : ['DIALPAD_CLIENT_ID', 'DIALPAD_CLIENT_SECRET', 'DIALPAD_WEBHOOK_SECRET']; },
  get scopes() { return keyMode() ? [] : ['calls:list', 'offline_access', ...(smsOn() ? ['message_content_export'] : [])]; },
  // An OAuth app is reviewed by Dialpad before companies outside its own account may use it. An admin's own key is not.
  get approval() { return keyMode() ? null : { needed: true, flag: 'DIALPAD_APPROVED', note: 'Dialpad reviews an OAuth app and the scopes it asks for before other companies can connect to it.' }; },

  authUrl(ctx) {
    return authorizeUrl(host(ctx) + '/oauth2/authorize', { clientId: ctx.env('DIALPAD_CLIENT_ID'), redirect: ctx.redirectUri, scopes: this.scopes, state: ctx.state, challenge: ctx.challenge });
  },
  async exchange(ctx, code) {
    const raw = await tokenRequest(ctx.fetch, host(ctx) + '/oauth2/token', { grant_type: 'authorization_code', code, redirect_uri: ctx.redirectUri, code_verifier: ctx.verifier, client_id: ctx.env('DIALPAD_CLIENT_ID'), client_secret: ctx.env('DIALPAD_CLIENT_SECRET') });
    return normaliseTokens(raw, {}, ctx.now());
  },
  async refresh(ctx, tokens) {
    // With an admin key there is nothing to renew.
    if (keyMode(ctx.env)) return tokens;
    const raw = await tokenRequest(ctx.fetch, host(ctx) + '/oauth2/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: ctx.env('DIALPAD_CLIENT_ID'), client_secret: ctx.env('DIALPAD_CLIENT_SECRET') });
    return normaliseTokens(raw, tokens, ctx.now());
  },
  async revoke(ctx, tokens) {
    if (keyMode(ctx.env)) return;
    let res;
    try { res = await ctx.fetch(host(ctx) + '/oauth2/deauthorize', { method: 'POST', headers: { authorization: 'Bearer ' + tokens.access_token }, signal: AbortSignal.timeout(10000) }); } catch { throw new ProviderError('provider_unreachable'); }
    if (!res.ok) throw new ProviderError('revoke_failed', { status: res.status });
  },

  /**
   * The verified call behind "connected": which Dialpad company does this token or key belong to?
   * A connection that was made for one Dialpad company and now answers for another is refused as wrong_account.
   */
  async status(ctx) {
    const co = await api(ctx, 'GET', '/company');
    const id = String(co.id ?? '');
    if (!id) return { ok: false, reason: 'account_unknown' };
    if (ctx.connection?.account_ref && ctx.connection.account_ref !== id) return { ok: false, reason: 'wrong_account' };
    return { ok: true, account: { label: String(co.name || co.domain || 'Dialpad').slice(0, 200), ref: id }, scopes: ctx.tokens?.scope ? String(ctx.tokens.scope).split(/[\s,]+/).filter(Boolean) : this.scopes };
  },

  async health(ctx) {
    try { const s = await this.status(ctx); return s.ok ? { ok: true, health: 'ok' } : { ok: false, reason: s.reason }; } catch (e) {
      if (e instanceof ProviderError) return { ok: false, reason: e.code, reauth: e.reauth };
      throw e;
    }
  },

  /** Reads the call log from where the last run stopped and stores each finished call once. */
  async sync(ctx, what = 'all') {
    if (what !== 'all' && what !== 'calls') return { skipped: 'nothing_to_sync' };
    const since = Number(ctx.cursor ? await ctx.cursor.get('calls') : 0) || 0;
    const messages = []; let newest = since; let cursor = '';
    for (let page = 0; page < 5; page += 1) {
      const q = new URLSearchParams({ limit: '50', ...(since ? { started_after: String(since) } : {}), ...(cursor ? { cursor } : {}) });
      const r = await api(ctx, 'GET', '/call?' + q.toString());
      for (const c of Array.isArray(r.items) ? r.items : []) {
        if (!c || (c.call_id ?? c.id) === undefined) continue;
        messages.push(callToMessage(c));
        const started = Number(c.date_started); if (Number.isFinite(started) && started > newest) newest = started;
      }
      cursor = typeof r.cursor === 'string' ? r.cursor : '';
      if (!cursor) break;
    }
    if (messages.length) await ingest(ctx.tenantId, 'dialpad', { messages }, ctx.rpc ? { rpc: ctx.rpc } : {});
    if (newest > since && ctx.cursor) await ctx.cursor.set('calls', String(newest));
    return { counts: { calls: messages.length } };
  },

  webhook: {
    /**
     * Checks the JWT signature and, where the event carries a time, that it is recent. Keeps the call or message id,
     * its state and direction, and the length of the call. No phone number, no name, no text.
     */
    verify(request, raw, ctx) {
      const v = openEvent(request, raw, ctx);
      if (!v.ok) return v;
      const p = v.payload;
      const now = ctx.now();
      if (Number.isFinite(Number(p.exp)) && Number(p.exp) * 1000 < now) return { ok: false, reason: 'stale' };
      const stamp = Number(p.iat) || Math.floor(Number(p.event_timestamp || p.created_date || 0) / 1000);
      const windowS = /^\d{2,8}$/.test(ctx.env('DIALPAD_WEBHOOK_MAX_AGE_S')) ? Number(ctx.env('DIALPAD_WEBHOOK_MAX_AGE_S')) : REPLAY_WINDOW_S;
      if (!stamp || !fresh(stamp, now, windowS)) return { ok: false, reason: 'stale' };
      const company = p.company_id !== undefined ? String(p.company_id) : null;
      if (isSms(p)) {
        const id = String(p.id ?? '');
        if (!id) return { ok: false, reason: 'bad_payload' };
        const status = String(p.message_status || 'received').toLowerCase().slice(0, 30);
        return { ok: true, eventId: `sms:${id}:${status}`.slice(0, 200), type: 'sms.' + (String(p.direction).toLowerCase() === 'inbound' ? 'inbound' : 'status'), tenantId: v.tenantId, accountRef: company, redacted: { type: 'sms', id, direction: String(p.direction || '').toLowerCase().slice(0, 10), status } };
      }
      const callId = String(p.call_id ?? '');
      const state = String(p.state || '').toLowerCase();
      if (!callId || !/^[a-z_]{2,40}$/.test(state)) return { ok: false, reason: 'bad_payload' };
      return { ok: true, eventId: `call:${callId}:${state}`.slice(0, 200), type: 'call.' + state, tenantId: v.tenantId, accountRef: company, redacted: { type: 'call', call_id: callId, state, direction: String(p.direction || '').toLowerCase().slice(0, 10), seconds: secondsOf(p) } };
    },

    /**
     * Text messages only: their content is in the event and cannot be read again by id, so it is returned here for
     * the server to store while the request is in hand. Calls are stored by handle(), which reads the call by id.
     */
    inbound(request, raw, ctx) {
      const v = openEvent(request, raw, ctx);
      if (!v.ok || !isSms(v.payload)) return [];
      const p = v.payload;
      const group = { tenantId: v.tenantId, accountRef: p.company_id !== undefined ? String(p.company_id) : null, messages: [], statuses: [], consent: [] };
      if (String(p.direction || '').toLowerCase() === 'inbound') {
        const m = smsToMessage(p);
        group.messages.push(m);
        const change = consentChange(p.text, { channel: 'text', from: m.message.from, at: m.message.at });
        if (change) group.consent.push(change);
      } else {
        const s = String(p.message_status || '').toLowerCase();
        group.statuses.push(toStatus({ provider: 'dialpad', externalId: String(p.id ?? ''), status: s === 'failed' || s === 'undelivered' ? 'failed' : s === 'delivered' ? 'delivered' : 'sent', at: p.event_timestamp || p.created_date, error: s === 'failed' || s === 'undelivered' ? 'delivery_failed' : '' }));
      }
      return [group];
    },

    /** A finished call: read it from Dialpad by id and store it once. Calls still in progress are not stored. */
    async handle(ctx, event) {
      const red = event.redacted || {};
      if (red.type !== 'call' || !FINAL_STATES.has(red.state)) return { ok: true, ignored: true };
      const c = await api(ctx, 'GET', '/call/' + encodeURIComponent(red.call_id));
      await ingest(ctx.tenantId, 'dialpad', { messages: [callToMessage({ state: red.state, ...c, call_id: c.call_id ?? red.call_id })] }, ctx.rpc ? { rpc: ctx.rpc } : {});
      return { ok: true, stored: 1 };
    },
  },

  actions: {
    /** The people of the Dialpad account, for matching a call to a team member. */
    async listUsers(ctx, { cursor = '' } = {}) {
      const r = await api(ctx, 'GET', '/users?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      const users = (Array.isArray(r.items) ? r.items : []).map((u) => ({ id: String(u.id ?? ''), name: String(u.display_name || [u.first_name, u.last_name].filter(Boolean).join(' ')).slice(0, 200), email: Array.isArray(u.emails) && u.emails[0] ? String(u.emails[0]).toLowerCase() : '', numbers: (Array.isArray(u.phone_numbers) ? u.phone_numbers : []).map((n) => e164(n)).filter(Boolean), state: String(u.state || '').slice(0, 30) }));
      return { users, cursor: typeof r.cursor === 'string' ? r.cursor : '' };
    },

    /** The account's phone numbers and what each is assigned to. */
    async listNumbers(ctx, { cursor = '' } = {}) {
      const r = await api(ctx, 'GET', '/numbers?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      const numbers = (Array.isArray(r.items) ? r.items : []).map((n) => ({ number: e164(n.number), status: String(n.status || '').slice(0, 30), targetType: String(n.target_type || '').slice(0, 30), targetId: String(n.target_id ?? '') })).filter((n) => n.number);
      return { numbers, cursor: typeof r.cursor === 'string' ? r.cursor : '' };
    },

    /**
     * Asks Dialpad to send this company's call events (and text events when enabled) to this server.
     * Returns the ids Dialpad gave, for the caller to keep in the connection settings.
     */
    async subscribeEvents(ctx, { origin }) {
      if (!UUID.test(String(ctx.tenantId || '')) || !/^https:\/\//.test(String(origin || ''))) throw new ProviderError('request_rejected');
      const hook = await api(ctx, 'POST', '/webhooks', { hook_url: hookUrl(origin, ctx.tenantId), secret: hookSecret(ctx, ctx.tenantId) });
      const webhookId = String(hook.id ?? '');
      if (!webhookId) throw new ProviderError('provider_error');
      const call = await api(ctx, 'POST', '/subscriptions/call', { webhook_id: webhookId, call_states: CALL_STATES, enabled: true });
      const settings = { webhook_id: webhookId, call_subscription_id: String(call.id ?? ''), sms_subscription_id: '' };
      if (smsOn(ctx.env)) {
        // Text events are a separate permission. When Dialpad refuses, calls still work and the answer says so.
        try { const sms = await api(ctx, 'POST', '/subscriptions/sms', { webhook_id: webhookId, direction: 'all', enabled: true }); settings.sms_subscription_id = String(sms.id ?? ''); } catch (e) { if (!(e instanceof ProviderError) || !DENIED.has(e.code)) throw e; settings.sms_refused = e.code; }
      }
      return { settings };
    },

    /**
     * Starts a call for a team member. With a Dialpad user id the API is asked to ring that person's Dialpad first.
     * When the plan or the granted scopes do not allow it (or no user is given), the answer is a link instead:
     * { placed: false, deepLink: true, link: 'dialpad://...', tel: 'tel:...' }. A link is never reported as a call.
     */
    async clickToCall(ctx, { to, userId, viaApi = true } = {}) {
      const number = e164(to);
      if (!number) throw new ProviderError('recipient_invalid');
      const link = { placed: false, mode: 'deep_link', deepLink: true, link: 'dialpad://' + number, tel: 'tel:' + number };
      if (!viaApi || !/^\d{1,30}$/.test(String(userId || ''))) return { ...link, reason: 'no_user' };
      try {
        await api(ctx, 'POST', `/users/${userId}/initiate_call`, { phone_number: number });
        return { placed: true, mode: 'api', deepLink: false };
      } catch (e) {
        if (e instanceof ProviderError && DENIED.has(e.code)) return { ...link, reason: e.code };
        throw e;
      }
    },

    /**
     * Sends a text through Dialpad. msg: { to, text, consent, fromNumber? | userId?, quietHours? }.
     * Refused without the person's consent record, and during the quiet hours the caller passes.
     */
    async sendSms(ctx, msg) {
      const to = e164(msg.to);
      if (!to) throw new ProviderError('recipient_invalid');
      assertConsent(msg.consent, { channel: 'text', to, now: ctx.now() });
      assertNotQuiet(msg.quietHours, ctx.now());
      const text = String(msg.text || '').trim();
      if (!text || text.length > 1600) throw new ProviderError('message_invalid');
      const from = e164(msg.fromNumber);
      if (!from && !/^\d{1,30}$/.test(String(msg.userId || ''))) throw new ProviderError('sender_invalid');
      const r = await api(ctx, 'POST', '/sms', { to_numbers: [to], text, infer_country_code: false, ...(from ? { from_number: from } : {}), ...(msg.userId ? { user_id: Number(msg.userId) } : {}) });
      const id = String(r.id ?? '');
      if (!id) throw new ProviderError('provider_error');
      return { id, status: 'queued', ...toMessage({ channel: 'text', provider: 'dialpad', externalId: id, at: ctx.now(), dir: 'out', status: 'queued', from, to, body: text, threadId: 'text:' + to }) };
    },
  },
};
