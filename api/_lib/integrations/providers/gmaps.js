// Google Maps: turns an address into coordinates (geocoding), on the server.
// Key based: the deployment holds one API key (GOOGLE_MAPS_API_KEY). The key is used only in calls made from here to
// Google. It is never sent to a browser, never part of an answer and never logged. Screens that only need "open this
// address in Maps" use mapsLink(), which needs no key and makes no call.
//
// A cap per company and day (GOOGLE_MAPS_DAILY_CAP, default 200) keeps one company from using up the deployment's quota.
// Only what is asked for is geocoded: an address a person entered. No device location is collected.
//
// Not exercised against Google. Tested with mocked provider responses.
import { ProviderError } from '../oauth.js';
import { gapi } from '../google/rest.js';

const GEOCODE = 'https://maps.googleapis.com/maps/api/geocode/json';
// A fixed public address used only to prove the key works. No company data leaves in a status check.
const PROBE = '1600 Amphitheatre Parkway, Mountain View, CA';
const DAY_S = 86400;

const cap = (ctx) => { const n = Number(ctx.env('GOOGLE_MAPS_DAILY_CAP')); return Number.isInteger(n) && n > 0 && n <= 100000 ? n : 200; };

/** Counts one use against the company's daily cap. Tests pass ctx.quota; otherwise the database counter is used. */
async function spend(ctx) {
  if (ctx.quota) return ctx.quota(cap(ctx));
  const { hit } = await import('../../ratelimit.js');
  const r = await hit('gmaps.geocode', String(ctx.tenantId || 'deployment'), cap(ctx), DAY_S);
  return !!r.allowed;
}

/** The Geocoding API answers 200 with a status word in the body. Each word becomes one of our codes. */
async function geocodeCall(ctx, address) {
  const r = await gapi(ctx, 'GET', GEOCODE, { auth: 'none', query: { address, key: ctx.env('GOOGLE_MAPS_API_KEY'), language: ctx.language || undefined, region: ctx.region || undefined } });
  const s = typeof r.status === 'string' ? r.status : '';
  if (s === 'OK' || s === 'ZERO_RESULTS') return Array.isArray(r.results) ? r.results : [];
  if (s === 'OVER_QUERY_LIMIT' || s === 'OVER_DAILY_LIMIT') { const e = new ProviderError('rate_limited', { status: 429 }); e.retryAfter = 3600; throw e; }
  if (s === 'REQUEST_DENIED') throw new ProviderError('invalid_key', { reauth: true, status: 403 });
  if (s === 'INVALID_REQUEST') throw new ProviderError('address_invalid', { status: 400 });
  throw new ProviderError(s === 'UNKNOWN_ERROR' ? 'provider_down' : 'bad_answer');
}

/** A link that opens an address in Google Maps. No key, no call, nothing stored. */
export function mapsLink(address) {
  const a = String(address || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return a ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(a) : null;
}

const adapter = {
  id: 'gmaps',
  name: 'Google Maps',
  kind: 'platform',
  env: ['GOOGLE_MAPS_API_KEY'],
  scopes: ['geocode'],
  approval: null,

  authUrl() { throw new ProviderError('not_oauth'); },
  async exchange() { throw new ProviderError('not_oauth'); },
  async refresh(ctx, tokens) { return tokens; },
  async revoke() { /* the key belongs to the deployment: disconnecting only removes the company's row */ },

  /** The verified call: one geocoding request for a fixed public address. Google refusing the key says so by name. */
  async status(ctx) {
    try {
      const results = await geocodeCall(ctx, PROBE);
      if (!results.length) return { ok: false, reason: 'bad_answer' };
      return { ok: true, account: { label: 'Geocoding', ref: null }, scopes: ['geocode'] };
    } catch (e) {
      if (e instanceof ProviderError && e.code !== 'provider_unreachable') return { ok: false, reason: e.code === 'request_rejected' || e.code === 'forbidden' ? 'invalid_key' : e.code };
      throw e;
    }
  },
  async health(ctx) {
    const s = await this.status(ctx);
    return s.ok ? { ok: true, health: 'ok' } : { ok: false, reason: s.reason, reauth: s.reason === 'invalid_key' };
  },
  async sync() { return { ok: true, skipped: 'nothing_to_sync' }; },

  webhook: null,

  actions: {
    mapsLink,

    /**
     * address: what a person typed. Returns { found: false } or
     * { found: true, formatted, lat, lng, placeId, precision, partial, mapsLink }.
     * precision is Google's word for how exact the point is (ROOFTOP, RANGE_INTERPOLATED, GEOMETRIC_CENTER, APPROXIMATE).
     */
    async geocode(ctx, address) {
      const a = String(address || '').replace(/\s+/g, ' ').trim();
      if (a.length < 5 || a.length > 300) throw new ProviderError('address_invalid');
      if (!(await spend(ctx))) { const e = new ProviderError('daily_cap_reached', { status: 429 }); e.retryAfter = DAY_S; throw e; }
      const first = (await geocodeCall(ctx, a))[0];
      const loc = first?.geometry?.location;
      if (!first || !Number.isFinite(loc?.lat) || !Number.isFinite(loc?.lng)) return { found: false };
      return {
        found: true, formatted: String(first.formatted_address || '').slice(0, 300), lat: loc.lat, lng: loc.lng,
        placeId: typeof first.place_id === 'string' ? first.place_id.slice(0, 200) : null,
        precision: typeof first.geometry.location_type === 'string' ? first.geometry.location_type.slice(0, 40) : null,
        partial: first.partial_match === true, mapsLink: mapsLink(first.formatted_address || a),
      };
    },
  },
};

export default adapter;
