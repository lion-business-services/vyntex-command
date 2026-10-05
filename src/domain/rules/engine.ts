// The rule engine: WHEN something happens, IF the conditions hold, THEN run the steps. One engine for every edition.
// Modules announce what happened with `emit()`; they never call another module's automation directly.
//
// What the engine guarantees:
//   * every rule that acts leaves one line in the run history (`data.automation.runs`) with its steps and how it went:
//     ok, skipped (it had a plain reason not to act) or failed (with the reason);
//   * a rule runs once per record and occasion. The occasion is part of a key kept on the run and on what the rule
//     created, so a retry, a double click or a second announcement of the same event changes nothing;
//   * a step that breaks stops its own rule only. The other rules still run and the caller never sees an error;
//   * a rule cannot set itself off for ever: what a rule changes may start other rules, a few levels deep and never the
//     same rule for the same record while it is still running.
// Pure domain code: no screen, no store. The same file runs in the browser (sample mode) and on the server.
import type { Appointment, AutomationRun, Client, DemoState, DocRecord, Envelope, IndustryId, Job, Lead, Message, Payment, Ref, RuleDef, RuleEvent, Task } from '../types';
import type { Ctx } from '../context';
import type { IndustryPack } from '@/packs/types';
import { RULES, type AutoEvent } from '../automations';
import { daysBetween, nowIso, today } from '@/lib/dates';
import { uid } from '@/lib/id';
import { isLive } from '@/platform/session';
import { type EngineEvent, eventDef, mainRef } from './fields';
import { matches } from './conditions';
import { runStep, type StepLine } from './steps';

/** What the event is about. Pass the records you have; rules read fields from them (`lead.source`, `job.price`, ...). */
export interface RuleSubject {
  ref?: Ref;
  lead?: Lead; client?: Client; job?: Job; appointment?: Appointment; task?: Task; doc?: DocRecord; envelope?: Envelope; message?: Message; payment?: Payment;
  /** Anything else a rule may test or use in a step, e.g. { from: 'new', to: 'won' } for a stage change. */
  extra?: Record<string, string | number | boolean>;
}

/** How deep one event may set off others (a rule moves a stage, which starts another rule, ...). */
export const MAX_DEPTH = 3;
/** Runs kept in a sample workspace. A live one keeps them all: the history there belongs to the database. */
export const RUN_CAP = 200;

/* ---------- which rules a company has ---------- */

// `var`, and created on first use: an edition's rules may be made known while this file is still being loaded
// (the modules of the domain import each other in a circle), and a `const` would not exist yet at that moment.
// eslint-disable-next-line no-var
var extraShipped: Map<IndustryId, RuleDef[]> | undefined;
/** Makes an edition's rules known before the edition's own list names them. Registering the same list twice changes nothing. */
export function registerShipped(pack: IndustryId, rules: RuleDef[]): void { (extraShipped ??= new Map()).set(pack, rules); }
/** The rules an edition ships with: the list in its pack, plus registered ones the pack does not name yet. */
export function shippedRules(pack: IndustryPack): RuleDef[] {
  const more = (extraShipped?.get(pack.id) ?? []).filter((r) => !pack.rules.some((x) => x.id === r.id));
  return more.length ? [...pack.rules, ...more] : pack.rules;
}
export const shippedRule = (pack: IndustryPack, id: string): RuleDef | undefined => shippedRules(pack).find((r) => r.id === id);
export const cloneRule = (r: RuleDef): RuleDef => ({ ...r, name: { ...r.name }, ...(r.about ? { about: { ...r.about } } : {}), when: { ...r.when }, if: (r.if ?? []).map((c) => ({ ...c, ...(Array.isArray(c.value) ? { value: [...c.value] } : {}) })), then: (r.then ?? []).map((s) => ({ ...s, params: { ...s.params } })) });
/**
 * The rules in force for a company: its own list, plus any rule the edition ships that the company's list does not have
 * yet (a company that started before a rule was added still gets it, as shipped).
 */
export function effectiveRules(d: Pick<DemoState, 'rules'>, pack: IndustryPack): RuleDef[] {
  const own = d.rules ?? [];
  const missing = shippedRules(pack).filter((r) => !own.some((x) => x.id === r.id));
  return missing.length ? [...own, ...missing] : own;
}
/** A rule runs when it is active and nobody switched it off. The older switch (`automation.enabled`) is still honoured. */
export const isRuleOn = (d: Pick<DemoState, 'automation'>, rule: RuleDef): boolean => rule.active !== false && d.automation?.enabled?.[rule.id] !== false;
/** What makes two rules behave the same: the event, the conditions and the steps. Names and the on/off switch do not count. */
const behaviour = (r: RuleDef) => JSON.stringify([r.when, r.if ?? [], (r.then ?? []).map((s) => [s.do, Object.keys(s.params).sort().map((k) => [k, s.params[k]])])]);
/** True when a shipped rule no longer does what it did when it shipped. */
export function ruleChanged(pack: IndustryPack, rule: RuleDef): boolean {
  const was = shippedRule(pack, rule.id);
  return !!was && (behaviour(was) !== behaviour(rule) || JSON.stringify(was.name) !== JSON.stringify(rule.name));
}

