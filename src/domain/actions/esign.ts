// Signature requests ("envelopes") as changes to the workspace: creating one for a document, sending it, a signer opening,
// signing or declining, voiding, reminding, storing the signed copy, and the daily sweep for reminders and expiry.
// The rules themselves are the pure functions of src/domain/esign; these wrap them with the document's status, the
// history and the automations. In a sample workspace nothing is emailed: the envelope carries `demo: true`.
import type { DemoState, DocRecord, DocTemplate, FileRef, Lang, SignField } from '../types';
import { type Ctx, logActivity } from '../context';
import { permissionsOf } from '../config';
import { isOfficeRole, type Permission } from '../permissions';
import { emit } from '../rules/engine';
import {
  autoPlace, clampField, decline, isOpenEnvelope, makeEnvelope, markViewed, remind, sendBlockers, send, sign, signDate, sweep, voidEnvelope as voidIt, waitingOn,
  type NewSigner, type SendBlocker, type SignAnchor, type SignRefusal,
} from '../esign/envelope';
import { hasPlaceholder } from '../esign/merge';
import { isConsentTemplate, signRoles, type ConsentTemplate } from '../esign/templates';
import type { DocVersionX, EnvelopeHashes, EnvelopeX, EsignSettings, PageSize, PageView, SignPayload, SignerRole, SignerX } from '../esign/types';
import { isLive } from '@/platform/session';
import { nowIso, today } from '@/lib/dates';
import { uid } from '@/lib/id';
import { setJobStatus } from './jobs';

export type Done<T> = { ok: true; data: T } | { ok: false; reason: string; blockers?: SendBlocker[] };
const yes = <T>(data: T): Done<T> => ({ ok: true, data });
const no = <T>(reason: string, blockers?: SendBlocker[]): Done<T> => ({ ok: false, reason, ...(blockers ? { blockers } : {}) });

function may(d: DemoState, ctx: Ctx, ...need: Permission[]): boolean {
  const u = d.users.find((x) => x.id === ctx.actor);
  const perms = u && u.active !== false && isOfficeRole(u.role) ? permissionsOf(d, ctx.pack, u.role) : [];
  return need.every((p) => perms.includes(p));
}
const env = (d: DemoState, id: string): EnvelopeX | undefined => d.envelopes.find((e) => e.id === id) as EnvelopeX | undefined;
const docOf = (d: DemoState, e: EnvelopeX): DocRecord | undefined => d.docs.find((x) => x.id === e.docId);
/** History of a request is filed under its document's job or client, and shows on the envelope itself. */
function log(d: DemoState, by: string, kind: string, e: EnvelopeX, params?: Record<string, string | number>) {
  const also = [e.jobId && { type: 'job' as const, id: e.jobId }, e.clientId && { type: 'client' as const, id: e.clientId }, e.leadId && { type: 'lead' as const, id: e.leadId }, { type: 'doc' as const, id: e.docId }]
    .filter((x): x is { type: 'job' | 'client' | 'lead' | 'doc'; id: string } => !!x);
  logActivity(d, by, kind, { type: 'envelope', id: e.id }, { title: e.title, ...params }, also);
}
const subject = (d: DemoState, e: EnvelopeX) => ({ ref: { type: 'envelope' as const, id: e.id }, envelope: e, doc: docOf(d, e), client: d.clients.find((c) => c.id === e.clientId), job: d.jobs.find((j) => j.id === e.jobId) });

/* ---------- company settings ---------- */

const consentTpl = (d: Pick<DemoState, 'templates'>, lang: Lang): ConsentTemplate | undefined => d.templates.find((t) => isConsentTemplate(t) && t.lang === lang);
const consentText = (t: DocTemplate | undefined): string => (t?.blocks[0]?.text ?? '').trim();
/**
 * The company's signature settings. The consent sentence is kept as wording, one record per language among the templates
 * (see `isConsentTemplate`), so it has a source and an approval like any other text; the two numbers are plain settings.
 */
