// One job: header with the status control, then tabs for the team, the money, tasks, documents, the work log and history.
// In the professional-services edition the job is an engagement: no crew and no work log; instead its service and period,
// its appointments and messages, and billing (agreed price, received, balance). The parts for that are in ./engagement.tsx.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  LuPencil, LuTrash2, LuPlus, LuMapPin, LuZap, LuX, LuBanknote, LuFileText, LuFilePlus2, LuChevronRight, LuMail, LuCalendarDays,
} from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, go } from '@/app/router';
import { BackLink } from '@/app/Shell';
import { act } from '@/store/store';
import { Avatar, Badge, Button, Card, Empty, IconButton, MoneyBar, PageHeader, confirmDialog, cx, toast, type Tone } from '@/ui';
import { ActivityList, ContactLinks, DemoTag, DocStatusBadge, JobStatusBadge, NoAccess, NotesPanel, PlanBadge, TaskRow, CanWrite } from '@/app/shared';
import { ClientPaymentModal, PayWorkerModal, TaskFormModal } from '@/app/forms';
import { createDoc, createDocFromTemplate, deleteJob, deleteWorkerPay, removeFromJob } from '@/domain/actions';
import { serviceOf } from '@/domain/actions/catalog';
import type { Engagement } from '@/domain/actions/jobs';
import { canSeeClient } from '@/domain/access';
import { activityFor, actorName, byId, calendarEvents, docsOfJob, insuranceState, isOpenTask, jobMoney, tasksOfJob, workerPaysForJob, type JobMoney } from '@/domain/selectors';
import type { Assignment, AssignStatus, DocKind, Job, JobStatus, WorkerPayment } from '@/domain/types';
import { planName } from '@/lib/pricing';
import { today } from '@/lib/dates';
import { money, money2, pct, sum } from '@/lib/money';
import { changeStatus, payLine, plain, repeats, shortDate, tabLabel, tabsFor, type AutoLine, type JobTab } from './parts';
import { AssignmentForm, ExpenseForm, JobForm, LogForm } from './forms';
import { Appointments, BillingSummary, EngagementFacts, EngagementLine, Messages, PlaybookCard } from './engagement';

const DOC_KINDS: DocKind[] = ['estimate', 'contract', 'invoice'];
const ASSIGN_TONE: Record<AssignStatus, Tone> = { pending: 'neutral', progress: 'info', done: 'ok' };
/** History entries that state an amount; left out for roles that do not see money. */
const MONEY_ACTIVITY = ['payment.received', 'worker.paid', 'expense.added', 'invoice.paid'];

