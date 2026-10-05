// Meta: one Facebook Page and the Instagram professional account linked to it.
// Publishing (Page posts, Instagram posts) and the two inboxes (Messenger for the Page, Instagram direct messages).
//
// How a company connects: Facebook Login for Business. The person signs in at Facebook and chooses the Pages this
// app may use. The server exchanges the code for a short-lived token, that for a long-lived one, and asks for the
// Page tokens. All of them are sealed in the connection; the browser never sees one. When the person has more than
// one Page, the Page (and with it the Instagram account) is chosen afterwards and kept in the connection settings.
//
// Settings: META_APP_ID, META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN (a random value typed into the Meta dashboard),
//           META_APPROVED (true once App Review and Business Verification are done; until then: pending approval),
//           META_LOGIN_CONFIG_ID (optional, the Facebook Login for Business configuration), META_GRAPH_VERSION
//           (optional), META_WEBHOOK_MAX_AGE_S (optional).
// Not proven against the live service: no app and no credentials exist in this build. The calls follow Meta's public
// Graph API documentation and are tested with mocked responses.
import { authorizeUrl, ProviderError } from '../oauth.js';
import { hmac, parseJson, payloadHash } from '../webhook.js';
import { graph, graphBase, graphVersion, graphErrorCode, verifyHubSignature, hubChallenge, maxAgeSeconds, withinAge } from '../messaging/graph.js';
import { toMessage, isoTime } from '../messaging/normalize.js';
import { insideWindow, WINDOW_MS } from '../messaging/consent.js';
import { ingest } from '../messaging/ingest.js';

const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'pages_manage_metadata', 'pages_messaging', 'instagram_basic', 'instagram_content_publish', 'instagram_manage_messages', 'business_management'];
const MAX_PAGES = 10;
const ID = /^\d{5,30}$/;
// Meta sends a failed webhook again for up to a day and a half. A body older than that is refused.
const MAX_AGE_S = 36 * 3600;
const HUMAN_AGENT_MS = 7 * 24 * 3600 * 1000;

/** A Graph call with the proof Meta accepts as evidence that the call comes from the app's own server. */
function g(ctx, path, opts = {}) {
  const secret = ctx.env('META_APP_SECRET');
  const query = { ...(opts.query || {}) };
  if (opts.token && secret) query.appsecret_proof = hmac(secret, opts.token);
  return graph(ctx, path, { ...opts, query });
}

/** The token endpoint. The app secret goes in the body of a POST, so it is never part of an address. */
async function tokenCall(ctx, form) {
  let res;
  try {
    res = await ctx.fetch(graphBase(ctx) + '/oauth/access_token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ client_id: ctx.env('META_APP_ID'), client_secret: ctx.env('META_APP_SECRET'), ...form }).toString(), signal: AbortSignal.timeout(10000),
    });
  } catch { throw new ProviderError('provider_unreachable'); }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok || !data || typeof data.access_token !== 'string' || !data.access_token) {
    const mapped = graphErrorCode(data && typeof data.error === 'object' ? data.error : {}, res.status);
    // A code that is no longer good and a token that ran out both mean the same to the person: connect again.
    if (mapped.reauth) throw new ProviderError(mapped.code, { reauth: true, status: res.status });
    throw new ProviderError(mapped.code === 'rate_limited' ? 'rate_limited' : 'token_exchange_failed', { status: res.status });
  }
  return data;
}

/** The Pages this person let the app use, each with its own token and its linked Instagram account. */
async function loadPages(ctx, userToken) {
  const r = await g(ctx, '/me/accounts', { token: userToken, query: { fields: 'id,name,access_token,instagram_business_account{id,username}', limit: 100 } });
  const list = Array.isArray(r.data) ? r.data : [];
  return list.filter((p) => p && ID.test(String(p.id)) && typeof p.access_token === 'string' && p.access_token).slice(0, MAX_PAGES).map((p) => ({
    id: String(p.id), name: String(p.name || '').slice(0, 200), token: p.access_token,
    ig: p.instagram_business_account && ID.test(String(p.instagram_business_account.id)) ? { id: String(p.instagram_business_account.id), username: String(p.instagram_business_account.username || '').slice(0, 100) } : null,
  }));
}

