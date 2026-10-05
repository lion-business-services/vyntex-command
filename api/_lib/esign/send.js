// Sending a signature request, reminding its signers, and the daily pass over open requests (reminders and expiry).
//
// Sending is the one moment a request leaves the company, so the server checks again what the screen checked: the
// wording of the document was approved, the company approved its consent sentence, every signer has a place to sign,
// and there is a file. Then the order is: make the links, hand the emails to the provider, and ONLY when the provider
// accepted them record the request as sent. If email is not set up, or the provider refuses, the request stays a
// draft and the answer says why. A request is never shown as sent on the strength of an attempt.
import { ok, fail, isUuid, upstreamError, log } from '../respond.js';
import { appOrigin, env } from '../env.js';
import { userRpc, serviceRpc } from '../supabase.js';
import { emailConfigured } from '../mail.js';
import { sha256Hex } from '../crypto.js';
import { hashToken, newToken } from '../public/core.js';
import { esignDomain, readSource, finalize } from './signing.js';
import { notice, sendNotice, sendOrQueue } from './emails.js';

const hex = (bytes) => sha256Hex(Buffer.from(bytes));
const slim = (e) => ({ status: e.status, sentAt: e.sentAt, expiresAt: e.expiresAt, completedAt: e.completedAt, lastReminder: e.lastReminder, events: e.events, consentText: e.consentText, hashes: e.hashes, signers: e.signers, fields: e.fields.map((f) => ({ id: f.id, value: f.value })) });

/** POST /api/ws/rpc/envelope_send  { tenant, args: { p_envelope } }  ->  { result: { status: 'sent', sentTo, expiresAt }, delivery: 'sent' } */
export async function envelopeSend({ request, session, cookies, tenant, args }) {
  const id = args.p_envelope ?? args.envelope;
  if (!isUuid(id)) return fail(400, 'invalid_args', {}, { cookies });
  // No way to deliver, no sending: the request stays a draft and the screen can say what is missing.
  if (!emailConfigured()) return fail(409, 'delivery_not_configured', {}, { cookies });
  const esign = await esignDomain();
  const c = await userRpc(session.at, 'envelope_send_check', { p_tenant: tenant, p_envelope: id });
  if (!c.ok) { const e = upstreamError(c); e.extra = { cookies }; throw e; }
  const ctx = c.data; const e = ctx.envelope;
  if (ctx.demo) return fail(409, 'rejected', { reason: 'sample' }, { cookies });
  const blockers = esign.sendBlockers(e, { templateApproved: !!ctx.templateApproved, consentApproved: !!ctx.consentApproved, hasDocument: !!ctx.hasDocument });
  if (blockers.length) return fail(409, 'rejected', { reason: blockers[0], blockers }, { cookies });
  // The file as it is stored, read by the server: its fingerprint is taken here, not from the browser.
  const source = await readSource(tenant, e);
  if (!source) return fail(409, 'rejected', { reason: 'no_document', blockers: ['no_document'] }, { cookies });
  e.hashes = { original: hex(source) };

  const released = esign.send(e, new Date().toISOString(), { consentText: ctx.consentText });
  if (!released.length) return fail(409, 'rejected', { reason: 'no_signers', blockers: ['no_signers'] }, { cookies });
  const fresh = released.map((signer) => ({ signer, token: newToken() }));
  const origin = appOrigin(request);
  for (const x of fresh) {
    const sent = await sendNotice(notice({ tenantId: tenant, company: ctx.company, envelope: e }, x.signer, x.token, 'request'), origin);
    if (!sent.delivered) {
      // Nothing was recorded, so the links made above open nothing. The request is still a draft.
      log('esign', 'send_not_delivered', { reason: sent.reason });
      return fail(sent.reason === 'not_configured' ? 409 : 502, sent.reason === 'not_configured' ? 'delivery_not_configured' : 'delivery_failed', {}, { cookies });
    }
  }
  const w = await serviceRpc('envelope_commit', {
    p_tenant: tenant, p_envelope: id, p_action: 'sent', p_rev: ctx.rev, p_new: slim(e), p_member: ctx.member || null,
    p_links: fresh.map((x) => ({ signerId: x.signer.id, tokenHash: hashToken(x.token) })),
  });
  if (!w.ok) { const err = upstreamError(w); err.extra = { cookies }; throw err; }
  if (!w.data || !w.data.ok) return fail(409, 'conflict', {}, { cookies });
  return ok({ result: { status: 'sent', sentTo: fresh.length, expiresAt: e.expiresAt }, delivery: 'sent' }, { cookies });
}

