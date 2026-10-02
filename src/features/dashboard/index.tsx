// Dashboard: where the business stands today, what needs someone now, and what is coming.
// Note for memo dependencies: the store replaces `data` on every change but keeps the lists inside it, so depend on `data`.
// Every figure is derived from the data through domain/selectors, and every figure opens the list behind it.
import { useMemo, useState, type CSSProperties } from 'react';
import { LuBriefcase, LuCalendarDays, LuCircleCheckBig, LuCompass, LuListChecks, LuPlus, LuUserPlus, LuWallet, LuX, LuZap } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, go, refPath } from '@/app/router';
import type { PageProps } from '@/app/routes';
import { setPrefs } from '@/store/store';
import { Button, Card, IconButton, Seg, cx, type Tone } from '@/ui';
import { ActivityList, JobStatusBadge, TaskRow } from '@/app/shared';
import { ClientPaymentModal, TaskFormModal } from '@/app/forms';
import { assigneeName, byId, calendarEvents, isActiveJob, isDueToday, isOpenLead, isOverdue, jobMoney, kpiValues, notices, type CalEvent, type EventKind, type Notice } from '@/domain/selectors';
import type { Permission } from '@/domain/permissions';
import type { LeadStage, Task } from '@/domain/types';
import type { KpiId } from '@/packs/types';
import { addDays, fmtDate, relDay, today } from '@/lib/dates';
import { money, pct, sum } from '@/lib/money';
import { ruleName, stepText } from '@/features/automations/format';
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
const GROUPS: { kind: Notice['kind']; more: string; needs?: Permission }[] = [
  { kind: 'overdueTask', more: '/tasks' },
  { kind: 'coiExpired', more: '/team', needs: 'team' },
  { kind: 'w9Missing', more: '/team', needs: 'team' },
  { kind: 'followUp', more: '/leads' },
  { kind: 'docWaiting', more: '/documents', needs: 'documents' },
  { kind: 'balance', more: '/payments', needs: 'money' },
  { kind: 'coiSoon', more: '/team', needs: 'team' },
  { kind: 'newLead', more: '/leads' },
];
const OPEN_STAGES: LeadStage[] = ['new', 'contacted', 'scheduled', 'sent'];
const EVENT_TONE: Record<EventKind, Tone> = { appt: 'violet', follow: 'warn', start: 'info', end: 'ok', visit: 'accent', task: 'neutral' };
const PRI_RANK = { high: 0, medium: 1, low: 2 } as const;

