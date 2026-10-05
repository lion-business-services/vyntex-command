// A signature request ("envelope"): one document, one or more signers, boxes placed on its pages, and a trail of events.
// Everything here is a plain function over the envelope: no browser, no storage, no clock of its own (the caller passes
// `now`). The app runs these in sample mode; the server runs the same ones when it receives a signer's answer, so the
// rules about order, required boxes, expiry and reminders exist once.
// Ported from the signing flow of the AGC Command Center (order of signers, release of the next one, reminders, expiry,
// decline, void), with boxes placed on the page added.
import type { Envelope, ISODateTime, Lang, SignField } from '../types';
import type { EnvelopeX, PageSize, SignPayload, SignerRole, SignerView, SignerX } from './types';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A drawn signature is a small PNG. Anything larger than this is refused. */
export const MAX_SIGNATURE_CHARS = 200_000;
export const DEFAULT_EXPIRY_DAYS = 30;
export const DEFAULT_REMIND_EVERY = 3;
const DAY = 86400000;
const OPEN: Envelope['status'][] = ['sent', 'partly_signed'];

export const isOpenEnvelope = (e: Envelope): boolean => OPEN.includes(e.status);
const ms = (iso?: ISODateTime) => (iso ? Date.parse(iso) : NaN);
const event = (e: Envelope, at: ISODateTime, kind: string, signerId?: string, note?: string) => { e.events.push({ at, kind, ...(signerId ? { signerId } : {}), ...(note ? { note } : {}) }); };
const signerOf = (e: EnvelopeX, id: string): SignerX | undefined => e.signers.find((s) => s.id === id);

/* ---------- creating ---------- */

export interface NewSigner { id: string; name: string; email: string; role?: SignerRole | string; userId?: string }
export interface NewEnvelope {
  id: string; docId: string; title: string; createdBy: string; now: ISODateTime;
  signers: NewSigner[]; ordered?: boolean; expiryDays?: number; remindEvery?: number;
  lang?: Lang; message?: string; clientId?: string; jobId?: string; leadId?: string; demo?: boolean;
}
export function makeEnvelope(n: NewEnvelope): EnvelopeX {
  return {
    id: n.id, docId: n.docId, title: n.title.trim(), status: 'draft', ordered: n.ordered ?? n.signers.length > 1, fields: [], created: n.now, createdBy: n.createdBy,
    signers: n.signers.map((s, i) => ({ id: s.id, name: s.name.trim(), email: s.email.trim().toLowerCase(), role: s.role, userId: s.userId, order: i + 1, status: 'waiting' })),
    // no reminders is "no number", never 0: the database keeps 1 to 365 days or nothing
    remindEvery: (n.remindEvery ?? DEFAULT_REMIND_EVERY) || undefined, events: [{ at: n.now, kind: 'created' }],
    lang: n.lang, message: n.message?.trim() || undefined, clientId: n.clientId, jobId: n.jobId, leadId: n.leadId, demo: n.demo || undefined,
    // a number of days until the envelope is sent; `expiresAt` is worked out at that moment
    expiryDays: n.expiryDays ?? DEFAULT_EXPIRY_DAYS,
  };
}

/* ---------- boxes ---------- */

