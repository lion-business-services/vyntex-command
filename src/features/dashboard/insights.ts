// What the dashboard works out beyond the shared selectors: short series for the sparklines, comparisons against the
// period before, the one-line state of the business and the suggested next steps. No React here, so it can be tested
// on its own. Nothing is typed in: every number comes from the records, and a comparison is only made when both sides exist.
import type { DemoState, Job, Lang, Payment } from '@/domain/types';
import type { IndustryPack } from '@/packs/types';
import type { TFn } from '@/i18n';
import type { Permission } from '@/domain/permissions';
import { byId, calendarEvents, workerMoney, type KpiValues, type Notice } from '@/domain/selectors';
import { addDays, daysBetween, fmtDate, relDay, today } from '@/lib/dates';
import { money, sum } from '@/lib/money';

export const WEEKS = 8;
/** The kinds of calendar entry the "visits" tile counts (same as kpiValues). */
const VISIT_KINDS = ['visit', 'start', 'appt'];
/** The visits tile looks at today plus the next seven days. */
export const VISIT_DAYS = 8;

/** Totals per rolling week, oldest first. The last bucket is the seven days ending today. */
export function weekly<T>(list: T[], dateOf: (x: T) => string | undefined, pick: (x: T) => number, weeks = WEEKS): number[] {
  const out: number[] = Array(weeks).fill(0); const td = today();
  for (const x of list) {
    const d = dateOf(x); if (!d) continue;
    const age = daysBetween(d.slice(0, 10), td); if (age < 0) continue;
    const bucket = Math.floor(age / 7);
    if (bucket < weeks) out[weeks - 1 - bucket] += pick(x);
  }
  return out;
}

const payments = (data: DemoState): Payment[] => data.jobs.flatMap((j) => j.received);
const ymOf = (y: number, m0: number) => `${y}-${String(m0 + 1).padStart(2, '0')}`;

export interface MonthTotal { ym: string; label: string; long: string; amount: number; count: number; current: boolean }
/** Money received from clients per calendar month, oldest first: from the first month with a payment, three to six months. */
export function collectedByMonth(data: DemoState, lang: Lang, min = 3, max = 6): MonthTotal[] {
  const td = today(); const cur = td.slice(0, 7);
  const pays = payments(data).filter((r) => r.date <= td);
  if (!pays.length) return [];
  const first = pays.reduce((a, r) => (r.date < a ? r.date : a), td).slice(0, 7);
  const y = Number(cur.slice(0, 4)), m = Number(cur.slice(5, 7)) - 1;
  const span = (y - Number(first.slice(0, 4))) * 12 + (m - (Number(first.slice(5, 7)) - 1)) + 1;
  const n = Math.max(min, Math.min(max, span));
  const out: MonthTotal[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - i, 1); const ym = ymOf(d.getFullYear(), d.getMonth());
    const inMonth = pays.filter((r) => r.date.startsWith(ym));
    out.push({ ym, label: fmtDate(ym + '-01', lang, { month: 'short' }), long: fmtDate(ym + '-01', lang, { month: 'long', year: 'numeric' }), amount: sum(inMonth, (r) => r.amount), count: inMonth.length, current: ym === cur });
  }
  return out;
}

export interface Trend { dir: 'up' | 'down' | 'flat'; /** Size of the change, already formatted; empty when there is none. */ delta: string; text: string }
const dirOf = (n: number): Trend['dir'] => (n > 0.005 ? 'up' : n < -0.005 ? 'down' : 'flat');

