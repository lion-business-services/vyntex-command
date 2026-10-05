// Google Meet: a video link on a calendar event.
// There is no separate Google sign-in for Meet. A Meet link is made by Google Calendar when an event is written with a
// conference request, so this adapter works through the company's Google Calendar connection and has no tokens of its
// own. Its state says exactly that: it can be "connected" only while Calendar is connected and the calendar accepts
// Meet conferences, and it reports calendar_not_connected otherwise.
//
// Not exercised against Google. Tested with mocked provider responses.
import { ProviderError } from '../oauth.js';
import { GOOGLE_ENV, SCOPE } from '../google/oauth.js';
import { gapi, seg } from '../google/rest.js';
import { stableId } from '../google/state.js';
import gcal from './gcal.js';

const API = 'https://www.googleapis.com/calendar/v3';
const CAL_ID = /^[A-Za-z0-9_.@#-]{1,200}$/;

/** A context that can call Google with the Calendar connection's tokens. Tests pass ctx.peer. */
async function calendarCtx(ctx) {
  try {
    if (ctx.peer) return await ctx.peer('gcal');
    const { connectionCtx } = await import('../core.js');
    return await connectionCtx(gcal, ctx.tenantId, { fetchFn: ctx.fetch });
  } catch (e) {
    if (e instanceof ProviderError && e.code === 'not_connected') throw new ProviderError('calendar_not_connected');
    // The Calendar connection needs the person again: so does this.
    if (e instanceof ProviderError && e.reauth) throw new ProviderError('calendar_reauth', { reauth: true });
    throw e;
  }
}

async function check(ctx) {
  let cal;
  try { cal = await calendarCtx(ctx); } catch (e) { return { ok: false, reason: e instanceof ProviderError ? e.code : 'calendar_not_connected', reauth: e instanceof ProviderError && e.reauth }; }
  if (!cal || !cal.tokens) return { ok: false, reason: 'calendar_not_connected' };
  const { cursorOf } = await import('../google/state.js');
  const calId = (await cursorOf(cal).get('calendar_id')) || 'primary';
  // The real call: the calendar itself says which kinds of conference it allows.
  const c = await gapi(cal, 'GET', `${API}/calendars/${seg(calId, CAL_ID)}`);
  const allowed = c.conferenceProperties?.allowedConferenceSolutionTypes;
  if (Array.isArray(allowed) && !allowed.includes('hangoutsMeet')) return { ok: false, reason: 'meet_not_available' };
  return { ok: true, cal, account: { label: cal.connection?.account_label || null, ref: cal.connection?.account_ref || null } };
}

const adapter = {
  id: 'gmeet',
  name: 'Google Meet',
  // "platform": nothing to sign in to here. Connecting only verifies, through Calendar, that links can be made.
  kind: 'platform',
  env: GOOGLE_ENV,
  scopes: [SCOPE.calendar],
  approval: { needed: true, flag: 'GOOGLE_CALENDAR_APPROVED', note: 'Meet links are made through Google Calendar and follow its approval.' },
  dependsOn: 'gcal',

  authUrl() { throw new ProviderError('not_oauth'); },
  async exchange() { throw new ProviderError('not_oauth'); },
  async refresh(ctx, tokens) { return tokens; },
  async revoke() { /* no tokens of its own: disconnecting removes the row and leaves Calendar as it is */ },

  async status(ctx) {
    const r = await check(ctx);
    return r.ok ? { ok: true, account: r.account, scopes: [SCOPE.calendar] } : { ok: false, reason: r.reason };
  },
  async health(ctx) {
    const r = await check(ctx);
    return r.ok ? { ok: true, health: 'ok' } : { ok: false, reason: r.reason, reauth: !!r.reauth };
  },
  async sync() { return { ok: true, skipped: 'nothing_to_sync' }; },

  webhook: null,

  actions: {
    /**
     * Writes the appointment to Google Calendar with a Meet link and returns { eventId, meetUrl, pending, outcome }.
     * `local` is what gcal.upsertEvent takes. The conference request id is made from the company and the record, so
     * a repeat returns the same link. Google sometimes creates the conference a moment later: then meetUrl is null,
     * pending is true, and linkFor() reads it afterwards.
     */
    async createMeeting(ctx, local) {
      const cal = await calendarCtx(ctx);
      const out = await gcal.actions.upsertEvent(cal, { ...local, meet: true });
      if (out.outcome === 'remote_newer') return { eventId: out.remote?.eventId || null, meetUrl: out.remote?.meetUrl || null, pending: false, outcome: out.outcome, conflict: out.conflict };
      let meetUrl = out.meetUrl;
      // An event that existed without a conference keeps none on a plain update: ask for one explicitly.
      if (!meetUrl && out.eventId) meetUrl = (await adapter.actions.addToEvent(ctx, out.eventId, local.id, cal)).meetUrl;
      return { eventId: out.eventId, meetUrl: meetUrl || null, pending: !meetUrl, outcome: out.outcome, conflict: out.conflict };
    },

    /** Adds a Meet link to an event that has none. Same request id as createMeeting, so it never makes a second link. */
    async addToEvent(ctx, eventId, localId, calCtx) {
      const cal = calCtx || await calendarCtx(ctx);
      const { cursorOf } = await import('../google/state.js');
      const calId = await cursorOf(cal).get('calendar_id');
      if (!calId) throw new ProviderError('not_found');
      const ev = await gapi(cal, 'PATCH', `${API}/calendars/${seg(calId, CAL_ID)}/events/${seg(eventId, /^[a-v0-9]{5,1024}$/)}`, {
        query: { conferenceDataVersion: 1, sendUpdates: 'none' },
        body: { conferenceData: { createRequest: { requestId: stableId('vx-meet', ctx.tenantId, localId).slice(0, 40), conferenceSolutionKey: { type: 'hangoutsMeet' } } } },
      });
      const e = gcal.actions.mapEvent(ev);
      return { eventId: ev.id, meetUrl: e.meetUrl, pending: !e.meetUrl };
    },

    /** Reads the link of an event (for the case where Google was still creating it). */
    async linkFor(ctx, eventId) {
      const cal = await calendarCtx(ctx);
      const e = await gcal.actions.getEvent(cal, eventId);
      return { eventId, meetUrl: e.meetUrl, pending: !e.meetUrl };
    },
  },
};

export default adapter;