/** Default size of a box as a fraction of the page. A checkbox is drawn square, whatever the shape of the page. */
export function fieldSize(type: SignField['type'], page: PageSize): { w: number; h: number } {
  switch (type) {
    case 'signature': return { w: 0.3, h: 46 / page.h };
    case 'initials': return { w: 0.1, h: 30 / page.h };
    case 'date': return { w: 0.2, h: 18 / page.h };
    case 'checkbox': return { w: 14 / page.w, h: 14 / page.h };
    default: return { w: 0.28, h: 18 / page.h };
  }
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Keeps a box on its page and never smaller than a fingertip can grab. */
export function clampField<T extends Pick<SignField, 'x' | 'y' | 'w' | 'h'>>(f: T): T {
  const w = clamp(f.w, 0.015, 1), h = clamp(f.h, 0.01, 1);
  return { ...f, w, h, x: clamp(f.x, 0, 1 - w), y: clamp(f.y, 0, 1 - h) };
}
/** Reading order: page, then top to bottom, then left to right. This is the order a signer is taken through the boxes. */
export const byPosition = (a: SignField, b: SignField) => a.page - b.page || (Math.abs(a.y - b.y) > 0.012 ? a.y - b.y : a.x - b.x);

/**
 * A place a document offers for a signature or its date: found by the layout of a generated document. Fractions of the
 * page, from the top left. `page` counts from 1, like the page of a box (the database refuses a page 0).
 */
export interface SignAnchor { page: number; role: SignerRole; kind: 'signature' | 'date'; x: number; y: number; w: number; h: number }
/** Puts a signature box and a date box on every signature line of the document that has a signer of that role. */
export function autoPlace(anchors: SignAnchor[], signers: Pick<SignerX, 'id' | 'role'>[], id: () => string): SignField[] {
  const out: SignField[] = [];
  for (const a of anchors) {
    const who = signers.find((s) => s.role === a.role);
    if (!who) continue;
    out.push(clampField({ id: id(), signerId: who.id, type: a.kind, page: a.page, x: a.x, y: a.y, w: a.w, h: a.h, required: true }));
  }
  return out;
}

/* ---------- sending ---------- */

export type SendBlocker = 'no_signers' | 'bad_signer' | 'no_fields' | 'no_signature_box' | 'template_unapproved' | 'consent_unapproved' | 'placeholders' | 'no_document' | 'not_draft';
export interface SendChecks {
  /** False when the document was made from a template nobody has approved. */
  templateApproved: boolean;
  /** False until the company approved its own consent sentence. */
  consentApproved: boolean;
  /** True when the text still has a bracketed placeholder or a missing value. */
  hasPlaceholders?: boolean;
  hasDocument?: boolean;
}
/** Everything that stops an envelope from going out. Empty means it may be sent. */
export function sendBlockers(e: EnvelopeX, c: SendChecks): SendBlocker[] {
  const out: SendBlocker[] = [];
  if (e.status !== 'draft') out.push('not_draft');
  if (!c.templateApproved) out.push('template_unapproved');
  if (!c.consentApproved) out.push('consent_unapproved');
  if (c.hasPlaceholders) out.push('placeholders');
  if (c.hasDocument === false) out.push('no_document');
  if (!e.signers.length) out.push('no_signers');
  else if (e.signers.some((s) => s.name.trim().length < 2 || !EMAIL_RE.test(s.email))) out.push('bad_signer');
  if (!e.fields.length) out.push('no_fields');
  // every signer signs somewhere: a request where someone has nothing to sign would complete without them
  else if (e.signers.some((s) => !e.fields.some((f) => f.signerId === s.id && f.type === 'signature'))) out.push('no_signature_box');
  return out;
}

/**
 * Lets the next people sign. With a signing order that is the first one who has not signed, and only once nobody before
 * them is still signing. Without an order it is everyone still waiting. Returns who was just released, so the caller
 * can send them their link.
 */
export function release(e: EnvelopeX, now: ISODateTime): SignerX[] {
  if (!isOpenEnvelope(e)) return [];
  const waiting = [...e.signers].sort((a, b) => a.order - b.order).filter((s) => s.status === 'waiting');
  const busy = e.signers.some((s) => s.status === 'sent' || s.status === 'viewed');
  const due = e.ordered ? (busy ? [] : waiting.slice(0, 1)) : waiting;
  for (const s of due) { s.status = 'sent'; s.sentAt = now; event(e, now, 'sent', s.id); }
  return due;
}

export function send(e: EnvelopeX, now: ISODateTime, opts: { consentText: string }): SignerX[] {
  e.status = 'sent'; e.sentAt = now; e.consentText = opts.consentText;
  e.expiresAt = new Date(ms(now) + (e.expiryDays || DEFAULT_EXPIRY_DAYS) * DAY).toISOString();
  return release(e, now);
}

/* ---------- a signer's turn ---------- */

export type SignRefusal = 'not_found' | 'not_open' | 'expired' | 'not_your_turn' | 'already_signed' | 'no_consent' | 'no_name' | 'bad_signature' | 'missing_fields';
export const isExpired = (e: Envelope, now: ISODateTime): boolean => isOpenEnvelope(e) && !!e.expiresAt && ms(e.expiresAt) <= ms(now);

/** Why this signer cannot sign right now, or null when they can. */
export function cannotSign(e: EnvelopeX, signerId: string, now: ISODateTime): SignRefusal | null {
  const s = signerOf(e, signerId);
  if (!s) return 'not_found';
  if (s.status === 'signed') return 'already_signed';
  if (!isOpenEnvelope(e)) return 'not_open';
  if (isExpired(e, now)) return 'expired';
  if (s.status === 'waiting') return 'not_your_turn';
  if (s.status === 'declined') return 'not_open';
  return null;
}

/** The signer opened their page: recorded once. Returns true when this was the first time. */
export function markViewed(e: EnvelopeX, signerId: string, now: ISODateTime): boolean {
  const s = signerOf(e, signerId);
  if (!s || s.status !== 'sent' || cannotSign(e, signerId, now)) return false;
  s.status = 'viewed'; s.viewedAt = now; event(e, now, 'viewed', s.id);
  return true;
}

/** Required boxes of this signer that the answer leaves empty. */
export function missingRequired(e: { fields: SignField[] }, signerId: string, p: Pick<SignPayload, 'signature' | 'initials' | 'values'>): SignField[] {
  return e.fields.filter((f) => f.signerId === signerId && f.required).filter((f) => {
    if (f.type === 'signature') return !p.signature;
    if (f.type === 'initials') return !p.initials;
    // the date box is the date of signing, filled in by the system
    if (f.type === 'date') return false;
    if (f.type === 'checkbox') return p.values[f.id] !== 'yes';
    return !(p.values[f.id] || '').trim();
  });
}
const isPng = (s: string | undefined) => !!s && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s) && s.length <= MAX_SIGNATURE_CHARS;
/** The date written into a date box: the day of signing, in the language of the envelope. */
export const signDate = (now: ISODateTime, lang: Lang = 'en'): string => new Date(now).toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });

