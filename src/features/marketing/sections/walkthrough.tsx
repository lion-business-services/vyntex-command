// The sticky product walkthrough: six moments in the life of a job. On wide screens the story scrolls on the left
// while one product window stays in place on the right and changes with the step at the middle of the viewport.
// On phones, tablets and for visitors who ask for reduced motion the six steps simply stack, each with its own window.
// Every window is built from the sample business of the selected edition with the product's own components and selectors.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LuCheck, LuFileText, LuZap } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { DocStatusBadge, DueBadge, JobStatusBadge, LeadStageBadge } from '@/app/shared';
import { usePrefersReducedMotion } from '@/brand';
import { assigneeName, byId, calendarEvents, clientMoney, docsOfJob, isActiveJob, isOpenLead, jobMoney, kpiValues } from '@/domain/selectors';
import { leadIsWon, openStages } from '@/domain/config';
import type { Client, DemoState, Job, Lead, LeadStage } from '@/domain/types';
import { ruleLine, ruleName, stepText } from '@/features/automations/format';
import { addDays, fmtDate, today } from '@/lib/dates';
import { money, money2, sum } from '@/lib/money';
import { Avatar, MoneyBar, cx } from '@/ui';
import { DemoLink, Head, SampleFrame, useMedia } from './shared';
import './walkthrough.css';

const STEPS = ['lead', 'convert', 'schedule', 'tasks', 'docs', 'insight'] as const;
type StepId = (typeof STEPS)[number];
/** Screen each step shows, as a path inside the workspace, and the wording key of that screen. */
const PAGE: Record<StepId, { to: string; label: string }> = {
  lead: { to: '/leads', label: 'nav.leads' }, convert: { to: '/jobs', label: 'nav.jobs' }, schedule: { to: '/calendar', label: 'nav.calendar' },
  tasks: { to: '/tasks', label: 'nav.tasks' }, docs: { to: '/documents', label: 'nav.documents' }, insight: { to: '/reports', label: 'nav.reports' },
};

/** The records the story follows, looked up in whatever the sample business holds right now. */
interface Story { lead?: Lead; job?: Job; client?: Client; docJob?: Job }
function pickStory(d: DemoState): Story {
  const won = d.leads.filter((l) => leadIsWon(d, l) && byId(d.jobs, l.jobId)).sort((a, b) => b.created.localeCompare(a.created))[0];
  const job = won ? byId(d.jobs, won.jobId) : d.jobs.find(isActiveJob) ?? d.jobs[0];
  // for documents and payment: a job with papers, ideally part paid, so the bar has something to say
  const score = (j: Job) => { const m = jobMoney(d, j); const docs = docsOfJob(d, j.id); return (docs.length ? 4 : 0) + (docs.some((x) => x.kind === 'invoice') ? 2 : 0) + (m.received > 0 && m.clientOwes > 0 ? 3 : m.received > 0 ? 1 : 0); };
  const docJob = [...d.jobs].sort((a, b) => score(b) - score(a))[0];
  return { lead: won, job, client: byId(d.clients, job?.clientId), docJob };
}

