// Unit tests of the public endpoints: token handling and every handler's refusals, with no database.
// Calls to the Supabase address are answered from memory by a small stand-in: each test says what the database
// "returns", and the stand-in records which functions were called and with what.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { setTestEnv, ORIGIN } from './helpers.mjs';

setTestEnv({ SUPABASE_URL: 'http://127.0.0.1:4749', SUPABASE_ANON_KEY: 'anon-key-for-unit-tests', SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-unit-tests-0123456789' });
const { resetMemoryLimits } = await import('../../api/_lib/ratelimit.js');
const core = await import('../../api/_lib/public/core.js');
const api = await import('../../api/public.js');
const { intakeFields } = await import('../../api/_lib/public/intake.js');
const { consentProblem, deliver, ROUTES } = await import('../../api/_lib/pipeline/deliver.js');
const { summaryEmail } = await import('../../api/_lib/pipeline/summary.js');
const { signerEmail, notice, sendOrQueue, openNotice } = await import('../../api/_lib/esign/emails.js');
const { sealToken } = await import('../../api/_lib/crypto.js');

const sha = (v) => createHash('sha256').update(v).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const calls = [];
let db = {};       // function name -> value, or (args) => value
let resend = null; // (body, headers) => Response, when a test lets email through
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.resend.com/emails')) { if (!resend) throw new Error('no email expected'); return resend(JSON.parse(init.body), init.headers); }
  const m = /\/rest\/v1\/rpc\/([a-z_]+)$/.exec(u);
  if (!m) throw new Error('unexpected call: ' + u.slice(0, 60));
  const args = JSON.parse(init.body || '{}');
  calls.push({ name: m[1], args });
  // the rate limit tables are "unreachable", so limits are counted in memory, which is what these tests reset
  if (['rate_hit', 'security_event'].includes(m[1])) return new Response('{"message":"down"}', { status: 500 });
  const v = Object.hasOwn(db, m[1]) ? db[m[1]] : null;
  return new Response(JSON.stringify(typeof v === 'function' ? v(args) : v), { status: 200 });
};
test.after(() => { globalThis.fetch = realFetch; });
test.beforeEach(() => { calls.length = 0; db = {}; resend = null; resetMemoryLimits(); delete process.env.RESEND_API_KEY; delete process.env.SYSTEM_EMAIL_FROM; });

const call = async (method, url, { body, raw, headers = {}, address = '198.51.100.7' } = {}) => {
  const h = { 'x-real-ip': address, ...headers };
  let payload;
  if (raw !== undefined) payload = raw; else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = h['content-type'] || 'application/json'; }
  const res = await api[method](new Request(ORIGIN + url, { method, headers: h, body: payload }));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, text, json, headers: res.headers };
};
const CANNOT = '404 {"ok":false,"error":"cannot_be_opened","reason":"unavailable"}';

test('a link token: 256 random bits, 43 URL-safe characters, stored as a SHA-256 hash', () => {
  const a = core.newToken(), b = core.newToken();
  assert.match(a, core.TOKEN); assert.notEqual(a, b);
  assert.equal(Buffer.from(a, 'base64url').length, 32);
  assert.equal(core.hashToken(a), sha(a)); assert.match(core.hashToken(a), /^[0-9a-f]{64}$/);
  for (const bad of ['', 'short', a + 'x', a.slice(1), a.slice(0, 42) + '!', a.slice(0, 42) + ' ', 12345, null, undefined, {}, [a]]) assert.equal(core.isToken(bad), false);
  assert.equal(core.isToken(a), true);
});

test('signing: an unknown or misshapen token gets the one refusal on every call, and the database is asked by hash only', async () => {
  const t = token();
  const answers = [];
  for (const tok of [t, 'short', t + 'x', '', 42, null, { a: 1 }]) {
    for (const action of ['view', 'opened', 'submit', 'decline']) {
      resetMemoryLimits();
      const r = await call('POST', '/api/public/sign/' + action, { body: { token: tok, consent: true, typedName: 'Sample Signer', signature: 'data:image/png;base64,AAAA', values: {} } });
      answers.push(`${r.status} ${r.text}`);
    }
  }
  assert.deepEqual([...new Set(answers)], [CANNOT]);
  const opened = calls.filter((c) => c.name === 'sign_open');
  assert.equal(opened.length, 4, 'only the well-shaped token reached the database');
  for (const c of opened) assert.equal(c.args.p_token_hash, sha(t));
  assert.ok(!JSON.stringify(calls).includes(t), 'the token itself is never sent to the database');
});

