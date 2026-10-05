// Google Calendar: two-way sync between the workspace and one calendar this app creates in the connected account.
//   out        upsertEvent / deleteEvent write an appointment to Google. The event id is made from the company and
//              the local id, so the same appointment can never become two events, and each event carries the local id
//              in extendedProperties.private. A stored link (local id, event id, the versions both sides last agreed
//              on) is kept beside it.
//   in         sync reads only what changed since the last run (sync token). When Google says the token is too old
//              (410) everything is read again from the start. Changes are handed over; the appointments module applies them.
//   conflict   when both sides changed since they last agreed, the newer `updated` time wins and the other side is
//              returned as the loser with its content, so it can be shown and kept. Nothing is overwritten silently.
//   push       a watch channel makes Google call /api/webhooks/gcal when the calendar changes. The channel carries a
//              token only this server can make; channels are renewed before they end.
//
// Scope: calendar.app.created (calendars this app made, and their events), plus openid and email. The person's other
// calendars are never read. Not exercised against Google. Tested with mocked provider responses.
import { ProviderError } from '../oauth.js';
import { sameString } from '../../crypto.js';
import { GOOGLE_ENV, GOOGLE_USERINFO, IDENTITY_SCOPES, SCOPE, googleAuthUrl, googleExchange, googleRefresh, googleRevoke, missingScopes, grantedScopes, domainAllowed, isEmail } from '../google/oauth.js';
import { gapi, seg } from '../google/rest.js';
import { cursorOf, cursorJson, linksOf, sinkOf, stableId, eventIdFor, channelToken } from '../google/state.js';

