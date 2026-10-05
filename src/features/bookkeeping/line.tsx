// One screen for a service line the firm runs with its own separate application: payroll, bookkeeping, licensing.
// The source of those applications was not supplied, so this screen does not calculate, post or file anything. It shows
// what this workspace already knows about the line (its engagements, tasks, deadlines and documents, read from the
// records), links to the firm's application, and lists exactly what is still needed to build the module in full.
// Nothing here is estimated: no rates, no tables, no history.
import { useState, type ReactNode } from 'react';
import { LuClipboardList, LuSettings2 } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { mutate } from '@/store/store';
import { Badge, Button, Card, Empty, Modal, Note, PageHeader, Stat, toast } from '@/ui';
import { DocStatusBadge, JobStatusBadge, TaskRow } from '@/app/shared';
import { TaskFormModal } from '@/app/forms';
import { lineSettings, saveLineSettings, type LineId } from '@/domain/actions/ops';
import { byId, isOpenTask, isOverdue, openDeadlines } from '@/domain/selectors';
import { visibleClientIds } from '@/domain/access';
import type { ComplianceItem, Job, Task } from '@/domain/types';
import { AddressModal, LinkRow, QuickLinks } from '@/features/dashboard/links';
import { DeadlineFormModal, DeadlineRow } from '@/features/deadlines/parts';
import '@/features/dashboard/dashboard.css';
import './bookkeeping.css';

/** What is still needed from the firm to build each module in full. Each entry is a sentence in the dictionary. */
const NEEDED: Record<LineId, string[]> = {
  payroll: ['source', 'records', 'tables', 'rules', 'signoff'],
  bookkeeping: ['source', 'records', 'accounts', 'ledger', 'signoff'],
  licensing: ['source', 'records', 'types', 'signoff'],
};
/** The service line of an engagement: the category of the catalog service it was sold as, or its own type. */
export const lineOfJob = (catalog: { id: string; category: string }[], j: Job): string => byId(catalog, j.serviceId)?.category ?? j.type;

