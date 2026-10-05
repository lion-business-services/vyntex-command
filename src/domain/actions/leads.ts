// Leads: from the first contact to won or lost. Stages come from the company's configuration (src/domain/config.ts), so
// nothing here knows a stage by name: it asks what part a stage plays (new, visit set, proposal out) and whether it is
// open, won or lost.
// Also here: whose turn it is to take a new lead, handing a lead to someone else, and the company's own pipeline settings
// (stages, sources, lost reasons, routing).
import type { Client, DemoState, Handoff, Job, Lead, LeadRouting, LeadStage, OptionDef, StageDef, TeamUser } from '../types';
import { type Ctx, logActivity } from '../context';
// every lead event goes to the rule engine, which runs the shipped rules (intake, visit preparation, proposal follow-up,
// won lead) and whatever the company built on the same events
import { emit } from '../rules/engine';
import { firstStage, isLost, isOpen, isWon, permissionsOf, routingOf, stageByRole, stageRole, stagesOf, wonStage } from '../config';
import type { IndustryPack } from '@/packs/types';
import { wonLeadSteps } from '../workflows';
import { nowIso, today } from '@/lib/dates';
import { uid } from '@/lib/id';
import { blankJob } from './jobs';
import { normEmail, normPhone } from './clients';

const leadRef = (l: Lead) => ({ type: 'lead' as const, id: l.id });

export function nextTicket(d: DemoState, ctx: Ctx): string {
  const n = d.leads.map((l) => parseInt(String(l.ticket).replace(/\D/g, ''), 10) || 0);
  return ctx.pack.ticketPrefix + (Math.max(1000, ...n) + 1);
}

/** `ownerId` may be left out: the next person in turn takes the lead when the company assigns leads automatically. */
export type NewLead = Omit<Lead, 'id' | 'ticket' | 'created' | 'notes' | 'status' | 'ownerId'> & { ownerId?: string; firstNote?: string; status?: LeadStage };

export function createLead(d: DemoState, ctx: Ctx, input: NewLead): Lead {
  const { firstNote, ...rest } = input;
  const first = firstStage(d, ctx.pack).id;
  const visit = stageByRole(d, ctx.pack, 'visit');
  const lead: Lead = { ...rest, ownerId: input.ownerId ?? '', id: uid('l'), ticket: nextTicket(d, ctx), created: today(), status: input.status ?? first, notes: [] };
  if (firstNote) lead.notes.push({ id: uid('n'), at: nowIso(), kind: 'note', text: firstNote, pin: true, by: ctx.actor });
  // a lead that arrives with a visit date is already past "new"
  if (lead.apptDate && lead.status === first && visit) lead.status = visit.id;
  // Nobody was chosen: the next person in turn takes it, and when the company assigns by hand, its fallback person does.
  // Every way a lead comes in (the form, the website, the assistant, an import) passes through here, so they all agree.
  if (!lead.ownerId) {
    const turn = routingOf(d).mode === 'round_robin' ? takeTurn(d, ctx) : fallbackTurn(d, ctx.pack);
    if (turn) { lead.ownerId = turn.userId; lead.originalOwnerId = turn.userId; lead.handoffs = [{ id: uid('h'), at: nowIso(), from: '', to: turn.userId, by: 'automation', how: turn.how === 'round_robin' ? 'round_robin' : 'rule' }]; }
  }
  d.leads.unshift(lead);
  logActivity(d, ctx.actor, 'lead.created', leadRef(lead), { lead: lead.name, source: ctx.t('src_' + lead.source) });
  emit(d, ctx, 'lead.created', { ref: leadRef(lead), lead });
  if (visit && lead.status === visit.id) emit(d, ctx, 'lead.stage', { ref: leadRef(lead), lead, extra: { from: first, to: lead.status } });
  return lead;
}
export function updateLead(d: DemoState, ctx: Ctx, id: string, patch: Partial<Lead>) {
  const l = d.leads.find((x) => x.id === id); if (!l) return;
  const before = l.status;
  Object.assign(l, patch);
  // setting a visit date moves a lead that had not got that far to the visit stage
  const visit = stageByRole(d, ctx.pack, 'visit'); const part = stageRole(d, ctx.pack, l.status);
  if (patch.apptDate && visit && (part === 'new' || part === 'contacted')) l.status = visit.id;
  if (l.status !== before) stageChanged(d, ctx, l, before);
}
function stageChanged(d: DemoState, ctx: Ctx, l: Lead, from: string) {
  const lost = isLost(d, ctx.pack, l.status);
  if (lost) l.lostAt = today(); else if (l.lostAt) { l.lostAt = undefined; l.lostReason = undefined; }
  logActivity(d, ctx.actor, lost ? 'lead.lost' : 'lead.stage', leadRef(l), { stage: ctx.t('ls_' + l.status) });
  emit(d, ctx, 'lead.stage', { ref: leadRef(l), lead: l, extra: { from, to: l.status } });
  if (lost) emit(d, ctx, 'lead.lost', { ref: leadRef(l), lead: l, extra: { from, reason: l.lostReason ?? '' } });
}
export function setLeadStage(d: DemoState, ctx: Ctx, id: string, stage: LeadStage) {
  const l = d.leads.find((x) => x.id === id); if (!l || l.status === stage) return;
  if (isWon(d, ctx.pack, stage)) { convertLead(d, ctx, id, stage); return; }
  const from = l.status; l.status = stage; stageChanged(d, ctx, l, from);
}
/**
 * Files a lead as lost, with the reason. `reason` is an id from the company's list of lost reasons (kept as the id, so
 * reports can count by reason and the label follows the language); what the person adds in their own words is kept as a
 * note on the lead. A lead that is already lost only gets its reason updated.
 */