/* ---------- once per record and occasion ---------- */

/** What tells one occurrence of an event from the next for the same record. An emitter can say it outright in `extra.occasion`. */
function occasion(event: string, s: RuleSubject): string {
  const x = s.extra ?? {};
  if (x.occasion !== undefined) return String(x.occasion);
  switch (event) {
    case 'lead.stage': return String(x.to ?? s.lead?.status ?? '');
    case 'job.status': return String(x.to ?? s.job?.status ?? '');
    case 'payment.received': return s.payment?.id ?? '';
    case 'appointment.booked': case 'appointment.soon': return s.appointment ? `${s.appointment.date}T${s.appointment.time}` : '';
    case 'task.overdue': return s.task?.due ?? '';
    case 'daily': return today();
    default: return '';
  }
}
/** The key of one rule acting on one record on one occasion. Kept on the run, and at the start of the mark on everything the rule creates. */
export function dedupeKey(rule: Pick<RuleDef, 'id'>, event: string, s: RuleSubject): string {
  const ref = mainRef(s);
  return [rule.id, ref ? `${ref.type}:${ref.id}` : 'all', occasion(event, s)].join('|').slice(0, 220);
}
const startsWith = (mark: string | undefined, key: string) => !!mark && mark.startsWith(key + '#');
/** Whether the rule already acted on this record and occasion: a run says so, or something it created is still there. */
export function alreadyRan(d: DemoState, key: string): boolean {
  return d.automation.runs.some((r) => r.dedupe === key)
    || d.tasks.some((t) => startsWith(t.auto, key)) || d.messages.some((m) => startsWith(m.auto, key))
    || (d.reviews ?? []).some((r) => startsWith((r as { auto?: string }).auto, key));
}
/** A key no run uses yet, so the history never holds two runs with the same one. */
function freeKey(d: DemoState, key: string): string {
  if (!d.automation.runs.some((r) => r.dedupe === key)) return key;
  for (let n = 2; ; n++) { const k = `${key}~${n}`; if (!d.automation.runs.some((r) => r.dedupe === k)) return k; }
}

/* ---------- the coded rules, run unchanged ---------- */

/** The event as the coded rules of src/domain/automations.ts have always received it, or null when a record they need is missing. */
function legacyEvent(trigger: AutoEvent['type'], s: RuleSubject): AutoEvent | null {
  const from = String(s.extra?.from ?? '');
  switch (trigger) {
    case 'lead.created': return s.lead ? { type: trigger, lead: s.lead } : null;
    case 'lead.stage': return s.lead ? { type: trigger, lead: s.lead, from } : null;
    case 'lead.won': return s.lead && s.job ? { type: trigger, lead: s.lead, job: s.job } : null;
    case 'job.status': return s.job ? { type: trigger, job: s.job, from } : null;
    case 'payment.received': return s.job ? { type: trigger, job: s.job, amount: s.payment?.amount ?? Number(s.extra?.amount ?? 0) } : null;
    case 'daily': return { type: trigger };
  }
}
function runBuiltin(d: DemoState, ctx: Ctx, id: string, s: RuleSubject): { steps: StepLine[]; ref?: Ref } | null {
  const coded = RULES.find((r) => r.id === id);
  if (!coded) throw new Error('auto.err.noBuiltin');
  const e = legacyEvent(coded.trigger, s);
  return e ? coded.run(d, ctx, e) : null;
}

/* ---------- running ---------- */

let depth = 0;
const running = new Set<string>();

function record(d: DemoState, run: AutomationRun) {
  d.automation.runs.unshift(run);
  if (!isLive() && d.automation.runs.length > RUN_CAP) d.automation.runs.length = RUN_CAP;
}
const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 300) || 'auto.err.unknown';

