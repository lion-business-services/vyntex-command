// End-to-end tests of the public endpoints and the server-side workflows (api/public.js, api/_lib/{public,esign,pipeline}).
//   node --test tests/server/e2e.public.test.mjs     (starts and stops its own PostgreSQL)
//   npm run test:server                               (tests/server/run.mjs starts the database for it)
// The stack: a throwaway PostgreSQL with EVERY migration (PGTEST_DIR /tmp/vx-pg-public), the test double of the
// Supabase HTTP surface on port 4741, the real handlers of api/. Emails "sent" through Resend are answered from
// memory. Nothing here reaches the internet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, createHash, createHmac } from 'node:crypto';
import path from 'node:path';
import { setTestEnv, Browser, seen, secrets, assertNoLeak, root, ORIGIN } from './helpers.mjs';

const PG = '/tmp/vx-pg-public';
const PORT = 4741;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const sha = (v) => createHash('sha256').update(v).digest('hex');
const pgEnv = { ...process.env, PGTEST_DIR: PG, MIGRATIONS_MODE: 'all' };
let S;          // the stack
let startedPg = false;
const tokens = new Set();   // every link token seen by a test: none may appear in an answer

async function startStack() {
  setTestEnv({ RESEND_API_KEY: 're_test_' + randomBytes(16).toString('hex'), SYSTEM_EMAIL_FROM: 'VYNTEX Command <system@mail.example.com>' });
  if (process.env.VX_PG_PUBLIC_READY !== '1') {
    const r = spawnSync('bash', [path.join(root, 'tests/server/pg_local.sh'), 'start'], { env: pgEnv, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('the local PostgreSQL did not start:\n' + r.stdout + r.stderr);
    startedPg = true;
  }
  const { startDevSupabase } = await import('../../scripts/dev-supabase.mjs');
  const sb = await startDevSupabase({ port: PORT, host: PG + '/sock' });
  Object.assign(process.env, { SUPABASE_URL: sb.url, SUPABASE_ANON_KEY: sb.anonKey, SUPABASE_SERVICE_ROLE_KEY: sb.serviceKey });
  for (const k of ['SESSION_SECRET', 'TOKEN_ENC_KEY', 'IP_HASH_SALT', 'CRON_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY']) secrets.add(process.env[k]);
  secrets.add(sb.jwtSecret);
  const mail = { sent: [], status: 200 };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.resend.com/emails')) {
      if (mail.status !== 200) return new Response(JSON.stringify({ statusCode: mail.status, name: 'application_error', message: 'internal detail from the email provider that must not leak' }), { status: mail.status });
      const body = JSON.parse(init.body);
      const key = init.headers['idempotency-key'];
      const dup = key && mail.sent.find((m) => m.idem === key);
      if (dup) return new Response(JSON.stringify({ id: dup.id }), { status: 200 });
      const id = 'email_' + randomBytes(6).toString('hex');
      mail.sent.push({ id, idem: key || null, ...body });
      return new Response(JSON.stringify({ id }), { status: 200 });
    }
    if (!u.startsWith(sb.url)) throw new Error('a test tried to reach an outside address: ' + u.slice(0, 60));
    return realFetch(url, init);
  };
  const api = { auth: await import('../../api/auth.js'), ws: await import('../../api/ws.js'), public: await import('../../api/public.js'), cron: await import('../../api/cron.js') };
  const sql = (text, data = {}) => sb.db.run('supabase_admin', [text], data);
  let n = 0;
  async function company() {
    n += 1;
    const slug = `pub-${Date.now().toString(36)}-${n}`;
    const email = `owner-${slug}@example.com`;
    const password = 'Quiet-harbor-lamp-41';
    const made = await sql(String.raw`
      with t as (insert into public.tenants (slug, name, industry_id, plan_id, status)
                 values ((select v from _in where k = 'slug'), 'Sample Company ' || (select v from _in where k = 'slug'), 'build', 'builder', 'active') returning id)
      select '@@R@@' || jsonb_build_object('id', (select id from t))::text;`, { slug });
    const boot = await sql(String.raw`select '@@R@@' || to_jsonb(public.invite_bootstrap((select v from _in where k = 'id')::uuid, (select v from _in where k = 'email')))::text;`, { id: made.id, email });
    const owner = new Browser(api);
    await owner.open();
    const accepted = await owner.post('/api/auth/invite/accept', { token: boot, password, name: 'Sample Owner' });
    if (accepted.status !== 200 || !accepted.json.signedIn) throw new Error('could not create the owner: ' + accepted.text);
    return { tenantId: made.id, slug, owner, email, password };
  }
  const linkFor = (email) => {
    const m = [...mail.sent].reverse().find((x) => x.to.includes(email));
    if (!m) throw new Error('no email was sent to ' + email);
    return /https?:\/\/\S+/.exec(m.text)[0];
  };
  const tokenFor = (email) => { const t = linkFor(email).split('/').pop(); tokens.add(t); return t; };
  const visitor = (address) => new Browser(api, { address });
  const cron = (job) => api.cron.GET(new Request(`${ORIGIN}/api/cron/${job}`, { headers: { authorization: 'Bearer ' + process.env.CRON_SECRET } })).then((r) => r.json());
  return { api, sb, mail, sql, company, linkFor, tokenFor, visitor, cron, async stop() { globalThis.fetch = realFetch; await sb.stop(); if (startedPg) spawnSync('bash', [path.join(root, 'tests/server/pg_local.sh'), 'stop'], { env: pgEnv }); } };
}

