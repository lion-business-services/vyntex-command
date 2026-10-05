// The Gmail adapter, tested with mocked provider responses. Nothing is sent and nothing reaches Google.
// Not exercised against Google: no client, account or Pub/Sub topic exists in this build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setGoogleEnv, ctxFor, reply, gerr, memCursor, memSink, goodTokens, googleSigner, leaks, TENANT, CLIENT_SECRET } from './google.helpers.mjs';

setGoogleEnv({ GOOGLE_PUBSUB_TOPIC: 'projects/vx-test/topics/gmail-push', GOOGLE_PUBSUB_AUDIENCE: 'https://app.example.com/api/webhooks/gmail', GOOGLE_PUBSUB_SERVICE_ACCOUNT: 'push@vx-test.iam.gserviceaccount.example' });
const gmail = (await import('../../api/_lib/integrations/providers/gmail.js')).default;
const { ProviderError } = await import('../../api/_lib/integrations/oauth.js');
const { configState } = await import('../../api/_lib/integrations/core.js');
const { resetKeyCache } = await import('../../api/_lib/integrations/google/pubsub.js');

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const ME = 'office@example.com';
const conn = { account_label: ME, account_ref: ME, state: 'connected' };
const profile = (historyId = '1000', email = ME) => ['GET', API + '/profile', () => reply(200, { emailAddress: email, messagesTotal: 5, threadsTotal: 4, historyId })];
const meta = (id, from, extra = {}) => ({ id, threadId: 't-' + id, labelIds: ['INBOX', 'UNREAD'], internalDate: '1767225600000', snippet: 'Private words of the sender', payload: { headers: [{ name: 'From', value: from }, { name: 'To', value: `Office <${ME}>` }, { name: 'Subject', value: 'Private subject line' }, { name: 'Message-ID', value: `<${id}@mail.example.com>` }] }, ...extra });
const rejects = (p, code, more = () => true) => assert.rejects(p, (e) => e instanceof ProviderError && e.code === code && !leaks(e) && more(e), code);

