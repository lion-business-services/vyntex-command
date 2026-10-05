// The signing page's four calls (view, opened, submit, decline), the signed copy, and the file a signer reads.
//
// The rules are not here. They are in src/domain/esign (bundled into ../domain.bundle.mjs): whose turn it is, which
// boxes are required, who signs next, when a request is complete, how the signed copy is drawn. This file reads the
// request behind a link, runs those rules, and writes the outcome back with sign_commit, which holds the row lock and
// refuses to write over a change it has not seen (supabase/migrations/0041). When it refuses, the request is read
// again and the rules run again on what is there now: two signers answering at the same moment both land.
import { randomUUID } from 'node:crypto';
import { ok, fail, HttpError, isPlainObject, log } from '../respond.js';
import { need, appOrigin } from '../env.js';
import { serviceRpc, storage } from '../supabase.js';
import { ipHash } from '../ratelimit.js';
import { sha256Hex, sealWith, openWith, deriveKey } from '../crypto.js';
import { productName } from '../mail.js';
import { enqueue } from '../jobs.js';
import { cannotOpen, hashToken, newToken } from '../public/core.js';
import { notice, sendOrQueue } from './emails.js';

const BUCKET = 'workspace-files';
const TRIES = 6;
const FILE_SECONDS = 300;
let domain = null;
/** The bundled rules, loaded when a signing call first needs them (they are large; the other public routes do not). */
export async function esignDomain() {
  if (!domain) domain = (await import('../domain.bundle.mjs')).esign;
  return domain;
}
const serviceKey = () => need('SUPABASE_SERVICE_ROLE_KEY');
const unavailable = () => new HttpError(503, 'store_unavailable');
const PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-z][a-z0-9_-]{1,30}\/[A-Za-z0-9][A-Za-z0-9._-]{4,120}$/;

/** The path of the PDF that was sent, when it is a real path inside this company's folder. */
export function sourcePath(tenantId, envelope) {
  const p = envelope && envelope.source && typeof envelope.source.path === 'string' ? envelope.source.path : '';
  return PATH.test(p) && p.startsWith(tenantId + '/') ? p : null;
}
export async function readSource(tenantId, envelope) {
  const p = sourcePath(tenantId, envelope);
  if (!p) return null;
  const r = await storage.download(serviceKey(), BUCKET, p);
  if (!r.ok) return null;
  const bytes = new Uint8Array(await r.response.arrayBuffer());
  return bytes.length > 5 && Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-' ? bytes : null;
}

/**
 * Reads the request behind a link, lets `decide` run the rules, and writes what they changed. Returns
 *   null                      the link does not open
 *   { replay }                the link was used up by this very request before: the answer given then
 *   { answer }                the rules refused, nothing was written
 *   { ctx, envelope, extra }  written
 */
async function transact(tokenHash, requestHash, request, decide) {
  for (let i = 0; i < TRIES; i += 1) {
    const o = await serviceRpc('sign_open', { p_token_hash: tokenHash, p_request_hash: requestHash });
    if (!o.ok) throw unavailable();
    if (!o.data) return null;
    if (o.data.replay) return { replay: o.data.replay };
    const ctx = o.data;
    const d = await decide(ctx);
    if (!d.write) return { ctx, answer: d.answer };
    const c = await serviceRpc('sign_commit', {
      p_token_hash: tokenHash, p_action: d.write, p_rev: ctx.rev, p_envelope: slim(ctx.envelope), p_links: d.links || [],
      p_ip_hash: ipHash(request), p_request_hash: requestHash, p_result: d.result || null,
    });
    if (!c.ok) throw unavailable();
    // null: the link was used up while this ran (the same request, twice at once). Reading again finds the stored answer.
    if (c.data && c.data.ok) return { ctx, written: true, ...d };
  }
  throw new HttpError(503, 'busy', {}, { headers: { 'retry-after': '2' } });
}
/** What sign_commit needs of the request: its state, not the page drawings it carries. */
const slim = (e) => ({ status: e.status, sentAt: e.sentAt, expiresAt: e.expiresAt, completedAt: e.completedAt, lastReminder: e.lastReminder, events: e.events, consentText: e.consentText, hashes: e.hashes, signers: e.signers, fields: e.fields.map((f) => ({ id: f.id, value: f.value })) });

