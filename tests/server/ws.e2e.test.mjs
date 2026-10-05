// The live workspace routes, end to end: load, apply, the allow-list of protected operations, and private files.
// Real handlers, the local PostgreSQL, and the TEST DOUBLE of the Supabase HTTP surface. The gateway functions
// ws_load / ws_apply are a small stand-in here (tests/server/sql/stub_gateway.sql): what is proved is the server
// around them, not the gateway itself. Proved against the local stand-in, not against Supabase.
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { startStack, assertNoLeak, secrets, ORIGIN } from './helpers.mjs';

let st; let a; let b;
const count = async (sqlText, data) => Number(await st.sql(`select '@@R@@' || (${sqlText})::text;`, data));
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n% sample file for a test\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF\n')]);
const upload = (browser, tenant, bytes, { type = 'application/pdf', area, name = 'Sample file.pdf', headers = {} } = {}) =>
  browser.call('POST', '/api/ws/file/upload', { raw: bytes, headers: { 'content-type': type, 'x-vx-tenant': tenant, ...(area ? { 'x-vx-area': area } : {}), 'x-vx-filename': encodeURIComponent(name), ...headers } });

before(async () => { st = await startStack(); a = await st.company(); b = await st.company(); });
after(async () => { await st.stop(); });

test('load and apply go through the person\'s own token, one company at a time', async () => {
  const empty = await a.owner.get('/api/ws/load?tenant=' + a.tenantId);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json.data.rows, []);
  const ops = [{ c: 'tasks', op: 'upsert', id: 't1', row: { id: 't1', title: 'Sample task' } }, { c: 'tasks', op: 'upsert', id: 't2', row: { id: 't2', title: 'Second sample task' } }];
  const applied = await a.owner.post('/api/ws/apply', { tenant: a.tenantId, idem: 'apply-key-0001', ops });
  assert.deepEqual(applied.json, { ok: true, server: {}, applied: 2, rejected: [] });
  assert.equal((await a.owner.get('/api/ws/load?tenant=' + a.tenantId)).json.data.rows.length, 2);

  // company B sees nothing of it and cannot touch it
  assert.deepEqual((await b.owner.get('/api/ws/load?tenant=' + b.tenantId)).json.data.rows, []);
  assert.deepEqual((await b.owner.get('/api/ws/load?tenant=' + a.tenantId)).json, { ok: false, error: 'forbidden' });
  assert.deepEqual((await b.owner.post('/api/ws/apply', { tenant: a.tenantId, idem: 'apply-key-000b', ops: [{ c: 'tasks', op: 'delete', id: 't1' }] })).json, { ok: false, error: 'forbidden' });
  assert.equal((await a.owner.get('/api/ws/load?tenant=' + a.tenantId)).json.data.rows.length, 2);
});

test('apply is safe to repeat: the same key gives the first answer and changes nothing again', async () => {
  const ops = [{ c: 'notes', op: 'upsert', id: 'n1', row: { id: 'n1', text: 'Sample note' } }];
  const first = await a.owner.post('/api/ws/apply', { tenant: a.tenantId, idem: 'apply-key-0002', ops });
  assert.equal(first.json.applied, 1);
  await a.owner.post('/api/ws/apply', { tenant: a.tenantId, idem: 'apply-key-0003', ops: [{ c: 'notes', op: 'delete', id: 'n1' }] });
  const repeat = await a.owner.post('/api/ws/apply', { tenant: a.tenantId, idem: 'apply-key-0002', ops });
  assert.equal(repeat.json.replayed, true, 'the stored answer');
  assert.equal((await a.owner.get('/api/ws/load?tenant=' + a.tenantId)).json.data.rows.filter((r) => r.id === 'n1').length, 0, 'the note deleted in between was not created again');
});

