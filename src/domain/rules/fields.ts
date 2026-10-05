// The field catalogue of the rule engine: for each event, which records come with it and which of their fields a
// condition may test. The Automations screen builds its pickers from this list and the engine reads values through
// `readField`, so the two can never disagree about what a field is called.
//
// Wording is a dictionary key, never text, so the edition's own words apply ("engagement" in the practice edition).
// Keys: `auto.ev.<event>` (the event as the start of a sentence), `auto.f.<path>` (a field), `auto.op.<operator>`.
import type { DemoState, Lang, Ref, RuleCond, RuleEvent } from '../types';
import type { IndustryPack } from '@/packs/types';
import type { TFn } from '@/i18n';
import { clientTypesOf, lostReasonsOf, sourcesOf, stagesOf, taskTypesOf } from '../config';
import type { RuleSubject } from './engine';

/**
 * Events the engine knows that the data model's `RuleEvent` list does not name yet. They behave like any other event;
 * the cast lives in `ev()` below so it is in one place until the list in types.ts is extended.
 *   appointment.soon     an appointment is coming up (the day before by default)
 *   appointment.pay_soon the pay-by moment of a prepaid appointment is less than a day away and it is still unpaid
 *   opportunity.created  a cross-sell opportunity was opened for a client
 *   credit.expiring      a client credit is about to run out
 */
export type ExtraEvent = 'appointment.soon' | 'appointment.pay_soon' | 'opportunity.created' | 'credit.expiring';
export type EngineEvent = RuleEvent | ExtraEvent;
export const ev = (e: EngineEvent): RuleEvent => e as RuleEvent;

export type SubjectKind = 'lead' | 'client' | 'job' | 'appointment' | 'task' | 'doc' | 'envelope' | 'message' | 'payment';
export type FieldType = 'text' | 'number' | 'bool' | 'enum' | 'list' | 'person';
export interface FieldOption { id: string; label: string }
export interface FieldDef {
  /** `lead.source`, `job.price`, `extra.days`. */
  path: string;
  type: FieldType;
  /** Choices for an `enum`, `list` or `person` field, read from the company's own configuration. */
  options?: (d: DemoState, pack: IndustryPack, t: TFn, lang: Lang) => FieldOption[];
}
export type EventGroup = 'lead' | 'client' | 'job' | 'money' | 'appointment' | 'task' | 'document' | 'message' | 'time';
export interface EventDef {
  id: EngineEvent;
  group: EventGroup;
  /** Records that come with the event, the main one first. */
  subjects: SubjectKind[];
  /**
   * Set for events the daily run produces by counting days. `after`: the rule waits until at least that many days have
   * passed (idle, overdue). `before`: the rule runs once the date is that many days away or closer (a deadline, a birthday).
   */
  days?: { dir: 'after' | 'before'; default: number };
  /** Fields carried in `subject.extra` for this event. */
  extra?: FieldDef[];
  /** Editions that have the records this event is about. Missing means every edition. */
  family?: 'practice' | 'field';
}

const users = (d: DemoState): FieldOption[] => d.users.filter((u) => u.active !== false).map((u) => ({ id: u.id, label: u.name }));
const offices = (d: DemoState): FieldOption[] => (d.offices ?? []).map((o) => ({ id: o.id, label: o.name }));
const keys = (prefix: string, ids: string[]) => (_d: DemoState, _p: IndustryPack, t: TFn): FieldOption[] => ids.map((id) => ({ id, label: t(prefix + id) }));
const LANGS = (_d: DemoState, _p: IndustryPack, t: TFn): FieldOption[] => ['en', 'es', 'zh'].map((id) => ({ id, label: t('auto.lang.' + id) }));
const KINDS = keys('auto.kind.', ['individual', 'business']);
const PRI = keys('pr.', ['high', 'medium', 'low']);
const services = (_d: DemoState, p: IndustryPack, t: TFn): FieldOption[] => p.serviceTypes.map((s) => ({ id: s.id, label: t('ty_' + s.id) }));
const catalog = (d: DemoState): FieldOption[] => (d.catalog ?? []).map((s) => ({ id: s.id, label: s.name }));

