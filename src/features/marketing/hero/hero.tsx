// The hero of the overview: the message, the signature scene (the dimensional V behind the product window) and the industry
// edition selector underneath. Choosing an edition lights its card, runs a circuit trace up to the window and cross-fades
// the wording and the sample business to that industry.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  LuBriefcase, LuDroplets, LuHardHat, LuKeyRound, LuSnowflake, LuSparkles, LuTent, LuTrees, LuTruck,
} from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Link } from '@/app/router';
import { switchPack } from '@/store/store';
import { PACK_LIST } from '@/packs';
import type { TFn } from '@/i18n';
import { BRAND } from '@/config/brand';
import { Arrow, VMark3D, usePrefersReducedMotion } from '@/brand';
import { cx } from '@/ui';
import { editionWord } from '../parts';
import { ProductWindow } from './window';

/** A small picture for each edition card. An edition without one gets the general icon. */
const EDITION_ICON: Record<string, ReactNode> = {
  build: <LuHardHat aria-hidden="true" />, clean: <LuSparkles aria-hidden="true" />, landscape: <LuTrees aria-hidden="true" />, wash: <LuDroplets aria-hidden="true" />,
  haul: <LuTruck aria-hidden="true" />, snow: <LuSnowflake aria-hidden="true" />, turnover: <LuKeyRound aria-hidden="true" />, events: <LuTent aria-hidden="true" />,
};

/** A sentence with the industry's own words set apart, so the visitor sees what the edition selector changes. */
function Worded({ t, k, tokens }: { t: TFn; k: string; tokens: string[] }) {
  const mark = '\u0001';
  const params = Object.fromEntries(tokens.map((name) => [name, mark + t('mk.tok.' + name) + mark]));
  return <>{t(k, params).split(mark).map((part, i) => (i % 2 ? <span className="mk-swap" key={i}>{part}</span> : part))}</>;
}

interface Trace { w: number; h: number; d: string; from: [number, number]; to: [number, number] }

