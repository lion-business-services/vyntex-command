// The Google Calendar adapter, tested with mocked provider responses. Nothing reaches Google.
// Not exercised against Google: no client or account exists in this build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setGoogleEnv, ctxFor, reply, gerr, memCursor, memLinks, memSink, goodTokens, leaks, TENANT, OTHER_TENANT, CHANNEL_SECRET, CLIENT_SECRET } from './google.helpers.mjs';

setGoogleEnv({ GOOGLE_CHANNEL_SECRET: CHANNEL_SECRET });
const gcal = (await import('../../api/_lib/integrations/providers/gcal.js')).default;
const { decide } = await import('../../api/_lib/integrations/providers/gcal.js');
const { ProviderError } = await import('../../api/_lib/integrations/oauth.js');
const { configState } = await import('../../api/_lib/integrations/core.js');
const { eventIdFor, channelToken } = await import('../../api/_lib/integrations/google/state.js');

const API = 'https://www.googleapis.com/calendar/v3';
const CAL = 'vxcal123@group.calendar.google.com';
const EVENTS = `${API}/calendars/${encodeURIComponent(CAL)}/events`;
const conn = { account_label: 'office@example.com', account_ref: 'sub-1', state: 'connected' };
const rejects = (p, code, more = () => true) => assert.rejects(p, (e) => e instanceof ProviderError && e.code === code && !leaks(e) && more(e), code);
const calOk = ['GET', new RegExp(`/calendars/${encodeURIComponent(CAL).replace('.', '\\.')}$`), () => reply(200, { id: CAL, conferenceProperties: { allowedConferenceSolutionTypes: ['hangoutsMeet'] } })];
const userinfo = (sub = 'sub-1', email = 'Office@Example.com') => ['GET', 'openidconnect.googleapis.com/v1/userinfo', () => reply(200, { sub, email, email_verified: true })];
const T0 = '2026-03-01T10:00:00.000Z', T1 = '2026-03-01T11:00:00.000Z', T2 = '2026-03-01T12:00:00.000Z';
const local = (over = {}) => ({ id: 'appt_1', updatedAt: T0, summary: 'Consulta inicial', location: 'Office', description: '', start: '2026-03-10T15:00:00.000Z', end: '2026-03-10T16:00:00.000Z', ...over });
const gev = (over = {}) => ({ id: eventIdFor(TENANT, 'appt_1'), etag: '"e1"', status: 'confirmed', updated: T0, summary: 'Consulta inicial', location: 'Office', description: '', start: { dateTime: '2026-03-10T11:00:00-04:00' }, end: { dateTime: '2026-03-10T12:00:00-04:00' }, htmlLink: 'https://calendar.example/e', extendedProperties: { private: { vxId: 'appt_1', vxTenant: TENANT } }, ...over });
const linked = (over = {}) => ({ local_id: 'appt_1', calendar_id: CAL, event_id: eventIdFor(TENANT, 'appt_1'), etag: '"e1"', remote_updated: T0, local_updated: T0, hash: 'old', ...over });
const setup = (opts = {}) => ctxFor(gcal, { connection: conn, cursor: memCursor({ calendar_id: CAL, ...(opts.cursor || {}) }), links: memLinks(opts.links || []), sink: (opts.inbox || memSink()).sink, routes: [...(opts.routes || []), calOk], ...(opts.more || {}) });

test('shape, minimal scope, pending approval until flagged', () => {
  assert.equal(gcal.id, 'gcal'); assert.equal(gcal.kind, 'oauth');
  assert.deepEqual(gcal.scopes, ['openid', 'email', 'https://www.googleapis.com/auth/calendar.app.created']);
  for (const fn of ['authUrl', 'exchange', 'refresh', 'revoke', 'status', 'health', 'sync']) assert.equal(typeof gcal[fn], 'function', fn);
  assert.equal(configState({ ...gcal, built: true }).state, 'pending_approval');
  process.env.GOOGLE_CALENDAR_APPROVED = 'true';
  assert.equal(configState({ ...gcal, built: true }).state, 'setup');
});

