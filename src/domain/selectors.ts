// Read-only calculations over the business data. Every number shown in the app comes from here,
// so the dashboard, the job page, reports and documents can never disagree.
import type { Appointment, CashClose, CashEntry, Client, ComplianceItem, Credit, DemoState, ISODate, Job, Lead, Priority, Ref, Repeat, Task, Worker, WorkerPayment } from './types';
import type { Permission } from './permissions';
import { addDays, addDaysFrom, daysBetween, today } from '@/lib/dates';
import { sum } from '@/lib/money';
import { isOpen, packOf, stageByRole, vaultRules } from './config';
import { visibleLeads } from './access';
import { PACKS } from '@/packs';
import { session } from '@/platform/session';

export interface JobMoney {
  /** Agreed price. */
  price: number;
  /** Agreed with workers / subcontractors. */
  labor: number;
  /** Materials and other expenses. */
  expenses: number;
  profit: number;
  /** profit / price, 0 when there is no price. */
  margin: number;
  received: number;
  paidWorkers: number;
  clientOwes: number;
  oweWorkers: number;
}

export const workerPaysForJob = (s: DemoState, jobId: string): WorkerPayment[] => s.workerPays.filter((p) => p.jobId === jobId);

export function jobMoney(s: DemoState, job: Job): JobMoney {
  const price = Number(job.price) || 0;
  const labor = sum(job.assign, (a) => a.price);
  const expenses = sum(job.expenses, (e) => e.amount);
  const received = sum(job.received, (r) => r.amount);
  const paidWorkers = sum(workerPaysForJob(s, job.id), (p) => p.amount);
  const profit = price - labor - expenses;
  return { price, labor, expenses, profit, margin: price ? profit / price : 0, received, paidWorkers, clientOwes: price - received, oweWorkers: labor - paidWorkers };
}

export const isActiveJob = (j: Job) => j.status === 'progress' || j.status === 'contract' || j.status === 'hold';
/**
 * True while a lead is neither won nor lost. Reads the stages of the edition the workspace runs on, and the company's own
 * when it changed them. Pass the workspace data whenever it is at hand: `isOpenLead(l, data)` or `openLeads(data)`.
 * Without it (older call sites that filter a list directly) a stage counts as closed when any edition ships it as won or lost.
 */
export function isOpenLead(l: Lead, s?: DemoState | number): boolean {
  if (s && typeof s === 'object') return isOpen(s, packOf(s), l.status);
  return !CLOSED_ANYWHERE.has(l.status);
}
const CLOSED_ANYWHERE = new Set(Object.values(PACKS).flatMap((p) => p.leadStages.filter((st) => st.kind !== 'open').map((st) => st.id)));
export { openLeads, leadIsOpen, leadIsWon, leadIsLost } from './config';
export const isOpenTask = (t: Task) => t.status !== 'done';
export const isOverdue = (t: Task) => isOpenTask(t) && !!t.due && t.due < today();
export const isDueToday = (t: Task) => isOpenTask(t) && t.due === today();

export const byId = <T extends { id: string }>(list: T[], id: string | undefined) => (id ? list.find((x) => x.id === id) : undefined);
export const clientOf = (s: DemoState, job: Job | undefined): Client | undefined => (job ? byId(s.clients, job.clientId) : undefined);
export const jobsOfClient = (s: DemoState, clientId: string) => s.jobs.filter((j) => j.clientId === clientId);
export const tasksOfJob = (s: DemoState, jobId: string) => s.tasks.filter((t) => t.jobId === jobId);
export const docsOfJob = (s: DemoState, jobId: string) => s.docs.filter((d) => d.jobId === jobId);
export const jobsOfWorker = (s: DemoState, workerId: string) => s.jobs.filter((j) => j.assign.some((a) => a.workerId === workerId));

/** Name behind an assignee code (`u:<id>` office user, `w:<id>` worker). */
export function assigneeName(s: DemoState, code: string | undefined): string {
  if (!code) return '';
  const id = code.slice(2);
  return code.startsWith('w:') ? byId(s.workers, id)?.name ?? '' : byId(s.users, id)?.name ?? '';
}
/** Name of whoever did something: an office user, a worker, the system or an automation. */
export function actorName(s: DemoState, by: string): string | null {
  return byId(s.users, by)?.name ?? byId(s.workers, by)?.name ?? null;
}

