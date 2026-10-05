// Home screen of the professional-services edition (and of LBS Command).
// 1 greeting and what is on the person's plate today · 2 the links the team sends to clients · 3 today at a glance, each
// count opening the records it counted · 4 the firm's figures, for people who may see reports · 5 what needs attention
// (the person's own notices included) · 6 the week's schedule · 7 pipeline and revenue · 8 suggestions and recent activity.
// Every figure is computed from the records (./glance.ts, domain/selectors). The field editions keep ./index.tsx as it is.
import { Fragment, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  LuAlarmClock, LuArrowUpRight, LuAtSign, LuBriefcase, LuCalendarCheck, LuCalendarClock, LuCalendarDays, LuChartColumn, LuChevronRight, LuCircleCheckBig, LuClockAlert, LuFilePen,
  LuInbox, LuKeyRound, LuListChecks, LuPhoneCall, LuPlus, LuSignature, LuSparkles, LuUserPlus, LuWallet, LuZap,
} from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, refPath } from '@/app/router';
import { Button, Card, Seg, cx, type Tone } from '@/ui';
import { ActivityList, CanWrite, PlanBadge } from '@/app/shared';
import { ClientPaymentModal } from '@/app/forms';
import { Arrow } from '@/brand';
import { pick } from '@/i18n';
import { moduleOn, openStages } from '@/domain/config';
import { visibleClientIds, visibleLeads } from '@/domain/access';
import { effectiveRules, shippedRules } from '@/domain/rules/engine';
import type { Permission } from '@/domain/permissions';
import { byId, calendarEvents, isCancelledAppt, isDueToday, isOpenLead, jobMoney, kpiValues, notices, type Notice } from '@/domain/selectors';
import type { KpiId } from '@/packs/types';
import { addDays, fmtDate, relDay, today } from '@/lib/dates';
import { money, sum } from '@/lib/money';
import { runRuleName, stepText } from '@/features/automations/format';
import { assistantOn } from '@/features/assistant/deploy';
import { ClientRequestModal } from '@/features/tasks/request';
import { TaskDialog } from '@/features/tasks/detail';
import { collectedByMonth, recommendations, type RecIcon } from './insights';
import { glance, type GlanceId, type GlanceTile } from './glance';
import { QuickLinks, quickLinks } from './links';
import { Quiet, Swap } from './parts';
import './dashboard.css';

