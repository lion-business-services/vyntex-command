// The built-in assistant. It understands a fixed set of requests in English and Spanish by matching words and patterns,
// answers only from the records in the workspace, and turns an instruction into a proposal that a person has to confirm.
// No AI model is involved here: when it does not recognise a request it says so.
import type { Client, DemoState, ISODate, Job, JobStatus, Lang, Lead, MessageChannel, PayMethod, Ref, Task } from '@/domain/types';
import type { IndustryPack } from '@/packs/types';
import { makeT, type TFn } from '@/i18n';
import type { Permission } from '@/domain/permissions';
import { assigneeName, byId, calendarEvents, clientMoney, insuranceState, isDueToday, isOpenLead, isOverdue, jobMoney, jobsOfClient, kpiValues, workerMoney } from '@/domain/selectors';
import { moduleOn, openStages, stageByRole, stageRole } from '@/domain/config';
import { asksForTaxId, parseAppointment, parseReview, reviewProblem, routeQuestion } from './records';
import { addDays, monthLabel, today } from '@/lib/dates';
import { money, money2, sum } from '@/lib/money';
import { NAME_LEAD, NAME_TRAIL, TITLE_LEAD, TITLE_TRAIL, Work, best, capFirst, fold, properName, rank, takeAmount, takeDate, takePhone, takeTime, tidy, words, type Candidate } from './text';

export interface Env {
  data: DemoState; pack: IndustryPack; lang: Lang; t: TFn;
  can: (p: Permission) => boolean;
  /** TeamUser id of the person asking. */
  actor: string;
  date: (d: string | undefined) => string; day: (d: string | undefined) => string; time: (hhmm: string | undefined) => string;
}

/** A change the assistant is asking permission for. Nothing happens until the person confirms it. */
export type Proposal =
  | { kind: 'task'; title: string; due?: ISODate; assignee: string }
  | { kind: 'lead'; name: string; phone: string; type: string; typeGuessed?: boolean }
  | { kind: 'note'; ref: Ref; text: string }
  | { kind: 'taskDone'; taskId: string }
  | { kind: 'jobStatus'; jobId: string; status: JobStatus }
  | { kind: 'payment'; jobId: string; amount: number; method: PayMethod; date: ISODate }
  | { kind: 'visit'; leadId: string; date: ISODate; time?: string }
  | { kind: 'appointment'; clientId?: string; leadId?: string; typeId: string; date: ISODate; time: string; staffId: string }
  | { kind: 'review'; clientId: string; jobId?: string; channel: MessageChannel };

export interface Item { title: string; sub?: string; right?: string; tone?: 'bad' | 'warn' | 'ok'; to?: string }
export type Block =
  | { type: 'text'; text: string; soft?: boolean }
  | { type: 'list'; items: Item[]; more?: { label: string; to: string } }
  | { type: 'facts'; rows: [string, string][] }
  | { type: 'link'; label: string; to: string }
  | { type: 'examples'; items: string[] };
export interface Choice { label: string; sub?: string; proposal: Proposal }
export interface Reply { blocks: Block[]; proposal?: Proposal; choices?: Choice[]; /** True when the request was not recognised. */ unknown?: boolean }

export const LIST_MAX = 8;
export const text = (s: string, soft = false): Block => ({ type: 'text', text: s, soft });
export const say = (...blocks: Block[]): Reply => ({ blocks });
const taskPath = (id: string) => `/tasks?task=${id}`;
const refPathOf = (ref: Ref) => (ref.type === 'lead' ? `/leads/${ref.id}` : ref.type === 'client' ? `/clients/${ref.id}` : `/jobs/${ref.id}`);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clientName = (d: DemoState, j: Job | undefined) => (j ? byId(d.clients, j.clientId)?.name ?? '' : '');
const jobLabel = (d: DemoState, j: Job) => { const c = clientName(d, j); return c ? `${j.name} · ${c}` : j.name; };
/** How to name a job in a suggested request: its name, plus the client when two jobs share the name. */
const jobSay = (d: DemoState, j: Job) => (d.jobs.filter((x) => fold(x.name) === fold(j.name)).length > 1 && clientName(d, j) ? `${j.name} (${clientName(d, j)})` : j.name);
export function capped<T>(list: T[], make: (x: T) => Item, more: { label: string; to: string }): Block {
  return { type: 'list', items: list.slice(0, LIST_MAX).map(make), more: list.length > LIST_MAX ? more : undefined };
}

/* ---------- wording of the selected industry, so "the kitchen project" and "el trabajo de cocina" both find the record ---------- */
const stopCache = new Map<string, Set<string>>();
export function industryWords(env: Env): Set<string> {
  const hit = stopCache.get(env.pack.id); if (hit) return hit;
  const out = new Set<string>();
  for (const lang of ['en', 'es'] as Lang[]) { const t = makeT(lang, env.pack); for (const k of ['project', 'projects', 'sub', 'subs', 'client', 'clients']) for (const w of fold(t(k)).split(/[^a-z0-9]+/)) if (w) out.add(w); }
  stopCache.set(env.pack.id, out);
  return out;
}
const STATUS_WORDS: Record<JobStatus, string[]> = {
  estimate: ['estimate', 'quote', 'presupuesto', 'cotizacion', 'estimado'],
  contract: ['waiting on signature', 'awaiting signature', 'waiting for signature', 'contract', 'esperando firma', 'en espera de firma', 'por firmar', 'contrato'],
  progress: ['in progress', 'started', 'active', 'underway', 'en curso', 'en progreso', 'en proceso', 'activo', 'iniciado', 'empezado', 'en marcha'],
  hold: ['on hold', 'paused', 'hold', 'pause', 'en pausa', 'pausado', 'pausa', 'detenido', 'en espera'],
  done: ['completed', 'complete', 'finished', 'done', 'closed', 'completado', 'completada', 'terminado', 'terminada', 'finalizado', 'finalizada', 'cerrado', 'cerrada', 'listo', 'lista', 'hecho', 'hecha'],
};
/** Every way a status of this industry can be typed, longest first. */
function statusPhrases(env: Env): { phrase: string; status: JobStatus }[] {
  const out: { phrase: string; status: JobStatus }[] = [];
  for (const s of env.pack.jobStatuses) {
    const set = new Set(STATUS_WORDS[s]);
    for (const lang of ['en', 'es'] as Lang[]) set.add(fold(makeT(lang, env.pack)('st_' + s)));
    for (const phrase of set) if (phrase) out.push({ phrase, status: s });
  }
  return out.sort((a, b) => b.phrase.length - a.phrase.length);
}

/* ---------- candidates for finding a record by name ---------- */
const jobCands = (env: Env, list: Job[], boost = 0): Candidate<Job>[] => list.map((j) => ({ rec: j, name: j.name, also: `${clientName(env.data, j)} ${j.number}`, boost }));
const leadCands = (list: Lead[], boost = 0): Candidate<Lead>[] => list.map((l) => ({ rec: l, name: l.name, also: `${l.company ?? ''} ${l.ticket}`, boost }));
const clientCands = (list: Client[], boost = 0): Candidate<Client>[] => list.map((c) => ({ rec: c, name: c.name, also: c.company ?? '', boost }));
const taskCands = (env: Env, list: Task[]): Candidate<Task>[] => list.map((x) => ({ rec: x, name: x.title, also: byId(env.data.jobs, x.jobId)?.name ?? '' }));

