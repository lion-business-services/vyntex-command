// What the security, team and audit screens ask of the gateway, in one place.
//
// The first group is the gateway's own protected operations (src/platform/gateway.ts), wrapped so that a call never throws
// and a "confirm it is you first" answer from the server opens the identity check and repeats the call once.
//
// The second group (`ExtraOperations`) is what these screens need and the gateway contract does not name yet. In a sample
// workspace they run the same rules as the rest (src/domain/actions/security.ts). In a live workspace they use a method of
// that name on the live gateway when it has one, and otherwise call the server function written next to each of them; when
// the server does not have it yet the answer is `not_available` and the screen says so instead of pretending.
import type { AccessRequest, ISODate, OfficeRole, RevealRequest, TeamUser } from '@/domain/types';
import type { ProfilePatch } from '@/domain/actions/team';
import { saveProfile } from '@/domain/actions';
import { rules, type InviteInput, type Res, type TaxIdType } from '@/domain/actions/security';
import { authGateway, gateway, type ExportFile, type ExportKind, type Outcome, type RevealedValue } from '@/platform/gateway';
import { isLive } from '@/platform/session';
import { rpc } from '@/platform/live/ops';
import { reasonOf } from '@/platform/live/http';
import { applyServer, ctx, mutate, viewerCan } from '@/store/store';
import type { DemoState } from '@/domain/types';
import type { Ctx } from '@/domain/context';
import { askStepUp } from './stepup';

const fail = <T,>(reason: string): Outcome<T> => ({ ok: false, reason, sample: !isLive() });
/**
 * The answers that mean "confirm who you are first" (docs/SERVER.md, section 9). The live gateway words an identity check
 * that was asked for and not completed as `cancelled`.
 */
export const needsStepUp = (reason: string): boolean => reason === 'stepup_required' || reason === 'step_up' || reason === 'cancelled';

/** Runs a gateway call. Never throws; asks for the identity check when the server wants one and repeats the call once. */
async function guarded<T>(run: () => Promise<Outcome<T>>): Promise<Outcome<T>> {
  const attempt = async (): Promise<Outcome<T>> => { try { return await run(); } catch { return fail<T>('not_available'); } };
  let res = await attempt();
  if (!res.ok && needsStepUp(res.reason) && (await askStepUp())) res = await attempt();
  return res;
}

/** Runs one of the sample rules against the sample workspace as the viewer. Only ever called in a sample workspace. */
function sampleRule<T>(fn: (d: DemoState, c: Ctx) => Res<T>): Outcome<T> {
  if (!viewerCan('write')) return { ok: false, reason: 'not_allowed', sample: true };
  let out: Res<T> = { ok: false, reason: 'not_available' };
  mutate((d) => { out = fn(d, ctx()); });
  const res = out as Res<T>;
  return res.ok ? { ok: true, data: res.data, sample: true } : { ok: false, reason: res.reason, sample: true };
}

/**
 * Operations these screens need that the gateway contract does not have yet. Each line names the server call it expects.
 * The live gateway can add a method of the same name and the screens start using it without any change here.
 */
export interface ExtraOperations {
  /** POST /api/ws/rpc/vault_copied { p_request }: writes "copied" to the access log before the value reaches the clipboard. */
  vaultCopied(requestId: string): Promise<Outcome<true>>;
  /** POST /api/ws/rpc/member_enable { p_member } (fresh identity check): lets a switched-off person sign in again. */
  memberEnable(userId: string): Promise<Outcome<TeamUser>>;
  /** POST /api/ws/rpc/member_update_profile { p_member, p_patch }: the function exists in the database (docs/DATABASE.md, section 7). */
  memberUpdate(userId: string, patch: ProfilePatch): Promise<Outcome<TeamUser>>;
  /** POST /api/ws/rpc/invite_resend { p_invitation }: a new link by email, the old one stops working. */
  inviteResend(id: string): Promise<Outcome<TeamUser>>;
  /** POST /api/ws/rpc/invite_revoke { p_invitation } (on the server's list already). */
  inviteRevoke(id: string): Promise<Outcome<true>>;
  /** POST /api/ws/rpc/grant_revoke { p_grant }: takes back access to one client. */
  grantRevoke(grantId: string): Promise<Outcome<true>>;
}
/** The database function behind each extra operation, and how its arguments are named there. */
const SERVER: Record<keyof ExtraOperations, (...a: never[]) => [string, Record<string, unknown>]> = {
  vaultCopied: (requestId: string) => ['vault_copied', { p_request: requestId }],
  memberEnable: (userId: string) => ['member_enable', { p_member: userId }],
  memberUpdate: (userId: string, patch: ProfilePatch) => ['member_update_profile', { p_member: userId, p_patch: patch }],
  inviteResend: (id: string) => ['invite_resend', { p_invitation: id }],
  inviteRevoke: (id: string) => ['invite_revoke', { p_invitation: id }],
  grantRevoke: (grantId: string) => ['grant_revoke', { p_grant: grantId }],
};
const isRow = (v: unknown): v is { id: string } => !!v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string';
/** One call to a protected function of the server, answered the way the gateway answers. */
async function call<T>(name: string, args: Record<string, unknown>): Promise<Outcome<T>> {
  const a = await rpc<T>(name, args);
  return a.ok ? { ok: true, data: a.data.result, sample: false } : { ok: false, reason: reasonOf(a), sample: false };
}
/** Runs an extra operation: the sample rule in a sample workspace, the live gateway's method or the server function otherwise. */
function extra<T>(name: keyof ExtraOperations, args: unknown[], sample: () => Outcome<T>, collection?: 'users'): Promise<Outcome<T>> {
  if (!isLive()) return Promise.resolve(sample());
  const target = gateway().protected as unknown as Record<string, unknown>;
  const fn = target[name];
  if (typeof fn === 'function') return guarded(() => (fn as (...a: unknown[]) => Promise<Outcome<T>>).apply(target, args));
  return guarded(async () => {
    const [rpcName, rpcArgs] = (SERVER[name] as (...a: unknown[]) => [string, Record<string, unknown>])(...args);
    const res = await call<T>(rpcName, rpcArgs);
    // the row the server returns replaces the one on screen
    if (res.ok && collection && isRow(res.data)) applyServer({ [collection]: [res.data] });
    return res;
  });
}
/** A person changes their own profile; the offices they work from and the lead rotation are for whoever manages people. */
function profileRule(d: DemoState, c: Ctx, userId: string, patch: ProfilePatch): Res<TeamUser> {
  const manages = viewerCan('users');
  if (userId !== c.actor && !manages) return { ok: false, reason: 'not_allowed' };
  if (!manages && (patch.officeIds !== undefined || patch.inLeadPool !== undefined)) return { ok: false, reason: 'not_allowed' };
  const u = saveProfile(d, c, userId, patch);
  return u ? { ok: true, data: u } : { ok: false, reason: 'invalid' };
}