export function esignSettings(d: Pick<DemoState, 'settings' | 'templates'>): EsignSettings {
  const nums = (d.settings.esign as Pick<EsignSettings, 'expiryDays' | 'remindEvery'> | undefined) ?? {};
  const en = consentTpl(d, 'en'), es = consentTpl(d, 'es');
  return { consent: { en: consentText(en), es: consentText(es) }, approved: !!en?.approved, approvedBy: en?.approvedBy, approvedAt: en?.approvedAt, expiryDays: nums.expiryDays, remindEvery: nums.remindEvery };
}
/** The consent sentence in a language (English when that language has none), and whether the company approved it. */
export function consentOf(d: Pick<DemoState, 'templates'>, lang: Lang): { text: string; approved: boolean } {
  const own = consentTpl(d, lang);
  const tpl = consentText(own) ? own : consentTpl(d, 'en');
  const text = consentText(tpl);
  return { text, approved: !!tpl?.approved && !!text && !hasPlaceholder(text) };
}
/** Saves the signature settings. Changing a consent sentence takes its approval away, like any other wording. */
export function saveEsignSettings(d: DemoState, ctx: Ctx, patch: Pick<EsignSettings, 'consent' | 'expiryDays' | 'remindEvery'>): boolean {
  if (!may(d, ctx, 'config', 'write')) return false;
  for (const lang of ['en', 'es'] as const) {
    const next = patch.consent?.[lang];
    if (next === undefined) continue;
    const text = next.trim(); const cur = consentTpl(d, lang);
    if (text === consentText(cur)) continue;
    if (!cur) { if (text) d.templates.push({ id: uid('tp'), kind: 'custom', name: ctx.t('docs.consent.title'), lang, blocks: [{ id: uid('b'), type: 'p', text }], source: 'company', approved: false, active: true, use: 'consent' } as ConsentTemplate); continue; }
    cur.blocks = [{ id: 'b1', type: 'p', text }]; cur.approved = false; cur.approvedBy = undefined; cur.approvedAt = undefined;
    if (cur.source === 'starter') cur.source = 'company';
  }
  const nums = { ...((d.settings.esign as Pick<EsignSettings, 'expiryDays' | 'remindEvery'> | undefined) ?? {}) };
  if (patch.expiryDays !== undefined) nums.expiryDays = Math.min(120, Math.max(1, Math.round(patch.expiryDays) || 30));
  if (patch.remindEvery !== undefined) nums.remindEvery = Math.min(30, Math.max(0, Math.round(patch.remindEvery) || 0));
  d.settings = { ...d.settings, esign: nums };
  return true;
}
/** Records who approved the consent sentence and when, in every language it is written in. Refused while it is empty or still has a bracketed placeholder. */
export function approveConsent(d: DemoState, ctx: Ctx, approved = true): { ok: boolean; reason?: 'not_allowed' | 'placeholders' } {
  if (!may(d, ctx, 'config', 'write')) return { ok: false, reason: 'not_allowed' };
  const all = d.templates.filter((t) => isConsentTemplate(t) && consentText(t));
  if (approved && (!consentText(consentTpl(d, 'en')) || all.some((t) => hasPlaceholder(consentText(t))))) return { ok: false, reason: 'placeholders' };
  const at = nowIso();
  for (const t of all) { t.approved = approved; t.approvedBy = approved ? ctx.actor : undefined; t.approvedAt = approved ? at : undefined; }
  return { ok: true };
}

/* ---------- preparing ---------- */

/** Whether the wording of a document may go out: a document made from a template needs that template approved. */
export function templateApproved(d: Pick<DemoState, 'templates'>, doc: Pick<DocRecord, 'templateId'>): boolean {
  if (!doc.templateId) return true;
  return !!d.templates.find((t) => t.id === doc.templateId)?.approved;
}
/** Who a document asks to sign, from its signature lines. An uploaded file asks the client. */
export function signerRolesOf(d: Pick<DemoState, 'templates'>, doc: Pick<DocRecord, 'kind' | 'templateId'>): SignerRole[] {
  const tpl = doc.templateId ? d.templates.find((t) => t.id === doc.templateId) : undefined;
  if (tpl) return [...new Set(tpl.blocks.filter((b) => b.type === 'sign').flatMap((b) => signRoles(b.text)))];
  return doc.kind === 'contract' ? ['client', 'firm'] : ['client'];
}

