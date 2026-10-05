// Unit tests for the one function every module uses to write to a client, `queueMessage`, and what sits around it:
// which channels a company uses, addresses, opt-outs and consent per channel, drafts and sending, the honest state of a
// message in a sample workspace, conversations (threads), incoming messages, quiet hours and logged calls.
// Run with `npm run test:unit` (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, blank } from './bundle.mjs';

const m = await load(`
  export { queueMessage, sendDraft, updateDraft, discardDraft, receiveMessage, markRead, logCall, setConversation, recordConsent, saveCommsSettings } from '@/domain/actions';
  export { checkOutgoing, commsSettings, deliveryStatus, isQuiet, matchSender, threadOf, contactOf } from '@/domain/actions/messages';
  export { composeMessage, sendMessageDemo, updateMessage, discardMessage } from '@/features/messages/actions';
  export { conversations, timeline, channelStates, fillMerge, fillLines } from '@/features/messages/model';
  export { createPost, submitPost, approvePost, schedulePost, publishPost, retryPost } from '@/domain/actions';
  export { postProblems, publishStatus } from '@/domain/actions/social';
  export { setSession } from '@/platform/session';
  export { PACKS } from '@/packs';
  export { makeT } from '@/i18n';
`);
const { queueMessage, sendDraft, updateDraft, discardDraft, receiveMessage, markRead, logCall, setConversation, recordConsent, saveCommsSettings, checkOutgoing, commsSettings, deliveryStatus,
  isQuiet, matchSender, composeMessage, sendMessageDemo, discardMessage, conversations, timeline, channelStates, fillMerge, fillLines,
  createPost, submitPost, approvePost, schedulePost, publishPost, retryPost, postProblems, publishStatus, setSession, PACKS, makeT } = m;

const user = (id, role) => ({ id, name: 'Person ' + id, role, email: id + '@example.com', active: true });
const client = (id, o = {}) => ({ id, name: 'Dana Example', phone: '609-555-0142', email: 'dana@example.com', addresses: ['1 Sample Way'], since: '2025-01-01', notes: [], ...o });
const lead = (id, o = {}) => ({ id, ticket: 'T-' + id, name: 'Lee Sample', phone: '609-555-0177', email: 'lee@example.com', address: '', type: 'tax', source: 'phone', status: 'new', pri: 'medium', ownerId: 'u2', value: null, created: '2026-01-01', notes: [], ...o });
function world(edition = 'practice') {
  const pack = PACKS[edition];
  const d = blank(pack);
  d.users = [user('u1', 'owner'), user('u2', 'manager'), user('u3', 'staff')];
  d.clients = [client('c1')];
  // quiet hours off unless a test is about them, so the time of day a test runs at never matters
  d.settings = { messages: { quiet: { on: false, from: '21:00', to: '08:00' } } };
  const ctx = { pack, lang: 'en', t: makeT('en', pack), actor: 'u1' };
  return { d, ctx, pack };
}
const ref = { type: 'client', id: 'c1' };
const email = (o = {}) => ({ channel: 'email', to: '', subject: 'Hello', body: 'Body', ref, ...o });

/* ---------- which channels a company uses ---------- */

test('an office edition starts with every channel and the inbox; a field edition starts with email alone', () => {
  const office = commsSettings(world('practice').d, PACKS.practice), field = commsSettings(world('build').d, PACKS.build);
  assert.equal(office.inbox, true); assert.equal(field.inbox, false);
  assert.deepEqual(Object.entries(field.channels).filter(([, on]) => on).map(([c]) => c), ['email']);
  assert.ok(['email', 'text', 'whatsapp', 'facebook', 'instagram', 'call'].every((c) => office.channels[c]));
});

test('a channel the company switched off is refused: channel_off', () => {
  const { d, ctx } = world();
  saveCommsSettings(d, ctx, { channels: { email: false } });
  assert.deepEqual(queueMessage(d, ctx, email()), { ok: false, reason: 'channel_off' });
  assert.equal(d.messages.length, 0);
  // only that channel changed
  assert.equal(commsSettings(d, ctx.pack).channels.text, true);
});