export const ops = {
  /* ---- the gateway's own ---- */
  vaultSet: (clientId: string, type: TaxIdType, value: string) => guarded(() => gateway().protected.vaultSet(clientId, type, value)),
  vaultRequest: (clientId: string, reason: string): Promise<Outcome<RevealRequest>> => guarded(() => gateway().protected.vaultRequest(clientId, reason)),
  vaultDecide: (requestId: string, approve: boolean): Promise<Outcome<RevealRequest>> => guarded(() => gateway().protected.vaultDecide(requestId, approve)),
  vaultReveal: (requestId: string): Promise<Outcome<RevealedValue>> => guarded(() => gateway().protected.vaultReveal(requestId)),
  // `lang` is the language of the invitation email; the server call accepts it (docs/SERVER.md, section 6), the contract does not name it yet
  memberInvite: (input: InviteInput): Promise<Outcome<TeamUser>> => guarded(() => gateway().protected.memberInvite(input)),
  memberSetRole: (userId: string, role: OfficeRole): Promise<Outcome<TeamUser>> => guarded(() => gateway().protected.memberSetRole(userId, role)),
  memberDisable: (userId: string): Promise<Outcome<TeamUser>> => guarded(() => gateway().protected.memberDisable(userId)),
  // the end date of the access is a third argument the contract does not name yet: grant_decide { p_request, p_approve, p_expires }
  grantDecide: (requestId: string, approve: boolean, expires?: ISODate): Promise<Outcome<AccessRequest>> => guarded(async () => {
    // a live approval with an end date goes straight to the server function, which is where the date has to arrive
    if (isLive() && approve && expires) {
      const res = await call<AccessRequest>('grant_decide', { p_request: requestId, p_approve: true, p_expires: expires });
      if (res.ok && isRow(res.data)) applyServer({ accessRequests: [res.data] });
      return res;
    }
    return (gateway().protected.grantDecide as (id: string, approve: boolean, expires?: ISODate) => Promise<Outcome<AccessRequest>>)(requestId, approve, expires);
  }),
  exportFile: (kind: ExportKind): Promise<Outcome<ExportFile>> => guarded(() => gateway().protected.exportRequest(kind)),

  /* ---- not in the contract yet ---- */
  vaultCopied: (requestId: string) => extra<true>('vaultCopied', [requestId], () => sampleRule((d, c) => rules.vaultCopied(d, c, requestId))),
  memberEnable: (userId: string) => extra<TeamUser>('memberEnable', [userId], () => sampleRule((d, c) => rules.memberEnable(d, c, userId)), 'users'),
  memberUpdate: (userId: string, patch: ProfilePatch) => extra<TeamUser>('memberUpdate', [userId, patch], () => sampleRule((d, c) => profileRule(d, c, userId, patch)), 'users'),
  inviteResend: (id: string) => extra<TeamUser>('inviteResend', [id], () => sampleRule((d, c) => rules.inviteResend(d, c, id))),
  inviteRevoke: (id: string) => extra<true>('inviteRevoke', [id], () => sampleRule((d, c) => rules.inviteRevoke(d, c, id))),
  grantRevoke: (grantId: string) => extra<true>('grantRevoke', [grantId], () => sampleRule((d, c) => rules.grantRevoke(d, c, grantId))),

  /** Ends every session of the signed-in person, on every device. There is no session in a sample workspace. */
  async signOutAll(): Promise<boolean> {
    if (!isLive()) return false;
    try { await authGateway().signOutAll(); return true; } catch { return false; }
  },
};

/** Hands a file the server (or the sample) produced to the person as a download. */
export function saveFile(file: ExportFile): void {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mime }));
  const a = document.createElement('a');
  a.href = url; a.download = file.fileName; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
