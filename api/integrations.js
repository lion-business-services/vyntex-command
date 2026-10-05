// /api/integrations/*: the connections of a company to outside services.
//
//   GET   /api/integrations?tenant=<id>                 every provider with its honest state and the exact reason
//   POST  /api/integrations/<provider>/connect          { tenant, returnTo? }
//                                                        OAuth providers:  -> { url }  (send the browser there)
//                                                        key providers:    -> { connection }  (verified now, or an error)
//   GET   /api/integrations/<provider>/callback?code&state    the provider's answer. Ends in a redirect to the screen.
//   POST  /api/integrations/<provider>/disconnect       { tenant }  revokes at the provider and deletes the tokens
//   POST  /api/integrations/<provider>/sync             { tenant, what? }  queues a sync
//   POST  /api/integrations/<provider>/test             { tenant }  a real call that says whether it works right now
//
// Nothing here ever returns a provider token, sealed or not. Connecting and disconnecting change credentials, so
// they need a fresh identity check. A provider is shown as connected only after it answered a real status call.
import { entry, ok, fail, readJson, HttpError, methodNotAllowed, isUuid } from './_lib/respond.js';
import { appOrigin } from './_lib/env.js';
import { guard, assertConfigured } from './_lib/guard.js';
import { requireSession } from './_lib/session.js';
import { limit, keyHash } from './_lib/ratelimit.js';
import { enqueue } from './_lib/jobs.js';
import { listFor, startConnect, finishConnect, discardState, disconnect, checkHealth, authorize, getAdapter } from './_lib/integrations/core.js';

const uidKey = (uid) => keyHash('uid', uid);
const RETURN_TO = /^\/[A-Za-z0-9/_?=&.-]{0,200}$/;

function tenantOf(value) {
  if (!isUuid(value)) throw new HttpError(400, 'tenant_required');
  return value.toLowerCase();
}

async function list(request) {
  const { session, cookies } = await guard(request);
  const tenant = tenantOf(new URL(request.url).searchParams.get('tenant'));
  try {
    return ok({ connections: await listFor(session, tenant) }, { cookies });
  } catch (e) {
    if (e instanceof HttpError) e.extra = { ...(e.extra || {}), cookies };
    throw e;
  }
}

async function connect(request, adapter) {
  const { session, cookies } = await guard(request, { stepUp: true });
  const body = await readJson(request, 2048);
  const tenant = tenantOf(body.tenant);
  await limit('integration.connect', uidKey(session.uid), 20, 600);
  const returnTo = typeof body.returnTo === 'string' && RETURN_TO.test(body.returnTo) && !body.returnTo.startsWith('//') ? body.returnTo : '/';
  try {
    const out = await startConnect({ adapter, session, tenantId: tenant, request, returnTo });
    return ok(out.url ? { url: out.url } : { connection: out.card }, { cookies });
  } catch (e) {
    if (e instanceof HttpError) e.extra = { ...(e.extra || {}), cookies };
    throw e;
  }
}

/** A redirect back to the Integrations screen with the outcome as two short codes in the query. */
function back(request, returnTo, provider, result, reason) {
  const u = new URL(RETURN_TO.test(returnTo || '') && !String(returnTo).startsWith('//') ? returnTo : '/', appOrigin(request));
  u.searchParams.set('integration', provider);
  u.searchParams.set('result', result);
  if (reason) u.searchParams.set('reason', reason);
  return new Response(null, { status: 302, headers: { location: u.toString(), 'cache-control': 'no-store' } });
}

async function callback(request, adapter) {
  assertConfigured();
  if (adapter.kind !== 'oauth') return fail(404, 'not_found');
  const url = new URL(request.url);
  // The person must still be signed in, in this browser. The session cookie is SameSite=Lax, which browsers send on
  // this kind of top-level return from the provider.
  let session;
  try { ({ session } = await requireSession(request)); } catch { return back(request, '/signin', adapter.id, 'error', 'not_signed_in'); }
  if (session.m !== 'ok') return back(request, '/signin', adapter.id, 'error', 'not_signed_in');
  // The provider reports a refusal on its consent screen with ?error=...: nothing to exchange.
  if (url.searchParams.get('error')) {
    // The state is still used up, so the same link cannot be replayed later with a code.
    await discardState(adapter, url.searchParams.get('state') || '');
    return back(request, '/', adapter.id, 'error', 'denied_at_provider');
  }
  const out = await finishConnect({ adapter, request, session, code: url.searchParams.get('code') || '', state: url.searchParams.get('state') || '', params: Object.fromEntries(url.searchParams) });
  return back(request, out.returnTo, adapter.id, out.result, out.reason);
}

async function remove(request, adapter) {
  const { session, cookies } = await guard(request, { stepUp: true });
  const body = await readJson(request, 2048);
  const tenant = tenantOf(body.tenant);
  try {
    const out = await disconnect({ adapter, session, tenantId: tenant, request });
    return ok({ removed: out.removed, revokedAtProvider: out.revoked }, { cookies });
  } catch (e) {
    if (e instanceof HttpError) e.extra = { ...(e.extra || {}), cookies };
    throw e;
  }
}

async function sync(request, adapter) {
  const { session, cookies } = await guard(request);
  const body = await readJson(request, 2048);
  const tenant = tenantOf(body.tenant);
  await limit('integration.sync', uidKey(session.uid), 30, 600);
  try { await authorize(session, tenant, 'sync'); } catch (e) { if (e instanceof HttpError) e.extra = { cookies }; throw e; }
  const what = typeof body.what === 'string' && /^[a-z][a-z0-9_.]{0,40}$/.test(body.what) ? body.what : 'all';
  // One sync per company, provider and minute: a second click inside the minute returns the job already queued.
  const job = await enqueue('integration.sync', { provider: adapter.id, what }, { tenant, idem: `${tenant}:${adapter.id}:manual:${Math.floor(Date.now() / 60000)}` });
  if (!job) return fail(503, 'queue_unavailable', {}, { cookies });
  return ok({ queued: true, job }, { cookies });
}

async function test(request, adapter) {
  const { session, cookies } = await guard(request);
  const body = await readJson(request, 2048);
  const tenant = tenantOf(body.tenant);
  await limit('integration.test', uidKey(session.uid), 30, 600);
  try { await authorize(session, tenant, 'test'); } catch (e) { if (e instanceof HttpError) e.extra = { cookies }; throw e; }
  const out = await checkHealth(adapter, tenant);
  return ok({ working: out.ok, health: out.health, reason: out.reason || null }, { cookies });
}

const ACTIONS = { connect: ['POST', connect], callback: ['GET', callback], disconnect: ['POST', remove], sync: ['POST', sync], test: ['POST', test] };

const handle = entry('integrations', async (request, path) => {
  if (path === '') return request.method === 'GET' ? list(request) : methodNotAllowed('GET');
  const [provider, action, extra] = path.split('/');
  if (extra || !Object.hasOwn(ACTIONS, action || '')) return fail(404, 'not_found');
  const [method, fn] = ACTIONS[action];
  if (request.method !== method) return methodNotAllowed(method);
  const adapter = await getAdapter(provider);
  // Unknown ids and providers that are not built yet answer the same way: there is nothing to act on.
  if (!adapter) return fail(404, 'unknown_provider');
  return fn(request, adapter);
});

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
