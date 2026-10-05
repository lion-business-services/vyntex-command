// Sign-in, invitations, the second sign-in step, fresh identity checks, sign-out and passwords, end to end:
// the real handlers of api/auth.js and api/ws.js, the local PostgreSQL with the real migrations of the server range,
// and the TEST DOUBLE of the Supabase HTTP surface (scripts/dev-supabase.mjs). Proved against the local stand-in,
// not against Supabase.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStack, assertNoLeak, secrets, ORIGIN } from './helpers.mjs';

let st; let co; let S;
const json = (v) => JSON.stringify(v);
const count = async (sqlText, data) => Number(await st.sql(`select '@@R@@' || (${sqlText})::text;`, data));
const supabase = async (path, { token, key, body } = {}) => {
  const k = key || process.env.SUPABASE_ANON_KEY;
  const r = await fetch(process.env.SUPABASE_URL + path, { method: 'POST', headers: { apikey: k, authorization: 'Bearer ' + (token || k), 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  return { status: r.status, json: await r.json().catch(() => null) };
};

before(async () => {
  st = await startStack();
  S = await import('../../api/_lib/session.js');
  co = await st.company();
});
after(async () => { await st.stop(); });

// ---------------------------------------------------------------------------------------------------------------------
test('a visitor gets a csrf value and nothing else', async () => {
  const b = st.browser();
  const r = await b.open();
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json).sort(), ['csrf', 'deploy', 'ok', 'signedIn']);
  assert.equal(r.json.signedIn, false);
  assert.equal(b.jar.get('vx-csrf'), r.json.csrf);
  const again = await b.open();
  assert.equal(again.json.csrf, r.json.csrf, 'the same visitor keeps the same value');
});

test('requests that change something are refused without the right Origin and csrf value', async () => {
  const b = st.browser(); await b.open();
  const body = { email: co.email, password: co.password };
  assert.deepEqual((await b.post('/api/auth/signin', body, { origin: false })).json, { ok: false, error: 'bad_origin' });
  assert.deepEqual((await b.post('/api/auth/signin', body, { origin: 'https://evil.example.com' })).json, { ok: false, error: 'bad_origin' });
  assert.deepEqual((await b.post('/api/auth/signin', body, { csrf: '' })).json, { ok: false, error: 'bad_csrf' });
  assert.deepEqual((await b.post('/api/auth/signin', body, { csrf: 'made-up-value.00000000000000000000000000000000' })).json, { ok: false, error: 'bad_csrf' });
  assert.equal(b.jar.has('vx'), false, 'none of them signed anybody in');
  // a signed-in browser: the csrf value of another visitor does not work
  const other = st.browser(); await other.open();
  const r = await co.owner.post('/api/auth/signout', {}, { csrf: other.jar.get('vx-csrf'), headers: { cookie: co.owner.cookieHeader().replace(/vx-csrf=[^;]+/, 'vx-csrf=' + other.jar.get('vx-csrf')) } });
  assert.deepEqual(r.json, { ok: false, error: 'bad_csrf' });
  assert.equal((await co.owner.get('/api/auth/session')).json.signedIn, true);
});

test('sign-in: the session lives in a sealed, HttpOnly cookie and the answer holds no token', async () => {
  const { browser, res } = await st.signIn(co.email, co.password);
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.json).sort(), ['csrf', 'mfa', 'ok']);
  assert.equal(res.json.mfa, 'ok');
  assert.match(browser.jar.get('vx'), /^s1\.[0-9a-f]{8}\./);
  const s = (await browser.get('/api/auth/session')).json;
  assert.equal(s.signedIn, true);
  assert.equal(s.user.email, co.email);
  assert.equal(s.aal, 'aal1');
  assert.equal(s.memberships.length, 1);
  assert.equal(s.memberships[0].tenantId, co.tenantId);
  assert.equal(s.memberships[0].role, 'owner');
  assert.ok(s.memberships[0].capabilities.includes('users') && s.memberships[0].capabilities.includes('integrations'));
  assert.equal(s.idleMinutes, 30);
  assert.ok(!json(s).includes('access_token') && !json(s).includes('refresh_token') && !/eyJ[A-Za-z0-9_-]{10,}\./.test(json(s)), 'no token of any kind');
});

