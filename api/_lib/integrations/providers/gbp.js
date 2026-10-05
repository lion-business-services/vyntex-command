// Google Business Profile: the company's listing on Google Search and Maps.
//   accounts and locations   which profiles the connected Google account manages
//   reviews                  list them, reply to one
//   review link              the address a client opens to leave a review for a location
//
// Google gives access to the Business Profile APIs per Google Cloud project, on request. Until Google has granted it
// (and GOOGLE_GBP_APPROVED says so) the card shows "pending approval" and nothing here is reachable.
// Scope: business.manage (the only scope these APIs have), plus openid and email.
// No webhook: Google can publish review notices to Pub/Sub, which is not built here. Reviews are read by sync.
//
// Not exercised against Google. Tested with mocked provider responses.
import { ProviderError } from '../oauth.js';
import { GOOGLE_ENV, GOOGLE_USERINFO, IDENTITY_SCOPES, SCOPE, googleAuthUrl, googleExchange, googleRefresh, googleRevoke, missingScopes, grantedScopes, domainAllowed, isEmail } from '../google/oauth.js';
import { gapi } from '../google/rest.js';
import { cursorOf, sinkOf } from '../google/state.js';

const ACCOUNTS = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const INFO = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const V4 = 'https://mybusiness.googleapis.com/v4';
const ACCOUNT = /^accounts\/[A-Za-z0-9_-]{1,60}$/;
const LOCATION = /^locations\/[A-Za-z0-9_-]{1,60}$/;
const REVIEW = /^accounts\/[A-Za-z0-9_-]{1,60}\/locations\/[A-Za-z0-9_-]{1,60}\/reviews\/[A-Za-z0-9_-]{1,200}$/;
const STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

const check = (value, pattern) => { if (typeof value !== 'string' || !pattern.test(value)) throw new ProviderError('invalid_id'); return value; };

/** A 403 from these APIs before Google granted access to the project reads as "not approved yet", not as a broken token. */
async function call(ctx, method, url, opts) {
  try { return await gapi(ctx, method, url, opts); } catch (e) {
    if (e instanceof ProviderError && (e.code === 'api_not_enabled' || e.code === 'forbidden')) throw new ProviderError('access_not_granted', { status: e.status });
    throw e;
  }
}

async function accounts(ctx) {
  const r = await call(ctx, 'GET', ACCOUNTS + '/accounts', { query: { pageSize: 20 } });
  return (Array.isArray(r.accounts) ? r.accounts : []).filter((a) => a && ACCOUNT.test(String(a.name || ''))).map((a) => ({ name: a.name, label: String(a.accountName || '').slice(0, 200), type: String(a.type || '').slice(0, 40) }));
}