test('connect, callback exchange, refresh on expiry, revoked permission', async () => {
  const u = new URL(gcal.authUrl(ctxFor(gcal, { state: 's1', challenge: 'c1' }).ctx));
  assert.equal(u.searchParams.get('scope'), gcal.scopes.join(' ')); assert.equal(u.searchParams.get('redirect_uri'), 'https://app.example.com/api/integrations/gcal/callback');
  assert.equal(u.searchParams.get('access_type'), 'offline'); assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  const ex = ctxFor(gcal, { tokens: null, verifier: 'ver', routes: [['POST', 'oauth2.googleapis.com/token', () => reply(200, { access_token: 'a1', refresh_token: 'r1', expires_in: 3600, scope: gcal.scopes.join(' ') })]] });
  const t = await gcal.exchange(ex.ctx, 'code');
  assert.equal(new URLSearchParams(ex.calls[0].body).get('code_verifier'), 'ver'); assert.equal(new URLSearchParams(ex.calls[0].body).get('client_secret'), CLIENT_SECRET);
  assert.equal(t.refresh_token, 'r1');
  const r = await gcal.refresh(ctxFor(gcal, { routes: [['POST', '/token', () => reply(200, { access_token: 'a2', expires_in: 3600 })]] }).ctx, t);
  assert.equal(r.access_token, 'a2'); assert.equal(r.refresh_token, 'r1');
  await rejects(gcal.refresh(ctxFor(gcal, { routes: [['POST', '/token', () => reply(400, { error: 'invalid_grant' })]] }).ctx, t), 'invalid_grant', (e) => e.reauth === true);
  await rejects(gcal.status(ctxFor(gcal, { routes: [['GET', '/userinfo', () => gerr(401, 'authError')]] }).ctx), 'token_rejected', (e) => e.reauth === true);
});

test('status and wrong account', async () => {
  const ok = ctxFor(gcal, { routes: [userinfo()] });
  assert.deepEqual(await gcal.status(ok.ctx), { ok: true, account: { label: 'office@example.com', ref: 'sub-1' }, scopes: gcal.scopes });
  assert.equal(ok.calls.length, 1);
  const unticked = ctxFor(gcal, { tokens: goodTokens(gcal, { scope: 'openid email' }), routes: [userinfo()] });
  assert.deepEqual(await gcal.status(unticked.ctx), { ok: false, reason: 'scope_missing' }); assert.equal(unticked.calls.length, 0);
  process.env.GOOGLE_ALLOWED_DOMAINS = 'lbs.example';
  assert.deepEqual(await gcal.status(ctxFor(gcal, { routes: [userinfo()] }).ctx), { ok: false, reason: 'wrong_account' });
  delete process.env.GOOGLE_ALLOWED_DOMAINS;
  assert.deepEqual(await gcal.health(ctxFor(gcal, { connection: conn, cursor: memCursor(), routes: [userinfo('sub-OTHER')] }).ctx), { ok: false, reason: 'wrong_account', reauth: true });
  assert.deepEqual(await gcal.health(setup({ routes: [userinfo()] }).ctx), { ok: true, health: 'ok' });
  assert.deepEqual(await gcal.health(ctxFor(gcal, { connection: conn, cursor: memCursor({ calendar_id: CAL }), routes: [userinfo(), ['GET', '/calendars/', () => gerr(404, 'notFound')]] }).ctx), { ok: false, reason: 'calendar_missing' });
});

test('the conflict rule: the newer change wins, and only when both sides changed is it a conflict', () => {
  const base = { baseLocal: T0, baseRemote: T0 };
  assert.equal(decide({ localUpdated: T0, remoteUpdated: T0, ...base }), 'none');
  assert.equal(decide({ localUpdated: T1, remoteUpdated: T0, ...base }), 'push');
  assert.equal(decide({ localUpdated: T0, remoteUpdated: T1, ...base }), 'pull');
  assert.equal(decide({ localUpdated: T2, remoteUpdated: T1, ...base }), 'local_wins');
  assert.equal(decide({ localUpdated: T1, remoteUpdated: T2, ...base }), 'remote_wins');
  assert.equal(decide({ localUpdated: T1, remoteUpdated: T1, ...base }), 'remote_wins', 'a tie keeps the copy other people see');
});

