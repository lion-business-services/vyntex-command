// THEN: the steps a rule can take, and how each one is carried out. Every step goes through the same business action a
// person would use (a task, a message through `queueMessage`, a document from a template, a playbook), so an automation
// can never do something a person could not, and opt-outs are respected in the one place that decides them.
//
// A step answers with the lines the run history shows and whether it did anything. A step that could not act for a
// plain reason (the client opted out, there is no address, the channel is not set up) is `skipped`, with the reason as
// its line. A step that breaks throws; the engine records the failure and carries on with the other rules.
import type { Client, DemoState, Lang, Lead, Message, MessageChannel, Opportunity, Priority, RuleStep, Task, TeamUser } from '../types';
import type { Ctx } from '../context';
import { stageOf, taskTypesOf } from '../config';
import { addDays, fmtDay, fmtTime, nowIso, today } from '@/lib/dates';
import { money2 } from '@/lib/money';
import { uid } from '@/lib/id';
import { queueMessage } from '../actions/messages';
import { createDocFromTemplate } from '../actions/documents';
import { startPlaybook } from '../actions/catalog';
import { assignNextLead, handoffLead, setLeadStage } from '../actions/leads';
import { setJobStatus } from '../actions/jobs';
import { requestReview } from '../actions/reviews';
import * as actions from '../actions';
import type { SubjectKind } from './fields';
import type { RuleSubject } from './engine';

export interface StepLine { key: string; params?: Record<string, string | number> }
export interface StepOutcome { lines: StepLine[]; /** False when the step had a plain reason not to act. */ did: boolean }
const done = (key: string, params?: StepLine['params']): StepOutcome => ({ lines: [{ key, params }], did: true });
const skipped = (key: string, params?: StepLine['params']): StepOutcome => ({ lines: [{ key, params }], did: false });

/** What a step is given: the workspace, who is acting, the records of the event and a stamp that is unique to this rule, record and step. */
export interface StepInput { d: DemoState; ctx: Ctx; subject: RuleSubject; /** Marks what the step creates, so the same occasion never creates it twice. */ stamp: string; ruleId: string }

/* ---------- the catalogue the builder reads ---------- */

export type StepKind = Exclude<RuleStep['do'], 'envelope' | 'appointment'>;
export type ParamType = 'text' | 'long' | 'days' | 'who' | 'assignTo' | 'pri' | 'taskType' | 'channel' | 'mode' | 'stage' | 'status' | 'docKind' | 'service' | 'tag';
export interface ParamDef { k: string; type: ParamType; req?: boolean; /** A second box for the Spanish wording, stored as `<k>Es`. */ es?: boolean }
export interface StepDef {
  do: StepKind;
  /** The step needs one of these records to come with the event. Empty: any event. */
  needs: SubjectKind[];
  params: ParamDef[];
}
/** Steps a person can add in the builder, in the order they are offered. `builtin` is not offered: it belongs to the shipped rules. */
export const STEPS: StepDef[] = [
  { do: 'task', needs: [], params: [{ k: 'title', type: 'text', req: true, es: true }, { k: 'for', type: 'who', req: true }, { k: 'dueIn', type: 'days' }, { k: 'pri', type: 'pri' }, { k: 'type', type: 'taskType' }] },
  { do: 'message', needs: ['client', 'lead'], params: [{ k: 'channel', type: 'channel', req: true }, { k: 'mode', type: 'mode', req: true }, { k: 'subject', type: 'text', es: true }, { k: 'body', type: 'long', req: true, es: true }] },
  { do: 'notify', needs: [], params: [{ k: 'who', type: 'who', req: true }, { k: 'text', type: 'text', req: true, es: true }] },
  { do: 'assign', needs: ['lead', 'job', 'client', 'task'], params: [{ k: 'to', type: 'assignTo', req: true }] },
  { do: 'stage', needs: ['lead', 'job'], params: [{ k: 'stage', type: 'stage' }, { k: 'status', type: 'status' }] },
  { do: 'document', needs: ['client'], params: [{ k: 'kind', type: 'docKind', req: true }] },
  { do: 'playbook', needs: ['job'], params: [] },
  { do: 'opportunity', needs: ['client'], params: [{ k: 'serviceId', type: 'service', req: true }, { k: 'note', type: 'text' }] },
  { do: 'review', needs: ['job', 'client'], params: [{ k: 'channel', type: 'channel', req: true }] },
  { do: 'tag', needs: ['client'], params: [{ k: 'tag', type: 'tag', req: true }] },
];
export const stepDef = (kind: string): StepDef | undefined => STEPS.find((s) => s.do === kind);
/** The steps that make sense for an event, given the records it comes with. */
export const stepsFor = (subjects: SubjectKind[]): StepDef[] => STEPS.filter((s) => !s.needs.length || s.needs.some((k) => subjects.includes(k)));
/** The first required setting a step is missing, or null when it is complete. A lead event needs `stage`, a job event `status`. */
export function stepProblem(step: RuleStep, subjects: SubjectKind[]): string | null {
  if (step.do === 'builtin') return null;
  const def = stepDef(step.do); if (!def) return 'do';
  for (const p of def.params) if (p.req && !String(step.params[p.k] ?? '').trim()) return p.k;
  if (step.do === 'stage') { const k = subjects.includes('lead') ? 'stage' : 'status'; if (!String(step.params[k] ?? '').trim()) return k; }
  if (step.do === 'message' && step.params.channel === 'email' && !String(step.params.subject ?? '').trim()) return 'subject';
  return null;
}

