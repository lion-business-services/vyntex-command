// Reports of the professional-services edition. Same shape as the field reports (./data.ts): each report is a table built
// from the records, and the same table feeds the chart, the screen and the CSV file. Money is added up in whole cents.
// A report with nothing behind it returns no rows, and the screen says so: a zero is never dressed up as a result.
//
//   sales          pipeline by stage and by source (with conversion), response time, idle leads
//   money          revenue received by month, service, service line and person; open balances and their age
//   work           engagements by status and by service; tasks by person; client requests and how long they take
//   appointments   outcomes, by person, credits issued and used
//   growth         cross-sell opportunities by state, review requests
//   profit         the field report, unchanged (owner only)
import type { Appointment, DemoState, Job, Lead } from '@/domain/types';
import { isWon, isLost, leadIsOpen } from '@/domain/config';
import { AGING_BUCKETS, agingTotals, assigneeName, byId, isCancelledAppt, isClientRequest, isOpenCredit, isOpenTask, isOverdue, openBalances, requestAge, total } from '@/domain/selectors';
import { daysBetween, fmtDate, monthLabel, today } from '@/lib/dates';
import { money, pct } from '@/lib/money';
import { buildReport as buildFieldReport, periodStart, type Chart, type Env, type Figure, type Period, type Report, type Row } from './data';

export type PracticeTab = 'sales' | 'money' | 'work' | 'appointments' | 'growth' | 'profit';
export const PRACTICE_TABS: PracticeTab[] = ['sales', 'money', 'work', 'appointments', 'growth', 'profit'];
export const PRACTICE_VIEWS: Record<PracticeTab, string[]> = {
  sales: ['stage', 'source', 'response', 'idle'],
  money: ['month', 'service', 'category', 'person', 'outstanding', 'aging'],
  work: ['status', 'service', 'assignee', 'requests'],
  appointments: ['outcome', 'staff', 'credits'],
  growth: ['crosssell', 'reviews'],
  profit: ['job', 'type', 'month'],
};
/** Breakdowns that describe today, whatever period is chosen. Every other one follows the period. */
const AS_OF_TODAY = new Set(['sales/idle', 'money/outstanding', 'money/aging', 'work/status', 'work/service', 'work/assignee']);
export const practiceHasPeriod = (tab: PracticeTab, view: string): boolean => !AS_OF_TODAY.has(`${tab}/${view}`);
/** A lead nobody has reached in this many days is idle. */
export const IDLE_DAYS = 7;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const inPeriod = (date: string | undefined, p: Period) => { const from = periodStart(p); return !!date && (!from || date.slice(0, 10) >= from); };
const none = (title: string, figures: Figure[], note?: string): Report => ({ title, note, figures, cols: [], rows: [], chart: { type: 'bars', unit: 'int', series: [], items: [] } });
const bars = (rows: Row[], key: string, label: string, unit: Chart['unit'], tone: Chart['series'][number]['tone'] = 'accent'): Chart =>
  ({ type: 'bars', unit, series: [{ label, tone }], items: rows.map((r) => ({ id: r.id, label: String(r.cells.label ?? ''), values: [Number(r.cells[key]) || 0], tip: unit === 'money' ? money(Number(r.cells[key]) || 0) : String(r.cells[key] ?? 0) })) });
/** "1 day", "2.5 days". */
const daysText = (t: Env['t'], n: number): string => t(n === 1 ? 'reports.p.day' : 'reports.p.days', { n });
const avg = (list: number[]): number | null => (list.length ? Math.round((list.reduce((a, n) => a + n, 0) / list.length) * 10) / 10 : null);

