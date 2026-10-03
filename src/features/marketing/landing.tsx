// Overview page. The story runs in the order a buyer asks questions: the promise and the product (hero), which industry
// (edition selector), why one system, what it replaces (the convergence), how work flows through it, then the deeper
// sections, the plans, how to ask for a demo and the close.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  LuBriefcase, LuCalendarDays, LuChartColumn, LuContactRound, LuFileText, LuHardHat, LuListChecks, LuMail, LuSheet,
  LuStickyNote, LuUserPlus, LuUsers, LuWallet, LuZap,
} from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Link } from '@/app/router';
import { PACK_LIST } from '@/packs';
import { RULES } from '@/domain/automations';
import { standing } from '@/domain/entitlements';
import { planName } from '@/lib/pricing';
import { BRAND } from '@/config/brand';
import { Arrow, Reveal, useInView, usePrefersReducedMotion } from '@/brand';
import { cx } from '@/ui';
import { ContactList, MkPage, scrollToSection, sectionOffBy, takePendingSection, usePageTitle } from './parts';
import { Hero } from './hero/hero';
import { Walkthrough } from './sections/walkthrough';
import { AiSection } from './sections/ai';
import { AutomationSection } from './sections/automation';
import { ConnectedSection } from './sections/connected';
import { EditionsSection } from './sections/editions';
import { CustomizationSection } from './sections/customization';
import { PlansOverview } from './sections/plans';
import { ClosingSection } from './sections/closing';

export function Landing({ notFound }: { notFound?: boolean }) {
  const { t } = useApp();
  usePageTitle(t('mk.title.home'));
  // arriving from "Product", "Industries" or "How it works" on another page, or with a section in the address
  // The page is long and some sections settle their height just after mounting, so: jump there, then keep the section in
  // place while the page above it is still settling (three seconds at most). It lets go the moment the visitor moves the
  // page: any input, a new address, or a scroll that no change of height explains.
  useEffect(() => {
    const id = takePendingSection(); if (!id) return;
    const main = document.getElementById('mk-main');
    let done = false, height = main?.scrollHeight ?? 0;
    const align = () => { if (done) return; height = main?.scrollHeight ?? 0; if ((sectionOffBy(id) ?? 0) > 6) scrollToSection(id, true); };
    const timers = [90, 500, 1200, 2400].map((ms) => window.setTimeout(align, ms));
    const ro = main && typeof ResizeObserver === 'function' ? new ResizeObserver(align) : null;
    if (ro && main) ro.observe(main);
    const events = ['wheel', 'touchstart', 'keydown', 'pointerdown', 'hashchange', 'popstate'] as const;
    const moved = () => { if ((sectionOffBy(id) ?? 0) > 6 && (main?.scrollHeight ?? 0) === height) stop(); };
    const stop = () => {
      done = true; timers.forEach(clearTimeout); ro?.disconnect();
      events.forEach((e) => window.removeEventListener(e, stop)); window.removeEventListener('scroll', moved);
    };
    timers.push(window.setTimeout(stop, 3000));
    events.forEach((e) => window.addEventListener(e, stop, { passive: true }));
    window.addEventListener('scroll', moved, { passive: true });
    return stop;
  }, []);
  return (
    <MkPage current="home">
      {notFound && <div className="mk-wrap"><p className="mk-404" role="status" data-testid="mk-notfound">{t('mk.notFound')}</p></div>}
      <Hero />
      <ValueStatement />
      <Converge />
      <Workflow />
      <div id="product" className="mk-anchor"><Walkthrough /></div>
      <AiSection />
      <AutomationSection />
      <ConnectedSection />
      <div id="industries" className="mk-anchor"><EditionsSection /></div>
      <CustomizationSection />
      <PlansOverview />
      <RequestBand />
      <ClosingSection />
    </MkPage>
  );
}

