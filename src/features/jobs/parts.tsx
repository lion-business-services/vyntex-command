// Small pieces shared by the jobs list, the job page and the job forms.
import { LuArrowRight, LuRepeat } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import type { App } from '@/app/hooks';
import { act, getSnapshot } from '@/store/store';
import { toast } from '@/ui';
import { setJobStatus } from '@/domain/actions';
import { playbookTasks } from '@/domain/actions/catalog';
import { repeats } from '@/domain/actions/jobs';
import { moduleOn } from '@/domain/config';
import type { Assignment, AutomationRun, CatalogTier, Job, JobStatus, Lang, PayType, Repeat } from '@/domain/types';
import type { TFn } from '@/i18n';
import { fmtDate } from '@/lib/dates';
import { money, money2 } from '@/lib/money';

export const TABS = ['overview', 'team', 'money', 'tasks', 'documents', 'appointments', 'messages', 'log', 'activity'] as const;
export type JobTab = (typeof TABS)[number];
/** The tabs of a field job, in the order they have always had. */
const FIELD_TABS: JobTab[] = ['overview', 'team', 'money', 'tasks', 'documents', 'log', 'activity'];
/** An engagement has no crew; it has appointments and a conversation with the client, and its money is what was billed and received. */
const PRACTICE_TABS: JobTab[] = ['overview', 'tasks', 'documents', 'appointments', 'messages', 'log', 'money', 'activity'];
/** The tabs of one job for this edition and this viewer. */
export function tabsFor({ pack, can, data }: Pick<App, 'pack' | 'can' | 'data'>): JobTab[] {
  const list = pack.family === 'practice' ? PRACTICE_TABS : FIELD_TABS;
  return list.filter((x) => (x !== 'money' || can('money')) && (x !== 'team' || pack.usesWorkers)
    && (x !== 'appointments' || (can('appointments') && moduleOn(data, pack, 'appointments'))) && (x !== 'messages' || (can('comms') && moduleOn(data, pack, 'messages'))));
}
/** In an office the money tab is the billing of the engagement. */
export const tabLabel = (t: TFn, pack: { family: 'field' | 'practice' }, x: JobTab): string => t(x === 'money' && pack.family === 'practice' ? 'jobs.tab.billing' : 'jobs.tab.' + x);
export const REPEATS: Repeat[] = ['once', 'weekly', 'biweekly', 'monthly'];
/** How often work can repeat in an edition. Office work (a practice) also repeats by quarter and by year. */
export const repeatsOf = (pack: { family: 'field' | 'practice' }): Repeat[] => (pack.family === 'practice' ? [...REPEATS, 'quarterly', 'yearly'] : REPEATS);
export { repeats };
/** "$220.00 per month": an agreed price with the unit it was quoted in. A price without a unit, or one price for the whole work, is just the amount. */
export function priceLine(t: TFn, price: number, unit?: CatalogTier['unit']): string {
  return unit && unit !== 'flat' ? t('jobs.price.per', { price: Number.isInteger(price) ? money(price) : money2(price), unit: t('jobs.unit.' + unit) }) : Number.isInteger(price) ? money(price) : money2(price);
}

/** Pack labels were written for forms ("Scope of work (for the contract)"); headings use them without the aside. */
export const plain = (label: string) => label.replace(/\s*\([^)]*\)\s*$/, '');