function runRule(d: DemoState, ctx: Ctx, rule: RuleDef, event: string, s: RuleSubject, key: string) {
  const failMark = `${key}!${today()}`;
  // a rule that failed today is tried again tomorrow, not on every event in between
  if (d.automation.runs.some((r) => r.dedupe === failMark)) return;
  // the coded rules look after their own repeats, exactly as before; every other step runs once per record and occasion
  const fresh = !alreadyRan(d, key);
  const lines: StepLine[] = []; let did = false; let error: string | undefined; let ref = mainRef(s);
  for (let i = 0; i < rule.then.length; i++) {
    const step = rule.then[i];
    try {
      if (step.do === 'builtin') {
        const out = runBuiltin(d, ctx, String(step.params.rule ?? rule.id), s);
        if (out && out.steps.length) { lines.push(...out.steps); did = true; if (out.ref) ref = out.ref; }
        continue;
      }
      if (!fresh) continue;
      const out = runStep(step, { d, ctx, subject: s, stamp: `${key}#${i}`, ruleId: rule.id });
      lines.push(...out.lines); did = did || out.did;
    } catch (e) {
      error = reason(e);
      lines.push({ key: 'auto.step.failed', params: { n: i + 1 } });
      break;
    }
  }
  if (!lines.length) return;
  const status: AutomationRun['status'] = error ? 'failed' : did ? 'ok' : 'skipped';
  record(d, { id: uid('r'), at: nowIso(), ruleId: rule.id, steps: lines, ...(ref ? { ref } : {}), status, ...(error ? { error } : {}), dedupe: freeKey(d, error ? failMark : key) });
}

/** The days a counted event needs before a rule acts: the rule's own number, the emitter's (`extra.threshold`), or the event's default. */
function daysMet(rule: Pick<RuleDef, 'when'>, event: string, s: RuleSubject): boolean {
  const def = eventDef(event); if (!def?.days) return true;
  const have = Number(s.extra?.days); if (!isFinite(have)) return true;
  const need = typeof rule.when.days === 'number' ? rule.when.days : typeof s.extra?.threshold === 'number' ? s.extra.threshold : def.days.default;
  return def.days.dir === 'after' ? have >= need : have <= need;
}

/** Tells the engine that something happened. Safe to call from any action; it never throws. */
export function emit(d: DemoState, ctx: Ctx, event: RuleEvent, subject: RuleSubject): void {
  if (depth >= MAX_DEPTH) return;
  let rules: RuleDef[];
  try { rules = effectiveRules(d, ctx.pack).filter((r) => r.when?.event === event && isRuleOn(d, r)); } catch { return; }
  for (const rule of rules) {
    let key = '';
    try {
      if (!daysMet(rule, event, subject) || !matches(rule, subject)) continue;
      key = dedupeKey(rule, event, subject);
      // the rule is already at work on this record: what it changes must not start it again
      if (running.has(key)) continue;
      running.add(key); depth++;
      try { runRule(d, ctx, rule, event, subject, key); } finally { depth--; running.delete(key); }
    } catch (e) {
      // even writing the run down failed: keep going with the other rules
      try { record(d, { id: uid('r'), at: nowIso(), ruleId: rule.id, steps: [{ key: 'auto.step.failed', params: { n: 0 } }], status: 'failed', error: reason(e) }); } catch { /* nothing more to do */ }
    }
  }
}

/* ---------- preview: which records on file would a rule have matched ---------- */

