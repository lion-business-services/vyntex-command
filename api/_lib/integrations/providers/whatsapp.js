// WhatsApp Business (Meta's Cloud API): approved templates, replies inside the 24 hour window, incoming messages,
// delivery reports and media.
//
// A "key" connection: there is no consent screen. A system user of the business holds a token that does not expire,
// and the connection is that token plus two ids: the phone number and the WhatsApp Business account it belongs to.
// Where they come from: the connection itself when the framework hands them over (ctx.tokens: { access_token,
// phone_number_id, business_account_id }), otherwise the deployment's settings below. With the settings, one
// deployment has one WhatsApp number.
//
// Rules this file enforces before any call leaves:
//   consent    the caller passes the person's opt-in record with every send. No record, no send.
//   window     free text only within 24 hours of the person's last message. Outside it only a template goes out,
//   template   and only one that Meta shows as APPROVED for that language (checked with a real call).
//
// Settings: META_APP_SECRET (signs the webhooks), WHATSAPP_WEBHOOK_VERIFY_TOKEN, WHATSAPP_SYSTEM_USER_TOKEN,
//           WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID, WHATSAPP_APPROVED, WHATSAPP_WEBHOOK_MAX_AGE_S (optional).
// Not proven against the live service: no account exists in this build. Tested with mocked responses.
import { ProviderError } from '../oauth.js';
import { parseJson, payloadHash } from '../webhook.js';
import { graph, verifyHubSignature, hubChallenge, maxAgeSeconds, withinAge } from '../messaging/graph.js';
import { toMessage, toStatus, e164, opaque, isoTime } from '../messaging/normalize.js';
import { assertConsent, consentChange, insideWindow } from '../messaging/consent.js';

const ID = /^\d{5,30}$/;
// Meta keeps trying a failed WhatsApp webhook for days. A body older than this is refused.
const MAX_AGE_S = 7 * 24 * 3600;
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
const MEDIA_HOSTS = /(^|\.)(fbsbx\.com|facebook\.com|fbcdn\.net|whatsapp\.net)$/;
const STATUS = { sent: 'sent', delivered: 'delivered', read: 'delivered', failed: 'failed' };
const TEMPLATE_STATUS = { APPROVED: 'approved', PENDING: 'pending', IN_APPEAL: 'pending', REJECTED: 'rejected', PAUSED: 'paused', DISABLED: 'disabled', PENDING_DELETION: 'disabled' };

/** The token and the two ids, from the connection when it carries them, else from the deployment's settings. */
function creds(ctx) {
  const t = ctx.tokens || {};
  const s = ctx.connection?.settings || {};
  const c = {
    token: t.access_token || ctx.env('WHATSAPP_SYSTEM_USER_TOKEN'),
    phoneId: String(t.phone_number_id || s.phone_number_id || ctx.env('WHATSAPP_PHONE_NUMBER_ID')),
    wabaId: String(t.business_account_id || s.business_account_id || ctx.env('WHATSAPP_BUSINESS_ACCOUNT_ID')),
  };
  if (!c.token || !ID.test(c.phoneId) || !ID.test(c.wabaId)) throw new ProviderError('not_configured');
  return c;
}

const paramCount = (components) => {
  const body = (Array.isArray(components) ? components : []).find((c) => c && c.type === 'BODY');
  return body && typeof body.text === 'string' ? new Set(body.text.match(/\{\{\d+\}\}/g) || []).size : 0;
};
const templateOut = (t) => ({ name: String(t.name || ''), language: String(t.language || ''), status: TEMPLATE_STATUS[t.status] || 'pending', category: String(t.category || '').toLowerCase(), params: paramCount(t.components) });

async function post(ctx, c, body) {
  const r = await graph(ctx, `/${c.phoneId}/messages`, { method: 'POST', token: c.token, body: { messaging_product: 'whatsapp', recipient_type: 'individual', ...body } });
  const id = Array.isArray(r.messages) && r.messages[0] && typeof r.messages[0].id === 'string' ? r.messages[0].id : '';
  if (!id) throw new ProviderError('provider_error');
  return id;
}

function recipient(msg) {
  const to = e164(msg.to);
  if (!to) throw new ProviderError('recipient_invalid');
  return to;
}

