// The outgoing message pipeline: the job "messages.deliver".
//
// A person (or an automation in the browser) saves a message as "queued". From there on the server decides:
//   1. consent, checked again here from the records: an email never goes to someone who opted out of email, a text or
//      a WhatsApp message only to someone who opted in
//      (the text and WhatsApp adapters check the consent record of the number once more, and refuse without it)
//   2. the provider for the channel, called through its adapter's action by name. An adapter that is missing, or that
//      this company has not connected, leaves the message "failed" with the reason "not_connected". Never "sent".
//   3. the outcome, written by message_mark, which only moves a message that is still queued: a job that runs twice
//      sends once, and the provider gets the message id as its idempotency key as well
// "sent" needs the provider's own reference for the message. No acceptance, no "sent".
import { JobError } from '../jobs.js';
import { serviceRpc } from '../supabase.js';
import { getAdapter } from '../integrations/providers/index.js';
import { connectionCtx } from '../integrations/core.js';
import { ProviderError } from '../integrations/oauth.js';
import { sendSystemEmail, emailConfigured } from '../mail.js';
import { openToken } from '../crypto.js';
import { isUuid } from '../respond.js';

/**
 * Which adapters may carry a channel, in order of preference, and the action each one is asked for.
 * Text has one route: the "sms" adapter picks its own carrier (Twilio or Dialpad) from the deployment's settings.
 */
export const ROUTES = {
  email: [['gmail', 'send'], ['resend', 'sendEmail']],
  text: [['sms', 'send']],
  whatsapp: [['whatsapp', 'send']],
  facebook: [['meta', 'sendMessage']],
  instagram: [['meta', 'sendMessage']],
};

/**
 * What each adapter's action is given. The adapters were written by different people and take different things:
 * the text and WhatsApp adapters refuse to send without the consent record of the number, WhatsApp and Meta need to
 * know when the person last wrote (their reply windows), and text keeps the company's quiet hours.
 * `x` is the message as the pipeline prepared it, `f` the facts of messaging_outbox_get (0048).
 */
const ARGS = {
  gmail: (x) => ({ to: x.to, subject: x.subject, text: x.text, idempotencyKey: x.idempotencyKey }),
  resend: (x) => ({ to: x.to, subject: x.subject, text: x.text, channel: x.channel, idempotencyKey: x.idempotencyKey }),
  sms: (x, f) => ({ to: x.to, text: x.text, consent: f.consent || null, quietHours: f.quietHours || null }),
  whatsapp: (x, f) => ({ to: x.to, text: x.text, consent: f.consent || null, lastInboundAt: f.lastInboundAt || null }),
  meta: (x, f) => ({ channel: x.channel, to: x.to, text: x.text, lastInboundAt: f.lastInboundAt || null }),
};

/** Channels whose adapters need the facts above. */
const NEEDS_FACTS = new Set(['text', 'whatsapp', 'facebook', 'instagram']);

/** Refusals that trying again will not change: the message is written as failed with the reason, at once. */
const FINAL = new Set(['recipient_invalid', 'message_invalid', 'message_rejected', 'consent_missing', 'consent_revoked', 'consent_expired', 'consent_mismatch',
  'recipient_opted_out', 'recipient_blocked', 'recipient_not_allowed', 'outside_messaging_window', 'sender_invalid', 'sender_not_found', 'sender_not_registered',
  'region_not_allowed', 'number_not_registered', 'account_restricted', 'instagram_not_linked', 'page_not_selected', 'wrong_account', 'no_pages']);

/** Why this message may not go out, or null. Looked up from the records at the moment of sending. */
export function consentProblem(m) {
  if (m.channel === 'email') return m.emailOptOut ? 'opted_out' : null;
  if (m.channel === 'text') return m.smsOptIn ? null : 'no_consent';
  if (m.channel === 'whatsapp') return m.whatsappOptIn ? null : 'no_consent';
  if (m.channel === 'facebook' || m.channel === 'instagram') return null;
  return 'unsupported_channel';
}

const mark = (m, status, more = {}) => serviceRpc('message_mark', { p_tenant: m.tenantId, p_id: m.id, p_status: status, p_provider: more.provider || null, p_external_id: more.id || null, p_error: more.error || null });

/**
 * Delivers one queued message. `last` is true on the job's final attempt: a provider failure is then written to the
 * message instead of being retried. Returns the outcome as a word (for the tests and the log).
 */
