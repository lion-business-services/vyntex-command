// A client's documents, on the client page: everything written for them and every file kept for them, with the way to
// add one. Registered in src/features/clients/tabs.ts.
import { useMemo, useState } from 'react';
import { LuFilePlus, LuLock, LuPaperclip, LuUpload } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, go } from '@/app/router';
import { Badge, Button, Card, Empty } from '@/ui';
import { DocStatusBadge, CanWrite } from '@/app/shared';
import { byId, jobsOfClient } from '@/domain/selectors';
import type { DocKind, DocStatus } from '@/domain/types';
import type { ClientTabProps } from '@/features/clients/tabs';
import { isFileDoc } from './model';
import { NewDocModal } from './NewDoc';
import './documents.css';

export default function DocumentsClientTab({ client }: ClientTabProps) {
  const { t, data, pack, date } = useApp();
  const [kind, setKind] = useState<'' | DocKind>('');
  const [status, setStatus] = useState<'' | DocStatus>('');
  const [form, setForm] = useState<null | 'new' | 'upload'>(null);
  const jobIds = useMemo(() => new Set(jobsOfClient(data, client.id).map((j) => j.id)), [data, client.id]);
  const docs = useMemo(() => data.docs.filter((d) => jobIds.has(d.jobId) || d.clientId === client.id).sort((a, b) => b.updated.localeCompare(a.updated)), [data.docs, jobIds, client.id]);
  const kinds = [...new Set(docs.map((d) => d.kind))];
  const statuses = [...new Set(docs.map((d) => d.status))];
  const rows = docs.filter((d) => (!kind || d.kind === kind) && (!status || d.status === status));
  const files = pack.docKinds.includes('upload');
  const actions = <CanWrite>
    {files && <Button size="sm" icon={<LuUpload aria-hidden="true" />} onClick={() => setForm('upload')} data-testid="docs-client-upload">{t('docs.client.upload')}</Button>}
    <Button size="sm" variant="primary" icon={<LuFilePlus aria-hidden="true" />} onClick={() => setForm('new')} data-testid="docs-client-new">{t('docs.new')}</Button>
  </CanWrite>;

  return (
    <>
      <Card flush title={<>{t('clients.docs')} {docs.length > 0 && <span className="count">{docs.length}</span>}</>} actions={actions}>
        {docs.length > 0 && (kinds.length > 1 || statuses.length > 1) && (
          <div className="filters docs-clientf">
            <select value={kind} onChange={(e) => setKind(e.target.value as DocKind | '')} aria-label={t('docs.kind')} data-testid="docs-client-kind"><option value="">{t('docs.allKinds')}</option>{kinds.map((k) => <option key={k} value={k}>{t('docs.kinds.' + k)}</option>)}</select>
            <select value={status} onChange={(e) => setStatus(e.target.value as DocStatus | '')} aria-label={t('common.status')} data-testid="docs-client-status"><option value="">{t('docs.allStatuses')}</option>{statuses.map((s) => <option key={s} value={s}>{t('doc.status.' + s)}</option>)}</select>
            {(kind || status) && <button type="button" className="linkbtn small" onClick={() => { setKind(''); setStatus(''); }}>{t('common.clearFilters')}</button>}
          </div>
        )}
        {!docs.length ? <div className="docs-clientempty"><Empty title={t('docs.client.empty')}>{t(files ? 'docs.client.emptyHint' : 'clients.noDocs')}</Empty></div>
          : !rows.length ? <div className="docs-clientempty"><Empty title={t('common.noResults')} action={<Button onClick={() => { setKind(''); setStatus(''); }}>{t('common.clearFilters')}</Button>} /></div>
          : (
            <div className="table-wrap">
              <table className="tbl stackable docs-tbl" data-testid="docs-client-table">
                <thead><tr><th>{t('docs.col.doc')}</th><th>{t('docs.col.title')}</th><th>{t('docs.col.job')}</th><th>{t('docs.col.status')}</th><th>{t('docs.col.updated')}</th></tr></thead>
                <tbody>
                  {rows.map((d) => {
                    const job = byId(data.jobs, d.jobId); const env = byId(data.envelopes, d.envelopeId);
                    return (
                      <tr key={d.id} className="click" onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button')) go(`/documents/${d.id}`); }}>
                        <td className="t1"><A to={`/documents/${d.id}`} className="docs-name">{d.number}</A><div className="xs dim">{isFileDoc(d) && <LuPaperclip aria-hidden="true" className="docs-clip" />}{t('doc.kind.' + d.kind)}{d.folder ? ` · ${d.folder}` : ''}</div></td>
                        <td data-label={t('docs.col.title')}>{d.title}{d.file && isFileDoc(d) && <div className="xs dim docs-clipname">{d.file.name}{(d.versions?.length ?? 0) > 1 ? ` · ${t('docs.hist.v', { n: d.versions!.length })}` : ''}</div>}</td>
                        <td data-label={t('docs.col.job')} className="docs-job">{job ? <A to={`/jobs/${job.id}`}>{job.number}</A> : <span className="dim small">{t('docs.noJobLinked')}</span>}</td>
                        <td data-label={t('docs.col.status')}><span className="row tight"><DocStatusBadge status={d.status} />{env && env.status !== 'completed' && env.status !== 'draft' && <A to={`/esign/${env.id}`} className="xs">{t('esign.status.' + env.status)}</A>}{d.esign && d.status !== 'draft' && d.status !== 'void' && <span className="xs dim">{t('docs.demoMark')}</span>}{!!d.templateId && d.status === 'draft' && !data.templates.find((x) => x.id === d.templateId)?.approved && <Badge tone="warn" outline>{t('docs.tpl.notApproved')}</Badge>}</span></td>
                        <td data-label={t('docs.col.updated')} className="small muted nowrap">{date(d.updated)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        {files && <p className="xs dim docs-clientnote"><LuLock aria-hidden="true" /><span>{t('docs.private.short')}</span></p>}
      </Card>
      {form && <NewDocModal onClose={() => setForm(null)} preset={{ clientId: client.id, kind: form === 'upload' ? 'upload' : undefined }} />}
    </>
  );
}
