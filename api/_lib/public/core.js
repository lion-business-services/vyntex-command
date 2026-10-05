// What every public (no sign-in) route shares: the link token, its limits, and the one answer for a link that cannot
// be used.
//
// A link token is 32 random bytes written as 43 URL-safe characters. The database holds only its SHA-256 hash, so a
// copy of the database opens no link. The token is never logged: log() in respond.js drops anything that long, and no
// code here passes a token (or its hash) to it.
//
// One answer for every link that does not open: unknown, expired, used up, taken back, or not even shaped like a
// token. Whoever tries links learns nothing from the difference, because there is none.
import { fail, HttpError, readJson } from '../respond.js';
import { appOrigin } from '../env.js';
import { limit, addressKey, keyHash } from '../ratelimit.js';
import { randomToken, sha256Hex } from '../crypto.js';
import { securityEvent } from '../audit.js';

export const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const newToken = () => randomToken(32);
export const hashToken = (token) => sha256Hex(String(token));
export const isToken = (v) => typeof v === 'string' && TOKEN.test(v);

/** The one refusal. `reason` is what the signing page reads; it is the same word every time. */
export const cannotOpen = () => fail(404, 'cannot_be_opened', { reason: 'unavailable' });

/**
 * Counts the request against the caller's address and against the token presented (whatever it is, so a wrong token
 * is limited exactly like a right one). Pass null as the token to count the address only. Ends the request with 429
 * past either limit.
 */
export async function publicLimits(request, bucket, token, { perAddress = 60, perToken = 30, windowSeconds = 60 } = {}) {
  await limit(`pub.${bucket}.addr`, addressKey(request), perAddress, windowSeconds);
  if (token !== null) await limit(`pub.${bucket}.tok`, keyHash('pubtok', sha256Hex(String(token ?? '')).slice(0, 48)), perToken, windowSeconds);
}

/**
 * These routes are for pages of this site only. A browser sends Origin with every POST; one from another site is
 * refused, and no answer here carries a cross-origin permission header, so another site's script cannot read one.
 */
export function assertSameSite(request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== appOrigin(request)) throw new HttpError(403, 'bad_origin');
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'bad_origin');
}

/** Reads a small JSON body. The limit is per route: a signature image needs room, nothing else does. */
export const body = (request, maxBytes = 8 * 1024) => readJson(request, maxBytes);

/** A refused public request, recorded with a hash of where it came from. Never the token. */
export const refused = (request, kind, meta = {}) => securityEvent({ kind, outcome: 'denied', request, meta });
