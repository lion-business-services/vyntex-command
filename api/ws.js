// /api/ws/*: the live workspace. Every call here is made with the signed-in person's own token, so the database
// decides what they may read and change (row level security and the capability checks inside the functions).
// This file adds what the database cannot see: the sealed session, the request's origin, limits on size and rate.
//
//   GET   load?tenant=<id>     the workspace data of one company                      -> { data }
//   POST  apply                { tenant, ops: Op[], idem }  changes, applied in one transaction, safe to repeat
//   POST  rpc/<name>           { tenant, args }  a protected operation from the allow-list below
//   POST  file/upload          the file is the request body; headers x-vx-tenant, x-vx-area, x-vx-filename
//   POST  file/url             { tenant, path }  a link to read a stored file, good for one minute
//   GET   file/get?k=<value>   what that link points at
//
// The browser never sees a Supabase address or token. A function that is not on the allow-list cannot be reached,
// whatever its name, and the functions that reveal, export or change who can do what also need a fresh identity check.
import { randomUUID } from 'node:crypto';
import { entry, ok, fail, readJson, readRaw, HttpError, methodNotAllowed, upstreamError, isUuid, isPlainObject, json } from './_lib/respond.js';
import { appOrigin, isTest, need } from './_lib/env.js';
import { userRpc, serviceRpc, storage } from './_lib/supabase.js';
import { guard } from './_lib/guard.js';
import { limit, keyHash } from './_lib/ratelimit.js';
import { securityEvent } from './_lib/audit.js';
import { randomToken, sha256Hex, sealWith, openWith, deriveKey } from './_lib/crypto.js';
import { sendSystemEmail, inviteEmail } from './_lib/mail.js';
import { RPCS } from './_lib/rpc-allowlist.js';

const MAX_APPLY_BYTES = 1024 * 1024;
const MAX_OPS = 500;
const MAX_FILE_BYTES = 4 * 1024 * 1024;   // a Vercel function accepts a body of about 4.5 MB
const BUCKET = 'workspace-files';
const LINK_SECONDS = 60;
const uidKey = (uid) => keyHash('uid', uid);

const ARG_NAME = /^p_[a-z0-9_]{1,40}$/;

function tenantOf(value) {
  if (!isUuid(value)) throw new HttpError(400, 'tenant_required');
  return value.toLowerCase();
}

// ---------------------------------------------------------------------------------------------------------------------
// load, apply
// ---------------------------------------------------------------------------------------------------------------------
async function load(request) {
  const { session, cookies } = await guard(request);
  const tenant = tenantOf(new URL(request.url).searchParams.get('tenant'));
  // vx_ws_load checks membership, the live session and the second sign-in step in SQL, then calls ws_load.
  const r = await userRpc(session.at, 'vx_ws_load', { p_tenant: tenant });
  if (!r.ok) { const e = upstreamError(r); e.extra = { cookies }; throw e; }
  return ok({ data: r.data }, { cookies });
}

async function apply(request) {
  const { session, cookies } = await guard(request);
  const body = await readJson(request, MAX_APPLY_BYTES);
  const tenant = tenantOf(body.tenant);
  if (typeof body.idem !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(body.idem)) return fail(400, 'idem_required', {}, { cookies });
  if (!Array.isArray(body.ops) || body.ops.length < 1 || body.ops.length > MAX_OPS) return fail(400, 'invalid_ops', {}, { cookies });
  for (const op of body.ops) {
    const shape = isPlainObject(op) && typeof op.c === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(op.c)
      && (op.op === 'upsert' || op.op === 'delete') && typeof op.id === 'string' && op.id.length > 0 && op.id.length <= 80
      && (op.op === 'delete' || isPlainObject(op.row));
    if (!shape) return fail(400, 'invalid_ops', {}, { cookies });
  }
  await limit('ws.apply', uidKey(session.uid), 600, 60);
  const r = await userRpc(session.at, 'vx_ws_apply', { p_tenant: tenant, p_ops: body.ops, p_idem: body.idem });
  if (!r.ok) { const e = upstreamError(r); e.extra = { cookies }; throw e; }
  // The gateway's own answer: { ok, applied, rejected: [{ id, c, reason }], server: { ... } }.
  return json(200, isPlainObject(r.data) ? r.data : { ok: false, error: 'upstream_error' }, { cookies });
}

