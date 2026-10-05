// The checks every signed-in route runs, in one place and in one order:
//   1. the deployment is configured (and is not a production deployment carrying test settings)
//   2. for a request that changes something: same origin and the double-submit value
//   3. an open session (sealed cookie, not idle, not past its lifetime, tokens refreshed)
//   4. the second sign-in step, when the session still owes it
//   5. a fresh identity check, when the route asks for one
// The database repeats 3 to 5 with its own evidence (app.require_mfa, app.require_stepup), so a mistake here does not
// open anything.
import { problems } from './env.js';
import { requireSession, steppedUp, openSession } from './session.js';
import { assertCsrf } from './csrf.js';
import { HttpError, log } from './respond.js';

/** Refuses to run the workspace on a deployment that is missing a core setting or mixes test and production. */
export function assertConfigured() {
  const p = problems();
  if (p.length) {
    // names of settings and rule codes only, never a value
    log('config', 'refused', { first: p[0], count: p.length });
    throw new HttpError(503, 'not_configured');
  }
}

/**
 * Returns { session, cookies }. Options:
 *   write       the request changes something: Origin and csrf are checked (default: true for anything but GET and HEAD)
 *   pendingMfa  the route is part of finishing sign-in, so a session that still owes the second step may use it
 *   stepUp      the route needs a fresh identity check (within five minutes)
 */
export async function guard(request, { write, pendingMfa = false, stepUp = false } = {}) {
  assertConfigured();
  const unsafe = write ?? !['GET', 'HEAD'].includes(request.method);
  if (unsafe) assertCsrf(request, openSession(request).session);
  const { session, cookies } = await requireSession(request);
  if (!pendingMfa && session.m !== 'ok') throw new HttpError(403, 'mfa_required', { mfa: session.m }, { cookies });
  if (stepUp && !steppedUp(session)) throw new HttpError(403, 'stepup_required', {}, { cookies });
  return { session, cookies };
}
