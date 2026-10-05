// Places where a module adds its own step to something the core does, without the core knowing the module.
// Today there is one: what happens after a lead is won. The rule engine (src/domain/rules) listens to the `lead.won`
// event as well; this list is for steps that must run in the same change, in code (an engagement letter draft, a playbook).
//
// The steps registered at the end of this file are the won-lead workflow of the service catalog. They are driven by data:
// a lead that names no catalog service, or a company that keeps no catalog, passes through untouched, so the field
// editions keep the kickoff tasks of their edition exactly as before. Every step can run again without doing its work twice.
import type { Client, DemoState, Job, Lang, Lead } from './types';
import { type Ctx, logActivity } from './context';
import { makeT } from '@/i18n';
import { addDays, today } from '@/lib/dates';
import { type Service, playbookOf, playbookTasks, serviceName, serviceOf, startPlaybook, tierOf } from './actions/catalog';
import { type Engagement, createJob, fromService, periodFor, repeats } from './actions/jobs';
import { createDocFromTemplate } from './actions/documents';
import { queueMessage } from './actions/messages';
import { createTask } from './actions/tasks';
import { evaluateCrossSell, settleOpportunities, type Opp } from './actions/opportunities';

export interface WonLead { lead: Lead; client: Client; job: Job; /** True when the client record was created by this conversion, false when an existing client was reused. */ newClient: boolean }
export interface WonLeadStep { id: string; run: (d: DemoState, ctx: Ctx, won: WonLead) => void }

/** Runs in order, after the client and the job exist and before the `lead.won` automations. */
export const wonLeadSteps: WonLeadStep[] = [];
/** Adds a step once; adding the same id again replaces it, so a module can be loaded twice without doubling its work. */
export function addWonLeadStep(step: WonLeadStep): void {
  const at = wonLeadSteps.findIndex((s) => s.id === step.id);
  if (at >= 0) wonLeadSteps[at] = step; else wonLeadSteps.push(step);
}

/* ---------- the won-lead workflow of the service catalog ---------- */
/**
 * What one run did, so the last step can write one honest line in the history. Kept while the steps run, never stored.
 * Counted per lead: the steps are handed a fresh description of the win each time, the lead record is what they share.
 */
interface Tally { engagements: number; docs: number; docsPending: number; tasks: number; welcome: boolean }
const tallies = new WeakMap<Lead, Tally>();
const tally = (won: WonLead): Tally => { let x = tallies.get(won.lead); if (!x) { x = { engagements: 0, docs: 0, docsPending: 0, tasks: 0, welcome: false }; tallies.set(won.lead, x); } return x; };

/** The key the welcome email of an engagement has always had, shared with the coded `lead-won` rule so only one of the two is ever prepared. */
export const welcomeKey = (jobId: string) => 'lead-won:' + jobId;
const kickoffKey = (leadId: string) => 'kickoff-appt:' + leadId;
/** Engagements that came from this lead, the one made first leading. */
const jobsOf = (d: DemoState, won: WonLead): Job[] => [won.job, ...d.jobs.filter((j) => j.leadId === won.lead.id && j.id !== won.job.id)];
const logged = (d: DemoState, kind: string, leadId: string) => d.activity.some((a) => a.kind === kind && a.ref.type === 'lead' && a.ref.id === leadId);
const refs = (won: WonLead) => [{ type: 'client' as const, id: won.client.id }, { type: 'job' as const, id: won.job.id }];
/** Fills the merge fields of a welcome message: {{name}}, {{company}}, {{service}}, {{responsible}}. Unknown fields are left as typed. */
export function fillWelcome(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => values[k] ?? m);
}

// (1) The client exists. `convertLead` created or matched it; when an existing client was reused the history says so.
addWonLeadStep({
  id: 'client',
  run(d, _ctx, won) {
    if (won.newClient || logged(d, 'workflow.clientLinked', won.lead.id)) return;
    logActivity(d, 'automation', 'workflow.clientLinked', { type: 'lead', id: won.lead.id }, { client: won.client.name }, [{ type: 'client', id: won.client.id }]);
  },
});

// (2) One engagement per service the lead asked about. `convertLead` made the first; the others are created here, each at
// the price of its first tier. With several services every engagement takes its own tier price (the lead's value was the
// estimate for all of them together); with one, the value agreed on the lead stands.
addWonLeadStep({
  id: 'engagements',
  run(d, ctx, won) {
    const { lead, job, client } = won;
    const services = [...new Set(lead.serviceIds ?? [])].map((id) => serviceOf(d, id)).filter((s): s is Service => !!s);
    if (!services.length) return;
    const first = services.find((s) => s.id === job.serviceId);
    if (first) {
      const eng = job as Engagement; const tier = tierOf(first, job.tierId);
      if (!eng.unit && tier) eng.unit = tier.unit;
      if (!job.period && repeats(job)) job.period = periodFor(job.repeat, job.start || today(), ctx.lang);
    }
    // a retired service is not sold again: it stays on the lead and no engagement is made for it
    const missing = services.filter((s) => s.active && s.id !== job.serviceId && !d.jobs.some((j) => j.leadId === lead.id && j.serviceId === s.id));
    if (missing.length && first) job.price = tierOf(first, job.tierId)?.price ?? job.price;
    for (const s of missing) {
      const from = fromService(d, ctx, s.id);
      if (!from) continue;
      const made = createJob(d, ctx, {
        ...from, name: from.name ?? s.name, clientId: client.id, address: lead.address, status: job.status, leadId: lead.id, managerId: job.managerId,
        period: periodFor(from.repeat, today(), ctx.lang), ...(job.officeId ? { officeId: job.officeId } : {}),
      } as Partial<Engagement> & { name: string; clientId: string });
      // creating an engagement that is under way starts its playbook right there; those tasks belong to this run too
      tally(won).engagements++; tally(won).tasks += playbookTasks(d, made.id).length;
    }
  },
});