type Found = { type: 'lead'; rec: Lead } | { type: 'client'; rec: Client } | { type: 'job'; rec: Job };
/** Looks for a lead, a client or a job by name. A word such as "lead" or "client" in the request tips the balance. */
function findRecord(query: string, env: Env, opts: { leads: Lead[]; hintFrom?: string }) {
  const n = fold(opts.hintFrom ?? query); const stop = industryWords(env);
  const hint = (re: RegExp) => (re.test(n) ? 0.25 : 0);
  const jobHint = [...stop].some((w) => new RegExp(`\\b${esc(w)}\\b`).test(n)) || /\b(job|project|trabajo|proyecto|servicio)\b/.test(n) ? 0.25 : 0;
  const cands: Candidate<Found>[] = [
    ...clientCands(env.data.clients, hint(/\b(client|customer|cliente)\b/) + 0.05).map((c) => ({ ...c, rec: { type: 'client', rec: c.rec } as Found })),
    ...jobCands(env, env.data.jobs, jobHint).map((c) => ({ ...c, rec: { type: 'job', rec: c.rec } as Found })),
    ...leadCands(opts.leads, hint(/\b(lead|prospect|prospecto)\b/)).map((c) => ({ ...c, rec: { type: 'lead', rec: c.rec } as Found })),
  ];
  return rank(query, cands, stop);
}
const foundName = (env: Env, f: Found) => (f.type === 'job' ? jobLabel(env.data, f.rec) : f.rec.name);
const foundKind = (env: Env, type: Ref['type']) => env.t(type === 'lead' ? 'asst.kind.lead' : type === 'client' ? 'asst.kind.client' : type === 'task' ? 'asst.kind.task' : 'asst.kind.job');

/* ---------- people a task can be given to ---------- */
interface Person { code: string; name: string; role: string }
function people(env: Env): Person[] {
  const { data, t } = env;
  return [
    ...data.users.map((u) => ({ code: 'u:' + u.id, name: u.name, role: t('role.' + u.role) })),
    ...data.workers.filter((w) => w.active !== false).map((w) => ({ code: 'w:' + w.id, name: w.name, role: w.trade })),
  ];
}
/** "for Priya", "assign to Luis Ortega", "para Carlos": cuts the phrase out and returns who was meant (several when a first name is shared). */
function takeAssignee(w: Work, env: Env): Person[] | null {
  const mine = w.take(/\b(?:assign(?:ed)?(?: it)? to|for|para)\s+(?:me|myself|mi)\b/);
  const all = people(env);
  if (mine) return all.filter((p) => p.code === 'u:' + env.actor);
  const names = new Map<string, Person[]>();
  const add = (k: string, p: Person) => { if (k.length >= 2) names.set(k, [...(names.get(k) ?? []), p]); };
  for (const p of all) { const full = fold(p.name).replace(/\s+/g, ' ').trim(); add(full, p); const first = full.split(' ')[0]; if (first !== full) add(first, p); }
  const alt = [...names.keys()].sort((a, b) => b.length - a.length).map((k) => esc(k).replace(/ /g, '\\s+')).join('|');
  if (!alt) return null;
  const hit = w.take(new RegExp(`\\b(?:assign(?:ed)?(?: it)? to|for|asignad[ao] a|asignar(?:la|sela)? a|asignasela a|asigneselo? a|para|a cargo de|encargad[ao] a)\\s+(${alt})(?![a-z0-9])`));
  if (!hit) return null;
  return names.get(hit.m[1].replace(/\s+/g, ' ')) ?? null;
}

/* ---------- what a proposal will change, in words ---------- */
export interface Card { title: string; rows: [string, string][]; note?: string }
export const PERM: Record<Proposal['kind'], Permission> = { task: 'tasks', lead: 'leads', note: 'clients', taskDone: 'tasks', jobStatus: 'jobs', payment: 'money', visit: 'leads', appointment: 'appointments', review: 'reviews' };

export function describe(p: Proposal, env: Env): Card {
  const { data, t, date, time } = env;
  const ruleOn = (id: string) => data.automation.enabled[id] !== false;
  switch (p.kind) {
    case 'task':
      return { title: t('asst.card.task'), rows: [[t('asst.row.task'), p.title], [t('common.due'), p.due ? date(p.due) : t('asst.noDue')], [t('common.assignedTo'), assigneeName(data, p.assignee) || t('common.unassigned')]] };
    case 'lead':
      return {
        title: t('asst.card.lead'),
        rows: [[t('common.name'), p.name], [t('common.phone'), p.phone], [t('asst.row.service'), t('ty_' + p.type) + (p.typeGuessed ? ` (${t('asst.serviceGuessed')})` : '')]],
        note: ruleOn('lead-intake') ? t('asst.card.leadNote') : undefined,
      };
    case 'note': {
      const name = p.ref.type === 'lead' ? byId(data.leads, p.ref.id)?.name : p.ref.type === 'client' ? byId(data.clients, p.ref.id)?.name : byId(data.jobs, p.ref.id)?.name;
      return { title: t('asst.card.note'), rows: [[foundKind(env, p.ref.type), name ?? t('asst.gone')], [t('asst.row.note'), p.text]] };
    }
    case 'taskDone': {
      const task = byId(data.tasks, p.taskId);
      return { title: t('asst.card.taskDone'), rows: [[t('asst.row.task'), task?.title ?? t('asst.gone')], [t('common.assignedTo'), assigneeName(data, task?.assignee) || t('common.unassigned')], [t('common.status'), task ? `${t('ts.' + task.status)} → ${t('ts.done')}` : '']] };
    }
    case 'jobStatus': {
      const job = byId(data.jobs, p.jobId);
      const note = p.status === 'done' && ruleOn('job-completed') ? t('asst.card.doneNote') : p.status === 'progress' && ruleOn('job-started') ? t('asst.card.startNote') : undefined;
      return { title: t('asst.card.jobStatus'), rows: [[t('asst.kind.job'), job ? jobLabel(data, job) : t('asst.gone')], [t('common.status'), job ? `${t('st_' + job.status)} → ${t('st_' + p.status)}` : '']], note };
    }
    case 'payment': {
      const job = byId(data.jobs, p.jobId); const owes = job ? jobMoney(data, job).clientOwes : 0;
      return {
        title: t('asst.card.payment'),
        rows: [[t('asst.kind.job'), job ? jobLabel(data, job) : t('asst.gone')], [t('common.amount'), money2(p.amount)], [t('common.date'), date(p.date)], [t('common.method'), t('m_' + p.method)], [t('asst.row.balanceAfter'), money2(Math.max(0, owes - p.amount))]],
        note: ruleOn('payment-posted') ? t('asst.card.payNote') : undefined,
      };
    }
    case 'visit': {
      const lead = byId(data.leads, p.leadId);
      // setting a visit moves a lead that had not got that far to the company's visit stage
      const part = lead ? stageRole(data, env.pack, lead.status) : undefined; const visit = stageByRole(data, env.pack, 'visit');
      const moves = !!visit && (part === 'new' || part === 'contacted');
      return { title: t('asst.card.visit'), rows: [[t('asst.kind.lead'), lead?.name ?? t('asst.gone')], [t('common.date'), env.day(p.date)], [t('asst.row.time'), p.time ? time(p.time) : t('asst.noTime')]], note: moves && visit ? t('asst.card.visitNote', { stage: t('ls_' + visit.id) }) : undefined };
    }
    case 'appointment': {
      const who = p.clientId ? byId(data.clients, p.clientId)?.name : byId(data.leads, p.leadId)?.name;
      const type = (data.apptTypes ?? []).find((x) => x.id === p.typeId);
      return {
        title: t('asst.card.appt'),
        rows: [[t('asst.row.with'), who ?? t('asst.gone')], [t('asst.row.apptType'), type ? type.name[env.lang] ?? type.name.en : t('asst.gone')], [t('common.date'), `${env.day(p.date)}, ${time(p.time)}`], [t('asst.row.staff'), byId(data.users, p.staffId)?.name ?? t('asst.gone')]],
        note: type?.prepay && type.fee > 0 ? t('asst.card.apptPrepay') : t('asst.card.apptNote'),
      };
    }
    case 'review': {
      const job = byId(data.jobs, p.jobId);
      return { title: t('asst.card.review'), rows: [[t('asst.kind.client'), byId(data.clients, p.clientId)?.name ?? t('asst.gone')], [t('asst.row.about'), job ? job.name : t('reviews.noJob')], [t('asst.row.channel'), t('auto.ch.' + p.channel)]], note: t('asst.card.reviewNote') };
    }
  }
}

