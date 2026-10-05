// /api/webhooks/<provider>: calls made by providers (delivery events, payments, messages).
//
// A webhook comes from the internet and claims to be a provider. What happens, in order:
//   1. the raw body is read (the exact bytes, because the signature covers them) with a size limit
//   2. the adapter verifies the signature and the time stamp. A bad signature or a time stamp outside the allowed
//      window is refused and logged with a hash of the body only. Nothing in an unverified body is stored or acted on.
//   3. the event is recorded by its provider event id. A repeat of an id already recorded is answered "ok" and
//      nothing runs again.
//   4. processing is handed to the job queue (retry with backoff, dead letter after the last attempt) and the
//      provider gets its answer at once.
// Three provider habits are handled here as well, each only for an adapter that declares it:
//   * webhook.challenge: the provider checks the address once with a GET that carries a shared word (Meta, WhatsApp)
//   * webhook.inbound: the message text arrives in the webhook and cannot be fetched again, so it is stored in the
//     company's records after the signature passed and before the event is recorded. When it cannot be stored the
//     provider is answered with an error, so it sends the webhook again.
//   * webhook.reply: the provider expects its own kind of answer (Twilio: an empty TwiML document)
// There is no session and no csrf check here: the signature is the authentication.
import { entry, ok, fail, readRaw, methodNotAllowed, log } from './_lib/respond.js';
import { assertConfigured } from './_lib/guard.js';
import { serviceRpc } from './_lib/supabase.js';
import { hit, addressKey, ipHash } from './_lib/ratelimit.js';
import { enqueue } from './_lib/jobs.js';
import { webhookAdapter } from './_lib/integrations/providers/index.js';
import { payloadHash } from './_lib/integrations/webhook.js';
import { makeCtx } from './_lib/integrations/core.js';
import { ingestInbound } from './_lib/integrations/messaging/ingest.js';

const MAX_BYTES = 1024 * 1024;

/** An answer in the provider's own format (a challenge echoed as text, an empty TwiML document). */
const plain = (r) => new Response(String(r.body ?? ''), {
  status: Number(r.status) || 200,
  headers: { 'content-type': r.contentType || 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
});

const handle = entry('webhooks', async (request, path) => {
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(path)) return fail(404, 'not_found');
  const adapter = request.method === 'POST' || request.method === 'GET' ? await webhookAdapter(path) : null;
  const challenge = adapter && typeof adapter.webhook.challenge === 'function';
  if (request.method !== 'POST' && !(request.method === 'GET' && challenge)) return methodNotAllowed(challenge ? 'GET, POST' : 'POST');
  assertConfigured();
  if (!adapter) return fail(404, 'unknown_provider');

  const addr = addressKey(request);
  const flood = await hit('webhook.addr', addr, 1200, 60);
  if (!flood.allowed) return fail(429, 'rate_limited', {}, { headers: { 'retry-after': String(flood.retryAfter) } });
  // What the adapter gets to work with: settings by name, the clock, and fetch (Google's notices are checked against
  // Google's published keys). No company and no tokens: nothing is known about the caller yet.
  const ctx = makeCtx(adapter, {});

  if (request.method === 'GET') {
    // The provider proves it knows the word this deployment set, and gets its own challenge back. Nothing is stored.
    let c;
    try { c = await adapter.webhook.challenge(request, ctx); } catch { c = { ok: false, reason: 'bad_request' }; }
    if (c && c.ok === true) return plain(c);
    // Guessing the word is slowed down like any other rejected call.
    const room = await hit('webhook.reject', addr, 20, 60);
    if (!room.allowed) return fail(429, 'rate_limited', {}, { headers: { 'retry-after': String(room.retryAfter) } });
    const reason = c && c.reason;
    return reason === 'not_configured' ? fail(503, 'not_configured') : reason === 'bad_request' ? fail(400, 'bad_request') : fail(403, 'forbidden');
  }

  let raw;
  try { raw = await readRaw(request, MAX_BYTES); } catch { return fail(400, 'invalid_body'); }
  if (raw === null) return fail(413, 'too_large');
  const hash = payloadHash(raw);

  let v;
  try {
    v = await adapter.webhook.verify(request, raw, ctx);
  } catch {
    v = { ok: false, reason: 'verify_failed' };
  }
  if (!v || v.ok !== true) {
    const reason = /^[a-z][a-z0-9_.]{1,60}$/.test(String(v && v.reason)) ? v.reason : 'bad_signature';
    // Rejections are logged, but not without limit: someone sending junk must not be able to fill the table.
    const room = await hit('webhook.reject', addr, 20, 60);
    // Service role throughout this file: a webhook arrives with nobody signed in.
    if (room.allowed) await serviceRpc('webhook_reject', { p_provider: adapter.id, p_payload_hash: hash, p_error: reason, p_ip_hash: ipHash(request) });
    return fail(reason === 'stale' ? 400 : reason === 'not_configured' ? 503 : 401, reason === 'not_configured' ? 'not_configured' : reason === 'stale' ? 'stale' : 'bad_signature');
  }

  // Which company? Either the adapter read it from the signed body, or the provider's account id says so.
  let tenant = v.tenantId || null;
  if (!tenant && v.accountRef) {
    const c = await serviceRpc('conn_by_account', { p_provider: adapter.id, p_account_ref: v.accountRef });
    if (c.ok && c.data) tenant = c.data.tenant_id;
  }

  // Message text that cannot be read again later is stored now. Not stored means not received: the provider is told
  // to come back, and nothing is recorded, so its next attempt is not taken for a repeat.
  if (typeof adapter.webhook.inbound === 'function') {
    const kept = await ingestInbound(adapter, { request, raw, tenant, ctx });
    if (!kept.ok) {
      log('webhooks', 'not_stored', { provider: adapter.id, reason: kept.reason });
      return fail(503, 'unavailable');
    }
  }
  const answer = (body) => {
    if (typeof adapter.webhook.reply !== 'function') return ok(body);
    const r = adapter.webhook.reply(v);
    return r && typeof r === 'object' ? plain(r) : ok(body);
  };

  const rec = await serviceRpc('webhook_receive', { p_provider: adapter.id, p_event_id: v.eventId, p_tenant: tenant, p_payload_hash: hash, p_redacted: v.redacted || {} });
  if (!rec.ok) {
    // Not recorded means not processed: answer with an error so the provider sends it again later.
    log('webhooks', 'not_recorded', { provider: adapter.id, status: rec.status });
    return fail(503, 'unavailable');
  }
  if (!rec.data.fresh) return answer({ duplicate: true });

  const job = await enqueue('webhook.process', { event: rec.data.id, provider: adapter.id }, { tenant, idem: `${adapter.id}:${v.eventId}`, maxAttempts: 6 });
  await serviceRpc('webhook_mark', { p_id: rec.data.id, p_status: job ? 'queued' : 'received', p_error: null, p_job: job });
  return answer({ received: true });
});

export const POST = handle;
export const GET = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
