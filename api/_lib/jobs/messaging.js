// Background work of the messaging adapters: scheduled social posts, queued outgoing messages (with retry), and the
// renewal of Meta's long-lived tokens before they run out.
//
// Registered by importing this file from api/_lib/jobs/handlers.js, with the two hooks pushed there:
//   import { messagingTick, messagingDaily } from './messaging.js';
//   hooks.tick.push(messagingTick); hooks.daily.push(messagingDaily);
//
// The honesty rules of the records hold here: a post is "published" and a message is "sent" only after the provider
// answered with its id. A failure is stored as a code. Consent, the reply window and template approval are checked
// again by the adapter at the moment of sending, with the records as they are then, so a STOP that arrived after a
// message was queued still stops it.
//
// The database functions used here (messaging_outbox_get, messaging_send_result, messaging_outbox_due,
// social_post_claim, social_post_result, social_posts_due) are in docs/integrations/messaging.md until the migration
// is added. Until then every job of this file fails with "not_installed" and nothing is sent.
import { register, JobError } from '../jobs.js';
import { serviceRpc } from '../supabase.js';
import { getAdapter } from '../integrations/providers/index.js';
import { connectionCtx, refreshTokens } from '../integrations/core.js';
import * as store from '../integrations/store.js';
import { ProviderError } from '../integrations/oauth.js';

/** Failures that will not get better by trying again: the job stops and the record says why. */
const PERMANENT = new Set(['consent_missing', 'consent_revoked', 'consent_expired', 'consent_mismatch', 'recipient_opted_out', 'recipient_invalid', 'recipient_blocked', 'outside_messaging_window', 'template_not_approved', 'template_not_found', 'template_invalid', 'template_params_invalid',
  'message_invalid', 'message_rejected', 'request_rejected', 'sender_invalid', 'sender_not_found', 'sender_not_registered', 'media_invalid', 'media_rejected', 'media_unavailable', 'instagram_not_linked', 'page_not_selected', 'wrong_account', 'no_pages', 'not_connected', 'not_built', 'channel_not_available', 'provider_unknown', 'region_not_allowed', 'recipient_not_allowed', 'account_restricted', 'number_not_registered']);
const permanent = (e) => e instanceof ProviderError && (e.reauth || PERMANENT.has(e.code));
const codeOf = (e, fallback) => (e instanceof ProviderError || e instanceof JobError ? e.code : fallback);
const CHANNEL_PROVIDER = { text: 'sms', whatsapp: 'whatsapp', facebook: 'meta', instagram: 'meta' };
// Quiet hours end by themselves, so a message held by them is tried again rather than failed.
const lastTry = (job) => Number(job.attempts) >= Number(job.max_attempts);

/** What the jobs reach outside for. Tests replace these; nothing else in the file talks to the database or a provider. */
export const deps = {
  rpc: (name, args) => serviceRpc(name, args),
  adapter: (id) => getAdapter(id),
  ctx: (adapter, tenantId) => connectionCtx(adapter, tenantId),
  /** Turns a stored file of a post into something a provider can take: { bytes, mime } or { url }. Not available yet. */
  media: async () => null,
  row: (tenantId, provider) => store.getRow(tenantId, provider),
  tokens: (row) => store.tokensOf(row),
  refresh: (adapter, tenantId, tokens) => refreshTokens(adapter, tenantId, tokens),
};

async function call(name, args) {
  const r = await deps.rpc(name, args);
  if (!r.ok) throw new JobError(r.status === 404 ? 'not_installed' : 'store_unavailable');
  return r.data;
}

