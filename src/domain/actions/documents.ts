// Documents: the ones written from a job (estimate, agreement, invoice), the ones written from a template for a client
// (engagement letter, service order, service agreement and the like), uploaded files with their versions, and the
// templates themselves. The one-signer demo signature of the field editions lives here too; requests with several
// signers and boxes on the page are in ./esign.ts.
import type { DemoState, DocKind, DocRecord, DocTemplate, FileRef, Lang } from '../types';
import { type Ctx, logActivity } from '../context';
import { permissionsOf } from '../config';
import { isOfficeRole, type Permission } from '../permissions';
import { emit } from '../rules/engine';
import { adoptStarter, canApprove, fromStarter, isTemplateKind, pickTemplate, starterTemplate } from '../esign/templates';
import type { DocVersionX } from '../esign/types';
import { nowIso, today } from '@/lib/dates';
import { uid } from '@/lib/id';
import { isLive } from '@/platform/session';
import { setJobStatus } from './jobs';

/** Short code of each kind inside a document number: VP-EL-1004. */
const CODE: Record<DocKind, string> = { contract: 'C', invoice: 'INV', estimate: 'EST', engagement_letter: 'EL', service_order: 'SO', service_agreement: 'SA', consent_7216: 'CON', poa_2848: 'POA', upload: 'FILE', custom: 'DOC' };
/** Next free number for a kind of document: the highest in use plus one, so two documents never share a number. */
const numberFor = (d: DemoState, ctx: Ctx, kind: DocKind): string => {
  const n = Math.max(1000, ...d.docs.filter((x) => x.kind === kind).map((x) => parseInt(x.number.split('-').pop() || '', 10) || 0)) + 1;
  return `${ctx.pack.ticketPrefix}${CODE[kind]}-${n}`;
};
/** Whether the person acting holds every capability named. Someone who was switched off holds nothing. */
function may(d: DemoState, ctx: Ctx, ...need: Permission[]): boolean {
  const u = d.users.find((x) => x.id === ctx.actor);
  const perms = u && u.active !== false && isOfficeRole(u.role) ? permissionsOf(d, ctx.pack, u.role) : [];
  return need.every((p) => perms.includes(p));
}
/** Where a document's history is filed: its job when it has one, else its client, else its lead. */
const home = (doc: Pick<DocRecord, 'id' | 'jobId' | 'clientId' | 'leadId'>) => (doc.jobId ? { type: 'job' as const, id: doc.jobId } : doc.clientId ? { type: 'client' as const, id: doc.clientId } : doc.leadId ? { type: 'lead' as const, id: doc.leadId } : { type: 'doc' as const, id: doc.id });
const alsoClient = (doc: Pick<DocRecord, 'jobId' | 'clientId'>) => (doc.jobId && doc.clientId ? [{ type: 'client' as const, id: doc.clientId }] : undefined);
const subject = (d: DemoState, doc: DocRecord) => ({ ref: { type: 'doc' as const, id: doc.id }, doc, client: d.clients.find((c) => c.id === doc.clientId), job: d.jobs.find((j) => j.id === doc.jobId), lead: d.leads.find((l) => l.id === doc.leadId) });

