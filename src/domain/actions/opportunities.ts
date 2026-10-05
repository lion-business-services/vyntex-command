// Cross-sell: rules that notice a service a client could use and does not have yet, and the opportunities they create.
// A rule is data the company edits (which services trigger it, which one to suggest, when not to): nothing here knows a
// service by name or code. `evaluateCrossSell` runs once a day and after an engagement is created; it never suggests the
// same service to the same client twice.
import type { Client, CrossSellRule, DemoState, ISODate, Job, Lead, Opportunity, RuleEvent } from '../types';
import { type Ctx, logActivity } from '../context';
import { emit } from '../rules/engine';
import { sourcesOf } from '../config';
import { addDaysFrom, today } from '@/lib/dates';
import { uid } from '@/lib/id';
import { serviceName, serviceOf, tierOf } from './catalog';
import { createJob, fromService, periodFor, type Engagement } from './jobs';
import { createLead } from './leads';
import { createTask } from './tasks';

/** What an opportunity keeps on top of the shared model: when to come back to it, and the engagement it became. The database keeps unknown fields. */
export type Opp = Opportunity & { /** Hidden from the open list until this day ("follow up later"). */ followUp?: ISODate; jobId?: string };

/* ---------- what a client has ---------- */
/**
 * The catalog services a client has, with the day each began (the earliest engagement that is past the proposal), and
 * the ones that were only proposed so far. A proposed service is not suggested again, and does not trigger a rule either.
 */
export function clientServices(d: Pick<DemoState, 'jobs'>, clientId: string): { has: Map<string, ISODate>; proposed: Set<string> } {
  const has = new Map<string, ISODate>(); const proposed = new Set<string>();
  for (const j of d.jobs) {
    if (j.clientId !== clientId || !j.serviceId) continue;
    if (j.status === 'estimate') { proposed.add(j.serviceId); continue; }
    const since = j.start || j.created; const cur = has.get(j.serviceId);
    if (!cur || since < cur) has.set(j.serviceId, since);
  }
  return { has, proposed };
}

/** Whether a rule applies to a client today: the right kind of client, has a triggering service long enough, and has neither the suggested service nor one that rules it out. */
export function ruleMatches(d: DemoState, rule: CrossSellRule, c: Client, day: ISODate = today()): boolean {
  const suggest = serviceOf(d, rule.suggestServiceId);
  // a retired service is not offered to anyone new
  if (!suggest || !suggest.active) return false;
  if (c.lifecycle === 'former') return false;
  if (rule.clientKind && c.kind !== rule.clientKind) return false;
  const { has, proposed } = clientServices(d, c.id);
  const got = (id: string) => has.has(id) || proposed.has(id);
  if (got(rule.suggestServiceId) || (rule.unlessServiceIds ?? []).some(got)) return false;
  const triggers = rule.whenServiceIds.filter((id) => has.has(id));
  if (rule.whenServiceIds.length && !triggers.length) return false;
  if (rule.delayDays && rule.delayDays > 0) {
    // counted from the first engagement that triggers the rule, or from the day they became a client when the rule names no service
    const from = triggers.length ? triggers.map((id) => has.get(id) as ISODate).sort()[0] : c.since;
    if (!from || addDaysFrom(from, rule.delayDays) > day) return false;
  }
  return true;
}
/** The clients a rule applies to today, whether or not it already suggested something to them. */
export const clientsMatching = (d: DemoState, rule: CrossSellRule): Client[] => d.clients.filter((c) => ruleMatches(d, rule, c));

/**
 * Tells the rule engine an opportunity was opened, so a company's rules can react (a task to call the client, a note to
 * someone). The daily routine announces every open opportunity again; the engine acts once per opportunity.
 */
function announce(d: DemoState, ctx: Ctx, o: Opportunity) {
  const service = serviceOf(d, o.serviceId);
  emit(d, ctx, 'opportunity.created' as RuleEvent, { ref: { type: 'opportunity', id: o.id }, client: d.clients.find((c) => c.id === o.clientId), extra: { serviceId: o.serviceId, service: service ? serviceName(service, ctx.lang) : '' } });
}

/* ---------- the engine ---------- */
/**
 * Runs the active rules over every client (or one) and creates an opportunity for each match. One suggestion per client
 * and service, ever: an opportunity that is open, was won or was dismissed is not created again, so dismissing means
 * "do not suggest this again". Returns the opportunities created. Safe to call as often as needed.
 */
export function evaluateCrossSell(d: DemoState, ctx: Ctx, clientId?: string): Opportunity[] {
  const rules = (d.crossSell ?? []).filter((r) => r.active);
  if (!rules.length) return [];
  const made: Opportunity[] = [];
  const clients = clientId ? d.clients.filter((c) => c.id === clientId) : d.clients;
  for (const c of clients) for (const rule of rules) {
    if ((d.opportunities ?? []).some((o) => o.clientId === c.id && o.serviceId === rule.suggestServiceId)) continue;
    if (!ruleMatches(d, rule, c)) continue;
    const service = serviceOf(d, rule.suggestServiceId)!;
    const o: Opportunity = { id: uid('op'), clientId: c.id, serviceId: service.id, ruleId: rule.id, status: 'open', created: today(), by: 'automation', value: tierOf(service)?.price ?? 0, ...(rule.note ? { note: rule.note } : {}) };
    d.opportunities = [o, ...(d.opportunities ?? [])];
    made.push(o);
    logActivity(d, 'automation', 'opportunity.created', { type: 'opportunity', id: o.id }, { service: serviceName(service, ctx.lang), rule: rule.name }, [{ type: 'client', id: c.id }]);
    announce(d, ctx, o);
  }
  return made;
}

