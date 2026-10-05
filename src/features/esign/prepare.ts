// The browser side of a signature request: reading a stored file, making the PDF that goes out, sending, and building the
// signed copy once everyone has signed. The rules are in src/domain/esign; this file does the parts that need a browser
// (drawing a document, reading a File, handing a download to the person).
// In a sample workspace every file stays in this browser. In a live one the signed copy is built by the server when the
// last signer finishes, with the same `buildSignedPdf`.
import type { DemoState, DocRecord, FileRef, Lang, SignField } from '@/domain/types';
import type { IndustryPack } from '@/packs/types';
import type { EnvelopeX, PageSize, PageView, SampleFileRef } from '@/domain/esign/types';
import { tinyPdf } from '@/domain/esign/tinypdf';
import type { SendBlocker, SignAnchor } from '@/domain/esign/envelope';
import { bytesDataUrl, dataUrlBytes, pageFrame, pdfLib, readPages, sha256Hex, type PdfProblem } from '@/domain/esign/pdfkit';
import { buildSignedPdf } from '@/domain/esign/stamp';
import { attachSignedCopy, remindEnvelope, sendEnvelope } from '@/domain/actions';
import { attachEnvelopeSource, envelopeBlockers, type Done, type PreparedDocument } from '@/domain/actions/esign';
import { PACKS } from '@/packs';
import { gateway } from '@/platform/gateway';
import { isLive } from '@/platform/session';
import { act, ctx, getSnapshot, mutateQuiet, syncNow } from '@/store/store';
import { syncStatus } from '@/platform/live/status';
import type { Ctx } from '@/domain/context';
import { DEPLOY } from '@/config/deployment';
import { buildDoc, isFileDoc } from '@/features/documents/model';
import { renderDoc, saveFile } from '@/features/documents/pdf';

/** Largest file kept in a sample workspace (it lives in this browser's storage), and the server's limit in a live one. */
export const SAMPLE_MAX_BYTES = 600_000, LIVE_MAX_BYTES = 4_000_000;
export const uploadLimit = (): number => (isLive() ? LIVE_MAX_BYTES : SAMPLE_MAX_BYTES);
/** File types the private storage accepts. */
export const ACCEPT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain', 'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
export const ACCEPT_ATTR = '.pdf,.jpg,.jpeg,.png,.webp,.txt,.csv,.docx,.xlsx';
export const isPdf = (f: Pick<FileRef, 'mime' | 'name'> | undefined): boolean => !!f && (f.mime === 'application/pdf' || /\.pdf$/i.test(f.name));
export const isImage = (f: Pick<FileRef, 'mime'> | undefined): boolean => !!f && /^image\/(png|jpeg|webp)$/.test(f.mime);
export const fileSize = (n: number): string => (n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1000)) + ' KB');

/** The bytes of a stored file. Sample: from the browser. Live: through a short-lived address the server hands out. */
export async function fileBytes(ref: FileRef | undefined): Promise<Uint8Array | null> {
  if (!ref) return null;
  try {
    if (ref.dataUrl) return dataUrlBytes(ref.dataUrl);
    // a made-up file of the sample business: a few lines of text, written out as a one-page PDF here
    const lines = (ref as SampleFileRef).sample;
    if (lines) return tinyPdf(lines);
    const url = await gateway().files.url(ref);
    if (!url.ok) return null;
    const res = await fetch(url.data, { credentials: 'same-origin' });
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch { return null; }
}
/** An address this page made itself for a file it already holds, to show or open it. The caller releases it when done. */
export async function objectUrl(ref: FileRef | undefined): Promise<string | null> {
  const bytes = await fileBytes(ref);
  return bytes && ref ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: ref.mime || 'application/octet-stream' })) : null;
}
export async function downloadFile(ref: FileRef | undefined, name?: string): Promise<boolean> {
  const bytes = await fileBytes(ref);
  if (!bytes || !ref) return false;
  saveFile(bytes, name || ref.name, ref.mime || 'application/octet-stream');
  return true;
}
/** Opens a stored file in a new tab, with the browser's own viewer. */
export async function openFile(ref: FileRef | undefined): Promise<boolean> {
  const url = await objectUrl(ref);
  if (!url) return false;
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}
/** Stores bytes made in the browser (a generated PDF, a signed copy) privately, like an upload. */
export async function storeBytes(bytes: Uint8Array, name: string, where: { clientId?: string; jobId?: string; docId?: string; folder?: string }): Promise<FileRef | null> {
  // a sample keeps the file in this browser as it is: no size limit applies to what the app made itself
  if (!isLive()) return { name, size: bytes.length, mime: 'application/pdf', dataUrl: bytesDataUrl(bytes, 'application/pdf') };
  const out = await gateway().files.upload(new File([bytes as BlobPart], name, { type: 'application/pdf' }), where);
  return out.ok ? out.data : null;
}