test('apply checks the shape of what it is given before the database sees it', async () => {
  const post = (body) => a.owner.post('/api/ws/apply', body);
  const op = { c: 'tasks', op: 'upsert', id: 'x', row: {} };
  assert.equal((await post({ idem: 'apply-key-0004', ops: [op] })).json.error, 'tenant_required');
  assert.equal((await post({ tenant: 'not-a-uuid', idem: 'apply-key-0004', ops: [op] })).json.error, 'tenant_required');
  assert.equal((await post({ tenant: a.tenantId, ops: [op] })).json.error, 'idem_required');
  assert.equal((await post({ tenant: a.tenantId, idem: 'short', ops: [op] })).json.error, 'idem_required');
  for (const ops of [[], 'x', [{ ...op, op: 'drop' }], [{ ...op, c: 'tasks; drop table' }], [{ ...op, id: '' }], [{ c: 'tasks', op: 'upsert', id: 'x' }], [null], Array.from({ length: 501 }, () => op)]) {
    assert.equal((await post({ tenant: a.tenantId, idem: 'apply-key-0005', ops })).json.error, 'invalid_ops');
  }
  const big = await post({ tenant: a.tenantId, idem: 'apply-key-0006', ops: [{ ...op, row: { blob: 'x'.repeat(1024 * 1024 + 10) } }] });
  assert.deepEqual([big.status, big.json], [413, { ok: false, error: 'too_large' }]);
  const wrongType = await a.owner.call('POST', '/api/ws/apply', { raw: Buffer.from('tenant=x'), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(wrongType.status, 415);
});

test('a read-only member can load, and their changes are rejected by the gateway', async () => {
  const ro = await st.addMember(a, 'readonly');
  assert.equal((await ro.browser.get('/api/ws/load?tenant=' + a.tenantId)).status, 200);
  const r = await ro.browser.post('/api/ws/apply', { tenant: a.tenantId, idem: 'apply-key-ro01', ops: [{ c: 'tasks', op: 'delete', id: 't1' }] });
  assert.deepEqual(r.json, { ok: true, server: {}, applied: 0, rejected: [{ c: 'tasks', id: 't1', reason: 'forbidden' }] });
});

test('protected operations: only names on the allow-list exist', async () => {
  const call = (name, body) => a.owner.post('/api/ws/rpc/' + name, { tenant: a.tenantId, ...body });
  const before = await count('select count(*) from app.security_events');
  for (const name of ['conn_get', 'conn_put', 'ws_load', 'vx_ws_load', 'auth_context', 'security_event', 'invite_complete', 'invite_bootstrap', 'session_stepup_mark', 'rate_lock_clear', 'job_claim', 'server_sweep', 'pg_sleep', 'version', 'nothing_at_all']) {
    const r = await call(name, { args: {} });
    assert.deepEqual([r.status, r.json], [404, { ok: false, error: 'unknown_operation' }], name);
  }
  assert.equal(await count('select count(*) from app.security_events'), before, 'none of them reached the database');
  const lead = '22222222-2222-4222-8222-222222222222';
  const ok = await call('lead_assign_next', { args: { p_lead: lead } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.result.lead, lead);
  assert.equal((await call('lead_assign_next', { args: { lead } })).json.error, 'invalid_args', 'argument names must be p_...');
  assert.equal((await call('lead_assign_next', { args: 'x' })).json.error, 'invalid_args');
  assert.equal((await call('lead_assign_next', { args: { p_lead: lead, p_tenant: b.tenantId } })).json.error, 'tenant_mismatch');
  assert.equal((await a.owner.post('/api/ws/rpc/lead_assign_next', { tenant: b.tenantId, args: { p_lead: lead } })).json.error, 'forbidden', 'another company');
  assert.equal((await a.owner.post('/api/ws/rpc/lead_assign_next', { args: { p_lead: lead } })).json.error, 'tenant_required');
  assert.equal((await call('lead_assign_next', { args: { p_lead: 'not-a-uuid' } })).json.error, 'invalid', 'a value the database refuses comes back as a code');
  assert.equal((await call('appt_mark_paid', { args: {} })).status, 501, 'a listed operation whose function is not installed yet says so');
});

test('protected operations: the sensitive ones need a fresh identity check, each time it has run out', async () => {
  const c = await st.company();
  const staff = await st.addMember(c, 'staff');
  const { browser: owner } = await st.signIn(c.email, c.password);
  const memberId = (await staff.browser.get('/api/auth/session')).json.memberships[0].memberId;
  const client = '33333333-3333-4333-8333-333333333333';
  for (const [name, args] of [['vault_reveal', { p_client: client }], ['member_set_role', { p_member: memberId, p_role: 'manager' }], ['member_invite', { email: 'x@example.com', role: 'staff' }], ['session_revoke_member', { p_member: memberId }], ['export_request', {}], ['vault_decide', {}], ['get_worker_tax_id', { p_worker: client }]]) {
    const r = await owner.post('/api/ws/rpc/' + name, { tenant: c.tenantId, args });
    assert.deepEqual([r.status, r.json], [403, { ok: false, error: 'stepup_required' }], name);
  }
  assert.equal((await staff.browser.get('/api/auth/session')).json.memberships[0].role, 'staff', 'nothing changed');
  await st.stepUp(owner, c.password);
  const reveal = await owner.post('/api/ws/rpc/vault_reveal', { tenant: c.tenantId, args: { p_client: client } });
  assert.equal(reveal.status, 200);
  const changed = await owner.post('/api/ws/rpc/member_set_role', { tenant: c.tenantId, args: { p_member: memberId, p_role: 'manager' } });
  assert.deepEqual(changed.json, { ok: true, result: null });
  assert.equal((await staff.browser.get('/api/auth/session')).json.memberships[0].role, 'manager');
  assert.equal(await count(`select count(*) from app.security_events where kind = 'member.role_changed' and tenant_id = (select v from _in where k = 't')::uuid and meta ->> 'to' = 'manager'`, { t: c.tenantId }), 1);
  assert.ok(await count(`select count(*) from public.audit_log where action = 'operation.protected' and tenant_id = (select v from _in where k = 't')::uuid and new_data ->> 'name' = 'vault_reveal'`, { t: c.tenantId }) >= 1, 'the protected call is in the audit log');
  // a member without the capability is refused by the database even with a fresh check
  await st.stepUp(staff.browser, staff.password);
  const denied = await staff.browser.post('/api/ws/rpc/member_set_role', { tenant: c.tenantId, args: { p_member: memberId, p_role: 'owner' } });
  assert.deepEqual([denied.status, denied.json], [403, { ok: false, error: 'forbidden' }]);
  assert.ok(await count(`select count(*) from app.security_events where kind = 'operation.refused' and tenant_id = (select v from _in where k = 't')::uuid`, { t: c.tenantId }) >= 1);
});

test('a database error never reaches the browser as text', async () => {
  secrets.add('sk_live_do_not_leak');
  const r = await a.owner.post('/api/ws/rpc/grant_decide', { tenant: a.tenantId, args: { p_request: '44444444-4444-4444-8444-444444444444', p_approve: true } });
  assert.equal(r.status, 409);
  assert.equal(r.text, '{"ok":false,"error":"rejected"}');
});

// ---------------------------------------------------------------------------------------------------------------------
test('files: stored privately under the company, with a server-made name', async () => {
  const up = await upload(a.owner, a.tenantId, PDF, { name: 'Contrato de servicio.pdf' });
  assert.equal(up.status, 200, up.text);
  const f = up.json.file;
  assert.deepEqual([f.name, f.size, f.mime], ['Contrato de servicio.pdf', PDF.length, 'application/pdf']);
  assert.match(f.path, new RegExp(`^${a.tenantId}/documents/[0-9a-f-]{36}\\.pdf$`), 'company folder, area, random name');
  assert.equal(await count(`select count(*) from storage.objects where bucket_id = 'workspace-files' and name = (select v from _in where k = 'p')`, { p: f.path }), 1);
  a.file = f;
  const inArea = await upload(a.owner, a.tenantId, PDF, { area: 'receipts' });
  assert.match(inArea.json.file.path, new RegExp(`^${a.tenantId}/receipts/`));
});

test('files: size and type limits, and the content must be what the type says', async () => {
  const cases = [
    [Buffer.from('MZ\x90\x00 this is a program, not a document'), { type: 'application/pdf' }, 415, 'type_mismatch'],
    [Buffer.from('<html><script>alert(1)</script></html>'), { type: 'text/html' }, 415, 'type_not_allowed'],
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), { type: 'image/svg+xml' }, 415, 'type_not_allowed'],
    [PDF, { type: 'image/png' }, 415, 'type_mismatch'],
    [Buffer.from([0x00, 0x01, 0x02, 0x03]), { type: 'text/plain' }, 415, 'type_mismatch'],
    [Buffer.alloc(0), {}, 400, 'empty_file'],
    [Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(4 * 1024 * 1024)]), {}, 413, 'too_large'],
    [PDF, { area: '../other' }, 400, 'invalid_area'],
    [PDF, { area: 'A/B' }, 400, 'invalid_area'],
  ];
  for (const [bytes, opts, status, code] of cases) {
    const r = await upload(a.owner, a.tenantId, bytes, opts);
    assert.deepEqual([r.status, r.json.error], [status, code], code);
  }
  assert.equal((await upload(a.owner, a.tenantId, Buffer.from('name,amount\nSample,10\n'), { type: 'text/csv', name: 'list.csv' })).status, 200);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
  assert.equal((await upload(a.owner, a.tenantId, png, { type: 'image/png', name: '../../etc/passwd' })).json.file.name, '.. .. etc passwd', 'the name is only a label; it never becomes part of a path');
});

