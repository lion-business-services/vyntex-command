// Automations: the rules that do routine follow-up work, a switch for each, a builder to write new ones and a log of
// what they did. The rules are data (the company's list, started from what the edition ships) and are run by the rule
// engine in src/domain/rules. This file is the list; Builder.tsx edits one rule and History.tsx is the full log.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  LuBanknote, LuBriefcase, LuCalendarClock, LuCheck, LuCircleCheck, LuCopy, LuEllipsis, LuFileText, LuHistory, LuListChecks, LuMail, LuPencil, LuPlay, LuPlus, LuRepeat,
  LuRotateCcw, LuSend, LuShieldCheck, LuSparkles, LuSunrise, LuTrash2, LuTriangleAlert, LuTrophy, LuUserPlus, LuUsers, LuZap,
} from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, go, refPath } from '@/app/router';
import type { PageProps } from '@/app/routes';
import { act, getSnapshot } from '@/store/store';
import { Badge, Button, Card, IconButton, Menu, Note, PageHeader, Seg, confirmDialog, cx, toast } from '@/ui';
import { DemoTag, PlanBadge, CanWrite } from '@/app/shared';
import { ALWAYS_ON, RULES } from '@/domain/automations';
import { createLead } from '@/domain/actions';
import { effectiveRules, isRuleOn, ruleChanged, shippedRule, shippedRules } from '@/domain/rules/engine';
import { deleteRule, duplicateRule, resetRule, setRuleActive } from '@/domain/rules/manage';
import { eventDef, type EventGroup } from '@/domain/rules/fields';
import { calendarEvents } from '@/domain/selectors';
import type { EntitlementId } from '@/domain/entitlements';
import type { DemoState, RuleDef } from '@/domain/types';
import { planName } from '@/lib/pricing';
import { today } from '@/lib/dates';
import { ruleLine, ruleName, ruleTitle, runRuleName, stepText } from './format';
import { builtinOf, ruleText } from './sentence';
import { Builder } from './Builder';
import { History, recordOf } from './History';
import './automations.css';

interface RuleView { id: string; rule?: RuleDef; thens: number; entitlement?: EntitlementId; alwaysOn?: boolean; group: EventGroup }

const ICON: Record<string, ReactNode> = {
  'lead-intake': <LuUserPlus />, 'visit-prep': <LuCalendarClock />, 'estimate-follow-up': <LuSend />, 'lead-won': <LuTrophy />, 'job-started': <LuPlay />,
  'job-completed': <LuCircleCheck />, 'payment-posted': <LuBanknote />, 'compliance-watch': <LuShieldCheck />, 'recurring-visits': <LuRepeat />,
};
/** A rule without a picture of its own shows the one of what it is about. */
const GROUP_ICON: Record<EventGroup, ReactNode> = {
  lead: <LuUserPlus />, client: <LuUsers />, job: <LuBriefcase />, money: <LuBanknote />, appointment: <LuCalendarClock />, task: <LuListChecks />, document: <LuFileText />, message: <LuMail />, time: <LuSunrise />,
};
const GROUPS: EventGroup[] = ['lead', 'appointment', 'job', 'money', 'document', 'task', 'client', 'message', 'time'];
/** Steps shown for the always-on rules, which are not part of RULES. */
const ALWAYS_ON_STEPS: Record<string, number> = { 'recurring-visits': 2 };
/** From this many rules on, the list can be narrowed to one area. */
const FILTER_FROM = 12;

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

export default function AutomationsPage({ id, sub }: PageProps) {
  if (id === 'history') return <History />;
  if (id === 'new') return <Builder />;
  if (id === 'rule' && sub) return <Builder ruleId={sub} />;
  return <RulesPage />;
}

