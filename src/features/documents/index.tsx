// Documents: every document of the business in one list. Estimates, agreements and invoices are written from each job;
// engagement letters, service orders and the like are written from the company's templates for a client; uploads are
// files kept with a client, an engagement or a lead. One description of a written document (model.ts) feeds the screen,
// the printout and the PDF. In an edition without the Signatures screen, e-signature is the one-signer demo and is
// labelled as one everywhere.
import { useMemo, useState } from 'react';
import { LuFilePlus, LuLock, LuPaperclip } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, currentUrl, go, useRoute } from '@/app/router';
import type { PageProps } from '@/app/routes';
import { Badge, Button, Card, Empty, PageHeader, SearchBox } from '@/ui';
import { DocStatusBadge, CanWrite } from '@/app/shared';
import { byId, jobMoney } from '@/domain/selectors';
import { visibleClientIds, visibleClients, visibleLeads } from '@/domain/access';
import type { DemoState, DocKind, DocRecord, DocStatus, TeamUser } from '@/domain/types';
import type { Permission } from '@/domain/permissions';
import { hasEdits, isFileDoc } from './model';
import { DocDetail } from './detail';
import { FileDetail } from './file';
import { NewDocModal, type NewDocPreset } from './NewDoc';
import './documents.css';

const STATUSES: DocStatus[] = ['draft', 'sent', 'viewed', 'signed', 'paid', 'void'];
const waitsOnSignature = (d: DocRecord) => d.kind !== 'invoice' && (d.status === 'sent' || d.status === 'viewed');

/** The documents the viewer may see: those of clients in view, and those of leads in view. Office scoping applies to documents as it does to clients. */
export function visibleDocs(data: DemoState, user: TeamUser | undefined, perms: Permission[]): DocRecord[] {
  const clients = visibleClientIds(data, user, perms);
  const leads = new Set(visibleLeads(data, user, perms).map((l) => l.id));
  const jobClient = new Map(data.jobs.map((j) => [j.id, j.clientId]));
  return data.docs.filter((d) => { const c = d.clientId || jobClient.get(d.jobId) || ''; return c ? clients.has(c) : d.leadId ? leads.has(d.leadId) : true; });
}

export default function DocumentsPage({ id }: PageProps) {
  const { t, data, user, perms } = useApp();
  if (!id) return <DocList />;
  const doc = visibleDocs(data, user, perms).find((d) => d.id === id);
  if (!doc) return <Empty title={t('docs.notFound')} action={<A to="/documents" className="btn">{t('docs.back')}</A>} />;
  return isFileDoc(doc) ? <FileDetail key={id} doc={doc} /> : <DocDetail key={id} doc={doc} />;
}