/** Why a proposal cannot be carried out right now (the record is gone, the role lacks access, the amount is too high), or null when it can. */
export function check(p: Proposal, env: Env): string | null {
  const { data, t } = env;
  if (!env.can(PERM[p.kind])) return t(p.kind === 'payment' ? 'asst.noMoney' : 'asst.noAccess');
  switch (p.kind) {
    case 'task': return !p.title.trim() ? t('asst.need.taskTitle') : p.assignee && !assigneeName(data, p.assignee) ? t('asst.goneRecord') : null;
    case 'lead': return !p.name.trim() || !p.phone.trim() ? t('asst.need.lead') : !env.pack.serviceTypes.some((s) => s.id === p.type) ? t('asst.goneRecord') : null;
    case 'note': {
      const there = p.ref.type === 'lead' ? byId(data.leads, p.ref.id) : p.ref.type === 'client' ? byId(data.clients, p.ref.id) : p.ref.type === 'job' ? byId(data.jobs, p.ref.id) : undefined;
      return !there ? t('asst.goneRecord') : !p.text.trim() ? t('asst.need.note') : null;
    }
    case 'taskDone': { const task = byId(data.tasks, p.taskId); return !task ? t('asst.goneRecord') : task.status === 'done' ? t('asst.already.taskDone', { name: task.title }) : null; }
    case 'jobStatus': {
      const job = byId(data.jobs, p.jobId);
      return !job ? t('asst.goneRecord') : !env.pack.jobStatuses.includes(p.status) ? t('asst.goneRecord') : job.status === p.status ? t('asst.already.status', { name: job.name, status: t('st_' + p.status) }) : null;
    }
    case 'payment': {
      // same rules as the payment form: a real amount, never more than the balance, and not on an estimate
      const job = byId(data.jobs, p.jobId); if (!job || job.status === 'estimate') return t('asst.pay.noJob');
      if (!(p.amount > 0)) return t('form.pay.positive');
      const owes = jobMoney(data, job).clientOwes;
      return p.amount > owes + 0.005 ? t('form.pay.tooMuch', { amount: money2(Math.max(0, owes)) }) : null;
    }
    case 'visit': { const lead = byId(data.leads, p.leadId); return !lead ? t('asst.goneRecord') : !isOpenLead(lead, data) ? t('asst.visit.closed', { name: lead.name }) : null; }
    case 'appointment': {
      const who = p.clientId ? byId(data.clients, p.clientId) : byId(data.leads, p.leadId);
      const type = (data.apptTypes ?? []).find((x) => x.id === p.typeId && x.active);
      return !who || !byId(data.users, p.staffId) ? t('asst.goneRecord') : !type ? t('asst.appt.unknown_type') : p.date < today() ? t('asst.appt.past') : null;
    }
    case 'review': return !byId(data.clients, p.clientId) ? t('asst.goneRecord') : reviewProblem(p, env);
  }
}

/* ---------- requests offered as one-tap suggestions, worded for the industry and built from real records ---------- */
export function suggestions(env: Env): string[] {
  const { data, t, can, pack } = env;
  const out: string[] = [t('asst.chip.due')];
  if (can('money')) out.push(t('asst.chip.owed'), ...(pack.usesWorkers ? [t('asst.chip.oweWorkers')] : []));
  out.push(t('asst.chip.pipeline'), t('asst.chip.calendar'));
  out.push(...extraQuestions(env).slice(0, 2));
  const active = data.jobs.find((j) => j.status === 'progress') ?? data.jobs[0];
  const client = byId(data.clients, active?.clientId) ?? data.clients[0];
  if (client) out.push(t('asst.chip.summary', { name: client.name }));
  out.push(t('asst.chip.task'));
  if (active && pack.jobStatuses.includes('hold') && active.status !== 'hold') out.push(t('asst.chip.move', { name: jobSay(data, active), status: t('st_hold') }));
  return out;
}
/** Questions about the screens an edition has on top of the first ones, for a role that may open them. */
function extraQuestions(env: Env): string[] {
  const { data, pack, t, can } = env; const on = (m: Parameters<typeof moduleOn>[2]) => moduleOn(data, pack, m);
  return [
    ...(on('appointments') && can('appointments') ? [t('asst.chip.appts')] : []), ...(on('deadlines') && can('deadlines') ? [t('asst.chip.deadlines')] : []),
    ...(on('esign') && can('esign') ? [t('asst.chip.sign')] : []), ...(on('opportunities') && can('opportunities') ? [t('asst.chip.opps')] : []),
    ...(on('catalog') && can('catalog') ? [t('asst.chip.services'), t('asst.chip.byService')] : []), ...(on('reviews') && can('reviews') ? [t('asst.chip.reviews')] : []),
  ];
}
/** Longer list shown under "What it can do" and when a request is not understood. */
export function examples(env: Env): { questions: string[]; actions: string[] } {
  const { data, t, can, pack } = env;
  const job = data.jobs.find((j) => j.status === 'progress') ?? data.jobs[0];
  const owing = data.jobs.find((j) => j.status !== 'estimate' && jobMoney(data, j).clientOwes >= 1);
  const lead = data.leads.find((l) => isOpenLead(l, data));
  const task = data.tasks.find((x) => x.status !== 'done');
  const client = byId(data.clients, job?.clientId) ?? data.clients[0];
  const questions = [t('asst.chip.due')];
  if (can('money')) questions.push(t('asst.chip.owed'), ...(pack.usesWorkers ? [t('asst.chip.oweWorkers')] : []), t('asst.chip.collected'));
  questions.push(t('asst.chip.pipeline'), t('asst.chip.calendar'));
  if (pack.compliance && can('compliance')) questions.push(t('asst.chip.compliance'));
  questions.push(...extraQuestions(env));
  if (client) questions.push(t('asst.chip.summary', { name: client.name }));
  const actions = [t('asst.chip.task'), t('asst.ex.lead', { service: t('ty_' + (pack.serviceTypes[0]?.id ?? '')).toLowerCase() })];
  const books = moduleOn(data, pack, 'appointments') && can('appointments') && (data.apptTypes ?? []).some((a) => a.active);
  if (lead) actions.push(t('asst.ex.note', { name: lead.name }), books ? t('asst.ex.appt', { name: lead.name }) : t('asst.ex.visit', { name: lead.name }));
  if (moduleOn(data, pack, 'reviews') && can('reviews')) { const c = data.clients.find((x) => !reviewProblem({ clientId: x.id }, env)); if (c) actions.push(t('asst.ex.review', { name: c.name })); }
  if (task) actions.push(t('asst.ex.taskDone', { name: task.title }));
  if (job && pack.jobStatuses.includes('hold') && job.status !== 'hold') actions.push(t('asst.chip.move', { name: jobSay(data, job), status: t('st_hold') }));
  if (owing && can('money')) actions.push(t('asst.ex.payment', { amount: money(Math.min(500, Math.floor(jobMoney(data, owing).clientOwes))), name: jobSay(data, owing) }));
  return { questions, actions };
}

