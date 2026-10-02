// All jobs: a table and a status board over the same filtered data.
import { useState } from 'react';
import { LuPlus, LuTable, LuKanban } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, appPath, go, navigate, useRoute } from '@/app/router';
import { Button, Card, Empty, MoneyBar, PageHeader, SearchBox, Seg, cx } from '@/ui';
import { JobStatusBadge } from '@/app/shared';
import { byId, isActiveJob, jobMoney } from '@/domain/selectors';
import type { Job, JobStatus } from '@/domain/types';
import { money, pct, sum } from '@/lib/money';
import { JobDates, changeStatus } from './parts';
import { JobForm } from './forms';

export function JobList() {
  const { t, data, pack, can } = useApp();
  const route = useRoute();
  const view = route.query.get('view') === 'board' ? 'board' : 'table';
  const wantNew = route.query.get('new') === '1';
  const presetClient = route.query.get('client') || undefined;
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | JobStatus>('');
  const [type, setType] = useState('');
  const [manager, setManager] = useState('');
  const [worker, setWorker] = useState('');
  const [form, setForm] = useState(false);
  const showMoney = can('money'); const showProfit = can('profit');
  const here = view === 'board' ? '/jobs?view=board' : '/jobs';

  const s = q.trim().toLowerCase();
  const base = data.jobs.filter((j) =>
    (!s || [j.name, j.number, j.address, byId(data.clients, j.clientId)?.name, byId(data.clients, j.clientId)?.company].some((x) => x && x.toLowerCase().includes(s)))
    && (!type || j.type === type) && (!manager || j.managerId === manager) && (!worker || j.assign.some((a) => a.workerId === worker)));
  const rows = view === 'board' ? base : base.filter((j) => !status || j.status === status);
  const filtered = !!(q || type || manager || worker || (view === 'table' && status));
  const clear = () => { setQ(''); setStatus(''); setType(''); setManager(''); setWorker(''); };
  /** Opened from another page with ?new=1: closing the form also drops that from the address. */
  const closeForm = () => { setForm(false); if (wantNew) navigate(appPath(here), { replace: true }); };

  const active = data.jobs.filter(isActiveJob);
  const m = rows.map((j) => ({ j, m: jobMoney(data, j) }));
  const tot = { price: sum(m, (x) => x.m.price), profit: sum(m, (x) => x.m.profit), received: sum(m, (x) => x.m.received), owes: sum(m, (x) => Math.max(0, x.m.clientOwes)) };

  return (
    <>
      <PageHeader title={t('nav.jobs')} sub={t('jobs.sub')} actions={<>
        <Seg label={t('jobs.view')} value={view} onChange={(x) => go(x === 'board' ? '/jobs?view=board' : '/jobs')} options={[
          { value: 'table', label: <><LuTable aria-hidden="true" />{t('jobs.view.table')}</> }, { value: 'board', label: <><LuKanban aria-hidden="true" />{t('jobs.view.board')}</> }]} />
        <Button variant="primary" icon={<LuPlus aria-hidden="true" />} onClick={() => setForm(true)} data-testid="jobs-new">{t('newProject')}</Button>
      </>} />

      <div className="filters jobs-filters">
        <SearchBox value={q} onChange={setQ} placeholder={t('jobs.search')} />
        {view === 'table' && (
          <select value={status} onChange={(e) => setStatus(e.target.value as JobStatus | '')} aria-label={t('common.status')} data-testid="jobs-filter-status">
            <option value="">{t('allStatuses')}</option>{pack.jobStatuses.map((x) => <option key={x} value={x}>{t('st_' + x)}</option>)}
          </select>
        )}
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label={t('type')} data-testid="jobs-filter-type">
          <option value="">{t('allTypes')}</option>{pack.serviceTypes.map((x) => <option key={x.id} value={x.id}>{t('ty_' + x.id)}</option>)}
        </select>
        <select value={manager} onChange={(e) => setManager(e.target.value)} aria-label={t('jobs.manager')} data-testid="jobs-filter-manager">
          <option value="">{t('jobs.allManagers')}</option>{data.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        {data.workers.length > 0 && (
          <select value={worker} onChange={(e) => setWorker(e.target.value)} aria-label={t('sub')} data-testid="jobs-filter-worker">
            <option value="">{t('allSubs')}</option>{data.workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        )}
        {filtered && <button type="button" className="linkbtn small" onClick={clear} data-testid="jobs-clear">{t('common.clearFilters')}</button>}
      </div>
      {data.jobs.length > 0 && (
        <p className="small muted jobs-sum">
          {t('jobs.sum.count', { n: data.jobs.length })} · {t('jobs.sum.active', { n: active.length })}
          {showMoney && <> · {t('jobs.sum.value')}: <b>{money(sum(active, (j) => j.price))}</b></>}
        </p>
      )}

      {!data.jobs.length ? (
        <Card><Empty title={t('jobs.empty')} action={<Button variant="primary" icon={<LuPlus aria-hidden="true" />} onClick={() => setForm(true)}>{t('newProject')}</Button>}>{t('jobs.emptyHint')}</Empty></Card>
      ) : !rows.length ? (
        <Card><Empty title={t('common.noResults')} action={<Button onClick={clear} data-testid="jobs-clear-empty">{t('common.clearFilters')}</Button>} /></Card>
      ) : view === 'board' ? (
        <Board jobs={rows} />
      ) : (
        <Card flush>
          <div className="table-wrap">
            <table className="tbl stackable jobs-table jobs-stack" data-testid="jobs-table">
              <thead>
                <tr>
                  <th>{t('project')}</th><th>{t('type')}</th><th>{t('common.status')}</th><th>{t('jobs.col.dates')}</th>
                  {showMoney && <th className="num">{t('contract')}</th>}
                  {showProfit && <th className="num">{t('profit')}</th>}
                  {showMoney && <><th className="num">{t('jobs.col.received')}</th><th className="num">{t('common.balance')}</th></>}
                </tr>
              </thead>
              <tbody>
                {m.map(({ j, m: c }) => {
                  const client = byId(data.clients, j.clientId);
                  const owes = Math.max(0, c.clientOwes);
                  return (
                    <tr key={j.id} className="click" data-job={j.id} onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button')) go(`/jobs/${j.id}`); }}>
                      <td className="t1"><A to={`/jobs/${j.id}`} className="jobs-name">{j.name}</A><div className="xs dim jobs-under">{[j.number, client?.name].filter(Boolean).join(' · ')}</div></td>
                      <td data-label={t('type')}>{t('ty_' + j.type)}</td>
                      <td data-label={t('common.status')}><JobStatusBadge status={j.status} /></td>
                      <td data-label={t('jobs.col.dates')} className="small"><JobDates job={j} /></td>
                      {showMoney && <td data-label={t('contract')} className="num">{money(c.price)}</td>}
                      {showProfit && (
                        c.labor + c.expenses <= 0 ? <td data-label={t('profit')} className="num"><span className="xs dim">{t('jobs.noCosts')}</span></td> : (
                        <td data-label={t('profit')} className="num">
                          <span className="jobs-profit">
                            <span className="nowrap"><b className={cx(c.profit < 0 && 'neg')}>{money(c.profit)}</b> <span className="xs muted">{pct(c.margin)}</span></span>
                            <MoneyBar total={c.price} label={`${t('subLabor')} ${money(c.labor)}, ${t('materials')} ${money(c.expenses)}, ${t('profit')} ${money(c.profit)}`}
                              parts={[{ value: c.labor, cls: 's1', label: t('subLabor') }, { value: c.expenses, cls: 's2', label: t('materials') }, { value: c.profit, cls: 's3', label: t('profit') }]} />
                          </span>
                        </td>
                        )
                      )}
                      {showMoney && <>
                        <td data-label={t('jobs.col.received')} className="num">{money(c.received)}</td>
                        <td data-label={t('common.balance')} className={cx('num', owes > 0.005 && j.status === 'done' && 'jobs-due')}>{money(owes)}</td>
                      </>}
                    </tr>
                  );
                })}
              </tbody>
              {showMoney && (
                <tfoot>
                  <tr>
                    <td className="t1" colSpan={4}>{t('common.total')} ({rows.length})</td>
                    <td data-label={t('contract')} className="num" data-testid="jobs-total-price">{money(tot.price)}</td>
                    {showProfit && <td data-label={t('profit')} className={cx('num', tot.profit < 0 && 'neg')}>{money(tot.profit)}</td>}
                    <td data-label={t('jobs.col.received')} className="num">{money(tot.received)}</td>
                    <td data-label={t('common.balance')} className="num">{money(tot.owes)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      )}

      {(form || wantNew) && <JobForm clientId={presetClient} onClose={closeForm} />}
    </>
  );
}

/* ---------- board: one column per status. Drag a card, or use the Move select on it ---------- */
function Board({ jobs }: { jobs: Job[] }) {
  const { t, data, pack, can } = useApp();
  const [over, setOver] = useState<JobStatus | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const showMoney = can('money');
  const move = (j: Job | undefined, to: JobStatus) => { if (j) changeStatus(t, j, to); };
  return (
    <div className="kanban jobs-board" data-testid="jobs-board">
      {pack.jobStatuses.map((s) => {
        const col = jobs.filter((j) => j.status === s);
        return (
          <section key={s} className={cx('kcol', over === s && 'over')} aria-label={t('st_' + s)} data-status={s}
            onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
            onDrop={(e) => { e.preventDefault(); setOver(null); move(jobs.find((x) => x.id === (e.dataTransfer.getData('text/plain') || dragging)), s); setDragging(null); }}>
            <div className="kcol-h"><span>{t('st_' + s)} <span className="count">{col.length}</span></span>{showMoney && <span className="small muted">{money(sum(col, (j) => j.price))}</span>}</div>
            <div className="kcol-b">
              {col.map((j) => (
                <article key={j.id} className="kcard" draggable data-job={j.id}
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', j.id); e.dataTransfer.effectAllowed = 'move'; setDragging(j.id); }} onDragEnd={() => { setDragging(null); setOver(null); }}>
                  <A to={`/jobs/${j.id}`} className="t jobs-name">{j.name}</A>
                  <div className="small muted">{byId(data.clients, j.clientId)?.name}</div>
                  <div className="small muted">{t('ty_' + j.type)}{showMoney && j.price ? ` · ${money(j.price)}` : ''}</div>
                  <div className="xs"><JobDates job={j} /></div>
                  <label className="jobs-move"><span className="sr">{t('jobs.moveTo')}</span>
                    <select value={j.status} onChange={(e) => move(j, e.target.value as JobStatus)} aria-label={`${t('jobs.moveTo')}: ${j.name}`}>
                      {pack.jobStatuses.map((x) => <option key={x} value={x}>{t('st_' + x)}</option>)}
                    </select>
                  </label>
                </article>
              ))}
              {!col.length && <p className="xs dim jobs-drop">{t('jobs.drop')}</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
