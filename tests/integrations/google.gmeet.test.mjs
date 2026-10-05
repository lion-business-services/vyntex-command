// Google Meet (through the Calendar connection), tested with mocked provider responses. Nothing reaches Google.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setGoogleEnv, ctxFor, reply, gerr, memCursor, memLinks, leaks, TENANT } from './google.helpers.mjs';

setGoogleEnv();
const gmeet = (await import('../../api/_lib/integrations/providers/gmeet.js')).default;
const gcal = (await import('../../api/_lib/integrations/providers/gcal.js')).default;
const { ProviderError } = await import('../../api/_lib/integrations/oauth.js');
const { configState } = await import('../../api/_lib/integrations/core.js');
const { eventIdFor, stableId } = await import('../../api/_lib/integrations/google/state.js');

const CAL = 'vxcal123@group.calendar.google.com';
const EVENTS = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CAL)}/events`;
const calGet = (types = ['hangoutsMeet']) => ['GET', /\/calendars\/[^/]+$/, () => reply(200, { id: CAL, conferenceProperties: { allowedConferenceSolutionTypes: types } })];
const meetEv = (over = {}) => ({ id: eventIdFor(TENANT, 'appt_1'), etag: '"e1"', status: 'confirmed', updated: '2026-03-01T10:00:00.000Z', summary: 'Call', start: { dateTime: '2026-03-10T15:00:00Z' }, end: { dateTime: '2026-03-10T16:00:00Z' }, conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:+15555550100' }, { entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }] }, ...over });
const local = { id: 'appt_1', updatedAt: '2026-03-01T10:00:00.000Z', summary: 'Call', start: '2026-03-10T15:00:00.000Z', end: '2026-03-10T16:00:00.000Z' };
/** A gmeet context whose "peer" is a Calendar connection with tokens (or a failure to get one). */
function setup({ routes = [], peer, links = [] } = {}) {
  const cal = ctxFor(gcal, { connection: { account_label: 'office@example.com', account_ref: 'sub-1', state: 'connected' }, cursor: memCursor({ calendar_id: CAL }), links: memLinks(links), routes: [...routes, calGet()] });
  const me = ctxFor(gmeet, { tokens: null, peer: peer || (async (id) => { assert.equal(id, 'gcal'); return cal.ctx; }) });
  return { ctx: me.ctx, cal, own: me };
}
const rejects = (p, code, more = () => true) => assert.rejects(p, (e) => e instanceof ProviderError && e.code === code && !leaks(e) && more(e), code);

test('shape: no sign-in of its own, follows Calendar\'s approval, has no webhook receiver', async () => {
  assert.equal(gmeet.id, 'gmeet'); assert.equal(gmeet.kind, 'platform'); assert.equal(gmeet.dependsOn, 'gcal'); assert.equal(gmeet.webhook, null);
  assert.equal(gmeet.approval.flag, 'GOOGLE_CALENDAR_APPROVED');
  assert.equal(configState({ ...gmeet, built: true }).state, 'pending_approval');
  process.env.GOOGLE_CALENDAR_APPROVED = 'true';
  assert.equal(configState({ ...gmeet, built: true }).state, 'setup');
  // connect, callback and refresh do not exist for it: there is nothing to exchange.
  assert.throws(() => gmeet.authUrl({}), (e) => e.code === 'not_oauth');
  await rejects(gmeet.exchange({}, 'c'), 'not_oauth');
  assert.deepEqual(await gmeet.refresh({}, { a: 1 }), { a: 1 });
  assert.deepEqual(await gmeet.sync({}), { ok: true, skipped: 'nothing_to_sync' });
});

test('connect: "connected" only when Calendar is connected and the calendar really allows Meet', async () => {
  const s = setup();
  assert.deepEqual(await gmeet.status(s.ctx), { ok: true, account: { label: 'office@example.com', ref: 'sub-1' }, scopes: ['https://www.googleapis.com/auth/calendar.app.created'] });
  assert.equal(s.cal.calls.length, 1, 'a real call, made with the Calendar connection\'s token');
  assert.equal(s.cal.calls[0].init.headers.authorization, 'Bearer ya29.test-access'); assert.equal(s.own.calls.length, 0);
  assert.deepEqual(await gmeet.health(s.ctx), { ok: true, health: 'ok' });
  const noMeet = ctxFor(gcal, { cursor: memCursor({ calendar_id: CAL }), routes: [calGet(['eventHangout'])] });
  assert.deepEqual(await gmeet.status(ctxFor(gmeet, { tokens: null, peer: async () => noMeet.ctx }).ctx), { ok: false, reason: 'meet_not_available' });
});

test('state follows Calendar: not connected, revoked permission, expired token, outage, rate limit', async () => {
  const failing = (err) => ctxFor(gmeet, { tokens: null, peer: async () => { throw err; } }).ctx;
  assert.deepEqual(await gmeet.status(failing(new ProviderError('not_connected'))), { ok: false, reason: 'calendar_not_connected' });
  // Calendar's refresh token was revoked (invalid_grant): Meet needs the person again too, through Calendar.
  assert.deepEqual(await gmeet.health(failing(new ProviderError('invalid_grant', { reauth: true }))), { ok: false, reason: 'calendar_reauth', reauth: true });
  assert.deepEqual(await gmeet.health(failing(new ProviderError('token_expired', { reauth: true }))), { ok: false, reason: 'calendar_reauth', reauth: true });
  assert.deepEqual(await gmeet.status(ctxFor(gmeet, { tokens: null, peer: async () => ({ tokens: null }) }).ctx), { ok: false, reason: 'calendar_not_connected' });
  await rejects(gmeet.actions.createMeeting(failing(new ProviderError('not_connected')), local), 'calendar_not_connected');
  const down = ctxFor(gcal, { cursor: memCursor({ calendar_id: CAL }), routes: [['GET', '/calendars/', () => reply(503, 'x')]] });
  await rejects(gmeet.status(ctxFor(gmeet, { tokens: null, peer: async () => down.ctx }).ctx), 'provider_down');
  assert.deepEqual(down.waits, [250, 750]);
  const slow = ctxFor(gcal, { cursor: memCursor({ calendar_id: CAL }), routes: [['GET', '/calendars/', () => gerr(429, 'rateLimitExceeded', { 'retry-after': '45' })]] });
  await rejects(gmeet.status(ctxFor(gmeet, { tokens: null, peer: async () => slow.ctx }).ctx), 'rate_limited', (e) => e.retryAfter === 45);
  const odd = ctxFor(gcal, { cursor: memCursor({ calendar_id: CAL }), routes: [['GET', '/calendars/', () => reply(200, '<html>')]] });
  await rejects(gmeet.status(ctxFor(gmeet, { tokens: null, peer: async () => odd.ctx }).ctx), 'bad_answer');
});

test('createMeeting: the event is written with a conference request whose id never changes for the same record', async () => {
  let sent = null;
  const s = setup({ routes: [['POST', EVENTS, (u, init) => { sent = JSON.parse(init.body); assert.equal(u.searchParams.get('conferenceDataVersion'), '1'); return reply(200, meetEv()); }]] });
  const out = await gmeet.actions.createMeeting(s.ctx, local);
  assert.deepEqual(out, { eventId: eventIdFor(TENANT, 'appt_1'), meetUrl: 'https://meet.google.com/abc-defg-hij', pending: false, outcome: 'created', conflict: undefined });
  const requestId = stableId('vx-meet', TENANT, 'appt_1').slice(0, 40);
  assert.deepEqual(sent.conferenceData, { createRequest: { requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } });
  assert.equal(s.cal.ctx.links.rows.get('appt_1').event_id, eventIdFor(TENANT, 'appt_1'));
});

test('duplicate and late links: a repeat asks with the same request id; a link Google is still making is reported as pending', async () => {
  const ids = [];
  const s = setup({ routes: [
    ['POST', EVENTS, (u, init) => { ids.push(JSON.parse(init.body).conferenceData.createRequest.requestId); return reply(200, meetEv({ conferenceData: { createRequest: { status: { statusCode: 'pending' } } } })); }],
    ['PATCH', '/events/', (u, init) => { ids.push(JSON.parse(init.body).conferenceData.createRequest.requestId); return reply(200, meetEv({ conferenceData: { createRequest: { status: { statusCode: 'pending' } } } })); }],
    ['GET', '/events/', () => reply(200, meetEv())],
  ] });
  const out = await gmeet.actions.createMeeting(s.ctx, local);
  assert.equal(out.meetUrl, null); assert.equal(out.pending, true);
  assert.equal(new Set(ids).size, 1, 'the create and the follow up carry one request id: one conference at most');
  assert.deepEqual(await gmeet.actions.linkFor(s.ctx, out.eventId), { eventId: out.eventId, meetUrl: 'https://meet.google.com/abc-defg-hij', pending: false });
  await rejects(gmeet.actions.addToEvent(s.ctx, 'NOT-AN-ID', 'appt_1'), 'invalid_id');
});