// (3) The documents each service lists (an engagement letter, a service order). The documents module writes them from the
// company's template; when it has none for a kind, nothing is made up here and the history says a document is still to be prepared.
addWonLeadStep({
  id: 'documents',
  run(d, ctx, won) {
    for (const j of jobsOf(d, won)) {
      for (const kind of serviceOf(d, j.serviceId)?.docKinds ?? []) {
        if (d.docs.some((x) => x.jobId === j.id && x.kind === kind && x.status !== 'void')) continue;
        const doc = createDocFromTemplate(d, ctx, { kind, clientId: j.clientId, jobId: j.id, leadId: won.lead.id });
        if (doc) tally(won).docs++; else tally(won).docsPending++;
      }
    }
  },
});

// (4) The playbook of each service: its tasks, once per engagement.
addWonLeadStep({
  id: 'playbook',
  run(d, ctx, won) { for (const j of jobsOf(d, won)) tally(won).tasks += startPlaybook(d, ctx, j.id).length; },
});

// (5) The welcome message of the playbook, in the client's language, as a draft for a person to review. Nothing is sent from here.
addWonLeadStep({
  id: 'welcome',
  run(d, ctx, won) {
    const { client, lead } = won;
    for (const j of jobsOf(d, won)) {
      const service = serviceOf(d, j.serviceId); const pb = playbookOf(d, service?.playbookId);
      if (!service || !pb || !pb.active || !pb.welcome) continue;
      if (d.messages.some((m) => m.auto === welcomeKey(j.id)) || !client.email) return;
      const lang: Lang = client.lang ?? lead.lang ?? ctx.lang;
      const t = lang === ctx.lang ? ctx.t : makeT(lang, ctx.pack, d.config);
      const body = fillWelcome(pb.welcomeI18n?.[lang] || pb.welcome, {
        name: client.name.split(' ')[0], company: d.company.name, service: serviceName(service, lang), responsible: d.users.find((u) => u.id === j.managerId)?.name ?? d.company.name,
      });
      const res = queueMessage(d, ctx, { channel: 'email', to: client.email, subject: t('auto.mail.welcome.subject', { company: d.company.name }), body, ref: { type: 'job', id: j.id }, clientId: client.id, auto: welcomeKey(j.id), mode: 'draft' });
      if (res.ok) tally(won).welcome = true;
      // one welcome per client, from the first service that has one
      return;
    }
  },
});

// (6) The kickoff appointment. A time is never booked for the client from here: when the service calls for an appointment
// and the lead did not already have one, a task asks the person responsible to schedule it. An appointment the lead
// already had is linked to the client and the engagement instead.
addWonLeadStep({
  id: 'appointment',
  run(d, ctx, won) {
    const { lead, client } = won;
    const j = jobsOf(d, won).find((x) => { const id = serviceOf(d, x.serviceId)?.appointmentTypeId; return !!id && (d.apptTypes ?? []).some((a) => a.id === id && a.active); });
    if (!j) return;
    const booked = (d.appointments ?? []).filter((a) => a.leadId === lead.id && !a.status.startsWith('cancelled'));
    for (const a of booked) { if (!a.clientId) a.clientId = client.id; if (!a.jobId) a.jobId = j.id; }
    if (booked.length || lead.apptDate || d.tasks.some((x) => x.auto === kickoffKey(lead.id))) return;
    const type = d.apptTypes.find((a) => a.id === serviceOf(d, j.serviceId)?.appointmentTypeId);
    createTask(d, ctx, {
      title: ctx.t('jobs.wf.kickoffAppt'), description: type ? ctx.t('jobs.wf.kickoffApptFor', { type: type.name[ctx.lang] ?? type.name.en, name: client.name }) : undefined,
      clientId: client.id, jobId: j.id, assignee: 'u:' + j.managerId, due: addDays(2), pri: 'high', auto: kickoffKey(lead.id),
    });
    tally(won).tasks++;
  },
});

// The sale settles what was suggested: an opportunity that became this lead, or was open for one of these services, is
// won, and the cross-sell rules look at the client again now that they have something new.
addWonLeadStep({
  id: 'opportunities',
  run(d, ctx, won) {
    for (const o of (d.opportunities ?? []) as Opp[]) if (o.leadId === won.lead.id && o.status !== 'won') { o.status = 'won'; o.jobId = won.job.id; o.followUp = undefined; }
    for (const j of jobsOf(d, won)) if (j.serviceId) settleOpportunities(d, ctx, j.clientId, j.serviceId, j.id);
    evaluateCrossSell(d, ctx, won.client.id);
  },
});

// (7) One line in the history for what this run did. A run that had nothing to do writes nothing.
addWonLeadStep({
  id: 'activity',
  run(d, _ctx, won) {
    const x = tally(won);
    if (x.engagements || x.docs || x.tasks || x.welcome) logActivity(d, 'automation', 'workflow.won', { type: 'lead', id: won.lead.id }, { engagements: 1 + x.engagements, docs: x.docs, tasks: x.tasks }, refs(won));
    if (x.welcome) logActivity(d, 'automation', 'workflow.welcome', { type: 'lead', id: won.lead.id }, undefined, refs(won));
    if (x.docsPending && !logged(d, 'workflow.docsPending', won.lead.id)) logActivity(d, 'automation', 'workflow.docsPending', { type: 'lead', id: won.lead.id }, { n: x.docsPending }, refs(won));
    tallies.delete(won.lead);
  },
});
