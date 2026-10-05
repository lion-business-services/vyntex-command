// Text messages (SMS), provider neutral. The rest of the platform calls this adapter; which company carries the
// messages is a setting of the deployment:
//   SMS_PROVIDER=twilio    Twilio's Messages API (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, SMS_FROM_NUMBER or
//                          TWILIO_MESSAGING_SERVICE_SID)
//   SMS_PROVIDER=dialpad   the company's Dialpad connection sends and receives (providers/dialpad.js)
//
// Rules enforced here, whichever carries the message:
//   consent      the caller passes the person's opt-in record. No record, a revoked one, or one for another number
//                is refused before any call.
//   STOP         an incoming STOP (or START, HELP, and their Spanish forms) becomes a consent change for the store
//                to record. After STOP the stored record is opted out, so the next send is refused above.
//   quiet hours  passed in by the caller (the company's own hours and time zone). Inside them the send is refused.
//   cost         the number of segments is counted here (arithmetic, from the standard). A price is reported only
//                when the provider states one for that message. No rate is ever assumed: `cost` is null otherwise.
//
// Settings: SMS_PROVIDER, SMS_FROM_NUMBER, SMS_APPROVED, and the chosen provider's own (above).
// Not proven against a live service: no account exists in this build. Tested with mocked responses.
import { createHmac } from 'node:crypto';
import { ProviderError } from '../oauth.js';
import { sameString } from '../../crypto.js';
import { env } from '../../env.js';
import dialpad from './dialpad.js';
import { toMessage, toStatus, e164, smsSegments } from '../messaging/normalize.js';
import { assertConsent, assertNotQuiet, consentChange } from '../messaging/consent.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TWILIO = 'https://api.twilio.com/2010-04-01';
const backend = (read = env) => read('SMS_PROVIDER').toLowerCase();
const TWILIO_STATUS = { accepted: 'queued', scheduled: 'queued', queued: 'queued', sending: 'queued', sent: 'sent', delivered: 'delivered', undelivered: 'failed', failed: 'failed', received: 'received', receiving: 'received' };
// Twilio's numbered reasons, from its error reference. The number is read; its text never is.
const TWILIO_ERRORS = { 21610: 'recipient_opted_out', 21211: 'recipient_invalid', 21614: 'recipient_invalid', 21408: 'region_not_allowed', 21606: 'sender_invalid', 21603: 'sender_invalid', 21608: 'recipient_not_allowed', 21617: 'message_invalid', 30003: 'recipient_unreachable', 30004: 'recipient_blocked', 30005: 'recipient_unreachable', 30006: 'recipient_unreachable', 30007: 'carrier_filtered', 30034: 'sender_not_registered' };

