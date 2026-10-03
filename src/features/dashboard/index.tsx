// Dashboard: the state of the business, in the order someone running it needs it.
// 1 greeting and what needs attention today · 2 key figures · 3 attention center · 4 today's operation · 5 pipeline and revenue
// 6 what the automations handled · 7 next steps suggested by VYNTEX AI.
// Every figure is derived from the data (domain/selectors plus ./insights) and every figure opens the list behind it.
// Note for memo dependencies: the store replaces `data` on every change but keeps the lists inside it, so depend on `data`.
import { Fragment, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  LuArrowUpRight, LuBanknote, LuBriefcase, LuCalendarCheck, LuCalendarClock, LuCalendarDays, LuChartColumn, LuChevronRight, LuCircleCheckBig, LuClockAlert, LuCompass,
  LuFilePen, LuFileWarning, LuListChecks, LuPhoneCall, LuPlus, LuShieldAlert, LuSparkles, LuUserPlus, LuWallet, LuX, LuZap,
} from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, go, refPath } from '@/app/router';
import type { PageProps } from '@/app/routes';
import { setPrefs } from '@/store/store';
import { Button, Card, IconButton, Seg, cx, type Tone } from '@/ui';
import { ActivityList, JobStatusBadge, PlanBadge, TaskRow } from '@/app/shared';
import { ClientPaymentModal, TaskFormModal } from '@/app/forms';
import { Arrow } from '@/brand';
import { assigneeName, byId, calendarEvents, isActiveJob, isDueToday, isOpenLead, isOverdue, jobMoney, kpiValues, notices, type CalEvent, type EventKind, type Notice } from '@/domain/selectors';
import type { Permission } from '@/domain/permissions';
import type { LeadStage, Task } from '@/domain/types';
import type { KpiId } from '@/packs/types';
import { addDays, fmtDate, relDay, today } from '@/lib/dates';
import { money, pct, sum } from '@/lib/money';
import { ruleName, stepText } from '@/features/automations/format';
import { VISIT_DAYS, WEEKS, collectedByMonth, figures, recommendations, stateParts, trends, type RecIcon } from './insights';
import { Quiet, Spark, Swap, TrendMark } from './parts';
import './dashboard.css';

/** Where each tile drills in, and which permission its number needs. */
const KPI: Record<KpiId, { to: string; needs?: Permission }> = {
  activeJobs: { to: '/jobs' },
  activeValue: { to: '/jobs', needs: 'money' },
  expectedProfit: { to: '/reports', needs: 'profit' },
  clientsOwe: { to: '/payments', needs: 'money' },
  oweWorkers: { to: '/payments', needs: 'money' },
  collectedMonth: { to: '/payments', needs: 'money' },
  newLeads: { to: '/leads' },
  pipelineValue: { to: '/leads?view=board' },
  visitsThisWeek: { to: '/calendar' },
  overdueTasks: { to: '/tasks' },
  recurringClients: { to: '/clients' },
};
const MONEY_KPIS: KpiId[] = ['activeValue', 'expectedProfit', 'clientsOwe', 'oweWorkers', 'collectedMonth', 'pipelineValue'];

/** Attention groups, most serious first. `needs` hides a group from roles that cannot open the records behind it. */
const GROUPS: { kind: Notice['kind']; more: string; needs?: Permission; icon: ReactNode }[] = [
  { kind: 'overdueTask', more: '/tasks', icon: <LuClockAlert /> },
  { kind: 'coiExpired', more: '/team', needs: 'team', icon: <LuShieldAlert /> },
  { kind: 'w9Missing', more: '/team', needs: 'team', icon: <LuFileWarning /> },
  { kind: 'followUp', more: '/leads', icon: <LuPhoneCall /> },
  { kind: 'docWaiting', more: '/documents', needs: 'documents', icon: <LuFilePen /> },
  { kind: 'balance', more: '/payments', needs: 'money', icon: <LuWallet /> },
  { kind: 'coiSoon', more: '/team', needs: 'team', icon: <LuCalendarClock /> },
  { kind: 'newLead', more: '/leads', icon: <LuUserPlus /> },
];
const TONES: Notice['tone'][] = ['bad', 'warn', 'info'];
const OPEN_STAGES: LeadStage[] = ['new', 'contacted', 'scheduled', 'sent'];
const EVENT_TONE: Record<EventKind, Tone> = { appt: 'violet', follow: 'warn', start: 'info', end: 'ok', visit: 'accent', task: 'neutral' };
const PRI_RANK = { high: 0, medium: 1, low: 2 } as const;
const REC_ICON: Record<RecIcon, ReactNode> = { follow: <LuPhoneCall />, task: <LuClockAlert />, balance: <LuWallet />, paper: <LuFileWarning />, doc: <LuFilePen />, lead: <LuUserPlus />, calendar: <LuCalendarDays />, money: <LuBanknote /> };
const compact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const TASKS_SHOWN = 3, JOBS_SHOWN = 5, EVENTS_SHOWN = 5;

