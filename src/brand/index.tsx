// Brand pieces shared by the sales pages and the workspace: the V mark (flat and dimensional), the product lockup,
// circuit traces, the product window frame and the scroll-reveal helpers. `BrandMark` and `BrandLockup` give the mark and
// lockup of the deployment being built (VYNTEX Command or LBS Command); the LBS pieces themselves are in ./lbs.
// Motion here follows the tokens in ui/styles.css and switches itself off for visitors who ask for reduced motion,
// on touch devices and while off screen.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { asset } from '@/app/router';
import { BRAND } from '@/config/brand';
import { LbsLockup, LionMark } from './lbs';
import './brand.css';

// Which brand this bundle carries. `BrandMark` and `BrandLockup` test the build constant itself (the one
// config/deployment.ts turns into DEPLOY), written out at the branch: the bundler folds that test to true or false and
// leaves the other brand's components and the addresses of its pictures out of the bundle. It does not do that for a
// value read from another file, or for a named constant, so the test is repeated rather than shared.
// `DEPLOY.theme` says the same thing at run time.
declare const __VX_DEPLOY__: string | undefined;

/* ---------- environment ---------- */
export function usePrefersReducedMotion(): boolean {
  const q = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches);
  useEffect(() => { const m = matchMedia(q); const on = () => setReduced(m.matches); m.addEventListener('change', on); return () => m.removeEventListener('change', on); }, []);
  return reduced;
}
/** True once the element has entered the viewport (stays true), plus whether it is on screen right now. */
export function useInView<T extends Element>(margin = '0px 0px -12% 0px') {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (typeof IntersectionObserver !== 'function') { setSeen(true); setVisible(true); return; }
    const io = new IntersectionObserver(([e]) => { setVisible(e.isIntersecting); if (e.isIntersecting) setSeen(true); }, { rootMargin: margin, threshold: 0.08 });
    io.observe(el); return () => io.disconnect();
  }, [margin]);
  return { ref, seen, visible };
}

/* ---------- scroll reveal: one language for the whole site ---------- */
/**
 * Reveals its content once when it scrolls into view: fade, a short rise and a touch of blur, per the motion tokens.
 * `as` picks the element, `delay` staggers siblings (keep steps to 40 to 120 ms), `kind="panel"` is the slightly
 * larger move used for product visuals. Content is always in the page: with reduced motion it is simply shown.
 */
export function Reveal({ children, as = 'div', delay = 0, kind = 'text', className, ...rest }: { children: ReactNode; as?: 'div' | 'section' | 'li' | 'span' | 'article' | 'header' | 'p' | 'h2' | 'h3'; delay?: number; kind?: 'text' | 'panel'; className?: string } & Record<string, unknown>) {
  const { ref, seen } = useInView<HTMLElement>();
  const Tag = as as 'div';
  return <Tag ref={ref as never} className={`vx-reveal ${kind === 'panel' ? 'panel ' : ''}${seen ? 'in ' : ''}${className ?? ''}`} style={delay ? { transitionDelay: `${delay}ms` } : undefined} {...rest}>{children}</Tag>;
}

/* ---------- the V mark ---------- */
/** The official V mark, flat. Transparent artwork made for dark surfaces. */
export function VMark({ size = 28, className }: { size?: number; className?: string }) {
  const file = size <= 68 ? 'brand/vyntex-v-xs.webp' : size <= 170 ? 'brand/vyntex-v-sm.webp' : 'brand/vyntex-v.webp';
  return <img className={`vx-mark ${className ?? ''}`} src={asset(file)} alt="" width={size} height={Math.round(size * 538 / 680)} decoding="async" />;
}

/**
 * The dimensional V: the brand signature for the hero and the closing section.
 * Built in layers (light behind, the mark, a chrome light sweep, circuit pulses in front) inside a perspective box:
 * it floats a few pixels, leans one to three degrees toward the pointer, and its circuits pulse every few seconds.
 * No WebGL and no extra download beyond the mark itself. Still for reduced motion, touch and when off screen.
 */
export function VMark3D({ className, quiet }: { className?: string; /** No pointer tilt (used where the mark is secondary). */ quiet?: boolean }) {
  const reduced = usePrefersReducedMotion();
  const { ref, visible, seen } = useInView<HTMLDivElement>('0px');
  useEffect(() => {
    const el = ref.current; if (!el || reduced || quiet) return;
    if (typeof matchMedia === 'function' && !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    let raf = 0, tx = 0, ty = 0, x = 0, y = 0;
    const tick = () => {
      x += (tx - x) * 0.07; y += (ty - y) * 0.07;
      el.style.setProperty('--px', x.toFixed(4)); el.style.setProperty('--py', y.toFixed(4));
      raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.002 ? requestAnimationFrame(tick) : 0;
    };
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      tx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2)));
      ty = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2)));
      if (!raf) raf = requestAnimationFrame(tick);
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => { window.removeEventListener('pointermove', move); if (raf) cancelAnimationFrame(raf); };
  }, [reduced, quiet, ref]);
  return (
    <div className={`vx3d ${className ?? ''}`} ref={ref} data-live={visible && !reduced ? '' : undefined} data-seen={seen ? '' : undefined} aria-hidden="true">
      <div className="vx3d-light" />
      <div className="vx3d-float">
        <div className="vx3d-plane">
          <img className="vx3d-glow" src={asset('brand/vyntex-v.webp')} alt="" width={680} height={538} decoding="async" />
          <img src={asset('brand/vyntex-v.webp')} alt="" width={680} height={538} decoding="async" />
          <div className="vx3d-sweep" />
          <svg className="vx3d-circuit" viewBox="0 0 680 538" fill="none">
            {/* pulses travel along the traces of the mark */}
            <path className="p p1" pathLength={100} d="M172 178 L178 183 L340 434 L468 233 L473 226" />
            <path className="p p2" pathLength={100} d="M394 134 L393 158 L341 237 L391 316 L335 400" />
            <path className="p p3" pathLength={100} d="M512 226 L484 266 L471 268 L472 290 L339 503" />
            <circle className="n n1" cx="172" cy="178" r="5" /><circle className="n n2" cx="395" cy="133" r="5.5" />
            <circle className="n n3" cx="473" cy="226" r="6.5" /><circle className="n n4" cx="512" cy="225" r="5.5" />
          </svg>
        </div>
      </div>
    </div>
  );
}