test('insert: a deterministic event id, the local id in private properties, a stored link, and the calendar made once', async () => {
  const cursor = memCursor(), links = memLinks();
  let made = 0;
  const routes = [
    ['POST', /\/calendar\/v3\/calendars$/, (u, init) => { made += 1; assert.equal(JSON.parse(init.body).summary, 'VYNTEX Command'); return reply(200, { id: CAL }); }],
    ['POST', EVENTS, (u, init) => { const b = JSON.parse(init.body); assert.equal(u.searchParams.get('conferenceDataVersion'), '1'); assert.equal(u.searchParams.get('sendUpdates'), 'none'); return reply(200, gev({ id: b.id, extendedProperties: b.extendedProperties, etag: '"e1"' })); }],
    calOk,
  ];
  const a = ctxFor(gcal, { connection: conn, cursor, links, routes });
  const out = await gcal.actions.upsertEvent(a.ctx, local());
  const id = eventIdFor(TENANT, 'appt_1');
  assert.match(id, /^[a-v0-9]{42}$/); assert.notEqual(id, eventIdFor(OTHER_TENANT, 'appt_1'));
  assert.equal(out.outcome, 'created'); assert.equal(out.eventId, id); assert.equal(cursor.data.get('calendar_id'), CAL);
  const body = JSON.parse(a.net.of('/events')[0].body);
  assert.equal(body.id, id); assert.deepEqual(body.extendedProperties, { private: { vxId: 'appt_1', vxTenant: TENANT } });
  assert.deepEqual(body.start, { dateTime: '2026-03-10T15:00:00.000Z' });
  const link = links.rows.get('appt_1');
  assert.equal(link.event_id, id); assert.equal(link.etag, '"e1"'); assert.equal(link.remote_updated, T0); assert.equal(link.local_updated, T0);
  // The same record again, unchanged: no write at all.
  const again = ctxFor(gcal, { connection: conn, cursor, links, routes });
  assert.equal((await gcal.actions.upsertEvent(again.ctx, local())).outcome, 'unchanged');
  assert.equal(again.net.of('/events').length, 0); assert.equal(made, 1, 'the calendar is created once and found by its stored id');
  await rejects(gcal.actions.upsertEvent(a.ctx, local({ end: '2026-03-10T14:00:00.000Z' })), 'event_invalid');
  await rejects(gcal.actions.upsertEvent(a.ctx, local({ id: 'bad id' })), 'event_invalid');
});

test('duplicate prevention: a second insert of the same record meets "already exists" and adopts the event', async () => {
  // The first attempt wrote the event and died before the link was stored (a retried job, or two tabs).
  const s = setup({ routes: [['POST', EVENTS, () => gerr(409, 'duplicate')], ['GET', new RegExp('/events/' + eventIdFor(TENANT, 'appt_1')), () => reply(200, gev({ updated: T2 }))]] });
  const out = await gcal.actions.upsertEvent(s.ctx, local());
  assert.equal(out.outcome, 'created'); assert.equal(s.ctx.links.rows.get('appt_1').event_id, eventIdFor(TENANT, 'appt_1'));
  assert.deepEqual(s.calls.filter((c) => c.method !== 'GET').map((c) => c.method), ['POST'], 'no second event and no overwrite');
});

test('update: only the local side changed, so it is written with If-Match on the version both sides agreed on', async () => {
  const s = setup({ links: [linked()], routes: [['PATCH', '/events/', (u, init) => { assert.equal(init.headers['if-match'], '"e1"'); return reply(200, gev({ etag: '"e2"', updated: T1, summary: 'Nueva hora' })); }]] });
  const out = await gcal.actions.upsertEvent(s.ctx, local({ updatedAt: T1, summary: 'Nueva hora' }));
  assert.equal(out.outcome, 'updated'); assert.equal(out.conflict, undefined);
  assert.equal(s.ctx.links.rows.get('appt_1').etag, '"e2"'); assert.equal(s.ctx.links.rows.get('appt_1').local_updated, T1);
});