test('no sign-up: every way in refuses an account that was not invited, and says nothing about which accounts exist', async () => {
  const usersBefore = await count('select count(*) from auth.users');
  const b = st.browser(); await b.open();
  // an address nobody has, a real address with the wrong password, and a real sign-in account that belongs to no company
  await supabase('/auth/v1/admin/users', { key: process.env.SUPABASE_SERVICE_ROLE_KEY, body: { email: 'orphan-account@example.com', password: 'Orphan-account-pw-77', email_confirm: true } });
  const answers = [];
  for (const [email, password] of [['nobody-has-this@example.com', 'Quiet-harbor-lamp-41'], [co.email, 'wrong-password-000'], ['orphan-account@example.com', 'Orphan-account-pw-77'], ['not an email', 'x'], ['', '']]) {
    const fresh = st.browser(); await fresh.open();
    const r = await fresh.post('/api/auth/signin', { email, password });
    answers.push(`${r.status} ${r.text}`);
    assert.equal(fresh.jar.has('vx'), false);
  }
  assert.deepEqual([...new Set(answers)], ['401 {"ok":false,"error":"invalid_credentials"}'], 'one answer for all of them');

  // the routes that need a session
  for (const path of ['mfa/enroll', 'mfa/confirm', 'mfa/verify', 'mfa/recovery', 'stepup', 'password/update']) {
    const r = await b.post('/api/auth/' + path, { code: '123456', factorId: '11111111-1111-4111-8111-111111111111', password: 'Quiet-harbor-lamp-41' });
    assert.deepEqual([r.status, r.json], [401, { ok: false, error: 'not_signed_in' }], path);
  }
  // the routes that work without one
  assert.deepEqual((await b.post('/api/auth/invite/accept', { token: 'x'.repeat(43), password: 'Quiet-harbor-lamp-41' })).json, { ok: false, error: 'invite_invalid' });
  assert.deepEqual((await b.post('/api/auth/invite/check', { token: 'x'.repeat(43) })).json, { ok: false, error: 'invite_invalid' });
  assert.deepEqual((await b.post('/api/auth/password/reset', { token: 'a'.repeat(56), password: 'Quiet-harbor-lamp-41' })).json, { ok: false, error: 'reset_invalid' });
  const mailBefore = st.mail.sent.length;
  const r1 = await b.post('/api/auth/password/reset', { email: 'nobody-has-this@example.com' });
  assert.deepEqual([r1.status, r1.json], [200, { ok: true, emailConfigured: true }]);
  assert.equal(st.mail.sent.length, mailBefore, 'no email goes to an address without an account');
  assert.deepEqual((await b.post('/api/auth/signout', {})).json, { ok: true });
  assert.equal((await b.post('/api/auth/signup', { email: 'new@example.com', password: 'Quiet-harbor-lamp-41' })).status, 404);
  // the stand-in for Supabase Auth has sign-ups switched off, as the real projects must (docs/SERVER.md)
  assert.equal((await supabase('/auth/v1/signup', { body: { email: 'new@example.com', password: 'Quiet-harbor-lamp-41' } })).status, 422);
  assert.equal(await count('select count(*) from auth.users'), usersBefore + 1, 'the only new account is the one this test made with the server key');
  assert.equal(await count(`select count(*) from public.tenant_members m join auth.users u on u.id = m.user_id where u.email = 'orphan-account@example.com'`), 0);
});

// ---------------------------------------------------------------------------------------------------------------------
test('sign-in lockout: five wrong passwords lock that address for that account, not the account for everyone', async () => {
  const c2 = await st.company();
  const attacker = st.browser({ address: '203.0.113.50' }); await attacker.open();
  for (let i = 1; i <= 4; i++) {
    const r = await attacker.post('/api/auth/signin', { email: c2.email, password: 'wrong-password-' + i });
    assert.deepEqual([r.status, r.json], [401, { ok: false, error: 'invalid_credentials' }], `attempt ${i}`);
  }
  const fifth = await attacker.post('/api/auth/signin', { email: c2.email, password: 'wrong-password-5' });
  assert.equal(fifth.status, 401);
  assert.equal(fifth.json.retryAfterSeconds, 60);
  const locked = await attacker.post('/api/auth/signin', { email: c2.email, password: c2.password });
  assert.equal(locked.status, 429, 'even the right password is refused from the locked address');
  assert.equal(locked.json.error, 'locked');
  assert.ok(Number(locked.headers.get('retry-after')) >= 1 && Number(locked.headers.get('retry-after')) <= 60);
  assert.equal(attacker.jar.has('vx'), false);

  const real = await st.signIn(c2.email, c2.password, { address: '198.51.100.200' });
  assert.equal(real.res.status, 200, 'the real person, from their own address, still gets in');

  assert.ok(await count(`select count(*) from app.security_events e where e.kind = 'signin.failed' and e.tenant_id = (select v from _in where k = 't')::uuid`, { t: c2.tenantId }) >= 5);
  assert.equal(await count(`select count(*) from app.security_events e where e.kind = 'signin.locked' and e.outcome = 'locked' and e.tenant_id = (select v from _in where k = 't')::uuid`, { t: c2.tenantId }), 1);
  assert.ok(await count(`select count(*) from public.audit_log a where a.action = 'signin.locked' and a.tenant_id = (select v from _in where k = 't')::uuid`, { t: c2.tenantId }) >= 1, 'the lockout is in the audit log');
  assert.equal(await count(`select count(*) from app.rate_locks where key_hash !~ '^[0-9a-f]{64}$'`), 0, 'the lock table holds hashes only');
  assert.equal(await count(`select count(*) from app.rate_limits where key_hash like '%203.0.113%'`), 0);

  // when the lock time has passed the address can try again
  await st.sql(`update app.rate_locks set locked_until = now() - interval '1 second' where locked_until is not null; select '@@R@@' || '1';`);
  assert.equal((await attacker.post('/api/auth/signin', { email: c2.email, password: c2.password })).status, 200);
});

test('sign-in rate limit: one address trying many accounts is stopped', async () => {
  const b = st.browser({ address: '203.0.113.99' }); await b.open();
  const statuses = [];
  for (let i = 0; i < 32; i++) statuses.push((await b.post('/api/auth/signin', { email: `spray-${i}@example.com`, password: 'Quiet-harbor-lamp-41' })).status);
  assert.deepEqual([...new Set(statuses.slice(0, 30))], [401]);
  assert.deepEqual(statuses.slice(30), [429, 429], 'attempts 31 and 32 are refused before Supabase Auth is even asked');
});