/* ---------- sales: response time and idle leads ---------- */
/** The day a lead was first reached: its first recorded call, text, email or visit, or its last contact when no note says. */
export function firstContact(l: Lead): string | undefined {
  const notes = l.notes.filter((n) => n.kind !== 'note').map((n) => n.at.slice(0, 10)).sort();
  return notes[0] ?? l.lastContact?.slice(0, 10);
}
function responseReport(env: Env): Report {
  const { data, t } = env;
  const leads = data.leads.filter((l) => inPeriod(l.created, env.period));
  const days = (l: Lead) => { const c = firstContact(l); return c ? Math.max(0, daysBetween(l.created, c)) : null; };
  const reached = leads.filter((l) => days(l) !== null);
  const waiting = leads.filter((l) => days(l) === null && leadIsOpen(data, l));
  const sameDay = reached.filter((l) => (days(l) as number) <= 1).length;
  const all = avg(reached.map((l) => days(l) as number));
  const title = t('reports.p.view.response'); const note = t('reports.p.note.response');
  const figures: Figure[] = [
    { label: t('reports.p.fig.avgResponse'), value: all === null ? t('reports.na') : daysText(t, all), hint: t('reports.p.fig.reached', { n: reached.length }) },
    { label: t('reports.p.fig.within1'), value: reached.length ? pct(sameDay / reached.length) : t('reports.na'), hint: reached.length ? t('reports.p.fig.ofReached', { n: sameDay, total: reached.length }) : undefined },
    { label: t('reports.p.fig.notReached'), value: String(waiting.length), tone: waiting.length ? 'neg' : undefined, hint: t('reports.p.fig.stillOpen') },
    { label: t('reports.fig.leads'), value: String(leads.length) },
  ];
  if (!leads.length) return none(title, figures, note);
  const owners = [...new Set(leads.map((l) => l.ownerId))];
  const rows = owners.map((id) => {
    const mine = leads.filter((l) => l.ownerId === id); const got = mine.filter((l) => days(l) !== null);
    const wait = mine.filter((l) => days(l) === null && leadIsOpen(data, l));
    return { id: id || 'none', cells: { label: byId(data.users, id)?.name ?? t('common.unassigned'), leads: mine.length, reached: got.length, avg: avg(got.map((l) => days(l) as number)), waiting: wait.length, longest: wait.length ? Math.max(...wait.map((l) => daysBetween(l.created, today()))) : null } };
  }).sort((a, b) => b.cells.leads - a.cells.leads);
  return {
    title, note, figures,
    cols: [{ key: 'label', label: t('reports.p.col.person'), kind: 'text' }, { key: 'leads', label: t('reports.col.leads'), kind: 'int' }, { key: 'reached', label: t('reports.p.col.reached'), kind: 'int' }, { key: 'avg', label: t('reports.p.col.avgDays'), kind: 'int' }, { key: 'waiting', label: t('reports.p.col.notReached'), kind: 'int' }, { key: 'longest', label: t('reports.p.col.longest'), kind: 'int' }],
    rows, total: { label: t('common.total'), leads: leads.length, reached: reached.length, avg: all, waiting: waiting.length, longest: waiting.length ? Math.max(...waiting.map((l) => daysBetween(l.created, today()))) : null },
    chart: { type: 'bars', unit: 'int', series: [{ label: t('reports.p.col.reached'), tone: 'ok' }, { label: t('reports.p.col.notReached'), tone: 'bad' }], items: rows.map((r) => ({ id: r.id, label: r.cells.label, values: [r.cells.reached, r.cells.waiting], tip: r.cells.avg === null ? t('reports.na') : daysText(t, r.cells.avg) })) },
  };
}
function idleReport(env: Env): Report {
  const { data, t } = env; const td = today();
  const last = (l: Lead) => (l.lastContact?.slice(0, 10) ?? [...l.notes].map((n) => n.at.slice(0, 10)).sort().pop() ?? l.created);
  const open = data.leads.filter((l) => leadIsOpen(data, l));
  const idle = open.map((l) => ({ l, days: Math.max(0, daysBetween(last(l), td)) })).filter((x) => x.days >= IDLE_DAYS).sort((a, b) => b.days - a.days);
  const title = t('reports.p.view.idle'); const note = t('reports.p.note.idle', { n: IDLE_DAYS });
  const figures: Figure[] = [
    { label: t('reports.p.fig.idle'), value: String(idle.length), tone: idle.length ? 'neg' : undefined, hint: t('reports.fig.openLeads', { n: open.length }) },
    { label: t('reports.p.fig.idleValue'), value: money(total(idle, (x) => x.l.value)) },
    { label: t('reports.p.fig.longestIdle'), value: idle.length ? daysText(t, idle[0].days) : t('reports.na') },
    { label: t('reports.p.fig.noNext'), value: String(open.filter((l) => !l.nextAction && !l.followUp).length), hint: t('reports.p.fig.noNextHint') },
  ];
  if (!idle.length) return none(title, figures, note);
  const rows = idle.map(({ l, days }) => ({ id: l.id, to: `/leads/${l.id}`, sub: l.company, cells: { label: l.name, stage: t('ls_' + l.status), owner: byId(data.users, l.ownerId)?.name ?? t('common.unassigned'), last: last(l), days, value: l.value ?? 0 } }));
  return {
    title, note, figures,
    cols: [{ key: 'label', label: t('reports.p.col.lead'), kind: 'text' }, { key: 'stage', label: t('reports.col.stage'), kind: 'text' }, { key: 'owner', label: t('reports.p.col.person'), kind: 'text' }, { key: 'last', label: t('reports.p.col.lastContact'), kind: 'text' }, { key: 'days', label: t('reports.p.col.idleDays'), kind: 'int' }, { key: 'value', label: t('reports.col.estValue'), kind: 'money' }],
    rows, total: { label: t('common.total'), stage: '', owner: '', last: '', days: null, value: total(idle, (x) => x.l.value) },
    chart: bars(rows, 'days', t('reports.p.col.idleDays'), 'int', 'warn'),
  };
}