export interface EnvelopeDraft { signers?: NewSigner[]; ordered?: boolean; expiryDays?: number; remindEvery?: number; message?: string; title?: string }
/**
 * Starts a signature request for a document, as a draft. The signers suggested are the ones the document's signature
 * lines ask for: the client, and the person acting for the company when the document has a line for it.
 */
export function createEnvelope(d: DemoState, ctx: Ctx, docId: string, draft: EnvelopeDraft = {}): Done<EnvelopeX> {
  if (!may(d, ctx, 'esign', 'write')) return no('not_allowed');
  const doc = d.docs.find((x) => x.id === docId);
  if (!doc || doc.status === 'void') return no('not_found');
  const cur = doc.envelopeId ? env(d, doc.envelopeId) : undefined;
  if (cur && cur.status === 'draft') return yes(cur);
  if (cur && isOpenEnvelope(cur)) return no('already_out');
  const client = d.clients.find((c) => c.id === doc.clientId); const lead = d.leads.find((l) => l.id === doc.leadId);
  const me = d.users.find((u) => u.id === ctx.actor);
  const tpl = d.templates.find((t) => t.id === doc.templateId);
  const s = esignSettings(d);
  const suggested: NewSigner[] = signerRolesOf(d, doc).flatMap((role): NewSigner[] => {
    if (role === 'client') return [{ id: uid('sg'), name: client?.name ?? lead?.name ?? '', email: client?.email ?? lead?.email ?? '', role }];
    if (role === 'firm') return me ? [{ id: uid('sg'), name: me.name, email: me.email, role, userId: me.id }] : [];
    // a co-owner is suggested from the owners on the client's record; a spouse is typed in by hand
    const other = role === 'co_owner' ? client?.owners?.find((o) => o.name !== client.name) : undefined;
    return [{ id: uid('sg'), name: other?.name ?? '', email: other?.email ?? '', role }];
  });
  const e = makeEnvelope({
    id: uid('ev'), docId, title: draft.title ?? `${ctx.t('doc.kind.' + doc.kind)} ${doc.number}`, createdBy: ctx.actor, now: nowIso(),
    signers: (draft.signers ?? suggested).map((x) => ({ ...x, id: x.id || uid('sg') })), ordered: draft.ordered,
    expiryDays: draft.expiryDays ?? s.expiryDays, remindEvery: draft.remindEvery ?? s.remindEvery,
    lang: tpl?.lang ?? client?.lang ?? lead?.lang ?? ctx.lang, message: draft.message, clientId: doc.clientId || undefined, jobId: doc.jobId || undefined, leadId: doc.leadId,
    demo: !isLive(),
  });
  e.docNumber = doc.number; e.docKind = doc.kind;
  d.envelopes.unshift(e);
  doc.envelopeId = e.id;
  return yes(e);
}