/** A document made ready for a signature request: the PDF, its pages, and where its signature lines are. */
export interface DrawnDocument { bytes: Uint8Array; name: string; pages: PageSize[]; view?: PageView[]; images?: Record<string, string>; anchors: SignAnchor[]; hasPlaceholders: boolean; /** Set for an uploaded file: it is sent as it is. */ file?: FileRef }
export type DrawProblem = PdfProblem | 'not_pdf' | 'no_file' | 'no_document';

/** Makes the PDF of a document as it stands now. An uploaded PDF is used as it is; anything else is drawn from its text. */
export async function drawDocument(app: { data: DemoState; pack: IndustryPack; lang: Lang }, doc: DocRecord): Promise<{ ok: true; doc: DrawnDocument } | { ok: false; reason: DrawProblem }> {
  if (isFileDoc(doc)) {
    if (!isPdf(doc.file)) return { ok: false, reason: 'not_pdf' };
    const bytes = await fileBytes(doc.file);
    if (!bytes) return { ok: false, reason: 'no_file' };
    const read = await readPages(bytes);
    if (!read.ok) return { ok: false, reason: read.reason };
    return { ok: true, doc: { bytes, name: doc.file!.name, pages: read.pages, anchors: [], hasPlaceholders: false, file: doc.file } };
  }
  const model = buildDoc(doc, app.data, app.pack, app.lang);
  if (!model) return { ok: false, reason: 'no_document' };
  const r = await renderDoc(model);
  return { ok: true, doc: { bytes: r.bytes, name: model.fileName, pages: r.layout.pages.map((p) => ({ w: p.w, h: p.h })), view: r.layout.pages, images: r.images, anchors: r.layout.anchors, hasPlaceholders: model.placeholders } };
}

/**
 * Sending, reminding and signing in a company workspace are done by the server: the database refuses them from a
 * signed-in person. The browser's part is below (`sendLive`, `remindRequest`): save the draft with its file, ask the
 * server to send, show what it answered. It stays switched off until that path has been run against the server from a
 * browser; while it is off a company workspace prepares drafts only, and the screens say so instead of pretending a
 * request went out.
 */
export const SERVER_SIGNING = false;
/** True where a request can only be prepared, not sent: a company workspace, until the server's signing calls exist. */
export const sendingPending = (): boolean => isLive() && !SERVER_SIGNING;
/** The page layout a request keeps with it has to fit in its record (512 KB in the database, with room for the rest). */
const MAX_VIEW_CHARS = 380_000;

/** The draft is given the file that will go out, its pages and their drawing: what the server reads when it sends. */
function stageDraft(d: DemoState, _ctx: Ctx, id: string, p: PreparedDocument, doc: Pick<DocRecord, 'number' | 'kind'>): boolean {
  const e = d.envelopes.find((x) => x.id === id) as EnvelopeX | undefined;
  if (!e || e.status !== 'draft') return false;
  e.source = p.source; e.pages = p.pages; e.view = p.view; e.images = p.images; e.hashes = { original: p.originalHash };
  e.docNumber = doc.number; e.docKind = doc.kind;
  return true;
}
/** Waits until the server has acknowledged every change made on screen. The server sends what it has stored, nothing else. */
async function waitSaved(ms = 20000): Promise<'saved' | 'problem' | 'slow'> {
  syncNow();
  const until = Date.now() + ms;
  // one turn first, so a change made just now is counted as waiting
  await new Promise((r) => setTimeout(r, 60));
  for (;;) {
    const s = syncStatus();
    if (s.state === 'problem') return 'problem';
    if (s.state === 'saved' && s.pending === 0) return 'saved';
    if (Date.now() > until) return 'slow';
    await new Promise((r) => setTimeout(r, 150));
  }
}
/**
 * Company workspace: the draft is saved with its file, then the server is asked to send it. The server checks the
 * request again, emails each signer whose turn it is, and records it as sent only when every email was accepted.
 * Anything else leaves the request a draft, and the answer says why (`delivery_not_configured`, `delivery_failed`,
 * the blockers the server found, `not_saved`).
 */