test('conflict: both changed and Google is newer, so nothing is written and the local loser is reported', async () => {
  const s = setup({ links: [linked()], routes: [['PATCH', '/events/', () => gerr(412, 'conditionNotMet')], ['GET', '/events/', () => reply(200, gev({ etag: '"e9"', updated: T2, summary: 'Moved in Google' }))]] });
  const out = await gcal.actions.upsertEvent(s.ctx, local({ updatedAt: T1, summary: 'Changed in the app' }));
  assert.equal(out.outcome, 'remote_newer'); assert.equal(out.remote.summary, 'Moved in Google');
  assert.deepEqual(out.conflict, { winner: 'remote', loser: { side: 'local', updated: T1, event: null } });
  assert.equal(s.calls.filter((c) => c.method === 'PATCH').length, 1, 'only the refused attempt: Google\'s copy was not overwritten');
  assert.equal(s.ctx.links.rows.get('appt_1').etag, '"e1"', 'the link still shows the last agreement');
});

test('conflict: both changed and the app is newer, so it is written and Google\'s lost copy comes back in the answer', async () => {
  let n = 0;
  const s = setup({ links: [linked()], routes: [
    ['PATCH', '/events/', (u, init) => { n += 1; if (n === 1) return gerr(412, 'conditionNotMet'); assert.equal(init.headers['if-match'], '"e9"'); return reply(200, gev({ etag: '"e10"', updated: T2, summary: 'Changed in the app' })); }],
    ['GET', '/events/', () => reply(200, gev({ etag: '"e9"', updated: T1, summary: 'Moved in Google', location: 'Room 2' }))],
  ] });
  const out = await gcal.actions.upsertEvent(s.ctx, local({ updatedAt: T2, summary: 'Changed in the app' }));
  assert.equal(out.outcome, 'updated'); assert.equal(out.conflict.winner, 'local');
  assert.equal(out.conflict.loser.side, 'remote'); assert.equal(out.conflict.loser.updated, T1);
  assert.equal(out.conflict.loser.event.summary, 'Moved in Google'); assert.equal(out.conflict.loser.event.location, 'Room 2');
  assert.equal(s.ctx.links.rows.get('appt_1').etag, '"e10"');
});

test('only Google changed: the app does not overwrite it; an event deleted at Google is not brought back by an old copy', async () => {
  const s = setup({ links: [linked({ hash: 'x' })], routes: [['PATCH', '/events/', () => gerr(412, 'conditionNotMet')], ['GET', '/events/', () => reply(200, gev({ etag: '"e5"', updated: T1 }))]] });
  const out = await gcal.actions.upsertEvent(s.ctx, local());
  assert.equal(out.outcome, 'remote_newer'); assert.equal(out.conflict, undefined);
  const d = setup({ links: [linked({ hash: 'x' })], routes: [['PATCH', '/events/', () => gerr(412, 'conditionNotMet')], ['GET', '/events/', () => reply(200, gev({ etag: '"e6"', updated: T1, status: 'cancelled' }))]] });
  const gone = await gcal.actions.upsertEvent(d.ctx, local());
  assert.equal(gone.outcome, 'remote_newer'); assert.equal(gone.remote.status, 'cancelled');
});

test('delete: removes the event and the link, and is safe to repeat', async () => {
  const s = setup({ links: [linked()], routes: [['DELETE', '/events/' + eventIdFor(TENANT, 'appt_1'), () => new Response(null, { status: 204 })]] });
  assert.deepEqual(await gcal.actions.deleteEvent(s.ctx, 'appt_1'), { outcome: 'deleted', eventId: eventIdFor(TENANT, 'appt_1') });
  assert.equal(s.ctx.links.rows.size, 0);
  assert.deepEqual(await gcal.actions.deleteEvent(s.ctx, 'appt_1'), { outcome: 'not_linked' });
  const already = setup({ links: [linked()], routes: [['DELETE', '/events/', () => gerr(410, 'deleted')]] });
  assert.equal((await gcal.actions.deleteEvent(already.ctx, 'appt_1')).outcome, 'deleted');
});

