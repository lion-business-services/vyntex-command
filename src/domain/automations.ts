// Workflow automation. Rules react to business events (a new lead, a won lead, a status change, a payment, the start of a day)
// and do the follow-up work a person would otherwise have to remember: tasks, records, documents and prepared emails.
// In demo mode emails are only prepared (status "draft"); nothing leaves the browser.
//
// The eight rules in this file are the coded rules every edition has had from the start. They are run by the rule engine
// (src/domain/rules/engine.ts) through the shipped rule definitions of each edition, whose one step is `builtin`: what
// they do has not changed. Rules a company builds itself, and the other shipped rules, are plain data and need no code here.
import type { DemoState, Job, Lead, Ref, Task, Worker } from './types';
import type { EntitlementId } from './entitlements';
import type { TaskTemplate } from '@/packs/types';
import { type Ctx, logActivity } from './context';
import { stageRole } from './config';
import { addDays, addDaysFrom, nowIso, today } from '@/lib/dates';
import { uid } from '@/lib/id';
import { sum } from '@/lib/money';
import { emit as engineEmit, registerShipped } from './rules/engine';
import { practiceRules } from '@/packs/practice/rules';
import { runTimed } from './actions/daily';

export type AutoEvent =
  | { type: 'lead.created'; lead: Lead }
  | { type: 'lead.stage'; lead: Lead; from: string }
  | { type: 'lead.won'; lead: Lead; job: Job }
  | { type: 'job.status'; job: Job; from: string }
  | { type: 'payment.received'; job: Job; amount: number }
  | { type: 'daily' };

type Step = { key: string; params?: Record<string, string | number> };

export interface AutomationRule {
  id: string;
  /** Event that starts the rule; shown to the user as "When…". */
  trigger: AutoEvent['type'];
  /** Capability that the customer-facing part of the rule depends on (for the Included / add-on badge). */
  entitlement?: EntitlementId;
  /** Number of "then" lines to display: i18n keys auto.<id>.then1..n */
  thens: number;
  run: (d: DemoState, ctx: Ctx, e: any) => { steps: Step[]; ref?: Ref } | null;
}

const ownerId = (d: DemoState) => d.users.find((u) => u.role === 'owner')?.id ?? d.users[0]?.id ?? 'u1';

function addTask(d: DemoState, auto: string, t: Omit<Task, 'id' | 'created' | 'status' | 'auto'> & { status?: Task['status'] }): Task | null {
  if (d.tasks.some((x) => x.auto === auto)) return null;
  const task: Task = { id: uid('t'), created: today(), status: 'todo', ...t, auto };
  d.tasks.unshift(task);
  return task;
}
function prepareEmail(d: DemoState, auto: string, to: string, subject: string, body: string, ref: Ref) {
  if (!to || d.messages.some((m) => m.auto === auto)) return false;
  d.messages.unshift({ id: uid('m'), at: nowIso(), channel: 'email', to, subject, body, status: 'draft', ref, auto });
  return true;
}
const firstName = (n: string) => n.split(' ')[0];
const DEFAULT_KICKOFF: TaskTemplate[] = [
  { en: 'Send the agreement for signature', es: 'Enviar el acuerdo para firma', dueIn: 0, for: 'owner', pri: 'high' },
  { en: 'Confirm the start date with the client', es: 'Confirmar la fecha de inicio con el cliente', dueIn: 2, for: 'owner' },
  { en: 'Assign the team and share the work details', es: 'Asignar al equipo y compartir los detalles', dueIn: 3, for: 'owner' },
];
const DEFAULT_CLOSEOUT: TaskTemplate[] = [
  { en: 'Send the final invoice', es: 'Enviar la factura final', dueIn: 0, for: 'owner', pri: 'high' },
  { en: 'Ask the client for a review', es: 'Pedir una reseña al cliente', dueIn: 3, for: 'owner', pri: 'low' },
];

