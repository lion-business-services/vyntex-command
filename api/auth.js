// /api/auth/*: sign-in, the second sign-in step, fresh identity checks, sign-out, invitations and passwords.
//
// There is NO sign-up route. An account exists only because a member with the "users" capability invited that
// address (invite/accept below), or because the platform operator invited the first owner of a company.
// The browser never talks to Supabase: it talks to these routes, and the Supabase tokens stay inside a sealed,
// HttpOnly cookie (api/_lib/session.js).
//
//   GET   session           who am I: companies, role, capabilities, assurance level, what sign-in still needs, csrf value
//   POST  signin            { email, password }
//   POST  mfa/enroll        start adding an authenticator app                -> { factorId, secret, uri, qr }
//   POST  mfa/confirm       { factorId, code }  finish adding it             -> { recoveryCodes } (shown once)
//   POST  mfa/verify        { code }            second step at sign-in
//   POST  mfa/recovery      { code }            a recovery code instead of the authenticator (removes the authenticator)
//   POST  stepup            { code } or { password }   fresh identity check, good for 5 minutes
//   POST  signout           this browser
//   POST  signout-all       every browser and device
//   POST  invite/check      { token }           what the invitation is for (no account needed)
//   POST  invite/accept     { token, password, name? }
//   POST  password/reset    { email }  or  { token, password }  (or { password } to retry after a refused password)
//   POST  password/update   { password }        needs a fresh identity check
//
// Every answer is { ok: true, ... } or { ok: false, error: <code> }. Wrong email or wrong password give the same
// answer, the same way, whether or not the account exists.
import { entry, ok, fail, readJson, HttpError, methodNotAllowed, upstreamError, log } from './_lib/respond.js';
import { appOrigin, deployId, envInt } from './_lib/env.js';
import { auth, admin, userRpc, serviceRpc } from './_lib/supabase.js';
import { openSession, newSession, adoptTokens, sessionCookies, clearCookies, requireSession, steppedUp, readCookies, STEPUP_SECONDS } from './_lib/session.js';
import { assertCsrf, csrfToken, csrfCookie, csrfCookieName } from './_lib/csrf.js';
import { guard, assertConfigured } from './_lib/guard.js';
import { limit, signinGate, signinResult, addressKey, accountKey, keyHash, ipHash, failLock, assertNotLocked, clearLock } from './_lib/ratelimit.js';
import { securityEvent } from './_lib/audit.js';
import { passwordProblem } from './_lib/password.js';
import { sha256Hex, randomToken, sealWith, openWith, deriveKey } from './_lib/crypto.js';
import { sendSystemEmail, resetEmail, emailConfigured } from './_lib/mail.js';
import { need, secureCookies } from './_lib/env.js';
import { randomBytes } from 'node:crypto';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CODE = /^\d{6}$/;
const nowS = () => Math.floor(Date.now() / 1000);
const uidKey = (uid) => keyHash('uid', uid);

// ---------------------------------------------------------------------------------------------------------------------
// Shared steps
// ---------------------------------------------------------------------------------------------------------------------

/** Asks the database, with the person's token, who they are and what each company requires of them. */
async function contextOf(session) {
  const r = await userRpc(session.at, 'auth_context', {});
  if (!r.ok) throw upstreamError(r);
  return r.data;
}

/**
 * Does any of the person's companies require the second step of them? The database answers per company
 * (security.mfaRoles plus the operator's required list). On the LBS deployment every office role needs it by default,
 * whatever the database says: the same rule is set in that database at setup (docs/SERVER.md), and this line makes
 * sure a setup step that was forgotten does not leave the door open.
 */
const mfaRequired = (ctx) => (ctx.memberships || []).some((m) => m.mfa_required || (deployId() === 'lbs' && m.role !== 'worker'));

/** What sign-in still needs: 'ok', 'verify' (enter a code) or 'enroll' (add an authenticator first). */
function mfaState(ctx) {
  if (ctx.aal === 'aal2') return 'ok';
  if (ctx.has_factor) return 'verify';
  return mfaRequired(ctx) ? 'enroll' : 'ok';
}