test('files: nobody uploads into, or reads from, another company', async () => {
  const cross = await upload(b.owner, a.tenantId, PDF);
  assert.deepEqual([cross.status, cross.json], [403, { ok: false, error: 'forbidden' }]);
  assert.equal((await upload(st.browser(), a.tenantId, PDF)).status, 403, 'no session, no csrf value');
  const anon = st.browser(); await anon.open();
  assert.equal((await upload(anon, a.tenantId, PDF)).status, 401);
  const fromElsewhere = await a.owner.call('POST', '/api/ws/file/upload', { raw: PDF, origin: 'https://evil.example.com', headers: { 'content-type': 'application/pdf', 'x-vx-tenant': a.tenantId } });
  assert.deepEqual([fromElsewhere.status, fromElsewhere.json], [403, { ok: false, error: 'bad_origin' }]);
  // company B asks for a link to company A's file
  assert.deepEqual((await b.owner.post('/api/ws/file/url', { tenant: b.tenantId, path: a.file.path })).json, { ok: false, error: 'invalid_path' }, 'the path is not under the company named');
  assert.deepEqual((await b.owner.post('/api/ws/file/url', { tenant: a.tenantId, path: a.file.path })).json, { ok: false, error: 'forbidden' });
  for (const path of [`${a.tenantId}/../${b.tenantId}/documents/x.pdf`, `${a.tenantId}/documents/../../x.pdf`, '/etc/passwd', `${a.tenantId}/documents`, '', `${a.tenantId}//x.pdf`]) {
    assert.equal((await a.owner.post('/api/ws/file/url', { tenant: a.tenantId, path })).json.error, 'invalid_path', path);
  }
});