export function clientMoney(s: DemoState, clientId: string) {
  const jobs = jobsOfClient(s, clientId);
  const billed = sum(jobs.filter((j) => j.status !== 'estimate'), (j) => j.price);
  const received = sum(jobs, (j) => sum(j.received, (r) => r.amount));
  return { jobs: jobs.length, billed, received, owes: sum(jobs.filter((j) => j.status === 'progress' || j.status === 'done'), (j) => jobMoney(s, j).clientOwes) };
}

export function workerMoney(s: DemoState, workerId: string, year = new Date().getFullYear()) {
  const pays = s.workerPays.filter((p) => p.workerId === workerId);
  const agreed = sum(s.jobs, (j) => sum(j.assign.filter((a) => a.workerId === workerId), (a) => a.price));
  const paid = sum(pays, (p) => p.amount);
  const inYear = pays.filter((p) => p.date.startsWith(String(year)));
  // Card payments are reported by the card company on Form 1099-K, so they do not count toward the 1099-NEC.
  const reportable = sum(inYear.filter((p) => p.method !== 'card'), (p) => p.amount);
  const excluded = sum(inYear.filter((p) => p.method === 'card'), (p) => p.amount);
  return { agreed, paid, owed: agreed - paid, paidYear: sum(inYear, (p) => p.amount), reportable, excluded };
}
/** 1099-NEC reporting threshold: $600 for payments through 2025, $2,000 from 2026. */
export const threshold1099 = (year: number) => (year >= 2026 ? 2000 : 600);

export type Compliance = 'ok' | 'soon' | 'expired' | 'missing';
export function insuranceState(w: Worker): Compliance {
  if (!w.coiExp) return 'missing';
  if (w.coiExp < today()) return 'expired';
  if (w.coiExp <= addDays(30)) return 'soon';
  return 'ok';
}

/* ---------- calendar ---------- */
export type EventKind = 'appt' | 'follow' | 'start' | 'end' | 'task' | 'visit';
export interface CalEvent { id: string; date: ISODate; time?: string; kind: EventKind; title: string; sub: string; pri?: Priority; ref: Ref; address?: string; done?: boolean }

const STEP: Record<Exclude<Repeat, 'once'>, number> = { weekly: 7, biweekly: 14, monthly: 28, quarterly: 91, yearly: 365 };

/** Everything that belongs on the calendar, derived from leads, jobs (including repeat visits) and tasks. */
export function calendarEvents(s: DemoState, horizonDays = 70): CalEvent[] {
  const out: CalEvent[] = [];
  const until = addDays(horizonDays);
  for (const l of s.leads) {
    if (!isOpenLead(l, s)) continue;
    if (l.apptDate) out.push({ id: 'ev-a-' + l.id, date: l.apptDate, time: l.apptTime, kind: 'appt', title: l.name, sub: l.address, pri: l.pri, ref: { type: 'lead', id: l.id }, address: l.address });
    if (l.followUp) out.push({ id: 'ev-f-' + l.id, date: l.followUp, kind: 'follow', title: l.name, sub: l.phone, pri: l.pri, ref: { type: 'lead', id: l.id } });
  }
  for (const j of s.jobs) {
    const c = byId(s.clients, j.clientId);
    const who = c ? c.name : '';
    if (j.status === 'estimate') continue;
    const rep = j.repeat && j.repeat !== 'once' ? j.repeat : null;
    if (j.start) out.push({ id: 'ev-s-' + j.id, date: j.start, kind: 'start', title: j.name, sub: who, ref: { type: 'job', id: j.id }, address: j.address, done: j.status === 'done' });
    if (j.end && j.end !== j.start) out.push({ id: 'ev-e-' + j.id, date: j.end, kind: 'end', title: j.name, sub: who, ref: { type: 'job', id: j.id }, address: j.address, done: j.status === 'done' });
    if (rep && j.start && (j.status === 'progress' || j.status === 'contract')) {
      let d = addDaysFrom(j.start, STEP[rep]); let n = 0;
      while (d <= until && (!j.end || d <= j.end) && n < 60) {
        if (d >= addDays(-30)) out.push({ id: `ev-v-${j.id}-${d}`, date: d, kind: 'visit', title: j.name, sub: who, ref: { type: 'job', id: j.id }, address: j.address, done: d < today() });
        d = addDaysFrom(d, STEP[rep]); n++;
      }
    }
  }
  for (const t of s.tasks) {
    if (!t.due) continue;
    const j = byId(s.jobs, t.jobId);
    out.push({ id: 'ev-t-' + t.id, date: t.due, kind: 'task', title: t.title, sub: j ? j.name : assigneeName(s, t.assignee), pri: t.pri, ref: { type: 'task', id: t.id }, done: t.status === 'done' });
  }
  return out.sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
}