export function markLeadLost(d: DemoState, ctx: Ctx, id: string, stage: LeadStage, reason: string, detail?: string) {
  const l = d.leads.find((x) => x.id === id); if (!l || !isLost(d, ctx.pack, stage)) return;
  l.lostReason = reason || undefined;
  if (detail?.trim()) l.notes.unshift({ id: uid('n'), at: nowIso(), kind: 'note', text: detail.trim(), by: ctx.actor });
  if (l.status === stage) return;
  const from = l.status; l.status = stage; stageChanged(d, ctx, l, from);
}
/** What happens next with a lead, and by when. An empty text clears it. */
export function setNextAction(d: DemoState, ctx: Ctx, id: string, text: string, due?: string) {
  const l = d.leads.find((x) => x.id === id); if (!l) return;
  const clean = text.trim();
  l.nextAction = clean ? { text: clean, ...(due ? { due } : {}) } : undefined;
  logActivity(d, ctx.actor, clean ? 'lead.next' : 'lead.nextCleared', leadRef(l), clean ? { text: clean.slice(0, 80) } : undefined);
}
export function deleteLead(d: DemoState, _ctx: Ctx, id: string) {
  d.leads = d.leads.filter((l) => l.id !== id); d.tasks = d.tasks.filter((t) => t.leadId !== id);
}