async function twilio(ctx, method, path, form) {
  const sid = ctx.env('TWILIO_ACCOUNT_SID');
  let res;
  try {
    res = await ctx.fetch(`${TWILIO}/Accounts/${encodeURIComponent(sid)}${path}`, {
      method, headers: { authorization: 'Basic ' + Buffer.from(`${sid}:${ctx.env('TWILIO_AUTH_TOKEN')}`).toString('base64'), accept: 'application/json', ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined, signal: AbortSignal.timeout(10000),
    });
  } catch { throw new ProviderError('provider_unreachable'); }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (res.ok && data && typeof data === 'object') return data;
  const known = data && TWILIO_ERRORS[Number(data.code)];
  if (known) throw new ProviderError(known, { status: res.status });
  if (res.status === 401 || res.status === 403) throw new ProviderError('invalid_key', { reauth: true, status: res.status });
  if (res.status === 429 || (data && Number(data.code) === 20429)) throw new ProviderError('rate_limited', { status: res.status });
  if (res.status === 404) throw new ProviderError('not_found', { status: 404 });
  if (res.status === 400 || res.status === 422) throw new ProviderError('message_rejected', { status: res.status });
  throw new ProviderError('provider_error', { status: res.status });
}

/** A price only when Twilio states one. It reports a negative amount as text ("-0.00750"); the sign is dropped. */
function twilioCost(m) {
  const amount = m && m.price !== null && m.price !== undefined && m.price !== '' ? Math.abs(Number(m.price)) : NaN;
  return Number.isFinite(amount) && typeof m.price_unit === 'string' && /^[A-Za-z]{3}$/.test(m.price_unit) ? { amount, currency: m.price_unit.toUpperCase() } : null;
}

/** The Dialpad side: a context with the company's Dialpad tokens (or the deployment's key). */
async function dialpadCtx(ctx) {
  if (ctx.dialpad) return ctx.dialpad;
  if (dialpad.kind === 'key') return { ...ctx, provider: 'dialpad', tokens: null, connection: null };
  // Loaded here and not at the top: the framework imports the provider list, which imports this file.
  const { connectionCtx } = await import('../core.js');
  try { return await connectionCtx({ ...dialpad, built: true }, ctx.tenantId, { fetchFn: ctx.fetch }); } catch (e) {
    throw new ProviderError(e instanceof ProviderError && e.code === 'not_connected' ? 'dialpad_not_connected' : e instanceof ProviderError ? e.code : 'dialpad_unavailable', { reauth: !!(e && e.reauth) });
  }
}

/**
 * Twilio signs a webhook with HMAC-SHA1 over the full address it called followed by every posted field, sorted by
 * name, each as name then value. The address is rebuilt from this deployment's own public address, so a request
 * that reached the server some other way does not verify.
 */
export function twilioSignature(authToken, url, params) {
  const data = url + [...params.keys()].filter((k, i, a) => a.indexOf(k) === i).sort().map((k) => k + params.getAll(k).join('')).join('');
  return createHmac('sha1', authToken).update(data).digest('base64');
}
function openTwilio(request, raw, ctx) {
  const token = ctx.env('TWILIO_AUTH_TOKEN');
  if (!token || !ctx.env('APP_ORIGIN')) return { ok: false, reason: 'not_configured' };
  const given = request.headers.get('x-twilio-signature') || '';
  if (!given) return { ok: false, reason: 'signature_missing' };
  let u;
  try { u = new URL(request.url); } catch { return { ok: false, reason: 'bad_signature' }; }
  const params = new URLSearchParams(raw.toString('utf8'));
  if (!sameString(given, twilioSignature(token, ctx.env('APP_ORIGIN').replace(/\/+$/, '') + u.pathname + u.search, params))) return { ok: false, reason: 'bad_signature' };
  const t = u.searchParams.get('t') || '';
  return { ok: true, params, tenantId: UUID.test(t) ? t.toLowerCase() : null };
}
const twilioKind = (p) => (p.get('MessageStatus') ? 'status' : 'inbound');

export default {
  id: 'sms',
  name: 'Text messages',
  kind: 'key',
  get env() {
    const b = backend();
    if (b === 'twilio') return ['SMS_PROVIDER', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', ...(env('TWILIO_MESSAGING_SERVICE_SID') ? [] : ['SMS_FROM_NUMBER'])];
    if (b === 'dialpad') return ['SMS_PROVIDER', 'SMS_FROM_NUMBER', ...dialpad.env];
    return ['SMS_PROVIDER'];
  },
  scopes: ['send', 'receive'],
  approval: { needed: true, flag: 'SMS_APPROVED', note: 'Phone carriers ask a business to register its sender and its message types before it may text customers.' },

  /** The verified call behind "connected": the account answers, it is active, and the sending number belongs to it. */
  async status(ctx) {
    const b = backend(ctx.env);
    const from = e164(ctx.env('SMS_FROM_NUMBER'));
    if (b === 'twilio') {
      const service = ctx.env('TWILIO_MESSAGING_SERVICE_SID');
      if (!service && !from) return { ok: false, reason: 'sender_invalid' };
      const acct = await twilio(ctx, 'GET', '.json');
      if (acct.sid !== ctx.env('TWILIO_ACCOUNT_SID')) return { ok: false, reason: 'wrong_account' };
      if (acct.status !== 'active') return { ok: false, reason: 'account_not_active' };
      if (!service) {
        const own = await twilio(ctx, 'GET', '/IncomingPhoneNumbers.json?PhoneNumber=' + encodeURIComponent(from));
        if (!(Array.isArray(own.incoming_phone_numbers) ? own.incoming_phone_numbers : []).some((n) => e164(n.phone_number) === from)) return { ok: false, reason: 'sender_not_found' };
      }
      return { ok: true, account: { label: from || 'Messaging service', ref: from || service }, scopes: ['send', 'receive'], backend: 'twilio' };
    }
    if (b === 'dialpad') {
      if (!from) return { ok: false, reason: 'sender_invalid' };
      const d = await dialpadCtx(ctx);
      const s = await dialpad.status(d);
      if (!s.ok) return { ok: false, reason: s.reason };
      const { numbers } = await dialpad.actions.listNumbers(d);
      if (!numbers.some((n) => n.number === from)) return { ok: false, reason: 'sender_not_found' };
      return { ok: true, account: { label: from, ref: from }, scopes: ['send', 'receive'], backend: 'dialpad' };
    }
    return { ok: false, reason: 'provider_unknown' };
  },

  async health(ctx) {
    try { const s = await this.status(ctx); return s.ok ? { ok: true, health: 'ok' } : { ok: false, reason: s.reason }; } catch (e) {
      if (e instanceof ProviderError) return { ok: false, reason: e.code, reauth: e.reauth };
      throw e;
    }
  },

  authUrl() { throw new ProviderError('not_oauth'); },
  async exchange() { throw new ProviderError('not_oauth'); },
  async refresh(ctx, tokens) { return tokens; },
  async revoke() { /* the account belongs to the deployment: disconnecting only removes the row */ },
  async sync() { return { ok: true, skipped: 'nothing_to_sync' }; },

  webhook: {
    /**
     * Twilio only (Dialpad's text events arrive at the Dialpad webhook). Twilio's signature has no time stamp, so a
     * replay cannot be told by age: it is stopped by the event id (message id plus state), which is recorded once.
     * Kept: the message id, its state, the error number and the segment count. No phone number, no text.
     */
    verify(request, raw, ctx) {
      if (backend(ctx.env) !== 'twilio') return { ok: false, reason: 'not_configured' };
      const v = openTwilio(request, raw, ctx);
      if (!v.ok) return v;
      const p = v.params;
      const sid = p.get('MessageSid') || p.get('SmsSid') || '';
      if (!/^(SM|MM)[0-9a-f]{32}$/i.test(sid)) return { ok: false, reason: 'bad_payload' };
      if (p.get('AccountSid') !== ctx.env('TWILIO_ACCOUNT_SID')) return { ok: false, reason: 'wrong_account' };
      const kind = twilioKind(p);
      const state = String(kind === 'status' ? p.get('MessageStatus') : 'received').toLowerCase().slice(0, 30);
      const ours = e164(kind === 'status' ? p.get('From') : p.get('To'));
      return { ok: true, eventId: `${sid}:${state}`, type: 'sms.' + kind, tenantId: v.tenantId, accountRef: ours || null, redacted: { type: 'sms.' + kind, sid, status: state, error_code: /^\d{1,6}$/.test(p.get('ErrorCode') || '') ? Number(p.get('ErrorCode')) : null, segments: /^\d{1,3}$/.test(p.get('NumSegments') || '') ? Number(p.get('NumSegments')) : null } };
    },

    /** The text of an incoming message, the delivery report and any STOP word, for the server to store at once. */
    inbound(request, raw, ctx) {
      if (backend(ctx.env) !== 'twilio') return [];
      const v = openTwilio(request, raw, ctx);
      if (!v.ok) return [];
      const p = v.params; const sid = p.get('MessageSid') || p.get('SmsSid') || '';
      const kind = twilioKind(p);
      const group = { tenantId: v.tenantId, accountRef: e164(kind === 'status' ? p.get('From') : p.get('To')) || null, messages: [], statuses: [], consent: [] };
      if (kind === 'status') {
        const state = TWILIO_STATUS[String(p.get('MessageStatus')).toLowerCase()] || 'sent';
        group.statuses.push(toStatus({ provider: 'sms', externalId: sid, status: state, at: Date.now(), error: state === 'failed' ? TWILIO_ERRORS[Number(p.get('ErrorCode'))] || 'delivery_failed' : '' }));
        if (Number(p.get('ErrorCode')) === 21610) group.consent.push({ action: 'opt_out', channel: 'text', address: e164(p.get('To')), at: new Date().toISOString(), source: 'provider' });
      } else {
        const from = e164(p.get('From')); const text = p.get('Body') || '';
        const segs = /^\d{1,3}$/.test(p.get('NumSegments') || '') ? Number(p.get('NumSegments')) : smsSegments(text).segments;
        group.messages.push(toMessage({ channel: 'text', provider: 'sms', externalId: sid, at: Date.now(), dir: 'in', from, to: e164(p.get('To')), body: text, threadId: 'text:' + from, extra: { segments: segs, backend: 'twilio', media: Number(p.get('NumMedia')) || 0 } }));
        const change = consentChange(text, { channel: 'text', from });
        if (change) group.consent.push(change);
      }
      return [group];
    },

    /** Twilio reads the answer to an incoming message as instructions. An empty set means: send nothing back. */
    reply() { return { status: 200, contentType: 'text/xml; charset=utf-8', body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>' }; },

    async handle() { return { ok: true, ignored: true }; },
  },

  actions: {
    /**
     * Sends one text. msg: { to, text, consent, quietHours?, statusCallback? }.
     * Returns { id, status, backend, segments, segmentsSource, cost, message, match, extra }. `cost` is null unless
     * the provider reported a price for this message.
     */
    async send(ctx, msg) {
      const b = backend(ctx.env);
      const to = e164(msg && msg.to);
      if (!to) throw new ProviderError('recipient_invalid');
      assertConsent(msg.consent, { channel: 'text', to, now: ctx.now() });
      assertNotQuiet(msg.quietHours, ctx.now());
      const text = String(msg.text || '').trim();
      if (!text || text.length > 1600) throw new ProviderError('message_invalid');
      const estimate = smsSegments(text);
      const from = e164(ctx.env('SMS_FROM_NUMBER'));
      if (b === 'twilio') {
        const service = ctx.env('TWILIO_MESSAGING_SERVICE_SID');
        if (!service && !from) throw new ProviderError('sender_invalid');
        const form = { To: to, Body: text, ...(service ? { MessagingServiceSid: service } : { From: from }) };
        if (msg.statusCallback && /^https:\/\//.test(String(msg.statusCallback))) form.StatusCallback = String(msg.statusCallback);
        const r = await twilio(ctx, 'POST', '/Messages.json', form);
        if (typeof r.sid !== 'string' || !r.sid) throw new ProviderError('provider_error');
        const reported = /^\d{1,3}$/.test(String(r.num_segments ?? '')) && Number(r.num_segments) > 0;
        const status = TWILIO_STATUS[String(r.status || '').toLowerCase()] || 'queued';
        return { id: r.sid, status, backend: 'twilio', segments: reported ? Number(r.num_segments) : estimate.segments, segmentsSource: reported ? 'provider' : 'estimate', cost: twilioCost(r), ...toMessage({ channel: 'text', provider: 'sms', externalId: r.sid, at: ctx.now(), dir: 'out', status, from, to, body: text, threadId: 'text:' + to, extra: { backend: 'twilio', encoding: estimate.encoding } }) };
      }
      if (b === 'dialpad') {
        if (!from) throw new ProviderError('sender_invalid');
        const sent = await dialpad.actions.sendSms(await dialpadCtx(ctx), { to, text, consent: msg.consent, quietHours: msg.quietHours, fromNumber: from });
        return { id: sent.id, status: 'queued', backend: 'dialpad', segments: estimate.segments, segmentsSource: 'estimate', cost: null, message: { ...sent.message, provider: 'sms' }, match: sent.match, extra: { backend: 'dialpad', encoding: estimate.encoding } };
      }
      throw new ProviderError('provider_unknown');
    },

    /** What the provider charged for one message, once it says. Null until then, and always null where it never says. */
    async cost(ctx, id) {
      if (backend(ctx.env) !== 'twilio') return null;
      if (!/^(SM|MM)[0-9a-f]{32}$/i.test(String(id || ''))) throw new ProviderError('not_found');
      return twilioCost(await twilio(ctx, 'GET', `/Messages/${id}.json`));
    },

    /** How many segments a text would take, before sending it. Arithmetic only. */
    segments(ctx, text) { return smsSegments(text); },
  },
};