/* ---------- answers from the records ---------- */
function answerDue(env: Env): Reply {
  const { data, t, date } = env; const td = today();
  const late = data.tasks.filter(isOverdue).sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''));
  const now = data.tasks.filter(isDueToday);
  const visits = data.leads.filter((l) => isOpenLead(l, data) && l.apptDate === td);
  const follow = data.leads.filter((l) => isOpenLead(l, data) && !!l.followUp && l.followUp <= td);
  if (!late.length && !now.length && !visits.length && !follow.length) return say(text(t('asst.due.none')));
  const item = (x: Task, tone: 'bad' | 'warn'): Item => ({ title: x.title, sub: [assigneeName(data, x.assignee) || t('common.unassigned'), byId(data.jobs, x.jobId)?.name ?? byId(data.leads, x.leadId)?.name].filter(Boolean).join(' · '), right: tone === 'bad' ? `${t('common.overdue')} · ${date(x.due)}` : t('asst.today'), tone, to: taskPath(x.id) });
  const blocks: Block[] = [text(t('asst.due.head', { late: late.length, today: now.length }))];
  const tasks = [...late.map((x) => item(x, 'bad')), ...now.map((x) => item(x, 'warn'))];
  if (tasks.length) blocks.push({ type: 'list', items: tasks.slice(0, LIST_MAX), more: tasks.length > LIST_MAX ? { label: t('asst.more', { n: tasks.length - LIST_MAX }), to: '/tasks' } : undefined });
  const leadItems: Item[] = [
    ...visits.map((l) => ({ title: l.name, sub: t('asst.due.visit') + (l.apptTime ? ` · ${env.time(l.apptTime)}` : ''), right: t('asst.today'), to: `/leads/${l.id}` })),
    ...follow.map((l) => ({ title: l.name, sub: t('asst.due.follow'), right: l.followUp === td ? t('asst.today') : date(l.followUp), tone: (l.followUp! < td ? 'bad' : 'warn') as 'bad' | 'warn', to: `/leads/${l.id}` })),
  ];
  if (leadItems.length) blocks.push(text(t('asst.due.leads', { visits: visits.length, follow: follow.length })), { type: 'list', items: leadItems.slice(0, LIST_MAX) });
  return { blocks };
}

function answerOwed(env: Env): Reply {
  const { data, t } = env;
  const rows = data.clients.map((c) => ({ c, owes: clientMoney(data, c.id).owes })).filter((r) => r.owes > 0.005).sort((a, b) => b.owes - a.owes);
  if (!rows.length) return say(text(t('asst.owed.none')));
  const sub = (c: Client) => jobsOfClient(data, c.id).filter((j) => (j.status === 'progress' || j.status === 'done') && jobMoney(data, j).clientOwes > 0.005).map((j) => `${j.name} ${money(jobMoney(data, j).clientOwes)}`).join(' · ');
  return say(
    text(t('asst.owed.head', { n: rows.length, total: money(sum(rows, (r) => r.owes)) })),
    capped(rows, (r) => ({ title: r.c.name, sub: sub(r.c), right: money(r.owes), to: `/clients/${r.c.id}` }), { label: t('asst.more', { n: rows.length - LIST_MAX }), to: '/payments' }),
    text(t('asst.owed.basis'), true),
  );
}

function answerOweWorkers(env: Env): Reply {
  const { data, t } = env;
  const rows = data.workers.map((w) => ({ w, owed: workerMoney(data, w.id).owed })).filter((r) => r.owed > 0.005).sort((a, b) => b.owed - a.owed);
  if (!rows.length) return say(text(t('asst.oweW.none')));
  return say(
    text(t('asst.oweW.head', { n: rows.length, total: money(sum(rows, (r) => r.owed)) })),
    capped(rows, (r) => ({ title: r.w.name, sub: r.w.trade, right: money(r.owed), to: `/team/${r.w.id}` }), { label: t('asst.more', { n: rows.length - LIST_MAX }), to: '/team' }),
    text(t('asst.oweW.basis'), true),
  );
}

function answerPipeline(env: Env): Reply {
  const { data, t } = env;
  const open = data.leads.filter((l) => isOpenLead(l, data));
  if (!open.length) return say(text(t('asst.pipe.none')), { type: 'link', label: t('nav.leads'), to: '/leads' });
  const stages = openStages(data, env.pack).map(({ id: s }) => ({ s, list: open.filter((l) => l.status === s) })).filter((x) => x.list.length);
  return say(
    text(t('asst.pipe.head', { n: open.length, total: money(sum(open, (l) => l.value)) })),
    { type: 'list', items: stages.map((x) => ({ title: `${t('ls_' + x.s)} · ${x.list.length}`, sub: x.list.slice(0, 4).map((l) => l.name).join(', ') + (x.list.length > 4 ? '…' : ''), right: money(sum(x.list, (l) => l.value)), to: '/leads?view=board' })) },
    { type: 'link', label: t('asst.pipe.open'), to: '/leads?view=board' },
  );
}

function answerCalendar(env: Env): Reply {
  const { data, t, day, time } = env; const from = today(); const to = addDays(6);
  const list = calendarEvents(data, 14).filter((e) => e.date >= from && e.date <= to && !e.done);
  if (!list.length) return say(text(t('asst.cal.none', { to: day(to) })), { type: 'link', label: t('nav.calendar'), to: '/calendar' });
  const path = (e: (typeof list)[number]) => (e.ref.type === 'task' ? taskPath(e.ref.id) : e.ref.type === 'lead' ? `/leads/${e.ref.id}` : `/jobs/${e.ref.id}`);
  return say(
    text(t('asst.cal.head', { n: list.length, to: day(to) })),
    capped(list, (e) => ({ title: e.title, sub: [t('asst.ev.' + e.kind), e.sub].filter(Boolean).join(' · '), right: day(e.date) + (e.time ? `, ${time(e.time)}` : ''), to: path(e) }), { label: t('asst.more', { n: list.length - LIST_MAX }), to: '/calendar' }),
    { type: 'link', label: t('nav.calendar'), to: '/calendar' },
  );
}

function answerCompliance(env: Env): Reply {
  const { data, t, date, pack } = env;
  if (!pack.compliance) return say(text(t('asst.comp.off')));
  if (!env.can('compliance')) return say(text(t('asst.noAccess')));
  const items: Item[] = [];
  for (const w of data.workers) {
    if (w.active === false) continue;
    if (!w.w9) items.push({ title: w.name, sub: w.trade, right: t('notif.w9Missing'), tone: 'bad', to: `/team/${w.id}` });
    const ins = insuranceState(w);
    if (ins === 'missing') items.push({ title: w.name, sub: w.trade, right: t('asst.comp.noInsurance'), tone: 'bad', to: `/team/${w.id}` });
    else if (ins === 'expired') items.push({ title: w.name, sub: w.trade, right: `${t('notif.coiExpired')} · ${date(w.coiExp)}`, tone: 'bad', to: `/team/${w.id}` });
    else if (ins === 'soon') items.push({ title: w.name, sub: w.trade, right: `${t('notif.coiSoon')} · ${date(w.coiExp)}`, tone: 'warn', to: `/team/${w.id}` });
  }
  if (!items.length) return say(text(t('asst.comp.none')));
  return say(text(t('asst.comp.head', { n: items.length })), capped(items, (x) => x, { label: t('asst.more', { n: items.length - LIST_MAX }), to: '/compliance' }), { type: 'link', label: t('nav.compliance'), to: '/compliance' });
}

function answerCollected(env: Env): Reply {
  const { data, t, date, lang } = env; const month = today().slice(0, 7);
  const pays = data.jobs.flatMap((j) => j.received.filter((r) => r.date.startsWith(month)).map((r) => ({ j, r }))).sort((a, b) => b.r.date.localeCompare(a.r.date));
  const total = kpiValues(data).collectedMonth;
  if (!pays.length) return say(text(t('asst.col.none', { month: monthLabel(month, lang) })));
  return say(
    text(t('asst.col.head', { total: money2(total), month: monthLabel(month, lang), n: pays.length })),
    capped(pays, (p) => ({ title: jobLabel(data, p.j), sub: `${date(p.r.date)} · ${t('m_' + p.r.method)}`, right: money2(p.r.amount), to: `/jobs/${p.j.id}` }), { label: t('asst.more', { n: pays.length - LIST_MAX }), to: '/payments' }),
  );
}

