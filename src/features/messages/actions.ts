// The actions the list of prepared emails has always used, kept under their names because other modules call them
// (Documents prepares its "email to client" with `composeMessage`). Each one now goes through the one function that
// decides what may be written to a client, `queueMessage` in src/domain/actions/messages.ts, so the same rules apply
// whoever asks. In a sample workspace an email is only ever prepared or marked as sent: nothing leaves the browser.
import type { DemoState, Message, Ref } from '@/domain/types';
import type { Ctx } from '@/domain/context';
import { discardDraft, queueMessage, sendDraft, updateDraft } from '@/domain/actions/messages';
import { nowIso } from '@/lib/dates';
import { uid } from '@/lib/id';

export interface MessageInput { to: string; subject: string; body: string; ref: Ref }

/**
 * Prepares an email for review (status `draft`). A person is writing it, so it may be saved before the address is known
 * and to a client who opted out of the automatic emails; both are asked about again when it is sent.
 */
export function composeMessage(d: DemoState, ctx: Ctx, input: MessageInput): Message {
  const out = queueMessage(d, ctx, { channel: 'email', ...input, mode: 'draft', personal: true });
  if (out.ok) return out.message;
  // Email is switched off for this company. Callers have always received a message back, so they still do: it is kept as
  // a draft that cannot be sent until the channel is on again.
  const m: Message = { id: uid('m'), at: nowIso(), channel: 'email', to: input.to.trim(), subject: input.subject.trim(), body: input.body.trim(), status: 'draft', ref: input.ref, by: ctx.actor };
  d.messages.unshift(m);
  return m;
}
export function updateMessage(d: DemoState, ctx: Ctx, id: string, patch: Pick<Message, 'to' | 'subject' | 'body'>) { updateDraft(d, ctx, id, patch); }
/** Sample "send": the message is marked as sent in this sample workspace and stamped with the time. No email goes out. */
export function sendMessageDemo(d: DemoState, ctx: Ctx, id: string) { return sendDraft(d, ctx, id); }
export function discardMessage(d: DemoState, ctx: Ctx, id: string) { discardDraft(d, ctx, id); }