test('a field edition has no text channel until the company switches it on', () => {
  const { d, ctx } = world('build');
  d.clients[0].smsOptIn = true;
  assert.equal(queueMessage(d, ctx, { channel: 'text', to: '', body: 'Hi', ref }).reason, 'channel_off');
  saveCommsSettings(d, ctx, { channels: { text: true } });
  assert.equal(queueMessage(d, ctx, { channel: 'text', to: '', body: 'Hi', ref }).ok, true);
});

test('calls and system notices are not channels one writes on', () => {
  const { d, ctx } = world();
  for (const channel of ['call', 'system']) assert.equal(queueMessage(d, ctx, { channel, to: 'x', body: 'Hi', ref }).reason, 'channel_off');
});

/* ---------- addresses ---------- */

test('the address comes from the record when none is given', () => {
  const { d, ctx } = world();
  const out = queueMessage(d, ctx, email());
  assert.equal(out.ok, true); assert.equal(out.message.to, 'dana@example.com'); assert.equal(out.message.clientId, 'c1');
});

test('no address on the record and none given: no_address, for a draft too', () => {
  const { d, ctx } = world();
  d.clients[0].email = '';
  assert.deepEqual(queueMessage(d, ctx, email({ mode: 'draft' })), { ok: false, reason: 'no_address' });
  assert.deepEqual(queueMessage(d, ctx, email({ mode: 'send' })), { ok: false, reason: 'no_address' });
  assert.equal(queueMessage(d, ctx, email({ to: 'not an address' })).reason, 'no_address');
  d.clients[0].phone = ''; d.clients[0].smsOptIn = true;
  assert.equal(queueMessage(d, ctx, { channel: 'text', to: '', body: 'Hi', ref }).reason, 'no_address');
});

test('a person writing by hand may save a draft without an address, and cannot send it until there is one', () => {
  const { d, ctx } = world();
  d.clients[0].email = '';
  const out = queueMessage(d, ctx, email({ mode: 'draft', personal: true }));
  assert.equal(out.ok, true); assert.equal(out.message.status, 'draft');
  assert.deepEqual(sendDraft(d, ctx, out.message.id), { ok: false, reason: 'no_address' });
  updateDraft(d, ctx, out.message.id, { to: 'dana@example.com' });
  assert.equal(sendDraft(d, ctx, out.message.id).ok, true);
});

/* ---------- opt-out and consent, per channel ---------- */

test('email: a client who opted out of automatic emails gets none from a rule or a module', () => {
  const { d, ctx } = world();
  d.clients[0].emailOptOut = true;
  assert.deepEqual(queueMessage(d, ctx, email({ auto: 'rule:1' })), { ok: false, reason: 'opted_out' });
  assert.deepEqual(queueMessage(d, ctx, email({ mode: 'send' })), { ok: false, reason: 'opted_out' });
  // through the job of that client as well
  d.jobs = [{ id: 'j1', clientId: 'c1' }];
  assert.equal(queueMessage(d, ctx, email({ ref: { type: 'job', id: 'j1' } })).reason, 'opted_out');
  assert.equal(d.messages.length, 0);
});

test('email: the opt-out is about automatic emails; a person may still write one themselves', () => {
  const { d, ctx } = world();
  d.clients[0].emailOptOut = true;
  assert.equal(queueMessage(d, ctx, email({ personal: true, mode: 'send' })).ok, true);
});

test('text: needs the opt-in on record (no_consent), and STOP is an opt-out (opted_out); writing by hand changes nothing', () => {
  const { d, ctx } = world();
  const text = (o = {}) => queueMessage(d, ctx, { channel: 'text', to: '', body: 'Hi', ref, ...o });
  assert.deepEqual(text(), { ok: false, reason: 'no_consent' });
  assert.deepEqual(text({ personal: true, mode: 'send' }), { ok: false, reason: 'no_consent' });
  d.clients[0].smsOptIn = false;
  assert.deepEqual(text(), { ok: false, reason: 'opted_out' });
  assert.deepEqual(text({ personal: true }), { ok: false, reason: 'opted_out' });
  d.clients[0].smsOptIn = true;
  const out = text({ mode: 'send' });
  assert.equal(out.ok, true); assert.equal(out.message.to, '609-555-0142');
});