test('shape, minimal scopes, and "pending approval" until the flag says Google verified the app', () => {
  assert.equal(gmail.id, 'gmail'); assert.equal(gmail.kind, 'oauth');
  assert.deepEqual(gmail.env, ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);
  assert.deepEqual(gmail.scopes, ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly']);
  for (const fn of ['authUrl', 'exchange', 'refresh', 'revoke', 'status', 'health', 'sync']) assert.equal(typeof gmail[fn], 'function', fn);
  assert.equal(typeof gmail.webhook.verify, 'function'); assert.equal(typeof gmail.webhook.handle, 'function');
  assert.deepEqual(configState({ ...gmail, built: true }), { state: 'pending_approval', reason: 'provider_review', missing: [] });
  process.env.GOOGLE_GMAIL_APPROVED = 'true';
  assert.equal(configState({ ...gmail, built: true }).state, 'setup');
  delete process.env.GOOGLE_CLIENT_SECRET;
  assert.deepEqual(configState({ ...gmail, built: true }), { state: 'not_connected', reason: 'not_configured', missing: ['GOOGLE_CLIENT_SECRET'] });
  process.env.GOOGLE_CLIENT_SECRET = CLIENT_SECRET;
});

test('connect: the consent address asks for offline access, PKCE and only this connection\'s scopes', () => {
  const { ctx } = ctxFor(gmail, { state: 'st.abc', challenge: 'chal123' });
  const u = new URL(gmail.authUrl(ctx));
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  const q = Object.fromEntries(u.searchParams);
  assert.equal(q.client_id, 'client-123.apps.example'); assert.equal(q.response_type, 'code');
  assert.equal(q.redirect_uri, 'https://app.example.com/api/integrations/gmail/callback');
  assert.equal(q.scope, gmail.scopes.join(' ')); assert.equal(q.state, 'st.abc');
  assert.equal(q.code_challenge, 'chal123'); assert.equal(q.code_challenge_method, 'S256');
  assert.equal(q.access_type, 'offline'); assert.equal(q.prompt, 'consent');
  assert.ok(!('include_granted_scopes' in q), 'scopes of other connections are not folded in');
  assert.ok(!('hd' in q) && !u.toString().includes(CLIENT_SECRET));
  process.env.GOOGLE_ALLOWED_DOMAINS = 'example.com';
  assert.equal(new URL(gmail.authUrl(ctx)).searchParams.get('hd'), 'example.com');
  delete process.env.GOOGLE_ALLOWED_DOMAINS;
});

test('callback: the code is exchanged server side with the verifier and the secret', async () => {
  const { ctx, calls } = ctxFor(gmail, { tokens: null, verifier: 'ver-xyz', routes: [['POST', 'oauth2.googleapis.com/token', () => reply(200, { access_token: 'ya29.new', refresh_token: '1//r', expires_in: 3599, scope: gmail.scopes.join(' '), token_type: 'Bearer', id_token: 'ignored' })]] });
  const t = await gmail.exchange(ctx, 'code-1');
  const form = Object.fromEntries(new URLSearchParams(calls[0].body));
  assert.deepEqual(form, { grant_type: 'authorization_code', code: 'code-1', redirect_uri: ctx.redirectUri, code_verifier: 'ver-xyz', client_id: 'client-123.apps.example', client_secret: CLIENT_SECRET });
  assert.equal(t.access_token, 'ya29.new'); assert.equal(t.refresh_token, '1//r');
  assert.equal(Date.parse(t.expires_at), ctx.now() + 3599000);
  assert.deepEqual(Object.keys(t).sort(), ['access_token', 'expires_at', 'refresh_token', 'scope', 'token_type'], 'the id token is not kept');
  // Google sent no refresh token: the connection would stop within the hour, so it is refused now.
  await rejects(gmail.exchange(ctxFor(gmail, { tokens: null, verifier: 'v', routes: [['POST', '/token', () => reply(200, { access_token: 'a', expires_in: 3599 })]] }).ctx, 'c'), 'no_refresh_token');
  await rejects(gmail.exchange(ctxFor(gmail, { tokens: null, verifier: 'v', routes: [['POST', '/token', () => reply(400, { error: 'invalid_grant', error_description: 'Bad Request private.person' })]] }).ctx, 'c'), 'invalid_grant', (e) => e.reauth === true);
});

test('expired token: refresh keeps the refresh token Google does not resend', async () => {
  const old = goodTokens(gmail, { expires_at: new Date(Date.now() - 1000).toISOString() });
  const { ctx, calls } = ctxFor(gmail, { tokens: old, routes: [['POST', '/token', () => reply(200, { access_token: 'ya29.fresh', expires_in: 3600, scope: old.scope, token_type: 'Bearer' })]] });
  const t = await gmail.refresh(ctx, old);
  assert.equal(new URLSearchParams(calls[0].body).get('grant_type'), 'refresh_token');
  assert.equal(new URLSearchParams(calls[0].body).get('refresh_token'), '1//test-refresh');
  assert.equal(t.access_token, 'ya29.fresh'); assert.equal(t.refresh_token, '1//test-refresh');
  assert.ok(Date.parse(t.expires_at) > Date.now());
});

test('revoked permission: invalid_grant on refresh means connect again; an outage does not', async () => {
  const old = goodTokens(gmail);
  await rejects(gmail.refresh(ctxFor(gmail, { routes: [['POST', '/token', () => reply(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })]] }).ctx, old), 'invalid_grant', (e) => e.reauth === true);
  await rejects(gmail.refresh(ctxFor(gmail, { routes: [['POST', '/token', () => reply(503, 'unavailable')]] }).ctx, old), 'token_exchange_failed', (e) => e.reauth === false);
  // A token Google stopped accepting in the middle of use.
  await rejects(gmail.status(ctxFor(gmail, { routes: [['GET', '/profile', () => gerr(401, 'authError')]] }).ctx), 'token_rejected', (e) => e.reauth === true);
  await rejects(gmail.actions.getThread(ctxFor(gmail, { connection: conn, routes: [['GET', '/threads/', () => gerr(403, 'insufficientPermissions')]] }).ctx, 'th1'), 'scope_missing', (e) => e.reauth === true);
});

test('status: a real profile call is the only way to "connected"', async () => {
  const { ctx, calls } = ctxFor(gmail, { routes: [profile('1000', 'Office@Example.com')] });
  assert.deepEqual(await gmail.status(ctx), { ok: true, account: { label: ME, ref: ME }, scopes: gmail.scopes });
  assert.equal(calls.length, 1); assert.equal(calls[0].init.headers.authorization, 'Bearer ya29.test-access');
  // The person unticked "read" on the consent screen: refused without pretending.
  const partial = ctxFor(gmail, { tokens: goodTokens(gmail, { scope: 'openid email https://www.googleapis.com/auth/gmail.send' }), routes: [profile()] });
  assert.deepEqual(await gmail.status(partial.ctx), { ok: false, reason: 'scope_missing' });
  assert.equal(partial.calls.length, 0);
  assert.deepEqual(await gmail.status(ctxFor(gmail, { routes: [['GET', '/profile', () => reply(200, { historyId: '1' })]] }).ctx), { ok: false, reason: 'account_unknown' });
});

