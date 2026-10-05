// Jobs (a project, a service, an engagement: the edition names it) and what happens on them: assignments, expenses,
// client payments and the work log. In the professional-services edition a job is an engagement: a catalog service being
// done for a client for a period. A repeating engagement rolls forward: when one period is completed the next is created.
import type { Assignment, CatalogTier, DemoState, Expense, ISODate, Job, JobStatus, Lang, Payment, Repeat, RuleEvent } from '../types';
import { type Ctx, logActivity } from '../context';
import { emit } from '../rules/engine';
import { addDaysFrom, today } from '@/lib/dates';
import { uid } from '@/lib/id';
import { money2, sum } from '@/lib/money';
import { serviceName, serviceOf, startPlaybook, tierOf } from './catalog';
import { evaluateCrossSell, settleOpportunities } from './opportunities';

/** What an engagement keeps on top of a job: the unit its price is quoted in, taken from the catalog tier. The database keeps unknown fields. */
export type Engagement = Job & { unit?: CatalogTier['unit'] };

/**
 * Tells the rule engine what happened to a job: created, status changed, completed, payment received. Each event is
 * announced once, with the job, its client and what a rule may want to test (the status it came from and went to, the
 * amount and the balance left). The coded rules every edition has always had run from these same announcements.
 */
function announce(d: DemoState, ctx: Ctx, event: RuleEvent, job: Job, extra?: Record<string, string | number | boolean>, payment?: Payment) {
  emit(d, ctx, event, { ref: { type: 'job', id: job.id }, job, client: d.clients.find((c) => c.id === job.clientId), ...(payment ? { payment } : {}), ...(extra ? { extra } : {}) });
}
const balanceOf = (j: Job) => Math.max(0, j.price - sum(j.received, (r) => r.amount));

/* ---------- repeating work: dates and periods ---------- */
export const repeats = (j: Pick<Job, 'repeat'>): boolean => !!j.repeat && j.repeat !== 'once';
const MONTHS: Record<'en' | 'es', string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  es: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
};
const pad = (n: number) => String(n).padStart(2, '0');
/** The same day one rhythm later. Weeks are counted in days; months, quarters and years by the calendar (the 31st becomes the last day of a shorter month). */
export function shiftDate(date: ISODate, repeat: Repeat | undefined): ISODate {
  if (repeat === 'weekly') return addDaysFrom(date, 7);
  if (repeat === 'biweekly') return addDaysFrom(date, 14);
  const months = repeat === 'monthly' ? 1 : repeat === 'quarterly' ? 3 : repeat === 'yearly' ? 12 : 0;
  if (!months) return date;
  const [y, m, day] = date.split('-').map(Number);
  const at = y * 12 + (m - 1) + months; const ny = Math.floor(at / 12); const nm = at % 12;
  const last = new Date(ny, nm + 1, 0).getDate();
  return `${ny}-${pad(nm + 1)}-${pad(Math.min(day, last))}`;
}
/** How a business writes the period a date falls in: "2026", "Q4 2026", "October 2026", or the first day for work that repeats by the week. */
export function periodFor(repeat: Repeat | undefined, date: ISODate, lang: Lang): string {
  const [y, m] = date.split('-').map(Number);
  if (repeat === 'yearly') return String(y);
  if (repeat === 'quarterly') return `Q${Math.ceil(m / 3)} ${y}`;
  if (repeat === 'monthly') return `${(lang === 'es' ? MONTHS.es : MONTHS.en)[m - 1]} ${y}`;
  if (repeat === 'weekly' || repeat === 'biweekly') return date;
  return '';
}
/**
 * The period after this one, written the way the first was ("2025" gives "2026", "Q4 2026" gives "Q1 2027", "Diciembre 2026"
 * gives "Enero 2027"). A period written some other way cannot be counted forward, so the next one is named from its start date.
 */
export function nextPeriod(period: string | undefined, repeat: Repeat | undefined, nextStart: ISODate, lang: Lang): string {
  const p = (period ?? '').trim();
  if (!repeat || repeat === 'once') return '';
  if (repeat === 'yearly' && /^\d{4}$/.test(p)) return String(Number(p) + 1);
  const q = /^([QT])([1-4])\s+(\d{4})$/i.exec(p);
  if (repeat === 'quarterly' && q) { const n = Number(q[2]); return `${q[1].toUpperCase()}${n === 4 ? 1 : n + 1} ${Number(q[3]) + (n === 4 ? 1 : 0)}`; }
  const mo = /^(\p{L}+)\s+(de\s+)?(\d{4})$/iu.exec(p);
  if (repeat === 'monthly' && mo) {
    for (const names of [MONTHS.en, MONTHS.es]) {
      const at = names.findIndex((n) => n.toLowerCase() === mo[1].toLowerCase());
      if (at >= 0) return `${names[(at + 1) % 12]} ${mo[2] ?? ''}${Number(mo[3]) + (at === 11 ? 1 : 0)}`;
    }
  }
  if ((repeat === 'weekly' || repeat === 'biweekly') && /^\d{4}-\d{2}-\d{2}$/.test(p)) return shiftDate(p, repeat);
  return periodFor(repeat, nextStart, lang);
}

