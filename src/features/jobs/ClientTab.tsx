// A client's engagements (jobs), on the client page. Registered in src/features/clients/tabs.ts.
// Shown where a client page has tabs (the professional-services edition): each engagement with its period, its status and
// what is owed on it, newest first, and a way to start a new one for this client.
import { LuPlus, LuRepeat } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, go } from '@/app/router';
import { Card, Empty, cx } from '@/ui';
import { JobStatusBadge } from '@/app/shared';
import type { ClientTabProps } from '@/features/clients/tabs';
import { jobMoney, jobsOfClient } from '@/domain/selectors';
import { money } from '@/lib/money';
import { repeats } from './parts';
import '@/features/leads/work.css';
import './jobs.css';

export default function JobsClientTab({ client }: ClientTabProps) {
  const { t, data, can } = useApp();
  const showMoney = can('money');
  const jobs = [...jobsOfClient(data, client.id)].sort((a, b) => (b.start || b.created).localeCompare(a.start || a.created));
  const add = can('write') && can('jobs') ? <A to={`/jobs?new=1&client=${client.id}`} className={cx('btn sm', jobs.length > 0 && 'primary')} data-testid="jobs-client-new"><LuPlus aria-hidden="true" />{t('newProject')}</A> : null;
  return (
    <Card flush className="work-none" title={<>{t('nav.jobs')} <span className="count">{jobs.length}</span></>} actions={add}>
      {jobs.length ? (
        <div className="table-wrap">
          <table className="tbl stackable" data-testid="jobs-client-table">
            <thead><tr><th>{t('project')}</th><th>{t('jobs.f.period')}</th><th>{t('common.status')}</th>{showMoney && <><th className="num">{t('contract')}</th><th className="num">{t('common.balance')}</th></>}</tr></thead>
            <tbody>
              {jobs.map((j) => {
                const m = jobMoney(data, j); const billable = j.status === 'progress' || j.status === 'done';
                return (
                  <tr key={j.id} className="click" onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button')) go(`/jobs/${j.id}`); }}>
                    <td className="t1"><A to={`/jobs/${j.id}`} className="jobs-name">{j.name}</A><div className="xs dim jobs-under">{j.number}{repeats(j) && <> · <span className="jobs-rep"><LuRepeat aria-hidden="true" />{t('jobs.rp.' + j.repeat)}</span></>}</div></td>
                    <td data-label={t('jobs.f.period')} className="nowrap">{j.period || null}</td>
                    <td data-label={t('common.status')}><JobStatusBadge status={j.status} /></td>
                    {showMoney && <>
                      <td data-label={t('contract')} className="num">{money(m.price)}</td>
                      <td data-label={t('common.balance')} className={cx('num', billable && m.clientOwes > 0.005 ? 'jobs-due' : 'dim')}>{billable ? money(Math.max(0, m.clientOwes)) : null}</td>
                    </>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <Empty title={t('jobs.empty')}>{t('jobs.client.none')}</Empty>}
    </Card>
  );
}