export interface EnvelopePatch extends EnvelopeDraft { fields?: SignField[] }
/** Changes a draft: who signs, in which order, the boxes on the pages, the options. A request that is out cannot be changed. */
export function saveEnvelope(d: DemoState, ctx: Ctx, id: string, patch: EnvelopePatch): Done<EnvelopeX> {
  if (!may(d, ctx, 'esign', 'write')) return no('not_allowed');
  const e = env(d, id);
  if (!e) return no('not_found');
  if (e.status !== 'draft') return no('not_draft');
  if (patch.signers) {
    const before = new Map(e.signers.map((s) => [s.id, s]));
    e.signers = patch.signers.map((s, i): SignerX => ({ ...(before.get(s.id) ?? { status: 'waiting' as const }), id: s.id || uid('sg'), name: s.name.trim(), email: s.email.trim().toLowerCase(), role: s.role, userId: s.userId, order: i + 1, status: 'waiting' }));
    // a box belongs to a signer: when the signer goes, so do their boxes
    const ids = new Set(e.signers.map((s) => s.id));
    e.fields = e.fields.filter((f) => ids.has(f.signerId));
  }
  if (patch.fields) { const ids = new Set(e.signers.map((s) => s.id)); e.fields = patch.fields.filter((f) => ids.has(f.signerId)).map((f) => clampField({ ...f, value: undefined })); }
  if (patch.ordered !== undefined) e.ordered = patch.ordered;
  if (patch.expiryDays !== undefined) e.expiryDays = Math.min(120, Math.max(1, Math.round(patch.expiryDays) || 30));
  if (patch.remindEvery !== undefined) e.remindEvery = Math.min(30, Math.max(0, Math.round(patch.remindEvery) || 0)) || undefined;
  if (patch.message !== undefined) e.message = patch.message.trim() || undefined;
  if (patch.title !== undefined && patch.title.trim()) e.title = patch.title.trim();
  return yes(e);
}
/** Throws a draft away. The document keeps nothing of it. */
export function deleteEnvelope(d: DemoState, ctx: Ctx, id: string): boolean {
  const e = env(d, id);
  if (!e || e.status !== 'draft' || !may(d, ctx, 'esign', 'write')) return false;
  d.envelopes = d.envelopes.filter((x) => x.id !== id);
  const doc = docOf(d, e); if (doc && doc.envelopeId === id) doc.envelopeId = undefined;
  return true;
}

/* ---------- sending ---------- */

/** The PDF that goes out and what a signer needs to see it. Made in the browser (or on the server) right before sending. */
export interface PreparedDocument { source: FileRef; pages: PageSize[]; view?: PageView[]; images?: Record<string, string>; originalHash: string; hasPlaceholders: boolean }
/** What stops this envelope from being sent right now. `prepared` is left out to ask before the PDF exists. */
export function envelopeBlockers(d: DemoState, e: EnvelopeX, prepared?: Pick<PreparedDocument, 'hasPlaceholders'> & { source?: FileRef }): SendBlocker[] {
  const doc = docOf(d, e);
  return sendBlockers(e, {
    templateApproved: !!doc && templateApproved(d, doc), consentApproved: consentOf(d, e.lang ?? 'en').approved,
    hasPlaceholders: prepared?.hasPlaceholders, hasDocument: !doc || doc.status === 'void' ? false : prepared ? !!prepared.source : undefined,
  });
}
/**
 * A request that is not a sample belongs to the server from the moment it goes out. Sending it, a signer opening,
 * signing or declining, a reminder, expiry and the signed copy are facts about people outside the company: the database
 * refuses them from a signed-in person, so in a company workspace they are server calls, never a change made here.
 * A person there prepares the draft and may void a request. Everything below that moves a sent request checks this.
 */
const serverOnly = (e: EnvelopeX): boolean => !e.demo;

/**
 * Sends a draft. Refused, with every reason, when the wording was not approved, the consent sentence is missing, a signer
 * has no signature box, and so on. In a sample workspace no message leaves: the people who may sign now are marked as
 * having their link, and the signing page opens inside the app. In a company workspace the server sends the links: this
 * action answers `server_only` there and changes nothing.
 */
