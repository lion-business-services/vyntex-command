// What a job shows when it is an engagement (the professional-services edition), and what any job shows once it is tied
// to a catalog service: the service and its period, the playbook, billing, and the appointments and messages linked to it.
// Every list here is read from the records themselves; nothing is counted or summed anywhere else.
import { LuBookOpen, LuBuilding2, LuCalendarPlus, LuChevronRight, LuListChecks, LuMail, LuMessageSquare, LuPhone, LuPlay, LuRepeat } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, go } from '@/app/router';
import { act } from '@/store/store';
import { Badge, Button, Card, Empty, MoneyBar, Stat, toast, type Tone } from '@/ui';
import { CanWrite, ContactLinks, DemoTag } from '@/app/shared';
import { startPlaybook } from '@/domain/actions';
import { playbookOf, playbookTasks, serviceName, serviceOf } from '@/domain/actions/catalog';
import type { Engagement } from '@/domain/actions/jobs';
import { moduleOn } from '@/domain/config';
import { byId, type JobMoney } from '@/domain/selectors';
import type { ApptStatus, Message } from '@/domain/types';
import { money2 } from '@/lib/money';
import { priceLine, repeats, type JobTab } from './parts';

/** The line under the title of an engagement: its service and tier, how it repeats, its office, and a way to call the client. */
export function EngagementLine({ job, phone }: { job: Engagement; phone?: string }) {
  const { t, data, lang, can, pack } = useApp();
  const s = serviceOf(data, job.serviceId); const tier = s?.tiers.find((x) => x.id === job.tierId);
  const office = byId(data.offices ?? [], job.officeId);
  const name = s ? serviceName(s, lang) : '';
  return (
    <div className="jobs-where">
      <span className="jobs-addr"><LuBookOpen aria-hidden="true" />
        {s ? <span>{can('catalog') && moduleOn(data, pack, 'catalog') ? <A to={`/catalog/${s.id}`} className="jobs-client" data-testid="jobs-service-link">{name}</A> : name}{tier && s.tiers.length > 1 ? ` · ${tier.name}` : ''}</span>
          : <span className="dim">{t('jobs.eng.noService')}</span>}
      </span>
      {repeats(job) && <span className="jobs-rep"><LuRepeat aria-hidden="true" />{t('jobs.rp.' + job.repeat)}</span>}
      {office && <span className="jobs-addr"><LuBuilding2 aria-hidden="true" />{office.name}</span>}
      <ContactLinks phone={phone} />
    </div>
  );
}

/** Rows for the details list: service, tier, period, office, and the periods before and after this one. */
export function EngagementFacts({ job }: { job: Engagement }) {
  const { t, data, lang, pack, can } = useApp();
  const office = pack.family === 'practice';
  const s = serviceOf(data, job.serviceId); const tier = s?.tiers.find((x) => x.id === job.tierId);
  const before = byId(data.jobs, job.parentId); const after = data.jobs.find((j) => j.parentId === job.id);
  const where = byId(data.offices ?? [], job.officeId);
  const unset = <span className="dim">{t('jobs.notSet')}</span>;
  return (
    <>
      <dt>{t('jobs.f.service')}</dt>
      <dd>{s ? <>{can('catalog') && moduleOn(data, pack, 'catalog') ? <A to={`/catalog/${s.id}`}>{serviceName(s, lang)}</A> : serviceName(s, lang)}{!s.active && <> <Badge>{t('catalog.retired')}</Badge></>}</> : job.serviceId ? <span className="dim">{t('catalog.gone')}</span> : unset}</dd>
      {tier && <><dt>{t('jobs.f.tier')}</dt><dd>{tier.name}</dd></>}
      {office && <><dt>{t('jobs.f.period')}</dt><dd data-testid="jobs-period">{job.period || unset}</dd></>}
      {office && (data.offices ?? []).length > 0 && <><dt>{t('jobs.f.office')}</dt><dd>{where ? where.name : <span className="dim">{t('jobs.f.noOffice')}</span>}</dd></>}
      {before && <><dt>{t('jobs.eng.before')}</dt><dd><A to={`/jobs/${before.id}`} data-testid="jobs-prev-period">{before.period || before.number}</A></dd></>}
      {after && <><dt>{t('jobs.eng.after')}</dt><dd><A to={`/jobs/${after.id}`} data-testid="jobs-next-period">{after.period || after.number}</A></dd></>}
    </>
  );
}