function applyContext(session, ctx) {
  session.m = mfaState(ctx);
  const idles = (ctx.memberships || []).map((m) => Number(m.idle_minutes)).filter((n) => Number.isFinite(n) && n > 0);
  session.idle = idles.length ? Math.min(...idles) : 30;
  return session;
}

/** Cookies for a session plus the csrf cookie that belongs to it. */
const cookiesFor = (session) => [...sessionCookies(session), csrfCookie(csrfToken(session.csrf))];

function publicSession(session, ctx) {
  return {
    signedIn: true,
    deploy: deployId(),
    user: { id: session.uid, email: session.email },
    aal: session.aal,
    mfa: { state: session.m, enrolled: !!ctx.has_factor, required: mfaRequired(ctx), recoveryCodesLeft: Number(ctx.recovery_codes_left) || 0 },
    stepUp: { fresh: steppedUp(session), expiresAt: steppedUp(session) ? new Date((session.su + STEPUP_SECONDS) * 1000).toISOString() : null },
    idleMinutes: session.idle,
    expiresAt: new Date((session.iat + envInt('SESSION_MAX_HOURS', 12, 1, 72) * 3600) * 1000).toISOString(),
    memberships: (ctx.memberships || []).map((m) => ({
      tenantId: m.tenant_id, slug: m.slug, name: m.name, industry: m.industry, plan: m.plan, status: m.status,
      role: m.role, memberId: m.member_id, workerId: m.worker_id, memberName: m.member_name,
      capabilities: m.capabilities || [], mfaRequired: !!m.mfa_required || (deployId() === 'lbs' && m.role !== 'worker'),
    })),
    csrf: csrfToken(session.csrf),
  };
}

/** The verified authenticator of the signed-in person, or null. Read from Supabase Auth with their own token. */
async function verifiedFactor(session) {
  const u = await auth.user(session.at);
  if (!u.ok) throw upstreamError(u);
  const factors = Array.isArray(u.data?.factors) ? u.data.factors : [];
  return { verified: factors.find((f) => f.status === 'verified' && f.factor_type === 'totp') || null, all: factors };
}

/** Records a passed fresh identity check in the session and in the database (the database keeps its own stamp). */
async function stampStepUp(session, method) {
  session.su = nowS();
  // Service role: the stamp says "the server verified this person just now". A person's own token must not be able to write it.
  const r = await serviceRpc('session_stepup_mark', { p_user: session.uid, p_session: session.sid, p_method: method });
  if (!r.ok) log('auth', 'stepup_stamp_not_stored', { status: r.status });
}

/** A wrong code or password in a step that takes guesses: count it, then answer. */
async function wrongGuess(bucket, session, request, kind, cookies) {
  const l = await failLock(bucket, uidKey(session.uid), 5, 900, 60, 1800);
  await securityEvent({ user: session.uid, kind, outcome: l.locked ? 'locked' : 'failed', request });
  if (l.locked) throw new HttpError(429, 'locked', { retryAfterSeconds: l.retryAfter }, { cookies, headers: { 'retry-after': String(l.retryAfter) } });
  throw new HttpError(401, 'invalid_code', {}, { cookies });
}

// ---------------------------------------------------------------------------------------------------------------------
// session
// ---------------------------------------------------------------------------------------------------------------------
async function getSession(request) {
  assertConfigured();
  const anonymous = (cookies = []) => {
    // Keep the visitor's csrf value when it is one of ours, otherwise hand out a new one.
    const existing = readCookies(request)[csrfCookieName()] || '';
    const token = /^[A-Za-z0-9_-]{20,}\.[0-9a-f]{32}$/.test(existing) && existing === csrfToken(existing.slice(0, existing.lastIndexOf('.'))) ? existing : csrfToken();
    return ok({ signedIn: false, deploy: deployId(), csrf: token }, { cookies: [...cookies, csrfCookie(token)] });
  };
  const opened = openSession(request);
  if (!opened.session) return anonymous(opened.why === 'none' ? [] : clearCookies());
  let session; let cookies;
  try { ({ session, cookies } = await requireSession(request)); } catch (e) {
    if (e instanceof HttpError && e.status === 401) return anonymous(clearCookies());
    throw e;
  }
  let ctx;
  try { ctx = await contextOf(session); } catch (e) {
    if (e instanceof HttpError && (e.status === 401 || e.status === 403)) return anonymous(clearCookies());
    throw e;
  }
  // Signed out everywhere, or no longer a member of any company: the session is over.
  if (!ctx.live || !(ctx.memberships || []).length) {
    await auth.logout(session.at, 'local');
    return anonymous(clearCookies());
  }
  const before = `${session.m}|${session.idle}`;
  applyContext(session, ctx);
  const out = cookies.length || before !== `${session.m}|${session.idle}` ? cookiesFor(session) : [csrfCookie(csrfToken(session.csrf))];
  return ok(publicSession(session, ctx), { cookies: out });
}

