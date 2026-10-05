// OAuth 2.0 helpers shared by every adapter that connects through a provider's consent screen.
// Authorization Code flow with PKCE and a signed, single-use state:
//
//   connect    the server makes a random state and a PKCE verifier. The state is signed (so a changed value is refused
//              before the database is even asked), its HASH is stored with the company, the provider and the person,
//              and the verifier is stored sealed. The browser only ever sees the provider address to go to.
//   callback   the provider sends the browser back with a code and the state. The state must verify, must be found
//              unused and unexpired (it is used up in the same statement that finds it), and must belong to the person
//              whose session makes the request. Then the code is exchanged SERVER SIDE, with the verifier and the
//              client secret. Tokens never travel through the browser.
import { need } from '../env.js';
import { deriveKey, hmacHex, randomToken, sameString, sha256Hex, pkcePair, sealToken, openToken } from '../crypto.js';

const stateKey = () => deriveKey(need('SESSION_SECRET'), 'vx-oauth-state-v1').key;
const sign = (value) => hmacHex(stateKey(), value).slice(0, 40);

/** A new state for one connect attempt: { state (goes to the provider), hash (goes to the database), verifier, challenge }. */
export function newState(provider, tenantId) {
  const nonce = randomToken(32);
  const state = `${nonce}.${sign(`${nonce}|${provider}|${tenantId}`)}`;
  return { state, hash: sha256Hex(state), ...pkcePair() };
}

/** Checks the shape and the signature of a returned state for a provider. Returns the hash to look up, or null. */
export function stateHash(state) {
  if (typeof state !== 'string' || state.length > 200 || !/^[A-Za-z0-9_-]{20,}\.[0-9a-f]{40}$/.test(state)) return null;
  return sha256Hex(state);
}
/** Second half of the check, once the stored row said which company the state was made for. */
export function stateMatches(state, provider, tenantId) {
  const i = state.lastIndexOf('.');
  return sameString(state.slice(i + 1), sign(`${state.slice(0, i)}|${provider}|${tenantId}`));
}

export const sealVerifier = (verifier, provider, tenantId) => sealToken({ verifier }, `pkce:${tenantId}:${provider}`);
export const openVerifier = (sealed, provider, tenantId) => openToken(sealed, `pkce:${tenantId}:${provider}`)?.verifier || null;

/** The address the provider sends the browser back to. Must be registered with the provider exactly as built here. */
export const redirectUri = (origin, provider) => `${origin}/api/integrations/${provider}/callback`;

/** Builds a provider authorization address with the standard parameters. `extra` adds provider-specific ones. */
export function authorizeUrl(base, { clientId, redirect, scopes, state, challenge, extra = {} }) {
  const u = new URL(base);
  const params = { response_type: 'code', client_id: clientId, redirect_uri: redirect, scope: scopes.join(' '), state, code_challenge: challenge, code_challenge_method: 'S256', ...extra };
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  return u.toString();
}

/** What every adapter returns from exchange() and refresh(): one shape, whatever the provider calls its fields. */
export function normaliseTokens(raw, previous = {}, now = Date.now()) {
  const expiresIn = Number(raw.expires_in);
  return {
    access_token: String(raw.access_token || ''),
    // A provider that rotates refresh tokens sends a new one; one that does not sends none, and the old one stays.
    refresh_token: String(raw.refresh_token || previous.refresh_token || ''),
    expires_at: Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(now + expiresIn * 1000).toISOString() : null,
    scope: typeof raw.scope === 'string' ? raw.scope : previous.scope || '',
    token_type: typeof raw.token_type === 'string' ? raw.token_type : 'Bearer',
  };
}

/** A thrown provider failure: a code for the connection row, and whether the person must connect again. */
export class ProviderError extends Error {
  constructor(code, { reauth = false, status = 0 } = {}) {
    super(code);
    this.code = /^[a-z][a-z0-9_.]{1,60}$/.test(code) ? code : 'provider_error';
    this.reauth = reauth;
    this.status = status;
  }
}

/**
 * POSTs a form to a provider's token endpoint (code exchange or refresh) and returns the parsed answer.
 * The provider's error text is not kept: only its status and, for the standard OAuth error names, the name.
 */
export async function tokenRequest(fetchFn, url, form, { basic } = {}) {
  const headers = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
  if (basic) headers.authorization = 'Basic ' + Buffer.from(`${basic.id}:${basic.secret}`).toString('base64');
  let res;
  try {
    res = await fetchFn(url, { method: 'POST', headers, body: new URLSearchParams(form).toString(), signal: AbortSignal.timeout(10000) });
  } catch {
    throw new ProviderError('provider_unreachable');
  }
  let data = {};
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok || !data || typeof data.access_token !== 'string' || !data.access_token) {
    const name = data && typeof data.error === 'string' ? data.error : '';
    // invalid_grant: the code or refresh token is no longer good. The person has to connect again.
    if (name === 'invalid_grant') throw new ProviderError('invalid_grant', { reauth: true, status: res.status });
    if (name === 'invalid_client') throw new ProviderError('invalid_client', { status: res.status });
    throw new ProviderError('token_exchange_failed', { status: res.status });
  }
  return data;
}