/* ---------- from the catalog ---------- */
/** What an engagement takes from a catalog service and one of its price tiers: name, service line, price, unit and how often it repeats. All of it can be changed afterwards. */
export function fromService(d: DemoState, ctx: Ctx, serviceId: string, tierId?: string): Partial<Engagement> | null {
  const s = serviceOf(d, serviceId); if (!s) return null;
  const tier = tierOf(s, tierId);
  const types = ctx.pack.serviceTypes.map((x) => x.id);
  const type = types.includes(s.category) ? s.category : types.includes('other') ? 'other' : types[0];
  return { name: serviceName(s, ctx.lang), type, serviceId: s.id, tierId: tier?.id, price: tier?.price ?? 0, unit: tier?.unit, repeat: s.repeat ?? 'once' };
}
/** A playbook belongs to work the client has agreed to: it starts once the engagement is past the proposal. */
const underWay = (s: JobStatus) => s === 'contract' || s === 'progress';

export function nextJobNumber(d: DemoState, ctx: Ctx): string {
  const n = d.jobs.map((j) => parseInt(String(j.number).replace(/\D/g, ''), 10) || 0);
  return `${ctx.pack.ticketPrefix}J-${Math.max(1000, ...n) + 1}`;
}
/** A job record with every field filled in. Not saved: the caller adds it to the list. */
export function blankJob(d: DemoState, ctx: Ctx, o: Partial<Job> & { name: string; clientId: string }): Job {
  // the person responsible is whoever is acting when that is an office user, otherwise the first one
  const actorIsUser = d.users.some((u) => u.id === ctx.actor);
  return { id: uid('j'), number: nextJobNumber(d, ctx), address: '', type: ctx.pack.serviceTypes[0].id, status: 'estimate', price: 0, start: '', end: '', repeat: 'once', scope: '', payTerms: '', managerId: actorIsUser ? ctx.actor : d.users[0].id, assign: [], expenses: [], received: [], log: [], notes: [], created: today(), ...o };
}
export function createJob(d: DemoState, ctx: Ctx, o: Partial<Engagement> & { name: string; clientId: string }): Job {
  const job = blankJob(d, ctx, o); d.jobs.unshift(job);
  logActivity(d, ctx.actor, 'job.created', { type: 'job', id: job.id }, { job: job.name }, [{ type: 'client', id: job.clientId }]);
  announce(d, ctx, 'job.created', job);
  if (job.status === 'progress' || job.status === 'done') announce(d, ctx, 'job.status', job, { from: 'estimate', to: job.status });
  if (job.status === 'done') announce(d, ctx, 'job.completed', job, { from: 'estimate', balance: balanceOf(job) });
  afterServiceAssigned(d, ctx, job);
  return job;
}
/**
 * What follows from a client having a service: the playbook of the service starts (once, and only for work that is under
 * way), an open suggestion for that same service is settled, and the cross-sell rules look at the client again.
 * A job without a catalog service is left alone, so an edition that keeps no catalog behaves as it always did.
 */
export function afterServiceAssigned(d: DemoState, ctx: Ctx, job: Job) {
  if (!job.serviceId) return;
  if (underWay(job.status)) startPlaybook(d, ctx, job.id);
  if (job.status !== 'estimate') settleOpportunities(d, ctx, job.clientId, job.serviceId, job.id);
  evaluateCrossSell(d, ctx, job.clientId);
}
export function updateJob(d: DemoState, ctx: Ctx, id: string, patch: Partial<Job>) {
  const j = d.jobs.find((x) => x.id === id); if (!j) return;
  const from = j.status; const service = j.serviceId; Object.assign(j, patch);
  if (patch.status && patch.status !== from) statusChanged(d, ctx, j, from);
  // a job that was given a catalog service afterwards gets what the service starts, like one created from it
  else if (j.serviceId && j.serviceId !== service) afterServiceAssigned(d, ctx, j);
}
function statusChanged(d: DemoState, ctx: Ctx, j: Job, from: JobStatus) {
  logActivity(d, ctx.actor, 'job.status', { type: 'job', id: j.id }, { status: ctx.t('st_' + j.status) }, [{ type: 'client', id: j.clientId }]);
  announce(d, ctx, 'job.status', j, { from, to: j.status });
  if (from === 'estimate') afterServiceAssigned(d, ctx, j);
  if (j.status === 'done') { announce(d, ctx, 'job.completed', j, { from, balance: balanceOf(j) }); rollForward(d, ctx, j); }
}
/**
 * The next period of a repeating engagement, created when one is completed: same client, service, price and person, dated
 * one rhythm later, pointing back at the one it follows. It happens once per engagement, and only where work is done in
 * periods (the professional-services edition): a field job that repeats stays one job with visits on the calendar.
 * A retired service is not carried into a new period.
 */
