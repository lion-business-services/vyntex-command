// Business actions for Messages. In demo mode an email is only ever prepared or marked as "sent in the demo":
// nothing leaves the browser.
import type { DemoState, Message, Ref } from '@/domain/types';
import { type Ctx, logActivity } from '@/domain/context';
import { nowIso } from '@/lib/dates';
import { uid } from '@/lib/id';

export interface MessageInput { to: string; subject: string; body: string; ref: Ref }

const also = (d: DemoState, ref: Ref): Ref[] | undefined => {
  if (ref.type !== 'job') return undefined;
  const j = d.jobs.find((x) => x.id === ref.id);
  return j ? [{ type: 'client', id: j.clientId }] : undefined;
};

/** Prepares an email for review (status `draft`). */
export function composeMessage(d: DemoState, ctx: Ctx, input: MessageInput): Message {
  const m: Message = { id: uid('m'), at: nowIso(), channel: 'email', to: input.to.trim(), subject: input.subject.trim(), body: input.body.trim(), status: 'draft', ref: input.ref };
  d.messages.unshift(m);
  logActivity(d, ctx.actor, 'message.drafted', input.ref, { subject: m.subject }, also(d, input.ref));
  return m;
}
export function updateMessage(d: DemoState, _ctx: Ctx, id: string, patch: Pick<Message, 'to' | 'subject' | 'body'>) {
  const m = d.messages.find((x) => x.id === id); if (!m || m.status !== 'draft') return;
  m.to = patch.to.trim(); m.subject = patch.subject.trim(); m.body = patch.body.trim();
}
/** Demo "send": the message is marked as sent in this demo and stamped with the time. No email goes out. */
export function sendMessageDemo(d: DemoState, ctx: Ctx, id: string) {
  const m = d.messages.find((x) => x.id === id); if (!m || m.status === 'demo') return;
  m.status = 'demo'; m.at = nowIso();
  logActivity(d, ctx.actor, 'message.demoSent', m.ref, { subject: m.subject }, also(d, m.ref));
}
export function discardMessage(d: DemoState, _ctx: Ctx, id: string) { d.messages = d.messages.filter((m) => m.id !== id); }