export function ServiceLine({ line, clientLink, deadlineKinds, children }: { line: LineId; /** Id of the quick link clients use for this line, when there is one. */ clientLink?: string; /** Deadlines of these kinds belong to the line whatever engagement they are on. */ deadlineKinds?: ComplianceItem['kind'][]; children?: ReactNode }) {
  const { t, data, pack, can, user, perms, date } = useApp();
  const [pickCat, setPickCat] = useState(false); const [staff, setStaff] = useState(false);
  const [task, setTask] = useState<Task | null>(null); const [deadline, setDeadline] = useState<{ item?: ComplianceItem } | null>(null);
  const settings = lineSettings(data, line);
  const may = can('config') && can('write');

  // the service lines a company has: the categories of its catalog and the edition's service types
  const cats = [...new Set([...data.catalog.map((s) => s.category), ...pack.serviceTypes.map((s) => s.id)])];
  const catName = (c: string) => (pack.serviceTypes.some((s) => s.id === c) ? t('ty_' + c) : c);
  const category = settings.category && cats.includes(settings.category) ? settings.category : cats.includes(line) ? line : '';

  const mine = visibleClientIds(data, user, perms);
  const jobs = category ? data.jobs.filter((j) => mine.has(j.clientId) && lineOfJob(data.catalog, j) === category) : [];
  const jobIds = new Set(jobs.map((j) => j.id));
  const active = jobs.filter((j) => j.status === 'progress' || j.status === 'contract' || j.status === 'hold');
  const tasks = data.tasks.filter((x) => x.jobId && jobIds.has(x.jobId) && isOpenTask(x)).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
  const late = tasks.filter(isOverdue).length;
  const deadlines = openDeadlines(data).filter((i) => (!i.clientId || mine.has(i.clientId)) && ((i.jobId && jobIds.has(i.jobId)) || (deadlineKinds ?? []).includes(i.kind)));
  const docs = data.docs.filter((d) => jobIds.has(d.jobId)).sort((a, b) => b.updated.localeCompare(a.updated));

  return (
    <div className="bookkeeping" data-line={line}>
      <PageHeader title={t('nav.' + line)} sub={t(line + '.sub')} actions={may ? <Button icon={<LuSettings2 aria-hidden="true" />} onClick={() => setPickCat(true)} data-testid={`${line}-category`}>{t('bookkeeping.x.pickCategory')}</Button> : undefined} />

      <Note>{t(line + '.today')}</Note>

      {/* the firm's own application and the link clients use: first, because the team sends that link every day */}
      <Card title={t('bookkeeping.x.links')} className="bookkeeping-links">
        <div className="bookkeeping-linkstack">
          {clientLink && <QuickLinks only={[clientLink]} compact />}
          <div className="dash-links compact"><LinkRow kind="staff" label={t(line + '.staffApp')} url={settings.staffUrl ?? ''} onSet={may ? () => setStaff(true) : undefined} testId={`${line}-staff-link`} /></div>
        </div>
        <p className="xs dim bookkeeping-linknote">{t('bookkeeping.x.linksNote')}</p>
      </Card>

      {!category ? (
        <Card><Empty title={t('bookkeeping.x.noCategory')} action={may ? <Button variant="primary" onClick={() => setPickCat(true)}>{t('bookkeeping.x.pickCategory')}</Button> : undefined}>{t('bookkeeping.x.noCategoryHint')}</Empty></Card>
      ) : (
        <>
          <p className="small muted bookkeeping-showing" data-testid={`${line}-showing`}>{t('bookkeeping.x.showing', { category: catName(category) })}</p>
          <div className="kpis bookkeeping-kpis">
            <Stat label={t('bookkeeping.x.k.active')} value={String(active.length)} hint={t('bookkeeping.x.k.activeHint', { n: jobs.length })} testId={`${line}-kpi-active`} />
            <Stat label={t('bookkeeping.x.k.clients')} value={String(new Set(active.map((j) => j.clientId)).size)} testId={`${line}-kpi-clients`} />
            <Stat label={t('bookkeeping.x.k.tasks')} value={String(tasks.length)} hint={late ? t('bookkeeping.x.k.tasksLate', { n: late }) : undefined} testId={`${line}-kpi-tasks`} />
            <Stat label={t('bookkeeping.x.k.deadlines')} value={String(deadlines.length)} testId={`${line}-kpi-deadlines`} />
          </div>

          {children}

          <Card flush title={<>{t('nav.jobs')} <span className="count">{jobs.length}</span></>} actions={can('jobs') ? <A to="/jobs" className="btn sm ghost">{t('bookkeeping.x.allJobs')}</A> : undefined}>
            {jobs.length ? (
              <div className="table-wrap">
                <table className="tbl stackable" data-testid={`${line}-jobs`}>
                  <thead><tr><th>{t('project')}</th><th>{t('bookkeeping.x.col.client')}</th><th>{t('common.status')}</th><th>{t('bookkeeping.x.col.period')}</th><th>{t('bookkeeping.x.col.who')}</th></tr></thead>
                  <tbody>
                    {jobs.map((j) => { const c = byId(data.clients, j.clientId); return (
                      <tr key={j.id}>
                        <td className="t1"><A to={`/jobs/${j.id}`} className="bookkeeping-name">{j.name}</A><div className="xs dim">{j.number}</div></td>
                        <td data-label={t('bookkeeping.x.col.client')}>{c ? <A to={`/clients/${c.id}`}>{c.company || c.name}</A> : null}</td>
                        <td data-label={t('common.status')}><JobStatusBadge status={j.status} /></td>
                        <td data-label={t('bookkeeping.x.col.period')} className="small">{j.period || (j.start ? date(j.start) : null)}</td>
                        <td data-label={t('bookkeeping.x.col.who')} className="small">{byId(data.users, j.managerId)?.name ?? ''}</td>
                      </tr>
                    ); })}
                  </tbody>
                </table>
              </div>
            ) : <p className="muted small bookkeeping-pad">{t('bookkeeping.x.noJobs', { category: catName(category) })}</p>}
          </Card>

          <div className="grid2 bookkeeping-pair">
            <Card title={<>{t('bookkeeping.x.tasks')} <span className="count">{tasks.length}</span></>} actions={can('tasks') ? <A to="/tasks?view=list" className="btn sm ghost">{t('nav.tasks')}</A> : undefined}>
              {tasks.length ? <div className="list">{tasks.slice(0, 8).map((x) => <TaskRow key={x.id} task={x} showJob onEdit={can('write') ? () => setTask(x) : undefined} />)}</div> : <p className="muted small">{t('bookkeeping.x.noTasks')}</p>}
            </Card>
            <Card title={<>{t('nav.deadlines')} <span className="count">{deadlines.length}</span></>} actions={can('deadlines') ? <A to="/deadlines" className="btn sm ghost">{t('nav.deadlines')}</A> : undefined}>
              {deadlines.length ? <div className="list">{deadlines.slice(0, 8).map((i) => <DeadlineRow key={i.id} item={i} onEdit={(item) => setDeadline({ item })} />)}</div> : <p className="muted small">{t('bookkeeping.x.noDeadlines')}</p>}
            </Card>
          </div>

          <Card title={<>{t('nav.documents')} <span className="count">{docs.length}</span></>} actions={can('documents') ? <A to="/documents" className="btn sm ghost">{t('nav.documents')}</A> : undefined}>
            {docs.length ? (
              <div className="list">
                {docs.slice(0, 8).map((d) => (
                  <A key={d.id} to={`/documents/${d.id}`} className="item click">
                    <span className="grow"><span className="t">{t('doc.kind.' + d.kind)} {d.number}</span><span className="xs dim bookkeeping-co">{[byId(data.clients, d.clientId)?.name, d.title, date(d.updated)].filter(Boolean).join(' · ')}</span></span>
                    <DocStatusBadge status={d.status} />
                  </A>
                ))}
              </div>
            ) : <p className="muted small">{t('bookkeeping.x.noDocs')}</p>}
          </Card>
        </>
      )}

      {/* what the module still needs: said plainly, so nobody mistakes this screen for the finished module */}
      <Card title={<><LuClipboardList aria-hidden="true" className="bookkeeping-ico" />{t('bookkeeping.x.needed')}</>} className="bookkeeping-needed">
        <p className="small muted">{t('bookkeeping.x.neededLead')}</p>
        <ul className="bookkeeping-list" data-testid={`${line}-needed`}>
          {NEEDED[line].map((k) => <li key={k}><span className="grow">{t(`${line}.need.${k}`)}</span><Badge tone="warn">{t('bookkeeping.x.notSupplied')}</Badge></li>)}
        </ul>
        <p className="xs dim">{t(line + '.never')}</p>
      </Card>

      {pickCat && <CategoryModal line={line} cats={cats} catName={catName} current={category} onClose={() => setPickCat(false)} />}
      {staff && <AddressModal title={t(line + '.staffApp')} url={settings.staffUrl ?? ''} hint={t('bookkeeping.x.staffHint')} onClose={() => setStaff(false)} onSave={(url) => { mutate((d) => saveLineSettings(d, line, { staffUrl: url }), 'config'); return true; }} />}
      {task && <TaskFormModal key={task.id} task={task} onClose={() => setTask(null)} />}
      {deadline && <DeadlineFormModal key={deadline.item?.id ?? 'new'} item={deadline.item} onClose={() => setDeadline(null)} />}
    </div>
  );
}

function CategoryModal({ line, cats, catName, current, onClose }: { line: LineId; cats: string[]; catName: (c: string) => string; current: string; onClose: () => void }) {
  const { t } = useApp();
  const [value, setValue] = useState(current);
  const save = () => { mutate((d) => saveLineSettings(d, line, { category: value }), 'config'); toast(t('common.saved')); onClose(); };
  return (
    <Modal title={t('bookkeeping.x.pickCategory')} onClose={onClose} size="narrow" labelClose={t('common.close')} footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={save} data-testid="bookkeeping-category-save">{t('common.save')}</Button></>}>
      <p className="small muted" style={{ marginBottom: 12 }}>{t('bookkeeping.x.pickCategoryHint')}</p>
      <div className="field"><label htmlFor="bookkeeping-cat">{t('bookkeeping.x.category')}</label>
        <select id="bookkeeping-cat" value={value} onChange={(e) => setValue(e.target.value)} data-testid="bookkeeping-category-select">
          {!value && <option value="">{t('bookkeeping.x.categoryNone')}</option>}{cats.map((c) => <option key={c} value={c}>{catName(c)}</option>)}
        </select>
      </div>
    </Modal>
  );
}