/**
 * The playbook of the engagement's service: how far its tasks are, or a button to start it when it has not run.
 * It starts by itself once the work is past the proposal; the button is for work that was created before the service had a playbook.
 */
export function PlaybookCard({ job, onTab, bar }: { job: Engagement; onTab?: (x: JobTab) => void; bar?: boolean }) {
  const { t, data } = useApp();
  const pb = playbookOf(data, serviceOf(data, job.serviceId)?.playbookId);
  const tasks = playbookTasks(data, job.id);
  if (!pb || (!pb.active && !tasks.length)) return null;
  const done = tasks.filter((x) => x.status === 'done').length;
  const start = () => { const made = act(startPlaybook, job.id); toast(made.length ? t('jobs.auto.playbook', { n: made.length }) : t('jobs.pb.nothing')); };
  const body = tasks.length ? (
    <>
      <div className="jobs-pb-line"><span>{t('jobs.pb.progress', { done, n: tasks.length })}</span>{done === tasks.length && <Badge tone="ok">{t('jobs.pb.finished')}</Badge>}</div>
      <MoneyBar total={tasks.length} parts={[{ value: done, cls: 's4', label: t('jobs.pb.progress', { done, n: tasks.length }) }]} label={t('jobs.pb.progress', { done, n: tasks.length })} />
    </>
  ) : (
    <>
      <p className="small muted jobs-pb-none">{t(job.status === 'estimate' ? 'jobs.pb.waits' : 'jobs.pb.notRun', { n: pb.steps.length })}</p>
      <CanWrite><Button size="sm" icon={<LuPlay aria-hidden="true" />} onClick={start} data-testid="jobs-start-playbook">{t('jobs.pb.start')}</Button></CanWrite>
    </>
  );
  if (bar) return <div className="note jobs-pb-bar" data-testid="jobs-playbook"><b><LuListChecks aria-hidden="true" />{pb.name}</b>{body}</div>;
  return (
    <Card title={<><LuListChecks aria-hidden="true" className="jobs-ico" />{t('catalog.f.playbook')}</>} actions={tasks.length && onTab ? <button type="button" className="linkbtn small" onClick={() => onTab('tasks')}>{t('jobs.ov.allTasks')}</button> : undefined}>
      <div className="jobs-pb" data-testid="jobs-playbook"><b>{pb.name}</b>{body}</div>
    </Card>
  );
}

/** Billing of an engagement at a glance: what was agreed, what came in, what is still owed. */
export function BillingSummary({ job, m }: { job: Engagement; m: JobMoney }) {
  const { t } = useApp();
  const owes = Math.max(0, m.clientOwes);
  const due = owes > 0.005 && (job.status === 'progress' || job.status === 'done');
  return (
    <section aria-label={t('jobs.tab.billing')}>
      <div className="kpis jobs-bill" data-testid="jobs-billing">
        <Stat label={t('jobs.bill.agreed')} value={priceLine(t, m.price, job.unit)} hint={job.period ? t('jobs.bill.forPeriod', { period: job.period }) : undefined} />
        <Stat label={t('jobs.col.received')} value={money2(m.received)} hint={m.price > 0 ? t('jobs.bill.payments', { n: job.received.length }) : undefined} />
        <Stat label={t('common.balance')} value={money2(owes)} attention={due} hint={m.price > 0 && owes <= 0.005 ? t('jobs.paid') : owes > 0.005 && !due ? t('jobs.bill.notDue') : undefined} />
      </div>
    </section>
  );
}

/* ---------- appointments linked to the engagement ---------- */
const APPT_TONE: Record<ApptStatus, Tone> = { requested: 'accent', scheduled: 'info', awaiting_payment: 'warn', confirmed: 'ok', completed: 'ok', no_show: 'bad', cancelled_unpaid: 'neutral', cancelled_client: 'neutral', cancelled_staff: 'neutral' };