export function JobDetail({ id, sub }: { id: string; sub?: string }) {
  const { t, data, pack, can, user, perms } = useApp();
  const job = byId(data.jobs, id) as Engagement | undefined;
  const [edit, setEdit] = useState(false);
  const [auto, setAuto] = useState<AutoLine[] | null>(null);
  /** Set once the status is changed on this page, so the badge settles when it changes and not when the page opens. */
  const [touched, setTouched] = useState(false);
  if (!job) return <Card className="work-none"><Empty title={t('jobs.notFound')} action={<A to="/jobs" className="btn" data-testid="jobs-back">{t('back')}</A>} /></Card>;

  const showMoney = can('money');
  const office = pack.family === 'practice';
  // an edition without field workers has no team tab on a job: nobody is assigned and paid per job there
  const tabs = tabsFor({ pack, can, data });
  const tab: JobTab = tabs.includes(sub as JobTab) ? (sub as JobTab) : 'overview';
  const client = byId(data.clients, job.clientId);
  // work for a client of another office is not shown to someone who may not open that client
  if (client && !canSeeClient(data, user, perms, client)) return <><BackLink to="/jobs">{t('back')}</BackLink><NoAccess /></>;
  const openTasks = tasksOfJob(data, job.id).filter(isOpenTask).length;
  const openTab = (x: JobTab) => go(x === 'overview' ? `/jobs/${job.id}` : `/jobs/${job.id}/${x}`);
  const setStatus = (to: JobStatus) => { setTouched(true); const lines = changeStatus(t, job, to); setAuto(lines.length ? lines : null); };
  const remove = async () => {
    if (await confirmDialog(t('jobs.deleteConfirm', { name: job.name }), t('deleteProject'), t('common.cancel'))) { act(deleteJob, job.id); toast(t('common.deleted')); go('/jobs'); }
  };

  return (
    <>
      <BackLink to="/jobs">{t('back')}</BackLink>
      <PageHeader
        title={<>{job.name} <span key={job.status} className={cx('jobs-status', touched && 'jobs-settle')}><JobStatusBadge status={job.status} /></span></>}
        sub={<>{[job.number, t('ty_' + job.type), office ? job.period : ''].filter(Boolean).join(' · ')}{client && <> · <A to={`/clients/${client.id}`} className="jobs-client" data-testid="jobs-client-link">{client.name}</A></>}</>}
        actions={<>
          {/* someone who can only look sees the status as the badge beside the name, not as a control that would refuse */}
          <CanWrite><label className="jobs-statusctl"><span className="xs muted">{t('common.status')}</span>
            <select value={job.status} onChange={(e) => setStatus(e.target.value as JobStatus)} data-testid="jobs-status">
              {pack.jobStatuses.map((s) => <option key={s} value={s}>{t('st_' + s)}</option>)}
            </select>
          </label></CanWrite>
          <CanWrite><Button icon={<LuPencil aria-hidden="true" />} onClick={() => setEdit(true)} data-testid="jobs-edit">{t('common.edit')}</Button></CanWrite>
          {can('delete') && <CanWrite><IconButton label={t('deleteProject')} onClick={remove} data-testid="jobs-delete"><LuTrash2 /></IconButton></CanWrite>}
        </>} />
      {office ? <EngagementLine job={job} phone={client?.phone} /> : (
        <div className="jobs-where">
          <span className="jobs-addr"><LuMapPin aria-hidden="true" />{job.address || <span className="dim">{t('jobs.noAddress')}</span>}</span>
          <ContactLinks phone={client?.phone} address={job.address} />
        </div>
      )}

      {auto && <AutoNote lines={auto} jobId={job.id} onClose={() => setAuto(null)} />}

      <JobTabs label={t('jobs.tabs')} current={tab}>
        {tabs.map((x) => (
          <button key={x} type="button" role="tab" aria-selected={x === tab} onClick={() => openTab(x)} data-testid={`jobs-tab-${x}`}>
            {tabLabel(t, pack, x)}{x === 'tasks' && openTasks > 0 && <span className="count">{openTasks}</span>}
          </button>
        ))}
      </JobTabs>

      <div className="jobs-tab" data-tab={tab}>
      {tab === 'overview' && <Overview job={job} onTab={openTab} />}
      {tab === 'team' && <Team job={job} />}
      {tab === 'money' && <Money job={job} />}
      {tab === 'tasks' && <Tasks job={job} />}
      {tab === 'documents' && <Documents job={job} />}
      {tab === 'appointments' && <Appointments job={job} />}
      {tab === 'messages' && <Messages job={job} />}
      {tab === 'log' && <LogAndNotes job={job} />}
      {tab === 'activity' && (
        <Card title={t('common.activity')}>
          <ActivityList items={activityFor(data, { type: 'job', id: job.id }).filter((a) => showMoney || !MONEY_ACTIVITY.includes(a.kind))} limit={25} />
        </Card>
      )}
      </div>

      {edit && <JobForm job={job} onClose={() => setEdit(false)} onSaved={(lines) => setAuto(lines.length ? lines : null)} />}
    </>
  );
}

/** The tab strip with one underline that slides to the open tab. On narrow screens the open tab is brought into view and a fade shows there is more to the right. */
function JobTabs({ label, current, children }: { label: string; current: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [line, setLine] = useState<{ x: number; w: number } | null>(null);
  const [more, setMore] = useState(false);
  const measure = () => {
    const el = ref.current; if (!el) return;
    const on = el.querySelector<HTMLElement>('[aria-selected="true"]');
    if (on) setLine((l) => (l && l.x === on.offsetLeft && l.w === on.offsetWidth ? l : { x: on.offsetLeft, w: on.offsetWidth }));
    setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
  };
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const on = el.querySelector<HTMLElement>('[aria-selected="true"]');
    // keep the open tab visible in the strip without moving the page
    if (on && (on.offsetLeft < el.scrollLeft || on.offsetLeft + on.offsetWidth > el.scrollLeft + el.clientWidth)) el.scrollLeft = Math.max(0, on.offsetLeft - 24);
  }, [current]);
  // cheap, and it keeps the underline right when a count appears on a tab or the wording changes
  useLayoutEffect(measure);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    // widths change when the web font arrives or the language changes
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (ro) for (const b of Array.from(el.children)) ro.observe(b);
    return () => { el.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); ro?.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);
  return (
    <div className={cx('jobs-tabwrap', more && 'more')}>
      <div className={cx('tabs jobs-tabs', line && 'ready')} role="tablist" aria-label={label} ref={ref}>
        {children}
        {line && <span className="jobs-tabline" aria-hidden="true" style={{ transform: `translateX(${line.x}px) scaleX(${line.w})` }} />}
      </div>
    </div>
  );
}

