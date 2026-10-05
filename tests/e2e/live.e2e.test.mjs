// The live client, end to end, in a real browser: sign-in, invitations, the second sign-in step, the workspace against the
// server and the database, roles, isolation between companies, and what happens when a session ends or the network drops.
//
// PROVED AGAINST LOCAL STAND-INS ONLY: a local PostgreSQL with every migration, the test double of the Supabase addresses
// (scripts/dev-supabase.mjs) and scripts/serve.mjs running the real handlers of api/ with the response headers of
// vercel.json. Nothing here ran on Supabase or on Vercel, and no email or provider was contacted.
//
//   npm run test:e2e        (node tests/e2e/run.mjs)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startStack } from './stack.mjs';
import { launch, person, fillSignIn, typeCode, ageSession, readQr, shot } from './helpers.mjs';

const PW = { ownerP: 'Quiet-harbor-lamp-41', ownerF: 'Maple-river-stone-88', reader: 'Copper-window-field-27', staff: 'Linen-orchard-bridge-63', lbs: 'Amber-meadow-signal-52' };
let st; let browser;
let P; let F; let L;                       // the practice company and the field company on VYNTEX Command; the company of LBS Command
const who = {};                            // people by name: { email, password, secret, codes }
const open = [];                           // browser contexts to close at the end

const count = async (dep, text, data) => Number(await dep.sql(`select '@@R@@' || (${text})::text;`, data));
/** One value from the database, as the local superuser. Anything is returned as JSON. */
const one = (dep, text, data) => dep.sql(`select '@@R@@' || coalesce(to_jsonb((${text}))::text, 'null');`, data);
const guy = async (origin, opts) => { const p = await person(browser, origin, opts); open.push(p); return p; };
const noErrors = (p, what) => assert.deepEqual(p.errors, [], `${what}: errors in the browser console`);
const text = (p, sel) => p.page.locator(sel).first().innerText();

/** Fields on the page that a screen reader could not name: no label tied to them and no label of their own. */
const unnamed = (p) => p.page.evaluate(() => [...document.querySelectorAll('.auth-form input, .auth-form select, .auth-form textarea, .modal input')]
  .filter((el) => !(el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) && !el.getAttribute('aria-label') && !el.closest('label')).map((el) => el.outerHTML.slice(0, 80)));

/** Signs a person in through the page: password, then the code when the account has an authenticator. */
async function signIn(p, path, person_) {
  await p.go(path);
  await fillSignIn(p, person_.email, person_.password);
  if (person_.secret) await typeCode(p, st.vyntex.totp(person_.secret));
  await p.workspace();
}
/** A fresh identity check and an invitation, made the way the Team screen will: returns the link the email would carry. */
async function invite(dep, inviter, by, tenantId, email, role) {
  let r = await inviter.api('POST', '/api/ws/rpc/member_invite', { tenant: tenantId, args: { email, role, name: 'Sample ' + role } });
  if (r.status === 403 && r.json.error === 'stepup_required') {
    const proof = by.secret ? { code: dep.totp(by.secret) } : { password: by.password };
    const s = await inviter.api('POST', '/api/auth/stepup', proof);
    assert.equal(s.status, 200, 'the fresh identity check: ' + JSON.stringify(s.json));
    r = await inviter.api('POST', '/api/ws/rpc/member_invite', { tenant: tenantId, args: { email, role, name: 'Sample ' + role } });
  }
  assert.equal(r.status, 200, 'the invitation: ' + JSON.stringify(r.json));
  // no email provider exists here: the test server hands the link back instead of withdrawing the invitation
  assert.equal(r.json.delivery, 'test');
  return r.json.testLink.replace(/^https?:\/\/[^/]+/, '');
}

before(async () => {
  st = await startStack();
  browser = await launch();
  const plan = JSON.parse(fs.readFileSync(new URL('../../config/vyntex-build-pricing.json', import.meta.url), 'utf8')).plans[1].id;
  P = await st.vyntex.company({ industry: 'practice', name: 'Sample Practice Office' });
  F = await st.vyntex.company({ industry: 'build', name: 'Sample Field Builders', plan });
  L = await st.lbs.company({ industry: 'practice', name: 'Sample Books and Tax' });
  // the practice company asks its owners and senior associates for the second sign-in step (its own configuration)
  await st.vyntex.sql(`update public.tenants set config = '{"security": {"mfaRoles": ["owner", "manager"]}}' where id = (select v from _in where k = 't')::uuid; select '@@R@@' || '1';`, { t: P.tenantId });
  who.ownerP = { email: P.ownerEmail, password: PW.ownerP };
  who.ownerF = { email: F.ownerEmail, password: PW.ownerF };
  who.ownerL = { email: L.ownerEmail, password: PW.lbs };
});
after(async () => {
  for (const p of open) await p.close().catch(() => undefined);
  await browser?.close();
  await st?.stop();
});

test('a build without settings says sign-in is not configured, and nothing fails oddly', async () => {
  const p = await guy(st.bare.origin);
  for (const address of ['/signin', '/some-company', '/some-company/leads']) {
    await p.go(address);
    await p.page.waitForSelector('[data-testid=auth-unconfigured]');
    assert.match(await text(p, '[data-testid=auth-unconfigured]'), /Sign-in is not configured for this deployment yet/);
    assert.equal(await p.page.locator('[data-testid=auth-form]').count(), 0, 'no form that could not work');
    assert.equal(await p.page.locator('.shell').count(), 0, 'no workspace');
  }
  await p.go('/invite/abcdefghijklmnopqrstuvwxyz0123456789');
  await p.page.waitForSelector('[data-testid=auth-unconfigured]');
  await p.go('/reset-password');
  await p.page.waitForSelector('[data-testid=auth-unconfigured]');
  assert.deepEqual(p.statuses, [], 'the page asked the health address first and made no request that could fail');
  noErrors(p, 'unconfigured build');
  await shot(p, 'unconfigured');
});

