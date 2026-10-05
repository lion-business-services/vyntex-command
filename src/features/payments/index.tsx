// Payments: every dollar in and out in one place. Received from clients, paid to workers, expenses and who still owes whom.
// Payments are recorded by hand; nothing here charges a card.
import { CanWrite } from '@/app/shared';
import { lazy, useMemo, useState } from 'react';
import { LuBanknote, LuDownload, LuHandCoins } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, useRoute, PREVIEW } from '@/app/router';
import type { PageProps } from '@/app/routes';
import { Button, Card, Empty, PageHeader, Stat, toast } from '@/ui';
import { ClientPaymentModal, PAY_METHODS, PayWorkerModal } from '@/app/forms';
import { byId, jobMoney, kpiValues, workerMoney } from '@/domain/selectors';
import type { PayMethod } from '@/domain/types';
import { money, money2, sum } from '@/lib/money';
import { monthLabel, today } from '@/lib/dates';
import { csvAmount, periodText } from '@/features/team/util';
import { downloadCsv } from '@/features/data/csv';
import './payments.css';

type Tab = 'received' | 'workers' | 'expenses' | 'balances';
const TABS: Tab[] = ['received', 'workers', 'expenses', 'balances'];
const isTab = (v: string | null): v is Tab => !!v && (TABS as string[]).includes(v);

/** What clients paid a professional-services firm and what they still owe (./practice.tsx). */
const PracticePayments = lazy(() => import('./practice'));

/** Field editions keep the money-in, money-out screen below; a practice has its own ledger of client payments. */
export default function PaymentsPage(props: PageProps) {
  const { pack } = useApp();
  return pack.family === 'practice' ? <PracticePayments {...props} /> : <FieldPayments {...props} />;
}

