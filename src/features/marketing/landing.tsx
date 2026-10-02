// Overview page. The page itself switches industry: one picker changes the headline, the product name,
// the examples and a live preview built from the real sample business of that edition.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  LuBriefcase, LuCalendarDays, LuChartColumn, LuFileText, LuFlaskConical, LuHardHat, LuListChecks, LuShieldCheck, LuUserPlus, LuUsers, LuWallet, LuZap,
} from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Link, appPath, asset } from '@/app/router';
import { JobStatusBadge } from '@/app/shared';
import { switchPack } from '@/store/store';
import { PACK_LIST } from '@/packs';
import type { IndustryPack, KpiId } from '@/packs/types';
import type { LeadStage } from '@/domain/types';
import { calendarEvents, byId, isActiveJob, isOpenLead, jobMoney, kpiValues } from '@/domain/selectors';
import { RULES } from '@/domain/automations';
import { ENTITLEMENTS, standing, type EntitlementId } from '@/domain/entitlements';
import { planName, plansFor } from '@/lib/pricing';
import { addOnViews, planFeatures, planSupport, type AddOnView } from '@/lib/pricing-view';
import { money, sum } from '@/lib/money';
import { today } from '@/lib/dates';
import { BRAND } from '@/config/brand';
import { Avatar, Badge, MoneyBar, cx, type Tone } from '@/ui';
import { ContactList, Frame, MkPage, ProductName, SecHead, Swap, editionWord, usePageTitle } from './parts';

export function Landing({ notFound }: { notFound?: boolean }) {
  const { t } = useApp();
  usePageTitle(t('mk.title.home'));
  return (
    <MkPage current="home">
      {notFound && <div className="mk-wrap"><p className="mk-404" role="status" data-testid="mk-notfound">{t('mk.notFound')}</p></div>}
      <Hero />
      <Flow />
      <Editions />
      <Categories />
      <Start />
      <Closing />
    </MkPage>
  );
}

/* ---------- hero: industry picker, headline and live preview, joined by one circuit trace ---------- */
interface Trace { w: number; h: number; main: string; branch: string; start: [number, number]; end: [number, number]; tap: [number, number] }