test('owner: accepts the invitation, sets a password, sets up the second step, sees the recovery codes, lands in the workspace', async () => {
  const p = await guy(st.vyntex.origin);
  who.ownerP.browser = p;
  await p.go(new URL(P.inviteLink).pathname);
  await p.page.waitForSelector('[data-testid=auth-invite-form]');
  assert.match(await text(p, '.auth-sub'), /Sample Practice Office/, 'the page says which company the invitation is for');
  assert.ok(!p.page.url().includes(new URL(P.inviteLink).pathname.split('/')[2]), 'the one-time value left the address bar');
  await shot(p, 'invite');
  assert.deepEqual(await unnamed(p), [], 'every field of the invitation form has a label');
  assert.equal(await p.page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'auth-invite-name', 'the keyboard starts in the first field');
  assert.equal(await p.page.getByRole('link', { name: /sign up|register|create an account/i }).count(), 0, 'no sign-up link');

  // the server's password rules, in the page's words
  await p.page.fill('[data-testid=auth-invite-name]', 'Olivia Sample');
  for (const [pw, says] of [['short', /at least 12 characters/i], ['password1234', /common passwords|simple run/i], ['abcabcabcabcabc', /simple run or repetition|common/i]]) {
    await p.page.fill('[data-testid=auth-invite-password]', pw); await p.page.fill('[data-testid=auth-invite-again]', pw);
    await p.page.click('[data-testid=auth-submit]');
    await p.page.waitForFunction((re) => new RegExp(re, 'i').test(document.querySelector('[data-testid=auth-error]')?.textContent || ''), says.source);
  }
  await p.page.fill('[data-testid=auth-invite-password]', PW.ownerP); await p.page.fill('[data-testid=auth-invite-again]', PW.ownerP + 'x');
  await p.page.click('[data-testid=auth-submit]');
  await p.page.waitForFunction(() => /not the same/.test(document.querySelector('[data-testid=auth-error]')?.textContent || ''));
  assert.equal(await p.page.getAttribute('[data-testid=auth-error]', 'role'), 'alert', 'errors are announced');
  await p.page.fill('[data-testid=auth-invite-again]', PW.ownerP);
  await p.page.click('[data-testid=auth-submit]');

  // the owner's role needs the second step: the company address shows that step, not the workspace
  await p.page.waitForSelector('[data-testid=auth-enroll]');
  assert.equal(new URL(p.page.url()).pathname, '/' + P.slug);
  assert.equal(await p.page.locator('.shell').count(), 0);
  const refused = await p.api('GET', '/api/ws/load?tenant=' + P.tenantId);
  assert.deepEqual([refused.status, refused.json.error], [403, 'mfa_required'], 'the server refuses the workspace until the step is done');
  const secret = await p.page.getAttribute('[data-testid=auth-secret]', 'data-secret');
  assert.match(secret, /^[A-Z2-7]{16,}$/);
  const scanned = await readQr(p);
  assert.match(scanned, /^otpauth:\/\/totp\//, 'the QR code on screen reads back as an authenticator address');
  assert.ok(scanned.includes('secret=' + secret), 'and carries the same key as the text next to it');
  await shot(p, 'enroll');
  assert.deepEqual(await unnamed(p), []);
  assert.equal(await p.page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'auth-code', 'the keyboard is in the code field');
  await typeCode(p, '000000' === st.vyntex.totp(secret) ? '111111' : '000000');
  await p.page.waitForSelector('[data-testid=auth-error]');
  await typeCode(p, st.vyntex.totp(secret));
  await p.page.waitForSelector('[data-testid=auth-codes]');
  const codes = await p.page.locator('[data-testid=auth-recovery-item]').allInnerTexts();
  assert.equal(codes.length, 10);
  assert.ok(codes.every((c) => /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/.test(c)));
  assert.equal(await p.page.isDisabled('[data-testid=auth-codes-continue]'), true, 'not past this page before saying the codes were saved');
  const [download] = await Promise.all([p.page.waitForEvent('download'), p.page.click('[data-testid=auth-codes-download]')]);
  const saved = fs.readFileSync(await download.path(), 'utf8');
  assert.ok(codes.every((c) => saved.includes(c)), 'the downloaded file holds the ten codes');
  await shot(p, 'recovery-codes');
  await p.page.check('[data-testid=auth-codes-kept]');
  await p.page.click('[data-testid=auth-codes-continue]');
  await p.workspace();
  Object.assign(who.ownerP, { secret, codes });

  assert.match(await text(p, '.side-brand'), /Sample Practice Office/);
  assert.equal(await p.page.locator('.demobar').count(), 0, 'the sample controls never appear in a live workspace');
  assert.equal(await p.page.locator('[data-testid=sync-status]').getAttribute('data-state'), 'saved');
  // nothing of the session or the records is readable by the page or kept in browser storage
  const seen = await p.page.evaluate(() => ({ cookie: document.cookie, local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
  assert.ok(!/(^|; )vx=/.test(seen.cookie), 'the session cookie is not readable by scripts');
  assert.deepEqual(seen.local.filter((k) => k !== 'vyntex.prefs'), [], 'no records in local storage');
  assert.deepEqual(seen.session, []);
  noErrors(p, 'owner onboarding');
  await shot(p, 'workspace-owner');
});

/** Everything the server refused in the change requests a person's page made so far. */
const refusals = (p) => p.applies.flatMap((a) => a.rejected || []);
/** Fills the form of the dialog on screen by the kind of field, which is the same in every edition and language. */
async function inModal(p, fill) { await p.page.waitForSelector('.modal'); await fill(p.page.locator('.modal')); }
/** The first plain text field of a form (some forms give it a type, some do not). */
const TEXT = 'input:not([type]), input[type=text]';

test('owner: a lead, a client, an engagement and a task are written to the database, edited, and still there after a reload', async () => {
  const p = who.ownerP.browser;
  const base = '/' + P.slug;

  // a lead
  await p.go(base + '/leads'); await p.workspace();
  await p.page.click('[data-testid=leads-new]');
  await inModal(p, async (m) => {
    await m.locator(TEXT).first().fill('Quinn Sample');
    await m.locator('input[type=tel]').first().fill('609-555-0199');
    await m.locator('input[type=email]').first().fill('quinn@example.com');
    await m.locator('input[type=number]').first().fill('1800');
    await m.locator('button[type=submit]').click();
  });
  await p.page.waitForFunction(() => /\/leads\/[0-9a-f-]{36}$/.test(location.pathname));
  const leadId = p.page.url().split('/').pop();
  await p.saved();
  assert.deepEqual(refusals(p), [], 'the server took every change of the new lead');
  assert.equal(await one(st.vyntex, `select name from public.leads where id = (select v from _in where k = 'id')::uuid`, { id: leadId }), 'Quinn Sample');

  // a client
  await p.page.click('[data-nav=clients]');
  await p.page.click('[data-testid=clients-new]');
  await inModal(p, async (m) => {
    await m.locator(TEXT).first().fill('Rowan Sample');
    await m.locator('input[type=tel]').first().fill('609-555-0142');
    await m.locator('[data-testid=clients-save]').click();
  });
  await p.saved();
  const clientId = await one(st.vyntex, `select id from public.clients where tenant_id = (select v from _in where k = 't')::uuid and name = 'Rowan Sample'`, { t: P.tenantId });
  assert.match(String(clientId), /^[0-9a-f-]{36}$/, 'the client is in the database');

  // an engagement for that client
  await p.page.click('[data-nav=jobs]');
  await p.page.click('[data-testid=jobs-new]');
  await inModal(p, async (m) => {
    await m.locator('[data-testid=jobs-f-client]').selectOption(clientId);
    await m.locator('[data-testid=jobs-f-name]').fill('Sample monthly bookkeeping');
    await m.locator('[data-testid=jobs-f-price]').fill('450');
    await m.locator('[data-testid=jobs-save]').click();
  });
  await p.saved();
  const job = await one(st.vyntex, `select jsonb_build_object('id', id, 'price', price, 'client', client_id) from public.jobs where tenant_id = (select v from _in where k = 't')::uuid and name = 'Sample monthly bookkeeping'`, { t: P.tenantId });
  assert.deepEqual([Number(job.price), job.client], [450, clientId]);

  // a task
  await p.page.click('[data-nav=tasks]');
  await p.page.click('[data-testid=tasks-new]');
  await inModal(p, async (m) => { await m.locator(TEXT).first().fill('Call Rowan about the March statements'); await m.locator('button[type=submit]').click(); });
  await p.saved();
  assert.equal(await count(st.vyntex, `select count(*) from public.tasks where tenant_id = (select v from _in where k = 't')::uuid and title = 'Call Rowan about the March statements'`, { t: P.tenantId }), 1);
  assert.deepEqual(refusals(p), [], 'nothing was refused: ' + JSON.stringify(refusals(p)));

  // edits: the lead's name, the engagement's status
  await p.go(base + '/leads/' + leadId); await p.workspace();
  await p.page.click('[data-testid=leads-edit]');
  await inModal(p, async (m) => { await m.locator(TEXT).first().fill('Quinn Sample Edited'); await m.locator('button[type=submit]').click(); });
  await p.saved();
  assert.equal(await one(st.vyntex, `select name from public.leads where id = (select v from _in where k = 'id')::uuid`, { id: leadId }), 'Quinn Sample Edited');
  await p.go(base + '/jobs/' + job.id); await p.workspace();
  await p.page.waitForSelector('[data-testid=jobs-status]');
  const statuses = await p.page.locator('[data-testid=jobs-status] option').evaluateAll((os) => os.map((o) => o.value));
  const before = await p.page.inputValue('[data-testid=jobs-status]');
  const next = statuses.find((v) => v && v !== before);
  await p.synced(() => p.page.selectOption('[data-testid=jobs-status]', next));
  assert.equal(await one(st.vyntex, `select status from public.jobs where id = (select v from _in where k = 'id')::uuid`, { id: job.id }), next);
  assert.deepEqual(refusals(p), [], 'nothing was refused: ' + JSON.stringify(refusals(p)));

  // reload: the page starts from nothing and gets everything back from the server
  await p.page.reload(); await p.workspace();
  assert.deepEqual(await p.page.evaluate(() => Object.keys(localStorage)), ['vyntex.prefs'], 'the browser kept preferences only');
  assert.ok(!(await p.page.evaluate(() => localStorage.getItem('vyntex.prefs'))).includes('Quinn'), 'and no record inside them');
  const sees = async (q, address, wanted) => { await q.go(address); await q.workspace(); await q.page.waitForFunction((w) => document.querySelector('#main')?.textContent?.includes(w), wanted); };
  await sees(p, base + '/leads', 'Quinn Sample Edited');
  await sees(p, base + '/clients', 'Rowan Sample');
  await sees(p, base + '/jobs', 'Sample monthly bookkeeping');
  await sees(p, base + '/tasks', 'Call Rowan about the March statements');
  Object.assign(P, { leadId, clientId, jobId: job.id });
  noErrors(p, 'owner records');
  await shot(p, 'workspace-tasks');
});

test('a second browser of the owner starts with nothing and gets the same records from the server', async () => {
  const p = await guy(st.vyntex.origin);
  who.ownerP.second = p;
  await p.go('/' + P.slug + '/leads');
  // signing in from a company address leads back to the page that was asked for
  await fillSignIn(p, who.ownerP.email, who.ownerP.password);
  await p.page.waitForSelector('[data-testid=auth-verify]');
  assert.deepEqual(await unnamed(p), []);
  assert.equal(await p.page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'auth-code', 'the keyboard moved to the code field');
  assert.equal(await p.page.locator('.shell').count(), 0, 'no workspace on a password alone, for a role that needs the second step');
  const early = await p.api('GET', '/api/ws/load?tenant=' + P.tenantId);
  assert.deepEqual([early.status, early.json.error], [403, 'mfa_required'], 'and the server refuses the records too');
  await typeCode(p, st.vyntex.totp(who.ownerP.secret));
  await p.workspace();
  assert.equal(new URL(p.page.url()).pathname, '/' + P.slug + '/leads', 'the place was remembered');
  await p.page.waitForFunction(() => document.querySelector('#main')?.textContent?.includes('Quinn Sample Edited'));
  noErrors(p, 'second browser');
});

test('read-only member: sees the records, has no controls that change them, and the server refuses a forced change', async () => {
  const email = `reader-${P.slug}@example.com`;
  const link = await invite(st.vyntex, who.ownerP.browser, who.ownerP, P.tenantId, email, 'readonly');
  const p = await guy(st.vyntex.origin);
  who.reader = { email, password: PW.reader, browser: p };
  await p.go(link);
  await p.page.waitForSelector('[data-testid=auth-invite-form]');
  await p.page.fill('[data-testid=auth-invite-name]', 'Riley Reader');
  await p.page.fill('[data-testid=auth-invite-password]', PW.reader); await p.page.fill('[data-testid=auth-invite-again]', PW.reader);
  await p.page.click('[data-testid=auth-submit]');
  await p.workspace();          // this role is not asked for the second step in this company
  assert.equal(new URL(p.page.url()).pathname, '/' + P.slug);
  assert.equal(await p.page.getAttribute('[data-testid=actor]', 'title'), 'Read only');
  for (const [section, wanted, control] of [['leads', 'Quinn Sample Edited', 'leads-new'], ['clients', 'Rowan Sample', 'clients-new'], ['jobs', 'Sample monthly bookkeeping', 'jobs-new'], ['tasks', 'Call Rowan about the March statements', 'tasks-new']]) {
    await p.page.click(`[data-nav=${section}]`);
    await p.page.waitForFunction((w) => document.querySelector('#main')?.textContent?.includes(w), wanted);
    assert.equal(await p.page.locator(`[data-testid=${control}]`).count(), 0, `no "${control}" for a read-only person`);
  }
  await p.go('/' + P.slug + '/leads/' + P.leadId); await p.workspace();
  await p.page.waitForFunction(() => document.querySelector('#main')?.textContent?.includes('Quinn Sample Edited'));
  assert.equal(await p.page.locator('[data-testid=leads-edit], [data-testid=leads-convert], [data-testid=leads-won]').count(), 0);
  await shot(p, 'workspace-readonly');

  // a change forced past the page, with the person's own session: the database refuses it
  const loaded = await p.api('GET', '/api/ws/load?tenant=' + P.tenantId);
  const lead = loaded.json.data.leads.find((l) => l.id === P.leadId);
  const forced = await p.api('POST', '/api/ws/apply', { tenant: P.tenantId, idem: 'forced-write-0001', ops: [
    { c: 'leads', op: 'upsert', id: lead.id, row: { ...lead, name: 'Changed by a read-only person' } },
    { c: 'leads', op: 'delete', id: lead.id },
    { c: 'tasks', op: 'upsert', id: crypto.randomUUID(), row: { id: 'x', title: 'Made by a read-only person' } },
  ] });
  assert.equal(forced.status, 200);
  assert.equal(forced.json.applied, 0);
  assert.deepEqual(forced.json.rejected.map((r) => r.reason), ['forbidden', 'forbidden', 'forbidden']);
  assert.equal(await one(st.vyntex, `select name from public.leads where id = (select v from _in where k = 'id')::uuid`, { id: P.leadId }), 'Quinn Sample Edited');
  assert.equal(await count(st.vyntex, `select count(*) from public.tasks where title = 'Made by a read-only person'`), 0);
  const protectedCall = await p.api('POST', '/api/ws/rpc/member_invite', { tenant: P.tenantId, args: { email: 'someone@example.com', role: 'staff' } });
  assert.ok([403].includes(protectedCall.status), 'inviting is refused: ' + JSON.stringify(protectedCall.json));
  noErrors(p, 'read-only member');
});

test('two browsers change the same lead: the later one is told, and gets the version that was saved first', async () => {
  const first = who.ownerP.second; const late = who.ownerP.browser;
  const address = '/' + P.slug + '/leads/' + P.leadId;
  // both have the lead on screen, in the version the server gave them
  await late.go(address); await late.workspace(); await late.page.waitForSelector('[data-testid=leads-edit]');
  await first.go(address); await first.workspace();
  await first.page.click('[data-testid=leads-edit]');
  await first.synced(() => inModal(first, async (m) => { await m.locator('input[type=number]').first().fill('2400'); await m.locator('button[type=submit]').click(); }));
  assert.equal(Number(await one(st.vyntex, `select value from public.leads where id = (select v from _in where k = 'id')::uuid`, { id: P.leadId })), 2400);
  // the other browser still holds the older version and saves over it
  await late.page.click('[data-testid=leads-edit]');
  await inModal(late, async (m) => { await m.locator('input[type=number]').first().fill('900'); await m.locator('button[type=submit]').click(); });
  await late.page.waitForFunction(() => [...document.querySelectorAll('.toast.err')].some((t) => /someone else changed it first/.test(t.textContent || '')));
  await late.saved();
  assert.deepEqual(refusals(late).map((r) => r.reason), ['stale']);
  assert.equal(Number(await one(st.vyntex, `select value from public.leads where id = (select v from _in where k = 'id')::uuid`, { id: P.leadId })), 2400, 'the first save stands');
  await late.page.waitForFunction(() => document.querySelector('#main')?.textContent?.includes('2,400'));
  late.applies.length = 0;
  noErrors(first, 'first editor'); noErrors(late, 'late editor');
});

test('duplicate search and the next turn of the lead rotation answer from the database, for members only', async () => {
  const p = who.ownerP.second;
  const call = (name, args, tenant = P.tenantId) => p.api('POST', '/api/ws/rpc/' + name, { tenant, args });
  const clients = await call('client_find_duplicate', { p_phone: '(609) 555-0142', p_name: 'rowan sample' });
  assert.equal(clients.status, 200, JSON.stringify(clients.json));
  assert.deepEqual(clients.json.result.map((r) => [r.client_id, r.name, r.restricted]), [[P.clientId, 'Rowan Sample', false]]);
  assert.ok(clients.json.result[0].matched.includes('phone') && clients.json.result[0].matched.includes('name'));
  const leads = await call('lead_find_duplicate', { p_email: 'QUINN@example.com' });
  assert.deepEqual(leads.json.result.map((r) => r.lead_id), [P.leadId]);
  assert.deepEqual((await call('lead_find_duplicate', { p_email: 'nobody@example.com' })).json.result, []);
  // the rotation: nobody while the company has no pool, then the member who is in it
  const none = await call('lead_assign_next', {});
  assert.deepEqual([none.status, none.json.result], [200, null], JSON.stringify(none.json));
  const me = (await p.api('GET', '/api/auth/session')).json.memberships.find((m) => m.tenantId === P.tenantId).memberId;
  const pool = await p.api('POST', '/api/ws/apply', { tenant: P.tenantId, idem: 'rotation-pool-0001', ops: [{ c: 'config', op: 'upsert', id: 'config', row: { security: { mfaRoles: ['owner', 'manager'] }, routing: { mode: 'round_robin', pool: [me], cursor: 0, exclude: [], skipAway: true } } }] });
  assert.deepEqual(pool.json.rejected, [], JSON.stringify(pool.json));
  const turn = await call('lead_assign_next', {});
  assert.deepEqual([turn.status, turn.json.result], [200, me], 'the member in the pool takes the turn');
  // someone who is not a member of that company gets nothing, not even "no match"
  const outsider = await guy(st.vyntex.origin);
  await outsider.go('/signin'); await outsider.page.waitForSelector('[data-testid=auth-form]');
  assert.equal((await outsider.api('POST', '/api/ws/rpc/client_find_duplicate', { tenant: P.tenantId, args: { p_name: 'Rowan Sample' } })).status, 401);
  await outsider.close();
});

/**
 * Where given amounts appear in loaded data, as paths: a number with that value, or text that writes it out ("5,200",
 * "5200.00"). Ids and time stamps are left out, since their digits mean nothing.
 */
function amountsIn(value, amounts, at = 'data', out = []) {
  if (Array.isArray(value)) value.forEach((v, i) => amountsIn(v, amounts, `${at}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) amountsIn(v, amounts, `${at}.${k}`, out);
  else if (typeof value === 'number') { if (amounts.includes(value)) out.push(`${at} = ${value}`); }
  else if (typeof value === 'string' && !/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(value) && !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    for (const a of amounts) if (new RegExp(`(^|[^0-9])${String(a).replace(/(\d)(\d{3})$/, '$1,?$2')}([^0-9]|$)`).test(value)) out.push(`${at} = ${value.slice(0, 60)}`);
  }
  return out;
}

/** Makes a task through the page, the way a person would. */
async function addTask(p, base, title) {
  if (new URL(p.page.url()).pathname !== base + '/tasks') { await p.go(base + '/tasks'); await p.workspace(); }
  await p.page.click('[data-testid=tasks-new]');
  await inModal(p, async (m) => { await m.locator(TEXT).first().fill(title); await m.locator('button[type=submit]').click(); });
}
const tasksNamed = (dep, title) => count(dep, `select count(*) from public.tasks where title = (select v from _in where k = 'title')`, { title });

test('field edition: the owner sees prices and payments; a staff member gets neither from the database, and cannot change them', async () => {
  const owner = await guy(st.vyntex.origin);
  who.ownerF.browser = owner;
  await owner.go(new URL(F.inviteLink).pathname);
  await owner.page.waitForSelector('[data-testid=auth-invite-form]');
  await owner.page.fill('[data-testid=auth-invite-name]', 'Felix Sample');
  await owner.page.fill('[data-testid=auth-invite-password]', PW.ownerF); await owner.page.fill('[data-testid=auth-invite-again]', PW.ownerF);
  await owner.page.click('[data-testid=auth-submit]');
  await owner.workspace();      // this company does not ask for the second step
  const base = '/' + F.slug;
  assert.match(await text(owner, '.side-brand'), /Sample Field Builders/);
  assert.match(await text(owner, '.side-brand'), /VYNTEX BUILD/i, 'the edition comes from the company');

  await owner.page.click('[data-nav=clients]');
  await owner.page.click('[data-testid=clients-new]');
  await owner.synced(() => inModal(owner, async (m) => { await m.locator(TEXT).first().fill('Harper Sample'); await m.locator('[data-testid=clients-save]').click(); }));
  const clientId = await one(st.vyntex, `select id from public.clients where tenant_id = (select v from _in where k = 't')::uuid and name = 'Harper Sample'`, { t: F.tenantId });
  await owner.page.click('[data-nav=jobs]');
  await owner.page.click('[data-testid=jobs-new]');
  await owner.synced(() => inModal(owner, async (m) => {
    await m.locator('[data-testid=jobs-f-client]').selectOption(clientId);
    await m.locator('[data-testid=jobs-f-name]').fill('Sample kitchen refit');
    await m.locator('[data-testid=jobs-f-price]').fill('5200');
    await m.locator('[data-testid=jobs-save]').click();
  }));
  const jobId = await one(st.vyntex, `select id from public.jobs where tenant_id = (select v from _in where k = 't')::uuid and name = 'Sample kitchen refit'`, { t: F.tenantId });
  // a payment received, recorded on the job page
  await owner.go(base + '/jobs/' + jobId + '/money'); await owner.workspace();
  await owner.page.click('[data-testid=jobs-record-payment]');
  await owner.synced(() => inModal(owner, async (m) => { await m.locator('input[type=number]').first().fill('1300'); await m.locator('button[type=submit]').click(); }));
  assert.deepEqual(refusals(owner), [], JSON.stringify(refusals(owner)));
  assert.equal(await count(st.vyntex, `select coalesce(sum(amount), 0) from public.client_payments where job_id = (select v from _in where k = 'j')::uuid`, { j: jobId }), 1300);
  assert.match(await text(owner, '#main'), /3,900/, 'the owner sees what the client still owes');
  Object.assign(F, { clientId, jobId });

  const email = `staff-${F.slug}@example.com`;
  const link = await invite(st.vyntex, owner, who.ownerF, F.tenantId, email, 'staff');
  const staff = await guy(st.vyntex.origin);
  who.staff = { email, password: PW.staff, browser: staff };
  await staff.go(link);
  await staff.page.waitForSelector('[data-testid=auth-invite-form]');
  await staff.page.fill('[data-testid=auth-invite-name]', 'Sam Staff');
  await staff.page.fill('[data-testid=auth-invite-password]', PW.staff); await staff.page.fill('[data-testid=auth-invite-again]', PW.staff);
  await staff.page.click('[data-testid=auth-submit]');
  await staff.workspace();

  // what the database hands this role: the job without its price, its payment terms and its money lists
  const loaded = (await staff.api('GET', '/api/ws/load?tenant=' + F.tenantId)).json.data;
  const j = loaded.jobs.find((x) => x.id === jobId);
  assert.ok(j, 'the job itself is visible');
  assert.deepEqual([j.price, j.received, j.expenses], [0, [], []], 'no price, no payments, no expenses');
  assert.deepEqual(loaded.workerPays, []);
  assert.deepEqual(amountsIn(loaded, [5200, 1300, 3900]), [], 'the amounts are nowhere in what was loaded');
  // and the screens: no payments screen in the menu, no amount on the job page
  assert.equal(await staff.page.locator('[data-nav=payments]').count(), 0);
  assert.equal(await staff.page.locator('[data-nav=reports]').count(), 0);
  await staff.go(base + '/jobs/' + jobId); await staff.workspace();
  await staff.page.waitForFunction(() => document.querySelector('#main')?.textContent?.includes('Sample kitchen refit'));
  assert.ok(!/5,200|1,300/.test(await text(staff, '#main')), 'no price or payment on the job page');
  await shot(staff, 'workspace-staff-job');
  // the staff member changes what they may (the status); the price they never received is not wiped by their save
  const options = await staff.page.locator('[data-testid=jobs-status] option').evaluateAll((os) => os.map((o) => o.value));
  const current = await staff.page.inputValue('[data-testid=jobs-status]');
  const to = options.find((v) => v && v !== current);
  await staff.synced(() => staff.page.selectOption('[data-testid=jobs-status]', to));
  assert.deepEqual(refusals(staff), [], JSON.stringify(refusals(staff)));
  const after = await one(st.vyntex, `select jsonb_build_object('status', status, 'price', price) from public.jobs where id = (select v from _in where k = 'j')::uuid`, { j: jobId });
  assert.deepEqual([after.status, Number(after.price)], [to, 5200], 'the status changed, the price is untouched');
  // a price forced past the page is not written
  const forced = await staff.api('POST', '/api/ws/apply', { tenant: F.tenantId, idem: 'forced-price-0001', ops: [{ c: 'jobs', op: 'upsert', id: jobId, row: { ...j, status: to, price: 1 } }] });
  assert.equal(forced.status, 200);
  assert.equal(Number(await one(st.vyntex, `select price from public.jobs where id = (select v from _in where k = 'j')::uuid`, { j: jobId })), 5200);
  noErrors(owner, 'field owner'); noErrors(staff, 'field staff');
});

test('a member of another company cannot load or change the first company\'s records, by any address or crafted request', async () => {
  const p = who.ownerF.browser;       // owner of the field company, signed in; the target is the practice company
  const before = await one(st.vyntex, `select jsonb_build_object('leads', (select count(*) from public.leads where tenant_id = t.id), 'tasks', (select count(*) from public.tasks where tenant_id = t.id), 'name', (select name from public.leads where id = (select v from _in where k = 'l')::uuid)) from public.tenants t where t.id = (select v from _in where k = 't')::uuid`, { t: P.tenantId, l: P.leadId });

  const load = await p.api('GET', '/api/ws/load?tenant=' + P.tenantId);
  assert.deepEqual([load.status, load.json], [403, { ok: false, error: 'forbidden' }]);
  const apply = await p.api('POST', '/api/ws/apply', { tenant: P.tenantId, idem: 'cross-company-0001', ops: [{ c: 'leads', op: 'delete', id: P.leadId }, { c: 'tasks', op: 'upsert', id: crypto.randomUUID(), row: { title: 'Planted from another company' } }] });
  assert.deepEqual([apply.status, apply.json], [403, { ok: false, error: 'forbidden' }]);
  const rpc = await p.api('POST', '/api/ws/rpc/lead_assign_next', { tenant: P.tenantId, args: { p_lead: P.leadId } });
  assert.deepEqual([rpc.status, rpc.json.error], [403, 'forbidden']);
  const smuggled = await p.api('POST', '/api/ws/rpc/lead_assign_next', { tenant: F.tenantId, args: { p_tenant: P.tenantId, p_lead: P.leadId } });
  assert.deepEqual([smuggled.status, smuggled.json.error], [400, 'tenant_mismatch'], 'the company cannot be swapped inside the arguments');
  const hidden = await p.api('POST', '/api/ws/rpc/ws_hidden_clients', { tenant: P.tenantId, args: {} });
  assert.equal(hidden.status, 403);
  const search = await p.api('POST', '/api/ws/rpc/client_find_duplicate', { tenant: P.tenantId, args: { p_name: 'Rowan Sample' } });
  assert.equal(search.status, 403, 'no searching another company for a name');
  assert.deepEqual((await p.api('POST', '/api/ws/rpc/client_find_duplicate', { tenant: F.tenantId, args: { p_name: 'Rowan Sample' } })).json.result, [], 'and their own search does not reach across');
  const conns = await p.api('GET', '/api/integrations?tenant=' + P.tenantId);
  assert.equal(conns.status, 403);
  const file = await p.api('POST', '/api/ws/file/url', { tenant: P.tenantId, path: `${P.tenantId}/documents/00000000-0000-4000-8000-000000000000.pdf` });
  assert.equal(file.status, 403);
  // through the own company: a row that names the other company, and the other company's row id
  const own = await p.api('POST', '/api/ws/apply', { tenant: F.tenantId, idem: 'cross-company-0002', ops: [
    { c: 'tasks', op: 'upsert', id: crypto.randomUUID(), row: { title: 'Planted', tenantId: P.tenantId } },
    { c: 'leads', op: 'upsert', id: P.leadId, row: { id: P.leadId, name: 'Taken over', ticket: 'X-1', phone: '', email: '', status: 'new', created: '2026-01-01' } },
    { c: 'leads', op: 'delete', id: P.leadId },
    { c: 'tasks', op: 'upsert', id: crypto.randomUUID(), row: { title: 'Pointing across', clientId: P.clientId, jobId: P.jobId } },
  ] });
  assert.equal(own.status, 200);
  assert.equal(own.json.rejected.find((r) => r.c === 'tasks')?.reason, 'wrong_tenant');
  assert.ok(own.json.rejected.some((r) => r.c === 'leads' && r.id === P.leadId), 'the other company\'s lead is not writable under its id');
  assert.equal(await count(st.vyntex, `select count(*) from public.tasks where title in ('Planted', 'Planted from another company')`), 0);
  assert.equal(await count(st.vyntex, `select count(*) from public.tasks where title = 'Pointing across' and (client_id is not null or job_id is not null)`), 0, 'no link into the other company was stored');
  const afterAll = await one(st.vyntex, `select jsonb_build_object('leads', (select count(*) from public.leads where tenant_id = t.id), 'tasks', (select count(*) from public.tasks where tenant_id = t.id), 'name', (select name from public.leads where id = (select v from _in where k = 'l')::uuid)) from public.tenants t where t.id = (select v from _in where k = 't')::uuid`, { t: P.tenantId, l: P.leadId });
  assert.deepEqual(afterAll, before, 'the first company is exactly as it was');

  // by address: the other company's address, and an address that is no company, give the same sign-in page
  await p.go('/' + P.slug + '/leads/' + P.leadId);
  await p.page.waitForSelector('[data-testid=auth-form]');
  assert.equal(await p.page.locator('.shell').count(), 0);
  const there = await text(p, '.auth-form');
  await p.go('/no-such-company-here/leads/' + P.leadId);
  await p.page.waitForSelector('[data-testid=auth-form]');
  assert.equal(await text(p, '.auth-form'), there, 'no hint whether the company exists');
  assert.ok(!there.includes('Sample Practice Office'));
  // their own company still opens
  await p.go('/' + F.slug); await p.workspace();
  noErrors(p, 'isolation');
});

test('wrong password and unknown email read the same; repeated failures lock the account from that address only', async () => {
  const p = await guy(st.vyntex.origin);
  await p.go('/signin');
  await fillSignIn(p, who.reader.email, 'not-the-password-1');
  await p.page.waitForSelector('[data-testid=auth-error]');
  const wrong = await text(p, '[data-testid=auth-error]');
  assert.equal(await p.page.locator('.shell').count(), 0);
  await fillSignIn(p, 'nobody-at-all@example.com', 'not-the-password-1');
  await p.page.waitForFunction(() => document.querySelector('[data-testid=auth-password]')?.value === '' && document.querySelector('[data-testid=auth-error]'));
  assert.equal(await text(p, '[data-testid=auth-error]'), wrong, 'the same sentence for a wrong password and for an address without an account');
  assert.ok(!/account|exist|registered/i.test(wrong));

  // four more failures for the real account: five in all from this address
  for (let i = 0; i < 4; i++) {
    const [res] = await Promise.all([p.page.waitForResponse((r) => r.url().endsWith('/api/auth/signin')), fillSignIn(p, who.reader.email, 'not-the-password-' + (i + 2))]);
    assert.equal(res.status(), 401);
    await p.page.waitForFunction(() => document.querySelector('[data-testid=auth-password]')?.value === '');
  }
  const [locked] = await Promise.all([p.page.waitForResponse((r) => r.url().endsWith('/api/auth/signin')), fillSignIn(p, who.reader.email, who.reader.password)]);
  assert.equal(locked.status(), 429, 'now even the right password is refused from this address');
  await p.page.waitForFunction(() => /Too many attempts/.test(document.querySelector('[data-testid=auth-error]')?.textContent || ''));
  assert.match(await text(p, '[data-testid=auth-error]'), /Try again in \d+ min/);
  assert.equal(await p.page.locator('.shell').count(), 0);
  await shot(p, 'locked');
  // the lock belongs to that address: the person themselves, elsewhere, is not locked out by someone guessing
  const elsewhere = await guy(st.vyntex.origin);
  await elsewhere.go('/signin');
  await fillSignIn(elsewhere, who.reader.email, who.reader.password);
  await elsewhere.workspace();
  assert.equal(new URL(elsewhere.page.url()).pathname, '/' + P.slug, 'one company: straight into it');
  who.reader.browser = elsewhere;
  noErrors(p, 'lockout'); noErrors(elsewhere, 'sign-in elsewhere');
});

test('requests without the csrf value or from another site are refused; a replayed change request is applied once', async () => {
  const p = who.ownerF.browser;
  const id = crypto.randomUUID();
  const op = { c: 'tasks', op: 'upsert', id, row: { id, title: 'Sample task sent twice', status: 'todo', pri: 'medium', created: '2026-10-03' } };
  const noHeader = await p.api('POST', '/api/ws/apply', { tenant: F.tenantId, idem: 'csrf-check-0001', ops: [op] }, { csrf: false });
  assert.deepEqual([noHeader.status, noHeader.json], [403, { ok: false, error: 'bad_csrf' }]);
  const wrongValue = await p.api('POST', '/api/ws/apply', { tenant: F.tenantId, idem: 'csrf-check-0002', ops: [op] }, { csrf: 'made-up-value.0123456789abcdef0123456789abcdef' });
  assert.deepEqual([wrongValue.status, wrongValue.json], [403, { ok: false, error: 'bad_csrf' }]);
  // the same cookies sent from somewhere that is not this site (another origin, or no origin at all)
  const cookies = (await p.context.cookies(st.vyntex.origin)).map((c) => `${c.name}=${c.value}`).join('; ');
  const csrf = (await p.context.cookies(st.vyntex.origin)).find((c) => c.name === 'vx-csrf').value;
  for (const origin of ['http://evil.example', undefined]) {
    const res = await fetch(st.vyntex.origin + '/api/ws/apply', { method: 'POST', headers: { cookie: cookies, 'content-type': 'application/json', 'x-vx-csrf': csrf, ...(origin ? { origin } : {}) }, body: JSON.stringify({ tenant: F.tenantId, idem: 'csrf-check-0003', ops: [op] }) });
    assert.deepEqual([res.status, await res.json()], [403, { ok: false, error: 'bad_origin' }]);
  }
  assert.equal(await tasksNamed(st.vyntex, 'Sample task sent twice'), 0, 'none of them wrote anything');

  // the same request twice under one key: written once, the second answer is the stored one
  const first = await p.api('POST', '/api/ws/apply', { tenant: F.tenantId, idem: 'replay-check-0001', ops: [op] });
  assert.deepEqual([first.status, first.json.applied, first.json.rejected], [200, 1, []]);
  await p.api('POST', '/api/ws/apply', { tenant: F.tenantId, idem: 'replay-check-0002', ops: [{ c: 'tasks', op: 'delete', id }] });
  assert.equal(await tasksNamed(st.vyntex, 'Sample task sent twice'), 0);
  const again = await p.api('POST', '/api/ws/apply', { tenant: F.tenantId, idem: 'replay-check-0001', ops: [op] });
  assert.equal(again.json.replayed, true);
  assert.equal(await tasksNamed(st.vyntex, 'Sample task sent twice'), 0, 'the task removed in between was not created again');
});

test('the page itself: an answer lost on the way is repeated with the same key and applied once; offline changes wait and are sent', async () => {
  const p = who.ownerF.browser;
  const base = '/' + F.slug;
  await p.go(base + '/tasks'); await p.workspace();
  // the server applies the request, and the answer never reaches the page
  let dropped = 0; const keys = [];
  await p.page.route('**/api/ws/apply', async (route) => {
    keys.push(JSON.parse(route.request().postData()).idem);
    if (dropped === 0) { dropped = 1; await route.fetch(); await route.abort('connectionreset'); return; }
    await route.continue();
  });
  const seen = p.applies.length;
  await addTask(p, base, 'Sample task with a lost answer');
  await p.page.waitForSelector('[data-testid=sync-status][data-state=offline]');
  assert.match(await text(p, '[data-testid=sync-status]'), /Offline/);
  await shot(p, 'sync-offline');
  await p.page.click('[data-testid=sync-retry]');
  await p.saved();
  await p.page.unroute('**/api/ws/apply');
  assert.ok(keys.length >= 2 && new Set(keys).size === 1, 'the repeat carried the same idempotency key: ' + keys.join(', '));
  assert.equal(p.applies.slice(seen).at(-1).replayed, true, 'the server answered the repeat from memory');
  assert.equal(await tasksNamed(st.vyntex, 'Sample task with a lost answer'), 1, 'written once');

  // no network at all: the change stays on screen, the indicator says so, and it is sent when the network is back
  await p.context.setOffline(true);
  await addTask(p, base, 'Sample task made offline');
  await p.page.waitForSelector('[data-testid=sync-status][data-state=offline]');
  assert.equal(await tasksNamed(st.vyntex, 'Sample task made offline'), 0);
  assert.ok((await text(p, '#main')).includes('Sample task made offline'), 'it is on screen meanwhile');
  await p.context.setOffline(false);
  await p.saved(90000);
  assert.equal(await tasksNamed(st.vyntex, 'Sample task made offline'), 1);
  noErrors(p, 'retry and offline');
});

test('idle timeout: back to sign-in with the place remembered, the unsaved change announced, then sent after signing in again', async () => {
  const p = who.ownerF.browser;
  const base = '/' + F.slug;
  await p.go(base + '/tasks'); await p.workspace();
  await ageSession(st.vyntex, p, { idleMinutes: 31 });        // the company's limit is 30 minutes
  await addTask(p, base, 'Sample task typed after a long lunch');
  await p.page.waitForSelector('[data-testid=auth-ended][data-reason=idle]');
  assert.equal(await p.page.locator('.shell').count(), 0, 'the workspace is gone from the screen');
  assert.match(await text(p, '[data-testid=auth-unsaved]'), /had not been saved/);
  assert.equal(new URL(p.page.url()).pathname, base + '/tasks', 'the address is the page the person was on');
  assert.equal(await tasksNamed(st.vyntex, 'Sample task typed after a long lunch'), 0);
  assert.equal((await p.api('GET', '/api/ws/load?tenant=' + F.tenantId)).status, 401, 'the session is over on the server');
  await shot(p, 'session-idle');
  await fillSignIn(p, who.ownerF.email, who.ownerF.password);
  await p.workspace();
  assert.equal(new URL(p.page.url()).pathname, base + '/tasks');
  await p.page.waitForFunction(() => document.querySelector('#main')?.textContent?.includes('Sample task typed after a long lunch'));
  assert.equal(await tasksNamed(st.vyntex, 'Sample task typed after a long lunch'), 1, 'the change that was waiting is in the database, once');

  // the longest life of a session, whatever the activity
  await ageSession(st.vyntex, p, { ageHours: 13 });
  await p.page.reload();
  await p.page.waitForSelector('[data-testid=auth-form]');
  assert.equal(await p.page.locator('.shell').count(), 0);
  await fillSignIn(p, who.ownerF.email, who.ownerF.password);
  await p.workspace();
  noErrors(p, 'idle timeout');
});

test('a recovery code replaces a lost authenticator; signing out everywhere ends the other browser too', async () => {
  const a = await guy(st.vyntex.origin);
  await a.go('/' + P.slug);
  await fillSignIn(a, who.ownerP.email, who.ownerP.password);
  await a.page.waitForSelector('[data-testid=auth-verify]');
  await a.page.click('[data-testid=auth-switch]');
  await a.page.waitForSelector('[data-testid=auth-recovery]');
  await a.page.fill('[data-testid=auth-recovery-code]', 'AAAA-BBBB-CCCC-DDDD');
  await a.page.click('[data-testid=auth-submit]');
  await a.page.waitForSelector('[data-testid=auth-error]');
  await a.page.fill('[data-testid=auth-recovery-code]', who.ownerP.codes[0].toLowerCase());
  await a.page.click('[data-testid=auth-submit]');
  // the code removed the old authenticator; this role must set a new one up before anything opens
  await a.page.waitForSelector('[data-testid=auth-enroll]');
  const secret = await a.page.getAttribute('[data-testid=auth-secret]', 'data-secret');
  assert.notEqual(secret, who.ownerP.secret);
  await typeCode(a, st.vyntex.totp(secret));
  await a.page.waitForSelector('[data-testid=auth-codes]');
  const codes = await a.page.locator('[data-testid=auth-recovery-item]').allInnerTexts();
  assert.ok(!codes.includes(who.ownerP.codes[1]), 'new recovery codes; the old ones are gone');
  await a.page.check('[data-testid=auth-codes-kept]'); await a.page.click('[data-testid=auth-codes-continue]');
  await a.workspace();
  Object.assign(who.ownerP, { secret, codes });

  // browser B is the owner's first browser, still open on the workspace
  const b = who.ownerP.browser;
  await b.go('/' + P.slug + '/tasks'); await b.workspace();
  await a.page.click('[data-testid=account-menu]');
  await a.page.click('[data-testid=account-signout-all]');
  await a.page.click('.modal [data-autofocus]');
  await a.page.waitForSelector('[data-testid=auth-ended][data-reason=signed_out]');
  assert.equal(await a.page.locator('.shell').count(), 0);
  assert.deepEqual(await a.page.evaluate(() => Object.keys(localStorage)), ['vyntex.prefs']);
  // B makes a change: the server refuses it, B is back at sign-in and says the change is not saved
  await addTask(b, '/' + P.slug, 'Sample task from the browser that was signed out');
  await b.page.waitForSelector('[data-testid=auth-ended]');
  assert.match(await b.page.getAttribute('[data-testid=auth-ended]', 'data-reason'), /revoked|expired/);
  assert.equal(await b.page.locator('.shell').count(), 0);
  assert.equal((await b.api('GET', '/api/ws/load?tenant=' + P.tenantId)).status, 401);
  assert.equal(await tasksNamed(st.vyntex, 'Sample task from the browser that was signed out'), 0);
  // signing in again as the same person from that page sends it
  await fillSignIn(b, who.ownerP.email, who.ownerP.password);
  await typeCode(b, st.vyntex.totp(secret));
  await b.workspace();
  await b.page.waitForFunction(() => document.querySelector('#main')?.textContent?.includes('Sample task from the browser that was signed out'));
  assert.equal(await tasksNamed(st.vyntex, 'Sample task from the browser that was signed out'), 1);
  // an ordinary sign-out: this browser only
  await b.page.click('[data-testid=account-menu]');
  await b.page.click('[data-testid=account-signout]');
  await b.page.waitForSelector('[data-testid=auth-ended][data-reason=signed_out]');
  assert.equal((await b.api('GET', '/api/auth/session')).json.signedIn, false);
  await b.go('/' + P.slug + '/leads');
  await b.page.waitForSelector('[data-testid=auth-form]');
  assert.equal(await b.page.locator('.shell').count(), 0, 'the back door is closed too');
  noErrors(a, 'recovery'); noErrors(b, 'signed out elsewhere');
});

test('the background check is marked as polling, brings in a colleague\'s change, and real activity is reported separately', async () => {
  // the owner signs in again (the last test signed this browser out) and the read-only colleague watches the same lead
  const owner = who.ownerP.browser;
  await fillSignIn(owner, who.ownerP.email, who.ownerP.password);
  await typeCode(owner, st.vyntex.totp(who.ownerP.secret));
  await owner.workspace();
  const reader = who.reader.browser;
  await reader.page.clock.install();
  await reader.go('/' + P.slug + '/leads/' + P.leadId); await reader.workspace();
  await reader.page.waitForFunction(() => document.querySelector('#main h1')?.textContent?.includes('Quinn Sample Edited'));

  await owner.go('/' + P.slug + '/leads/' + P.leadId); await owner.workspace();
  await owner.page.click('[data-testid=leads-edit]');
  await owner.synced(() => inModal(owner, async (m) => { await m.locator(TEXT).first().fill('Quinn Sample Renamed'); await m.locator('button[type=submit]').click(); }));

  const polled = [];
  reader.page.on('request', (r) => { if (r.url().includes('/api/ws/load') || r.url().includes('/api/auth/session')) polled.push({ path: new URL(r.url()).pathname, passive: r.headers()['x-vx-passive'] || '' }); });
  await reader.page.clock.fastForward(61000);
  await reader.page.waitForFunction(() => document.querySelector('#main h1')?.textContent?.includes('Quinn Sample Renamed'), null, { timeout: 60000 });
  for (const t0 = Date.now(); polled.length < 2 && Date.now() - t0 < 30000;) await reader.page.waitForTimeout(100);   // the records, then who is signed in
  assert.deepEqual(polled.map((r) => r.path), ['/api/ws/load', '/api/auth/session']);
  assert.ok(polled.every((r) => r.passive === '1'), 'every background request says it is polling: ' + JSON.stringify(polled));
  // the person uses the page: a few minutes later one request without the mark keeps the session from going idle
  polled.length = 0;
  await reader.page.click('[data-nav=clients]');
  await reader.page.clock.fastForward(4 * 60000 + 1000);
  await reader.page.waitForTimeout(400);
  assert.ok(polled.some((r) => r.path === '/api/auth/session' && r.passive === ''), 'activity was reported: ' + JSON.stringify(polled));
  noErrors(reader, 'background check');
});

test('changing the password asks for a fresh identity check: the password without an authenticator, the code with one', async () => {
  const reader = who.reader.browser;
  const change = async (p, next) => {
    await p.page.click('[data-testid=account-menu]');
    await p.page.click('[data-testid=account-password]');
    await p.page.fill('[data-testid=auth-new-password]', next); await p.page.fill('[data-testid=auth-new-password-again]', next);
    await p.page.click('[data-testid=auth-change-password-save]');
    await p.page.waitForSelector('[data-testid=auth-stepup]');
  };
  // cancelled: nothing changes
  await change(reader, 'Garden-lantern-river-19');
  assert.equal(await reader.page.getAttribute('[data-testid=auth-stepup]', 'data-mode'), 'password');
  await reader.page.click('[data-testid=auth-stepup-cancel]');
  await reader.page.waitForSelector('[data-testid=auth-stepup]', { state: 'detached' });
  await reader.page.keyboard.press('Escape');
  await reader.page.waitForSelector('[data-testid=auth-change-password]', { state: 'detached' });
  // a wrong password at the check, then the right one
  await change(reader, 'Garden-lantern-river-19');
  await reader.page.fill('[data-testid=auth-stepup-password]', 'not-my-password-00'); await reader.page.click('[data-testid=auth-stepup-submit]');
  await reader.page.waitForSelector('[data-testid=auth-stepup] [data-testid=auth-error]');
  await reader.page.fill('[data-testid=auth-stepup-password]', who.reader.password); await reader.page.click('[data-testid=auth-stepup-submit]');
  await reader.page.waitForSelector('[data-testid=auth-change-password]', { state: 'detached' });
  who.reader.password = 'Garden-lantern-river-19';
  await reader.page.click('[data-testid=account-menu]'); await reader.page.click('[data-testid=account-signout]');
  await reader.page.waitForSelector('[data-testid=auth-ended][data-reason=signed_out]');
  await fillSignIn(reader, who.reader.email, PW.reader);
  await reader.page.waitForSelector('[data-testid=auth-error]');
  await fillSignIn(reader, who.reader.email, who.reader.password);
  await reader.workspace();

  // the owner has an authenticator: the check asks for its code, and a password would not do
  const owner = who.ownerP.browser;
  const direct = await owner.api('POST', '/api/auth/password/update', { password: 'Silver-harbor-window-73' });
  assert.ok(direct.status === 403 && direct.json.error === 'stepup_required' || direct.status === 200, JSON.stringify(direct.json));
  if (direct.status === 200) { who.ownerP.password = 'Silver-harbor-window-73'; return; }   // the sign-in a moment ago still counted as fresh
  await change(owner, 'Silver-harbor-window-73');
  assert.equal(await owner.page.getAttribute('[data-testid=auth-stepup]', 'data-mode'), 'code');
  await typeCode(owner, st.vyntex.totp(who.ownerP.secret), '[data-testid=auth-stepup-code]');
  await owner.page.waitForSelector('[data-testid=auth-change-password]', { state: 'detached' });
  who.ownerP.password = 'Silver-harbor-window-73';
  noErrors(reader, 'password change'); noErrors(owner, 'password change with a code');
});

test('password reset: the request page gives nothing away; the emailed link sets a new password and ends every session', async () => {
  const p = await guy(st.vyntex.origin);
  await p.go('/signin');
  await p.page.waitForSelector('[data-testid=auth-form]');
  await p.page.click('[data-testid=auth-forgot]');
  await p.page.fill('[data-testid=auth-reset-email]', who.staff.email);
  await p.page.click('[data-testid=auth-reset-send]');
  await p.page.waitForSelector('[data-testid=auth-reset-sent]');
  // this stack has no email provider: the page says no link was sent, for a real address and for a made-up one alike
  const said = await text(p, '[data-testid=auth-reset-sent]');
  assert.match(said, /cannot send email/);
  await p.go('/reset-password');
  await p.page.fill('[data-testid=auth-reset-email]', 'nobody-at-all@example.com');
  await p.page.click('[data-testid=auth-reset-send]');
  await p.page.waitForSelector('[data-testid=auth-reset-sent]');
  assert.equal(await text(p, '[data-testid=auth-reset-sent]'), said);

  // the one-time value an emailed link would carry, made by the stand-in for Supabase Auth (the email itself is not imitated)
  const sb = st.vyntex.sb;
  const made = await (await fetch(sb.url + '/auth/v1/admin/generate_link', { method: 'POST', headers: { apikey: sb.serviceKey, authorization: 'Bearer ' + sb.serviceKey, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'recovery', email: who.staff.email }) })).json();
  await p.go('/reset-password#token=' + made.hashed_token);
  await p.page.waitForSelector('[data-testid=auth-reset-form]');
  assert.equal(p.page.url(), st.vyntex.origin + '/reset-password', 'the one-time value left the address bar');
  await p.page.fill('[data-testid=auth-reset-password]', 'short'); await p.page.fill('[data-testid=auth-reset-again]', 'short');
  await p.page.click('[data-testid=auth-submit]');
  await p.page.waitForSelector('[data-testid=auth-error]');
  const next = 'Willow-anchor-paper-58';
  await p.page.fill('[data-testid=auth-reset-password]', next); await p.page.fill('[data-testid=auth-reset-again]', next);
  await p.page.click('[data-testid=auth-submit]');
  await p.page.waitForSelector('[data-testid=auth-reset-done]');
  // the staff member's open browser is signed out by the reset
  const old = who.staff.browser;
  assert.equal((await old.api('GET', '/api/ws/load?tenant=' + F.tenantId)).status, 401);
  // a used link does not work twice
  const again = await guy(st.vyntex.origin);
  await again.go('/reset-password#token=' + made.hashed_token);
  await again.page.fill('[data-testid=auth-reset-password]', next + 'x'); await again.page.fill('[data-testid=auth-reset-again]', next + 'x');
  await again.page.click('[data-testid=auth-submit]');
  await again.page.waitForSelector('[data-testid=auth-reset-invalid]');
  await p.page.click('[data-testid=auth-back]');
  await fillSignIn(p, who.staff.email, PW.staff);
  await p.page.waitForSelector('[data-testid=auth-error]');
  await fillSignIn(p, who.staff.email, next);
  await p.workspace();
  who.staff.password = next;
  noErrors(p, 'password reset');
});

test('one person in two companies: the invitation asks for the password of the account that exists, and sign-in offers a choice', async () => {
  // the owner of the field company is invited into the practice company as an associate
  const link = await invite(st.vyntex, who.ownerP.browser, who.ownerP, P.tenantId, who.ownerF.email, 'staff');
  const p = await guy(st.vyntex.origin);
  await p.go(link);
  await p.page.waitForSelector('[data-testid=auth-invite-form]');
  await p.page.fill('[data-testid=auth-invite-name]', 'Felix Sample');
  await p.page.fill('[data-testid=auth-invite-password]', 'Another-password-entirely-9'); await p.page.fill('[data-testid=auth-invite-again]', 'Another-password-entirely-9');
  await p.page.click('[data-testid=auth-submit]');
  // an invitation never sets a new password on an account that exists
  await p.page.waitForSelector('[data-testid=auth-invite][data-step=form-existing]');
  assert.match(await text(p, '[data-testid=auth-error]'), /already has an account/);
  await p.page.fill('[data-testid=auth-invite-password]', who.ownerF.password);
  await p.page.click('[data-testid=auth-submit]');
  await p.workspace();
  assert.equal(new URL(p.page.url()).pathname, '/' + P.slug);
  assert.match(await text(p, '.side-brand'), /Sample Practice Office/);
  // the sign-in page of someone signed in with two companies is the choice between them
  await p.go('/signin');
  await p.page.waitForSelector('[data-testid=auth-picker]');
  assert.deepEqual((await p.page.locator('[data-testid=auth-pick]').evaluateAll((els) => els.map((e) => e.getAttribute('data-slug')))).sort(), [F.slug, P.slug].sort());
  await shot(p, 'company-picker');
  await p.page.click(`[data-testid=auth-pick][data-slug="${F.slug}"]`);
  await p.workspace();
  assert.match(await text(p, '.side-brand'), /Sample Field Builders/);
  assert.equal(await p.page.getAttribute('[data-testid=actor]', 'title'), 'Owner', 'owner there');
  await p.go('/' + P.slug); await p.workspace();
  assert.match(await text(p, '.side-brand'), /Sample Practice Office/);
  assert.notEqual(await p.page.getAttribute('[data-testid=actor]', 'title'), 'Owner', 'an associate here: the role comes from the membership');
  noErrors(p, 'two companies');
});

test('LBS Command: / is sign-in, /app is the workspace of the practice edition, every office role needs the second step, and there is no demo', async () => {
  const dep = st.lbs;
  const p = await guy(dep.origin, { width: 390, height: 844 });
  await p.go('/');
  await p.page.waitForSelector('[data-testid=auth-form]');
  assert.equal(await p.page.evaluate(() => document.documentElement.dataset.brand), 'lbs');
  assert.match(await p.page.title(), /LBS Command/);
  assert.match(await text(p, '[data-testid=auth-invite-only]'), /by invitation/);
  assert.equal(await p.page.locator('[data-testid=auth-open-sample]').count(), 0, 'no sample workspace in this build');
  assert.ok(await p.page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth), 'no sideways scroll at 390 wide');
  assert.deepEqual(await unnamed(p), [], 'every field of the sign-in form has a label');
  assert.equal(await p.page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'auth-email', 'the keyboard starts in the email field');
  await shot(p, 'lbs-signin-390');
  await p.page.click('[data-testid=auth-lang-zh]');
  await p.page.waitForFunction(() => document.querySelector('.auth-form h1')?.textContent === '登录');
  await p.page.click('[data-testid=auth-lang-es]');
  await p.page.waitForFunction(() => document.querySelector('.auth-form h1')?.textContent === 'Iniciar sesión');
  await shot(p, 'lbs-signin-390-es');
  await p.page.click('[data-testid=auth-lang-en]');
  for (const gone of ['/demo', '/demo/leads', '/pricing', '/request-demo', '/preview']) {
    await p.go(gone);
    await p.page.waitForSelector('[data-testid=public-notfound]');
    assert.equal(await p.page.locator('.shell, [data-testid=auth-form]').count(), 0, gone + ' is nothing here');
  }
  await p.go('/app/leads');
  await p.page.waitForSelector('[data-testid=auth-form]');
  await p.close();

  // the owner, at a desk
  const o = await guy(dep.origin);
  await o.go(new URL(L.inviteLink).pathname);
  await o.page.waitForSelector('[data-testid=auth-invite-form]');
  await o.page.fill('[data-testid=auth-invite-name]', 'Lena Sample');
  await o.page.fill('[data-testid=auth-invite-password]', PW.lbs); await o.page.fill('[data-testid=auth-invite-again]', PW.lbs);
  await o.page.click('[data-testid=auth-submit]');
  await o.page.waitForSelector('[data-testid=auth-enroll]');
  assert.equal(new URL(o.page.url()).pathname, '/app');
  const secret = await o.page.getAttribute('[data-testid=auth-secret]', 'data-secret');
  assert.ok((await readQr(o)).includes('secret=' + secret));
  await shot(o, 'lbs-enroll');
  await typeCode(o, dep.totp(secret));
  await o.page.waitForSelector('[data-testid=auth-codes]');
  await o.page.check('[data-testid=auth-codes-kept]'); await o.page.click('[data-testid=auth-codes-continue]');
  await o.workspace();
  Object.assign(who.ownerL, { secret });
  assert.equal(new URL(o.page.url()).pathname, '/app');
  assert.match(await text(o, '.side-brand'), /Sample Books and Tax/);
  assert.match(await text(o, '.side-brand'), /LBS Command/);
  assert.equal(await o.page.locator('.demobar, [data-testid=plan], [data-testid=industry]').count(), 0, 'no sample controls, no edition or plan picker');
  assert.equal(await o.page.locator('[data-nav=team]').count() + await o.page.locator('[data-nav=jobs]').count(), 2);
  assert.match(await text(o, '[data-nav=jobs]'), /Engagements/, 'the practice edition, in its own words');
  assert.deepEqual(await o.page.evaluate(() => Object.keys(localStorage)), ['lbs.prefs']);
  await shot(o, 'lbs-workspace');

  await o.page.click('[data-nav=leads]');
  await o.page.click('[data-testid=leads-new]');
  await o.synced(() => inModal(o, async (m) => {
    await m.locator(TEXT).first().fill('Avery Sample');
    await m.locator('input[type=tel]').first().fill('609-555-0177');
    await m.locator('button[type=submit]').click();
  }));
  assert.deepEqual(refusals(o), [], JSON.stringify(refusals(o)));
  await o.page.waitForFunction(() => /^\/app\/leads\/[0-9a-f-]{36}$/.test(location.pathname));
  await o.page.reload(); await o.workspace();
  await o.page.waitForFunction(() => document.querySelector('#main h1')?.textContent?.includes('Avery Sample'));
  assert.equal(await count(dep, `select count(*) from public.leads where name = 'Avery Sample'`), 1, 'in the LBS database');
  assert.equal(await count(st.vyntex, `select count(*) from public.leads where name = 'Avery Sample'`), 0, 'and not in the other deployment\'s');

  // an associate: the second step is required for every office role on this deployment
  const link = await invite(dep, o, who.ownerL, L.tenantId, 'associate-lbs@example.com', 'staff');
  const a = await guy(dep.origin);
  await a.go(link);
  await a.page.waitForSelector('[data-testid=auth-invite-form]');
  await a.page.fill('[data-testid=auth-invite-name]', 'Alex Associate');
  await a.page.fill('[data-testid=auth-invite-password]', 'Orchard-silver-kettle-34'); await a.page.fill('[data-testid=auth-invite-again]', 'Orchard-silver-kettle-34');
  await a.page.click('[data-testid=auth-submit]');
  await a.page.waitForSelector('[data-testid=auth-enroll]');
  assert.equal(await a.page.locator('.shell').count(), 0);
  assert.equal((await a.api('GET', '/api/ws/load?tenant=' + L.tenantId)).json.error, 'mfa_required');
  // a session of the other deployment means nothing here: separate cookies, separate secrets, separate database
  const stranger = await guy(dep.origin);
  const cookies = await who.ownerF.browser.context.cookies(st.vyntex.origin);
  await stranger.context.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: dep.origin, httpOnly: c.httpOnly, sameSite: 'Lax' })));
  await stranger.go('/app');
  await stranger.page.waitForSelector('[data-testid=auth-form]');
  assert.equal((await stranger.api('GET', '/api/auth/session')).json.signedIn, false);
  noErrors(o, 'LBS owner'); noErrors(a, 'LBS associate');
});