export const RULES: AutomationRule[] = [
  {
    id: 'lead-intake', trigger: 'lead.created', thens: 3,
    run(d, ctx, e: { lead: Lead }) {
      const l = e.lead; const steps: Step[] = [];
      if (!l.ownerId) { l.ownerId = ownerId(d); }
      const owner = d.users.find((u) => u.id === l.ownerId);
      steps.push({ key: 'auto.step.owner', params: { owner: owner?.name ?? '' } });
      if (!l.followUp && !l.apptDate) { l.followUp = addDays(1); steps.push({ key: 'auto.step.followUp', params: { date: l.followUp } }); }
      const task = addTask(d, `lead-intake:${l.id}`, { title: ctx.t('auto.task.callBack', { lead: l.name }), leadId: l.id, assignee: 'u:' + l.ownerId, due: today(), pri: 'high' });
      if (task) steps.push({ key: 'auto.step.task', params: { task: task.title } });
      return { steps, ref: { type: 'lead', id: l.id } };
    },
  },
  {
    id: 'visit-prep', trigger: 'lead.stage', thens: 2,
    run(d, ctx, e: { lead: Lead }) {
      const l = e.lead; if (stageRole(d, ctx.pack, l.status) !== 'visit' || !l.apptDate) return null;
      const task = addTask(d, `visit-prep:${l.id}:${l.apptDate}`, { title: ctx.t('auto.task.visitPrep', { lead: l.name }), leadId: l.id, assignee: 'u:' + l.ownerId, due: l.apptDate, pri: 'medium' });
      if (!task) return null;
      const steps: Step[] = [{ key: 'auto.step.calendar', params: { date: l.apptDate } }, { key: 'auto.step.task', params: { task: task.title } }];
      return { steps, ref: { type: 'lead', id: l.id } };
    },
  },
  {
    id: 'estimate-follow-up', trigger: 'lead.stage', thens: 2,
    run(d, ctx, e: { lead: Lead }) {
      const l = e.lead; if (stageRole(d, ctx.pack, l.status) !== 'proposal') return null;
      l.followUp = addDays(3);
      const task = addTask(d, `estimate-follow-up:${l.id}`, { title: ctx.t('auto.task.estimateFollowUp', { lead: l.name }), leadId: l.id, assignee: 'u:' + l.ownerId, due: l.followUp, pri: 'medium' });
      if (!task) return null;
      const steps: Step[] = [{ key: 'auto.step.followUp', params: { date: l.followUp } }, { key: 'auto.step.task', params: { task: task.title } }];
      return { steps, ref: { type: 'lead', id: l.id } };
    },
  },
  {
    id: 'lead-won', trigger: 'lead.won', entitlement: 'clientEmails', thens: 4,
    run(d, ctx, e: { lead: Lead; job: Job }) {
      const { lead, job } = e; const steps: Step[] = [{ key: 'auto.step.client' }, { key: 'auto.step.job', params: { job: job.name } }];
      // office editions: when the service's own playbook already created the kickoff tasks for this engagement, the edition's generic list would only repeat them
      const playbook = ctx.pack.family === 'practice' && d.tasks.some((t) => t.jobId === job.id && !!t.auto && t.auto.startsWith('playbook:'));
      const list = playbook ? [] : ctx.pack.kickoffTasks.length ? ctx.pack.kickoffTasks : DEFAULT_KICKOFF;
      let n = 0;
      list.forEach((tpl, i) => { if (addTask(d, `lead-won:${job.id}:${i}`, { title: tpl[ctx.lang] ?? tpl.en, jobId: job.id, clientId: job.clientId, assignee: 'u:' + job.managerId, due: addDays(tpl.dueIn), pri: tpl.pri ?? 'medium' })) n++; });
      steps.push({ key: 'auto.step.tasks', params: { n } });
      const client = d.clients.find((c) => c.id === job.clientId);
      if (client && !client.emailOptOut && prepareEmail(d, `lead-won:${job.id}`, client.email, ctx.t('auto.mail.welcome.subject', { company: d.company.name }), ctx.t('auto.mail.welcome.body', { name: firstName(lead.name), company: d.company.name, job: job.name }), { type: 'job', id: job.id }))
        steps.push({ key: 'auto.step.email', params: { subject: ctx.t('auto.mail.welcome.subject', { company: d.company.name }) } });
      return { steps, ref: { type: 'job', id: job.id } };
    },
  },
  {
    id: 'job-started', trigger: 'job.status', entitlement: 'clientEmails', thens: 2,
    run(d, ctx, e: { job: Job }) {
      const j = e.job; if (j.status !== 'progress') return null; const steps: Step[] = [];
      if (!j.start) j.start = today();
      const client = d.clients.find((c) => c.id === j.clientId);
      const subj = ctx.t('auto.mail.started.subject', { job: j.name });
      if (client && !client.emailOptOut && prepareEmail(d, `job-started:${j.id}`, client.email, subj, ctx.t('auto.mail.started.body', { name: firstName(client.name), company: d.company.name, job: j.name }), { type: 'job', id: j.id })) steps.push({ key: 'auto.step.email', params: { subject: subj } });
      const w = j.assign.length;
      if (w) steps.push({ key: 'auto.step.notifyWorkers', params: { n: w } });
      return steps.length ? { steps, ref: { type: 'job', id: j.id } } : null;
    },
  },
  {
    id: 'job-completed', trigger: 'job.status', entitlement: 'clientEmails', thens: 4,
    run(d, ctx, e: { job: Job }) {
      const j = e.job; if (j.status !== 'done') return null; const steps: Step[] = [];
      if (!j.end) j.end = today();
      if (!d.docs.some((x) => x.jobId === j.id && x.kind === 'invoice')) {
        const n = Math.max(1000, ...d.docs.filter((x) => x.kind === 'invoice').map((x) => parseInt(x.number.split('-').pop() || '', 10) || 0)) + 1;
        d.docs.unshift({ id: uid('d'), kind: 'invoice', number: `${ctx.pack.ticketPrefix}INV-${n}`, title: j.name, jobId: j.id, clientId: j.clientId, status: 'draft', created: today(), updated: today() });
        steps.push({ key: 'auto.step.invoice' });
      }
      const list = ctx.pack.closeoutTasks.length ? ctx.pack.closeoutTasks : DEFAULT_CLOSEOUT; let n = 0;
      list.forEach((tpl, i) => { if (addTask(d, `job-completed:${j.id}:${i}`, { title: tpl[ctx.lang] ?? tpl.en, jobId: j.id, clientId: j.clientId, assignee: 'u:' + j.managerId, due: addDays(tpl.dueIn), pri: tpl.pri ?? 'medium' })) n++; });
      if (n) steps.push({ key: 'auto.step.tasks', params: { n } });
      const owes = j.price - sum(j.received, (r) => r.amount);
      const client = d.clients.find((c) => c.id === j.clientId);
      const subj = ctx.t('auto.mail.done.subject', { job: j.name });
      if (client && !client.emailOptOut && prepareEmail(d, `job-completed:${j.id}`, client.email, subj, ctx.t(owes > 0 ? 'auto.mail.done.bodyBalance' : 'auto.mail.done.body', { name: firstName(client.name), company: d.company.name, job: j.name }), { type: 'job', id: j.id })) steps.push({ key: 'auto.step.email', params: { subject: subj } });
      return steps.length ? { steps, ref: { type: 'job', id: j.id } } : null;
    },
  },
  {
    id: 'payment-posted', trigger: 'payment.received', thens: 3,
    run(d, _ctx, e: { job: Job; amount: number }) {
      const j = e.job; const owes = j.price - sum(j.received, (r) => r.amount);
      const steps: Step[] = [{ key: 'auto.step.balance', params: { amount: Math.max(0, owes) } }];
      const inv = d.docs.find((x) => x.jobId === j.id && x.kind === 'invoice');
      if (inv && owes <= 0.005 && inv.status !== 'paid') { inv.status = 'paid'; inv.updated = today(); steps.push({ key: 'auto.step.invoicePaid' }); logActivity(d, 'automation', 'invoice.paid', { type: 'job', id: j.id }, undefined, [{ type: 'client', id: j.clientId }]); }
      return { steps, ref: { type: 'job', id: j.id } };
    },
  },
  {
    id: 'compliance-watch', trigger: 'daily', entitlement: 'complianceUploads', thens: 2,
    run(d, ctx) {
      if (!ctx.pack.compliance) return null;
      const steps: Step[] = []; const owner = ownerId(d);
      const flag = (w: Worker, what: 'w9' | 'coi', due: string) => {
        const task = addTask(d, `compliance-watch:${w.id}:${what}:${what === 'coi' ? w.coiExp ?? 'none' : 'missing'}`, { title: ctx.t(what === 'w9' ? 'auto.task.w9' : 'auto.task.coi', { worker: w.name }), assignee: 'u:' + owner, due, pri: 'high' });
        if (task) steps.push({ key: 'auto.step.task', params: { task: task.title } });
      };
      for (const w of d.workers) {
        if (w.active === false) continue;
        const working = d.jobs.some((j) => j.status === 'progress' && j.assign.some((a) => a.workerId === w.id));
        if (!w.w9 && working) flag(w, 'w9', addDays(2));
        if (w.coiExp && w.coiExp <= addDays(30) && working) flag(w, 'coi', w.coiExp < today() ? today() : addDaysFrom(w.coiExp, -7) < today() ? today() : addDaysFrom(w.coiExp, -7));
      }
      return steps.length ? { steps } : null;
    },
  },
];
// The shipped rules of the professional-services edition are plain data (src/packs/practice/rules.ts). The engine reads an
// edition's rules from its pack; this makes them known to it as well, so they are in force even where the pack's own list
// does not name them yet.
registerShipped('practice', practiceRules);