test('wrong account: outside the allowed domains at connect, or a different mailbox later', async () => {
  process.env.GOOGLE_ALLOWED_DOMAINS = 'example.com, example.org';
  assert.deepEqual(await gmail.status(ctxFor(gmail, { routes: [profile('1', 'someone@personal.example')] }).ctx), { ok: false, reason: 'wrong_account' });
  assert.equal((await gmail.status(ctxFor(gmail, { routes: [profile('1', 'a@example.org')] }).ctx)).ok, true);
  delete process.env.GOOGLE_ALLOWED_DOMAINS;
  assert.deepEqual(await gmail.health(ctxFor(gmail, { connection: conn, routes: [profile('1', 'other@example.com')] }).ctx), { ok: false, reason: 'wrong_account', reauth: true });
  assert.deepEqual(await gmail.health(ctxFor(gmail, { connection: conn, routes: [profile()] }).ctx), { ok: true, health: 'ok' });
});

test('send: an RFC 2822 message with attachment, thread and reply headers; nothing can add a header', async () => {
  const { ctx, calls } = ctxFor(gmail, { connection: conn, routes: [['POST', '/messages/send', () => reply(200, { id: 'm1', threadId: 'th9', labelIds: ['SENT'] })]] });
  const out = await gmail.actions.send(ctx, {
    to: 'client@example.com', cc: ['partner@example.com'], subject: 'Su cita\r\nBcc: thief@example.com', text: 'Hola,\nle confirmamos.', fromName: 'Oficina "Central"\r\nX-Evil: 1',
    threadId: 'th9', inReplyTo: '<orig-1@mail.example.com>', references: '<root@mail.example.com>',
    attachments: [{ filename: 'carta año.pdf', contentType: 'application/pdf', data: Buffer.from('%PDF-1.4 sample') }],
  });
  assert.deepEqual(out, { id: 'm1', threadId: 'th9', messageId: null, duplicate: false });
  assert.equal(calls.length, 1, 'no idempotency key: no lookup');
  const sent = JSON.parse(calls[0].body);
  assert.equal(sent.threadId, 'th9');
  const mime = Buffer.from(sent.raw, 'base64url').toString('utf8');
  const head = mime.split('\r\n\r\n')[0];
  assert.match(head, /^From: "Oficina Central X-Evil: 1" <office@example\.com>\r\n/);
  assert.match(head, /\r\nTo: client@example\.com\r\n/); assert.match(head, /\r\nCc: partner@example\.com\r\n/);
  assert.match(head, /\r\nSubject: Su cita Bcc: thief@example\.com\r\n/);
  assert.ok(!/^Bcc:/m.test(head) && !/^X-Evil:/m.test(head), 'line breaks in a subject or a name cannot add headers');
  assert.match(head, /\r\nIn-Reply-To: <orig-1@mail\.example\.com>\r\n/);
  assert.match(head, /\r\nReferences: <root@mail\.example\.com> <orig-1@mail\.example\.com>\r\n/);
  assert.match(head, /Content-Type: multipart\/mixed; boundary="vxm_/);
  assert.match(mime, /Content-Type: application\/pdf; name="=\?UTF-8\?B\?/);
  assert.match(mime, /filename\*=UTF-8''carta%20a%C3%B1o\.pdf/);
  assert.ok(mime.includes(Buffer.from('%PDF-1.4 sample').toString('base64')));
  assert.ok(mime.includes(Buffer.from('Hola,\nle confirmamos.').toString('base64')), 'the text part is there');
});

test('send: bad input is refused before any call, and failures are codes', async () => {
  const none = ctxFor(gmail, { connection: conn });
  await rejects(gmail.actions.send(none.ctx, { to: 'not-an-address', subject: 's', text: 't' }), 'recipient_invalid');
  await rejects(gmail.actions.send(none.ctx, { to: [], subject: 's', text: 't' }), 'recipient_invalid');
  await rejects(gmail.actions.send(none.ctx, { to: 'a@example.com', subject: ' ', text: 't' }), 'message_invalid');
  await rejects(gmail.actions.send(none.ctx, { to: 'a@example.com', subject: 's', text: 't', attachments: [{ filename: 'big.bin', contentType: 'application/octet-stream', data: Buffer.alloc(19 * 1024 * 1024, 1) }] }), 'message_too_large');
  await rejects(gmail.actions.send(ctxFor(gmail, { connection: null }).ctx, { to: 'a@example.com', subject: 's', text: 't' }), 'not_connected');
  assert.equal(none.calls.length, 0);
  await rejects(gmail.actions.send(ctxFor(gmail, { connection: conn, routes: [['POST', '/messages/send', () => gerr(400, 'invalidArgument')]] }).ctx, { to: 'a@example.com', subject: 's', text: 't' }), 'request_rejected');
  await rejects(gmail.actions.send(ctxFor(gmail, { connection: conn, routes: [['POST', '/messages/send', () => reply(200, { nothing: true })]] }).ctx, { to: 'a@example.com', subject: 's', text: 't' }), 'bad_answer');
});

test('send is idempotent with a key: the same key finds the first send instead of sending again', async () => {
  let sentCount = 0, stored = null;
  const routes = [
    ['GET', API + '/messages?', (u) => { assert.match(u.searchParams.get('q'), /^rfc822msgid:<vx\.[0-9a-f]{40}@example\.com>$/); return reply(200, stored ? { messages: [stored] } : { resultSizeEstimate: 0 }); }],
    ['POST', '/messages/send', (u, init) => { sentCount += 1; const mime = Buffer.from(JSON.parse(init.body).raw, 'base64url').toString(); assert.match(mime, /\r\nMessage-ID: <vx\.[0-9a-f]{40}@example\.com>\r\n/); stored = { id: 'm77', threadId: 't77' }; return reply(200, stored); }],
  ];
  const a = await gmail.actions.send(ctxFor(gmail, { connection: conn, routes }).ctx, { to: 'a@example.com', subject: 's', text: 't', idempotencyKey: 'appt:42:confirm' });
  const b = await gmail.actions.send(ctxFor(gmail, { connection: conn, routes }).ctx, { to: 'a@example.com', subject: 's', text: 't', idempotencyKey: 'appt:42:confirm' });
  assert.equal(a.duplicate, false); assert.equal(b.duplicate, true);
  assert.equal(b.id, 'm77'); assert.equal(a.messageId, b.messageId); assert.equal(sentCount, 1);
  const c = await gmail.actions.send(ctxFor(gmail, { connection: conn, tenantId: '22222222-2222-4222-8222-222222222222', routes: [['GET', '/messages?', () => reply(200, {})], ['POST', '/messages/send', () => reply(200, { id: 'm78' })]] }).ctx, { to: 'a@example.com', subject: 's', text: 't', idempotencyKey: 'appt:42:confirm' });
  assert.notEqual(c.messageId, a.messageId, 'the same key in another company is another message');
});

test('send: a large message goes to the upload address in two parts', async () => {
  const { ctx, calls } = ctxFor(gmail, { connection: conn, routes: [['POST', 'upload/gmail/v1/users/me/messages/send', () => reply(200, { id: 'big1', threadId: 'tb' })]] });
  const out = await gmail.actions.send(ctx, { to: 'a@example.com', subject: 'Files', text: 'See attached', threadId: 'tb', attachments: [{ filename: 'scan.pdf', contentType: 'application/pdf', data: Buffer.alloc(4 * 1024 * 1024, 65) }] });
  assert.equal(out.id, 'big1');
  assert.equal(new URL(calls[0].url).searchParams.get('uploadType'), 'multipart');
  assert.match(calls[0].init.headers['content-type'], /^multipart\/related; boundary=vxu_/);
  assert.ok(calls[0].body.includes('{"threadId":"tb"}') && calls[0].body.includes('Content-Type: message/rfc822'));
});

test('threads: list and read, with the addresses to match against clients and leads', async () => {
  const full = { id: 'th1', messages: [
    { id: 'a1', threadId: 'th1', labelIds: ['INBOX'], internalDate: '1767225600000', snippet: 'hi', payload: { mimeType: 'multipart/mixed', headers: [{ name: 'From', value: '"Sample Client" <Client@Example.com>' }, { name: 'To', value: ME }, { name: 'Cc', value: 'spouse@example.com' }, { name: 'Subject', value: 'Documents' }, { name: 'Message-ID', value: '<a1@mail.example.com>' }],
      parts: [{ mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }], body: { data: Buffer.from('Adjunto el formulario.').toString('base64url') } }, { mimeType: 'application/pdf', filename: 'form.pdf', headers: [], body: { attachmentId: 'att-1', size: 1234 } }] } },
    { id: 'a2', threadId: 'th1', labelIds: ['SENT'], internalDate: '1767229200000', snippet: 'thanks', payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: ME }, { name: 'To', value: 'client@example.com' }, { name: 'Subject', value: 'Re: Documents' }], body: { data: Buffer.from('Recibido.').toString('base64url') } } },
  ] };
  const routes = [['GET', /\/threads\/th1/, () => reply(200, full)], ['GET', API + '/threads?', (u) => { assert.equal(u.searchParams.get('labelIds'), 'INBOX'); assert.equal(u.searchParams.get('q'), 'from:client'); return reply(200, { threads: [{ id: 'th1' }], nextPageToken: 'p2' }); }], ['GET', '/attachments/att-1', () => reply(200, { size: 3, data: Buffer.from('PDF').toString('base64url') })]];
  const l = await gmail.actions.listThreads(ctxFor(gmail, { connection: conn, routes }).ctx, { q: 'from:client' });
  assert.equal(l.next, 'p2'); assert.equal(l.threads.length, 1);
  assert.equal(l.threads[0].subject, 'Documents'); assert.equal(l.threads[0].count, 2);
  const t = await gmail.actions.getThread(ctxFor(gmail, { connection: conn, routes }).ctx, 'th1');
  assert.equal(t.messages[0].text, 'Adjunto el formulario.');
  assert.deepEqual(t.messages[0].attachments, [{ id: 'att-1', name: 'form.pdf', type: 'application/pdf', size: 1234 }]);
  assert.deepEqual(t.messages[0].match, { sender: 'client@example.com', senderDomain: 'example.com', emails: ['client@example.com', 'spouse@example.com'], outgoing: false });
  assert.deepEqual(t.messages[1].match, { sender: ME, senderDomain: 'example.com', emails: ['client@example.com'], outgoing: true }, 'for a sent message the people to match are the recipients');
  const a = await gmail.actions.getAttachment(ctxFor(gmail, { connection: conn, routes }).ctx, 'a1', 'att-1');
  assert.equal(a.data.toString(), 'PDF');
  await rejects(gmail.actions.getThread(ctxFor(gmail, { connection: conn }).ctx, '../labels'), 'invalid_id');
  await rejects(gmail.actions.listThreads(ctxFor(gmail, { connection: conn }).ctx, { label: 'IN BOX' }), 'invalid_id');
});