test('successful sync: incremental with the sync token; our own writes are skipped; changes are handed over once', async () => {
  const inbox = memSink();
  const items = [
    gev({ etag: '"e1"' }),                                                                              // the echo of our own write
    gev({ id: eventIdFor(TENANT, 'appt_2'), etag: '"m2"', updated: T1, summary: 'Moved', extendedProperties: { private: { vxId: 'appt_2', vxTenant: TENANT } } }),
    { id: eventIdFor(TENANT, 'appt_3'), status: 'cancelled', etag: '"c3"', updated: T1 },                 // deleted in Google
    { id: 'abcde12345', status: 'confirmed', etag: '"n1"', updated: T1, summary: 'Made in Google', start: { date: '2026-04-01' }, end: { date: '2026-04-02' }, hangoutLink: 'https://meet.google.com/abc-defg-hij' },
    { id: 'zzzzz99999', status: 'cancelled', etag: '"x"' },                                              // never known here
    gev({ id: 'copied11111', etag: '"o"', extendedProperties: { private: { vxId: 'appt_1', vxTenant: OTHER_TENANT } } }),
  ];
  const routes = [['GET', EVENTS, (u, i, n) => { assert.equal(u.searchParams.get('syncToken'), 'tok-1'); assert.equal(u.searchParams.get('showDeleted'), 'true'); return n === 1 ? reply(200, { items: items.slice(0, 3), nextPageToken: 'p2' }) : reply(200, { items: items.slice(3), nextSyncToken: 'tok-2' }); }]];
  const links = [linked(), linked({ local_id: 'appt_2', event_id: eventIdFor(TENANT, 'appt_2'), etag: '"old"' }), linked({ local_id: 'appt_3', event_id: eventIdFor(TENANT, 'appt_3'), etag: '"old3"' })];
  const s = setup({ cursor: { events: 'tok-1' }, links, inbox, routes });
  const out = await gcal.sync(s.ctx, 'events');
  assert.deepEqual(out.counts, { changed: 1, deleted: 1, created: 1, echoes: 1 }); assert.equal(s.ctx.cursor.data.get('events'), 'tok-2');
  const got = inbox.list().map((i) => [i.data.change, i.data.localId]);
  assert.deepEqual(got, [['changed', 'appt_2'], ['deleted', 'appt_3'], ['created', null]]);
  const created = inbox.list()[2].data.event;
  assert.equal(created.allDay, true); assert.equal(created.start, '2026-04-01'); assert.equal(created.meetUrl, 'https://meet.google.com/abc-defg-hij');
  assert.deepEqual(inbox.list()[0].data.base, { local: T0, remote: T0 });
  // The same page again (a retry): stored once.
  s.ctx.cursor.data.set('events', 'tok-1');
  await gcal.sync(setup({ cursor: { events: 'tok-1' }, links, inbox, routes }).ctx, 'events');
  assert.equal(inbox.items.size, 3);
});

test('410: the sync token is too old, so everything is read again and known events do not double', async () => {
  const inbox = memSink();
  const routes = [['GET', EVENTS, (u) => (u.searchParams.get('syncToken') ? gerr(410, 'fullSyncRequired') : reply(200, { items: [gev({ etag: '"e1"' }), gev({ id: eventIdFor(TENANT, 'appt_2'), etag: '"m2"', updated: T1, extendedProperties: { private: { vxId: 'appt_2', vxTenant: TENANT } } })], nextSyncToken: 'tok-new' }))]];
  const s = setup({ cursor: { events: 'tok-old' }, links: [linked()], inbox, routes });
  const out = await gcal.sync(s.ctx, 'events');
  assert.equal(out.resync, true); assert.equal(s.ctx.cursor.data.get('events'), 'tok-new');
  assert.deepEqual(out.counts, { changed: 0, deleted: 0, created: 1, echoes: 1 });
  assert.equal(inbox.list()[0].data.localId, 'appt_2', 'an event that carries a local id is offered for that record, not as a new one');
  assert.equal(s.net.of('/events').length, 2);
});