/**
 * One pass over one open request, by the server: expire it when its time is up, otherwise remind (`how`: 'auto' only
 * when a reminder is due, 'manual' always). Every reminded signer gets a new link; the earlier one stops working.
 */
export async function sweepOne(tenantId, envelopeId, how = 'auto', origin = '') {
  const esign = await esignDomain();
  for (let i = 0; i < 4; i += 1) {
    const g = await serviceRpc('envelope_get', { p_tenant: tenantId, p_envelope: envelopeId });
    if (!g.ok) return { error: 'store_unavailable' };
    if (!g.data) return { skipped: true };
    const ctx = g.data; const e = ctx.envelope; const now = new Date().toISOString();
    let action; let who = [];
    if (esign.isExpired(e, now)) { esign.sweep(e, now); action = 'expired'; }
    else { who = how === 'manual' ? esign.remind(e, now, 'manual') : esign.sweep(e, now).reminded; action = 'reminded'; }
    if (action === 'reminded' && !who.length) return { reminded: 0 };
    const fresh = who.map((signer) => ({ signer, token: newToken() }));
    const w = await serviceRpc('envelope_commit', {
      p_tenant: tenantId, p_envelope: envelopeId, p_action: action, p_rev: ctx.rev, p_new: slim(e),
      p_links: fresh.map((x) => ({ signerId: x.signer.id, tokenHash: hashToken(x.token) })),
    });
    if (!w.ok) return { error: 'store_unavailable' };
    if (!w.data) return { skipped: true };
    if (w.data.conflict) continue;
    let sent = 0;
    for (const x of fresh) if ((await sendOrQueue(notice(ctx, x.signer, x.token, 'reminder'), origin || env('APP_ORIGIN').replace(/\/+$/, ''))) !== 'failed') sent += 1;
    return action === 'expired' ? { expired: true } : { reminded: sent };
  }
  return { error: 'busy' };
}

/** POST /api/ws/rpc/envelope_remind  { tenant, args: { p_envelope } }: a reminder now, to everyone who has their link and has not answered. */
export async function envelopeRemind({ request, session, cookies, tenant, args }) {
  const id = args.p_envelope ?? args.envelope;
  if (!isUuid(id)) return fail(400, 'invalid_args', {}, { cookies });
  if (!emailConfigured()) return fail(409, 'delivery_not_configured', {}, { cookies });
  // the person's own token decides whether they may touch this request
  const c = await userRpc(session.at, 'envelope_send_check', { p_tenant: tenant, p_envelope: id });
  if (!c.ok) { const e = upstreamError(c); e.extra = { cookies }; throw e; }
  if (c.data.demo) return fail(409, 'rejected', { reason: 'sample' }, { cookies });
  const r = await sweepOne(tenant, id, 'manual', appOrigin(request));
  if (r.error) return fail(503, r.error, {}, { cookies });
  return ok({ result: { reminded: r.reminded || 0, expired: !!r.expired } }, { cookies });
}

/** The daily pass: every open request whose time is up or whose reminder is due, then signed copies still missing. */
export async function sweepAll() {
  const out = { expired: 0, reminded: 0, finalized: 0 };
  const due = await serviceRpc('envelopes_due', { p_limit: 200 });
  for (const d of due.ok ? due.data || [] : []) {
    const r = await sweepOne(d.tenantId, d.envelopeId, 'auto');
    if (r.expired) out.expired += 1; else if (r.reminded) out.reminded += r.reminded;
  }
  const open = await serviceRpc('envelopes_unfinished', { p_limit: 25 });
  for (const d of open.ok ? open.data || [] : []) { try { if ((await finalize(d.tenantId, d.envelopeId)) === 'made') out.finalized += 1; } catch { /* the next run tries again */ } }
  return out;
}
