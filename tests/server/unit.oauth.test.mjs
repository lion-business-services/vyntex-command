// OAuth helpers: signed single-use state, PKCE, the token request, and what an adapter may learn from a failure.
// No database: the stored half of "single use" is tested in the SQL tests and in the end-to-end tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTestEnv } from './helpers.mjs';

setTestEnv();
const O = await import('../../api/_lib/integrations/oauth.js');
const { pkceChallenge, sha256Hex } = await import('../../api/_lib/crypto.js');
const T1 = '11111111-1111-4111-8111-111111111111'; const T2 = '22222222-2222-4222-8222-222222222222';

test('a state is random, signed, and stored only as a hash', () => {
  const a = O.newState('mock', T1); const b = O.newState('mock', T1);
  assert.notEqual(a.state, b.state);
  assert.match(a.state, /^[A-Za-z0-9_-]{43}\.[0-9a-f]{40}$/);
  assert.equal(a.hash, sha256Hex(a.state));
  assert.notEqual(a.hash, a.state);
  assert.equal(O.stateHash(a.state), a.hash);
  assert.equal(O.stateMatches(a.state, 'mock', T1), true);
});

test('a tampered state is refused before the database is asked', () => {
  const s = O.newState('mock', T1).state;
  const [nonce, sig] = s.split('.');
  assert.equal(O.stateMatches(nonce.slice(0, -1) + (nonce.endsWith('A') ? 'B' : 'A') + '.' + sig, 'mock', T1), false, 'changed value');
  assert.equal(O.stateMatches(nonce + '.' + '0'.repeat(40), 'mock', T1), false, 'changed signature');
  assert.equal(O.stateMatches(s, 'other', T1), false, 'made for another provider');
  assert.equal(O.stateMatches(s, 'mock', T2), false, 'made for another company');
  for (const bad of ['', 'abc', nonce, nonce + '.zz', 'a'.repeat(300), null, undefined, 42, `${nonce}.${sig}.extra`]) assert.equal(O.stateHash(bad), null);
});

test('a state signed with another secret is refused', () => {
  const s = O.newState('mock', T1).state;
  const keep = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'a-different-secret-0123456789abcdefghij';
  assert.equal(O.stateMatches(s, 'mock', T1), false);
  process.env.SESSION_SECRET = keep;
});

test('PKCE: the challenge sent to the provider is the S256 of the verifier kept on the server', () => {
  const s = O.newState('mock', T1);
  assert.equal(s.challenge, pkceChallenge(s.verifier));
  assert.match(s.verifier, /^[A-Za-z0-9_-]{43,128}$/);
  const url = new URL(O.authorizeUrl('https://provider.example.com/authorize', { clientId: 'cid', redirect: 'https://app.example.com/api/integrations/mock/callback', scopes: ['a', 'b'], state: s.state, challenge: s.challenge }));
  assert.equal(url.searchParams.get('code_challenge'), s.challenge);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), s.state);
  assert.equal(url.searchParams.get('scope'), 'a b');
  assert.ok(!url.toString().includes(s.verifier), 'the verifier never goes to the browser');
});

test('the verifier is stored sealed, bound to the company and the provider', () => {
  const s = O.newState('mock', T1);
  const sealed = O.sealVerifier(s.verifier, 'mock', T1);
  assert.ok(!sealed.includes(s.verifier));
  assert.equal(O.openVerifier(sealed, 'mock', T1), s.verifier);
  assert.equal(O.openVerifier(sealed, 'mock', T2), null);
  assert.equal(O.openVerifier(sealed, 'other', T1), null);
});

test('the redirect address is built from the site address and the provider id', () => {
  assert.equal(O.redirectUri('https://command.example.com', 'mock'), 'https://command.example.com/api/integrations/mock/callback');
});

test('tokens are normalised to one shape, and a refresh token that was not rotated is kept', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const first = O.normaliseTokens({ access_token: 'a1', refresh_token: 'r1', expires_in: 3600, scope: 'x y' }, {}, now);
  assert.deepEqual(first, { access_token: 'a1', refresh_token: 'r1', expires_at: '2026-01-01T01:00:00.000Z', scope: 'x y', token_type: 'Bearer' });
  const kept = O.normaliseTokens({ access_token: 'a2', expires_in: 60 }, first, now);
  assert.equal(kept.refresh_token, 'r1'); assert.equal(kept.scope, 'x y');
  const rotated = O.normaliseTokens({ access_token: 'a3', refresh_token: 'r2' }, first, now);
  assert.equal(rotated.refresh_token, 'r2'); assert.equal(rotated.expires_at, null);
});

test('the token request sends a form, and a failure keeps a code, never the provider text', async () => {
  let seen;
  const okFetch = async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 10 }), { status: 200 }); };
  const out = await O.tokenRequest(okFetch, 'https://provider.example.com/token', { grant_type: 'authorization_code', code: 'c', code_verifier: 'v' });
  assert.equal(out.access_token, 'a');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(new URLSearchParams(seen.init.body).get('code_verifier'), 'v');

  const failing = (status, body) => async () => new Response(JSON.stringify(body), { status });
  const SECRET_TEXT = 'client secret sk_live_ABC123 is wrong for account 99';
  await assert.rejects(O.tokenRequest(failing(400, { error: 'invalid_grant', error_description: SECRET_TEXT }), 'https://p/token', {}),
    (e) => e instanceof O.ProviderError && e.code === 'invalid_grant' && e.reauth === true && !e.message.includes('sk_live'));
  await assert.rejects(O.tokenRequest(failing(401, { error: 'invalid_client', error_description: SECRET_TEXT }), 'https://p/token', {}),
    (e) => e.code === 'invalid_client' && e.reauth === false && !JSON.stringify(e).includes('sk_live'));
  await assert.rejects(O.tokenRequest(failing(500, { message: SECRET_TEXT }), 'https://p/token', {}), (e) => e.code === 'token_exchange_failed' && !e.message.includes('sk_live'));
  await assert.rejects(O.tokenRequest(failing(200, { no_token: true }), 'https://p/token', {}), (e) => e.code === 'token_exchange_failed');
  await assert.rejects(O.tokenRequest(async () => { throw new TypeError('fetch failed: ECONNREFUSED 10.0.0.5'); }, 'https://p/token', {}), (e) => e.code === 'provider_unreachable' && !e.message.includes('10.0.0.5'));
  await assert.rejects(O.tokenRequest(async () => new Response('<html>gateway error</html>', { status: 502 }), 'https://p/token', {}), (e) => e.code === 'token_exchange_failed');
});

test('a provider error code is always a short code', () => {
  assert.equal(new O.ProviderError('Something long and human, with spaces!').code, 'provider_error');
  assert.equal(new O.ProviderError('token_expired', { reauth: true }).reauth, true);
});