export function Appointments({ job }: { job: Engagement }) {
  const { t, data, lang, day, time, can } = useApp();
  // booked for this engagement, or for the lead it came from
  const list = (data.appointments ?? []).filter((a) => a.jobId === job.id || (!!job.leadId && a.leadId === job.leadId)).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const wanted = (data.apptTypes ?? []).find((x) => x.id === serviceOf(data, job.serviceId)?.appointmentTypeId);
  const book = <CanWrite><Button size="sm" variant="primary" icon={<LuCalendarPlus aria-hidden="true" />} onClick={() => go(`/appointments?client=${job.clientId}&job=${job.id}`)} data-testid="jobs-book-appt">{t('jobs.appt.book')}</Button></CanWrite>;
  return (
    <Card flush className="work-none" title={<>{t('jobs.tab.appointments')} <span className="count">{list.length}</span></>} actions={can('appointments') ? book : undefined}>
      {list.length ? (
        <div className="table-wrap">
          <table className="tbl stackable" data-testid="jobs-appts">
            <thead><tr><th>{t('jobs.appt.when')}</th><th>{t('common.type')}</th><th>{t('jobs.appt.with')}</th><th>{t('common.status')}</th></tr></thead>
            <tbody>
              {list.map((a) => {
                const type = (data.apptTypes ?? []).find((x) => x.id === a.typeId);
                return (
                  <tr key={a.id} className="click" onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button')) go(`/appointments/${a.id}`); }}>
                    <td className="t1 nowrap"><A to={`/appointments/${a.id}`} className="jobs-name">{day(a.date)}, {time(a.time)}</A></td>
                    <td data-label={t('common.type')}>{type ? type.name[lang] ?? type.name.en : null}<span className="xs dim jobs-under">{t('jobs.appt.mode.' + a.mode)} · {t('catalog.minutes', { n: a.minutes })}</span></td>
                    <td data-label={t('jobs.appt.with')}>{byId(data.users, a.staffId)?.name ?? null}</td>
                    <td data-label={t('common.status')}><Badge tone={APPT_TONE[a.status] ?? 'neutral'}>{t('jobs.appt.st.' + a.status)}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <Empty title={t('jobs.appt.none')}>{wanted ? t('jobs.appt.wanted', { type: wanted.name[lang] ?? wanted.name.en }) : t('jobs.appt.noneHint')}</Empty>}
    </Card>
  );
}

/* ---------- messages about the engagement ---------- */
const MSG_TONE: Record<Message['status'], Tone> = { draft: 'warn', demo: 'accent', queued: 'info', sent: 'ok', delivered: 'ok', failed: 'bad', received: 'info' };
const channelIcon = (m: Message) => (m.channel === 'call' ? <LuPhone aria-hidden="true" /> : m.channel === 'email' ? <LuMail aria-hidden="true" /> : <LuMessageSquare aria-hidden="true" />);

export function Messages({ job }: { job: Engagement }) {
  const { t, data, dateTime, live } = useApp();
  const list = data.messages.filter((m) => m.ref.type === 'job' && m.ref.id === job.id).sort((a, b) => b.at.localeCompare(a.at));
  return (
    <Card className="work-none" title={<>{t('jobs.tab.messages')} <span className="count">{list.length}</span></>} actions={<A to="/messages" className="btn sm" data-testid="jobs-open-messages">{t('jobs.msg.open')}<LuChevronRight aria-hidden="true" /></A>}>
      {list.length ? (
        <>
          <div className="list" data-testid="jobs-messages">
            {list.map((m) => (
              <div className="item jobs-msg" key={m.id}>
                <span className="jobs-msg-ico">{channelIcon(m)}</span>
                <div className="grow">
                  <div className="t">{m.subject || t('jobs.msg.ch.' + m.channel)}</div>
                  <div className="small muted jobs-msg-body">{m.body}</div>
                  <div className="xs dim">{m.dir === 'in' ? t('jobs.msg.from', { who: m.from || '' }) : t('jobs.msg.to', { who: m.to })} · {dateTime(m.at)}</div>
                </div>
                <span className="row tight"><Badge tone={MSG_TONE[m.status] ?? 'neutral'}>{t('jobs.msg.st.' + m.status)}</Badge>{m.status === 'demo' && <DemoTag />}</span>
              </div>
            ))}
          </div>
          {!live && <p className="xs muted jobs-msg-note">{t('jobs.msg.sample')}</p>}
        </>
      ) : <Empty title={t('jobs.msg.none')}>{t('jobs.msg.noneHint')}</Empty>}
    </Card>
  );
}
