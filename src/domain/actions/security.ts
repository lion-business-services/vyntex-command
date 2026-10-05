// Security: the tax ID vault, people and their roles, access to clients of another office, offices, and the company's own
// role and sign-in rules.
//
// Two kinds of function live here.
//
//   Ordinary changes (offices, role capabilities, role names, sign-in and vault rules). They travel like any other change:
//   `act(saveOffice, ...)`. They are re-exported from '@/domain/actions'.
//
//   The rules of the protected operations (`rules` below: set, request, decide, reveal, invite, change role, disable,
//   grant). In a live workspace the server and the database apply them and nothing here runs. In a sample workspace
//   src/platform/sample.ts calls them, so a reviewer meets the same refusals the real system gives: the wrong role is
//   refused, the person who asked cannot approve, an approval runs out, a value is shown once. They are plain functions
//   over the workspace so they can be tested without a browser (tests/unit/vault.test.mjs). They are not re-exported from
//   '@/domain/actions' on purpose: a page must never run them with `act()`.
//
// A tax ID never passes through this file as data to keep: `vaultSet` reads the digits to check the format and to take the
// last four, then lets go of them.
import type {
  AccessGrant, AccessRequest, Activity, AuditEntry, Client, CompanyConfig, DemoState, ISODate, ISODateTime, L10n, Office, OfficeRole, RevealRequest, SecureAccessLog, TeamUser,
} from '../types';
import type { Ctx } from '../context';
import { OFFICE_ROLES, isOfficeRole, type Permission } from '../permissions';
import { permissionsOf, vaultRules } from '../config';
import { canSeeClient, visibleClientIds, visibleLeads } from '../access';
import type { ExportFile, ExportKind } from '@/platform/gateway';
import { nowIso, today } from '@/lib/dates';
import { uid } from '@/lib/id';
import { isLive } from '@/platform/session';

/* ---------- tax ID formats ---------- */

export type TaxIdType = NonNullable<Client['taxIdType']>;
export const TAX_ID_TYPES: TaxIdType[] = ['ssn', 'ein', 'itin'];
export const onlyDigits = (v: string): string => v.replace(/\D/g, '');

/** The two-digit prefixes that have been assigned to employer identification numbers. */
const EIN_PREFIXES = new Set<number>([1, 2, 3, 4, 5, 6, 10, 11, 12, 13, 14, 15, 16, 20, 21, 22, 23, 24, 25, 26, 27, 98, 99,
  ...Array.from({ length: 19 }, (_, i) => 30 + i), ...Array.from({ length: 19 }, (_, i) => 50 + i), ...Array.from({ length: 7 }, (_, i) => 71 + i),
  ...Array.from({ length: 9 }, (_, i) => 80 + i), ...Array.from({ length: 6 }, (_, i) => 90 + i)]);
/** The fourth and fifth digits an individual taxpayer number can have. */
const itinGroup = (g: number) => (g >= 50 && g <= 65) || (g >= 70 && g <= 88) || (g >= 90 && g <= 92) || (g >= 94 && g <= 99);

export type TaxIdProblem = 'length' | 'pattern';
/**
 * Checks that what was typed can be a number of that type. It only looks at the shape (how many digits, which ranges are
 * never issued): it cannot tell whether the number belongs to the person. Returns null when the shape is right.
 */
export function taxIdProblem(type: TaxIdType, value: string): TaxIdProblem | null {
  // anything other than digits, spaces and dashes is a typing mistake, not a separator
  if (/[^\d\s-]/.test(value)) return 'pattern';
  const d = onlyDigits(value);
  if (d.length !== 9) return 'length';
  const area = Number(d.slice(0, 3)), group = Number(d.slice(3, 5)), serial = Number(d.slice(5));
  if (type === 'ein') return EIN_PREFIXES.has(Number(d.slice(0, 2))) ? null : 'pattern';
  if (type === 'itin') return area >= 900 && itinGroup(group) ? null : 'pattern';
  // social security number: these areas, group 00 and serial 0000 are never issued; 9xx belongs to the other type
  return area === 0 || area === 666 || area >= 900 || group === 0 || serial === 0 ? 'pattern' : null;
}
/** Puts the dashes where that type has them, as far as the digits go: "12-3456789", "123-45-6789". */
export function formatTaxId(type: TaxIdType, value: string): string {
  const d = onlyDigits(value).slice(0, 9);
  if (type === 'ein') return d.length > 2 ? `${d.slice(0, 2)}-${d.slice(2)}` : d;
  return d.length > 5 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : d.length > 3 ? `${d.slice(0, 3)}-${d.slice(3)}` : d;
}
/** The number with everything hidden except the last four digits: "•••-••-0142". This is all a sample workspace can ever show. */
export function maskedTaxId(type: TaxIdType | undefined, last4: string | undefined): string {
  const tail = last4 && /^\d{4}$/.test(last4) ? last4 : '••••';
  return type === 'ein' ? `••-•••${tail}` : `•••-••-${tail}`;
}