/** What the automations did after a status change, with links to where each result lives. */
function AutoNote({ lines, jobId, onClose }: { lines: AutoLine[]; jobId: string; onClose: () => void }) {
  const { t, lang, standing } = useApp();
  const emails = standing('clientEmails'); const portal = standing('workerPortal');
  const upgrade = (s: typeof emails) => (s.state === 'upgrade' && s.plan ? ' ' + t('ent.upgradeHint', { plan: planName(s.plan, lang) }) : '');
  return (
    <div className="note jobs-auto" data-testid="jobs-auto">
      <div className="jobs-auto-h">
        <b><LuZap aria-hidden="true" />{t('jobs.auto.title')}</b>
        <IconButton size="sm" label={t('common.close')} onClick={onClose}><LuX /></IconButton>
      </div>
      <ul>
        {lines.map((l, i) => (
          <li key={i}>
            <span>{l.text}</span>
            {l.kind === 'invoice' && <A to={`/jobs/${jobId}/documents`} className="linkbtn small">{t('jobs.auto.seeDocs')}</A>}
            {l.kind === 'tasks' && <A to={`/jobs/${jobId}/tasks`} className="linkbtn small">{t('jobs.auto.seeTasks')}</A>}
            {l.kind === 'next' && l.to && <A to={l.to} className="linkbtn small" data-testid="jobs-auto-next">{t('jobs.auto.seeNext')}</A>}
            {l.kind === 'email' && <><A to="/messages" className="linkbtn small">{t('jobs.auto.seeMessages')}</A><DemoTag /><PlanBadge feature="clientEmails" detail /></>}
            {l.kind === 'workers' && <PlanBadge feature="workerPortal" detail />}
            {l.kind === 'email' && <div className="xs muted jobs-auto-sub">{t('jobs.auto.emailNote')}{upgrade(emails)}</div>}
            {l.kind === 'workers' && portal.state === 'upgrade' && <div className="xs muted jobs-auto-sub">{upgrade(portal).trim()}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- overview ---------- */
function Fig({ label, value, hint, tone, swatch }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'pos' | 'neg' | 'warn'; swatch?: 's1' | 's2' | 's3' | 's4' }) {
  // the hint line is always there so the figures of a pair stay on the same baseline
  return <div className="jobs-fig"><div className="k">{swatch && <i className={'jobs-k ' + swatch} aria-hidden="true" />}{label}</div><div className={cx('v', tone)}>{value}</div><div className="h">{hint}</div></div>;
}
function Line({ label, value, swatch }: { label: ReactNode; value: ReactNode; swatch?: 's1' | 's2' }) {
  return <div><dt>{swatch && <i className={'jobs-k ' + swatch} aria-hidden="true" />}{label}</dt><dd>{value}</dd></div>;
}

/** Price, profit, received and balance first; what they are made of underneath. */
function MoneySummary({ m }: { m: JobMoney }) {
  const { t, can, pack } = useApp();
  const showProfit = can('profit');
  const crew = pack.usesWorkers;
  const parts = [
    ...(crew ? [{ value: m.labor, cls: 's1' as const, label: t('subLabor') }] : []), { value: m.expenses, cls: 's2' as const, label: t('materials') },
    ...(showProfit ? [{ value: m.profit, cls: 's3' as const, label: t('profit') }] : []),
  ];
  const collected = m.price > 0 ? Math.min(1, Math.max(0, m.received / m.price)) : 0;
  return (
    <Card title={t('jobs.ov.money')} className="jobs-money raised">
      <div className="jobs-mgrid">
        <div className="jobs-mhalf">
          <div className="jobs-figs">
            <Fig label={t('contract')} value={money(m.price)} />
            {showProfit && <Fig label={t('jobs.ov.profit')} swatch="s3" value={money(m.profit)} tone={m.profit < 0 ? 'neg' : 'pos'} hint={m.price > 0 ? t('jobs.ov.margin', { pct: pct(m.margin) }) : undefined} />}
          </div>
          <MoneyBar total={m.price} parts={parts} label={`${t('jobs.ov.split')}: ${parts.map((p) => `${p.label} ${money(p.value)}`).join(', ')}`} />
          <dl className="jobs-lines">
            {crew && <Line swatch="s1" label={t('subLabor')} value={money(m.labor)} />}
            <Line swatch="s2" label={t('materials')} value={money(m.expenses)} />
          </dl>
        </div>
        <div className="jobs-mhalf">
          <div className="jobs-figs">
            <Fig label={t('jobs.m.received')} swatch="s4" value={money(m.received)} hint={m.price > 0 ? t('jobs.ov.collected', { pct: pct(collected) }) : undefined} />
            <Fig label={t('jobs.m.clientOwes')} value={money(Math.max(0, m.clientOwes))} tone={m.clientOwes > 0.005 ? 'warn' : undefined} hint={m.price > 0 && m.clientOwes <= 0.005 ? t('jobs.paid') : undefined} />
          </div>
          <MoneyBar total={m.price} parts={[{ value: m.received, cls: 's4', label: t('jobs.m.received') }]} label={`${t('jobs.m.received')}: ${money(m.received)} / ${money(m.price)}`} />
          {crew && <dl className="jobs-lines">
            <Line label={t('paidSubs')} value={money(m.paidWorkers)} />
            <Line label={t('jobs.m.oweWorkers')} value={money(Math.max(0, m.oweWorkers))} />
          </dl>}
        </div>
      </div>
    </Card>
  );
}

function Overview({ job, onTab }: { job: Engagement; onTab: (x: JobTab) => void }) {
  const { t, data, can, date, day, pack } = useApp();
  const showMoney = can('money');
  const office = pack.family === 'practice';
  const client = byId(data.clients, job.clientId);
  const manager = byId(data.users, job.managerId);
  const lead = byId(data.leads, job.leadId);
  const open = tasksOfJob(data, job.id).filter(isOpenTask).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  // an engagement is one period; its next period is its own record, linked in the details, so there are no visit dates to list
  const visits = repeats(job) && !office ? calendarEvents(data, 70).filter((e) => e.kind === 'visit' && e.ref.type === 'job' && e.ref.id === job.id && e.date >= today()).slice(0, 4) : [];
  const unset = <span className="dim">{t('jobs.notSet')}</span>;
  const tasksCard = (
    <Card title={t('jobs.ov.openTasks')} className={showMoney ? undefined : 'raised'} actions={<button type="button" className="linkbtn small" onClick={() => onTab('tasks')}>{t('jobs.ov.allTasks')}</button>}>
      {open.length ? <div className="list">{open.slice(0, 4).map((x) => <TaskRow key={x.id} task={x} />)}</div> : <p className="muted small">{t('jobs.ov.noOpenTasks')}</p>}
    </Card>
  );
  return (
    <div className="split">
      <div className="stack">
        {showMoney && <MoneySummary m={jobMoney(data, job)} />}
        <Card title={plain(t('scope'))}>{job.scope ? <p className="jobs-prose">{job.scope}</p> : <p className="muted small">{t(office ? 'jobs.ov.noScopeOffice' : 'jobs.ov.noScope')}</p>}</Card>
        {showMoney && <Card title={plain(t('payTerms'))}>{job.payTerms ? <p className="jobs-prose">{job.payTerms}</p> : <p className="muted small">{t('jobs.ov.noTerms')}</p>}</Card>}
        {!showMoney && tasksCard}
      </div>
      <div className="stack">
        <Card title={t('common.details')}>
          <dl className="kv">
            {(office || job.serviceId) && <EngagementFacts job={job} />}
            <dt>{t('type')}</dt><dd>{t('ty_' + job.type)}</dd>
            <dt>{plain(t('start'))}</dt><dd>{job.start ? date(job.start) : unset}</dd>
            <dt>{plain(t('end'))}</dt><dd>{job.end ? date(job.end) : unset}</dd>
            <dt>{t('jobs.repeat')}</dt><dd>{t('jobs.rp.' + (job.repeat || 'once'))}</dd>
            <dt>{t('jobs.manager')}</dt><dd>{manager ? manager.name : <span className="dim">{t('common.unassigned')}</span>}</dd>
            <dt>{t('common.created')}</dt><dd>{job.created ? date(job.created) : unset}</dd>
            {lead && <><dt>{t('jobs.ov.fromLead')}</dt><dd><A to={`/leads/${lead.id}`}>{lead.ticket}</A></dd></>}
          </dl>
          {visits.length > 0 && (
            <div className="jobs-visits">
              <div className="xs dim">{t('jobs.ov.nextVisits')}</div>
              <div className="row tight">{visits.map((v) => <Badge key={v.id} tone="info"><LuCalendarDays aria-hidden="true" />{day(v.date)}</Badge>)}</div>
              <A to="/calendar" className="linkbtn small">{t('jobs.ov.calendar')}</A>
            </div>
          )}
        </Card>
        {client && (
          <Card title={t('client')} actions={<A to={`/clients/${client.id}`} className="btn sm">{t('common.open')}<LuChevronRight aria-hidden="true" /></A>}>
            <dl className="kv">
              <dt>{t('common.name')}</dt><dd>{client.name}{client.company ? ` · ${client.company}` : ''}</dd>
              <dt>{t('common.phone')}</dt><dd>{client.phone || unset}</dd>
              <dt>{t('common.email')}</dt><dd>{client.email ? <a href={`mailto:${client.email}`}><LuMail aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 4 }} />{client.email}</a> : unset}</dd>
            </dl>
          </Card>
        )}
        {job.serviceId && <PlaybookCard job={job} onTab={onTab} />}
        {showMoney && tasksCard}
      </div>
    </div>
  );
}

/* ---------- team: who does which part and how it is paid ---------- */
function Team({ job }: { job: Job }) {
  const { t, data, pack, can } = useApp();
  const showMoney = can('money');
  const [form, setForm] = useState<Assignment | 'new' | null>(null);
  const [pay, setPay] = useState<string | null>(null);
  const m = jobMoney(data, job);
  // payments are recorded per person, so they fill that person's assignments in order
  const pool: Record<string, number> = {};
  for (const p of workerPaysForJob(data, job.id)) pool[p.workerId] = (pool[p.workerId] || 0) + p.amount;
  const last: Record<string, number> = {}; job.assign.forEach((a, i) => { last[a.workerId] = i; });
  const rows = job.assign.map((a, i) => {
    const left = pool[a.workerId] || 0; const paid = last[a.workerId] === i ? left : Math.min(left, a.price);
    pool[a.workerId] = left - paid;
    return { a, paid, owed: a.price - paid };
  });
  const others = m.paidWorkers - sum(rows, (r) => r.paid);
  const remove = async (a: Assignment, name: string) => {
    if (await confirmDialog(t('jobs.team.removeConfirm', { name }), t('jobs.team.remove'), t('common.cancel'))) { act(removeFromJob, job.id, 'assign', a.id); toast(t('jobs.team.removed')); }
  };
  const add = showMoney ? <CanWrite><Button size="sm" variant="primary" icon={<LuPlus aria-hidden="true" />} onClick={() => setForm('new')} data-testid="jobs-add-assignment">{t('addAssign')}</Button></CanWrite> : null;

  return (
    <>
      <Card flush className="work-none" title={t('secAssign')} actions={add}>
        {!rows.length ? (
          <Empty title={t('jobs.team.empty')}>{showMoney ? t('jobs.team.emptyHint') : null}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="tbl stackable jobs-stack jobs-team" data-testid="jobs-team-table">
              <thead>
                <tr>
                  <th>{t('sub')}</th><th>{t('part')}</th>
                  {showMoney && <><th className="jobs-c-pay">{t('jobs.team.col.pay')}</th><th className="num">{t('jobs.as.total')}</th><th className="num">{t('jobs.team.col.paid')}</th><th className="num">{t('jobs.team.col.owed')}</th></>}
                  <th>{t('common.status')}</th>{showMoney && <th className="jobs-acts"><span className="sr">{t('common.actions')}</span></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ a, paid, owed }) => {
                  const w = byId(data.workers, a.workerId);
                  const name = w?.name ?? t('jobs.team.gone');
                  const flags = w && pack.compliance && can('compliance');
                  return (
                    <tr key={a.id} data-assign={a.id}>
                      <td className="t1">
                        {w && can('team') ? <A to={`/team/${w.id}`} className="jobs-name">{name}</A> : <span className={cx(!w && 'dim')}>{name}</span>}
                        {w && <div className="xs dim jobs-under">{w.trade}</div>}
                        {flags && (!w.w9 || insuranceState(w) === 'expired') && (
                          <div className="row tight jobs-flags">{!w.w9 && <Badge tone="bad">{t('missingW9')}</Badge>}{insuranceState(w) === 'expired' && <Badge tone="bad">{t('coiExpired')}</Badge>}</div>
                        )}
                      </td>
                      <td data-label={t('part')}>{a.scope}</td>
                      {showMoney && <>
                        <td data-label={t('jobs.team.col.pay')} className="small nowrap jobs-c-pay">{payLine(t, a)}</td>
                        <td data-label={t('jobs.as.total')} className="num">{money2(a.price)}</td>
                        <td data-label={t('jobs.team.col.paid')} className="num">{money2(paid)}</td>
                        <td data-label={t('jobs.team.col.owed')} className={cx('num strong', owed < -0.005 && 'neg')}>{money2(owed)}</td>
                      </>}
                      <td data-label={t('common.status')}><Badge tone={ASSIGN_TONE[a.status] ?? 'neutral'}>{t('a_' + a.status)}</Badge></td>
                      {showMoney && (
                        <td className="jobs-acts">
                          <span className="row tight nowrap">
                            {w && <CanWrite><Button size="sm" icon={<LuBanknote aria-hidden="true" />} onClick={() => setPay(w.id)} aria-label={t('jobs.team.payName', { name })} data-testid="jobs-pay-worker">{t('pay')}</Button></CanWrite>}
                            <CanWrite><IconButton size="sm" label={`${t('jobs.team.edit')}: ${name}`} onClick={() => setForm(a)} data-testid="jobs-edit-assignment"><LuPencil /></IconButton></CanWrite>
                            <CanWrite><IconButton size="sm" label={`${t('jobs.team.remove')}: ${name}`} onClick={() => remove(a, name)} data-testid="jobs-remove-assignment"><LuTrash2 /></IconButton></CanWrite>
                          </span>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              {showMoney && (
                <tfoot>
                  <tr>
                    <td className="t1" colSpan={2}>{t('common.total')}</td><td className="jobs-c-pay" />
                    <td data-label={t('jobs.as.total')} className="num">{money2(m.labor)}</td>
                    <td data-label={t('jobs.team.col.paid')} className="num">{money2(m.paidWorkers)}</td>
                    <td data-label={t('jobs.team.col.owed')} className="num">{money2(m.oweWorkers)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
        {showMoney && others > 0.005 && <p className="xs muted jobs-foot">{t('jobs.team.others', { amount: money2(others) })}</p>}
      </Card>
      {form && <AssignmentForm job={job} assignment={form === 'new' ? undefined : form} onClose={() => setForm(null)} />}
      {pay && <PayWorkerModal workerId={pay} jobId={job.id} onClose={() => setPay(null)} />}
    </>
  );
}

/* ---------- money: what came in, what was spent, what went to the team ---------- */
function Money({ job }: { job: Engagement }) {
  const { t, data, lang, date , pack } = useApp();
  const [recv, setRecv] = useState(false);
  const [exp, setExp] = useState(false);
  const [pay, setPay] = useState(false);
  const m = jobMoney(data, job);
  const byDate = <T extends { date: string }>(list: T[]) => [...list].sort((a, b) => b.date.localeCompare(a.date));
  const pays = byDate(workerPaysForJob(data, job.id));
  const ask = async (msg: string, run: () => void) => { if (await confirmDialog(msg, t('common.delete'), t('common.cancel'))) { run(); toast(t('jobs.money.removed')); } };
  const period = (p: WorkerPayment) => {
    if (!p.payType || p.payType === 'project') return '';
    const type = t('jobs.pt.' + p.payType);
    if (!p.from) return type;
    return p.to && p.to !== p.from ? t('jobs.money.period', { type, from: shortDate(p.from, lang), to: shortDate(p.to, lang) }) : `${type}, ${shortDate(p.from, lang)}`;
  };
  const x = (label: string, onClick: () => void, testId: string) => <CanWrite><IconButton size="sm" label={label} onClick={onClick} data-testid={testId}><LuTrash2 /></IconButton></CanWrite>;

  return (
    <div className="stack">
      {pack.family === 'practice' && <BillingSummary job={job} m={m} />}
      <div className="grid2 jobs-pair">
        <Card flush title={t('secRecv')} className={m.clientOwes > 0.005 ? 'raised' : undefined} actions={m.clientOwes > 0.005
          ? <CanWrite><Button size="sm" variant="primary" icon={<LuPlus aria-hidden="true" />} onClick={() => setRecv(true)} data-testid="jobs-record-payment">{t('form.pay.record')}</Button></CanWrite>
          : m.price > 0 ? <Badge tone="ok">{t('jobs.paid')}</Badge> : null}>
          {job.received.length ? (
            <div className="table-wrap">
              <table className="tbl stackable" data-testid="jobs-received">
                <thead><tr><th>{t('common.date')}</th><th>{t('common.method')}</th><th className="num">{t('common.amount')}</th><th className="jobs-acts"><span className="sr">{t('common.actions')}</span></th></tr></thead>
                <tbody>
                  {byDate(job.received).map((r) => (
                    <tr key={r.id}>
                      <td className="t1 nowrap">{date(r.date)}</td>
                      <td data-label={t('common.method')}>{t('m_' + r.method)}{r.ref ? ` · ${r.ref}` : ''}</td>
                      <td data-label={t('common.amount')} className="num strong">{money2(r.amount)}</td>
                      <td className="jobs-acts">{x(`${t('common.delete')}: ${money2(r.amount)}`, () => ask(t('jobs.money.removeRecv', { amount: money2(r.amount) }), () => act(removeFromJob, job.id, 'received', r.id)), 'jobs-remove-payment')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted small jobs-none">{t('jobs.money.noRecv')}</p>}
          <div className="jobs-sumrow"><span className="muted">{t('jobs.col.received')}</span><b>{money2(m.received)}</b></div>
          <div className="jobs-sumrow"><span className="muted">{t('jobs.m.clientOwes')}</span><b className={cx(m.clientOwes > 0.005 && 'jobs-warn')} data-testid="jobs-balance">{money2(Math.max(0, m.clientOwes))}</b></div>
        </Card>

        <Card flush title={t('secPurch')} actions={<CanWrite><Button size="sm" icon={<LuPlus aria-hidden="true" />} onClick={() => setExp(true)} data-testid="jobs-add-expense">{t('addPurch')}</Button></CanWrite>}>
          {job.expenses.length ? (
            <div className="table-wrap">
              <table className="tbl stackable" data-testid="jobs-expenses">
                <thead><tr><th>{t('desc')}</th><th>{t('common.date')}</th><th className="num">{t('common.amount')}</th><th className="jobs-acts"><span className="sr">{t('common.actions')}</span></th></tr></thead>
                <tbody>
                  {byDate(job.expenses).map((e) => (
                    <tr key={e.id}>
                      <td className="t1">{e.desc}{e.vendor && <div className="xs dim jobs-under">{e.vendor}</div>}</td>
                      <td data-label={t('common.date')} className="nowrap">{date(e.date)}</td>
                      <td data-label={t('common.amount')} className="num strong">{money2(e.amount)}</td>
                      <td className="jobs-acts">{x(`${t('common.delete')}: ${e.desc}`, () => ask(t('jobs.money.removeExp', { amount: money2(e.amount) }), () => act(removeFromJob, job.id, 'expenses', e.id)), 'jobs-remove-expense')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted small jobs-none">{t('jobs.money.noExp')}</p>}
          <div className="jobs-sumrow"><span className="muted">{t('common.total')}</span><b data-testid="jobs-expenses-total">{money2(m.expenses)}</b></div>
        </Card>
      </div>

      {pack.usesWorkers && <Card flush title={t('secSubPay')} actions={<CanWrite><Button size="sm" icon={<LuBanknote aria-hidden="true" />} onClick={() => setPay(true)} data-testid="jobs-pay-any">{t('paySub')}</Button></CanWrite>}>
        {pays.length ? (
          <div className="table-wrap">
            <table className="tbl stackable" data-testid="jobs-worker-pays">
              <thead><tr><th>{t('jobs.money.who')}</th><th>{t('common.date')}</th><th>{t('common.method')}</th><th className="num">{t('common.amount')}</th><th className="jobs-acts"><span className="sr">{t('common.actions')}</span></th></tr></thead>
              <tbody>
                {pays.map((p) => {
                  const name = byId(data.workers, p.workerId)?.name ?? t('jobs.team.gone');
                  return (
                    <tr key={p.id}>
                      <td className="t1">{name}{period(p) && <div className="xs dim jobs-under">{period(p)}</div>}</td>
                      <td data-label={t('common.date')} className="nowrap">{date(p.date)}</td>
                      <td data-label={t('common.method')}>{t('m_' + p.method)}{p.ref ? ` · ${p.ref}` : ''}</td>
                      <td data-label={t('common.amount')} className="num strong">{money2(p.amount)}</td>
                      <td className="jobs-acts">{x(`${t('common.delete')}: ${name}, ${money2(p.amount)}`, () => ask(t('jobs.money.removePay', { amount: money2(p.amount), name }), () => act(deleteWorkerPay, p.id)), 'jobs-remove-workerpay')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="muted small jobs-none">{t('jobs.money.noPays')}</p>}
        <div className="jobs-sumrow"><span className="muted">{t('paidSubs')}</span><b>{money2(m.paidWorkers)}</b></div>
        <div className="jobs-sumrow"><span className="muted">{t('jobs.m.oweWorkers')}</span><b>{money2(Math.max(0, m.oweWorkers))}</b></div>
      </Card>}

      {recv && <ClientPaymentModal jobId={job.id} onClose={() => setRecv(false)} />}
      {exp && <ExpenseForm job={job} onClose={() => setExp(false)} />}
      {pay && <PayWorkerModal jobId={job.id} workerId={job.assign[0]?.workerId} onClose={() => setPay(false)} />}
    </div>
  );
}

/* ---------- tasks ---------- */
function Tasks({ job }: { job: Job }) {
  const { t, data } = useApp();
  const [add, setAdd] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const all = tasksOfJob(data, job.id);
  const open = all.filter(isOpenTask).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const done = all.filter((x) => !isOpenTask(x)).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
  const addBtn = <CanWrite><Button size="sm" variant="primary" icon={<LuPlus aria-hidden="true" />} onClick={() => setAdd(true)} data-testid="jobs-add-task">{t('jobs.tasks.add')}</Button></CanWrite>;
  const current = byId(data.tasks, editing ?? undefined);
  return (
    <div className="stack">
      {job.serviceId && <PlaybookCard job={job} bar />}
      <Card className="work-none" title={<>{t('jobs.tasks.open')} <span className="count">{open.length}</span></>} actions={addBtn}>
        {open.length ? <div className="list" data-testid="jobs-tasks-open">{open.map((x) => <TaskRow key={x.id} task={x} onEdit={() => setEditing(x.id)} />)}</div>
          : all.length ? <p className="muted small">{t('jobs.tasks.noneOpen')}</p>
          : <Empty title={t('jobs.tasks.none')}>{t('jobs.tasks.noneHint')}</Empty>}
      </Card>
      {done.length > 0 && (
        <Card title={<>{t('jobs.tasks.done')} <span className="count">{done.length}</span></>}>
          <div className="list" data-testid="jobs-tasks-done">{done.map((x) => <TaskRow key={x.id} task={x} onEdit={() => setEditing(x.id)} />)}</div>
        </Card>
      )}
      {add && <TaskFormModal defaults={{ jobId: job.id, clientId: job.clientId, assignee: 'u:' + job.managerId }} onClose={() => setAdd(false)} />}
      {current && <TaskFormModal task={current} onClose={() => setEditing(null)} />}
    </div>
  );
}

/* ---------- documents: listed here, shown and edited in the Documents module ---------- */
function Documents({ job }: { job: Job }) {
  const { t, data, date } = useApp();
  const docs = docsOfJob(data, job.id);
  const live = (k: DocKind) => docs.find((d) => d.kind === k && d.status !== 'void');
  // the documents the service lists are written from the company's templates; the three every job has are written from the job
  const listed = (serviceOf(data, job.serviceId)?.docKinds ?? []).filter((k) => !DOC_KINDS.includes(k));
  // the agreement written from the job and the engagement letter written from a template are the same paper under two
  // names: whichever the job already has is the one offered, and a job with neither gets the one its service lists
  const letter = listed.includes('engagement_letter') && !live('contract');
  const kinds: DocKind[] = [...DOC_KINDS.filter((k) => k !== 'contract' || !letter), ...listed.filter((k) => k !== 'engagement_letter' || letter)];
  const make = (k: DocKind) => {
    const made = live(k) ?? (listed.includes(k) ? act(createDocFromTemplate, { kind: k, clientId: job.clientId, jobId: job.id, leadId: job.leadId }) : act(createDoc, job.id, k));
    if (made) go(`/documents/${made.id}`); else toast(t('jobs.docs.noTemplate', { doc: t('doc.kind.' + k).toLowerCase() }), true);
  };
  return (
    <div className="split">
      <Card flush className="work-none" title={t('jobs.tab.documents')}>
        {docs.length ? (
          <div className="jobs-docs" data-testid="jobs-docs">
            {docs.map((d) => (
              <A key={d.id} to={`/documents/${d.id}`} className="jobs-doc" data-testid="jobs-doc">
                <LuFileText aria-hidden="true" />
                <span className="grow"><span className="strong">{t('doc.kind.' + d.kind)}</span> <span className="muted">{d.number}</span><span className="xs dim jobs-under">{t('jobs.docs.updated', { date: date(d.updated) })}</span></span>
                <span className="row tight"><DocStatusBadge status={d.status} />{d.esign && <DemoTag />}</span>
                <LuChevronRight aria-hidden="true" />
              </A>
            ))}
          </div>
        ) : <Empty title={t('jobs.docs.none')}>{t('jobs.docs.hint')}</Empty>}
      </Card>
      <Card title={t('jobs.docs.make')}>
        <div className="stack tight">
          {kinds.map((k) => (
            <CanWrite key={k}><Button block icon={live(k) ? <LuFileText aria-hidden="true" /> : <LuFilePlus2 aria-hidden="true" />} onClick={() => make(k)} data-testid={`jobs-create-${k}`}>
              {t(live(k) ? 'jobs.docs.open' : 'jobs.docs.create', { doc: t('doc.kind.' + k).toLowerCase() })}
            </Button></CanWrite>
          ))}
        </div>
        <p className="xs muted" style={{ marginTop: 12 }}>{t('jobs.docs.hint')}</p>
      </Card>
    </div>
  );
}

/* ---------- work log and notes ---------- */
function LogAndNotes({ job }: { job: Job }) {
  const { t, data, lang, can, standing, pack } = useApp();
  const [add, setAdd] = useState(false);
  const log = [...job.log].sort((a, b) => b.date.localeCompare(a.date));
  const portal = standing('workerPortal');
  const remove = async (logId: string) => { if (await confirmDialog(t('common.confirmDelete'), t('common.delete'), t('common.cancel'))) act(removeFromJob, job.id, 'log', logId); };
  // the work log is what field workers write from their portal; without field workers this tab is the notes
  if (!pack.usesWorkers) return <NotesPanel target={{ type: 'job', id: job.id }} notes={job.notes} />;
  return (
    <div className="grid2">
      <Card title={t('secLog')} actions={<CanWrite><Button size="sm" variant="primary" icon={<LuPlus aria-hidden="true" />} onClick={() => setAdd(true)} data-testid="jobs-add-log">{t('jobs.log.add')}</Button></CanWrite>}>
        {log.length ? (
          <div className="list" data-testid="jobs-log">
            {log.map((l) => {
              const name = actorName(data, l.workerId) ?? t('jobs.team.gone');
              return (
                <div className="item jobs-logrow" key={l.id}>
                  <Avatar name={name} size="sm" />
                  <div className="grow"><div className="jobs-prose">{l.text}</div><div className="xs dim">{name} · {shortDate(l.date, lang)}</div></div>
                  {can('delete') && <CanWrite><IconButton size="sm" label={t('common.delete')} onClick={() => remove(l.id)} data-testid="jobs-remove-log"><LuTrash2 /></IconButton></CanWrite>}
                </div>
              );
            })}
          </div>
        ) : <p className="muted small">{t('jobs.log.none')}</p>}
        <p className="xs muted jobs-portal">
          <span>{t('jobs.log.portalHint')}{portal.state === 'upgrade' && portal.plan ? ' ' + t('ent.upgradeHint', { plan: planName(portal.plan, lang) }) : ''}</span>
          <PlanBadge feature="workerPortal" detail />
        </p>
      </Card>
      <NotesPanel target={{ type: 'job', id: job.id }} notes={job.notes} />
      {add && <LogForm job={job} onClose={() => setAdd(false)} />}
    </div>
  );
}