test('signing: wrong method, wrong type, too large, another site, unknown address', async () => {
  const t = token();
  assert.equal((await call('GET', '/api/public/sign/view')).status, 405);
  assert.equal((await call('POST', '/api/public/sign/view', { raw: 'token=' + t, headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status, 415);
  assert.equal((await call('POST', '/api/public/sign/view', { raw: '{not json', headers: { 'content-type': 'application/json' } })).json.error, 'invalid_json');
  assert.equal((await call('POST', '/api/public/sign/view', { body: { token: t, pad: 'x'.repeat(3000) } })).status, 413);
  assert.equal((await call('POST', '/api/public/sign/decline', { body: { token: t, reason: 'x'.repeat(9000) } })).status, 413);
  assert.equal((await call('POST', '/api/public/sign/submit', { body: { token: t, signature: 'x'.repeat(600 * 1024) } })).status, 413);
  assert.equal((await call('POST', '/api/public/sign/view', { body: { token: t }, headers: { origin: 'https://other.example.com' } })).json.error, 'bad_origin');
  assert.equal((await call('POST', '/api/public/sign/view', { body: { token: t }, headers: { 'sec-fetch-site': 'cross-site' } })).json.error, 'bad_origin');
  assert.equal((await call('POST', '/api/public/sign/view', { body: { token: t }, headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin' } })).status, 404);
  assert.equal((await call('POST', '/api/public/sign/everything', { body: { token: t } })).json.error, 'not_found');
  assert.equal((await call('POST', '/api/public/nothing/here', { body: {} })).json.error, 'not_found');
  assert.equal((await call('POST', '/api/public/sign/view/extra', { body: { token: t } })).json.error, 'not_found');
  const pre = await call('OPTIONS', '/api/public/sign/view', { headers: { origin: 'https://other.example.com', 'access-control-request-method': 'POST' } });
  assert.equal(pre.status, 405);
  for (const r of [pre, await call('POST', '/api/public/sign/view', { body: { token: t } })]) for (const [k] of r.headers) assert.ok(!k.startsWith('access-control-'), 'no cross-origin permission header');
  assert.equal((await call('GET', '/api/public/sign/file?k=nonsense')).status, 404);
});

test('signing: a rejected signature image never reaches the rules, and a refusal by the rules is passed on as the page expects', async () => {
  const t = token();
  const big = await call('POST', '/api/public/sign/submit', { body: { token: t, consent: true, typedName: 'Sample Signer', signature: 'data:image/png;base64,' + 'A'.repeat(210000), values: {} } });
  assert.equal(big.status, 409); assert.equal(big.json.reason, 'bad_signature');
  assert.equal(calls.filter((c) => c.name === 'sign_open').length, 0);
  // a request the rules refuse: the signer has not agreed
  const envelope = { id: 'e1', status: 'sent', ordered: false, events: [], fields: [{ id: 'f1', signerId: 's1', type: 'signature', page: 1, x: 0, y: 0, w: 0.3, h: 0.1, required: true }],
    signers: [{ id: 's1', name: 'Sample Signer', email: 's@example.com', order: 1, status: 'sent' }], expiresAt: new Date(Date.now() + 86400000).toISOString() };
  db.sign_open = () => ({ tenantId: 't', signerId: 's1', envelopeId: 'e1', rev: 0, company: 'Sample Company', envelope: structuredClone(envelope) });
  const r = await call('POST', '/api/public/sign/submit', { body: { token: t, consent: false, typedName: 'Sample Signer', signature: 'data:image/png;base64,AAAA', values: {} } });
  assert.equal(r.status, 409); assert.deepEqual(r.json, { ok: false, error: 'rejected', reason: 'no_consent' });
  assert.equal(calls.filter((c) => c.name === 'sign_commit').length, 0, 'nothing is written when the rules refuse');
  // the view: built by the rules, never with another signer's address
  const v = await call('POST', '/api/public/sign/view', { body: { token: t } });
  assert.equal(v.status, 200); assert.equal(v.json.view.state, 'open'); assert.equal(v.json.view.company, 'Sample Company');
  // a stale reading is tried again, a bounded number of times, then answered "busy"
  db.sign_commit = () => ({ conflict: true });
  const busy = await call('POST', '/api/public/sign/opened', { body: { token: t } });
  assert.equal(busy.status, 503); assert.equal(busy.json.error, 'busy');
  assert.equal(calls.filter((c) => c.name === 'sign_commit').length, 6);
  // a replayed answer is returned without running anything
  db.sign_open = () => ({ replay: { ok: true, completed: true } });
  const again = await call('POST', '/api/public/sign/submit', { body: { token: t, consent: true, typedName: 'Sample Signer', signature: 'data:image/png;base64,AAAA', values: {} } });
  assert.deepEqual(again.json, { ok: true, completed: true });
});

test('reviews: one refusal for every link that does not open, validation of the answer', async () => {
  const t = token();
  const answers = [];
  for (const tok of [t, 'short', t + 'x', 'a.b', '%20']) {
    resetMemoryLimits();
    for (const r of [await call('GET', '/api/public/review/' + tok), await call('POST', '/api/public/review/' + tok, { body: { rating: 5, comment: '' } })]) answers.push(`${r.status} ${r.text}`);
  }
  assert.deepEqual([...new Set(answers)], [CANNOT]);
  assert.equal((await call('POST', '/api/public/review/' + t, { body: { rating: 0 } })).json.reason, 'rating');
  assert.equal((await call('POST', '/api/public/review/' + t, { body: { rating: 2.5 } })).status, 400);
  assert.equal((await call('POST', '/api/public/review/' + t, { body: { rating: '5' } })).status, 400);
  assert.equal((await call('POST', '/api/public/review/' + t, { body: { rating: 5, comment: 'x'.repeat(20000) } })).status, 413);
  assert.equal((await call('POST', '/api/public/review/' + t, { body: { decline: true }, headers: { origin: 'https://other.example.com' } })).status, 403);
  assert.equal((await call('PUT', '/api/public/review/' + t, { body: {} })).status, 405);
  db.review_open = () => ({ tenantId: 'x', company: 'Sample Company', firstName: 'Sample', state: 'open', publicUrl: 'https://reviews.example.com/s' });
  const ok = await call('GET', '/api/public/review/' + t);
  assert.deepEqual(ok.json, { ok: true, company: 'Sample Company', firstName: 'Sample', state: 'open', publicUrl: 'https://reviews.example.com/s' });
  assert.equal(ok.headers.get('referrer-policy'), 'no-referrer'); assert.equal(ok.headers.get('cache-control'), 'no-store');
  db.review_answer = (a) => ({ ok: true, low: a.p_rating <= 3, publicUrl: 'https://reviews.example.com/s', tenantId: 'x' });
  assert.deepEqual((await call('POST', '/api/public/review/' + t, { body: { rating: 1, comment: ' late ' } })).json, { ok: true, low: true, publicUrl: 'https://reviews.example.com/s' });
  const sent = calls.filter((c) => c.name === 'review_answer').at(-1).args;
  assert.equal(sent.p_token_hash, sha(t)); assert.equal(sent.p_comment, 'late'); assert.match(sent.p_ip_hash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(calls).includes('198.51.100.7'), 'the address is never sent to the database');
});

test('rate limits on the public routes: per token from many addresses, per address over many tokens', async () => {
  const t = token();
  let n = 0; let r;
  do { n += 1; r = await call('POST', '/api/public/sign/view', { body: { token: t }, address: '198.51.100.' + n }); } while (r.status === 404 && n < 80);
  assert.equal(r.status, 429); assert.equal(n, 31); assert.ok(Number(r.headers.get('retry-after')) > 0);
  resetMemoryLimits();
  n = 0;
  do { n += 1; r = await call('GET', '/api/public/review/' + token(), { address: '198.51.100.9' }); } while (r.status === 404 && n < 100);
  assert.equal(r.status, 429); assert.equal(n, 61);
  // a misshapen token is counted like any other
  resetMemoryLimits();
  n = 0;
  do { n += 1; r = await call('POST', '/api/public/sign/view', { body: { token: 'nope' }, address: '198.51.100.' + n }); } while (r.status === 404 && n < 80);
  assert.equal(r.status, 429);
});

test('website form: the fields', () => {
  const ok = intakeFields({ name: ' Sample Prospect ', email: 'P@Example.com', phone: '(555) 010-0142', message: 'Hello\u0000 there', lang: 'es', consent: 'on', consentText: 'I agree.', smsOptIn: 'on' });
  assert.deepEqual(ok.fields, { name: 'Sample Prospect', email: 'p@example.com', phone: '(555) 010-0142', company: '', address: '', service: '', message: 'Hello there', lang: 'es', smsOptIn: true });
  assert.equal(ok.consentText, 'I agree.');
  assert.equal(intakeFields({ name: 'Sample Prospect', email: 'p@example.com', smsOptIn: true }).fields.smsOptIn, undefined, 'no consent tick, no text messages');
  assert.equal(intakeFields({ name: 'Sample Prospect', email: 'p@example.com', consentText: 'x' }).consentText, '');
  for (const [b, problem] of [[{ name: 'S' }, 'name'], [{ name: 'Sample Prospect' }, 'contact'], [{ name: 'Sample Prospect', email: 'nope' }, 'email'], [{ name: 'Sample Prospect', phone: '12' }, 'phone'],
    [{ name: 'Sample Prospect', phone: '555-010-0142 <script>' }, 'phone'], [{ name: 42, email: 'p@example.com' }, 'name'], [{}, 'name']]) assert.equal(intakeFields(b).problem, problem);
});

test('website form: quiet refusals, the hidden field, the form key by hash, the same answer for a key nobody has', async () => {
  const key = sha('form key');
  const form = { name: 'Sample Prospect', email: 'p@example.com', idem: 'submission-0001' };
  db.intake_submit = () => ({ ok: true, tenantId: 't', leadId: 'l' });
  const good = await call('POST', '/api/public/intake/' + key, { body: form, headers: { origin: 'https://www.sample-company.example.com' } });
  assert.deepEqual(good.json, { ok: true });
  const sent = calls.filter((c) => c.name === 'intake_submit').at(-1).args;
  assert.equal(sent.p_key_hash, sha(key)); assert.equal(sent.p_idem, 'submission-0001'); assert.ok(!JSON.stringify(calls).includes('"' + key + '"'));
  // the database knows no such key: the same answer
  db.intake_submit = () => null;
  assert.deepEqual((await call('POST', '/api/public/intake/' + key, { body: form })).json, { ok: true });
  // without a key of its own, the same details on the same day are one submission
  await call('POST', '/api/public/intake/' + key, { body: { name: 'Sample Prospect', email: 'p@example.com' } });
  await call('POST', '/api/public/intake/' + key, { body: { name: 'Sample Prospect', email: 'p@example.com' } });
  const [a, b] = calls.filter((c) => c.name === 'intake_submit').slice(-2).map((c) => c.args.p_idem);
  assert.equal(a, b); assert.match(a, /^auto-[0-9a-f]{40}$/);
  const before = calls.filter((c) => c.name === 'intake_submit').length;
  assert.deepEqual((await call('POST', '/api/public/intake/' + key, { body: { ...form, website: 'https://spam.example.com' } })).json, { ok: true });
  assert.deepEqual((await call('POST', '/api/public/intake/not-a-key', { body: form })).json, { ok: true });
  assert.equal(calls.filter((c) => c.name === 'intake_submit').length, before, 'neither reached the database');
  assert.equal((await call('POST', '/api/public/intake/' + key, { body: { name: 'S' } })).status, 400);
  assert.equal((await call('POST', '/api/public/intake/' + key, { raw: 'x', headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await call('GET', '/api/public/intake/' + key)).status, 405);
  resetMemoryLimits();
  let n = 0; let r;
  do { n += 1; r = await call('POST', '/api/public/intake/' + key, { body: { ...form, idem: 'submission-1' + String(n).padStart(3, '0') } }); } while (r.status === 200 && n < 30);
  assert.equal(r.status, 429); assert.equal(n, 11);
});

test('the office operations need a signed-in member', async () => {
  for (const name of ['envelope_send', 'envelope_remind', 'review_send', 'intake_key_rotate', 'intake_key_state']) {
    const r = await call('POST', '/api/public/office/' + name, { body: { tenant: '11111111-1111-4111-8111-111111111111', args: {} }, headers: { origin: ORIGIN } });
    assert.ok([401, 403].includes(r.status), name); assert.ok(['bad_csrf', 'not_signed_in'].includes(r.json.error), name + ': ' + r.json.error);
  }
  assert.equal((await call('POST', '/api/public/office/drop_everything', { body: {} })).json.error, 'unknown_operation');
});

test('outgoing messages: consent, and what "no provider" does', async () => {
  assert.equal(consentProblem({ channel: 'email', emailOptOut: true }), 'opted_out');
  assert.equal(consentProblem({ channel: 'email', emailOptOut: false }), null);
  assert.equal(consentProblem({ channel: 'text', smsOptIn: false }), 'no_consent');
  assert.equal(consentProblem({ channel: 'text', smsOptIn: true }), null);
  assert.equal(consentProblem({ channel: 'whatsapp' }), 'no_consent');
  assert.equal(consentProblem({ channel: 'call' }), 'unsupported_channel');
  assert.deepEqual(Object.keys(ROUTES), ['email', 'text', 'whatsapp', 'facebook', 'instagram']);
  const T = '11111111-1111-4111-8111-111111111111', M = '22222222-2222-4222-8222-222222222222';
  const msg = (more) => ({ id: M, tenantId: T, channel: 'email', recipient: 'reader@example.com', subject: 'S', body: 'Hello {{link}}', status: 'queued', dir: 'out', system: false, emailOptOut: false, smsOptIn: false, whatsappOptIn: false, ...more });
  const marks = () => calls.filter((c) => c.name === 'message_mark').map((c) => [c.args.p_status, c.args.p_error, c.args.p_provider, c.args.p_external_id]);

  db.message_get = () => msg({});
  assert.equal(await deliver(T, M), 'failed:not_connected');
  assert.deepEqual(marks(), [['failed', 'not_connected', null, null]]);
  calls.length = 0; db.message_get = () => msg({ emailOptOut: true });
  assert.equal(await deliver(T, M), 'failed:opted_out');
  calls.length = 0; db.message_get = () => msg({ channel: 'text' });
  assert.equal(await deliver(T, M), 'failed:no_consent');
  calls.length = 0; db.message_get = () => msg({ channel: 'text', smsOptIn: true });
  assert.equal(await deliver(T, M), 'failed:not_connected');
  calls.length = 0; db.message_get = () => msg({ status: 'sent' });
  assert.equal(await deliver(T, M), 'skipped'); assert.deepEqual(marks(), []);
  calls.length = 0; db.message_get = () => null;
  assert.equal(await deliver(T, M), 'skipped');

  // a message the server wrote: system email. Not set up means failed, never sent.
  calls.length = 0; db.message_get = () => msg({ system: true, link: sealToken({ url: ORIGIN + '/review/abc' }, 'msg-link:' + T) });
  assert.equal(await deliver(T, M), 'failed:not_connected');
  process.env.RESEND_API_KEY = 're_test_' + randomBytes(12).toString('hex'); process.env.SYSTEM_EMAIL_FROM = 'VYNTEX Command <system@mail.example.com>';
  let mailed = null;
  resend = (body, headers) => { mailed = { body, headers }; return new Response(JSON.stringify({ id: 'email_abc' }), { status: 200 }); };
  calls.length = 0;
  assert.equal(await deliver(T, M), 'sent');
  assert.deepEqual(marks(), [['sent', null, 'resend', 'email_abc']]);
  assert.equal(mailed.body.text, `Hello ${ORIGIN}/review/abc`); assert.equal(mailed.headers['idempotency-key'], 'msg:' + M);
  // the provider refuses: retried while attempts remain, written as failed on the last one
  resend = () => new Response(JSON.stringify({ name: 'application_error', message: 'detail' }), { status: 500 });
  calls.length = 0;
  await assert.rejects(() => deliver(T, M), (e) => e.code === 'provider_error');
  assert.deepEqual(marks(), []);
  assert.equal(await deliver(T, M, { last: true }), 'failed:provider_error');
  // a sealed link that cannot be opened is never sent as it is
  calls.length = 0; db.message_get = () => msg({ system: true, link: 'tampered' });
  assert.equal(await deliver(T, M), 'failed:link_unreadable');
});

test('emails: the signer email, the sealed queue copy, and a summary that names nobody', async () => {
  const en = signerEmail({ kind: 'request', lang: 'en', company: 'Sample Company', title: 'Sample agreement', name: 'Sample Signer', link: ORIGIN + '/sign/abc', message: 'Please sign.\r\nThanks', expiresAt: '2026-12-01T00:00:00.000Z' });
  assert.equal(en.subject, 'Sample Company asks for your signature'); assert.ok(en.text.includes(ORIGIN + '/sign/abc') && en.text.includes('December 1, 2026') && en.text.includes('Please sign. Thanks'));
  const es = signerEmail({ kind: 'reminder', lang: 'es', company: 'Sample Company', title: 'Sample agreement', name: 'Sample Signer', link: ORIGIN + '/sign/abc' });
  assert.match(es.subject, /^Recordatorio/); assert.ok(es.text.includes('Abra este enlace'));
  assert.ok(!/[\u2013\u2014]/.test(en.text + es.text + en.subject + es.subject));
  assert.ok(!signerEmail({ kind: 'request', lang: 'en', company: 'A\r\nBcc: x@example.com', title: 't', name: 'n', link: 'l' }).subject.includes('\n'), 'no header can be slipped into the subject');

  // a notice that cannot be sent now goes to the queue sealed: no token, no address in the clear
  process.env.RESEND_API_KEY = 're_test_' + randomBytes(12).toString('hex'); process.env.SYSTEM_EMAIL_FROM = 'VYNTEX Command <system@mail.example.com>';
  resend = () => new Response('{}', { status: 500 });
  db.job_enqueue = () => '33333333-3333-4333-8333-333333333333';
  const t = token();
  const n = notice({ tenantId: '11111111-1111-4111-8111-111111111111', company: 'Sample Company', envelope: { title: 'Sample agreement', lang: 'en' } }, { name: 'Sample Signer', email: 'signer@example.com' }, t, 'request');
  assert.equal(await sendOrQueue(n, ORIGIN), 'queued');
  const queued = calls.find((c) => c.name === 'job_enqueue').args;
  assert.equal(queued.p_kind, 'esign.notify');
  assert.ok(!JSON.stringify(queued).includes(t) && !JSON.stringify(queued).includes('signer@example.com'));
  assert.equal(openNotice(queued.p_payload.sealed).token, t); assert.equal(openNotice('tampered'), null);

  assert.equal(summaryEmail({ newLeads: 0, tasksDue: 0 }), null, 'a day with nothing to report sends nothing');
  const s = summaryEmail({ newLeads: 3, tasksDue: 1, appointmentsToday: 0, signaturesWaiting: 2, messagesFailed: 0, reviewsAnswered: 0, clientName: 'Sample Client' });
  assert.equal(s.subject, 'Your daily summary from VYNTEX Command');
  assert.ok(s.text.includes('3 new leads') && s.text.includes('3 prospectos nuevos') && !s.text.includes('appointments today') && !s.text.includes('Sample Client'));
});

test('nothing written to the server log holds a token', async () => {
  const lines = []; const real = console.error; console.error = (...a) => { lines.push(a.join(' ')); };
  const t = token();
  try {
    db.sign_open = () => { throw new Error('boom ' + t); };
    await call('POST', '/api/public/sign/view', { body: { token: t } });
    await call('GET', '/api/public/review/' + t);
    db = {};
    await call('POST', '/api/public/sign/submit', { body: { token: t, consent: true, typedName: 'Sample Signer', signature: 'data:image/png;base64,AAAA', values: {} } });
  } finally { console.error = real; }
  assert.ok(!lines.join('\n').includes(t) && !lines.join('\n').includes(sha(t)));
});