const fileKeys = () => [deriveKey(need('SESSION_SECRET'), 'vx-public-file-v1')];

export async function view(request, token) {
  const esign = await esignDomain();
  const o = await serviceRpc('sign_open', { p_token_hash: hashToken(token), p_request_hash: null });
  if (!o.ok) throw unavailable();
  if (!o.data || o.data.replay) return cannotOpen();
  const ctx = o.data; const e = ctx.envelope;
  // A request without a drawing of its pages is read from the PDF itself: a short-lived address on this site, sealed
  // for this file. It is not the link token and opens nothing else.
  let fileUrl;
  if (!(Array.isArray(e.view) && e.view.length) && sourcePath(ctx.tenantId, e)) {
    const k = sealWith(fileKeys(), { p: sourcePath(ctx.tenantId, e), e: Math.floor(Date.now() / 1000) + FILE_SECONDS }, 'pub-file', 'p1');
    fileUrl = `/api/public/sign/file?k=${encodeURIComponent(k)}`;
  }
  const v = esign.signerView(e, ctx.signerId, { company: ctx.company, now: new Date().toISOString(), fileUrl });
  return v ? ok({ view: v }) : cannotOpen();
}

export async function file(request) {
  const link = openWith(fileKeys(), new URL(request.url).searchParams.get('k') || '', 'pub-file', 'p1');
  if (!link || link.e < Math.floor(Date.now() / 1000) || !PATH.test(link.p)) return cannotOpen();
  const r = await storage.download(serviceKey(), BUCKET, link.p);
  if (!r.ok) return cannotOpen();
  return new Response(r.response.body, { status: 200, headers: {
    'content-type': 'application/pdf', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
    'content-disposition': 'inline; filename="document.pdf"', 'content-security-policy': "default-src 'none'; sandbox",
  } });
}

export async function opened(request, token) {
  const esign = await esignDomain();
  const r = await transact(hashToken(token), null, request, (ctx) => {
    const first = esign.markViewed(ctx.envelope, ctx.signerId, new Date().toISOString());
    return first ? { write: 'viewed' } : { answer: true };
  });
  return r ? ok({}) : cannotOpen();
}

/** A signer's answer as sent by the page, reduced to what the rules read. Anything else in the body is dropped. */
function payloadOf(b) {
  const values = {};
  if (isPlainObject(b.values)) for (const [k, v] of Object.entries(b.values).slice(0, 200)) if (typeof v === 'string' && k.length <= 80) values[k] = v.slice(0, 300);
  return {
    consent: b.consent === true, typedName: typeof b.typedName === 'string' ? b.typedName.slice(0, 200) : '',
    signature: typeof b.signature === 'string' ? b.signature : '', initials: typeof b.initials === 'string' && b.initials ? b.initials : undefined, values,
  };
}