test('successful sync: first run sets the position; later runs hand over only new inbox messages, once', async () => {
  const cursor = memCursor(), inbox = memSink();
  const first = await gmail.sync(ctxFor(gmail, { connection: conn, cursor, sink: inbox.sink, routes: [profile('1000'), ['POST', '/watch', () => reply(200, { historyId: '1000', expiration: String(Date.now() + 7 * 86400e3) })]] }).ctx, 'all');
  assert.equal(first.baseline, true); assert.deepEqual(first.counts, { messages: 0, gone: 0 });
  assert.equal(cursor.data.get('history'), '1000'); assert.deepEqual(first.watch, { watching: true, renewed: true });
  const routes = [
    ['GET', API + '/history', (u) => { assert.equal(u.searchParams.get('startHistoryId'), '1000'); assert.equal(u.searchParams.get('labelId'), 'INBOX'); return reply(200, { history: [{ id: '1001', messagesAdded: [{ message: { id: 'm1', threadId: 't1' } }] }, { id: '1002', messagesAdded: [{ message: { id: 'm2' } }, { message: { id: 'm1' } }, { message: { id: 'gone' } }] }], historyId: '1005' }); }],
    ['GET', /\/messages\/gone/, () => gerr(404, 'notFound')],
    ['GET', /\/messages\/m1/, (u) => { assert.equal(u.searchParams.get('format'), 'metadata'); assert.ok(!u.searchParams.getAll('metadataHeaders').includes('Subject')); return reply(200, meta('m1', 'Sample Lead <lead@example.com>')); }],
    ['GET', /\/messages\/m2/, () => reply(200, meta('m2', 'client@example.com'))],
  ];
  const run = ctxFor(gmail, { connection: conn, cursor, sink: inbox.sink, routes });
  const second = await gmail.sync(run.ctx, 'inbox');
  assert.deepEqual(second.counts, { messages: 2, gone: 1 }); assert.equal(cursor.data.get('history'), '1005');
  const items = inbox.list();
  assert.deepEqual(items.map((i) => i.ref), ['gmail:m1', 'gmail:m2']);
  assert.deepEqual(items[0].data.match, { sender: 'lead@example.com', senderDomain: 'example.com', emails: ['lead@example.com'], outgoing: false });
  assert.ok(!JSON.stringify(items).includes('Private subject') && !JSON.stringify(items).includes('Private words'), 'subject and text stay at Google');
  // The same range again (a retried job): nothing is handed over twice.
  cursor.data.set('history', '1000');
  await gmail.sync(ctxFor(gmail, { connection: conn, cursor, sink: inbox.sink, routes }).ctx, 'inbox');
  assert.equal(inbox.items.size, 2);
});

