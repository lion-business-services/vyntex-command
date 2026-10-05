// Gmail: send from, and read, the mailbox a company connected.
//   send        RFC 2822 message with attachments and reply threading, through users.messages.send
//   read        thread list, one thread, an attachment
//   sync        only what changed since the last run, by Gmail's history id; a lost history id starts over cleanly
//   push        Gmail tells a Cloud Pub/Sub topic when the inbox changes; Pub/Sub calls /api/webhooks/gmail with a
//               signed token, and the notice only starts a sync (it carries no email content)
//   matching    for each new message the adapter returns the addresses to look up (matchInput). Finding the client
//               or the lead is the caller's job: the adapter never reads workspace records.
//
// Scopes: gmail.send and gmail.readonly, plus openid and email to learn which account answered. gmail.readonly is one
// of Google's restricted scopes, so the card stays "pending approval" until GOOGLE_GMAIL_APPROVED is true.
// One mailbox per company: the framework keeps one connection per company and provider (see docs/integrations/google.md).
//
// Not exercised against Google: no client or account exists in this build. Tested with mocked provider responses.
import { ProviderError } from '../oauth.js';
import { parseJson } from '../webhook.js';
import { GOOGLE_ENV, IDENTITY_SCOPES, SCOPE, googleAuthUrl, googleExchange, googleRefresh, googleRevoke, missingScopes, grantedScopes, domainAllowed, isEmail } from '../google/oauth.js';
import { gapi, seg } from '../google/rest.js';
import { buildMime, parseAddresses } from '../google/mime.js';
import { verifyGoogleOidc } from '../google/pubsub.js';
import { cursorOf, sinkOf, stableId } from '../google/state.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const UPLOAD = 'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send';
const ID = /^[A-Za-z0-9_-]{1,120}$/;
const NEEDED = [SCOPE.gmailSend, SCOPE.gmailRead];
const MAX_TOTAL = 18 * 1024 * 1024;       // Gmail refuses a message over 25 MB after encoding; this leaves room for base64.
const INLINE_LIMIT = 4 * 1024 * 1024;     // above this the upload address is used
const SYNC_MESSAGES = 50;                 // per run; the next run goes on from the stored history id
const WATCH_RENEW_MS = 2 * 86400000;      // a Gmail watch lasts 7 days: renew when under 2 days are left

const header = (payload, name) => { const h = (payload?.headers || []).find((x) => String(x.name).toLowerCase() === name.toLowerCase()); return h ? String(h.value) : ''; };
const list = (v) => (Array.isArray(v) ? v : v ? String(v).split(/[,;]/) : []).map((x) => String(x).trim()).filter(Boolean);

/** What the caller needs to find the client, lead or contact behind a message: addresses only, in lower case. */
export function matchInput(payload, own = '') {
  const me = String(own || '').toLowerCase();
  const from = parseAddresses(header(payload, 'From'))[0] || null;
  const others = [...parseAddresses(header(payload, 'To')), ...parseAddresses(header(payload, 'Cc')), ...parseAddresses(header(payload, 'Reply-To'))];
  const sender = from && isEmail(from.email) ? from.email : null;
  const emails = [...new Set([sender, ...others.map((a) => a.email)].filter((e) => e && isEmail(e) && e !== me))];
  return { sender, senderDomain: sender ? sender.split('@')[1] : null, emails, outgoing: !!sender && sender === me };
}