/** A draft request with two signers, a signature box and a date box each, over a one-page PDF stored through the real upload route. */
async function draftEnvelope(co, { ordered = true, tag = 'a' } = {}) {
  const { esign } = await import('../../api/_lib/domain.bundle.mjs');
  const pdf = Buffer.from(esign.tinyPdf(['Sample agreement ' + tag, 'This document is a sample made for a test.']));
  const up = await co.owner.call('POST', '/api/ws/file/upload', { raw: pdf, headers: { 'content-type': 'application/pdf', 'x-vx-tenant': co.tenantId, 'x-vx-area': 'signature', 'x-vx-filename': 'sample.pdf' } });
  assert.equal(up.status, 200, up.text);
  const e1 = `signer1-${tag}-${co.slug}@example.com`, e2 = `signer2-${tag}-${co.slug}@example.com`;
  const made = await S.sql(String.raw`
    with p as (select (select v from _in where k = 't')::uuid as t),
    c as (insert into public.clients (tenant_id, name) select t, 'Sample Client ' || (select v from _in where k = 'tag') from p returning id),
    d as (insert into public.documents (tenant_id, kind, number, title, status, client_id) select p.t, 'contract', 'C-' || (select v from _in where k = 'tag'), 'Sample agreement', 'draft', c.id from p, c returning id),
    e as (insert into public.envelopes (tenant_id, doc_id, title, status, ordered, remind_every, extra)
          select p.t, d.id, 'Sample agreement', 'draft', (select v from _in where k = 'ordered')::boolean, 3,
                 jsonb_build_object('source', jsonb_build_object('name', 'sample.pdf', 'size', 1, 'mime', 'application/pdf', 'path', (select v from _in where k = 'path')),
                                    'pages', '[{"w":612,"h":792}]'::jsonb, 'lang', 'en', 'expiryDays', 30, 'hashes', jsonb_build_object('original', repeat('0', 64)))
          from p, d returning id),
    s1 as (insert into public.envelope_signers (tenant_id, envelope_id, name, email, role, sign_order) select p.t, e.id, 'Sample Signer One', (select v from _in where k = 'e1'), 'client', 1 from p, e returning id),
    s2 as (insert into public.envelope_signers (tenant_id, envelope_id, name, email, role, sign_order) select p.t, e.id, 'Sample Signer Two', (select v from _in where k = 'e2'), 'firm', 2 from p, e returning id),
    f as (insert into public.envelope_fields (tenant_id, envelope_id, signer_id, type, page, x, y, w, h, required, position)
          select p.t, e.id, s1.id, 'signature', 1, 0.1, 0.7, 0.3, 0.06, true, 0 from p, e, s1 union all
          select p.t, e.id, s1.id, 'date', 1, 0.45, 0.7, 0.2, 0.03, true, 1 from p, e, s1 union all
          select p.t, e.id, s2.id, 'signature', 1, 0.1, 0.82, 0.3, 0.06, true, 2 from p, e, s2 returning 1)
    select '@@R@@' || jsonb_build_object('envelope', (select id from e), 'doc', (select id from d), 's1', (select id from s1), 's2', (select id from s2), 'n', (select count(*) from f))::text;`,
    { t: co.tenantId, tag: tag + '-' + randomBytes(3).toString('hex'), ordered: String(ordered), path: up.json.file.path, e1, e2 });
  return { ...made, e1, e2, pdf };
}
const envelopeRow = (co, id) => S.sql(String.raw`select '@@R@@' || jsonb_build_object('status', e.status, 'events', jsonb_array_length(e.events), 'kinds', (select jsonb_agg(x ->> 'kind') from jsonb_array_elements(e.events) x),
    'signedFile', e.signed_file, 'hashes', e.extra -> 'hashes', 'consentText', e.extra ->> 'consentText',
    'signers', (select jsonb_agg(jsonb_build_object('status', s.status, 'ipHash', s.extra ->> 'ipHash', 'typed', s.typed_name) order by s.sign_order) from public.envelope_signers s where s.envelope_id = e.id),
    'links', (select count(*) from app.public_links l where l.signer_id in (select s.id from public.envelope_signers s where s.envelope_id = e.id)),
    'liveLinks', (select count(*) from app.public_links l where l.used_at is null and l.revoked_at is null and l.expires_at > now() and l.signer_id in (select s.id from public.envelope_signers s where s.envelope_id = e.id)),
    'doc', (select jsonb_build_object('status', d.status, 'versions', d.versions) from public.documents d where d.id = e.doc_id))::text
  from public.envelopes e where e.id = (select v from _in where k = 'id')::uuid;`, { id });
const consent = (co, approved) => S.sql(String.raw`
  with t as (insert into public.doc_templates (tenant_id, kind, name, lang, source, approved, extra) values ((select v from _in where k = 't')::uuid, 'custom', 'Consent', 'en', 'company', (select v from _in where k = 'a')::boolean, '{"use":"consent"}') returning id, tenant_id),
  b as (insert into public.doc_template_blocks (tenant_id, template_id, type, text, position) select tenant_id, id, 'p', 'I agree to sign this sample document electronically.', 0 from t returning 1)
  select '@@R@@' || jsonb_build_object('id', (select id from t), 'n', (select count(*) from b))::text;`, { t: co.tenantId, a: String(approved) });
const send = (co, envelope) => co.owner.post('/api/public/office/envelope_send', { tenant: co.tenantId, args: { p_envelope: envelope } });
const signBody = (token, more = {}) => ({ token, consent: true, typedName: 'Sample Signer', signature: PNG, values: {}, ...more });

test.before(async () => { S = await startStack(); });
test.after(async () => { if (S) await S.stop(); });

let co; let env1;