const digits = (s: string | undefined) => (s || '').replace(/\D/g, '');
const same = (a: string | undefined, b: string | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
/**
 * The client a lead belongs to, so winning a lead never creates a second record for someone the company already serves.
 * Matched in this order: the client the lead already points at, the same email, the same phone number, then the exact
 * same name at the same address. A name alone is not enough: two people can share one.
 */
export function matchClient(d: DemoState, l: Lead): Client | undefined {
  return d.clients.find((c) => c.id === l.clientId)
    ?? d.clients.find((c) => same(c.email, l.email))
    ?? d.clients.find((c) => digits(l.phone).length >= 7 && normPhone(c.phone) === normPhone(l.phone))
    ?? d.clients.find((c) => same(c.name, l.name) && (l.address ? c.addresses.some((a) => same(a, l.address)) : c.addresses.length === 0));
}
function clientForLead(d: DemoState, ctx: Ctx, l: Lead): { client: Client; created: boolean } {
  const hit = matchClient(d, l);
  if (hit) { if (l.address && !hit.addresses.some((a) => same(a, l.address))) hit.addresses.push(l.address); return { client: hit, created: false }; }
  const c: Client = { id: uid('c'), name: l.name, company: l.company, phone: l.phone, email: l.email, addresses: l.address ? [l.address] : [], since: today(), notes: [] };
  // what the lead already told us about the person carries over
  if (l.kind) c.kind = l.kind;
  if (l.lang) c.lang = l.lang;
  if (l.smsOptIn !== undefined) c.smsOptIn = l.smsOptIn;
  if (l.officeId) c.officeId = l.officeId;
  if (l.ownerId) c.assignedTo = l.ownerId;
  // the name written next to a referral is who sent them
  if (l.sourceDetail && l.source === 'referral') c.referredBy = l.sourceDetail;
  d.clients.unshift(c);
  logActivity(d, 'automation', 'client.created', { type: 'client', id: c.id });
  emit(d, ctx, 'client.created', { ref: { type: 'client', id: c.id }, client: c, lead: l });
  return { client: c, created: true };
}
/**
 * Won lead: creates (or links) the client and the job, carries the notes over and starts the kickoff workflow.
 * When the lead names a catalog service, the job is the engagement for the first one: its name, price, tier and schedule.
 * `stage` is the won stage to file the lead under, for a company with more than one.
 */
export function convertLead(d: DemoState, ctx: Ctx, id: string, stage?: LeadStage): Job | null {
  const l = d.leads.find((x) => x.id === id); if (!l) return null;
  if (l.jobId) return d.jobs.find((j) => j.id === l.jobId) ?? null;
  const from = l.status;
  const { client, created } = clientForLead(d, ctx, l);
  const service = (d.catalog ?? []).find((s) => s.id === l.serviceIds?.[0]);
  const tier = service?.tiers[0];
  const job = blankJob(d, ctx, {
    name: service ? service.i18n?.[ctx.lang]?.name ?? service.name : ctx.t('ty_' + l.type),
    clientId: client.id, address: l.address, type: l.type, price: Number(l.value) || tier?.price || 0, status: 'contract', leadId: l.id,
    ...(l.ownerId ? { managerId: l.ownerId } : {}),
    ...(service ? { serviceId: service.id, tierId: tier?.id, repeat: service.repeat ?? 'once' } : {}),
    ...(l.officeId ? { officeId: l.officeId } : {}),
  });
  job.notes = l.notes.map((n) => ({ ...n, id: uid('n') }));
  d.jobs.unshift(job);
  l.status = stage && isWon(d, ctx.pack, stage) ? stage : wonStage(d, ctx.pack)?.id ?? l.status;
  l.clientId = client.id; l.jobId = job.id;
  // a lead that was lost and is won after all is no longer lost
  l.lostAt = undefined; l.lostReason = undefined;
  logActivity(d, ctx.actor, 'lead.won', leadRef(l), undefined, [{ type: 'client', id: client.id }]);
  logActivity(d, ctx.actor, 'job.created', { type: 'job', id: job.id }, { job: job.name }, [{ type: 'client', id: client.id }]);
  for (const step of wonLeadSteps) step.run(d, ctx, { lead: l, client, job, newClient: created });
  emit(d, ctx, 'lead.won', { ref: leadRef(l), lead: l, client, job, extra: { from, to: l.status, newClient: created } });
  return job;
}

/* ---------- has this person already written to us? ---------- */

export interface LeadMatch { lead: Lead; by: ('email' | 'phone')[] }
/** Leads with the same email or phone, open ones first. The person decides whether the new one is really new. */
export function findLeadMatches(d: Pick<DemoState, 'leads' | 'config'>, pack: IndustryPack, probe: { email?: string; phone?: string }, excludeId?: string): LeadMatch[] {
  const email = normEmail(probe.email); const phone = normPhone(probe.phone);
  if (!email && phone.length < 7) return [];
  const out: LeadMatch[] = [];
  for (const l of d.leads) {
    if (l.id === excludeId) continue;
    const by: LeadMatch['by'] = [];
    if (email && normEmail(l.email) === email) by.push('email');
    if (phone.length >= 7 && normPhone(l.phone) === phone) by.push('phone');
    if (by.length) out.push({ lead: l, by });
  }
  return out.sort((a, b) => Number(isOpen(d, pack, b.lead.status)) - Number(isOpen(d, pack, a.lead.status)) || b.lead.created.localeCompare(a.lead.created));
}

/* ---------- who gets a lead ---------- */

const isAway = (u: TeamUser, day: string) => !!u.away && u.away.from <= day && day <= u.away.to;
/** Someone who can be given a lead at all: still with the company, and in a role that may work leads and change records. */
function worksLeads(d: DemoState, pack: IndustryPack, id: string | undefined): TeamUser | undefined {
  const u = d.users.find((x) => x.id === id && x.active !== false);
  if (!u) return undefined;
  const perms = permissionsOf(d, pack, u.role);
  return perms.includes('leads') && perms.includes('write') ? u : undefined;
}
/**
 * Whether a person takes their turn today. The same test as the database (app.lead_pool_eligible): works leads, not
 * excluded, did not opt out of the pool, and not away when the company skips people who are away.
 */
export function takesTurn(d: DemoState, pack: IndustryPack, id: string, r: LeadRouting = routingOf(d), day: string = today()): boolean {
  const u = worksLeads(d, pack, id);
  return !!u && !r.exclude.includes(id) && u.inLeadPool !== false && !(r.skipAway && isAway(u, day));
}
/** Why a person in the pool is passed over today, for the settings screen. Null when they take their turn. */
export function skipReason(d: DemoState, pack: IndustryPack, id: string, r: LeadRouting = routingOf(d)): 'gone' | 'role' | 'excluded' | 'opted_out' | 'away' | null {
  const u = d.users.find((x) => x.id === id);
  if (!u || u.active === false) return 'gone';
  if (!worksLeads(d, pack, id)) return 'role';
  if (r.exclude.includes(id)) return 'excluded';
  if (u.inLeadPool === false) return 'opted_out';
  if (r.skipAway && isAway(u, today())) return 'away';
  return null;
}
export interface Turn { userId: string; how: 'round_robin' | 'fallback' | 'owner'; /** Where the cursor stands after this turn. */ cursor: number }
/** Who is at a position of the rotation, without moving it. */
function turnFrom(d: DemoState, pack: IndustryPack, r: LeadRouting, cursor: number): Turn | null {
  const n = r.pool.length; const day = today();
  for (let i = 0; i < n; i++) {
    const at = (((cursor + i) % n) + n) % n;
    if (takesTurn(d, pack, r.pool[at], r, day)) return { userId: r.pool[at], how: 'round_robin', cursor: (at + 1) % n };
  }
  return null;
}
/** The person who takes a lead when the rotation cannot: the company's fallback person. */
function fallbackTurn(d: DemoState, pack: IndustryPack): Turn | null {
  const r = routingOf(d);
  const u = worksLeads(d, pack, r.fallbackId);
  return u ? { userId: u.id, how: 'fallback', cursor: r.cursor } : null;
}
/**
 * The next people to be given a lead, in order, without taking a turn: what the settings screen shows as "who is next".
 * With manual assignment, or when nobody in the pool can take a lead, the list holds the fallback person alone, or nobody.
 */
export function upcomingTurns(d: DemoState, pack: IndustryPack, count = 3): Turn[] {
  const r = routingOf(d); const out: Turn[] = [];
  if (r.mode === 'round_robin') {
    let cursor = r.cursor;
    for (let i = 0; i < count; i++) { const t = turnFrom(d, pack, r, cursor); if (!t) break; out.push(t); cursor = t.cursor; }
  }
  if (!out.length) { const f = fallbackTurn(d, pack); if (f) out.push(f); }
  return out;
}
/** Takes the next turn and moves the rotation on. Falls back to the fallback person, then to an owner of the company. */
function takeTurn(d: DemoState, ctx: Ctx): Turn | null {
  const r = routingOf(d);
  const t = turnFrom(d, ctx.pack, r, r.cursor);
  if (t) { d.config = { ...d.config, routing: { ...r, cursor: t.cursor } }; return t; }
  const f = fallbackTurn(d, ctx.pack);
  if (f) return f;
  const owner = d.users.find((u) => u.role === 'owner' && u.active !== false);
  return owner ? { userId: owner.id, how: 'owner', cursor: r.cursor } : null;
}
/**
 * Whose turn it is to take a new lead. Walks the pool in order from the cursor, skipping people who are excluded, no longer
 * active, read only, opted out, or away (when the company chose to skip them), and moves the cursor past whoever is picked
 * so the next lead goes to the next person. When nobody in the pool can take it, the fallback person gets it, then an owner.
 * Returns the TeamUser id, or null when the company has nobody at all. In a live workspace the server takes the turn under a
 * lock (`lead_assign_next`), so two leads arriving together never get the same one.
 */
export function assignNextLead(d: DemoState, ctx: Ctx): string | null {
  return takeTurn(d, ctx)?.userId ?? null;
}
/**
 * Gives one lead to whoever is next, the way the server does (`lead_assign_next` for a lead): a lead that already has an
 * owner who is still with the company keeps them and no turn is used, so asking twice never skips anyone.
 */
export function assignLeadTurn(d: DemoState, ctx: Ctx, leadId: string): { userId: string | null; how: Turn['how'] | 'kept' | null } {
  const l = d.leads.find((x) => x.id === leadId);
  if (!l) return { userId: null, how: null };
  if (l.ownerId && d.users.some((u) => u.id === l.ownerId && u.active !== false)) return { userId: l.ownerId, how: 'kept' };
  const turn = takeTurn(d, ctx);
  if (!turn) return { userId: null, how: null };
  handoffLead(d, ctx, leadId, turn.userId, undefined, turn.how === 'round_robin' ? 'round_robin' : 'rule');
  return { userId: turn.userId, how: turn.how };
}
/**
 * Gives a lead to someone else and keeps the trail: who had it, who has it now, who decided and why. The first owner is
 * remembered in `originalOwnerId`. The lead's open tasks that belonged to the previous owner move with it.
 */
export function handoffLead(d: DemoState, ctx: Ctx, leadId: string, toUserId: string, reason?: string, how: Handoff['how'] = 'manual'): Handoff | null {
  const l = d.leads.find((x) => x.id === leadId); const to = d.users.find((u) => u.id === toUserId);
  if (!l || !to || l.ownerId === toUserId) return null;
  // a turn of the rotation is decided by the rotation, not by whoever happened to press the button
  const h: Handoff = { id: uid('h'), at: nowIso(), from: l.ownerId, to: toUserId, by: how === 'manual' ? ctx.actor : 'automation', how, ...(reason?.trim() ? { reason: reason.trim() } : {}) };
  if (!l.originalOwnerId) l.originalOwnerId = l.ownerId || toUserId;
  for (const t of d.tasks) if (t.leadId === l.id && t.status !== 'done' && t.assignee === 'u:' + l.ownerId) t.assignee = 'u:' + toUserId;
  l.ownerId = toUserId;
  (l.handoffs ??= []).push(h);
  logActivity(d, ctx.actor, 'lead.owner', leadRef(l), { owner: to.name });
  return h;
}

/* ---------- the company's own pipeline: stages, sources, lost reasons, routing ---------- */
// These write data.config. The screens run them with the `config` capability (`mutate(fn, 'config')`); the database asks for
// the same capability before it accepts a change to the company's configuration.

export type StageProblem = 'no_open' | 'no_won' | 'no_lost' | 'no_label' | 'duplicate_id' | 'in_use';
/** What is wrong with a list of stages, or null. A pipeline always has somewhere to start, a way to win and a way to lose. */
export function stageProblem(stages: StageDef[]): StageProblem | null {
  if (!stages.some((s) => s.kind === 'open')) return 'no_open';
  if (!stages.some((s) => s.kind === 'won')) return 'no_won';
  if (!stages.some((s) => s.kind === 'lost')) return 'no_lost';
  if (stages.some((s) => !s.label.en.trim() || !s.label.es.trim())) return 'no_label';
  if (new Set(stages.map((s) => s.id)).size !== stages.length) return 'duplicate_id';
  return null;
}
/** How many leads sit in each stage, to know which ones cannot simply be removed. */
export function leadsPerStage(d: Pick<DemoState, 'leads'>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of d.leads) out[l.status] = (out[l.status] ?? 0) + 1;
  return out;
}
/**
 * Saves the company's stages. `moves` says where the leads of a removed stage go (removed stage id to a stage that stays);
 * a stage that still holds leads cannot be removed without one. Leads are moved quietly: nothing was won or lost by tidying
 * the list, so no automation runs. Returns the problem when the list is refused, and changes nothing in that case.
 */