test('files: read back through a link that lasts one minute and belongs to one person', async () => {
  const link = await a.owner.post('/api/ws/file/url', { tenant: a.tenantId, path: a.file.path, name: 'Contrato de servicio.pdf' });
  assert.equal(link.status, 200);
  assert.match(link.json.url, /^\/api\/ws\/file\/get\?k=f1\./);
  assert.ok(Date.parse(link.json.expiresAt) - Date.now() <= 60_000);
  assert.ok(!link.json.url.includes(process.env.SUPABASE_URL) && !decodeURIComponent(link.json.url).includes(a.file.path), 'no storage address and no path in the link');
  const got = await a.owner.get(link.json.url);
  assert.equal(got.status, 200);
  assert.ok(got.bytes.equals(PDF), 'the same bytes come back');
  assert.equal(got.headers.get('content-type'), 'application/pdf');
  assert.match(got.headers.get('content-disposition'), /^attachment; filename="Contrato de servicio\.pdf"$/);
  assert.equal(got.headers.get('x-content-type-options'), 'nosniff');
  assert.match(got.headers.get('content-security-policy'), /sandbox/);
  assert.match(got.headers.get('cache-control'), /no-store/);

  // the link in other hands
  assert.deepEqual((await b.owner.get(link.json.url)).json, { ok: false, error: 'link_invalid' });
  const staff = await st.addMember(a, 'staff');
  assert.deepEqual((await staff.browser.get(link.json.url)).json, { ok: false, error: 'link_invalid' }, 'even a colleague needs their own link');
  assert.equal((await st.browser().get(link.json.url)).status, 401);
  assert.equal((await a.owner.get(link.json.url.slice(0, -4) + 'AAAA')).json.error, 'link_invalid', 'a changed link');
  const own = await staff.browser.post('/api/ws/file/url', { tenant: a.tenantId, path: a.file.path });
  assert.equal((await staff.browser.get(own.json.url)).status, 200, 'a colleague with the documents capability gets their own');

  // after a minute
  mock.timers.enable({ apis: ['Date'], now: Date.now() + 61_000 });
  try { assert.deepEqual((await a.owner.get(link.json.url)).json, { ok: false, error: 'link_invalid' }); } finally { mock.timers.reset(); }
});

test('nothing sent to a browser in this file contains a secret, a token, a stack trace or database text', () => {
  assertNoLeak(assert);
});
