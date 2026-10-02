// 1099 and compliance: what each worker was paid in a tax year, what counts toward the 1099-NEC, the paperwork still missing,
// and who does the filing. The software prepares the report; preparation and e-filing are a service by Lion Business Services.
import { useMemo, useState } from 'react';
import { LuDownload, LuPrinter, LuArrowRight, LuPenLine } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, PREVIEW } from '@/app/router';
import type { PageProps } from '@/app/routes';
import { mutate } from '@/store/store';
import { Badge, Button, Card, Dot, Empty, PageHeader, Stat, cx, confirmDialog, toast, type Tone } from '@/ui';
import { DemoTag, PlanBadge, W9Badge } from '@/app/shared';
import { threshold1099, workerMoney } from '@/domain/selectors';
import { addOnViews } from '@/lib/pricing-view';
import { money, money2, sum } from '@/lib/money';
import { nowIso } from '@/lib/dates';
import { attentionItems, attentionOf, csvAmount, downloadCsv, paymentYears, type AttentionKind } from '@/features/team/util';
import './compliance.css';

type Todo = 'file' | 'needW9' | 'askW9' | 'under';
const TODO_TONE: Record<Todo, Tone> = { file: 'info', needW9: 'bad', askW9: 'warn', under: 'neutral' };
const ATTN_TONE: Record<AttentionKind, Tone> = { w9: 'bad', expired: 'bad', soon: 'warn' };