function Hero() {
  const { t, pack, lang } = useApp();
  const root = useRef<HTMLElement>(null);
  const chips = useRef<Record<string, HTMLElement | null>>({});
  const band = useRef<HTMLDivElement>(null);
  const edition = useRef<HTMLParagraphElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [trace, setTrace] = useState<Trace | null>(null);
  // The trace draws itself slowly once, on load, and quickly whenever the industry changes.
  const [run, setRun] = useState({ id: pack.id, n: 0 });
  if (run.id !== pack.id) setRun({ id: pack.id, n: run.n + 1 });

  useLayoutEffect(() => {
    const measure = () => {
      const r0 = root.current, c0 = chips.current[pack.id], b0 = band.current, e0 = edition.current, f0 = frame.current;
      if (!r0 || !c0 || !b0 || !e0 || !f0) return;
      const r = r0.getBoundingClientRect(), c = c0.getBoundingClientRect(), b = b0.getBoundingClientRect(), e = e0.getBoundingClientRect(), f = f0.getBoundingClientRect();
      const px = (n: number) => Math.round(n * 2) / 2;
      const k = 9; // length of the 45 degree corners
      const nx = px(c.left + c.width / 2 - r.left); let ny = px(c.bottom - r.top) + 4; // the node under the selected chip
      let sx = nx, sy = ny, lead = '';
      const g0 = c0.parentElement;
      if (g0) {
        // The picker wraps into rows on narrower screens. From an upper row the trace runs along the gap between rows and down the gap between columns.
        const g = g0.getBoundingClientRect(); const cs = getComputedStyle(g0);
        const colGap = parseFloat(cs.columnGap) || 0, rowGap = parseFloat(cs.rowGap) || 0;
        if (g.bottom - c.bottom > 4 && rowGap >= 8) {
          ny = px(c.bottom - r.top + rowGap / 2); sy = ny;
          sx = px((c.right + colGap < g.right ? c.right + colGap / 2 : c.left - colGap / 2) - r.left);
          lead = `M${nx} ${ny}H${sx}`;
        }
      }
      const by = px(b.top + b.height / 2 - r.top);
      const ex = px(e.left - r.left) + 5, ey = px(e.top - r.top + Math.min(e.height / 2, 13)); // level with the first line of the product name
      const ty = px(f.top - r.top);
      const stacked = f.top > e.bottom; // phone and tablet: the preview sits under the copy
      let tx: number; let main: string;
      if (stacked) {
        tx = px(f.right - r.left) - 64;
        const g = px(r.width) - 7, jy = ty - 24; // run down the right gutter, then step into the frame
        main = `${lead || `M${sx} ${sy}`}V${by - k}L${sx + k} ${by}H${g - k}L${g} ${by + k}V${jy - k}L${g - k} ${jy}H${tx + k}L${tx} ${jy + k}V${ty}`;
      } else {
        tx = px(f.left - r.left) + 72;
        const dir = tx >= sx ? 1 : -1;
        const head = lead || `M${sx} ${sy}`;
        if (Math.abs(tx - sx) < 2 * k + 4) { tx = sx; main = `${head}V${ty}`; }
        else main = `${head}V${by - k}L${sx + dir * k} ${by}H${tx - dir * k}L${tx} ${by + k}V${ty}`;
      }
      const from = !stacked && tx < sx ? `M${tx + k} ${by}` : `M${sx} ${by - k}L${sx - k} ${by}`;
      const branch = `${from}H${ex + k}L${ex} ${by + k}V${ey - 5}`;
      setTrace({ w: px(r.width), h: px(r.height), main, branch, start: [nx, ny], end: [tx, ty], tap: [ex, ey] });
    };
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (ro && root.current) ro.observe(root.current);
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
  }, [pack.id, lang]);

  return (
    <section className="mk-hero mk-wrap" ref={root} aria-labelledby="mk-h1">
      {trace && (
        <svg className="mk-trace" width={trace.w} height={trace.h} viewBox={`0 0 ${trace.w} ${trace.h}`} aria-hidden="true" focusable="false">
          <g key={pack.id} className={cx('mk-trace-run', run.n > 0 && 'again')}>
            {/* each line is drawn twice: a wide faint stroke for the glow, then the crisp trace (no CSS filter, which is costly on a layer this large) */}
            <path className="mk-trace-branch glow" d={trace.branch} pathLength={1} />
            <path className="mk-trace-branch" d={trace.branch} pathLength={1} />
            <path className="mk-trace-main glow" d={trace.main} pathLength={1} />
            <path className="mk-trace-main" d={trace.main} pathLength={1} />
            <circle className="mk-node ring" cx={trace.start[0]} cy={trace.start[1]} r={3.5} />
            <circle className="mk-node ring late" cx={trace.tap[0]} cy={trace.tap[1]} r={3.5} />
            <circle className="mk-node dot late" cx={trace.end[0]} cy={trace.end[1]} r={3.5} />
          </g>
        </svg>
      )}

      <div className="mk-pick">
        <p id="mk-pick-l" className="mk-pick-l">{t('mk.hero.pick')}</p>
        <div className="mk-chips" role="group" aria-labelledby="mk-pick-l">
          {PACK_LIST.map((p) => (
            <button key={p.id} type="button" className="mk-chip" aria-pressed={p.id === pack.id} onClick={() => switchPack(p.id)} title={p.label[lang]}
              aria-label={`${p.product}, ${p.label[lang]}`} data-testid={`mk-industry-${p.id}`} ref={(el: HTMLElement | null) => { chips.current[p.id] = el; }}>
              <span className="mk-chip-in"><b>{editionWord(p)}</b><small>{p.label[lang]}</small></span>
            </button>
          ))}
        </div>
      </div>
      <div className="mk-band" ref={band} aria-hidden="true" />

      <div className="mk-hero-grid">
        <div className="mk-hero-copy">
          <p className="mk-edition" ref={edition} aria-live="polite"><ProductName pack={pack} /><span className="mk-edition-l">{pack.label[lang]}</span></p>
          <h1 id="mk-h1" className={cx(run.n > 0 && 'again')}>
            <span key={pack.id + '-a'}><Swap t={t} k="mk.hero.h1a" token="job" /></span>{' '}
            <span key={pack.id + '-b'}><Swap t={t} k="mk.hero.h1b" token="worker" /></span>{' '}
            <span>{t('mk.hero.h1c')}</span>
          </h1>
          <p className="mk-lede"><strong>{pack.blurb[lang]}</strong> {t('mk.hero.lede')}</p>
          <div className="mk-cta">
            <Link to="/demo" className="mk-btn primary" data-testid="mk-open-demo">{t('mk.cta.demo')}</Link>
            <span className="mk-cta-links">
              <Link to="/pricing" className="mk-link" data-testid="mk-pricing">{t('mk.cta.pricing')}</Link>
              <Link to="/request-demo" className="mk-link" data-testid="mk-request">{t('mk.cta.request')}</Link>
            </span>
          </div>
          <p className="mk-fine">{t('mk.hero.fine')}</p>
        </div>
        <div className="mk-preview-slot" ref={frame}><Preview /></div>
      </div>
    </section>
  );
}

