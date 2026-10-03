// The product window of the hero. It is built from the real sample business of the selected edition (the same records the
// demo opens with) and replays, slowly, what the product does when a lead arrives: the lead-intake rule of domain/automations.ts
// assigns an owner, creates a call-back task and sets a follow-up that lands on the calendar. Nothing on it is typed by hand.
import { useEffect, useState } from 'react';
import { LuCheck, LuFlaskConical, LuPause, LuPlay, LuZap } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { JobStatusBadge } from '@/app/shared';
import type { KpiId } from '@/packs/types';
import type { LeadStage } from '@/domain/types';
import { byId, calendarEvents, isActiveJob, isOpenLead, jobMoney, kpiValues, type CalEvent } from '@/domain/selectors';
import { money, sum } from '@/lib/money';
import { addDays, today } from '@/lib/dates';
import { Frame, useInView, usePrefersReducedMotion } from '@/brand';
import { Avatar, Badge, MoneyBar, cx } from '@/ui';

const MONEY_KPIS: KpiId[] = ['activeValue', 'expectedProfit', 'clientsOwe', 'oweWorkers', 'pipelineValue', 'collectedMonth'];
const OPEN_STAGES: LeadStage[] = ['new', 'contacted', 'scheduled', 'sent'];

/* The loop. Phase 0 is the moment before the lead arrives; each later phase adds one thing; REST is the complete, quiet state. */
const REST = 7;
/** When each phase starts, in milliseconds from the start of a cycle. The last entry is the length of the cycle. */
const AT = [1100, 2500, 3900, 5300, 6800, 8300, 10700, 13200];

/** Runs the cycle while `active`; otherwise rests on the complete state. */
function useDemoLoop(active: boolean, resetKey: string): number {
  const [phase, setPhase] = useState(REST);
  useEffect(() => {
    setPhase(REST);
    if (!active) return;
    let timers: number[] = [];
    const cycle = () => {
      timers.forEach(clearTimeout); timers = [];
      setPhase(0);
      AT.forEach((ms, i) => timers.push(window.setTimeout(() => (i + 1 <= REST ? setPhase(i + 1) : cycle()), ms)));
    };
    const first = window.setTimeout(cycle, 2200);
    return () => { clearTimeout(first); timers.forEach(clearTimeout); };
  }, [active, resetKey]);
  return phase;
}

/** A figure that slides in when it changes. */
function Tick({ value }: { value: string | number }) { return <span className="mk-tick" key={String(value)}>{value}</span>; }