test('sync: a lost history id starts over; a failed hand over does not move the position; watch is renewed only when due', async () => {
  const cursor = memCursor({ history: '5' }), inbox = memSink();
  const routes = [['GET', API + '/history', () => gerr(404, 'notFound')], profile('9000'), ['GET', API + '/messages?', (u) => { assert.equal(u.searchParams.get('labelIds'), 'INBOX'); return reply(200, { messages: [{ id: 'r1' }] }); }], ['GET', /\/messages\/r1/, () => reply(200, meta('r1', 'x@example.com'))]];
  const out = await gmail.sync(ctxFor(gmail, { connection: conn, cursor, sink: inbox.sink, routes }).ctx, 'inbox');
  assert.equal(out.resync, true); assert.equal(out.counts.messages, 1); assert.equal(cursor.data.get('history'), '9000');
  const c2 = memCursor({ history: '1' });
  await rejects(gmail.sync(ctxFor(gmail, { connection: conn, cursor: c2, sink: async () => { throw new ProviderError('inbound_unavailable'); }, routes: [['GET', API + '/history', () => reply(200, { history: [{ messagesAdded: [{ message: { id: 'm1' } }] }], historyId: '2' })], ['GET', /\/messages\/m1/, () => reply(200, meta('m1', 'x@example.com'))]] }).ctx, 'inbox'), 'inbound_unavailable');
  assert.equal(c2.data.get('history'), '1', 'the next run reads the same range again');
  const c3 = memCursor({ watch: String(Date.now() + 5 * 86400e3) });
  const idle = ctxFor(gmail, { connection: conn, cursor: c3 });
  assert.deepEqual(await gmail.sync(idle.ctx, 'watch'), { counts: { messages: 0, gone: 0 }, watch: { watching: true, renewed: false } });
  assert.equal(idle.calls.length, 0);
  c3.data.set('watch', String(Date.now() + 86400e3));
  const due = ctxFor(gmail, { connection: conn, cursor: c3, routes: [['POST', '/watch', (u, init) => { assert.deepEqual(JSON.parse(init.body), { topicName: 'projects/vx-test/topics/gmail-push', labelIds: ['INBOX'], labelFilterBehavior: 'INCLUDE' }); return reply(200, { historyId: '1', expiration: '1893456000000' }); }]] });
  assert.equal((await gmail.sync(due.ctx, 'watch')).watch.renewed, true); assert.equal(c3.data.get('watch'), '1893456000000');
  delete process.env.GOOGLE_PUBSUB_TOPIC;
  assert.deepEqual((await gmail.sync(ctxFor(gmail, { connection: conn, cursor: memCursor() }).ctx, 'watch')).watch, { watching: false, reason: 'push_not_configured' });
  process.env.GOOGLE_PUBSUB_TOPIC = 'projects/vx-test/topics/gmail-push';
});