/* ---------- people ---------- */

const active = (d: DemoState, id: string | undefined): TeamUser | undefined => (id ? d.users.find((u) => u.id === id && u.active !== false) : undefined);
const ownerOf = (d: DemoState): TeamUser | undefined => d.users.find((u) => u.role === 'owner' && u.active !== false) ?? d.users[0];
/** The person responsible for the record the event is about. */
function recordOwner(d: DemoState, s: RuleSubject): TeamUser | undefined {
  const fromTask = s.task?.assignee?.startsWith('u:') ? s.task.assignee.slice(2) : undefined;
  // an emitter may name the person itself (a deadline has its own assignee)
  const named = typeof s.extra?.assignee === 'string' ? s.extra.assignee.replace(/^u:/, '') : undefined;
  return active(d, named) ?? active(d, s.appointment?.staffId) ?? active(d, fromTask) ?? active(d, s.job?.managerId) ?? active(d, s.lead?.ownerId) ?? active(d, s.client?.assignedTo);
}
function managerOf(d: DemoState, s: RuleSubject): TeamUser | undefined {
  const managers = d.users.filter((u) => u.role === 'manager' && u.active !== false);
  const office = s.job?.officeId ?? s.client?.officeId ?? s.lead?.officeId ?? s.appointment?.officeId;
  return managers.find((u) => !!office && u.officeIds?.includes(office)) ?? managers[0];
}
/** `owner`, `manager`, `record_owner` or `user:<id>`. Falls back to the owner, so a task is never left without a person. */
export function resolveWho(d: DemoState, s: RuleSubject, who: unknown): TeamUser | undefined {
  const w = String(who ?? 'owner');
  if (w.startsWith('user:')) return active(d, w.slice(5)) ?? ownerOf(d);
  if (w === 'manager') return managerOf(d, s) ?? ownerOf(d);
  if (w === 'record_owner') return recordOwner(d, s) ?? ownerOf(d);
  return ownerOf(d);
}

/* ---------- merge fields ---------- */

/** The person the event is about: the client, or the lead when there is no client yet. */
export const personOf = (s: RuleSubject): Client | Lead | undefined => s.client ?? s.lead;
const first = (name: string | undefined) => (name ?? '').trim().split(/\s+/)[0] ?? '';

/**
 * Fills `{{field}}` in a rule's wording from the records of the event. Fields: name, first_name, company (the business
 * running the workspace), client.name, client.company, lead.name, job.name, job.number, appointment.date,
 * appointment.time, task.title, doc.title, doc.number, owner (the person responsible), days, amount, balance, title,
 * service, today. A field that has no value becomes nothing, never a visible placeholder.
 */