export function Walkthrough() {
  const { t, data } = useApp();
  const reduced = usePrefersReducedMotion();
  const wide = useMedia('(min-width: 1024px)');
  const sticky = wide && !reduced;
  const [active, setActive] = useState(0);
  const steps = useRef<(HTMLLIElement | null)[]>([]);
  const story = useMemo(() => pickStory(data), [data]);

  // the step whose block crosses the middle of the viewport is the one the window shows
  useEffect(() => {
    if (!sticky || typeof IntersectionObserver !== 'function') return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i));
    }, { rootMargin: '-50% 0px -50% 0px', threshold: 0 });
    steps.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [sticky]);

  const pane = (id: StepId): ReactNode => {
    switch (id) {
      case 'lead': return <LeadsPane />;
      case 'convert': return <ConvertPane story={story} />;
      case 'schedule': return <CalendarPane />;
      case 'tasks': return <TasksPane />;
      case 'docs': return <DocsPane job={story.docJob} />;
      default: return <InsightPane />;
    }
  };
  const linkTo = (id: StepId) => (id === 'convert' && story.job ? `/jobs/${story.job.id}` : PAGE[id].to);

  return (
    <section className="mks mks-wt" aria-labelledby="mks-wt-h">
      <Head id="mks-wt-h" title={t('mk.s.wt.h')} sub={t('mk.s.wt.sub')} />
      <div className={cx('mks-wt-grid', sticky ? 'sticky' : 'stack')}>
        <ol className="mks-wt-steps">
          {STEPS.map((id, i) => (
            <li key={id} data-i={i} ref={(el: HTMLLIElement | null) => { steps.current[i] = el; }} className={cx('mks-wt-step', sticky && i === active && 'on', sticky && i < active && 'past')} data-testid={`mk-wt-step-${id}`}>
              <span className="mks-wt-node" aria-hidden="true">{i + 1}</span>
              <div className="mks-wt-copy">
                <h3>{t(`mk.s.wt.${id}.h`)}</h3>
                <p>{t(`mk.s.wt.${id}.p`)}</p>
                <DemoLink to={linkTo(id)} testId={`mk-wt-open-${id}`}>{t('mk.s.wt.open', { page: t(PAGE[id].label) })}</DemoLink>
              </div>
              {!sticky && <div className="mks-wt-pane on">{pane(id)}</div>}
            </li>
          ))}
        </ol>
        {sticky && (
          <div className="mks-wt-stage">
            <div className="mks-wt-sticky" role="group" aria-label={t('mk.s.wt.window', { step: t(`mk.s.wt.${STEPS[active]}.h`) })} data-active={STEPS[active]} data-testid="mk-wt-window">
              {STEPS.map((id, i) => (
                <div key={id} className={cx('mks-wt-pane', i === active && 'on')} aria-hidden={i !== active} {...(i !== active ? { inert: true } : {})}>{pane(id)}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------- 1. lead captured: the pipeline with the open leads ---------- */
function LeadsPane() {
  const { data, pack, t } = useApp();
  const open = data.leads.filter((l) => isOpenLead(l, data));
  const newest = [...open].sort((a, b) => b.created.localeCompare(a.created)).slice(0, 4);
  return (
    <SampleFrame page={t('nav.leads')}>
      <h3>{t('mk.s.wt.p1.open')}<span className="num">{money(sum(open, (l) => l.value))}</span></h3>
      {open.length ? (
        <>
          <ul className="mks-wt-stages">
            {openStages(data, pack).map(({ id: s }) => {
              const list = open.filter((l) => l.status === s);
              return <li key={s} className={cx(!list.length && 'zero')}><b>{list.length}</b><span>{t('ls_' + s)}</span>{sum(list, (l) => l.value) > 0 && <small>{money(sum(list, (l) => l.value))}</small>}</li>;
            })}
          </ul>
          <ul className="mks-rows">
            {newest.map((l, i) => (
              <li key={l.id}>
                <Avatar name={l.name} size="sm" accent={i === 0} />
                <span className="grow"><span className="t clip">{l.name}</span><small className="clip">{t('ty_' + l.type)}, {t('src_' + l.source)}</small></span>
                {l.value ? <span className="num mks-wide-only">{money(l.value)}</span> : null}
                <LeadStageBadge stage={l.status} />
              </li>
            ))}
          </ul>
        </>
      ) : <p className="muted small">{t('mk.s.wt.p1.none')}</p>}
    </SampleFrame>
  );
}

/* ---------- 2. lead converted: the client and the job that came out of a won lead ---------- */
function ConvertPane({ story }: { story: Story }) {
  const { data, t, date } = useApp();
  const { lead, job, client } = story;
  if (!job) return <SampleFrame page={t('nav.jobs')}><p className="muted small">{t('mk.s.wt.p2.none')}</p></SampleFrame>;
  return (
    <SampleFrame page={t('nav.jobs')}>
      {lead && (
        <>
          <div className="mks-wt-from">
            <Avatar name={lead.name} size="sm" />
            <span className="grow"><small>{t('mk.s.wt.p2.lead')}, {lead.ticket}</small><b className="clip">{lead.name}</b></span>
            <LeadStageBadge stage={lead.status} />
          </div>
          <svg className="mks-wt-fork" viewBox="0 0 400 34" preserveAspectRatio="none" fill="none" aria-hidden="true">
            <path d="M200 0V10L190 20H100V34M200 10L210 20H300V34" vectorEffect="non-scaling-stroke" />
          </svg>
        </>
      )}
      <div className="mks-wt-pair">
        {client && (
          <div className="mks-wt-rec">
            <small>{t('mk.s.wt.p2.client')}</small>
            <b>{client.name}</b>
            <dl className="kv">
              <dt>{t('common.since')}</dt><dd>{date(client.since)}</dd>
              <dt>{t('nav.jobs')}</dt><dd>{clientMoney(data, client.id).jobs}</dd>
            </dl>
          </div>
        )}
        <div className="mks-wt-rec main">
          <small>{job.number}</small>
          <b>{job.name}</b>
          <p><JobStatusBadge status={job.status} /></p>
          <dl className="kv">
            <dt>{t('mk.s.wt.p2.price')}</dt><dd className="num">{money(job.price)}</dd>
            <dt>{t('common.type')}</dt><dd>{t('ty_' + job.type)}</dd>
            {job.start && <><dt>{t('common.start')}</dt><dd>{date(job.start)}</dd></>}
          </dl>
        </div>
      </div>
      <p className="mks-wt-addr clip">{job.address}</p>
    </SampleFrame>
  );
}

/* ---------- 3. work scheduled: the coming week ---------- */
function CalendarPane() {
  const { data, t, lang, day, time } = useApp();
  const from = today(); const to = addDays(6);
  const events = calendarEvents(data, 14).filter((e) => !e.done && e.date >= from && e.date <= to);
  const days = Array.from({ length: 7 }, (_, n) => addDays(n));
  return (
    <SampleFrame page={t('nav.calendar')}>
      <h3>{t('mk.s.wt.p3.week')}<span className="num">{t('mk.s.wt.p3.count', { n: events.length })}</span></h3>
      <ul className="mks-wt-week" aria-hidden="true">
        {days.map((d) => {
          const n = events.filter((e) => e.date === d).length;
          return (
            <li key={d} className={cx(d === from && 'now', !n && 'zero')}>
              <span>{fmtDate(d, lang, { weekday: 'short' })}</span><b>{fmtDate(d, lang, { day: 'numeric' })}</b>
              <i>{Array.from({ length: Math.min(n, 4) }, (_, k) => <u key={k} />)}</i>
            </li>
          );
        })}
      </ul>
      {events.length ? (
        <ul className="mks-rows">
          {events.slice(0, 4).map((e) => (
            <li key={e.id}>
              <span className="mks-wt-when">{e.date === from ? t('common.today') : day(e.date)}{e.time ? <small>{time(e.time)}</small> : null}</span>
              <span className="grow"><span className="t clip">{e.title}</span><small className="clip">{t('asst.ev.' + e.kind)}{e.sub ? ', ' + e.sub : ''}</small></span>
            </li>
          ))}
        </ul>
      ) : <p className="muted small">{t('noEvents')}</p>}
    </SampleFrame>
  );
}

/* ---------- 4. tasks automated: tasks a rule created, and the rule that adds the kickoff list ---------- */
function TasksPane() {
  const { data, pack, t, lang, date, dateTime } = useApp();
  const made = data.tasks.filter((x) => x.auto && x.status !== 'done').slice(0, 2);
  const run = data.automation.runs[0];
  const kick = pack.kickoffTasks.slice(0, 3);
  const dueIn = (n: number) => (n <= 0 ? t('mk.s.wt.p4.day0') : n === 1 ? t('mk.s.wt.p4.day1') : t('mk.s.wt.p4.dayN', { n }));
  const thens: string[] = [];
  for (let n = 1; n <= 6 && t(`auto.lead-won.then${n}`) !== `auto.lead-won.then${n}`; n++) thens.push(ruleLine(`auto.lead-won.then${n}`, t, lang));
  return (
    <SampleFrame page={t('nav.tasks')}>
      {made.length > 0 && (
        <>
          <h3>{t('mk.s.wt.p4.made')}{run && <span className="num">{dateTime(run.at)}</span>}</h3>
          <ul className="mks-rows">
            {made.map((x) => (
              <li key={x.id}>
                <span className="grow"><span className="t">{x.title}</span><small>{assigneeName(data, x.assignee) || t('common.unassigned')}</small></span>
                <span className="mks-wt-due"><span className="mks-auto"><LuZap aria-hidden="true" />{t('common.automation')}</span><DueBadge due={x.due} /></span>
              </li>
            ))}
          </ul>
          {run && <p className="mks-wt-by"><LuCheck aria-hidden="true" />{ruleName(run.ruleId, t)}: {stepText(run.steps[0], t, date)}</p>}
        </>
      )}
      <div className="mks-wt-rule">
        <p className="mks-wt-rule-h"><span className="mks-auto"><LuZap aria-hidden="true" />{ruleName('lead-won', t)}</span></p>
        <p><b>{t('mk.s.when')}</b> {ruleLine('auto.lead-won.when', t, lang)}</p>
        {kick.length ? (
          <>
            <p><b>{t('mk.s.then')}</b> {t('mk.s.wt.p4.kick')}</p>
            <ul className="mks-wt-kick">{kick.map((k, i) => <li key={i}><span>{k[lang]}</span><small>{dueIn(k.dueIn)}</small></li>)}</ul>
          </>
        ) : <p><b>{t('mk.s.then')}</b> {thens.join(', ')}</p>}
      </div>
    </SampleFrame>
  );
}

/* ---------- 5. documents and payment: the papers of one job and the money received against its price ---------- */
function DocsPane({ job }: { job?: Job }) {
  const { data, t, date } = useApp();
  if (!job) return <SampleFrame page={t('nav.documents')}><p className="muted small">{t('mk.s.wt.p2.none')}</p></SampleFrame>;
  const docs = docsOfJob(data, job.id).slice(0, 3);
  const m = jobMoney(data, job);
  const label = t('mk.s.wt.p5.received', { paid: money(m.received), total: money(m.price) });
  const pays = [...job.received].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 2);
  return (
    <SampleFrame page={t('nav.documents')}>
      <div className="mks-wt-job">
        <span className="grow"><b className="clip">{job.name}</b><small className="clip">{byId(data.clients, job.clientId)?.name}</small></span>
        <JobStatusBadge status={job.status} />
      </div>
      {docs.length > 0 && (
        <ul className="mks-rows">
          {docs.map((d) => (
            <li key={d.id}>
              <LuFileText className="mks-wt-ico" aria-hidden="true" />
              <span className="grow"><span className="t">{t('doc.kind.' + d.kind)}</span><small>{d.number}, {date(d.updated)}</small></span>
              <DocStatusBadge status={d.status} />
            </li>
          ))}
        </ul>
      )}
      <div className="mks-wt-money">
        <h3>{label}<span className="num">{t('common.balance')} {money(Math.max(0, m.clientOwes))}</span></h3>
        <MoneyBar parts={[{ value: m.received, cls: 's4', label }]} total={m.price} label={label} />
        {pays.length ? (
          <ul className="mks-wt-pays">{pays.map((p) => <li key={p.id}><span>{date(p.date)}</span><span>{t('m_' + p.method)}</span><b className="num">{money2(p.amount)}</b></li>)}</ul>
        ) : <p className="muted small">{t('mk.s.wt.p5.none')}</p>}
      </div>
    </SampleFrame>
  );
}

/* ---------- 6. business insight: figures computed from the same records ---------- */
function InsightPane() {
  const { data, pack, t, lang } = useApp();
  const kpi = kpiValues(data);
  const byStatus = pack.jobStatuses.map((s) => ({ s, n: data.jobs.filter((j) => j.status === s).length }));
  const top = Math.max(1, ...byStatus.map((x) => x.n));
  // money received per month, for the last four months, straight from the payments on each job
  const months = Array.from({ length: 4 }, (_, k) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (3 - k)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
  const collected = months.map((ym) => ({ ym, total: sum(data.jobs, (j) => sum(j.received.filter((r) => r.date.startsWith(ym)), (r) => r.amount)) }));
  const peak = Math.max(1, ...collected.map((c) => c.total));
  const monthName = (ym: string) => fmtDate(ym + '-01', lang, { month: 'short' });
  return (
    <SampleFrame page={t('nav.reports')}>
      <div className="mks-wt-kpis">
        <div className="kpi"><div className="k">{t('mk.s.wt.p6.pipeline')}</div><div className="v">{money(kpi.pipelineValue)}</div></div>
        <div className="kpi"><div className="k">{t('mk.s.wt.p6.owed')}</div><div className="v">{money(kpi.clientsOwe)}</div></div>
      </div>
      <div className="mks-wt-charts">
        <div>
          <h3>{t('mk.s.wt.p6.byStatus')}</h3>
          <ul className="mks-wt-status">
            {byStatus.map(({ s, n }) => (
              <li key={s}><span className="clip">{t('st_' + s)}</span><i><u style={{ width: `${(n / top) * 100}%` }} /></i><b className="num">{n}</b></li>
            ))}
          </ul>
        </div>
        <div>
          <h3>{t('mk.s.wt.p6.collected')}</h3>
          <ul className="mks-wt-cols" role="img" aria-label={collected.map((c) => `${monthName(c.ym)}: ${money(c.total)}`).join(', ')}>
            {collected.map((c) => (
              <li key={c.ym} title={`${monthName(c.ym)}: ${money(c.total)}`}>
                <small className="num">{money(c.total)}</small>
                <i><u style={{ height: `${Math.max(c.total > 0 ? 3 : 0, (c.total / peak) * 100)}%` }} /></i>
                <span>{monthName(c.ym)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </SampleFrame>
  );
}