// ---- webhook (Cloud Pub/Sub push) ------------------------------------------------------------------------------------
const signer = googleSigner();
const AUD = 'https://app.example.com/api/webhooks/gmail', SA = 'push@vx-test.iam.gserviceaccount.example';
const nowS = () => Math.floor(Date.now() / 1000);
const claims = (over = {}) => ({ iss: 'https://accounts.google.com', aud: AUD, email: SA, email_verified: true, iat: nowS() - 5, exp: nowS() + 3600, sub: '1099', ...over });
const push = (data = { emailAddress: 'Office@Example.com', historyId: 123456 }, over = {}) => JSON.stringify({ message: { data: Buffer.from(JSON.stringify(data)).toString('base64'), messageId: '9876543210', publishTime: '2026-01-01T00:00:00.000Z', ...over }, subscription: 'projects/vx-test/subscriptions/gmail-push-sub' });
const certs = (jwks = signer.jwks) => ['GET', 'googleapis.com/oauth2/v3/certs', () => reply(200, jwks, { 'cache-control': 'public, max-age=3600' })];
async function verify(body, token, { routes = [certs()], ctxMore = {} } = {}) {
  resetKeyCache();
  const { ctx, calls } = ctxFor(gmail, { routes, ...ctxMore });
  const headers = { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) };
  const v = await gmail.webhook.verify(new Request(AUD, { method: 'POST', headers, body }), Buffer.from(body), { provider: 'gmail', env: ctx.env, now: ctx.now, fetch: ctx.fetch });
  return { v, calls };
}

test('webhook valid: a Pub/Sub push signed by Google for our audience and service account', async () => {
  const { v, calls } = await verify(push(), signer.sign(claims()));
  assert.deepEqual(v, { ok: true, eventId: 'pubsub:9876543210', type: 'gmail.push', accountRef: ME, redacted: { type: 'gmail.push', historyId: '123456', publishTime: '2026-01-01T00:00:00.000Z' } });
  assert.ok(!JSON.stringify(v.redacted).includes('@'), 'the stored copy holds no address');
  assert.equal(calls.length, 1, 'Google\'s keys are fetched once');
});