test('sending: refused without delivery, refused without an approved consent sentence, then sent to the first signer only', async () => {
  co = await S.company();
  env1 = await draftEnvelope(co, { ordered: true, tag: 'ord' });
  const tpl = await consent(co, false);

  // no email set up: the request stays a draft and the answer says delivery is not configured
  const key = process.env.RESEND_API_KEY; delete process.env.RESEND_API_KEY;
  const none = await send(co, env1.envelope);
  process.env.RESEND_API_KEY = key;
  assert.equal(none.status, 409); assert.equal(none.json.error, 'delivery_not_configured');
  assert.equal((await envelopeRow(co, env1.envelope)).status, 'draft');

  const blocked = await send(co, env1.envelope);
  assert.equal(blocked.status, 409); assert.equal(blocked.json.reason, 'consent_unapproved');
  await S.sql(String.raw`update public.doc_templates set approved = true, approved_at = now() where id = (select v from _in where k = 'id')::uuid; select '@@R@@' || 'true';`, { id: tpl.id });

  // the provider refuses: still a draft, no link works
  S.mail.status = 500;
  const failed = await send(co, env1.envelope);
  S.mail.status = 200;
  assert.equal(failed.status, 502); assert.equal(failed.json.error, 'delivery_failed');
  let row = await envelopeRow(co, env1.envelope);
  assert.equal(row.status, 'draft'); assert.equal(row.links, 0);

  const before = S.mail.sent.length;
  const sent = await send(co, env1.envelope);
  assert.equal(sent.status, 200, sent.text);
  assert.deepEqual({ status: sent.json.result.status, sentTo: sent.json.result.sentTo, delivery: sent.json.delivery }, { status: 'sent', sentTo: 1, delivery: 'sent' });
  assert.equal(S.mail.sent.length, before + 1, 'one email: the second signer waits for the first');
  assert.ok(S.mail.sent.at(-1).to.includes(env1.e1));
  row = await envelopeRow(co, env1.envelope);
  assert.equal(row.status, 'sent'); assert.deepEqual(row.signers.map((s) => s.status), ['sent', 'waiting']); assert.equal(row.liveLinks, 1);
  assert.equal(row.consentText, 'I agree to sign this sample document electronically.');
  // the fingerprint of the file as sent is the server's own, not the one the browser left on the draft
  assert.equal(row.hashes.original, sha(env1.pdf));
  assert.equal(row.doc.status, 'sent');
  // a second send of the same request is refused
  const again = await send(co, env1.envelope);
  assert.equal(again.status, 409); assert.equal(again.json.reason, 'not_draft');
});

test('a link that does not open: unknown, misshapen, expired, used and revoked tokens get one and the same answer', async () => {
  const v = S.visitor('203.0.113.10');
  const t1 = S.tokenFor(env1.e1);
  assert.match(t1, /^[A-Za-z0-9_-]{43}$/);
  const good = await v.post('/api/public/sign/view', { token: t1 });
  assert.equal(good.status, 200); assert.equal(good.json.view.state, 'open');
  // only the hash is stored
  const stored = await S.sql(String.raw`select '@@R@@' || jsonb_build_object('hash', (select count(*) from app.public_links where token_hash = (select v from _in where k = 'h')), 'plain', (select count(*) from app.public_links l where to_jsonb(l)::text like '%' || (select v from _in where k = 't') || '%'))::text;`, { h: sha(t1), t: t1 });
  assert.deepEqual(stored, { hash: 1, plain: 0 });

  // an expired link and a revoked one, made for the purpose
  const expired = randomBytes(32).toString('base64url'), revoked = randomBytes(32).toString('base64url');
  await S.sql(String.raw`
    insert into app.public_links (tenant_id, purpose, token_hash, signer_id, created_at, expires_at) values ((select v from _in where k = 't')::uuid, 'sign', (select v from _in where k = 'x'), (select v from _in where k = 's')::uuid, now() - interval '2 days', now() - interval '1 day');
    insert into app.public_links (tenant_id, purpose, token_hash, signer_id, expires_at, revoked_at) values ((select v from _in where k = 't')::uuid, 'sign', (select v from _in where k = 'r'), (select v from _in where k = 's')::uuid, now() + interval '1 day', now());
    select '@@R@@' || 'true';`, { t: co.tenantId, s: env1.s1, x: sha(expired), r: sha(revoked) });
  // a review link presented to the signing page is for another purpose
  const answers = [];
  for (const token of [randomBytes(32).toString('base64url'), expired, revoked, 'short', 'x'.repeat(43) + '!', '', 12345]) {
    for (const action of ['view', 'opened', 'submit', 'decline']) {
      const r = await S.visitor('203.0.113.' + (20 + answers.length % 200)).post('/api/public/sign/' + action, action === 'submit' ? signBody(token) : { token });
      answers.push(`${r.status} ${r.text}`);
    }
  }
  assert.equal(new Set(answers).size, 1, 'every refusal is the same: ' + [...new Set(answers)].join(' | '));
  assert.equal(answers[0], '404 {"ok":false,"error":"cannot_be_opened","reason":"unavailable"}');
  // closed to other sites: no permission header, and a POST from another origin is refused
  assert.equal(good.headers.get('access-control-allow-origin'), null);
  const cross = await v.post('/api/public/sign/view', { token: t1 }, { origin: 'https://other.example.com' });
  assert.equal(cross.status, 403);
  const pre = await S.api.public.OPTIONS(new Request(ORIGIN + '/api/public/sign/view', { method: 'OPTIONS', headers: { origin: 'https://other.example.com', 'access-control-request-method': 'POST' } }));
  assert.equal(pre.status, 405); assert.equal(pre.headers.get('access-control-allow-origin'), null);
  // too large a body for a route that needs a few bytes
  const big = await v.post('/api/public/sign/view', { token: t1, pad: 'x'.repeat(5000) });
  assert.equal(big.status, 413);
});