/** Shown in the Automations page alongside the rules above; repeat visits are generated straight onto the calendar. */
export const ALWAYS_ON = ['recurring-visits'] as const;

/**
 * Announces an event the way the actions always have. It is handed to the rule engine (src/domain/rules/engine.ts), which
 * runs the coded rules above through their shipped rule definitions and every rule a company built on the same event.
 * New code calls the engine's `emit` directly; this entry stays for the events that were announced here before.
 */
export function emit(d: DemoState, ctx: Ctx, e: AutoEvent) {
  const clientOf = (j: Job) => d.clients.find((c) => c.id === j.clientId);
  switch (e.type) {
    case 'lead.created': return engineEmit(d, ctx, e.type, { ref: { type: 'lead', id: e.lead.id }, lead: e.lead });
    case 'lead.stage': return engineEmit(d, ctx, e.type, { ref: { type: 'lead', id: e.lead.id }, lead: e.lead, extra: { from: e.from, to: e.lead.status } });
    case 'lead.won': return engineEmit(d, ctx, e.type, { ref: { type: 'lead', id: e.lead.id }, lead: e.lead, job: e.job, client: clientOf(e.job) });
    case 'job.status': return engineEmit(d, ctx, e.type, { ref: { type: 'job', id: e.job.id }, job: e.job, client: clientOf(e.job), extra: { from: e.from, to: e.job.status } });
    case 'payment.received': {
      // the payment just recorded is the last one on the job
      const payment = [...e.job.received].reverse().find((p) => Math.abs(p.amount - e.amount) < 0.005) ?? e.job.received[e.job.received.length - 1];
      return engineEmit(d, ctx, e.type, { ref: { type: 'job', id: e.job.id }, job: e.job, client: clientOf(e.job), ...(payment ? { payment } : {}), extra: { amount: e.amount, balance: Math.max(0, e.job.price - sum(e.job.received, (r) => r.amount)) } });
    }
    case 'daily': return engineEmit(d, ctx, e.type, {});
  }
}

