// Google sign-in for the adapters that connect through Google's consent screen (Gmail, Calendar, Business Profile).
// One Google Cloud project (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) serves all of them, but each adapter asks for its
// own scopes and keeps its own tokens: connecting Calendar never widens what the Gmail connection may do.
//
// Not proven against Google: no client exists in this build. The calls follow Google's published OAuth 2.0 and
// OpenID Connect endpoints and are tested with mocked responses.
import { authorizeUrl, tokenRequest, normaliseTokens, ProviderError } from '../oauth.js';

export const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_EXCHANGE = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE = 'https://oauth2.googleapis.com/revoke';
export const GOOGLE_USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';

/** Asked for by every Google connection, only to learn which account answered. */
export const IDENTITY_SCOPES = ['openid', 'email'];
export const SCOPE = {
  gmailSend: 'https://www.googleapis.com/auth/gmail.send',
  gmailRead: 'https://www.googleapis.com/auth/gmail.readonly',
  calendar: 'https://www.googleapis.com/auth/calendar.app.created',
  business: 'https://www.googleapis.com/auth/business.manage',
};
export const GOOGLE_ENV = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];

const EMAIL = /^[^\s@<>(),;:"\[\]]+@[^\s@<>(),;:"\[\]]+\.[A-Za-z]{2,}$/;
export const isEmail = (v) => typeof v === 'string' && v.length <= 254 && EMAIL.test(v);

/** GOOGLE_ALLOWED_DOMAINS: "example.com, other.example". Empty means any Google account may be connected. */
export function allowedDomains(ctx) {
  return String(ctx.env('GOOGLE_ALLOWED_DOMAINS') || '').toLowerCase().split(/[\s,]+/).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d));
}
export function domainAllowed(ctx, email) {
  const list = allowedDomains(ctx);
  return !list.length || list.includes(String(email).toLowerCase().split('@')[1] || '');
}

/**
 * The consent address. access_type=offline asks for a refresh token; prompt=consent makes Google send one every time
 * (without it a second connect of the same account returns none). include_granted_scopes is left off on purpose, so a
 * token carries the scopes of this connection only.
 */
export function googleAuthUrl(ctx, scopes) {
  const domains = allowedDomains(ctx);
  return authorizeUrl(GOOGLE_AUTH, {
    clientId: ctx.env('GOOGLE_CLIENT_ID'), redirect: ctx.redirectUri, scopes, state: ctx.state, challenge: ctx.challenge,
    // hd only narrows the account chooser. It is a hint, not a control: the real check is in status().
    extra: { access_type: 'offline', prompt: 'consent', hd: domains.length === 1 ? domains[0] : '' },
  });
}

export async function googleExchange(ctx, code) {
  const raw = await tokenRequest(ctx.fetch, GOOGLE_EXCHANGE, {
    grant_type: 'authorization_code', code, redirect_uri: ctx.redirectUri, code_verifier: ctx.verifier,
    client_id: ctx.env('GOOGLE_CLIENT_ID'), client_secret: ctx.env('GOOGLE_CLIENT_SECRET'),
  });
  const tokens = normaliseTokens(raw, {}, ctx.now());
  // Without a refresh token the connection would die within the hour. Better to say so at once.
  if (!tokens.refresh_token) throw new ProviderError('no_refresh_token');
  return tokens;
}

/** Google does not rotate refresh tokens: the answer carries a new access token and the old refresh token stays. */
export async function googleRefresh(ctx, tokens) {
  const raw = await tokenRequest(ctx.fetch, GOOGLE_EXCHANGE, {
    grant_type: 'refresh_token', refresh_token: tokens.refresh_token,
    client_id: ctx.env('GOOGLE_CLIENT_ID'), client_secret: ctx.env('GOOGLE_CLIENT_SECRET'),
  });
  return normaliseTokens(raw, tokens, ctx.now());
}

/**
 * Google revokes the whole grant of an account to this app, not one token. When the same account is also connected
 * for another Google service in this company, revoking here would silently break that one, so the grant is kept and
 * the caller is told (the framework then reports "not revoked at the provider" and still deletes the stored tokens).
 */
export async function googleRevoke(ctx, tokens, siblings = []) {
  const mine = String(ctx.connection?.account_label || '').toLowerCase();
  if (mine) {
    for (const id of siblings) {
      const other = ctx.sibling ? await ctx.sibling(id) : await siblingRow(ctx.tenantId, id);
      if (other && String(other.account_label || '').toLowerCase() === mine && ['connected', 'attention'].includes(other.state)) throw new ProviderError('shared_grant_kept');
    }
  }
  let res;
  try {
    res = await ctx.fetch(GOOGLE_REVOKE, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: tokens.refresh_token || tokens.access_token }).toString(), signal: AbortSignal.timeout(8000) });
  } catch {
    throw new ProviderError('provider_unreachable');
  }
  // 400 invalid_token: Google no longer knows the token, which is the outcome that was wanted.
  if (!res.ok && res.status !== 400) throw new ProviderError('revoke_failed', { status: res.status });
}
async function siblingRow(tenantId, provider) {
  const { getRow } = await import('../store.js');
  return getRow(tenantId, provider);
}

export const grantedScopes = (ctx) => String(ctx.tokens?.scope || '').split(/[\s,]+/).filter(Boolean);
/** Google lets a person untick single permissions on the consent screen. Returns the ones that are missing. */
export const missingScopes = (ctx, needed) => { const got = grantedScopes(ctx); return needed.filter((s) => !got.includes(s)); };
