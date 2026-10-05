// Security events and the audit trail, from the server's side.
// Most of the trail is written by the database itself (triggers on the tables, and the functions that reveal or
// export something). This file adds what only the server knows: sign-ins, the second step, sign-outs, password
// changes, connections, rejected webhooks. Each event lands in app.security_events and, when it concerns a person
// or a company, in the append-only audit log of migration 0004.
//
// An event never carries a secret: no password, code, token or key. The database drops such fields again as a second
// line of defence (app.safe_meta). Writing an event never fails a request: if the database is unreachable the event
// is logged on the server as a code and the request goes on.
import { serviceRpc, configured } from './supabase.js';
import { ipHash } from './ratelimit.js';
import { log } from './respond.js';

const KIND = /^[a-z][a-z0-9_.]{2,60}$/;
const OUTCOMES = new Set(['ok', 'denied', 'failed', 'locked', 'info']);

/**
 * Records one event. `tenant` and `user` are ids or null. `meta` holds a few short facts (ids, codes, counts).
 * Service role: an event must be recordable when nobody is signed in, and the person it concerns must not be able to
 * write, change or leave out their own events.
 */
export async function securityEvent({ tenant = null, user = null, kind, outcome = 'ok', request = null, meta = {}, subject = null }) {
  if (!KIND.test(kind) || !OUTCOMES.has(outcome)) { log('audit', 'bad_event'); return false; }
  if (!configured()) return false;
  const r = await serviceRpc('security_event', {
    p_tenant: tenant, p_user: user, p_kind: kind, p_outcome: outcome,
    p_ip_hash: request ? ipHash(request) : null, p_meta: meta, p_subject_hash: subject,
  });
  if (!r.ok) log('audit', 'event_not_stored', { kind, status: r.status });
  return r.ok;
}
