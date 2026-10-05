// Payments of a professional-services firm: what its clients paid it and what they still owe.
// Engagement payments, appointment fees, credits, open balances by engagement and by client with their age, receipts, export.
// This is the firm's own ledger with its clients. What a company pays for the platform is a different ledger and never
// appears here. Nothing on this screen charges a card: payments are recorded by hand, and the Square line only reports
// whether a connection exists.
import { useEffect, useMemo, useState } from 'react';
import { LuArrowLeft, LuHandCoins, LuPlug, LuPrinter, LuReceipt } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, appPath, navigate, useRoute } from '@/app/router';
import type { PageProps } from '@/app/routes';
import { Badge, Button, Card, Empty, PageHeader, Seg, Stat, cx, type Tone } from '@/ui';
import { CanWrite } from '@/app/shared';
import { ClientPaymentModal, PAY_METHODS } from '@/app/forms';
import { pick } from '@/i18n';
import { moduleOn } from '@/domain/config';
import { visibleClientIds } from '@/domain/access';
import { AGING_BUCKETS, agingTotals, appointmentMoney, byId, cents, dollars, isOpenCredit, openBalances, total, type AgingBucket, type OpenBalance } from '@/domain/selectors';
import type { Appointment, ConnState, Credit, Job, PayMethod, Payment } from '@/domain/types';
import { gateway } from '@/platform/gateway';
import { monthLabel, today } from '@/lib/dates';
import { money, money2 } from '@/lib/money';
import { ExportCsv } from '@/features/cash/parts';
import { usePrintInLight } from '@/features/reports/print';
import './payments.css';

type Tab = 'received' | 'balances' | 'appointments' | 'credits';
const TABS: Tab[] = ['received', 'balances', 'appointments', 'credits'];
const isTab = (v: string | null): v is Tab => !!v && (TABS as string[]).includes(v);
const BUCKET_TONE: Record<AgingBucket, Tone> = { d0: 'neutral', d31: 'info', d61: 'warn', d91: 'bad' };
/** One line of money received: a payment on an engagement, or the fee of an appointment. */
interface Receipt { id: string; date: string; clientId?: string; what: string; sub: string; method: PayMethod; ref: string; amount: number; kind: 'job' | 'appt'; to: string; receipt: string }