const GLANCE_ICON: Record<GlanceId, ReactNode> = {
  appts: <LuCalendarClock />, tasks: <LuListChecks />, requests: <LuInbox />, leads: <LuPhoneCall />, signatures: <LuSignature />, deadlines: <LuAlarmClock />, unpaid: <LuCalendarCheck />, balances: <LuWallet />,
};
/** Where each firm figure opens, and the capability its number needs. */
const KPI: Record<KpiId, { to: string; needs?: Permission }> = {
  activeJobs: { to: '/jobs' }, activeValue: { to: '/jobs', needs: 'money' }, expectedProfit: { to: '/reports/profit', needs: 'profit' }, clientsOwe: { to: '/payments?tab=balances', needs: 'money' },
  oweWorkers: { to: '/payments', needs: 'money' }, collectedMonth: { to: '/payments', needs: 'money' }, newLeads: { to: '/leads' }, pipelineValue: { to: '/leads?view=board' },
  visitsThisWeek: { to: '/calendar' }, overdueTasks: { to: '/tasks?view=list&due=overdue' }, recurringClients: { to: '/clients' },
};
const MONEY_KPIS: KpiId[] = ['activeValue', 'expectedProfit', 'clientsOwe', 'oweWorkers', 'collectedMonth', 'pipelineValue'];
/** Attention groups, most serious first. `needs` hides a group from people who cannot open the records behind it. */
const GROUPS: { kind: string; more: string; needs?: Permission; icon: ReactNode }[] = [
  { kind: 'mention', more: '/tasks', icon: <LuAtSign /> },
  { kind: 'overdueTask', more: '/tasks?view=list&due=overdue', icon: <LuClockAlert /> },
  { kind: 'deadlineOverdue', more: '/deadlines', needs: 'deadlines', icon: <LuAlarmClock /> },
  { kind: 'apptUnpaid', more: '/appointments', needs: 'appointments', icon: <LuCalendarCheck /> },
  { kind: 'revealPending', more: '/security', needs: 'secureApprove', icon: <LuKeyRound /> },
  { kind: 'accessPending', more: '/clients', needs: 'allClients', icon: <LuKeyRound /> },
  { kind: 'envelopeDeclined', more: '/esign', needs: 'esign', icon: <LuSignature /> },
  { kind: 'autoFailed', more: '/automations', needs: 'automations', icon: <LuZap /> },
  { kind: 'requestMine', more: '/tasks?view=requests&who=me', icon: <LuInbox /> },
  { kind: 'ruleNote', more: '/messages', needs: 'comms', icon: <LuZap /> },
  { kind: 'followUp', more: '/leads', needs: 'leads', icon: <LuPhoneCall /> },
  { kind: 'docWaiting', more: '/documents', needs: 'documents', icon: <LuFilePen /> },
  { kind: 'deadlineSoon', more: '/deadlines', needs: 'deadlines', icon: <LuAlarmClock /> },
  { kind: 'balance', more: '/payments?tab=balances', needs: 'money', icon: <LuWallet /> },
  { kind: 'envelopeDone', more: '/esign', needs: 'esign', icon: <LuSignature /> },
  { kind: 'newLead', more: '/leads', needs: 'leads', icon: <LuUserPlus /> },
];
const TONES: Notice['tone'][] = ['bad', 'warn', 'info'];
const REC_ICON: Record<RecIcon, ReactNode> = { follow: <LuPhoneCall />, task: <LuClockAlert />, balance: <LuWallet />, paper: <LuFilePen />, doc: <LuFilePen />, lead: <LuUserPlus />, calendar: <LuCalendarDays />, money: <LuWallet /> };
const compact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const ROWS_SHOWN = 6;
interface Slot { id: string; date: string; time?: string; title: string; sub: string; tone: Tone; to: string }

