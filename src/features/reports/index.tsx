// Reports: profit, sales, money, work and team figures, each computed from the records (see data.ts).
// The tab lives in the address (/reports/<tab>), the breakdown and the period in the query, so a report can be linked and printed.
import { useEffect, useMemo } from 'react';
import { LuDownload, LuLock, LuPrinter } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, go, useRoute, PREVIEW } from '@/app/router';
import type { PageProps } from '@/app/routes';
import { Button, Card, Empty, Note, PageHeader, Seg, cx, toast } from '@/ui';
import { PlanBadge } from '@/app/shared';
import { planName } from '@/lib/pricing';
import { today } from '@/lib/dates';
import { HAS_PERIOD, PERIODS, TABS, VIEWS, buildReport, cellText, toCsv, type Period, type Report, type TabId } from './data';
import { ReportChart } from './charts';
import './reports.css';

function downloadCsv(name: string, text: string) {
  // the byte-order mark makes spreadsheet programs read accents correctly
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function ReportsPage({ id }: PageProps) {
  const { t, data, lang, pack, can, standing, date } = useApp();
  const route = useRoute();
  const tab: TabId = TABS.includes(id as TabId) ? (id as TabId) : can('profit') ? 'profit' : 'sales';
  const by = route.query.get('by') || '';
  const view = VIEWS[tab].includes(by) ? by : VIEWS[tab][0];
  const asked = route.query.get('period') as Period | null;
  const period: Period = asked && PERIODS.includes(asked) ? asked : 'all';
  const path = (tb: TabId, v: string, p: Period) => {
    const q = new URLSearchParams();
    if (v !== VIEWS[tb][0]) q.set('by', v);
    if (p !== 'all') q.set('period', p);
    const s = q.toString();
    return `/reports/${tb}${s ? '?' + s : ''}`;
  };

  const locked = tab === 'profit' && !can('profit');
  const report: Report | null = useMemo(() => (locked ? null : buildReport(tab, view, { data, t, lang, pack, period: HAS_PERIOD[tab] ? period : 'all' })), [locked, tab, view, data, t, lang, pack, period]);
  const profitPlan = standing('profitReports');

  // Printing uses the light colours whatever theme is on screen, then puts the theme back.
  useEffect(() => {
    let prev: string | undefined;
    const before = () => { prev = document.documentElement.dataset.theme; document.documentElement.dataset.theme = 'light'; };
    const after = () => { if (prev) document.documentElement.dataset.theme = prev; prev = undefined; };
    window.addEventListener('beforeprint', before); window.addEventListener('afterprint', after);
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); after(); };
  }, []);

  const periodLabel = HAS_PERIOD[tab] ? t('reports.period.' + period) : t(tab === 'money' && view !== 'outstanding' ? 'reports.basis.six' : 'reports.basis.today');
  const fullTitle = report ? `${t('reports.tab.' + tab)}: ${report.title}` : t('reports.tab.' + tab);
  const csv = () => {
    if (!report) return;
    const slug = pack.product.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    downloadCsv(`${slug}-${tab}-${view}-${today()}.csv`, toCsv(report));
    if (!PREVIEW) toast(t('reports.csvDone', { n: report.rows.length }));
  };

  return (
    <div className="reports">
      <PageHeader title={t('nav.reports')} sub={t('reports.sub')} actions={
        <div className="row no-print">
          {HAS_PERIOD[tab] && !locked && (
            <select className="reports-select" value={period} onChange={(e) => go(path(tab, view, e.target.value as Period))} aria-label={t('reports.period')} data-testid="reports-period">
              {PERIODS.map((p) => <option key={p} value={p}>{t('reports.period.' + p)}</option>)}
            </select>
          )}
          <Button icon={<LuDownload aria-hidden="true" />} onClick={csv} disabled={!report || !report.rows.length} data-testid="reports-csv">{t('reports.csv')}</Button>
          <Button icon={<LuPrinter aria-hidden="true" />} onClick={() => window.print()} disabled={!report} data-testid="reports-print">{t('common.print')}</Button>
        </div>
      } />

      <div className="tabs no-print" role="tablist" aria-label={t('nav.reports')}>
        {TABS.map((tb) => (
          <button key={tb} type="button" role="tab" aria-selected={tb === tab} onClick={() => go(path(tb, VIEWS[tb][0], period))} data-testid={`reports-tab-${tb}`}>
            {tb === 'profit' && !can('profit') && <LuLock aria-hidden="true" />}{t('reports.tab.' + tb)}
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
        <Card><Empty title={t('reports.profit.locked')} action={<Button onClick={() => go(path('sales', VIEWS.sales[0], period))}>{t('reports.profit.goSales')}</Button>}>{t('reports.profit.lockedHint', { role: t('role.owner') })}</Empty></Card>
      ) : (
        <>
          <dl className="reports-figs" data-testid="reports-figures">
            {report.figures.map((f) => (
              <div key={f.label}><dt>{f.label}</dt><dd className={cx(f.tone)}>{f.value}</dd>{f.hint && <dd className="h">{f.hint}</dd>}</div>
            ))}
          </dl>

          <div className="reports-bar">
            {VIEWS[tab].length > 1
              ? <div className="no-print" data-testid="reports-view"><Seg label={t('reports.breakdown')} value={view} onChange={(v) => go(path(tab, v, period))} options={VIEWS[tab].map((v) => ({ value: v, label: t('reports.seg.' + v) }))} /></div>
              : <span />}
            <span className="small muted reports-basis">{periodLabel}</span>
          </div>

          {!report.rows.length ? (
            <Card><Empty title={t('reports.empty')} action={HAS_PERIOD[tab] && period !== 'all' ? <Button onClick={() => go(path(tab, view, 'all'))} data-testid="reports-all-time">{t('reports.showAll')}</Button> : undefined}>{t(HAS_PERIOD[tab] && period !== 'all' ? 'reports.emptyPeriod' : 'reports.emptyHint')}</Empty></Card>
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

      <p className="reports-custom small muted no-print">{t('reports.custom')} <PlanBadge feature="customWork" /></p>
    </div>
  );
}
