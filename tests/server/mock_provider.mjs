// A stand-in OAuth provider for the server tests. It behaves like a careful provider would:
//   /authorize  remembers the PKCE challenge with the code it hands out, and sends the browser back with code and state
//   /token      checks the client secret, the redirect address, that the code is unused, and that
//               SHA-256(code_verifier) equals the challenge it was given. Refresh tokens rotate: an old one stops working.
//   /userinfo, /ping, /items   need a live access token
//   /revoke     makes the tokens stop working
// The tests read `calls` and change `settings` to make it misbehave on purpose.
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

export async function startMockProvider({ port = 4622, clientId = 'mock-client', clientSecret = 'mock-client-secret-value-1234' } = {}) {
  const codes = new Map();      // code -> { challenge, redirect, scope, used }
  const access = new Map();     // access token -> { sub, scope }
  const refresh = new Map();    // refresh token -> { sub, scope }
  const calls = [];
  const settings = { expiresIn: 3600, failUserinfo: false, sub: 'acct_mock_1', email: 'connected-account@example.com', rotate: true };
  const rand = (p) => p + randomBytes(18).toString('hex');
  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const issue = (sub, scope) => {
    const at = rand('mock-at-'); const rt = rand('mock-rt-');
    access.set(at, { sub, scope }); refresh.set(rt, { sub, scope, access: at });
    return { access_token: at, refresh_token: rt, expires_in: settings.expiresIn, scope, token_type: 'Bearer' };
  };
  const bearer = (req) => access.get(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, `http://127.0.0.1:${port}`);
    const chunks = []; for await (const c of req) chunks.push(c);
    const form = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
    calls.push({ method: req.method, path: u.pathname, form: { ...form }, query: Object.fromEntries(u.searchParams) });

    if (u.pathname === '/authorize') {
      const q = Object.fromEntries(u.searchParams);
      if (q.client_id !== clientId || q.response_type !== 'code' || q.code_challenge_method !== 'S256' || !q.code_challenge || !q.state || !q.redirect_uri) return json(res, 400, { error: 'invalid_request' });
      const code = rand('mock-code-');
      codes.set(code, { challenge: q.code_challenge, redirect: q.redirect_uri, scope: q.scope || '', used: false });
      const back = new URL(q.redirect_uri);
      back.searchParams.set('code', code); back.searchParams.set('state', q.state);
      res.writeHead(302, { location: back.toString() }); return res.end();
    }
    if (u.pathname === '/token' && req.method === 'POST') {
      if (form.client_id !== clientId || form.client_secret !== clientSecret) return json(res, 401, { error: 'invalid_client', error_description: 'secret detail that must never reach a browser: ' + clientSecret });
      if (form.grant_type === 'authorization_code') {
        const c = codes.get(form.code);
        const challenge = createHash('sha256').update(String(form.code_verifier || '')).digest('base64url');
        if (!c || c.used || c.redirect !== form.redirect_uri || c.challenge !== challenge) return json(res, 400, { error: 'invalid_grant', error_description: 'code, redirect or verifier mismatch' });
        c.used = true;
        return json(res, 200, issue(settings.sub, c.scope));
      }
      if (form.grant_type === 'refresh_token') {
        const r = refresh.get(form.refresh_token);
        if (!r) return json(res, 400, { error: 'invalid_grant' });
        if (settings.rotate) refresh.delete(form.refresh_token);
        const next = issue(r.sub, r.scope);
        if (!settings.rotate) { refresh.delete(next.refresh_token); delete next.refresh_token; }
        return json(res, 200, next);
      }
      return json(res, 400, { error: 'unsupported_grant_type' });
    }
    if (u.pathname === '/revoke' && req.method === 'POST') {
      // revoking a refresh token also ends the access token that came with it; other connections are untouched
      const pair = refresh.get(form.token);
      if (pair) access.delete(pair.access);
      refresh.delete(form.token); access.delete(form.token);
      return json(res, 200, {});
    }
    if (u.pathname === '/userinfo') {
      if (settings.failUserinfo) return json(res, 500, { error: 'internal', detail: 'stack trace of the provider' });
      const who = bearer(req);
      if (!who) return json(res, 401, { error: 'invalid_token' });
      return json(res, 200, { sub: who.sub, email: settings.email });
    }
    if (u.pathname === '/ping') return bearer(req) ? json(res, 200, { ok: true }) : json(res, 401, { error: 'invalid_token' });
    if (u.pathname === '/items') {
      if (!bearer(req)) return json(res, 401, { error: 'invalid_token' });
      const at = Number(u.searchParams.get('cursor') || 0);
      return json(res, 200, { items: [{ id: 'item-' + (at + 1) }, { id: 'item-' + (at + 2) }], next: String(at + 2) });
    }
    return json(res, 404, { error: 'not_found' });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return {
    base: `http://127.0.0.1:${port}`, clientId, clientSecret, calls, settings, access, refresh,
    /** Makes every access token handed out so far stop working (as if they expired at the provider). */
    expireAccessTokens() { access.clear(); },
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