/* ---------- notifications ---------- */
export type NoticeCategory = 'tasks' | 'lead' | 'signature' | 'payment' | 'appointment' | 'compliance' | 'mention' | 'approval' | 'system';
export interface Notice {
  id: string; kind: string; title: string; ref: Ref; tone: 'bad' | 'warn' | 'info'; date?: ISODate; amount?: number;
  /** What the notice is about, for grouping and for a person's own choices later. */
  category?: NoticeCategory;
  /** Where the notice leads when the record's own page is not the right place (a failed rule opens Automations). */
  to?: string;
}
/**
 * Who the notices are for. Some notices are personal (a mention, a request assigned to me) and some need a capability
 * (an approval I may give, a failed automation). Without a viewer only the notices everyone shares are returned.
 */
export interface NoticeViewer { /** TeamUser id. */ id?: string; perms: Permission[] }

/** Mentions and finished signature requests stay in the list this long. */
const RECENT_DAYS = 14;
/** How close to its payment deadline an unpaid appointment has to be before it is announced. */
const PAY_SOON_HOURS = 24;

/**
 * Things that need someone's attention right now. Derived, so it is always in step with the data.
 * Pass `viewer` (the person looking and what they may do) to get their own notices as well. In a live workspace the
 * signed-in person is used when no viewer is passed.
 */