/** Short-lived or still valid long-lived token in, long-lived token and Page tokens out, in the stored shape. */
async function longLived(ctx, token, previous = {}) {
  const raw = await tokenCall(ctx, { grant_type: 'fb_exchange_token', fb_exchange_token: token });
  const expiresIn = Number(raw.expires_in);
  const pages = await loadPages(ctx, raw.access_token);
  return {
    access_token: raw.access_token,
    // Meta has no separate refresh token: a long-lived token is renewed by exchanging it while it still works.
    refresh_token: raw.access_token,
    expires_at: Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(ctx.now() + expiresIn * 1000).toISOString() : null,
    scope: previous.scope || SCOPES.join(' '), token_type: 'Bearer', pages,
  };
}

/** The Page this connection works with: the one in the settings, else the one it was verified for, else the only one. */
function pageOf(ctx) {
  const pages = (ctx.tokens && Array.isArray(ctx.tokens.pages) ? ctx.tokens.pages : []);
  const wanted = String(ctx.connection?.settings?.page_id || ctx.connection?.account_ref || '');
  if (wanted) {
    const p = pages.find((x) => x.id === wanted);
    // The stored Page is not among the Pages of the account that is signed in now: a different Facebook account.
    if (!p) throw new ProviderError('wrong_account');
    return p;
  }
  if (!pages.length) throw new ProviderError('no_pages');
  if (pages.length > 1) throw new ProviderError('page_not_selected');
  return pages[0];
}

const channelOf = (object) => (object === 'instagram' ? 'instagram' : 'facebook');

function messageFromGraph(m, page, channel) {
  const fromId = String(m.from?.id || '');
  const mine = fromId === page.id || (page.ig && fromId === page.ig.id);
  const other = mine ? (Array.isArray(m.to?.data) && m.to.data[0] ? m.to.data[0] : {}) : m.from || {};
  return toMessage({
    channel, provider: 'meta', externalId: String(m.id || ''), at: m.created_time, dir: mine ? 'out' : 'in', status: mine ? 'sent' : 'received',
    from: mine ? page.name : String(other.name || other.username || ''), to: mine ? String(other.name || other.username || '') : page.name,
    body: typeof m.message === 'string' ? m.message : '', threadId: other.id ? `${channel}:${other.id}` : undefined,
    handle: other.id ? { id: String(other.id) } : null, name: other.name || other.username || '',
  });
}