export type SignResult = { ok: true; completed: boolean; released: SignerX[] } | { ok: false; reason: SignRefusal; fields?: string[] };
/**
 * Records one signer's answer. Checks the turn, the consent tick, the name, the signature image and every required box,
 * fills the boxes, then either completes the envelope or lets the next signer in.
 */
export function sign(e: EnvelopeX, signerId: string, p: SignPayload, now: ISODateTime): SignResult {
  const stop = cannotSign(e, signerId, now);
  if (stop) return { ok: false, reason: stop };
  const s = signerOf(e, signerId)!;
  if (p.consent !== true) return { ok: false, reason: 'no_consent' };
  const name = String(p.typedName || '').trim().slice(0, 120);
  if (name.length < 2) return { ok: false, reason: 'no_name' };
  if (!isPng(p.signature) || (p.initials !== undefined && !isPng(p.initials))) return { ok: false, reason: 'bad_signature' };
  const missing = missingRequired(e, signerId, p);
  if (missing.length) return { ok: false, reason: 'missing_fields', fields: missing.map((f) => f.id) };

  for (const f of e.fields) {
    if (f.signerId !== signerId) continue;
    if (f.type === 'signature') f.value = 'signed';
    else if (f.type === 'initials') f.value = p.initials ? 'signed' : undefined;
    else if (f.type === 'date') f.value = signDate(now, e.lang);
    else if (f.type === 'checkbox') f.value = p.values[f.id] === 'yes' ? 'yes' : undefined;
    else f.value = (p.values[f.id] || '').trim().slice(0, 300) || undefined;
  }
  if (s.status === 'sent') { s.viewedAt = now; }
  s.status = 'signed'; s.signedAt = now; s.typedName = name; s.signature = p.signature; s.initials = p.initials; s.consent = true; s.consentAt = now;
  event(e, now, 'signed', s.id);

  if (e.signers.every((x) => x.status === 'signed')) {
    e.status = 'completed'; e.completedAt = now; event(e, now, 'completed');
    return { ok: true, completed: true, released: [] };
  }
  e.status = 'partly_signed';
  return { ok: true, completed: false, released: release(e, now) };
}

export function decline(e: EnvelopeX, signerId: string, reason: string, now: ISODateTime): { ok: boolean; reason?: SignRefusal } {
  const stop = cannotSign(e, signerId, now);
  if (stop) return { ok: false, reason: stop };
  const s = signerOf(e, signerId)!;
  s.status = 'declined'; s.declinedAt = now; s.declineReason = reason.trim().slice(0, 1000) || undefined;
  e.status = 'declined'; event(e, now, 'declined', s.id, s.declineReason);
  return { ok: true };
}

/* ---------- the office: void, remind, the daily sweep ---------- */

export function voidEnvelope(e: EnvelopeX, reason: string, now: ISODateTime): boolean {
  if (e.status !== 'draft' && !isOpenEnvelope(e)) return false;
  e.status = 'void'; e.voidReason = reason.trim().slice(0, 500) || undefined; event(e, now, 'voided', undefined, e.voidReason);
  return true;
}
/** People who have their link and have not answered. */
export const waitingOn = (e: EnvelopeX): SignerX[] => (isOpenEnvelope(e) ? e.signers.filter((s) => s.status === 'sent' || s.status === 'viewed') : []);

