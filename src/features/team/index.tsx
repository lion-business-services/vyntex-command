// Team: the people who do the work. How each one is paid, their paperwork, and what is agreed, paid and still owed.
import { useMemo, useState } from 'react';
import { LuPlus, LuPencil, LuTrash2, LuBanknote, LuMail, LuFileCheck2, LuShieldCheck, LuArrowRight } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, go } from '@/app/router';
import { BackLink } from '@/app/Shell';
import type { PageProps } from '@/app/routes';
import { act } from '@/store/store';
import { Avatar, Badge, Button, Card, Empty, FormModal, IconButton, PageHeader, SearchBox, Seg, Stat, cx, confirmDialog, toast, type FieldDef, type Tone } from '@/ui';
import { ActivityList, ContactLinks, InsuranceBadge, PlanBadge, W9Badge, CanWrite } from '@/app/shared';
import { PAY_TYPES, PayWorkerModal } from '@/app/forms';
import { deleteWorkerPay, saveWorker } from '@/domain/actions';
import { activityFor, byId, jobsOfWorker, threshold1099, workerMoney } from '@/domain/selectors';
import type { AssignStatus, PayType, Worker } from '@/domain/types';
import { planName } from '@/lib/pricing';
import { money, money2, sum } from '@/lib/money';
import { today } from '@/lib/dates';
import { attentionOf, payTypeLabel, periodText, rateLabel } from './util';
import { InsuranceModal, W9Modal } from './paperwork';
import { OfficeTeam, Profile } from './office';
import '@/features/leads/work.css';
import './team.css';

const ASSIGN_TONE: Record<AssignStatus, Tone> = { pending: 'neutral', progress: 'info', done: 'ok' };

export default function TeamPage({ id }: PageProps) {
  const { pack } = useApp();
  // an edition without field workers has no crews to list: its team page is the office team and each person's profile
  if (!pack.usesWorkers) return id ? <Profile id={id} /> : <OfficeTeam />;
  return id ? <WorkerDetail id={id} /> : <TeamList />;
}

