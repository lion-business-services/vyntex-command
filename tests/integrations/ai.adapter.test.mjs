// The model adapter behind the assistant, tested with mocked provider responses. Nothing is sent anywhere.
// Not proven against the live service: no key exists in this build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setTestEnv } from '../server/helpers.mjs';

const KEY = 'sk-test-' + randomBytes(16).toString('hex');
setTestEnv({ ANTHROPIC_API_KEY: KEY });
for (const k of ['ASSISTANT_MODEL', 'AI_TIMEOUT_MS']) delete process.env[k];
const mod = await import('../../api/_lib/integrations/providers/ai.js');
const ai = mod.default;
const { redactText, redactDeep, modelId } = mod;
const { ProviderError } = await import('../../api/_lib/integrations/oauth.js');
const { configState } = await import('../../api/_lib/integrations/core.js');
const { env } = await import('../../api/_lib/env.js');

const LEAK = 'Organization org_778899 key sk-ant-xyz exceeded its limit';
const reply = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const answer = (over = {}) => ({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-4-5', content: [{ type: 'text', text: 'There are two overdue tasks.' }], stop_reason: 'end_turn', usage: { input_tokens: 412, output_tokens: 18, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 }, ...over });
function ctxWith(responder, more = {}) {
  const calls = []; const waits = [];
  const ctx = { provider: 'ai', tenantId: null, env, now: () => Date.now(), sleep: async (ms) => { waits.push(ms); }, fetch: async (url, init = {}) => { calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : null }); return responder(String(url), init, calls.length); }, ...more };
  return { ctx, calls, waits };
}
const rejects = (p, code, extra = () => true) => assert.rejects(p, (e) => e instanceof ProviderError && e.code === code && !String(e.message).includes('org_778899') && extra(e), code);
const ask = (ctx, more = {}) => ai.actions.complete(ctx, { system: 'You are the assistant.', messages: [{ role: 'user', content: 'Which tasks are overdue?' }], ...more });
const TOOLS = [{ name: 'create_task', description: 'Propose creating a task.', input_schema: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } } }];

test('shape: a platform connection with no approval step', () => {
  assert.equal(ai.id, 'ai'); assert.equal(ai.kind, 'platform'); assert.deepEqual(ai.env, ['ANTHROPIC_API_KEY']); assert.equal(ai.approval, null);
  for (const fn of ['status', 'health', 'refresh', 'revoke', 'sync']) assert.equal(typeof ai[fn], 'function', fn);
  assert.equal(typeof ai.actions.complete, 'function');
  assert.equal(configState({ ...ai, built: true }).state, 'setup');
  const keep = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  assert.deepEqual(configState({ ...ai, built: true }), { state: 'not_connected', reason: 'not_configured', missing: ['ANTHROPIC_API_KEY'] });
  process.env.ANTHROPIC_API_KEY = keep;
});