test('applyInbound: the same rule on the way in, and the agreement is recorded', async () => {
  const change = { change: 'changed', localId: 'appt_1', eventId: 'ev1', remoteUpdated: T1, base: { local: T0, remote: T0 }, event: { etag: '"e7"', summary: 'Moved in Google' } };
  const s = setup({ links: [linked()] });
  assert.deepEqual(await gcal.actions.applyInbound(s.ctx, change, { updatedAt: T0 }), { apply: true });
  assert.equal(s.ctx.links.rows.get('appt_1').etag, '"e7"'); assert.equal(s.ctx.links.rows.get('appt_1').remote_updated, T1);
  const newer = await gcal.actions.applyInbound(setup({ links: [linked()] }).ctx, change, { updatedAt: T2 });
  assert.deepEqual(newer, { apply: false, conflict: { winner: 'local', loser: { side: 'remote', updated: T1, event: change.event } } });
  const older = await gcal.actions.applyInbound(setup({ links: [linked()] }).ctx, { ...change, remoteUpdated: T2 }, { updatedAt: T1 });
  assert.deepEqual(older, { apply: true, conflict: { winner: 'remote', loser: { side: 'local', updated: T1, event: null } } });
  const del = setup({ links: [linked()] });
  assert.deepEqual(await gcal.actions.applyInbound(del.ctx, { ...change, change: 'deleted', event: null }, { updatedAt: T0 }), { apply: true });
  assert.equal(del.ctx.links.rows.size, 0);
});

test('watch channel: created with a token only this server can make, renewed when due, the old one stopped', async () => {
  const now = Date.UTC(2026, 2, 1);
  let seen = null;
  const routes = [['POST', '/events/watch', (u, init) => { seen = JSON.parse(init.body); return reply(200, { kind: 'api#channel', id: seen.id, resourceId: 'res-1', expiration: String(now + 7 * 86400e3) }); }], ['POST', '/channels/stop', () => new Response(null, { status: 204 })]];
  const s = setup({ routes, more: { now } });
  const out = await gcal.sync(s.ctx, 'watch');
  assert.deepEqual(out.watch, { watching: true, renewed: true });
  assert.equal(seen.type, 'web_hook'); assert.equal(seen.address, 'https://app.example.com/api/webhooks/gcal');
  assert.equal(seen.token, channelToken(CHANNEL_SECRET, TENANT, seen.id)); assert.match(seen.id, /^vx-[0-9a-f]{40}$/);
  const stored = JSON.parse(s.ctx.cursor.data.get('watch'));
  assert.deepEqual(stored, { id: seen.id, resourceId: 'res-1', calendarId: CAL, expiration: now + 7 * 86400e3 });
  // Still has days to go: no call.
  const idle = setup({ cursor: { watch: JSON.stringify(stored) }, more: { now: now + 86400e3 } });
  assert.deepEqual((await gcal.sync(idle.ctx, 'watch')).watch, { watching: true, renewed: false });
  assert.equal(idle.net.of('/watch').length, 0);
  // Under two days left: a new channel, and the old one is stopped.
  const due = setup({ cursor: { watch: JSON.stringify(stored) }, routes, more: { now: now + 6 * 86400e3 } });
  assert.equal((await gcal.sync(due.ctx, 'watch')).watch.renewed, true);
  assert.notEqual(JSON.parse(due.ctx.cursor.data.get('watch')).id, stored.id);
  assert.deepEqual(JSON.parse(due.net.of('/channels/stop')[0].body), { id: stored.id, resourceId: 'res-1' });
  // The same day twice: Google says the id is taken, which means it is already watching.
  const twice = setup({ routes: [['POST', '/events/watch', () => gerr(400, 'channelIdNotUnique')]], more: { now } });
  assert.deepEqual((await gcal.sync(twice.ctx, 'watch')).watch, { watching: true, renewed: false });
  const keep = process.env.GOOGLE_CHANNEL_SECRET; delete process.env.GOOGLE_CHANNEL_SECRET;
  assert.deepEqual((await gcal.sync(setup().ctx, 'watch')).watch, { watching: false, reason: 'push_not_configured' });
  process.env.GOOGLE_CHANNEL_SECRET = keep;
});