/* ---------- who is acting ---------- */

export type Res<T> = { ok: true; data: T } | { ok: false; reason: string };
const yes = <T>(data: T): Res<T> => ({ ok: true, data });
const no = <T>(reason: string): Res<T> => ({ ok: false, reason });

interface Who { id: string; user: TeamUser | undefined; perms: Permission[]; can: (...p: Permission[]) => boolean }
/** The person behind an action and what their role may do. Someone who was switched off holds nothing. */
function who(d: DemoState, ctx: Ctx): Who {
  const user = d.users.find((u) => u.id === ctx.actor);
  const perms = user && user.active !== false && isOfficeRole(user.role) ? permissionsOf(d, ctx.pack, user.role) : [];
  return { id: ctx.actor, user, perms, can: (...p) => p.every((x) => perms.includes(x)) };
}

/* ---------- trails ---------- */

/**
 * One line of the audit trail of a sample workspace. In a live workspace the database writes the trail itself and the
 * browser cannot add to it, so this does nothing there.
 */
export function auditSample(d: DemoState, by: string, action: string, entity?: string, entityId?: string, summary?: string): void {
  if (isLive()) return;
  const entry: AuditEntry = { id: uid('au'), at: nowIso(), by, action, entity, entityId, summary };
  d.audit.unshift(entry);
  if (d.audit.length > 500) d.audit.length = 500;
}
function secureLog(d: DemoState, by: string, clientId: string, action: SecureAccessLog['action'], reason?: string, requestId?: string): void {
  d.secureLog.unshift({ id: uid('sl'), at: nowIso(), clientId, userId: by, action, reason, requestId });
}

/* ---------- the vault ---------- */

/** An approval is good for this long, for one viewing. */
export const APPROVAL_MINUTES = 15;
/** A request nobody answered lapses after this long. */
export const REQUEST_HOURS = 24;
/** The shortest reason that counts as written. */
export const MIN_REASON = 5;
const later = (from: ISODateTime, minutes: number): ISODateTime => new Date(new Date(from).getTime() + minutes * 60000).toISOString();

/** Whether a request has run out at this moment: an approval past its window, or a request left unanswered too long. */
export function revealLapsed(r: RevealRequest, now: ISODateTime = nowIso()): boolean {
  if (r.status === 'approved') return !!r.expiresAt && r.expiresAt <= now;
  if (r.status === 'pending') return later(r.at, REQUEST_HOURS * 60) <= now;
  return false;
}
/** The state a request is really in, whatever was last written down. */
export const revealState = (r: RevealRequest, now: ISODateTime = nowIso()): RevealRequest['status'] => (revealLapsed(r, now) ? 'expired' : r.status);

/** Closes every request that has run out and writes each one to the access log. Returns how many were closed. */
export function sweepReveals(d: DemoState, now: ISODateTime = nowIso()): number {
  let n = 0;
  for (const r of d.reveals) {
    if (!revealLapsed(r, now)) continue;
    r.status = 'expired'; n++;
    secureLog(d, 'system', r.clientId, 'expire', undefined, r.id);
    auditSample(d, 'system', 'vault.expire', 'client', r.clientId);
  }
  return n;
}

function clientFor(d: DemoState, w: Who, clientId: string): Client | undefined {
  const c = d.clients.find((x) => x.id === clientId);
  // a client of another office does not exist for this person
  return c && canSeeClient(d, w.user, w.perms, c) ? c : undefined;
}

/**
 * Puts a tax ID on file, replaces it, or removes it (an empty value). Needs `secureReveal` and `write`.
 * The number is checked and dropped: the record keeps its type and last four digits.
 */