test('WhatsApp: needs its own opt-in; agreeing to texts is not agreeing to WhatsApp', () => {
  const { d, ctx } = world();
  d.clients[0].smsOptIn = true;
  const wa = () => queueMessage(d, ctx, { channel: 'whatsapp', to: '', body: 'Hi', ref });
  assert.deepEqual(wa(), { ok: false, reason: 'no_consent' });
  d.clients[0].whatsappOptIn = false;
  assert.deepEqual(wa(), { ok: false, reason: 'opted_out' });
  d.clients[0].whatsappOptIn = true; d.clients[0].whatsapp = '609-555-0199';
  const out = wa();
  assert.equal(out.ok, true); assert.equal(out.message.to, '609-555-0199', 'the WhatsApp number wins over the phone');
});

test('a lead is asked the same way: text needs the lead to have agreed', () => {
  const { d, ctx } = world();
  d.leads = [lead('l1')];
  const lref = { type: 'lead', id: 'l1' };
  assert.equal(queueMessage(d, ctx, { channel: 'text', to: '', body: 'Hi', ref: lref }).reason, 'no_consent');
  recordConsent(d, ctx, lref, 'text', true);
  assert.equal(queueMessage(d, ctx, { channel: 'text', to: '', body: 'Hi', ref: lref }).ok, true);
  recordConsent(d, ctx, lref, 'text', false);
  assert.equal(queueMessage(d, ctx, { channel: 'text', to: '', body: 'Hi', ref: lref }).reason, 'opted_out');
  assert.equal(queueMessage(d, ctx, { channel: 'email', to: '', subject: 'S', body: 'Hi', ref: lref }).ok, true, 'email to a lead needs only the address');
});

test('nobody on record: an email goes to the address given, a text is refused (no consent can be on record)', () => {
  const { d, ctx } = world();
  const nobody = { type: 'user', id: 'u1' };
  assert.equal(queueMessage(d, ctx, { channel: 'email', to: 'someone@example.com', subject: 'S', body: 'B', ref: nobody }).ok, true);
  assert.equal(queueMessage(d, ctx, { channel: 'text', to: '609-555-0100', body: 'B', ref: nobody }).reason, 'no_consent');
});

test('Facebook and Instagram: only an answer to someone who wrote first', () => {
  const { d, ctx } = world();
  const fb = () => queueMessage(d, ctx, { channel: 'facebook', to: 'Dana Example', body: 'Hi', ref, mode: 'send' });
  assert.deepEqual(fb(), { ok: false, reason: 'no_consent' });
  d.messages.push({ id: 'in1', at: '2026-01-01T10:00:00.000Z', channel: 'facebook', to: '', from: 'Dana Example', subject: '', body: 'Hello', status: 'received', dir: 'in', ref, clientId: 'c1' });
  assert.equal(fb().ok, true);
  assert.equal(queueMessage(d, ctx, { channel: 'instagram', to: 'dana', body: 'Hi', ref }).reason, 'no_consent', 'a Facebook message does not open Instagram');
});

test('recordConsent writes the answer on the record and in the history', () => {
  const { d, ctx } = world();
  recordConsent(d, ctx, ref, 'whatsapp', true); recordConsent(d, ctx, ref, 'text', false); recordConsent(d, ctx, ref, 'email', false);
  assert.equal(d.clients[0].whatsappOptIn, true); assert.equal(d.clients[0].smsOptIn, false); assert.equal(d.clients[0].emailOptOut, true);
  assert.deepEqual(d.activity.map((a) => a.kind), ['consent.off', 'consent.off', 'consent.on']);
  recordConsent(d, ctx, ref, 'email', true);
  assert.equal(d.clients[0].emailOptOut, undefined);
});

/* ---------- draft, send, and the honest state ---------- */

test('draft is the default: nothing is marked as sent, and the lead or client is not marked as contacted', () => {
  const { d, ctx } = world();
  const out = queueMessage(d, ctx, email());
  assert.equal(out.message.status, 'draft'); assert.equal(out.message.by, 'u1');
  assert.equal(d.clients[0].lastContact, undefined);
  assert.equal(d.activity[0].kind, 'message.drafted');
});

test('send in a sample workspace ends as `demo`, never as queued, sent or delivered', () => {
  const { d, ctx } = world();
  assert.equal(deliveryStatus(), 'demo');
  const out = queueMessage(d, ctx, email({ mode: 'send' }));
  assert.equal(out.message.status, 'demo');
  assert.ok(d.clients[0].lastContact, 'the client was contacted now');
  assert.equal(d.activity[0].kind, 'message.demoSent');
  assert.ok(!d.messages.some((x) => ['queued', 'sent', 'delivered'].includes(x.status)));
});