const notice = (over = {}, channel = 'vx-chan-1', tenant = TENANT) => new Request('https://app.example.com/api/webhooks/gcal', { method: 'POST', headers: { 'x-goog-channel-id': channel, 'x-goog-channel-token': channelToken(CHANNEL_SECRET, tenant, channel), 'x-goog-resource-id': 'res-1', 'x-goog-resource-state': 'exists', 'x-goog-message-number': '7', 'x-goog-channel-expiration': new Date(Date.now() + 86400e3).toUTCString(), ...over } });
const vctx = { provider: 'gcal', env: (n) => process.env[n] || '', now: () => Date.now() };

test('webhook valid: the channel token names the company and nothing personal is kept', () => {
  const v = gcal.webhook.verify(notice(), Buffer.alloc(0), vctx);
  assert.deepEqual(v, { ok: true, eventId: 'vx-chan-1:7', type: 'gcal.exists', tenantId: TENANT, redacted: { type: 'gcal.exists', channel: 'vx-chan-1', resource: 'res-1', number: 7 } });
});

test('webhook bad token, malformed notice, ended channel, no secret', () => {
  const bad = (over, reason, channel, tenant) => assert.deepEqual(gcal.webhook.verify(notice(over, channel, tenant), Buffer.alloc(0), vctx), { ok: false, reason }, reason);
  bad({ 'x-goog-channel-token': '' }, 'signature_missing');
  bad({ 'x-goog-channel-token': 'v1.' + TENANT + '.' + 'a'.repeat(64) }, 'bad_signature');
  bad({ 'x-goog-channel-token': channelToken(CHANNEL_SECRET, OTHER_TENANT, 'vx-chan-1').replace(OTHER_TENANT, TENANT) }, 'bad_signature');   // another company's token re-labelled
  bad({ 'x-goog-channel-token': channelToken(CHANNEL_SECRET, TENANT, 'vx-chan-2') }, 'bad_signature');                                   // a token of another channel
  bad({ 'x-goog-channel-token': channelToken('x'.repeat(40), TENANT, 'vx-chan-1') }, 'bad_signature');                                   // made with another secret
  bad({ 'x-goog-channel-token': 'garbage' }, 'bad_signature');
  bad({ 'x-goog-message-number': 'seven' }, 'bad_payload'); bad({ 'x-goog-resource-state': 'exploded' }, 'bad_payload');
  bad({ 'x-goog-channel-expiration': new Date(Date.now() - 60000).toUTCString() }, 'stale');
  const keep = process.env.GOOGLE_CHANNEL_SECRET; delete process.env.GOOGLE_CHANNEL_SECRET;
  bad({}, 'not_configured');
  process.env.GOOGLE_CHANNEL_SECRET = keep;
});

test('webhook duplicate, hello notice, left over channel: a notice only ever starts one sync of what is new', async () => {
  const a = gcal.webhook.verify(notice(), Buffer.alloc(0), vctx), b = gcal.webhook.verify(notice(), Buffer.alloc(0), vctx);
  assert.equal(a.eventId, b.eventId, 'the framework records an event id once');
  assert.notEqual(gcal.webhook.verify(notice({ 'x-goog-message-number': '8' }), Buffer.alloc(0), vctx).eventId, a.eventId);
  const inbox = memSink();
  const watch = JSON.stringify({ id: 'vx-chan-1', resourceId: 'res-1', calendarId: CAL, expiration: Date.now() + 5 * 86400e3 });
  const routes = [['GET', EVENTS, () => reply(200, { items: [{ id: 'abcde12345', status: 'confirmed', etag: '"n1"', updated: T1, summary: 'New', start: { date: '2026-04-01' }, end: { date: '2026-04-02' } }], nextSyncToken: 't2' })]];
  const s = setup({ cursor: { watch, events: 't1' }, inbox, routes });
  assert.deepEqual(await gcal.webhook.handle(s.ctx, { redacted: a.redacted }), { ok: true, counts: { changed: 0, deleted: 0, created: 1, echoes: 0 } });
  await gcal.webhook.handle(setup({ cursor: { watch, events: 't1' }, inbox, routes }).ctx, { redacted: a.redacted });
  assert.equal(inbox.items.size, 1);
  const hello = setup({ cursor: { watch } });
  assert.deepEqual(await gcal.webhook.handle(hello.ctx, { redacted: { type: 'gcal.sync', channel: 'vx-chan-1' } }), { ok: true, ignored: true });
  const old = setup({ cursor: { watch } });
  assert.deepEqual(await gcal.webhook.handle(old.ctx, { redacted: { type: 'gcal.exists', channel: 'vx-old-channel' } }), { ok: true, ignored: true });
  assert.equal(hello.calls.length + old.calls.length, 0);
  assert.deepEqual(await gcal.webhook.handle(ctxFor(gcal, { tokens: null }).ctx, { redacted: a.redacted }), { ok: true, ignored: true });
});

