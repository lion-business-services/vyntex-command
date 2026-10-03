// Worker portal: what a subcontractor, cleaner or crew member sees on their phone at the job site.
// Only their own jobs, tasks, payments and paperwork. Never the job price, the profit, other people's pay or client contact details.
import { useState } from 'react';
import { LuCalendarDays, LuMapPin, LuSend, LuShieldCheck, LuFileCheck2 } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { act, setPrefs } from '@/store/store';
import { Badge, Button, Card, Empty, cx, toast, type Tone } from '@/ui';
import { ContactLinks, DemoTag, DueBadge, InsuranceBadge, PlanBadge, PriorityBadge, W9Badge } from '@/app/shared';
import { addWorkLog, toggleTask } from '@/domain/actions';
import { byId, jobsOfWorker, workerMoney } from '@/domain/selectors';
import { workerIdOf } from '@/domain/permissions';
import type { AssignStatus, Job, Task } from '@/domain/types';
import { planName } from '@/lib/pricing';
import { money, money2, sum } from '@/lib/money';
import { periodText } from '@/features/team/util';
import { InsuranceModal } from '@/features/team/paperwork';
import '@/features/leads/work.css';
import './portal.css';

const ASSIGN_TONE: Record<AssignStatus, Tone> = { pending: 'neutral', progress: 'info', done: 'ok' };