async function ready(provider, tenantId) {
  const adapter = await deps.adapter(provider);
  if (!adapter) throw new ProviderError('not_built');
  return { adapter, ctx: await deps.ctx(adapter, tenantId) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Outgoing messages
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Sends one queued message. The outbox row says what to send and brings the facts the adapter needs to decide:
 * the person's consent record, when they last wrote, the company's quiet hours.
 */
export async function sendQueued(job) {
  const id = String(job.payload?.message || '');
  if (!job.tenant_id || !id) throw new JobError('bad_job', { permanent: true });
  const out = await call('messaging_outbox_get', { p_tenant: job.tenant_id, p_id: id });
  // Gone, already sent, or no longer waiting: nothing to do, and doing nothing twice is safe.
  if (!out || !out.message || out.message.status !== 'queued' || out.message.externalId) return { skipped: true };
  const m = out.message;
  const provider = CHANNEL_PROVIDER[m.channel];
  let sent;
  try {
    if (!provider) throw new ProviderError('channel_not_available');
    const { adapter, ctx } = await ready(provider, job.tenant_id);
    if (provider === 'sms') sent = await adapter.actions.send(ctx, { to: m.to, text: m.body, consent: out.consent, quietHours: out.quietHours, statusCallback: out.statusCallback });
    else if (provider === 'whatsapp') sent = await adapter.actions.send(ctx, { to: m.to, text: m.body, template: out.template || null, params: out.params || [], consent: out.consent, lastInboundAt: out.lastInboundAt });
    else sent = await adapter.actions.sendMessage(ctx, { channel: m.channel, to: m.to, text: m.body, lastInboundAt: out.lastInboundAt, humanAgent: out.humanAgent === true });
  } catch (e) {
    const code = codeOf(e, 'send_failed');
    if (code === 'quiet_hours' && !lastTry(job)) throw new JobError('quiet_hours');
    if (permanent(e) || lastTry(job) || !(e instanceof ProviderError)) {
      await call('messaging_send_result', { p_tenant: job.tenant_id, p_id: id, p_status: 'failed', p_external_id: null, p_error: code, p_meta: {} });
      throw new JobError(code, { permanent: true });
    }
    throw new JobError(code);
  }
  // The provider has the message. If the record cannot be written now, the job must not run again and send twice.
  try {
    await call('messaging_send_result', { p_tenant: job.tenant_id, p_id: id, p_status: sent.status === 'queued' ? 'queued' : 'sent', p_external_id: sent.id, p_error: null, p_meta: { segments: sent.segments ?? null, segmentsSource: sent.segmentsSource ?? null, cost: sent.cost ?? null, backend: sent.backend ?? null } });
  } catch { throw new JobError('result_not_recorded', { permanent: true }); }
  return { sent: true, id: sent.id };
}
register('messaging.send', sendQueued);

// ---------------------------------------------------------------------------------------------------------------------
// Scheduled social posts
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Publishes one scheduled post to each of its channels. A channel that already went out is not sent again: its
 * provider id is written as soon as the provider answers, before the next channel is tried.
 */
export async function publishPost(job) {
  const id = String(job.payload?.post || '');
  if (!job.tenant_id || !id) throw new JobError('bad_job', { permanent: true });
  const post = await call('social_post_claim', { p_tenant: job.tenant_id, p_id: id });
  if (!post || post.status !== 'scheduled') return { skipped: true };
  const done = post.published && typeof post.published === 'object' ? { ...post.published } : {};
  const file = Array.isArray(post.media) && post.media[0] ? post.media[0] : null;
  let failure = null;
  for (const channel of Array.isArray(post.channels) ? post.channels : []) {
    if (done[channel]) continue;
    try {
      const media = file ? await deps.media(job.tenant_id, file) : null;
      if (file && !media) throw new ProviderError('media_unavailable');
      let r;
      if (channel === 'facebook') {
        const { adapter, ctx } = await ready('meta', job.tenant_id);
        r = await adapter.actions.publishPagePost(ctx, { text: post.text, ...(media ? (media.bytes ? { photoBytes: media.bytes, photoMime: media.mime } : { photoUrl: media.url }) : {}) });
      } else if (channel === 'instagram') {
        if (!media || !media.url) throw new ProviderError('media_unavailable');
        const { adapter, ctx } = await ready('meta', job.tenant_id);
        r = await adapter.actions.publishInstagram(ctx, { imageUrl: media.url, caption: post.text });
      } else {
        // Other channels (Google Business Profile) publish through their own adapter when it offers the action.
        const { adapter, ctx } = await ready(channel, job.tenant_id);
        if (!adapter.actions || typeof adapter.actions.publishPost !== 'function') throw new ProviderError('channel_not_available');
        r = await adapter.actions.publishPost(ctx, { text: post.text, media });
      }
      done[channel] = r.id;
      await call('social_post_result', { p_tenant: job.tenant_id, p_id: id, p_status: 'scheduled', p_error: null, p_published: { ...done } });
    } catch (e) {
      if (e instanceof JobError) throw e;
      failure = { code: codeOf(e, 'publish_failed'), permanent: permanent(e) || !(e instanceof ProviderError) };
      break;
    }
  }
  if (!failure) {
    await call('social_post_result', { p_tenant: job.tenant_id, p_id: id, p_status: 'published', p_error: null, p_published: { ...done } });
    return { published: Object.keys(done) };
  }
  if (failure.permanent || lastTry(job)) {
    await call('social_post_result', { p_tenant: job.tenant_id, p_id: id, p_status: 'failed', p_error: failure.code, p_published: { ...done } });
    throw new JobError(failure.code, { permanent: true });
  }
  throw new JobError(failure.code);
}
register('social.publish', publishPost);

// ---------------------------------------------------------------------------------------------------------------------
// Meta token renewal
// ---------------------------------------------------------------------------------------------------------------------
const RENEW_WITHIN_MS = 7 * 24 * 3600 * 1000;

/**
 * A long-lived Meta token lasts about two months and has no refresh token: it is renewed by exchanging it while it
 * still works. The framework's own refresh runs minutes before expiry, which is too close for a token that can
 * only be renewed while valid, so this looks a week ahead, once a day.
 */
export async function renewToken(job, now = Date.now()) {
  const provider = String(job.payload?.provider || '');
  if (!job.tenant_id || !provider) throw new JobError('bad_job', { permanent: true });
  const adapter = await deps.adapter(provider);
  if (!adapter) throw new JobError('unknown_provider', { permanent: true });
  const row = await deps.row(job.tenant_id, provider);
  if (!row || !row.token_enc || !['connected', 'attention'].includes(row.state)) return { skipped: 'not_connected' };
  const tokens = await deps.tokens(row);
  if (!tokens) throw new JobError('token_unreadable', { permanent: true });
  const expires = tokens.expires_at ? Date.parse(tokens.expires_at) : 0;
  if (!expires || expires - now > RENEW_WITHIN_MS) return { skipped: 'not_due' };
  try { await deps.refresh(adapter, job.tenant_id, tokens); } catch (e) { throw new JobError(codeOf(e, 'refresh_failed'), { permanent: e instanceof ProviderError && e.reauth }); }
  return { renewed: true };
}
register('messaging.token_renew', renewToken);

// ---------------------------------------------------------------------------------------------------------------------
// Scheduled runs
// ---------------------------------------------------------------------------------------------------------------------

/** Every scheduled run: queue the posts whose time has come and the messages waiting to go out. */
export async function messagingTick({ enqueue }) {
  const out = { posts: 0, messages: 0 };
  const posts = await deps.rpc('social_posts_due', { p_limit: 50 });
  for (const p of posts.ok && Array.isArray(posts.data) ? posts.data : []) {
    if (await enqueue('social.publish', { post: p.id }, { tenant: p.tenant_id, idem: `post:${p.id}:${p.scheduled_for || ''}`, maxAttempts: 5 })) out.posts += 1;
  }
  const msgs = await deps.rpc('messaging_outbox_due', { p_limit: 100 });
  for (const m of msgs.ok && Array.isArray(msgs.data) ? msgs.data : []) {
    if (await enqueue('messaging.send', { message: m.id }, { tenant: m.tenant_id, idem: `msg:${m.id}`, maxAttempts: 6 })) out.messages += 1;
  }
  return out;
}

/** Once a day: look at every connected Meta connection and renew the token that is within a week of running out. */
export async function messagingDaily({ enqueue }) {
  const day = new Date().toISOString().slice(0, 10);
  const conns = await deps.rpc('conn_connected', { p_limit: 500 });
  let queued = 0;
  for (const c of conns.ok && Array.isArray(conns.data) ? conns.data : []) {
    if (c.provider !== 'meta') continue;
    if (await enqueue('messaging.token_renew', { provider: 'meta' }, { tenant: c.tenant_id, idem: `renew:${c.tenant_id}:meta:${day}`, maxAttempts: 3 })) queued += 1;
  }
  return { renewQueued: queued };
}
