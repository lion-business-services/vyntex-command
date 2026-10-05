// OAuth test provider. Loaded ONLY when VX_ENV is "test" (providers/index.js), never in a deployment.
// It talks to a small stand-in server started by the tests (tests/server/mock_provider.mjs) and exists for two
// reasons: to prove the whole OAuth path of the framework (state, PKCE, exchange, verification, refresh, revoke,
// webhook) without a real provider, and to be the reference for the "oauth" kind of adapter.
//
// Settings (test run only): MOCK_OAUTH_BASE, MOCK_CLIENT_ID, MOCK_CLIENT_SECRET, MOCK_WEBHOOK_SECRET,
//                           MOCK_NEEDS_APPROVAL + MOCK_APPROVED (to exercise "pending_approval").
import { authorizeUrl, tokenRequest, normaliseTokens, ProviderError } from '../oauth.js';
import { verifyTimestamped, parseJson } from '../webhook.js';
import { env, has } from '../../env.js';

const base = (ctx) => ctx.env('MOCK_OAUTH_BASE').replace(/\/+$/, '');

async function get(ctx, path) {
  let res;
  try {
    res = await ctx.fetch(base(ctx) + path, { headers: { authorization: 'Bearer ' + ctx.tokens.access_token }, signal: AbortSignal.timeout(5000) });
  } catch {
    throw new ProviderError('provider_unreachable');
  }
  if (res.status === 401) throw new ProviderError('token_rejected', { reauth: true, status: 401 });
  if (!res.ok) throw new ProviderError('provider_error', { status: res.status });
  try { return await res.json(); } catch { throw new ProviderError('provider_error'); }
}

export default {
  id: 'mock',
  name: 'Test provider',
  kind: 'oauth',
  env: ['MOCK_OAUTH_BASE', 'MOCK_CLIENT_ID', 'MOCK_CLIENT_SECRET'],
  scopes: ['profile', 'items.read'],
  get approval() { return has('MOCK_NEEDS_APPROVAL') ? { needed: true, flag: 'MOCK_APPROVED', note: 'Test provider review.' } : null; },

  authUrl(ctx) {
    return authorizeUrl(base(ctx) + '/authorize', { clientId: ctx.env('MOCK_CLIENT_ID'), redirect: ctx.redirectUri, scopes: this.scopes, state: ctx.state, challenge: ctx.challenge });
  },

  /** The code is exchanged from the server with the client secret and the PKCE verifier. */
  async exchange(ctx, code) {
    const raw = await tokenRequest(ctx.fetch, base(ctx) + '/token', {
      grant_type: 'authorization_code', code, redirect_uri: ctx.redirectUri, code_verifier: ctx.verifier,
      client_id: ctx.env('MOCK_CLIENT_ID'), client_secret: ctx.env('MOCK_CLIENT_SECRET'),
    });
    return normaliseTokens(raw, {}, ctx.now());
  },

  async refresh(ctx, tokens) {
    const raw = await tokenRequest(ctx.fetch, base(ctx) + '/token', {
      grant_type: 'refresh_token', refresh_token: tokens.refresh_token,
      client_id: ctx.env('MOCK_CLIENT_ID'), client_secret: ctx.env('MOCK_CLIENT_SECRET'),
    });
    return normaliseTokens(raw, tokens, ctx.now());
  },

  async revoke(ctx, tokens) {
    const res = await ctx.fetch(base(ctx) + '/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: tokens.refresh_token || tokens.access_token }).toString() });
    if (!res.ok) throw new ProviderError('revoke_failed', { status: res.status });
  },

  /** The verified call: who does this token belong to? */
  async status(ctx) {
    const me = await get(ctx, '/userinfo');
    if (!me || typeof me.sub !== 'string') return { ok: false, reason: 'account_unknown' };
    return { ok: true, account: { label: String(me.email || me.sub), ref: me.sub }, scopes: String(ctx.tokens.scope || '').split(' ').filter(Boolean) };
  },

  async health(ctx) {
    await get(ctx, '/ping');
    return { ok: true, health: 'ok' };
  },

  /** Reads pages from where the last run stopped and remembers the new position. */
  async sync(ctx) {
    const cursor = (await ctx.cursor.get('items')) || '';
    const page = await get(ctx, '/items?cursor=' + encodeURIComponent(cursor));
    if (page.next) await ctx.cursor.set('items', String(page.next));
    return { counts: { items: Array.isArray(page.items) ? page.items.length : 0 } };
  },

  webhook: {
    verify(request, raw, ctx) {
      const v = verifyTimestamped(ctx.env('MOCK_WEBHOOK_SECRET'), request.headers.get('x-mock-signature'), raw, ctx.now());
      if (!v.ok) return v;
      const body = parseJson(raw);
      if (!body || typeof body.id !== 'string' || !body.id) return { ok: false, reason: 'bad_payload' };
      return { ok: true, eventId: body.id.slice(0, 200), type: String(body.type || 'event').slice(0, 60), accountRef: typeof body.account === 'string' ? body.account : null, redacted: { type: String(body.type || 'event').slice(0, 60), item: typeof body.item === 'string' ? body.item.slice(0, 80) : null } };
    },
    async handle(ctx, event) {
      // The test server can be told to make processing fail, to exercise retry and the dead letter state.
      if (env('MOCK_WEBHOOK_FAIL') === '1' || event.redacted?.type === 'always.fails') throw new ProviderError('mock_processing_failed');
      return { ok: true };
    },
  },

  actions: {},
};