export default function CompliancePage(_: PageProps) {
  const { t, data, pack, date, prefs } = useApp();
  const years = useMemo(() => paymentYears(data), [data]);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const limit = threshold1099(year);

  const rows = useMemo(() => data.workers.map((w) => {
    const m = workerMoney(data, w.id, year);
    const reaches = m.reportable >= limit;
    const todo: Todo = reaches ? (w.w9 ? 'file' : 'needW9') : m.reportable > 0 && !w.w9 ? 'askW9' : 'under';
    // an expired certificate only matters for people still on the team; the W-9 is needed for anyone who was paid
    return { w, m, reaches, todo, missing: attentionOf(w).filter((k) => k === 'w9' || w.active !== false) };
  }).filter((r) => r.m.paidYear > 0).sort((a, b) => b.m.reportable - a.m.reportable || a.w.name.localeCompare(b.w.name)), [data, year, limit]);

  if (!pack.compliance) return <><PageHeader title={t('nav.compliance')} /><Card><Empty title={t('compliance.na')} /></Card></>;

  const forms = rows.filter((r) => r.reaches);
  const attention = attentionItems(data);
  const total = { paid: sum(rows, (r) => r.m.paidYear), card: sum(rows, (r) => r.m.excluded), counts: sum(rows, (r) => r.m.reportable) };

  const csv = () => {
    downloadCsv(t('compliance.csvName', { year }), [
      [t('team.col.who'), t('trade'), t('w9'), t('team.w9Date'), t('compliance.col.paid'), t('compliance.col.card'), t('compliance.col.counts'), t('compliance.col.reaches', { limit: money(limit) }), t('compliance.col.todo')],
      ...rows.map((r) => [r.w.name, r.w.trade, t(r.w.w9 ? 'onFile' : 'missing'), r.w.w9Date || '', csvAmount(r.m.paidYear), csvAmount(r.m.excluded), csvAmount(r.m.reportable), t(r.reaches ? 'common.yes' : 'common.no'), t('compliance.st.' + r.todo)]),
      [t('common.total'), '', '', '', csvAmount(total.paid), csvAmount(total.card), csvAmount(total.counts), String(forms.length), ''],
    ]);
    if (!PREVIEW) toast(t('compliance.csvDone'));
  };

  return (
    <div className="compliance-page">
      <PageHeader title={t('nav.compliance')} sub={t('compliance.sub')} actions={<>
        <label className="compliance-year no-print"><span>{t('compliance.year')}</span>
          <select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))} data-testid="compliance-year">{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        </label>
        <Button icon={<LuDownload />} onClick={csv} disabled={!rows.length} className="no-print" data-testid="compliance-csv">{t('compliance.csv')}</Button>
        <Button icon={<LuPrinter />} onClick={() => window.print()} className="no-print" data-testid="compliance-print">{t('common.print')}</Button>
      </>} />

      <div className="kpis compliance-kpis">
        <Stat label={t('compliance.k.paid', { year })} value={money(total.paid)} />
        <Stat label={t('compliance.k.counts')} value={money(total.counts)} hint={t('compliance.k.countsHint')} />
        <Stat label={t('compliance.k.forms')} value={forms.length} hint={t('compliance.k.formsHint', { limit: money(limit) })} />
        <Stat label={t('compliance.k.w9')} value={forms.filter((r) => !r.w.w9).length} hint={t('compliance.k.w9Hint')} attention={forms.some((r) => !r.w.w9)} />
      </div>

      <Card flush title={t('compliance.report', { year })} className="compliance-report">
        <p className="small muted compliance-rule">{t('compliance.rule', { year, limit: money(limit), old: money(threshold1099(2025)), next: money(threshold1099(2026)) })}</p>
        {rows.length ? (
          <div className="table-wrap">
            <table className="tbl stackable compliance-tbl" data-testid="compliance-table">
              <thead><tr>
                <th>{t('team.col.who')}</th><th>{t('w9')}</th><th className="num">{t('compliance.col.paid')}</th><th className="num">{t('compliance.col.card')}</th>
                <th className="num">{t('compliance.col.counts')}</th><th>{t('compliance.col.todo')}</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.w.id}>
                    <td className="t1"><A to={`/team/${r.w.id}`} className="compliance-name">{r.w.name}</A><div className="xs dim compliance-trade">{r.w.trade}</div></td>
                    <td data-label={t('w9')}><W9Badge worker={r.w} /></td>
                    <td data-label={t('compliance.col.paid')} className="num">{money2(r.m.paidYear)}</td>
                    <td data-label={t('compliance.col.card')} className="num muted">{r.m.excluded ? money2(r.m.excluded) : null}</td>
                    <td data-label={t('compliance.col.counts')} className="num strong">{money2(r.m.reportable)}</td>
                    <td data-label={t('compliance.col.todo')}>
                      <span className="row tight compliance-miss"><Badge tone={TODO_TONE[r.todo]}>{t('compliance.st.' + r.todo)}</Badge>
                        {r.missing.map((k) => <Badge key={k} tone={ATTN_TONE[k]} outline title={t('compliance.col.missing')}>{t('compliance.miss.' + k)}</Badge>)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr>
                <td colSpan={2}>{t('common.total')} ({rows.length})</td>
                <td className="num" data-label={t('compliance.col.paid')}>{money2(total.paid)}</td>
                <td className="num" data-label={t('compliance.col.card')}>{money2(total.card)}</td>
                <td className="num" data-label={t('compliance.col.counts')}>{money2(total.counts)}</td>
                <td>{t('compliance.formsLine', { n: forms.length })}</td>
              </tr></tfoot>
            </table>
          </div>
        ) : <Empty title={t('compliance.none', { year })}>{t('compliance.noneHint')}</Empty>}
      </Card>

      <div className="split compliance-rest no-print">
        <Card title={t('compliance.who')}>
          <p className="small muted">{t('compliance.who.intro')} {t('price.r.1099')}</p>
          <Services />
        </Card>

        <div className="stack">
          <Card title={<>{t('compliance.attn')}{attention.length > 0 && <span className="count">{attention.length}</span>}</>}>
            {attention.length ? (
              <div className="list" data-testid="compliance-attention">
                {attention.map(({ worker: w, kind }) => (
                  <div className="item compliance-attn" key={w.id + kind}>
                    <Dot tone={ATTN_TONE[kind]} />
                    <div className="grow"><A to={`/team/${w.id}`} className="compliance-name">{w.name}</A><div className={cx('small', kind === 'soon' ? 'muted' : 'neg')}>{t('compliance.attn.' + kind, { date: date(w.coiExp) })}</div></div>
                    <A to={`/team/${w.id}`} className="btn sm" aria-label={`${t('common.open')}: ${w.name}`}>{t('common.open')}<LuArrowRight aria-hidden="true" /></A>
                  </div>
                ))}
              </div>
            ) : <p className="small muted">{t('team.allClearHint')}</p>}
          </Card>
          <Consent canSign={prefs.viewAs === 'owner'} />
        </div>
      </div>
    </div>
  );
}