export interface Figures {
  /** Money received per week, last eight weeks. */
  collectedWeeks: number[];
  /** Leads that came in per week, last eight weeks. */
  leadWeeks: number[];
  /** Visits, starts and estimate visits per day, today first. */
  visitDays: number[];
  /** Collected this month against the same days of last month; `until` is the matching day of last month. */
  collected: { now: number; before: number; until: string };
  /** Leads that came in over the last seven days and the seven before. */
  leads: { now: number; before: number };
  /** Visits in the tile's window and in the same number of days just before today. */
  visits: { now: number; before: number };
}
export function figures(data: DemoState, kpi: KpiValues): Figures {
  const td = today();
  const pays = payments(data);
  const y = Number(td.slice(0, 4)), m = Number(td.slice(5, 7)) - 1;
  const prev = new Date(y, m - 1, 1); const prevYm = ymOf(prev.getFullYear(), prev.getMonth());
  // the same day of last month, or its last day when that month is shorter
  const lastOfPrev = new Date(y, m, 0).getDate();
  const until = `${prevYm}-${String(Math.min(Number(td.slice(8, 10)), lastOfPrev)).padStart(2, '0')}`;
  const ev = calendarEvents(data, 14).filter((e) => VISIT_KINDS.includes(e.kind));
  const visitDays = Array.from({ length: VISIT_DAYS }, (_, i) => { const d = addDays(i); return ev.filter((e) => e.date === d).length; });
  // the calendar drops the estimate visit of a lead once it is won or lost, so past visits are read from the leads themselves
  const from = addDays(-VISIT_DAYS), to = addDays(-1);
  const before = ev.filter((e) => e.kind !== 'appt' && e.date >= from && e.date <= to).length + data.leads.filter((l) => !!l.apptDate && l.apptDate >= from && l.apptDate <= to).length;
  const leadWeeks = weekly(data.leads, (l) => l.created, () => 1);
  return {
    collectedWeeks: weekly(pays, (r) => r.date, (r) => r.amount),
    leadWeeks, visitDays,
    collected: { now: kpi.collectedMonth, before: sum(pays.filter((r) => r.date.startsWith(prevYm) && r.date <= until), (r) => r.amount), until },
    leads: { now: leadWeeks[WEEKS - 1], before: leadWeeks[WEEKS - 2] },
    visits: { now: kpi.visitsThisWeek, before },
  };
}
/** Comparisons shown on the tiles. A tile gets one only when there is something on at least one side of it. */
export function trends(f: Figures, t: TFn, lang: Lang): { collectedMonth?: Trend; newLeads?: Trend; visitsThisWeek?: Trend } {
  const out: ReturnType<typeof trends> = {};
  const c = f.collected;
  if (c.now > 0 || c.before > 0) out.collectedMonth = { dir: dirOf(c.now - c.before), delta: Math.abs(c.now - c.before) > 0.005 ? money(Math.abs(c.now - c.before)) : '', text: t('dash.trend.collected', { prev: money(c.before), date: fmtDate(c.until, lang, { month: 'short', day: 'numeric' }) }) };
  const l = f.leads;
  if (l.now > 0 || l.before > 0) out.newLeads = { dir: dirOf(l.now - l.before), delta: l.now !== l.before ? String(Math.abs(l.now - l.before)) : '', text: t('dash.trend.leads', { a: l.now, b: l.before }) };
  const v = f.visits;
  if (v.now > 0 || v.before > 0) out.visitsThisWeek = { dir: dirOf(v.now - v.before), delta: v.now !== v.before ? String(Math.abs(v.now - v.before)) : '', text: t('dash.trend.visits', { prev: v.before, days: VISIT_DAYS }) };
  return out;
}

/* ---------- the state of the business in one line ---------- */
export interface StatePart { id: string; text: string; to: string }
/** What is waiting on someone today, most serious first. `list` is what notices() returned. */
export function stateParts(list: Notice[], t: TFn, can: (p: Permission) => boolean): StatePart[] {
  const n1 = (key: string, n: number) => t(n === 1 ? key + '.one' : key, { n });
  const count = (kind: string) => list.filter((x) => x.kind === kind).length;
  const out: StatePart[] = [];
  const late = count('overdueTask'); if (late) out.push({ id: 'overdue', text: n1('dash.state.overdue', late), to: '/tasks' });
  if (can('team')) { const people = new Set(list.filter((x) => x.kind === 'w9Missing' || x.kind === 'coiExpired').map((x) => x.ref.id)).size; if (people) out.push({ id: 'paper', text: n1('dash.state.paper', people), to: '/team' }); }
  const follow = count('followUp'); if (follow) out.push({ id: 'follow', text: n1('dash.state.follow', follow), to: '/leads' });
  if (can('documents')) { const docs = count('docWaiting'); if (docs) out.push({ id: 'docs', text: n1('dash.state.docs', docs), to: '/documents' }); }
  if (can('money')) { const owed = sum(list.filter((x) => x.kind === 'balance'), (x) => x.amount); if (owed > 0.005) out.push({ id: 'balance', text: t('dash.state.balance', { amount: money(owed) }), to: '/payments' }); }
  const fresh = count('newLead'); if (fresh) out.push({ id: 'newLeads', text: n1('dash.state.newLeads', fresh), to: '/leads' });
  return out;
}

/* ---------- suggested next steps ---------- */
export type RecIcon = 'follow' | 'task' | 'balance' | 'paper' | 'doc' | 'lead' | 'calendar' | 'money';
export interface Rec {
  id: string; icon: RecIcon; title: string; detail?: string;
  /** A request for the assistant, worded so the built-in interpreter understands it. */
  ask?: string;
  /** Or the record to open, with the wording of the link. */
  to?: string; cta?: string;
}
export interface RecEnv { data: DemoState; pack: IndustryPack; lang: Lang; t: TFn; can: (p: Permission) => boolean; date: (d: string | undefined) => string; day: (d: string | undefined) => string; notices: Notice[]; kpi: KpiValues }

/**
 * Up to four next steps, each read off the records by a fixed rule (no model involved). The requests reuse the assistant's own
 * example sentences where one fits; every request has to be a sentence interpret() in features/assistant/engine.ts answers.
 */
