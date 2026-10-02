// Small pieces shared by the jobs list, the job page and the job forms.
import { LuArrowRight, LuRepeat } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { act, getSnapshot } from '@/store/store';
import { toast } from '@/ui';
import { setJobStatus } from '@/domain/actions';
import type { Assignment, AutomationRun, Job, JobStatus, Lang, PayType, Repeat } from '@/domain/types';
import type { TFn } from '@/i18n';
import { fmtDate } from '@/lib/dates';
import { money2 } from '@/lib/money';

export const TABS = ['overview', 'team', 'money', 'tasks', 'documents', 'log', 'activity'] as const;
export type JobTab = (typeof TABS)[number];
export const REPEATS: Repeat[] = ['once', 'weekly', 'biweekly', 'monthly'];
export const repeats = (j: Job) => !!j.repeat && j.repeat !== 'once';

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
export interface AutoLine { kind: 'invoice' | 'tasks' | 'email' | 'workers' | 'other'; text: string }

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
/** Changes the status, then says what the automations did because of it. */
export function changeStatus(t: TFn, job: Job, to: JobStatus): AutoLine[] {
  if (job.status === to) return [];
  const id = job.id;
  const { runs } = withRuns(() => act(setJobStatus, id, to));
  const lines = autoLines(t, runs, id);
  toast([t('jobs.statusNow', { status: t('st_' + to) }), ...lines.map((l) => l.text)].join(' '));
  return lines;
}