async function sendLive(envelopeId: string, doc: DocRecord, drawn: DrawnDocument, fits: boolean): Promise<Done<unknown>> {
  const find = () => getSnapshot().data.envelopes.find((e) => e.id === envelopeId) as EnvelopeX | undefined;
  const e = find();
  if (!e) return { ok: false, reason: 'not_found' };
  const hash = await sha256Hex(drawn.bytes);
  // what the screen already knows is wrong is not uploaded
  const blockers = envelopeBlockers(getSnapshot().data, e, { hasPlaceholders: drawn.hasPlaceholders, source: drawn.file ?? { name: drawn.name, size: drawn.bytes.length, mime: 'application/pdf' } });
  if (blockers.length) return { ok: false, reason: blockers[0], blockers };
  // an attempt that could not be delivered left its file with the draft: the same document is not uploaded twice
  const kept = e.hashes?.original === hash && e.source?.path ? e.source : undefined;
  const source = drawn.file ?? kept ?? await storeBytes(drawn.bytes, drawn.name, { clientId: doc.clientId || undefined, jobId: doc.jobId || undefined, docId: doc.id, folder: 'signature' });
  if (!source?.path) return { ok: false, reason: 'no_document' };
  const prepared: PreparedDocument = { source, pages: drawn.pages, view: fits ? drawn.view : undefined, images: fits ? drawn.images : undefined, originalHash: hash, hasPlaceholders: drawn.hasPlaceholders };
  if (!act(stageDraft, envelopeId, prepared, doc)) return { ok: false, reason: 'not_draft' };
  if ((await waitSaved()) !== 'saved') return { ok: false, reason: 'not_saved' };
  const { envelopeSend } = await import('@/platform/live/ops');
  const r = await envelopeSend(envelopeId);
  return r.ok ? { ok: true, data: r.data } : { ok: false, reason: r.reason, ...(r.blockers ? { blockers: r.blockers as SendBlocker[] } : {}) };
}

/** Sends a draft with the document as drawn: stores the PDF that goes out, then records the sending. */
export async function sendDrawn(envelopeId: string, doc: DocRecord, drawn: DrawnDocument): Promise<Done<unknown>> {
  if (sendingPending()) return { ok: false, reason: 'server_only' };
  if (isLive()) return sendLive(envelopeId, doc, drawn, !drawn.view || JSON.stringify([drawn.view, drawn.images ?? {}]).length <= MAX_VIEW_CHARS);
  const source = drawn.file ?? await storeBytes(drawn.bytes, drawn.name, { clientId: doc.clientId || undefined, jobId: doc.jobId || undefined, docId: doc.id, folder: 'signature' });
  if (!source) return { ok: false, reason: 'no_document' };
  // A long document's drawing can outgrow the record of its request. The request then goes without it, and the pages
  // are shown from the PDF itself (the browser's viewer, or sheets of the right size): the boxes land the same.
  const fits = !drawn.view || JSON.stringify([drawn.view, drawn.images ?? {}]).length <= MAX_VIEW_CHARS;
  const prepared: PreparedDocument = { source, pages: drawn.pages, view: fits ? drawn.view : undefined, images: fits ? drawn.images : undefined, originalHash: await sha256Hex(drawn.bytes), hasPlaceholders: drawn.hasPlaceholders };
  return act(sendEnvelope, envelopeId, prepared);
}

/**
 * Reminds everyone who has their link and has not answered. Sample: recorded only, nothing is sent. Company workspace:
 * the server sends the reminders, each with a new link, and the answer says how many went out.
 */
export async function remindRequest(envelopeId: string): Promise<Done<{ reminded: number }>> {
  if (!isLive()) return act(remindEnvelope, envelopeId);
  if (sendingPending()) return { ok: false, reason: 'server_only' };
  const { envelopeRemind } = await import('@/platform/live/ops');
  const r = await envelopeRemind(envelopeId);
  if (!r.ok) return { ok: false, reason: r.reason };
  return r.data.expired ? { ok: false, reason: 'expired' } : { ok: true, data: { reminded: r.data.reminded } };
}

const busy = new Set<string>();
const hydrating = new Map<string, Promise<boolean>>();
/**
 * Sample workspaces only: a signature request that came with the sample business has no PDF yet, because a sample is
 * built without a browser. The first time it is opened, its document is drawn and attached. A request someone actually
 * sent always has its file, so this does nothing for it. It is housekeeping, not a change by the viewer.
 */