// ---------------------------------------------------------------------------------------------------------------------
// signin
// ---------------------------------------------------------------------------------------------------------------------

/** After Supabase Auth accepted a password: build the session, refuse an account that belongs to no company. */
async function establish(grant, request) {
  const session = newSession(grant);
  const ctx = await contextOf(session);
  if (!(ctx.memberships || []).length) {
    await auth.logout(session.at, 'local');
    return null;
  }
  applyContext(session, ctx);
  if (session.m === 'ok') await securityEvent({ user: session.uid, kind: 'signin.completed', outcome: 'ok', request });
  return { session, ctx };
}

async function signin(request) {
  assertConfigured();
  assertCsrf(request, null);
  const body = await readJson(request, 4096);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const addr = addressKey(request);
  // The limits run before the shape check, on whatever was typed, so probing with nonsense is limited too.
  const acct = accountKey(email.slice(0, 320) || 'empty');
  const gate = await signinGate(addr, acct);
  if (!gate.allowed) return fail(429, 'locked', { retryAfterSeconds: gate.retryAfter }, { headers: { 'retry-after': String(gate.retryAfter) } });

  const denied = async () => {
    const r = await signinResult(addr, acct, false, email, ipHash(request));
    return fail(401, 'invalid_credentials', r.locked ? { retryAfterSeconds: r.retryAfter } : {});
  };
  if (!EMAIL.test(email) || email.length > 320 || !password || password.length > 200) return denied();

  const grant = await auth.password(email, password);
  if (!grant.ok) {
    if (grant.status === 0 || grant.status >= 500) return fail(503, 'auth_unavailable');
    return denied();
  }
  const made = await establish(grant.data, request);
  // An account with no company is answered exactly like a wrong password.
  if (!made) return denied();
  await signinResult(addr, acct, true, email, ipHash(request));
  return ok({ mfa: made.session.m, csrf: csrfToken(made.session.csrf) }, { cookies: cookiesFor(made.session) });
}

// ---------------------------------------------------------------------------------------------------------------------
// mfa
// ---------------------------------------------------------------------------------------------------------------------
async function mfaEnroll(request) {
  const { session } = await guard(request, { pendingMfa: true });
  await limit('mfa.enroll', uidKey(session.uid), 10, 3600);
  const { verified, all } = await verifiedFactor(session);
  // One authenticator per person. With one in place, a password alone must never be enough to add another.
  if (verified) return fail(409, 'already_enrolled');
  for (const f of all) if (f.status !== 'verified') await auth.unenroll(session.at, f.id);
  const r = await auth.enrollTotp(session.at, 'Authenticator ' + randomToken(4), deployId() === 'lbs' ? 'LBS Command' : 'VYNTEX Command');
  if (!r.ok) throw upstreamError(r);
  await securityEvent({ user: session.uid, kind: 'mfa.enroll_started', outcome: 'info', request });
  return ok({ factorId: r.data.id, secret: r.data.totp?.secret || '', uri: r.data.totp?.uri || '', qr: r.data.totp?.qr_code || '' }, { cookies: cookiesFor(session) });
}

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newRecoveryCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const bytes = randomBytes(16);
    const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % 32]).join('');
    codes.push(chars.match(/.{4}/g).join('-'));
  }
  return codes;
}
const normaliseRecovery = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const recoveryHash = (uid, code) => sha256Hex(`${uid}:${normaliseRecovery(code)}`);

/** challenge + verify with Supabase Auth. On success the session holds the new token pair at aal2. */
async function verifyCode(session, factorId, code) {
  const ch = await auth.challenge(session.at, factorId);
  if (!ch.ok) return ch;
  const v = await auth.verify(session.at, factorId, ch.data.id, code);
  if (v.ok) adoptTokens(session, v.data);
  return v;
}