function summarize(f: Found, env: Env): Reply {
  const { data, t, date, can } = env;
  if (f.type === 'client') {
    const c = f.rec; const jobs = jobsOfClient(data, c.id); const m = clientMoney(data, c.id);
    const rows: [string, string][] = [[t('common.since'), date(c.since)], [t('asst.sum.jobs'), String(jobs.length)]];
    if (c.phone) rows.unshift([t('common.phone'), c.phone]);
    if (can('money')) rows.push([t('asst.sum.billed'), money(m.billed)], [t('asst.sum.received'), money(m.received)], [t('common.balance'), money(Math.max(0, m.owes))]);
    rows.push([t('asst.sum.openTasks'), String(data.tasks.filter((x) => x.status !== 'done' && (x.clientId === c.id || jobs.some((j) => j.id === x.jobId))).length)]);
    const blocks: Block[] = [text(t('asst.sum.client', { name: c.name })), { type: 'facts', rows }];
    if (jobs.length) blocks.push({ type: 'list', items: jobs.slice(0, LIST_MAX).map((j) => ({ title: j.name, sub: t('st_' + j.status), right: can('money') ? money(j.price) : undefined, to: `/jobs/${j.id}` })) });
    const note = [...c.notes].sort((a, b) => b.at.localeCompare(a.at))[0];
    if (note) blocks.push(text(t('asst.sum.lastNote', { text: note.text }), true));
    blocks.push({ type: 'link', label: t('asst.sum.open', { name: c.name }), to: `/clients/${c.id}` });
    return { blocks };
  }
  if (f.type === 'job') {
    const j = f.rec; const m = jobMoney(data, j);
    const rows: [string, string][] = [[t('common.status'), t('st_' + j.status)]];
    if (clientName(data, j)) rows.unshift([t('asst.kind.client'), clientName(data, j)]);
    if (j.start) rows.push([t('common.start'), date(j.start)]);
    if (j.end) rows.push([t('common.end'), date(j.end)]);
    if (can('money')) rows.push([t('common.price'), money(m.price)], [t('asst.sum.received'), money(m.received)], [t('common.balance'), money(Math.max(0, m.clientOwes))]);
    if (can('profit')) rows.push([t('asst.sum.profit'), money(m.profit)]);
    const crew = j.assign.map((a) => byId(data.workers, a.workerId)?.name).filter(Boolean) as string[];
    if (crew.length) rows.push([t('asst.sum.crew'), [...new Set(crew)].join(', ')]);
    const open = data.tasks.filter((x) => x.jobId === j.id && x.status !== 'done');
    rows.push([t('asst.sum.openTasks'), String(open.length)]);
    const blocks: Block[] = [text(t('asst.sum.job', { name: j.name, number: j.number })), { type: 'facts', rows }];
    if (open.length) blocks.push({ type: 'list', items: open.slice(0, 5).map((x) => ({ title: x.title, sub: assigneeName(data, x.assignee) || t('common.unassigned'), right: x.due ? date(x.due) : undefined, tone: isOverdue(x) ? 'bad' : undefined, to: taskPath(x.id) })) });
    blocks.push({ type: 'link', label: t('asst.sum.open', { name: j.name }), to: `/jobs/${j.id}` });
    return { blocks };
  }
  const l = f.rec;
  const rows: [string, string][] = [[t('asst.sum.stage'), t('ls_' + l.status)], [t('asst.row.service'), t('ty_' + l.type)]];
  if (l.phone) rows.push([t('common.phone'), l.phone]);
  if (l.value) rows.push([t('common.value'), money(l.value)]);
  if (l.apptDate) rows.push([t('asst.due.visit'), env.day(l.apptDate) + (l.apptTime ? `, ${env.time(l.apptTime)}` : '')]);
  if (l.followUp) rows.push([t('asst.due.follow'), date(l.followUp)]);
  const blocks: Block[] = [text(t('asst.sum.lead', { name: l.name })), { type: 'facts', rows }];
  const note = [...l.notes].sort((a, b) => b.at.localeCompare(a.at))[0];
  if (note) blocks.push(text(t('asst.sum.lastNote', { text: note.text }), true));
  blocks.push({ type: 'link', label: t('asst.sum.open', { name: l.name }), to: `/leads/${l.id}` });
  return { blocks };
}

function answerSummary(query: string, env: Env, strict: boolean): Reply | null {
  const hits = findRecord(query, env, { leads: env.data.leads });
  // without a clear "summary of…" the typed words have to be mostly the name, so an unrelated sentence is not answered with a random record
  const usable = strict ? hits.filter((h) => h.score >= 1 && h.precision >= 0.5) : hits;
  const pick = best(usable);
  if (pick.one) return summarize(pick.one, env);
  if (pick.many) return say(text(env.t('asst.sum.which')), { type: 'list', items: pick.many.map((f) => ({ title: foundName(env, f), sub: foundKind(env, f.type), to: refPathOf({ type: f.type, id: f.rec.id }) })) });
  return null;
}

/* ---------- instructions: read the request, find the records, build the proposal ---------- */
export const POLITE = /^\s*(?:(?:please|por favor|can you|could you|would you|puedes|puede|podrias|podria|quiero|quisiera|necesito|i want to|i need to|i would like to|hay que|ok|okay)[\s,]+)+/;
export const offer = (p: Proposal, env: Env): Reply => { const bad = check(p, env); return bad ? say(text(bad)) : { blocks: [text(env.t('asst.confirmAsk'))], proposal: p }; };
export const which = (env: Env, key: string, choices: Choice[]): Reply => ({ blocks: [text(env.t(key))], choices });

function parseTask(input: string, env: Env): Reply {
  const { t } = env; const w = new Work(input);
  w.take(POLITE);
  const remind = w.take(/^\s*(?:remind me|recuerdame|recuerdeme|recordarme|recordar)\b\s*(?:to\b|that\b|de\b|que\b)?/);
  if (!remind) w.take(/^\s*(?:(?:create|add|make|set up|crea|crear|creame|cree|agrega|agregar|agregue|agregame|anade|anadir|pon|poner|ponga|ponme|haz|hazme|hacer|haga|registra|registrar)\s+)?(?:(?:a|an|una|un|the|la|me)\s+)?(?:(?:new|nueva|nuevo)\s+)?(?:task|tarea|to-?do|reminder|recordatorio)\b\s*[:\-]?/);
  const who = takeAssignee(w, env);
  const due = takeDate(w);
  const title = capFirst(w.rest(TITLE_LEAD, TITLE_TRAIL)).slice(0, 140);
  if (!title) return say(text(t('asst.need.taskTitle')), { type: 'examples', items: [t('asst.chip.task')] });
  if (who && who.length > 1) return which(env, 'asst.which.person', who.map((p) => ({ label: p.name, sub: p.role, proposal: { kind: 'task', title, due, assignee: p.code } })));
  return offer({ kind: 'task', title, due, assignee: who?.[0]?.code ?? 'u:' + env.actor }, env);
}

