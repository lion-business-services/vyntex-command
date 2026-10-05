// Sign-in against this site's /api/auth addresses (docs/SERVER.md, sections 3 to 6). There is no sign-up call anywhere:
// an account exists only because someone was invited. Wrong email and wrong password get the same answer from the server,
// and this file adds nothing that would tell them apart.
import type { IndustryId, ISODateTime, OfficeRole } from '@/domain/types';
import type { Permission } from '@/domain/permissions';
import { DEPLOY } from '@/config/deployment';
import { isIndustry } from '@/packs';
import { APP_SEGMENT } from '../mode';
import type { AuthOperations, Outcome, SignInResult, WorkspaceRole, WorkspaceSession } from '../gateway';
import { get, post, reasonOf, type Answer, type Fail } from './http';

/** One company the person belongs to, as `GET /api/auth/session` lists it. */
export interface Membership {
  tenantId: string; slug: string; name: string; industry: string; plan: string; status: string;
  role: WorkspaceRole; memberId: string; workerId: string | null; memberName: string; capabilities: string[]; mfaRequired: boolean;
}
/** What sign-in still needs: nothing, a code from the authenticator, or setting an authenticator up first. */
export type MfaState = 'ok' | 'verify' | 'enroll';
export interface SessionAnswer {
  signedIn: boolean;
  deploy: string;
  user?: { id: string; email: string };
  aal?: 'aal1' | 'aal2';
  mfa?: { state: MfaState; enrolled: boolean; required: boolean; recoveryCodesLeft: number };
  stepUp?: { fresh: boolean; expiresAt: ISODateTime | null };
  idleMinutes?: number;
  expiresAt?: ISODateTime;
  memberships?: Membership[];
}

/**
 * Whether this deployment can sign anyone in at all. A preview build has no database settings; its health answer says so
 * (yes or no only), and the sign-in page then says "not configured" instead of failing on the first request.
 * `/api/health` contacts nothing and always answers, so this is asked first, and remembered once it is known.
 *   yes      sign-in works here          no       the deployment is not configured (or has no server functions at all)
 *   offline  the server could not be reached just now: ask again
 */
export type DeploymentState = 'yes' | 'no' | 'offline';
let known: 'yes' | 'no' | null = null;
let asking: Promise<DeploymentState> | null = null;
export function deploymentState(): Promise<DeploymentState> {
  if (known) return Promise.resolve(known);
  asking ??= get<{ configured?: { workspace?: boolean } }>('/api/health', { passive: true, session: false }).then((a) => {
    asking = null;
    if (!a.ok && (a.status === 0 || a.status >= 500)) return 'offline';
    known = a.ok && a.data.configured?.workspace === true ? 'yes' : 'no';
    return known;
  });
  return asking;
}
export const signInConfigured = async (): Promise<boolean> => (await deploymentState()) === 'yes';

/** Who is signed in, straight from the server. `passive` for background checks. Null when the server could not be asked. */
export async function fetchSession(passive = false): Promise<SessionAnswer | null> {
  if (!(await signInConfigured())) return null;
  const a = await get<SessionAnswer>('/api/auth/session', { passive, session: false });
  return a.ok ? a.data : null;
}

/** The companies of a session that this deployment can show. LBS Command serves the professional-services edition only. */
export function usable(answer: SessionAnswer | null): Membership[] {
  const all = (answer?.memberships ?? []).filter((m) => m.status !== 'disabled' && isIndustry(m.industry));
  return DEPLOY.lockedEdition ? all.filter((m) => m.industry === DEPLOY.lockedEdition) : all;
}
/**
 * The membership an address stands for: the company with that slug, or, where the deployment has one company under /app,
 * the person's company. Undefined for an address the person does not belong to, which reads exactly like not being signed in.
 */
export function membershipFor(answer: SessionAnswer | null, slug: string): Membership | undefined {
  const list = usable(answer);
  return DEPLOY.liveBase === 'app' ? (slug === APP_SEGMENT ? list[0] : undefined) : list.find((m) => m.slug === slug);
}
/** The address of a company's workspace in this deployment. */
export const workspaceAddress = (m: Membership): string => (DEPLOY.liveBase === 'app' ? '/' + APP_SEGMENT : '/' + m.slug);

/** The session the store and the pages read: who, which company, which role, what they may do. */
export function describe(answer: SessionAnswer, m: Membership): WorkspaceSession {
  const worker = m.role === 'worker';
  return {
    mode: 'workspace',
    slug: DEPLOY.liveBase === 'app' ? APP_SEGMENT : m.slug,
    tenantId: m.tenantId,
    industry: m.industry as IndustryId,
    planId: m.plan,
    role: m.role,
    actorId: worker ? m.workerId ?? m.memberId : m.memberId,
    name: m.memberName,
    email: answer.user?.email,
    permissions: m.capabilities as Permission[],
    aal: answer.aal,
    idleUntil: answer.idleMinutes ? new Date(Date.now() + answer.idleMinutes * 60000).toISOString() : undefined,
  };
}

const no = <T,>(a: Fail): Outcome<T> => ({ ok: false, reason: reasonOf(a), sample: false });
const yes = <T,>(data: T): Outcome<T> => ({ ok: true, data, sample: false });