function decode(data, contentType) {
  const buf = Buffer.from(String(data || ''), 'base64url');
  const cs = (/charset="?([\w-]+)"?/i.exec(contentType || '') || [])[1] || 'utf-8';
  try { return new TextDecoder(cs.toLowerCase() === 'us-ascii' ? 'utf-8' : cs).decode(buf); } catch { return buf.toString('utf8'); }
}
function walk(p, out, depth = 0) {
  if (!p || depth > 12) return;
  const type = String(p.mimeType || '').toLowerCase();
  const disp = header(p, 'Content-Disposition').toLowerCase();
  if (p.filename && p.body && p.body.attachmentId) out.files.push({ id: p.body.attachmentId, name: String(p.filename).slice(0, 200), type, size: Number(p.body.size) || 0 });
  else if (type === 'text/html' && p.body?.data) out.html.push(decode(p.body.data, header(p, 'Content-Type')));
  else if (type === 'text/plain' && p.body?.data && !disp.startsWith('attachment')) out.text.push(decode(p.body.data, header(p, 'Content-Type')));
  for (const c of p.parts || []) walk(c, out, depth + 1);
}
function mapMessage(m, own) {
  const x = { html: [], text: [], files: [] };
  walk(m.payload, x);
  return {
    id: m.id, threadId: m.threadId, labels: m.labelIds || [], unread: (m.labelIds || []).includes('UNREAD'),
    date: Number(m.internalDate) ? new Date(Number(m.internalDate)).toISOString() : null, snippet: m.snippet || '',
    from: parseAddresses(header(m.payload, 'From'))[0] || null, to: parseAddresses(header(m.payload, 'To')), cc: parseAddresses(header(m.payload, 'Cc')),
    subject: header(m.payload, 'Subject'), messageId: header(m.payload, 'Message-ID'), references: header(m.payload, 'References'),
    text: x.text.join('\n\n').slice(0, 200000), html: x.html.join('<hr>').slice(0, 600000), attachments: x.files,
    match: matchInput(m.payload, own),
  };
}

const profile = (ctx) => gapi(ctx, 'GET', API + '/profile');
const ownAddress = (ctx) => String(ctx.connection?.account_label || '').toLowerCase();

/** Asks Gmail to notify the Pub/Sub topic for the inbox. Calling it again simply renews it, so a repeat is harmless. */
async function watch(ctx, cursor) {
  const topic = ctx.env('GOOGLE_PUBSUB_TOPIC');
  if (!/^projects\/[a-z0-9-]{4,40}\/topics\/[A-Za-z0-9._~%+-]{3,255}$/.test(topic)) return { watching: false, reason: 'push_not_configured' };
  const until = Number(await cursor.get('watch')) || 0;
  if (until - ctx.now() > WATCH_RENEW_MS) return { watching: true, renewed: false };
  const r = await gapi(ctx, 'POST', API + '/watch', { body: { topicName: topic, labelIds: ['INBOX'], labelFilterBehavior: 'INCLUDE' }, repeatable: true });
  const expiration = Number(r.expiration) || 0;
  if (!expiration) throw new ProviderError('bad_answer');
  await cursor.set('watch', String(expiration));
  return { watching: true, renewed: true };
}

/** Message ids added to the inbox since a history id. { ids, next } or { expired: true } when Gmail no longer has that far back. */
async function historySince(ctx, startHistoryId) {
  const ids = new Set();
  let pageToken, next = startHistoryId;
  for (let page = 0; page < 10; page += 1) {
    let r;
    try {
      r = await gapi(ctx, 'GET', API + '/history', { query: { startHistoryId, historyTypes: 'messageAdded', labelId: 'INBOX', maxResults: 500, pageToken } });
    } catch (e) {
      if (e instanceof ProviderError && e.code === 'not_found') return { expired: true };
      throw e;
    }
    for (const h of Array.isArray(r.history) ? r.history : []) for (const a of h.messagesAdded || []) if (a.message && ID.test(String(a.message.id || ''))) ids.add(a.message.id);
    if (typeof r.historyId === 'string' || typeof r.historyId === 'number') next = String(r.historyId);
    pageToken = r.nextPageToken;
    if (!pageToken) return { ids: [...ids], next, complete: true };
  }
  // More pages than one run reads: stop at a point Gmail can resume from (the cursor is not moved past unread pages).
  return { ids: [...ids], next: startHistoryId, complete: false };
}

async function deliver(ctx, ids) {
  const sink = sinkOf(ctx);
  const own = ownAddress(ctx);
  let delivered = 0, gone = 0;
  for (const id of ids) {
    let m;
    try {
      m = await gapi(ctx, 'GET', `${API}/messages/${seg(id, ID)}`, { query: { format: 'metadata', metadataHeaders: ['From', 'To', 'Cc', 'Reply-To', 'Message-ID'] } });
    } catch (e) {
      // Deleted between the notice and now. Nothing to hand over.
      if (e instanceof ProviderError && e.code === 'not_found') { gone += 1; continue; }
      throw e;
    }
    if ((m.labelIds || []).includes('DRAFT') || (m.labelIds || []).includes('SPAM')) continue;
    // The subject and the body stay at Google until someone opens the thread: the row holds ids and the lookup input.
    await sink({ kind: 'gmail.message', ref: `gmail:${m.id}`, data: { messageId: m.id, threadId: m.threadId, receivedAt: Number(m.internalDate) ? new Date(Number(m.internalDate)).toISOString() : null, match: matchInput(m.payload, own) } });
    delivered += 1;
  }
  return { delivered, gone };
}

