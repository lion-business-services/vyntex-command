// Read-only calculations over the business data. Every number shown in the app comes from here,
// so the dashboard, the job page, reports and documents can never disagree.
import type { Client, DemoState, ISODate, Job, Lead, Priority, Ref, Repeat, Task, Worker, WorkerPayment } from './types';
import { addDays, addDaysFrom, today } from '@/lib/dates';
import { sum } from '@/lib/money';

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
export const isOpenLead = (l: Lead) => l.status !== 'won' && l.status !== 'lost';
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

const STEP: Record<Exclude<Repeat, 'once'>, number> = { weekly: 7, biweekly: 14, monthly: 28 };

/** Everything that belongs on the calendar, derived from leads, jobs (including repeat visits) and tasks. */
export function calendarEvents(s: DemoState, horizonDays = 70): CalEvent[] {
  const out: CalEvent[] = [];
  const until = addDays(horizonDays);
  for (const l of s.leads) {
    if (!isOpenLead(l)) continue;
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
export interface Notice { id: string; kind: string; title: string; ref: Ref; tone: 'bad' | 'warn' | 'info'; date?: ISODate; amount?: number }

/** Things that need someone's attention right now. Derived, so it is always in step with the data. */
export function notices(s: DemoState, opts: { compliance: boolean } = { compliance: true }): Notice[] {
  const out: Notice[] = [];
  const td = today();
  for (const t of s.tasks) {
    if (isOverdue(t)) out.push({ id: 'n-late-' + t.id, kind: 'overdueTask', title: t.title, ref: { type: 'task', id: t.id }, tone: 'bad', date: t.due });
    else if (isDueToday(t)) out.push({ id: 'n-today-' + t.id, kind: 'dueToday', title: t.title, ref: { type: 'task', id: t.id }, tone: 'warn', date: t.due });
  }
  for (const l of s.leads) {
    if (!isOpenLead(l)) continue;
    if (l.status === 'new') out.push({ id: 'n-new-' + l.id, kind: 'newLead', title: l.name, ref: { type: 'lead', id: l.id }, tone: 'info', date: l.created });
    if (l.apptDate === td) out.push({ id: 'n-appt-' + l.id, kind: 'apptToday', title: l.name, ref: { type: 'lead', id: l.id }, tone: 'info', date: td });
    if (l.followUp && l.followUp <= td) out.push({ id: 'n-fu-' + l.id, kind: 'followUp', title: l.name, ref: { type: 'lead', id: l.id }, tone: 'warn', date: l.followUp });
  }
  for (const d of s.docs) if (d.kind === 'contract' && (d.status === 'sent' || d.status === 'viewed')) out.push({ id: 'n-doc-' + d.id, kind: 'docWaiting', title: d.title, ref: { type: 'doc', id: d.id }, tone: 'warn', date: d.updated });
  if (opts.compliance) for (const w of s.workers) {
    if (w.active === false) continue;
    if (!w.w9) out.push({ id: 'n-w9-' + w.id, kind: 'w9Missing', title: w.name, ref: { type: 'worker', id: w.id }, tone: 'bad' });
    const ins = insuranceState(w);
    if (ins === 'expired') out.push({ id: 'n-coi-' + w.id, kind: 'coiExpired', title: w.name, ref: { type: 'worker', id: w.id }, tone: 'bad', date: w.coiExp });
    else if (ins === 'soon') out.push({ id: 'n-coi-' + w.id, kind: 'coiSoon', title: w.name, ref: { type: 'worker', id: w.id }, tone: 'warn', date: w.coiExp });
  }
  for (const j of s.jobs) if (j.status === 'done') { const m = jobMoney(s, j); if (m.clientOwes > 0.005) out.push({ id: 'n-bal-' + j.id, kind: 'balance', title: j.name, ref: { type: 'job', id: j.id }, tone: 'warn', amount: m.clientOwes }); }
  const rank = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone] || (a.date || '').localeCompare(b.date || ''));
}

/* ---------- dashboard figures ---------- */
export function kpiValues(s: DemoState) {
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
    newLeads: s.leads.filter((l) => l.status === 'new').length,
    pipelineValue: sum(s.leads.filter(isOpenLead), (l) => l.value),
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