function mapLocation(l) {
  const placeId = typeof l.metadata?.placeId === 'string' && /^[A-Za-z0-9_-]{5,200}$/.test(l.metadata.placeId) ? l.metadata.placeId : null;
  const given = typeof l.metadata?.newReviewUri === 'string' && /^https:\/\/[^\s]{1,400}$/.test(l.metadata.newReviewUri) ? l.metadata.newReviewUri : null;
  return {
    name: l.name, title: String(l.title || '').slice(0, 200), placeId,
    mapsUri: typeof l.metadata?.mapsUri === 'string' && /^https:\/\//.test(l.metadata.mapsUri) ? l.metadata.mapsUri : null,
    // Google's own "write a review" address when it gives one; otherwise the documented address built from the place id.
    reviewLink: given || (placeId ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}` : null),
  };
}

const adapter = {
  id: 'gbp',
  name: 'Google Business Profile',
  kind: 'oauth',
  env: GOOGLE_ENV,
  scopes: [...IDENTITY_SCOPES, SCOPE.business],
  approval: { needed: true, flag: 'GOOGLE_GBP_APPROVED', note: 'Google grants access to the Business Profile APIs per Google Cloud project, on request. The business.manage scope is also subject to Google verification.' },

  authUrl(ctx) { return googleAuthUrl(ctx, this.scopes); },
  exchange: googleExchange,
  refresh: googleRefresh,
  revoke(ctx, tokens) { return googleRevoke(ctx, tokens, ['gmail', 'gcal']); },

  /** The verified calls: who is this, and does Google answer for the Business Profile accounts of that person. */
  async status(ctx) {
    if (missingScopes(ctx, [SCOPE.business]).length) return { ok: false, reason: 'scope_missing' };
    const me = await gapi(ctx, 'GET', GOOGLE_USERINFO);
    if (typeof me.sub !== 'string' || !isEmail(me.email)) return { ok: false, reason: 'account_unknown' };
    if (!domainAllowed(ctx, me.email)) return { ok: false, reason: 'wrong_account' };
    const list = await accounts(ctx);
    // Signed in fine, but this Google account manages no business profile: the wrong account for this connection.
    if (!list.length) return { ok: false, reason: 'no_business_account' };
    return { ok: true, account: { label: list[0].label || me.email.toLowerCase(), ref: me.sub }, scopes: grantedScopes(ctx) };
  },

  async health(ctx) {
    const me = await gapi(ctx, 'GET', GOOGLE_USERINFO);
    const known = String(ctx.connection?.account_ref || '');
    if (known && me.sub !== known) return { ok: false, reason: 'wrong_account', reauth: true };
    const list = await accounts(ctx);
    return list.length ? { ok: true, health: 'ok' } : { ok: false, reason: 'no_business_account' };
  },

  /**
   * Looks for reviews that are new or changed since the last run, across the locations of the first account.
   * Handed to the sink: the review's id, stars, time and whether it has a reply. The reviewer's name and the text
   * stay at Google and are read on demand with listReviews.
   */
  async sync(ctx) {
    const cursor = cursorOf(ctx), sink = sinkOf(ctx);
    const acct = (await accounts(ctx))[0];
    if (!acct) throw new ProviderError('no_business_account');
    const locations = (await adapter.actions.listLocations(ctx, acct.name)).locations.slice(0, 10);
    const since = (await cursor.get('reviews')) || '';
    let newest = since, found = 0;
    for (const loc of locations) {
      const r = await adapter.actions.listReviews(ctx, acct.name, loc.name, { pageSize: 50 });
      for (const rv of r.reviews) {
        if (!rv.updatedAt || rv.updatedAt <= since) continue;
        await sink({ kind: 'gbp.review', ref: `gbp:${rv.id}:${rv.updatedAt}`, data: { review: rv.name, location: loc.name, stars: rv.stars, updatedAt: rv.updatedAt, replied: !!rv.reply } });
        found += 1;
        if (rv.updatedAt > newest) newest = rv.updatedAt;
      }
    }
    if (newest && newest !== since) await cursor.set('reviews', newest);
    return { counts: { locations: locations.length, reviews: found } };
  },

  webhook: null,

  actions: {
    listAccounts: async (ctx) => ({ accounts: await accounts(ctx) }),

    /** account: "accounts/123". Returns { locations: [{ name, title, placeId, mapsUri, reviewLink }], next }. */
    async listLocations(ctx, account, { pageToken } = {}) {
      const r = await call(ctx, 'GET', `${INFO}/${check(account, ACCOUNT)}/locations`, { query: { readMask: 'name,title,metadata', pageSize: 100, pageToken } });
      return { locations: (Array.isArray(r.locations) ? r.locations : []).filter((l) => l && LOCATION.test(String(l.name || ''))).map(mapLocation), next: r.nextPageToken || null };
    },

    /** Returns { reviews: [{ id, name, stars, text, reviewer, createdAt, updatedAt, reply }], average, total, next }. */
    async listReviews(ctx, account, location, { pageSize = 20, pageToken } = {}) {
      const r = await call(ctx, 'GET', `${V4}/${check(account, ACCOUNT)}/${check(location, LOCATION)}/reviews`, { query: { pageSize: Math.max(1, Math.min(50, Number(pageSize) || 20)), orderBy: 'updateTime desc', pageToken } });
      const reviews = (Array.isArray(r.reviews) ? r.reviews : []).filter((v) => v && REVIEW.test(String(v.name || ''))).map((v) => ({
        id: String(v.reviewId || v.name.split('/').pop()), name: v.name, stars: STARS[v.starRating] || null, text: String(v.comment || ''), reviewer: String(v.reviewer?.displayName || ''),
        createdAt: v.createTime || null, updatedAt: v.updateTime || v.createTime || null, reply: v.reviewReply ? { text: String(v.reviewReply.comment || ''), updatedAt: v.reviewReply.updateTime || null } : null,
      }));
      return { reviews, average: Number(r.averageRating) || null, total: Number(r.totalReviewCount) || 0, next: r.nextPageToken || null };
    },

    /** review: the review's full name. PUT replaces the reply, so sending the same reply twice leaves one reply. */
    async replyToReview(ctx, review, text) {
      const comment = String(text || '').trim();
      if (!comment || comment.length > 4000) throw new ProviderError('reply_invalid');
      const r = await call(ctx, 'PUT', `${V4}/${check(review, REVIEW)}/reply`, { body: { comment } });
      return { replied: true, updatedAt: r.updateTime || null };
    },

    /** The address a client opens to write a review for a location ("locations/123" under the given account). */
    async reviewLink(ctx, account, location) {
      const r = await call(ctx, 'GET', `${INFO}/${check(location, LOCATION)}`, { query: { readMask: 'name,title,metadata' } });
      void account;
      const l = mapLocation(r);
      if (!l.reviewLink) throw new ProviderError('review_link_unavailable');
      return { location: l.name, reviewLink: l.reviewLink };
    },
  },
};

export default adapter;
