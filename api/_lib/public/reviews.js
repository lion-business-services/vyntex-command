// Review requests: the public page's two calls, and sending a request from the office.
//
//   GET  /api/public/review/<token>   { ok, company, firstName, job?, state: 'open', publicUrl? }
//   POST /api/public/review/<token>   { rating: 1..5, comment } or { decline: true }   ->   { ok, low?, publicUrl? }
//
// The link is made by the server when the request is sent, and only its hash is stored. The answer uses the link up.
// A rating of 3 or lower creates a follow-up task for the company. The company's public review link is returned after
// any rating: a low rating is never steered away from it.
import { ok, fail, isUuid, upstreamError } from '../respond.js';
import { appOrigin } from '../env.js';
import { userRpc, serviceRpc } from '../supabase.js';
import { ipHash } from '../ratelimit.js';
import { sealToken, sha256Hex } from '../crypto.js';
import { emailConfigured } from '../mail.js';
import { enqueue } from '../jobs.js';
import { cannotOpen, hashToken, newToken, isToken, publicLimits, assertSameSite, body } from './core.js';

const HEADERS = { 'referrer-policy': 'no-referrer' };

export async function reviewGet(request, token) {
  await publicLimits(request, 'review', token);
  if (!isToken(token)) return cannotOpen();
  const r = await serviceRpc('review_open', { p_token_hash: hashToken(token) });
  if (!r.ok) return fail(503, 'store_unavailable');
  if (!r.data) return cannotOpen();
  const d = r.data;
  return ok({ company: d.company || '', firstName: d.firstName || '', ...(d.job ? { job: d.job } : {}), state: 'open', ...(d.publicUrl ? { publicUrl: d.publicUrl } : {}) }, { headers: HEADERS });
}

export async function reviewPost(request, token) {
  assertSameSite(request);
  await publicLimits(request, 'review', token, { perToken: 10 });
  const b = await body(request, 16 * 1024);
  if (!isToken(token)) return cannotOpen();
  const decline = b.decline === true;
  const rating = Number.isInteger(b.rating) ? b.rating : 0;
  const comment = typeof b.comment === 'string' ? b.comment.trim().slice(0, 4000) : '';
  if (!decline && (rating < 1 || rating > 5)) return fail(400, 'invalid', { reason: 'rating' });
  const r = await serviceRpc('review_answer', {
    p_token_hash: hashToken(token), p_rating: decline ? null : rating, p_comment: decline ? null : comment, p_decline: decline, p_ip_hash: ipHash(request),
    p_request_hash: sha256Hex(JSON.stringify(decline ? ['decline'] : ['rate', rating, comment])),
  });
  if (!r.ok) return fail(503, 'store_unavailable');
  if (!r.data) return cannotOpen();
  return ok({ ...(r.data.low ? { low: true } : {}), ...(r.data.publicUrl ? { publicUrl: r.data.publicUrl } : {}) }, { headers: HEADERS });
}

/** The request email. `{{link}}` is replaced when the message is handed to the provider; the stored text never holds the link. */
export function reviewEmail({ lang, company, firstName }) {
  if (lang === 'es') {
    return { subject: `¿Cómo le fue con ${company}?`, body: [`Hola ${firstName}:`, '', `Gracias por elegir a ${company}. ¿Nos cuenta cómo le fue? Toma un minuto:`, '{{link}}', '', 'El enlace es personal. Si prefiere no responder, puede ignorar este mensaje.', ''].join('\n') };
  }
  return { subject: `How did it go with ${company}?`, body: [`Hello ${firstName},`, '', `Thank you for choosing ${company}. Would you tell us how it went? It takes a minute:`, '{{link}}', '', 'The link is personal. If you would rather not answer, you can ignore this message.', ''].join('\n') };
}

/**
 * POST /api/ws/rpc/review_send  { tenant, args: { p_review } }  ->  { result: { queued: true, messageId } }
 * The person's token decides whether they may send this draft. The server makes the link, queues the email and starts
 * the delivery job. The request becomes "sent" when the provider accepted the email, not before.
 */
export async function reviewSend({ request, session, cookies, tenant, args }) {
  const id = args.p_review ?? args.review;
  if (!isUuid(id)) return fail(400, 'invalid_args', {}, { cookies });
  if (!emailConfigured()) return fail(409, 'delivery_not_configured', {}, { cookies });
  const c = await userRpc(session.at, 'review_send_check', { p_tenant: tenant, p_review: id });
  if (!c.ok) { const e = upstreamError(c); e.extra = { cookies }; throw e; }
  const d = c.data;
  const stop = d.status !== 'draft' ? 'not_draft' : d.pending ? 'already_queued' : d.channel !== 'email' ? 'channel_not_supported' : !d.hasEmail ? 'no_address' : d.emailOptOut ? 'opted_out' : null;
  if (stop) return fail(409, 'rejected', { reason: stop }, { cookies });
  const token = newToken();
  const mail = reviewEmail({ lang: d.lang === 'es' ? 'es' : 'en', company: d.company || '', firstName: d.firstName || '' });
  const w = await serviceRpc('review_send_commit', {
    p_tenant: tenant, p_review: id, p_token_hash: hashToken(token), p_ttl_hours: Math.round((Number(d.linkDays) || 30) * 24), p_subject: mail.subject, p_body: mail.body,
    p_sealed_link: sealToken({ url: `${appOrigin(request)}/review/${token}` }, 'msg-link:' + tenant), p_member: d.member || null,
  });
  if (!w.ok) { const e = upstreamError(w); e.extra = { cookies }; throw e; }
  if (!w.data || !w.data.ok) return fail(409, 'rejected', { reason: (w.data && w.data.reason) || 'not_draft' }, { cookies });
  await enqueue('messages.deliver', { message: w.data.messageId }, { tenant, idem: 'msg:' + w.data.messageId, maxAttempts: 5 });
  return ok({ result: { queued: true, messageId: w.data.messageId } }, { cookies });
}
