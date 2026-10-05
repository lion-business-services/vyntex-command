// Who may see which client. Ported from the office rule of the earlier internal system:
//   a client without an office is visible to everyone in the company;
//   a client with an office is visible to the people of that office, to anyone who may see all clients,
//   and to a person who was granted access to that one client.
// Everyone else sees the name only and can ask for access. The database applies the same rule to what it returns
// (app.ws_load), so in live mode hidden clients never reach the browser; this file is what the sample workspace uses
// and what the screens call so both modes read the same.
import type { AccessRequest, Client, DemoState, Lead, TeamUser } from './types';
import type { Permission } from './permissions';
import { today } from '@/lib/dates';

type Scope = Pick<DemoState, 'grants'>;

/** A grant that has not run out. */
const granted = (d: Scope, userId: string, clientId: string): boolean =>
  (d.grants ?? []).some((g) => g.userId === userId && g.clientId === clientId && (!g.expires || g.expires >= today()));

export function canSeeClient(d: Scope, user: TeamUser | undefined, perms: Permission[], c: Client): boolean {
  if (!c.officeId) return true;
  if (perms.includes('allClients')) return true;
  if (!user) return false;
  if (user.officeIds?.includes(c.officeId)) return true;
  return granted(d, user.id, c.id);
}

/** The clients this person may open. */
export function visibleClients(d: Pick<DemoState, 'clients' | 'grants'>, user: TeamUser | undefined, perms: Permission[]): Client[] {
  if (perms.includes('allClients')) return d.clients;
  return d.clients.filter((c) => canSeeClient(d, user, perms, c));
}

export interface HiddenClient { id: string; name: string; officeId: string; /** The person's own request for this client, when one is waiting or was decided. */ request?: AccessRequest }
/** Clients of other offices: the name and the office only, so the person can ask for access. Nothing else about them is shown. */
export function hiddenClients(d: Pick<DemoState, 'clients' | 'grants' | 'accessRequests'>, user: TeamUser | undefined, perms: Permission[]): HiddenClient[] {
  if (perms.includes('allClients')) return [];
  return d.clients.filter((c) => !canSeeClient(d, user, perms, c)).map((c) => ({
    id: c.id, name: c.name, officeId: c.officeId as string,
    request: user ? [...(d.accessRequests ?? [])].reverse().find((r) => r.userId === user.id && r.clientId === c.id) : undefined,
  }));
}

/** A lead follows the same rule; the person who owns the lead always sees it. */
export function canSeeLead(user: TeamUser | undefined, perms: Permission[], l: Lead): boolean {
  if (!l.officeId || perms.includes('allClients')) return true;
  if (!user) return false;
  return l.ownerId === user.id || !!user.officeIds?.includes(l.officeId);
}
export const visibleLeads = (d: Pick<DemoState, 'leads'>, user: TeamUser | undefined, perms: Permission[]): Lead[] =>
  (perms.includes('allClients') ? d.leads : d.leads.filter((l) => canSeeLead(user, perms, l)));
/** How many leads belong to other offices, so the list can say that it is not showing everything. Nothing about them is shown. */
export const hiddenLeadCount = (d: Pick<DemoState, 'leads'>, user: TeamUser | undefined, perms: Permission[]): number =>
  (perms.includes('allClients') ? 0 : d.leads.reduce((n, l) => n + (canSeeLead(user, perms, l) ? 0 : 1), 0));

/**
 * Where a person stands with a client they cannot open: nothing asked yet, a request waiting, or a request that was turned
 * down. An approved request needs no state of its own: the grant that came with it makes the client visible.
 */
export type AccessState = 'none' | 'pending' | 'denied';
export function accessState(d: Pick<DemoState, 'accessRequests'>, user: TeamUser | undefined, clientId: string): { state: AccessState; request?: AccessRequest } {
  if (!user) return { state: 'none' };
  const request = [...(d.accessRequests ?? [])].reverse().find((r) => r.userId === user.id && r.clientId === clientId);
  return request && request.status !== 'approved' ? { state: request.status, request } : { state: 'none' };
}
/** The offices a person may file a new client or lead under: every office for someone who sees all clients, their own otherwise. */
export function officesFor(d: Pick<DemoState, 'offices'>, user: TeamUser | undefined, perms: Permission[]): DemoState['offices'] {
  if (perms.includes('allClients')) return d.offices;
  return d.offices.filter((o) => !!user?.officeIds?.includes(o.id));
}

/** Ids of the clients a person may open, for filtering work that belongs to a client (engagements, documents, tasks). */
export const visibleClientIds = (d: Pick<DemoState, 'clients' | 'grants'>, user: TeamUser | undefined, perms: Permission[]): Set<string> =>
  new Set(visibleClients(d, user, perms).map((c) => c.id));