async function mfaConfirm(request) {
  const { session, cookies } = await guard(request, { pendingMfa: true });
  const body = await readJson(request, 2048);
  if (typeof body.factorId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.factorId) || !CODE.test(String(body.code || ''))) return fail(400, 'invalid_request');
  await assertNotLocked('mfa.code', uidKey(session.uid));
  const v = await verifyCode(session, body.factorId, String(body.code));
  if (!v.ok) {
    if (v.status === 0 || v.status >= 500) return fail(503, 'auth_unavailable');
    return wrongGuess('mfa.code', session, request, 'mfa.enroll_failed', cookies);
  }
  await clearLock('mfa.code', uidKey(session.uid));
  const codes = newRecoveryCodes();
  const stored = await userRpc(session.at, 'mfa_recovery_set', { p_hashes: codes.map((c) => recoveryHash(session.uid, c)) });
  if (!stored.ok) throw upstreamError(stored);
  session.m = 'ok';
  await stampStepUp(session, 'totp');
  await securityEvent({ user: session.uid, kind: 'mfa.enrolled', outcome: 'ok', request });
  await securityEvent({ user: session.uid, kind: 'signin.completed', outcome: 'ok', request });
  // Shown once. Only their hashes are stored.
  return ok({ mfa: 'ok', recoveryCodes: codes }, { cookies: cookiesFor(session) });
}

async function mfaVerify(request) {
  const { session, cookies } = await guard(request, { pendingMfa: true });
  const body = await readJson(request, 2048);
  if (!CODE.test(String(body.code || ''))) return fail(400, 'invalid_request');
  await assertNotLocked('mfa.code', uidKey(session.uid));
  const { verified } = await verifiedFactor(session);
  if (!verified) return fail(409, 'not_enrolled');
  const v = await verifyCode(session, verified.id, String(body.code));
  if (!v.ok) {
    if (v.status === 0 || v.status >= 500) return fail(503, 'auth_unavailable');
    return wrongGuess('mfa.code', session, request, 'mfa.verify_failed', cookies);
  }
  await clearLock('mfa.code', uidKey(session.uid));
  session.m = 'ok';
  await stampStepUp(session, 'totp');
  await securityEvent({ user: session.uid, kind: 'signin.completed', outcome: 'ok', request, meta: { step: 'totp' } });
  return ok({ mfa: 'ok' }, { cookies: cookiesFor(session) });
}

async function mfaRecovery(request) {
  const { session, cookies } = await guard(request, { pendingMfa: true });
  const body = await readJson(request, 2048);
  const code = normaliseRecovery(body.code);
  if (code.length !== 16) return fail(400, 'invalid_request');
  await assertNotLocked('mfa.recovery', uidKey(session.uid));
  // Service role: using a code up must be one atomic statement that the person cannot repeat or undo.
  const used = await serviceRpc('mfa_recovery_use', { p_user: session.uid, p_hash: recoveryHash(session.uid, code), p_ip_hash: ipHash(request) });
  if (!used.ok) throw upstreamError(used);
  if (used.data !== true) {
    const l = await failLock('mfa.recovery', uidKey(session.uid), 5, 900, 300, 3600);
    if (l.locked) return fail(429, 'locked', { retryAfterSeconds: l.retryAfter }, { cookies, headers: { 'retry-after': String(l.retryAfter) } });
    return fail(401, 'invalid_code', {}, { cookies });
  }
  // A recovery code cannot raise the session to aal2 (only an authenticator code can). What it does is remove the
  // lost authenticator, so the person can add a new one right away. Service role: they cannot produce a code to do it.
  const factors = await admin.listFactors(session.uid);
  if (!factors.ok) throw upstreamError(factors);
  for (const f of factors.data || []) {
    const del = await admin.deleteFactor(session.uid, f.id);
    if (!del.ok) throw upstreamError(del);
  }
  await serviceRpc('mfa_recovery_clear', { p_user: session.uid });
  await securityEvent({ user: session.uid, kind: 'mfa.removed', outcome: 'ok', request, meta: { by: 'recovery' } });
  const ctx = await contextOf(session);
  applyContext(session, ctx);
  if (session.m === 'ok') await securityEvent({ user: session.uid, kind: 'signin.completed', outcome: 'ok', request, meta: { step: 'recovery' } });
  return ok({ mfa: session.m }, { cookies: cookiesFor(session) });
}