/* ---------- rules ---------- */
export type CrossSellInput = Omit<CrossSellRule, 'id'>;
/** Adds a rule or saves changes to one. A rule needs a name and a service to suggest; a service cannot trigger or block its own suggestion. */
export function saveCrossSellRule(d: DemoState, _ctx: Ctx, input: CrossSellInput, id?: string): CrossSellRule | null {
  const name = input.name.trim();
  if (!name || !serviceOf(d, input.suggestServiceId)) return null;
  const known = (ids: string[] | undefined) => [...new Set(ids ?? [])].filter((x) => x !== input.suggestServiceId && !!serviceOf(d, x));
  const unless = known(input.unlessServiceIds); const when = known(input.whenServiceIds).filter((x) => !unless.includes(x));
  const body: CrossSellInput = {
    name, whenServiceIds: when, suggestServiceId: input.suggestServiceId, active: input.active !== false,
    ...(unless.length ? { unlessServiceIds: unless } : {}), ...(input.clientKind ? { clientKind: input.clientKind } : {}),
    ...(input.delayDays && input.delayDays > 0 ? { delayDays: Math.round(input.delayDays) } : {}), ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  };
  const cur = id ? (d.crossSell ?? []).find((r) => r.id === id) : undefined;
  if (id && !cur) return null;
  if (cur) { d.crossSell = d.crossSell.map((r) => (r.id === id ? { id: r.id, ...body } : r)); return d.crossSell.find((r) => r.id === id) ?? null; }
  const rule: CrossSellRule = { id: uid('cs'), ...body };
  d.crossSell = [...(d.crossSell ?? []), rule];
  return rule;
}
/** Removes a rule. The opportunities it created stay as they are. */
export function deleteCrossSellRule(d: DemoState, _ctx: Ctx, id: string) { d.crossSell = (d.crossSell ?? []).filter((r) => r.id !== id); }
export function setCrossSellRuleActive(d: DemoState, _ctx: Ctx, id: string, active: boolean) { d.crossSell = (d.crossSell ?? []).map((r) => (r.id === id ? { ...r, active } : r)); }

/* ---------- opportunities ---------- */
const find = (d: DemoState, id: string): Opp | undefined => (d.opportunities ?? []).find((o) => o.id === id);
const touch = (d: DemoState) => { d.opportunities = [...(d.opportunities ?? [])]; };
const isOpen = (o: Opportunity) => o.status === 'open' || o.status === 'contacted';

/** An opportunity a person noticed. When one is already open for the same client and service, that one is returned instead of a second. */
export function addOpportunity(d: DemoState, ctx: Ctx, input: { clientId: string; serviceId: string; note?: string }): Opportunity | null {
  const service = serviceOf(d, input.serviceId); const client = d.clients.find((c) => c.id === input.clientId);
  if (!service || !client) return null;
  const open = (d.opportunities ?? []).find((o) => o.clientId === client.id && o.serviceId === service.id && isOpen(o));
  if (open) return open;
  const o: Opportunity = { id: uid('op'), clientId: client.id, serviceId: service.id, status: 'open', created: today(), by: ctx.actor, value: tierOf(service)?.price ?? 0, ...(input.note?.trim() ? { note: input.note.trim() } : {}) };
  d.opportunities = [o, ...(d.opportunities ?? [])];
  logActivity(d, ctx.actor, 'opportunity.created', { type: 'opportunity', id: o.id }, { service: serviceName(service, ctx.lang), rule: '' }, [{ type: 'client', id: client.id }]);
  announce(d, ctx, o);
  return o;
}

/** Records how it went: talked to the client (`contacted`), they bought (`won`), or it is not for them (`dismissed`, with the reason). `open` reopens one. */
export function setOpportunityStatus(d: DemoState, ctx: Ctx, id: string, status: Opportunity['status'], reason?: string) {
  const o = find(d, id); if (!o || o.status === status) return;
  o.status = status; o.followUp = undefined;
  o.dismissedReason = status === 'dismissed' ? reason?.trim() || undefined : undefined;
  touch(d);
  logActivity(d, ctx.actor, 'opportunity.' + status, { type: 'opportunity', id }, { service: nameOf(d, ctx, o), reason: o.dismissedReason ?? '' }, [{ type: 'client', id: o.clientId }]);
}
const nameOf = (d: DemoState, ctx: Ctx, o: Opportunity) => { const s = serviceOf(d, o.serviceId); return s ? serviceName(s, ctx.lang) : ''; };