export function createDoc(d: DemoState, ctx: Ctx, jobId: string, kind: DocKind): DocRecord | null {
  const j = d.jobs.find((x) => x.id === jobId); if (!j) return null;
  const existing = d.docs.find((x) => x.jobId === jobId && x.kind === kind && x.status !== 'void'); if (existing) return existing;
  const doc: DocRecord = { id: uid('d'), kind, number: numberFor(d, ctx, kind), title: j.name, jobId, clientId: j.clientId, status: 'draft', created: today(), updated: today() };
  d.docs.unshift(doc);
  logActivity(d, ctx.actor, 'doc.created', { type: 'job', id: jobId }, { doc: ctx.t('doc.kind.' + kind) }, [{ type: 'client', id: j.clientId }]);
  return doc;
}
export function saveDocEdits(d: DemoState, ctx: Ctx, docId: string, edits: Record<string, string> | undefined) {
  const doc = d.docs.find((x) => x.id === docId); if (!doc) return;
  // the text being replaced is kept as a version, so an earlier wording can be brought back
  const versions = (doc.versions ?? []) as DocVersionX[];
  versions.push({ v: Math.max(0, ...versions.map((x) => x.v)) + 1, at: nowIso(), by: ctx.actor, kind: 'edit', edits: { ...(doc.edits || {}) } });
  doc.versions = versions.slice(-25);
  doc.edits = edits && Object.keys(edits).length ? edits : undefined; doc.updated = today();
  if (edits) logActivity(d, ctx.actor, 'doc.edited', home(doc), { doc: ctx.t('doc.kind.' + doc.kind) });
}
/** Demo e-signature: records the request and its status changes. No legal signature takes place in demo mode. */
export function sendForSignature(d: DemoState, ctx: Ctx, docId: string, signerName: string, signerEmail: string) {
  const doc = d.docs.find((x) => x.id === docId); if (!doc) return;
  doc.esign = { demo: true, signerName, signerEmail, status: 'sent', sentAt: nowIso() }; doc.status = 'sent'; doc.updated = today();
  logActivity(d, ctx.actor, 'doc.sent', { type: 'job', id: doc.jobId }, { doc: ctx.t('doc.kind.' + doc.kind) }, [{ type: 'client', id: doc.clientId }]);
  emit(d, ctx, 'doc.sent', subject(d, doc));
}
export function advanceSignature(d: DemoState, ctx: Ctx, docId: string, to: 'viewed' | 'signed') {
  const doc = d.docs.find((x) => x.id === docId); if (!doc || !doc.esign) return;
  if (to === 'viewed') { doc.esign.status = 'viewed'; doc.esign.viewedAt = nowIso(); doc.status = 'viewed'; }
  else {
    doc.esign.status = 'signed'; doc.esign.signedAt = nowIso(); if (!doc.esign.viewedAt) doc.esign.viewedAt = doc.esign.signedAt; doc.status = 'signed';
    logActivity(d, 'system', 'doc.signed', { type: 'job', id: doc.jobId }, { doc: ctx.t('doc.kind.' + doc.kind) }, [{ type: 'client', id: doc.clientId }]);
    const j = d.jobs.find((x) => x.id === doc.jobId);
    if (j && doc.kind === 'contract' && j.status === 'contract') setJobStatus(d, ctx, j.id, 'progress');
  }
  doc.updated = today();
}
export function setDocStatus(d: DemoState, ctx: Ctx, docId: string, status: DocRecord['status']) {
  const doc = d.docs.find((x) => x.id === docId); if (!doc) return;
  const was = doc.status; doc.status = status; doc.updated = today();
  // handed over by hand and marked as sent: the automations hear about it the same way
  if (status === 'sent' && was !== 'sent') emit(d, ctx, 'doc.sent', subject(d, doc));
}

/* ---------- documents written from a template ---------- */

/**
 * Creates a document of a kind for a client, with or without an engagement. An estimate, agreement or invoice is written
 * from its job. Every other kind is written from a template: the one asked for, else the company's active template of
 * that kind in the client's language, else its English one, else the edition's starter structure.
 * Asking twice gives the same draft back instead of a second one.
 */
export function createDocFromTemplate(d: DemoState, ctx: Ctx, input: { kind: DocKind; clientId: string; jobId?: string; leadId?: string; templateId?: string }): DocRecord | null {
  const { kind } = input;
  const job = input.jobId ? d.jobs.find((x) => x.id === input.jobId) : undefined;
  if (kind === 'estimate' || kind === 'contract' || kind === 'invoice') return job ? createDoc(d, ctx, job.id, kind) : null;
  if (!isTemplateKind(kind)) return null;
  const client = d.clients.find((x) => x.id === (input.clientId || job?.clientId));
  const lead = input.leadId ? d.leads.find((x) => x.id === input.leadId) : undefined;
  if (!client && !lead) return null;
  const lang: Lang = client?.lang ?? lead?.lang ?? ctx.lang;
  const picked = pickTemplate(d, kind, lang, input.templateId);
  if (!picked) return null;
  // a starter the company has not touched yet becomes its own copy the first time it is used, so it can be edited and approved
  const known = d.templates.some((x) => x.id === picked.id);
  const tpl = known ? picked : adoptStarter(picked, isLive() ? uid : undefined);
  if (!known) d.templates.push(tpl);
  const same = d.docs.find((x) => x.kind === kind && x.status === 'draft' && x.templateId === tpl.id && x.clientId === (client?.id ?? '') && x.jobId === (job?.id ?? '') && (x.leadId ?? '') === (lead?.id ?? ''));
  if (same) return same;
  const doc: DocRecord = {
    id: uid('d'), kind, number: numberFor(d, ctx, kind), title: job?.name ?? ctx.t('doc.kind.' + kind), jobId: job?.id ?? '', clientId: client?.id ?? '', status: 'draft', created: today(), updated: today(),
    templateId: tpl.id, ...(lead ? { leadId: lead.id } : {}),
  };
  d.docs.unshift(doc);
  logActivity(d, ctx.actor, 'doc.created', home(doc), { doc: ctx.t('doc.kind.' + kind) }, alsoClient(doc));
  return doc;
}