/* ---------- core value: one sentence, three facts about the product ---------- */
function ValueStatement() {
  const { t } = useApp();
  return (
    <section className="mk-value" aria-labelledby="mk-value-h">
      <div className="mk-wrap">
        <Reveal as="h2" className="mk-value-h" id="mk-value-h">{t('mk.value.h')}</Reveal>
        <ul className="mk-proof">
          {(['editions', 'workflows', 'roles'] as const).map((k, i) => (
            <Reveal as="li" key={k} delay={80 + i * 70}><b>{t(`mk.value.${k}.h`, { n: PACK_LIST.length })}</b><span>{t(`mk.value.${k}.p`)}</span></Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------- before and after: eight separate tools converge into one window as the visitor scrolls ---------- */
/** Each tool a small business juggles today, the screen that takes its place, and where it starts out on the stage (px and degrees). */
const TOOLS: { id: string; icon: ReactNode; to: string; x: number; y: number; r: number; s: number }[] = [
  { id: 'crm', icon: <LuContactRound aria-hidden="true" />, to: 'nav.leads', x: -58, y: -62, r: -7, s: 0.04 },
  { id: 'sheets', icon: <LuSheet aria-hidden="true" />, to: 'nav.money', x: -26, y: -128, r: 5, s: -0.05 },
  { id: 'email', icon: <LuMail aria-hidden="true" />, to: 'nav.messages', x: 6, y: -74, r: -4, s: 0.02 },
  { id: 'calendar', icon: <LuCalendarDays aria-hidden="true" />, to: 'nav.calendar', x: 20, y: -134, r: 8, s: -0.03 },
  { id: 'tasks', icon: <LuListChecks aria-hidden="true" />, to: 'nav.tasks', x: -60, y: 92, r: 6, s: -0.04 },
  { id: 'docs', icon: <LuFileText aria-hidden="true" />, to: 'nav.documents', x: -30, y: 132, r: -5, s: 0.05 },
  { id: 'notes', icon: <LuStickyNote aria-hidden="true" />, to: 'nav.jobs', x: 8, y: 70, r: 4, s: -0.02 },
  { id: 'reports', icon: <LuChartColumn aria-hidden="true" />, to: 'nav.reports', x: 22, y: 126, r: -8, s: 0.03 },
];
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const easeInOut = (n: number) => (n < 0.5 ? 4 * n * n * n : 1 - Math.pow(-2 * n + 2, 3) / 2);

function Converge() {
  const { t } = useApp();
  const reduced = usePrefersReducedMotion();
  const track = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);
  const [first, ...rest] = BRAND.platformName.split(' ');

  // Scroll-linked on wide screens only: the stage is pinned while the page scrolls through the track, and one number
  // (how far through) drives every transform and opacity. Phones and reduced motion get the finished picture.
  useEffect(() => {
    const el = track.current; if (!el || reduced || typeof matchMedia !== 'function') { setLive(false); return; }
    const wide = matchMedia('(min-width:981px) and (min-height:620px)');
    let raf = 0, last = -1;
    const set = () => {
      raf = 0;
      if (!wide.matches) return;
      const r = el.getBoundingClientRect();
      const pin = el.firstElementChild as HTMLElement | null;
      const span = Math.max(1, r.height - (pin?.offsetHeight ?? window.innerHeight));
      const top = parseFloat(getComputedStyle(pin ?? el).top) || 0;
      const raw = clamp01((top - r.top) / (span * 0.84));
      if (Math.abs(raw - last) < 0.0005) return;
      last = raw;
      const p = easeInOut(raw);
      el.style.setProperty('--p', p.toFixed(4));
      // the old names hand over to the new ones in the middle; the circuit joins the cells at the end
      const a = clamp01((p - 0.3) / 0.4);
      el.style.setProperty('--a', a.toFixed(4));
      el.style.setProperty('--b', (1 - a).toFixed(4));
      el.style.setProperty('--c', clamp01((p - 0.62) / 0.38).toFixed(4));
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(set); };
    const mode = () => {
      setLive(wide.matches); last = -1;
      if (wide.matches) on(); else ['--p', '--a', '--b', '--c'].forEach((k) => el.style.removeProperty(k));
    };
    mode();
    wide.addEventListener('change', mode);
    window.addEventListener('scroll', on, { passive: true }); window.addEventListener('resize', on);
    return () => {
      wide.removeEventListener('change', mode); window.removeEventListener('scroll', on); window.removeEventListener('resize', on);
      if (raf) cancelAnimationFrame(raf); ['--p', '--a', '--b', '--c'].forEach((k) => el.style.removeProperty(k));
    };
  }, [reduced]);

  return (
    <section className={cx('mk-conv', live && 'live')} aria-labelledby="mk-conv-h">
      <div className="mk-conv-track" ref={track}>
        <div className="mk-conv-pin">
          <div className="mk-wrap mk-conv-in">
            <div className="mk-conv-copy">
              <div className="mk-conv-before">
                <h2 id="mk-conv-h">{t('mk.conv.before.h')}</h2>
                <p>{t('mk.conv.before.p')}</p>
              </div>
              <div className="mk-conv-after">
                <h3>{t('mk.conv.after.h', { name: BRAND.platformName })}</h3>
                <p>{t('mk.conv.after.p')}</p>
              </div>
            </div>

            <div className="mk-conv-stage">
              <div className="mk-conv-shell" aria-hidden="true">
                <div className="mk-conv-bar"><span className="mk-conv-word"><span className="chrome-text">{first.toUpperCase()}</span>{rest.length > 0 && <> <span className="brand-text">{rest.join(' ').toUpperCase()}</span></>}</span><i /><i /><i /></div>
              </div>
              <div className="mk-conv-cells">
              <ul className="mk-conv-grid">
                {TOOLS.map((tool) => (
                  <li key={tool.id} className="mk-tool" style={{ '--x': tool.x + 'px', '--y': tool.y + 'px', '--r': tool.r + 'deg', '--s': tool.s } as React.CSSProperties}>
                    <span className="mk-tool-i">{tool.icon}</span>
                    <span className="mk-tool-n">
                      <b className="from">{t(`mk.conv.${tool.id}`)}</b>
                      <b className="to"><span className="sr">{t('mk.conv.becomes')} </span>{t(tool.to)}</b>
                    </span>
                    <small>{t(`mk.conv.${tool.id}.p`)}</small>
                  </li>
                ))}
              </ul>
              <svg className="mk-conv-bus" viewBox="0 0 800 28" preserveAspectRatio="none" fill="none" aria-hidden="true">
                <path d="M100 14H700M100 0V28M300 0V28M500 0V28M700 0V28" pathLength={100} vectorEffect="non-scaling-stroke" />
              </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- the operating workflow: one line from the first call to the report, with what the system does by itself at each stop ---------- */
type RuleUse = { id: string; thens?: number[]; when?: 'recurring' | 'compliance' };
const STOPS: { id: string; icon: ReactNode; rules: RuleUse[] }[] = [
  { id: 'lead', icon: <LuUserPlus aria-hidden="true" />, rules: [{ id: 'lead-intake' }, { id: 'visit-prep' }, { id: 'estimate-follow-up' }] },
  { id: 'client', icon: <LuUsers aria-hidden="true" />, rules: [{ id: 'lead-won', thens: [1, 2] }] },
  { id: 'job', icon: <LuBriefcase aria-hidden="true" />, rules: [{ id: 'lead-won', thens: [3, 4] }, { id: 'recurring-visits', when: 'recurring' }] },
  { id: 'team', icon: <LuHardHat aria-hidden="true" />, rules: [{ id: 'job-started' }, { id: 'compliance-watch', when: 'compliance' }] },
  { id: 'docs', icon: <LuFileText aria-hidden="true" />, rules: [{ id: 'job-completed' }] },
  { id: 'pay', icon: <LuWallet aria-hidden="true" />, rules: [{ id: 'payment-posted' }] },
  { id: 'report', icon: <LuChartColumn aria-hidden="true" />, rules: [] },
];

function Workflow() {
  const { t, pack, lang } = useApp();
  const { ref, seen } = useInView<HTMLDivElement>();
  const [sel, setSel] = useState(0);
  const has = (k: string) => t(k) !== k;
  /** The rule as the Automations page words it: when it starts and what it then does. Rules the edition does not use are left out. */
  const rule = (use: RuleUse) => {
    if (use.when === 'recurring' && !pack.recurring) return null;
    if (use.when === 'compliance' && !pack.compliance) return null;
    if (!has(`auto.${use.id}.when`)) return null;
    const thens: string[] = [];
    for (let n = 1; n <= 6 && has(`auto.${use.id}.then${n}`); n++) if (!use.thens || use.thens.includes(n)) thens.push(t(`auto.${use.id}.then${n}`));
    const ent = RULES.find((r) => r.id === use.id)?.entitlement;
    const s = ent ? standing(ent, pack.id, 0) : null;
    const from = s && s.state === 'upgrade' && s.plan ? planName(s.plan, lang) : null;
    // the Automations page has the exact sentence for the part of a rule that depends on the plan
    const key = ent === 'clientEmails' ? 'auto.needsPlan' : `auto.needsPlan.${ent}`;
    const emailStep = !use.thens || use.thens.some((n) => /mail|correo/i.test(t(`auto.${use.id}.then${n}`)));
    const plan = from && has(key) && (ent !== 'clientEmails' || emailStep) ? t(key, { plan: from }) : null;
    return { key: use.id + (use.thens?.join('') ?? ''), when: t(`auto.${use.id}.when`), thens, plan };
  };
  const stops = STOPS.map((s) => ({ ...s, auto: s.rules.map(rule).filter((r): r is NonNullable<ReturnType<typeof rule>> => !!r) }));
  const auto = (s: (typeof stops)[number]) => (
    <>
      <p className="mk-wf-auto-h"><LuZap aria-hidden="true" />{t('mk.wf.auto')}</p>
      {s.auto.length ? (
        <div className="mk-wf-rules">
          {s.auto.map((r) => (
            <div className="mk-wf-rule" key={r.key}>
              <p><span>{t('auto.when')}</span>{r.when}</p>
              <ul>{r.thens.map((x, n) => <li key={n}>{x}</li>)}</ul>
              {r.plan && <p className="mk-wf-plan">{r.plan}</p>}
            </div>
          ))}
        </div>
      ) : <p className="mk-wf-none">{t(`mk.wf.${s.id}.auto`)}</p>}
    </>
  );
  const cur = stops[sel];
  return (
    <section className="mk-sec mk-wf" id="how-it-works" aria-labelledby="mk-wf-h">
      <div className="mk-wrap">
        <Reveal className="mk-sec-h"><h2 id="mk-wf-h">{t('mk.wf.h')}</h2><p>{t('mk.wf.sub')}</p></Reveal>
        <div className={cx('mk-wf-body', seen && 'in')} ref={ref} style={{ '--sel': sel, '--n': stops.length } as React.CSSProperties}>
          <ol className="mk-wf-rail">
            {stops.map((s, i) => (
              <li key={s.id} className={cx(i === sel && 'on')} style={{ '--i': i } as React.CSSProperties}>
                <button type="button" aria-pressed={i === sel} onClick={() => setSel(i)} onMouseEnter={() => setSel(i)} onFocus={() => setSel(i)} data-testid={`mk-wf-${s.id}`}>
                  <span className="mk-wf-node" aria-hidden="true">{i + 1}</span>
                  <span className="mk-wf-name">{t(`mk.wf.${s.id}.h`)}</span>
                  <span className="mk-wf-p">{t(`mk.wf.${s.id}.p`)}</span>
                </button>
                <div className="mk-wf-inline">{auto(s)}</div>
              </li>
            ))}
          </ol>
          <div className="mk-wf-panel" aria-live="polite">
            <p className="mk-wf-at"><span>{sel + 1}</span>{cur.icon}{t(`mk.wf.${cur.id}.h`)}</p>
            {auto(cur)}
          </div>
        </div>
        <p className="mk-fine">{t('mk.wf.note')}</p>
      </div>
    </section>
  );
}

/* ---------- request a demo: what happens next and how to reach the company ---------- */
function RequestBand() {
  const { t } = useApp();
  return (
    <section className="mk-sec mk-req" aria-labelledby="mk-req-h">
      <div className="mk-wrap">
        <Reveal className="mk-req-in">
          <div className="mk-req-main">
            <h2 id="mk-req-h">{t('mk.req.h')}</h2>
            <p>{t('mk.req.p')}</p>
            <ol className="mk-req-steps">
              {[1, 2, 3].map((n) => <li key={n}><span aria-hidden="true">{n}</span><div><b>{t(`mk.req.s${n}.h`)}</b><p>{t(`mk.req.s${n}.p`)}</p></div></li>)}
            </ol>
          </div>
          <div className="mk-req-side">
            <h3>{t('mk.req.contact')}</h3>
            <ContactList />
            <Link to="/request-demo" className="btn primary lg" data-testid="mk-req-request">{t('mk.cta.request')}<Arrow /></Link>
            <Link to="/demo" className="mk-tlink" data-testid="mk-req-demo">{t('mk.req.look')}</Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
