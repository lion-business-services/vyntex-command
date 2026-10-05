// What a lead needs right now, worked out from its records: the next step and whether it is late or missing, when the
// person was last contacted, and how long the lead has been waiting. The list, the board and the lead page all read these,
// so they can never disagree. No React here.
import type { DemoState, ISODate, ISODateTime, Lead } from '@/domain/types';
import type { IndustryPack } from '@/packs/types';
import { isHot, isOpen } from '@/domain/config';
import { isContactNote } from '@/domain/actions/clients';
import { daysBetween, today, toISODate } from '@/lib/dates';

/** A lead nobody has spoken to for this many days counts as going cold. The rule of the office's earlier system. */
export const STALE_DAYS = 7;

/** Latest message to or from each lead. A draft is not a contact: nothing was said yet. */
export function messageContacts(d: Pick<DemoState, 'messages'>): Map<string, ISODateTime> {
  const out = new Map<string, ISODateTime>();
  for (const m of d.messages ?? []) {
    if (m.ref.type !== 'lead' || m.status === 'draft' || m.status === 'failed' || m.channel === 'system') continue;
    const had = out.get(m.ref.id);
    if (!had || m.at > had) out.set(m.ref.id, m.at);
  }
  return out;
}
/**
 * When the person was last contacted: the latest of the stamp on the lead, a note of a call, visit, text or email, and a
 * message. Undefined when nobody has been in touch yet.
 */
export function lastContactOf(l: Lead, messages?: Map<string, ISODateTime>): ISODateTime | undefined {
  let last = l.lastContact;
  for (const n of l.notes) if (isContactNote(n.kind) && (!last || n.at > last)) last = n.at;
  const msg = messages?.get(l.id);
  if (msg && (!last || msg > last)) last = msg;
  return last;
}

export interface NextStep {
  /** `action`: what the person wrote. `appt`: a visit or appointment. `follow`: a follow-up date. `none`: nothing is planned. */
  kind: 'action' | 'appt' | 'follow' | 'none';
  /** The written next action, when that is what drives the lead. */
  text?: string;
  due?: ISODate;
  time?: string;
  late: boolean;
  dueToday: boolean;
}
/**
 * The one thing that happens next. An office that writes down a next action is driven by it; a field business is driven
 * by the visit on the calendar, then the follow-up date, as it always was.
 */
export function nextStepOf(l: Lead, pack: IndustryPack): NextStep {
  const td = today();
  const action = (): NextStep | null => (l.nextAction?.text ? { kind: 'action', text: l.nextAction.text, due: l.nextAction.due, late: !!l.nextAction.due && l.nextAction.due < td, dueToday: l.nextAction.due === td } : null);
  const appt = (): NextStep | null => (l.apptDate && l.apptDate >= td ? { kind: 'appt', due: l.apptDate, time: l.apptTime, late: false, dueToday: l.apptDate === td } : null);
  const follow = (): NextStep | null => (l.followUp ? { kind: 'follow', due: l.followUp, late: l.followUp < td, dueToday: l.followUp === td } : null);
  const order = pack.family === 'practice' ? [action, appt, follow] : [appt, follow, action];
  for (const pick of order) { const step = pick(); if (step) return step; }
  return { kind: 'none', late: false, dueToday: false };
}

export interface LeadSignals {
  open: boolean;
  next: NextStep;
  lastContact?: ISODateTime;
  /** Whole days since the last contact, or since the lead came in when nobody has been in touch. */
  idle: number;
  /** Open, and nobody has been in touch for a week or more. */
  stale: boolean;
  /** In a stage the company counts as close to a decision. */
  hot: boolean;
  /** Open and either nothing is planned or what is planned is late: someone has to look at it. */
  attention: boolean;
}
export function leadSignals(d: Pick<DemoState, 'config'>, pack: IndustryPack, l: Lead, messages?: Map<string, ISODateTime>): LeadSignals {
  const open = isOpen(d, pack, l.status);
  const next = nextStepOf(l, pack);
  const lastContact = lastContactOf(l, messages);
  const since = lastContact ? toISODate(new Date(lastContact)) : l.created;
  const idle = Math.max(0, daysBetween(since, today()));
  return { open, next, lastContact, idle, stale: open && idle >= STALE_DAYS, hot: open && isHot(d, pack, l.status), attention: open && (next.kind === 'none' || next.late) };
}