export function mergeText(text: string, d: DemoState, s: RuleSubject, lang: Lang): string {
  const who = personOf(s); const x = s.extra ?? {};
  const values: Record<string, string> = {
    name: who?.name ?? '', first_name: first(who?.name), company: d.company.name,
    'client.name': s.client?.name ?? '', 'client.company': s.client?.company ?? '', 'lead.name': s.lead?.name ?? '',
    'job.name': s.job?.name ?? '', 'job.number': s.job?.number ?? '',
    'appointment.date': s.appointment ? fmtDay(s.appointment.date, lang) : '', 'appointment.time': s.appointment ? fmtTime(s.appointment.time, lang) : '',
    'task.title': s.task?.title ?? '', 'doc.title': s.doc?.title ?? s.envelope?.title ?? '', 'doc.number': s.doc?.number ?? '',
    owner: recordOwner(d, s)?.name ?? '', days: x.days === undefined ? '' : String(Math.abs(Number(x.days))),
    amount: s.payment ? money2(s.payment.amount) : typeof x.amount === 'number' ? money2(x.amount) : '', balance: typeof x.balance === 'number' ? money2(x.balance) : '',
    title: typeof x.title === 'string' ? x.title : '', service: typeof x.service === 'string' ? x.service : '', today: fmtDay(today(), lang),
  };
  return text.replace(/\{\{\s*([a-z_.]+)\s*\}\}/gi, (_m, k: string) => values[k.toLowerCase()] ?? '').replace(/[ \t]{2,}/g, ' ').trim();
}
/** The wording of a step in a language: `<k>Es` for Spanish when the rule has it, otherwise the main text. */
const say = (step: RuleStep, k: string, lang: Lang): string => String((lang === 'es' ? step.params[k + 'Es'] : undefined) || step.params[k] || '');

/* ---------- the steps ---------- */

const PRIS: Priority[] = ['high', 'medium', 'low'];

function task(step: RuleStep, { d, ctx, subject: s, stamp }: StepInput): StepOutcome {
  if (d.tasks.some((t) => t.auto === stamp)) return { lines: [], did: false };
  const who = resolveWho(d, s, step.params.for);
  const title = mergeText(say(step, 'title', ctx.lang), d, s, ctx.lang).slice(0, 160);
  if (!title) throw new Error('auto.err.noTitle');
  const type = String(step.params.type ?? '');
  const t: Task = {
    id: uid('t'), title, assignee: who ? 'u:' + who.id : '', due: addDays(Math.max(0, Number(step.params.dueIn) || 0)), status: 'todo',
    pri: PRIS.includes(step.params.pri as Priority) ? (step.params.pri as Priority) : 'medium', created: today(), auto: stamp,
    ...(s.job ? { jobId: s.job.id } : {}), ...(s.lead && !s.job ? { leadId: s.lead.id } : {}), ...(s.client ? { clientId: s.client.id } : s.job ? { clientId: s.job.clientId } : {}),
    ...(s.appointment ? { apptId: s.appointment.id } : {}), ...(type && taskTypesOf(d, ctx.pack).some((x) => x.id === type) ? { type } : {}),
  };
  d.tasks.unshift(t);
  return done('auto.step.task', { task: t.title });
}

const CHANNELS: MessageChannel[] = ['email', 'text', 'whatsapp'];
/** Where a message to this person goes on a channel, or why it cannot go. Text and WhatsApp need the person's opt-in. */
function addressOf(who: Client | Lead, channel: MessageChannel): { to: string } | { skip: string } {
  const c = who as Partial<Client> & Partial<Lead>;
  if (channel === 'email') return c.emailOptOut ? { skip: 'opted_out' } : c.email ? { to: c.email } : { skip: 'no_address' };
  if (channel === 'text') return !c.smsOptIn ? { skip: 'no_consent' } : c.phone ? { to: c.phone } : { skip: 'no_address' };
  return !c.whatsappOptIn ? { skip: 'no_consent' } : c.whatsapp || c.phone ? { to: (c.whatsapp || c.phone)! } : { skip: 'no_address' };
}
function message(step: RuleStep, { d, ctx, subject: s, stamp }: StepInput): StepOutcome {
  if (d.messages.some((m) => m.auto === stamp)) return { lines: [], did: false };
  const who = personOf(s); if (!who) return skipped('auto.skip.no_person');
  const channel = CHANNELS.includes(step.params.channel as MessageChannel) ? (step.params.channel as MessageChannel) : 'email';
  const where = addressOf(who, channel); if ('skip' in where) return skipped('auto.skip.' + where.skip, { who: who.name });
  // written in the person's own language when the rule has it; anything else reads the main wording
  const lang: Lang = who.lang === 'es' ? 'es' : who.lang ? 'en' : ctx.lang === 'es' ? 'es' : 'en';
  const subject = mergeText(say(step, 'subject', lang), d, s, lang);
  const body = mergeText(say(step, 'body', lang), d, s, lang);
  if (!body) throw new Error('auto.err.noBody');
  const out = queueMessage(d, ctx, {
    channel, to: where.to, subject, body, auto: stamp, mode: step.params.mode === 'send' ? 'send' : 'draft', ...(s.client ? { clientId: s.client.id } : {}),
    ref: s.ref ?? (s.job ? { type: 'job', id: s.job.id } : s.client ? { type: 'client', id: s.client.id } : { type: 'lead', id: who.id }),
  });
  if (!out.ok) return skipped('auto.skip.' + out.reason, { who: who.name });
  const what = subject || ctx.t('auto.ch.' + channel);
  return done(out.message.status === 'draft' ? (channel === 'email' ? 'auto.step.email' : 'auto.step.msgDraft') : out.message.status === 'demo' ? 'auto.step.msgDemo' : 'auto.step.msgQueued', { subject: what, who: who.name });
}

