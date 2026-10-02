// Automations: the rules that do routine follow-up work, a switch for each, and a log of what they did.
// The rules themselves live in domain/automations.ts; this page only shows them and turns them on or off.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LuBanknote, LuCalendarClock, LuCheck, LuCircleCheck, LuMail, LuPlay, LuRepeat, LuSend, LuShieldCheck, LuSparkles, LuTrophy, LuUserPlus, LuZap } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, refPath } from '@/app/router';
import type { PageProps } from '@/app/routes';
import { act, getSnapshot, mutate } from '@/store/store';
import { Badge, Button, Card, Note, PageHeader, cx, toast } from '@/ui';
import { DemoTag, PlanBadge } from '@/app/shared';
import { ALWAYS_ON, RULES } from '@/domain/automations';
import { createLead } from '@/domain/actions';
import { byId, calendarEvents } from '@/domain/selectors';
import type { EntitlementId } from '@/domain/entitlements';
import type { DemoState, Ref } from '@/domain/types';
import { planName } from '@/lib/pricing';
import { today } from '@/lib/dates';
import { ruleLine, ruleName, stepText } from './format';
import './automations.css';

interface RuleView { id: string; thens: number; entitlement?: EntitlementId; alwaysOn?: boolean }

const ICON: Record<string, ReactNode> = {
  'lead-intake': <LuUserPlus />, 'visit-prep': <LuCalendarClock />, 'estimate-follow-up': <LuSend />, 'lead-won': <LuTrophy />, 'job-started': <LuPlay />,
  'job-completed': <LuCircleCheck />, 'payment-posted': <LuBanknote />, 'compliance-watch': <LuShieldCheck />, 'recurring-visits': <LuRepeat />,
};
/** Steps shown for the always-on rules, which are not part of RULES. */
const ALWAYS_ON_STEPS: Record<string, number> = { 'recurring-visits': 2 };

/* Fictional people for the "Try it" lead. Combined so that pressing the button again gives a different person. */
const FIRST = ['Elena', 'Marcus', 'Sofia', 'Daniel', 'Camila', 'Andre', 'Lucia', 'Victor', 'Paola', 'Owen', 'Rosa', 'Miguel'];
const LAST = ['Ortiz', 'Bennett', 'Navarro', 'Coleman', 'Vega', 'Whitaker', 'Salazar', 'Dawson', 'Cordero', 'Hale', 'Mendez', 'Foster'];
const STREETS = ['Sample Ter', 'Sample Blvd', 'Sample Pl', 'Sample Cir', 'Sample Pkwy', 'Sample Row'];
const TOWNS = ['Northfield, NJ', 'Somers Point, NJ', 'Pleasantville, NJ', 'Brigantine, NJ', 'Margate, NJ', 'Absecon, NJ'];

function samplePerson(d: DemoState) {
  const names = new Set([...d.leads.map((l) => l.name), ...d.clients.map((c) => c.name)].map((n) => n.toLowerCase()));
  const phones = new Set(d.leads.map((l) => l.phone));
  const start = d.leads.length;
  let name = '';
  for (let i = 0; i < FIRST.length * LAST.length; i++) {
    const k = start + i;
    const candidate = `${FIRST[k % FIRST.length]} ${LAST[(k * 5 + Math.floor(k / FIRST.length)) % LAST.length]}`;
    if (!names.has(candidate.toLowerCase())) { name = candidate; break; }
  }
  if (!name) name = `${FIRST[start % FIRST.length]} ${LAST[start % LAST.length]} ${start + 1}`;
  let phone = '';
  for (let i = 0; i < 100; i++) { const p = `609-555-01${String((start * 7 + i) % 100).padStart(2, '0')}`; if (!phones.has(p)) { phone = p; break; } }
  const [first, last] = name.toLowerCase().split(' ');
  return {
    name, phone: phone || '609-555-0100', email: `${first}.${last}@example.com`,
    address: `${12 + ((start * 13) % 180)} ${STREETS[start % STREETS.length]}, ${TOWNS[(start * 5) % TOWNS.length]}`,
  };
}