// ---------------------------------------------------------------------------------------------------------------------
test('invitations: created by a member with the capability, after a fresh identity check, delivered by email only', async () => {
  const email = `invited-${Date.now()}@example.com`;
  const args = { email, role: 'staff', name: 'Sample Invitee', lang: 'es' };
  const fresh = await st.signIn(co.email, co.password);
  const noStep = await fresh.browser.post('/api/ws/rpc/member_invite', { tenant: co.tenantId, args });
  assert.deepEqual([noStep.status, noStep.json], [403, { ok: false, error: 'stepup_required' }]);
  await st.stepUp(fresh.browser, co.password);
  const sentBefore = st.mail.sent.length;
  const made = await fresh.browser.post('/api/ws/rpc/member_invite', { tenant: co.tenantId, args, idem: 'invite-click-0001' });
  assert.equal(made.status, 200);
  assert.equal(made.json.delivery, 'sent');
  assert.deepEqual(Object.keys(made.json.invitation).sort(), ['email', 'expiresAt', 'id', 'role']);
  assert.ok(!made.text.includes('/invite/'), 'the inviter does not receive the link');
  assert.equal(st.mail.sent.length, sentBefore + 1);
  const mailed = st.mail.sent.at(-1);
  assert.deepEqual(mailed.to, [email]);
  assert.match(mailed.subject, /^Invitación a Sample Company/);
  assert.match(mailed.text, new RegExp(`${ORIGIN}/invite/[A-Za-z0-9_-]{43}`));
  const token = st.tokenOfInvite(st.linkFor(email));
  secrets.add(token);
  assert.equal(await count(`select count(*) from app.invitations where token_hash = (select v from _in where k = 'tok')`, { tok: token }), 0, 'the database holds the hash, not the token');

  // a double click with the same key: the first answer again, and no second email
  const again = await fresh.browser.post('/api/ws/rpc/member_invite', { tenant: co.tenantId, args, idem: 'invite-click-0001' });
  assert.deepEqual(again.json, made.json);
  assert.equal(st.mail.sent.length, sentBefore + 1);

  // the invited person
  const guest = st.browser(); await guest.open();
  const peek = await guest.post('/api/auth/invite/check', { token });
  assert.equal(peek.json.emailHint, 'i***@example.com');
  assert.match(peek.json.company, /^Sample Company/);
  const weak = await guest.post('/api/auth/invite/accept', { token, password: 'password1234' });
  assert.deepEqual([weak.status, weak.json], [400, { ok: false, error: 'weak_password', reason: 'common' }]);
  const withEmail = await guest.post('/api/auth/invite/accept', { token, password: email.split('@')[0] + '-2026' });
  assert.equal(withEmail.json.reason, 'contains_email');
  assert.equal(await count(`select count(*) from auth.users where email = (select v from _in where k = 'e')`, { e: email }), 0, 'a refused password leaves no account behind');
  const ok = await guest.post('/api/auth/invite/accept', { token, password: 'Maple-river-stone-88', name: 'Sample Invitee' });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.signedIn, true); assert.equal(ok.json.slug, co.slug);
  const s = (await guest.get('/api/auth/session')).json;
  assert.equal(s.memberships[0].role, 'staff');
  assert.ok(!s.memberships[0].capabilities.includes('users'));

  // single use
  const second = st.browser(); await second.open();
  assert.deepEqual((await second.post('/api/auth/invite/accept', { token, password: 'Another-long-password-9' })).json, { ok: false, error: 'invite_invalid' });
  assert.deepEqual((await second.post('/api/auth/invite/check', { token })).json, { ok: false, error: 'invite_invalid' });

  // a member without the capability cannot invite, fresh check or not
  await st.stepUp(guest, 'Maple-river-stone-88');
  const denied = await guest.post('/api/ws/rpc/member_invite', { tenant: co.tenantId, args: { email: 'x-' + email, role: 'staff' } });
  assert.deepEqual([denied.status, denied.json], [403, { ok: false, error: 'forbidden' }]);
  // nor into a company they do not belong to
  const other = await st.company();
  const cross = await fresh.browser.post('/api/ws/rpc/member_invite', { tenant: other.tenantId, args: { email: 'y-' + email, role: 'staff' } });
  assert.deepEqual([cross.status, cross.json], [403, { ok: false, error: 'forbidden' }]);
  assert.ok(await count(`select count(*) from app.security_events where kind = 'invite.accepted' and tenant_id = (select v from _in where k = 't')::uuid`, { t: co.tenantId }) >= 1);
});

test('invitations: expiry, revocation, and the two-minute claim', async () => {
  await st.stepUp(co.owner, co.password);
  const mk = async (email) => {
    const r = await co.owner.post('/api/ws/rpc/member_invite', { tenant: co.tenantId, args: { email, role: 'manager' } });
    assert.equal(r.status, 200, r.text);
    return { id: r.json.invitation.id, token: st.tokenOfInvite(st.linkFor(email)) };
  };
  const late = await mk(`late-${Date.now()}@example.com`);
  await st.sql(`update app.invitations set created_at = now() - interval '4 days', expires_at = now() - interval '1 minute' where id = (select v from _in where k = 'id')::uuid; select '@@R@@' || '1';`, { id: late.id });
  const g = st.browser(); await g.open();
  assert.deepEqual((await g.post('/api/auth/invite/accept', { token: late.token, password: 'Maple-river-stone-88' })).json, { ok: false, error: 'invite_invalid' }, 'expired');

  const gone = await mk(`revoked-${Date.now()}@example.com`);
  const rev = await co.owner.post('/api/ws/rpc/invite_revoke', { tenant: co.tenantId, args: { p_invitation: gone.id } });
  assert.deepEqual(rev.json, { ok: true, result: true });
  assert.deepEqual((await g.post('/api/auth/invite/accept', { token: gone.token, password: 'Maple-river-stone-88' })).json, { ok: false, error: 'invite_invalid' }, 'revoked');

  const list = await co.owner.post('/api/ws/rpc/invite_list', { tenant: co.tenantId, args: {} });
  const statuses = Object.fromEntries(list.json.result.map((i) => [i.id, i.status]));
  assert.equal(statuses[late.id], 'expired'); assert.equal(statuses[gone.id], 'revoked');
  assert.ok(!list.text.includes('token'), 'the list never shows a token or its hash');

  // two browsers at the same moment: only one can hold the invitation
  const both = await mk(`race-${Date.now()}@example.com`);
  const a = st.browser(); const b = st.browser(); await a.open(); await b.open();
  const [ra, rb] = await Promise.all([a.post('/api/auth/invite/accept', { token: both.token, password: 'Maple-river-stone-88' }), b.post('/api/auth/invite/accept', { token: both.token, password: 'Maple-river-stone-88' })]);
  assert.deepEqual([ra.status, rb.status].sort(), [200, 400]);
});