/* ---------- money: what was received, and what is still owed ---------- */
interface Receipt { date: string; amount: number; job?: Job; appt?: Appointment }
function receipts(data: DemoState, p: Period): Receipt[] {
  const out: Receipt[] = [];
  for (const j of data.jobs) for (const r of j.received) if (inPeriod(r.date, p)) out.push({ date: r.date, amount: r.amount, job: j });
  for (const a of data.appointments ?? []) if (a.paid && a.paid.method !== 'credit' && inPeriod(a.paid.at, p)) out.push({ date: a.paid.at.slice(0, 10), amount: a.paid.amount, appt: a });
  return out;
}
function revenueReport(env: Env, view: string): Report {
  const { data, t, lang } = env;
  const list = receipts(data, env.period);
  const owed = openBalances(data);
  const fees = list.filter((r) => r.appt);
  const figures: Figure[] = [
    { label: t('reports.p.fig.received'), value: money(total(list, (r) => r.amount)), hint: t('reports.p.fig.payments', { n: list.length }) },
    { label: t('reports.p.fig.apptFees'), value: money(total(fees, (r) => r.amount)), hint: t('reports.p.fig.payments', { n: fees.length }) },
    { label: t('reports.p.fig.owed'), value: money(total(owed, (b) => b.balance)), hint: t('reports.fig.asOfToday') },
    { label: t('reports.p.fig.over90'), value: money(agingTotals(owed).d91.amount), tone: agingTotals(owed).d91.count ? 'neg' : undefined, hint: t('reports.fig.asOfToday') },
  ];
  const title = t('reports.p.view.' + view); const note = t('reports.p.note.revenue');
  if (!list.length) return none(title, figures, note);
  const group = (keyOf: (r: Receipt) => string, label: (k: string) => string, order?: (a: string, b: string) => number) => {
    const keys = [...new Set(list.map(keyOf))];
    const rows = keys.map((k) => { const mine = list.filter((r) => keyOf(r) === k); return { id: k || 'none', cells: { label: label(k), count: mine.length, amount: total(mine, (r) => r.amount), share: total(mine, (r) => r.amount) / (total(list, (r) => r.amount) || 1) } }; });
    return order ? rows.sort((a, b) => order(a.id, b.id)) : rows.sort((a, b) => b.cells.amount - a.cells.amount);
  };
  const FEES = '~fees';
  const serviceOf = (j: Job) => byId(data.catalog, j.serviceId);
  const first = view === 'month' ? t('reports.col.month') : view === 'service' ? t('reports.p.col.service') : view === 'category' ? t('reports.p.col.category') : t('reports.p.col.person');
  const rows = view === 'month' ? group((r) => r.date.slice(0, 7), (k) => cap(monthLabel(k, lang)), (a, b) => a.localeCompare(b))
    : view === 'service' ? group((r) => (r.appt ? FEES : serviceOf(r.job!)?.id ?? ''), (k) => (k === FEES ? t('reports.p.apptFees') : byId(data.catalog, k)?.name ?? t('reports.p.noService')))
    : view === 'category' ? group((r) => (r.appt ? FEES : serviceOf(r.job!)?.category ?? r.job!.type), (k) => (k === FEES ? t('reports.p.apptFees') : env.pack.serviceTypes.some((s) => s.id === k) ? t('ty_' + k) : k))
    : group((r) => (r.appt ? r.appt.staffId : r.job!.managerId), (k) => byId(data.users, k)?.name ?? t('common.unassigned'));
  return {
    title, note: view === 'person' ? `${note} ${t('reports.p.note.person')}` : note, figures,
    cols: [{ key: 'label', label: first, kind: 'text' }, { key: 'count', label: t('reports.col.payments'), kind: 'int' }, { key: 'amount', label: t('reports.col.received'), kind: 'money' }, { key: 'share', label: t('reports.col.share'), kind: 'pct' }],
    rows, total: { label: t('common.total'), count: list.length, amount: total(list, (r) => r.amount), share: 1 },
    chart: view === 'month'
      ? { type: 'columns', unit: 'money', series: [{ label: t('reports.col.received'), tone: 'accent' }], items: rows.slice(-12).map((r) => ({ id: r.id, label: cap(fmtDate(r.id + '-01', lang, { month: 'short' }).replace('.', '')), values: [r.cells.amount], tip: money(r.cells.amount) })) }
      : bars(rows, 'amount', t('reports.col.received'), 'money'),
  };
}
function balancesReport(env: Env, view: string): Report {
  const { data, t } = env;
  const owed = openBalances(data); const aging = agingTotals(owed); const sum = total(owed, (b) => b.balance);
  const figures: Figure[] = [
    { label: t('reports.p.fig.owed'), value: money(sum), hint: t('reports.p.fig.onJobs', { n: owed.length }) },
    { label: t('reports.p.fig.clientsOwing'), value: String(new Set(owed.map((b) => b.job.clientId)).size) },
    { label: t('reports.p.fig.over90'), value: money(aging.d91.amount), tone: aging.d91.count ? 'neg' : undefined, hint: t('reports.p.fig.onJobs', { n: aging.d91.count }) },
    { label: t('reports.p.fig.oldest'), value: owed.length ? daysText(t, Math.max(...owed.map((b) => b.days))) : t('reports.na') },
  ];
  const title = t('reports.p.view.' + view); const note = t('reports.p.note.aging');
  if (!owed.length) return none(title, figures, note);
  if (view === 'aging') {
    const rows = AGING_BUCKETS.map((b) => ({ id: b, cells: { label: t('reports.p.age.' + b), count: aging[b].count, amount: aging[b].amount, share: sum ? aging[b].amount / sum : null } }));
    return {
      title, note, figures,
      cols: [{ key: 'label', label: t('reports.p.col.age'), kind: 'text' }, { key: 'count', label: t('reports.p.col.balances'), kind: 'int' }, { key: 'amount', label: t('reports.col.outstanding'), kind: 'money' }, { key: 'share', label: t('reports.col.share'), kind: 'pct' }],
      rows, total: { label: t('common.total'), count: owed.length, amount: sum, share: 1 }, chart: bars(rows, 'amount', t('reports.col.outstanding'), 'money', 'warn'),
    };
  }
  const ids = [...new Set(owed.map((b) => b.job.clientId))];
  const rows = ids.map((id) => { const mine = owed.filter((b) => b.job.clientId === id); const a = agingTotals(mine); return { id, to: `/clients/${id}`, cells: { label: byId(data.clients, id)?.name ?? '', count: mine.length, d0: a.d0.amount, d31: a.d31.amount, d61: a.d61.amount, d91: a.d91.amount, owes: total(mine, (b) => b.balance) } }; }).sort((a, b) => b.cells.owes - a.cells.owes);
  return {
    title, note, figures,
    cols: [{ key: 'label', label: t('reports.col.client'), kind: 'text' }, { key: 'count', label: t('reports.p.col.balances'), kind: 'int' }, ...AGING_BUCKETS.map((b) => ({ key: b, label: t('reports.p.age.' + b), kind: 'money' as const })), { key: 'owes', label: t('reports.col.outstanding'), kind: 'money' }],
    rows, total: { label: t('common.total'), count: owed.length, d0: aging.d0.amount, d31: aging.d31.amount, d61: aging.d61.amount, d91: aging.d91.amount, owes: sum },
    chart: bars(rows, 'owes', t('reports.col.outstanding'), 'money', 'warn'),
  };
}