test('the same call in a live workspace marks the message `queued` for the server: the difference is deliveryStatus()', () => {
  const { d, ctx } = world();
  setSession({ mode: 'workspace', slug: 'x', tenantId: 't', industry: 'practice', planId: '', role: 'owner', actorId: 'u1' });
  try {
    assert.equal(deliveryStatus(), 'queued');
    const out = queueMessage(d, ctx, email({ mode: 'send' }));
    assert.equal(out.message.status, 'queued');
    assert.equal(d.activity[0].kind, 'message.queued');
  } finally { setSession(null); }
  assert.equal(deliveryStatus(), 'demo');
});

test('a text on another channel is logged with the channel name, and an automation is not named as a person', () => {
  const { d, ctx } = world();
  d.clients[0].smsOptIn = true;
  const out = queueMessage(d, ctx, { channel: 'text', to: '', body: 'See you tomorrow', ref, auto: 'rule:9', mode: 'send' });
  assert.equal(out.message.by, undefined); assert.equal(out.message.auto, 'rule:9');
  assert.equal(d.activity[0].kind, 'message.other.demoSent'); assert.equal(d.activity[0].params.channel, 'Text message');
});

test('the same automation never writes the same message twice', () => {
  const { d, ctx } = world();
  const a = queueMessage(d, ctx, email({ auto: 'job-started:j1' })), b = queueMessage(d, ctx, email({ auto: 'job-started:j1', body: 'Other' }));
  assert.equal(a.message.id, b.message.id); assert.equal(d.messages.length, 1);
});

test('sendDraft checks again: a draft cannot be sent after the person opted out of texts', () => {
  const { d, ctx } = world();
  d.clients[0].smsOptIn = true;
  const out = queueMessage(d, ctx, { channel: 'text', to: '', body: 'Hi', ref });
  d.clients[0].smsOptIn = false;
  assert.deepEqual(sendDraft(d, ctx, out.message.id), { ok: false, reason: 'opted_out' });
  assert.equal(out.message.status, 'draft');
  assert.deepEqual(sendDraft(d, ctx, 'nope'), { ok: false, reason: 'not_found' });
});

test('only a draft can be edited; a draft or a sample message can be discarded, a received one cannot', () => {
  const { d, ctx } = world();
  const out = queueMessage(d, ctx, email({ mode: 'send' }));
  assert.equal(updateDraft(d, ctx, out.message.id, { body: 'changed' }), null);
  assert.equal(out.message.body, 'Body');
  const inc = receiveMessage(d, ctx, { channel: 'email', from: 'dana@example.com', body: 'Hello' });
  assert.equal(discardDraft(d, ctx, inc.id), false);
  assert.equal(discardDraft(d, ctx, out.message.id), true);
  assert.deepEqual(d.messages.map((x) => x.id), [inc.id]);
});

/* ---------- quiet hours ---------- */

test('isQuiet handles a period that runs past midnight', () => {
  const q = { on: true, from: '21:00', to: '08:00' };
  assert.equal(isQuiet('22:30', q), true); assert.equal(isQuiet('07:59', q), true); assert.equal(isQuiet('08:00', q), false); assert.equal(isQuiet('12:00', q), false);
  assert.equal(isQuiet('22:30', { ...q, on: false }), false);
  assert.equal(isQuiet('10:00', { on: true, from: '09:00', to: '17:00' }), true);
});

test('an automatic text due during quiet hours waits as a draft; a person and an email are not held', () => {
  const { d, ctx } = world();
  d.clients[0].smsOptIn = true;
  saveCommsSettings(d, ctx, { quiet: { on: true, from: '00:00', to: '23:59' } });
  const held = queueMessage(d, ctx, { channel: 'text', to: '', body: 'Reminder', ref, auto: 'rule:1', mode: 'send' });
  assert.equal(held.message.status, 'draft'); assert.equal(held.message.held, 'quiet_hours');
  assert.equal(queueMessage(d, ctx, { channel: 'text', to: '', body: 'By hand', ref, personal: true, mode: 'send' }).message.status, 'demo');
  assert.equal(queueMessage(d, ctx, email({ auto: 'rule:2', mode: 'send' })).message.status, 'demo');
  // a person sends the held one: the mark goes away
  assert.equal(sendDraft(d, ctx, held.message.id).message.status, 'demo');
  assert.equal(held.message.held, undefined);
});