/** Brings back the text a document had before a saved edit. The current text becomes a version itself. */
export function restoreDocVersion(d: DemoState, ctx: Ctx, docId: string, v: number): boolean {
  const doc = d.docs.find((x) => x.id === docId); if (!doc) return false;
  const ver = ((doc.versions ?? []) as DocVersionX[]).find((x) => x.v === v && x.kind === 'edit');
  if (!ver) return false;
  saveDocEdits(d, ctx, docId, ver.edits && Object.keys(ver.edits).length ? { ...ver.edits } : undefined);
  return true;
}

/* ---------- uploaded files ---------- */

export interface UploadInput { file: FileRef; title?: string; kind?: DocKind; clientId?: string; jobId?: string; leadId?: string; folder?: string }
/** Files an uploaded document under a client, an engagement or a lead. The file itself was stored through the gateway first. */
export function addUpload(d: DemoState, ctx: Ctx, input: UploadInput): DocRecord | null {
  const job = input.jobId ? d.jobs.find((x) => x.id === input.jobId) : undefined;
  const clientId = input.clientId || job?.clientId || '';
  if (!clientId && !job && !input.leadId) return null;
  const kind = input.kind ?? 'upload';
  const first: DocVersionX = { v: 1, at: nowIso(), by: ctx.actor, kind: 'upload', file: input.file };
  const doc: DocRecord = {
    id: uid('d'), kind, number: numberFor(d, ctx, kind), title: (input.title || '').trim() || input.file.name.replace(/\.[A-Za-z0-9]{1,5}$/, ''), jobId: job?.id ?? '', clientId, status: 'draft', created: today(), updated: today(),
    file: input.file, versions: [first], ...(input.folder?.trim() ? { folder: input.folder.trim() } : {}), ...(input.leadId ? { leadId: input.leadId } : {}),
  };
  d.docs.unshift(doc);
  logActivity(d, ctx.actor, 'doc.uploaded', home(doc), { file: input.file.name }, alsoClient(doc));
  return doc;
}
/** A newer file for the same document. Older versions stay on the record and can still be downloaded. */
export function addDocVersion(d: DemoState, ctx: Ctx, docId: string, file: FileRef, note?: string): boolean {
  const doc = d.docs.find((x) => x.id === docId); if (!doc) return false;
  // a request that is out for signature was sent with the earlier file: it has to be voided before the file changes
  const env = d.envelopes.find((e) => e.id === doc.envelopeId);
  if (env && (env.status === 'sent' || env.status === 'partly_signed')) return false;
  const versions = (doc.versions ?? []) as DocVersionX[];
  versions.push({ v: Math.max(0, ...versions.map((x) => x.v)) + 1, at: nowIso(), by: ctx.actor, kind: 'upload', file, ...(note?.trim() ? { note: note.trim() } : {}) });
  doc.versions = versions; doc.file = file; doc.updated = today();
  if (doc.status === 'signed') doc.status = 'draft';
  logActivity(d, ctx.actor, 'doc.version', home(doc), { file: file.name, v: versions[versions.length - 1].v }, alsoClient(doc));
  return true;
}
export function updateDocMeta(d: DemoState, _ctx: Ctx, docId: string, patch: { title?: string; folder?: string }) {
  const doc = d.docs.find((x) => x.id === docId); if (!doc) return;
  if (patch.title !== undefined && patch.title.trim()) doc.title = patch.title.trim();
  if (patch.folder !== undefined) doc.folder = patch.folder.trim() || undefined;
  doc.updated = today();
}