/* ---------- work: engagements by service, client requests ---------- */
function serviceReport(env: Env): Report {
  const { data, t } = env;
  const jobs = data.jobs; const active = (j: Job) => j.status === 'progress' || j.status === 'contract' || j.status === 'hold';
  const figures: Figure[] = [
    { label: t('reports.p.fig.jobs'), value: String(jobs.length) },
    { label: t('reports.p.fig.active'), value: String(jobs.filter(active).length) },
    { label: t('reports.p.fig.done'), value: String(jobs.filter((j) => j.status === 'done').length) },
    { label: t('reports.p.fig.fees'), value: money(total(jobs.filter((j) => j.status !== 'estimate'), (j) => j.price)), hint: t('reports.p.fig.feesHint') },
  ];
  const title = t('reports.p.view.service');
  if (!jobs.length) return none(title, figures);
  const keys = [...new Set(jobs.map((j) => j.serviceId ?? ''))];
  const rows = keys.map((k) => { const mine = jobs.filter((j) => (j.serviceId ?? '') === k); return { id: k || 'none', to: k ? `/catalog/${k}` : undefined, cells: { label: byId(data.catalog, k)?.name ?? t('reports.p.noService'), count: mine.length, active: mine.filter(active).length, done: mine.filter((j) => j.status === 'done').length, price: total(mine.filter((j) => j.status !== 'estimate'), (j) => j.price) } }; }).sort((a, b) => b.cells.count - a.cells.count);
  return {
    title, note: t('reports.p.note.service'), figures,
    cols: [{ key: 'label', label: t('reports.p.col.service'), kind: 'text' }, { key: 'count', label: t('reports.col.jobs'), kind: 'int' }, { key: 'active', label: t('reports.p.fig.active'), kind: 'int' }, { key: 'done', label: t('reports.p.fig.done'), kind: 'int' }, { key: 'price', label: t('reports.p.fig.fees'), kind: 'money' }],
    rows, total: { label: t('common.total'), count: jobs.length, active: jobs.filter(active).length, done: jobs.filter((j) => j.status === 'done').length, price: total(jobs.filter((j) => j.status !== 'estimate'), (j) => j.price) },
    chart: { type: 'bars', unit: 'int', series: [{ label: t('reports.p.fig.active'), tone: 'accent' }, { label: t('reports.p.fig.done'), tone: 'ok' }], items: rows.map((r) => ({ id: r.id, label: r.cells.label, values: [r.cells.active, r.cells.done], tip: String(r.cells.count) })) },
  };
}
function requestsReport(env: Env): Report {
  const { data, t } = env;
  const all = data.tasks.filter((x) => isClientRequest(x) && inPeriod(x.created, env.period));
  const open = all.filter(isOpenTask); const done = all.filter((x) => !isOpenTask(x));
  const took = avg(done.map(requestAge));
  const figures: Figure[] = [
    { label: t('reports.p.fig.requests'), value: String(all.length) },
    { label: t('reports.p.fig.answered'), value: String(done.length), hint: all.length ? pct(done.length / all.length) : undefined },
    { label: t('reports.p.fig.turnaround'), value: took === null ? t('reports.na') : daysText(t, took), hint: t('reports.p.fig.turnaroundHint') },
    { label: t('reports.p.fig.waiting'), value: String(open.length), tone: open.some(isOverdue) ? 'neg' : undefined, hint: open.length ? t('reports.p.fig.oldestOpen', { age: daysText(t, Math.max(...open.map(requestAge))) }) : undefined },
  ];
  const title = t('reports.p.view.requests');
  if (!all.length) return none(title, figures, t('reports.p.note.requests'));
  const codes = [...new Set(all.map((x) => x.assignee || ''))];
  const rows = codes.map((code) => {
    const mine = all.filter((x) => (x.assignee || '') === code); const o = mine.filter(isOpenTask); const d = mine.filter((x) => !isOpenTask(x));
    return { id: code || 'none', cells: { label: assigneeName(data, code) || t('common.unassigned'), total: mine.length, done: d.length, open: o.length, late: o.filter(isOverdue).length, avg: avg(d.map(requestAge)) } };
  }).sort((a, b) => b.cells.total - a.cells.total);
  return {
    title, note: t('reports.p.note.requests'), figures,
    cols: [{ key: 'label', label: t('reports.p.col.person'), kind: 'text' }, { key: 'total', label: t('reports.p.fig.requests'), kind: 'int' }, { key: 'done', label: t('reports.p.fig.answered'), kind: 'int' }, { key: 'open', label: t('reports.p.fig.waiting'), kind: 'int' }, { key: 'late', label: t('reports.fig.tasksLate'), kind: 'int' }, { key: 'avg', label: t('reports.p.col.avgDays'), kind: 'int' }],
    rows, total: { label: t('common.total'), total: all.length, done: done.length, open: open.length, late: open.filter(isOverdue).length, avg: took },
    chart: { type: 'bars', unit: 'int', series: [{ label: t('reports.p.fig.answered'), tone: 'ok' }, { label: t('reports.p.fig.waiting'), tone: 'info' }, { label: t('reports.fig.tasksLate'), tone: 'bad' }], items: rows.map((r) => ({ id: r.id, label: r.cells.label, values: [r.cells.done, r.cells.open - r.cells.late, r.cells.late], tip: String(r.cells.total) })) },
  };
}