/** Records a reminder for everyone who has their link and has not signed. Returns who that is; the caller sends the messages. */
export function remind(e: EnvelopeX, now: ISODateTime, how: 'manual' | 'auto'): SignerX[] {
  const who = isExpired(e, now) ? [] : waitingOn(e);
  for (const s of who) { s.lastReminder = now; event(e, now, 'reminded', s.id, how === 'auto' ? 'auto' : undefined); }
  if (who.length) e.lastReminder = now;
  return who;
}
/** True when the reminder interval has passed since the last reminder (or since sending). */
export function reminderDue(e: EnvelopeX, now: ISODateTime): boolean {
  if (!isOpenEnvelope(e) || !e.remindEvery || e.remindEvery <= 0 || isExpired(e, now) || !waitingOn(e).length) return false;
  const last = ms(e.lastReminder) || ms(e.sentAt);
  return !isNaN(last) && ms(now) - last >= e.remindEvery * DAY;
}
/** One pass of the daily run over one envelope: expire it when its time is up, else remind when a reminder is due. */
export function sweep(e: EnvelopeX, now: ISODateTime): { expired: boolean; reminded: SignerX[] } {
  if (isExpired(e, now)) { e.status = 'expired'; event(e, now, 'expired'); return { expired: true, reminded: [] }; }
  return { expired: false, reminded: reminderDue(e, now) ? remind(e, now, 'auto') : [] };
}

/* ---------- reading ---------- */

/** The four lists of the signatures screen. */
export type EnvelopeBucket = 'draft' | 'out' | 'completed' | 'closed';
export const bucketOf = (e: Envelope): EnvelopeBucket => (e.status === 'draft' ? 'draft' : isOpenEnvelope(e) ? 'out' : e.status === 'completed' ? 'completed' : 'closed');
/** Position of a signer in the list, used for their colour. */
export const signerIndex = (e: Envelope, signerId: string): number => Math.max(0, e.signers.findIndex((s) => s.id === signerId));

/** What one signer may see: their own boxes to fill, what others already filled, and nobody else's email address. */
export function signerView(e: EnvelopeX, signerId: string, o: { company: string; now: ISODateTime; consentText?: string; fileUrl?: string }): SignerView | null {
  const s = signerOf(e, signerId);
  if (!s) return null;
  const state: SignerView['state'] = e.status === 'completed' ? 'completed' : e.status === 'void' || e.status === 'draft' ? 'void' : e.status === 'expired' || isExpired(e, o.now) ? 'expired'
    : s.status === 'declined' || e.status === 'declined' ? 'declined' : s.status === 'signed' ? 'signed' : s.status === 'waiting' ? 'waiting' : 'open';
  const signedIds = new Set(e.signers.filter((x) => x.status === 'signed').map((x) => x.id));
  const fields = e.fields.filter((f) => f.signerId === signerId || signedIds.has(f.signerId)).sort(byPosition)
    .map((f) => ({ ...f, mine: f.signerId === signerId, color: signerIndex(e, f.signerId), ink: fieldImage(e, f) ?? undefined, inkName: fieldInkName(e, f) ?? undefined }));
  return {
    envelopeId: e.id, signerId, title: e.title, company: o.company, lang: e.lang ?? 'en', state,
    signer: { name: s.name, email: s.email, role: s.role },
    people: [...e.signers].sort((a, b) => a.order - b.order).map((x) => ({ name: x.name, role: x.role, status: x.status, me: x.id === signerId })),
    ordered: e.ordered, message: e.message, consentText: e.consentText ?? o.consentText ?? '',
    pages: e.pages ?? [], view: e.view, images: e.images, fileUrl: o.fileUrl, fields, expiresAt: e.expiresAt, demo: !!e.demo,
  };
}
/** The name written in a signed signature box when there is no image of the signature (the signed copy does the same). */
export function fieldInkName(e: EnvelopeX, f: SignField): string | null {
  if (!f.value || (f.type !== 'signature' && f.type !== 'initials') || fieldImage(e, f)) return null;
  const s = signerOf(e, f.signerId);
  const name = s?.typedName || s?.name || '';
  return f.type === 'signature' ? name : name.split(/\s+/).filter(Boolean).map((w) => w[0]!.toUpperCase()).slice(0, 3).join('');
}
/** The image a signed box shows: the signer's signature or initials. Null for a box that holds text. */
export function fieldImage(e: EnvelopeX, f: SignField): string | null {
  if (!f.value || (f.type !== 'signature' && f.type !== 'initials')) return null;
  const s = signerOf(e, f.signerId);
  return (f.type === 'signature' ? s?.signature : s?.initials) ?? null;
}