/** Walks a verified webhook body: one group per phone number id, with what it carries. */
function read(body) {
  const groups = new Map();
  for (const e of Array.isArray(body.entry) ? body.entry.slice(0, 50) : []) {
    for (const ch of Array.isArray(e?.changes) ? e.changes.slice(0, 50) : []) {
      const v = ch && ch.field === 'messages' && ch.value && typeof ch.value === 'object' ? ch.value : null;
      const phoneId = v && v.metadata ? String(v.metadata.phone_number_id || '') : '';
      if (!v || !ID.test(phoneId)) continue;
      if (!groups.has(phoneId)) groups.set(phoneId, { phoneId, display: String(v.metadata.display_phone_number || ''), messages: [], statuses: [], names: new Map() });
      const grp = groups.get(phoneId);
      for (const c of Array.isArray(v.contacts) ? v.contacts : []) if (c && c.wa_id) grp.names.set(String(c.wa_id), String(c.profile?.name || ''));
      for (const m of Array.isArray(v.messages) ? v.messages.slice(0, 100) : []) if (m && typeof m.id === 'string') grp.messages.push(m);
      for (const s of Array.isArray(v.statuses) ? v.statuses.slice(0, 100) : []) if (s && typeof s.id === 'string') grp.statuses.push(s);
    }
  }
  return [...groups.values()];
}

const mediaOf = (m) => { const part = m[m.type]; return part && typeof part === 'object' && typeof part.id === 'string' ? { id: part.id, mime: String(part.mime_type || ''), kind: m.type, name: String(part.filename || '').slice(0, 200) } : null; };
const textOf = (m) => (m.type === 'text' ? String(m.text?.body || '') : m.type === 'button' ? String(m.button?.text || '') : m.type === 'interactive' ? String(m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '') : String(m[m.type]?.caption || ''));