/** Tells a person inside the company. It is a note in their messages and in the record's history; nothing leaves the building. */
function notify(step: RuleStep, { d, ctx, subject: s, stamp, ruleId }: StepInput): StepOutcome {
  if (d.messages.some((m) => m.auto === stamp)) return { lines: [], did: false };
  const who = resolveWho(d, s, step.params.who); if (!who) return skipped('auto.skip.no_person');
  const lang: Lang = ctx.lang === 'es' ? 'es' : 'en';
  const body = mergeText(say(step, 'text', lang), d, s, lang);
  if (!body) throw new Error('auto.err.noBody');
  const ref = s.ref ?? (s.job ? { type: 'job' as const, id: s.job.id } : s.lead ? { type: 'lead' as const, id: s.lead.id } : s.client ? { type: 'client' as const, id: s.client.id } : { type: 'user' as const, id: who.id });
  const m: Message = { id: uid('m'), at: nowIso(), channel: 'system', to: who.name, subject: body.slice(0, 120), body, status: 'received', ref, auto: stamp, dir: 'in', from: ruleId, read: false, ...(s.client ? { clientId: s.client.id } : {}) };
  d.messages.unshift(m);
  return done('auto.step.notify', { who: who.name });
}

function assign(step: RuleStep, { d, ctx, subject: s }: StepInput): StepOutcome {
  const to = String(step.params.to ?? 'owner');
  const person = to === 'next' ? active(d, assignNextLead(d, ctx) ?? undefined) : resolveWho(d, s, to);
  if (!person) return skipped('auto.skip.no_person');
  if (s.lead && !s.job) {
    if (s.lead.ownerId === person.id) return { lines: [], did: false };
    handoffLead(d, ctx, s.lead.id, person.id, undefined, 'rule');
  } else if (s.task) { if (s.task.assignee === 'u:' + person.id) return { lines: [], did: false }; s.task.assignee = 'u:' + person.id; }
  else if (s.job) { if (s.job.managerId === person.id) return { lines: [], did: false }; s.job.managerId = person.id; }
  else if (s.client) { if (s.client.assignedTo === person.id) return { lines: [], did: false }; s.client.assignedTo = person.id; }
  else return skipped('auto.skip.no_record');
  return done('auto.step.owner', { owner: person.name });
}

function stage(step: RuleStep, { d, ctx, subject: s }: StepInput): StepOutcome {
  if (s.lead && !s.job && step.params.stage) {
    const id = String(step.params.stage);
    if (!stageOf(d, ctx.pack, id)) throw new Error('auto.err.noStage');
    if (s.lead.status === id) return { lines: [], did: false };
    setLeadStage(d, ctx, s.lead.id, id);
    return done('auto.step.stage', { stage: ctx.t('ls_' + id) });
  }
  if (s.job && step.params.status) {
    const st = String(step.params.status) as typeof s.job.status;
    if (!ctx.pack.jobStatuses.includes(st)) throw new Error('auto.err.noStage');
    if (s.job.status === st) return { lines: [], did: false };
    setJobStatus(d, ctx, s.job.id, st);
    return done('auto.step.stage', { stage: ctx.t('st_' + st) });
  }
  return skipped('auto.skip.no_record');
}

