// Resend: system email (invitations, password resets, notices, automated messages).
// A reference adapter for the "key" kind: no consent screen, the deployment holds one API key in its environment.
// "Connecting" for a company means the server checks that key with a real call and records the result.
//
// Settings: RESEND_API_KEY, SYSTEM_EMAIL_FROM (a sender on a domain verified in Resend),
//           RESEND_WEBHOOK_SECRET (optional, starts with whsec_: needed only to receive delivery events).
// Not proven against the live service: no key exists in this build. The code follows Resend's public API as documented
// (POST /emails, GET /domains, Svix-signed webhooks) and is tested with mocked responses.
import { ProviderError } from '../oauth.js';
import { verifySvix, parseJson } from '../webhook.js';

const API = 'https://api.resend.com';
const EMAIL = /^[^\s@<>(),;:"\[\]]+@[^\s@<>(),;:"\[\]]+\.[A-Za-z]{2,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Name <a@b.c>" or "a@b.c" -> the address part. */
const addressOf = (from) => { const m = /<([^>]+)>/.exec(from || ''); return (m ? m[1] : from || '').trim(); };
const domainOf = (from) => addressOf(from).split('@')[1]?.toLowerCase() || '';

async function api(ctx, method, path, body, headers = {}) {
  let res;
  try {
    res = await ctx.fetch(API + path, {
      method,
      headers: { authorization: 'Bearer ' + ctx.env('RESEND_API_KEY'), ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new ProviderError('provider_unreachable');
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  // Resend names its errors ({ name: "invalid_api_key" ... }). Only that name is kept, never the message.
  const name = data && typeof data.name === 'string' && /^[a-z_]{3,40}$/.test(data.name) ? data.name : '';
  return { ok: res.ok, status: res.status, data, name };
}

export default {
  id: 'resend',
  name: 'System email',
  kind: 'key',
  env: ['RESEND_API_KEY', 'SYSTEM_EMAIL_FROM'],
  scopes: ['send'],
  approval: null,

  /**
   * The verified call behind "connected": asks Resend for the account's domains and looks for the sender's domain.
   * A key limited to sending cannot list domains; Resend answers that with its own "restricted_api_key" name, which
   * still proves the key is real, so that case counts as connected (the domain is then proven by the first send).
   */
  async status(ctx) {
    const from = ctx.env('SYSTEM_EMAIL_FROM');
    if (!EMAIL.test(addressOf(from))) return { ok: false, reason: 'sender_invalid' };
    const r = await api(ctx, 'GET', '/domains');
    if (r.ok) {
      const list = Array.isArray(r.data?.data) ? r.data.data : [];
      const mine = list.find((d) => String(d.name || '').toLowerCase() === domainOf(from));
      if (!mine) return { ok: false, reason: 'domain_not_found' };
      if (mine.status !== 'verified') return { ok: false, reason: 'domain_not_verified' };
      return { ok: true, account: { label: addressOf(from), ref: String(mine.id || '') || null }, scopes: ['send'] };
    }
    if (r.status === 401 && r.name === 'restricted_api_key') return { ok: true, account: { label: addressOf(from), ref: null }, scopes: ['send'] };
    if (r.status === 401 || r.status === 403) return { ok: false, reason: 'invalid_key' };
    if (r.status === 429) return { ok: false, reason: 'rate_limited' };
    return { ok: false, reason: 'provider_error' };
  },

  async health(ctx) {
    const s = await this.status(ctx);
    return s.ok ? { ok: true, health: 'ok' } : { ok: false, reason: s.reason, reauth: s.reason === 'invalid_key' };
  },

  // Nothing to exchange, refresh or revoke for a key held by the deployment. Present so every adapter has the same shape.
  authUrl() { throw new ProviderError('not_oauth'); },
  async exchange() { throw new ProviderError('not_oauth'); },
  async refresh(ctx, tokens) { return tokens; },
  async revoke() { /* the key belongs to the deployment, not to the company: disconnecting only removes the row */ },
  async sync() { return { ok: true, skipped: 'nothing_to_sync' }; },

  webhook: {
    /**
     * Checks the Svix signature on the raw body and returns what may be stored. The redacted copy holds the event
     * type and Resend's ids only: no recipient, no subject. The company is read from the tag this adapter puts on
     * every email it sends (it is inside the signed body, so it can be trusted once the signature passed).
     */
    verify(request, raw, ctx) {
      const secret = ctx.env('RESEND_WEBHOOK_SECRET');
      if (!secret) return { ok: false, reason: 'not_configured' };
      const v = verifySvix(secret, request.headers, raw, ctx.now());
      if (!v.ok) return v;
      const body = parseJson(raw);
      if (!body || typeof body.type !== 'string') return { ok: false, reason: 'bad_payload' };
      const tags = body.data && body.data.tags;
      const tenant = Array.isArray(tags) ? tags.find((t) => t && t.name === 'vx_tenant')?.value : tags && typeof tags === 'object' ? tags.vx_tenant : null;
      return {
        ok: true, eventId: v.id, type: body.type.slice(0, 60),
        tenantId: typeof tenant === 'string' && UUID.test(tenant) ? tenant : null,
        redacted: { type: body.type.slice(0, 60), email_id: typeof body.data?.email_id === 'string' ? body.data.email_id.slice(0, 80) : null, created_at: typeof body.created_at === 'string' ? body.created_at.slice(0, 40) : null },
      };
    },
    /**
     * Delivery events (sent, delivered, bounced, complained). The message records they update belong to the
     * communications module, which is not built yet, so the event is logged and marked as not acted on.
     */
    async handle() {
      return { ok: true, ignored: true };
    },
  },

  actions: {
    /**
     * Sends one email. msg: { to: string | string[], subject, text, html?, replyTo?, idempotencyKey? }.
     * The idempotency key goes to Resend, so a retry of the same send does not produce a second email.
     * Returns { id }. Throws ProviderError with a code; the provider's message is never passed on.
     */
    async sendEmail(ctx, msg) {
      const to = (Array.isArray(msg.to) ? msg.to : [msg.to]).map((a) => String(a || '').trim()).filter(Boolean);
      if (!to.length || to.length > 50 || !to.every((a) => EMAIL.test(a))) throw new ProviderError('recipient_invalid');
      const subject = String(msg.subject || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
      if (!subject || !(msg.text || msg.html)) throw new ProviderError('message_invalid');
      const body = { from: ctx.env('SYSTEM_EMAIL_FROM'), to, subject };
      if (msg.text) body.text = String(msg.text);
      if (msg.html) body.html = String(msg.html);
      if (msg.replyTo && EMAIL.test(String(msg.replyTo))) body.reply_to = String(msg.replyTo);
      if (ctx.tenantId && UUID.test(ctx.tenantId)) body.tags = [{ name: 'vx_tenant', value: ctx.tenantId }];
      const headers = msg.idempotencyKey ? { 'idempotency-key': String(msg.idempotencyKey).slice(0, 200) } : {};
      const r = await api(ctx, 'POST', '/emails', body, headers);
      if (r.ok && r.data && typeof r.data.id === 'string') return { id: r.data.id };
      if (r.status === 401 || r.status === 403) throw new ProviderError(r.name === 'validation_error' ? 'sender_not_allowed' : 'invalid_key', { reauth: r.name !== 'validation_error', status: r.status });
      if (r.status === 429) throw new ProviderError('rate_limited', { status: 429 });
      if (r.status === 422 || r.status === 400) throw new ProviderError('message_rejected', { status: r.status });
      throw new ProviderError('provider_error', { status: r.status });
    },
  },
};