export function notices(s: DemoState, opts: { compliance: boolean; viewer?: NoticeViewer } = { compliance: true }): Notice[] {
  const out: Notice[] = [];
  const td = today();
  for (const t of s.tasks) {
    if (isOverdue(t)) out.push({ id: 'n-late-' + t.id, kind: 'overdueTask', title: t.title, ref: { type: 'task', id: t.id }, tone: 'bad', date: t.due, category: 'tasks' });
    else if (isDueToday(t)) out.push({ id: 'n-today-' + t.id, kind: 'dueToday', title: t.title, ref: { type: 'task', id: t.id }, tone: 'warn', date: t.due, category: 'tasks' });
  }
  const fresh = stageByRole(s, packOf(s), 'new')?.id;
  const viewer = opts.viewer ?? signedInViewer();
  // a person only hears about the leads they may open (their own, their offices', or all of them)
  for (const l of leadsFor(s, viewer)) {
    if (!isOpenLead(l, s)) continue;
    if (l.status === fresh) out.push({ id: 'n-new-' + l.id, kind: 'newLead', title: l.name, ref: { type: 'lead', id: l.id }, tone: 'info', date: l.created, category: 'lead' });
    if (l.apptDate === td) out.push({ id: 'n-appt-' + l.id, kind: 'apptToday', title: l.name, ref: { type: 'lead', id: l.id }, tone: 'info', date: td, category: 'appointment' });
    if (l.followUp && l.followUp <= td) out.push({ id: 'n-fu-' + l.id, kind: 'followUp', title: l.name, ref: { type: 'lead', id: l.id }, tone: 'warn', date: l.followUp, category: 'lead' });
  }
  for (const d of s.docs) if (d.kind === 'contract' && (d.status === 'sent' || d.status === 'viewed')) out.push({ id: 'n-doc-' + d.id, kind: 'docWaiting', title: d.title, ref: { type: 'doc', id: d.id }, tone: 'warn', date: d.updated, category: 'signature' });
  if (opts.compliance) for (const w of s.workers) {
    if (w.active === false) continue;
    if (!w.w9) out.push({ id: 'n-w9-' + w.id, kind: 'w9Missing', title: w.name, ref: { type: 'worker', id: w.id }, tone: 'bad', category: 'compliance' });
    const ins = insuranceState(w);
    if (ins === 'expired') out.push({ id: 'n-coi-' + w.id, kind: 'coiExpired', title: w.name, ref: { type: 'worker', id: w.id }, tone: 'bad', date: w.coiExp, category: 'compliance' });
    else if (ins === 'soon') out.push({ id: 'n-coi-' + w.id, kind: 'coiSoon', title: w.name, ref: { type: 'worker', id: w.id }, tone: 'warn', date: w.coiExp, category: 'compliance' });
  }
  for (const j of s.jobs) if (j.status === 'done') { const m = jobMoney(s, j); if (m.clientOwes > 0.005) out.push({ id: 'n-bal-' + j.id, kind: 'balance', title: j.name, ref: { type: 'job', id: j.id }, tone: 'warn', amount: m.clientOwes, category: 'payment' }); }
  if (viewer) out.push(...personalNotices(s, viewer));
  const rank = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone] || (a.date || '').localeCompare(b.date || ''));
}
/** The leads a viewer may open. Without a viewer nothing is known about the person, so the list is left whole. */
const leadsFor = (s: DemoState, v: NoticeViewer | undefined): Lead[] => (v ? visibleLeads(s, byId(s.users, v.id), v.perms) : s.leads);
/** The signed-in person of a live workspace. A sample workspace has no session: there the caller says who is looking. */
function signedInViewer(): NoticeViewer | undefined {
  const who = session();
  return who && who.mode === 'workspace' && who.role !== 'worker' ? { id: who.actorId, perms: who.permissions ?? [] } : undefined;
}

/**
 * Notices that depend on who is looking: mentions, client requests assigned to them, approvals they may give, unpaid
 * appointments close to their deadline, signature requests that finished, deadlines, and rules that failed.
 * Each one goes to the person responsible, or to someone who oversees the firm (`reports`), never to everyone: a notice
 * nobody can act on is noise.
 */