/* ---------- appointments ---------- */
function appointmentsReport(env: Env, view: string): Report {
  const { data, t } = env;
  const list = (data.appointments ?? []).filter((a) => inPeriod(a.date, env.period));
  const n = (f: (a: Appointment) => boolean) => list.filter(f).length;
  const completed = n((a) => a.status === 'completed'), noShow = n((a) => a.status === 'no_show'), released = n((a) => a.status === 'cancelled_unpaid');
  const held = completed + noShow;
  const paid = list.filter((a) => a.paid && a.paid.method !== 'credit');
  const figures: Figure[] = [
    { label: t('reports.p.fig.booked'), value: String(list.length), hint: t('reports.p.fig.upcoming', { n: n((a) => !isCancelledAppt(a) && a.status !== 'completed' && a.status !== 'no_show') }) },
    { label: t('reports.p.fig.completed'), value: String(completed) },
    { label: t('reports.p.fig.noShowRate'), value: held ? pct(noShow / held) : t('reports.na'), hint: held ? t('reports.p.fig.noShowHint', { n: noShow, total: held }) : t('reports.p.fig.noneHeld'), tone: noShow ? 'neg' : undefined },
    { label: t('reports.p.fig.released'), value: String(released), hint: t('reports.p.fig.releasedHint') },
  ];
  const title = t('reports.p.view.' + view);
  if (view === 'credits') {
    const credits = (data.credits ?? []).filter((c) => inPeriod(c.at, env.period));
    const cf: Figure[] = [
      { label: t('reports.p.fig.crIssued'), value: money(total(credits.filter((c) => !c.void), (c) => c.amount)), hint: t('reports.p.fig.credits', { n: credits.filter((c) => !c.void).length }) },
      { label: t('reports.p.fig.crUsed'), value: money(total(credits.filter((c) => c.used), (c) => c.amount)), hint: t('reports.p.fig.credits', { n: credits.filter((c) => c.used).length }) },
      { label: t('reports.p.fig.crOpen'), value: money(total(credits.filter(isOpenCredit), (c) => c.amount)), hint: t('reports.p.fig.credits', { n: credits.filter(isOpenCredit).length }) },
      { label: t('reports.p.fig.crVoid'), value: String(credits.filter((c) => c.void).length) },
    ];
    if (!credits.length) return none(title, cf, t('reports.p.note.credits'));
    const reasons = [...new Set(credits.map((c) => c.reason))];
    const rows = reasons.map((r) => { const mine = credits.filter((c) => c.reason === r && !c.void); return { id: r, cells: { label: t('reports.p.cr.' + r), count: mine.length, issued: total(mine, (c) => c.amount), used: total(mine.filter((c) => c.used), (c) => c.amount), open: total(mine.filter(isOpenCredit), (c) => c.amount) } }; });
    const live = credits.filter((c) => !c.void);
    return {
      title, note: t('reports.p.note.credits'), figures: cf,
      cols: [{ key: 'label', label: t('reports.p.col.reason'), kind: 'text' }, { key: 'count', label: t('reports.p.col.credits'), kind: 'int' }, { key: 'issued', label: t('reports.p.fig.crIssued'), kind: 'money' }, { key: 'used', label: t('reports.p.fig.crUsed'), kind: 'money' }, { key: 'open', label: t('reports.p.fig.crOpen'), kind: 'money' }],
      rows, total: { label: t('common.total'), count: live.length, issued: total(live, (c) => c.amount), used: total(live.filter((c) => c.used), (c) => c.amount), open: total(live.filter(isOpenCredit), (c) => c.amount) },
      chart: { type: 'bars', unit: 'money', series: [{ label: t('reports.p.fig.crUsed'), tone: 'ok' }, { label: t('reports.p.fig.crOpen'), tone: 'accent' }], items: rows.map((r) => ({ id: r.id, label: r.cells.label, values: [r.cells.used, r.cells.open], tip: money(r.cells.issued) })) },
    };
  }
  if (!list.length) return none(title, figures, t('reports.p.note.appointments'));
  if (view === 'staff') {
    const ids = [...new Set(list.map((a) => a.staffId))];
    const rows = ids.map((id) => { const mine = list.filter((a) => a.staffId === id); const c = mine.filter((a) => a.status === 'completed').length, ns = mine.filter((a) => a.status === 'no_show').length; return { id: id || 'none', cells: { label: byId(data.users, id)?.name ?? t('common.unassigned'), booked: mine.length, completed: c, noShow: ns, rate: c + ns ? ns / (c + ns) : null, fees: total(mine.filter((a) => a.paid && a.paid.method !== 'credit'), (a) => a.paid?.amount) } }; }).sort((a, b) => b.cells.booked - a.cells.booked);
    return {
      title, note: t('reports.p.note.appointments'), figures,
      cols: [{ key: 'label', label: t('reports.p.col.person'), kind: 'text' }, { key: 'booked', label: t('reports.p.fig.booked'), kind: 'int' }, { key: 'completed', label: t('reports.p.fig.completed'), kind: 'int' }, { key: 'noShow', label: t('reports.p.col.noShow'), kind: 'int' }, { key: 'rate', label: t('reports.p.fig.noShowRate'), kind: 'pct' }, { key: 'fees', label: t('reports.p.col.feesPaid'), kind: 'money' }],
      rows, total: { label: t('common.total'), booked: list.length, completed, noShow, rate: held ? noShow / held : null, fees: total(paid, (a) => a.paid?.amount) },
      chart: { type: 'bars', unit: 'int', series: [{ label: t('reports.p.fig.completed'), tone: 'ok' }, { label: t('reports.p.col.noShow'), tone: 'bad' }], items: rows.map((r) => ({ id: r.id, label: r.cells.label, values: [r.cells.completed, r.cells.noShow], tip: String(r.cells.booked) })) },
    };
  }
  const OUT: [string, (a: Appointment) => boolean][] = [
    ['upcoming', (a) => a.status === 'requested' || a.status === 'scheduled' || a.status === 'confirmed'], ['awaiting', (a) => a.status === 'awaiting_payment'], ['completed', (a) => a.status === 'completed'], ['no_show', (a) => a.status === 'no_show'],
    ['cancelled_client', (a) => a.status === 'cancelled_client'], ['cancelled_staff', (a) => a.status === 'cancelled_staff'], ['cancelled_unpaid', (a) => a.status === 'cancelled_unpaid'],
  ];
  const rows = OUT.map(([k, f]) => { const mine = list.filter(f); return { id: k, cells: { label: t('reports.p.ap.' + k), count: mine.length, share: mine.length / list.length, fees: total(mine.filter((a) => a.paid && a.paid.method !== 'credit'), (a) => a.paid?.amount) } }; }).filter((r) => r.cells.count > 0);
  return {
    title, note: t('reports.p.note.appointments'), figures,
    cols: [{ key: 'label', label: t('reports.p.col.outcome'), kind: 'text' }, { key: 'count', label: t('nav.appointments'), kind: 'int' }, { key: 'share', label: t('reports.col.share'), kind: 'pct' }, { key: 'fees', label: t('reports.p.col.feesPaid'), kind: 'money' }],
    rows, total: { label: t('common.total'), count: list.length, share: 1, fees: total(paid, (a) => a.paid?.amount) }, chart: bars(rows, 'count', t('nav.appointments'), 'int'),
  };
}