export function rollForward(d: DemoState, ctx: Ctx, j: Engagement): Job | null {
  if (ctx.pack.family !== 'practice' || !repeats(j) || d.jobs.some((x) => x.parentId === j.id)) return null;
  const service = serviceOf(d, j.serviceId);
  if (service && !service.active) { logActivity(d, 'automation', 'job.notRolled', { type: 'job', id: j.id }, { service: service.name }, [{ type: 'client', id: j.clientId }]); return null; }
  const start = shiftDate(j.start || today(), j.repeat);
  const next = blankJob(d, ctx, {
    name: j.name, clientId: j.clientId, address: j.address, type: j.type, status: 'progress', price: j.price, start, end: j.end ? shiftDate(j.end, j.repeat) : '',
    repeat: j.repeat, scope: j.scope, payTerms: j.payTerms, managerId: j.managerId, parentId: j.id, period: nextPeriod(j.period, j.repeat, start, ctx.lang),
    ...(j.serviceId ? { serviceId: j.serviceId, tierId: j.tierId } : {}), ...(j.officeId ? { officeId: j.officeId } : {}), ...(j.unit ? { unit: j.unit } : {}),
  } as Partial<Engagement> & { name: string; clientId: string });
  d.jobs.unshift(next);
  logActivity(d, 'automation', 'job.rolled', { type: 'job', id: next.id }, { job: next.name, period: next.period || start }, [{ type: 'client', id: next.clientId }, { type: 'job', id: j.id }]);
  announce(d, ctx, 'job.created', next, { rolled: true });
  startPlaybook(d, ctx, next.id);
  return next;
}
export function setJobStatus(d: DemoState, ctx: Ctx, id: string, status: JobStatus) {
  const j = d.jobs.find((x) => x.id === id); if (!j || j.status === status) return;
  const from = j.status; j.status = status; statusChanged(d, ctx, j, from);
}
export function deleteJob(d: DemoState, _ctx: Ctx, id: string) {
  d.jobs = d.jobs.filter((j) => j.id !== id); d.tasks = d.tasks.filter((t) => t.jobId !== id);
  d.docs = d.docs.filter((x) => x.jobId !== id); d.workerPays = d.workerPays.filter((p) => p.jobId !== id);
}
export function saveAssignment(d: DemoState, ctx: Ctx, jobId: string, a: Omit<Assignment, 'id'>, id?: string) {
  const j = d.jobs.find((x) => x.id === jobId); if (!j) return;
  if (id) { const cur = j.assign.find((x) => x.id === id); if (cur) Object.assign(cur, a); return; }
  j.assign.push({ ...a, id: uid('as') });
  const w = d.workers.find((x) => x.id === a.workerId);
  logActivity(d, ctx.actor, 'worker.assigned', { type: 'job', id: jobId }, { worker: w?.name ?? '', scope: a.scope }, [{ type: 'worker', id: a.workerId }]);
}
export function removeFromJob(d: DemoState, _ctx: Ctx, jobId: string, coll: 'assign' | 'expenses' | 'received' | 'log', id: string) {
  const j = d.jobs.find((x) => x.id === jobId); if (!j) return;
  (j as any)[coll] = (j[coll] as { id: string }[]).filter((x) => x.id !== id);
  // taking a client payment back reopens an invoice that was marked paid
  if (coll === 'received') {
    const inv = d.docs.find((x) => x.jobId === jobId && x.kind === 'invoice' && x.status === 'paid');
    if (inv && j.price - sum(j.received, (r) => r.amount) > 0.005) { inv.status = 'sent'; inv.updated = today(); }
  }
}
export function addExpense(d: DemoState, ctx: Ctx, jobId: string, e: Omit<Expense, 'id'>) {
  const j = d.jobs.find((x) => x.id === jobId); if (!j) return;
  j.expenses.push({ ...e, id: uid('e') });
  logActivity(d, ctx.actor, 'expense.added', { type: 'job', id: jobId }, { desc: e.desc, amount: money2(e.amount) });
}
export function addClientPayment(d: DemoState, ctx: Ctx, jobId: string, p: Omit<Payment, 'id'>) {
  const j = d.jobs.find((x) => x.id === jobId); if (!j) return;
  const payment: Payment = { ...p, id: uid('r') };
  j.received.push(payment);
  logActivity(d, ctx.actor, 'payment.received', { type: 'job', id: jobId }, { amount: money2(p.amount), job: j.name }, [{ type: 'client', id: j.clientId }]);
  announce(d, ctx, 'payment.received', j, { amount: p.amount, balance: balanceOf(j) }, payment);
}
export function addWorkLog(d: DemoState, _ctx: Ctx, jobId: string, workerId: string, text: string) {
  const j = d.jobs.find((x) => x.id === jobId); if (!j || !text.trim()) return;
  j.log.unshift({ id: uid('g'), date: today(), workerId, text: text.trim() });
}