// ---------------------------------------------------------------------------------------------------------------------
// stepup
// ---------------------------------------------------------------------------------------------------------------------
async function stepup(request) {
  const { session, cookies } = await guard(request);
  const body = await readJson(request, 4096);
  await assertNotLocked('stepup', uidKey(session.uid));
  const { verified } = await verifiedFactor(session);
  let method;
  if (verified) {
    // With an authenticator enrolled, the code is the proof. The password alone is not accepted.
    if (!CODE.test(String(body.code || ''))) return fail(400, 'code_required', {}, { cookies });
    const v = await verifyCode(session, verified.id, String(body.code));
    if (!v.ok) {
      if (v.status === 0 || v.status >= 500) return fail(503, 'auth_unavailable');
      return wrongGuess('stepup', session, request, 'stepup.failed', cookies);
    }
    method = 'totp';
  } else {
    if (typeof body.password !== 'string' || !body.password || body.password.length > 200) return fail(400, 'password_required', {}, { cookies });
    const again = await auth.password(session.email, body.password);
    if (!again.ok) {
      if (again.status === 0 || again.status >= 500) return fail(503, 'auth_unavailable');
      return wrongGuess('stepup', session, request, 'stepup.failed', cookies);
    }
    if (String(again.data.user?.id || '') !== session.uid) return fail(401, 'invalid_code', {}, { cookies });
    // The password check made a new Supabase session. It replaces the old one, which is signed out.
    const old = session.at;
    adoptTokens(session, again.data);
    await auth.logout(old, 'local');
    method = 'password';
  }
  await clearLock('stepup', uidKey(session.uid));
  await stampStepUp(session, method);
  return ok({ stepUp: { fresh: true, expiresAt: new Date((session.su + STEPUP_SECONDS) * 1000).toISOString() } }, { cookies: cookiesFor(session) });
}

// ---------------------------------------------------------------------------------------------------------------------
// signout
// ---------------------------------------------------------------------------------------------------------------------
async function signout(request, everywhere) {
  assertConfigured();
  const opened = openSession(request);
  assertCsrf(request, opened.session);
  if (!opened.session) return ok({}, { cookies: clearCookies() });
  const session = opened.session;
  if (everywhere) {
    await auth.logout(session.at, 'global');
    // Supabase revokes the refresh tokens. This mark makes the database refuse the access tokens already issued too.
    // Service role: a revocation must hold even if the person's own token is already useless.
    const r = await serviceRpc('session_revoke_user', { p_user: session.uid, p_reason: 'signout_all', p_ip_hash: ipHash(request) });
    if (!r.ok) throw upstreamError(r);
  } else {
    await auth.logout(session.at, 'local');
    await securityEvent({ user: session.uid, kind: 'signout', outcome: 'ok', request });
  }
  return ok({}, { cookies: clearCookies() });
}

// ---------------------------------------------------------------------------------------------------------------------
// invitations
// ---------------------------------------------------------------------------------------------------------------------
const TOKEN = /^[A-Za-z0-9_-]{20,200}$/;

async function inviteCheck(request) {
  assertConfigured();
  assertCsrf(request, null);
  await limit('invite.addr', addressKey(request), 20, 600);
  const body = await readJson(request, 2048);
  if (!TOKEN.test(String(body.token || ''))) return fail(400, 'invite_invalid');
  // Service role here and below: the person has no account yet, so there is no token of theirs to call with.
  const r = await serviceRpc('invite_peek', { p_token_hash: sha256Hex(body.token) });
  if (!r.ok) throw upstreamError(r);
  // Unknown, used, revoked and expired all look the same from outside.
  if (!r.data) return fail(400, 'invite_invalid');
  return ok({ company: r.data.company, emailHint: r.data.email_hint, expiresAt: r.data.expires_at });
}