function personalNotices(s: DemoState, v: NoticeViewer): Notice[] {
  const out: Notice[] = [];
  const has = (p: Permission) => v.perms.includes(p);
  const since = addDays(-RECENT_DAYS);
  const name = (clientId?: string, leadId?: string) => byId(s.clients, clientId)?.name ?? byId(s.leads, leadId)?.name ?? '';
  const oversees = has('reports');

  if (v.id) {
    const me = v.id;
    // someone wrote @me in a task comment or in a note on a lead, a client or an engagement
    for (const t of s.tasks) for (const c of t.comments ?? []) {
      if (c.by !== me && c.mentions?.includes(me) && c.at.slice(0, 10) >= since) out.push({ id: 'n-mention-' + c.id, kind: 'mention', title: t.title, ref: { type: 'task', id: t.id }, tone: 'info', date: c.at.slice(0, 10), category: 'mention' });
    }
    const noted: [Ref['type'], { id: string; name: string; notes: { id: string; at: string; by?: string; mentions?: string[] }[] }[]][] = [['lead', leadsFor(s, v)], ['client', s.clients], ['job', s.jobs]];
    for (const [type, list] of noted) for (const rec of list) for (const n of rec.notes) {
      if (n.by !== me && n.mentions?.includes(me) && n.at.slice(0, 10) >= since) out.push({ id: 'n-mention-' + n.id, kind: 'mention', title: rec.name, ref: { type, id: rec.id }, tone: 'info', date: n.at.slice(0, 10), category: 'mention' });
    }
    // a client asked for something and it is mine to answer (late or due today is already announced as a task)
    for (const t of s.tasks) {
      if (isClientRequest(t) && isOpenTask(t) && t.assignee === 'u:' + me && !isOverdue(t) && !isDueToday(t)) out.push({ id: 'n-req-' + t.id, kind: 'requestMine', title: t.title, ref: { type: 'task', id: t.id }, tone: 'warn', date: t.due ?? t.created, category: 'tasks' });
    }
    // a rule left this person a note (its "notify" step): an unread internal message addressed to them by name
    const mine = byId(s.users, me)?.name;
    if (mine) for (const m of s.messages) {
      if (m.channel === 'system' && m.dir === 'in' && m.read === false && m.to === mine) out.push({ id: 'n-note-' + m.id, kind: 'ruleNote', title: m.subject || m.body, ref: m.ref, tone: 'info', date: m.at.slice(0, 10), category: 'system' });
    }
  }

  // approvals this person may give. Under the two-person rule nobody approves their own request.
  if (has('secureApprove')) {
    const twoPeople = vaultRules(s).approval === 'second_person';
    for (const r of s.reveals ?? []) {
      if (r.status === 'pending' && !(twoPeople && r.requestedBy === v.id)) out.push({ id: 'n-reveal-' + r.id, kind: 'revealPending', title: name(r.clientId), ref: { type: 'client', id: r.clientId }, to: `/clients/${r.clientId}/secure`, tone: 'warn', date: r.at.slice(0, 10), category: 'approval' });
    }
  }
  if (has('allClients')) for (const r of s.accessRequests ?? []) {
    if (r.status === 'pending') out.push({ id: 'n-access-' + r.id, kind: 'accessPending', title: name(r.clientId), ref: { type: 'client', id: r.clientId }, tone: 'warn', date: r.at.slice(0, 10), category: 'approval' });
  }

  // a prepaid appointment that is still unpaid and close to the moment its slot is released
  if (has('appointments')) {
    const soon = new Date(Date.now() + PAY_SOON_HOURS * 3600000).toISOString(); const now = new Date().toISOString();
    for (const a of s.appointments ?? []) {
      if (a.status !== 'awaiting_payment' || !(a.staffId === v.id || oversees)) continue;
      const near = a.payBy ? a.payBy <= soon : a.date <= addDays(1);
      if (near) out.push({ id: 'n-pay-' + a.id, kind: 'apptUnpaid', title: name(a.clientId, a.leadId), ref: { type: 'appointment', id: a.id }, tone: a.payBy && a.payBy < now ? 'bad' : 'warn', date: (a.payBy ?? a.date).slice(0, 10), amount: has('money') ? a.fee : undefined, category: 'payment' });
    }
  }

  // signature requests that finished, for whoever sent them
  if (has('esign')) for (const e of s.envelopes ?? []) {
    if (!(e.createdBy === v.id || oversees)) continue;
    if (e.status === 'completed' && e.completedAt && e.completedAt.slice(0, 10) >= since) out.push({ id: 'n-env-' + e.id, kind: 'envelopeDone', title: e.title, ref: { type: 'envelope', id: e.id }, tone: 'info', date: e.completedAt.slice(0, 10), category: 'signature' });
    if (e.status === 'declined') {
      const at = [...e.events].reverse().find((x) => x.kind === 'declined')?.at ?? e.events[e.events.length - 1]?.at ?? e.sentAt ?? e.created;
      if (at.slice(0, 10) >= since) out.push({ id: 'n-env-' + e.id, kind: 'envelopeDeclined', title: e.title, ref: { type: 'envelope', id: e.id }, tone: 'bad', date: at.slice(0, 10), category: 'signature' });
    }
  }

  // deadlines of the firm and of its clients: late, or inside their reminder window
  if (has('deadlines')) for (const i of s.complianceItems ?? []) {
    if (!(i.assignee === v.id || (oversees && (!i.assignee || deadlineState(i) === 'overdue')))) continue;
    const st = deadlineState(i);
    if (st === 'overdue') out.push({ id: 'n-dl-' + i.id, kind: 'deadlineOverdue', title: i.title, ref: { type: 'compliance', id: i.id }, tone: 'bad', date: i.due, category: 'compliance' });
    else if (st === 'soon') out.push({ id: 'n-dl-' + i.id, kind: 'deadlineSoon', title: i.title, ref: { type: 'compliance', id: i.id }, tone: 'warn', date: i.due, category: 'compliance' });
  }

  // a rule that could not finish its work
  if (has('automations')) for (const r of s.automation.runs) {
    if (r.status === 'failed' && r.at.slice(0, 10) >= since) out.push({ id: 'n-run-' + r.id, kind: 'autoFailed', title: r.error || r.ruleId, ref: r.ref ?? { type: 'task', id: '' }, to: '/automations', tone: 'bad', date: r.at.slice(0, 10), category: 'system' });
  }
  return out;
}