/* ---------- conversations ---------- */

test('messages to the same person on the same channel share a thread; another channel is another thread', () => {
  const { d, ctx } = world();
  d.clients[0].smsOptIn = true;
  const a = queueMessage(d, ctx, email()).message, b = queueMessage(d, ctx, email({ subject: 'Again' })).message;
  const c = queueMessage(d, ctx, { channel: 'text', to: '', body: 'Hi', ref }).message;
  assert.equal(a.threadId, 'c:c1:email'); assert.equal(b.threadId, a.threadId); assert.equal(c.threadId, 'c:c1:text');
  // about a job of the same client: still the client's conversation
  d.jobs = [{ id: 'j1', clientId: 'c1' }];
  assert.equal(queueMessage(d, ctx, email({ ref: { type: 'job', id: 'j1' } })).message.threadId, 'c:c1:email');
  d.leads = [lead('l1')];
  assert.equal(queueMessage(d, ctx, email({ ref: { type: 'lead', id: 'l1' } })).message.threadId, 'l:l1:email');
});

test('a reply joins the thread of the message it answers', () => {
  const { d, ctx } = world();
  const inc = receiveMessage(d, ctx, { channel: 'email', from: 'Dana@Example.com', subject: 'Question', body: 'Hello' });
  inc.threadId = 'provider-thread-77';
  const out = queueMessage(d, ctx, email({ replyTo: inc.id, mode: 'send' }));
  assert.equal(out.message.threadId, 'provider-thread-77');
});

test('an incoming message is matched to the client, is unread, and marks the client as contacted', () => {
  const { d, ctx } = world();
  const inc = receiveMessage(d, ctx, { channel: 'text', from: '+1 (609) 555-0142', body: 'On my way' });
  assert.equal(inc.clientId, 'c1'); assert.deepEqual(inc.ref, ref); assert.equal(inc.status, 'received'); assert.equal(inc.dir, 'in'); assert.equal(inc.read, false);
  assert.ok(d.clients[0].lastContact);
  markRead(d, ctx, [inc.id]);
  assert.equal(inc.read, true);
});

test('an incoming message from a lead goes to the lead; from nobody on file it has no record and is still kept', () => {
  const { d, ctx } = world();
  d.leads = [lead('l1')];
  assert.deepEqual(receiveMessage(d, ctx, { channel: 'email', from: 'lee@example.com', body: 'Hi' }).ref, { type: 'lead', id: 'l1' });
  const stranger = receiveMessage(d, ctx, { channel: 'instagram', from: 'sample.handle', body: 'Hi' });
  assert.equal(stranger.ref.id, ''); assert.equal(stranger.clientId, undefined); assert.equal(stranger.threadId, 'a:sample.handle:instagram');
  assert.deepEqual(matchSender(d, 'email', 'nobody@example.com'), {});
});

test('the same provider message is never recorded twice', () => {
  const { d, ctx } = world();
  const a = receiveMessage(d, ctx, { channel: 'whatsapp', from: '609-555-0142', body: 'Hi', provider: 'whatsapp', externalId: 'wamid.1' });
  const b = receiveMessage(d, ctx, { channel: 'whatsapp', from: '609-555-0142', body: 'Hi', provider: 'whatsapp', externalId: 'wamid.1' });
  assert.equal(a.id, b.id); assert.equal(d.messages.length, 1);
});