export function ensureSource(envelopeId: string): Promise<boolean> {
  const find = () => getSnapshot().data.envelopes.find((e) => e.id === envelopeId) as EnvelopeX | undefined;
  const e = find();
  if (!e) return Promise.resolve(false);
  if (e.source) return Promise.resolve(true);
  if (isLive() || !e.demo || e.status === 'draft') return Promise.resolve(false);
  const running = hydrating.get(envelopeId);
  if (running) return running;
  const job = (async () => {
    const snap = getSnapshot();
    const doc = snap.data.docs.find((x) => x.id === e.docId);
    if (!doc) return false;
    const r = await drawDocument({ data: snap.data, pack: PACKS[snap.prefs.pack], lang: e.lang ?? snap.prefs.lang }, doc);
    if (!r.ok) return false;
    const source = r.doc.file ?? await storeBytes(r.doc.bytes, r.doc.name, { docId: doc.id });
    if (!source) return false;
    const prepared: PreparedDocument = { source, pages: r.doc.pages, view: r.doc.view, images: r.doc.images, originalHash: await sha256Hex(r.doc.bytes), hasPlaceholders: false };
    if (!find()?.source) mutateQuiet((d) => { attachEnvelopeSource(d, ctx(), envelopeId, prepared, r.doc.anchors); });
    return !!find()?.source;
  })().catch(() => false).finally(() => { hydrating.delete(envelopeId); });
  hydrating.set(envelopeId, job);
  return job;
}

/**
 * Builds and stores the signed copy of a completed envelope that does not have one yet. Sample workspaces only: there the
 * browser is the only place the file can be made. Safe to call more than once.
 */
export async function finishEnvelope(envelopeId: string): Promise<'done' | 'already' | 'not_ready' | 'failed'> {
  const find = () => getSnapshot().data.envelopes.find((e) => e.id === envelopeId) as EnvelopeX | undefined;
  const e = find();
  if (!e || e.status !== 'completed') return 'not_ready';
  if (e.signedFile) return 'already';
  if (isLive() || busy.has(envelopeId)) return 'not_ready';
  busy.add(envelopeId);
  try {
    await ensureSource(envelopeId);
    const source = await fileBytes(find()?.source);
    if (!source) return 'failed';
    const d = getSnapshot().data;
    const doc = d.docs.find((x) => x.id === e.docId);
    const out = await buildSignedPdf(source, find() ?? e, { docTitle: e.title, docNumber: e.docNumber ?? doc?.number, company: d.company.legalName || d.company.name, sentBy: d.users.find((u) => u.id === e.createdBy)?.name, product: DEPLOY.productName });
    const name = (e.docNumber || e.title).replace(/[^\w.-]+/g, '-') + '-signed.pdf';
    const file = await storeBytes(out.bytes, name, { clientId: e.clientId, jobId: e.jobId, docId: e.docId, folder: 'signature' });
    if (!file || find()?.signedFile) return file ? 'already' : 'failed';
    // storing the copy is the system finishing its own work, so it is done whatever the viewer's role
    mutateQuiet((x) => { attachSignedCopy(x, ctx(), envelopeId, file, out.hashes); });
    return 'done';
  } catch (err) { console.warn('signed copy', err); return 'failed'; }
  finally { busy.delete(envelopeId); }
}

/**
 * The PDF with every box drawn on it as an outline and a label: an exact check of where the boxes will land, for a file
 * whose pages cannot be drawn on screen.
 */
export async function placementPreview(source: Uint8Array, fields: SignField[], label: (f: SignField) => string): Promise<Uint8Array> {
  const lib = await pdfLib();
  const pdf = await lib.PDFDocument.load(source, { updateMetadata: false });
  const font = await pdf.embedFont(lib.StandardFonts.Helvetica);
  const pages = pdf.getPages();
  const ink = lib.rgb(0.08, 0.36, 0.72);
  for (const f of fields) {
    const page = pages[f.page - 1]; if (!page) continue;
    const { size, matrix } = pageFrame(page);
    page.pushOperators(lib.pushGraphicsState(), lib.concatTransformationMatrix(...matrix));
    const x = f.x * size.w, w = f.w * size.w, h = f.h * size.h, y = size.h - f.y * size.h - h;
    page.drawRectangle({ x, y, width: w, height: h, borderColor: ink, borderWidth: 1, color: ink, opacity: 0.08, borderOpacity: 0.9 });
    const text = label(f).replace(/[^\x20-\x7e -ÿ]/g, '?');
    page.drawText(text, { x: x + 2, y: y + h + 2, size: 7, font, color: ink });
    page.pushOperators(lib.popGraphicsState());
  }
  return pdf.save();
}