export function ProductWindow() {
  const { t, data, pack, day, time } = useApp();
  const reduced = usePrefersReducedMotion();
  const { ref, visible } = useInView<HTMLDivElement>('0px');
  const [paused, setPaused] = useState(false);
  const todayIso = today();

  const kpi = kpiValues(data);
  const events = calendarEvents(data, 30).filter((e) => e.date >= todayIso && !e.done);
  const eventOf = (leadId: string) => events.find((e) => e.ref.type === 'lead' && e.ref.id === leadId);
  // the lead the loop replays: the newest one still in "new", preferring one that already has its entry on the calendar
  const fresh = data.leads.filter((l) => l.status === 'new').sort((a, b) => b.created.localeCompare(a.created));
  const lead = fresh.find((l) => eventOf(l.id)) ?? fresh[0];
  const leadEvent = lead ? eventOf(lead.id) : undefined;
  const owner = lead ? byId(data.users, lead.ownerId) ?? data.users.find((u) => u.role === 'owner') : undefined;

  const phase = useDemoLoop(visible && !reduced && !paused && !!lead, pack.id + ':' + (lead?.id ?? ''));
  const live = phase !== REST;
  const arrived = phase >= 1, counted = phase >= 2, ruleOn = phase >= 3, taskOn = phase >= 4, calOn = phase >= 5, doneOn = phase >= 6;

  const openLeads = data.leads.filter(isOpenLead);
  const pipeline = sum(openLeads, (l) => l.value) - (counted || !lead ? 0 : lead.value ?? 0);
  const stageCount = (s: LeadStage) => openLeads.filter((l) => l.status === s).length - (s === 'new' && lead && !counted ? 1 : 0);
  const newLeads = kpi.newLeads - (lead && !counted ? 1 : 0);

  // three figures of the edition's own dashboard, plus the one the loop changes
  const kpiIds: KpiId[] = [...pack.kpis.filter((id) => id !== 'newLeads').slice(0, 3), 'newLeads'];
  // coming up: the next entries of the calendar, always including the one that belongs to the lead
  const others = events.filter((e) => e !== leadEvent).slice(0, leadEvent ? 3 : 4);
  const upcoming = (leadEvent ? [...others, leadEvent] : others).sort((a, b) => events.indexOf(a) - events.indexOf(b));
  const job = data.jobs.find((j) => j.status === 'progress') ?? data.jobs.find(isActiveJob);
  const jm = job ? jobMoney(data, job) : null;
  const kindLabel = (e: CalEvent) => (e.kind === 'visit' ? t('calendar.ev_visit') : t('ev_' + e.kind));
  const when = (e: CalEvent) => (e.date === todayIso ? t('common.today') : day(e.date));

  // the lines the Automations page records when the rule runs, with the same wording keys
  const steps = lead ? [
    { on: ruleOn, text: t('auto.step.owner', { owner: owner?.name ?? '' }) },
    { on: taskOn, text: t('auto.step.task', { task: t('auto.task.callBack', { lead: lead.name }) }) },
    { on: calOn, text: leadEvent?.kind === 'appt' ? t('auto.step.calendar', { date: day(leadEvent.date) }) : t('auto.step.followUp', { date: day(lead.followUp ?? addDays(1)) }) },
  ] : [];

  return (
    <div className="mk-win-wrap" ref={ref} role="group" aria-label={t('mk.prev.label')}>
      <Frame tilt className="mk-win" title={data.company.name} sub={pack.product} badge={data.company.initials || undefined}
        note={(
          <span className="mk-win-note">
            <LuFlaskConical aria-hidden="true" /><span>{t('mk.prev.tag')}</span>
            {lead && !reduced && (
              <button type="button" className="mk-win-pause" aria-pressed={paused} onClick={() => setPaused(!paused)} title={t(paused ? 'mk.prev.play' : 'mk.prev.pause')} aria-label={t(paused ? 'mk.prev.play' : 'mk.prev.pause')} data-testid="mk-preview-pause">
                {paused ? <LuPlay aria-hidden="true" /> : <LuPause aria-hidden="true" />}
              </button>
            )}
          </span>
        )}>
        <div className="mk-win-b" key={pack.id} data-live={live ? '' : undefined} data-phase={phase}>
          <div className="mk-win-kpis">
            {kpiIds.map((id) => (
              <div className={cx('mk-kpi', id === 'newLeads' && live && phase >= 2 && phase <= 3 && 'hot')} key={id}>
                <div className="k">{t('dash.kpi.' + id)}</div>
                <div className="v">{id === 'newLeads' ? <Tick value={newLeads} /> : MONEY_KPIS.includes(id) ? money(kpi[id]) : kpi[id]}</div>
              </div>
            ))}
          </div>

          <div className="mk-win-cols">
            <div className="mk-win-col">
              <section aria-labelledby="mk-prev-leads">
                <h3 id="mk-prev-leads">{t('mk.prev.leads')}<span className="num"><Tick value={money(pipeline)} /></span></h3>
                {openLeads.length ? (
                  <ul className="mk-win-stages">
                    {OPEN_STAGES.map((s) => { const n = stageCount(s); return <li key={s} className={cx(!n && 'zero')}><b>{s === 'new' ? <Tick value={n} /> : n}</b><span>{t('ls_' + s)}</span></li>; })}
                  </ul>
                ) : <p className="mk-win-empty">{t('mk.prev.noLeads')}</p>}
                {lead && (
                  <div className={cx('mk-win-lead mk-ap', !arrived && 'off', live && phase >= 1 && phase <= 2 && 'hot')}>
                    <Avatar name={lead.name} size="sm" />
                    <span className="grow"><span className="t clip">{lead.name}</span><small className="clip">{t('ty_' + lead.type)}, {t('src_' + lead.source)}</small></span>
                    <Badge tone="accent">{t('ls_new')}</Badge>
                  </div>
                )}
              </section>

              {lead && (
                <section className={cx('mk-win-auto', live && ruleOn && 'lit', live && !ruleOn && 'idle')} aria-labelledby="mk-prev-auto">
                  <h3 id="mk-prev-auto"><span className="mk-win-rule"><LuZap aria-hidden="true" /><span className="clip">{t('auto.lead-intake.when')}</span></span></h3>
                  <ol>
                    {steps.map((s, i) => <li key={i} className={cx('mk-ap', !s.on && 'off')}><LuCheck aria-hidden="true" /><span>{s.text}</span></li>)}
                  </ol>
                  <p className={cx('mk-win-done mk-ap', !doneOn && 'off')}>
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="7" /><path d="M4.6 8.3 7 10.6l4.5-5" pathLength={1} /></svg>
                    {t('mk.prev.done')}
                  </p>
                </section>
              )}
            </div>

            <div className="mk-win-col">
              <section aria-labelledby="mk-prev-next">
                <h3 id="mk-prev-next">{t('mk.prev.next')}</h3>
                {upcoming.length ? (
                  <ul className="mk-win-list">
                    {upcoming.map((e, i) => {
                      const mine = e === leadEvent;
                      // until the entry of the lead arrives, the rows under it sit one row higher, so the list has no hole
                      const under = !!leadEvent && !calOn && i > upcoming.indexOf(leadEvent);
                      return (
                        <li key={e.id} className={cx(mine ? 'mk-ap' : 'mk-row', mine && !calOn && 'off', mine && live && phase === 5 && 'hot', under && 'up')}>
                          <span className="mk-win-when">{when(e)}{e.time ? <small>{time(e.time)}</small> : null}</span>
                          <span className="grow"><span className="t clip">{e.title}</span><small className="clip">{kindLabel(e)}</small></span>
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="mk-win-empty">{t('noEvents')}</p>}
              </section>
              {job && jm && (
                <section className="mk-win-job" aria-labelledby="mk-prev-job">
                  <h3 id="mk-prev-job">{t('dash.kpi.activeJobs')}</h3>
                  <div className="mk-win-job-h"><span className="t clip">{job.name}</span><JobStatusBadge status={job.status} /></div>
                  <MoneyBar parts={[{ value: jm.received, cls: 's4', label: t('mk.prev.received', { paid: money(jm.received), total: money(jm.price) }) }]} total={jm.price} label={t('mk.prev.received', { paid: money(jm.received), total: money(jm.price) })} />
                  <small className="clip">{byId(data.clients, job.clientId)?.name}, {t('mk.prev.received', { paid: money(jm.received), total: money(jm.price) })}</small>
                </section>
              )}
            </div>
          </div>
        </div>
      </Frame>
    </div>
  );
}