export default function PortalPage() {
  const { t, data, prefs, pack, date, standing, lang } = useApp();
  const me = byId(data.workers, workerIdOf(prefs.viewAs));
  const [coi, setCoi] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [allPays, setAllPays] = useState(false);
  if (!me) return <Card className="work-none"><Empty title={t('team.notFound')} action={<Button variant="primary" onClick={() => setPrefs({ viewAs: 'owner' })}>{t('portal.backOwner')}</Button>} /></Card>;

  const year = new Date().getFullYear();
  const m = workerMoney(data, me.id, year);
  const pays = data.workerPays.filter((p) => p.workerId === me.id).sort((a, b) => b.date.localeCompare(a.date));
  const jobs = jobsOfWorker(data, me.id).map((j) => {
    const mine = j.assign.filter((a) => a.workerId === me.id);
    const agreed = sum(mine, (a) => a.price);
    const paid = sum(pays.filter((p) => p.jobId === j.id), (p) => p.amount);
    return { j, mine, agreed, paid, owed: agreed - paid, finished: j.status === 'done' || mine.every((a) => a.status === 'done') };
  }).sort((a, b) => Number(a.finished) - Number(b.finished) || (a.j.start || '9').localeCompare(b.j.start || '9'));
  const current = jobs.filter((x) => !x.finished);
  const finished = jobs.filter((x) => x.finished);
  const tasks = data.tasks.filter((x) => x.assignee === 'w:' + me.id);
  const open = tasks.filter((x) => x.status !== 'done').sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
  const done = tasks.filter((x) => x.status === 'done').sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
  const portal = standing('workerPortal');
  const shownPays = allPays ? pays : pays.slice(0, 6);

  return (
    <div className="portal">
      <header className="portal-head">
        <div>
          <h1>{t('hi')}, {me.name.split(' ')[0]}</h1>
          <p className="muted">{me.trade}</p>
        </div>
        <div className="portal-plan"><PlanBadge feature="workerPortal" detail /><span className="xs dim">{portal.state === 'upgrade' && portal.plan ? t('ent.upgradeHint', { plan: planName(portal.plan, lang) }) + ' ' : ''}{t('portal.demoNote')}</span></div>
      </header>

      {pack.compliance && !me.w9 && <div className="note bad" role="status">{t('w9Missing')} {t('portal.w9How')}</div>}

      <dl className="portal-sum">
        <div><dt>{t('team.col.agreed')}</dt><dd>{money(m.agreed)}</dd></div>
        <div><dt>{t('team.col.paid')}</dt><dd>{money(m.paid)}</dd></div>
        <div><dt>{t('portal.owed')}</dt><dd>{money(Math.max(0, m.owed))}</dd></div>
      </dl>

      <div className="portal-grid">
        <Card title={<>{t('portal.tasks')}{open.length > 0 && <span className="count">{open.length}</span>}</>} className="portal-side">
          {!tasks.length ? <p className="muted small">{t('portal.noTasks')}</p> : (
            <>
              {open.length ? <div className="list">{open.map((x) => <TaskLine key={x.id} task={x} job={byId(data.jobs, x.jobId)} />)}</div> : <p className="muted small">{t('portal.allDone')}</p>}
              {done.length > 0 && (
                <>
                  <button type="button" className="linkbtn small portal-more" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>{t('portal.tasksDone', { n: done.length })}</button>
                  {showDone && <div className="list">{done.map((x) => <TaskLine key={x.id} task={x} job={byId(data.jobs, x.jobId)} />)}</div>}
                </>
              )}
            </>
          )}
        </Card>

        <section className="portal-main" aria-labelledby="portal-jobs-h">
          <h2 id="portal-jobs-h" className="portal-h">{t('portal.jobs')}</h2>
          {!jobs.length ? <Card className="work-none"><Empty title={t('portal.noJobs')} /></Card> : (
            <div className="stack">
              {current.map((x) => <JobCard key={x.j.id} {...x} workerId={me.id} />)}
              {finished.length > 0 && (
                <>
                  {current.length > 0 && <h3 className="portal-h3">{t('portal.finished')}</h3>}
                  {finished.map((x) => <JobCard key={x.j.id} {...x} workerId={me.id} />)}
                </>
              )}
            </div>
          )}
        </section>

        <Card title={t('portal.pays')} className="portal-side">
          {pays.length ? (
            <>
              <p className="small muted portal-ytd">{t('portal.paidYear', { year })}: <b>{money2(m.paidYear)}</b></p>
              <div className="list" data-testid="portal-pays">
                {shownPays.map((p) => {
                  const j = byId(data.jobs, p.jobId);
                  return (
                    <div className="item portal-pay" key={p.id}>
                      <div className="grow">
                        <div className="t">{j ? j.name : t('form.pay.noJob')}</div>
                        <div className="small muted">{date(p.date)} · {t('m_' + p.method)}{p.ref ? ` · ${p.ref}` : ''}{periodText(t, p, date) ? ` · ${periodText(t, p, date)}` : ''}</div>
                      </div>
                      <b className="nowrap">{money2(p.amount)}</b>
                    </div>
                  );
                })}
              </div>
              {pays.length > shownPays.length && <button type="button" className="linkbtn small portal-more" onClick={() => setAllPays(true)}>{t('common.seeAll')} ({pays.length})</button>}
            </>
          ) : <p className="muted small">{t('team.noPays')}</p>}
        </Card>

        {pack.compliance && (
          <Card title={t('portal.docs')} className="portal-side">
            <div className="list">
              <div className="item portal-doc">
                <LuFileCheck2 aria-hidden="true" className="portal-ic" />
                <div className="grow">
                  <div className="t">{t('team.w9Title')} <W9Badge worker={me} /></div>
                  <div className="small muted">{me.w9 ? (me.w9Date ? t('team.w9On', { date: date(me.w9Date) }) : t('team.w9NoDate')) : t('portal.w9How')}</div>
                </div>
              </div>
              <div className="item portal-doc">
                <LuShieldCheck aria-hidden="true" className="portal-ic" />
                <div className="grow">
                  <div className="t">{t('team.coiTitle')} <InsuranceBadge worker={me} /></div>
                  <div className="small muted">{me.coiExp ? (me.insurer ? t('team.coiBy', { insurer: me.insurer }) : t('team.coiNoInsurer')) : t('team.coiNone')}</div>
                  <div className="row portal-coi"><Button size="sm" icon={<LuSend />} onClick={() => setCoi(true)} data-testid="portal-coi">{t('portal.coiSend')}</Button><DemoTag /></div>
                </div>
              </div>
            </div>
          </Card>
        )}
      </div>

      {coi && <InsuranceModal worker={me} own onClose={() => setCoi(false)} />}
    </div>
  );
}