test('invitations: an address that already has an account must prove it with its own password', async () => {
  const other = await st.company();
  await st.stepUp(other.owner, other.password);
  // co.owner's address is invited into the other company
  const r = await other.owner.post('/api/ws/rpc/member_invite', { tenant: other.tenantId, args: { email: co.email, role: 'manager' } });
  assert.equal(r.status, 200);
  const token = st.tokenOfInvite(st.linkFor(co.email));
  const g = st.browser(); await g.open();
  const wrong = await g.post('/api/auth/invite/accept', { token, password: 'Attacker-chosen-password-1' });
  assert.deepEqual([wrong.status, wrong.json], [409, { ok: false, error: 'account_exists' }]);
  assert.equal((await st.signIn(co.email, co.password)).res.status, 200, 'the invitation did not change the existing password');
  assert.equal((await st.signIn(co.email, 'Attacker-chosen-password-1')).res.status, 401);
  const right = await g.post('/api/auth/invite/accept', { token, password: co.password });
  assert.equal(right.status, 200);
  const s = (await g.get('/api/auth/session')).json;
  assert.deepEqual(s.memberships.map((m) => m.role).sort(), ['manager', 'owner'], 'one account, two companies');
  // an active member cannot be invited again
  const dup = await other.owner.post('/api/ws/rpc/member_invite', { tenant: other.tenantId, args: { email: co.email, role: 'staff' } });
  assert.deepEqual([dup.status, dup.json], [409, { ok: false, error: 'conflict', reason: 'already_member' }]);
});

test('invitations: when email is not set up, no invitation is left open and the answer says why', async () => {
  await st.stepUp(co.owner, co.password);
  const keep = { key: process.env.RESEND_API_KEY, env: process.env.VX_ENV };
  const email = `noemail-${Date.now()}@example.com`;
  delete process.env.RESEND_API_KEY; process.env.VX_ENV = 'local';
  let r;
  try { r = await co.owner.post('/api/ws/rpc/member_invite', { tenant: co.tenantId, args: { email, role: 'staff' } }); } finally { process.env.RESEND_API_KEY = keep.key; process.env.VX_ENV = keep.env; }
  assert.deepEqual([r.status, r.json], [409, { ok: false, error: 'email_not_configured' }]);
  assert.equal(await count(`select count(*) from app.invitations where email = (select v from _in where k = 'e') and revoked_at is null`, { e: email }), 0);
  // the email provider failing has the same effect
  st.mail.status = 500;
  const failed = await co.owner.post('/api/ws/rpc/member_invite', { tenant: co.tenantId, args: { email, role: 'staff' } });
  st.mail.status = 200;
  assert.equal(failed.json.delivery, 'test', 'in a test run the link is returned so the flow can be exercised without email');
  process.env.VX_ENV = 'local';
  let failedLive;
  try { st.mail.status = 500; failedLive = await co.owner.post('/api/ws/rpc/member_invite', { tenant: co.tenantId, args: { email: 'b-' + email, role: 'staff' } }); } finally { st.mail.status = 200; process.env.VX_ENV = keep.env; }
  assert.deepEqual([failedLive.status, failedLive.json], [502, { ok: false, error: 'delivery_failed' }]);
});