/* ---------- client requests ---------- */
export const CLIENT_REQUEST = 'client_request';
export const isClientRequest = (t: Task) => t.type === CLIENT_REQUEST;
/** Days a request has been open (or took, once answered). */
export const requestAge = (t: Task): number => Math.max(0, daysBetween(t.created, t.status === 'done' && t.doneAt ? t.doneAt : today()));

/* ---------- deadlines ---------- */
export type DeadlineState = 'done' | 'waived' | 'overdue' | 'soon' | 'upcoming';
/** Days before the due date at which an item counts as "due soon" when it has no reminder of its own. */
export const DEADLINE_SOON_DAYS = 7;
export function deadlineState(i: ComplianceItem): DeadlineState {
  if (i.status === 'done') return 'done';
  if (i.status === 'waived') return 'waived';
  const td = today();
  if (i.due < td) return 'overdue';
  const window = Math.max(DEADLINE_SOON_DAYS, ...(i.remind ?? []));
  return i.due <= addDays(window) ? 'soon' : 'upcoming';
}
export const isOpenDeadline = (i: ComplianceItem) => i.status === 'open';
/** Open items, most urgent first. */
export const openDeadlines = (s: DemoState): ComplianceItem[] => (s.complianceItems ?? []).filter(isOpenDeadline).sort((a, b) => a.due.localeCompare(b.due));
export const deadlinesOfClient = (s: DemoState, clientId: string): ComplianceItem[] => (s.complianceItems ?? []).filter((i) => i.clientId === clientId).sort((a, b) => a.due.localeCompare(b.due));

/* ---------- money in whole cents ----------
   Amounts are stored as dollars with cents. Adding many of them as fractions drifts (0.1 + 0.2), so every total below is
   added up in whole cents and turned back into dollars once, at the end. */
export const cents = (n: number | null | undefined): number => Math.round((Number(n) || 0) * 100);
export const dollars = (c: number): number => c / 100;
export const sumCents = <T,>(list: T[] | undefined, pick: (x: T) => number | null | undefined): number => (list || []).reduce((a, x) => a + cents(pick(x)), 0);
/** Cent-safe total in dollars. */
export const total = <T,>(list: T[] | undefined, pick: (x: T) => number | null | undefined): number => dollars(sumCents(list, pick));

/* ---------- what clients owe (professional services) ---------- */
export type AgingBucket = 'd0' | 'd31' | 'd61' | 'd91';
export const AGING_BUCKETS: AgingBucket[] = ['d0', 'd31', 'd61', 'd91'];
export const agingBucket = (days: number): AgingBucket => (days <= 30 ? 'd0' : days <= 60 ? 'd31' : days <= 90 ? 'd61' : 'd91');
export interface OpenBalance { job: Job; client?: Client; price: number; received: number; balance: number; /** The day the balance is counted from. */ since: ISODate; days: number; bucket: AgingBucket }