export default function DashboardPage(_: PageProps) {
  const { t, data, prefs, pack, lang, can, date, day, time, dateTime } = useApp();
  const [taskForm, setTaskForm] = useState<{ task?: Task } | null>(null);
  const [payForm, setPayForm] = useState(false);
  const [whose, setWhose] = useState<'mine' | 'team' | null>(null);
  const [allTasks, setAllTasks] = useState(false);
  /* The activity card closes whichever column is shorter, so the two columns end near each other with any data, language or role.
     Measured before paint; the choice only depends on the other cards, so it settles in one pass. Below 1280 the page is one
     column (the columns have no box of their own) and the order classes decide. */
  const leftCol = useRef<HTMLDivElement>(null), rightCol = useRef<HTMLDivElement>(null), activityBox = useRef<HTMLDivElement>(null);
  const [activityLeft, setActivityLeft] = useState(false);
  useLayoutEffect(() => {
    const measure = () => {
      const l = leftCol.current?.getBoundingClientRect().height ?? 0, r = rightCol.current?.getBoundingClientRect().height ?? 0;
      const card = activityBox.current?.parentElement; if (!l || !r || !card) return;
      const own = card.getBoundingClientRect().height + parseFloat(getComputedStyle(card.parentElement!).rowGap || '0');
      const inLeft = !!leftCol.current?.contains(card);
      setActivityLeft(l - (inLeft ? own : 0) < r - (inLeft ? 0 : own));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });

  const me = data.users.find((u) => u.role === prefs.viewAs) ?? data.users[0];
  const td = today();
  /** "1 item" and "3 items" are separate sentences in both languages. */
  const n1 = (key: string, n: number, extra?: Record<string, string | number>) => t(n === 1 ? key + '.one' : key, { n, ...extra });

  const kpi = useMemo(() => kpiValues(data), [data]);
  const allNotices = useMemo(() => notices(data, { compliance: pack.compliance }), [data, pack.compliance]);
  const fig = useMemo(() => figures(data, kpi), [data, kpi]);
  const trend = trends(fig, t, lang);

  /* ---------- 3. attention center ---------- */
  const groups = GROUPS.filter((g) => !g.needs || can(g.needs))
    .map((g) => ({ ...g, items: allNotices.filter((n) => n.kind === g.kind) }))
    .filter((g) => g.items.length);
  const attentionCount = sum(groups, (g) => g.items.length);
  const byTone = TONES.map((tone) => ({ tone, n: sum(groups, (g) => g.items.filter((x) => x.tone === tone).length) })).filter((x) => x.n);

  /* ---------- 4. today's operation: schedule, tasks due, active jobs ---------- */
  const upcoming = useMemo(() => calendarEvents(data, 8).filter((e) => e.kind !== 'task' && !e.done && e.date >= td && e.date <= addDays(7)), [data, td]);
  const todayEvents = upcoming.filter((e) => e.date === td);
  const todayShown = todayEvents.slice(0, 4);
  const later = upcoming.filter((e) => e.date > td);
  const laterShown = later.slice(0, Math.max(2, EVENTS_SHOWN - todayShown.length));
  const days: { date: string; events: CalEvent[] }[] = [];
  for (const e of laterShown) { const last = days[days.length - 1]; if (last && last.date === e.date) last.events.push(e); else days.push({ date: e.date, events: [e] }); }
  const moreEvents = upcoming.length - todayShown.length - laterShown.length;
  const dayLabel = (d: string) => (d === addDays(1) ? t('dash.up.tomorrow') : day(d));
  const eventKind = (k: EventKind) => (k === 'visit' ? t('dash.ev.visit') : t('ev_' + k));
  const eventRow = (e: CalEvent) => (
    <li key={e.id}>
      <A to={refPath(e.ref)} className="dash-ev dash-row">
        <span className={cx('dot', EVENT_TONE[e.kind])} aria-hidden="true" />
        <span className="grow">
          <b>{e.title}</b>
          <span className="xs muted dash-ev-s">{[eventKind(e.kind), e.sub].filter(Boolean).join(' · ')}</span>
        </span>
        {e.time && <span className="small nowrap dash-ev-t">{time(e.time)}</span>}
      </A>
    </li>
  );

  const dueNow = useMemo(() => data.tasks.filter((x) => isOverdue(x) || isDueToday(x))
    .sort((a, b) => (a.due || '').localeCompare(b.due || '') || PRI_RANK[a.pri] - PRI_RANK[b.pri]), [data]);
  const mine = me ? dueNow.filter((x) => x.assignee === 'u:' + me.id) : [];
  const view = whose ?? (mine.length ? 'mine' : 'team');
  const shownTasks = view === 'mine' ? mine : dueNow;

  const active = useMemo(() => {
    const rank = { progress: 0, contract: 1, hold: 2, estimate: 3, done: 4 } as const;
    return data.jobs.filter(isActiveJob).sort((a, b) => rank[a.status] - rank[b.status] || (a.start || '9').localeCompare(b.start || '9'));
  }, [data]);
  const activeShown = active.slice(0, JOBS_SHOWN);

  /* ---------- 5. pipeline and revenue ---------- */
  const openLeads = data.leads.filter(isOpenLead);
  const stages = OPEN_STAGES.map((s) => { const list = openLeads.filter((l) => l.status === s); return { stage: s, n: list.length, value: sum(list, (l) => l.value) }; });
  const byValue = stages.some((s) => s.value > 0);
  const pipeMax = Math.max(1, ...stages.map((s) => (byValue ? s.value : s.n)));
  const months = useMemo(() => (can('money') ? collectedByMonth(data, lang) : []), [data, lang, prefs.viewAs]); // eslint-disable-line react-hooks/exhaustive-deps
  const monthMax = Math.max(1, ...months.map((m) => m.amount));

  /* ---------- 6. automation activity ---------- */
  const moneyKinds = /^(payment\.|worker\.paid|expense\.|invoice\.)/;
  const activity = data.activity.filter((a) => (can('money') || !moneyKinds.test(a.kind)) && (can('team') || a.ref.type !== 'worker'));
  const runs = can('automations') ? data.automation.runs.slice(0, 4) : [];

  /* ---------- 7. suggested next steps ---------- */
  const recs = useMemo(() => (can('assistant') ? recommendations({ data, pack, lang, t, can, date, day, notices: allNotices, kpi }) : []), [data, pack, lang, prefs.viewAs, allNotices, kpi]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- 2. key figures ---------- */
  const tiles = pack.kpis.filter((id) => KPI[id] && (!KPI[id].needs || can(KPI[id].needs!)));
  const hiddenTiles = pack.kpis.length - tiles.length;
  /** The note about hidden figures takes the cells the hidden tiles left free in the last row, or a row of its own. */
  const noteSpan = (cols: number) => { const free = (cols - (tiles.length % cols)) % cols; return free ? `span ${free}` : '1 / -1'; };
  const waiting = data.jobs.filter((j) => j.status === 'contract').length;
  const withBalance = data.jobs.filter((j) => (j.status === 'progress' || j.status === 'done') && jobMoney(data, j).clientOwes > 0.005).length;
  const owedOnDone = sum(allNotices.filter((n) => n.kind === 'balance'), (n) => n.amount);
  const paymentsThisMonth = sum(data.jobs, (j) => j.received.filter((r) => r.date.startsWith(td.slice(0, 7))).length);
  const dueTodayCount = data.tasks.filter(isDueToday).length;
  const hint: Record<KpiId, string | undefined> = {
    activeJobs: waiting ? t('dash.hint.waiting', { n: waiting }) : undefined,
    activeValue: kpi.activeJobs ? n1('dash.hint.acrossJobs', kpi.activeJobs) : undefined,
    expectedProfit: kpi.activeValue > 0 ? t('dash.hint.margin', { pct: pct(kpi.expectedProfit / kpi.activeValue) }) : undefined,
    clientsOwe: owedOnDone > 0.005 ? t('dash.hint.owedOnDone', { amount: money(owedOnDone) }) : withBalance ? n1('dash.hint.balances', withBalance) : t('dash.hint.nobodyOwes'),
    oweWorkers: kpi.oweWorkers > 0 ? t('dash.hint.oweWorkers') : t('dash.hint.oweNothing'),
    newLeads: t('dash.hint.openLeads', { n: openLeads.length }),
    pipelineValue: t('dash.hint.pipeline', { n: openLeads.length }),
    visitsThisWeek: t('dash.hint.visits'),
    overdueTasks: dueTodayCount ? t('dash.hint.dueToday', { n: dueTodayCount }) : kpi.overdueTasks ? undefined : t('dash.hint.noneLate'),
    recurringClients: t('dash.hint.recurring'),
    collectedMonth: paymentsThisMonth ? n1('dash.hint.payments', paymentsThisMonth) : t('dash.hint.noPayments'),
  };
  const nums = (list: number[], fmt: (n: number) => string = String) => list.map(fmt).join(', ');
  const spark: Partial<Record<KpiId, ReactNode>> = {
    collectedMonth: <Spark kind="line" values={fig.collectedWeeks} label={t('dash.spark.collected', { weeks: WEEKS, values: nums(fig.collectedWeeks, money) })} />,
    newLeads: <Spark kind="bars" values={fig.leadWeeks} label={t('dash.spark.leads', { weeks: WEEKS, values: nums(fig.leadWeeks) })} />,
    visitsThisWeek: <Spark kind="bars" mark={0} values={fig.visitDays} label={t('dash.spark.visits', { days: VISIT_DAYS, values: nums(fig.visitDays) })} />,
  };
  const kpiText = (id: KpiId) => (MONEY_KPIS.includes(id) ? money(kpi[id]) : String(kpi[id]));

  /* ---------- 1. greeting and state ---------- */
  const hour = new Date().getHours();
  const hello = t(hour < 12 ? 'dash.hi.morning' : hour < 18 ? 'dash.hi.afternoon' : 'dash.hi.evening');
  const greeting = me ? t('dash.hi.named', { greeting: hello, name: me.name.split(' ')[0] }) : t('dash.hi.plain', { greeting: hello });
  const longDate = fmtDate(td, lang, { weekday: 'long', month: 'long', day: 'numeric' });
  const parts = stateParts(allNotices, t, can).slice(0, 3);

  /** One attention line: what it is, the record it belongs to, and how late or how much. */
  const noticeLine = (n: Notice): { ctx: string; meta: string; to: string } => {
    const rel = (d?: string) => (d ? relDay(d, lang) : '');
    if (n.ref.type === 'task') {
      const task = byId(data.tasks, n.ref.id); const job = byId(data.jobs, task?.jobId); const lead = byId(data.leads, task?.leadId);
      const ctx = job ? [byId(data.clients, job.clientId)?.name, job.name].filter(Boolean).join(' · ') : lead ? lead.name : assigneeName(data, task?.assignee);
      return { ctx, meta: rel(n.date), to: refPath(n.ref, task?.jobId) };
    }
    if (n.ref.type === 'lead') {
      const lead = byId(data.leads, n.ref.id);
      return { ctx: lead ? [t('ty_' + lead.type), n.kind === 'newLead' ? t('src_' + lead.source) : lead.phone].filter(Boolean).join(' · ') : '', meta: rel(n.date), to: refPath(n.ref) };
    }
    if (n.ref.type === 'doc') {
      const doc = byId(data.docs, n.ref.id);
      return { ctx: doc ? [`${t('doc.kind.' + doc.kind)} ${doc.number}`, byId(data.clients, doc.clientId)?.name].filter(Boolean).join(' · ') : '', meta: n.date ? t('dash.att.sentOn', { date: date(n.date) }) : '', to: refPath(n.ref) };
    }
    if (n.ref.type === 'worker') {
      const w = byId(data.workers, n.ref.id);
      return { ctx: w?.trade ?? '', meta: n.date ? t(n.kind === 'coiExpired' ? 'dash.att.expired' : 'dash.att.expires', { date: date(n.date) }) : '', to: refPath(n.ref) };
    }
    const job = byId(data.jobs, n.ref.id);
    return { ctx: byId(data.clients, job?.clientId)?.name ?? '', meta: n.amount ? t('dash.att.owes', { amount: money(n.amount) }) : '', to: refPath(n.ref) };
  };

  /* 6. what the automations handled, then the rest of the recent activity (placed under the shorter column, see above) */
  const activityCard = (
    <Card className="dash-o5" title={can('automations') ? <><LuZap aria-hidden="true" className="dash-zap" />{t('dash.auto.title')}</> : t('dash.activity.title')} actions={can('automations') && <A to="/automations" className="btn sm ghost">{t('dash.auto.all')}</A>}>
      <div data-testid="dash-activity" ref={activityBox}>
        {can('automations') && (
          !runs.length ? (
            <Quiet icon={<LuZap />} title={t('dash.auto.empty')}><A to="/automations" className="btn sm">{t('dash.auto.open')}</A></Quiet>
          ) : (
            <ol className="dash-runs">
              {runs.map((r) => (
                <li key={r.id}>
                  <A to="/automations" className="dash-run dash-row">
                    <span className="grow"><b>{ruleName(r.ruleId, t)}</b><span className="small muted dash-ev-s">{r.steps[0] ? stepText(r.steps[0], t, date) : ''}{r.steps.length > 1 ? ` ${t('dash.auto.more', { n: r.steps.length - 1 })}` : ''}</span></span>
                    <span className="xs dim nowrap">{dateTime(r.at)}</span>
                  </A>
                </li>
              ))}
            </ol>
          )
        )}
        {can('automations') && <h3 className="dash-h3 dash-act-h">{t('dash.activity.title')}</h3>}
        <ActivityList items={activity} limit={4} linkRecords />
      </div>
    </Card>
  );

  return (
    <div className="dash">
      {/* 1. greeting, the state of the business, quick actions (one primary) */}
      <header className="dash-head">
        <div className="dash-hello">
          <p className="dash-date">{longDate.charAt(0).toUpperCase() + longDate.slice(1)}</p>
          <h1>{greeting}</h1>
          <p className="dash-state" data-testid="dash-state">
            {parts.length ? (
              <>{t('dash.state.lead')} {parts.map((p, i) => <Fragment key={p.id}>{i > 0 && (i === parts.length - 1 ? ` ${t('dash.state.and')} ` : ', ')}<A to={p.to}>{p.text}</A></Fragment>)}.</>
            ) : (
              <>{t('dash.state.clear')}{todayEvents.length > 0 && <> <A to="/calendar">{n1('dash.state.sched', todayEvents.length)}</A>.</>}</>
            )}
          </p>
        </div>
        <div className="dash-actions" role="group" aria-label={t('dash.actions')}>
          {can('leads') && <A to="/leads" className="btn" data-testid="dash-new-lead"><LuUserPlus aria-hidden="true" />{t('dash.act.lead')}</A>}
          {can('tasks') && <Button icon={<LuListChecks aria-hidden="true" />} onClick={() => setTaskForm({})} data-testid="dash-new-task">{t('dash.act.task')}</Button>}
          {can('money') && <Button icon={<LuWallet aria-hidden="true" />} onClick={() => setPayForm(true)} data-testid="dash-record-payment">{t('dash.act.payment')}</Button>}
          {can('jobs') && <A to="/jobs?new=1" className="btn primary" data-testid="dash-new-job"><LuBriefcase aria-hidden="true" />{t('newProject')}</A>}
        </div>
      </header>

      {!prefs.tourSeen && (
        <section className="dash-tour" data-testid="dash-tour" aria-label={t('demo.tour')}>
          <LuCompass aria-hidden="true" className="dash-tour-ico" />
          <p className="grow"><b>{t('dash.tour.title')}</b> <span className="muted dash-tour-t">{t('dash.tour.text')}</span></p>
          <Button size="sm" onClick={() => go('/?tour=1')} data-testid="dash-tour-start">{t('dash.tour.start')}<Arrow /></Button>
          <IconButton size="sm" label={t('dash.tour.dismiss')} onClick={() => setPrefs({ tourSeen: true })} data-testid="dash-tour-dismiss"><LuX /></IconButton>
        </section>
      )}

      {/* 2. key figures */}
      <section className="dash-kpis" aria-label={t('dash.kpis')} style={{ '--n': pack.kpis.length, '--note6': noteSpan(pack.kpis.length), '--note3': noteSpan(3), '--note2': noteSpan(2) } as CSSProperties}>
        {tiles.map((id) => {
          const text = kpiText(id); const tr = trend[id as keyof typeof trend];
          return (
            <A key={id} to={KPI[id].to} className={cx('kpi', id === 'overdueTasks' && kpi.overdueTasks > 0 && 'attn')} data-testid={`dash-kpi-${id}`}>
              <div className="k">{t('dash.kpi.' + id)}</div>
              <div className="dash-kpi-v">
                <div className={cx('v', text.length >= 10 ? 'xlong' : text.length >= 8 && 'long')}><Swap>{text}</Swap></div>
                {spark[id]}
              </div>
              {tr
                ? <div className="h dash-kpi-h"><TrendMark trend={tr} words={t('dash.trend.' + tr.dir, { delta: tr.delta })} /> {tr.text}</div>
                : hint[id] && <div className={cx('h dash-kpi-h', id === 'clientsOwe' && owedOnDone > 0.005 && 'warn')}>{hint[id]}</div>}
              <LuArrowUpRight className="dash-kpi-go" aria-hidden="true" />
            </A>
          );
        })}
        {hiddenTiles > 0 && (
          <p className="dash-kpi-note small" data-testid="dash-hidden-note">
            {can('money') ? t('dash.kpi.hiddenProfit', { role: t('role.owner') }) : t('dash.kpi.hiddenMoney', { role: t('role.' + prefs.viewAs) })}
          </p>
        )}
      </section>

      <div className="dash-grid">
        <div className="dash-col" ref={leftCol}>
          {/* 3. attention center: the heaviest block on the page */}
          <Card className="raised dash-attn dash-o1" title={<>{t('dash.att.title')}{attentionCount > 0 && <span className="count bad">{attentionCount}</span>}</>}
            actions={byTone.length > 0 && <ul className="dash-tones" aria-label={t('dash.att.byTone')}>{byTone.map((x) => <li key={x.tone}><span className={cx('dot', x.tone)} aria-hidden="true" />{n1('dash.att.tone.' + x.tone, x.n)}</li>)}</ul>}>
            <div data-testid="dash-attention">
              {!groups.length ? (
                <Quiet tone="ok" icon={<LuCircleCheckBig />} title={<><b>{t('dash.att.clear')}</b> {t('dash.att.clearHint')}</>} />
              ) : groups.map((g) => (
                <section key={g.kind} className="dash-att" aria-label={t('dash.att.' + g.kind)}>
                  <h3><span className={cx('dash-att-ico', g.items[0].tone)} aria-hidden="true">{g.icon}</span><span>{t('dash.att.' + g.kind)}{g.items.length > 1 && <span className="dash-att-n">{'\u00A0'}{g.items.length}</span>}</span></h3>
                  <ul>
                    {g.items.slice(0, 3).map((n) => {
                      const v = noticeLine(n);
                      return (
                        <li key={n.id}>
                          <A to={v.to} className="dash-att-item dash-row">
                            <span className="dash-att-t"><b>{n.title}</b>{v.ctx && <span className="muted dash-att-c"><span aria-hidden="true"> · </span>{v.ctx}</span>}</span>
                            {v.meta && <span className={cx('small nowrap dash-att-m', n.tone === 'bad' ? 'neg' : 'muted')}>{v.meta}</span>}
                            <LuChevronRight className="dash-go" aria-hidden="true" />
                          </A>
                        </li>
                      );
                    })}
                    {g.items.length > 3 && <li><A to={g.more} className="dash-more small">{t('dash.att.more', { n: g.items.length - 3 })}</A></li>}
                  </ul>
                </section>
              ))}
            </div>
          </Card>

          {/* 4b. active jobs and the money received on each */}
          {can('jobs') && (
            <Card flush className="dash-o3" title={<>{t('dash.active.title')}{active.length > 0 && <span className="count">{active.length}</span>}</>} actions={<A to="/jobs" className="btn sm ghost">{t('dash.active.all')}</A>}>
              <div data-testid="dash-active">
                {!active.length ? (
                  <Quiet pad icon={<LuBriefcase />} title={<><b>{t('dash.active.empty')}</b> {t('dash.active.emptyHint')}</>}><A to="/jobs?new=1" className="btn sm"><LuPlus aria-hidden="true" />{t('newProject')}</A></Quiet>
                ) : (
                  <div className="table-wrap">
                    <table className="tbl stackable dash-jobs">
                      <thead><tr>
                        <th>{t('dash.active.col.job')}</th><th>{t('common.status')}</th>
                        {can('money') ? <th>{t('dash.active.col.received')}</th> : <th>{t('dash.active.col.start')}</th>}
                        {can('profit') && <th className="num">{t('dash.active.col.profit')}</th>}
                      </tr></thead>
                      <tbody>
                        {activeShown.map((j) => {
                          const m = jobMoney(data, j); const client = byId(data.clients, j.clientId);
                          const share = m.price > 0 ? Math.min(1, Math.max(0, m.received / m.price)) : 0;
                          return (
                            <tr key={j.id}>
                              <td className="t1"><A to={`/jobs/${j.id}`} className="dash-link">{j.name}</A><div className="xs dim dash-sub">{client?.name ?? ''}</div></td>
                              <td data-label={t('common.status')}><JobStatusBadge status={j.status} /></td>
                              {can('money') ? (
                                <td className="dash-recv">
                                  {m.price > 0 ? (
                                    <div>
                                      <div className="bar" role="img" aria-label={t('dash.active.receivedLabel', { received: money(m.received), price: money(m.price) })}><span className="s4" style={{ width: `${share * 100}%` }} /></div>
                                      <div className="xs muted dash-recv-t"><span>{t('dash.active.received', { received: money(m.received), price: money(m.price) })}</span><span>{pct(share)}</span></div>
                                    </div>
                                  ) : <span className="small dim">{t('dash.active.noPrice')}</span>}
                                </td>
                              ) : <td data-label={t('dash.active.col.start')} className="small muted">{date(j.start || undefined)}</td>}
                              {can('profit') && <td data-label={t('dash.active.col.profit')} className={cx('num nowrap', m.profit < 0 && 'neg')}><span><b>{money(m.profit)}</b>{m.price > 0 && <span className="xs muted"> {pct(m.margin)}</span>}</span></td>}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {active.length > activeShown.length && <A to="/jobs" className="dash-more pad small">{t('dash.active.more', { n: active.length - activeShown.length })}</A>}
              </div>
            </Card>
          )}

          {/* 5. pipeline and revenue */}
          {can('leads') && (
            <Card className="dash-pr dash-o4" title={t(can('money') ? 'dash.pr.title' : 'dash.pipe.title')} actions={<A to="/leads?view=board" className="btn sm ghost">{t('dash.pipe.board')}</A>}>
              <div className="dash-pr-grid">
                <section data-testid="dash-pipeline" aria-label={t('dash.pipe.sub')}>
                  <h3 className="dash-h3">{t('dash.pipe.sub')}</h3>
                  {!openLeads.length ? (
                    <Quiet icon={<LuUserPlus />} title={t('dash.pipe.empty')}><A to="/leads" className="btn sm"><LuPlus aria-hidden="true" />{t('dash.act.lead')}</A></Quiet>
                  ) : (
                    <>
                      <ul className="dash-pipe">
                        {stages.map((s) => (
                          <li key={s.stage}>
                            <A to="/leads?view=board" className="dash-pipe-row dash-row" aria-label={t('dash.pipe.row', { stage: t('ls_' + s.stage), n: s.n, value: money(s.value) })}>
                              <span className="dash-pipe-l">{t('ls_' + s.stage)}</span>
                              <span className="dash-pipe-n">{s.n}</span>
                              <span className="dash-pipe-bar" aria-hidden="true"><i style={{ width: `${((byValue ? s.value : s.n) / pipeMax) * 100}%` }} /></span>
                              <span className="dash-pipe-v">{money(s.value)}</span>
                            </A>
                          </li>
                        ))}
                      </ul>
                      <div className="dash-total small"><span className="muted">{n1('dash.pipe.total', openLeads.length)}</span><b data-testid="dash-pipeline-total">{money(kpi.pipelineValue)}</b></div>
                    </>
                  )}
                </section>
                {can('money') && (
                  <section data-testid="dash-revenue" aria-label={t('dash.rev.title')}>
                    <h3 className="dash-h3">{t('dash.rev.title')}</h3>
                    {!months.length ? (
                      <Quiet icon={<LuChartColumn />} title={t('dash.rev.empty')}><Button size="sm" icon={<LuPlus aria-hidden="true" />} onClick={() => setPayForm(true)}>{t('dash.act.payment')}</Button></Quiet>
                    ) : (
                      <>
                        <ol className="dash-rev" style={{ '--cols': months.length } as CSSProperties}>
                          {months.map((m) => (
                            <li key={m.ym} className={cx(m.current && 'now')} title={`${m.long}: ${money(m.amount)}`} data-month={m.ym} data-amount={Math.round(m.amount)}>
                              <span className="dash-rev-plot" aria-hidden="true"><span className="dash-rev-v">{m.amount >= 10000 ? compact.format(m.amount) : money(m.amount)}</span><i style={{ height: `calc((100% - 22px) * ${(m.amount / monthMax).toFixed(4)})` }} /></span>
                              <span className="dash-rev-m" aria-hidden="true">{m.label}{m.current && <small>{t('dash.rev.now')}</small>}</span>
                              <span className="sr">{t('dash.rev.col', { month: m.long, amount: money(m.amount) })}{m.current ? ` (${t('dash.rev.now')})` : ''}</span>
                            </li>
                          ))}
                        </ol>
                        <div className="dash-total small"><span className="muted">{t('dash.rev.total', { n: months.length })}</span><b data-testid="dash-revenue-total">{money(sum(months, (m) => m.amount))}</b></div>
                      </>
                    )}
                  </section>
                )}
              </div>
            </Card>
          )}
          {activityLeft && activityCard}
        </div>

        <div className="dash-col" ref={rightCol}>
          {/* 4a. today's operation: the schedule and the tasks that are due */}
          {(can('calendar') || can('tasks')) && (
            <Card className="dash-op dash-o2" title={t('dash.op.title')} actions={can('calendar') && <A to="/calendar" className="btn sm ghost"><LuCalendarDays aria-hidden="true" />{t('dash.up.calendar')}</A>}>
              <div className="dash-op-grid">
                {can('calendar') && (
                  <section data-testid="dash-upcoming" aria-label={t('dash.op.schedule')}>
                    <h3 className="dash-h3 now">{t('common.today')}{todayEvents.length > 0 && <span className="dash-att-n"> {todayEvents.length}</span>}</h3>
                    {todayShown.length ? <ul className="dash-evs">{todayShown.map(eventRow)}</ul>
                      : <Quiet icon={<LuCalendarCheck />} title={t('dash.op.clear')}>{!later.length && <A to="/calendar" className="btn sm">{t('dash.op.openCalendar')}</A>}</Quiet>}
                    {days.map((d) => (
                      <div key={d.date} className="dash-day">
                        <h3 className="dash-h3">{dayLabel(d.date)}</h3>
                        <ul className="dash-evs">{d.events.map(eventRow)}</ul>
                      </div>
                    ))}
                    {moreEvents > 0 && <A to="/calendar" className="dash-more small">{t('dash.up.more', { n: moreEvents })}</A>}
                  </section>
                )}
                {can('tasks') && (
                  <section className="dash-due" aria-label={t('dash.today.title')}>
                    <div className="dash-due-h">
                      <h3 className="dash-h3">{t('dash.today.title')}{dueNow.length > 0 && <span className="dash-att-n"> {dueNow.length}</span>}</h3>
                      <div className="row tight">
                        {dueNow.length > 0 && me && <Seg label={t('dash.today.who')} value={view} onChange={(v) => setWhose(v)} options={[{ value: 'mine', label: t('dash.today.mine'), count: mine.length }, { value: 'team', label: t('dash.today.team'), count: dueNow.length }]} />}
                      </div>
                    </div>
                    <div data-testid="dash-today" className="dash-today">
                      {shownTasks.length ? (
                        <>
                          <div className="list">{(allTasks ? shownTasks : shownTasks.slice(0, TASKS_SHOWN)).map((x) => <TaskRow key={x.id} task={x} showJob onEdit={() => setTaskForm({ task: x })} />)}</div>
                        </>
                      ) : (
                        <Quiet icon={<LuListChecks />} title={dueNow.length ? t('dash.today.emptyMine', { n: dueNow.length }) : <><b>{t('dash.today.empty')}</b> {t('dash.today.emptyHint')}</>}>
                          {dueNow.length
                            ? <Button size="sm" onClick={() => setWhose('team')}>{t('dash.today.showTeam')}</Button>
                            : <Button size="sm" icon={<LuPlus aria-hidden="true" />} onClick={() => setTaskForm({})}>{t('dash.act.task')}</Button>}
                        </Quiet>
                      )}
                    </div>
                    <div className="dash-due-f">
                      {!allTasks && shownTasks.length > TASKS_SHOWN ? <button type="button" className="linkbtn small dash-more" onClick={() => setAllTasks(true)} data-testid="dash-today-more">{t('dash.today.more', { n: shownTasks.length - TASKS_SHOWN })}</button> : <span />}
                      <A to="/tasks" className="dash-more small">{t('dash.today.all')}</A>
                    </div>
                  </section>
                )}
              </div>
            </Card>
          )}

          {/* 7. next steps suggested by VYNTEX AI: rules over the records, the assistant takes it from there */}
          {can('assistant') && (
            <section className="card premium dash-ai dash-o6" data-testid="dash-ai" aria-labelledby="dash-ai-h">
              <div className="dash-ai-h">
                <span className="dash-ai-mark cut" aria-hidden="true"><LuSparkles /></span>
                <div className="grow">
                  <div className="row tight"><h2 id="dash-ai-h">{t('dash.ai.title')}</h2><PlanBadge feature="assistant" /></div>
                  <p className="small muted">{t('dash.ai.note')}</p>
                </div>
              </div>
              {!recs.length ? (
                <Quiet icon={<LuSparkles />} title={t('dash.ai.empty')}><A to="/assistant" className="btn sm">{t('dash.ai.open')}<Arrow /></A></Quiet>
              ) : (
                <>
                  <ul className="dash-ai-list">
                    {recs.map((r) => (
                      <li key={r.id}>
                        <A to={r.ask ? '/assistant?q=' + encodeURIComponent(r.ask) : r.to ?? '/assistant'} className="dash-ai-row dash-row" data-testid={`dash-ai-${r.id}`} data-ask={r.ask}>
                          <span className="dash-ai-ico" aria-hidden="true">{REC_ICON[r.icon]}</span>
                          <span className="grow">
                            <b>{r.title}</b>
                            {r.detail && <span className="small muted dash-ai-d">{r.detail}</span>}
                            <span className="dash-ai-q">{r.ask ? <><LuSparkles aria-hidden="true" /><span className="sr">{t('cmd.ask')}: </span>{r.ask}</> : r.cta}{'\u00A0'}<Arrow /></span>
                          </span>
                        </A>
                      </li>
                    ))}
                  </ul>
                  <A to="/assistant" className="dash-more small">{t('dash.ai.more')}</A>
                </>
              )}
            </section>
          )}

          {!activityLeft && activityCard}
        </div>
      </div>

      {taskForm && <TaskFormModal task={taskForm.task} defaults={me ? { assignee: 'u:' + me.id } : undefined} onClose={() => { if (!taskForm.task) setAllTasks(true); setTaskForm(null); }} />}
      {payForm && <ClientPaymentModal onClose={() => setPayForm(false)} />}
    </div>
  );
}
