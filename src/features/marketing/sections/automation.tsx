// Automation drawn as circuitry: the trigger of a real rule on one side, a trace into a bus, and every step of the rule
// lighting up in order. The rules, their wording and their plan standing come from domain/automations.ts,
// the Automations wording and the entitlements; nothing here is written for the sales page only.
import { useState } from 'react';
import { LuMailCheck, LuZap } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { CircuitTrace, Reveal, useInView, usePrefersReducedMotion } from '@/brand';
import { ALWAYS_ON, RULES } from '@/domain/automations';
import { standing } from '@/domain/entitlements';
import { ruleLine, ruleName } from '@/features/automations/format';
import { planName } from '@/lib/pricing';
import { Badge, cx } from '@/ui';
import { DemoLink, Head } from './shared';
import './automation.css';

/** The three rules that tell the story of a job: a lead arrives, the lead is won, the work is finished. */
const SHOWN = ['lead-intake', 'lead-won', 'job-completed'];

export function AutomationSection() {
  const { t, pack, lang } = useApp();
  const reduced = usePrefersReducedMotion();
  const { ref, seen, visible } = useInView<HTMLDivElement>('0px 0px -18% 0px');
  const rules = SHOWN.map((id) => RULES.find((r) => r.id === id)).filter((r): r is (typeof RULES)[number] => !!r);
  // the won-lead rule opens the section: it is the one that touches the most records
  const [pick, setPick] = useState({ id: (rules.find((r) => r.id === 'lead-won') ?? rules[0])?.id ?? '', n: 0 });
  const rule = rules.find((r) => r.id === pick.id) ?? rules[0];
  if (!rule) return null;

  const has = (k: string) => t(k) !== k;
  const thens: string[] = [];
  for (let n = 1; n <= rule.thens && has(`auto.${rule.id}.then${n}`); n++) thens.push(ruleLine(`auto.${rule.id}.then${n}`, t, lang));
  // how the rule is sold, read for the entry plan so the answer does not depend on what the visitor previewed in the demo
  const s = rule.entitlement ? standing(rule.entitlement, pack.id, 0) : null;
  const fromPlan = s && s.state === 'upgrade' && s.plan ? planName(s.plan, lang) : null;
  const planNote = fromPlan && rule.entitlement === 'clientEmails' && has('auto.needsPlan') ? t('auto.needsPlan', { plan: fromPlan }) : null;
  const total = RULES.filter((r) => r.id !== 'compliance-watch' || pack.compliance).length + (pack.recurring ? ALWAYS_ON.length : 0);
  const state = reduced ? 'static' : seen ? 'run' : 'idle';

  return (
    <section className="mks mks-au" aria-labelledby="mks-au-h">
      <div className="mks-au-top">
        <Head id="mks-au-h" title={t('mk.s.au.h')} sub={t('mk.s.au.sub')} />
        <Reveal className="mks-au-pick" delay={140}>
          <div className="seg" role="group" aria-label={t('mk.s.au.pick')}>
            {rules.map((r) => (
              <button key={r.id} type="button" aria-pressed={r.id === rule.id} onClick={() => setPick((p) => ({ id: r.id, n: p.n + 1 }))} data-testid={`mk-au-rule-${r.id}`}>{ruleName(r.id, t)}</button>
            ))}
          </div>
        </Reveal>
      </div>

      <Reveal kind="panel">
        <div className="card premium mks-au-board" ref={ref} data-state={state} data-live={visible ? '' : undefined} data-testid="mk-au-board">
          {/* keyed by the rule and the number of picks, so choosing a rule plays its sequence again */}
          <div className="mks-au-flow" key={`${rule.id}-${pick.n}`} data-rule={rule.id}>
            <div className="mks-au-left">
              <div className="mks-au-when">
                <span className="mks-au-tag">{t('mk.s.when')}</span>
                <p>{ruleLine(`auto.${rule.id}.when`, t, lang)}</p>
                <small><LuZap aria-hidden="true" />{ruleName(rule.id, t)}</small>
                <i className="mks-au-port" aria-hidden="true" />
              </div>
              <p className="mks-au-plan">
                {fromPlan ? <Badge tone="warn" outline>{t('ent.fromPlan', { plan: fromPlan })}</Badge> : <Badge tone="ok">{t('mk.s.au.everyPlan')}</Badge>}
                {planNote && <span>{planNote}</span>}
              </p>
            </div>
            <div className="mks-au-wire" aria-hidden="true">
              <CircuitTrace className="h" viewBox="0 0 96 56" d="M0 28H38L50 40H96" />
              <CircuitTrace className="v" viewBox="0 0 22 30" d="M11 0V30" />
            </div>
            <div className="mks-au-then" style={{ ['--n' as string]: thens.length }}>
              <span className="mks-au-tag">{t('mk.s.then')}</span>
              <ol>
                {thens.map((x, i) => <li key={i} style={{ ['--i' as string]: i }}><i className="mks-au-node" aria-hidden="true" /><i className="mks-au-branch" aria-hidden="true" /><span>{x}</span></li>)}
              </ol>
            </div>
          </div>
          <div className="mks-au-foot">
            <p className="mks-au-honest"><LuMailCheck aria-hidden="true" />{t('mk.s.au.honest')}</p>
          </div>
        </div>
      </Reveal>

      <p className="mks-au-more">
        <span className="mks-fine">{t('mk.s.au.count', { shown: rules.length, n: total })}</span>
        <DemoLink to="/automations" testId="mk-au-demo">{t('mk.s.au.link')}</DemoLink>
      </p>
    </section>
  );
}