/** "Follow up later": the opportunity leaves the open list until the day given, and a task can remind whoever looks after the client. */
export function snoozeOpportunity(d: DemoState, ctx: Ctx, id: string, until: ISODate, withTask: boolean) {
  const o = find(d, id); if (!o || !isOpen(o) || !until) return;
  o.followUp = until; touch(d);
  const c = d.clients.find((x) => x.id === o.clientId);
  if (withTask && c) {
    const who = d.users.find((u) => u.id === c.assignedTo && u.active !== false)?.id ?? ctx.actor;
    createTask(d, ctx, { title: ctx.t('opportunities.task.follow', { service: nameOf(d, ctx, o), name: c.name }), clientId: c.id, assignee: 'u:' + who, due: until, pri: 'medium', type: 'call' in typeIds(ctx) ? 'call' : undefined });
  }
  logActivity(d, ctx.actor, 'opportunity.later', { type: 'opportunity', id }, { service: nameOf(d, ctx, o), date: until }, [{ type: 'client', id: o.clientId }]);
}
const typeIds = (ctx: Ctx): Record<string, true> => Object.fromEntries(ctx.pack.taskTypes.map((x) => [x.id, true as const]));

/**
 * Puts the opportunity in the pipeline as a lead for the same client, so it is worked like any other sale: the lead
 * points at the client (winning it never creates a second client record) and at the service. Done once per opportunity.
 */
export function opportunityToLead(d: DemoState, ctx: Ctx, id: string): Lead | null {
  const o = find(d, id); if (!o) return null;
  const linked = d.leads.find((l) => l.id === o.leadId); if (linked) return linked;
  const c = d.clients.find((x) => x.id === o.clientId); const service = serviceOf(d, o.serviceId);
  if (!c || !service) return null;
  const types = ctx.pack.serviceTypes.map((x) => x.id); const sources = sourcesOf(d, ctx.pack).map((x) => x.id);
  const owner = d.users.find((u) => u.id === c.assignedTo && u.active !== false)?.id;
  const lead = createLead(d, ctx, {
    name: c.name, company: c.company, phone: c.phone, email: c.email, address: c.addresses[0] ?? '', pri: 'medium', value: o.value ?? tierOf(service)?.price ?? null,
    type: types.includes(service.category) ? service.category : types.includes('other') ? 'other' : types[0],
    source: sources.includes('existing_client') ? 'existing_client' : sources.includes('referral') ? 'referral' : sources[0],
    clientId: c.id, serviceIds: [service.id], ...(owner ? { ownerId: owner } : {}), ...(c.kind ? { kind: c.kind } : {}), ...(c.lang ? { lang: c.lang } : {}), ...(c.officeId ? { officeId: c.officeId } : {}),
    firstNote: [ctx.t('opportunities.lead.note', { service: serviceName(service, ctx.lang) }), o.note].filter(Boolean).join(' '),
  });
  o.leadId = lead.id; o.followUp = undefined; if (o.status === 'open') o.status = 'contacted';
  touch(d);
  logActivity(d, ctx.actor, 'opportunity.lead', { type: 'opportunity', id }, { service: serviceName(service, ctx.lang) }, [{ type: 'client', id: c.id }, { type: 'lead', id: lead.id }]);
  return lead;
}

/** The client said yes: the engagement is created from the suggested service (first price tier unless another is named) and the opportunity is won. */
export function opportunityToEngagement(d: DemoState, ctx: Ctx, id: string, tierId?: string): Job | null {
  const o = find(d, id); if (!o) return null;
  const done = d.jobs.find((j) => j.id === o.jobId); if (done) return done;
  const c = d.clients.find((x) => x.id === o.clientId); const from = fromService(d, ctx, o.serviceId, tierId);
  if (!c || !from) return null;
  const manager = d.users.find((u) => u.id === c.assignedTo && u.active !== false)?.id;
  const job = createJob(d, ctx, {
    ...from, name: from.name ?? '', clientId: c.id, address: c.addresses[0] ?? '', status: 'contract', period: periodFor(from.repeat, today(), ctx.lang),
    ...(manager ? { managerId: manager } : {}), ...(c.officeId ? { officeId: c.officeId } : {}),
  } as Partial<Engagement> & { name: string; clientId: string });
  // createJob already settled it; this covers an opportunity that was dismissed and is being taken up after all
  if (o.status !== 'won') { o.status = 'won'; o.jobId = job.id; o.followUp = undefined; o.dismissedReason = undefined; touch(d); }
  return job;
}

/** A client who now has the service no longer needs the suggestion: every open opportunity for that service is marked won. */
export function settleOpportunities(d: DemoState, ctx: Ctx, clientId: string, serviceId: string, jobId?: string) {
  let changed = false;
  for (const o of (d.opportunities ?? []) as Opp[]) {
    if (o.clientId !== clientId || o.serviceId !== serviceId || !isOpen(o)) continue;
    o.status = 'won'; o.followUp = undefined; if (jobId) o.jobId = jobId; changed = true;
    logActivity(d, 'automation', 'opportunity.won', { type: 'opportunity', id: o.id }, { service: nameOf(d, ctx, o), reason: '' }, [{ type: 'client', id: clientId }]);
  }
  if (changed) touch(d);
}