export default {
  id: 'whatsapp',
  name: 'WhatsApp Business',
  kind: 'key',
  env: ['META_APP_SECRET', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'WHATSAPP_SYSTEM_USER_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_BUSINESS_ACCOUNT_ID'],
  scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'],
  approval: { needed: true, flag: 'WHATSAPP_APPROVED', note: 'Meta verifies the business and approves the display name and each message template before messages can be sent to customers.' },

  /**
   * The verified call behind "connected": the phone number answers with this token, and it is one of the numbers of
   * the stated WhatsApp Business account. A number of another account is refused as wrong_account.
   */
  async status(ctx) {
    let c;
    try { c = creds(ctx); } catch (e) { return { ok: false, reason: e.code }; }
    const n = await graph(ctx, '/' + c.phoneId, { token: c.token, query: { fields: 'id,display_phone_number,verified_name,quality_rating' } });
    if (String(n.id) !== c.phoneId) return { ok: false, reason: 'account_unknown' };
    const list = await graph(ctx, `/${c.wabaId}/phone_numbers`, { token: c.token, query: { fields: 'id', limit: 100 } });
    if (!(Array.isArray(list.data) ? list.data : []).some((p) => String(p.id) === c.phoneId)) return { ok: false, reason: 'wrong_account' };
    if (ctx.connection?.account_ref && ctx.connection.account_ref !== c.phoneId) return { ok: false, reason: 'wrong_account' };
    const label = [String(n.verified_name || '').slice(0, 120), String(n.display_phone_number || '').slice(0, 40)].filter(Boolean).join(' ') || 'WhatsApp number';
    return { ok: true, account: { label, ref: c.phoneId }, scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'] };
  },

  async health(ctx) {
    try {
      const s = await this.status(ctx);
      return s.ok ? { ok: true, health: 'ok' } : { ok: false, reason: s.reason };
    } catch (e) {
      if (e instanceof ProviderError) return { ok: false, reason: e.code, reauth: e.reauth };
      throw e;
    }
  },

  // A system user token is not exchanged, refreshed or revoked from here: it is made and ended in Meta Business settings.
  authUrl() { throw new ProviderError('not_oauth'); },
  async exchange() { throw new ProviderError('not_oauth'); },
  async refresh(ctx, tokens) { return tokens; },
  async revoke() { /* disconnecting removes the connection; the token itself is ended in Meta Business settings */ },

  /** The templates and their approval state are the only thing to pull: messages arrive by webhook. */
  async sync(ctx) {
    const list = await this.actions.listTemplates(ctx);
    return { counts: { templates: list.length, approved: list.filter((t) => t.status === 'approved').length } };
  },

  webhook: {
    challenge(request, ctx) { return hubChallenge(request, ctx.env('WHATSAPP_WEBHOOK_VERIFY_TOKEN')); },

    /**
     * Signature over the raw body, then counts and opaque references only. A WhatsApp message id contains the
     * person's phone number, so not even the ids are kept as they are: the log gets a hash of each.
     */
    verify(request, raw, ctx) {
      const v = verifyHubSignature(ctx.env('META_APP_SECRET'), request.headers.get('x-hub-signature-256'), raw);
      if (!v.ok) return v;
      const body = parseJson(raw);
      if (!body || body.object !== 'whatsapp_business_account' || !Array.isArray(body.entry) || !body.entry.length) return { ok: false, reason: 'bad_payload' };
      const groups = read(body);
      if (!groups.length) return { ok: false, reason: 'bad_payload' };
      let newest = 0; let messages = 0; const statuses = {}; const refs = [];
      for (const grp of groups) {
        for (const m of grp.messages) { messages += 1; newest = Math.max(newest, Number(m.timestamp) || 0); if (refs.length < 25) refs.push(opaque(m.id)); }
        for (const s of grp.statuses) { statuses[STATUS[s.status] ? s.status : 'other'] = (statuses[STATUS[s.status] ? s.status : 'other'] || 0) + 1; newest = Math.max(newest, Number(s.timestamp) || 0); if (refs.length < 25) refs.push(opaque(s.id)); }
      }
      if (!newest || !withinAge(isoTime(newest), ctx.now(), maxAgeSeconds(ctx, 'WHATSAPP_WEBHOOK_MAX_AGE_S', MAX_AGE_S))) return { ok: false, reason: 'stale' };
      const type = messages ? 'message' : 'status';
      return { ok: true, eventId: 'h' + payloadHash(raw).slice(0, 48), type: 'whatsapp.' + type, accountRef: groups[0].phoneId, redacted: { type, phone_number_id: groups[0].phoneId, accounts: groups.length, messages, statuses, refs } };
    },

    /**
     * The text of a WhatsApp message exists in the webhook and nowhere else: Meta has no call to read a message
     * again by id. So this returns the normalized messages, delivery reports and opt-out words for the server to
     * store in the company's records while the request is in hand (messaging/ingest.js). Called only after verify().
     */
    inbound(request, raw) {
      const body = parseJson(raw);
      if (!body) return [];
      return read(body).map((grp) => {
        const out = { accountRef: grp.phoneId, messages: [], statuses: [], consent: [] };
        for (const m of grp.messages) {
          const from = e164('+' + String(m.from || '').replace(/\D/g, ''));
          const media = mediaOf(m); const text = textOf(m);
          out.messages.push(toMessage({
            channel: 'whatsapp', provider: 'whatsapp', externalId: m.id, at: m.timestamp, dir: 'in', from, to: e164(grp.display) || grp.display, body: text,
            threadId: 'whatsapp:' + from, name: grp.names.get(String(m.from)) || '', extra: { type: String(m.type || '').slice(0, 30), ...(media ? { media } : {}), ...(m.context?.id ? { replyTo: m.context.id } : {}) },
          }));
          const change = consentChange(text, { channel: 'whatsapp', from, at: isoTime(m.timestamp) });
          if (change) out.consent.push(change);
        }
        for (const s of grp.statuses) {
          if (!STATUS[s.status]) continue;
          const code = Array.isArray(s.errors) && s.errors[0] ? Number(s.errors[0].code) : 0;
          out.statuses.push(toStatus({ provider: 'whatsapp', externalId: s.id, status: STATUS[s.status], at: s.timestamp, error: s.status === 'failed' ? (code === 131047 ? 'outside_messaging_window' : code === 131026 ? 'recipient_unreachable' : 'delivery_failed') : '', extra: { read: s.status === 'read', ...(s.pricing?.category ? { category: String(s.pricing.category).slice(0, 40) } : {}) } }));
        }
        return out;
      });
    },

    /** Everything a WhatsApp webhook carries is stored by inbound(). Nothing is left for the job to do. */
    async handle() { return { ok: true, ignored: true }; },
  },

  actions: {
    /** Every template of the account with its approval state: approved, pending, rejected, paused or disabled. */
    async listTemplates(ctx) {
      const c = creds(ctx);
      const r = await graph(ctx, `/${c.wabaId}/message_templates`, { token: c.token, query: { fields: 'name,language,status,category,components', limit: 200 } });
      return (Array.isArray(r.data) ? r.data : []).filter((t) => t && t.name).map(templateOut);
    },

    /**
     * Sends an approved template. msg: { to, template: { name, language }, params?: string[], consent }.
     * The approval is read from Meta at send time, so a template that was paused or rejected since is not sent.
     */
    async sendTemplate(ctx, msg) {
      const c = creds(ctx);
      const to = recipient(msg);
      assertConsent(msg.consent, { channel: 'whatsapp', to, now: ctx.now() });
      const name = String(msg.template?.name || ''); const language = String(msg.template?.language || '');
      if (!/^[a-z0-9_]{1,512}$/.test(name) || !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(language)) throw new ProviderError('template_invalid');
      const found = await graph(ctx, `/${c.wabaId}/message_templates`, { token: c.token, query: { name, fields: 'name,language,status,category,components', limit: 50 } });
      const t = (Array.isArray(found.data) ? found.data : []).find((x) => x && x.name === name && x.language === language);
      if (!t) throw new ProviderError('template_not_found');
      if (t.status !== 'APPROVED') throw new ProviderError('template_not_approved');
      const params = (Array.isArray(msg.params) ? msg.params : []).map((p) => String(p ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, 1024));
      if (params.length !== paramCount(t.components) || params.some((p) => !p)) throw new ProviderError('template_params_invalid');
      const id = await post(ctx, c, { to: to.slice(1), type: 'template', template: { name, language: { code: language }, ...(params.length ? { components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] } : {}) } });
      return { id, ...toMessage({ channel: 'whatsapp', provider: 'whatsapp', externalId: id, at: ctx.now(), dir: 'out', status: 'sent', to, from: '', subject: name, body: '', threadId: 'whatsapp:' + to, extra: { template: { name, language }, params: params.length } }) };
    },

    /**
     * Sends free text. msg: { to, text, consent, lastInboundAt }. Only inside the 24 hours after the person's last
     * message; outside it the answer is outside_messaging_window and nothing is sent (use a template).
     */
    async sendText(ctx, msg) {
      const c = creds(ctx);
      const to = recipient(msg);
      assertConsent(msg.consent, { channel: 'whatsapp', to, now: ctx.now() });
      const text = String(msg.text || '').trim();
      if (!text || text.length > 4096) throw new ProviderError('message_invalid');
      if (!insideWindow(msg.lastInboundAt, ctx.now())) throw new ProviderError('outside_messaging_window');
      const id = await post(ctx, c, { to: to.slice(1), type: 'text', text: { body: text, preview_url: false } });
      return { id, ...toMessage({ channel: 'whatsapp', provider: 'whatsapp', externalId: id, at: ctx.now(), dir: 'out', status: 'sent', to, from: '', body: text, threadId: 'whatsapp:' + to }) };
    },

    /** One entry point for callers that do not care which kind it is: a template when one is named, else free text. */
    async send(ctx, msg) {
      return msg && msg.template ? this.sendTemplate(ctx, msg) : this.sendText(ctx, msg);
    },

    /**
     * Fetches a received file by its media id, through the server. Meta answers the id with a short-lived address
     * that only opens with the token, so the browser can never fetch it itself. Returns { bytes, mime, size, sha256 }.
     */
    async downloadMedia(ctx, mediaId) {
      const c = creds(ctx);
      if (!/^[A-Za-z0-9_-]{5,120}$/.test(String(mediaId || ''))) throw new ProviderError('media_invalid');
      const meta = await graph(ctx, '/' + mediaId, { token: c.token, query: { phone_number_id: c.phoneId } });
      let url;
      try { url = new URL(String(meta.url || '')); } catch { throw new ProviderError('media_unavailable'); }
      // The token is sent to this address, so it must be one of Meta's own.
      if (url.protocol !== 'https:' || !MEDIA_HOSTS.test(url.hostname)) throw new ProviderError('media_unavailable');
      if (Number(meta.file_size) > MAX_MEDIA_BYTES) throw new ProviderError('media_too_large');
      let res;
      try { res = await ctx.fetch(url.toString(), { headers: { authorization: 'Bearer ' + c.token }, signal: AbortSignal.timeout(30000) }); } catch { throw new ProviderError('provider_unreachable'); }
      if (res.status === 401 || res.status === 403) throw new ProviderError('media_unavailable', { status: res.status });
      if (!res.ok) throw new ProviderError('provider_error', { status: res.status });
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > MAX_MEDIA_BYTES) throw new ProviderError('media_too_large');
      return { bytes, mime: String(meta.mime_type || res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim(), size: bytes.length, sha256: typeof meta.sha256 === 'string' ? meta.sha256 : null };
    },
  },
};