export function sendEnvelope(d: DemoState, ctx: Ctx, id: string, prepared: PreparedDocument): Done<{ released: SignerX[] }> {
  if (!may(d, ctx, 'esign', 'write')) return no('not_allowed');
  const e = env(d, id);
  if (!e) return no('not_found');
  const blockers = envelopeBlockers(d, e, prepared);
  if (blockers.length) return no(blockers[0], blockers);
  if (serverOnly(e)) return no('server_only');
  const doc = docOf(d, e)!;
  e.source = prepared.source; e.pages = prepared.pages; e.view = prepared.view; e.images = prepared.images; e.hashes = { original: prepared.originalHash };
  e.docNumber = doc.number; e.docKind = doc.kind;
  const released = send(e, nowIso(), { consentText: consentOf(d, e.lang ?? 'en').text });
  doc.status = 'sent'; doc.updated = today(); doc.envelopeId = e.id;
  log(d, ctx.actor, 'env.sent', e, { n: e.signers.length });
  emit(d, ctx, 'doc.sent', { ...subject(d, e), ref: { type: 'doc', id: doc.id } });
  return yes({ released });
}

/**
 * Gives a sample envelope the document it stands for. The sample business ships its signature requests without their
 * PDF (a sample is built without a browser); the first time one is opened the document is drawn, and the boxes go on its
 * signature lines, filled in for whoever the sample says has signed. Never used for a request someone actually sent:
 * that one always carries the file that went out.
 */
export function attachEnvelopeSource(d: DemoState, _ctx: Ctx, id: string, prepared: PreparedDocument, anchors: SignAnchor[]): boolean {
  const e = env(d, id);
  if (!e || e.source || !e.demo || e.status === 'draft') return false;
  e.source = prepared.source; e.pages = prepared.pages; e.view = prepared.view; e.images = prepared.images; e.hashes = { original: prepared.originalHash };
  if (!e.fields.length) {
    e.fields = autoPlace(anchors, e.signers, () => uid('fd'));
    for (const f of e.fields) {
      const s = e.signers.find((x) => x.id === f.signerId);
      if (s?.status === 'signed') f.value = f.type === 'date' ? signDate(s.signedAt ?? nowIso(), e.lang) : 'signed';
    }
  }
  return true;
}

/* ---------- the signer ---------- */

/** A signer opened their page. Recorded the first time only. */
export function viewEnvelope(d: DemoState, _ctx: Ctx, id: string, signerId: string): boolean {
  const e = env(d, id);
  if (!e || serverOnly(e) || !markViewed(e, signerId, nowIso())) return false;
  const doc = docOf(d, e); if (doc && doc.status === 'sent') { doc.status = 'viewed'; doc.updated = today(); }
  log(d, 'system', 'env.viewed', e, { name: e.signers.find((s) => s.id === signerId)?.name ?? '' });
  return true;
}
/** A signer's answer. When it was the last one the envelope is complete: the document is signed and the automations hear of it. */
export function signEnvelope(d: DemoState, ctx: Ctx, id: string, signerId: string, payload: SignPayload): Done<{ completed: boolean; released: SignerX[] }> & { reason?: SignRefusal | string; fields?: string[] } {
  const e = env(d, id);
  if (!e) return no('not_found');
  if (serverOnly(e)) return no('server_only');
  const r = sign(e, signerId, payload, nowIso());
  if (!r.ok) return { ok: false, reason: r.reason, fields: r.fields };
  const doc = docOf(d, e);
  log(d, 'system', 'env.signed', e, { name: e.signers.find((s) => s.id === signerId)?.name ?? '' });
  if (r.completed) {
    if (doc) {
      doc.status = 'signed'; doc.updated = today();
      // the signed agreement is what an engagement waits for: it starts, as it does with the one-signer signature
      const job = d.jobs.find((j) => j.id === doc.jobId);
      if (job && job.status === 'contract' && (doc.kind === 'contract' || doc.kind === 'engagement_letter' || doc.kind === 'service_agreement')) setJobStatus(d, ctx, job.id, 'progress');
    }
    log(d, 'system', 'env.completed', e);
    emit(d, ctx, 'envelope.completed', subject(d, e));
  }
  return yes({ completed: r.completed, released: r.released });
}
export function declineEnvelope(d: DemoState, _ctx: Ctx, id: string, signerId: string, reason: string): Done<true> {
  const e = env(d, id);
  if (!e) return no('not_found');
  if (serverOnly(e)) return no('server_only');
  const r = decline(e, signerId, reason, nowIso());
  if (!r.ok) return no(r.reason ?? 'not_open');
  // the document can be changed and sent again
  const doc = docOf(d, e); if (doc && (doc.status === 'sent' || doc.status === 'viewed')) { doc.status = 'draft'; doc.updated = today(); }
  log(d, 'system', 'env.declined', e, { name: e.signers.find((s) => s.id === signerId)?.name ?? '' });
  return yes(true);
}