async function inviteAccept(request) {
  assertConfigured();
  assertCsrf(request, null);
  await limit('invite.addr', addressKey(request), 20, 600);
  const body = await readJson(request, 4096);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!TOKEN.test(String(body.token || ''))) return fail(400, 'invite_invalid');
  const hash = sha256Hex(body.token);

  const claimed = await serviceRpc('invite_claim', { p_token_hash: hash });
  if (!claimed.ok) throw upstreamError(claimed);
  const inv = claimed.data;
  if (!inv) return fail(400, 'invite_invalid');
  const release = () => serviceRpc('invite_release', { p_token_hash: hash });

  let createdUser = null;
  try {
    // The password is judged before any account is made: a refused password leaves nothing behind.
    const weak = passwordProblem(password, inv.email);
    if (weak) { await release(); return fail(400, 'weak_password', { reason: weak }); }
    let userId;
    const created = await admin.createUser(inv.email, password);
    if (created.ok) {
      userId = created.data.id;
      createdUser = userId;
    } else if (created.code === 'email_exists' || created.code === 'user_already_exists' || created.status === 422) {
      // The address already has an account (a member of another company). The invitation must not become a way to
      // set a new password on it: the person proves the account is theirs with its existing password.
      const existing = await auth.password(inv.email, password);
      if (!existing.ok) { await release(); return fail(409, 'account_exists'); }
      userId = existing.data.user.id;
      await auth.logout(existing.data.access_token, 'local');
    } else {
      await release();
      return fail(created.status === 0 || created.status >= 500 ? 503 : 502, created.status === 0 || created.status >= 500 ? 'auth_unavailable' : 'upstream_error');
    }

    const done = await serviceRpc('invite_complete', { p_token_hash: hash, p_user: userId, p_name: typeof body.name === 'string' ? body.name.slice(0, 200) : null, p_ip_hash: ipHash(request) });
    if (!done.ok) {
      if (createdUser) await admin.deleteUser(createdUser);
      await release();
      return fail(400, 'invite_invalid');
    }
    const grant = await auth.password(inv.email, password);
    if (!grant.ok) return ok({ signedIn: false, slug: done.data.slug, tenantId: done.data.tenant_id });
    const made = await establish(grant.data, request);
    if (!made) return ok({ signedIn: false, slug: done.data.slug, tenantId: done.data.tenant_id });
    return ok({ signedIn: true, mfa: made.session.m, slug: done.data.slug, tenantId: done.data.tenant_id, csrf: csrfToken(made.session.csrf) }, { cookies: cookiesFor(made.session) });
  } catch (e) {
    if (createdUser) await admin.deleteUser(createdUser);
    await release();
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// passwords
// ---------------------------------------------------------------------------------------------------------------------
const resetCookieName = () => (secureCookies() ? '__Host-vx-reset' : 'vx-reset');
const resetKeys = () => [deriveKey(need('SESSION_SECRET'), 'vx-reset-v1')];
const resetCookie = (value, maxAge) => `${resetCookieName()}=${value}; Path=/; HttpOnly; SameSite=Lax${secureCookies() ? '; Secure' : ''}; Max-Age=${maxAge}`;

async function passwordReset(request) {
  assertConfigured();
  assertCsrf(request, null);
  const body = await readJson(request, 4096);
  const addr = addressKey(request);

  // Step 1: ask for a link. The answer is the same whether or not the address has an account.
  if (typeof body.email === 'string' && body.token === undefined && body.password === undefined) {
    await limit('reset.addr', addr, 5, 900);
    const email = body.email.trim().toLowerCase();
    const lang = body.lang === 'es' ? 'es' : 'en';
    if (EMAIL.test(email) && email.length <= 320 && emailConfigured()) {
      const perAccount = await limit('reset.acct', accountKey(email), 3, 3600).catch(() => null);
      if (perAccount) {
        // Service role: the person asking is not signed in. Supabase makes the one-time token; this site sends the email.
        const link = await admin.recoveryLink(email);
        const token = link.ok ? link.data?.hashed_token || link.data?.properties?.hashed_token : null;
        if (token) {
          // The token travels after "#", which browsers never send to a server, so it stays out of logs and referrers.
          const mail = resetEmail({ lang, link: `${appOrigin(request)}/reset-password#token=${encodeURIComponent(token)}` });
          await sendSystemEmail({ to: email, subject: mail.subject, text: mail.text, idem: 'reset:' + sha256Hex(token).slice(0, 32) });
          await securityEvent({ kind: 'password.reset_requested', outcome: 'info', request, subject: accountKey(email) });
        }
      }
    }
    return ok({ emailConfigured: emailConfigured() });
  }

  // Step 2: the link was opened and a new password typed.
  await limit('reset.confirm', addr, 10, 900);
  const password = typeof body.password === 'string' ? body.password : '';
  let pending = null;
  if (typeof body.token === 'string') {
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(body.token)) return fail(400, 'reset_invalid');
    const early = passwordProblem(password, '');
    if (early) return fail(400, 'weak_password', { reason: early });
    const v = await auth.verifyRecovery(body.token);
    if (!v.ok) return fail(v.status === 0 || v.status >= 500 ? 503 : 400, v.status === 0 || v.status >= 500 ? 'auth_unavailable' : 'reset_invalid');
    pending = { at: v.data.access_token, uid: String(v.data.user?.id || ''), email: String(v.data.user?.email || ''), exp: nowS() + 600 };
  } else {
    // A retry after a refused password: the one-time token is already used, so the recovery session waits in a sealed cookie.
    pending = openWith(resetKeys(), readCookies(request)[resetCookieName()] || '', 'vx-reset', 'r1');
    if (!pending || pending.exp < nowS()) return fail(400, 'reset_invalid', {}, { cookies: [resetCookie('', 0)] });
  }
  const weak = passwordProblem(password, pending.email);
  if (weak) return fail(400, 'weak_password', { reason: weak }, { cookies: [resetCookie(sealWith(resetKeys(), pending, 'vx-reset', 'r1'), 600)] });

  const changed = await auth.updateUser(pending.at, { password });
  if (!changed.ok) return fail(changed.status === 0 || changed.status >= 500 ? 503 : 400, changed.status === 0 || changed.status >= 500 ? 'auth_unavailable' : 'reset_invalid', {}, { cookies: [resetCookie('', 0)] });
  // A reset ends every session, including the one the link created. The person signs in again (with the second step, if they have one).
  await auth.logout(pending.at, 'global');
  await serviceRpc('session_revoke_user', { p_user: pending.uid, p_reason: 'password_reset', p_ip_hash: ipHash(request) });
  await securityEvent({ user: pending.uid, kind: 'password.reset', outcome: 'ok', request });
  return ok({}, { cookies: [resetCookie('', 0), ...clearCookies()] });
}