export default function DashboardPage(_: PageProps) {
  const { t, data, prefs, pack, lang, can, date, day, time, dateTime } = useApp();
  const [taskForm, setTaskForm] = useState<{ task?: Task } | null>(null);
  const [payForm, setPayForm] = useState(false);
  const [whose, setWhose] = useState<'mine' | 'team' | null>(null);
  const [allTasks, setAllTasks] = useState(false);

  const me = data.users.find((u) => u.role === prefs.viewAs) ?? data.users[0];
  const td = today();
  /** "1 item" and "3 items" are separate sentences in both languages. */
  const n1 = (key: string, n: number, extra?: Record<string, string | number>) => t(n === 1 ? key + '.one' : key, { n, ...extra });

  const kpi = useMemo(() => kpiValues(data), [data]);
  const allNotices = useMemo(() => notices(data, { compliance: pack.compliance }), [data, pack.compliance]);

  /* ---------- needs attention ---------- */
  const groups = GROUPS.filter((g) => !g.needs || can(g.needs))
    .map((g) => ({ ...g, items: allNotices.filter((n) => n.kind === g.kind) }))
    .filter((g) => g.items.length);
  const attentionCount = sum(groups, (g) => g.items.length);

  /* ---------- today and overdue ---------- */
  const dueNow = useMemo(() => data.tasks.filter((x) => isOverdue(x) || isDueToday(x))
    .sort((a, b) => (a.due || '').localeCompare(b.due || '') || PRI_RANK[a.pri] - PRI_RANK[b.pri]), [data]);
  const mine = me ? dueNow.filter((x) => x.assignee === 'u:' + me.id) : [];
  const view = whose ?? (mine.length ? 'mine' : 'team');
  const shownTasks = view === 'mine' ? mine : dueNow;

  /* ---------- coming up ---------- */
  const upcoming = useMemo(() => calendarEvents(data, 8).filter((e) => e.kind !== 'task' && !e.done && e.date >= td && e.date <= addDays(7)), [data, td]);
  const upShown = upcoming.slice(0, 9);
  const days: { date: string; events: CalEvent[] }[] = [];
  for (const e of upShown) { const last = days[days.length - 1]; if (last && last.date === e.date) last.events.push(e); else days.push({ date: e.date, events: [e] }); }
  const dayLabel = (d: string) => (d === td ? t('common.today') : d === addDays(1) ? t('dash.up.tomorrow') : day(d));
  const eventKind = (k: EventKind) => (k === 'visit' ? t('dash.ev.visit') : t('ev_' + k));

  /* ---------- active jobs ---------- */
  const active = useMemo(() => {
    const rank = { progress: 0, contract: 1, hold: 2, estimate: 3, done: 4 } as const;
    return data.jobs.filter(isActiveJob).sort((a, b) => rank[a.status] - rank[b.status] || (a.start || '9').localeCompare(b.start || '9'));
  }, [data]);
  const activeShown = active.slice(0, 6);

  /* ---------- pipeline ---------- */
  const openLeads = data.leads.filter(isOpenLead);
  const stages = OPEN_STAGES.map((s) => { const list = openLeads.filter((l) => l.status === s); return { stage: s, n: list.length, value: sum(list, (l) => l.value) }; });
  const byValue = stages.some((s) => s.value > 0);
  const pipeMax = Math.max(1, ...stages.map((s) => (byValue ? s.value : s.n)));

  /* ---------- activity ---------- */
  const moneyKinds = /^(payment\.|worker\.paid|expense\.|invoice\.)/;
  const activity = data.activity.filter((a) => (can('money') || !moneyKinds.test(a.kind)) && (can('team') || a.ref.type !== 'worker'));
  const runs = can('automations') ? data.automation.runs.slice(0, 3) : [];

  /* ---------- tiles ---------- */
  const tiles = pack.kpis.filter((id) => KPI[id] && (!KPI[id].needs || can(KPI[id].needs!)));
  const hiddenTiles = pack.kpis.length - tiles.length;
  const waiting = data.jobs.filter((j) => j.status === 'contract').length;
  const withBalance = data.jobs.filter((j) => (j.status === 'progress' || j.status === 'done') && jobMoney(data, j).clientOwes > 0.005).length;
  const paymentsThisMonth = sum(data.jobs, (j) => j.received.filter((r) => r.date.startsWith(td.slice(0, 7))).length);
  const dueTodayCount = data.tasks.filter(isDueToday).length;
  const hint: Record<KpiId, string | undefined> = {
    activeJobs: waiting ? t('dash.hint.waiting', { n: waiting }) : undefined,
    activeValue: kpi.activeJobs ? n1('dash.hint.acrossJobs', kpi.activeJobs) : undefined,
    expectedProfit: kpi.activeValue > 0 ? t('dash.hint.margin', { pct: pct(kpi.expectedProfit / kpi.activeValue) }) : undefined,
    clientsOwe: withBalance ? n1('dash.hint.balances', withBalance) : t('dash.hint.nobodyOwes'),
    oweWorkers: kpi.oweWorkers > 0 ? t('dash.hint.oweWorkers') : t('dash.hint.oweNothing'),
    newLeads: t('dash.hint.openLeads', { n: openLeads.length }),
    pipelineValue: t('dash.hint.pipeline', { n: openLeads.length }),
    visitsThisWeek: t('dash.hint.visits'),
    overdueTasks: dueTodayCount ? t('dash.hint.dueToday', { n: dueTodayCount }) : kpi.overdueTasks ? undefined : t('dash.hint.noneLate'),
    recurringClients: t('dash.hint.recurring'),
    collectedMonth: paymentsThisMonth ? n1('dash.hint.payments', paymentsThisMonth) : undefined,
  };

  const kpiText = (id: KpiId) => (MONEY_KPIS.includes(id) ? money(kpi[id]) : String(kpi[id]));

  /* ---------- header ---------- */
  const hour = new Date().getHours();
  const greeting = t(hour < 12 ? 'dash.hi.morning' : hour < 18 ? 'dash.hi.afternoon' : 'dash.hi.evening') + (me ? `, ${me.name.split(' ')[0]}` : '');
  const longDate = fmtDate(td, lang, { weekday: 'long', month: 'long', day: 'numeric' });
  const summary = [attentionCount ? n1('dash.sum.items', attentionCount) : '', dueNow.length ? n1('dash.sum.tasks', dueNow.length) : ''].filter(Boolean).join(' · ') || t('dash.sum.clear');

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

  return (
    <div className="dash">
      <header className="dash-head">
        <div>
          <h1>{greeting}</h1>
          <p><span className="dash-date">{longDate.charAt(0).toUpperCase() + longDate.slice(1)}</span> · {summary}</p>
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
          <div className="grow">
            <b>{t('dash.tour.title')}</b>
            <p className="small muted">{t('dash.tour.text')}</p>
          </div>
          <Button variant="primary" size="sm" onClick={() => go('/?tour=1')} data-testid="dash-tour-start">{t('dash.tour.start')}</Button>
          <IconButton size="sm" label={t('dash.tour.dismiss')} onClick={() => setPrefs({ tourSeen: true })} data-testid="dash-tour-dismiss"><LuX /></IconButton>
        </section>
      )}

      <section className="dash-kpis" aria-label={t('dash.kpis')} style={{ '--n': pack.kpis.length, '--hidden': Math.max(1, hiddenTiles) } as CSSProperties}>
        {tiles.map((id) => (
          <A key={id} to={KPI[id].to} className={cx('kpi', id === 'overdueTasks' && kpi.overdueTasks > 0 && 'attn')} data-testid={`dash-kpi-${id}`}>
            <div className="k">{t('dash.kpi.' + id)}</div>
            <div className={cx('v', kpiText(id).length > 8 && 'long')}>{kpiText(id)}</div>
            {hint[id] && <div className="h">{hint[id]}</div>}
          </A>
        ))}
        {hiddenTiles > 0 && (
          <p className="dash-kpi-note small" data-testid="dash-hidden-note">
            {can('money') ? t('dash.kpi.hiddenProfit', { role: t('role.owner') }) : t('dash.kpi.hiddenMoney', { role: t('role.' + prefs.viewAs) })}
          </p>
        )}
      </section>

      <div className="dash-grid">
        <div className="dash-col">
          {/* needs attention */}
          <Card className="dash-o1" title={<>{t('dash.att.title')}{attentionCount > 0 && <span className="count bad">{attentionCount}</span>}</>}>
            <div data-testid="dash-attention">
              {!groups.length ? (
                <div className="dash-clear"><LuCircleCheckBig aria-hidden="true" /><div><b>{t('dash.att.clear')}</b><p className="small muted">{t('dash.att.clearHint')}</p></div></div>
              ) : groups.map((g) => (
                <section key={g.kind} className="dash-att" aria-label={t('dash.att.' + g.kind)}>
                  <h3><span className={cx('dot', g.items[0].tone)} aria-hidden="true" /><span>{t('dash.att.' + g.kind)}{g.items.length > 1 && <span className="dash-att-n"> {g.items.length}</span>}</span></h3>
                  <ul>
                    {g.items.slice(0, 3).map((n) => {
                      const v = noticeLine(n);
                      return (
                        <li key={n.id}>
                          <A to={v.to} className="dash-att-item">
                            <span className="dash-att-t"><b>{n.title}</b>{v.ctx && <span className="muted dash-att-c"><span aria-hidden="true"> · </span>{v.ctx}</span>}</span>
                            {v.meta && <span className={cx('small nowrap dash-att-m', n.tone === 'bad' ? 'neg' : 'muted')}>{v.meta}</span>}
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

          {/* today and overdue */}
          {can('tasks') && (
            <Card className="dash-o2" title={t('dash.today.title')} actions={<>
              {dueNow.length > 0 && me && <Seg label={t('dash.today.who')} value={view} onChange={(v) => setWhose(v)} options={[{ value: 'mine', label: t('dash.today.mine'), count: mine.length }, { value: 'team', label: t('dash.today.team'), count: dueNow.length }]} />}
              <A to="/tasks" className="btn sm ghost">{t('dash.today.all')}</A>
            </>}>
              <div data-testid="dash-today" className="dash-today">
                {shownTasks.length ? (
                  <>
                    <div className="list">{(allTasks ? shownTasks : shownTasks.slice(0, 6)).map((x) => <TaskRow key={x.id} task={x} showJob onEdit={() => setTaskForm({ task: x })} />)}</div>
                    {!allTasks && shownTasks.length > 6 && <button type="button" className="linkbtn small dash-more" onClick={() => setAllTasks(true)} data-testid="dash-today-more">{t('dash.today.more', { n: shownTasks.length - 6 })}</button>}
                  </>
                ) : (
                  <div className="dash-quiet">
                    <p><b>{t('dash.today.empty')}</b></p>
                    <p className="small muted">{dueNow.length ? t('dash.today.emptyMine', { n: dueNow.length }) : t('dash.today.emptyHint')}</p>
                    {dueNow.length
                      ? <Button size="sm" onClick={() => setWhose('team')}>{t('dash.today.showTeam')}</Button>
                      : <Button size="sm" icon={<LuPlus aria-hidden="true" />} onClick={() => setTaskForm({})}>{t('dash.act.task')}</Button>}
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* active jobs */}
          {can('jobs') && (
            <Card flush className="dash-o4" title={<>{t('dash.active.title')}<span className="count">{active.length}</span></>} actions={<A to="/jobs" className="btn sm ghost">{t('dash.active.all')}</A>}>
              <div data-testid="dash-active">
                {!active.length ? (
                  <div className="dash-quiet pad"><p><b>{t('dash.active.empty')}</b></p><p className="small muted">{t('dash.active.emptyHint')}</p><A to="/leads" className="btn sm">{t('nav.leads')}</A></div>
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
                                      <div className="bar" role="img" aria-label={t('dash.active.receivedLabel', { received: money(m.received), price: money(m.price) })}><span className="s3" style={{ width: `${share * 100}%` }} /></div>
                                      <div className="xs muted dash-recv-t"><span>{t('dash.active.received', { received: money(m.received), price: money(m.price) })}</span><span>{pct(share)}</span></div>
                                    </div>
                                  ) : <span className="small dim">{t('dash.active.noPrice')}</span>}
                                </td>
                              ) : <td data-label={t('dash.active.col.start')} className="small muted">{date(j.start || undefined)}</td>}
                              {can('profit') && <td data-label={t('dash.active.col.profit')} className={cx('num nowrap', m.profit < 0 && 'neg')}><b>{money(m.profit)}</b>{m.price > 0 && <span className="xs muted"> {pct(m.margin)}</span>}</td>}
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
        </div>

        <div className="dash-col">
          {/* coming up */}
          {can('calendar') && (
            <Card className="dash-o3" title={<>{t('dash.up.title')}<span className="dash-h-sub">{t('dash.up.sub')}</span></>} actions={<A to="/calendar" className="btn sm ghost"><LuCalendarDays aria-hidden="true" />{t('dash.up.calendar')}</A>}>
              <div data-testid="dash-upcoming">
                {!days.length ? <p className="small muted">{t('dash.up.empty')}</p> : days.map((d) => (
                  <div key={d.date} className="dash-day">
                    <div className={cx('dash-day-h', d.date === td && 'now')}>{dayLabel(d.date)}</div>
                    <ul>
                      {d.events.map((e) => (
                        <li key={e.id}>
                          <A to={refPath(e.ref)} className="dash-ev">
                            <span className={cx('dot', EVENT_TONE[e.kind])} aria-hidden="true" />
                            <span className="grow">
                              <b>{e.title}</b>
                              <span className="xs muted dash-ev-s">{[eventKind(e.kind), e.sub].filter(Boolean).join(' · ')}</span>
                            </span>
                            {e.time && <span className="small muted nowrap">{time(e.time)}</span>}
                          </A>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {upcoming.length > upShown.length && <A to="/calendar" className="dash-more small">{t('dash.up.more', { n: upcoming.length - upShown.length })}</A>}
              </div>
            </Card>
          )}

          {/* pipeline */}
          {can('leads') && (
            <Card className="dash-o5" title={t('dash.pipe.title')} actions={<A to="/leads?view=board" className="btn sm ghost">{t('dash.pipe.board')}</A>}>
              <div data-testid="dash-pipeline">
                {!openLeads.length ? <p className="small muted">{t('dash.pipe.empty')}</p> : (
                  <>
                    <ul className="dash-pipe">
                      {stages.map((s) => (
                        <li key={s.stage}>
                          <A to="/leads?view=board" className="dash-pipe-row" aria-label={t('dash.pipe.row', { stage: t('ls_' + s.stage), n: s.n, value: money(s.value) })}>
                            <span className="dash-pipe-l">{t('ls_' + s.stage)}</span>
                            <span className="dash-pipe-n">{s.n}</span>
                            <span className="dash-pipe-bar" aria-hidden="true"><i style={{ width: `${((byValue ? s.value : s.n) / pipeMax) * 100}%` }} /></span>
                            <span className="dash-pipe-v">{money(s.value)}</span>
                          </A>
                        </li>
                      ))}
                    </ul>
                    <div className="dash-pipe-total small"><span className="muted">{n1('dash.pipe.total', openLeads.length)}</span><b>{money(kpi.pipelineValue)}</b></div>
                  </>
                )}
              </div>
            </Card>
          )}

          {/* recent activity and what the automations did */}
          <Card className="dash-o6" title={t('dash.activity.title')}>
            <div data-testid="dash-activity">
              <ActivityList items={activity} limit={6} linkRecords />
              {can('automations') && (
                <div className="dash-auto">
                  <div className="row between"><h3><LuZap aria-hidden="true" />{t('dash.auto.title')}</h3><A to="/automations" className="small dash-link-a">{t('dash.auto.all')}</A></div>
                  {!runs.length ? <p className="small muted">{t('dash.auto.empty')}</p> : (
                    <ul>
                      {runs.map((r) => (
                        <li key={r.id}>
                          <A to="/automations" className="dash-auto-row">
                            <span className="grow"><b>{ruleName(r.ruleId, t)}</b><span className="small muted dash-ev-s">{r.steps[0] ? stepText(r.steps[0], t, date) : ''}{r.steps.length > 1 ? ` ${t('dash.auto.more', { n: r.steps.length - 1 })}` : ''}</span></span>
                            <span className="xs dim nowrap">{dateTime(r.at)}</span>
                          </A>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {taskForm && <TaskFormModal task={taskForm.task} defaults={me ? { assignee: 'u:' + me.id } : undefined} onClose={() => { if (!taskForm.task) setAllTasks(true); setTaskForm(null); }} />}
      {payForm && <ClientPaymentModal onClose={() => setPayForm(false)} />}
    </div>
  );
}