function FieldPayments(_: PageProps) {
  const { t, data, date, lang, pack } = useApp();
  // an edition without field workers pays nobody per job: that tab, its figures and its button are left out
  const crew = pack.usesWorkers;
  const tabs = TABS.filter((k) => k !== 'workers' || crew);
  const route = useRoute();
  const asked = route.query.get('tab');
  const [tab, setTab] = useState<Tab>(isTab(asked) && (asked !== 'workers' || crew) ? asked : 'received');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [method, setMethod] = useState<'' | PayMethod>('');
  const [recv, setRecv] = useState<string | null>(null);
  const [pay, setPay] = useState<string | null>(null);

  const month = today().slice(0, 7);
  const kpi = useMemo(() => kpiValues(data), [data]);
  const inRange = (d: string) => (!from || d >= from) && (!to || d <= to);
  const byDate = <T extends { d: string }>(list: T[]) => list.sort((a, b) => b.d.localeCompare(a.d));

  const allReceived = useMemo(() => data.jobs.flatMap((j) => j.received.map((p) => ({ d: p.date, p, j, c: byId(data.clients, j.clientId) }))), [data]);
  const allPaid = useMemo(() => data.workerPays.map((p) => ({ d: p.date, p, w: byId(data.workers, p.workerId), j: byId(data.jobs, p.jobId) })), [data]);
  const allExpenses = useMemo(() => data.jobs.flatMap((j) => j.expenses.map((e) => ({ d: e.date, e, j }))), [data]);
  const received = byDate(allReceived.filter((r) => inRange(r.d) && (!method || r.p.method === method)));
  const paid = byDate(allPaid.filter((r) => inRange(r.d) && (!method || r.p.method === method)));
  const expenses = byDate(allExpenses.filter((r) => inRange(r.d)));
  const owing = useMemo(() => data.jobs.filter((j) => j.status === 'progress' || j.status === 'done').map((j) => ({ j, c: byId(data.clients, j.clientId), m: jobMoney(data, j) })).filter((r) => r.m.clientOwes > 0.005).sort((a, b) => b.m.clientOwes - a.m.clientOwes), [data]);
  const owed = useMemo(() => data.workers.map((w) => ({ w, m: workerMoney(data, w.id) })).filter((r) => r.m.owed > 0.005).sort((a, b) => b.m.owed - a.m.owed), [data]);
  const paidMonth = sum(data.workerPays.filter((p) => p.date.startsWith(month)), (p) => p.amount);

  const filtered = !!(from || to || method);
  const clear = () => { setFrom(''); setTo(''); setMethod(''); };
  const thisMonth = (next: Tab) => { setTab(next); setFrom(month + '-01'); setTo(''); setMethod(''); };
  const counts: Record<Tab, number> = { received: allReceived.length, workers: allPaid.length, expenses: allExpenses.length, balances: owing.length + owed.length };

  const csv = () => {
    const rows: (string | number)[][] =
      tab === 'received' ? [
        [t('common.date'), t('payments.col.client'), t('team.col.job'), t('common.method'), t('common.reference'), t('common.amount')],
        ...received.map((r) => [r.p.date, r.c?.name ?? '', r.j.name, t('m_' + r.p.method), r.p.ref || '', csvAmount(r.p.amount)]),
        [t('common.total'), '', '', '', '', csvAmount(sum(received, (r) => r.p.amount))],
      ] : tab === 'workers' ? [
        [t('common.date'), t('team.col.who'), t('team.col.job'), t('common.method'), t('common.reference'), t('team.col.period'), t('common.amount')],
        ...paid.map((r) => [r.p.date, r.w?.name ?? '', r.j?.name ?? t('form.pay.noJob'), t('m_' + r.p.method), r.p.ref || '', [r.p.from, r.p.to].filter(Boolean).join(' / '), csvAmount(r.p.amount)]),
        [t('common.total'), '', '', '', '', '', csvAmount(sum(paid, (r) => r.p.amount))],
      ] : tab === 'expenses' ? [
        [t('common.date'), t('team.col.job'), t('payments.col.vendor'), t('payments.col.what'), t('common.amount')],
        ...expenses.map((r) => [r.e.date, r.j.name, r.e.vendor, r.e.desc, csvAmount(r.e.amount)]),
        [t('common.total'), '', '', '', csvAmount(sum(expenses, (r) => r.e.amount))],
      ] : [
        [t('common.type'), t('common.name'), t('team.col.job'), t('team.col.agreed'), t('team.col.paid'), t('common.balance')],
        ...owing.map((r) => [t('payments.col.client'), r.c?.name ?? '', r.j.name, csvAmount(r.m.price), csvAmount(r.m.received), csvAmount(r.m.clientOwes)]),
        ...owed.map((r) => [t('team.col.who'), r.w.name, '', csvAmount(r.m.agreed), csvAmount(r.m.paid), csvAmount(r.m.owed)]),
      ];
    downloadCsv(`${t('payments.file.' + tab)}-${today()}.csv`, rows);
    if (!PREVIEW) toast(t('payments.csvDone'));
  };
  const csvEmpty = tab === 'received' ? !received.length : tab === 'workers' ? !paid.length : tab === 'expenses' ? !expenses.length : !(owing.length + owed.length);
  const noMatch = <Empty title={t('common.noResults')} action={<Button onClick={clear}>{t('common.clearFilters')}</Button>} />;

  return (
    <>
      <PageHeader title={t('nav.money')} sub={t('payments.sub')} actions={<>
        {crew && <CanWrite><Button icon={<LuBanknote />} onClick={() => setPay('')} data-testid="payments-pay">{t('form.pay.worker')}</Button></CanWrite>}
        <CanWrite><Button variant="primary" icon={<LuHandCoins />} onClick={() => setRecv('')} data-testid="payments-record">{t('form.pay.record')}</Button></CanWrite>
      </>} />

      <div className="kpis payments-kpis">
        <Stat label={t('payments.k.received')} value={money(kpi.collectedMonth)} hint={monthLabel(month, lang)} onClick={() => thisMonth('received')} testId="payments-kpi-received" />
        <Stat label={t('payments.k.clientsOwe')} value={money(kpi.clientsOwe)} hint={t('payments.k.clientsOweHint')} onClick={() => setTab('balances')} testId="payments-kpi-owing" />
        {crew && <Stat label={t('payments.k.paid')} value={money(paidMonth)} hint={monthLabel(month, lang)} onClick={() => thisMonth('workers')} testId="payments-kpi-paid" />}
        {crew && <Stat label={t('payments.k.owed')} value={money(kpi.oweWorkers)} hint={t('team.k.owedHint')} onClick={() => setTab('balances')} testId="payments-kpi-owed" />}
      </div>

      <div className="tabs payments-tabs" role="tablist">
        {tabs.map((k) => <button key={k} role="tab" type="button" aria-selected={k === tab} onClick={() => setTab(k)} data-testid={`payments-tab-${k}`}>{t('payments.tab.' + k)}{counts[k] > 0 && <span className="count">{counts[k]}</span>}</button>)}
      </div>

      <div className="filters payments-filters">
        {tab !== 'balances' && <>
          <label className="payments-date"><span>{t('common.from')}</span><input type="date" className="input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} data-testid="payments-from" /></label>
          <label className="payments-date"><span>{t('common.to')}</span><input type="date" className="input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} data-testid="payments-to" /></label>
          {tab !== 'expenses' && (
            <select value={method} onChange={(e) => setMethod(e.target.value as PayMethod | '')} aria-label={t('common.method')} data-testid="payments-method">
              <option value="">{t('payments.allMethods')}</option>{PAY_METHODS.map((m) => <option key={m} value={m}>{t('m_' + m)}</option>)}
            </select>
          )}
          {filtered && <button type="button" className="linkbtn small" onClick={clear}>{t('common.clearFilters')}</button>}
        </>}
        <span className="grow" />
        <Button size="sm" icon={<LuDownload />} onClick={csv} disabled={csvEmpty} data-testid="payments-csv">{t('payments.csv')}</Button>
      </div>

      {tab === 'received' && (
        <Card flush className="payments-list">
          {!allReceived.length ? <Empty title={t('payments.empty.received')} action={<CanWrite><Button variant="primary" onClick={() => setRecv('')}>{t('form.pay.record')}</Button></CanWrite>}>{t('payments.empty.receivedHint')}</Empty>
            : !received.length ? noMatch : (
              <div className="table-wrap">
                <table className="tbl stackable payments-tbl" data-testid="payments-table-received">
                  <thead><tr><th>{t('common.date')}</th><th>{t('payments.col.client')}</th><th>{t('team.col.job')}</th><th>{t('common.method')}</th><th>{t('common.reference')}</th><th className="num">{t('common.amount')}</th></tr></thead>
                  <tbody>
                    {received.map(({ p, j, c }) => (
                      <tr key={p.id}>
                        <td className="t1 nowrap">{date(p.date)}</td>
                        <td data-label={t('payments.col.client')}>{c ? <A to={`/clients/${c.id}`}>{c.name}</A> : null}</td>
                        <td data-label={t('team.col.job')}><A to={`/jobs/${j.id}`}>{j.name}</A></td>
                        <td data-label={t('common.method')}>{t('m_' + p.method)}</td>
                        <td data-label={t('common.reference')}>{p.ref || null}</td>
                        <td data-label={t('common.amount')} className="num strong pos">{money2(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td colSpan={5}>{t('common.total')} ({received.length})</td><td className="num" data-label={t('common.amount')}>{money2(sum(received, (r) => r.p.amount))}</td></tr></tfoot>
                </table>
              </div>
            )}
        </Card>
      )}

      {tab === 'workers' && (
        <Card flush className="payments-list">
          {!allPaid.length ? <Empty title={t('payments.empty.workers')} action={<CanWrite><Button variant="primary" onClick={() => setPay('')}>{t('form.pay.worker')}</Button></CanWrite>}>{t('payments.empty.workersHint')}</Empty>
            : !paid.length ? noMatch : (
              <div className="table-wrap">
                <table className="tbl stackable payments-tbl" data-testid="payments-table-workers">
                  <thead><tr><th>{t('common.date')}</th><th>{t('team.col.who')}</th><th>{t('team.col.job')}</th><th>{t('common.method')}</th><th className="num">{t('common.amount')}</th></tr></thead>
                  <tbody>
                    {paid.map(({ p, w, j }) => (
                      <tr key={p.id}>
                        <td className="t1"><span className="nowrap">{date(p.date)}</span>{periodText(t, p, date) && <div className="xs dim payments-sub">{t('team.col.period')}: {periodText(t, p, date)}</div>}</td>
                        <td data-label={t('team.col.who')}>{w ? <A to={`/team/${w.id}`}>{w.name}</A> : null}</td>
                        <td data-label={t('team.col.job')}>{j ? <A to={`/jobs/${j.id}`}>{j.name}</A> : <span className="muted">{t('form.pay.noJob')}</span>}</td>
                        <td data-label={t('common.method')}>{t('m_' + p.method)}{p.ref ? <span className="small dim payments-ref">{p.ref}</span> : null}</td>
                        <td data-label={t('common.amount')} className="num strong">{money2(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td colSpan={4}>{t('common.total')} ({paid.length})</td><td className="num" data-label={t('common.amount')}>{money2(sum(paid, (r) => r.p.amount))}</td></tr></tfoot>
                </table>
              </div>
            )}
        </Card>
      )}

      {tab === 'expenses' && (
        <Card flush className="payments-list">
          {!allExpenses.length ? <Empty title={t('payments.empty.expenses')} action={<A to="/jobs" className="btn">{t('nav.jobs')}</A>}>{t('payments.empty.expensesHint')}</Empty>
            : !expenses.length ? noMatch : (
              <div className="table-wrap">
                <table className="tbl stackable payments-tbl" data-testid="payments-table-expenses">
                  <thead><tr><th>{t('common.date')}</th><th>{t('team.col.job')}</th><th>{t('payments.col.vendor')}</th><th>{t('payments.col.what')}</th><th className="num">{t('common.amount')}</th></tr></thead>
                  <tbody>
                    {expenses.map(({ e, j }) => (
                      <tr key={e.id}>
                        <td className="t1 nowrap">{date(e.date)}</td>
                        <td data-label={t('team.col.job')}><A to={`/jobs/${j.id}`}>{j.name}</A></td>
                        <td data-label={t('payments.col.vendor')}>{e.vendor || null}</td>
                        <td data-label={t('payments.col.what')}>{e.desc || null}</td>
                        <td data-label={t('common.amount')} className="num strong">{money2(e.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td colSpan={4}>{t('common.total')} ({expenses.length})</td><td className="num" data-label={t('common.amount')}>{money2(sum(expenses, (r) => r.e.amount))}</td></tr></tfoot>
                </table>
              </div>
            )}
        </Card>
      )}

      {tab === 'balances' && (
        <div className="stack">
          <Card flush title={t('payments.bal.clients')}>
            <p className="small muted payments-pad">{t('payments.k.clientsOweHint')}</p>
            {owing.length ? (
              <div className="table-wrap">
                <table className="tbl stackable payments-tbl" data-testid="payments-table-owing">
                  <thead><tr><th>{t('team.col.job')}</th><th className="num">{t('common.price')}</th><th className="num">{t('payments.col.received')}</th><th className="num">{t('common.balance')}</th><th aria-label={t('common.actions')} /></tr></thead>
                  <tbody>
                    {owing.map(({ j, c, m }) => (
                      <tr key={j.id}>
                        <td className="t1"><A to={`/jobs/${j.id}`} className="payments-name">{j.name}</A><div className="xs dim payments-sub">{c?.name}</div></td>
                        <td data-label={t('common.price')} className="num">{money(m.price)}</td>
                        <td data-label={t('payments.col.received')} className="num">{money(m.received)}</td>
                        <td data-label={t('common.balance')} className="num strong">{money2(m.clientOwes)}</td>
                        <td className="num payments-rowact"><CanWrite><Button size="sm" onClick={() => setRecv(j.id)} data-testid="payments-record-row" aria-label={`${t('form.pay.record')}: ${j.name}`}>{t('form.pay.record')}</Button></CanWrite></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td colSpan={3}>{t('common.total')} ({owing.length})</td><td className="num" data-label={t('common.balance')}>{money2(sum(owing, (r) => r.m.clientOwes))}</td><td /></tr></tfoot>
                </table>
              </div>
            ) : <p className="muted payments-pad">{t('payments.bal.noClients')}</p>}
          </Card>
          {crew && <Card flush title={t('payments.k.owed')}>
            <p className="small muted payments-pad">{t('team.k.owedHint')}</p>
            {owed.length ? (
              <div className="table-wrap">
                <table className="tbl stackable payments-tbl" data-testid="payments-table-owed">
                  <thead><tr><th>{t('team.col.who')}</th><th className="num">{t('team.col.agreed')}</th><th className="num">{t('team.col.paid')}</th><th className="num">{t('team.col.owed')}</th><th aria-label={t('common.actions')} /></tr></thead>
                  <tbody>
                    {owed.map(({ w, m }) => (
                      <tr key={w.id}>
                        <td className="t1"><A to={`/team/${w.id}`} className="payments-name">{w.name}</A><div className="xs dim payments-sub">{w.trade}</div></td>
                        <td data-label={t('team.col.agreed')} className="num">{money(m.agreed)}</td>
                        <td data-label={t('team.col.paid')} className="num">{money(m.paid)}</td>
                        <td data-label={t('team.col.owed')} className="num strong">{money2(m.owed)}</td>
                        <td className="num payments-rowact">{w.active !== false && <CanWrite><Button size="sm" onClick={() => setPay(w.id)} data-testid="payments-pay-row" aria-label={`${t('team.pay')}: ${w.name}`}>{t('team.pay')}</Button></CanWrite>}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td colSpan={3}>{t('common.total')} ({owed.length})</td><td className="num" data-label={t('team.col.owed')}>{money2(sum(owed, (r) => r.m.owed))}</td><td /></tr></tfoot>
                </table>
              </div>
            ) : <p className="muted payments-pad">{t('payments.bal.noWorkers')}</p>}
          </Card>}
        </div>
      )}

      {recv !== null && <ClientPaymentModal jobId={recv || undefined} onClose={() => setRecv(null)} />}
      {pay !== null && <PayWorkerModal workerId={pay || undefined} onClose={() => setPay(null)} />}
    </>
  );
}