test('connect: status asks the provider for the configured model, and that is the only way to "connected"', async () => {
  const { ctx, calls } = ctxWith(() => reply(200, { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', type: 'model' }));
  assert.deepEqual(await ai.status(ctx), { ok: true, account: { label: 'Claude Haiku 4.5', ref: 'claude-haiku-4-5' }, scopes: [] });
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/models/claude-haiku-4-5'); assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers['x-api-key'], KEY); assert.equal(calls[0].init.headers['anthropic-version'], '2023-06-01');
  assert.ok(!calls[0].url.includes(KEY));
  assert.deepEqual(await ai.health(ctx), { ok: true, health: 'ok' });
  // The model id comes from the environment; a value that is not shaped like one is not sent anywhere.
  process.env.ASSISTANT_MODEL = 'some-other-model-2';
  const other = ctxWith(() => reply(200, { id: 'some-other-model-2' }));
  assert.equal((await ai.status(other.ctx)).account.ref, 'some-other-model-2'); assert.ok(other.calls[0].url.endsWith('/models/some-other-model-2'));
  process.env.ASSISTANT_MODEL = 'bad model/../id';
  assert.equal(modelId({ env }), 'claude-haiku-4-5');
  delete process.env.ASSISTANT_MODEL;
});

test('status: a refused key (expired or revoked), a model this key may not use, outage, rate limit, malformed answer', async () => {
  assert.deepEqual(await ai.status(ctxWith(() => reply(401, { type: 'error', error: { type: 'authentication_error', message: LEAK } })).ctx), { ok: false, reason: 'invalid_key' });
  assert.deepEqual(await ai.health(ctxWith(() => reply(401, {})).ctx), { ok: false, reason: 'invalid_key', reauth: true });
  assert.deepEqual(await ai.status(ctxWith(() => reply(403, { error: { type: 'permission_error', message: LEAK } })).ctx), { ok: false, reason: 'permission_denied' });
  assert.deepEqual(await ai.status(ctxWith(() => reply(404, { error: { type: 'not_found_error', message: LEAK } })).ctx), { ok: false, reason: 'model_not_found' });
  assert.deepEqual(await ai.status(ctxWith(() => reply(429, { error: { message: LEAK } })).ctx), { ok: false, reason: 'rate_limited' });
  assert.deepEqual(await ai.status(ctxWith(() => reply(529, { error: { type: 'overloaded_error' } })).ctx), { ok: false, reason: 'overloaded' });
  assert.deepEqual(await ai.status(ctxWith(() => new Response('<html>bad gateway</html>', { status: 502 })).ctx), { ok: false, reason: 'provider_error' });
  assert.deepEqual(await ai.status(ctxWith(() => reply(200, { nothing: true })).ctx), { ok: false, reason: 'provider_error' });
  await rejects(ai.status(ctxWith(() => { throw new TypeError('fetch failed'); }).ctx), 'provider_unreachable');
  assert.deepEqual(await ai.health(ctxWith(() => { throw new TypeError('fetch failed'); }).ctx), { ok: false, reason: 'provider_unreachable' });
});

test('disconnect and reconnect: the key belongs to the deployment, nothing is exchanged or synced', async () => {
  const { ctx, calls } = ctxWith(() => reply(200, {}));
  assert.equal(await ai.refresh(ctx, null), null); await ai.revoke(ctx, null);
  assert.deepEqual(await ai.sync(ctx), { ok: true, skipped: 'nothing_to_sync' });
  assert.throws(() => ai.authUrl(), (e) => e.code === 'not_oauth');
  assert.equal(calls.length, 0);
});

test('complete: the request, the answer, and the token usage for metering', async () => {
  const { ctx, calls } = ctxWith(() => reply(200, answer()));
  const out = await ask(ctx, { tools: TOOLS, maxTokens: 700 });
  assert.deepEqual(out, { text: 'There are two overdue tasks.', toolCalls: [], stopReason: 'end_turn', model: 'claude-haiku-4-5', usage: { inputTokens: 412, outputTokens: 18, cacheReadTokens: 100, cacheWriteTokens: 0 }, redactions: { tax: 0, card: 0, bank: 0 }, attempts: 1 });
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages'); assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['x-api-key'], KEY); assert.equal(calls[0].init.headers['content-type'], 'application/json');
  assert.ok(calls[0].init.signal instanceof AbortSignal, 'every call has a time limit');
  assert.deepEqual(calls[0].body, { model: 'claude-haiku-4-5', max_tokens: 700, messages: [{ role: 'user', content: 'Which tasks are overdue?' }], system: 'You are the assistant.', tools: TOOLS });
});

test('complete: tool definitions are passed through and tool calls come back as proposals', async () => {
  const { ctx, calls } = ctxWith(() => reply(200, answer({ content: [{ type: 'text', text: 'I can add that.' }, { type: 'tool_use', id: 'toolu_1', name: 'create_task', input: { title: 'Call the supplier' } }, { type: 'tool_use', name: 'broken' }], stop_reason: 'tool_use' })));
  const out = await ask(ctx, { tools: TOOLS, toolChoice: { type: 'auto' } });
  assert.deepEqual(out.toolCalls, [{ id: 'toolu_1', name: 'create_task', input: { title: 'Call the supplier' } }]);
  assert.equal(out.stopReason, 'tool_use'); assert.equal(out.text, 'I can add that.');
  assert.deepEqual(calls[0].body.tools, TOOLS); assert.deepEqual(calls[0].body.tool_choice, { type: 'auto' });
  const none = await ask(ctxWith(() => reply(200, answer())).ctx);
  assert.equal(none.toolCalls.length, 0);
});

test('tax ID redaction: nothing shaped like a tax ID, a card or a bank number leaves the server', async () => {
  const { ctx, calls } = ctxWith(() => reply(200, answer()));
  const out = await ai.actions.complete(ctx, {
    system: 'Business data: {"clients":[{"id":"11111111-1111-4111-8111-111111111111","name":"Sample Person","ssn":"123-45-6789","ein":"12-3456789","phone":"(555) 555-0142","balance":1250.5}]}',
    messages: [
      { role: 'user', content: 'Her SSN is 123 45 6789 and the ITIN 912-70-1234. Card 4111 1111 1111 1111, routing 021000021, account number 000123456789.' },
      { role: 'assistant', content: [{ type: 'text', text: 'Noted.' }, { type: 'tool_use', id: 'toolu_9', name: 'add_note', input: { text: 'tax id 987654321 on file', record_id: '22222222-2222-4222-8222-222222222222' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_9', content: 'saved. IBAN GB82 WEST 1234 5698 7654 32' }, { type: 'text', text: 'Now call her at 555-555-0142 about invoice 1042 for $1,250.50 due 2026-10-05.' }] },
    ],
    tools: TOOLS,
  });
  const sent = JSON.stringify(calls[0].body);
  for (const secret of ['123-45-6789', '12-3456789', '123 45 6789', '912-70-1234', '4111 1111 1111 1111', '4111111111111111', '021000021', '000123456789', '987654321', 'GB82 WEST 1234 5698 7654 32']) assert.ok(!sent.includes(secret), 'still in the request: ' + secret);
  assert.ok(sent.includes('[tax ID removed]') && sent.includes('[card number removed]') && sent.includes('[bank number removed]'));
  // What the model needs to do its job is left alone: record ids, phone numbers, amounts, dates, invoice numbers.
  for (const kept of ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '(555) 555-0142', '555-555-0142', '1250.5', '$1,250.50', '2026-10-05', 'invoice 1042', 'toolu_9', 'add_note', 'Sample Person']) assert.ok(sent.includes(kept), 'should be kept: ' + kept);
  assert.deepEqual(calls[0].body.tools, TOOLS, 'tool definitions are code, not content: passed through untouched');
  // Counts only, for the audit trail: 5 tax IDs (two in the data, the SSN, the ITIN, the one after "tax id"), 1 card, 3 bank numbers.
  assert.deepEqual(out.redactions, { tax: 5, card: 1, bank: 3 });
});

test('redaction rules, one by one', () => {
  const r = (s) => redactText(s).text;
  assert.equal(r('SSN 123-45-6789.'), 'SSN [tax ID removed].');
  assert.equal(r('EIN: 12-3456789'), 'EIN: [tax ID removed]');
  assert.equal(r('ein 123456789'), 'ein [tax ID removed]');
  assert.equal(r('Seguro social: 123456789'), 'Seguro social: [tax ID removed]');
  assert.equal(r('tax id 12 3456789 ok'), 'tax id [tax ID removed] ok');
  assert.equal(r('card 5500-0000-0000-0004 exp 12/27'), 'card [card number removed] exp 12/27');
  assert.equal(r('amex 3782 822463 10005'), 'amex [card number removed]');
  assert.equal(r('4111111111111111'), '[card number removed]');
  assert.equal(r('cuenta 12345678'), 'cuenta [bank number removed]');
  assert.equal(r('Routing: 021000021'), 'Routing: [bank number removed]');
  assert.equal(r('wire to 1234567890123456'), 'wire to [bank number removed]', 'a long number that is not a card is treated as a bank number');
  // Not masked: the last four digits (what the records hold), phone numbers, money, dates, short numbers, record ids.
  for (const s of ['SSN ending 6789', 'last four: 6789', 'call 555-555-0142', '+1 (555) 555-0142', '5555550142', '$12,500.00 on 2026-10-05', 'invoice 100245', 'zip 08234', 'id 33333333-3333-4333-8333-333333333333', 'job 12345678 is done']) assert.equal(r(s), s, s);
  const counts = { tax: 0, card: 0, bank: 0 };
  assert.deepEqual(redactDeep({ type: 'text', text: 'ssn 123-45-6789', nested: [{ note: 'card 4111 1111 1111 1111' }], n: 5, ok: true, nothing: null }, counts), { type: 'text', text: 'ssn [tax ID removed]', nested: [{ note: 'card [card number removed]' }], n: 5, ok: true, nothing: null });
  assert.deepEqual(counts, { tax: 1, card: 1, bank: 0 });
});

test('one retry on a server error or "overloaded", and no more', async () => {
  let c = ctxWith((url, init, n) => (n === 1 ? reply(529, { type: 'error', error: { type: 'overloaded_error', message: LEAK } }) : reply(200, answer())));
  let out = await ask(c.ctx);
  assert.equal(out.attempts, 2); assert.equal(c.calls.length, 2); assert.deepEqual(c.waits, [600]); assert.equal(out.text, 'There are two overdue tasks.');
  c = ctxWith((url, init, n) => (n === 1 ? reply(500, { error: { message: LEAK } }) : reply(200, answer())));
  out = await ask(c.ctx);
  assert.equal(out.attempts, 2);
  c = ctxWith(() => reply(529, { error: { type: 'overloaded_error', message: LEAK } }));
  await rejects(ask(c.ctx), 'overloaded'); assert.equal(c.calls.length, 2, 'two attempts, not three');
  c = ctxWith(() => reply(503, { error: { message: LEAK } }));
  await rejects(ask(c.ctx), 'provider_error'); assert.equal(c.calls.length, 2);
});

test('no retry for failures that would not pass: rate limit, bad key, bad request, too large', async () => {
  for (const [status, code, reauth] of [[429, 'rate_limited', false], [401, 'invalid_key', true], [403, 'permission_denied', false], [400, 'request_rejected', false], [413, 'request_too_large', false], [404, 'model_not_found', false]]) {
    const c = ctxWith(() => reply(status, { type: 'error', error: { type: 'x', message: LEAK } }));
    await rejects(ask(c.ctx), code, (e) => e.reauth === reauth && e.status === status);
    assert.equal(c.calls.length, 1, String(status));
  }
});

test('time limit, outage and a malformed answer are codes', async () => {
  const timeout = () => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; };
  const c = ctxWith(timeout);
  await rejects(ask(c.ctx), 'provider_timeout'); assert.equal(c.calls.length, 1, 'a call that ran out of time is not made again');
  await rejects(ask(ctxWith(() => { throw new TypeError('fetch failed'); }).ctx), 'provider_unreachable');
  await rejects(ask(ctxWith(() => new Response('not json', { status: 200 })).ctx), 'provider_error');
  await rejects(ask(ctxWith(() => reply(200, { id: 'msg', content: 'text' })).ctx), 'provider_error');
  await rejects(ai.actions.complete(ctxWith(() => reply(200, answer())).ctx, { messages: [] }), 'request_rejected');
  // A real time limit: the provider does not answer within the configured time.
  process.env.AI_TIMEOUT_MS = '1000';
  const slow = { provider: 'ai', env, now: () => Date.now(), fetch: (url, init) => new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => reject(init.signal.reason)); }) };
  const started = Date.now();
  // The timer of a time limit does not keep the process alive by itself (an open connection does, in real use).
  const alive = setTimeout(() => {}, 5000);
  try { await rejects(ask(slow), 'provider_timeout'); } finally { clearTimeout(alive); }
  assert.ok(Date.now() - started < 3000);
  delete process.env.AI_TIMEOUT_MS;
});

test('prompts are never logged: nothing is written to the console on any path', async () => {
  const written = [];
  const keep = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  for (const k of Object.keys(keep)) console[k] = (...a) => written.push(a.join(' '));
  try {
    await ask(ctxWith(() => reply(200, answer())).ctx, { messages: [{ role: 'user', content: 'PRIVATE-PROMPT-MARKER ssn 123-45-6789' }] });
    await ask(ctxWith(() => reply(500, { error: { message: LEAK } })).ctx, { messages: [{ role: 'user', content: 'PRIVATE-PROMPT-MARKER' }] }).catch(() => {});
    await ask(ctxWith(() => { throw new TypeError('fetch failed'); }).ctx, { messages: [{ role: 'user', content: 'PRIVATE-PROMPT-MARKER' }] }).catch(() => {});
    await ai.status(ctxWith(() => reply(401, { error: { message: LEAK } })).ctx);
  } finally { Object.assign(console, keep); }
  assert.deepEqual(written, []);
});
