// Opening, watching and closing a live workspace.
//
//   open    who is signed in (GET /api/auth/session), which company the address stands for, anything held from a session
//           that ended, then the records (GET /api/ws/load), and the store starts from them
//   watch   a quiet check every minute while the page is visible: it notices a session that ended and brings in what
//           colleagues changed. It is marked as background polling, so it never keeps a session alive by itself.
//           Real use of the page (typing, clicking) is reported every few minutes, so someone who is reading is not
//           signed out for being idle.
//   close   sign out, or the server said the session ended: the records leave memory, and what was unsaved is set
//           aside for the same person signing in again from this page
import type { WorkspaceData } from '../gateway';
import { isLive, session, setSessionEnd, type SessionEndReason } from '../session';
import { bootLive, endLive, hasUnsaved, parkUnsaved, refreshLive, syncNow, updateLiveSession, currentT } from '@/store/store';
import { toast } from '@/ui';
import { get, post, sessionEnded, setSessionEndedHandler, type Fail } from './http';
import { deploymentState, describe, fetchSession, membershipFor, type MfaState, type SessionAnswer } from './auth';
import { makeSync, sendHeld, stopSync } from './sync';
import { hold, takeHeld, whoKey } from './carry';
import { setRefresher } from './ops';
import { syncStatus } from './status';

export type Gate =
  /** The workspace is open: the store holds its records. */
  | { state: 'ready' }
  /** Nobody is signed in, or the person does not belong to the company of this address. The two look the same on purpose. */
  | { state: 'signin'; signedIn: boolean }
  /** Signed in, and the second sign-in step is still owed. */
  | { state: 'mfa'; step: Exclude<MfaState, 'ok'> }
  /** This deployment has no sign-in set up (a preview build). */
  | { state: 'unconfigured' }
  /** The server could not be reached. */
  | { state: 'offline' };

const POLL_MS = 60000;
const ACTIVITY_MS = 4 * 60000;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let activityTimer: ReturnType<typeof setInterval> | undefined;
let active = false;
let lastPoll = 0;
let lastLoadMs = 0;
let polling = false;

const loadPath = (tenantId: string) => '/api/ws/load?tenant=' + encodeURIComponent(tenantId);

/** What a failed load means for the person at the door. */
function gateOf(a: Fail, s: SessionAnswer): Gate {
  if (a.code === 'not_configured') return { state: 'unconfigured' };
  if (a.code === 'mfa_required') return { state: 'mfa', step: a.data.mfa === 'verify' || s.mfa?.enrolled ? 'verify' : 'enroll' };
  // not a member (403), or the session ended between the two requests (401): the sign-in page, nothing more specific
  if (a.status === 401 || a.status === 403 || a.status === 404) return { state: 'signin', signedIn: a.status !== 401 && !sessionEnded(a.code) };
  return { state: 'offline' };
}

/**
 * Opens the workspace an address stands for (`slug` is the company address, or `app` where the deployment has one company).
 * Answers what the page should show. An address the person does not belong to and an address that does not exist get the
 * same answer as not being signed in.
 */
export async function openWorkspace(slug: string): Promise<Gate> {
  const there = await deploymentState();
  if (there !== 'yes') return { state: there === 'no' ? 'unconfigured' : 'offline' };
  const s = await fetchSession();
  if (!s) return { state: 'offline' };
  if (!s.signedIn) return { state: 'signin', signedIn: false };
  if (s.mfa && s.mfa.state !== 'ok') return { state: 'mfa', step: s.mfa.state };
  const m = membershipFor(s, slug);
  if (!m) return { state: 'signin', signedIn: true };
  const who = describe(s, m);

  // Changes that were unsaved when the last session of this page ended go first, under the keys they already had.
  const held = takeHeld(whoKey(who.email, who.tenantId));
  let heldNote = '';
  if (held.length) {
    const { result, unsent } = await sendHeld(m.tenantId, held);
    if (unsent.length) hold(whoKey(who.email, who.tenantId), unsent);
    const t = currentT();
    // counted the way a person counts: records, not the history lines written with them
    const history = (c: string) => c === 'activity' || c === 'automationRuns';
    const lost = result.rejected.filter((r) => !history(r.c)).length + unsent.reduce((n, b) => n + b.ops.filter((o) => !history(o.c)).length, 0);
    heldNote = lost ? t('auth.held.some', { n: lost }) : t('auth.held.saved');
  }

  const started = Date.now();
  const a = await get<{ data: WorkspaceData }>(loadPath(m.tenantId), { session: false });
  lastLoadMs = Date.now() - started;
  if (!a.ok) return gateOf(a, s);
  setSessionEnd(null);
  bootLive(a.data.data, who, makeSync(m.tenantId));
  watch();
  if (heldNote) toast(heldNote, heldNote !== currentT()('auth.held.saved'));
  return { state: 'ready' };
}