async function passwordUpdate(request) {
  const { session, cookies } = await guard(request, { stepUp: true });
  const body = await readJson(request, 4096);
  const weak = passwordProblem(body.password, session.email);
  if (weak) return fail(400, 'weak_password', { reason: weak }, { cookies });
  const r = await auth.updateUser(session.at, { password: body.password });
  if (!r.ok) throw upstreamError(r);
  // Every other browser of this person is signed out. This one stays.
  await auth.logout(session.at, 'others');
  await securityEvent({ user: session.uid, kind: 'password.changed', outcome: 'ok', request });
  return ok({}, { cookies: cookies.length ? cookies : cookiesFor(session) });
}

// ---------------------------------------------------------------------------------------------------------------------
// routing
// ---------------------------------------------------------------------------------------------------------------------
const POST_ROUTES = {
  'signin': signin,
  'mfa/enroll': mfaEnroll,
  'mfa/confirm': mfaConfirm,
  'mfa/verify': mfaVerify,
  'mfa/recovery': mfaRecovery,
  'stepup': stepup,
  'signout': (r) => signout(r, false),
  'signout-all': (r) => signout(r, true),
  'invite/check': inviteCheck,
  'invite/accept': inviteAccept,
  'password/reset': passwordReset,
  'password/update': passwordUpdate,
};

const handle = entry('auth', async (request, path) => {
  if (path === 'session') return request.method === 'GET' ? getSession(request) : methodNotAllowed('GET');
  const route = Object.hasOwn(POST_ROUTES, path) ? POST_ROUTES[path] : null;
  // Anything else does not exist. In particular there is no "signup", "register" or "users" route.
  if (!route) return fail(404, 'not_found');
  if (request.method !== 'POST') return methodNotAllowed('POST');
  return route(request);
});

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