function documentStep(step: RuleStep, { d, ctx, subject: s }: StepInput): StepOutcome {
  const clientId = s.client?.id ?? s.job?.clientId; if (!clientId) return skipped('auto.skip.no_record');
  const kind = String(step.params.kind) as Parameters<typeof createDocFromTemplate>[2]['kind'];
  const doc = createDocFromTemplate(d, ctx, { kind, clientId, ...(s.job ? { jobId: s.job.id } : {}), ...(s.lead ? { leadId: s.lead.id } : {}), ...(step.params.templateId ? { templateId: String(step.params.templateId) } : {}) });
  return doc ? done('auto.step.doc', { doc: ctx.t('doc.kind.' + kind) }) : skipped('auto.skip.doc', { doc: ctx.t('doc.kind.' + kind) });
}

function playbook(_step: RuleStep, { d, ctx, subject: s }: StepInput): StepOutcome {
  if (!s.job) return skipped('auto.skip.no_record');
  const made = startPlaybook(d, ctx, s.job.id);
  return made.length ? done('auto.step.tasks', { n: made.length }) : skipped('auto.skip.playbook');
}

function opportunity(step: RuleStep, { d, ctx, subject: s }: StepInput): StepOutcome {
  const clientId = s.client?.id ?? s.job?.clientId; if (!clientId) return skipped('auto.skip.no_record');
  const service = (d.catalog ?? []).find((x) => x.id === step.params.serviceId);
  if (!service) throw new Error('auto.err.noService');
  if ((d.opportunities ?? []).some((o) => o.clientId === clientId && o.serviceId === service.id && (o.status === 'open' || o.status === 'contacted'))) return { lines: [], did: false };
  // the opportunities module's own action when it is there (it prices the opportunity and writes the history)
  const add = (actions as unknown as Record<string, unknown>).addOpportunity;
  if (typeof add === 'function') {
    const made = (add as (d: DemoState, ctx: Ctx, input: { clientId: string; serviceId: string; note?: string }) => Opportunity | null)(d, ctx, { clientId, serviceId: service.id, ...(step.params.note ? { note: String(step.params.note) } : {}) });
    return made ? done('auto.step.opportunity', { service: service.name }) : skipped('auto.skip.no_record');
  }
  const o: Opportunity = { id: uid('op'), clientId, serviceId: service.id, status: 'open', created: today(), by: 'automation', ...(step.params.note ? { note: String(step.params.note) } : {}) };
  d.opportunities = [o, ...(d.opportunities ?? [])];
  return done('auto.step.opportunity', { service: service.name });
}

function review(step: RuleStep, { d, ctx, subject: s, stamp }: StepInput): StepOutcome {
  const clientId = s.client?.id ?? s.job?.clientId; if (!clientId) return skipped('auto.skip.no_record');
  const channel = CHANNELS.includes(step.params.channel as MessageChannel) ? (step.params.channel as MessageChannel) : 'email';
  const out = requestReview(d, ctx, { clientId, ...(s.job ? { jobId: s.job.id } : {}), channel, auto: stamp });
  if (!out.ok) return out.reason === 'already_asked' ? { lines: [], did: false } : skipped('auto.skip.review.' + out.reason);
  const lines: StepLine[] = [{ key: 'auto.step.review', params: { who: d.clients.find((c) => c.id === clientId)?.name ?? '' } }];
  if (out.noMessage) lines.push({ key: 'auto.skip.' + out.noMessage, params: { who: d.clients.find((c) => c.id === clientId)?.name ?? '' } });
  return { lines, did: true };
}

function tag(step: RuleStep, { subject: s }: StepInput): StepOutcome {
  const label = String(step.params.tag ?? '').trim(); if (!label) throw new Error('auto.err.noTag');
  if (!s.client) return skipped('auto.skip.no_record');
  if ((s.client.tags ?? []).some((x) => x.toLowerCase() === label.toLowerCase())) return { lines: [], did: false };
  s.client.tags = [...(s.client.tags ?? []), label];
  return done('auto.step.tag', { tag: label });
}

const RUN: Record<StepKind, ((step: RuleStep, input: StepInput) => StepOutcome) | undefined> = {
  task, message, notify, assign, stage, document: documentStep, playbook, opportunity, review, tag, builtin: undefined,
};
/** Carries out one step. `builtin` is run by the engine itself, because it needs the coded rules. */
export function runStep(step: RuleStep, input: StepInput): StepOutcome {
  const fn = RUN[step.do as StepKind];
  if (!fn) throw new Error('auto.err.unsupported');
  return fn(step, input);
}