/** A failed sign-in step as the page needs it: wrong, locked for a while, or not possible right now. */
export function signInError(a: Fail): SignInResult {
  const retryAfterSeconds = typeof a.data.retryAfterSeconds === 'number' ? a.data.retryAfterSeconds : undefined;
  if (a.code === 'locked' || a.code === 'rate_limited') return { ok: false, step: 'error', reason: a.code === 'locked' ? 'locked' : 'rate_limited', retryAfterSeconds };
  if (a.code === 'not_configured') return { ok: false, step: 'error', reason: 'not_configured' };
  if (a.status === 0 || a.status >= 500) return { ok: false, step: 'error', reason: 'offline' };
  if (a.code === 'mfa_required') return { ok: false, step: a.data.mfa === 'enroll' ? 'enroll' : 'mfa' };
  return { ok: false, step: 'error', reason: 'invalid', retryAfterSeconds };
}
/** After a step that may have finished sign-in: the session, or what is still owed. */
async function afterStep(a: Answer<{ mfa?: MfaState }>): Promise<SignInResult> {
  if (!a.ok) return signInError(a);
  if (a.data.mfa === 'verify') return { ok: false, step: 'mfa' };
  if (a.data.mfa === 'enroll') return { ok: false, step: 'enroll' };
  const s = await fetchSession();
  const m = usable(s)[0];
  // signed in, and no company this deployment can show: the same answer as a wrong password
  if (!s?.signedIn || !m) return { ok: false, step: 'error', reason: s ? 'invalid' : 'offline' };
  return { ok: true, session: describe(s, m) };
}

export const liveAuth: AuthOperations = {
  async signIn(email, password) {
    if (!(await signInConfigured())) return { ok: false, step: 'error', reason: 'not_configured' };
    return afterStep(await post('/api/auth/signin', { email, password }, { stepUp: false, session: false }));
  },
  async mfaVerify(code) { return afterStep(await post('/api/auth/mfa/verify', { code }, { stepUp: false, session: false })); },
  async mfaEnroll() {
    const a = await post<{ factorId: string; secret: string; uri: string }>('/api/auth/mfa/enroll', {}, { stepUp: false, session: false });
    return a.ok ? yes({ factorId: a.data.factorId, secret: a.data.secret, uri: a.data.uri }) : no(a);
  },
  async mfaConfirm(factorId, code) {
    const a = await post<{ recoveryCodes: string[] }>('/api/auth/mfa/confirm', { factorId, code }, { stepUp: false, session: false });
    return a.ok ? yes({ recoveryCodes: a.data.recoveryCodes ?? [] }) : no(a);
  },
  async mfaRecovery(code) { return afterStep(await post('/api/auth/mfa/recovery', { code }, { stepUp: false, session: false })); },
  async signOut() { await post('/api/auth/signout', {}, { stepUp: false, session: false }); },
  async signOutAll() { await post('/api/auth/signout-all', {}, { stepUp: false, session: false }); },
  async session() {
    const s = await fetchSession(true);
    const m = usable(s)[0];
    return s?.signedIn && s.mfa?.state === 'ok' && m ? describe(s, m) : null;
  },
  async inviteInfo(token) {
    if (!(await signInConfigured())) return { ok: false, reason: 'not_configured', sample: false };
    const a = await post<{ company: string; emailHint: string; expiresAt: ISODateTime }>('/api/auth/invite/check', { token }, { stepUp: false, session: false });
    return a.ok ? yes({ email: a.data.emailHint, company: a.data.company, expiresAt: a.data.expiresAt }) : no(a);
  },
  async inviteAccept(token, input) {
    const a = await post<{ signedIn: boolean; mfa?: MfaState }>('/api/auth/invite/accept', { token, password: input.password, name: input.name }, { stepUp: false, session: false });
    if (a.ok && !a.data.signedIn) return { ok: false, step: 'error', reason: 'not_available' };
    return afterStep(a);
  },
  async passwordReset(email) { await post('/api/auth/password/reset', { email }, { stepUp: false, session: false }); },
  async passwordUpdate(input) {
    // with the token of an emailed link nobody is signed in; without one it is a change by the person signed in, which
    // needs a fresh identity check (the shared prompt opens when the server asks for it)
    const a = input.token !== undefined
      ? await post('/api/auth/password/reset', { token: input.token, password: input.next }, { stepUp: false, session: false })
      : await post('/api/auth/password/update', { password: input.next }, { session: true });
    return a.ok ? yes(true as const) : no(a);
  },
  async stepUp(input) {
    const a = await post<{ stepUp: { expiresAt: ISODateTime } }>('/api/auth/stepup', input.code ? { code: input.code } : { password: input.password }, { stepUp: false, session: true });
    return a.ok ? yes({ until: a.data.stepUp.expiresAt }) : no(a);
  },
};

/** Roles an invitation can carry, for screens that list them. Owners can only be invited by an owner (the server decides). */
export const INVITABLE: readonly OfficeRole[] = ['owner', 'manager', 'staff', 'readonly'];