function RulesPage() {
  const app = useApp();
  const { t, data, pack, lang, can, standing, date, dateTime } = app;
  const [fresh, setFresh] = useState<{ leadId: string; name: string; ran: boolean; tick: number } | null>(null);
  const [all, setAll] = useState(false);
  const [group, setGroup] = useState<EventGroup | 'all'>('all');
  const freshRef = useRef<HTMLLIElement | null>(null);
  const write = can('write');

  // the rules in force, in the order the edition ships them, the company's own after those
  const shipped = shippedRules(pack);
  const inForce = effectiveRules(data, pack);
  const ordered = [...shipped.map((s) => inForce.find((r) => r.id === s.id)).filter((r): r is RuleDef => !!r), ...inForce.filter((r) => !shipped.some((s) => s.id === r.id))];
  const rules: RuleView[] = [
    ...ordered.filter((r) => r.id !== 'compliance-watch' || pack.compliance).map((rule): RuleView => {
      const coded = builtinOf(rule);
      return { id: rule.id, rule, thens: rule.then.length, entitlement: coded?.entitlement, group: eventDef(rule.when.event)?.group ?? 'time' };
    }),
    ...ALWAYS_ON.map((id): RuleView => ({ id, thens: ALWAYS_ON_STEPS[id] ?? 1, alwaysOn: true, group: 'job' })),
  ];
  const isOn = (r: RuleView) => r.alwaysOn || (!!r.rule && isRuleOn(data, r.rule));
  const runs = data.automation.runs;
  const count = (id: string) => runs.filter((r) => r.ruleId === id).length;
  const plannedVisits = calendarEvents(data).filter((e) => e.kind === 'visit' && e.date >= today()).length;
  const n1 = (key: string, n: number) => t(n === 1 ? key + '.one' : key, { n });
  const nameOf = (r: RuleView) => (r.rule ? ruleTitle(r.rule, shippedRule(pack, r.id), t, lang) : ruleName(r.id, t));

  const toggle = (r: RuleView) => {
    const on = isOn(r);
    act(setRuleActive, r.id, !on);
    toast(t(on ? 'auto.turnedOff' : 'auto.turnedOn', { name: nameOf(r) }));
  };
  const copy = (r: RuleView) => {
    const name = nameOf(r);
    const made = act(duplicateRule, r.id, { en: t('auto.copyOf', { name }), es: t('auto.copyOf', { name }) });
    if (made) { toast(t('auto.duplicated', { name: t('auto.copyOf', { name }) })); go(`/automations/rule/${made.id}`); }
  };
  const reset = async (r: RuleView) => {
    if (!(await confirmDialog(t('auto.resetAsk', { name: nameOf(r) }), t('auto.reset'), t('common.cancel'), false))) return;
    if (act(resetRule, r.id)) toast(t('auto.resetDone', { name: nameOf(r) }));
  };
  const remove = async (r: RuleView) => {
    const name = nameOf(r);
    if (!(await confirmDialog(t('auto.deleteAsk', { name }), t('common.delete'), t('common.cancel')))) return;
    if (act(deleteRule, r.id)) toast(t('auto.deleted', { name }));
  };

  const tryIt = () => {
    const person = samplePerson(data);
    const type = pack.serviceTypes[0]?.id ?? 'other';
    const lead = act(createLead, { ...person, type, source: 'website', pri: 'medium', ownerId: '', value: null, firstNote: t('auto.try.note', { service: t('ty_' + type) }) });
    const ran = getSnapshot().data.automation.runs.some((r) => r.ref?.type === 'lead' && r.ref.id === lead.id);
    setFresh((was) => ({ leadId: lead.id, name: lead.name, ran, tick: (was?.tick ?? 0) + 1 }));
    toast(t(ran ? 'auto.try.done' : 'auto.try.off', { lead: lead.name }));
  };
  useEffect(() => { if (fresh?.ran) freshRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [fresh]);

  const shownRuns = all ? runs : runs.slice(0, 6);
  const onCount = rules.filter(isOn).length;
  // the rules that just ran for the sample lead: their steps light one after the other, in step with the new entry in "What ran"
  const freshRuns = fresh ? runs.filter((r) => r.ref?.type === 'lead' && r.ref.id === fresh.leadId) : [];
  const litRules = new Set(freshRuns.map((r) => r.ruleId));
  const groups = GROUPS.filter((g) => rules.some((r) => r.group === g));
  const filterable = rules.length >= FILTER_FROM && groups.length > 1;
  const visible = filterable && group !== 'all' ? rules.filter((r) => r.group === group) : rules;
  const writesToClients = rules.some((r) => r.rule?.then.some((s) => s.do === 'message' || s.do === 'review'));

  return (
    <div className="auto">
      <PageHeader title={t('auto.title')} sub={t('auto.sub')} actions={(
        <>
          <A to="/automations/history" className="btn" data-testid="auto-open-history"><LuHistory aria-hidden="true" />{t('auto.tab.history')}</A>
          <CanWrite><A to="/automations/new" className="btn" data-testid="auto-new"><LuPlus aria-hidden="true" />{t('auto.new')}</A></CanWrite>
        </>
      )} />

      <div className="auto-grid">
        <section className="auto-main" aria-labelledby="auto-rules-h">
          <div className="auto-sec-h"><h2 id="auto-rules-h">{t('auto.rules')}</h2><span className="small muted">{t('auto.rulesOn', { on: onCount, n: rules.length })}</span></div>
          {filterable && (
            <div className="auto-filter" data-testid="auto-filter">
              <Seg label={t('auto.filter')} value={group} onChange={setGroup} options={[{ value: 'all' as const, label: t('auto.filter.all'), count: rules.length }, ...groups.map((g) => ({ value: g, label: t('auto.group.' + g), count: rules.filter((r) => r.group === g).length }))]} />
            </div>
          )}
          {rules.some((r) => r.entitlement && standing(r.entitlement).state === 'upgrade') && <p className="small muted auto-above" data-testid="auto-plan-note">{t('auto.demoOpen')}</p>}
          <div className="auto-rules">
            {visible.map((r) => {
              const on = isOn(r); const n = count(r.id);
              const st = r.entitlement ? standing(r.entitlement) : null;
              const planKey = r.entitlement && t('auto.needsPlan.' + r.entitlement) !== 'auto.needsPlan.' + r.entitlement ? 'auto.needsPlan.' + r.entitlement : 'auto.needsPlan';
              const name = nameOf(r);
              const lit = on && litRules.has(r.id);
              const text = r.rule ? ruleText(r.rule, app) : null;
              const whenLine = text ? text.when : ruleLine(`auto.${r.id}.when`, t, lang);
              const thens = text ? text.thens : Array.from({ length: r.thens }, (_x, i) => ruleLine(`auto.${r.id}.then${i + 1}`, t, lang));
              const coded = r.rule ? builtinOf(r.rule) : undefined;
              const isShipped = !!r.rule && !!shippedRule(pack, r.id);
              const changed = !!r.rule && isShipped && ruleChanged(pack, r.rule);
              const about = r.rule?.about ? r.rule.about[lang] || r.rule.about.en || r.rule.about.es : '';
              return (
                <article key={r.id} className={cx('auto-rule', !on && 'off', lit && 'lit')} data-testid={`auto-rule-${r.id}`} data-lit={lit || undefined} aria-label={name}>
                  <header>
                    <h3>{name}</h3>
                    {r.alwaysOn ? <Badge tone="ok">{t('auto.alwaysOn')}</Badge> : (
                      <button type="button" role="switch" aria-checked={on} className="auto-switch" disabled={!write} onClick={() => toggle(r)} aria-label={`${t(on ? 'auto.turnOff' : 'auto.turnOn')}: ${name}`} data-testid={`auto-toggle-${r.id}`}>
                        <span className="auto-switch-t">{t(on ? 'auto.on' : 'auto.off')}</span><span className="auto-switch-track" aria-hidden="true"><span /></span>
                      </button>
                    )}
                  </header>
                  {(about || changed || (r.rule && !isShipped)) && (
                    <p className="small muted auto-about">
                      {r.rule && !isShipped && <Badge tone="accent" outline>{t('auto.tag.own')}</Badge>}
                      {changed && <Badge tone="warn" outline>{t('auto.tag.changed')}</Badge>}
                      {about && <span>{about}</span>}
                    </p>
                  )}
                  <div className="auto-flow" key={lit ? fresh?.tick : 'rest'} style={{ '--n': thens.length } as React.CSSProperties}>
                    <div className="auto-when">
                      <span className="auto-node" aria-hidden="true">{ICON[coded?.id ?? r.id] ?? GROUP_ICON[r.group] ?? <LuZap />}</span>
                      <div>
                        <span className="auto-cap">{t('auto.when')}</span><p>{whenLine}</p>
                        {!!text?.conds.length && <p className="auto-cond" data-testid={`auto-cond-${r.id}`}><span className="auto-cap">{t('auto.if')}</span>{text.conds.map((c, i) => <span key={i}>{i > 0 && <i>{t('auto.and')} </i>}{c}</span>)}</p>}
                      </div>
                    </div>
                    <div className="auto-then">
                      <span className="auto-cap">{t('auto.then')}</span>
                      <ol aria-label={t('auto.steps')}>
                        {thens.map((line, i) => <li key={i} style={{ '--i': i } as React.CSSProperties}><span className="auto-num" data-n={i + 1} aria-hidden="true">{i + 1}</span><span>{line}</span></li>)}
                      </ol>
                    </div>
                  </div>
                  <footer>
                    <span className="small muted">{r.alwaysOn ? (plannedVisits ? n1('auto.visitsPlanned', plannedVisits) : t('auto.visitsNone')) : n === 0 ? t('auto.neverRan') : n === 1 ? t('auto.ranOnce') : t('auto.ranTimes', { n })}</span>
                    {r.entitlement && <PlanBadge feature={r.entitlement} />}
                    {r.rule && write && (
                      <Menu label={`${t('auto.menu')}: ${name}`} button={<IconButton size="sm" label={`${t('auto.menu')}: ${name}`} data-testid={`auto-menu-${r.id}`}><LuEllipsis /></IconButton>}>
                        {(close: () => void) => (
                          <>
                            <button type="button" role="menuitem" onClick={() => { close(); go(`/automations/rule/${r.id}`); }} data-testid={`auto-edit-${r.id}`}><LuPencil aria-hidden="true" />{t('auto.edit')}</button>
                            {!coded && <button type="button" role="menuitem" onClick={() => { close(); copy(r); }} data-testid={`auto-copy-${r.id}`}><LuCopy aria-hidden="true" />{t('auto.duplicate')}</button>}
                            {changed && <button type="button" role="menuitem" onClick={() => { close(); void reset(r); }} data-testid={`auto-reset-${r.id}`}><LuRotateCcw aria-hidden="true" />{t('auto.reset')}</button>}
                            {!isShipped && <button type="button" role="menuitem" className="danger" onClick={() => { close(); void remove(r); }} data-testid={`auto-delete-${r.id}`}><LuTrash2 aria-hidden="true" />{t('auto.delete')}</button>}
                          </>
                        )}
                      </Menu>
                    )}
                    {st?.state === 'upgrade' && st.plan && <p className="xs muted auto-plan">{t(planKey, { plan: planName(st.plan, lang) })}</p>}
                  </footer>
                </article>
              );
            })}
          </div>
        </section>

        <aside className="auto-side">
          <Card className="auto-try premium" title={<><LuSparkles aria-hidden="true" />{t('auto.tryIt')}</>}>
            <p className="small muted">{t('auto.tryHint')}</p>
            <div className="row auto-try-row">
              <CanWrite><Button variant="primary" icon={<LuUserPlus aria-hidden="true" />} onClick={tryIt} data-testid="auto-try">{t(fresh ? 'auto.try.again' : 'auto.tryLead')}</Button></CanWrite>
              {fresh && data.leads.some((l) => l.id === fresh.leadId) && <A to={`/leads/${fresh.leadId}`} className="btn" data-testid="auto-try-open">{t('auto.try.open', { lead: fresh.name.split(' ')[0] })}</A>}
            </div>
            {fresh && !fresh.ran && <p className="small auto-try-off" role="status">{t('auto.try.off', { lead: fresh.name })}</p>}
          </Card>

          <Card title={<>{t('auto.history')}{runs.length > 0 && <span className="count">{runs.length}</span>}</>}>
            <div data-testid="auto-history">
              {!runs.length ? <p className="small muted auto-none"><LuZap aria-hidden="true" /><span>{ruleLine('auto.historyEmpty', t, lang)}</span></p> : (
                <ol className="auto-runs">
                  {shownRuns.map((run) => {
                    const isFresh = !!fresh && run.ref?.type === 'lead' && run.ref.id === fresh.leadId;
                    const rec = recordOf(data, run.ref);
                    const bad = run.status === 'failed'; const skip = run.status === 'skipped';
                    return (
                      <li key={run.id} className={cx('auto-run', isFresh && 'fresh', bad && 'bad')} ref={isFresh ? freshRef : undefined} data-run={run.ruleId} data-status={run.status ?? 'ok'} data-fresh={isFresh || undefined}>
                        <div className="auto-run-h"><b>{runRuleName(run.ruleId, inForce, shipped, t, lang)}</b>{isFresh ? <Badge tone="accent">{t('auto.justNow')}</Badge> : <time className="xs dim">{dateTime(run.at)}</time>}</div>
                        {(bad || skip) && <Badge tone={bad ? 'bad' : 'neutral'} outline>{t('auto.status.' + run.status)}</Badge>}
                        <ul>{run.steps.map((s, i) => <li key={i} className={bad && i === run.steps.length - 1 ? 'bad' : skip ? 'skip' : undefined} style={isFresh ? ({ '--i': i } as React.CSSProperties) : undefined}>{bad && i === run.steps.length - 1 ? <LuTriangleAlert aria-hidden="true" /> : <LuCheck aria-hidden="true" />}<span>{stepText(s, t, date)}</span></li>)}</ul>
                        {run.error && <p className="xs auto-why">{t('auto.hist.why', { why: t(run.error) })}</p>}
                        {run.ref && rec && <A to={refPath(run.ref)} className="small auto-link">{t('auto.open', { name: rec })}</A>}
                      </li>
                    );
                  })}
                </ol>
              )}
              {runs.length > shownRuns.length && <button type="button" className="linkbtn small auto-all" onClick={() => setAll(true)}>{t('auto.showAll', { n: runs.length })}</button>}
              {runs.length > 0 && <p className="auto-all-link"><A to="/automations/history" className="small auto-link">{t('auto.hist.all')}</A></p>}
            </div>
          </Card>

          <Note>
            <span className="auto-mail"><LuMail aria-hidden="true" /><span>{t('auto.emailNote')}{writesToClients ? ' ' + t('auto.draftsNote') : ''}</span></span>
            <span className="row auto-mail-row">{!app.live && <DemoTag />}{can('documents') && <A to="/messages" className="small auto-link">{t('auto.messages')}</A>}</span>
          </Note>
        </aside>
      </div>
    </div>
  );
}