test('webhook bad signature or token: every way it can be wrong is refused', async () => {
  const other = googleSigner('test-key-1');   // same key id, a different key: a forged token
  const none = `${signer.b64({ alg: 'none', kid: signer.kid })}.${signer.b64(claims())}.`;
  const hs = signer.sign(claims(), { alg: 'HS256' });
  const cases = [
    [undefined, 'signature_missing'], ['not-a-jwt', 'signature_missing'], [other.sign(claims()), 'bad_signature'], [none + 'AAAA', 'bad_signature'], [hs, 'bad_signature'],
    [signer.sign(claims({ iss: 'https://evil.example' })), 'bad_signature'], [signer.sign(claims({ aud: 'https://other.example/api/webhooks/gmail' })), 'wrong_audience'],
    [signer.sign(claims({ email: 'attacker@other.iam.gserviceaccount.example' })), 'wrong_sender'], [signer.sign(claims({ email_verified: false })), 'wrong_sender'],
    [signer.sign(claims({ iat: nowS() - 7200, exp: nowS() - 3600 })), 'stale'], [signer.sign(claims({ iat: nowS() + 3600, exp: nowS() + 7200 })), 'stale'],
    [googleSigner('unknown-kid').sign(claims()), 'bad_signature'],
  ];
  for (const [token, reason] of cases) assert.deepEqual((await verify(push(), token)).v, { ok: false, reason }, reason);
  // A tampered body part of the token.
  const good = signer.sign(claims()).split('.');
  assert.equal((await verify(push(), `${good[0]}.${signer.b64(claims({ aud: AUD, email: 'x@y.example' }))}.${good[2]}`)).v.reason, 'bad_signature');
  assert.deepEqual((await verify(push(), signer.sign(claims()), { routes: [['GET', '/certs', () => reply(503, 'down')]] })).v, { ok: false, reason: 'keys_unavailable' });
  for (const name of ['GOOGLE_PUBSUB_AUDIENCE', 'GOOGLE_PUBSUB_SERVICE_ACCOUNT']) {
    const keep = process.env[name]; delete process.env[name];
    assert.deepEqual((await verify(push(), signer.sign(claims()))).v, { ok: false, reason: 'not_configured' });
    process.env[name] = keep;
  }
});

test('webhook malformed payload, wrong subscription, and a rotated Google key', async () => {
  const t = () => signer.sign(claims());
  for (const body of ['not json', '[]', '{}', JSON.stringify({ message: { messageId: '1' } }), push({ historyId: 5 }), push({ emailAddress: 'not-an-address', historyId: 5 }), push({ emailAddress: ME, historyId: 'abc' }), push(undefined, { messageId: 'bad id with spaces' }), JSON.stringify({ message: { data: '%%%', messageId: '1' } })]) {
    assert.deepEqual((await verify(body, t())).v, { ok: false, reason: 'bad_payload' }, body.slice(0, 40));
  }
  process.env.GOOGLE_PUBSUB_SUBSCRIPTION = 'projects/vx-test/subscriptions/another';
  assert.deepEqual((await verify(push(), t())).v, { ok: false, reason: 'wrong_subscription' });
  delete process.env.GOOGLE_PUBSUB_SUBSCRIPTION;
  // The cached keys do not know the key id: they are fetched once more before refusing.
  const next = googleSigner('rotated-2');
  let n = 0;
  resetKeyCache();
  const { ctx } = ctxFor(gmail, { routes: [['GET', '/certs', () => { n += 1; return reply(200, n === 1 ? signer.jwks : next.jwks); }]] });
  const ask = (token) => gmail.webhook.verify(new Request(AUD, { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: push() }), Buffer.from(push()), { env: ctx.env, now: ctx.now, fetch: ctx.fetch });
  assert.equal((await ask(signer.sign(claims()))).ok, true);
  assert.equal((await ask(next.sign(claims()))).ok, true); assert.equal(n, 2);
});

test('webhook duplicate and wrong account: a repeat has the same event id and hands nothing over twice', async () => {
  const a = (await verify(push(), signer.sign(claims()))).v, b = (await verify(push(), signer.sign(claims({ iat: nowS() - 1 })))).v;
  assert.equal(a.eventId, b.eventId, 'the framework records an event id once and answers the repeat without running it');
  const cursor = memCursor({ history: '10' }), inbox = memSink();
  const routes = [['GET', API + '/history', () => reply(200, { history: [{ messagesAdded: [{ message: { id: 'm1' } }] }], historyId: '11' })], ['GET', /\/messages\/m1/, () => reply(200, meta('m1', 'client@example.com'))]];
  const one = await gmail.webhook.handle(ctxFor(gmail, { connection: conn, cursor, sink: inbox.sink, routes }).ctx, { redacted: a.redacted });
  assert.deepEqual(one, { ok: true, counts: { messages: 1, gone: 0 } });
  cursor.data.set('history', '10');
  await gmail.webhook.handle(ctxFor(gmail, { connection: conn, cursor, sink: inbox.sink, routes }).ctx, { redacted: a.redacted });
  assert.equal(inbox.items.size, 1);
  // A notice for a mailbox no company has connected: no tokens, nothing happens, no call is made.
  const stray = ctxFor(gmail, { tokens: null, tenantId: null });
  assert.deepEqual(await gmail.webhook.handle(stray.ctx, { redacted: a.redacted }), { ok: true, ignored: true });
  assert.equal(stray.calls.length, 0);
});