export default function PracticeDashboard() {
  const { t, data, prefs, pack, lang, can, perms, user, date, day, time, dateTime } = useApp();
  const [scope, setScope] = useState<'mine' | 'firm'>('mine');
  const [picked, setPicked] = useState<GlanceId | null>(null);
  const [asking, setAsking] = useState(false); const [payForm, setPayForm] = useState(false); const [taskForm, setTaskForm] = useState(false);
  const td = today();
  const n1 = (key: string, n: number, extra?: Record<string, string | number>) => t(n === 1 ? key + '.one' : key, { n, ...extra });
  const oversees = can('reports');
  const on = (m: Parameters<typeof moduleOn>[2]) => moduleOn(data, pack, m);

  /* ---------- today at a glance ---------- */
  const view = oversees ? scope : 'mine';
  const tiles = useMemo(() => glance({ data, pack, t, lang, can, perms, user, scope: view, date, time }), [data, pack, lang, prefs.viewAs, view]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = useMemo(() => (view === 'mine' ? tiles : glance({ data, pack, t, lang, can, perms, user, scope: 'mine', date, time })), [tiles, view]); // eslint-disable-line react-hooks/exhaustive-deps
  const selected: GlanceTile | undefined = tiles.find((x) => x.id === picked) ?? tiles.find((x) => x.count > 0) ?? tiles[0];
  const tileValue = (x: GlanceTile) => (x.id === 'balances' ? money(x.amount) : String(x.count));
  const tileHint = (x: GlanceTile) => (x.id === 'balances' ? n1('dash.p.h.balances', x.count) : x.id === 'unpaid' && x.count ? money(x.amount) : undefined);

  /* ---------- greeting: what is on this person's plate ---------- */
  const hour = new Date().getHours();
  const hello = t(hour < 12 ? 'dash.hi.morning' : hour < 18 ? 'dash.hi.afternoon' : 'dash.hi.evening');
  const greeting = user ? t('dash.hi.named', { greeting: hello, name: user.name.split(' ')[0] }) : t('dash.hi.plain', { greeting: hello });
  const longDate = fmtDate(td, lang, { weekday: 'long', month: 'long', day: 'numeric' });
  const plate = mine.filter((x) => x.count > 0 && x.id !== 'balances' && x.id !== 'unpaid').slice(0, 4);
  const jump = (id: GlanceId) => { setScope('mine'); setPicked(id); document.getElementById('dash-glance')?.scrollIntoView({ block: 'nearest' }); };

  /* ---------- what needs attention: shared notices plus this person's own ---------- */
  const allNotices = useMemo(() => notices(data, { compliance: pack.compliance, viewer: { id: user?.id, perms } }), [data, pack.compliance, user?.id, prefs.viewAs]); // eslint-disable-line react-hooks/exhaustive-deps
  const seen = useMemo(() => visibleClientIds(data, user, perms), [data, user, perms]);
  const groups = GROUPS.filter((g) => !g.needs || can(g.needs)).map((g) => ({ ...g, items: allNotices.filter((n) => n.kind === g.kind) })).filter((g) => g.items.length);
  const attentionCount = sum(groups, (g) => g.items.length);
  const byTone = TONES.map((tone) => ({ tone, n: sum(groups, (g) => g.items.filter((x) => x.tone === tone).length) })).filter((x) => x.n);
  const noticeLine = (n: Notice): { ctx: string; meta: string; to: string } => {
    const rel = n.date ? relDay(n.date, lang) : '';
    const to = n.to ?? refPath(n.ref);
    if (n.ref.type === 'task') { const task = byId(data.tasks, n.ref.id); const job = byId(data.jobs, task?.jobId); return { ctx: [byId(data.clients, task?.clientId ?? job?.clientId)?.name, job?.name].filter(Boolean).join(' · '), meta: rel, to }; }
    if (n.ref.type === 'lead') { const lead = byId(data.leads, n.ref.id); return { ctx: lead ? [t('ty_' + lead.type), n.kind === 'newLead' ? t('src_' + lead.source) : lead.phone].filter(Boolean).join(' · ') : '', meta: rel, to }; }
    if (n.ref.type === 'doc') { const doc = byId(data.docs, n.ref.id); return { ctx: doc ? [`${t('doc.kind.' + doc.kind)} ${doc.number}`, byId(data.clients, doc.clientId)?.name].filter(Boolean).join(' · ') : '', meta: n.date ? t('dash.att.sentOn', { date: date(n.date) }) : '', to }; }
    if (n.ref.type === 'job') { const job = byId(data.jobs, n.ref.id); return { ctx: byId(data.clients, job?.clientId)?.name ?? '', meta: n.amount ? t('dash.att.owes', { amount: money(n.amount) }) : rel, to }; }
    if (n.ref.type === 'compliance') { const i = byId(data.complianceItems, n.ref.id); return { ctx: byId(data.clients, i?.clientId)?.name ?? t('deadlines.firm'), meta: rel, to }; }
    return { ctx: '', meta: n.amount ? money(n.amount) : rel, to };
  };

  /* ---------- the week's schedule: appointments, plus what the calendar derives from leads and engagements ---------- */
  const slots = useMemo(() => {
    const until = addDays(7); const out: Slot[] = [];
    const appts = (data.appointments ?? []).filter((a) => a.date >= td && a.date <= until && !isCancelledAppt(a) && (!a.clientId || seen.has(a.clientId)) && (view === 'firm' || a.staffId === user?.id));
    if (can('appointments') && on('appointments')) for (const a of appts) {
      const type = byId(data.apptTypes, a.typeId);
      out.push({ id: a.id, date: a.date, time: a.time, title: byId(data.clients, a.clientId)?.name ?? byId(data.leads, a.leadId)?.name ?? t('dash.p.noName'), sub: [type ? pick(type.name, lang) : '', view === 'firm' ? byId(data.users, a.staffId)?.name : ''].filter(Boolean).join(' · '), tone: 'violet', to: `/appointments/${a.id}` });
    }
    if (can('calendar')) for (const e of calendarEvents(data, 8)) {
      if (e.kind === 'task' || e.done || e.date < td || e.date > until) continue;
      const lead = e.ref.type === 'lead' ? byId(data.leads, e.ref.id) : undefined; const job = e.ref.type === 'job' ? byId(data.jobs, e.ref.id) : undefined;
      if (job && !seen.has(job.clientId)) continue;
      if (view === 'mine' && (lead ? lead.ownerId !== user?.id : job ? job.managerId !== user?.id : false)) continue;
      // a lead's appointment that is also booked as an appointment record is listed once
      if (e.kind === 'appt' && appts.some((a) => a.leadId === e.ref.id && a.date === e.date)) continue;
      out.push({ id: e.id, date: e.date, time: e.time, title: e.title, sub: [e.kind === 'visit' ? t('dash.ev.visit') : t('ev_' + e.kind), e.sub].filter(Boolean).join(' · '), tone: e.kind === 'follow' ? 'warn' : e.kind === 'end' ? 'ok' : e.kind === 'appt' ? 'violet' : 'info', to: refPath(e.ref) });
    }
    return out.sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
  }, [data, view, user?.id, lang, seen]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownSlots = slots.slice(0, 8);
  const days: { date: string; items: Slot[] }[] = [];
  for (const s of shownSlots) { const last = days[days.length - 1]; if (last && last.date === s.date) last.items.push(s); else days.push({ date: s.date, items: [s] }); }
  const dayLabel = (d: string) => (d === td ? t('common.today') : d === addDays(1) ? t('dash.up.tomorrow') : day(d));

  /* ---------- the firm ---------- */
  // leads of other offices stay out of every count here, as they do in the lead list
  const myLeads = useMemo(() => visibleLeads(data, user, perms), [data, user, perms]);
  const kpi = useMemo(() => kpiValues(data, myLeads), [data, myLeads]);
  const firmTiles = oversees ? pack.kpis.filter((id) => KPI[id] && (!KPI[id].needs || can(KPI[id].needs!))) : [];
  const openLeads = myLeads.filter((l) => isOpenLead(l, data));
  const withBalance = data.jobs.filter((j) => (j.status === 'progress' || j.status === 'done') && jobMoney(data, j).clientOwes > 0.005).length;
  const paymentsThisMonth = sum(data.jobs, (j) => j.received.filter((r) => r.date.startsWith(td.slice(0, 7))).length);
  const hint: Partial<Record<KpiId, string | undefined>> = {
    activeJobs: data.jobs.filter((j) => j.status === 'contract').length ? t('dash.hint.waiting', { n: data.jobs.filter((j) => j.status === 'contract').length }) : undefined,
    newLeads: t('dash.hint.openLeads', { n: openLeads.length }), pipelineValue: t('dash.hint.pipeline', { n: openLeads.length }),
    overdueTasks: data.tasks.filter(isDueToday).length ? t('dash.hint.dueToday', { n: data.tasks.filter(isDueToday).length }) : kpi.overdueTasks ? undefined : t('dash.hint.noneLate'),
    clientsOwe: withBalance ? n1('dash.hint.balances', withBalance) : t('dash.hint.nobodyOwes'),
    collectedMonth: paymentsThisMonth ? n1('dash.hint.payments', paymentsThisMonth) : t('dash.hint.noPayments'),
    visitsThisWeek: t('dash.hint.visits'), recurringClients: t('dash.hint.recurring'),
  };
  const stages = openStages(data, pack).map(({ id: s }) => { const list = openLeads.filter((l) => l.status === s); return { stage: s, n: list.length, value: sum(list, (l) => l.value) }; });
  const byValue = stages.some((s) => s.value > 0);
  const pipeMax = Math.max(1, ...stages.map((s) => (byValue ? s.value : s.n)));
  const months = useMemo(() => (can('money') && oversees ? collectedByMonth(data, lang) : []), [data, lang, prefs.viewAs]); // eslint-disable-line react-hooks/exhaustive-deps
  const monthMax = Math.max(1, ...months.map((m) => m.amount));

  /* ---------- suggestions, automation runs, activity ---------- */
  const recs = useMemo(() => (can('assistant') && assistantOn(data, pack) ? recommendations({ data, pack, lang, t, can, date, day, notices: allNotices, kpi }) : []), [data, pack, lang, prefs.viewAs, allNotices, kpi]); // eslint-disable-line react-hooks/exhaustive-deps
  const hidden = /^(payment\.|worker\.paid|expense\.|invoice\.)/;
  const activity = data.activity.filter((a) => (can('money') || !hidden.test(a.kind)) && (can('cash') || a.ref.type !== 'cash'));
  const runs = can('automations') ? data.automation.runs.slice(0, 3) : [];
  const rules = effectiveRules(data, pack); const shipped = shippedRules(pack);
  const links = quickLinks(data);

  return (
    <div className="dash dash-p">
      {/* 1. greeting, what is on the person's plate, quick actions (one primary) */}
      <header className="dash-head">
        <div className="dash-hello">
          <p className="dash-date">{longDate.charAt(0).toUpperCase() + longDate.slice(1)}</p>
          <h1>{greeting}</h1>
          <p className="dash-state" data-testid="dash-state">
            {plate.length ? (
              <>{t('dash.p.plate')} {plate.map((p, i) => <Fragment key={p.id}>{i > 0 && (i === plate.length - 1 ? ` ${t('dash.state.and')} ` : ', ')}<button type="button" className="dash-statebtn" onClick={() => jump(p.id)}>{n1('dash.p.s.' + p.id, p.count)}</button></Fragment>)}.</>
            ) : t('dash.p.plateClear')}
          </p>
        </div>
        <div className="dash-actions" role="group" aria-label={t('dash.actions')}>
          {can('leads') && on('leads') && <CanWrite><A to="/leads?new=1" className="btn" data-testid="dash-new-lead"><LuUserPlus aria-hidden="true" />{t('dash.act.lead')}</A></CanWrite>}
          {can('appointments') && on('appointments') && <CanWrite><A to="/appointments?new=1" className="btn" data-testid="dash-new-appt"><LuCalendarClock aria-hidden="true" />{t('dash.p.act.appt')}</A></CanWrite>}
          {can('tasks') && on('tasks') && <CanWrite><Button icon={<LuInbox aria-hidden="true" />} onClick={() => setAsking(true)} data-testid="dash-new-request">{t('dash.p.act.request')}</Button></CanWrite>}
          {can('money') && on('payments') && <CanWrite><Button icon={<LuWallet aria-hidden="true" />} onClick={() => setPayForm(true)} data-testid="dash-record-payment">{t('dash.act.payment')}</Button></CanWrite>}
          {can('jobs') && on('jobs') && <CanWrite><A to="/jobs?new=1" className="btn primary" data-testid="dash-new-job"><LuBriefcase aria-hidden="true" />{t('newProject')}</A></CanWrite>}
        </div>
      </header>

      {/* 2. the links the team sends to clients: up front, because they are used every day */}
      {links.length > 0 && (
        <section className="card dash-linkcard" aria-labelledby="dash-links-h">
          <div className="dash-linkcard-h"><h2 id="dash-links-h">{t('dash.links.title')}</h2><p className="small muted">{t('dash.links.sub')}</p></div>
          <QuickLinks />
        </section>
      )}

      {/* 3. today at a glance: each count is a tab, the panel under it lists exactly what was counted */}
      <section className="card raised dash-glance" id="dash-glance" aria-labelledby="dash-glance-h">
        <div className="dash-glance-h">
          <h2 id="dash-glance-h">{t(view === 'firm' ? 'dash.p.glanceFirm' : 'dash.p.glance')}</h2>
          {oversees && <Seg label={t('dash.p.scope')} value={scope} onChange={(v) => { setScope(v); setPicked(null); }} options={[{ value: 'mine', label: t('dash.p.scope.mine') }, { value: 'firm', label: t('dash.p.scope.firm') }]} />}
        </div>
        {!tiles.length ? <Quiet icon={<LuCircleCheckBig />} title={t('dash.p.nothing')} /> : (
          <>
            <div className="dash-g-tiles" role="tablist" aria-label={t('dash.p.glance')} data-testid="dash-glance">
              {tiles.map((x) => (
                <button key={x.id} type="button" role="tab" id={`dash-g-tab-${x.id}`} aria-selected={selected?.id === x.id} aria-controls="dash-g-panel" className={cx('dash-g-tile', x.count === 0 && 'zero', x.rows.some((r) => r.tone === 'bad') && 'late')} onClick={() => setPicked(x.id)} data-testid={`dash-g-${x.id}`} data-count={x.count}>
                  <span className="dash-g-ico" aria-hidden="true">{GLANCE_ICON[x.id]}</span>
                  <span className="dash-g-v"><Swap>{tileValue(x)}</Swap></span>
                  <span className="dash-g-k">{t(`dash.p.g.${x.id}`)}</span>
                  {tileHint(x) && <span className="dash-g-h">{tileHint(x)}</span>}
                </button>
              ))}
            </div>
            {selected && (
              <div className="dash-g-panel" role="tabpanel" id="dash-g-panel" aria-labelledby={`dash-g-tab-${selected.id}`} data-testid="dash-g-panel" data-tile={selected.id}>
                <div className="dash-g-ph"><h3>{t(`dash.p.g.${selected.id}`)}<span className="count">{selected.count}</span></h3><A to={selected.more} className="btn sm ghost" data-testid="dash-g-more">{t(`dash.p.open.${selected.id}`)}<LuChevronRight aria-hidden="true" /></A></div>
                {selected.rows.length ? (
                  <ul className="dash-g-rows">
                    {selected.rows.slice(0, ROWS_SHOWN).map((r) => (
                      <li key={r.id}>
                        <A to={r.to} className="dash-g-row dash-row">
                          <span className="grow dash-g-rt"><b>{r.title}</b>{r.sub && <span className="small muted">{r.sub}</span>}</span>
                          {r.meta && <span className={cx('small nowrap', r.tone === 'bad' ? 'neg strong' : r.tone === 'warn' ? 'dash-g-warn' : 'muted')}>{r.meta}</span>}
                          <LuChevronRight className="dash-go" aria-hidden="true" />
                        </A>
                      </li>
                    ))}
                    {selected.rows.length > ROWS_SHOWN && <li><A to={selected.more} className="dash-more small">{t('dash.att.more', { n: selected.rows.length - ROWS_SHOWN })}</A></li>}
                  </ul>
                ) : (
                  <Quiet tone="ok" icon={<LuCircleCheckBig />} title={t(`dash.p.none.${selected.id}`)}>
                    {selected.id === 'tasks' && <CanWrite><Button size="sm" icon={<LuPlus aria-hidden="true" />} onClick={() => setTaskForm(true)}>{t('dash.act.task')}</Button></CanWrite>}
                  </Quiet>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* 4. the firm's figures, for people who may see reports */}
      {firmTiles.length > 0 && (
        <section aria-labelledby="dash-firm-h" className="dash-firm">
          <div className="dash-firm-h"><h2 id="dash-firm-h">{t('dash.p.firm')}</h2><A to="/reports" className="btn sm ghost"><LuChartColumn aria-hidden="true" />{t('nav.reports')}</A></div>
          <div className="dash-kpis" style={{ '--n': firmTiles.length } as CSSProperties} data-testid="dash-firm">
            {firmTiles.map((id) => {
              const text = MONEY_KPIS.includes(id) ? money(kpi[id]) : String(kpi[id]);
              return (
                <A key={id} to={KPI[id].to} className={cx('kpi', id === 'overdueTasks' && kpi.overdueTasks > 0 && 'attn')} data-testid={`dash-kpi-${id}`}>
                  <div className="k">{t('dash.kpi.' + id)}</div>
                  <div className="dash-kpi-v"><div className={cx('v', text.length >= 10 ? 'xlong' : text.length >= 8 && 'long')}><Swap>{text}</Swap></div></div>
                  {hint[id] && <div className="h dash-kpi-h">{hint[id]}</div>}
                  <LuArrowUpRight className="dash-kpi-go" aria-hidden="true" />
                </A>
              );
            })}
          </div>
        </section>
      )}

      <div className="dash-grid">
        <div className="dash-col">
          {/* 5. what needs attention */}
          <Card className="dash-attn dash-o1" title={<>{t('dash.att.title')}{attentionCount > 0 && <span className="count bad">{attentionCount}</span>}</>}
            actions={byTone.length > 0 && <ul className="dash-tones" aria-label={t('dash.att.byTone')}>{byTone.map((x) => <li key={x.tone}><span className={cx('dot', x.tone)} aria-hidden="true" />{n1('dash.att.tone.' + x.tone, x.n)}</li>)}</ul>}>
            <div data-testid="dash-attention">
              {!groups.length ? <Quiet tone="ok" icon={<LuCircleCheckBig />} title={<><b>{t('dash.att.clear')}</b> {t('dash.p.attClear')}</>} /> : groups.map((g) => (
                <section key={g.kind} className="dash-att" aria-label={t('dash.att.' + g.kind)} data-kind={g.kind}>
                  <h3><span className={cx('dash-att-ico', g.items[0].tone)} aria-hidden="true">{g.icon}</span><span>{t('dash.att.' + g.kind)}{g.items.length > 1 && <span className="dash-att-n">{' '}{g.items.length}</span>}</span></h3>
                  <ul>
                    {g.items.slice(0, 3).map((n) => { const v = noticeLine(n); return (
                      <li key={n.id}>
                        <A to={v.to} className="dash-att-item dash-row">
                          <span className="dash-att-t"><b>{n.title}</b>{v.ctx && <span className="muted dash-att-c"><span aria-hidden="true"> · </span>{v.ctx}</span>}</span>
                          {v.meta && <span className={cx('small nowrap dash-att-m', n.tone === 'bad' ? 'neg' : 'muted')}>{v.meta}</span>}
                          <LuChevronRight className="dash-go" aria-hidden="true" />
                        </A>
                      </li>
                    ); })}
                    {g.items.length > 3 && <li><A to={g.more} className="dash-more small">{t('dash.att.more', { n: g.items.length - 3 })}</A></li>}
                  </ul>
                </section>
              ))}
            </div>
          </Card>

          {/* 7. pipeline, and revenue for people who oversee the firm */}
          {can('leads') && on('leads') && (
            <Card className="dash-pr dash-o4" title={t(months.length ? 'dash.pr.title' : 'dash.pipe.title')} actions={<A to="/leads?view=board" className="btn sm ghost">{t('dash.pipe.board')}</A>}>
              <div className={cx('dash-pr-grid', !months.length && 'one')}>
                <section data-testid="dash-pipeline" aria-label={t('dash.pipe.sub')}>
                  <h3 className="dash-h3">{t('dash.pipe.sub')}</h3>
                  {!openLeads.length ? <Quiet icon={<LuUserPlus />} title={t('dash.pipe.empty')} /> : (
                    <>
                      <ul className="dash-pipe">
                        {stages.map((s) => (
                          <li key={s.stage}>
                            <A to="/leads?view=board" className="dash-pipe-row dash-row" aria-label={t('dash.pipe.row', { stage: t('ls_' + s.stage), n: s.n, value: money(s.value) })}>
                              <span className="dash-pipe-l">{t('ls_' + s.stage)}</span><span className="dash-pipe-n">{s.n}</span>
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
                {months.length > 0 && (
                  <section data-testid="dash-revenue" aria-label={t('dash.rev.title')}>
                    <h3 className="dash-h3">{t('dash.rev.title')}</h3>
                    <ol className="dash-rev" style={{ '--cols': months.length } as CSSProperties}>
                      {months.map((m) => (
                        <li key={m.ym} className={cx(m.current && 'now')} title={`${m.long}: ${money(m.amount)}`}>
                          <span className="dash-rev-plot" aria-hidden="true"><span className="dash-rev-v">{m.amount >= 10000 ? compact.format(m.amount) : money(m.amount)}</span><i style={{ height: `calc((100% - 22px) * ${(m.amount / monthMax).toFixed(4)})` }} /></span>
                          <span className="dash-rev-m" aria-hidden="true">{m.label}{m.current && <small>{t('dash.rev.now')}</small>}</span>
                          <span className="sr">{t('dash.rev.col', { month: m.long, amount: money(m.amount) })}{m.current ? ` (${t('dash.rev.now')})` : ''}</span>
                        </li>
                      ))}
                    </ol>
                    <div className="dash-total small"><span className="muted">{t('dash.rev.total', { n: months.length })}</span><b data-testid="dash-revenue-total">{money(sum(months, (m) => m.amount))}</b></div>
                  </section>
                )}
              </div>
            </Card>
          )}
        </div>

        <div className="dash-col">
          {/* 6. the week's schedule */}
          {(can('calendar') || can('appointments')) && (
            <Card className="dash-op dash-o2" title={t(view === 'firm' ? 'dash.p.weekFirm' : 'dash.p.week')} actions={can('calendar') && <A to="/calendar" className="btn sm ghost"><LuCalendarDays aria-hidden="true" />{t('dash.up.calendar')}</A>}>
              <div data-testid="dash-upcoming">
                {!days.length ? <Quiet icon={<LuCalendarCheck />} title={t('dash.p.weekClear')} /> : days.map((d) => (
                  <div key={d.date} className="dash-day">
                    <h3 className={cx('dash-h3', d.date === td && 'now')}>{dayLabel(d.date)}</h3>
                    <ul className="dash-evs">
                      {d.items.map((e) => (
                        <li key={e.id}>
                          <A to={e.to} className="dash-ev dash-row">
                            <span className={cx('dot', e.tone)} aria-hidden="true" />
                            <span className="grow"><b>{e.title}</b><span className="xs muted dash-ev-s">{e.sub}</span></span>
                            {e.time && <span className="small nowrap dash-ev-t">{time(e.time)}</span>}
                          </A>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {slots.length > shownSlots.length && <A to="/calendar" className="dash-more small">{t('dash.up.more', { n: slots.length - shownSlots.length })}</A>}
              </div>
            </Card>
          )}

          {/* 8a. next steps suggested from the records; the assistant takes it from there */}
          {can('assistant') && assistantOn(data, pack) && recs.length > 0 && (
            <section className="card premium dash-ai dash-o6" data-testid="dash-ai" aria-labelledby="dash-ai-h">
              <div className="dash-ai-h">
                <span className="dash-ai-mark cut" aria-hidden="true"><LuSparkles /></span>
                <div className="grow"><div className="row tight"><h2 id="dash-ai-h">{t('dash.ai.title')}</h2><PlanBadge feature="assistant" /></div><p className="small muted">{t('dash.ai.note')}</p></div>
              </div>
              <ul className="dash-ai-list">
                {recs.slice(0, 3).map((r) => (
                  <li key={r.id}>
                    <A to={r.ask ? '/assistant?q=' + encodeURIComponent(r.ask) : r.to ?? '/assistant'} className="dash-ai-row dash-row" data-testid={`dash-ai-${r.id}`}>
                      <span className="dash-ai-ico" aria-hidden="true">{REC_ICON[r.icon]}</span>
                      <span className="grow"><b>{r.title}</b>{r.detail && <span className="small muted dash-ai-d">{r.detail}</span>}<span className="dash-ai-q">{r.ask ? <><LuSparkles aria-hidden="true" /><span className="sr">{t('cmd.ask')}: </span>{r.ask}</> : r.cta}{' '}<Arrow /></span></span>
                    </A>
                  </li>
                ))}
              </ul>
              <A to="/assistant" className="dash-more small">{t('dash.ai.more')}</A>
            </section>
          )}

          {/* 8b. what the rules handled, then the recent activity */}
          <Card className="dash-o5" title={t('dash.activity.title')} actions={can('automations') && <A to="/automations" className="btn sm ghost"><LuZap aria-hidden="true" />{t('dash.auto.all')}</A>}>
            <div data-testid="dash-activity">
              {runs.length > 0 && (
                <ol className="dash-runs">
                  {runs.map((r) => (
                    <li key={r.id}><A to="/automations" className="dash-run dash-row"><span className="grow"><b>{runRuleName(r.ruleId, rules, shipped, t, lang)}</b><span className="small muted dash-ev-s">{r.steps[0] ? stepText(r.steps[0], t, date) : ''}</span></span><span className="xs dim nowrap">{dateTime(r.at)}</span></A></li>
                  ))}
                </ol>
              )}
              <ActivityList items={activity} limit={5} linkRecords />
            </div>
          </Card>
        </div>
      </div>

      {/* a company that has not set up a client link yet: the way to add one, for people who may configure it */}
      {!links.length && can('config') && can('write') && <div className="dash-linkadd"><p className="small muted">{t('dash.links.none')}</p><QuickLinks /></div>}

      {asking && <ClientRequestModal onClose={() => setAsking(false)} />}
      {taskForm && <TaskDialog defaults={{ assignee: user ? 'u:' + user.id : undefined }} onClose={() => setTaskForm(false)} />}
      {payForm && <ClientPaymentModal onClose={() => setPayForm(false)} />}
    </div>
  );
}