test('an ordered request with two signers, from the first signature to the signed copy', async () => {
  const a = S.visitor('203.0.113.50'), b = S.visitor('203.0.113.51');
  const t1 = S.tokenFor(env1.e1);
  assert.equal((await a.post('/api/public/sign/opened', { token: t1 })).status, 200);
  assert.equal((await a.post('/api/public/sign/opened', { token: t1 })).status, 200);
  let row = await envelopeRow(co, env1.envelope);
  assert.deepEqual(row.signers.map((s) => s.status), ['viewed', 'waiting']);
  assert.equal(row.kinds.filter((k) => k === 'viewed').length, 1, 'an opening is recorded once');

  // the rules refuse, in the words the page expects
  const noConsent = await a.post('/api/public/sign/submit', signBody(t1, { consent: false }));
  assert.equal(noConsent.status, 409); assert.equal(noConsent.json.reason, 'no_consent');
  const badInk = await a.post('/api/public/sign/submit', signBody(t1, { signature: 'data:text/html;base64,AAAA' }));
  assert.equal(badInk.json.reason, 'bad_signature');

  const mails = S.mail.sent.length;
  const first = await a.post('/api/public/sign/submit', signBody(t1, { typedName: 'Sample Signer One' }));
  assert.equal(first.status, 200, first.text); assert.deepEqual(first.json, { ok: true, completed: false });
  assert.equal(S.mail.sent.length, mails + 1); assert.ok(S.mail.sent.at(-1).to.includes(env1.e2), 'the next signer gets their link');
  row = await envelopeRow(co, env1.envelope);
  assert.equal(row.status, 'partly_signed'); assert.deepEqual(row.signers.map((s) => s.status), ['signed', 'sent']);
  assert.match(row.signers[0].ipHash, /^[0-9a-f]{64}$/, 'the address is kept as a salted hash');
  assert.ok(!JSON.stringify(row).includes('203.0.113.50'));

  // the same answer sent again: the same reply, and nothing changes
  const events = row.events;
  const replay = await a.post('/api/public/sign/submit', signBody(t1, { typedName: 'Sample Signer One' }));
  assert.equal(replay.status, 200); assert.deepEqual(replay.json, { ok: true, completed: false });
  assert.equal(S.mail.sent.length, mails + 1, 'no second email');
  assert.equal((await envelopeRow(co, env1.envelope)).events, events);
  // a different answer with the used link is just a link that does not open
  const other = await a.post('/api/public/sign/submit', signBody(t1, { typedName: 'Somebody Else' }));
  assert.equal(other.status, 404); assert.equal(other.json.error, 'cannot_be_opened');
  assert.equal((await a.post('/api/public/sign/view', { token: t1 })).status, 404);

  const t2 = S.tokenFor(env1.e2);
  const seenBy2 = await b.post('/api/public/sign/view', { token: t2 });
  assert.equal(seenBy2.json.view.state, 'open');
  assert.ok(!JSON.stringify(seenBy2.json.view.people).includes('@'), 'nobody else\'s address is shown');
  assert.ok(seenBy2.json.view.fileUrl.startsWith('/api/public/sign/file?k='));
  const file = await b.get(seenBy2.json.view.fileUrl);
  assert.equal(file.status, 200); assert.equal(sha(file.bytes), sha(env1.pdf));
  assert.equal((await b.get('/api/public/sign/file?k=' + 'A'.repeat(80))).status, 404);

  const last = await b.post('/api/public/sign/submit', signBody(t2, { typedName: 'Sample Signer Two' }));
  assert.equal(last.status, 200, last.text); assert.deepEqual(last.json, { ok: true, completed: true });
  row = await envelopeRow(co, env1.envelope);
  assert.equal(row.status, 'completed'); assert.deepEqual(row.signers.map((s) => s.status), ['signed', 'signed']); assert.equal(row.liveLinks, 0);
  // the signed copy: stored privately, with its fingerprints, as a new version of the document
  assert.ok(row.signedFile && row.signedFile.path.startsWith(co.tenantId + '/signature/'), 'signed file path');
  for (const k of ['original', 'signed', 'final']) assert.match(row.hashes[k], /^[0-9a-f]{64}$/);
  assert.equal(row.hashes.original, sha(env1.pdf));
  assert.notEqual(row.hashes.signed, row.hashes.original); assert.notEqual(row.hashes.final, row.hashes.signed);
  const { storage } = await import('../../api/_lib/supabase.js');
  const stored = await storage.download(process.env.SUPABASE_SERVICE_ROLE_KEY, 'workspace-files', row.signedFile.path);
  assert.equal(stored.ok, true);
  const bytes = Buffer.from(await stored.response.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.equal(sha(bytes), row.hashes.final, 'the stored file is the one whose fingerprint was recorded');
  assert.equal(bytes.length, row.signedFile.size);
  const version = row.doc.versions.at(-1);
  assert.equal(version.kind, 'signed'); assert.equal(version.file.path, row.signedFile.path); assert.equal(version.hashes.final, row.hashes.final);
  assert.equal(row.doc.status, 'signed');
  assert.deepEqual(row.kinds.slice(-3), ['signed', 'completed', 'signed_copy']);
  // the owner of the company can read it through the workspace route; a visitor cannot
  const link = await co.owner.post('/api/ws/file/url', { tenant: co.tenantId, path: row.signedFile.path });
  assert.equal(link.status, 200, link.text);
});

test('two signers answering at the same moment: both signatures land', async () => {
  const e = await draftEnvelope(co, { ordered: false, tag: 'par' });
  const sent = await send(co, e.envelope);
  assert.equal(sent.status, 200, sent.text); assert.equal(sent.json.result.sentTo, 2);
  const t1 = S.tokenFor(e.e1), t2 = S.tokenFor(e.e2);
  const [r1, r2] = await Promise.all([
    S.visitor('203.0.113.60').post('/api/public/sign/submit', signBody(t1, { typedName: 'Sample Signer One' })),
    S.visitor('203.0.113.61').post('/api/public/sign/submit', signBody(t2, { typedName: 'Sample Signer Two' })),
  ]);
  assert.equal(r1.status, 200, r1.text); assert.equal(r2.status, 200, r2.text);
  assert.equal([r1.json.completed, r2.json.completed].filter(Boolean).length, 1, 'exactly one of them completed the request');
  const row = await envelopeRow(co, e.envelope);
  assert.equal(row.status, 'completed');
  assert.deepEqual(row.signers.map((s) => [s.status, s.typed]), [['signed', 'Sample Signer One'], ['signed', 'Sample Signer Two']]);
  assert.equal(row.kinds.filter((k) => k === 'signed').length, 2);
  assert.ok(row.signedFile, 'the signed copy was made');
  // the same token twice at once: one signature, one answer
  const d = await draftEnvelope(co, { ordered: false, tag: 'dup' });
  assert.equal((await send(co, d.envelope)).status, 200);
  const td = S.tokenFor(d.e1);
  const both = await Promise.all([1, 2].map((i) => S.visitor('203.0.113.7' + i).post('/api/public/sign/submit', signBody(td, { typedName: 'Sample Signer One' }))));
  assert.deepEqual(both.map((r) => r.status), [200, 200]);
  assert.equal((await envelopeRow(co, d.envelope)).kinds.filter((k) => k === 'signed').length, 1);
});

test('declining closes the request for everyone, and the daily pass expires and reminds', async () => {
  const e = await draftEnvelope(co, { ordered: false, tag: 'dec' });
  assert.equal((await send(co, e.envelope)).status, 200);
  const t1 = S.tokenFor(e.e1), t2 = S.tokenFor(e.e2);
  assert.equal((await S.visitor('203.0.113.80').post('/api/public/sign/decline', { token: t1, reason: 'Not the right document' })).status, 200);
  const row = await envelopeRow(co, e.envelope);
  assert.equal(row.status, 'declined'); assert.equal(row.liveLinks, 0);
  assert.equal((await S.visitor('203.0.113.81').post('/api/public/sign/view', { token: t2 })).status, 404, 'the other signer\'s link no longer opens');

  // one request past its date, one whose reminder is due
  const x = await draftEnvelope(co, { ordered: true, tag: 'exp' }), r = await draftEnvelope(co, { ordered: true, tag: 'rem' });
  assert.equal((await send(co, x.envelope)).status, 200); assert.equal((await send(co, r.envelope)).status, 200);
  const old = S.tokenFor(r.e1);
  await S.sql(String.raw`update public.envelopes set expires_at = now() - interval '1 hour' where id = (select v from _in where k = 'x')::uuid;
    update public.envelopes set sent_at = now() - interval '4 days' where id = (select v from _in where k = 'r')::uuid; select '@@R@@' || 'true';`, { x: x.envelope, r: r.envelope });
  const mails = S.mail.sent.length;
  const { sweepAll } = await import('../../api/_lib/esign/send.js');
  const out = await sweepAll();
  assert.equal(out.expired, 1); assert.equal(out.reminded, 1);
  assert.equal((await envelopeRow(co, x.envelope)).status, 'expired');
  assert.equal(S.mail.sent.length, mails + 1); assert.match(S.mail.sent.at(-1).subject, /^Reminder/);
  const fresh = S.tokenFor(r.e1);
  assert.notEqual(fresh, old);
  assert.equal((await S.visitor('203.0.113.82').post('/api/public/sign/view', { token: old })).status, 404, 'the earlier link was taken back');
  assert.equal((await S.visitor('203.0.113.82').post('/api/public/sign/view', { token: fresh })).status, 200);
  assert.equal((await sweepAll()).reminded, 0, 'not reminded twice in a row');
});

test('rate limits: per token and per address', async () => {
  const token = randomBytes(32).toString('base64url');
  let limited = null;
  // (more tries than twice the limit: the counting window may turn over once while this runs)
  for (let i = 0; i < 70 && !limited; i += 1) {
    const r = await S.visitor('198.51.100.' + (100 + i)).post('/api/public/sign/view', { token });
    if (r.status === 429) limited = r;
  }
  assert.ok(limited, 'the same token from many addresses is limited');
  assert.equal(limited.json.error, 'rate_limited'); assert.ok(Number(limited.headers.get('retry-after')) > 0);
  const one = S.visitor('203.0.113.250');
  let hit = null;
  for (let i = 0; i < 130 && !hit; i += 1) { const r = await one.post('/api/public/sign/view', { token: randomBytes(32).toString('base64url') }); if (r.status === 429) hit = r; }
  assert.ok(hit, 'one address trying many tokens is limited');
});

async function reviewDraft(co2, { optOut = false } = {}) {
  return S.sql(String.raw`
    with c as (insert into public.clients (tenant_id, name, email, email_opt_out) values ((select v from _in where k = 't')::uuid, 'Sample Client ' || (select v from _in where k = 'n'), 'client-' || (select v from _in where k = 'n') || '@example.com', (select v from _in where k = 'o')::boolean) returning id, email),
    r as (insert into public.review_requests (tenant_id, client_id, channel, status) select (select v from _in where k = 't')::uuid, id, 'email', 'draft' from c returning id)
    select '@@R@@' || jsonb_build_object('review', (select id from r), 'client', (select id from c), 'email', (select email from c))::text;`, { t: co2.tenantId, n: randomBytes(4).toString('hex'), o: String(optOut) });
}
const reviewRow = (id) => S.sql(String.raw`select '@@R@@' || jsonb_build_object('status', r.status, 'rating', r.rating, 'comment', r.comment, 'token', r.extra ? 'token',
    'message', (select jsonb_build_object('status', m.status, 'body', m.body, 'provider', m.provider, 'external', m.external_id, 'extra', m.extra) from public.messages m where m.id::text = r.extra ->> 'messageId'),
    'tasks', (select coalesce(jsonb_agg(jsonb_build_object('title', t.title, 'pri', t.pri, 'client', t.client_id)), '[]'::jsonb) from public.tasks t where t.auto = 'review-low:' || r.id))::text
  from public.review_requests r where r.id = (select v from _in where k = 'id')::uuid;`, { id });

test('reviews: sent by the server, a high rating and a low one, the public link after both', async () => {
  await S.sql(String.raw`update public.tenants set settings = settings || '{"reviews":{"publicUrl":"https://reviews.example.com/sample-company","linkDays":30}}'::jsonb where id = (select v from _in where k = 't')::uuid; select '@@R@@' || 'true';`, { t: co.tenantId });
  const high = await reviewDraft(co), low = await reviewDraft(co), out = await reviewDraft(co, { optOut: true });
  const refused = await co.owner.post('/api/public/office/review_send', { tenant: co.tenantId, args: { p_review: out.review } });
  assert.equal(refused.status, 409); assert.equal(refused.json.reason, 'opted_out');

  for (const r of [high, low]) {
    const q = await co.owner.post('/api/public/office/review_send', { tenant: co.tenantId, args: { p_review: r.review } });
    assert.equal(q.status, 200, q.text); assert.equal(q.json.result.queued, true);
  }
  let row = await reviewRow(high.review);
  assert.equal(row.status, 'draft', 'not "sent" before a provider accepted the email');
  assert.equal(row.message.status, 'queued'); assert.ok(row.message.body.includes('{{link}}') && !row.message.body.includes('/review/'), 'the stored text holds no link');
  const twice = await co.owner.post('/api/public/office/review_send', { tenant: co.tenantId, args: { p_review: high.review } });
  assert.equal(twice.status, 409); assert.equal(twice.json.reason, 'already_queued');

  const ran = await S.cron('tick');
  assert.equal(ran.ok, true); assert.equal(ran.dead, 0);
  row = await reviewRow(high.review);
  assert.equal(row.status, 'sent'); assert.equal(row.message.status, 'sent'); assert.equal(row.message.provider, 'resend'); assert.match(row.message.external, /^email_/);
  assert.equal(row.message.extra.link, undefined, 'the sealed link is dropped once the message went out');
  assert.equal(row.token, false, 'no token on the record');

  const th = S.tokenFor(high.email), tl = S.tokenFor(low.email);
  const v = S.visitor('203.0.113.90');
  const opened = await v.get('/api/public/review/' + th);
  assert.equal(opened.status, 200);
  assert.deepEqual(opened.json, { ok: true, company: 'Sample Company ' + co.slug, firstName: 'Sample', state: 'open', publicUrl: 'https://reviews.example.com/sample-company' });
  assert.equal((await reviewRow(high.review)).status, 'opened');
  assert.equal((await v.post('/api/public/review/' + th, { rating: 9, comment: '' })).status, 400);

  const five = await v.post('/api/public/review/' + th, { rating: 5, comment: 'Everything went well.' });
  assert.equal(five.status, 200); assert.deepEqual(five.json, { ok: true, publicUrl: 'https://reviews.example.com/sample-company' });
  row = await reviewRow(high.review);
  assert.deepEqual({ status: row.status, rating: row.rating, comment: row.comment, tasks: row.tasks.length }, { status: 'rated', rating: 5, comment: 'Everything went well.', tasks: 0 });

  const two = await v.post('/api/public/review/' + tl, { rating: 2, comment: 'The visit started late.' });
  assert.equal(two.status, 200);
  assert.deepEqual(two.json, { ok: true, low: true, publicUrl: 'https://reviews.example.com/sample-company' }, 'a low rating is shown the public link too');
  row = await reviewRow(low.review);
  assert.equal(row.status, 'rated'); assert.equal(row.tasks.length, 1); assert.equal(row.tasks[0].pri, 'high'); assert.equal(row.tasks[0].client, low.client);
  assert.match(row.tasks[0].title, /2 of 5/);
  // the same answer again: the same reply, still one task. Anything else with a used link: it does not open.
  const again = await v.post('/api/public/review/' + tl, { rating: 2, comment: 'The visit started late.' });
  assert.equal(again.status, 200); assert.equal((await reviewRow(low.review)).tasks.length, 1);
  const cant = [await v.post('/api/public/review/' + tl, { rating: 5, comment: '' }), await v.get('/api/public/review/' + tl), await v.get('/api/public/review/' + randomBytes(32).toString('base64url')),
    await v.get('/api/public/review/short'), await v.post('/api/public/review/' + th, { decline: true })];
  assert.equal(new Set(cant.map((r) => `${r.status} ${r.text}`)).size, 1);
  assert.equal(cant[0].json.error, 'cannot_be_opened');
  // a signing link is not a review link
  assert.equal((await v.get('/api/public/review/' + S.tokenFor(env1.e2))).status, 404);
});

test('website form: validated, quiet about what it knows, one lead per person and per submission', async () => {
  const leads = () => S.sql(String.raw`select '@@R@@' || coalesce(jsonb_agg(jsonb_build_object('name', l.name, 'email', l.email, 'source', l.source, 'status', l.status, 'ticket', l.ticket, 'again', l.extra ->> 'intakeAgain',
      'consent', l.extra -> 'consent', 'sms', l.sms_opt_in, 'message', l.extra ->> 'message') order by l.created_at), '[]'::jsonb)::text from public.leads l where l.tenant_id = (select v from _in where k = 't')::uuid;`, { t: co.tenantId });
  // the key is made from settings, after a fresh identity check, and shown once
  const noStep = await co.owner.post('/api/public/office/intake_key_rotate', { tenant: co.tenantId, args: {} });
  assert.equal(noStep.status, 403); assert.equal(noStep.json.error, 'stepup_required');
  assert.equal((await co.owner.post('/api/auth/stepup', { password: co.password })).status, 200);
  const made = await co.owner.post('/api/public/office/intake_key_rotate', { tenant: co.tenantId, args: {} });
  assert.equal(made.status, 200, made.text);
  const key = made.json.result.key;
  assert.match(key, /^[0-9a-f]{64}$/);
  const state = await co.owner.post('/api/public/office/intake_key_state', { tenant: co.tenantId, args: {} });
  assert.equal(state.json.result.active, true); assert.ok(!state.text.includes(key));

  const form = { name: 'Sample Prospect', email: 'Prospect.One@example.com', phone: '(555) 010-0142', service: 'Kitchen', message: 'Please call me about a quote.', consent: true, consentText: 'I agree to be contacted about my request.', smsOptIn: true, idem: 'form-submission-0001' };
  const v = S.visitor('203.0.113.120');
  const first = await v.post('/api/public/intake/' + key, form, { origin: 'https://www.sample-company.example.com' });
  assert.equal(first.status, 200); assert.deepEqual(first.json, { ok: true });
  let list = await leads();
  assert.equal(list.length, 1);
  assert.deepEqual({ name: list[0].name, email: list[0].email, source: list[0].source, status: list[0].status, sms: list[0].sms, message: list[0].message },
    { name: 'Sample Prospect', email: 'prospect.one@example.com', source: 'website', status: 'new', sms: true, message: 'Please call me about a quote.' });
  assert.equal(list[0].consent.text, 'I agree to be contacted about my request.'); assert.ok(!Number.isNaN(Date.parse(list[0].consent.at))); assert.match(list[0].consent.ipHash, /^[0-9a-f]{64}$/);

  // the same submission again (a retry): no second lead
  assert.deepEqual((await v.post('/api/public/intake/' + key, form)).json, { ok: true });
  assert.equal((await leads()).length, 1);
  // the same person through a new submission: found as a duplicate, noted on the lead that exists
  assert.deepEqual((await v.post('/api/public/intake/' + key, { ...form, idem: 'form-submission-0002', name: 'S. Prospect' })).json, { ok: true });
  list = await leads();
  assert.equal(list.length, 1); assert.equal(list[0].again, '1');
  // an ordinary HTML form post from the company's site, for someone new
  const posted = await v.call('POST', '/api/public/intake/' + key, { raw: new URLSearchParams({ name: 'Second Prospect', phone: '555-010-0177', website: '' }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(posted.status, 200);
  list = await leads();
  assert.equal(list.length, 2); assert.equal(list[1].consent, null); assert.equal(list[1].sms, null);
  assert.notEqual(list[1].ticket, list[0].ticket);

  // refusals. The hidden field and an unknown key get the usual answer and store nothing.
  assert.deepEqual((await v.post('/api/public/intake/' + key, { ...form, idem: 'form-submission-0003', email: 'robot@example.com', phone: '', website: 'https://spam.example.com' })).json, { ok: true });
  assert.deepEqual((await v.post('/api/public/intake/' + sha('unknown'), { ...form, idem: 'form-submission-0004', email: 'nobody@example.com', phone: '' })).json, { ok: true });
  assert.equal((await leads()).length, 2);
  const bad = await v.post('/api/public/intake/' + key, { name: 'X', email: 'not-an-address' });
  assert.equal(bad.status, 400); assert.equal(bad.json.reason, 'name');
  assert.equal((await v.post('/api/public/intake/' + key, { name: 'Sample Person', email: 'not-an-address' })).json.reason, 'email');
  assert.equal((await v.post('/api/public/intake/' + key, { name: 'Sample Person' })).json.reason, 'contact');
  assert.equal((await v.post('/api/public/intake/' + key, { name: 'Sample Person', email: 'a@example.com', message: 'x'.repeat(20000) })).status, 413);
  // replacing the key stops the old one
  const next = await co.owner.post('/api/public/office/intake_key_rotate', { tenant: co.tenantId, args: {} });
  assert.notEqual(next.json.result.key, key);
  assert.deepEqual((await S.visitor('203.0.113.121').post('/api/public/intake/' + key, { ...form, idem: 'form-submission-0005', email: 'late@example.com', phone: '' })).json, { ok: true });
  assert.equal((await leads()).length, 2);
  // one address cannot flood a form
  let limited = false;
  for (let i = 0; i < 14 && !limited; i += 1) limited = (await S.visitor('203.0.113.122').post('/api/public/intake/' + next.json.result.key, { name: 'Sample Flood', email: `flood${i}@example.com`, idem: 'flood-submission-' + i })).status === 429;
  assert.ok(limited);
});

test('outgoing messages: consent checked again, no connected provider means failed, never sent', async () => {
  const made = await S.sql(String.raw`
    with c as (insert into public.clients (tenant_id, name, email, email_opt_out, sms_opt_in) values
        ((select v from _in where k = 't')::uuid, 'Sample Reader', 'reader@example.com', false, false),
        ((select v from _in where k = 't')::uuid, 'Sample Opted Out', 'optout@example.com', true, false) returning id, email),
    m as (insert into public.messages (tenant_id, channel, recipient, subject, body, status, dir, client_id)
          select (select v from _in where k = 't')::uuid, x.channel, c.email, 'Sample subject', 'Sample body', 'queued', 'out', c.id
          from c join (values ('reader@example.com', 'email'), ('optout@example.com', 'email'), ('reader@example.com', 'text')) x(email, channel) on x.email = c.email returning id, recipient, channel)
    select '@@R@@' || (select jsonb_agg(jsonb_build_object('id', id, 'to', recipient, 'channel', channel)) from m)::text;`, { t: co.tenantId });
  const mails = S.mail.sent.length;
  const ran = await S.cron('tick');
  assert.equal(ran.ok, true); assert.equal(ran.dead, 0);
  const after = await S.sql(String.raw`select '@@R@@' || jsonb_object_agg(m.recipient || '/' || m.channel, jsonb_build_object('status', m.status, 'error', m.error, 'external', m.external_id))::text
    from public.messages m where m.id = any (string_to_array((select v from _in where k = 'ids'), ',')::uuid[]);`, { ids: made.map((m) => m.id).join(',') });
  assert.deepEqual(after['reader@example.com/email'], { status: 'failed', error: 'not_connected', external: null });
  assert.deepEqual(after['optout@example.com/email'], { status: 'failed', error: 'opted_out', external: null });
  assert.deepEqual(after['reader@example.com/text'], { status: 'failed', error: 'no_consent', external: null });
  assert.equal(S.mail.sent.slice(mails).filter((m) => m.to.some((x) => /reader@|optout@/.test(x))).length, 0, 'nothing left the server for them');
  // running again changes nothing: the outcome of a message is written once
  const { deliver } = await import('../../api/_lib/pipeline/deliver.js');
  assert.equal(await deliver(co.tenantId, made[0].id), 'skipped');
});

test('an incoming text is stored before the provider is answered, a repeat adds nothing, and STOP switches consent off', async () => {
  const webhooks = await import('../../api/webhooks.js');
  const sid = 'AC' + randomBytes(16).toString('hex'); const token = randomBytes(16).toString('hex');
  Object.assign(process.env, { SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, SMS_FROM_NUMBER: '+15555550100' }); secrets.add(token);
  const q = '?t=' + co.tenantId;
  const hook = async (fields) => {
    const signature = createHmac('sha1', token).update(ORIGIN + '/api/webhooks/sms' + q + Object.keys(fields).sort().map((k) => k + fields[k]).join('')).digest('base64');
    const res = await webhooks.POST(new Request(ORIGIN + '/api/webhooks/sms' + q, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature, 'x-real-ip': '203.0.113.88' }, body: new URLSearchParams(fields).toString() }));
    const text = await res.text(); seen.push(text);
    return { status: res.status, type: res.headers.get('content-type'), text };
  };
  const stored = (id) => S.sql(String.raw`select '@@R@@' || coalesce((select jsonb_agg(jsonb_build_object('channel', m.channel, 'dir', m.dir, 'body', m.body, 'sender', m.sender, 'provider', m.provider, 'status', m.status)) from public.messages m
    where m.tenant_id = (select v from _in where k = 't')::uuid and m.external_id = (select v from _in where k = 'id')), '[]'::jsonb)::text;`, { t: co.tenantId, id });
  const TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  try {
    const m1 = 'SM' + randomBytes(16).toString('hex');
    const fields = { MessageSid: m1, SmsSid: m1, AccountSid: sid, From: '+15555550142', To: '+15555550100', Body: 'A sample question', NumSegments: '1', NumMedia: '0' };
    // Twilio reads the answer as instructions: an empty document, not JSON
    assert.deepEqual(await hook(fields), { status: 200, type: 'text/xml; charset=utf-8', text: TWIML });
    assert.deepEqual(await stored(m1), [{ channel: 'text', dir: 'in', body: 'A sample question', sender: '+15555550142', provider: 'sms', status: 'received' }]);
    assert.deepEqual(await hook(fields), { status: 200, type: 'text/xml; charset=utf-8', text: TWIML }, 'the same webhook again');
    assert.equal((await stored(m1)).length, 1, 'stored once');
    const ev = await S.sql(String.raw`select '@@R@@' || (select jsonb_agg(jsonb_build_object('tenant', e.tenant_id, 'redacted', e.redacted)) from app.webhook_events e where e.provider = 'sms' and e.signature_ok)::text;`);
    assert.equal(ev.length, 1); assert.equal(ev[0].tenant, co.tenantId);
    assert.ok(!JSON.stringify(ev).includes('sample question') && !JSON.stringify(ev).includes('5555550142'), 'the webhook log keeps no text and no number');

    // STOP: the switch for this number goes off, by the provider's word, with nobody signed in
    const m2 = 'SM' + randomBytes(16).toString('hex');
    assert.equal((await hook({ ...fields, MessageSid: m2, SmsSid: m2, Body: 'STOP' })).status, 200);
    const consentRow = await S.sql(String.raw`select '@@R@@' || coalesce((select jsonb_agg(jsonb_build_object('status', c.status, 'source', c.source, 'revoked', c.revoked_at is not null)) from public.messaging_consents c
      where c.tenant_id = (select v from _in where k = 't')::uuid and c.channel = 'text' and c.address = '+15555550142'), '[]'::jsonb)::text;`, { t: co.tenantId });
    assert.deepEqual(consentRow, [{ status: 'opted_out', source: 'keyword', revoked: true }]);
  } finally { for (const k of ['SMS_PROVIDER', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'SMS_FROM_NUMBER']) delete process.env[k]; }
});

test('the office operations answer under /api/ws/rpc too, with the same checks', async () => {
  const rpc = (name, args = {}, who = co.owner) => who.post('/api/ws/rpc/' + name, { tenant: co.tenantId, args });
  const state = await rpc('intake_key_state');
  assert.equal(state.status, 200, state.text); assert.equal(state.json.ok, true);
  const same = await co.owner.post('/api/public/office/intake_key_state', { tenant: co.tenantId, args: {} });
  assert.deepEqual(state.json.result, same.json.result, 'one operation, two addresses');
  // sending a signature request that does not exist: the database refuses, as it does under the other address
  const missing = await rpc('envelope_send', { p_envelope: '99999999-9999-4999-8999-999999999999' });
  const missingOffice = await co.owner.post('/api/public/office/envelope_send', { tenant: co.tenantId, args: { p_envelope: '99999999-9999-4999-8999-999999999999' } });
  assert.ok(missing.status >= 400 && missing.status < 500, missing.text);
  assert.deepEqual([missing.status, missing.json], [missingOffice.status, missingOffice.json]);
  // replacing the website form key needs a fresh identity check
  await S.sql(String.raw`update app.session_stamps set stepup_at = now() - interval '20 minutes'; select '@@R@@' || '1';`);
  const stale = await rpc('intake_key_rotate', { p_active: true });
  assert.deepEqual([stale.status, stale.json.error], [403, 'stepup_required'], stale.text);
  // finance: reading what is unmatched is on the list and decided by the database (nothing is connected: an empty list or a refusal, never a 404)
  const fin = await rpc('finance_unmatched');
  assert.notEqual(fin.status, 404, fin.text); assert.notEqual(fin.json.error, 'unknown_operation');
  assert.equal((await rpc('drop_everything')).json.error, 'unknown_operation');
});

test('the scheduled runs include the new jobs, and nothing secret or token-shaped was sent to a browser', async () => {
  const daily = await S.cron('daily');
  assert.equal(daily.ok, true, JSON.stringify(daily)); assert.equal(daily.dead, 0); assert.equal(daily.retried, 0);
  const kinds = await S.sql(String.raw`select '@@R@@' || jsonb_object_agg(kind, n)::text from (select kind, count(*) n from app.jobs where status = 'done' group by kind) x;`);
  for (const k of ['esign.sweep', 'vault.expire', 'public.purge', 'owner.summary', 'appointments.sweep', 'messages.deliver', 'maintenance.sweep']) assert.ok(kinds[k] >= 1, 'ran: ' + k);
  const summary = S.mail.sent.filter((m) => /daily summary/i.test(m.subject));
  assert.ok(summary.length >= 1, 'the owner summary went out');
  assert.ok(!/Sample (Client|Prospect|Signer|Reader)/.test(summary[0].subject + summary[0].text), 'counts only: nobody is named');
  // no queue row holds a link token or an address in the clear
  const jobs = await S.sql(String.raw`select '@@R@@' || coalesce(jsonb_agg(payload), '[]'::jsonb)::text from app.jobs;`);
  // (the test client notes each address it called on the first line of what it saw; a review address carries its token, so that line is left out)
  const all = seen.map((x) => x.replace(/^\d{3} \S+\n/, '')).join('\n') + JSON.stringify(jobs);
  for (const t of tokens) { assert.ok(!all.includes(t), 'a link token appears in an answer or in the queue'); assert.ok(!all.includes(sha(t)), 'a token hash appears in an answer'); }
  assertNoLeak(assert);
});