/** Finds the service the person named, in either language, and cuts it out of the text. */
function takeService(w: Work, env: Env): string | undefined {
  const phrases = new Map<string, string | null>(); // phrase -> service id, null when two services share the word
  const put = (phrase: string, id: string) => { if (phrase.length < 3) return; phrases.set(phrase, phrases.has(phrase) && phrases.get(phrase) !== id ? null : id); };
  for (const s of env.pack.serviceTypes) {
    if (s.id === 'other') continue;
    for (const label of [s.en, s.es]) {
      const f = fold(label).replace(/[^a-z0-9]+/g, ' ').trim(); put(f, s.id);
      for (const word of words(label)) if (word.length >= 4) put(word, s.id);
    }
  }
  const ordered = [...phrases.entries()].filter(([, id]) => id).sort((a, b) => b[0].length - a[0].length);
  for (const [phrase, id] of ordered) {
    const m = new RegExp(`\\b${esc(phrase).replace(/ /g, '[^a-z0-9]+')}(?:s|es)?\\b`).exec(w.norm); if (!m) continue;
    const pre = /(?:\b(?:for|wants|needs|interested in|asking about|about|para|quiere|necesita|busca|interesad[oa] en|pregunta por|servicio de|service|servicio|a|an|the|un|una|el|la|new|nuevo|nueva)\s+)+$/.exec(w.norm.slice(0, m.index));
    w.cut(pre ? pre.index : m.index, m.index + m[0].length);
    return id!;
  }
  return undefined;
}
function parseLead(input: string, env: Env): Reply {
  const { t, pack } = env; const w = new Work(input);
  w.take(POLITE);
  w.take(/^\s*(?:(?:add|create|new|crea|crear|cree|agrega|agregar|agregue|registra|registrar|registre|anade|anadir|ingresa|ingresar)\s+)?(?:(?:a|an|un|una|el)\s+)?(?:(?:new|nuevo)\s+)?(?:lead|prospecto|prospect)\b\s*[:\-]?/);
  const phone = takePhone(w);
  const type = takeService(w, env);
  w.take(/\b(?:named|called|llamad[oa]|de nombre|se llama|name is|su nombre es)\b/);
  const name = properName(w.rest(NAME_LEAD, NAME_TRAIL)).slice(0, 80);
  if (!name || !phone) return say(text(t('asst.need.lead')), { type: 'examples', items: [t('asst.ex.lead', { service: t('ty_' + (pack.serviceTypes[0]?.id ?? '')).toLowerCase() })] });
  const fallback = pack.serviceTypes.find((s) => s.id === 'other')?.id ?? pack.serviceTypes[0]?.id ?? '';
  return offer({ kind: 'lead', name, phone, type: type ?? fallback, typeGuessed: !type }, env);
}

function parseNote(input: string, env: Env): Reply {
  const { t, data } = env; const w = new Work(input);
  w.take(POLITE);
  w.take(/^\s*(?:(?:add|leave|write|create|make|agrega|agregar|agregue|pon|poner|ponga|deja|dejar|deje|escribe|escribir|escriba|anota|anotar|anote|anade|anadir|crea|crear)\s+)?(?:(?:a|an|una|un|the|la|esta)\s+)?(?:(?:new|nueva)\s+)?(?:note|nota)\b/);
  const example: Block = { type: 'examples', items: [t('asst.ex.note', { name: data.leads.find((l) => isOpenLead(l, data))?.name ?? data.clients[0]?.name ?? t('asst.kind.client') })] };
  let who = ''; let body = '';
  const colon = w.norm.search(/:(?!\d)/);
  const quoted = /"([^"]{2,})"/.exec(w.norm);
  const sep = /\b(?:saying|that says|which says|que dice|que diga|diciendo)\b/.exec(w.norm);
  if (colon >= 0) { who = w.slice(0, colon); body = w.slice(colon + 1); }
  else if (quoted) { body = w.slice(quoted.index + 1, quoted.index + quoted[0].length - 1); who = w.slice(0, quoted.index) + ' ' + w.slice(quoted.index + quoted[0].length); }
  else if (sep) { who = w.slice(0, sep.index); body = w.slice(sep.index + sep[0].length); }
  const leads = data.leads.filter((l) => isOpenLead(l, data));
  let pick = best(findRecord(who || w.raw, env, { leads }));
  if (!who && pick.one) {
    // no separator: the note is whatever follows the record's name
    const at = w.norm.indexOf(fold(pick.one.rec.name));
    if (at < 0) return say(text(t('asst.need.noteFormat')), example);
    body = w.slice(at + pick.one.rec.name.length); who = w.slice(0, at + pick.one.rec.name.length);
  }
  if (!pick.one && !pick.many && who) pick = best(findRecord(who, env, { leads: data.leads }));
  body = capFirst(tidy(body, ['that', 'que', 'saying', 'to', 'de'], [])).slice(0, 600);
  if (!pick.one && !pick.many) return say(text(tidy(who, NAME_LEAD, NAME_TRAIL) ? t('asst.notFound.record', { q: tidy(who, NAME_LEAD, NAME_TRAIL) }) : t('asst.need.noteFormat')), example);
  if (!body) return say(text(t('asst.need.note')), example);
  if (pick.many) return which(env, 'asst.which.record', pick.many.map((f) => ({ label: foundName(env, f), sub: foundKind(env, f.type), proposal: { kind: 'note', ref: { type: f.type, id: f.rec.id }, text: body } })));
  return offer({ kind: 'note', ref: { type: pick.one!.type, id: pick.one!.rec.id }, text: body }, env);
}

const VERBS = /\b(?:move|change|set|mark|put|update|switch|complete|completed|finish|finished|close|pause|start|resume|check off|mueve|mover|mueva|cambia|cambiar|cambie|pon|poner|ponga|marca|marcar|marque|pasa|pasar|pase|actualiza|actualizar|actualice|completa|completar|termina|terminar|termine|finaliza|finalizar|finalice|cierra|cerrar|cierre|pausa|pausar|inicia|iniciar|inicie|empieza|empezar|empiece|reanuda|reanudar|da|dar|dale)\b/;
const DONE_WORDS = /\b(?:(?:as|como|is|esta|ya esta|por)\s+)?(?:done|complete|completed|finished|hecha|hecho|completada|completado|lista|listo|terminada|terminado)\b/;

function taskChoices(env: Env, list: Task[]): Choice[] {
  return list.slice(0, 5).map((x) => ({ label: x.title, sub: [assigneeName(env.data, x.assignee), x.due ? env.date(x.due) : ''].filter(Boolean).join(' · '), proposal: { kind: 'taskDone', taskId: x.id } }));
}
function parseTaskDone(input: string, env: Env): Reply {
  const { t, data } = env; const w = new Work(input);
  w.take(POLITE); w.take(VERBS); w.take(DONE_WORDS); w.take(/\b(?:the|la|el|mi|my)?\s*(?:task|tarea|to-?do|pendiente)\b/);
  const open = data.tasks.filter((x) => x.status !== 'done');
  const query = w.rest();
  if (!words(query).length) {
    const soon = open.filter((x) => isOverdue(x) || isDueToday(x));
    return soon.length ? which(env, 'asst.which.task', taskChoices(env, soon)) : say(text(t('asst.need.task')));
  }
  const pick = best(rank(query, taskCands(env, open), industryWords(env)));
  if (pick.one) return offer({ kind: 'taskDone', taskId: pick.one.id }, env);
  if (pick.many) return which(env, 'asst.which.task', taskChoices(env, pick.many));
  const closed = best(rank(query, taskCands(env, data.tasks.filter((x) => x.status === 'done'))));
  if (closed.one) return say(text(t('asst.already.taskDone', { name: closed.one.title })));
  return say(text(t('asst.notFound.task', { q: tidy(query) })));
}