export function vaultSet(d: DemoState, ctx: Ctx, clientId: string, type: TaxIdType, value: string): Res<{ taxIdType: TaxIdType; taxIdLast4: string }> {
  const w = who(d, ctx);
  if (!w.can('secureView', 'secureReveal', 'write')) return no('not_allowed');
  const c = clientFor(d, w, clientId);
  if (!c) return no('not_found');
  if (!TAX_ID_TYPES.includes(type)) return no('invalid');
  if (value.trim() === '') {
    if (!c.taxIdType) return no('not_found');
    const was = c.taxIdType;
    delete c.taxIdType; delete c.taxIdLast4;
    // nothing is left to see: requests that were waiting or approved are closed
    for (const r of d.reveals) if (r.clientId === clientId && (r.status === 'pending' || r.status === 'approved')) { r.status = 'expired'; secureLog(d, 'system', clientId, 'expire', undefined, r.id); }
    secureLog(d, w.id, clientId, 'clear');
    auditSample(d, w.id, 'vault.clear', 'client', clientId, was);
    return yes({ taxIdType: was, taxIdLast4: '' });
  }
  if (taxIdProblem(type, value)) return no('invalid');
  const last4 = onlyDigits(value).slice(-4);
  c.taxIdType = type; c.taxIdLast4 = last4;
  secureLog(d, w.id, clientId, 'set');
  // the trail says a number was stored and of which type, never a digit of it
  auditSample(d, w.id, 'vault.set', 'client', clientId, type);
  return yes({ taxIdType: type, taxIdLast4: last4 });
}

/** Asks to see a client's tax ID, with the business reason in writing. Needs `secureReveal` and `write`. */
export function vaultRequest(d: DemoState, ctx: Ctx, clientId: string, reason: string): Res<RevealRequest> {
  sweepReveals(d);
  const w = who(d, ctx);
  if (!w.can('secureView', 'secureReveal', 'write')) return no('not_allowed');
  const text = reason.trim();
  if (text.length < MIN_REASON) return no('invalid');
  const c = clientFor(d, w, clientId);
  if (!c || !c.taxIdType) return no('not_found');
  // one open request per person and client: a second one would only hide the first
  if (d.reveals.some((r) => r.clientId === clientId && r.requestedBy === w.id && (r.status === 'pending' || r.status === 'approved'))) return no('conflict');
  const req: RevealRequest = { id: uid('rv'), clientId, field: 'tax_id', requestedBy: w.id, reason: text.slice(0, 300), at: nowIso(), status: 'pending' };
  d.reveals.unshift(req);
  secureLog(d, w.id, clientId, 'request', req.reason, req.id);
  auditSample(d, w.id, 'vault.request', 'client', clientId);
  return yes(req);
}

/**
 * Approves or denies a request.
 *   Two-person rule (`second_person`): someone else with `secureApprove` decides. The person who asked can never approve.
 *   Single-person rule (`step_up`): the person who asked approves their own request after confirming who they are, when
 *   their role may reveal. The identity check itself is the server's; here the rule only says who may decide.
 * The person who asked may always withdraw their own request (a denial by themselves).
 */
export function vaultDecide(d: DemoState, ctx: Ctx, requestId: string, approve: boolean): Res<RevealRequest> {
  sweepReveals(d);
  const w = who(d, ctx);
  const r = d.reveals.find((x) => x.id === requestId);
  if (!r) return no('not_found');
  if (r.status !== 'pending') return no('expired');
  const own = r.requestedBy === w.id;
  if (own && approve) {
    if (vaultRules(d).approval !== 'step_up') return no('needs_other_person');
    if (!w.can('secureReveal', 'write')) return no('not_allowed');
  } else if (!own && !w.can('secureApprove', 'write')) return no('not_allowed');
  if (!own && !clientFor(d, w, r.clientId)) return no('not_found');
  const now = nowIso();
  r.status = approve ? 'approved' : 'denied'; r.approverId = w.id; r.decidedAt = now;
  if (approve) r.expiresAt = later(now, APPROVAL_MINUTES);
  secureLog(d, w.id, r.clientId, approve ? 'approve' : 'deny', undefined, r.id);
  auditSample(d, w.id, approve ? 'vault.approve' : 'vault.deny', 'client', r.clientId);
  return yes(r);
}

/**
 * Opens an approved request: once, by the person who asked, inside the approval's window. The request is used up and the
 * viewing is written to the access log before anything is shown. A sample workspace has no number, so `value` is null.
 */
