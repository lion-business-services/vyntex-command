// Client changes that the shared actions do not cover yet. Same signature as src/domain/actions.ts.
import type { DemoState } from '@/domain/types';
import { type Ctx, logActivity } from '@/domain/context';

/** Records whether a client wants the automatic service emails. The automation rules read `emailOptOut` before preparing an email. */
export function setEmailOptOut(d: DemoState, ctx: Ctx, id: string, optOut: boolean) {
  const c = d.clients.find((x) => x.id === id);
  if (!c || !!c.emailOptOut === optOut) return;
  c.emailOptOut = optOut || undefined;
  logActivity(d, ctx.actor, optOut ? 'client.emailsOff' : 'client.emailsOn', { type: 'client', id });
}

/** Removes a client that has no jobs. Returns false (and changes nothing) when there is work on record for them. */
export function deleteClient(d: DemoState, _ctx: Ctx, id: string): boolean {
  if (d.jobs.some((j) => j.clientId === id)) return false;
  d.clients = d.clients.filter((c) => c.id !== id);
  for (const l of d.leads) if (l.clientId === id) l.clientId = undefined;
  for (const t of d.tasks) if (t.clientId === id) t.clientId = undefined;
  return true;
}