/** The day an engagement's balance is counted from: its invoice, else the day it was finished, else its start, else the day it was opened. */
export function balanceSince(s: DemoState, job: Job): ISODate {
  const invoice = s.docs.filter((d) => d.jobId === job.id && d.kind === 'invoice' && d.status !== 'void' && d.status !== 'draft').sort((a, b) => a.created.localeCompare(b.created))[0];
  return invoice?.created || (job.status === 'done' && job.end) || job.start || job.created;
}
/** Engagements with money still to collect: work in progress or completed, fee minus payments received. Largest first. */
export function openBalances(s: DemoState): OpenBalance[] {
  const out: OpenBalance[] = [];
  for (const job of s.jobs) {
    if (job.status !== 'progress' && job.status !== 'done') continue;
    const price = cents(job.price), received = sumCents(job.received, (r) => r.amount);
    if (price - received <= 0) continue;
    const since = balanceSince(s, job); const days = Math.max(0, daysBetween(since, today()));
    out.push({ job, client: byId(s.clients, job.clientId), price: dollars(price), received: dollars(received), balance: dollars(price - received), since, days, bucket: agingBucket(days) });
  }
  return out.sort((a, b) => b.balance - a.balance);
}
/** Open balances added up per aging bucket. */
export function agingTotals(list: OpenBalance[]): Record<AgingBucket, { count: number; amount: number }> {
  const out = Object.fromEntries(AGING_BUCKETS.map((b) => [b, { count: 0, amount: 0 }])) as Record<AgingBucket, { count: number; amount: number }>;
  for (const b of AGING_BUCKETS) { const rows = list.filter((r) => r.bucket === b); out[b] = { count: rows.length, amount: total(rows, (r) => r.balance) }; }
  return out;
}

/* ---------- appointment fees and credits ---------- */
export const isUpcomingAppt = (a: Appointment) => a.status === 'requested' || a.status === 'scheduled' || a.status === 'awaiting_payment' || a.status === 'confirmed';
export const isCancelledAppt = (a: Appointment) => a.status === 'cancelled_unpaid' || a.status === 'cancelled_client' || a.status === 'cancelled_staff';
/** A credit the client can still use: not used, not voided, not past its last day. */
export const isOpenCredit = (c: Credit) => !c.used && !c.void && (!c.expires || c.expires >= today());
export function appointmentMoney(s: DemoState) {
  const list = s.appointments ?? [];
  const paid = list.filter((a) => a.paid && a.paid.method !== 'credit');
  const byCredit = list.filter((a) => a.paid && a.paid.method === 'credit');
  const unpaid = list.filter((a) => a.status === 'awaiting_payment');
  const open = (s.credits ?? []).filter(isOpenCredit);
  return {
    paid, byCredit, unpaid, openCredits: open,
    feesReceived: total(paid, (a) => a.paid?.amount), creditsApplied: total(byCredit, (a) => a.paid?.amount),
    unpaidFees: total(unpaid, (a) => a.fee), creditsOpen: total(open, (c) => c.amount),
  };
}

/* ---------- petty cash ---------- */
/** True when two records belong to the same cash drawer. A firm without offices has one drawer. */
export const sameDrawer = (a: string | undefined, b: string | undefined) => (a ?? '') === (b ?? '');
export const cashCloseOf = (s: DemoState, date: ISODate, officeId?: string): CashClose | undefined => (s.cashCloses ?? []).find((c) => c.date === date && sameDrawer(c.officeId, officeId));
/** The last day that was counted and closed for a drawer, or '' when it was never closed. Entries up to that day are locked. */
export function cashLockedThrough(s: DemoState, officeId?: string): ISODate | '' {
  return (s.cashCloses ?? []).filter((c) => sameDrawer(c.officeId, officeId)).reduce((max, c) => (c.date > max ? c.date : max), '');
}
export const isCashLocked = (s: DemoState, e: Pick<CashEntry, 'date' | 'officeId' | 'closeId'>): boolean => !!e.closeId || (!!cashLockedThrough(s, e.officeId) && e.date <= cashLockedThrough(s, e.officeId));
const signed = (e: CashEntry) => (e.dir === 'in' ? cents(e.amount) : -cents(e.amount));
/**
 * What the drawer should hold at the end of `date`: the last count before that day, plus what came in, minus what went
 * out since. This is the figure the daily close compares the count against.
 */
