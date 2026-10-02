// Two plain chart forms drawn with HTML and CSS: horizontal bars to compare groups, columns for months.
// The numbers are always printed next to the marks and repeated in the table under the chart.
import { cx } from '@/ui';
import { money } from '@/lib/money';
import type { Chart } from './data';

const fmt = (v: number, unit: Chart['unit']) => (unit === 'money' ? money(v) : String(v));

function Legend({ chart }: { chart: Chart }) {
  if (chart.series.length < 2) return null;
  return <div className="legend reports-legend" aria-hidden="true">{chart.series.map((s) => <span key={s.label}><i className={'reports-c-' + s.tone} />{s.label}</span>)}</div>;
}
/** One sentence a screen reader can use instead of the picture. */
function describe(title: string, chart: Chart) {
  const parts = chart.items.map((it) => `${it.label}: ${chart.series.length > 1 ? chart.series.map((s, i) => `${s.label} ${fmt(it.values[i] ?? 0, chart.unit)}`).join(', ') : fmt(it.values[0] ?? 0, chart.unit)}`);
  return `${title}. ${parts.join('; ')}.`;
}

export function ReportChart({ title, chart }: { title: string; chart: Chart }) {
  return (
    <figure className="reports-chart" role="img" aria-label={describe(title, chart)}>
      <Legend chart={chart} />
      {chart.type === 'columns' ? <Columns chart={chart} /> : <Bars chart={chart} />}
    </figure>
  );
}

/** Horizontal bars, one row per group, segments stacked from the left. The longest row sets the scale. */
function Bars({ chart }: { chart: Chart }) {
  const total = (v: number[]) => v.reduce((a, x) => a + Math.max(0, x), 0);
  const max = Math.max(1, ...chart.items.map((it) => total(it.values)));
  return (
    <div className="reports-bars">
      {chart.items.map((it) => (
        <div className="reports-bar-row" key={it.id}>
          <div className="reports-bar-l" title={it.label}>{it.label}</div>
          <div className="reports-bar-t">
            {it.values.map((v, i) => v > 0 ? <span key={i} className={cx('reports-seg', 'reports-c-' + chart.series[i].tone)} style={{ width: `${(v / max) * 100}%` }} title={`${chart.series[i].label}: ${fmt(v, chart.unit)}`} /> : null)}
          </div>
          <div className="reports-bar-v">{it.tip}</div>
        </div>
      ))}
    </div>
  );
}

/** Columns over time. Handles months below zero by moving the baseline up. */
function Columns({ chart }: { chart: Chart }) {
  const vals = chart.items.map((it) => it.values[0] ?? 0);
  const hi = Math.max(0, ...vals), lo = Math.min(0, ...vals);
  const range = hi - lo || 1;
  const zero = ((0 - lo) / range) * 100;
  return (
    <div className="reports-cols" style={{ gridTemplateColumns: `repeat(${chart.items.length}, minmax(0, 1fr))` }}>
      {chart.items.map((it, i) => {
        const v = vals[i]; const h = (Math.abs(v) / range) * 100;
        return (
          <div className="reports-col" key={it.id}>
            <div className="reports-col-plot" style={lo < 0 ? { marginBottom: 22 } : undefined} title={`${it.label}: ${fmt(v, chart.unit)}`}>
              <span className="reports-col-v" style={v >= 0 ? { bottom: `calc(${zero + h}% + 4px)` } : { top: `calc(${100 - zero + h}% + 4px)` }}>{it.tip}</span>
              {v !== 0 && <span className={cx('reports-col-b', 'reports-c-' + chart.series[0].tone, v < 0 && 'down')} style={{ height: `${h}%`, bottom: `${v >= 0 ? zero : zero - h}%` }} />}
              <span className="reports-col-0" style={{ bottom: `${zero}%` }} />
            </div>
            <div className="reports-col-l">{it.label}</div>
          </div>
        );
      })}
    </div>
  );
}
