// Consent, opt-out keywords and quiet hours for text and WhatsApp messages.
//
// The rule every sending adapter follows: no consent record, no send. The caller (the communications module, a job)
// reads the person's consent from the company's records and passes it with the message. The adapter does not look
// consent up and does not assume it: a missing, revoked, expired or mismatched record is refused with a code before
// any call to the provider.
//
// The record the caller passes:
//   { status: 'opted_in' | 'opted_out', channel: 'text' | 'whatsapp', address: '+15555550100',
//     grantedAt: ISO time, revokedAt?: ISO time, expiresAt?: ISO time, recordId?: the consent record's id }
//
// STOP, START and HELP: when a person texts one of the words below as the whole message, the adapter returns a
// consent change for the store to record. After STOP the stored status is opted_out, so the next send is refused
// here. Nothing in this file sends an automatic reply: the wording of a HELP answer is the company's to write.
import { ProviderError } from '../oauth.js';
import { e164 } from './normalize.js';

const STOP = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT', 'ALTO', 'PARAR', 'DETENER', 'BAJA', 'CANCELAR'];
const START = ['START', 'UNSTOP', 'YES', 'INICIAR', 'COMENZAR'];
const HELP = ['HELP', 'INFO', 'AYUDA'];

/** 'stop' | 'start' | 'help' | null. Only when the keyword is the whole message (case and punctuation ignored). */
export function keyword(body) {
  const word = String(body ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (!word || word.length > 12) return null;
  if (STOP.includes(word)) return 'stop';
  if (START.includes(word)) return 'start';
  if (HELP.includes(word)) return 'help';
  return null;
}

/** The change a keyword asks for, in the shape the store records. Null when the message is an ordinary one. */
export function consentChange(body, { channel, from, at }) {
  const k = keyword(body);
  if (!k) return null;
  const address = e164(from);
  if (!address) return null;
  return { action: k === 'stop' ? 'opt_out' : k === 'start' ? 'opt_in' : 'help', channel, address, at: at || new Date().toISOString(), source: 'keyword', keyword: k };
}

/**
 * Throws unless `consent` allows a message on `channel` to `to` right now.
 * Codes: consent_missing, consent_revoked (the person opted out), consent_expired, consent_mismatch (the record is
 * for another number or another channel).
 */
export function assertConsent(consent, { channel, to, now = Date.now() }) {
  if (!consent || typeof consent !== 'object') throw new ProviderError('consent_missing');
  if (consent.status === 'opted_out' || consent.revokedAt) throw new ProviderError('consent_revoked');
  if (consent.status !== 'opted_in' || !consent.grantedAt || !Number.isFinite(Date.parse(consent.grantedAt))) throw new ProviderError('consent_missing');
  if (consent.channel !== channel || !e164(to) || e164(consent.address) !== e164(to)) throw new ProviderError('consent_mismatch');
  if (consent.expiresAt && Date.parse(consent.expiresAt) <= now) throw new ProviderError('consent_expired');
  return true;
}

/**
 * Is `now` inside the quiet hours the caller passed? { start: '21:00', end: '08:00', timeZone: 'America/New_York' }.
 * The hours are the company's setting; nothing is assumed when none are passed. A window may cross midnight.
 */
export function inQuietHours(quiet, now = Date.now()) {
  if (!quiet || !/^\d{2}:\d{2}$/.test(quiet.start || '') || !/^\d{2}:\d{2}$/.test(quiet.end || '')) return false;
  let parts;
  try { parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: quiet.timeZone || 'UTC' }).formatToParts(new Date(now)); } catch { throw new ProviderError('quiet_hours_invalid'); }
  const minute = (Number(parts.find((p) => p.type === 'hour').value) % 24) * 60 + Number(parts.find((p) => p.type === 'minute').value);
  const at = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
  const a = at(quiet.start); const b = at(quiet.end);
  if (a === b) return false;
  return a < b ? minute >= a && minute < b : minute >= a || minute < b;
}

export function assertNotQuiet(quiet, now = Date.now()) {
  if (inQuietHours(quiet, now)) throw new ProviderError('quiet_hours');
}

/** The reply window messaging providers give after the person last wrote (24 hours on Messenger, Instagram and WhatsApp). */
export const WINDOW_MS = 24 * 3600 * 1000;
export function insideWindow(lastInboundAt, now = Date.now(), windowMs = WINDOW_MS) {
  const t = lastInboundAt ? Date.parse(lastInboundAt) : NaN;
  return Number.isFinite(t) && t <= now && now - t < windowMs;
}
