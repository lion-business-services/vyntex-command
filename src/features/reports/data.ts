// Builds every report from the business data. Nothing here is typed in by hand: each row is a group of real records,
// money comes from jobMoney()/workerMoney(), and the same table feeds the chart, the screen and the CSV file.
import type { DemoState, Job, JobStatus, Lang, LeadSource, LeadStage } from '@/domain/types';
import type { TFn } from '@/i18n';
import type { IndustryPack } from '@/packs/types';
import { assigneeName, byId, isOpenLead, isOverdue, jobMoney, kpiValues, workerMoney } from '@/domain/selectors';
import { fmtDate, monthLabel, toISODate, today } from '@/lib/dates';
import { money, pct, sum } from '@/lib/money';

export type TabId = 'profit' | 'sales' | 'money' | 'work' | 'team';
export type Period = 'month' | '3m' | 'year' | 'all';
export const TABS: TabId[] = ['profit', 'sales', 'money', 'work', 'team'];
export const PERIODS: Period[] = ['month', '3m', 'year', 'all'];
/** Which breakdowns each tab offers. The first one is shown by default. */
export const VIEWS: Record<TabId, string[]> = {
  profit: ['job', 'type', 'month'],
  sales: ['stage', 'source'],
  money: ['collected', 'outstanding', 'paidWorkers'],
  work: ['status', 'assignee'],
  team: ['worker'],
};
/** Tabs whose figures depend on the chosen period. The others describe today, or a fixed six-month window. */
export const HAS_PERIOD: Record<TabId, boolean> = { profit: true, sales: true, money: false, work: false, team: false };

export type CellKind = 'text' | 'money' | 'int' | 'pct';
export type Cell = string | number | null;
export interface Col { key: string; label: string; kind: CellKind }
export interface Row { id: string; cells: Record<string, Cell>; /** Smaller line under the first cell. */ sub?: string; to?: string }
export type SeriesTone = 'accent' | 'info' | 'violet' | 'ok' | 'warn' | 'bad';
export interface Series { label: string; tone: SeriesTone }
export interface ChartItem { id: string; label: string; values: number[]; /** Text at the end of the bar or on top of the column. */ tip: string }
export interface Chart { type: 'bars' | 'columns'; series: Series[]; items: ChartItem[]; unit: 'money' | 'int' }
export interface Figure { label: string; value: string; hint?: string; tone?: 'neg' }
export interface Report {
  /** Title of the breakdown in view, used for the chart label, the print header and the CSV file name. */
  title: string;
  note?: string;
  figures: Figure[];
  cols: Col[];
  rows: Row[];
  total?: Record<string, Cell>;
  chart: Chart;
}

export interface Env { data: DemoState; t: TFn; lang: Lang; pack: IndustryPack; period: Period }