// ---------------------------------------------------------------------------------------------------------------------
// rpc/<name>
// ---------------------------------------------------------------------------------------------------------------------
async function rpc(request, name) {
  const spec = Object.hasOwn(RPCS, name) ? RPCS[name] : null;
  // A name that is not on the list does not exist, whether or not the database has a function called that.
  if (!spec) return fail(404, 'unknown_operation');
  const { session, cookies } = await guard(request, { stepUp: spec.stepUp });
  const body = await readJson(request, 256 * 1024);
  const tenant = tenantOf(body.tenant);
  const args = body.args === undefined ? {} : body.args;
  if (!isPlainObject(args) || Object.keys(args).length > 30) return fail(400, 'invalid_args', {}, { cookies });
  await limit('ws.rpc', uidKey(session.uid), 240, 60);
  const withCookies = (e) => { e.extra = { ...(e.extra || {}), cookies }; return e; };

  if (spec.special === 'invite') return invite(request, session, cookies, tenant, args, body.idem);
  if (spec.special === 'office') {
    // Loaded only when one of these runs: the signing code brings the bundled domain rules, which every other call
    // to this file can do without.
    const { SPECIALS } = await import('./_lib/public/office.js');
    if (Object.keys(args).length > 10) return fail(400, 'invalid_args', {}, { cookies });
    await limit('office.' + name, uidKey(session.uid), 60, 600);
    const g = await userRpc(session.at, 'vx_guard', { p_tenant: tenant, p_stepup: !!spec.stepUp });
    if (!g.ok) throw withCookies(upstreamError(g));
    const res = await SPECIALS[name].run({ request, session, cookies, tenant, args, idem: body.idem });
    if (res.status >= 400) await securityEvent({ tenant, user: session.uid, kind: 'operation.refused', outcome: 'denied', request, meta: { name, status: res.status } });
    else if (spec.stepUp) await securityEvent({ tenant, user: session.uid, kind: 'operation.protected', outcome: 'ok', request, meta: { name } });
    return res;
  }

  for (const k of Object.keys(args)) if (!ARG_NAME.test(k)) return fail(400, 'invalid_args', {}, { cookies });
  const tenantArg = spec.tenantArg === undefined ? 'p_tenant' : spec.tenantArg;
  if (tenantArg && args[tenantArg] !== undefined && args[tenantArg] !== tenant) return fail(400, 'tenant_mismatch', {}, { cookies });

  // The database's own check for this company: member, live session, second step, and the fresh identity check when
  // the operation needs one. It runs here because not every function on the list can be assumed to call it itself.
  const g = await userRpc(session.at, 'vx_guard', { p_tenant: tenant, p_stepup: !!spec.stepUp });
  if (!g.ok) throw withCookies(upstreamError(g));

  const r = await userRpc(session.at, name, tenantArg ? { ...args, [tenantArg]: tenant } : args);
  if (!r.ok) {
    if (!spec.read) await securityEvent({ tenant, user: session.uid, kind: 'operation.refused', outcome: 'denied', request, meta: { name, sqlstate: r.sqlstate || String(r.status) } });
    throw withCookies(upstreamError(r));
  }
  if (spec.stepUp) await securityEvent({ tenant, user: session.uid, kind: 'operation.protected', outcome: 'ok', request, meta: { name } });
  return ok({ result: r.data ?? null }, { cookies });
}

/**
 * member_invite. The server makes the one-time token, stores only its hash (through invite_create, with the person's
 * token, so the database decides whether they may invite), and emails the link to the invited address. The inviter
 * never receives the link: accepting an invitation proves control of that mailbox.
 * args: { email, role, name?, lang?, workerId? }
 */
