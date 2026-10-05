// One shape for everything that arrives from a messaging provider.
// Every adapter (Meta, WhatsApp, Dialpad, SMS) turns its own payload into the platform's `Message`
// (src/domain/types.ts) through this file, so the communications center stores one kind of record whatever the
// channel, and a message exists once (the provider's id is the key that stops a second copy).
//
// What is NOT decided here: which client, lead or job a message belongs to. The adapter does not know the company's
// records. It returns `match`, the facts the store needs to find the sender (a phone number, a Page-scoped id, the
// Dialpad user who took the call), and the store does the lookup under the company's own rules.
import { sha256Hex } from '../../crypto.js';

export const CHANNELS = ['email', 'text', 'whatsapp', 'facebook', 'instagram', 'call', 'system'];
const STATUSES = ['draft', 'demo', 'queued', 'sent', 'delivered', 'failed', 'received'];
const clip = (v, n) => String(v ?? '').slice(0, n);

/**
 * A phone number as E.164 ("+15555550100"), or '' when it cannot be one.
 * Ten digits are read as a North American number, because that is how people here write them. Anything that
 * already starts with "+" keeps its own country code.
 */
export function e164(raw, defaultCountry = '1') {
  const s = String(raw ?? '').trim().replace(/^(whatsapp|tel|sms):/i, '');
  const digits = s.replace(/\D/g, '');
  if (!digits) return '';
  if (s.startsWith('+') || s.startsWith('00')) {
    const d = s.startsWith('00') ? digits.slice(2) : digits;
    return d.length >= 8 && d.length <= 15 ? '+' + d : '';
  }
  if (digits.length === 10) return '+' + defaultCountry + digits;
  if (digits.length === 11 && digits.startsWith(defaultCountry)) return '+' + digits;
  return digits.length >= 11 && digits.length <= 15 ? '+' + digits : '';
}

/** "+15555550100" -> "*** 0100". For logs and labels where the full number has no business being. */
export const maskPhone = (raw) => { const d = String(raw ?? '').replace(/\D/g, ''); return d.length >= 4 ? '*** ' + d.slice(-4) : '***'; };

/** A short, stable stand-in for an id that itself carries personal data (a WhatsApp message id holds the phone number). */
export const opaque = (value) => sha256Hex(String(value ?? '')).slice(0, 24);

/** Seconds or milliseconds since 1970, or an ISO string -> ISO string. Null when it is none of those. */
export function isoTime(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && /\D/.test(value.trim())) { const t = Date.parse(value); return Number.isFinite(t) ? new Date(t).toISOString() : null; }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n < 1e11 ? n * 1000 : n).toISOString();
}

/**
 * Builds one normalized record.
 *   message   the `Message` fields the provider can know. `id` and `ref` are missing on purpose: the store gives
 *             the id and finds the record the message belongs to.
 *   match     how to find the sender: { phone } (E.164), { handle: { kind, id } } (Page-scoped or Instagram-scoped
 *             id), { agent: { id, email } } (the team member on a call).
 *   extra     facts with no column of their own (call state, voicemail reference, attachment ids, segments).
 */
export function toMessage(m) {
  if (!CHANNELS.includes(m.channel)) throw new TypeError('channel');
  const dir = m.dir === 'in' ? 'in' : 'out';
  const status = STATUSES.includes(m.status) ? m.status : dir === 'in' ? 'received' : 'queued';
  const message = {
    at: isoTime(m.at) || new Date().toISOString(),
    channel: m.channel,
    to: clip(m.to, 320),
    subject: clip(m.subject, 300),
    body: clip(m.body, 20000),
    status, dir,
    from: clip(m.from, 320),
    provider: m.provider,
    externalId: clip(m.externalId, 300),
  };
  if (m.threadId) message.threadId = clip(m.threadId, 200);
  if (dir === 'in') message.read = false;
  if (Number.isFinite(m.seconds) && m.seconds >= 0) message.seconds = Math.round(m.seconds);
  if (m.error) message.error = clip(m.error, 60);
  const match = {};
  const other = dir === 'in' ? m.from : m.to;
  if (m.channel === 'text' || m.channel === 'whatsapp' || m.channel === 'call') { const p = e164(other); if (p) { match.phone = p; match.phoneKey = p.replace(/\D/g, '').slice(-10); } }
  if (m.handle && m.handle.id) match.handle = { kind: m.channel, id: clip(m.handle.id, 100) };
  if (m.agent && (m.agent.id || m.agent.email)) match.agent = { id: clip(m.agent.id, 100), email: clip(m.agent.email, 320).toLowerCase(), name: clip(m.agent.name, 200) };
  if (m.name) match.name = clip(m.name, 200);
  return { message, match, extra: m.extra && typeof m.extra === 'object' ? m.extra : {} };
}

/** A delivery report for a message we sent earlier. The store finds the message by provider and external id. */
export function toStatus({ provider, externalId, status, at, error, extra }) {
  return { provider, externalId: clip(externalId, 300), status: STATUSES.includes(status) ? status : 'sent', at: isoTime(at) || new Date().toISOString(), ...(error ? { error: clip(error, 60) } : {}), ...(extra ? { extra } : {}) };
}

/** Delivery states only move forward: a late "sent" must not undo a "delivered". */
const RANK = { draft: 0, queued: 1, sent: 2, failed: 3, delivered: 4, received: 5 };
export const advances = (from, to) => (RANK[to] ?? -1) > (RANK[from] ?? -1);

// ---------------------------------------------------------------------------------------------------------------------
// Text message length
// ---------------------------------------------------------------------------------------------------------------------
// A text is cut into segments by the phone network: 160 characters of the basic alphabet (153 each when there is
// more than one), or 70 (67 each) as soon as one character is outside it, which includes most accented capitals
// and every emoji. This is arithmetic from the standard (3GPP TS 23.038), not a price. No rate is assumed anywhere.
const GSM7 = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXT = '^{}\\[~]|€';

/** { segments, encoding: 'gsm7' | 'ucs2', units } for a text. An empty text has no segments. */
export function smsSegments(text) {
  const s = String(text ?? '');
  if (!s) return { segments: 0, encoding: 'gsm7', units: 0 };
  let units = 0; let basic = true;
  for (const ch of s) {
    if (GSM7.includes(ch)) units += 1;
    else if (GSM7_EXT.includes(ch)) units += 2;
    else { basic = false; break; }
  }
  if (basic) return { segments: units <= 160 ? 1 : Math.ceil(units / 153), encoding: 'gsm7', units };
  units = s.length;   // UTF-16 code units: an emoji counts as two
  return { segments: units <= 70 ? 1 : Math.ceil(units / 67), encoding: 'ucs2', units };
}