export function vaultReveal(d: DemoState, ctx: Ctx, requestId: string): Res<{ value: null; hideAt: ISODateTime; last4?: string }> {
  sweepReveals(d);
  const w = who(d, ctx);
  const r = d.reveals.find((x) => x.id === requestId);
  if (!r) return no('not_found');
  if (r.requestedBy !== w.id || !w.can('secureReveal', 'write')) return no('not_allowed');
  if (r.status !== 'approved') return no('expired');
  const c = clientFor(d, w, r.clientId);
  if (!c || !c.taxIdType) return no('not_found');
  r.status = 'used';
  secureLog(d, w.id, r.clientId, 'reveal', r.reason, r.id);
  auditSample(d, w.id, 'vault.reveal', 'client', r.clientId);
  return yes({ value: null, hideAt: later(nowIso(), vaultRules(d).revealSeconds / 60), last4: c.taxIdLast4 });
}

/** The value was copied out of the panel. Only the person who just opened the request can say so, and it is logged. */
export function vaultCopied(d: DemoState, ctx: Ctx, requestId: string): Res<true> {
  const w = who(d, ctx);
  const r = d.reveals.find((x) => x.id === requestId);
  if (!r) return no('not_found');
  if (r.requestedBy !== w.id || r.status !== 'used') return no('not_allowed');
  secureLog(d, w.id, r.clientId, 'export', r.reason, r.id);
  auditSample(d, w.id, 'vault.copy', 'client', r.clientId);
  return yes(true);
}

/* ---------- people ---------- */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const activeOwners = (d: DemoState): TeamUser[] => d.users.filter((u) => u.role === 'owner' && u.active !== false);
/** How long an invitation can be accepted. */
export const INVITE_HOURS = 72;
export type InviteState = 'member' | 'invited' | 'invite_expired' | 'disabled';
/** Where a person stands: a member, invited and not yet in, invited too long ago, or switched off. */
export function memberState(u: TeamUser, now: ISODateTime = nowIso()): InviteState {
  if (u.invitedAt && !u.lastSeen && u.active === false) return later(u.invitedAt, INVITE_HOURS * 60) <= now ? 'invite_expired' : 'invited';
  return u.active === false ? 'disabled' : 'member';
}

export interface InviteInput { name: string; email: string; role: OfficeRole; officeIds?: string[]; title?: string; lang?: string }
/**
 * Invites a person. Needs `users` and `write`; only an owner invites an owner. The person is on the list as invited and is
 * not active until they accept, so nobody can hand them work before they exist.
 */
export function memberInvite(d: DemoState, ctx: Ctx, input: InviteInput): Res<TeamUser> {
  const w = who(d, ctx);
  if (!w.can('users', 'write')) return no('not_allowed');
  const name = input.name.trim(), email = input.email.trim().toLowerCase();
  if (!name || !EMAIL.test(email) || !OFFICE_ROLES.includes(input.role)) return no('invalid');
  if (input.role === 'owner' && w.user?.role !== 'owner') return no('not_allowed');
  if (d.users.some((u) => u.email.trim().toLowerCase() === email)) return no('conflict');
  const officeIds = (input.officeIds ?? []).filter((id) => d.offices.some((o) => o.id === id));
  const user: TeamUser = { id: uid('u'), name, email, role: input.role, title: input.title?.trim() || undefined, officeIds: officeIds.length ? officeIds : undefined, active: false, invitedAt: nowIso() };
  d.users.push(user);
  auditSample(d, w.id, 'invite.created', 'user', user.id, `${email} · ${input.role}`);
  return yes(user);
}

/** Changes a person's role. Needs `users` and `write`; only an owner makes or unmakes an owner; the last owner stays one. */
export function memberSetRole(d: DemoState, ctx: Ctx, userId: string, role: OfficeRole): Res<TeamUser> {
  const w = who(d, ctx);
  if (!w.can('users', 'write')) return no('not_allowed');
  const u = d.users.find((x) => x.id === userId);
  if (!u) return no('not_found');
  if (!OFFICE_ROLES.includes(role)) return no('invalid');
  if (u.role === role) return yes(u);
  if ((u.role === 'owner' || role === 'owner') && w.user?.role !== 'owner') return no('not_allowed');
  // a company never ends up without an owner
  if (u.role === 'owner' && u.active !== false && activeOwners(d).length === 1) return no('locked');
  const was = u.role;
  u.role = role;
  auditSample(d, w.id, 'member.role_changed', 'user', userId, `${was} > ${role}`);
  return yes(u);
}

/**
 * Switches a person off: they keep their history and cannot sign in. Needs `users` and `write`. Nobody switches themselves
 * off, only an owner switches an owner off, and the last owner cannot be switched off.
 */