/** The services around the report, each with its commercial standing for the plan being previewed. */
function Services() {
  const { t, pack, lang, standing } = useApp();
  const views = addOnViews(pack.id, lang, t);
  const prep = views.find((v) => v.id === '1099_prep');
  const efile = views.find((v) => v.id === '1099_efile_mail');
  const prepIncluded = standing('prep1099Included').state === 'included';
  const priceLine = (v: typeof prep) => (v ? [v.price, v.billing].filter(Boolean).join(' ') : '');
  return (
    <div className="list compliance-svc" data-testid="compliance-services">
      <div className="item">
        <div className="grow"><div className="t">{t('compliance.svc.report')}</div><div className="small muted">{t('compliance.svc.reportHint')}</div></div>
        <PlanBadge feature="report1099" />
      </div>
      {prep && (
        <div className="item">
          <div className="grow">
            <div className="t">{prepIncluded ? t('compliance.svc.prep') : prep.name}</div>
            <div className="small muted">{prepIncluded ? t('price.f.prep1099', { prep: prep.price ?? '' }) : priceLine(prep)}. {t('compliance.svc.by')}</div>
            {!prepIncluded && <div className="small muted compliance-also"><PlanBadge feature="prep1099Included" /> <span>{t('price.f.prep1099', { prep: prep.price ?? '' })}</span></div>}
          </div>
          <PlanBadge feature={prepIncluded ? 'prep1099Included' : 'prep1099'} />
        </div>
      )}
      {efile && (
        <div className="item">
          <div className="grow"><div className="t">{efile.name}</div><div className="small muted">{priceLine(efile)}. {t('compliance.svc.by')}</div></div>
          <PlanBadge feature="efile1099" />
        </div>
      )}
      <div className="item">
        <div className="grow"><div className="t">{t('price.f.w9')}</div><div className="small muted">{t('compliance.svc.w9Hint')}</div></div>
        <PlanBadge feature="w9Collection" />
      </div>
    </div>
  );
}

/** Written consent to share worker payment data for 1099 preparation. A demo record: nothing is shared from the demo. */
function Consent({ canSign }: { canSign: boolean }) {
  const { t, data, dateTime } = useApp();
  const consent = data.settings.consent1099;
  const [agree, setAgree] = useState(false);
  const [name, setName] = useState('');
  const [err, setErr] = useState(false);
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const signer = name.trim();
    if (!agree || signer.length < 3) { setErr(true); return; }
    mutate((d) => { d.settings = { ...d.settings, consent1099: { name: signer, at: nowIso() } }; });
    setErr(false); setAgree(false); setName(''); toast(t('compliance.consent.saved'));
  };
  const withdraw = async () => {
    if (!(await confirmDialog(t('compliance.consent.withdrawAsk'), t('compliance.consent.withdraw'), t('common.cancel')))) return;
    mutate((d) => { const rest = { ...d.settings }; delete rest.consent1099; d.settings = rest; });
    toast(t('compliance.consent.withdrawn'));
  };
  return (
    <Card title={t('compliance.consent')} actions={<DemoTag />}>
      {consent ? (
        <div className="stack tight" data-testid="compliance-consent-record">
          <div><Badge tone="ok">{t('compliance.consent.on')}</Badge></div>
          <p>{t('compliance.consent.by', { name: consent.name, date: dateTime(consent.at) })}</p>
          <p className="small muted">{t('compliance.consent.text')}</p>
          {canSign ? <div><Button size="sm" variant="danger" onClick={withdraw} data-testid="compliance-consent-withdraw">{t('compliance.consent.withdraw')}</Button></div> : <p className="small muted">{t('compliance.consent.ownerOnly')}</p>}
        </div>
      ) : canSign ? (
        <form className="stack tight" onSubmit={save} noValidate>
          <p className="small muted">{t('compliance.consent.need')}</p>
          <label className="check"><input type="checkbox" checked={agree} onChange={(e) => { setAgree(e.target.checked); setErr(false); }} data-testid="compliance-consent-agree" /><span>{t('compliance.consent.text')}</span></label>
          <label className={cx('field', err && name.trim().length < 3 && 'err')}><span className="label">{t('compliance.consent.name')}</span>
            <input value={name} onChange={(e) => { setName(e.target.value); setErr(false); }} autoComplete="name" data-testid="compliance-consent-name" />
          </label>
          {err && <p className="small neg" role="alert">{t('compliance.consent.err')}</p>}
          <div><Button type="submit" variant="primary" icon={<LuPenLine />} data-testid="compliance-consent">{t('compliance.consent.save')}</Button></div>
        </form>
      ) : (
        <div className="stack tight"><div><Badge tone="warn">{t('compliance.consent.missing')}</Badge></div><p className="small muted">{t('compliance.consent.need')} {t('compliance.consent.ownerOnly')}</p></div>
      )}
      <p className="xs dim compliance-demo">{t('compliance.consent.demo')}</p>
    </Card>
  );
}
