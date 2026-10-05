// Shared pieces for the Google adapter tests. No network: every call an adapter makes goes to a function in the test.
import { generateKeyPairSync, createSign, randomBytes } from 'node:crypto';
import { setTestEnv } from '../server/helpers.mjs';

export const TENANT = '11111111-1111-4111-8111-111111111111';
export const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
export const CLIENT_SECRET = 'gsecret_' + randomBytes(12).toString('hex');
export const CHANNEL_SECRET = randomBytes(32).toString('hex');
export const MAPS_KEY = 'mapskey_' + randomBytes(12).toString('hex');
/** A sentence a provider might put in an error. It must never come out of an adapter. */
export const LEAK = 'User private.person@example.com exceeded quota on project 991122';

const GOOGLE_NAMES = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_ALLOWED_DOMAINS', 'GOOGLE_GMAIL_APPROVED', 'GOOGLE_CALENDAR_APPROVED', 'GOOGLE_GBP_APPROVED', 'GOOGLE_PUBSUB_TOPIC',
  'GOOGLE_PUBSUB_AUDIENCE', 'GOOGLE_PUBSUB_SERVICE_ACCOUNT', 'GOOGLE_PUBSUB_SUBSCRIPTION', 'GOOGLE_CHANNEL_SECRET', 'GOOGLE_CALENDAR_NAME', 'GOOGLE_MAPS_API_KEY', 'GOOGLE_MAPS_DAILY_CAP'];
export function setGoogleEnv(extra = {}) {
  for (const k of GOOGLE_NAMES) delete process.env[k];
  return setTestEnv({ GOOGLE_CLIENT_ID: 'client-123.apps.example', GOOGLE_CLIENT_SECRET: CLIENT_SECRET, APP_ORIGIN: 'https://app.example.com', ...extra });
}

export const reply = (status, body, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
export const gerr = (status, reason, headers = {}) => reply(status, { error: { code: status, message: LEAK, errors: [{ reason, message: LEAK }], status: reason } }, headers);

/**
 * A stand-in for fetch. routes: [[method, test, answer]] where test is a string the address must contain or a RegExp,
 * and answer is a Response maker (url, init, nth call of this route). The first route that matches answers.
 * An address no route knows fails the test: nothing may reach the internet.
 */
export function mockFetch(routes) {
  const calls = [];
  const counts = new Map();
  const fetch = async (url, init = {}) => {
    const u = String(url), method = (init.method || 'GET').toUpperCase();
    calls.push({ url: u, method, init, body: typeof init.body === 'string' ? init.body : init.body ? Buffer.from(init.body).toString('utf8') : '' });
    for (let i = 0; i < routes.length; i += 1) {
      const [m, test, answer] = routes[i];
      if (m !== method || !(test instanceof RegExp ? test.test(u) : u.includes(test))) continue;
      const n = (counts.get(i) || 0) + 1; counts.set(i, n);
      return answer(new URL(u), init, n);
    }
    throw new Error(`unexpected call in a test: ${method} ${u.split('?')[0]}`);
  };
  return { fetch, calls, of: (part) => calls.filter((c) => c.url.includes(part)) };
}

export function memCursor(start = {}) {
  const data = new Map(Object.entries(start));
  return { data, get: async (k) => (data.has(k) ? data.get(k) : null), set: async (k, v) => { data.set(k, v); return true; } };
}
export function memLinks(rows = []) {
  const byLocal = new Map(rows.map((r) => [r.local_id, r]));
  return {
    rows: byLocal,
    get: async (id) => byLocal.get(id) || null,
    byEvent: async (eventId) => [...byLocal.values()].find((r) => r.event_id === eventId) || null,
    put: async (row) => { byLocal.set(row.local_id, { ...row }); return row; },
    remove: async (id) => { byLocal.delete(id); return true; },
  };
}
/** Keeps each change once by its ref, the way the inbound table does. */
export function memSink() {
  const items = new Map();
  const sink = async (item) => { if (!items.has(item.ref)) items.set(item.ref, item); return true; };
  return { sink, items, list: () => [...items.values()] };
}

export function ctxFor(adapter, { routes = [], tokens, connection = null, tenantId = TENANT, now = Date.now(), ...more } = {}) {
  const net = mockFetch(routes);
  const waits = [];
  const ctx = {
    provider: adapter.id, tenantId, tokens: tokens === undefined ? goodTokens(adapter) : tokens, connection,
    env: (name) => (typeof process.env[name] === 'string' ? process.env[name].trim() : ''), fetch: net.fetch, now: () => now,
    redirectUri: `https://app.example.com/api/integrations/${adapter.id}/callback`, sleep: async (ms) => { waits.push(ms); },
    ...more,
  };
  return { ctx, net, waits, calls: net.calls };
}
export const goodTokens = (adapter, extra = {}) => ({ access_token: 'ya29.test-access', refresh_token: '1//test-refresh', expires_at: new Date(Date.now() + 3600e3).toISOString(), scope: (adapter.scopes || []).join(' '), token_type: 'Bearer', ...extra });

/** A key pair standing in for Google's signing keys, with a signer for OpenID Connect tokens. */
export function googleSigner(kid = 'test-key-1') {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const sign = (claims, header = {}) => {
    const head = b64({ alg: 'RS256', kid, typ: 'JWT', ...header }), body = b64(claims);
    return `${head}.${body}.${createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url')}`;
  };
  return { kid, jwks: { keys: [jwk] }, sign, b64 };
}

/** True when a thrown or returned value carries any of the provider's text. */
export const leaks = (value) => { const s = value instanceof Error ? `${value.message} ${JSON.stringify(value)} ${value.code}` : JSON.stringify(value); return /private\.person|991122|exceeded quota/.test(s); };