export async function deliver(tenantId, messageId, { last = false, fetchFn } = {}) {
  const g = await serviceRpc('message_get', { p_tenant: tenantId, p_id: messageId });
  if (!g.ok) throw new JobError('store_unavailable');
  const m = g.data;
  if (!m || m.status !== 'queued' || m.dir !== 'out') return 'skipped';
  const stop = consentProblem(m);
  if (stop) { await mark(m, 'failed', { error: stop }); return 'failed:' + stop; }

  let text = m.body || '';
  if (m.link) {
    const link = openToken(m.link, 'msg-link:' + tenantId);
    if (!link || typeof link.url !== 'string') { await mark(m, 'failed', { error: 'link_unreadable' }); return 'failed:link_unreadable'; }
    text = text.split('{{link}}').join(link.url);
  }
  const giveUp = async (code) => { await mark(m, 'failed', { error: code }); return 'failed:' + code; };
  const retryOr = async (code, permanent) => { if (last || permanent) return giveUp(code); throw new JobError(code); };

  // Messages the server itself wrote (a review request) go out as system email, from the deployment's own sender.
  if (m.system && m.channel === 'email') {
    if (!emailConfigured()) return giveUp('not_connected');
    const sent = await sendSystemEmail({ to: m.recipient, subject: m.subject || m.company || 'Message', text, tenant: tenantId, idem: 'msg:' + m.id, fetchFn });
    if (sent.delivered && sent.id) { await mark(m, 'sent', { provider: 'resend', id: sent.id }); return 'sent'; }
    return retryOr(sent.reason || 'send_failed', ['recipient_invalid', 'message_invalid', 'message_rejected', 'not_configured'].includes(sent.reason));
  }

  let facts = null;
  for (const [provider, action] of ROUTES[m.channel] || []) {
    const adapter = await getAdapter(provider);
    if (!adapter || !adapter.actions || typeof adapter.actions[action] !== 'function' || !ARGS[provider]) continue;
    let ctx;
    try { ctx = await connectionCtx(adapter, tenantId, { fetchFn }); } catch (e) {
      if (e instanceof ProviderError && (e.code === 'not_connected' || e.reauth)) continue;
      return retryOr(e instanceof ProviderError ? e.code : 'provider_error', false);
    }
    // Read only once a connection exists, so a company with no provider needs nothing from the messaging tables.
    if (!facts && NEEDS_FACTS.has(m.channel)) {
      const f = await serviceRpc('messaging_outbox_get', { p_tenant: tenantId, p_id: m.id });
      if (!f.ok) return retryOr('store_unavailable', false);
      facts = f.data || {};
    }
    try {
      const out = await adapter.actions[action](ctx, ARGS[provider]({ to: m.recipient, subject: m.subject, text, channel: m.channel, idempotencyKey: 'msg:' + m.id }, facts || {}));
      // an adapter that answers without the provider's reference has not shown an acceptance
      if (!out || typeof out.id !== 'string' || !out.id) return retryOr('no_acceptance', false);
      await mark(m, 'sent', { provider, id: out.id });
      return 'sent';
    } catch (e) {
      const code = e instanceof ProviderError ? e.code : 'provider_error';
      // Quiet hours end by themselves, so that refusal is tried again (and written to the message on the last attempt).
      return retryOr(code, e instanceof ProviderError && (e.reauth || FINAL.has(code)));
    }
  }
  return giveUp('not_connected');
}

/** The job. payload: { message: <id> }. */
export async function deliverJob(job) {
  const id = String(job.payload?.message || '');
  if (!isUuid(id) || !job.tenant_id) throw new JobError('bad_payload', { permanent: true });
  await deliver(job.tenant_id, id, { last: Number(job.attempts) >= Number(job.max_attempts) });
}

/** Queues a delivery job for every message that is waiting. The key makes it one job per message, however often this runs. */
export async function queueWaiting(enqueue, max = 100) {
  const r = await serviceRpc('messages_queued', { p_limit: max });
  let n = 0;
  for (const m of r.ok ? r.data || [] : []) if (await enqueue('messages.deliver', { message: m.id }, { tenant: m.tenantId, idem: 'msg:' + m.id, maxAttempts: 5 })) n += 1;
  return n;
}