function parseStatus(input: string, env: Env): Reply | null {
  const { t, data } = env; const w = new Work(input);
  w.take(POLITE);
  let status: JobStatus | undefined;
  // a status introduced by "to", "as", "a" or "como" wins, so a status word inside a record's name is not mistaken for the target
  for (const lead of ['(?:\\b(?:to|as|a|al|como|into|estado|status)\\s+)+', '']) {
    for (const p of statusPhrases(env)) {
      const m = new RegExp(`${lead}\\b${esc(p.phrase).replace(/ /g, '\\s+')}\\b`).exec(w.norm); if (!m) continue;
      w.cut(m.index, m.index + m[0].length); status = p.status; break;
    }
    if (status) break;
  }
  const verb = w.take(VERBS)?.m[0] ?? '';
  if (!status) status = /^(complet|finish|close|termin|finaliz|cierr|cerr)/.test(verb) ? 'done' : /^(paus)/.test(verb) ? 'hold' : /^(start|resume|inici|empie|empez|reanud)/.test(verb) ? 'progress' : undefined;
  if (!status || !env.pack.jobStatuses.includes(status)) return null;
  const jobWord = /\b(job|project|trabajo|proyecto|servicio)\b/.test(w.norm) || [...industryWords(env)].some((x) => new RegExp(`\\b${esc(x)}\\b`).test(w.norm));
  w.take(/\b(?:the\s+)?(?:status|estado)(?:\s+(?:of|de|del))?\b/);
  const query = w.rest(NAME_LEAD, NAME_TRAIL);
  if (!words(query, industryWords(env)).length) return say(text(t('asst.need.job')));
  const jobHits = rank(query, jobCands(env, data.jobs), industryWords(env));
  const taskHits = status === 'done' && !jobWord ? rank(query, taskCands(env, data.tasks.filter((x) => x.status !== 'done')), industryWords(env)) : [];
  const jobTop = jobHits[0]?.score ?? 0; const taskTop = taskHits[0]?.score ?? 0;
  if (!jobTop && !taskTop) return say(text(t(status === 'done' ? 'asst.notFound.jobOrTask' : 'asst.notFound.job', { q: tidy(query) })));
  const jobPick = best(jobHits); const taskPick = best(taskHits);
  const forJob = (j: Job): Choice => ({ label: jobLabel(data, j), sub: `${t('asst.kind.job')} · ${t('st_' + j.status)} → ${t('st_' + status!)}`, proposal: { kind: 'jobStatus', jobId: j.id, status: status! } });
  if (Math.abs(jobTop - taskTop) < 0.001) return which(env, 'asst.which.record', [...(jobPick.one ? [jobPick.one] : jobPick.many ?? []).map(forJob), ...taskChoices(env, taskPick.one ? [taskPick.one] : taskPick.many ?? [])]);
  if (taskTop > jobTop) return taskPick.one ? offer({ kind: 'taskDone', taskId: taskPick.one.id }, env) : which(env, 'asst.which.task', taskChoices(env, taskPick.many ?? []));
  if (jobPick.many) return which(env, 'asst.which.job', jobPick.many.map(forJob));
  return offer({ kind: 'jobStatus', jobId: jobPick.one!.id, status }, env);
}

const METHODS: [RegExp, PayMethod][] = [[/\b(cash|efectivo)\b/, 'cash'], [/\b(check|cheque)\b/, 'check'], [/\bzelle\b/, 'zelle'], [/\b(bank transfer|transfer|transferencia|wire|ach)\b/, 'transfer'], [/\b(card|tarjeta|paypal)\b/, 'card']];
function parsePayment(input: string, env: Env): Reply {
  const { t, data } = env;
  if (!env.can('money')) return say(text(t('asst.noMoney')));
  const w = new Work(input);
  w.take(POLITE);
  let method: PayMethod = 'check';
  for (const [re, m] of METHODS) { const hit = re.exec(w.norm); if (hit) { const pre = /(?:\b(?:by|in|with|via|paid by|con|en|por)\s+)+$/.exec(w.norm.slice(0, hit.index)); w.cut(pre ? pre.index : hit.index, hit.index + hit[0].length); method = m; break; } }
  const date = takeDate(w) ?? today();
  const amount = takeAmount(w);
  w.take(/\b(?:record|log|register|enter|post|add|registra|registrar|registre|anota|anotar|anote|apunta|apuntar|agrega|agregar|agregue|captura|capturar|received|got paid|recibi|recibimos|me pago|me pagaron|nos pago|nos pagaron|paid me|paid us|cobre|cobramos)\b/);
  w.take(/\b(?:(?:a|an|un|una|the|el)\s+)?(?:payment|pago|deposit|deposito|abono)\b/);
  const open = data.jobs.filter((j) => j.status !== 'estimate');
  const owing = open.filter((j) => jobMoney(data, j).clientOwes > 0.005);
  const example: Block[] = owing[0] ? [{ type: 'examples', items: [t('asst.ex.payment', { amount: money(Math.min(500, Math.floor(jobMoney(data, owing[0]).clientOwes)) || 1), name: owing[0].name })] }] : [];
  if (amount === null || !(amount > 0)) return say(text(t('asst.need.amount')), ...example);
  const query = w.rest(NAME_LEAD, NAME_TRAIL);
  const forJob = (j: Job): Choice => ({ label: jobLabel(data, j), sub: t('form.pay.owes', { amount: money2(Math.max(0, jobMoney(data, j).clientOwes)) }), proposal: { kind: 'payment', jobId: j.id, amount, method, date } });
  if (!words(query, industryWords(env)).length) return owing.length ? which(env, 'asst.which.payJob', owing.slice(0, 5).map(forJob)) : say(text(t('asst.pay.nothingOwed')));
  const pick = best(rank(query, jobCands(env, open), industryWords(env)));
  if (pick.many) return which(env, 'asst.which.job', pick.many.map(forJob));
  if (!pick.one) return say(text(t('asst.notFound.job', { q: tidy(query) })));
  return offer({ kind: 'payment', jobId: pick.one.id, amount, method, date }, env);
}

function parseVisit(input: string, env: Env): Reply {
  const { t, data } = env; const w = new Work(input);
  w.take(POLITE);
  const date = takeDate(w); const time = takeTime(w);
  w.take(/\b(?:schedule|book|set up|set|reschedule|programa|programar|programe|agenda|agendar|agende|reserva|reservar|reserve|reprograma|reprogramar)\b/);
  w.take(/\b(?:(?:a|an|the|una|la|un)\s+)?(?:estimate\s+)?(?:visit|visita|appointment|cita|walkthrough|meeting|reunion)(?:\s+de\s+(?:estimado|presupuesto))?\b/);
  const open = data.leads.filter((l) => isOpenLead(l, data));
  const example: Block[] = open[0] ? [{ type: 'examples', items: [t('asst.ex.visit', { name: open[0].name })] }] : [];
  const query = w.rest(NAME_LEAD, NAME_TRAIL);
  if (!words(query).length) return say(text(t('asst.need.visitLead')), ...example);
  const pick = best(rank(query, leadCands(open), industryWords(env)));
  if (!pick.one && !pick.many) {
    const closed = best(rank(query, leadCands(data.leads.filter((l) => !isOpenLead(l, data)))));
    return say(text(closed.one ? t('asst.visit.closed', { name: closed.one.name }) : t('asst.notFound.lead', { q: tidy(query) })));
  }
  if (!date) return say(text(t('asst.need.visitDate')), ...example);
  if (pick.many) return which(env, 'asst.which.lead', pick.many.map((l) => ({ label: l.name, sub: `${l.ticket} · ${t('ls_' + l.status)}`, proposal: { kind: 'visit', leadId: l.id, date, time } })));
  return offer({ kind: 'visit', leadId: pick.one!.id, date, time }, env);
}