/* ---------- product lockup ---------- */
/** "VYNTEX" in chrome, the product word in the blue spectrum, with the V mark. The name comes from config/brand.ts. */
export function Lockup({ size = 'md', tagline, mark = true }: { size?: 'sm' | 'md' | 'lg'; tagline?: string; mark?: boolean }) {
  const [first, ...rest] = BRAND.platformName.split(' ');
  return (
    <span className={`vx-lockup ${size}`}>
      {mark && <VMark size={size === 'lg' ? 60 : size === 'md' ? 38 : 32} />}
      <span className="vx-lockup-t">
        <span className="vx-word"><span className="chrome-text">{first.toUpperCase()}</span>{rest.length > 0 && <span className="brand-text"> {rest.join(' ').toUpperCase()}</span>}</span>
        {tagline && <span className="vx-tag">{tagline}</span>}
      </span>
    </span>
  );
}

/* ---------- the brand of this deployment ---------- */
/**
 * The mark of whichever product this bundle is: the V for VYNTEX Command, the lion for LBS Command. Same props as `VMark`.
 * `size` is the width of the V; the lion is taller than wide, so it is drawn a little taller to carry the same weight.
 */
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return typeof __VX_DEPLOY__ !== 'undefined' && __VX_DEPLOY__ === 'lbs' ? <LionMark size={Math.round(size * 1.3)} className={className} /> : <VMark size={size} className={className} />;
}
/** The product lockup of this deployment. Same props as `Lockup`. Use this in shared screens (sidebar, sign-in, emails). */
export function BrandLockup(props: { size?: 'sm' | 'md' | 'lg'; tagline?: string; mark?: boolean }) {
  return typeof __VX_DEPLOY__ !== 'undefined' && __VX_DEPLOY__ === 'lbs' ? <LbsLockup {...props} /> : <Lockup {...props} />;
}

/* ---------- circuit trace ---------- */
/**
 * A circuit line that draws itself when it scrolls into view, with nodes at its ends. Use only where the idea is
 * connection, automation or flow. `d` is an SVG path in the given viewBox; `nodes` are [x, y] points.
 */
export function CircuitTrace({ d, viewBox, nodes = [], className, pulse }: { d: string; viewBox: string; nodes?: [number, number][]; className?: string; /** Keep a soft pulse travelling after the line is drawn. */ pulse?: boolean }) {
  const { ref, seen } = useInView<SVGSVGElement>();
  return (
    <svg ref={ref} className={`vx-trace ${seen ? 'in ' : ''}${pulse ? 'pulse ' : ''}${className ?? ''}`} viewBox={viewBox} fill="none" aria-hidden="true" preserveAspectRatio="none">
      <path className="l" d={d} pathLength={100} vectorEffect="non-scaling-stroke" />
      {pulse && <path className="s" d={d} pathLength={100} vectorEffect="non-scaling-stroke" />}
      {nodes.map(([x, y], i) => <circle key={i} className="nd" cx={x} cy={y} r="3" vectorEffect="non-scaling-stroke" />)}
    </svg>
  );
}

/* ---------- product window ---------- */
/** The frame around real product UI on the sales pages: a title row, an optional sample-data strip, a faint edge light. */
export function Frame({ title, sub, badge, note, children, className, tilt }: { title: ReactNode; sub?: ReactNode; badge?: ReactNode; note?: ReactNode; children: ReactNode; className?: string; /** Slight perspective for hero use (2 to 4 degrees). Off on phones. */ tilt?: boolean }) {
  return (
    <div className={`vx-frame ${tilt ? 'tilt ' : ''}${className ?? ''}`}>
      <div className="vx-frame-h"><span className="vx-frame-b" aria-hidden="true">{badge}</span><span className="vx-frame-t"><b>{title}</b>{sub && <small>{sub}</small>}</span><span className="vx-frame-dots" aria-hidden="true"><i /><i /><i /></span></div>
      {note && <div className="vx-frame-n">{note}</div>}
      <div className="vx-frame-c">{children}</div>
    </div>
  );
}

/* ---------- scroll progress ---------- */
/** A one-pixel circuit line across the top of long pages with a lit node at the reading position. */
export function ScrollProgress() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return; let raf = 0;
    const set = () => { raf = 0; const max = document.documentElement.scrollHeight - window.innerHeight; el.style.setProperty('--p', max > 0 ? String(Math.min(1, window.scrollY / max)) : '0'); };
    const on = () => { if (!raf) raf = requestAnimationFrame(set); };
    set(); window.addEventListener('scroll', on, { passive: true }); window.addEventListener('resize', on);
    return () => { window.removeEventListener('scroll', on); window.removeEventListener('resize', on); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return <div className="vx-progress" ref={ref} aria-hidden="true"><i /></div>;
}

/** The small arrow used in calls to action. It shifts three pixels on hover (see .btn .arr). */
export function Arrow() {
  return <svg className="arr" viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