export function saveLeadStages(d: DemoState, ctx: Ctx, stages: StageDef[], moves: Record<string, string> = {}): StageProblem | null {
  const clean = stages.map((s) => ({ id: s.id, label: { ...s.label, en: s.label.en.trim(), es: s.label.es.trim() }, kind: s.kind, ...(s.kind === 'open' && s.role ? { role: s.role } : {}), ...(s.kind === 'open' && s.hot ? { hot: true } : {}) }) as StageDef);
  const problem = stageProblem(clean); if (problem) return problem;
  const stays = new Set(clean.map((s) => s.id));
  const before = stagesOf(d, ctx.pack);
  const used = leadsPerStage(d);
  for (const s of before) if (!stays.has(s.id) && used[s.id] && !stays.has(moves[s.id])) return 'in_use';
  for (const l of d.leads) if (!stays.has(l.status) && stays.has(moves[l.status])) l.status = moves[l.status];
  d.config = { ...d.config, leadStages: clean };
  logActivity(d, ctx.actor, 'config.stages', { type: 'user', id: ctx.actor });
  return null;
}
/** Back to the stages the edition ships. Refused while a lead sits in a stage the edition does not have. */
export function resetLeadStages(d: DemoState, ctx: Ctx): StageProblem | null {
  const shipped = new Set(ctx.pack.leadStages.map((s) => s.id));
  if (d.leads.some((l) => !shipped.has(l.status))) return 'in_use';
  const { leadStages: _own, ...rest } = d.config; d.config = rest;
  logActivity(d, ctx.actor, 'config.stages', { type: 'user', id: ctx.actor });
  return null;
}
const cleanOptions = (list: OptionDef[]): OptionDef[] => list.filter((o) => o.label.en.trim() && o.label.es.trim()).map((o) => ({ id: o.id, label: { ...o.label, en: o.label.en.trim(), es: o.label.es.trim() } }));
/** Saves the company's lead sources. An empty list means "as the edition ships". Leads keep the source they have. */
export function saveLeadSources(d: DemoState, ctx: Ctx, list: OptionDef[]) {
  const clean = cleanOptions(list);
  const { leadSources: _own, ...rest } = d.config;
  d.config = clean.length ? { ...rest, leadSources: clean } : rest;
  logActivity(d, ctx.actor, 'config.sources', { type: 'user', id: ctx.actor });
}
export function saveLostReasons(d: DemoState, ctx: Ctx, list: OptionDef[]) {
  const clean = cleanOptions(list);
  const { lostReasons: _own, ...rest } = d.config;
  d.config = clean.length ? { ...rest, lostReasons: clean } : rest;
  logActivity(d, ctx.actor, 'config.reasons', { type: 'user', id: ctx.actor });
}
/**
 * Saves how new leads are assigned. The pool keeps its order (that is the turn order), without repeats and without people
 * who cannot work leads. The cursor is kept on the same person when the pool is reordered, so changing the settings never
 * makes someone lose or repeat a turn. In a live workspace the server keeps the cursor and ignores the one sent from here.
 */
export function saveRouting(d: DemoState, ctx: Ctx, patch: Partial<Omit<LeadRouting, 'cursor'>>) {
  const r = routingOf(d);
  const nextUp = r.pool.length ? r.pool[((r.cursor % r.pool.length) + r.pool.length) % r.pool.length] : undefined;
  const pool = [...new Set(patch.pool ?? r.pool)].filter((id) => !!worksLeads(d, ctx.pack, id));
  const exclude = [...new Set(patch.exclude ?? r.exclude)].filter((id) => pool.includes(id));
  const at = nextUp ? pool.indexOf(nextUp) : -1;
  const next: LeadRouting = { mode: patch.mode ?? r.mode, pool, cursor: at >= 0 ? at : pool.length ? r.cursor % pool.length : 0, exclude, skipAway: patch.skipAway ?? r.skipAway };
  const fallbackId = 'fallbackId' in patch ? patch.fallbackId : r.fallbackId;
  if (fallbackId && worksLeads(d, ctx.pack, fallbackId)) next.fallbackId = fallbackId;
  d.config = { ...d.config, routing: next };
  logActivity(d, ctx.actor, 'config.routing', { type: 'user', id: ctx.actor });
}