const API = 'https://www.googleapis.com/calendar/v3';
const EVENT_ID = /^[a-v0-9]{5,1024}$/;
const CAL_ID = /^[A-Za-z0-9_.@#-]{1,200}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const WATCH_DAYS = 7;
const WATCH_RENEW_MS = 2 * 86400000;
const MAX_PAGES = 20;

const iso = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const ms = (v) => { const t = Date.parse(v || ''); return Number.isFinite(t) ? t : 0; };
const calendarName = (ctx) => ctx.env('GOOGLE_CALENDAR_NAME') || (ctx.env('VX_DEPLOY') === 'lbs' ? 'LBS Command' : 'VYNTEX Command');
const eventsUrl = (calId) => `${API}/calendars/${seg(calId, CAL_ID)}/events`;

/**
 * The conflict rule, in one place for both directions.
 * local, remote: times of the last change on each side. base: the times both sides had when they last agreed (the link).
 * Returns 'none' (nothing changed), 'push' (only local changed), 'pull' (only Google changed), or a conflict:
 * 'local_wins' / 'remote_wins' by the newer time. A tie goes to Google, because that copy is the one other people see.
 */
export function decide({ localUpdated, remoteUpdated, baseLocal, baseRemote }) {
  const l = ms(localUpdated) > ms(baseLocal);
  const r = ms(remoteUpdated) > ms(baseRemote);
  if (!l && !r) return 'none';
  if (l && !r) return 'push';
  if (r && !l) return 'pull';
  return ms(localUpdated) > ms(remoteUpdated) ? 'local_wins' : 'remote_wins';
}

/** A Google event as the workspace reads it. */
export function mapEvent(ev) {
  const allDay = !!(ev.start && ev.start.date);
  const meet = (ev.conferenceData?.entryPoints || []).find((p) => p && p.entryPointType === 'video' && /^https:\/\//.test(String(p.uri || '')));
  return {
    eventId: ev.id, status: ev.status === 'cancelled' ? 'cancelled' : 'confirmed', updated: iso(ev.updated), etag: ev.etag || null,
    summary: ev.summary || '', description: ev.description || '', location: ev.location || '', allDay,
    start: allDay ? ev.start.date : iso(ev.start?.dateTime), end: allDay ? ev.end?.date || null : iso(ev.end?.dateTime), timeZone: ev.start?.timeZone || null,
    meetUrl: meet ? meet.uri : ev.hangoutLink && /^https:\/\//.test(ev.hangoutLink) ? ev.hangoutLink : null, htmlLink: ev.htmlLink || null,
    localId: ev.extendedProperties?.private?.vxId || null,
  };
}

/** local: { id, updatedAt, summary, description?, location?, start, end, allDay?, timeZone?, attendees?: [email], meet? } */
function eventBody(ctx, local) {
  const body = {
    summary: String(local.summary || '').slice(0, 300), description: String(local.description || '').slice(0, 8000), location: String(local.location || '').slice(0, 500),
    // Private properties are visible to this app only. They say which local record the event is, in which company.
    extendedProperties: { private: { vxId: String(local.id), vxTenant: String(ctx.tenantId) } },
  };
  if (local.allDay) {
    if (!DATE.test(String(local.start)) || !DATE.test(String(local.end || local.start))) throw new ProviderError('event_invalid');
    body.start = { date: local.start }; body.end = { date: local.end || local.start };
  } else {
    const s = iso(local.start), e = iso(local.end);
    if (!s || !e || Date.parse(e) <= Date.parse(s)) throw new ProviderError('event_invalid');
    body.start = { dateTime: s, ...(local.timeZone ? { timeZone: String(local.timeZone).slice(0, 60) } : {}) };
    body.end = { dateTime: e, ...(local.timeZone ? { timeZone: String(local.timeZone).slice(0, 60) } : {}) };
  }
  if (Array.isArray(local.attendees)) body.attendees = local.attendees.filter(isEmail).slice(0, 50).map((email) => ({ email }));
  // The request id is made from the company and the record: asking twice gives the same Meet link, not a second one.
  if (local.meet) body.conferenceData = { createRequest: { requestId: stableId('vx-meet', ctx.tenantId, local.id).slice(0, 40), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  if (!body.summary) throw new ProviderError('event_invalid');
  return body;
}
/** True when a Google event already holds what would be written (same title, place, text and times). */
function sameContent(body, ev) {
  const t = (x) => (x?.date ? x.date : ms(x?.dateTime));
  return (ev.summary || '') === body.summary && (ev.location || '') === body.location && (ev.description || '') === body.description && t(ev.start) === t(body.start) && t(ev.end) === t(body.end);
}
const hashOf = (body) => stableId(JSON.stringify(body)).slice(0, 32);
const linkRow = (local, calId, ev, hash) => ({ local_id: String(local.id), calendar_id: calId, event_id: ev.id, etag: ev.etag || null, remote_updated: iso(ev.updated), local_updated: iso(local.updatedAt) || new Date().toISOString(), hash });

/** The calendar this app keeps in the account. Created once; found again by its stored id. */
async function ensureCalendar(ctx, cursor) {
  const known = await cursor.get('calendar_id');
  if (known && CAL_ID.test(known)) {
    try { await gapi(ctx, 'GET', `${API}/calendars/${seg(known, CAL_ID)}`); return { id: known, fresh: false }; } catch (e) {
      if (!(e instanceof ProviderError) || !['not_found', 'gone'].includes(e.code)) throw e;
      // The person deleted the calendar in Google. A new one is made and every event is written again.
    }
  }
  const c = await gapi(ctx, 'POST', `${API}/calendars`, { body: { summary: calendarName(ctx), description: 'Appointments from the workspace. Changes made here are sent back to it.' } });
  if (!CAL_ID.test(String(c.id || ''))) throw new ProviderError('bad_answer');
  await cursor.set('calendar_id', c.id);
  await cursor.set('events', '');
  await cursor.set('watch', '');
  return { id: c.id, fresh: true };
}

async function listChanges(ctx, calId, syncToken) {
  const events = [];
  let pageToken, next = null;
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const r = await gapi(ctx, 'GET', eventsUrl(calId), { query: { showDeleted: true, singleEvents: false, maxResults: 250, syncToken: syncToken || undefined, pageToken } });
    events.push(...(Array.isArray(r.items) ? r.items : []));
    pageToken = r.nextPageToken;
    next = r.nextSyncToken || next;
    if (!pageToken) return { events, next };
  }
  // Too many pages for one run. Without the final page there is no new sync token, so the next run repeats this range.
  return { events, next: null };
}

/** Starts or renews the watch channel. Skipped (and said so) when the deployment has no channel secret or address. */
async function ensureWatch(ctx, cursor, calId) {
  const secret = ctx.env('GOOGLE_CHANNEL_SECRET');
  const origin = String(ctx.env('APP_ORIGIN') || '').replace(/\/+$/, '');
  if (!secret || secret.length < 32 || !/^https:\/\//.test(origin)) return { watching: false, reason: 'push_not_configured' };
  const current = await cursorJson(cursor, 'watch');
  if (current && current.calendarId === calId && Number(current.expiration) - ctx.now() > WATCH_RENEW_MS) return { watching: true, renewed: false };
  // One channel id per company, calendar and day: a repeat on the same day is refused by Google as "not unique",
  // which here means "already watching".
  const id = 'vx-' + stableId('gcal-watch', ctx.tenantId, calId, Math.floor(ctx.now() / 86400000)).slice(0, 40);
  let r;
  try {
    r = await gapi(ctx, 'POST', eventsUrl(calId) + '/watch', { repeatable: true, body: { id, type: 'web_hook', address: `${origin}/api/webhooks/gcal`, token: channelToken(secret, ctx.tenantId, id), params: { ttl: String(WATCH_DAYS * 86400) } } });
  } catch (e) {
    if (e instanceof ProviderError && e.code === 'request_rejected' && e.googleReason === 'channelIdNotUnique') return { watching: true, renewed: false };
    throw e;
  }
  const expiration = Number(r.expiration) || 0;
  if (!expiration || typeof r.resourceId !== 'string') throw new ProviderError('bad_answer');
  await cursor.set('watch', JSON.stringify({ id, resourceId: r.resourceId, calendarId: calId, expiration }));
  // The channel it replaces would keep sending until it ends. Stopping it is best effort.
  if (current && current.id && current.id !== id) await stopChannel(ctx, current).catch(() => {});
  return { watching: true, renewed: true };
}
const stopChannel = (ctx, ch) => gapi(ctx, 'POST', `${API}/channels/stop`, { repeatable: true, body: { id: String(ch.id), resourceId: String(ch.resourceId) } });

async function userinfo(ctx) {
  const me = await gapi(ctx, 'GET', GOOGLE_USERINFO);
  if (typeof me.sub !== 'string' || !isEmail(me.email)) throw new ProviderError('account_unknown');
  return { sub: me.sub, email: me.email.toLowerCase() };
}

const adapter = {
  id: 'gcal',
  name: 'Google Calendar',
  kind: 'oauth',
  env: GOOGLE_ENV,
  scopes: [...IDENTITY_SCOPES, SCOPE.calendar],
  approval: { needed: true, flag: 'GOOGLE_CALENDAR_APPROVED', note: 'Calendar access is a Google sensitive scope. Google must verify the app before it may be used outside the test users of the Google Cloud project.' },

  authUrl(ctx) { return googleAuthUrl(ctx, this.scopes); },
  exchange: googleExchange,
  refresh: googleRefresh,
  async revoke(ctx, tokens) {
    // Tell Google to stop calling before the tokens go. Best effort: the channel ends by itself within a week.
    try { const w = await cursorJson(cursorOf(ctx), 'watch'); if (w && w.id) await stopChannel(ctx, w); } catch { /* nothing to undo */ }
    return googleRevoke(ctx, tokens, ['gmail', 'gbp']);
  },

  /** The verified call: who is this, answered by Google with the new token. A consent without the calendar permission is refused. */
  async status(ctx) {
    if (missingScopes(ctx, [SCOPE.calendar]).length) return { ok: false, reason: 'scope_missing' };
    const me = await userinfo(ctx);
    if (!domainAllowed(ctx, me.email)) return { ok: false, reason: 'wrong_account' };
    return { ok: true, account: { label: me.email, ref: me.sub }, scopes: grantedScopes(ctx) };
  },

  async health(ctx) {
    const me = await userinfo(ctx);
    const known = String(ctx.connection?.account_ref || '');
    if (known && me.sub !== known) return { ok: false, reason: 'wrong_account', reauth: true };
    const calId = await cursorOf(ctx).get('calendar_id');
    if (calId && CAL_ID.test(calId)) {
      try { await gapi(ctx, 'GET', `${API}/calendars/${seg(calId, CAL_ID)}`); } catch (e) {
        if (e instanceof ProviderError && ['not_found', 'gone'].includes(e.code)) return { ok: false, reason: 'calendar_missing' };
        throw e;
      }
    }
    return { ok: true, health: 'ok' };
  },

  /**
   * Reads what changed at Google. what: 'all' (default), 'events' or 'watch'.
   * Returns { counts: { changed, deleted, created, echoes }, resync?, more?, watch }.
   * Each change is handed to the sink as { kind: 'gcal.event', ref, data: { change, localId, eventId, remoteUpdated,
   * base, event } }. The module that owns appointments calls actions.applyInbound() with its record to learn whether
   * to apply it or whether its own copy is newer (a conflict, reported with the loser).
   */
  async sync(ctx, what = 'all') {
    const cursor = cursorOf(ctx);
    const cal = await ensureCalendar(ctx, cursor);
    const out = { counts: { changed: 0, deleted: 0, created: 0, echoes: 0 } };
    if (what !== 'watch') {
      const links = linksOf(ctx), sink = sinkOf(ctx);
      const token = cal.fresh ? '' : (await cursor.get('events')) || '';
      let ch;
      try { ch = await listChanges(ctx, cal.id, token); } catch (e) {
        if (!(e instanceof ProviderError) || e.code !== 'gone' || !token) throw e;
        // 410: the sync token is too old. Read everything again; the links keep already known events from doubling.
        ch = await listChanges(ctx, cal.id, '');
        out.resync = true;
      }
      for (const ev of ch.events) {
        if (!ev || typeof ev.id !== 'string' || !ev.id) continue;
        const priv = ev.extendedProperties?.private || {};
        // An event that names another company is not ours to touch (it cannot happen in a calendar this app made,
        // but a copied event would carry the properties along).
        if (priv.vxTenant && priv.vxTenant !== String(ctx.tenantId)) continue;
        let link = priv.vxId ? await links.get(String(priv.vxId)) : null;
        if (!link) link = await links.byEvent(ev.id);
        const cancelled = ev.status === 'cancelled';
        if (link && link.etag && ev.etag === link.etag) { out.counts.echoes += 1; continue; }   // our own write coming back
        if (cancelled && !link) continue;
        const change = cancelled ? 'deleted' : link ? 'changed' : 'created';
        const event = mapEvent(ev);
        await sink({
          kind: 'gcal.event', ref: `gcal:${ev.id}:${ev.etag || event.updated || 'x'}`,
          data: { change, localId: link ? link.local_id : priv.vxId || null, eventId: ev.id, remoteUpdated: event.updated, base: link ? { local: link.local_updated, remote: link.remote_updated } : null, event: cancelled ? null : event },
        });
        out.counts[change] += 1;
      }
      if (ch.next) await cursor.set('events', ch.next); else out.more = true;
    }
    if (what === 'all' || what === 'watch') out.watch = await ensureWatch(ctx, cursor, cal.id);
    return out;
  },

  webhook: {
    /**
     * A watch channel notice. Google does not sign these: it sends back the token given when the channel was made.
     * The token holds the company and an HMAC over the company and the channel id, made with GOOGLE_CHANNEL_SECRET,
     * so a notice cannot be forged or moved to another company or channel.
     * Replay: a notice has no body and only says "look again". Each message number of a channel is recorded once,
     * and a notice of a channel whose end time has passed is refused.
     */
    verify(request, raw, ctx) {
      const secret = ctx.env('GOOGLE_CHANNEL_SECRET');
      if (!secret || secret.length < 32) return { ok: false, reason: 'not_configured' };
      const h = request.headers;
      const channel = h.get('x-goog-channel-id') || '', token = h.get('x-goog-channel-token') || '', number = h.get('x-goog-message-number') || '';
      const state = h.get('x-goog-resource-state') || '', resource = h.get('x-goog-resource-id') || '';
      if (!channel || !token) return { ok: false, reason: 'signature_missing' };
      const m = /^v1\.([0-9a-f-]{36})\.([0-9a-f]{64})$/i.exec(token);
      if (!m || !UUID.test(m[1]) || !/^[A-Za-z0-9_-]{1,64}$/.test(channel) || !sameString(token, channelToken(secret, m[1], channel))) return { ok: false, reason: 'bad_signature' };
      if (!/^\d{1,15}$/.test(number) || !['sync', 'exists', 'not_exists'].includes(state)) return { ok: false, reason: 'bad_payload' };
      const ends = Date.parse(h.get('x-goog-channel-expiration') || '');
      if (Number.isFinite(ends) && ends < ctx.now()) return { ok: false, reason: 'stale' };
      return { ok: true, eventId: `${channel}:${number}`, type: 'gcal.' + state, tenantId: m[1].toLowerCase(), redacted: { type: 'gcal.' + state, channel, resource: /^[A-Za-z0-9_-]{1,200}$/.test(resource) ? resource : null, number: Number(number) } };
    },
    async handle(ctx, event) {
      // "sync" is the hello Google sends when a channel starts. Nothing changed.
      if (event?.redacted?.type === 'gcal.sync') return { ok: true, ignored: true };
      if (!ctx.tenantId || !ctx.tokens) return { ok: true, ignored: true };
      // A notice from a channel that is no longer the current one (replaced or left over) is not acted on.
      const current = await cursorJson(cursorOf(ctx), 'watch');
      if (!current || current.id !== event?.redacted?.channel) return { ok: true, ignored: true };
      const out = await adapter.sync(ctx, 'events');
      return { ok: true, counts: out.counts };
    },
  },

  actions: {
    decide, mapEvent,

    /**
     * Writes one appointment to Google. Returns one of:
     *   { outcome: 'created' | 'updated' | 'unchanged', eventId, meetUrl, htmlLink, conflict? }
     *   { outcome: 'remote_newer', remote, conflict? }   Google's copy is the one to keep: nothing was written
     * conflict (present only when both sides had changed): { winner: 'local' | 'remote', loser: { side, updated, event } }.
     * The loser's content is in the answer so the caller can show and keep it.
     */
    async upsertEvent(ctx, local) {
      if (!local || typeof local.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,120}$/.test(local.id)) throw new ProviderError('event_invalid');
      const cursor = cursorOf(ctx), links = linksOf(ctx);
      const cal = await ensureCalendar(ctx, cursor);
      const body = eventBody(ctx, local);
      const hash = hashOf(body);
      const eventId = eventIdFor(ctx.tenantId, local.id);
      const url = eventsUrl(cal.id);
      const q = { conferenceDataVersion: 1, sendUpdates: local.notify ? 'all' : 'none' };
      const done = async (outcome, ev, extra = {}) => { await links.put(linkRow(local, cal.id, ev, hash)); const e = mapEvent(ev); return { outcome, eventId: ev.id, meetUrl: e.meetUrl, htmlLink: e.htmlLink, ...extra }; };
      let link = cal.fresh ? null : await links.get(local.id);
      if (link && link.calendar_id !== cal.id) link = null;
      let remote = null;
      if (!link) {
        try {
          // The id is ours, so a second attempt (a retried job, two tabs) meets "already exists" instead of making a twin.
          return await done('created', await gapi(ctx, 'POST', url, { query: q, body: { id: eventId, ...body }, repeatable: true }));
        } catch (e) {
          if (!(e instanceof ProviderError) || e.code !== 'conflict') throw e;
          remote = await gapi(ctx, 'GET', `${url}/${eventId}`);
        }
      } else if (link.hash === hash && ms(local.updatedAt) <= ms(link.local_updated)) {
        return { outcome: 'unchanged', eventId: link.event_id, meetUrl: null, htmlLink: null };
      }
      const id = link ? link.event_id : eventId;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (!remote && link && link.etag) {
          try {
            // If-Match: Google applies the change only if its copy is still the one both sides agreed on.
            return await done('updated', await gapi(ctx, 'PATCH', `${url}/${seg(id, EVENT_ID)}`, { query: q, body, headers: { 'if-match': link.etag } }));
          } catch (e) {
            if (!(e instanceof ProviderError) || !['changed_meanwhile', 'not_found', 'gone'].includes(e.code)) throw e;
            if (e.code !== 'changed_meanwhile') { await links.remove(local.id); return adapter.actions.upsertEvent(ctx, local); }
          }
        }
        if (!remote) remote = await gapi(ctx, 'GET', `${url}/${seg(id, EVENT_ID)}`);
        const verdict = decide({ localUpdated: local.updatedAt, remoteUpdated: remote.updated, baseLocal: link ? link.local_updated : 0, baseRemote: link ? link.remote_updated : 0 });
        const theirs = { side: 'remote', updated: iso(remote.updated), event: mapEvent(remote) };
        const mine = { side: 'local', updated: iso(local.updatedAt), event: null };
        // No link but the event exists and holds exactly this content: an earlier attempt wrote it and stopped before
        // the link was stored. Adopt it; there is nothing to decide.
        if (!link && remote.status !== 'cancelled' && sameContent(body, remote)) return await done('created', remote);
        if (verdict === 'remote_wins') return { outcome: 'remote_newer', remote: theirs.event, conflict: { winner: 'remote', loser: mine } };
        // A deletion at Google is a change like any other: the event is brought back only by a newer local change.
        if (verdict === 'pull' || (verdict === 'none' && remote.status === 'cancelled')) return { outcome: 'remote_newer', remote: theirs.event };
        if (verdict === 'none') return await done('unchanged', remote);
        try {
          const written = await gapi(ctx, 'PATCH', `${url}/${seg(id, EVENT_ID)}`, { query: q, body: { ...body, status: 'confirmed' }, headers: remote.etag ? { 'if-match': remote.etag } : {} });
          return await done('updated', written, verdict === 'local_wins' ? { conflict: { winner: 'local', loser: theirs } } : {});
        } catch (e) {
          // Changed again between the read and the write: read once more and decide again.
          if (!(e instanceof ProviderError) || e.code !== 'changed_meanwhile' || attempt === 1) throw e;
          remote = null; link = link ? { ...link, etag: null } : link;
        }
      }
      throw new ProviderError('changed_meanwhile');
    },

    /** Removes the event of a local record. Safe to repeat: an event that is already gone counts as removed. */
    async deleteEvent(ctx, localId, { notify = false } = {}) {
      const cursor = cursorOf(ctx), links = linksOf(ctx);
      const calId = await cursor.get('calendar_id');
      const link = await links.get(String(localId));
      if (!calId || !link) return { outcome: 'not_linked' };
      try {
        await gapi(ctx, 'DELETE', `${eventsUrl(link.calendar_id || calId)}/${seg(link.event_id, EVENT_ID)}`, { query: { sendUpdates: notify ? 'all' : 'none' } });
      } catch (e) {
        if (!(e instanceof ProviderError) || !['not_found', 'gone'].includes(e.code)) throw e;
      }
      await links.remove(String(localId));
      return { outcome: 'deleted', eventId: link.event_id };
    },

    async getEvent(ctx, eventId) {
      const calId = await cursorOf(ctx).get('calendar_id');
      if (!calId) throw new ProviderError('not_found');
      return mapEvent(await gapi(ctx, 'GET', `${eventsUrl(calId)}/${seg(eventId, EVENT_ID)}`));
    },

    /**
     * For the module that applies an inbound change: given the change (as handed to the sink) and the local record's
     * last change time, says what to do and records the agreement.
     * Returns { apply: true, conflict? } or { apply: false, conflict: { winner: 'local', loser } } (push the local copy next).
     */
    async applyInbound(ctx, change, local) {
      const links = linksOf(ctx);
      const base = change.base || { local: 0, remote: 0 };
      const verdict = local ? decide({ localUpdated: local.updatedAt, remoteUpdated: change.remoteUpdated, baseLocal: base.local, baseRemote: base.remote }) : 'pull';
      if (verdict === 'local_wins') return { apply: false, conflict: { winner: 'local', loser: { side: 'remote', updated: change.remoteUpdated, event: change.event } } };
      if (verdict === 'none' || verdict === 'push') return { apply: false };
      const conflict = verdict === 'remote_wins' ? { conflict: { winner: 'remote', loser: { side: 'local', updated: iso(local.updatedAt), event: null } } } : {};
      if (change.change === 'deleted') { if (change.localId) await links.remove(change.localId); return { apply: true, ...conflict }; }
      if (change.localId && change.event) {
        const calId = await cursorOf(ctx).get('calendar_id');
        // After applying, the local record equals Google's copy: both times are the agreed ones from here on.
        await links.put({ local_id: change.localId, calendar_id: calId, event_id: change.eventId, etag: change.event.etag, remote_updated: change.remoteUpdated, local_updated: new Date(ctx.now()).toISOString(), hash: null });
      }
      return { apply: true, ...conflict };
    },
  },
};

export default adapter;
