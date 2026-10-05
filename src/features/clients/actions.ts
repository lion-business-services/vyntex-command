// Client changes that the shared actions do not cover yet. Same signature as src/domain/actions.ts.
import type { Client, DemoState } from '@/domain/types';
import { type Ctx, logActivity } from '@/domain/context';

/** Records whether a client wants the automatic service emails. The automation rules read `emailOptOut` before preparing an email. */
export function setEmailOptOut(d: DemoState, ctx: Ctx, id: string, optOut: boolean) {
  const c = d.clients.find((x) => x.id === id);
  if (!c || !!c.emailOptOut === optOut) return;
  c.emailOptOut = optOut || undefined;
  logActivity(d, ctx.actor, optOut ? 'client.emailsOff' : 'client.emailsOn', { type: 'client', id });
}

/**
 * Records what a client said about text messages or WhatsApp: agreed (true), asked not to (false), or nobody asked yet
 * (undefined). Kept in the history, because whether someone agreed to be texted is a question that comes back.
 */
export function setChannelConsent(d: DemoState, ctx: Ctx, id: string, channel: 'text' | 'whatsapp', consent: boolean | undefined) {
  const c = d.clients.find((x) => x.id === id);
  if (!c) return;
  const key: keyof Pick<Client, 'smsOptIn' | 'whatsappOptIn'> = channel === 'text' ? 'smsOptIn' : 'whatsappOptIn';
  if (c[key] === consent) return;
  c[key] = consent;
  logActivity(d, ctx.actor, consent === true ? 'client.consentYes' : consent === false ? 'client.consentNo' : 'client.consentUnset', { type: 'client', id }, { channel: ctx.t('clients.ch.' + channel) });
}

/** Removes a client that has no jobs. Returns false (and changes nothing) when there is work on record for them. */
export function deleteClient(d: DemoState, _ctx: Ctx, id: string): boolean {
  if (d.jobs.some((j) => j.clientId === id)) return false;
  d.clients = d.clients.filter((c) => c.id !== id);
  for (const l of d.leads) if (l.clientId === id) l.clientId = undefined;
  for (const t of d.tasks) if (t.clientId === id) t.clientId = undefined;
  return true;
}