/** "Oct 2" this year, "Oct 2, 2025" otherwise. */
export function shortDate(d: string, lang: Lang): string {
  const thisYear = d.slice(0, 4) === String(new Date().getFullYear());
  return fmtDate(d, lang, thisYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Start to end, plus the rhythm when the job repeats. */
export function JobDates({ job }: { job: Job }) {
  const { t, lang } = useApp();
  const rep = repeats(job) ? <span className="jobs-rep"><LuRepeat aria-hidden="true" />{t('jobs.rp.' + job.repeat)}</span> : null;
  if (!job.start && !job.end) return <span className="jobs-dates"><span className="dim">{t('jobs.noDates')}</span>{rep}</span>;
  const both = job.start && job.end && job.end !== job.start;
  return (
    <span className="jobs-dates">
      <span className="jobs-span">
        {job.start ? <span className="nowrap">{shortDate(job.start, lang)}</span> : <span className="nowrap">{t('jobs.until', { date: shortDate(job.end, lang) })}</span>}
        {both && <><LuArrowRight aria-hidden="true" /><span className="sr">{t('jobs.to')}</span><span className="nowrap">{shortDate(job.end, lang)}</span></>}
      </span>
      {rep}
    </span>
  );
}

/** How an assignment is paid, in one line: "Fixed price", "By stage" or "$220.00 / day × 5". */
export function payLine(t: TFn, a: Pick<Assignment, 'payType' | 'rate' | 'qty' | 'price'>): string {
  const type: PayType = a.payType ?? 'project';
  if (type === 'project' || type === 'milestone') return t('jobs.pt.' + type);
  return `${money2(a.rate ?? a.price)} / ${t('pu_' + type)} × ${a.qty || 1}`;
}

/* ---------- automations, told in plain words ---------- */
export interface AutoLine { kind: 'invoice' | 'tasks' | 'email' | 'workers' | 'next' | 'other'; text: string; /** Where the result lives, for a line that leads to another record. */ to?: string }

/** Runs a change and returns the automation runs it started. */
export function withRuns<R>(fn: () => R): { out: R; runs: AutomationRun[] } {
  const seen = new Set(getSnapshot().data.automation.runs.map((r) => r.id));
  const out = fn();
  return { out, runs: getSnapshot().data.automation.runs.filter((r) => !seen.has(r.id)) };
}
export function autoLines(t: TFn, runs: AutomationRun[], jobId: string): AutoLine[] {
  const out: AutoLine[] = [];
  for (const r of runs) {
    if (r.ref && !(r.ref.type === 'job' && r.ref.id === jobId)) continue;
    for (const s of r.steps) {
      const n = Number(s.params?.n) || 0;
      if (s.key === 'auto.step.invoice') out.push({ kind: 'invoice', text: t('jobs.auto.invoice') });
      else if (s.key === 'auto.step.tasks') out.push({ kind: 'tasks', text: n === 1 ? t('jobs.auto.task1') : t('jobs.auto.tasks', { n }) });
      else if (s.key === 'auto.step.email') out.push({ kind: 'email', text: t('jobs.auto.email') });
      else if (s.key === 'auto.step.notifyWorkers') out.push({ kind: 'workers', text: n === 1 ? t('jobs.auto.worker1') : t('jobs.auto.workers', { n }) });
      else { const text = t(s.key, s.params); if (text !== s.key) out.push({ kind: 'other', text: /[.!?]$/.test(text) ? text : text + '.' }); }
    }
  }
  return out;
}
/** Changes the status, then says what happened because of it: the automations, a playbook that started, the next period of repeating work. */
export function changeStatus(t: TFn, job: Job, to: JobStatus): AutoLine[] {
  if (job.status === to) return [];
  const id = job.id;
  const before = getSnapshot().data; const hadTasks = playbookTasks(before, id).length; const known = new Set(before.jobs.map((j) => j.id));
  const { runs } = withRuns(() => act(setJobStatus, id, to));
  const lines = autoLines(t, runs, id);
  const after = getSnapshot().data;
  const started = playbookTasks(after, id).length - hadTasks;
  if (started > 0) lines.push({ kind: 'tasks', text: t('jobs.auto.playbook', { n: started }) });
  const next = after.jobs.find((j) => j.parentId === id && !known.has(j.id));
  if (next) lines.push({ kind: 'next', text: t('jobs.auto.next', { period: next.period || shortDate(next.start || '', getSnapshot().prefs.lang) }), to: `/jobs/${next.id}` });
  toast([t('jobs.statusNow', { status: t('st_' + to) }), ...lines.map((l) => l.text)].join(' '));
  return lines;
}