export function cashExpected(s: DemoState, date: ISODate, officeId?: string): number {
  const last = (s.cashCloses ?? []).filter((c) => c.date < date && sameDrawer(c.officeId, officeId)).sort((a, b) => b.date.localeCompare(a.date))[0];
  const open = (s.cash ?? []).filter((e) => sameDrawer(e.officeId, officeId) && e.date <= date && !e.closeId && (!last || e.date > last.date));
  return dollars(cents(last?.counted) + open.reduce((a, e) => a + signed(e), 0));
}
/** What the drawer holds right now, by the records. */
export function cashBalance(s: DemoState, officeId?: string): number {
  const locked = cashLockedThrough(s, officeId);
  // on a day that is already closed the drawer holds what was counted, plus anything dated after it
  return cashExpected(s, locked && locked >= today() ? addDaysFrom(locked, 1) : today(), officeId);
}
export interface CashLine { kind: 'entry' | 'close'; date: ISODate; entry?: CashEntry; close?: CashClose; /** Drawer balance after this line. */ balance: number }
/** The ledger of one drawer, oldest first, with the running balance. A close sets the balance to what was counted. */
export function cashLedger(s: DemoState, officeId?: string): CashLine[] {
  const entries = (s.cash ?? []).filter((e) => sameDrawer(e.officeId, officeId)).map((e, i) => ({ e, i })).sort((a, b) => a.e.date.localeCompare(b.e.date) || a.i - b.i).map((x) => x.e);
  const closes = (s.cashCloses ?? []).filter((c) => sameDrawer(c.officeId, officeId)).sort((a, b) => a.date.localeCompare(b.date));
  const out: CashLine[] = []; let bal = 0; let ci = 0;
  const closeUpTo = (date: ISODate | null) => { while (ci < closes.length && (date === null || closes[ci].date < date)) { bal = cents(closes[ci].counted); out.push({ kind: 'close', date: closes[ci].date, close: closes[ci], balance: dollars(bal) }); ci++; } };
  for (const e of entries) { closeUpTo(e.date); bal += signed(e); out.push({ kind: 'entry', date: e.date, entry: e, balance: dollars(bal) }); }
  closeUpTo(null);
  return out;
}

/** Leads still sitting in the first stage: nobody has acted on them yet. */
export function newLeads(s: DemoState): Lead[] { const first = stageByRole(s, packOf(s), 'new')?.id; return first ? s.leads.filter((l) => l.status === first) : []; }

/* ---------- dashboard figures ---------- */
/** `leads`: the leads the person looking may open, when the figures are for one person. Left out, every lead counts. */
export function kpiValues(s: DemoState, leads: Lead[] = s.leads) {
  const active = s.jobs.filter((j) => j.status === 'progress');
  const month = today().slice(0, 7);
  const weekEnd = addDays(7);
  const ev = calendarEvents(s, 14);
  return {
    activeJobs: active.length,
    activeValue: sum(active, (j) => j.price),
    expectedProfit: sum(active, (j) => jobMoney(s, j).profit),
    clientsOwe: sum(s.jobs.filter((j) => j.status === 'progress' || j.status === 'done'), (j) => Math.max(0, jobMoney(s, j).clientOwes)),
    oweWorkers: sum(s.jobs.filter((j) => j.status !== 'estimate'), (j) => Math.max(0, jobMoney(s, j).oweWorkers)),
    newLeads: leads === s.leads ? newLeads(s).length : newLeads({ ...s, leads }).length,
    pipelineValue: sum(leads.filter((l) => isOpenLead(l, s)), (l) => l.value),
    visitsThisWeek: ev.filter((e) => e.date >= today() && e.date <= weekEnd && (e.kind === 'visit' || e.kind === 'start' || e.kind === 'appt')).length,
    overdueTasks: s.tasks.filter(isOverdue).length,
    recurringClients: new Set(s.jobs.filter((j) => j.repeat && j.repeat !== 'once' && j.status === 'progress').map((j) => j.clientId)).size,
    collectedMonth: sum(s.jobs, (j) => sum(j.received.filter((r) => r.date.startsWith(month)), (r) => r.amount)),
  };
}
export type KpiValues = ReturnType<typeof kpiValues>;

/** Activity entries that belong to a record, newest first. */
export function activityFor(s: DemoState, ref: Ref) {
  return s.activity.filter((a) => (a.ref.type === ref.type && a.ref.id === ref.id) || (a.also || []).some((r) => r.type === ref.type && r.id === ref.id));
}