export function memberDisable(d: DemoState, ctx: Ctx, userId: string): Res<TeamUser> {
  const w = who(d, ctx);
  if (!w.can('users', 'write')) return no('not_allowed');
  const u = d.users.find((x) => x.id === userId);
  if (!u) return no('not_found');
  if (u.id === w.id) return no('locked');
  if (u.role === 'owner' && w.user?.role !== 'owner') return no('not_allowed');
  if (u.role === 'owner' && u.active !== false && activeOwners(d).length === 1) return no('locked');
  if (u.active === false) return yes(u);
  u.active = false; u.inLeadPool = false;
  // what they were waiting for is closed with them
  for (const r of d.reveals) if (r.requestedBy === userId && (r.status === 'pending' || r.status === 'approved')) { r.status = 'expired'; secureLog(d, 'system', r.clientId, 'expire', undefined, r.id); }
  auditSample(d, w.id, 'member.disabled', 'user', userId);
  return yes(u);
}

/** Lets a person who was switched off sign in again. Same rule as switching off. */
export function memberEnable(d: DemoState, ctx: Ctx, userId: string): Res<TeamUser> {
  const w = who(d, ctx);
  if (!w.can('users', 'write')) return no('not_allowed');
  const u = d.users.find((x) => x.id === userId);
  if (!u) return no('not_found');
  if (u.role === 'owner' && w.user?.role !== 'owner') return no('not_allowed');
  if (memberState(u) !== 'disabled') return no('invalid');
  u.active = true;
  auditSample(d, w.id, 'member.enabled', 'user', userId);
  return yes(u);
}

/** Sends an invitation again: the clock starts over. */
export function inviteResend(d: DemoState, ctx: Ctx, userId: string): Res<TeamUser> {
  const w = who(d, ctx);
  if (!w.can('users', 'write')) return no('not_allowed');
  const u = d.users.find((x) => x.id === userId);
  if (!u) return no('not_found');
  if (memberState(u) === 'member' || memberState(u) === 'disabled') return no('invalid');
  u.invitedAt = nowIso();
  auditSample(d, w.id, 'invite.resent', 'user', userId, u.email);
  return yes(u);
}
/** Withdraws an invitation nobody accepted: the person leaves the list, they never had any history. */
export function inviteRevoke(d: DemoState, ctx: Ctx, userId: string): Res<true> {
  const w = who(d, ctx);
  if (!w.can('users', 'write')) return no('not_allowed');
  const u = d.users.find((x) => x.id === userId);
  if (!u) return no('not_found');
  if (memberState(u) === 'member' || memberState(u) === 'disabled') return no('invalid');
  d.users = d.users.filter((x) => x.id !== userId);
  auditSample(d, w.id, 'invite.revoked', 'user', userId, u.email);
  return yes(true);
}

/* ---------- access to a client of another office ---------- */

/**
 * Approves or denies a request to see a client of another office. Approving creates the grant, which may end on a date.
 * Needs `allClients` and `write`; nobody decides their own request.
 */
export function grantDecide(d: DemoState, ctx: Ctx, requestId: string, approve: boolean, expires?: ISODate): Res<AccessRequest> {
  const w = who(d, ctx);
  if (!w.can('allClients', 'write')) return no('not_allowed');
  const r = d.accessRequests.find((x) => x.id === requestId);
  if (!r) return no('not_found');
  if (r.status !== 'pending') return no('expired');
  if (r.userId === w.id) return no('needs_other_person');
  if (expires !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(expires) || expires < today())) return no('invalid');
  r.status = approve ? 'approved' : 'denied'; r.decidedBy = w.id; r.decidedAt = nowIso();
  if (approve) {
    // one grant per person and client: a new approval replaces the old one, so its end date is the one that counts
    d.grants = d.grants.filter((g) => !(g.userId === r.userId && g.clientId === r.clientId));
    const grant: AccessGrant = { id: uid('gr'), userId: r.userId, clientId: r.clientId, grantedBy: w.id, at: nowIso(), expires, reason: r.reason || undefined };
    d.grants.push(grant);
  }
  auditSample(d, w.id, approve ? 'access.grant' : 'access.deny', 'client', r.clientId, approve && expires ? expires : undefined);
  return yes(r);
}
/** Takes back access that was granted. Needs `allClients` and `write`. */
export function grantRevoke(d: DemoState, ctx: Ctx, grantId: string): Res<true> {
  const w = who(d, ctx);
  if (!w.can('allClients', 'write')) return no('not_allowed');
  const g = d.grants.find((x) => x.id === grantId);
  if (!g) return no('not_found');
  d.grants = d.grants.filter((x) => x.id !== grantId);
  auditSample(d, w.id, 'access.revoke', 'client', g.clientId);
  return yes(true);
}