export function recommendations(env: RecEnv, max = 4): Rec[] {
  const { data, pack, lang, t, can, date, day, notices: list, kpi } = env;
  const n1 = (key: string, n: number, extra?: Record<string, string | number>) => t(n === 1 ? key + '.one' : key, { n, ...extra });
  const of = (kind: string) => list.filter((x) => x.kind === kind);
  const out: Rec[] = [];

  // 1. leads waiting for a call back; when there are none, tasks that are late
  const follow = of('followUp');
  const late = of('overdueTask');
  if (follow.length) {
    const first = follow[0];
    out.push({ id: 'follow', icon: 'follow', title: n1('dash.ai.follow', follow.length, { name: first.title }), detail: follow.length > 1 && first.date ? t('dash.ai.follow.detail', { name: first.title, when: relDay(first.date, lang) }) : undefined, ask: t('asst.chip.due') });
  } else if (late.length) {
    const first = late[0];
    out.push({ id: 'overdue', icon: 'task', title: n1('dash.ai.overdue', late.length), detail: first.date ? t('dash.ai.overdue.detail', { name: first.title, when: relDay(first.date, lang) }) : undefined, ask: t('dash.ai.q.overdue') });
  }

  // 2. finished work that is not paid in full: the largest balance
  if (can('money')) {
    const owing = of('balance').sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))[0];
    const job: Job | undefined = owing ? byId(data.jobs, owing.ref.id) : undefined;
    const client = byId(data.clients, job?.clientId);
    if (owing && job && client) {
      const amount = money(owing.amount);
      // if somebody is already working on it, show who owes; otherwise offer to put the call on the list
      const handled = data.tasks.some((x) => x.jobId === job.id && x.status !== 'done');
      out.push({ id: 'balance', icon: 'balance', title: t('dash.ai.balance', { name: client.name, amount }), detail: `${job.name} · ${t('st_done')}`, ask: handled || !can('tasks') ? t('asst.chip.owed') : t('dash.ai.q.balanceTask', { name: client.name, amount }) });
    }
  }

  // 3. paperwork: a missing W-9 first, then an expired insurance certificate
  if (pack.compliance && can('compliance')) {
    const w9 = of('w9Missing')[0]; const coi = of('coiExpired')[0];
    const worker = byId(data.workers, (w9 ?? coi)?.ref.id);
    if (worker) {
      const paid = can('money') ? workerMoney(data, worker.id).paidYear : 0;
      const detail = [worker.trade, paid > 0.005 ? t('dash.ai.paidYear', { amount: money(paid) }) : ''].filter(Boolean).join(' · ');
      out.push({ id: 'paper', icon: 'paper', title: w9 ? t('dash.ai.w9', { name: worker.name }) : t('dash.ai.coi', { name: worker.name, date: date(coi.date) }), detail, ask: t('asst.chip.compliance') });
    }
  }

  // 4. agreements sent and not signed yet: straight to the document
  if (can('documents')) {
    const docs = of('docWaiting');
    const doc = byId(data.docs, docs[0]?.ref.id);
    if (doc) {
      const client = byId(data.clients, doc.clientId)?.name;
      out.push({ id: 'doc', icon: 'doc', title: n1('dash.ai.docs', docs.length), detail: [doc.title, client, t('dash.att.sentOn', { date: date(doc.updated) })].filter(Boolean).join(' · '), to: docs.length > 1 ? '/documents' : `/documents/${doc.id}`, cta: t(docs.length > 1 ? 'dash.ai.openDocs' : 'dash.ai.openDoc') });
    }
  }

  // 5. new leads nobody has contacted
  if (can('leads')) {
    const fresh = of('newLead');
    const lead = byId(data.leads, fresh[fresh.length - 1]?.ref.id);
    if (lead) out.push({ id: 'lead', icon: 'lead', title: n1('dash.ai.newLeads', fresh.length), detail: t('dash.ai.newLeads.detail', { name: lead.name, service: t('ty_' + lead.type) }), ask: t('asst.chip.pipeline') });
  }

  // when little is pressing: what is on the calendar, then what came in this month
  if (out.length < max && can('calendar')) {
    const to = addDays(6);
    const n = calendarEvents(data, 14).filter((e) => e.date >= today() && e.date <= to && !e.done).length;
    if (n) out.push({ id: 'calendar', icon: 'calendar', title: n1('dash.ai.calendar', n, { day: day(to) }), ask: t('asst.chip.calendar') });
  }
  if (out.length < max && can('money') && kpi.collectedMonth > 0.005) {
    out.push({ id: 'collected', icon: 'money', title: t('dash.ai.collected', { amount: money(kpi.collectedMonth), month: fmtDate(today(), lang, { month: 'long' }) }), ask: t('asst.chip.collected') });
  }
  return out.slice(0, max);
}