/* ---------- list ---------- */
function DocList() {
  const { t, data, pack, user, perms, date, live } = useApp();
  const route = useRoute();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'' | DocKind>('');
  const [status, setStatus] = useState<'' | DocStatus>('');
  const [clientId, setClientId] = useState(route.query.get('client') ?? '');
  const [folder, setFolder] = useState('');
  const [form, setForm] = useState(() => currentUrl().includes('new=1'));
  const preset: NewDocPreset = { kind: (route.query.get('kind') as DocKind | null) ?? undefined, clientId: route.query.get('client') ?? undefined, jobId: route.query.get('job') ?? undefined, leadId: route.query.get('lead') ?? undefined };

  // the kinds this edition offers, plus any kind a document already on file has
  const kinds = useMemo(() => [...new Set<DocKind>([...pack.docKinds, ...data.docs.map((d) => d.kind)])], [pack, data.docs]);
  const files = pack.docKinds.includes('upload');
  const all = useMemo(() => visibleDocs(data, user, perms), [data, user, perms]);
  const clients = useMemo(() => visibleClients(data, user, perms).filter((c) => all.some((d) => d.clientId === c.id)), [data, user, perms, all]);
  const folders = useMemo(() => [...new Set(all.map((d) => d.folder).filter((x): x is string => !!x))].sort(), [all]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all
      .filter((d) => (!kind || d.kind === kind) && (!status || d.status === status) && (!clientId || d.clientId === clientId) && (!folder || d.folder === folder))
      .filter((d) => !s || [d.number, d.title, d.file?.name, d.folder, byId(data.clients, d.clientId)?.name, byId(data.jobs, d.jobId)?.number, byId(data.leads, d.leadId)?.name].some((v) => v && v.toLowerCase().includes(s)))
      .sort((a, b) => b.updated.localeCompare(a.updated) || b.created.localeCompare(a.created));
  }, [all, data.clients, data.jobs, data.leads, q, kind, status, clientId, folder]);
  const waiting = all.filter(waitsOnSignature).length;
  const unpaid = all.filter((d) => { const j = byId(data.jobs, d.jobId); return d.kind === 'invoice' && d.status !== 'void' && !!j && jobMoney(data, j).clientOwes > 0.005; }).length;
  const filtered = !!(q || kind || status || clientId || folder);
  const clear = () => { setQ(''); setKind(''); setStatus(''); setClientId(''); setFolder(''); };
  const add = <CanWrite><Button variant="primary" icon={<LuFilePlus />} onClick={() => setForm(true)} data-testid="docs-new">{t('docs.new')}</Button></CanWrite>;
  const unapproved = (d: DocRecord) => !!d.templateId && d.status === 'draft' && !data.templates.find((x) => x.id === d.templateId)?.approved;

  return (
    <>
      <PageHeader title={t('docs.title')} sub={t(files ? 'docs.subFiles' : 'docs.sub')} actions={add} />
      <div className="filters">
        <SearchBox value={q} onChange={setQ} placeholder={t('docs.search')} />
        <select value={kind} onChange={(e) => setKind(e.target.value as DocKind | '')} aria-label={t('docs.kind')} data-testid="docs-filter-kind">
          <option value="">{t('docs.allKinds')}</option>{kinds.map((k) => <option key={k} value={k}>{t('docs.kinds.' + k)}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as DocStatus | '')} aria-label={t('common.status')} data-testid="docs-filter-status">
          <option value="">{t('docs.allStatuses')}</option>{STATUSES.map((s) => <option key={s} value={s}>{t('doc.status.' + s)}</option>)}
        </select>
        {files && clients.length > 1 && (
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label={t('docs.col.client')} data-testid="docs-filter-client">
            <option value="">{t('docs.allClients')}</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {folders.length > 0 && (
          <select value={folder} onChange={(e) => setFolder(e.target.value)} aria-label={t('docs.folder')} data-testid="docs-filter-folder">
            <option value="">{t('docs.allFolders')}</option>{folders.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        )}
        {filtered && <button type="button" className="linkbtn small" onClick={clear}>{t('common.clearFilters')}</button>}
      </div>
      {!!all.length && (
        <p className="small muted docs-sum"><span>{t('docs.sum.waiting', { n: waiting })}</span><span>{t('docs.sum.unpaid', { n: unpaid })}</span>{!live && <span className="dim">{t('docs.sum.demo')}</span>}{files && <span className="dim docs-privnote"><LuLock aria-hidden="true" />{t('docs.private.short')}</span>}</p>
      )}

      {!all.length ? (
        <Card className="docs-none"><Empty title={t('docs.empty')} action={<CanWrite><Button variant="primary" onClick={() => setForm(true)}>{t('docs.new')}</Button></CanWrite>}>{t('docs.emptyHint')}</Empty></Card>
      ) : !rows.length ? (
        <Card className="docs-none"><Empty title={t('common.noResults')} action={<Button onClick={clear}>{t('common.clearFilters')}</Button>} /></Card>
      ) : (
        <Card flush>
          <div className="table-wrap">
            <table className="tbl stackable docs-tbl" data-testid="docs-table">
              <thead><tr><th>{t('docs.col.doc')}</th><th>{t('docs.col.title')}</th><th>{t('docs.col.client')}</th><th>{t('docs.col.job')}</th><th>{t('docs.col.status')}</th><th>{t('docs.col.updated')}</th></tr></thead>
              <tbody>
                {rows.map((d) => {
                  const client = byId(data.clients, d.clientId); const job = byId(data.jobs, d.jobId); const lead = byId(data.leads, d.leadId);
                  return (
                    <tr key={d.id} className="click" onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button')) go(`/documents/${d.id}`); }}>
                      <td className="t1"><A to={`/documents/${d.id}`} className="docs-name">{d.number}</A>{hasEdits(d) && <span className="docs-edited"><Badge tone="warn" outline>{t('docs.edited')}</Badge></span>}<div className="xs dim">{isFileDoc(d) && <LuPaperclip aria-hidden="true" className="docs-clip" />}{t('doc.kind.' + d.kind)}{d.folder ? ` · ${d.folder}` : ''}</div></td>
                      <td data-label={t('docs.col.title')}>{d.title}</td>
                      <td data-label={t('docs.col.client')}>{client ? <A to={`/clients/${client.id}`}>{client.name}</A> : lead ? <A to={`/leads/${lead.id}`}>{lead.name}</A> : null}</td>
                      <td data-label={t('docs.col.job')} className="docs-job">{job ? <A to={`/jobs/${job.id}`}>{job.number}</A> : <span className="dim small">{t(d.jobId ? 'docs.noJob' : 'docs.noJobLinked')}</span>}</td>
                      <td data-label={t('docs.col.status')}><span className="row tight nowrap"><DocStatusBadge status={d.status} />{d.esign && d.status !== 'draft' && d.status !== 'void' && <span className="xs dim">{t('docs.demoMark')}</span>}{unapproved(d) && <Badge tone="warn" outline title={t('docs.unapproved.title')}>{t('docs.tpl.notApproved')}</Badge>}</span></td>
                      <td data-label={t('docs.col.updated')} className="small muted nowrap">{date(d.updated)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {form && <NewDocModal onClose={() => setForm(false)} preset={preset} />}
    </>
  );
}