/** Requests waiting for this person to decide: tax ID requests of other people, and requests to see a client. */
export function waitingFor(d: DemoState, userId: string | undefined, perms: Permission[]): { reveals: RevealRequest[]; access: AccessRequest[] } {
  const write = perms.includes('write');
  return {
    reveals: write && perms.includes('secureApprove') ? d.reveals.filter((r) => revealState(r) === 'pending' && r.requestedBy !== userId) : [],
    access: write && perms.includes('allClients') ? d.accessRequests.filter((r) => r.status === 'pending' && r.userId !== userId) : [],
  };
}

/* ---------- ordinary changes: offices ---------- */

/** Adds an office or changes one. Exactly one office is the main one: marking another moves the mark. */
export function saveOffice(d: DemoState, ctx: Ctx, input: Omit<Office, 'id'>, id?: string): Office | null {
  const name = input.name.trim(); if (!name) return null;
  const clean: Omit<Office, 'id'> = { name, address: input.address.trim(), phone: input.phone?.trim() || undefined, timezone: input.timezone?.trim() || undefined, main: input.main || undefined };
  let office: Office;
  if (id) {
    const cur = d.offices.find((o) => o.id === id); if (!cur) return null;
    Object.assign(cur, clean); if (!clean.main) delete cur.main;
    office = cur;
  } else {
    office = { ...clean, id: uid('o') };
    d.offices.push(office);
  }
  if (office.main) for (const o of d.offices) if (o.id !== office.id) delete o.main;
  // a company with offices always has a main one
  if (!d.offices.some((o) => o.main)) d.offices[0].main = true;
  auditSample(d, ctx.actor, id ? 'office.updated' : 'office.created', 'office', office.id, office.name);
  return office;
}
/** What still points at an office: it cannot be removed while clients belong to it. */
export const officeUse = (d: DemoState, id: string) => ({
  clients: d.clients.filter((c) => c.officeId === id).length,
  people: d.users.filter((u) => u.officeIds?.includes(id)).length,
  leads: d.leads.filter((l) => l.officeId === id).length,
});
/** Removes an office that no client belongs to. People assigned to it lose that assignment; leads go back to "no office". */
export function removeOffice(d: DemoState, ctx: Ctx, id: string): boolean {
  const o = d.offices.find((x) => x.id === id);
  if (!o || officeUse(d, id).clients > 0) return false;
  d.offices = d.offices.filter((x) => x.id !== id);
  for (const l of d.leads) if (l.officeId === id) delete l.officeId;
  if (!isLive()) for (const u of d.users) if (u.officeIds?.includes(id)) u.officeIds = u.officeIds.filter((x) => x !== id);
  if (d.offices.length && !d.offices.some((x) => x.main)) d.offices[0].main = true;
  auditSample(d, ctx.actor, 'office.removed', 'office', id, o.name);
  return true;
}

/* ---------- ordinary changes: roles and rules ---------- */

type EditableRole = Exclude<OfficeRole, 'owner'>;
/** Capabilities a read-only role can never be given: the database refuses the configuration otherwise. */
export const READONLY_NEVER: Permission[] = ['write', 'delete'];

/**
 * Sets what a role may do in this company. The owner's role cannot be changed, a read-only role never gets `write` or
 * `delete`, and only capabilities that exist are kept. When the list equals the edition's own, the company's override is
 * removed so the role follows the edition again.
 */