/* ---------- the office ---------- */

export function voidEnvelope(d: DemoState, ctx: Ctx, id: string, reason = ''): Done<true> {
  if (!may(d, ctx, 'esign', 'write')) return no('not_allowed');
  const e = env(d, id);
  if (!e) return no('not_found');
  if (!voidIt(e, reason, nowIso())) return no('not_open');
  const doc = docOf(d, e); if (doc && (doc.status === 'sent' || doc.status === 'viewed')) { doc.status = 'draft'; doc.updated = today(); }
  log(d, ctx.actor, 'env.voided', e);
  return yes(true);
}
/** Reminds everyone who has their link and has not signed. Sample: recorded only. Live: the server sends the messages. */
export function remindEnvelope(d: DemoState, ctx: Ctx, id: string): Done<{ reminded: number }> {
  if (!may(d, ctx, 'esign', 'write')) return no('not_allowed');
  const e = env(d, id);
  if (!e) return no('not_found');
  if (serverOnly(e)) return no('server_only');
  const who = remind(e, nowIso(), 'manual');
  if (!who.length) return no('not_open');
  log(d, ctx.actor, 'env.reminded', e, { n: who.length });
  return yes({ reminded: who.length });
}
/** Stores the signed copy with its fingerprints: on the envelope, and as a new version of the document. */
export function attachSignedCopy(d: DemoState, _ctx: Ctx, id: string, file: FileRef, hashes: Required<EnvelopeHashes>): boolean {
  const e = env(d, id);
  if (!e || serverOnly(e) || e.status !== 'completed' || e.signedFile) return false;
  e.signedFile = file; e.hashes = hashes;
  e.events.push({ at: nowIso(), kind: 'signed_copy', note: hashes.final });
  const doc = docOf(d, e);
  if (doc) {
    const versions = (doc.versions ?? []) as DocVersionX[];
    versions.push({ v: Math.max(0, ...versions.map((x) => x.v)) + 1, at: nowIso(), by: 'system', kind: 'signed', file });
    doc.versions = versions; doc.file = file; doc.updated = today();
  }
  return true;
}

/**
 * The daily pass over every request that is out: one whose time is up expires (its document goes back to a draft), and
 * one whose reminder interval has passed gets its reminder recorded. Called by the daily run.
 */
export function sweepEnvelopes(d: DemoState, ctx: Ctx): { expired: number; reminded: number } {
  let expired = 0, reminded = 0;
  const now = nowIso();
  for (const raw of d.envelopes) {
    const e = raw as EnvelopeX;
    // a request of a company workspace is swept by the server's own daily run
    if (!isOpenEnvelope(e) || serverOnly(e)) continue;
    const r = sweep(e, now);
    if (r.expired) {
      expired++;
      const doc = docOf(d, e); if (doc && (doc.status === 'sent' || doc.status === 'viewed')) { doc.status = 'draft'; doc.updated = today(); }
      log(d, 'system', 'env.expired', e);
    } else if (r.reminded.length) {
      reminded += r.reminded.length;
      log(d, 'automation', 'env.reminded', e, { n: r.reminded.length });
      emit(d, ctx, 'envelope.idle', { ...subject(d, e), extra: { waiting: waitingOn(e).length, days: e.remindEvery ?? 0 } });
    }
  }
  return { expired, reminded };
}
/** How many requests are waiting on someone: the number next to Signatures in the menu. */
export const envelopesWaiting = (d: Pick<DemoState, 'envelopes'>): number => d.envelopes.filter(isOpenEnvelope).length;