test('the inbox shows one conversation per person across channels, with unread, needs reply and drafts', () => {
  const { d, ctx } = world();
  d.clients[0].smsOptIn = true;
  queueMessage(d, ctx, email({ mode: 'send' })).message.at = new Date(Date.now() - 10000).toISOString();
  const inc = receiveMessage(d, ctx, { channel: 'text', from: '609-555-0142', body: 'Thanks', at: new Date(Date.now() - 5000).toISOString() });
  queueMessage(d, ctx, email({ subject: 'Later' }));
  const viewer = { user: d.users[0], perms: ctx.pack.rolePermissions.owner };
  const list = conversations(d, viewer);
  assert.equal(list.length, 1);
  const c = list[0];
  assert.equal(c.key, 'c_c1'); assert.deepEqual(c.channels, ['email', 'text']); assert.equal(c.unread, 1); assert.equal(c.needsReply, true); assert.equal(c.drafts, 1); assert.equal(c.done, false);
  assert.equal(timeline(c).filter((e) => e.message).length, 3);
  // done until they write again
  setConversation(d, ctx, ref, { done: true, assignee: 'u3' });
  let again = conversations(d, viewer)[0];
  assert.equal(again.done, true); assert.equal(again.needsReply, false); assert.equal(again.assignee, 'u3');
  receiveMessage(d, ctx, { channel: 'text', from: '609-555-0142', body: 'One more thing', at: new Date(Date.now() + 5000).toISOString() });
  again = conversations(d, viewer)[0];
  assert.equal(again.done, false); assert.equal(again.needsReply, true);
  assert.ok(inc);
});

test('a system notice sits in the conversation without making it unread or its last line', () => {
  const { d, ctx } = world();
  queueMessage(d, ctx, email({ mode: 'send' }));
  d.messages.unshift({ id: 'sys1', at: new Date(Date.now() + 60000).toISOString(), channel: 'system', to: '', subject: '', body: 'A notice', status: 'received', dir: 'in', read: false, ref, clientId: 'c1' });
  const c = conversations(d, { user: d.users[0], perms: ctx.pack.rolePermissions.owner })[0];
  assert.equal(c.unread, 0); assert.equal(c.notices, 1); assert.equal(c.total, 1); assert.equal(c.needsReply, false); assert.equal(c.last.channel, 'email');
});

test('a logged call is a note on the record with its length, and shows in the conversation', () => {
  const { d, ctx } = world();
  const note = logCall(d, ctx, ref, { dir: 'out', seconds: 240, text: 'Talked about the balance' });
  assert.equal(note.kind, 'call'); assert.equal(note.seconds, 240); assert.equal(note.dir, 'out');
  assert.equal(d.clients[0].notes[0].id, note.id); assert.ok(d.clients[0].lastContact);
  assert.equal(d.messages.length, 0, 'nothing is added to the messages: a call written down is not a delivery');
  const c = conversations(d, { user: d.users[0], perms: ctx.pack.rolePermissions.owner })[0];
  assert.deepEqual(c.channels, ['call']); assert.equal(c.needsReply, false);
  assert.equal(logCall(d, ctx, { type: 'client', id: 'nope' }, { dir: 'in', seconds: 0, text: '' }), null);
});

test('the composer is told which channels reach the person and why not', () => {
  const { d, ctx } = world();
  d.clients[0].phone = '';
  const c = { key: 'c_c1', client: d.clients[0], ref, messages: [] };
  const by = Object.fromEntries(channelStates(d, ctx.pack, c, false).map((s) => [s.channel, s.blocked]));
  assert.deepEqual(by, { email: null, text: 'no_address', whatsapp: 'no_address', facebook: 'no_address', instagram: 'no_address' });
  // a live workspace also needs the connection
  assert.equal(channelStates(d, ctx.pack, c, true).find((s) => s.channel === 'email').blocked, 'not_connected');
  d.connections = [{ id: 'gmail', state: 'connected' }];
  assert.equal(channelStates(d, ctx.pack, c, true).find((s) => s.channel === 'email').blocked, null);
});

test('merge fields are filled, and one with nothing to say stays visible', () => {
  assert.equal(fillMerge('Hello {{client.first}}, see you {{appointment.date}}', { 'client.first': 'Dana' }), 'Hello Dana, see you {{appointment.date}}');
  assert.equal(fillLines('{{user.name}}\n{{user.title}}\n{{company.name}}', { 'user.name': 'Ana', 'company.name': 'Sample Co' }), 'Ana\nSample Co');
});

/* ---------- the names other modules already call ---------- */