// ---------------------------------------------------------------------------------------------------------------------
test('second sign-in step: enrol, recovery codes shown once, and a password alone is no longer enough', async () => {
  const c = await st.company();
  const b = c.owner;
  const start = await b.post('/api/auth/mfa/enroll', {});
  assert.equal(start.status, 200);
  assert.match(start.json.secret, /^[A-Z2-7]{32}$/);
  assert.match(start.json.uri, /^otpauth:\/\/totp\/VYNTEX%20Command:/);
  secrets.delete(start.json.secret);
  const wrong = await b.post('/api/auth/mfa/confirm', { factorId: start.json.factorId, code: '000000' });
  assert.deepEqual([wrong.status, wrong.json], [401, { ok: false, error: 'invalid_code' }]);
  assert.equal((await b.get('/api/auth/session')).json.mfa.enrolled, false, 'a wrong code enrols nothing');
  const done = await b.post('/api/auth/mfa/confirm', { factorId: start.json.factorId, code: st.totp(start.json.secret) });
  assert.equal(done.status, 200);
  assert.equal(done.json.recoveryCodes.length, 10);
  for (const code of done.json.recoveryCodes) assert.match(code, /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
  assert.equal(new Set(done.json.recoveryCodes).size, 10);
  assert.equal(await count(`select count(*) from app.mfa_recovery_codes where code_hash = any (string_to_array((select v from _in where k = 'codes'), ','))`, { codes: done.json.recoveryCodes.join(',') }), 0, 'only hashes are stored');
  let s = (await b.get('/api/auth/session')).json;
  assert.deepEqual([s.aal, s.mfa.state, s.mfa.enrolled, s.mfa.recoveryCodesLeft], ['aal2', 'ok', true, 10]);
  assert.equal((await b.post('/api/auth/mfa/enroll', {})).json.error, 'already_enrolled');

  // a new sign-in: the password gets as far as "enter your code" and no further
  const { browser: again, res } = await st.signIn(c.email, c.password);
  assert.equal(res.json.mfa, 'verify');
  const load = await again.get('/api/ws/load?tenant=' + c.tenantId);
  assert.deepEqual([load.status, load.json], [403, { ok: false, error: 'mfa_required', mfa: 'verify' }]);
  assert.equal((await again.post('/api/ws/apply', { tenant: c.tenantId, idem: 'idem-00000001', ops: [{ c: 'tasks', op: 'upsert', id: 't', row: {} }] })).json.error, 'mfa_required');
  assert.equal((await again.post('/api/auth/stepup', { password: c.password })).json.error, 'mfa_required');
  assert.equal((await again.post('/api/auth/mfa/enroll', {})).json.error, 'already_enrolled', 'and cannot add an authenticator of their own');
  assert.equal((await again.post('/api/auth/mfa/verify', { code: '000000' })).json.error, 'invalid_code');
  const v = await again.post('/api/auth/mfa/verify', { code: st.totp(start.json.secret) });
  assert.deepEqual(v.json, { ok: true, mfa: 'ok' });
  assert.equal((await again.get('/api/ws/load?tenant=' + c.tenantId)).status, 200);
  assert.equal((await again.get('/api/auth/session')).json.aal, 'aal2');

  // the database says the same on its own: the password-only token is refused by the SQL guard
  const raw = await supabase('/auth/v1/token?grant_type=password', { body: { email: c.email, password: c.password } });
  secrets.add(raw.json.access_token); secrets.add(raw.json.refresh_token);
  const direct = await supabase('/rest/v1/rpc/vx_ws_load', { token: raw.json.access_token, body: { p_tenant: c.tenantId } });
  assert.equal(direct.json.code, 'VX402');
  const direct2 = await supabase('/rest/v1/rpc/ws_load', { token: raw.json.access_token, body: { p_tenant: c.tenantId } });
  assert.equal(direct2.status, 200, '(the stand-in ws_load has no guard of its own, which is why api/ws.js calls vx_ws_load)');

  // with an authenticator, the fresh identity check is the code, not the password
  assert.equal((await again.post('/api/auth/stepup', { password: c.password })).json.error, 'code_required');
  const su = await again.post('/api/auth/stepup', { code: st.totp(start.json.secret) });
  assert.equal(su.json.stepUp.fresh, true);
  c.totpSecret = start.json.secret; c.recovery = done.json.recoveryCodes;

  // ---- recovery: a code replaces the lost authenticator, once ----
  const { browser: lost } = await st.signIn(c.email, c.password);
  assert.equal((await lost.post('/api/auth/mfa/recovery', { code: 'AAAA-BBBB-CCCC-DDDD' })).json.error, 'invalid_code');
  const rec = await lost.post('/api/auth/mfa/recovery', { code: c.recovery[3].toLowerCase() });
  assert.deepEqual(rec.json, { ok: true, mfa: 'ok' }, 'the authenticator is removed; this company does not require one, so the person is in');
  s = (await lost.get('/api/auth/session')).json;
  assert.deepEqual([s.mfa.enrolled, s.mfa.recoveryCodesLeft, s.aal], [false, 0, 'aal1']);
  const reuse = await st.signIn(c.email, c.password);
  assert.equal(reuse.res.json.mfa, 'ok');
  assert.equal((await reuse.browser.post('/api/auth/mfa/recovery', { code: c.recovery[3] })).json.error, 'invalid_code', 'the same code does not work twice');
  assert.equal((await reuse.browser.post('/api/auth/mfa/recovery', { code: c.recovery[4] })).json.error, 'invalid_code', 'and the other codes of the removed authenticator are gone');
  for (const kind of ['mfa.enrolled', 'mfa.recovery_used', 'mfa.removed', 'mfa.recovery_failed']) {
    assert.ok(await count(`select count(*) from app.security_events where kind = (select v from _in where k = 'k') and tenant_id = (select v from _in where k = 't')::uuid`, { k: kind, t: c.tenantId }) >= 1, kind);
  }
});

test('second sign-in step required by role: the workspace does not load below aal2, in the server and in SQL', async () => {
  const c = await st.company();
  const staff = await st.addMember(c, 'staff');
  await st.sql(`update public.tenants set config = '{"security": {"mfaRoles": ["owner", "manager", "staff"], "idleMinutes": 20}}' where id = (select v from _in where k = 't')::uuid; select '@@R@@' || '1';`, { t: c.tenantId });

  // the browser that was already signed in: the server still thinks "ok", the database refuses
  const stale = await staff.browser.get('/api/ws/load?tenant=' + c.tenantId);
  assert.deepEqual([stale.status, stale.json], [403, { ok: false, error: 'mfa_required' }]);
  const s0 = (await staff.browser.get('/api/auth/session')).json;
  assert.deepEqual([s0.mfa.state, s0.mfa.required, s0.idleMinutes], ['enroll', true, 20], 'the session answer now says what is needed');

  const { browser: b, res } = await st.signIn(staff.email, staff.password);
  assert.equal(res.json.mfa, 'enroll');
  assert.deepEqual((await b.get('/api/ws/load?tenant=' + c.tenantId)).json, { ok: false, error: 'mfa_required', mfa: 'enroll' });
  assert.equal((await b.post('/api/ws/rpc/lead_assign_next', { tenant: c.tenantId, args: { p_lead: '11111111-1111-4111-8111-111111111111' } })).json.error, 'mfa_required');
  assert.equal((await b.get('/api/integrations?tenant=' + c.tenantId)).json.error, 'mfa_required');
  const e = await b.post('/api/auth/mfa/enroll', {});
  const done = await b.post('/api/auth/mfa/confirm', { factorId: e.json.factorId, code: st.totp(e.json.secret) });
  assert.equal(done.json.mfa, 'ok');
  assert.equal((await b.get('/api/ws/load?tenant=' + c.tenantId)).status, 200);

  // five wrong codes lock the step for a while
  const { browser: guesser } = await st.signIn(staff.email, staff.password);
  const answers = [];
  for (let i = 0; i < 6; i++) answers.push((await guesser.post('/api/auth/mfa/verify', { code: String(100000 + i) })).status);
  assert.deepEqual(answers, [401, 401, 401, 401, 429, 429]);
  assert.equal((await guesser.post('/api/auth/mfa/verify', { code: st.totp(e.json.secret) })).status, 429, 'while locked, even the right code waits');
});

test('LBS deployment: every office role needs the second step by default', async () => {
  const c = await st.company();
  process.env.VX_DEPLOY = 'lbs';
  try {
    const { browser: b, res } = await st.signIn(c.email, c.password);
    assert.equal(res.json.mfa, 'enroll');
    const s = (await b.get('/api/auth/session')).json;
    assert.deepEqual([s.deploy, s.mfa.state, s.mfa.required, s.memberships[0].mfaRequired], ['lbs', 'enroll', true, true]);
    assert.deepEqual((await b.get('/api/ws/load?tenant=' + c.tenantId)).json, { ok: false, error: 'mfa_required', mfa: 'enroll' });
    const e = await b.post('/api/auth/mfa/enroll', {});
    assert.match(e.json.uri, /^otpauth:\/\/totp\/LBS%20Command:/);
    assert.equal((await b.post('/api/auth/mfa/confirm', { factorId: e.json.factorId, code: st.totp(e.json.secret) })).json.mfa, 'ok');
    assert.equal((await b.get('/api/ws/load?tenant=' + c.tenantId)).status, 200);
  } finally { process.env.VX_DEPLOY = 'vyntex'; }
  // the same rule in the database is the operator's required list (set at setup on the LBS database)
  const c2 = await st.company();
  await st.sql(`update app.server_settings set value = '{"mfaRoles": ["owner", "manager", "staff", "readonly"], "idleMinutes": 30}' where key = 'security.required'; select '@@R@@' || '1';`);
  try {
    const r = await c2.owner.get('/api/ws/load?tenant=' + c2.tenantId);
    assert.deepEqual([r.status, r.json], [403, { ok: false, error: 'mfa_required' }], 'refused by SQL even though this server run is not the LBS deployment');
  } finally { await st.sql(`update app.server_settings set value = '{"mfaRoles": []}' where key = 'security.required'; select '@@R@@' || '1';`); }
});

// ---------------------------------------------------------------------------------------------------------------------
test('fresh identity check: needed for protected operations, good for five minutes, enforced twice', async () => {
  const c = await st.company();
  const b = c.owner;
  const client = '11111111-1111-4111-8111-111111111111';
  const reveal = () => b.post('/api/ws/rpc/vault_reveal', { tenant: c.tenantId, args: { p_client: client } });
  assert.deepEqual((await reveal()).json, { ok: false, error: 'stepup_required' });
  assert.deepEqual((await b.post('/api/auth/password/update', { password: 'Another-long-password-9' })).json, { ok: false, error: 'stepup_required' });
  assert.equal((await b.post('/api/auth/stepup', { password: 'wrong-password-000' })).json.error, 'invalid_code');
  assert.equal((await reveal()).json.error, 'stepup_required', 'a failed check stamps nothing');
  const su = await st.stepUp(b, c.password);
  assert.equal(su.status, 200);
  assert.ok(Date.parse(su.json.stepUp.expiresAt) - Date.now() <= 300_000 && Date.parse(su.json.stepUp.expiresAt) - Date.now() > 290_000);
  assert.equal((await reveal()).status, 200);
  assert.equal((await b.get('/api/auth/session')).json.stepUp.fresh, true);

  // the database's own stamp is older than five minutes, the cookie's is not: the database refuses
  await st.sql(`update app.session_stamps set stepup_at = now() - interval '6 minutes'; select '@@R@@' || '1';`);
  assert.deepEqual((await reveal()).json, { ok: false, error: 'stepup_required' });
  await st.stepUp(b, c.password);
  assert.equal((await reveal()).status, 200);

  // the cookie's stamp is older than five minutes, the database's is not: the server refuses
  const { session } = S.openSession(new Request(ORIGIN + '/x', { headers: { cookie: b.cookieHeader() } }));
  session.su = Math.floor(Date.now() / 1000) - 301;
  for (const cookie of S.sessionCookies(session)) { const [pair] = cookie.split(';'); const i = pair.indexOf('='); if (pair.slice(i + 1)) b.jar.set(pair.slice(0, i), pair.slice(i + 1)); }
  assert.deepEqual((await reveal()).json, { ok: false, error: 'stepup_required' });
  assert.equal((await b.get('/api/auth/session')).json.stepUp.fresh, false);

  // five wrong passwords lock the check
  const answers = [];
  for (let i = 0; i < 6; i++) answers.push((await b.post('/api/auth/stepup', { password: 'wrong-password-' + i })).status);
  assert.deepEqual(answers, [401, 401, 401, 401, 429, 429], 'the fifth wrong password in a row locks it (a passed check had cleared the earlier failure)');
  assert.ok(await count(`select count(*) from app.security_events where kind = 'stepup.failed' and tenant_id = (select v from _in where k = 't')::uuid`, { t: c.tenantId }) >= 5);
});

// ---------------------------------------------------------------------------------------------------------------------
test('sign-out ends the session on the server, not just in the browser', async () => {
  const c = await st.company();
  const { browser: b } = await st.signIn(c.email, c.password);
  const stolen = b.cookieHeader();
  assert.equal((await b.get('/api/ws/load?tenant=' + c.tenantId)).status, 200);
  const out = await b.post('/api/auth/signout', {});
  assert.deepEqual(out.json, { ok: true });
  assert.equal(b.jar.has('vx'), false);
  // someone who copied the cookie before sign-out
  const thief = st.browser();
  const withStolen = (url) => thief.get(url, { headers: { cookie: stolen } });
  assert.deepEqual((await withStolen('/api/ws/load?tenant=' + c.tenantId)).json, { ok: false, error: 'session_revoked' });
  assert.equal((await withStolen('/api/auth/session')).json.signedIn, false);
});

test('sign out everywhere: every other browser of the person is out at once', async () => {
  const c = await st.company();
  const one = (await st.signIn(c.email, c.password)).browser;
  const two = (await st.signIn(c.email, c.password)).browser;
  assert.equal((await two.get('/api/ws/load?tenant=' + c.tenantId)).status, 200);
  assert.deepEqual((await one.post('/api/auth/signout-all', {})).json, { ok: true });
  assert.deepEqual((await two.get('/api/ws/load?tenant=' + c.tenantId)).json, { ok: false, error: 'session_revoked' });
  assert.equal((await two.get('/api/auth/session')).json.signedIn, false);
  assert.equal((await c.owner.get('/api/auth/session')).json.signedIn, false, 'including the browser the account was created in');
  assert.equal((await st.signIn(c.email, c.password)).res.status, 200, 'the person can sign in again');
  assert.ok(await count(`select count(*) from app.security_events where kind = 'session.revoked_all' and tenant_id = (select v from _in where k = 't')::uuid`, { t: c.tenantId }) >= 1);
});

test('an owner ends the sessions of a member', async () => {
  const c = await st.company();
  const staff = await st.addMember(c, 'staff');
  assert.equal((await staff.browser.get('/api/ws/load?tenant=' + c.tenantId)).status, 200);
  const memberId = (await staff.browser.get('/api/auth/session')).json.memberships[0].memberId;
  await new Promise((r) => setTimeout(r, 1100));   // tokens carry whole seconds: the mark must be later than the token
  await st.stepUp(c.owner, c.password);
  const r = await c.owner.post('/api/ws/rpc/session_revoke_member', { tenant: c.tenantId, args: { p_member: memberId } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual((await staff.browser.get('/api/ws/load?tenant=' + c.tenantId)).json, { ok: false, error: 'session_revoked' });
  const denied = await staff.browser.post('/api/ws/rpc/session_revoke_member', { tenant: c.tenantId, args: { p_member: memberId } });
  assert.ok([401, 403].includes(denied.status));
});

test('idle timeout and absolute lifetime are enforced by the server', async () => {
  const c = await st.company();
  const { browser: b } = await st.signIn(c.email, c.password);
  const reseal = (change) => {
    const { session } = S.openSession(new Request(ORIGIN + '/x', { headers: { cookie: b.cookieHeader() } }));
    change(session);
    for (const cookie of S.sessionCookies(session)) { const [pair] = cookie.split(';'); const i = pair.indexOf('='); if (pair.slice(i + 1)) b.jar.set(pair.slice(0, i), pair.slice(i + 1)); }
  };
  const now = Math.floor(Date.now() / 1000);
  reseal((s) => { s.last = now - 31 * 60; });
  const idle = await b.get('/api/ws/load?tenant=' + c.tenantId);
  assert.deepEqual([idle.status, idle.json], [401, { ok: false, error: 'session_idle' }]);
  assert.equal(b.jar.has('vx'), false, 'the cookie is cleared');

  const again = (await st.signIn(c.email, c.password)).browser;
  Object.assign(b, { jar: again.jar });
  reseal((s) => { s.iat = now - 12 * 3600 - 10; });
  assert.deepEqual((await b.get('/api/ws/load?tenant=' + c.tenantId)).json, { ok: false, error: 'session_expired' });
  assert.equal((await b.get('/api/auth/session')).json.signedIn, false);

  // background polling does not keep a session alive
  const third = (await st.signIn(c.email, c.password)).browser;
  Object.assign(b, { jar: third.jar });
  reseal((s) => { s.last = now - 20 * 60; });
  const before = b.jar.get('vx');
  assert.equal((await b.get('/api/ws/load?tenant=' + c.tenantId, { headers: { 'x-vx-passive': '1' } })).status, 200);
  assert.equal(b.jar.get('vx'), before, 'a passive request leaves the activity stamp alone');
  assert.equal((await b.get('/api/ws/load?tenant=' + c.tenantId)).status, 200);
  assert.notEqual(b.jar.get('vx'), before, 'a real request moves it');
});

test('refresh rotation: tokens are exchanged on use, and a replayed old cookie ends the whole session', async () => {
  const c = await st.company();
  st.sb.set({ jwtExp: 30, reuseInterval: 0 });   // every request finds the access token "about to expire"
  try {
    const { browser: b } = await st.signIn(c.email, c.password);
    const first = b.cookieHeader();
    const rt = (cookie) => S.openSession(new Request(ORIGIN + '/x', { headers: { cookie } })).session.rt;
    const r1 = await b.get('/api/ws/load?tenant=' + c.tenantId);
    assert.equal(r1.status, 200);
    const second = b.cookieHeader();
    assert.notEqual(rt(second), rt(first), 'the refresh token was replaced');
    assert.equal((await b.get('/api/ws/load?tenant=' + c.tenantId)).status, 200);
    assert.notEqual(rt(b.cookieHeader()), rt(second), 'and again on the next use');
    const live = b.cookieHeader();
    // an attacker replays the first cookie, which holds a refresh token that was already used
    const thief = st.browser();
    const replay = await thief.get('/api/ws/load?tenant=' + c.tenantId, { headers: { cookie: first } });
    assert.deepEqual([replay.status, replay.json], [401, { ok: false, error: 'session_expired' }]);
    // reuse of a refresh token is treated as theft: the real browser's session is ended too
    const after = await b.get('/api/ws/load?tenant=' + c.tenantId, { headers: { cookie: live } });
    assert.equal(after.status, 401);
  } finally { st.sb.set({ jwtExp: 3600, reuseInterval: 10 }); }
});

// ---------------------------------------------------------------------------------------------------------------------
test('password reset: a one-time link by email, the same answer for every address, and every session ended', async () => {
  const c = await st.company();
  const b = st.browser(); await b.open();
  const sentBefore = st.mail.sent.length;
  const asked = await b.post('/api/auth/password/reset', { email: c.email.toUpperCase(), lang: 'en' });
  assert.deepEqual(asked.json, { ok: true, emailConfigured: true });
  assert.equal(st.mail.sent.length, sentBefore + 1);
  const link = st.linkFor(c.email);
  assert.match(link, new RegExp(`^${ORIGIN}/reset-password#token=[0-9a-f]{56}$`), 'the token travels after "#", which is never sent to a server');
  const token = decodeURIComponent(link.split('#token=')[1]);
  secrets.add(token);

  assert.deepEqual((await b.post('/api/auth/password/reset', { token, password: 'short' })).json, { ok: false, error: 'weak_password', reason: 'too_short' });
  // refused because it holds the address: the one-time token is used by now, so the retry goes without it
  const own = await b.post('/api/auth/password/reset', { token, password: c.email.split('@')[0] + '!!' });
  assert.deepEqual(own.json, { ok: false, error: 'weak_password', reason: 'contains_email' });
  assert.ok(b.jar.has('vx-reset'));
  const done = await b.post('/api/auth/password/reset', { password: 'Brand-new-password-2026' });
  assert.deepEqual(done.json, { ok: true });
  assert.equal(b.jar.has('vx-reset'), false);
  assert.equal(b.jar.has('vx'), false, 'a reset signs nobody in');

  assert.equal((await st.signIn(c.email, c.password)).res.status, 401, 'the old password is gone');
  assert.equal((await st.signIn(c.email, 'Brand-new-password-2026')).res.status, 200);
  assert.equal((await c.owner.get('/api/auth/session')).json.signedIn, false, 'sessions opened before the reset are ended');
  const b2 = st.browser(); await b2.open();
  assert.deepEqual((await b2.post('/api/auth/password/reset', { token, password: 'Yet-another-password-77' })).json, { ok: false, error: 'reset_invalid' }, 'the link works once');
  assert.deepEqual((await b2.post('/api/auth/password/reset', { password: 'Yet-another-password-77' })).json, { ok: false, error: 'reset_invalid' }, 'and a retry without a pending reset is refused');
  assert.ok(await count(`select count(*) from app.security_events where kind = 'password.reset' and tenant_id = (select v from _in where k = 't')::uuid`, { t: c.tenantId }) >= 1);

  // asking too often: the answer stays the same, but no more emails go out
  const n = st.mail.sent.length;
  const asker = st.browser({ address: '203.0.113.61' }); await asker.open();
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await asker.post('/api/auth/password/reset', { email: c.email })).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
  assert.ok(st.mail.sent.length - n <= 3, 'at most three reset emails per account and hour');
});

test('password change: needs a fresh identity check, follows the password rules, signs out the other browsers', async () => {
  const c = await st.company();
  const one = (await st.signIn(c.email, c.password)).browser;
  const two = (await st.signIn(c.email, c.password)).browser;
  await st.stepUp(one, c.password);
  assert.deepEqual((await one.post('/api/auth/password/update', { password: 'qwertyuiop12' })).json, { ok: false, error: 'weak_password', reason: 'common' });
  assert.deepEqual((await one.post('/api/auth/password/update', { password: 'Changed-password-2026' })).json, { ok: true });
  assert.equal((await one.get('/api/auth/session')).json.signedIn, true, 'this browser stays signed in');
  assert.equal((await two.get('/api/auth/session')).json.signedIn, false, 'the other one does not');
  assert.equal((await st.signIn(c.email, 'Changed-password-2026')).res.status, 200);
});

test('nothing sent to a browser in this file contains a secret, a token, a stack trace or database text', () => {
  assertNoLeak(assert);
});