/**
 * A fresh demo starts with a few emails already prepared, so Messages shows what the rules produce before the visitor does anything.
 * They use the same wording and the same keys as the rules, so the rules never prepare a duplicate later.
 * Then the rules that count days look at the sample records (an idle lead, an overdue task, a deadline coming up), so the
 * run history shows real runs from the first moment.
 */
export function primeDemo(d: DemoState, ctx: Ctx) {
  if (!d.messages.length) primeEmails(d, ctx);
  // the history a fresh sample starts with is what the rules really do with its records: nothing is typed in
  runTimed(d, ctx);
}
function primeEmails(d: DemoState, ctx: Ctx) {
  const prep = (j: Job | undefined, auto: string, subject: string, bodyKey: string) => {
    if (!j) return;
    const c = d.clients.find((x) => x.id === j.clientId);
    if (!c || c.emailOptOut) return;
    prepareEmail(d, `${auto}:${j.id}`, c.email, subject, ctx.t(bodyKey, { name: firstName(c.name), company: d.company.name, job: j.name }), { type: 'job', id: j.id });
  };
  const done = d.jobs.find((j) => j.status === 'done' && j.price - sum(j.received, (r) => r.amount) > 0);
  const started = d.jobs.find((j) => j.status === 'progress');
  const signed = d.jobs.find((j) => j.status === 'contract');
  if (done) prep(done, 'job-completed', ctx.t('auto.mail.done.subject', { job: done.name }), 'auto.mail.done.bodyBalance');
  if (started) prep(started, 'job-started', ctx.t('auto.mail.started.subject', { job: started.name }), 'auto.mail.started.body');
  if (signed) prep(signed, 'lead-won', ctx.t('auto.mail.welcome.subject', { company: d.company.name }), 'auto.mail.welcome.body');
}