/* ---------- templates ---------- */

export type TemplateInput = Pick<DocTemplate, 'kind' | 'name' | 'lang' | 'blocks'> & { id?: string; active?: boolean; /** `supplied`: wording handed to the company by its adviser. `company`: wording the company wrote. */ source?: 'supplied' | 'company' };
/**
 * Saves a template. Needs the `config` capability. Changing the wording of an approved template takes its approval away:
 * what was approved is no longer what the template says, so someone has to approve it again.
 */
export function saveTemplate(d: DemoState, ctx: Ctx, input: TemplateInput): DocTemplate | null {
  if (!may(d, ctx, 'config', 'write') || !input.name.trim()) return null;
  const blocks = input.blocks.map((x) => ({ id: x.id || uid('b'), type: x.type, text: x.text.replace(/\r/g, '').trim() })).filter((x) => x.type === 'sign' || x.text);
  let tpl = input.id ? d.templates.find((x) => fromStarter(x, input.id!)) : undefined;
  // a starter that is not in the company's list yet is copied in on its first save
  if (!tpl && input.id) { const starter = starterTemplate(input.kind, input.lang); if (starter && starter.id === input.id) { tpl = adoptStarter(starter, isLive() ? uid : undefined); d.templates.push(tpl); } }
  if (!tpl) { tpl = { id: uid('tp'), kind: input.kind, name: input.name.trim(), lang: input.lang, blocks, source: input.source === 'supplied' ? 'supplied' : 'company', approved: false, active: input.active ?? true }; d.templates.push(tpl); return tpl; }
  const changed = JSON.stringify(tpl.blocks.map((x) => [x.type, x.text])) !== JSON.stringify(blocks.map((x) => [x.type, x.text]));
  tpl.name = input.name.trim(); tpl.lang = input.lang; tpl.kind = input.kind; tpl.blocks = blocks;
  if (input.active !== undefined) tpl.active = input.active;
  if ((input.source === 'supplied' || input.source === 'company') && tpl.source !== 'starter') tpl.source = input.source;
  if (changed) {
    // wording typed by the company is the company's, even when it started from the starter structure
    if (tpl.source === 'starter') tpl.source = input.source === 'supplied' ? 'supplied' : 'company';
    if (tpl.approved) { tpl.approved = false; tpl.approvedBy = undefined; tpl.approvedAt = undefined; }
  }
  return tpl;
}
/** Marks a template as approved by the person acting, with the time. Refused while a placeholder is still in the text. */
export function approveTemplate(d: DemoState, ctx: Ctx, templateId: string, approved = true): { ok: boolean; reason?: 'not_allowed' | 'not_found' | 'placeholders' } {
  if (!may(d, ctx, 'config', 'write')) return { ok: false, reason: 'not_allowed' };
  const tpl = d.templates.find((x) => x.id === templateId);
  if (!tpl) return { ok: false, reason: 'not_found' };
  if (!approved) { tpl.approved = false; tpl.approvedBy = undefined; tpl.approvedAt = undefined; return { ok: true }; }
  if (!canApprove(tpl)) return { ok: false, reason: 'placeholders' };
  tpl.approved = true; tpl.approvedBy = ctx.actor; tpl.approvedAt = nowIso();
  logActivity(d, ctx.actor, 'tpl.approved', { type: 'user', id: ctx.actor }, { template: tpl.name });
  return { ok: true };
}
export function setTemplateActive(d: DemoState, ctx: Ctx, templateId: string, active: boolean) {
  if (!may(d, ctx, 'config', 'write')) return;
  const tpl = d.templates.find((x) => x.id === templateId); if (tpl) tpl.active = active;
}
/** Removes a template nobody used. One that documents were made from is switched off instead, so those documents keep their text. */
export function deleteTemplate(d: DemoState, ctx: Ctx, templateId: string): 'deleted' | 'switched_off' | 'refused' {
  if (!may(d, ctx, 'config', 'write')) return 'refused';
  const tpl = d.templates.find((x) => x.id === templateId); if (!tpl) return 'refused';
  if (d.docs.some((x) => x.templateId === templateId)) { tpl.active = false; return 'switched_off'; }
  d.templates = d.templates.filter((x) => x.id !== templateId);
  return 'deleted';
}