/* ---------- live preview: the real sample business of the selected edition, drawn with the product's own components ---------- */
const MONEY_KPIS: KpiId[] = ['activeValue', 'expectedProfit', 'clientsOwe', 'oweWorkers', 'pipelineValue', 'collectedMonth'];
/** Label of each dashboard figure. The first five reuse the wording every industry pack already defines. */
const KPI_LABEL: Record<KpiId, string> = {
  activeJobs: 'activeProjects', activeValue: 'contractValue', expectedProfit: 'expProfit', clientsOwe: 'clientsOwe', oweWorkers: 'oweSubs',
  newLeads: 'mk.kpi.newLeads', pipelineValue: 'mk.kpi.pipelineValue', visitsThisWeek: 'mk.kpi.visitsThisWeek', overdueTasks: 'mk.kpi.overdueTasks',
  recurringClients: 'mk.kpi.recurringClients', collectedMonth: 'mk.kpi.collectedMonth',
};
const OPEN_STAGES: LeadStage[] = ['new', 'contacted', 'scheduled', 'sent'];

function Preview() {
  const { t, data, pack, day, time } = useApp();
  const kpi = kpiValues(data);
  const upcoming = calendarEvents(data, 30).filter((e) => e.date >= today() && !e.done).slice(0, 5);
  const openLeads = data.leads.filter(isOpenLead);
  const active = data.jobs.filter(isActiveJob).slice(0, 2);
  const kindLabel = (kind: string) => t('ev_' + (kind === 'visit' ? 'start' : kind));
  return (
    <Frame className="mk-preview" role="region" aria-label={t('mk.prev.label')}>
      <div className="mk-win-h">
        <Avatar name={data.company.name} accent />
        <div className="grow"><b>{data.company.name}</b><small>{pack.product}</small></div>
      </div>
      <p className="mk-win-tag"><LuFlaskConical aria-hidden="true" />{t('mk.prev.tag')}</p>
      <div className="mk-win-b" key={pack.id}>
        <div className="mk-win-kpis">
          {pack.kpis.slice(0, 4).map((id) => (
            <div className="kpi" key={id}><div className="k">{t(KPI_LABEL[id])}</div><div className="v">{MONEY_KPIS.includes(id) ? money(kpi[id]) : kpi[id]}</div></div>
          ))}
        </div>
        <div className="mk-win-cols">
          <section aria-labelledby="mk-prev-next">
            <h3 id="mk-prev-next">{t('mk.prev.next')}</h3>
            {upcoming.length ? (
              <ul className="mk-win-list">
                {upcoming.map((e) => (
                  <li key={e.id}>
                    <span className="mk-win-when">{e.date === today() ? t('common.today') : day(e.date)}{e.time ? <small>{time(e.time)}</small> : null}</span>
                    <span className="grow"><span className="t clip">{e.title}</span><small className="clip">{kindLabel(e.kind)}{e.sub ? ', ' + e.sub : ''}</small></span>
                  </li>
                ))}
              </ul>
            ) : <p className="muted small">{t('noEvents')}</p>}
          </section>
          <div className="mk-win-side">
            <section aria-labelledby="mk-prev-leads">
              <h3 id="mk-prev-leads">{t('mk.prev.leads')}<span className="num">{money(sum(openLeads, (l) => l.value))}</span></h3>
              {openLeads.length ? (
                <ul className="mk-win-stages">
                  {OPEN_STAGES.map((s) => { const n = openLeads.filter((l) => l.status === s).length; return <li key={s} className={cx(!n && 'zero')}><b>{n}</b><span>{t('ls_' + s)}</span></li>; })}
                </ul>
              ) : <p className="muted small">{t('mk.prev.noLeads')}</p>}
            </section>
            <section aria-labelledby="mk-prev-jobs">
              <h3 id="mk-prev-jobs">{t('activeList')}</h3>
              {active.length ? (
                <ul className="mk-win-jobs">
                  {active.map((j) => {
                    const m = jobMoney(data, j); const label = t('mk.prev.received', { paid: money(m.received), total: money(m.price) });
                    return (
                      <li key={j.id}>
                        <Link to={appPath('/jobs/' + j.id)} className="mk-win-job">
                          <span className="mk-win-job-h"><span className="t clip">{j.name}</span><JobStatusBadge status={j.status} /></span>
                          <small className="clip">{byId(data.clients, j.clientId)?.name}</small>
                          <MoneyBar parts={[{ value: m.received, cls: 's4', label }]} total={m.price} label={label} />
                          <small>{label}</small>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="muted small">{t('mk.prev.noJobs')}</p>}
            </section>
          </div>
        </div>
      </div>
      <div className="mk-win-f"><span>{t('mk.prev.foot')}</span><Link to="/demo" className="linkbtn" data-testid="mk-preview-open">{t('mk.prev.open')}</Link></div>
    </Frame>
  );
}

/* ---------- what it runs: the real path of a job, with the screens and the automation rules behind each step ---------- */
type ModId = 'leads' | 'calendar' | 'clients' | 'jobs' | 'tasks' | 'team' | 'documents' | 'payments' | 'reports' | 'compliance';
const MODS: Record<ModId, { to: string; label: string; icon: ReactNode }> = {
  leads: { to: '/leads', label: 'nav.leads', icon: <LuUserPlus aria-hidden="true" /> },
  calendar: { to: '/calendar', label: 'nav.calendar', icon: <LuCalendarDays aria-hidden="true" /> },
  clients: { to: '/clients', label: 'nav.clients', icon: <LuUsers aria-hidden="true" /> },
  jobs: { to: '/jobs', label: 'nav.jobs', icon: <LuBriefcase aria-hidden="true" /> },
  tasks: { to: '/tasks', label: 'nav.tasks', icon: <LuListChecks aria-hidden="true" /> },
  team: { to: '/team', label: 'nav.team', icon: <LuHardHat aria-hidden="true" /> },
  documents: { to: '/documents', label: 'nav.documents', icon: <LuFileText aria-hidden="true" /> },
  payments: { to: '/payments', label: 'nav.money', icon: <LuWallet aria-hidden="true" /> },
  reports: { to: '/reports', label: 'nav.reports', icon: <LuChartColumn aria-hidden="true" /> },
  compliance: { to: '/compliance', label: 'nav.compliance', icon: <LuShieldCheck aria-hidden="true" /> },
};
/** Each step names the screens that handle it and the automation rules (domain/automations.ts) that fire during it. */
const STEPS: { id: string; mods: ModId[]; rules: string[] }[] = [
  { id: 's1', mods: ['leads', 'calendar'], rules: ['lead-intake', 'visit-prep'] },
  { id: 's2', mods: ['leads', 'clients', 'jobs'], rules: ['estimate-follow-up', 'lead-won'] },
  { id: 's3', mods: ['jobs', 'tasks', 'calendar', 'team'], rules: ['job-started', 'recurring-visits'] },
  { id: 's4', mods: ['documents', 'payments'], rules: ['job-completed', 'payment-posted'] },
  { id: 's5', mods: ['team', 'compliance', 'reports'], rules: ['compliance-watch'] },
];

function Flow() {
  const { t, pack, lang } = useApp();
  const has = (k: string) => t(k) !== k;
  /** The rule as the Automations page words it: when it starts and what it then does. Rules the edition does not use are left out. */
  const rule = (id: string) => {
    if (id === 'recurring-visits' && !pack.recurring) return null;
    if (id === 'compliance-watch' && !pack.compliance) return null;
    if (!has(`auto.${id}.when`)) return null;
    const thens: string[] = [];
    for (let n = 1; n <= 6 && has(`auto.${id}.then${n}`); n++) thens.push(t(`auto.${id}.then${n}`));
    const ent = RULES.find((r) => r.id === id)?.entitlement;
    const s = ent ? standing(ent, pack.id, 0) : null;
    const from = s && s.state === 'upgrade' && s.plan ? planName(s.plan, lang) : null;
    // Only the email of these rules depends on the plan; the Automations page has the exact sentence for that.
    const emailOnly = from && ent === 'clientEmails' && has('auto.needsPlan') ? t('auto.needsPlan', { plan: from }) : null;
    return { id, when: t(`auto.${id}.when`), thens, from, emailOnly };
  };
  return (
    <section className="mk-sec" aria-labelledby="mk-flow-h">
      <div className="mk-wrap">
        <SecHead id="mk-flow-h" title={t('mk.flow.h')} sub={t('mk.flow.sub')} />
        <ol className="mk-flow">
          {STEPS.map((s, i) => {
            const rules = s.rules.map(rule).filter((r): r is NonNullable<ReturnType<typeof rule>> => !!r);
            const mods = s.mods.filter((m) => m !== 'compliance' || pack.compliance);
            return (
              <li key={s.id}>
                <span className="mk-flow-n" aria-hidden="true">{i + 1}</span>
                <div className="mk-flow-main">
                  <h3>{t(`mk.flow.${s.id}.h`)}</h3>
                  <p>{t(`mk.flow.${s.id}.p`)}</p>
                  <p className="mk-mods"><span className="sr">{t('mk.flow.screens')}: </span>
                    {mods.map((m) => <Link key={m} to={appPath(MODS[m].to)} className="mk-mod">{MODS[m].icon}{t(MODS[m].label)}</Link>)}
                  </p>
                </div>
                {rules.length > 0 && (
                  <div className="mk-flow-auto">
                    <h4><LuZap aria-hidden="true" />{t('mk.flow.auto')}</h4>
                    <div className="mk-rules">
                      {rules.map((r) => (
                        <div className="mk-rule" key={r.id}>
                          <p>{r.when}</p>
                          <ul>{r.thens.map((x, n) => <li key={n}>{x}</li>)}</ul>
                          {r.emailOnly ? <p className="mk-rule-plan">{r.emailOnly}</p> : r.from && <Badge tone="warn" outline>{t('ent.fromPlan', { plan: r.from })}</Badge>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        <p className="mk-fine">{t('mk.flow.note')}</p>
      </div>
    </section>
  );
}

/* ---------- the editions ---------- */
function Editions() {
  const { t, pack, lang } = useApp();
  const services = (p: IndustryPack) => p.serviceTypes.filter((s) => s.id !== 'other').slice(0, 4).map((s) => s[lang]).join(', ');
  return (
    <section className="mk-sec" aria-labelledby="mk-ed-h">
      <div className="mk-wrap">
        <SecHead id="mk-ed-h" title={t('mk.ed.h')} sub={t('mk.ed.sub')} />
        <ul className="mk-eds">
          {PACK_LIST.map((p) => (
            <li key={p.id} className={cx('mk-ed', p.id === pack.id && 'on')}>
              <h3><ProductName pack={p} /><span>{p.label[lang]}</span></h3>
              <p className="mk-ed-for">{p.blurb[lang]}</p>
              <p className="mk-ed-types"><span className="sr">{t('mk.ed.services')}: </span>{services(p)}</p>
              <Link to="/demo" onClick={() => switchPack(p.id)} className="mk-btn sm" aria-label={t('mk.ed.openIn', { name: p.product })} data-testid={`mk-edition-${p.id}`}>{t('mk.ed.open')}</Link>
            </li>
          ))}
        </ul>
        <p className="mk-ed-more">{t('mk.ed.more')} <Link to="/request-demo" className="linkbtn">{t('mk.ed.ask')}</Link></p>
      </div>
    </section>
  );
}

/* ---------- included, add-on, usage, custom: real examples from the entitlements and the add-on list ---------- */
const INCLUDED_EXAMPLES: EntitlementId[] = ['core', 'workerPortal', 'profitReports'];

function Categories() {
  const { t, pack, lang } = useApp();
  const plans = plansFor(pack.id);
  const included = INCLUDED_EXAMPLES.map((id) => {
    const e = ENTITLEMENTS[id]; if (e.kind !== 'plan') return null;
    const plan = plans[e.tier]; const at = plan.features.indexOf(e.source);
    return at < 0 ? null : { id, text: planFeatures(plan, pack.id, lang, t)[at], note: e.tier === 0 ? t('mk.cat.every') : t('mk.cat.from', { plan: planName(plan, lang) }) };
  }).filter((x): x is { id: EntitlementId; text: string; note: string } => !!x);
  const views = addOnViews(pack.id, lang, t);
  const priced = (a: AddOnView) => (a.price ? `${a.price}${a.billing ? ' ' + a.billing : ''}` : a.notBuilt ? t('mk.quoted') : a.note || '');
  const cols: { key: 'included' | 'addon' | 'usage' | 'custom'; tone: Tone; outline?: boolean; rows: { id: string; text: string; note: string; notBuilt?: boolean }[] }[] = [
    { key: 'included', tone: 'ok', rows: included },
    { key: 'addon', tone: 'violet', rows: views.filter((a) => a.kind === 'addon').map((a) => ({ id: a.id, text: a.name, note: priced(a) })) },
    { key: 'usage', tone: 'info', rows: views.filter((a) => a.kind === 'usage').map((a) => ({ id: a.id, text: a.name, note: priced(a) })) },
    { key: 'custom', tone: 'violet', outline: true, rows: views.filter((a) => a.kind === 'custom').map((a) => ({ id: a.id, text: a.name, note: priced(a), notBuilt: a.notBuilt })) },
  ];
  return (
    <section className="mk-sec" aria-labelledby="mk-cat-h">
      <div className="mk-wrap">
        <SecHead id="mk-cat-h" title={t('mk.cat.h')} sub={t('mk.cat.sub')} />
        <div className="mk-cats">
          {cols.map((c) => (
            <div className="mk-cat" key={c.key}>
              <h3><Badge tone={c.tone} outline={c.outline}>{t('ent.' + c.key)}</Badge></h3>
              <p className="mk-cat-p">{t(`mk.cat.${c.key}.p`)}</p>
              <ul>
                {c.rows.map((r) => (
                  <li key={r.id}><span>{r.text}{r.notBuilt && <> <Badge tone="warn" outline>{t('mk.notBuilt')}</Badge></>}</span><small>{r.note}</small></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mk-sec-link"><Link to="/pricing" className="linkbtn" data-testid="mk-cat-pricing">{t('mk.cat.link')}</Link></p>
      </div>
    </section>
  );
}

/* ---------- getting started: only what the pricing file says ---------- */
function Start() {
  const { t, pack, lang } = useApp();
  const plans = plansFor(pack.id);
  const top = plans[plans.length - 1];
  const templates = ENTITLEMENTS.emailTemplates;
  const at = top.features.indexOf(templates.source);
  const setupLine = at >= 0 ? planFeatures(top, pack.id, lang, t)[at] : null;
  return (
    <section className="mk-sec" aria-labelledby="mk-start-h">
      <div className="mk-wrap mk-start">
        <SecHead id="mk-start-h" title={t('mk.start.h')} sub={t('mk.start.sub')} />
        <dl className="mk-facts">
          <div>
            <dt>{t('mk.start.setup')}</dt>
            <dd>
              <ul className="mk-fact-plans">{plans.map((p) => <li key={p.id}><span>{planName(p, lang)}</span><b>{money(p.setup)}</b></li>)}</ul>
              <p>{t('mk.start.setupNote')}</p>
            </dd>
          </div>
          {setupLine && <div><dt>{t('mk.start.during')}</dt><dd><p>{t('mk.start.onPlan', { plan: planName(top, lang), line: setupLine })}</p></dd></div>}
          <div>
            <dt>{t('mk.start.support')}</dt>
            <dd><ul className="mk-fact-plans wide">{plans.map((p) => <li key={p.id}><span>{planName(p, lang)}</span><b>{planSupport(p, pack.id, lang, t)}</b></li>)}</ul></dd>
          </div>
          <div>
            <dt>{t('mk.start.billing')}</dt>
            <dd><p>{t('mk.start.billingNote')} {t('price.r.lines')}</p><p>{t('price.r.methods')}</p></dd>
          </div>
          <div>
            <dt>{t('mk.start.contact')}</dt>
            <dd><ContactList /></dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

/* ---------- closing ---------- */
function Closing() {
  const { t, lang } = useApp();
  return (
    <section className="mk-close" aria-labelledby="mk-close-h">
      <div className="mk-wrap mk-close-in">
        <div>
          <h2 id="mk-close-h">{BRAND.promise[lang].split(/(?<=\.)\s+/).map((line, i) => <span key={i} className="mk-chrome">{line} </span>)}</h2>
          <p>{t('mk.close.p')}</p>
          <div className="mk-cta">
            <Link to="/demo" className="mk-btn primary" data-testid="mk-close-demo">{t('mk.cta.demo')}</Link>
            <Link to="/request-demo" className="mk-btn" data-testid="mk-close-request">{t('mk.cta.request')}</Link>
          </div>
        </div>
        <img className="mk-close-mark" src={asset('brand/vyntex-mark.jpg')} alt="" width={440} height={347} />
      </div>
    </section>
  );
}