/* ---------- growth: cross-sell and reviews ---------- */
function crossSellReport(env: Env): Report {
  const { data, t } = env;
  const list = (data.opportunities ?? []).filter((o) => inPeriod(o.created, env.period));
  const by = (s: string) => list.filter((o) => o.status === s);
  const decided = by('won').length + by('dismissed').length;
  const figures: Figure[] = [
    { label: t('reports.p.fig.opps'), value: String(list.length) },
    { label: t('reports.p.fig.oppsWon'), value: String(by('won').length), hint: decided ? t('reports.fig.winRateHint', { won: by('won').length, closed: decided }) : t('reports.p.fig.noneDecided') },
    { label: t('reports.fig.winRate'), value: decided ? pct(by('won').length / decided) : t('reports.na') },
    { label: t('reports.p.fig.oppsOpen'), value: money(total([...by('open'), ...by('contacted')], (o) => o.value)), hint: t('reports.p.fig.oppsOpenHint', { n: by('open').length + by('contacted').length }) },
  ];
  const title = t('reports.p.view.crosssell');
  if (!list.length) return none(title, figures, t('reports.p.note.crosssell'));
  const rows = ['open', 'contacted', 'won', 'dismissed'].map((s) => ({ id: s, cells: { label: t('reports.p.op.' + s), count: by(s).length, share: by(s).length / list.length, value: total(by(s), (o) => o.value) } }));
  return {
    title, note: t('reports.p.note.crosssell'), figures,
    cols: [{ key: 'label', label: t('reports.p.col.state'), kind: 'text' }, { key: 'count', label: t('nav.opportunities'), kind: 'int' }, { key: 'share', label: t('reports.col.share'), kind: 'pct' }, { key: 'value', label: t('reports.col.estValue'), kind: 'money' }],
    rows, total: { label: t('common.total'), count: list.length, share: 1, value: total(list, (o) => o.value) }, chart: bars(rows, 'count', t('nav.opportunities'), 'int'),
  };
}
function reviewsReport(env: Env): Report {
  const { data, t } = env;
  const list = (data.reviews ?? []).filter((r) => inPeriod(r.at, env.period));
  const rated = list.filter((r) => r.status === 'rated' && typeof r.rating === 'number');
  const mean = rated.length ? Math.round((rated.reduce((a, r) => a + (r.rating as number), 0) / rated.length) * 10) / 10 : null;
  // an average exists only when someone gave a rating; with none it is not shown as zero
  const figures: Figure[] = [
    { label: t('reports.p.fig.reviews'), value: String(list.length) },
    { label: t('reports.p.fig.rated'), value: String(rated.length) },
    { label: t('reports.p.fig.avgRating'), value: mean === null ? t('reports.na') : String(mean), hint: mean === null ? t('reports.p.fig.noRatings') : t('reports.p.fig.outOf5', { n: rated.length }) },
    { label: t('reports.p.fig.declined'), value: String(list.filter((r) => r.status === 'declined').length) },
  ];
  const title = t('reports.p.view.reviews');
  if (!list.length) return none(title, figures, t('reports.p.note.reviews'));
  const states = ['draft', 'demo', 'sent', 'opened', 'rated', 'declined'].filter((s) => list.some((r) => r.status === s));
  const rows = states.map((s) => ({ id: s, cells: { label: t('reports.p.rv.' + s), count: list.filter((r) => r.status === s).length, share: list.filter((r) => r.status === s).length / list.length } }));
  return {
    title, note: t('reports.p.note.reviews'), figures,
    cols: [{ key: 'label', label: t('reports.p.col.state'), kind: 'text' }, { key: 'count', label: t('reports.p.fig.reviews'), kind: 'int' }, { key: 'share', label: t('reports.col.share'), kind: 'pct' }],
    rows, total: { label: t('common.total'), count: list.length, share: 1 }, chart: bars(rows, 'count', t('reports.p.fig.reviews'), 'int'),
  };
}