export function Hero() {
  const { t, pack, lang } = useApp();
  const reduced = usePrefersReducedMotion();
  const [first, ...restName] = BRAND.platformName.split(' ');
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const cards = useRef<Record<string, HTMLButtonElement | null>>({});
  const [trace, setTrace] = useState<Trace | null>(null);
  // counts the switches: the first paint is calm, every later one plays the short switch sequence
  const [run, setRun] = useState({ id: pack.id, n: 0 });
  if (run.id !== pack.id) setRun({ id: pack.id, n: run.n + 1 });
  const switched = run.n > 0;

  // the trace from the selected card up to the product window
  useLayoutEffect(() => {
    const measure = () => {
      const r0 = root.current, c0 = cards.current[pack.id], w0 = stage.current?.querySelector<HTMLElement>('.mk-win-wrap'), s0 = rail.current;
      if (!r0 || !c0 || !w0 || !s0) return;
      const r = r0.getBoundingClientRect(), c = c0.getBoundingClientRect(), w = w0.getBoundingClientRect(), s = s0.getBoundingClientRect();
      // only when the selector sits under the window and the card is on screen (phones scroll the cards sideways)
      if (s.top < w.bottom - 4 || c.right < s.left + 8 || c.left > s.right - 8 || r.width < 900) { setTrace(null); return; }
      const px = (n: number) => Math.round(n * 2) / 2;
      const k = 8;
      const x0 = px(c.left + c.width / 2 - r.left), y0 = px(c.top - r.top);
      const y1 = px(w.bottom - r.top) + 2;
      // a card under the window goes straight up; any other runs along the gap above the cards, then up beside the label
      const lo = px(w.left - r.left) + 64, hi = px(w.right - r.left) - 64;
      const x1 = Math.min(Math.max(x0, lo), hi);
      const gap = y0 - 11;
      const dir = x1 > x0 ? 1 : -1;
      const d = Math.abs(x1 - x0) < 2 * k + 2 ? `M${x0} ${y0}V${y1}` : `M${x0} ${y0}V${gap + k}L${x0 + dir * k} ${gap}H${x1 - dir * k}L${x1} ${gap - k}V${y1}`;
      const end = Math.abs(x1 - x0) < 2 * k + 2 ? x0 : x1;
      setTrace({ w: px(r.width), h: px(r.height), d, from: [x0, y0], to: [end, y1] });
    };
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (ro && root.current) ro.observe(root.current);
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
  }, [pack.id, lang]);

  // on phones the cards scroll sideways: keep the selected one in view without moving the page
  useEffect(() => {
    const s = rail.current, c = cards.current[pack.id];
    if (!s || !c || s.scrollWidth <= s.clientWidth + 2) return;
    const left = c.offsetLeft - (s.clientWidth - c.offsetWidth) / 2;
    s.scrollTo({ left, behavior: reduced || !switched ? 'auto' : 'smooth' });
  }, [pack.id, reduced, switched]);

  return (
    <section className="mk-hero" aria-labelledby="mk-h1">
      <div className="mk-hero-bg" aria-hidden="true" />
      <div className="mk-wrap mk-hero-in" ref={root}>
        {trace && (
          <svg className="mk-pick-trace" width={trace.w} height={trace.h} viewBox={`0 0 ${trace.w} ${trace.h}`} aria-hidden="true" focusable="false">
            <g key={pack.id} className={cx(switched && 'run')}>
              <path className="glow" d={trace.d} pathLength={1} />
              <path className="line" d={trace.d} pathLength={1} />
              <path className="spark" d={trace.d} pathLength={1} />
              <circle className="node" cx={trace.from[0]} cy={trace.from[1]} r={3.5} />
              <circle className="node end" cx={trace.to[0]} cy={trace.to[1]} r={3.5} />
            </g>
          </svg>
        )}

        <div className="mk-hero-grid">
          <div className="mk-hero-copy">
            <p className="mk-hero-name">
              <span className="mk-hero-word"><span className="chrome-text">{first.toUpperCase()}</span>{restName.length > 0 && <> <span className="brand-text">{restName.join(' ').toUpperCase()}</span></>}</span>
              <span className={cx('mk-hero-ed', switched && 'in')} key={pack.id} aria-live="polite"><b>{editionWord(pack)}</b>{pack.label[lang]}</span>
            </p>
            <h1 id="mk-h1">{t('mk.hero.h1a')} <span className="chrome-text mk-sheen">{t('mk.hero.h1b')}</span></h1>
            <p className={cx('mk-lede', switched && 'in')} key={pack.id + lang}><Worded t={t} k="mk.hero.lede" tokens={['jobs', 'workers']} /></p>
            <div className="mk-cta">
              <Link to="/demo" className="btn primary lg" data-testid="mk-open-demo">{t('mk.cta.demo')}<Arrow /></Link>
              <Link to="/request-demo" className="btn lg" data-testid="mk-request">{t('mk.cta.request')}</Link>
              <Link to="/pricing" className="mk-tlink" data-testid="mk-pricing">{t('mk.cta.pricing')}</Link>
            </div>
            <p className="mk-hero-facts">{[t('mk.hero.fact1', { n: PACK_LIST.length }), t('mk.hero.fact2'), t('mk.hero.fact3')].map((x, i) => <span key={i}>{x}</span>)}</p>
          </div>

          <div className="mk-stage" ref={stage}>
            <VMark3D className="mk-stage-v" />
            {/* a trace from behind the V down into the window: the mark feeds the product */}
            <svg className="mk-stage-link" viewBox="0 0 680 538" fill="none" aria-hidden="true">
              <path className="l" d="M540 150H572L592 170V520" pathLength={100} />
              <path className="s" d="M540 150H572L592 170V520" pathLength={100} />
            </svg>
            <div className={cx('mk-stage-win', switched && 'in')} key={pack.id}><ProductWindow /></div>
          </div>
        </div>

        <div className="mk-pick">
          <p id="mk-pick-l" className="mk-pick-l"><b>{t('mk.pick.h')}</b> <span>{t('mk.pick.p')}</span></p>
          <div className="mk-cards" role="group" aria-labelledby="mk-pick-l" ref={rail}>
            {PACK_LIST.map((p) => (
              <button key={p.id} type="button" className="mk-card" aria-pressed={p.id === pack.id} onClick={() => switchPack(p.id)}
                aria-label={`${p.product}, ${p.label[lang]}`} data-testid={`mk-industry-${p.id}`} ref={(el: HTMLButtonElement | null) => { cards.current[p.id] = el; }}>
                <span className="mk-card-i">{EDITION_ICON[p.id] ?? <LuBriefcase aria-hidden="true" />}</span>
                <b>{editionWord(p)}</b>
                <small>{p.label[lang]}</small>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
