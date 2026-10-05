// Reports: profit, sales, money, work and team figures, each computed from the records (see data.ts).
// The tab lives in the address (/reports/<tab>), the breakdown and the period in the query, so a report can be linked and printed.
import { useMemo } from 'react';
import { LuDownload, LuLock, LuPrinter } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, go, useRoute, PREVIEW } from '@/app/router';
import type { PageProps } from '@/app/routes';
import { Button, Card, Empty, Note, PageHeader, Seg, cx, toast } from '@/ui';
import { PlanBadge } from '@/app/shared';
import { planName } from '@/lib/pricing';
import { today } from '@/lib/dates';
import { HAS_PERIOD, PERIODS, buildReport, tabsFor, viewsFor, cellText, toCsv, type Period, type Report, type TabId } from './data';
import { PRACTICE_TABS, PRACTICE_VIEWS, buildPracticeReport, practiceHasPeriod, type PracticeTab } from './practice';
import { ReportChart } from './charts';
import { usePrintInLight } from './print';
import { downloadCsv } from '@/features/data/csv';
import { DEPLOY } from '@/config/deployment';
import './reports.css';

/** A report tab of any edition. */
type AnyTab = TabId | PracticeTab;

export default function ReportsPage({ id }: PageProps) {
  const { t, data, lang, pack, can, standing, date, priced } = useApp();
  const route = useRoute();
  // a practice has its own set of reports (./practice.ts); the field editions keep theirs (./data.ts)
  const practice = pack.family === 'practice';
  const TABS: AnyTab[] = practice ? PRACTICE_TABS : tabsFor(pack);
  const tab: AnyTab = TABS.includes(id as AnyTab) ? (id as AnyTab) : practice ? 'sales' : can('profit') ? 'profit' : 'sales';
  const viewsOf = (tb: AnyTab): string[] => (practice ? PRACTICE_VIEWS[tb as PracticeTab] : viewsFor(pack, tb as TabId));
  const by = route.query.get('by') || '';
  const views = viewsOf(tab);
  const view = views.includes(by) ? by : views[0];
  const hasPeriod = practice ? practiceHasPeriod(tab as PracticeTab, view) : HAS_PERIOD[tab as TabId];
  const asked = route.query.get('period') as Period | null;
  const period: Period = asked && PERIODS.includes(asked) ? asked : 'all';
  const path = (tb: AnyTab, v: string, p: Period) => {
    const q = new URLSearchParams();
    if (v !== viewsOf(tb)[0]) q.set('by', v);
    if (p !== 'all') q.set('period', p);
    const s = q.toString();
    return `/reports/${tb}${s ? '?' + s : ''}`;
  };
  const tabLabel = (tb: AnyTab) => t((practice ? 'reports.ptab.' : 'reports.tab.') + tb);
  const segLabel = (v: string) => t((practice && tab !== 'profit' ? 'reports.p.seg.' : 'reports.seg.') + v);

  const locked = tab === 'profit' && !can('profit');
  const report: Report | null = useMemo(() => {
    if (locked) return null;
    const env = { data, t, lang, pack, period: hasPeriod ? period : 'all' as Period };
    return practice ? buildPracticeReport(tab as PracticeTab, view, env) : buildReport(tab as TabId, view, env);
  }, [locked, practice, tab, view, data, t, lang, pack, period, hasPeriod]);
  const profitPlan = standing('profitReports');

  usePrintInLight();

  const periodLabel = hasPeriod ? t('reports.period.' + period) : t(!practice && tab === 'money' && view !== 'outstanding' ? 'reports.basis.six' : 'reports.basis.today');
  const fullTitle = report ? `${tabLabel(tab)}: ${report.title}` : tabLabel(tab);
  // in an edition with its own roles for it, a download is for people who may export records
  const mayExport = !practice || can('export');
  const csv = () => {
    if (!report) return;
    const slug = (DEPLOY.lockedEdition ? DEPLOY.productName : pack.product).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    downloadCsv(`${slug}-${tab}-${view}-${today()}.csv`, toCsv(report));
    if (!PREVIEW) toast(t('reports.csvDone', { n: report.rows.length }));
  };

  return (
    <div className="reports">
      <PageHeader title={t('nav.reports')} sub={t('reports.sub')} actions={
        <div className="row no-print">
          {hasPeriod && !locked && (
            <select className="reports-select" value={period} onChange={(e) => go(path(tab, view, e.target.value as Period))} aria-label={t('reports.period')} data-testid="reports-period">
              {PERIODS.map((p) => <option key={p} value={p}>{t('reports.period.' + p)}</option>)}
            </select>
          )}
          {mayExport && <Button icon={<LuDownload aria-hidden="true" />} onClick={csv} disabled={!report || !report.rows.length} data-testid="reports-csv">{t('reports.csv')}</Button>}
          <Button icon={<LuPrinter aria-hidden="true" />} onClick={() => window.print()} disabled={!report} data-testid="reports-print">{t('common.print')}</Button>
        </div>
      } />

      <div className="tabs no-print" role="tablist" aria-label={t('nav.reports')}>
        {TABS.map((tb) => (
          <button key={tb} type="button" role="tab" aria-selected={tb === tab} onClick={() => go(path(tb, viewsOf(tb)[0], period))} data-testid={`reports-tab-${tb}`}>
            {tb === 'profit' && !can('profit') && <LuLock aria-hidden="true" />}{tabLabel(tb)}
          </button>
        ))}
      </div>

      <p className="reports-printhead">{data.company.name} · {fullTitle} · {periodLabel} · {date(today())}</p>

      {tab === 'profit' && (
        <div className="reports-plan">
          <PlanBadge feature="profitReports" detail />
          {profitPlan.state === 'upgrade' && profitPlan.plan && <span className="small muted">{t('ent.upgradeHint', { plan: planName(profitPlan.plan, lang) })} {t('reports.plan.demoNote')}</span>}
        </div>
      )}

      {locked || !report ? (
        <Card><Empty title={t('reports.profit.locked')} action={<Button onClick={() => go(path('sales', viewsOf('sales')[0], period))}>{t('reports.profit.goSales')}</Button>}>{t('reports.profit.lockedHint', { role: t('role.owner') })}</Empty></Card>
      ) : (
        <>
          <dl className="reports-figs" data-testid="reports-figures">
            {report.figures.map((f) => (
              <div key={f.label}><dt>{f.label}</dt><dd className={cx(f.tone)}>{f.value}</dd>{f.hint && <dd className="h">{f.hint}</dd>}</div>
            ))}
          </dl>

          <div className="reports-bar">
            {views.length > 1
              ? <div className="no-print" data-testid="reports-view"><Seg label={t('reports.breakdown')} value={view} onChange={(v) => go(path(tab, v, period))} options={views.map((v) => ({ value: v, label: segLabel(v) }))} /></div>
              : <span />}
            <span className="small muted reports-basis">{periodLabel}</span>
          </div>

          {!report.rows.length ? (
            <Card><Empty title={t('reports.empty')} action={hasPeriod && period !== 'all' ? <Button onClick={() => go(path(tab, view, 'all'))} data-testid="reports-all-time">{t('reports.showAll')}</Button> : undefined}>{t(hasPeriod && period !== 'all' ? 'reports.emptyPeriod' : 'reports.emptyHint')}</Empty>{practice && report.note && <p className="xs dim reports-note reports-emptynote">{report.note}</p>}</Card>
          ) : (
            <div className={cx('reports-pair', report.cols.length <= 4 && 'two')}>
              <Card title={report.title} className="reports-chart-card">
                <ReportChart title={fullTitle} chart={report.chart} />
                {report.note && <p className="xs dim reports-note">{report.note}</p>}
              </Card>
              <Card flush>
                <div className="table-wrap">
                  <table className="tbl stackable reports-table" data-testid="reports-table">
                    <caption className="sr">{fullTitle}</caption>
                    <thead><tr>{report.cols.map((c) => <th key={c.key} scope="col" className={c.kind !== 'text' ? 'num' : undefined}>{c.label}</th>)}</tr></thead>
                    <tbody>
                      {report.rows.map((r) => (
                        <tr key={r.id}>
                          {report.cols.map((c, i) => {
                            const v = r.cells[c.key] ?? null;
                            if (i === 0) return <td key={c.key} className="t1">{r.to ? <A to={r.to} className="reports-link">{String(v ?? '')}</A> : String(v ?? '')}{r.sub && <div className="xs dim reports-sub">{r.sub}</div>}</td>;
                            return <td key={c.key} data-label={c.label} className={cx(c.kind !== 'text' && 'num', c.kind === 'money' && Number(v) < 0 && 'neg')}>{cellText(v, c.kind, t('reports.na'))}</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                    {report.total && (
                      <tfoot><tr>{report.cols.map((c, i) => {
                        const v = report.total![c.key] ?? null;
                        return i === 0 ? <td key={c.key} className="t1">{String(v ?? '')}</td> : <td key={c.key} data-label={c.label} className={cx(c.kind !== 'text' && 'num', c.kind === 'money' && Number(v) < 0 && 'neg')}>{c.kind === 'text' ? String(v ?? '') : cellText(v, c.kind, t('reports.na'))}</td>;
                      })}</tr></tfoot>
                    )}
                  </table>
                </div>
              </Card>
            </div>
          )}
        </>
      )}

      {/* custom reports are a commercial offer: said only where plans and prices apply */}
      {priced && <p className="reports-custom small muted no-print">{t('reports.custom')} <PlanBadge feature="customWork" /></p>}
    </div>
  );
}