export interface PreviewHit { ref: Ref; name: string }
export interface RulePreview {
  /** False for events that are not about a list of records (every morning). */
  possible: boolean;
  /** Records looked at. */
  total: number;
  hits: PreviewHit[];
  /** The records come from this many days back; 0 means everything on file. */
  windowDays: number;
}
const since = (date: string | undefined, days: number) => !!date && daysBetween(date.slice(0, 10), today()) <= days;
const clientOf = (d: DemoState, id: string | undefined) => (id ? d.clients.find((c) => c.id === id) : undefined);
/** The records an event has been about lately, each as the subject a rule would have been given. */
function population(d: DemoState, event: EngineEvent | string, days: number): { windowDays: number; list: { subject: RuleSubject; name: string }[] } | null {
  const group = eventDef(event)?.group; const id = String(event);
  if (id.startsWith('lead.')) {
    const all = id === 'lead.idle' ? d.leads : d.leads.filter((l) => since(l.created, days));
    return { windowDays: id === 'lead.idle' ? 0 : days, list: all.map((l) => ({ name: l.name, subject: { ref: { type: 'lead', id: l.id }, lead: l, client: clientOf(d, l.clientId), job: d.jobs.find((j) => j.id === l.jobId), extra: { to: l.status, days: daysBetween((l.lastContact ?? l.created).slice(0, 10), today()) } } })) };
  }
  if (id === 'client.created' || id === 'client.birthday' || id === 'opportunity.created' || id === 'credit.expiring') {
    const all = id === 'client.created' ? d.clients.filter((c) => since(c.since, days)) : d.clients;
    return { windowDays: id === 'client.created' ? days : 0, list: all.map((c) => ({ name: c.name, subject: { ref: { type: 'client', id: c.id }, client: c } })) };
  }
  if (id === 'payment.received') {
    const list = d.jobs.flatMap((j) => j.received.filter((p) => since(p.date, days)).map((p) => ({ name: j.name, subject: { ref: { type: 'job' as const, id: j.id }, job: j, client: clientOf(d, j.clientId), payment: p } })));
    return { windowDays: days, list };
  }
  if (group === 'job') {
    const all = id === 'review.due' || id === 'job.completed' ? d.jobs.filter((j) => j.status === 'done') : d.jobs.filter((j) => since(j.created, days));
    return { windowDays: id === 'review.due' || id === 'job.completed' ? 0 : days, list: all.map((j) => ({ name: j.name, subject: { ref: { type: 'job', id: j.id }, job: j, client: clientOf(d, j.clientId), extra: { to: j.status, days: j.end ? daysBetween(j.end, today()) : 0 } } })) };
  }
  if (group === 'appointment') {
    const all = (d.appointments ?? []).filter((a) => since(a.created, days) || Math.abs(daysBetween(a.date, today())) <= days);
    return { windowDays: days, list: all.map((a) => { const c = clientOf(d, a.clientId); const l = d.leads.find((x) => x.id === a.leadId); return { name: c?.name ?? l?.name ?? a.date, subject: { ref: { type: 'appointment', id: a.id }, appointment: a, client: c, lead: l, extra: { days: daysBetween(today(), a.date) } } }; }) };
  }
  if (id === 'task.overdue') {
    const all = d.tasks.filter((t) => t.status !== 'done' && !!t.due && t.due < today());
    return { windowDays: 0, list: all.map((t) => ({ name: t.title, subject: { ref: { type: 'task', id: t.id }, task: t, client: clientOf(d, t.clientId), job: d.jobs.find((j) => j.id === t.jobId), lead: d.leads.find((l) => l.id === t.leadId), extra: { days: daysBetween(t.due!, today()) } } })) };
  }
  if (id === 'deadline.near') {
    const all = (d.complianceItems ?? []).filter((x) => x.status === 'open');
    return { windowDays: 0, list: all.map((x) => ({ name: x.title, subject: { ref: { type: 'compliance', id: x.id }, client: clientOf(d, x.clientId), job: d.jobs.find((j) => j.id === x.jobId), extra: { days: daysBetween(today(), x.due), kind: x.kind, title: x.title } } })) };
  }
  if (id === 'doc.sent') {
    const all = d.docs.filter((x) => x.status !== 'draft' && x.status !== 'void' && since(x.updated, days));
    return { windowDays: days, list: all.map((x) => ({ name: x.title || x.number, subject: { ref: { type: 'doc', id: x.id }, doc: x, client: clientOf(d, x.clientId), job: d.jobs.find((j) => j.id === x.jobId) } })) };
  }
  if (id.startsWith('envelope.')) {
    const all = (d.envelopes ?? []).filter((x) => since(x.created, days));
    return { windowDays: days, list: all.map((x) => { const doc = d.docs.find((y) => y.id === x.docId); return { name: x.title, subject: { ref: { type: 'envelope', id: x.id }, envelope: x, doc, client: clientOf(d, doc?.clientId), extra: { days: x.sentAt ? daysBetween(x.sentAt.slice(0, 10), today()) : 0 } } }; }) };
  }
  if (id === 'message.received') {
    const all = d.messages.filter((m) => m.dir === 'in' && m.channel !== 'system' && since(m.at, days));
    return { windowDays: days, list: all.map((m) => ({ name: m.subject || m.from || m.to, subject: { ref: m.ref, message: m, client: clientOf(d, m.clientId) } })) };
  }
  return null;
}
/**
 * Which records on file meet a rule's conditions, so a person can see what a rule would catch before switching it on.
 * It tests the conditions against the records as they are today; it does not replay history.
 */
export function previewRule(d: DemoState, rule: Pick<RuleDef, 'when' | 'if'>, days = 30): RulePreview {
  const pop = population(d, rule.when.event, days);
  if (!pop) return { possible: false, total: 0, hits: [], windowDays: 0 };
  const hits = pop.list.filter((x) => daysMet(rule, rule.when.event, x.subject) && matches(rule, x.subject)).map((x) => ({ ref: mainRef(x.subject)!, name: x.name }));
  return { possible: true, total: pop.list.length, hits, windowDays: pop.windowDays };
}