/* ---------- the router: which kind of request is this? ---------- */
const QUESTION_START = /^\s*(?:what|what's|whats|which|who|whose|how|any|are there|is there|do i|do we|did i|did we|show|list|tell me|give me|que|cual|cuales|quien|quienes|cuanto|cuantos|cuanta|cuantas|hay|tengo|tenemos|como|muestr\w*|dame|dime|deme|digame|ver|resumen|summary)\b/;
const ADD_VERB = /\b(?:create|add|new|make|crea|crear|creame|cree|agrega|agregar|agregue|agregame|nueva|nuevo|anade|anadir|pon|poner|ponga|ponme|haz|hazme|hacer|haga|registra|registrar|registre|record|log|enter|post|anota|anotar|anote|apunta|apuntar|write|leave|deja|dejar|deje|escribe|escribir|escriba)\b/;
const OBJECTS: [string, RegExp][] = [
  ['task', /\b(?:task|tarea|to-?do|reminder|recordatorio)\b/], ['note', /\b(?:note|nota)\b/], ['lead', /\b(?:lead|prospecto|prospect)\b/], ['payment', /\b(?:payment|pago|deposit|deposito|abono)\b/],
];
export const isYes = (s: string) => /^\s*(?:yes|yep|yeah|confirm|confirmed|do it|go ahead|ok|okay|si|claro|confirmar|confirmo|confirmado|adelante|hazlo|hagalo|dale)[\s.!]*$/.test(fold(s));
export const isNo = (s: string) => /^\s*(?:no|nope|cancel|cancelar|cancela|cancele|stop|never mind|nevermind|olvidalo|olvidelo|mejor no)[\s.!]*$/.test(fold(s));

function unknown(env: Env): Reply {
  const ex = examples(env);
  return { unknown: true, blocks: [text(env.t('asst.unknown')), { type: 'examples', items: [...ex.questions.slice(0, 3), ...ex.actions.slice(0, 2)] }] };
}
function help(env: Env): Reply {
  const ex = examples(env);
  return say(text(env.t('asst.help.q')), { type: 'examples', items: ex.questions }, text(env.t('asst.help.a')), { type: 'examples', items: ex.actions });
}

/** Reads one request and returns the answer, a proposal to confirm, a question back, or "I did not understand". */
export function interpret(input: string, env: Env): Reply {
  const { t, can } = env;
  const n = fold(input.normalize('NFC')).replace(/\s+/g, ' ').trim();
  if (!n) return unknown(env);
  if (/^(?:hi|hello|hey|hola|buenas|buenos dias|buenas tardes|buenas noches|good (?:morning|afternoon|evening))\b[\s!.,]*$/.test(n)) return say(text(t('asst.hello')), { type: 'examples', items: suggestions(env).slice(0, 4) });
  if (/^(?:thanks|thank you|thx|gracias|muchas gracias|perfecto|great|genial)\b[\s!.,]*$/.test(n)) return say(text(t('asst.welcome')));
  if (/^(?:help|ayuda)\b|what can (?:you|i) (?:do|ask)|what do you do|how does this work|que (?:puede|puedes|sabe|sabes) hacer|como funciona|que (?:le|te) puedo (?:pedir|preguntar)|\b(?:options|opciones)\b/.test(n)) return help(env);

  // a tax ID is never read out, whoever asks and however the question is put
  if (asksForTaxId(n)) return say(text(t('asst.taxId')));

  const asking = QUESTION_START.test(n);
  if (!asking) {
    if (/^(?:(?:please|por favor)\s+)?(?:remind me|recuerdame|recuerdeme|recordarme)\b/.test(n)) return parseTask(input, env);
    const verb = ADD_VERB.exec(n);
    const firstObject = OBJECTS.map(([kind, re]) => ({ kind, at: re.exec(n)?.index ?? -1 })).filter((o) => o.at >= 0).sort((a, b) => a.at - b.at)[0];
    if (firstObject && (verb || firstObject.at <= 12)) {
      // "note for …", "new lead …" and "add a task …" all name what is being added; the first one named wins
      if (firstObject.kind === 'task' && !/\b(?:mark|complete|completed|finish|close|check off|marca|marcar|marque|completa|completar|termina|terminar|finaliza|cierra|cerrar)\b.*\b(?:task|tarea)\b/.test(n)) return parseTask(input, env);
      if (firstObject.kind === 'note') return parseNote(input, env);
      if (firstObject.kind === 'lead') return parseLead(input, env);
      if (firstObject.kind === 'payment') return parsePayment(input, env);
    }
    if (/\b(?:received|got paid|recibi|recibimos|me pago|me pagaron|nos pago|nos pagaron|paid me|paid us|cobre|cobramos)\b/.test(n) && /\d/.test(n)) return parsePayment(input, env);
    if (/\b(?:ask|request|pide|pidele|pedir|pida|pidale|solicit\w*)\b.*\b(?:review|resena|opinion)\b/.test(n) && moduleOn(env.data, env.pack, 'reviews')) return can('reviews') ? parseReview(input, env) : say(text(t('asst.noAccess')));
    if (/\b(?:schedule|book|set up|set|reschedule|program\w*|agend\w*|reserv\w*|reprogram\w*)\b.*\b(?:visit|visita|appointment|cita|walkthrough|meeting|reunion|consultation|consulta)\b/.test(n)) {
      // an edition with an appointment book books a real appointment; the others set the visit date on the lead, as before
      if (moduleOn(env.data, env.pack, 'appointments') && (env.data.apptTypes ?? []).some((a) => a.active)) return can('appointments') ? parseAppointment(input, env) : say(text(t('asst.noAccess')));
      return parseVisit(input, env);
    }
    if (VERBS.test(n)) {
      if (/\b(?:task|tarea|to-?do|pendiente)\b/.test(n)) return parseTaskDone(input, env);
      const moved = parseStatus(input, env); if (moved) return moved;
    }
  }

  // questions
  const wantsMoney = (r: () => Reply) => (can('money') ? r() : say(text(t('asst.noMoney'))));
  // the newer records first: signatures, deadlines, credits, reviews, opportunities, the catalog, appointments
  const newer = routeQuestion(n, env); if (newer) return newer;
  if (/who owes|owes? (?:me|us)|owed to (?:me|us)|outstanding|unpaid|receivable|\bbalances\b|open balance|quien(?:es)? (?:me|nos) debe|(?:me|nos) deben?\b|por cobrar|\bsaldos\b|saldo pendiente|adeud/.test(n)) return wantsMoney(() => answerOwed(env));
  if ((/\b(?:collect\w*|cobr\w*|recib\w*|ingres\w*|received|income|revenue|brought in|came in|entro)\b/.test(n) && /how much|cuanto|cuanta|\btotal\b|\bmonth\b|\bmes\b/.test(n)) || /\b(?:payments|pagos)\b.*\b(?:month|mes)\b/.test(n)) return wantsMoney(() => answerCollected(env));
  if (/\b(?:i|we) owe\b|owe (?:the|my|to)\b|\b(?:debo|debemos)\b|por pagar|payable/.test(n)) return wantsMoney(() => answerOweWorkers(env));
  if (/\bw-?\s?9s?\b|insurance|\bseguros?\b|certificad|\bcoi\b|compliance|cumplimiento|\b1099\b/.test(n)) return answerCompliance(env);
  const explicit = /\b(?:summary|summarize|resumen|resume|resuma)\b|tell me about|status of|how is|how are|details (?:of|on|for)|info (?:on|about)|balance (?:of|for)|como va|como esta|estado de|hableme de|hablame de|dime de|digame de|informacion (?:de|sobre)|datos de|saldo de/.test(n);
  if (explicit) { const r = answerSummary(input, env, false); if (r) return r; }
  // "today" and "this week" only count next to words about what is on the list, so a question about something else is not answered with the task list
  const onMyPlate = /what do (?:i|we) have|what(?:'s| is|s)? (?:on|up|for|there|left)\b|do (?:i|we) have|anything|que (?:hay|tengo|tenemos|sigue|toca)|\b(?:tengo|tenemos|hay)\b|for today|para hoy|para esta semana|for (?:this|the) week/.test(n);
  if (/calendar|calendario|agenda|\bschedule\b|coming up|upcoming|\bvisitas?\b|\bvisits?\b|appointments?|\bcitas?\b/.test(n) || (onMyPlate && /\b(?:this|next) week\b|(?:esta|proxima) semana|next (?:few|7|seven) days|proximos dias/.test(n))) return answerCalendar(env);
  if (/\b(?:overdue|past due|late|atrasad\w*|vencid\w*|retrasad\w*)\b|\bdue\b|\bvence\w*\b|\bpendientes?\b|to-?do list|\b(?:tasks|tareas)\b/.test(n) || (onMyPlate && /\b(?:today|hoy)\b/.test(n))) return answerDue(env);
  if (/pipeline|embudo|\bleads?\b|prospectos?|oportunidades|opportunities|funnel/.test(n)) return answerPipeline(env);
  if (explicit) return say(text(t('asst.notFound.summary')));
  return answerSummary(input, env, true) ?? unknown(env);
}