/** Brings the server's copy in when nothing of this person's is waiting, and learns whether the session is still open. */
async function poll(passive = true): Promise<void> {
  const s = session();
  if (!s?.tenantId || polling || !isLive()) return;
  polling = true; lastPoll = Date.now();
  try {
    if (!hasUnsaved() && syncStatus().state === 'saved') {
      const started = Date.now();
      // a session that ended answers 401 with its reason, which reaches `ended` through the handler registered below
      const a = await get<{ data: WorkspaceData }>(loadPath(s.tenantId), { passive, session: true });
      lastLoadMs = Date.now() - started;
      if (!isLive() || session()?.tenantId !== s.tenantId) return;
      if (a.ok) refreshLive(a.data.data);
    }
    // a role or a name changed by an owner shows up here; the server enforces it either way
    const answer = await fetchSession(passive);
    if (!answer || !isLive() || session()?.tenantId !== s.tenantId) return;
    if (!answer.signedIn) { ended('session_expired'); return; }
    const m = membershipFor(answer, s.slug);
    if (!m || m.tenantId !== s.tenantId) { ended('session_revoked'); return; }
    if (m.role !== s.role || m.capabilities.join() !== (s.permissions ?? []).join() || m.memberName !== s.name) updateLiveSession(describe(answer, m));
  } finally { polling = false; }
}
/** After a protected operation the database changed rows itself: fetch them soon, once the queue is quiet. */
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
function refreshSoon(): void { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { void poll(false); }, 400); }

const noteActivity = () => { active = true; };
const onVisible = () => { if (document.visibilityState === 'visible' && Date.now() - lastPoll > POLL_MS / 2) void poll(); };
const onOnline = () => { syncNow(); };
/** The browser asks before a page with unsaved changes is closed. It words the question itself. */
const beforeUnload = (e: BeforeUnloadEvent) => { if (isLive() && (hasUnsaved() || syncStatus().state !== 'saved')) { e.preventDefault(); e.returnValue = ''; } };

function watch(): void {
  unwatch();
  lastPoll = Date.now();
  // a company so large that loading takes seconds is checked less often
  pollTimer = setInterval(() => { if (document.visibilityState === 'visible' && Date.now() - lastPoll >= Math.max(POLL_MS, lastLoadMs * 40) - 1000) void poll(); }, POLL_MS);
  activityTimer = setInterval(() => {
    if (!active || !isLive()) return;
    active = false;
    // not passive: this is the person using the page, and it moves the session's activity stamp
    void get('/api/auth/session', { session: true });
  }, ACTIVITY_MS);
  window.addEventListener('pointerdown', noteActivity, { passive: true });
  window.addEventListener('keydown', noteActivity, { passive: true });
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);
  window.addEventListener('beforeunload', beforeUnload);
  setRefresher(refreshSoon);
}
function unwatch(): void {
  clearInterval(pollTimer); clearInterval(activityTimer); clearTimeout(refreshTimer);
  window.removeEventListener('pointerdown', noteActivity);
  window.removeEventListener('keydown', noteActivity);
  document.removeEventListener('visibilitychange', onVisible);
  window.removeEventListener('online', onOnline);
  window.removeEventListener('beforeunload', beforeUnload);
  setRefresher(() => undefined);
}

/** The records leave memory and every timer stops. */
function close(): void { unwatch(); stopSync(); endLive(); }

/**
 * The server said the session is over (or owes its second step again). What was unsaved is set aside in memory, the
 * workspace closes, and the address stays where it was: the sign-in page that appears leads straight back to it.
 */
function ended(code: string): void {
  if (!isLive()) return;
  const unsaved = parkUnsaved();
  close();
  // a session that only owes its second step is still open: the door shows that step, not a notice
  if (code === 'mfa_required') return;
  const reason: SessionEndReason = code === 'session_idle' ? 'idle' : code === 'session_revoked' ? 'revoked' : 'expired';
  setSessionEnd({ reason, unsaved });
}
setSessionEndedHandler(ended);

/** Checks now, for a screen that wants to be sure before something important (and for the tests). */
export const checkNow = (): Promise<void> => poll();

/**
 * Signs out: this browser, or every browser and device of the person. The caller has already asked about unsaved changes.
 * Whatever the server answers, the records leave this page.
 */
export async function signOut(everywhere = false): Promise<void> {
  await post(everywhere ? '/api/auth/signout-all' : '/api/auth/signout', {}, { stepUp: false, session: false });
  close();
  setSessionEnd({ reason: 'signed_out', unsaved: 0 });
}