/** Fields of each kind of record. The path is the record's key in the subject plus the property name. */
const RECORD_FIELDS: Record<SubjectKind, FieldDef[]> = {
  lead: [
    { path: 'lead.source', type: 'enum', options: (d, p, t) => sourcesOf(d, p).map((s) => ({ id: s.id, label: t('src_' + s.id) })) },
    { path: 'lead.status', type: 'enum', options: (d, p, t) => stagesOf(d, p).map((s) => ({ id: s.id, label: t('ls_' + s.id) })) },
    { path: 'lead.type', type: 'enum', options: services },
    { path: 'lead.serviceIds', type: 'list', options: catalog },
    { path: 'lead.pri', type: 'enum', options: PRI },
    { path: 'lead.value', type: 'number' },
    { path: 'lead.kind', type: 'enum', options: KINDS },
    { path: 'lead.ownerId', type: 'person', options: users },
    { path: 'lead.officeId', type: 'enum', options: offices },
    { path: 'lead.lang', type: 'enum', options: LANGS },
    { path: 'lead.company', type: 'text' },
    { path: 'lead.email', type: 'text' },
    { path: 'lead.phone', type: 'text' },
    { path: 'lead.smsOptIn', type: 'bool' },
    { path: 'lead.lostReason', type: 'enum', options: (d, p, t) => lostReasonsOf(d, p).map((s) => ({ id: s.id, label: t('lr_' + s.id) })) },
  ],
  client: [
    { path: 'client.kind', type: 'enum', options: KINDS },
    { path: 'client.clientType', type: 'enum', options: (d, p, t) => clientTypesOf(d, p).map((s) => ({ id: s.id, label: t('ct_' + s.id) })) },
    { path: 'client.tags', type: 'list' },
    { path: 'client.lang', type: 'enum', options: LANGS },
    { path: 'client.officeId', type: 'enum', options: offices },
    { path: 'client.assignedTo', type: 'person', options: users },
    { path: 'client.lifecycle', type: 'enum', options: keys('auto.life.', ['active', 'inactive', 'former']) },
    { path: 'client.emailOptOut', type: 'bool' },
    { path: 'client.smsOptIn', type: 'bool' },
    { path: 'client.whatsappOptIn', type: 'bool' },
    { path: 'client.email', type: 'text' },
    { path: 'client.company', type: 'text' },
    { path: 'client.referredBy', type: 'text' },
  ],
  job: [
    { path: 'job.status', type: 'enum', options: (_d, p, t) => p.jobStatuses.map((s) => ({ id: s, label: t('st_' + s) })) },
    { path: 'job.type', type: 'enum', options: services },
    { path: 'job.serviceId', type: 'enum', options: catalog },
    { path: 'job.price', type: 'number' },
    { path: 'job.repeat', type: 'enum', options: keys('auto.rp.', ['once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']) },
    { path: 'job.managerId', type: 'person', options: users },
    { path: 'job.officeId', type: 'enum', options: offices },
  ],
  appointment: [
    { path: 'appointment.typeId', type: 'enum', options: (d, _p, _t, lang) => (d.apptTypes ?? []).map((a) => ({ id: a.id, label: a.name[lang] ?? a.name.en })) },
    { path: 'appointment.mode', type: 'enum', options: keys('auto.mode.', ['office', 'phone', 'video']) },
    { path: 'appointment.status', type: 'enum', options: keys('auto.appt.', ['requested', 'scheduled', 'awaiting_payment', 'confirmed', 'completed', 'no_show', 'cancelled_unpaid', 'cancelled_client', 'cancelled_staff']) },
    { path: 'appointment.fee', type: 'number' },
    { path: 'appointment.staffId', type: 'person', options: users },
    { path: 'appointment.officeId', type: 'enum', options: offices },
  ],
  task: [
    { path: 'task.type', type: 'enum', options: (d, p, t) => taskTypesOf(d, p).map((s) => ({ id: s.id, label: t('tt_' + s.id) })) },
    { path: 'task.pri', type: 'enum', options: PRI },
    { path: 'task.status', type: 'enum', options: keys('ts.', ['todo', 'doing', 'waiting', 'review']) },
    { path: 'task.assignee', type: 'person', options: (d) => users(d).map((u) => ({ id: 'u:' + u.id, label: u.label })) },
  ],
  doc: [
    { path: 'doc.kind', type: 'enum', options: (_d, p, t) => p.docKinds.map((k) => ({ id: k, label: t('doc.kind.' + k) })) },
    { path: 'doc.status', type: 'enum', options: keys('doc.status.', ['draft', 'sent', 'viewed', 'signed', 'paid', 'void']) },
  ],
  envelope: [
    { path: 'envelope.status', type: 'enum', options: keys('auto.env.', ['sent', 'partly_signed', 'completed', 'declined', 'expired']) },
  ],
  message: [
    { path: 'message.channel', type: 'enum', options: keys('auto.ch.', ['email', 'text', 'whatsapp', 'facebook', 'instagram', 'call']) },
  ],
  payment: [
    { path: 'payment.amount', type: 'number' },
    { path: 'payment.method', type: 'enum', options: keys('m_', ['cash', 'check', 'transfer', 'zelle', 'card']) },
  ],
};