const adapter = {
  id: 'gmail',
  name: 'Gmail',
  kind: 'oauth',
  env: GOOGLE_ENV,
  scopes: [...IDENTITY_SCOPES, ...NEEDED],
  approval: { needed: true, flag: 'GOOGLE_GMAIL_APPROVED', note: 'Reading a mailbox uses a Google restricted scope. Google must verify the app, including a security assessment, before it may be used outside the test users of the Google Cloud project.' },

  authUrl(ctx) { return googleAuthUrl(ctx, this.scopes); },
  exchange: googleExchange,
  refresh: googleRefresh,
  revoke(ctx, tokens) { return googleRevoke(ctx, tokens, ['gcal', 'gbp']); },

  /** The verified call: the mailbox profile. Also refuses a consent with a permission unticked, or an account outside the allowed domains. */
  async status(ctx) {
    const missing = missingScopes(ctx, NEEDED);
    if (missing.length) return { ok: false, reason: 'scope_missing' };
    const p = await profile(ctx);
    if (!isEmail(p.emailAddress)) return { ok: false, reason: 'account_unknown' };
    const email = p.emailAddress.toLowerCase();
    if (!domainAllowed(ctx, email)) return { ok: false, reason: 'wrong_account' };
    // The address is the reference: Pub/Sub notices name the mailbox by address and are matched to the company with it.
    return { ok: true, account: { label: email, ref: email }, scopes: grantedScopes(ctx) };
  },

  async health(ctx) {
    const p = await profile(ctx);
    const known = String(ctx.connection?.account_ref || '').toLowerCase();
    if (known && String(p.emailAddress || '').toLowerCase() !== known) return { ok: false, reason: 'wrong_account', reauth: true };
    return { ok: true, health: 'ok' };
  },

  /**
   * what: 'all' (default), 'inbox' or 'watch'. Returns { counts: { messages, gone }, baseline?, resync?, more?, watch }.
   * New inbox messages are handed to the sink before the history id is stored, so a failure in between repeats the
   * hand over (which is stored once) instead of losing a message.
   */
  async sync(ctx, what = 'all') {
    const cursor = cursorOf(ctx);
    const out = { counts: { messages: 0, gone: 0 } };
    if (what !== 'watch') {
      const since = await cursor.get('history');
      let found = since ? await historySince(ctx, since) : null;
      if (!found || found.expired) {
        // First run, or Gmail no longer keeps history that far back: take the newest inbox messages and start from now.
        const p = await profile(ctx);
        const recent = found ? await gapi(ctx, 'GET', API + '/messages', { query: { labelIds: 'INBOX', maxResults: SYNC_MESSAGES } }) : { messages: [] };
        found = { ids: (recent.messages || []).map((m) => m.id).filter((id) => ID.test(String(id))), next: String(p.historyId || ''), complete: true };
        if (since) out.resync = true; else out.baseline = true;
      }
      const batch = found.ids.slice(0, SYNC_MESSAGES);
      const d = await deliver(ctx, batch);
      out.counts = { messages: d.delivered, gone: d.gone };
      // Only when everything found was handed over does the position move. Otherwise the next run reads the same range again.
      if (found.complete && batch.length === found.ids.length && found.next) await cursor.set('history', found.next);
      else out.more = true;
    }
    if (what === 'all' || what === 'watch') out.watch = await watch(ctx, cursor);
    return out;
  },

  webhook: {
    /**
     * A Pub/Sub push. The signed token is the authentication; the body says which mailbox and which history id.
     * Stored copy: the type, the history id and the publish time. The mailbox address is used to find the company
     * and is not stored.
     * Replay: the token expires (signed), a message id is recorded once by the framework, and a repeat could only
     * start a sync that finds nothing new.
     */
    async verify(request, raw, ctx) {
      const audience = ctx.env('GOOGLE_PUBSUB_AUDIENCE');
      const sender = ctx.env('GOOGLE_PUBSUB_SERVICE_ACCOUNT');
      if (!audience || !sender) return { ok: false, reason: 'not_configured' };
      const v = await verifyGoogleOidc(request.headers.get('authorization'), { audience, email: sender, fetchFn: ctx.fetch || ((...a) => globalThis.fetch(...a)), now: ctx.now() });
      if (!v.ok) return v;
      const body = parseJson(raw);
      const msg = body && body.message;
      const eventId = msg && (msg.messageId || msg.message_id);
      if (!msg || typeof eventId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(eventId) || typeof msg.data !== 'string') return { ok: false, reason: 'bad_payload' };
      const wanted = ctx.env('GOOGLE_PUBSUB_SUBSCRIPTION');
      if (wanted && body.subscription !== wanted) return { ok: false, reason: 'wrong_subscription' };
      let data = null;
      try { data = JSON.parse(Buffer.from(msg.data, 'base64').toString('utf8')); } catch { data = null; }
      if (!data || !isEmail(data.emailAddress) || !/^\d{1,20}$/.test(String(data.historyId ?? ''))) return { ok: false, reason: 'bad_payload' };
      const published = typeof (msg.publishTime || msg.publish_time) === 'string' ? String(msg.publishTime || msg.publish_time).slice(0, 40) : null;
      return { ok: true, eventId: 'pubsub:' + eventId, type: 'gmail.push', accountRef: data.emailAddress.toLowerCase(), redacted: { type: 'gmail.push', historyId: String(data.historyId), publishTime: published } };
    },
    /** The notice only says "something changed": read the changes from the stored position. */
    async handle(ctx) {
      // No company has this mailbox connected (disconnected since, or a notice for another account): nothing to do.
      if (!ctx.tenantId || !ctx.tokens) return { ok: true, ignored: true };
      const out = await adapter.sync(ctx, 'inbox');
      return { ok: true, counts: out.counts };
    },
  },

  actions: {
    matchInput,

    /**
     * msg: { to, cc?, bcc?, subject, text, html?, fromName?, attachments?: [{ filename, contentType, data: Buffer | base64 }],
     *        threadId?, inReplyTo?, references?, idempotencyKey? }
     * Gmail has no idempotency key. With msg.idempotencyKey the message gets a Message-ID made from the key, and the
     * mailbox is asked first whether a message with that id was already sent: a retry then returns the first send.
     * Returns { id, threadId, messageId, duplicate }.
     */
    async send(ctx, msg) {
      const from = ownAddress(ctx);
      if (!isEmail(from)) throw new ProviderError('not_connected');
      const to = list(msg.to), cc = list(msg.cc), bcc = list(msg.bcc);
      if (!to.length || to.length + cc.length + bcc.length > 50 || ![...to, ...cc, ...bcc].every(isEmail)) throw new ProviderError('recipient_invalid');
      const subject = String(msg.subject || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
      if (!subject || !(String(msg.text || '').trim() || msg.html)) throw new ProviderError('message_invalid');
      const attachments = [];
      let total = 0;
      for (const a of (Array.isArray(msg.attachments) ? msg.attachments : []).slice(0, 20)) {
        const data = Buffer.isBuffer(a?.data) ? a.data : Buffer.from(String(a?.data || ''), 'base64');
        if (!data.length) continue;
        total += data.length;
        attachments.push({ filename: a.filename, contentType: a.contentType, data });
      }
      if (total > MAX_TOTAL) throw new ProviderError('message_too_large');
      const threadId = ID.test(String(msg.threadId || '')) ? String(msg.threadId) : undefined;
      let messageId;
      if (msg.idempotencyKey) {
        messageId = `<vx.${stableId('gmail-send', ctx.tenantId, String(msg.idempotencyKey)).slice(0, 40)}@${from.split('@')[1]}>`;
        const seen = await gapi(ctx, 'GET', API + '/messages', { query: { q: `rfc822msgid:${messageId}`, maxResults: 1 } });
        const first = Array.isArray(seen.messages) ? seen.messages[0] : null;
        if (first && ID.test(String(first.id || ''))) return { id: first.id, threadId: first.threadId || null, messageId, duplicate: true };
      }
      const mime = buildMime({ from, fromName: msg.fromName, to, cc, bcc, subject, text: String(msg.text || ''), html: msg.html ? String(msg.html) : undefined, attachments, messageId, inReplyTo: msg.inReplyTo, references: msg.references });
      let r;
      if (mime.length < INLINE_LIMIT) {
        r = await gapi(ctx, 'POST', API + '/messages/send', { body: { raw: Buffer.from(mime).toString('base64url'), ...(threadId ? { threadId } : {}) }, timeoutMs: 20000 });
      } else {
        // Large messages go to the upload address as two parts: the thread, then the message itself.
        const bd = 'vxu_' + stableId(mime.length, Date.now(), Math.random()).slice(0, 20);
        const payload = Buffer.concat([Buffer.from(`--${bd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(threadId ? { threadId } : {})}\r\n--${bd}\r\nContent-Type: message/rfc822\r\n\r\n`), Buffer.from(mime), Buffer.from(`\r\n--${bd}--`)]);
        r = await gapi(ctx, 'POST', UPLOAD, { query: { uploadType: 'multipart' }, raw: payload, contentType: `multipart/related; boundary=${bd}`, timeoutMs: 60000 });
      }
      if (!ID.test(String(r.id || ''))) throw new ProviderError('bad_answer');
      return { id: r.id, threadId: r.threadId || null, messageId: messageId || null, duplicate: false };
    },

    /** opts: { label = 'INBOX' | 'SENT' | 'ALL' | a label id, q?, pageToken?, max? (1 to 50) }. Returns { threads, next }. */
    async listThreads(ctx, opts = {}) {
      const label = String(opts.label || 'INBOX');
      if (label !== 'ALL' && !ID.test(label)) throw new ProviderError('invalid_id');
      const max = Math.max(1, Math.min(50, Number(opts.max) || 25));
      const r = await gapi(ctx, 'GET', API + '/threads', { query: { maxResults: max, labelIds: label === 'ALL' ? undefined : label, q: opts.q ? String(opts.q).slice(0, 300) : undefined, pageToken: opts.pageToken ? String(opts.pageToken).slice(0, 300) : undefined } });
      const own = ownAddress(ctx);
      const threads = [];
      for (const t of Array.isArray(r.threads) ? r.threads : []) {
        if (!ID.test(String(t.id || ''))) continue;
        const full = await gapi(ctx, 'GET', `${API}/threads/${seg(t.id, ID)}`, { query: { format: 'metadata', metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date', 'Message-ID'] } });
        const msgs = Array.isArray(full.messages) ? full.messages : [];
        if (!msgs.length) continue;
        const last = msgs[msgs.length - 1];
        threads.push({
          id: t.id, subject: header(msgs[0].payload, 'Subject'), snippet: last.snippet || '', count: msgs.length,
          date: Number(last.internalDate) ? new Date(Number(last.internalDate)).toISOString() : null,
          unread: msgs.some((m) => (m.labelIds || []).includes('UNREAD')), from: parseAddresses(header(last.payload, 'From'))[0] || null,
          match: matchInput(last.payload, own),
        });
      }
      return { threads, next: r.nextPageToken || null };
    },

    /** One conversation with its messages (text, HTML, attachment list) and, per message, the addresses to match. */
    async getThread(ctx, id) {
      const r = await gapi(ctx, 'GET', `${API}/threads/${seg(id, ID)}`, { query: { format: 'full' } });
      const own = ownAddress(ctx);
      const messages = (Array.isArray(r.messages) ? r.messages : []).map((m) => mapMessage(m, own));
      return { id: r.id, subject: messages[0]?.subject || '', messages };
    },

    /** The bytes of one attachment. Returns { data: Buffer, size }. */
    async getAttachment(ctx, messageId, attachmentId) {
      const r = await gapi(ctx, 'GET', `${API}/messages/${seg(messageId, ID)}/attachments/${seg(attachmentId, /^[A-Za-z0-9_-]{1,2000}$/)}`);
      const data = Buffer.from(String(r.data || ''), 'base64url');
      return { data, size: data.length };
    },
  },
};

export default adapter;