function TaskLine({ task, job }: { task: Task; job?: Job }) {
  const { t } = useApp();
  const done = task.status === 'done';
  return (
    <label className={cx('item portal-task', done && 'done')}>
      <input type="checkbox" checked={done} onChange={() => act(toggleTask, task.id)} aria-label={`${t(done ? 'ts.done' : 'ts.todo')}: ${task.title}`} data-testid="portal-task" />
      <span className="grow">
        <span className="t">{task.title}</span> {!done && <PriorityBadge pri={task.pri} />}
        {task.description && !done && <span className="small muted portal-desc">{task.description}</span>}
        <span className="small muted portal-meta">{job && <span>{job.name}</span>}<DueBadge due={task.due} done={done} /></span>
      </span>
    </label>
  );
}

interface JobCardProps { j: Job; mine: Job['assign']; agreed: number; paid: number; owed: number; finished: boolean; workerId: string }
function JobCard({ j, mine, agreed, paid, owed, finished, workerId }: JobCardProps) {
  const { t, date, day } = useApp();
  const [text, setText] = useState('');
  const logs = j.log.filter((l) => l.workerId === workerId).sort((a, b) => b.date.localeCompare(a.date));
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    act(addWorkLog, j.id, workerId, text); setText(''); toast(t('portal.logSent'));
  };
  const when = j.start && j.end && j.end !== j.start ? t('team.period', { from: day(j.start), to: day(j.end) }) : j.start ? day(j.start) : t('portal.noDates');
  const repeat = j.repeat && j.repeat !== 'once' && t('rp_' + j.repeat) !== 'rp_' + j.repeat ? t('rp_' + j.repeat) : '';
  return (
    <article className={cx('card portal-job', finished ? 'is-done' : 'raised')} data-testid="portal-job">
      <div className="row between top nowrap">
        <h3>{j.name}</h3>
        <span className="row tight portal-status">{[...new Set(mine.map((a) => a.status))].map((s) => <Badge key={s} tone={ASSIGN_TONE[s]}>{t('a_' + s)}</Badge>)}</span>
      </div>
      <div className="portal-where">
        {j.address && <div className="portal-line"><LuMapPin aria-hidden="true" /><span>{j.address}</span></div>}
        <div className="portal-line"><LuCalendarDays aria-hidden="true" /><span>{when}{repeat ? ` · ${repeat}` : ''}</span></div>
        {j.address && <ContactLinks address={j.address} />}
      </div>
      <div className="portal-part">
        <div className="xs dim">{t('portal.part')}</div>
        {mine.map((a) => <div key={a.id}>{a.scope}</div>)}
      </div>
      <dl className="portal-money">
        <div><dt>{t('team.col.agreed')}</dt><dd>{money(agreed)}</dd></div>
        <div><dt>{t('team.col.paid')}</dt><dd>{money(paid)}</dd></div>
        <div><dt>{t('portal.owed')}</dt><dd className={cx(owed > 0.005 && 'strong')}>{money(Math.max(0, owed))}</dd></div>
      </dl>
      {logs.length > 0 && (
        <div className="portal-logs">
          <div className="xs dim">{t('portal.updates')}</div>
          {logs.slice(0, 2).map((l) => <p key={l.id} className="small"><span className="dim">{date(l.date)}</span> {l.text}</p>)}
        </div>
      )}
      {!finished && (
        <form className="portal-log" onSubmit={send}>
          <label className="sr" htmlFor={'log-' + j.id}>{t('portal.logLabel')}</label>
          <textarea id={'log-' + j.id} className="input" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('portal.logPh')} data-testid="portal-log-text" />
          <Button type="submit" size="sm" variant={text.trim() ? 'primary' : 'default'} icon={<LuSend />} disabled={!text.trim()} data-testid="portal-log">{t('portal.logSend')}</Button>
        </form>
      )}
    </article>
  );
}