export function buildPracticeReport(tab: PracticeTab, view: string, env: Env): Report {
  switch (tab) {
    case 'sales': return view === 'response' ? responseReport(env) : view === 'idle' ? idleReport(env) : conversion(buildFieldReport('sales', view, env), env, view);
    case 'money': return view === 'outstanding' || view === 'aging' ? balancesReport(env, view) : revenueReport(env, view);
    case 'work': return view === 'service' ? serviceReport(env) : view === 'requests' ? requestsReport(env) : buildFieldReport('work', view, env);
    case 'appointments': return appointmentsReport(env, view);
    case 'growth': return view === 'reviews' ? reviewsReport(env) : crossSellReport(env);
    default: return buildFieldReport('profit', view, env);
  }
}
/** The stage report, with how the pipeline converted in the period: leads won out of leads decided. */
function conversion(r: Report, env: Env, view: string): Report {
  if (view !== 'stage' || !r.rows.length) return r;
  const { data, t, pack } = env;
  const leads = data.leads.filter((l) => inPeriod(l.created, env.period));
  const won = leads.filter((l) => isWon(data, pack, l.status)).length, lost = leads.filter((l) => isLost(data, pack, l.status)).length;
  return { ...r, note: won + lost ? t('reports.p.note.conversion', { won, decided: won + lost, pct: pct(won / (won + lost)) }) : t('reports.fig.noClosed') };
}