export function setRolePermissions(d: DemoState, ctx: Ctx, role: EditableRole, perms: Permission[]): Permission[] | null {
  if (!(['manager', 'staff', 'readonly'] as OfficeRole[]).includes(role)) return null;
  const known = ctx.pack.rolePermissions.owner;
  const want = new Set(perms.filter((p) => known.includes(p) && !(role === 'readonly' && READONLY_NEVER.includes(p))));
  const next = known.filter((p) => want.has(p));
  const before = permissionsOf(d, ctx.pack, role);
  const shipped = ctx.pack.rolePermissions[role];
  const same = (a: Permission[], b: Permission[]) => a.length === b.length && a.every((p) => b.includes(p));
  if (same(before, next)) return before;
  const roles = { ...(d.config.roles ?? {}) };
  if (same(shipped, next)) delete roles[role]; else roles[role] = next;
  const config: CompanyConfig = { ...d.config, roles };
  if (!Object.keys(roles).length) delete config.roles;
  d.config = config;
  const added = next.filter((p) => !before.includes(p)), removed = before.filter((p) => !next.includes(p));
  auditSample(d, ctx.actor, 'config.roles', 'role', role, [...added.map((p) => '+' + p), ...removed.map((p) => '-' + p)].join(' '));
  return next;
}
/** Puts a role back to how the edition ships it. */
export function resetRole(d: DemoState, ctx: Ctx, role: EditableRole): void {
  setRolePermissions(d, ctx, role, ctx.pack.rolePermissions[role]);
}
/** What the company calls a role. An empty name puts the edition's name back. */
export function setRoleLabel(d: DemoState, ctx: Ctx, role: OfficeRole, label: L10n | null): void {
  const roleLabels = { ...(d.config.roleLabels ?? {}) };
  const en = label?.en.trim() ?? '', es = label?.es.trim() ?? '';
  const shipped = ctx.pack.roleLabels[role];
  if (!en || (en === shipped.en && (es || shipped.es) === shipped.es)) delete roleLabels[role];
  else roleLabels[role] = { en: en.slice(0, 40), es: (es || en).slice(0, 40), ...(label?.zh?.trim() ? { zh: label.zh.trim().slice(0, 40) } : {}) };
  const config: CompanyConfig = { ...d.config, roleLabels };
  if (!Object.keys(roleLabels).length) delete config.roleLabels;
  d.config = config;
  auditSample(d, ctx.actor, 'config.roleLabel', 'role', role, en || undefined);
}

/** Limits the server accepts for the idle timeout: five minutes to twelve hours. */
export const IDLE_MIN = 5, IDLE_MAX = 720;
/**
 * The company's sign-in rules: which roles must use the second step and when an idle session ends. `fixed` are the roles
 * the deployment itself requires; a company can add to them and never remove one.
 */
export function setSecurityRules(d: DemoState, ctx: Ctx, rules: { idleMinutes: number; mfaRoles: OfficeRole[] }, fixed: OfficeRole[] = []): void {
  const idle = Math.min(IDLE_MAX, Math.max(IDLE_MIN, Math.round(Number(rules.idleMinutes) || 30)));
  const mfaRoles = OFFICE_ROLES.filter((r) => rules.mfaRoles.includes(r) || fixed.includes(r));
  d.config = { ...d.config, security: { idleMinutes: idle, mfaRoles } };
  auditSample(d, ctx.actor, 'config.security', 'company', undefined, `${idle} min · ${mfaRoles.join(', ') || 'none'}`);
}
/** How a tax ID reveal is approved and how long the value stays on screen (15 seconds to 5 minutes). */
export function setVaultRules(d: DemoState, ctx: Ctx, rules: { approval: 'second_person' | 'step_up'; revealSeconds: number }): void {
  const seconds = Math.min(300, Math.max(15, Math.round(Number(rules.revealSeconds) || 60)));
  const approval = rules.approval === 'step_up' ? 'step_up' : 'second_person';
  d.config = { ...d.config, vault: { approval, revealSeconds: seconds } };
  auditSample(d, ctx.actor, 'config.vault', 'company', undefined, `${approval} · ${seconds} s`);
}
/** How many people could approve someone else's request: the two-person rule needs at least two people in the picture. */
export function approversFor(d: DemoState, pack: Ctx['pack'], exceptUserId?: string): TeamUser[] {
  return d.users.filter((u) => u.active !== false && u.id !== exceptUserId && permissionsOf(d, pack, u.role).includes('secureApprove'));
}

/* ---------- the audit trail of a sample workspace ---------- */

/** One line of the trail as the audit screen and the audit export read it. `activity` is set for a line that came from the business history. */
export interface AuditRow extends AuditEntry { activity?: Activity }
/**
 * The audit trail, newest first. A live workspace has the database's own log, which records every change by itself. A sample
 * workspace has what the protected operations wrote (`data.audit`) plus the business history (`data.activity`: a lead
 * created, a payment recorded, a document sent), so the reviewer sees what a real trail holds: who, what, which record, when.
 */