export default {
  id: 'meta',
  name: 'Facebook and Instagram',
  kind: 'oauth',
  env: ['META_APP_ID', 'META_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN'],
  scopes: SCOPES,
  approval: { needed: true, flag: 'META_APPROVED', note: 'Meta reviews the app (App Review) and the business (Business Verification) before these permissions work for accounts outside the app\'s own team.' },

  authUrl(ctx) {
    const config = ctx.env('META_LOGIN_CONFIG_ID');
    return authorizeUrl(`https://www.facebook.com/${graphVersion(ctx)}/dialog/oauth`, {
      clientId: ctx.env('META_APP_ID'), redirect: ctx.redirectUri, state: ctx.state, challenge: ctx.challenge,
      // With a Facebook Login for Business configuration, the permissions are the ones set in that configuration.
      scopes: config ? [] : SCOPES, extra: config ? { config_id: config } : {},
    });
  },

  async exchange(ctx, code) {
    const short = await tokenCall(ctx, { redirect_uri: ctx.redirectUri, code, code_verifier: ctx.verifier });
    return longLived(ctx, short.access_token);
  },

  /** Renews the long-lived token while it still works, and reads the Page tokens again. */
  async refresh(ctx, tokens) {
    return longLived(ctx, tokens.refresh_token || tokens.access_token, tokens);
  },

  /** Removes every permission the person gave this app. */
  async revoke(ctx, tokens) {
    await g(ctx, '/me/permissions', { method: 'DELETE', token: tokens.access_token });
  },

  /**
   * The verified call behind "connected": who is signed in, which permissions they granted, and that the Page
   * answers with its own token. With several Pages and none chosen yet the account is verified but no Page is:
   * the answer says so (`needs: 'page_selection'`) and every action refuses with page_not_selected until one is.
   */
  async status(ctx) {
    if (!ctx.tokens || !ctx.tokens.access_token) return { ok: false, reason: 'not_connected' };
    const me = await g(ctx, '/me', { token: ctx.tokens.access_token, query: { fields: 'id,name' } });
    if (!me || !ID.test(String(me.id))) return { ok: false, reason: 'account_unknown' };
    const perms = await g(ctx, '/me/permissions', { token: ctx.tokens.access_token });
    const granted = (Array.isArray(perms.data) ? perms.data : []).filter((p) => p && p.status === 'granted').map((p) => String(p.permission));
    if (!granted.includes('pages_show_list')) return { ok: false, reason: 'permission_missing' };
    let page;
    try { page = pageOf(ctx); } catch (e) {
      if (e.code !== 'page_not_selected') return { ok: false, reason: e.code };
      return { ok: true, account: { label: String(me.name || 'Facebook account').slice(0, 200), ref: null }, scopes: granted, needs: 'page_selection' };
    }
    const p = await g(ctx, '/' + page.id, { token: page.token, query: { fields: 'id,name' } });
    if (String(p.id) !== page.id) return { ok: false, reason: 'wrong_account' };
    return { ok: true, account: { label: String(p.name || page.name).slice(0, 200), ref: page.id }, scopes: granted };
  },

  async health(ctx) {
    try {
      const s = await this.status(ctx);
      return s.ok ? { ok: true, health: 'ok' } : { ok: false, reason: s.reason, reauth: s.reason === 'permission_missing' };
    } catch (e) {
      if (e instanceof ProviderError) return { ok: false, reason: e.code, reauth: e.reauth };
      throw e;
    }
  },

  /** Reads the newest conversations of the Page (and of its Instagram account) and stores what is not there yet. */
  async sync(ctx, what = 'all') {
    let page;
    try { page = pageOf(ctx); } catch (e) { return { skipped: e.code }; }
    const counts = {};
    for (const platform of ['messenger', 'instagram']) {
      if (platform === 'instagram' && !page.ig) continue;
      if (what !== 'all' && what !== platform) continue;
      const resource = 'conversations.' + platform;
      const since = ctx.cursor ? await ctx.cursor.get(resource) : null;
      const r = await g(ctx, `/${page.id}/conversations`, { token: page.token, query: { platform, fields: 'id,updated_time,messages.limit(10){id,created_time,from,to,message}', limit: 20 } });
      const channel = platform === 'instagram' ? 'instagram' : 'facebook';
      const messages = []; let newest = since || '';
      for (const c of Array.isArray(r.data) ? r.data : []) {
        const updated = isoTime(c.updated_time) || '';
        if (since && updated && updated <= since) continue;
        if (updated > newest) newest = updated;
        for (const m of Array.isArray(c.messages?.data) ? c.messages.data : []) if (m && m.id) messages.push(messageFromGraph(m, page, channel));
      }
      if (messages.length) await ingest(ctx.tenantId, 'meta', { messages }, ctx.rpc ? { rpc: ctx.rpc } : {});
      if (newest && newest !== since && ctx.cursor) await ctx.cursor.set(resource, newest);
      counts[platform] = messages.length;
    }
    return { counts };
  },

  webhook: {
    /** The one-time GET Meta makes when the webhook address is saved. */
    challenge(request, ctx) { return hubChallenge(request, ctx.env('META_WEBHOOK_VERIFY_TOKEN')); },

    /**
     * Checks the signature over the raw body, then keeps ids and counts only: which Page, how many of each kind of
     * event, and the message ids. No message text, no names. The text is fetched by id when the event is processed.
     */
    verify(request, raw, ctx) {
      const v = verifyHubSignature(ctx.env('META_APP_SECRET'), request.headers.get('x-hub-signature-256'), raw);
      if (!v.ok) return v;
      const body = parseJson(raw);
      if (!body || (body.object !== 'page' && body.object !== 'instagram') || !Array.isArray(body.entry) || !body.entry.length) return { ok: false, reason: 'bad_payload' };
      const counts = { message: 0, echo: 0, delivery: 0, read: 0, postback: 0, change: 0 };
      const mids = []; let newest = 0; let account = '';
      for (const e of body.entry.slice(0, 50)) {
        if (!e || !ID.test(String(e.id))) return { ok: false, reason: 'bad_payload' };
        account = account || String(e.id);
        const t = Number(e.time); if (Number.isFinite(t)) newest = Math.max(newest, t < 1e11 ? t * 1000 : t);
        for (const m of Array.isArray(e.messaging) ? e.messaging.slice(0, 100) : []) {
          if (m && m.message && typeof m.message.mid === 'string') { counts[m.message.is_echo ? 'echo' : 'message'] += 1; if (mids.length < 25) mids.push(m.message.mid.slice(0, 200)); }
          else if (m && m.delivery) counts.delivery += 1;
          else if (m && m.read) counts.read += 1;
          else if (m && m.postback) counts.postback += 1;
        }
        counts.change += Array.isArray(e.changes) ? e.changes.length : 0;
      }
      if (!newest || !withinAge(new Date(newest).toISOString(), ctx.now(), maxAgeSeconds(ctx, 'META_WEBHOOK_MAX_AGE_S', MAX_AGE_S))) return { ok: false, reason: 'stale' };
      const type = counts.message || counts.echo ? 'message' : counts.delivery ? 'delivery' : counts.read ? 'read' : counts.postback ? 'postback' : 'change';
      // Meta gives a delivery no id of its own. The same body sent again has the same hash, which is what a repeat is.
      return { ok: true, eventId: 'h' + payloadHash(raw).slice(0, 48), type: `${body.object}.${type}`, accountRef: account, redacted: { object: body.object, account, type, counts, mids } };
    },

    /** Fetches each new message by its id with the Page token and stores it. Deliveries and reads carry nothing to store yet. */
    async handle(ctx, event) {
      const red = event.redacted || {};
      const mids = Array.isArray(red.mids) ? red.mids : [];
      if (!mids.length) return { ok: true, ignored: true };
      if (!ctx.tokens) throw new ProviderError('not_connected');
      const page = pageOf(ctx);
      const messages = [];
      for (const mid of mids) {
        const m = await g(ctx, '/' + encodeURIComponent(mid), { token: page.token, query: { fields: 'id,created_time,from,to,message' } });
        if (m && m.id) messages.push(messageFromGraph(m, page, channelOf(red.object)));
      }
      await ingest(ctx.tenantId, 'meta', { messages }, ctx.rpc ? { rpc: ctx.rpc } : {});
      return { ok: true, stored: messages.length };
    },
  },

  actions: {
    /** The Pages of the connected account, without their tokens: what the Page picker shows. */
    listPages(ctx) {
      return (ctx.tokens?.pages || []).map((p) => ({ id: p.id, name: p.name, instagram: p.ig ? { id: p.ig.id, username: p.ig.username } : null }));
    },

    /**
     * Chooses the Page. Checks it with a real call, then returns what the caller stores on the connection:
     * { settings, account }. The Instagram id is kept in the settings because Instagram webhooks arrive under it.
     */
    async selectPage(ctx, { pageId }) {
      const page = (ctx.tokens?.pages || []).find((p) => p.id === String(pageId));
      if (!page) throw new ProviderError('wrong_account');
      const p = await g(ctx, '/' + page.id, { token: page.token, query: { fields: 'id,name' } });
      if (String(p.id) !== page.id) throw new ProviderError('wrong_account');
      return { settings: { page_id: page.id, page_name: page.name, ig_account_id: page.ig ? page.ig.id : '', ig_username: page.ig ? page.ig.username : '' }, account: { label: String(p.name || page.name).slice(0, 200), ref: page.id } };
    },

    /** Tells Meta to send this Page's messages to the app's webhook. Needed once per Page. */
    async subscribePage(ctx) {
      const page = pageOf(ctx);
      const r = await g(ctx, `/${page.id}/subscribed_apps`, { method: 'POST', token: page.token, body: { subscribed_fields: ['messages', 'messaging_postbacks', 'message_deliveries', 'message_reads', 'message_echoes'] } });
      if (r.success !== true) throw new ProviderError('subscribe_failed');
      return { subscribed: true };
    },

    /**
     * Publishes to the Page: text, or a photo with a caption. A photo comes either as bytes ({ photoBytes, photoMime })
     * or as an address Meta can fetch ({ photoUrl }, https only). Returns { id, channel: 'facebook' }.
     */
    async publishPagePost(ctx, post) {
      const page = pageOf(ctx);
      const text = String(post.text || '').trim().slice(0, 60000);
      let r;
      if (post.photoBytes) {
        const form = new FormData();
        form.set('source', new Blob([post.photoBytes], { type: /^image\/(jpeg|png|webp|gif)$/.test(post.photoMime || '') ? post.photoMime : 'image/jpeg' }), 'photo');
        if (text) form.set('caption', text);
        r = await g(ctx, `/${page.id}/photos`, { method: 'POST', token: page.token, form, timeoutMs: 30000 });
      } else if (post.photoUrl) {
        if (!/^https:\/\/[^\s]{4,2000}$/.test(String(post.photoUrl))) throw new ProviderError('media_invalid');
        r = await g(ctx, `/${page.id}/photos`, { method: 'POST', token: page.token, body: { url: String(post.photoUrl), ...(text ? { caption: text } : {}) }, timeoutMs: 30000 });
      } else {
        if (!text) throw new ProviderError('message_invalid');
        r = await g(ctx, `/${page.id}/feed`, { method: 'POST', token: page.token, body: { message: text } });
      }
      const id = String(r.post_id || r.id || '');
      if (!id) throw new ProviderError('provider_error');
      return { id, channel: 'facebook' };
    },

    /**
     * Publishes a photo to Instagram in the two steps Meta requires: create a container from an address Meta can
     * fetch, wait until it is ready, publish it. Instagram takes no text-only post and no uploaded bytes.
     */
    async publishInstagram(ctx, post) {
      const page = pageOf(ctx);
      if (!page.ig) throw new ProviderError('instagram_not_linked');
      if (!/^https:\/\/[^\s]{4,2000}$/.test(String(post.imageUrl || ''))) throw new ProviderError('media_invalid');
      const c = await g(ctx, `/${page.ig.id}/media`, { method: 'POST', token: page.token, body: { image_url: String(post.imageUrl), caption: String(post.caption || post.text || '').slice(0, 2200) }, timeoutMs: 30000 });
      if (!c.id) throw new ProviderError('provider_error');
      const sleep = ctx.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
      for (let i = 0; ; i += 1) {
        const s = await g(ctx, '/' + c.id, { token: page.token, query: { fields: 'status_code' } });
        if (s.status_code === 'FINISHED') break;
        if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new ProviderError('media_rejected');
        // Not ready after a few looks: the caller (a job) tries the whole post again later.
        if (i >= 4) throw new ProviderError('media_processing');
        await sleep(2000);
      }
      const p = await g(ctx, `/${page.ig.id}/media_publish`, { method: 'POST', token: page.token, body: { creation_id: c.id } });
      if (!p.id) throw new ProviderError('provider_error');
      return { id: String(p.id), channel: 'instagram' };
    },

    /**
     * Answers a person on Messenger or Instagram. msg: { channel: 'facebook' | 'instagram', to (their scoped id),
     * text, lastInboundAt (when they last wrote, from the company's records), humanAgent? }.
     * Meta allows a reply for 24 hours after the person's last message. Outside it the send is refused here with
     * outside_messaging_window, before any call. `humanAgent: true` uses Meta's human agent tag (7 days), which is
     * a permission of its own that Meta must have approved for the app.
     */
    async sendMessage(ctx, msg) {
      const page = pageOf(ctx);
      const channel = msg.channel === 'instagram' ? 'instagram' : 'facebook';
      if (channel === 'instagram' && !page.ig) throw new ProviderError('instagram_not_linked');
      const to = String(msg.to || '');
      const text = String(msg.text || '').trim();
      if (!ID.test(to)) throw new ProviderError('recipient_invalid');
      if (!text || text.length > (channel === 'instagram' ? 1000 : 2000)) throw new ProviderError('message_invalid');
      const inWindow = insideWindow(msg.lastInboundAt, ctx.now(), WINDOW_MS);
      const tagged = !inWindow && msg.humanAgent === true && insideWindow(msg.lastInboundAt, ctx.now(), HUMAN_AGENT_MS);
      if (!inWindow && !tagged) throw new ProviderError('outside_messaging_window');
      const body = { recipient: { id: to }, message: { text }, ...(tagged ? { messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' } : { messaging_type: 'RESPONSE' }) };
      const r = await g(ctx, `/${page.id}/messages`, { method: 'POST', token: page.token, body });
      if (typeof r.message_id !== 'string' || !r.message_id) throw new ProviderError('provider_error');
      return { id: r.message_id, ...toMessage({ channel, provider: 'meta', externalId: r.message_id, at: ctx.now(), dir: 'out', status: 'sent', from: page.name, to, body: text, threadId: `${channel}:${to}`, handle: { id: to } }) };
    },
  },
};