test('provider outage: 5xx is retried with a growing wait, then reported; a send is never repeated blindly', async () => {
  const flaky = ctxFor(gmail, { routes: [['GET', '/profile', (u, i, n) => (n < 3 ? reply(503, { error: { message: LEAK_TEXT } }) : reply(200, { emailAddress: ME, historyId: '1' }))]] });
  assert.equal((await gmail.status(flaky.ctx)).ok, true);
  assert.deepEqual(flaky.waits, [250, 750]); assert.equal(flaky.calls.length, 3);
  const down = ctxFor(gmail, { routes: [['GET', '/profile', () => reply(502, '<html>bad gateway</html>')]] });
  await rejects(gmail.status(down.ctx), 'provider_down', (e) => e.status === 502 && e.reauth === false);
  assert.equal(down.calls.length, 3);
  const cut = ctxFor(gmail, { routes: [['GET', '/profile', () => { throw new TypeError('fetch failed'); }]] });
  await rejects(gmail.status(cut.ctx), 'provider_unreachable'); assert.equal(cut.calls.length, 3);
  const send = ctxFor(gmail, { connection: conn, routes: [['POST', '/messages/send', () => reply(503, 'x')]] });
  await rejects(gmail.actions.send(send.ctx, { to: 'a@example.com', subject: 's', text: 't' }), 'provider_down');
  assert.equal(send.calls.length, 1, 'a send that may have gone through is not sent again without an idempotency key');
});
const LEAK_TEXT = 'User private.person@example.com exceeded quota on project 991122';

test('rate limit: 429 and Google\'s 403 rate reasons become rate_limited with the wait Google asked for', async () => {
  const a = ctxFor(gmail, { connection: conn, routes: [['GET', '/threads', () => gerr(429, 'rateLimitExceeded', { 'retry-after': '120' })]] });
  await rejects(gmail.actions.listThreads(a.ctx), 'rate_limited', (e) => e.retryAfter === 120 && e.reauth === false);
  assert.equal(a.calls.length, 1, 'not retried in a loop'); assert.deepEqual(a.waits, []);
  await rejects(gmail.status(ctxFor(gmail, { routes: [['GET', '/profile', () => gerr(403, 'userRateLimitExceeded')]] }).ctx), 'rate_limited', (e) => e.retryAfter === 60);
  const when = new Date(Date.now() + 90000).toUTCString();
  await rejects(gmail.status(ctxFor(gmail, { routes: [['GET', '/profile', () => gerr(429, 'RESOURCE_EXHAUSTED', { 'retry-after': when })]] }).ctx), 'rate_limited', (e) => e.retryAfter >= 85 && e.retryAfter <= 91);
});

test('malformed answers from Google are codes, never passed on', async () => {
  await rejects(gmail.status(ctxFor(gmail, { routes: [['GET', '/profile', () => reply(200, '<html>login</html>')]] }).ctx), 'bad_answer');
  await rejects(gmail.status(ctxFor(gmail, { routes: [['GET', '/profile', () => reply(200, '"just a string"')]] }).ctx), 'bad_answer');
  await rejects(gmail.status(ctxFor(gmail, { routes: [['GET', '/profile', () => reply(418, LEAK_TEXT)]] }).ctx), 'request_rejected');
  const c = memCursor({ history: '1' });
  const out = await gmail.sync(ctxFor(gmail, { connection: conn, cursor: c, sink: memSink().sink, routes: [['GET', '/history', () => reply(200, { history: 'nope', historyId: {} })]] }).ctx, 'inbox');
  assert.deepEqual(out.counts, { messages: 0, gone: 0 }); assert.equal(c.data.get('history'), '1');
});

test('disconnect: the token is revoked at Google, unless the same account serves another Google connection', async () => {
  const one = ctxFor(gmail, { connection: conn, sibling: async () => null, routes: [['POST', 'oauth2.googleapis.com/revoke', () => reply(200, {})]] });
  await gmail.revoke(one.ctx, one.ctx.tokens);
  assert.equal(new URLSearchParams(one.calls[0].body).get('token'), '1//test-refresh');
  const gone = ctxFor(gmail, { connection: conn, sibling: async () => null, routes: [['POST', '/revoke', () => reply(400, { error: 'invalid_token' })]] });
  await gmail.revoke(gone.ctx, gone.ctx.tokens);   // already unknown to Google: fine
  const shared = ctxFor(gmail, { connection: conn, sibling: async (id) => (id === 'gcal' ? { account_label: 'OFFICE@example.com', state: 'connected' } : null) });
  await rejects(gmail.revoke(shared.ctx, shared.ctx.tokens), 'shared_grant_kept');
  assert.equal(shared.calls.length, 0);
  await rejects(gmail.revoke(ctxFor(gmail, { connection: conn, sibling: async () => null, routes: [['POST', '/revoke', () => reply(500, 'x')]] }).ctx, goodTokens(gmail)), 'revoke_failed');
  void TENANT;
});