export function auditRows(d: Pick<DemoState, 'audit' | 'activity'>): AuditRow[] {
  const rows: AuditRow[] = [...d.audit];
  if (!isLive()) for (const a of d.activity) rows.push({ id: 'act-' + a.id, at: a.at, by: a.by, action: 'activity.' + a.kind, entity: a.ref.type, entityId: a.ref.id, activity: a });
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

/* ---------- exports ---------- */

type Cell = string | number | boolean | null | undefined;
function csvCell(v: Cell): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // a spreadsheet would run text that starts with one of these as a formula
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const csv = (head: string[], rows: Cell[][]): string => [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
/** What a person must be able to see before they can take it out as a file. */
const EXPORT_NEEDS: Record<ExportKind, Permission> = { clients: 'clients', leads: 'leads', jobs: 'jobs', tasks: 'tasks', payments: 'money', appointments: 'appointments', audit: 'audit' };

/**
 * A file of records to download. Needs `export` and the capability to see that kind of record; the person gets only the
 * clients their office may see. A tax ID is never part of an export, not even its type or last four digits. Every export
 * is written to the audit trail.
 */
export function exportRequest(d: DemoState, ctx: Ctx, kind: ExportKind): Res<ExportFile> {
  const w = who(d, ctx);
  if (!(kind in EXPORT_NEEDS)) return no('invalid');
  if (!w.can('export', EXPORT_NEEDS[kind])) return no('not_allowed');
  const seen = visibleClientIds(d, w.user, w.perms);
  const mine = (clientId?: string) => !clientId || seen.has(clientId);
  const name = (id?: string) => d.clients.find((c) => c.id === id)?.name ?? '';
  const person = (id?: string) => d.users.find((u) => u.id === id)?.name ?? id ?? '';
  const money = w.can('money');
  const build: Record<ExportKind, () => [string[], Cell[][]]> = {
    clients: () => [['name', 'company', 'phone', 'email', 'address', 'client since', 'type', 'office'],
      d.clients.filter((c) => seen.has(c.id)).map((c) => [c.name, c.company, c.phone, c.email, c.addresses[0], c.since, c.clientType, d.offices.find((o) => o.id === c.officeId)?.name])],
    leads: () => [['ticket', 'name', 'company', 'phone', 'email', 'stage', 'source', 'value', 'created', 'owner'],
      visibleLeads(d, w.user, w.perms).map((l) => [l.ticket, l.name, l.company, l.phone, l.email, l.status, l.source, l.value, l.created, person(l.ownerId)])],
    jobs: () => [['number', 'name', 'client', 'status', ...(money ? ['price'] : []), 'start', 'end'],
      d.jobs.filter((j) => mine(j.clientId)).map((j) => [j.number, j.name, name(j.clientId), j.status, ...(money ? [j.price] : []), j.start, j.end])],
    tasks: () => [['title', 'status', 'priority', 'due', 'client'], d.tasks.filter((x) => mine(x.clientId)).map((x) => [x.title, x.status, x.pri, x.due, name(x.clientId)])],
    payments: () => [['date', 'client', 'job', 'method', 'reference', 'amount'],
      d.jobs.filter((j) => mine(j.clientId)).flatMap((j) => j.received.map((r): Cell[] => [r.date, name(j.clientId), j.name, r.method, r.ref, r.amount]))],
    appointments: () => [['date', 'time', 'client', 'with', 'status', 'fee'], d.appointments.filter((a) => mine(a.clientId)).map((a) => [a.date, a.time, name(a.clientId), person(a.staffId), a.status, a.fee])],
    audit: () => [['when', 'who', 'action', 'record type', 'record', 'detail'], auditRows(d).map((a) => [a.at, person(a.by), a.action, a.entity, a.entityId, a.summary])],
  };
  const [head, rows] = build[kind]();
  const file: ExportFile = { fileName: `${kind}-${today()}.csv`, mime: 'text/csv;charset=utf-8', content: '\uFEFF' + csv(head, rows) };
  auditSample(d, w.id, 'export.' + kind, 'export', undefined, `${file.fileName} · ${rows.length}`);
  return yes(file);
}

/** The rules of the protected operations, for the sample workspace (src/platform/sample.ts) and the unit tests. */
export const rules = { vaultSet, vaultRequest, vaultDecide, vaultReveal, vaultCopied, memberInvite, memberSetRole, memberDisable, memberEnable, inviteResend, inviteRevoke, grantDecide, grantRevoke, exportRequest, sweepReveals };