export default function AutomationsPage(_: PageProps) {
  const { t, data, pack, lang, can, standing, date, dateTime } = useApp();
  const [fresh, setFresh] = useState<{ leadId: string; name: string; ran: boolean } | null>(null);
  const [all, setAll] = useState(false);
  const freshRef = useRef<HTMLLIElement | null>(null);

  const rules: RuleView[] = [
    ...RULES.filter((r) => r.id !== 'compliance-watch' || pack.compliance).map((r) => ({ id: r.id, thens: r.thens, entitlement: r.entitlement })),
    ...ALWAYS_ON.map((id) => ({ id, thens: ALWAYS_ON_STEPS[id] ?? 1, alwaysOn: true })),
  ];
  const isOn = (r: RuleView) => r.alwaysOn || data.automation.enabled[r.id] !== false;
  const runs = data.automation.runs;
  const count = (id: string) => runs.filter((r) => r.ruleId === id).length;
  const plannedVisits = calendarEvents(data).filter((e) => e.kind === 'visit' && e.date >= today()).length;
  const n1 = (key: string, n: number) => t(n === 1 ? key + '.one' : key, { n });

  const toggle = (r: RuleView) => {
    const on = isOn(r);
    mutate((d) => { d.automation.enabled[r.id] = !on; });
    toast(t(on ? 'auto.turnedOff' : 'auto.turnedOn', { name: ruleName(r.id, t) }));
  };

  const tryIt = () => {
    const person = samplePerson(data);
    const type = pack.serviceTypes[0]?.id ?? 'other';
    const lead = act(createLead, { ...person, type, source: 'website', pri: 'medium', ownerId: '', value: null, firstNote: t('auto.try.note', { service: t('ty_' + type) }) });
    const ran = getSnapshot().data.automation.runs.some((r) => r.ref?.type === 'lead' && r.ref.id === lead.id);
    setFresh({ leadId: lead.id, name: lead.name, ran });
    toast(t(ran ? 'auto.try.done' : 'auto.try.off', { lead: lead.name }));
  };
  useEffect(() => { if (fresh?.ran) freshRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [fresh]);

  /** Name of the record a run worked on, when it still exists. */
  const recordName = (ref?: Ref) => (!ref ? null : ref.type === 'lead' ? byId(data.leads, ref.id)?.name : ref.type === 'job' ? byId(data.jobs, ref.id)?.name : ref.type === 'client' ? byId(data.clients, ref.id)?.name : null) ?? null;
  const shownRuns = all ? runs : runs.slice(0, 6);
  const onCount = rules.filter(isOn).length;

  return (
    <div className="auto">
      <PageHeader title={t('auto.title')} sub={t('auto.sub')} />

      <div className="auto-grid">
        <section className="auto-main" aria-labelledby="auto-rules-h">
          <div className="auto-sec-h"><h2 id="auto-rules-h">{t('auto.rules')}</h2><span className="small muted">{t('auto.rulesOn', { on: onCount, n: rules.length })}</span></div>
          {rules.some((r) => r.entitlement && standing(r.entitlement).state === 'upgrade') && <p className="small muted auto-above" data-testid="auto-plan-note">{t('auto.demoOpen')}</p>}
          <div className="auto-rules">
            {rules.map((r) => {
              const on = isOn(r); const n = count(r.id);
              const st = r.entitlement ? standing(r.entitlement) : null;
              const planKey = r.entitlement && t('auto.needsPlan.' + r.entitlement) !== 'auto.needsPlan.' + r.entitlement ? 'auto.needsPlan.' + r.entitlement : 'auto.needsPlan';
              const name = ruleName(r.id, t);
              return (
                <article key={r.id} className={cx('auto-rule', !on && 'off')} data-testid={`auto-rule-${r.id}`} aria-label={name}>
                  <header>
                    <h3>{name}</h3>
                    {r.alwaysOn ? <Badge tone="ok">{t('auto.alwaysOn')}</Badge> : (
                      <button type="button" role="switch" aria-checked={on} className="auto-switch" onClick={() => toggle(r)} aria-label={`${t(on ? 'auto.turnOff' : 'auto.turnOn')}: ${name}`} data-testid={`auto-toggle-${r.id}`}>
                        <span className="auto-switch-t">{t(on ? 'auto.on' : 'auto.off')}</span><span className="auto-switch-track" aria-hidden="true"><span /></span>
                      </button>
                    )}
                  </header>
                  <div className="auto-flow">
                    <div className="auto-when">
                      <span className="auto-node" aria-hidden="true">{ICON[r.id] ?? <LuZap />}</span>
                      <div><span className="auto-cap">{t('auto.when')}</span><p>{ruleLine(`auto.${r.id}.when`, t, lang)}</p></div>
                    </div>
                    <div className="auto-then">
                      <span className="auto-cap">{t('auto.then')}</span>
                      <ol aria-label={t('auto.steps')}>
                        {Array.from({ length: r.thens }, (_x, i) => <li key={i}><span className="auto-num" aria-hidden="true">{i + 1}</span><span>{ruleLine(`auto.${r.id}.then${i + 1}`, t, lang)}</span></li>)}
                      </ol>
                    </div>
                  </div>
                  <footer>
                    <span className="small muted">{r.alwaysOn ? (plannedVisits ? n1('auto.visitsPlanned', plannedVisits) : t('auto.visitsNone')) : n === 0 ? t('auto.neverRan') : n === 1 ? t('auto.ranOnce') : t('auto.ranTimes', { n })}</span>
                    {r.entitlement && <PlanBadge feature={r.entitlement} />}
                    {st?.state === 'upgrade' && st.plan && <p className="xs muted auto-plan">{t(planKey, { plan: planName(st.plan, lang) })}</p>}
                  </footer>
                </article>
              );
            })}
          </div>
        </section>

        <aside className="auto-side">
          <Card className="auto-try" title={<><LuSparkles aria-hidden="true" />{t('auto.tryIt')}</>}>
            <p className="small muted">{t('auto.tryHint')}</p>
            <div className="row auto-try-row">
              <Button variant="primary" icon={<LuUserPlus aria-hidden="true" />} onClick={tryIt} data-testid="auto-try">{t(fresh ? 'auto.try.again' : 'auto.tryLead')}</Button>
              {fresh && byId(data.leads, fresh.leadId) && <A to={`/leads/${fresh.leadId}`} className="btn" data-testid="auto-try-open">{t('auto.try.open', { lead: fresh.name.split(' ')[0] })}</A>}
            </div>
            {fresh && !fresh.ran && <p className="small auto-try-off" role="status">{t('auto.try.off', { lead: fresh.name })}</p>}
          </Card>

          <Card title={<>{t('auto.history')}{runs.length > 0 && <span className="count">{runs.length}</span>}</>}>
            <div data-testid="auto-history">
              {!runs.length ? <p className="small muted">{ruleLine('auto.historyEmpty', t, lang)}</p> : (
                <ol className="auto-runs">
                  {shownRuns.map((run) => {
                    const isFresh = !!fresh && run.ref?.type === 'lead' && run.ref.id === fresh.leadId;
                    const name = recordName(run.ref);
                    return (
                      <li key={run.id} className={cx('auto-run', isFresh && 'fresh')} ref={isFresh ? freshRef : undefined} data-run={run.ruleId} data-fresh={isFresh || undefined}>
                        <div className="auto-run-h"><b>{ruleName(run.ruleId, t)}</b>{isFresh ? <Badge tone="accent">{t('auto.justNow')}</Badge> : <time className="xs dim">{dateTime(run.at)}</time>}</div>
                        <ul>{run.steps.map((s, i) => <li key={i}><LuCheck aria-hidden="true" /><span>{stepText(s, t, date)}</span></li>)}</ul>
                        {run.ref && name && <A to={refPath(run.ref)} className="small auto-link">{t('auto.open', { name })}</A>}
                      </li>
                    );
                  })}
                </ol>
              )}
              {runs.length > shownRuns.length && <button type="button" className="linkbtn small auto-all" onClick={() => setAll(true)}>{t('auto.showAll', { n: runs.length })}</button>}
            </div>
          </Card>

          <Note>
            <span className="auto-mail"><LuMail aria-hidden="true" /><span>{t('auto.emailNote')}</span></span>
            <span className="row auto-mail-row"><DemoTag />{can('documents') && <A to="/messages" className="small auto-link">{t('auto.messages')}</A>}</span>
          </Note>
        </aside>
      </div>
    </div>
  );
}