/* ---------- list ---------- */
type Show = 'active' | 'attention' | 'inactive';
function TeamList() {
  const { t, data, can, pack } = useApp();
  const [q, setQ] = useState('');
  const [show, setShow] = useState<Show>('active');
  const [form, setForm] = useState(false);
  const [pay, setPay] = useState<string | null>(null);
  const showMoney = can('money');
  const year = new Date().getFullYear();

  const all = useMemo(() => data.workers.map((w) => ({ w, m: workerMoney(data, w.id, year), attn: pack.compliance && w.active !== false ? attentionOf(w) : [] })), [data, pack.compliance, year]);
  const active = all.filter((r) => r.w.active !== false);
  const inactive = all.filter((r) => r.w.active === false);
  const attention = active.filter((r) => r.attn.length);
  const pool = show === 'inactive' && inactive.length ? inactive : show === 'attention' && pack.compliance ? attention : active;
  const s = q.trim().toLowerCase();
  const rows = pool.filter((r) => !s || [r.w.name, r.w.trade, r.w.phone, r.w.email].some((v) => v && v.toLowerCase().includes(s)));
  const filtered = !!s || show !== 'active';
  const clear = () => { setQ(''); setShow('active'); };

  const options: { value: Show; label: string; count?: number }[] = [{ value: 'active', label: t('team.show.active'), count: active.length }];
  if (pack.compliance) options.push({ value: 'attention', label: t('team.show.attention'), count: attention.length });
  if (inactive.length) options.push({ value: 'inactive', label: t('team.show.inactive'), count: inactive.length });

  return (
    <>
      <PageHeader title={t('nav.team')} sub={t(pack.compliance ? 'team.sub' : 'team.subPlain')} actions={<>
        {showMoney && <CanWrite><Button icon={<LuBanknote />} onClick={() => setPay('')} data-testid="team-pay">{t('form.pay.worker')}</Button></CanWrite>}
        <CanWrite><Button variant={data.workers.length ? 'primary' : 'default'} icon={<LuPlus />} onClick={() => setForm(true)} data-testid="team-new">{t('team.new')}</Button></CanWrite>
      </>} />

      {!!data.workers.length && (
        <div className="kpis team-kpis">
          <Stat label={t('team.k.active')} value={active.length} hint={inactive.length ? t('team.k.inactive', { n: inactive.length }) : undefined} />
          {pack.compliance && <Stat label={t('team.k.attention')} value={attention.length} hint={t('team.k.attentionHint')} attention={attention.length > 0} onClick={() => setShow('attention')} testId="team-kpi-attention" />}
          {showMoney && <Stat label={t('team.k.paidYear', { year })} value={money(sum(all, (r) => r.m.paidYear))} />}
          {showMoney && <Stat label={t('team.k.owed')} value={money(sum(active, (r) => Math.max(0, r.m.owed)))} hint={t('team.k.owedHint')} />}
        </div>
      )}

      {!data.workers.length ? (
        <Card className="work-none"><Empty title={t('team.empty')} action={<CanWrite><Button variant="primary" icon={<LuPlus />} onClick={() => setForm(true)}>{t('team.new')}</Button></CanWrite>}>{t('team.emptyHint')}</Empty></Card>
      ) : (
        <>
          <div className="filters team-filters">
            <SearchBox value={q} onChange={setQ} placeholder={t('team.search')} />
            {options.length > 1 && <Seg label={t('common.filter')} value={show} onChange={setShow} options={options} />}
            {filtered && <button type="button" className="linkbtn small" onClick={clear}>{t('common.clearFilters')}</button>}
          </div>
          {!rows.length ? (
            show === 'attention' && !s
              ? <Card className="work-none"><Empty title={t('team.allClear')} action={<Button onClick={clear}>{t('team.showAll')}</Button>}>{t('team.allClearHint')}</Empty></Card>
              : <Card className="work-none"><Empty title={t('common.noResults')} action={<Button onClick={clear}>{t('common.clearFilters')}</Button>} /></Card>
          ) : (
            <Card flush>
              <div className="table-wrap">
                <table className="tbl stackable team-tbl team-list" data-testid="team-table">
                  <thead><tr>
                    <th>{t('team.col.who')}</th><th className="team-c-phone">{t('common.phone')}</th><th>{t('team.col.pay')}</th>
                    {pack.compliance && <><th>{t('w9')}</th><th>{t('coi')}</th></>}
                    {showMoney && <><th className="num">{t('team.col.agreed')}</th><th className="num">{t('team.col.paid')}</th><th className="num">{t('team.col.owed')}</th><th aria-label={t('common.actions')} /></>}
                  </tr></thead>
                  <tbody>
                    {rows.map(({ w, m }) => (
                      <tr key={w.id} className="click" onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button')) go(`/team/${w.id}`); }}>
                        <td className="t1">
                          <span className="team-who"><Avatar name={w.name} size="sm" />
                            <span className="grow"><A to={`/team/${w.id}`} className="team-name">{w.name}</A>{w.active === false && <> <Badge outline>{t('team.inactive')}</Badge></>}<span className="xs dim team-trade">{w.trade}</span></span>
                          </span>
                        </td>
                        <td data-label={t('common.phone')} className="nowrap team-c-phone">{w.phone ? <a href={`tel:${w.phone.replace(/[^0-9+]/g, '')}`} className="team-tel">{w.phone}</a> : null}</td>
                        <td data-label={t('team.col.pay')}>{w.payType ? <span className="team-pay">{payTypeLabel(t, w.payType)}{rateLabel(t, w.payType, w.rate) && <span className="xs dim">{rateLabel(t, w.payType, w.rate)}</span>}</span> : null}</td>
                        {pack.compliance && <><td data-label={t('w9')}><W9Badge worker={w} /></td><td data-label={t('coi')}><InsuranceBadge worker={w} /></td></>}
                        {showMoney && <>
                          <td data-label={t('team.col.agreed')} className="num">{money(m.agreed)}</td>
                          <td data-label={t('team.col.paid')} className="num">{money(m.paid)}</td>
                          <td data-label={t('team.col.owed')} className={cx('num strong', m.owed < -0.005 && 'neg')}>{money(m.owed)}</td>
                          <td className="num team-rowact">{w.active !== false && <CanWrite><Button size="sm" onClick={() => setPay(w.id)} data-testid="team-pay-row" aria-label={`${t('team.pay')}: ${w.name}`}>{t('team.pay')}</Button></CanWrite>}</td>
                        </>}
                      </tr>
                    ))}
                  </tbody>
                  {showMoney && rows.length > 1 && (
                    <tfoot><tr>
                      <td>{t('common.total')} ({rows.length})</td><td className="team-c-phone" /><td colSpan={pack.compliance ? 3 : 1} />
                      <td className="num" data-label={t('team.col.agreed')}>{money(sum(rows, (r) => r.m.agreed))}</td>
                      <td className="num" data-label={t('team.col.paid')}>{money(sum(rows, (r) => r.m.paid))}</td>
                      <td className="num" data-label={t('team.col.owed')}>{money(sum(rows, (r) => r.m.owed))}</td><td />
                    </tr></tfoot>
                  )}
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {form && <WorkerForm onClose={() => setForm(false)} />}
      {pay !== null && <PayWorkerModal workerId={pay || undefined} onClose={() => setPay(null)} />}
    </>
  );
}

/* ---------- add / edit ---------- */
function WorkerForm({ worker, onClose }: { worker?: Worker; onClose: () => void }) {
  const { t } = useApp();
  const fields: FieldDef[] = [
    { k: 'name', label: t('team.f.name'), req: true, full: true },
    { k: 'trade', label: t('trade') }, { k: 'phone', label: t('common.phone'), type: 'tel' },
    { k: 'email', label: t('common.email'), type: 'email', full: true },
    { k: 'payType', label: t('team.f.payType'), type: 'select', options: PAY_TYPES.map((x) => [x, payTypeLabel(t, x)]) },
    { k: 'rate', label: `${t('team.f.rate')} (${t('common.optional')})`, type: 'money', hint: t('team.f.rateHint') },
    ...(worker ? [{ k: 'active', label: t('team.f.active'), type: 'checkbox' as const, full: true }] : []),
  ];
  const initial = worker ? { ...worker, payType: worker.payType ?? 'project', rate: worker.rate ?? '', active: worker.active !== false } : { payType: 'project' };
  return (
    <FormModal title={t(worker ? 'team.edit' : 'team.new')} fields={fields} initial={initial} onClose={onClose} saveLabel={t('common.save')} cancelLabel={t('common.cancel')} requiredMsg={t('common.required')}
      onSave={(v) => {
        const patch = { name: v.name, trade: v.trade, phone: v.phone, email: v.email, payType: v.payType as PayType, rate: v.rate || undefined };
        if (worker) {
          const { id, ...rest } = worker;
          act(saveWorker, { ...rest, ...patch, active: !!v.active }, id); toast(t('team.saved'));
        } else {
          const w = act(saveWorker, { ...patch, w9: false, active: true }); toast(t('team.created')); go(`/team/${w.id}`);
        }
      }} />
  );
}

/* ---------- one person ---------- */
function WorkerDetail({ id }: { id: string }) {
  const { t, data, can, pack, date, standing, lang } = useApp();
  const w = byId(data.workers, id);
  const year = new Date().getFullYear();
  const [edit, setEdit] = useState(false);
  const [pay, setPay] = useState(false);
  const [w9, setW9] = useState(false);
  const [coi, setCoi] = useState(false);
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(today());
  if (!w) return <Empty title={t('team.notFound')} action={<A to="/team" className="btn">{t('team.back')}</A>} />;

  const showMoney = can('money');
  // the shared payment form only lists active people
  const canPay = showMoney && w.active !== false;
  const m = workerMoney(data, w.id, year);
  const allPays = data.workerPays.filter((p) => p.workerId === w.id);
  const pays = allPays.filter((p) => (!from || p.date >= from) && (!to || p.date <= to)).sort((a, b) => b.date.localeCompare(a.date));
  const byMethod = new Map<string, number>();
  for (const p of pays) byMethod.set(p.method, (byMethod.get(p.method) || 0) + p.amount);
  const jobs = jobsOfWorker(data, w.id).map((j) => {
    const mine = j.assign.filter((a) => a.workerId === w.id);
    const agreed = sum(mine, (a) => a.price);
    const paid = sum(allPays.filter((p) => p.jobId === j.id), (p) => p.amount);
    return { j, mine, agreed, paid, owed: agreed - paid };
  });
  const uploads = standing('complianceUploads');
  const limit = threshold1099(year);
  const reaches = m.reportable >= limit;
  const removePay = async (payId: string) => { if (await confirmDialog(t('team.payDelete'), t('common.delete'), t('common.cancel'))) { act(deleteWorkerPay, payId); toast(t('common.deleted')); } };

  return (
    <>
      <BackLink to="/team">{t('team.back')}</BackLink>
      <PageHeader title={<>{w.name} {w.active === false && <Badge outline>{t('team.inactive')}</Badge>}</>} sub={w.trade || undefined} actions={<>
        <CanWrite><Button icon={<LuPencil />} onClick={() => setEdit(true)} data-testid="team-edit">{t('common.edit')}</Button></CanWrite>
        {canPay && <CanWrite><Button variant="primary" icon={<LuBanknote />} onClick={() => setPay(true)} data-testid="team-pay">{t('team.pay')}</Button></CanWrite>}
      </>} />

      {showMoney && (
        <div className="kpis team-kpis">
          <Stat label={t('team.col.agreed')} value={money(m.agreed)} hint={t('team.k.jobs', { n: jobs.length })} />
          <Stat label={t('team.col.paid')} value={money(m.paid)} />
          <Stat label={t('team.col.owed')} value={money(m.owed)} />
          <Stat label={t('team.k.paidYear', { year })} value={money(m.paidYear)} hint={t('team.k.ytd')} />
        </div>
      )}

      <div className="split">
        <div className="stack">
          <Card flush title={t('team.jobs')}>
            {jobs.length ? (
              <div className="table-wrap">
                <table className="tbl stackable team-tbl" data-testid="team-jobs">
                  <thead><tr><th>{t('team.col.job')}</th><th>{t('part')}</th>{showMoney && <><th className="num">{t('team.col.agreed')}</th><th className="num">{t('team.col.paid')}</th><th className="num">{t('team.col.owed')}</th></>}</tr></thead>
                  <tbody>
                    {jobs.map(({ j, mine, agreed, paid, owed }) => (
                      <tr key={j.id}>
                        <td className="t1"><A to={`/jobs/${j.id}`} className="team-name">{j.name}</A><div className="xs dim team-trade">{byId(data.clients, j.clientId)?.name}</div></td>
                        <td data-label={t('part')}><div className="team-parts">{mine.map((a) => <span key={a.id}>{a.scope} <Badge tone={ASSIGN_TONE[a.status]}>{t('a_' + a.status)}</Badge></span>)}</div></td>
                        {showMoney && <>
                          <td data-label={t('team.col.agreed')} className="num">{money(agreed)}</td>
                          <td data-label={t('team.col.paid')} className="num">{money(paid)}</td>
                          <td data-label={t('team.col.owed')} className={cx('num strong', owed < -0.005 && 'neg')}>{money(owed)}</td>
                        </>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="muted small team-pad">{t('team.noJobs')}</p>}
          </Card>

          {showMoney && (
            <Card flush title={t('team.history')} actions={canPay ? <CanWrite><Button size="sm" icon={<LuBanknote />} onClick={() => setPay(true)}>{t('team.pay')}</Button></CanWrite> : undefined}>
              <div className="team-range">
                <label className="small muted">{t('common.from')} <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="team-from" /></label>
                <label className="small muted">{t('common.to')} <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="team-to" /></label>
                {(from || to) && allPays.length > pays.length && <button type="button" className="linkbtn small" onClick={() => { setFrom(''); setTo(''); }}>{t('team.allDates')}</button>}
              </div>
              {pays.length ? (
                <>
                  <div className="row team-methods">
                    {[...byMethod].map(([k, v]) => <Badge key={k}>{t('m_' + k)}: {money2(v)}</Badge>)}
                  </div>
                  <div className="table-wrap">
                    <table className="tbl stackable team-tbl" data-testid="team-pays">
                      <thead><tr><th>{t('common.date')}</th><th>{t('team.col.job')}</th><th>{t('common.method')}</th><th className="num">{t('common.amount')}</th>{can('delete') && <th aria-label={t('common.actions')} />}</tr></thead>
                      <tbody>
                        {pays.map((p) => {
                          const j = byId(data.jobs, p.jobId);
                          return (
                            <tr key={p.id}>
                              <td className="t1"><span className="nowrap">{date(p.date)}</span>{periodText(t, p, date) && <div className="xs dim team-trade">{t('team.col.period')}: {periodText(t, p, date)}</div>}</td>
                              <td data-label={t('team.col.job')}>{j ? <A to={`/jobs/${j.id}`}>{j.name}</A> : <span className="muted">{t('form.pay.noJob')}</span>}</td>
                              <td data-label={t('common.method')}>{t('m_' + p.method)}{p.ref ? <span className="small dim team-ref" title={t('common.reference')}>{p.ref}</span> : null}</td>
                              <td data-label={t('common.amount')} className="num strong">{money2(p.amount)}</td>
                              {can('delete') && <td className="num team-rowact"><CanWrite><IconButton size="sm" label={`${t('common.delete')}: ${money2(p.amount)}`} onClick={() => removePay(p.id)} data-testid="team-pay-delete"><LuTrash2 /></IconButton></CanWrite></td>}
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot><tr><td colSpan={3}>{t('common.total')} ({pays.length})</td><td className="num" data-label={t('common.amount')}>{money2(sum(pays, (p) => p.amount))}</td>{can('delete') && <td />}</tr></tfoot>
                    </table>
                  </div>
                </>
              ) : <p className="muted small team-pad">{allPays.length ? t('team.noPaysRange') : t('team.noPays')}</p>}
            </Card>
          )}
        </div>

        <div className="stack">
          <Card title={t('team.contact')}>
            <dl className="kv">
              <dt>{t('common.phone')}</dt><dd>{w.phone || <span className="dim">{t('team.none')}</span>}</dd>
              <dt>{t('common.email')}</dt><dd>{w.email ? <a href={`mailto:${w.email}`}><LuMail aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 4 }} />{w.email}</a> : <span className="dim">{t('team.none')}</span>}</dd>
              <dt>{t('team.col.pay')}</dt><dd>{w.payType ? payTypeLabel(t, w.payType) : <span className="dim">{t('team.none')}</span>}{rateLabel(t, w.payType, w.rate) && <div className="small muted" style={{ fontWeight: 500 }}>{rateLabel(t, w.payType, w.rate)}</div>}</dd>
            </dl>
            {w.phone && <div style={{ marginTop: 12 }}><ContactLinks phone={w.phone} /></div>}
          </Card>

          {pack.compliance && (
            <Card title={t('team.paperwork')} actions={<PlanBadge feature="complianceUploads" />} className={cx(w.active !== false && attentionOf(w).length > 0 && 'raised')}>
              {uploads.state === 'upgrade' && <p className="small muted team-up">{t('ent.upgradeHint', { plan: planName(uploads.plan!, lang) })} {t('team.upgradeNote')}</p>}
              <div className="list">
                <div className="item team-doc">
                  <LuFileCheck2 aria-hidden="true" className="team-ic" />
                  <div className="grow">
                    <div className="t">{t('team.w9Title')} <W9Badge worker={w} /></div>
                    <div className="small muted">{w.w9 ? (w.w9Date ? t('team.w9On', { date: date(w.w9Date) }) : t('team.w9NoDate')) : t('team.w9Need')}</div>
                  </div>
                  <CanWrite><Button size="sm" variant={w.w9 || canPay ? 'default' : 'primary'} onClick={() => setW9(true)} data-testid="team-w9">{t(w.w9 ? 'team.w9Change' : 'team.w9Mark')}</Button></CanWrite>
                </div>
                <div className="item team-doc">
                  <LuShieldCheck aria-hidden="true" className="team-ic" />
                  <div className="grow">
                    <div className="t">{t('team.coiTitle')} <InsuranceBadge worker={w} /></div>
                    <div className="small muted">{w.coiExp ? (w.insurer ? t('team.coiBy', { insurer: w.insurer }) : t('team.coiNoInsurer')) : t('team.coiNone')}</div>
                  </div>
                  <CanWrite><Button size="sm" onClick={() => setCoi(true)} data-testid="team-coi">{t('team.coiUpdate')}</Button></CanWrite>
                </div>
                {showMoney && (
                  <div className="item team-doc">
                    <LuBanknote aria-hidden="true" className="team-ic" />
                    <div className="grow">
                      <div className="t">{t('team.t1099', { year })} <Badge tone={reaches ? (w.w9 ? 'info' : 'bad') : 'neutral'}>{t(reaches ? (w.w9 ? 'team.t1099Yes' : 'team.t1099NoW9') : 'team.t1099Under')}</Badge></div>
                      <div className="small muted">{t('team.t1099Line', { amount: money2(m.reportable), limit: money(limit) })}{m.excluded > 0 ? ' ' + t('team.t1099Card', { amount: money2(m.excluded) }) : ''}</div>
                    </div>
                    {can('compliance') && <A to="/compliance" className="btn sm">{t('team.open1099')}<LuArrowRight aria-hidden="true" /></A>}
                  </div>
                )}
              </div>
            </Card>
          )}

          <Card title={t('common.activity')}><ActivityList items={activityFor(data, { type: 'worker', id: w.id })} limit={8} linkRecords /></Card>
        </div>
      </div>

      {edit && <WorkerForm worker={w} onClose={() => setEdit(false)} />}
      {pay && <PayWorkerModal workerId={w.id} onClose={() => setPay(false)} />}
      {w9 && <W9Modal worker={w} onClose={() => setW9(false)} />}
      {coi && <InsuranceModal worker={w} onClose={() => setCoi(false)} />}
    </>
  );
}