const STAGES: LeadStage[] = ['new', 'contacted', 'scheduled', 'sent', 'won', 'lost'];
const SOURCES: LeadSource[] = ['website', 'phone', 'referral', 'facebook', 'instagram', 'google', 'other'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** First day covered by a period, or '' for all time. "Last 3 months" is this month and the two before it. */
export function periodStart(p: Period): string {
  const d = new Date();
  if (p === 'month') return toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
  if (p === '3m') return toISODate(new Date(d.getFullYear(), d.getMonth() - 2, 1));
  if (p === 'year') return toISODate(new Date(d.getFullYear(), 0, 1));
  return '';
}
/** The last `n` months as YYYY-MM, oldest first, ending with the current month. */
export function lastMonths(n: number): string[] {
  const d = new Date(); const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(toISODate(new Date(d.getFullYear(), d.getMonth() - i, 1)).slice(0, 7));
  return out;
}
const monthName = (ym: string, lang: Lang) => cap(monthLabel(ym, lang));
/** Short month for chart axes ("Oct"); the table next to the chart carries the full name and year. */
const monthShort = (ym: string, lang: Lang) => cap(fmtDate(ym + '-01', lang, { month: 'short' }).replace('.', ''));
/** Date a job counts under: its start date, or the day it was created when it has no start yet. */
const jobDate = (j: Job) => j.start || j.created;

/* ---------- profit ---------- */
function profitReport(env: Env, view: string): Report {
  const { data, t, lang } = env;
  const from = periodStart(env.period);
  const jobs = data.jobs.filter((j) => j.status !== 'estimate' && (!from || jobDate(j) >= from));
  const m = new Map(jobs.map((j) => [j.id, jobMoney(data, j)]));
  const totals = (list: Job[]) => {
    const price = sum(list, (j) => m.get(j.id)!.price), labor = sum(list, (j) => m.get(j.id)!.labor), expenses = sum(list, (j) => m.get(j.id)!.expenses);
    const profit = price - labor - expenses;
    return { price, labor, expenses, profit, margin: price ? profit / price : null };
  };
  const all = totals(jobs);
  const figures: Figure[] = [
    { label: t('reports.col.price'), value: money(all.price), hint: t('reports.fig.jobs', { n: jobs.length }) },
    { label: t('reports.col.labor'), value: money(all.labor) },
    { label: t('reports.col.expenses'), value: money(all.expenses) },
    { label: t('reports.col.profit'), value: money(all.profit), hint: all.margin === null ? undefined : t('reports.fig.margin', { pct: pct(all.margin) }), tone: all.profit < 0 ? 'neg' : undefined },
  ];
  const moneyCols: Col[] = [
    { key: 'price', label: t('reports.col.price'), kind: 'money' }, { key: 'labor', label: t('reports.col.labor'), kind: 'money' },
    { key: 'expenses', label: t('reports.col.expenses'), kind: 'money' }, { key: 'profit', label: t('reports.col.profit'), kind: 'money' }, { key: 'margin', label: t('reports.col.margin'), kind: 'pct' },
  ];
  const series: Series[] = [{ label: t('reports.col.labor'), tone: 'info' }, { label: t('reports.col.expenses'), tone: 'violet' }, { label: t('reports.col.profit'), tone: 'ok' }];
  const split = (x: ReturnType<typeof totals>) => [x.labor, x.expenses, Math.max(0, x.profit)];
  const note = t('reports.profit.note');

  if (view === 'job') {
    const sorted = [...jobs].sort((a, b) => m.get(b.id)!.profit - m.get(a.id)!.profit);
    return {
      title: t('reports.view.job'), note, figures,
      cols: [{ key: 'label', label: t('reports.col.job'), kind: 'text' }, { key: 'status', label: t('common.status'), kind: 'text' }, ...moneyCols],
      rows: sorted.map((j) => { const x = totals([j]); return { id: j.id, to: `/jobs/${j.id}`, sub: byId(data.clients, j.clientId)?.name, cells: { label: j.name, status: t('st_' + j.status), ...x } }; }),
      total: { label: t('common.total'), status: '', ...all },
      chart: { type: 'bars', unit: 'money', series, items: sorted.map((j) => { const x = totals([j]); return { id: j.id, label: j.name, values: split(x), tip: money(x.profit) }; }) },
    };
  }
  const groups = new Map<string, Job[]>();
  for (const j of jobs) { const k = view === 'type' ? j.type : jobDate(j).slice(0, 7); groups.set(k, [...(groups.get(k) || []), j]); }
  const keys = [...groups.keys()];
  if (view === 'type') keys.sort((a, b) => totals(groups.get(b)!).profit - totals(groups.get(a)!).profit); else keys.sort();
  const name = (k: string) => (view === 'type' ? t('ty_' + k) : monthName(k, lang));
  const rows = keys.map((k) => { const list = groups.get(k)!; return { id: k, cells: { label: name(k), count: list.length, ...totals(list) } }; });
  const first: Col = { key: 'label', label: t(view === 'type' ? 'reports.col.type' : 'reports.col.month'), kind: 'text' };
  return {
    title: t('reports.view.' + view), note: view === 'month' ? `${note} ${t('reports.profit.monthNote')}` : note, figures,
    cols: [first, { key: 'count', label: t('reports.col.jobs'), kind: 'int' }, ...moneyCols], rows,
    total: { label: t('common.total'), count: jobs.length, ...all },
    chart: view === 'type'
      ? { type: 'bars', unit: 'money', series, items: keys.map((k) => { const x = totals(groups.get(k)!); return { id: k, label: name(k), values: split(x), tip: money(x.profit) }; }) }
      : { type: 'columns', unit: 'money', series: [{ label: t('reports.col.profit'), tone: 'ok' }], items: keys.map((k) => { const x = totals(groups.get(k)!); return { id: k, label: monthShort(k, lang), values: [x.profit], tip: money(x.profit) }; }) },
  };
}

/* ---------- sales ---------- */
function salesReport(env: Env, view: string): Report {
  const { data, t } = env;
  const from = periodStart(env.period);
  const leads = data.leads.filter((l) => !from || l.created >= from);
  const won = leads.filter((l) => l.status === 'won'), lost = leads.filter((l) => l.status === 'lost'), open = leads.filter(isOpenLead);
  const closed = won.length + lost.length;
  const valued = leads.filter((l) => Number(l.value) > 0);
  const figures: Figure[] = [
    { label: t('reports.fig.leads'), value: String(leads.length), hint: t('reports.fig.wonLost', { won: won.length, lost: lost.length }) },
    { label: t('reports.fig.winRate'), value: closed ? pct(won.length / closed) : t('reports.na'), hint: closed ? t('reports.fig.winRateHint', { won: won.length, closed }) : t('reports.fig.noClosed') },
    { label: t('reports.fig.avgValue'), value: valued.length ? money(sum(valued, (l) => l.value) / valued.length) : t('reports.na'), hint: t('reports.fig.avgHint', { n: valued.length }) },
    { label: t('reports.fig.pipeline'), value: money(sum(open, (l) => l.value)), hint: t('reports.fig.openLeads', { n: open.length }) },
  ];
  const tone: Series[] = [{ label: t('reports.col.leads'), tone: 'accent' }];
  if (view === 'source') {
    const rows = SOURCES.map((s) => {
      const list = leads.filter((l) => l.source === s); const w = list.filter((l) => l.status === 'won').length; const lo = list.filter((l) => l.status === 'lost').length;
      return { id: s, cells: { label: t('src_' + s), count: list.length, won: w, rate: w + lo ? w / (w + lo) : null, value: sum(list, (l) => l.value) } };
    }).filter((r) => r.cells.count > 0).sort((a, b) => b.cells.count - a.cells.count);
    return {
      title: t('reports.view.source'), figures,
      cols: [{ key: 'label', label: t('common.source'), kind: 'text' }, { key: 'count', label: t('reports.col.leads'), kind: 'int' }, { key: 'won', label: t('reports.col.won'), kind: 'int' }, { key: 'rate', label: t('reports.fig.winRate'), kind: 'pct' }, { key: 'value', label: t('reports.col.estValue'), kind: 'money' }],
      rows, total: { label: t('common.total'), count: leads.length, won: won.length, rate: closed ? won.length / closed : null, value: sum(leads, (l) => l.value) },
      chart: { type: 'bars', unit: 'int', series: tone, items: rows.map((r) => ({ id: r.id, label: r.cells.label, values: [r.cells.count], tip: String(r.cells.count) })) },
    };
  }
  const rows = STAGES.map((s) => { const list = leads.filter((l) => l.status === s); return { id: s, cells: { label: t('ls_' + s), count: list.length, share: leads.length ? list.length / leads.length : null, value: sum(list, (l) => l.value) } }; });
  return {
    title: t('reports.view.stage'), figures,
    cols: [{ key: 'label', label: t('reports.col.stage'), kind: 'text' }, { key: 'count', label: t('reports.col.leads'), kind: 'int' }, { key: 'share', label: t('reports.col.share'), kind: 'pct' }, { key: 'value', label: t('reports.col.estValue'), kind: 'money' }],
    rows: leads.length ? rows : [], total: { label: t('common.total'), count: leads.length, share: leads.length ? 1 : null, value: sum(leads, (l) => l.value) },
    chart: { type: 'bars', unit: 'int', series: tone, items: rows.map((r) => ({ id: r.id, label: r.cells.label, values: [r.cells.count], tip: String(r.cells.count) })) },
  };
}

/* ---------- money ---------- */
function moneyReport(env: Env, view: string): Report {
  const { data, t, lang } = env;
  const months = lastMonths(6);
  const received = data.jobs.flatMap((j) => j.received);
  const inMonth = <T extends { date: string }>(list: T[], ym: string) => list.filter((x) => x.date.startsWith(ym));
  const collected6 = sum(months, (ym) => sum(inMonth(received, ym), (r) => r.amount));
  const paid6 = sum(months, (ym) => sum(inMonth(data.workerPays, ym), (p) => p.amount));
  const kpi = kpiValues(data);
  const figures: Figure[] = [
    { label: t('reports.fig.collectedMonth'), value: money(kpi.collectedMonth), hint: monthName(today().slice(0, 7), lang) },
    { label: t('reports.fig.collected6'), value: money(collected6), hint: t('reports.fig.six') },
    { label: t('reports.fig.outstanding'), value: money(kpi.clientsOwe), hint: t('reports.fig.asOfToday') },
    { label: t('reports.fig.paidWorkers6'), value: money(paid6), hint: t('reports.fig.six') },
  ];
  if (view === 'outstanding') {
    const rows = data.clients.map((c) => {
      const due = data.jobs.filter((j) => j.clientId === c.id && (j.status === 'progress' || j.status === 'done')).map((j) => jobMoney(data, j)).filter((x) => x.clientOwes > 0.005);
      return { id: c.id, to: `/clients/${c.id}`, cells: { label: c.name, count: due.length, price: sum(due, (x) => x.price), received: sum(due, (x) => x.received), owes: sum(due, (x) => x.clientOwes) } };
    }).filter((r) => r.cells.owes > 0.005).sort((a, b) => b.cells.owes - a.cells.owes);
    return {
      title: t('reports.view.outstanding'), note: t('reports.money.outstandingNote'), figures,
      cols: [{ key: 'label', label: t('reports.col.client'), kind: 'text' }, { key: 'count', label: t('reports.col.jobs'), kind: 'int' }, { key: 'price', label: t('reports.col.price'), kind: 'money' }, { key: 'received', label: t('reports.col.received'), kind: 'money' }, { key: 'owes', label: t('reports.col.outstanding'), kind: 'money' }],
      rows, total: { label: t('common.total'), count: sum(rows, (r) => r.cells.count), price: sum(rows, (r) => r.cells.price), received: sum(rows, (r) => r.cells.received), owes: sum(rows, (r) => r.cells.owes) },
      chart: { type: 'bars', unit: 'money', series: [{ label: t('reports.col.outstanding'), tone: 'warn' }], items: rows.map((r) => ({ id: r.id, label: r.cells.label, values: [r.cells.owes], tip: money(r.cells.owes) })) },
    };
  }
  const list: { date: string; amount: number }[] = view === 'paidWorkers' ? data.workerPays : received;
  const rows = months.map((ym) => { const x = inMonth(list, ym); return { id: ym, cells: { label: monthName(ym, lang), count: x.length, amount: sum(x, (p) => p.amount) } }; });
  const any = rows.some((r) => r.cells.count > 0);
  const label = t(view === 'paidWorkers' ? 'reports.col.paidOut' : 'reports.col.collected');
  return {
    title: t('reports.view.' + (view === 'paidWorkers' ? 'paidWorkers' : 'collected')), note: t('reports.money.sixNote'), figures,
    cols: [{ key: 'label', label: t('reports.col.month'), kind: 'text' }, { key: 'count', label: t('reports.col.payments'), kind: 'int' }, { key: 'amount', label, kind: 'money' }],
    rows: any ? rows : [], total: { label: t('common.total'), count: sum(rows, (r) => r.cells.count), amount: sum(rows, (r) => r.cells.amount) },
    chart: { type: 'columns', unit: 'money', series: [{ label, tone: view === 'paidWorkers' ? 'violet' : 'accent' }], items: rows.map((r) => ({ id: r.id, label: monthShort(r.id, lang), values: [r.cells.amount], tip: money(r.cells.amount) })) },
  };
}

/* ---------- work ---------- */
function workReport(env: Env, view: string): Report {
  const { data, t, pack } = env;
  const done = data.tasks.filter((x) => x.status === 'done'), late = data.tasks.filter(isOverdue);
  const open = data.tasks.filter((x) => x.status !== 'done' && !isOverdue(x));
  const figures: Figure[] = [
    { label: t('reports.fig.jobsOpen'), value: String(data.jobs.filter((j) => j.status !== 'done' && j.status !== 'estimate').length), hint: `${t('st_done')}: ${data.jobs.filter((j) => j.status === 'done').length}` },
    { label: t('reports.fig.tasksDone'), value: String(done.length), hint: data.tasks.length ? t('reports.fig.ofTasks', { pct: pct(done.length / data.tasks.length), n: data.tasks.length }) : undefined },
    { label: t('reports.fig.tasksOpen'), value: String(open.length), hint: t('reports.fig.onTime') },
    { label: t('reports.fig.tasksLate'), value: String(late.length), tone: late.length ? 'neg' : undefined },
  ];
  if (view === 'assignee') {
    const codes = [...new Set(data.tasks.map((x) => x.assignee || ''))];
    const rows = codes.map((code) => {
      const mine = data.tasks.filter((x) => (x.assignee || '') === code);
      const d = mine.filter((x) => x.status === 'done').length, l = mine.filter(isOverdue).length;
      const worker = code.startsWith('w:') ? byId(data.workers, code.slice(2)) : undefined;
      return { id: code || 'none', sub: worker?.trade, cells: { label: assigneeName(data, code) || t('common.unassigned'), done: d, open: mine.length - d - l, late: l, total: mine.length } };
    }).sort((a, b) => b.cells.total - a.cells.total);
    return {
      title: t('reports.view.assignee'), note: t('reports.work.note'), figures,
      cols: [{ key: 'label', label: t('common.assignedTo'), kind: 'text' }, { key: 'done', label: t('reports.fig.tasksDone'), kind: 'int' }, { key: 'open', label: t('reports.fig.tasksOpen'), kind: 'int' }, { key: 'late', label: t('reports.fig.tasksLate'), kind: 'int' }, { key: 'total', label: t('common.total'), kind: 'int' }],
      rows, total: { label: t('common.total'), done: done.length, open: open.length, late: late.length, total: data.tasks.length },
      chart: { type: 'bars', unit: 'int', series: [{ label: t('reports.fig.tasksDone'), tone: 'ok' }, { label: t('reports.fig.tasksOpen'), tone: 'info' }, { label: t('reports.fig.tasksLate'), tone: 'bad' }], items: rows.map((r) => ({ id: r.id, label: r.cells.label, values: [r.cells.done, r.cells.open, r.cells.late], tip: String(r.cells.total) })) },
    };
  }
  const order: JobStatus[] = pack.jobStatuses;
  const rows = order.map((s) => { const list = data.jobs.filter((j) => j.status === s); return { id: s, cells: { label: t('st_' + s), count: list.length, share: data.jobs.length ? list.length / data.jobs.length : null, price: sum(list, (j) => j.price) } }; });
  return {
    title: t('reports.view.status'), note: t('reports.work.note'), figures,
    cols: [{ key: 'label', label: t('common.status'), kind: 'text' }, { key: 'count', label: t('reports.col.jobs'), kind: 'int' }, { key: 'share', label: t('reports.col.share'), kind: 'pct' }, { key: 'price', label: t('reports.col.price'), kind: 'money' }],
    rows: data.jobs.length ? rows : [], total: { label: t('common.total'), count: data.jobs.length, share: data.jobs.length ? 1 : null, price: sum(data.jobs, (j) => j.price) },
    chart: { type: 'bars', unit: 'int', series: [{ label: t('reports.col.jobs'), tone: 'accent' }], items: rows.map((r) => ({ id: r.id, label: r.cells.label, values: [r.cells.count], tip: String(r.cells.count) })) },
  };
}

/* ---------- team ---------- */
function teamReport(env: Env): Report {
  const { data, t } = env;
  const year = new Date().getFullYear();
  const rows = data.workers.map((w) => {
    const x = workerMoney(data, w.id, year);
    return { id: w.id, to: `/team/${w.id}`, sub: w.trade, cells: { label: w.name, agreed: x.agreed, paid: x.paid, owed: x.owed, paidYear: x.paidYear } };
  }).filter((r) => r.cells.agreed || r.cells.paid).sort((a, b) => b.cells.owed - a.cells.owed || b.cells.paid - a.cells.paid);
  const tot = { agreed: sum(rows, (r) => r.cells.agreed), paid: sum(rows, (r) => r.cells.paid), owed: sum(rows, (r) => r.cells.owed), paidYear: sum(rows, (r) => r.cells.paidYear) };
  const figures: Figure[] = [
    { label: t('reports.col.agreed'), value: money(tot.agreed), hint: t('reports.fig.people', { n: rows.length }) },
    { label: t('reports.col.paid'), value: money(tot.paid) },
    { label: t('reports.col.owed'), value: money(tot.owed), hint: t('reports.fig.asOfToday') },
    { label: t('reports.col.paidYear', { year }), value: money(tot.paidYear) },
  ];
  return {
    title: t('reports.view.worker'), note: t('reports.team.note'), figures,
    cols: [{ key: 'label', label: t('reports.col.worker'), kind: 'text' }, { key: 'agreed', label: t('reports.col.agreed'), kind: 'money' }, { key: 'paid', label: t('reports.col.paid'), kind: 'money' }, { key: 'owed', label: t('reports.col.owed'), kind: 'money' }, { key: 'paidYear', label: t('reports.col.paidYear', { year }), kind: 'money' }],
    rows, total: { label: t('common.total'), ...tot },
    chart: { type: 'bars', unit: 'money', series: [{ label: t('reports.col.paid'), tone: 'accent' }, { label: t('reports.col.owed'), tone: 'warn' }], items: rows.map((r) => ({ id: r.id, label: r.cells.label, values: [r.cells.paid, Math.max(0, r.cells.owed)], tip: money(r.cells.agreed) })) },
  };
}

export function buildReport(tab: TabId, view: string, env: Env): Report {
  switch (tab) {
    case 'profit': return profitReport(env, view);
    case 'sales': return salesReport(env, view);
    case 'money': return moneyReport(env, view);
    case 'work': return workReport(env, view);
    default: return teamReport(env);
  }
}

/* ---------- output ---------- */
/** `none` is what an empty number shows as ("n/a"): a margin with no price, a win rate with nothing decided. */
export function cellText(v: Cell, kind: CellKind, none: string): string {
  if (v === null || v === undefined || v === '') return kind === 'text' ? '' : none;
  if (kind === 'money') return money(Number(v));
  if (kind === 'pct') return pct(Number(v));
  return String(v);
}
const csvCell = (v: Cell, kind: CellKind): string => {
  if (v === null || v === undefined) return '';
  if (kind === 'money') return (Math.round(Number(v) * 100) / 100).toFixed(2);
  if (kind === 'pct') return (Math.round(Number(v) * 1000) / 10).toFixed(1);
  if (kind === 'int') return String(v);
  const s = String(v);
  // a leading = + - @ would be read as a formula by spreadsheet programs
  const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
/** The table in view as CSV text: one header row, the rows, then the total. Percent columns are plain numbers (27.5 = 27.5%). */
export function toCsv(r: Report): string {
  const head = r.cols.map((c) => csvCell(c.kind === 'pct' ? `${c.label} (%)` : c.label, 'text'));
  const line = (cells: Record<string, Cell>) => r.cols.map((c) => csvCell(cells[c.key] ?? null, c.kind)).join(',');
  return [head.join(','), ...r.rows.map((x) => line(x.cells)), ...(r.total && r.rows.length ? [line(r.total)] : [])].join('\r\n') + '\r\n';
}