export async function submit(request, token, b) {
  const esign = await esignDomain();
  const p = payloadOf(b);
  if (p.signature.length > esign.MAX_SIGNATURE_CHARS || (p.initials || '').length > esign.MAX_SIGNATURE_CHARS) return fail(409, 'rejected', { reason: 'bad_signature' });
  const tokenHash = hashToken(token);
  const requestHash = sha256Hex('submit\n' + JSON.stringify([p.consent, p.typedName, p.signature, p.initials || '', Object.entries(p.values).sort()]));
  const fresh = [];
  const r = await transact(tokenHash, requestHash, request, (ctx) => {
    const out = esign.sign(ctx.envelope, ctx.signerId, p, new Date().toISOString());
    if (!out.ok) return { answer: { reason: out.reason, fields: out.fields } };
    // the signers this answer let in get their links in the same write
    fresh.length = 0;
    for (const s of out.released) fresh.push({ signer: s, token: newToken() });
    return { write: 'signed', links: fresh.map((x) => ({ signerId: x.signer.id, tokenHash: hashToken(x.token) })), result: { ok: true, completed: out.completed }, completed: out.completed };
  });
  if (!r) return cannotOpen();
  if (r.replay) return ok({ completed: !!r.replay.completed });
  if (!r.written) return fail(409, 'rejected', { reason: r.answer.reason, ...(r.answer.fields ? { fields: r.answer.fields } : {}) });
  const origin = appOrigin(request);
  for (const x of fresh) {
    const how = await sendOrQueue(notice(r.ctx, x.signer, x.token, 'request'), origin);
    if (how !== 'sent') log('esign', 'next_signer_notice', { how });
  }
  if (r.completed) {
    // The signed copy is made now. If that does not work (storage is slow, the function runs out of time) the queue
    // makes it: the signer's answer is already recorded and is not held up by the file.
    let made = false;
    try { made = (await finalize(r.ctx.tenantId, r.ctx.envelopeId)) !== 'failed'; } catch { made = false; }
    if (!made) await enqueue('esign.finalize', { envelope: r.ctx.envelopeId }, { tenant: r.ctx.tenantId, idem: 'esign.finalize:' + r.ctx.envelopeId, maxAttempts: 8 });
  }
  return ok({ completed: !!r.completed });
}

export async function decline(request, token, b) {
  const esign = await esignDomain();
  const reason = typeof b.reason === 'string' ? b.reason.slice(0, 1000) : '';
  const requestHash = sha256Hex('decline\n' + reason);
  const r = await transact(hashToken(token), requestHash, request, (ctx) => {
    const out = esign.decline(ctx.envelope, ctx.signerId, reason, new Date().toISOString());
    return out.ok ? { write: 'declined', result: { ok: true, declined: true } } : { answer: { reason: out.reason } };
  });
  if (!r) return cannotOpen();
  if (r.replay || r.written) return ok({});
  return fail(409, 'rejected', { reason: r.answer.reason });
}

/**
 * Makes the signed copy of a completed request: the PDF that was sent with every box filled in and the completion
 * certificate behind it. Stores it in the company's private folder and records it as a new version of the document
 * with its three fingerprints. Returns 'made', 'already' or 'failed'. Safe to run twice.
 */
export async function finalize(tenantId, envelopeId) {
  const esign = await esignDomain();
  const g = await serviceRpc('envelope_get', { p_tenant: tenantId, p_envelope: envelopeId });
  if (!g.ok || !g.data) return 'failed';
  const e = g.data.envelope;
  if (e.status !== 'completed') return 'failed';
  if (e.signedFile) return 'already';
  const source = await readSource(tenantId, e);
  if (!source) { log('esign', 'signed_copy_no_source'); return 'failed'; }
  const copy = await esign.buildSignedPdf(source, e, {
    docTitle: (g.data.doc && g.data.doc.title) || e.title, docNumber: (g.data.doc && g.data.doc.number) || e.docNumber,
    company: g.data.company, sentBy: g.data.sentBy || undefined, product: productName(),
  });
  // the fingerprint of the file as sent is the server's own reading of it, not a number the browser supplied
  if (e.hashes && e.hashes.original && e.hashes.original !== copy.hashes.original) log('esign', 'original_hash_differs');
  const path = `${tenantId}/signature/${randomUUID()}.pdf`;
  const up = await storage.upload(serviceKey(), BUCKET, path, Buffer.from(copy.bytes), 'application/pdf');
  if (!up.ok) { log('esign', 'signed_copy_not_stored', { status: up.status }); return 'failed'; }
  const name = (String(e.title || 'document').replace(/[^\w.\- ]+/g, ' ').trim().slice(0, 80) || 'document') + ' (signed).pdf';
  const f = await serviceRpc('sign_finalize', { p_tenant: tenantId, p_envelope: envelopeId, p_file: { name, size: copy.bytes.length, mime: 'application/pdf', path }, p_hashes: copy.hashes });
  if (!f.ok) { await storage.remove(serviceKey(), BUCKET, path); return 'failed'; }
  if (f.data !== true) { await storage.remove(serviceKey(), BUCKET, path); return 'already'; }
  return 'made';
}
