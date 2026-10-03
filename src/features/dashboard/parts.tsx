// Small display pieces of the dashboard: the sparkline, the direction mark, the value that crossfades when it changes
// and the empty state. All of them are static drawings; the only motion is the crossfade and it is switched off for reduced motion.
import { useRef, type ReactNode } from 'react';
import { LuArrowDownRight, LuArrowUpRight, LuMinus } from 'react-icons/lu';
import { cx } from '@/ui';
import type { Trend } from './insights';

/** Shows a value and fades the new one in when it changes (a payment recorded, a task ticked, another industry picked). Never on first paint. */
export function Swap({ children }: { children: string }) {
  const seen = useRef(children); const turn = useRef(0);
  if (seen.current !== children) { seen.current = children; turn.current++; }
  return <span key={turn.current} className={turn.current ? 'dash-swap' : undefined}>{children}</span>;
}

const W = 64, H = 24, PAD = 3;
/**
 * A tiny chart of a real series. `line` for money over time, `bars` for counts. The period that the big number refers to
 * (`mark`, the last point by default) is drawn in the accent, the rest stays quiet. Read out through `label`.
 */
export function Spark({ values, kind, label, mark = values.length - 1 }: { values: number[]; kind: 'line' | 'bars'; label: string; mark?: number }) {
  const max = Math.max(...values, 0);
  if (!(max > 0) || values.length < 2) return null;
  if (kind === 'bars') {
    const slot = W / values.length; const bw = Math.min(6, slot - 2);
    return (
      <svg className="dash-spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label}>
        <title>{label}</title>
        {values.map((v, i) => { const h = v > 0 ? Math.max(2.5, (v / max) * (H - 2)) : 1; return <rect key={i} className={i === mark ? 'on' : undefined} x={i * slot + (slot - bw) / 2} y={H - h} width={bw} height={h} rx={v > 0 ? 1.5 : 0} />; })}
      </svg>
    );
  }
  const step = (W - PAD * 2) / (values.length - 1);
  const pts = values.map((v, i) => [PAD + i * step, H - PAD - (v / max) * (H - PAD * 2)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [mx, my] = pts[Math.max(0, Math.min(pts.length - 1, mark))];
  return (
    <svg className="dash-spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label}>
      <title>{label}</title>
      <path className="area" d={`${line} L${pts[pts.length - 1][0].toFixed(1)} ${H} L${pts[0][0].toFixed(1)} ${H} Z`} />
      <path className="ln" d={line} />
      <circle className="pt" cx={mx} cy={my} r="3" />
    </svg>
  );
}

/** Direction of a comparison: an arrow, the size of the change, and the same thing in words for screen readers. */
export function TrendMark({ trend, words }: { trend: Trend; words: string }) {
  const Icon = trend.dir === 'up' ? LuArrowUpRight : trend.dir === 'down' ? LuArrowDownRight : LuMinus;
  return <span className={cx('dash-trend', trend.dir)}><Icon aria-hidden="true" /><span aria-hidden="true">{trend.delta && (trend.dir === 'up' ? '+' : '\u2212') + trend.delta}</span><span className="sr">{words}</span></span>;
}

/** Empty state: a small icon on a circuit node, one sentence, one action. */
export function Quiet({ icon, title, children, tone, pad }: { icon: ReactNode; title: ReactNode; children?: ReactNode; tone?: 'ok'; pad?: boolean }) {
  return (
    <div className={cx('dash-quiet', tone, pad && 'pad')}>
      <span className="dash-quiet-ico" aria-hidden="true">{icon}</span>
      <div className="dash-quiet-t"><p>{title}</p>{children && <div className="dash-quiet-a">{children}</div>}</div>
    </div>
  );
}