test('provider outage, rate limit, malformed answers', async () => {
  const flaky = setup({ cursor: { events: 't1' }, routes: [['GET', EVENTS, (u, i, n) => (n < 3 ? reply(503, 'x') : reply(200, { items: [], nextSyncToken: 't2' }))]] });
  await gcal.sync(flaky.ctx, 'events');
  assert.deepEqual(flaky.waits, [250, 750]); assert.equal(flaky.ctx.cursor.data.get('events'), 't2');
  const down = setup({ cursor: { events: 't1' }, routes: [['GET', EVENTS, () => reply(500, { error: { message: 'private.person' } })]] });
  await rejects(gcal.sync(down.ctx, 'events'), 'provider_down'); assert.equal(down.ctx.cursor.data.get('events'), 't1');
  // An insert carries its own id, so repeating it after a 5xx is safe and is done.
  const ins = setup({ routes: [['POST', EVENTS, (u, i, n) => (n === 1 ? reply(502, 'x') : reply(200, gev()))]] });
  assert.equal((await gcal.actions.upsertEvent(ins.ctx, local())).outcome, 'created'); assert.deepEqual(ins.waits, [250]);
  await rejects(gcal.sync(setup({ cursor: { events: 't1' }, routes: [['GET', EVENTS, () => gerr(403, 'rateLimitExceeded', { 'retry-after': '30' })]] }).ctx, 'events'), 'rate_limited', (e) => e.retryAfter === 30);
  await rejects(gcal.actions.upsertEvent(setup({ routes: [['POST', EVENTS, () => gerr(429, 'quotaExceeded', { 'retry-after': '5' })]] }).ctx, local()), 'rate_limited', (e) => e.retryAfter === 5);
  await rejects(gcal.sync(setup({ cursor: { events: 't1' }, routes: [['GET', EVENTS, () => reply(200, 'not json at all')]] }).ctx, 'events'), 'bad_answer');
  const odd = setup({ cursor: { events: 't1' }, routes: [['GET', EVENTS, () => reply(200, { items: [null, { no: 'id' }, { id: 5 }], nextSyncToken: 't3' })]] });
  assert.deepEqual((await gcal.sync(odd.ctx, 'events')).counts, { changed: 0, deleted: 0, created: 0, echoes: 0 });
  await rejects(gcal.status(ctxFor(gcal, { routes: [['GET', '/userinfo', () => reply(200, { email: 'no-sub@example.com' })]] }).ctx), 'account_unknown');
});

test('disconnect: the watch channel is stopped, then the grant is revoked', async () => {
  const watch = JSON.stringify({ id: 'vx-chan-1', resourceId: 'res-1', calendarId: CAL, expiration: Date.now() + 86400e3 });
  const s = setup({ cursor: { watch }, more: { sibling: async () => null }, routes: [['POST', '/channels/stop', () => new Response(null, { status: 204 })], ['POST', 'oauth2.googleapis.com/revoke', () => reply(200, {})]] });
  await gcal.revoke(s.ctx, s.ctx.tokens);
  assert.deepEqual(s.calls.map((c) => c.url.split('?')[0].split('/').slice(-2).join('/')), ['channels/stop', 'oauth2.googleapis.com/revoke']);
});