const DAYS: FieldDef = { path: 'extra.days', type: 'number' };
const BALANCE: FieldDef = { path: 'extra.balance', type: 'number' };
const stageField = (path: string): FieldDef => ({ path, type: 'enum', options: (d, p, t) => stagesOf(d, p).map((s) => ({ id: s.id, label: t('ls_' + s.id) })) });
const statusField = (path: string): FieldDef => ({ path, type: 'enum', options: (_d, p, t) => p.jobStatuses.map((s) => ({ id: s, label: t('st_' + s) })) });

/** Every event a rule can start from, in the order the builder lists them. */
export const EVENTS: EventDef[] = [
  { id: 'lead.created', group: 'lead', subjects: ['lead'] },
  { id: 'lead.stage', group: 'lead', subjects: ['lead'], extra: [stageField('extra.to'), stageField('extra.from')] },
  { id: 'lead.won', group: 'lead', subjects: ['lead', 'client', 'job'] },
  { id: 'lead.lost', group: 'lead', subjects: ['lead'] },
  { id: 'lead.idle', group: 'lead', subjects: ['lead'], days: { dir: 'after', default: 3 }, extra: [DAYS] },
  { id: 'client.created', group: 'client', subjects: ['client'] },
  { id: 'client.birthday', group: 'client', subjects: ['client'], days: { dir: 'before', default: 0 }, extra: [DAYS] },
  { id: 'job.created', group: 'job', subjects: ['job', 'client'] },
  { id: 'job.status', group: 'job', subjects: ['job', 'client'], extra: [statusField('extra.to'), statusField('extra.from')] },
  { id: 'job.completed', group: 'job', subjects: ['job', 'client'], extra: [BALANCE] },
  { id: 'review.due', group: 'job', subjects: ['job', 'client'], days: { dir: 'after', default: 3 }, extra: [DAYS] },
  { id: 'opportunity.created', group: 'client', subjects: ['client'], extra: [{ path: 'extra.serviceId', type: 'enum', options: catalog }], family: 'practice' },
  { id: 'payment.received', group: 'money', subjects: ['payment', 'job', 'client'], extra: [BALANCE] },
  { id: 'appointment.booked', group: 'appointment', subjects: ['appointment', 'client', 'lead'], family: 'practice' },
  { id: 'appointment.soon', group: 'appointment', subjects: ['appointment', 'client', 'lead'], days: { dir: 'before', default: 1 }, extra: [DAYS], family: 'practice' },
  { id: 'appointment.pay_soon', group: 'appointment', subjects: ['appointment', 'client', 'lead'], extra: [{ path: 'extra.hoursLeft', type: 'number' }], family: 'practice' },
  // announced by the appointments module when the pay-by moment passed and the slot was released
  { id: 'appointment.unpaid', group: 'appointment', subjects: ['appointment', 'client', 'lead'], family: 'practice' },
  { id: 'appointment.paid', group: 'appointment', subjects: ['appointment', 'client', 'lead'], family: 'practice' },
  { id: 'appointment.completed', group: 'appointment', subjects: ['appointment', 'client', 'lead'], family: 'practice' },
  { id: 'appointment.no_show', group: 'appointment', subjects: ['appointment', 'client', 'lead'], extra: [{ path: 'extra.noShows', type: 'number' }], family: 'practice' },
  { id: 'appointment.cancelled', group: 'appointment', subjects: ['appointment', 'client', 'lead'], family: 'practice' },
  { id: 'credit.expiring', group: 'money', subjects: ['client'], days: { dir: 'before', default: 14 }, extra: [DAYS, { path: 'extra.amount', type: 'number' }], family: 'practice' },
  { id: 'task.overdue', group: 'task', subjects: ['task', 'client', 'job', 'lead'], days: { dir: 'after', default: 2 }, extra: [DAYS] },
  { id: 'deadline.near', group: 'task', subjects: ['client', 'job'], days: { dir: 'before', default: 14 }, extra: [DAYS, { path: 'extra.kind', type: 'enum', options: keys('auto.dl.', ['filing', 'license', 'renewal', 'deadline', 'insurance', 'other']) }], family: 'practice' },
  { id: 'doc.sent', group: 'document', subjects: ['doc', 'client', 'job'] },
  // announced by the e-signature sweep when a request's own reminder interval has passed
  { id: 'envelope.idle', group: 'document', subjects: ['envelope', 'doc', 'client'], family: 'practice' },
  { id: 'envelope.completed', group: 'document', subjects: ['envelope', 'doc', 'client'], family: 'practice' },
  { id: 'message.received', group: 'message', subjects: ['message', 'client'], family: 'practice' },
  { id: 'worker.document', group: 'time', subjects: [], family: 'field' },
  { id: 'daily', group: 'time', subjects: [] },
];
export const eventDef = (id: EngineEvent | string): EventDef | undefined => EVENTS.find((e) => e.id === id);
/** The events an edition can use: one about appointments means nothing where there are none. */
export const eventsFor = (pack: IndustryPack): EventDef[] => EVENTS.filter((e) => !e.family || e.family === pack.family);