test('composeMessage, sendMessageDemo and discardMessage keep working on top of queueMessage', () => {
  const { d, ctx } = world('build');
  d.clients[0].emailOptOut = true; d.clients[0].email = '';
  // "Email to client" from a document: prepared even without an address and for a client who opted out of the automatic ones
  const msg = composeMessage(d, ctx, { to: '', subject: 'Invoice', body: 'Here it is', ref });
  assert.equal(msg.status, 'draft'); assert.equal(msg.channel, 'email'); assert.equal(d.activity[0].kind, 'message.drafted');
  assert.equal(sendMessageDemo(d, ctx, msg.id).ok, false, 'no address yet');
  updateDraft(d, ctx, msg.id, { to: 'dana@example.com' });
  assert.equal(sendMessageDemo(d, ctx, msg.id).ok, true);
  assert.equal(msg.status, 'demo'); assert.equal(d.activity[0].kind, 'message.demoSent');
  discardMessage(d, ctx, msg.id);
  assert.equal(d.messages.length, 0);
});

/* ---------- social posts ---------- */

test('each network has its own rules: Instagram needs a picture and has the shortest caption after Google', () => {
  const post = (o) => ({ text: 'Hello', channels: ['facebook', 'instagram', 'gbp'], ...o });
  assert.deepEqual(postProblems(post()).map((p) => [p.channel, p.code]), [['instagram', 'needs_image']]);
  const jpg = { name: 'a.jpg', size: 10, mime: 'image/jpeg' }, png = { name: 'a.png', size: 10, mime: 'image/png' };
  assert.deepEqual(postProblems(post({ media: [jpg] })), []);
  assert.deepEqual(postProblems(post({ media: [png] })).map((p) => [p.channel, p.code]), [['instagram', 'image_type']]);
  assert.deepEqual(postProblems(post({ text: 'x'.repeat(1501), media: [jpg] })).map((p) => p.channel), ['gbp']);
  assert.deepEqual(postProblems(post({ text: 'x'.repeat(2201), media: [jpg] })).map((p) => p.channel), ['instagram', 'gbp']);
  assert.deepEqual(postProblems({ text: '', channels: [] }).map((p) => p.code), ['empty', 'no_channel']);
});

test('a post goes draft, approval, schedule, publish; publishing in a sample workspace marks it `demo`', () => {
  const { d, ctx } = world();
  const staff = { ...ctx, actor: 'u3' };
  const p = createPost(d, staff, { text: 'Hello', channels: ['facebook'] });
  assert.equal(p.status, 'draft'); assert.equal(p.by, 'u3');
  assert.equal(publishPost(d, staff, p.id).reason, 'not_allowed', 'office staff cannot publish');
  assert.equal(approvePost(d, staff, p.id).reason, 'not_allowed');
  assert.equal(submitPost(d, staff, p.id).ok, true); assert.equal(p.status, 'needs_approval');
  assert.equal(approvePost(d, { ...ctx, actor: 'u2' }, p.id).ok, true); assert.equal(p.approvedBy, 'u2'); assert.equal(p.status, 'draft');
  assert.equal(schedulePost(d, ctx, p.id, new Date(Date.now() - 60000).toISOString()).reason, 'past');
  assert.equal(schedulePost(d, ctx, p.id, new Date(Date.now() + 86400000).toISOString()).ok, true); assert.equal(p.status, 'scheduled');
  assert.equal(publishStatus(), 'demo');
  assert.equal(publishPost(d, ctx, p.id).ok, true);
  assert.equal(p.status, 'demo'); assert.ok(p.publishedAt); assert.equal(p.scheduledFor, undefined);
  assert.equal(publishPost(d, ctx, p.id).reason, 'wrong_state');
});

test('a post that breaks a network rule is not submitted or published; a live workspace hands it to the server', () => {
  const { d, ctx } = world();
  const p = createPost(d, ctx, { text: 'Hello', channels: ['instagram'] });
  assert.equal(submitPost(d, ctx, p.id).reason, 'invalid');
  assert.equal(publishPost(d, ctx, p.id).problems[0].code, 'needs_image');
  p.media = [{ name: 'a.jpg', size: 10, mime: 'image/jpeg' }];
  setSession({ mode: 'workspace', slug: 'x', tenantId: 't', industry: 'practice', planId: '', role: 'owner', actorId: 'u1' });
  try {
    assert.equal(publishPost(d, ctx, p.id).ok, true);
    assert.equal(p.status, 'scheduled', 'the browser never writes published'); assert.ok(p.scheduledFor); assert.equal(p.publishedAt, undefined);
  } finally { setSession(null); }
  p.status = 'failed'; p.error = 'x';
  assert.equal(retryPost(d, ctx, p.id).ok, true); assert.equal(p.status, 'demo'); assert.equal(p.error, undefined);
});