async function invite(request, session, cookies, tenant, args, idem) {
  await limit('invite.user', uidKey(session.uid), 30, 3600);
  const email = typeof args.email === 'string' ? args.email.trim().toLowerCase() : '';
  const role = typeof args.role === 'string' ? args.role : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 320) return fail(400, 'invalid', { reason: 'invalid_email' }, { cookies });
  if (!['owner', 'manager', 'staff', 'readonly', 'worker'].includes(role)) return fail(400, 'invalid', { reason: 'invalid_role' }, { cookies });

  // A double click or a repeated request with the same key gets the first answer and sends no second email.
  const idemKey = typeof idem === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(idem) ? idem : null;
  if (idemKey) {
    const b = await serviceRpc('idem_begin', { p_scope: 'invite', p_key: `${session.uid}:${idemKey}`, p_request_hash: sha256Hex(`${tenant}|${email}|${role}`), p_tenant: tenant });
    if (b.ok && b.data?.state === 'replay') return json(200, b.data.response, { cookies });
    if (b.ok && b.data?.state === 'in_progress') return fail(409, 'in_progress', {}, { cookies });
    if (b.ok && b.data?.state === 'mismatch') return fail(409, 'idem_mismatch', {}, { cookies });
  }
  const finish = async (status, answer) => {
    if (idemKey) await serviceRpc(status === 200 ? 'idem_finish' : 'idem_abort', status === 200 ? { p_scope: 'invite', p_key: `${session.uid}:${idemKey}`, p_response: answer } : { p_scope: 'invite', p_key: `${session.uid}:${idemKey}` });
    return json(status, answer, { cookies });
  };

  const token = randomToken(32);
  const created = await userRpc(session.at, 'invite_create', {
    p_tenant: tenant, p_email: email, p_role: role, p_name: typeof args.name === 'string' ? args.name.slice(0, 200) : '',
    p_token_hash: sha256Hex(token), p_ttl_hours: 72, p_worker: isUuid(args.workerId) ? args.workerId : null,
  });
  if (!created.ok) {
    if (idemKey) await serviceRpc('idem_abort', { p_scope: 'invite', p_key: `${session.uid}:${idemKey}` });
    const e = upstreamError(created); e.extra = { cookies }; throw e;
  }
  const inv = created.data;
  const link = `${appOrigin(request)}/invite/${token}`;
  const mail = inviteEmail({ lang: args.lang === 'es' ? 'es' : 'en', company: inv.company || '', inviter: inv.inviter || '', link, hours: 72 });
  const sent = await sendSystemEmail({ to: email, subject: mail.subject, text: mail.text, tenant, idem: 'invite:' + inv.id });
  if (!sent.delivered) {
    // No email went out, so nobody holds the link. An invitation nobody can accept is withdrawn rather than left open.
    // A test run is the one place where the link is returned instead, so the flow can be exercised without email.
    if (!isTest()) {
      await userRpc(session.at, 'invite_revoke', { p_tenant: tenant, p_invitation: inv.id });
      return finish(sent.reason === 'not_configured' ? 409 : 502, { ok: false, error: sent.reason === 'not_configured' ? 'email_not_configured' : 'delivery_failed' });
    }
    return finish(200, { ok: true, invitation: { id: inv.id, email: inv.email, role: inv.role, expiresAt: inv.expires_at }, delivery: 'test', testLink: link });
  }
  return finish(200, { ok: true, invitation: { id: inv.id, email: inv.email, role: inv.role, expiresAt: inv.expires_at }, delivery: 'sent' });
}

// ---------------------------------------------------------------------------------------------------------------------
// files
// ---------------------------------------------------------------------------------------------------------------------
const TYPES = {
  'application/pdf': { ext: 'pdf', magic: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  'image/png': { ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { ext: 'webp', magic: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: 'docx', magic: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: 'xlsx', magic: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 },
  'text/plain': { ext: 'txt', magic: (b) => isText(b) },
  'text/csv': { ext: 'csv', magic: (b) => isText(b) },
};
/** Valid UTF-8 with no control bytes other than tab, line feed and carriage return. */
function isText(b) {
  try { new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return false; }
  for (const byte of b) if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) return false;
  return true;
}

async function upload(request) {
  const { session, cookies } = await guard(request);
  const tenant = tenantOf(request.headers.get('x-vx-tenant'));
  const area = request.headers.get('x-vx-area') || 'documents';
  if (!/^[a-z][a-z0-9_-]{1,30}$/.test(area)) return fail(400, 'invalid_area', {}, { cookies });
  const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const spec = Object.hasOwn(TYPES, type) ? TYPES[type] : null;
  if (!spec) return fail(415, 'type_not_allowed', {}, { cookies });
  await limit('ws.upload', uidKey(session.uid), 60, 600);
  let bytes;
  try { bytes = await readRaw(request, MAX_FILE_BYTES); } catch { return fail(400, 'invalid_body', {}, { cookies }); }
  if (bytes === null) return fail(413, 'too_large', { maxBytes: MAX_FILE_BYTES }, { cookies });
  if (bytes.length === 0) return fail(400, 'empty_file', {}, { cookies });
  // The content must be what the type says: a renamed program is not a PDF.
  if (!spec.magic(bytes)) return fail(415, 'type_mismatch', {}, { cookies });
  let name = '';
  try { name = decodeURIComponent(request.headers.get('x-vx-filename') || ''); } catch { name = ''; }
  name = name.replace(/[\u0000-\u001f\u007f/\\]+/g, ' ').trim().slice(0, 200) || 'file.' + spec.ext;
  // The path is made here, never taken from the browser: the company folder, the area, a random name.
  const path = `${tenant}/${area}/${randomUUID()}.${spec.ext}`;
  const r = await storage.upload(session.at, BUCKET, path, bytes, type);
  if (!r.ok) { const e = upstreamError(r); e.extra = { cookies }; throw e; }
  return ok({ file: { name, size: bytes.length, mime: type, path } }, { cookies });
}

const linkKeys = () => [deriveKey(need('SESSION_SECRET'), 'vx-file-link-v1')];
const PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-z][a-z0-9_-]{1,30}\/[A-Za-z0-9][A-Za-z0-9._-]{4,120}$/;