export default function PracticePayments({ id }: PageProps) {
  const { t, data, pack, lang, can, user, perms, date } = useApp();
  const route = useRoute();
  const asked = route.query.get('tab');
  const [tab, setTab] = useState<Tab>(isTab(asked) ? asked : 'received');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [method, setMethod] = useState<'' | PayMethod>(''); const [kind, setKind] = useState<'' | 'job' | 'appt'>('');
  const [bucket, setBucket] = useState<'' | AgingBucket>(''); const [by, setBy] = useState<'job' | 'client'>('job');
  const [recv, setRecv] = useState<string | null>(null);
  const [square, setSquare] = useState<ConnState | null>(null);
  const appts = moduleOn(data, pack, 'appointments') && can('appointments');

  // whether Square is connected is read from the connections, never assumed. A sample workspace is never connected.
  useEffect(() => {
    let live = true;
    gateway().integrations.list().then((list) => { if (live) setSquare(list.find((c) => c.id === 'square')?.state ?? 'not_connected'); }, () => { if (live) setSquare('not_connected'); });
    return () => { live = false; };
  }, []);

  // a client of another office is not shown to someone who may not open that client
  const seen = useMemo(() => visibleClientIds(data, user, perms), [data, user, perms]);
  const name = (clientId?: string) => byId(data.clients, clientId)?.name ?? '';
  const typeName = (a: Appointment) => { const ty = byId(data.apptTypes, a.typeId); return ty ? pick(ty.name, lang) : t('nav.appointments'); };
  const am = useMemo(() => appointmentMoney(data), [data]);

  const receipts = useMemo(() => {
    const out: Receipt[] = [];
    for (const j of data.jobs) if (seen.has(j.clientId)) for (const p of j.received) out.push({ id: p.id, date: p.date, clientId: j.clientId, what: j.name, sub: j.number, method: p.method, ref: p.ref, amount: p.amount, kind: 'job', to: `/jobs/${j.id}`, receipt: `/payments/receipt?job=${j.id}&p=${p.id}` });
    if (appts) for (const a of am.paid) if (!a.clientId || seen.has(a.clientId)) out.push({ id: a.id, date: a.paid!.at.slice(0, 10), clientId: a.clientId, what: typeName(a), sub: t('payments.p.apptOn', { date: date(a.date) }), method: a.paid!.method as PayMethod, ref: a.paid!.ref, amount: a.paid!.amount, kind: 'appt', to: `/appointments/${a.id}`, receipt: `/payments/receipt?appt=${a.id}` });
    return out.sort((x, y) => y.date.localeCompare(x.date));
  }, [data, seen, appts, am, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = receipts.filter((r) => (!from || r.date >= from) && (!to || r.date <= to) && (!method || r.method === method) && (!kind || r.kind === kind));
  const month = today().slice(0, 7);
  const receivedMonth = total(receipts.filter((r) => r.date.startsWith(month)), (r) => r.amount);

  const balances = useMemo(() => openBalances(data).filter((b) => seen.has(b.job.clientId)), [data, seen]);
  const aging = agingTotals(balances);
  const owed = total(balances, (b) => b.balance);
  const balRows = balances.filter((b) => !bucket || b.bucket === bucket);
  const byClient = useMemo(() => {
    const ids = [...new Set(balRows.map((b) => b.job.clientId))];
    return ids.map((cid) => { const rows = balRows.filter((b) => b.job.clientId === cid); return { cid, rows, balance: total(rows, (b) => b.balance), oldest: Math.max(...rows.map((b) => b.days)), aging: agingTotals(rows) }; }).sort((a, b) => b.balance - a.balance);
  }, [balRows]);

  const apptRows = appts ? (data.appointments ?? []).filter((a) => a.fee > 0 && (!a.clientId || seen.has(a.clientId))).sort((a, b) => b.date.localeCompare(a.date)) : [];
  const unpaid = apptRows.filter((a) => a.status === 'awaiting_payment');
  const credits = appts ? (data.credits ?? []).filter((c) => seen.has(c.clientId)).sort((a, b) => b.at.localeCompare(a.at)) : [];
  const openCredits = credits.filter(isOpenCredit);
  const apptState = (a: Appointment): { key: string; tone: Tone } => (a.paid ? (a.paid.method === 'credit' ? { key: 'credit', tone: 'info' } : { key: 'paid', tone: 'ok' }) : a.status === 'awaiting_payment' ? { key: 'waiting', tone: 'warn' } : a.status === 'cancelled_unpaid' ? { key: 'released', tone: 'neutral' } : a.status.startsWith('cancelled') ? { key: 'cancelled', tone: 'neutral' } : { key: 'due', tone: 'neutral' });
  const creditState = (c: Credit): { key: string; tone: Tone } => (c.void ? { key: 'void', tone: 'neutral' } : c.used ? { key: 'used', tone: 'ok' } : isOpenCredit(c) ? { key: 'open', tone: 'accent' } : { key: 'expired', tone: 'neutral' });

  usePrintInLight();
  if (id === 'receipt') return <ReceiptPage />;

  const filtered = !!(from || to || method || kind);
  const clear = () => { setFrom(''); setTo(''); setMethod(''); setKind(''); };
  const go = (next: Tab) => { setTab(next); navigate(appPath(next === 'received' ? '/payments' : `/payments?tab=${next}`), { replace: true }); };
  const tabs = TABS.filter((k) => appts || (k !== 'appointments' && k !== 'credits'));
  const counts: Record<Tab, number> = { received: receipts.length, balances: balances.length, appointments: unpaid.length, credits: openCredits.length };
  const days = (n: number) => t(n === 1 ? 'tasks.req.day' : 'tasks.req.days', { n });
  const csvRows = (): unknown[][] => (tab === 'received' ? [
    [t('common.date'), t('payments.col.client'), t('payments.p.col.for'), t('payments.p.col.kind'), t('common.method'), t('common.reference'), t('common.amount')],
    ...shown.map((r) => [r.date, name(r.clientId), r.what, t('payments.p.kind.' + r.kind), t('m_' + r.method), r.ref, r.amount.toFixed(2)]),
    [t('common.total'), '', '', '', '', '', total(shown, (r) => r.amount).toFixed(2)],
  ] : tab === 'balances' ? [
    [t('payments.col.client'), t('project'), t('payments.p.col.fee'), t('payments.col.received'), t('common.balance'), t('payments.p.col.since'), t('payments.p.col.days'), t('payments.p.col.bucket')],
    ...balRows.map((b) => [b.client?.name ?? '', b.job.name, b.price.toFixed(2), b.received.toFixed(2), b.balance.toFixed(2), b.since, b.days, t('payments.p.age.' + b.bucket)]),
    [t('common.total'), '', '', '', total(balRows, (b) => b.balance).toFixed(2), '', '', ''],
  ] : tab === 'appointments' ? [
    [t('common.date'), t('payments.col.client'), t('payments.p.col.appt'), t('common.status'), t('common.method'), t('common.reference'), t('payments.p.col.fee')],
    ...apptRows.map((a) => [a.date, name(a.clientId) || byId(data.leads, a.leadId)?.name || '', typeName(a), t('payments.p.ap.' + apptState(a).key), a.paid ? t(a.paid.method === 'credit' ? 'payments.p.byCredit' : 'm_' + a.paid.method) : '', a.paid?.ref ?? '', a.fee.toFixed(2)]),
  ] : [
    [t('common.date'), t('payments.col.client'), t('payments.p.col.reason'), t('common.status'), t('common.amount')],
    ...credits.map((c) => [c.at.slice(0, 10), name(c.clientId), t('payments.p.cr.reason.' + c.reason), t('payments.p.cr.' + creditState(c).key), c.amount.toFixed(2)]),
  ]);

  return (
    <div className="payments-p">
      <PageHeader title={t('nav.money')} sub={t('payments.p.sub')} actions={<CanWrite><Button variant="primary" icon={<LuHandCoins aria-hidden="true" />} onClick={() => setRecv('')} data-testid="payments-record">{t('form.pay.record')}</Button></CanWrite>} />

      <div className="kpis payments-kpis">
        <Stat label={t('payments.k.received')} value={money(receivedMonth)} hint={monthLabel(month, lang)} onClick={() => { go('received'); setFrom(month + '-01'); setTo(''); setMethod(''); setKind(''); }} testId="payments-kpi-received" />
        <Stat label={t('payments.p.k.owed')} value={money(owed)} hint={t('payments.p.k.owedHint', { n: balances.length })} onClick={() => { go('balances'); setBucket(''); }} attention={aging.d91.count > 0} testId="payments-kpi-owing" />
        {appts && <Stat label={t('payments.p.k.unpaid')} value={money(total(unpaid, (a) => a.fee))} hint={t('payments.p.k.unpaidHint', { n: unpaid.length })} onClick={() => go('appointments')} testId="payments-kpi-unpaid" />}
        {appts && <Stat label={t('payments.p.k.credits')} value={money(total(openCredits, (c) => c.amount))} hint={t('payments.p.k.creditsHint', { n: openCredits.length })} onClick={() => go('credits')} testId="payments-kpi-credits" />}
      </div>

      <div className="tabs payments-tabs" role="tablist">
        {tabs.map((k) => <button key={k} role="tab" type="button" aria-selected={k === tab} onClick={() => go(k)} data-testid={`payments-tab-${k}`}>{t('payments.p.tab.' + k)}{counts[k] > 0 && <span className="count">{counts[k]}</span>}</button>)}
      </div>

      <div className="filters payments-filters">
        {tab === 'received' && <>
          <label className="payments-date"><span>{t('common.from')}</span><input type="date" className="input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} data-testid="payments-from" /></label>
          <label className="payments-date"><span>{t('common.to')}</span><input type="date" className="input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} data-testid="payments-to" /></label>
          <select value={method} onChange={(e) => setMethod(e.target.value as PayMethod | '')} aria-label={t('common.method')} data-testid="payments-method"><option value="">{t('payments.allMethods')}</option>{PAY_METHODS.map((m) => <option key={m} value={m}>{t('m_' + m)}</option>)}</select>
          {appts && <select value={kind} onChange={(e) => setKind(e.target.value as '' | 'job' | 'appt')} aria-label={t('payments.p.col.kind')} data-testid="payments-kind"><option value="">{t('payments.p.kind.all')}</option><option value="job">{t('payments.p.kind.job')}</option><option value="appt">{t('payments.p.kind.appt')}</option></select>}
          {filtered && <button type="button" className="linkbtn small" onClick={clear}>{t('common.clearFilters')}</button>}
        </>}
        {tab === 'balances' && <Seg label={t('payments.p.by')} value={by} onChange={setBy} options={[{ value: 'job', label: t('payments.p.by.job') }, { value: 'client', label: t('payments.p.by.client') }]} />}
        <span className="grow" />
        <ExportCsv size="sm" name={t('payments.p.file.' + tab)} rows={csvRows} kind="payments" testId="payments-csv" />
      </div>

      {tab === 'received' && (
        <Card flush className="payments-list">
          {!receipts.length ? <Empty title={t('payments.empty.received')} action={<CanWrite><Button variant="primary" onClick={() => setRecv('')}>{t('form.pay.record')}</Button></CanWrite>}>{t('payments.empty.receivedHint')}</Empty>
            : !shown.length ? <Empty title={t('common.noResults')} action={<Button onClick={clear}>{t('common.clearFilters')}</Button>} /> : (
              <div className="table-wrap">
                <table className="tbl stackable payments-tbl" data-testid="payments-table-received">
                  <thead><tr><th>{t('common.date')}</th><th>{t('payments.col.client')}</th><th>{t('payments.p.col.for')}</th><th>{t('common.method')}</th><th className="num">{t('common.amount')}</th><th aria-label={t('common.actions')} /></tr></thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.kind + r.id}>
                        <td className="t1 nowrap">{date(r.date)}</td>
                        <td data-label={t('payments.col.client')}>{r.clientId ? <A to={`/clients/${r.clientId}/billing`}>{name(r.clientId)}</A> : null}</td>
                        <td data-label={t('payments.p.col.for')}><span><A to={r.to}>{r.what}</A><span className="xs dim payments-sub2"> {r.sub}</span></span></td>
                        <td data-label={t('common.method')}><span>{t('m_' + r.method)}{r.ref ? <span className="small dim payments-ref">{r.ref}</span> : null}</span></td>
                        <td data-label={t('common.amount')} className="num strong pos">{money2(r.amount)}</td>
                        <td className="num payments-rowact"><A to={r.receipt} className="btn sm ghost" aria-label={`${t('payments.p.receipt')}: ${name(r.clientId)} ${money2(r.amount)}`}><LuReceipt aria-hidden="true" />{t('payments.p.receipt')}</A></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td colSpan={4}>{t('common.total')} ({shown.length})</td><td className="num" data-label={t('common.amount')}>{money2(total(shown, (r) => r.amount))}</td><td /></tr></tfoot>
                </table>
              </div>
            )}
        </Card>
      )}

      {tab === 'balances' && (
        <div className="stack">
          <div className="payments-aging" role="group" aria-label={t('payments.p.aging')} data-testid="payments-aging">
            {AGING_BUCKETS.map((b) => (
              <button key={b} type="button" className={cx('payments-age', bucket === b && 'on', aging[b].count === 0 && 'zero')} aria-pressed={bucket === b} onClick={() => setBucket(bucket === b ? '' : b)} data-bucket={b}>
                <span className="k"><span className={cx('dot', BUCKET_TONE[b])} aria-hidden="true" />{t('payments.p.age.' + b)}</span>
                <span className="v">{money(aging[b].amount)}</span>
                <span className="h">{t('payments.p.age.n', { n: aging[b].count })}</span>
              </button>
            ))}
          </div>
          <Card flush>
            {!balances.length ? <Empty title={t('payments.bal.noClients')} /> : !balRows.length ? <Empty title={t('common.noResults')} action={<Button onClick={() => setBucket('')}>{t('common.clearFilters')}</Button>} /> : by === 'job' ? (
              <div className="table-wrap">
                <table className="tbl stackable payments-tbl" data-testid="payments-table-owing">
                  <thead><tr><th>{t('project')}</th><th className="num">{t('payments.p.col.fee')}</th><th className="num">{t('payments.col.received')}</th><th className="num">{t('common.balance')}</th><th>{t('payments.p.col.since')}</th><th aria-label={t('common.actions')} /></tr></thead>
                  <tbody>
                    {balRows.map((b: OpenBalance) => (
                      <tr key={b.job.id}>
                        <td className="t1"><A to={`/jobs/${b.job.id}`} className="payments-name">{b.job.name}</A><div className="xs dim payments-sub">{b.client ? <A to={`/clients/${b.client.id}/billing`}>{b.client.name}</A> : null}</div></td>
                        <td data-label={t('payments.p.col.fee')} className="num">{money2(b.price)}</td>
                        <td data-label={t('payments.col.received')} className="num">{money2(b.received)}</td>
                        <td data-label={t('common.balance')} className="num strong">{money2(b.balance)}</td>
                        <td data-label={t('payments.p.col.since')}><span><Badge tone={BUCKET_TONE[b.bucket]}>{days(b.days)}</Badge> <span className="xs dim nowrap">{date(b.since)}</span></span></td>
                        <td className="num payments-rowact"><CanWrite><Button size="sm" onClick={() => setRecv(b.job.id)} data-testid="payments-record-row" aria-label={`${t('form.pay.record')}: ${b.job.name}`}>{t('form.pay.record')}</Button></CanWrite></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td colSpan={3}>{t('common.total')} ({balRows.length})</td><td className="num" data-label={t('common.balance')}>{money2(total(balRows, (b) => b.balance))}</td><td colSpan={2} /></tr></tfoot>
                </table>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="tbl stackable payments-tbl" data-testid="payments-table-clients">
                  <thead><tr><th>{t('payments.col.client')}</th>{AGING_BUCKETS.map((b) => <th key={b} className="num">{t('payments.p.age.' + b)}</th>)}<th className="num">{t('common.balance')}</th></tr></thead>
                  <tbody>
                    {byClient.map((c) => (
                      <tr key={c.cid}>
                        <td className="t1"><A to={`/clients/${c.cid}/billing`} className="payments-name">{name(c.cid)}</A><div className="xs dim payments-sub">{t('payments.p.onJobs', { n: c.rows.length })} · {t('payments.p.oldest', { age: days(c.oldest) })}</div></td>
                        {AGING_BUCKETS.map((b) => <td key={b} data-label={t('payments.p.age.' + b)} className={cx('num', !c.aging[b].count && 'dim')}>{c.aging[b].count ? money2(c.aging[b].amount) : null}</td>)}
                        <td data-label={t('common.balance')} className="num strong">{money2(c.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td>{t('common.total')} ({byClient.length})</td>{AGING_BUCKETS.map((b) => <td key={b} className="num" data-label={t('payments.p.age.' + b)}>{money2(total(balRows.filter((r) => r.bucket === b), (r) => r.balance))}</td>)}<td className="num" data-label={t('common.balance')}>{money2(total(balRows, (b) => b.balance))}</td></tr></tfoot>
                </table>
              </div>
            )}
          </Card>
          <p className="xs dim payments-foot">{t('payments.p.agingNote')}</p>
        </div>
      )}

      {tab === 'appointments' && (
        <Card flush className="payments-list">
          {!apptRows.length ? <Empty title={t('payments.p.ap.empty')}>{t('payments.p.ap.emptyHint')}</Empty> : (
            <div className="table-wrap">
              <table className="tbl stackable payments-tbl" data-testid="payments-table-appointments">
                <thead><tr><th>{t('common.date')}</th><th>{t('payments.col.client')}</th><th>{t('payments.p.col.appt')}</th><th>{t('common.status')}</th><th>{t('common.method')}</th><th className="num">{t('payments.p.col.fee')}</th></tr></thead>
                <tbody>
                  {apptRows.map((a) => { const st = apptState(a); return (
                    <tr key={a.id}>
                      <td className="t1 nowrap"><A to={`/appointments/${a.id}`}>{date(a.date)}</A></td>
                      <td data-label={t('payments.col.client')}>{a.clientId ? <A to={`/clients/${a.clientId}/billing`}>{name(a.clientId)}</A> : byId(data.leads, a.leadId)?.name ?? null}</td>
                      <td data-label={t('payments.p.col.appt')}>{typeName(a)}</td>
                      <td data-label={t('common.status')}><span><Badge tone={st.tone}>{t('payments.p.ap.' + st.key)}</Badge>{a.status === 'awaiting_payment' && a.payBy && <span className="xs dim payments-sub2"> {t('dash.p.payBy', { date: date(a.payBy.slice(0, 10)) })}</span>}</span></td>
                      <td data-label={t('common.method')}>{a.paid ? <span>{t(a.paid.method === 'credit' ? 'payments.p.byCredit' : 'm_' + a.paid.method)}{a.paid.ref && a.paid.method !== 'credit' ? <span className="small dim payments-ref">{a.paid.ref}</span> : null}</span> : null}</td>
                      <td data-label={t('payments.p.col.fee')} className={cx('num strong', a.paid && a.paid.method !== 'credit' && 'pos')}>{money2(a.fee)}</td>
                    </tr>
                  ); })}
                </tbody>
                <tfoot><tr><td colSpan={5}>{t('payments.p.ap.totals', { paid: money2(am.feesReceived), credit: money2(am.creditsApplied), unpaid: money2(total(unpaid, (a) => a.fee)) })}</td><td /></tr></tfoot>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'credits' && (
        <Card flush className="payments-list">
          {!credits.length ? <Empty title={t('payments.p.cr.empty')}>{t('payments.p.cr.emptyHint')}</Empty> : (
            <div className="table-wrap">
              <table className="tbl stackable payments-tbl" data-testid="payments-table-credits">
                <thead><tr><th>{t('common.date')}</th><th>{t('payments.col.client')}</th><th>{t('payments.p.col.reason')}</th><th>{t('common.status')}</th><th className="num">{t('common.amount')}</th></tr></thead>
                <tbody>
                  {credits.map((c) => { const st = creditState(c); return (
                    <tr key={c.id}>
                      <td className="t1 nowrap">{date(c.at.slice(0, 10))}</td>
                      <td data-label={t('payments.col.client')}><A to={`/clients/${c.clientId}/billing`}>{name(c.clientId)}</A></td>
                      <td data-label={t('payments.p.col.reason')}>{t('payments.p.cr.reason.' + c.reason)}</td>
                      <td data-label={t('common.status')}><span><Badge tone={st.tone}>{t('payments.p.cr.' + st.key)}</Badge>{c.used && <span className="xs dim payments-sub2"> {date(c.used.at.slice(0, 10))}</span>}{!c.used && !c.void && c.expires && <span className="xs dim payments-sub2"> {t('payments.p.cr.until', { date: date(c.expires) })}</span>}</span></td>
                      <td data-label={t('common.amount')} className="num strong">{money2(c.amount)}</td>
                    </tr>
                  ); })}
                </tbody>
                <tfoot><tr><td colSpan={4}>{t('payments.p.cr.totals', { issued: money2(total(credits.filter((c) => !c.void), (c) => c.amount)), used: money2(total(credits.filter((c) => c.used), (c) => c.amount)) })}</td><td className="num" data-label={t('payments.p.cr.open')}>{money2(total(openCredits, (c) => c.amount))}</td></tr></tfoot>
              </table>
            </div>
          )}
        </Card>
      )}

      <div className="payments-notes">
        <p className="small muted payments-square" data-testid="payments-square" data-state={square ?? ''}>
          <LuPlug aria-hidden="true" /><span><b>{t('payments.p.sq')}</b> {square ? t('payments.p.sq.' + square) : ''} {t('payments.p.sq.note')}{moduleOn(data, pack, 'integrations') && can('integrations') && <> <A to="/integrations">{t('nav.integrations')}</A></>}</span>
        </p>
        <p className="xs dim">{t('payments.p.separate')}</p>
      </div>

      {recv !== null && <ClientPaymentModal jobId={recv || undefined} onClose={() => setRecv(null)} />}
    </div>
  );
}

/* ---------- a printable receipt for one payment ---------- */
function ReceiptPage() {
  const { t, data, lang, date, user, perms } = useApp();
  const route = useRoute();
  const seen = visibleClientIds(data, user, perms);
  const job: Job | undefined = byId(data.jobs, route.query.get('job') ?? undefined);
  const pay: Payment | undefined = job?.received.find((p) => p.id === route.query.get('p'));
  const appt = byId(data.appointments ?? [], route.query.get('appt') ?? undefined);
  const clientId = job?.clientId ?? appt?.clientId;
  const client = byId(data.clients, clientId);
  const found = (job && pay) || (appt && appt.paid && appt.paid.method !== 'credit');
  const back = <A to="/payments" className="crumb no-print"><LuArrowLeft aria-hidden="true" />{t('nav.money')}</A>;
  if (!found || (clientId && !seen.has(clientId))) return <>{back}<Card><Empty title={t('payments.p.rc.gone')} /></Card></>;
  const amount = pay ? pay.amount : appt!.paid!.amount;
  const when = pay ? pay.date : appt!.paid!.at.slice(0, 10);
  const methodKey = pay ? pay.method : appt!.paid!.method;
  const ref = pay ? pay.ref : appt!.paid!.ref;
  const ty = appt ? byId(data.apptTypes, appt.typeId) : undefined;
  // what was still owed on the engagement after this payment: the fee minus everything received up to and including it
  const upTo = job && pay ? job.received.filter((p) => p.date < pay.date || (p.date === pay.date && job.received.indexOf(p) <= job.received.indexOf(pay))) : [];
  const after = job && pay ? dollars(cents(job.price) - upTo.reduce((a, p) => a + cents(p.amount), 0)) : null;
  return (
    <div className="payments-receipt">
      <div className="row between no-print payments-rc-bar">{back}<Button icon={<LuPrinter aria-hidden="true" />} onClick={() => window.print()} data-testid="payments-receipt-print">{t('common.print')}</Button></div>
      <article className="paper" data-testid="payments-receipt">
        <header className="payments-rc-h">
          <div><h1 className="payments-rc-co">{data.company.name}</h1>{data.company.address && <p>{data.company.address}</p>}<p>{[data.company.phone, data.company.email].filter(Boolean).join(' · ')}</p></div>
          <div className="payments-rc-t"><h2>{t('payments.p.rc.title')}</h2><p>{date(when)}</p></div>
        </header>
        <dl className="payments-rc-kv">
          <dt>{t('payments.p.rc.from')}</dt><dd>{client ? (client.company ? `${client.name}, ${client.company}` : client.name) : byId(data.leads, appt?.leadId)?.name ?? ''}</dd>
          <dt>{t('payments.p.rc.for')}</dt><dd>{job ? `${job.name} (${job.number})` : `${ty ? pick(ty.name, lang) : t('nav.appointments')}, ${date(appt!.date)}`}</dd>
          <dt>{t('common.method')}</dt><dd>{t('m_' + methodKey)}{ref ? ` · ${ref}` : ''}</dd>
          <dt>{t('payments.p.rc.amount')}</dt><dd className="payments-rc-amt">{money2(amount)}</dd>
          {after !== null && <><dt>{t('payments.p.rc.after')}</dt><dd>{money2(Math.max(0, after))}</dd></>}
        </dl>
        <p className="payments-rc-foot">{t('payments.p.rc.foot', { company: data.company.name })}</p>
      </article>
    </div>
  );
}