/** Every field a condition on this event may test: the fields of the records that come with it, then the event's own. */
export function fieldsFor(event: EngineEvent | string): FieldDef[] {
  const def = eventDef(event); if (!def) return [];
  return [...def.subjects.flatMap((k) => RECORD_FIELDS[k]), ...(def.extra ?? [])];
}
export const fieldDef = (event: EngineEvent | string, path: string): FieldDef | undefined => fieldsFor(event).find((f) => f.path === path);

/** Which comparisons make sense for each kind of field. The builder offers exactly these. */
export const OPERATORS: Record<FieldType, RuleCond['op'][]> = {
  text: ['is', 'is_not', 'has', 'empty', 'not_empty'],
  number: ['gt', 'lt', 'is', 'empty', 'not_empty'],
  bool: ['is'],
  enum: ['is', 'is_not', 'in', 'empty', 'not_empty'],
  list: ['has', 'empty', 'not_empty'],
  person: ['is', 'is_not', 'in', 'empty', 'not_empty'],
};
/** Operators that take no value. */
export const NO_VALUE: RuleCond['op'][] = ['empty', 'not_empty'];

/** The value of a field for the records an event came with. Undefined when the record or the field is not there. */
export function readField(subject: RuleSubject, path: string): unknown {
  const dot = path.indexOf('.'); if (dot < 0) return undefined;
  const holder = (subject as unknown as Record<string, Record<string, unknown> | undefined>)[path.slice(0, dot)];
  return holder ? holder[path.slice(dot + 1)] : undefined;
}

/** The record an event is mainly about, as a reference the run history can link to. */
export function mainRef(subject: RuleSubject): Ref | undefined {
  if (subject.ref) return subject.ref;
  if (subject.appointment) return { type: 'appointment', id: subject.appointment.id };
  if (subject.envelope) return { type: 'envelope', id: subject.envelope.id };
  if (subject.task) return { type: 'task', id: subject.task.id };
  if (subject.job) return { type: 'job', id: subject.job.id };
  if (subject.lead) return { type: 'lead', id: subject.lead.id };
  if (subject.doc) return { type: 'doc', id: subject.doc.id };
  if (subject.client) return { type: 'client', id: subject.client.id };
  return undefined;
}