async function fileUrl(request) {
  const { session, cookies } = await guard(request);
  const body = await readJson(request, 2048);
  const tenant = tenantOf(body.tenant);
  const path = typeof body.path === 'string' ? body.path : '';
  // The path must sit under the company named in the request. The database checks again that the person may read it.
  if (!PATH.test(path) || !path.startsWith(tenant + '/')) return fail(400, 'invalid_path', {}, { cookies });
  const g = await userRpc(session.at, 'vx_guard', { p_tenant: tenant, p_stepup: false });
  if (!g.ok) { const e = upstreamError(g); e.extra = { cookies }; throw e; }
  const expires = Math.floor(Date.now() / 1000) + LINK_SECONDS;
  // The link is sealed for this person: it names the file, when it stops working, and who may use it.
  const k = sealWith(linkKeys(), { p: path, u: session.uid, e: expires, n: typeof body.name === 'string' ? body.name.slice(0, 200) : '' }, 'vx-file', 'f1');
  return ok({ url: `/api/ws/file/get?k=${encodeURIComponent(k)}`, expiresAt: new Date(expires * 1000).toISOString() }, { cookies });
}

async function fileGet(request) {
  const { session, cookies } = await guard(request);
  const link = openWith(linkKeys(), new URL(request.url).searchParams.get('k') || '', 'vx-file', 'f1');
  if (!link || link.u !== session.uid || link.e < Math.floor(Date.now() / 1000) || !PATH.test(link.p)) return fail(403, 'link_invalid', {}, { cookies });
  // Read with the person's own token: the storage rules decide, one more time, whether they may have this file.
  const r = await storage.download(session.at, BUCKET, link.p);
  if (!r.ok) { const e = upstreamError(r); e.extra = { cookies }; throw e; }
  const ext = link.p.split('.').pop();
  const type = Object.entries(TYPES).find(([, v]) => v.ext === ext)?.[0] || 'application/octet-stream';
  const name = (link.n || 'file.' + ext).replace(/[^\w.\- ]+/g, '_');
  const h = new Headers({
    'content-type': type, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
    // Always a download, never shown inside this site: a stored file must not run as a page of this origin.
    'content-disposition': `attachment; filename="${name}"`,
    'content-security-policy': "default-src 'none'; sandbox",
  });
  for (const c of cookies) h.append('set-cookie', c);
  return new Response(r.response.body, { status: 200, headers: h });
}

// ---------------------------------------------------------------------------------------------------------------------
// routing
// ---------------------------------------------------------------------------------------------------------------------
const handle = entry('ws', async (request, path) => {
  const m = request.method;
  if (path === 'load') return m === 'GET' ? load(request) : methodNotAllowed('GET');
  if (path === 'apply') return m === 'POST' ? apply(request) : methodNotAllowed('POST');
  if (path.startsWith('rpc/')) return m === 'POST' ? rpc(request, path.slice(4)) : methodNotAllowed('POST');
  if (path === 'file/upload') return m === 'POST' ? upload(request) : methodNotAllowed('POST');
  if (path === 'file/url') return m === 'POST' ? fileUrl(request) : methodNotAllowed('POST');
  if (path === 'file/get') return m === 'GET' ? fileGet(request) : methodNotAllowed('GET');
  return fail(404, 'not_found');
});

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
