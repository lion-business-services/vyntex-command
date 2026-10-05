// An uploaded file: what it is, a preview where the browser can show one, its versions, and the signature request for it.
// Files are private. Nothing here makes a public link: a file is read through the workspace only.
import { useEffect, useRef, useState } from 'react';
import { LuDownload, LuExternalLink, LuLock, LuRotateCcw, LuUpload } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { BackLink } from '@/app/Shell';
import { act } from '@/store/store';
import { Button, Card, Field, Note, PageHeader, confirmDialog, toast } from '@/ui';
import { DocStatusBadge, CanWrite } from '@/app/shared';
import { addDocVersion, setDocStatus, updateDocMeta } from '@/domain/actions';
import { moduleOn } from '@/domain/config';
import { byId } from '@/domain/selectors';
import type { DocRecord, FileRef } from '@/domain/types';
import type { EnvelopeX, PageSize } from '@/domain/esign/types';
import { isOpenEnvelope } from '@/domain/esign/envelope';
import { readPages } from '@/domain/esign/pdfkit';
import { ACCEPT_ATTR, downloadFile, fileBytes, fileSize, isImage, isPdf, openFile, uploadLimit } from '@/features/esign/prepare';
import { PageSheet, pageMode, useViewer } from '@/features/esign/pages';
import { EnvelopeCard } from './EnvelopeCard';
import { HistoryCard } from './detail';
import { storeFile } from './upload';

/** A file shown inside the page: an image as it is, a PDF in the browser's own viewer or as sheets of the right size. */
export function FilePreview({ file }: { file: FileRef }) {
  const { t } = useApp();
  const viewer = useViewer();
  const [state, setState] = useState<{ url?: string; pages?: PageSize[]; problem?: string }>({});
  useEffect(() => {
    let live = true; let url: string | undefined;
    setState({});
    void (async () => {
      const bytes = await fileBytes(file);
      if (!live) return;
      if (!bytes) { setState({ problem: 'gone' }); return; }
      url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: file.mime }));
      if (isPdf(file)) { const r = await readPages(bytes); if (!live) return; setState(r.ok ? { url, pages: r.pages } : { url, problem: r.reason }); }
      else setState({ url });
    })();
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [file]);
  if (state.problem === 'gone') return <Note tone="bad">{t('docs.file.gone')}</Note>;
  if (isImage(file)) return state.url ? <img className="docs-img" src={state.url} alt={file.name} data-testid="docs-file-image" /> : <p className="muted small" role="status">{t('docs.file.loading')}</p>;
  if (!isPdf(file)) return <p className="muted small" data-testid="docs-file-nopreview">{t('docs.file.noPreview')}</p>;
  if (state.problem) return <Note tone="warn">{t('esign.draw.' + state.problem)}</Note>;
  if (!state.pages) return <p className="muted small" role="status">{t('docs.file.loading')}</p>;
  const mode = pageMode(undefined, state.url, viewer);
  // a long file shows its first pages here; the whole file opens in a new tab
  const first = state.pages.slice(0, 6);
  return (
    <div className="es-pages es-read" data-testid="docs-file-pages" data-mode={mode}>
      <Note>{t(mode === 'viewer' ? 'docs.file.viewer' : 'docs.file.blank')}</Note>
      {first.map((size, i) => <PageSheet key={i} index={i} size={size} pdfUrl={state.url} mode={mode} label={t('esign.pages.page', { n: i + 1, total: state.pages!.length })} blankNote={t('esign.pages.blankSheet')} />)}
      {state.pages.length > first.length && <p className="small muted">{t('docs.file.morePages', { n: state.pages.length - first.length })}</p>}
    </div>
  );
}

/** Picks a file and stores it, with a plain message when it is too large or of a kind that is not accepted. */
export function useFilePicker(where: { clientId?: string; jobId?: string; docId?: string; folder?: string }, onStored: (file: FileRef) => void) {
  const { t } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = '';
    if (!f) return;
    setBusy(true);
    const r = await storeFile(f, where);
    setBusy(false);
    if (r.ok) onStored(r.file); else toast(t('docs.up.err.' + r.reason, { limit: fileSize(uploadLimit()) }), true);
  };
  const field = <input ref={input} type="file" accept={ACCEPT_ATTR} className="sr" tabIndex={-1} aria-hidden="true" onChange={(e) => void onChange(e)} data-testid="docs-file-input" />;
  return { field, busy, pick: () => input.current?.click() };
}

export function FileDetail({ doc }: { doc: DocRecord }) {
  const { t, data, pack, can, date, live } = useApp();
  const job = byId(data.jobs, doc.jobId); const client = byId(data.clients, doc.clientId); const lead = byId(data.leads, doc.leadId);
  const env = byId(data.envelopes, doc.envelopeId) as EnvelopeX | undefined;
  const out = !!env && isOpenEnvelope(env);
  const isVoid = doc.status === 'void';
  const [title, setTitle] = useState(doc.title); const [folder, setFolder] = useState(doc.folder ?? '');
  const folders = [...new Set(data.docs.map((d) => d.folder).filter((x): x is string => !!x))].sort();
  const picker = useFilePicker({ clientId: doc.clientId || undefined, jobId: doc.jobId || undefined, docId: doc.id, folder: doc.folder }, (file) => {
    if (act(addDocVersion, doc.id, file)) toast(t('docs.file.versionAdded')); else toast(t('docs.file.versionRefused'), true);
  });
  const file = doc.file;
  const setVoid = async () => { if (await confirmDialog(t('docs.file.voidConfirm'), t('docs.void'), t('common.cancel'))) { act(setDocStatus, doc.id, 'void'); toast(t('docs.voided')); } };
  const saveMeta = () => { if (title.trim() !== doc.title || folder.trim() !== (doc.folder ?? '')) { act(updateDocMeta, doc.id, { title, folder }); toast(t('docs.file.saved')); } };

  return (
    <>
      <BackLink to="/documents">{t('docs.back')}</BackLink>
      <PageHeader title={<>{t('doc.kind.' + doc.kind)} {doc.number} <DocStatusBadge status={doc.status} /></>}
        sub={<>{doc.title}{client && <> · <A to={`/clients/${client.id}`}>{client.name}</A></>}{job && <> · <A to={`/jobs/${job.id}`}>{job.number}</A></>}{lead && <> · <A to={`/leads/${lead.id}`}>{lead.name}</A></>}</>} />
      <div className="docs-layout">
        <div>
          <Card title={t('docs.file.preview')} actions={file ? <>
            <Button size="sm" icon={<LuExternalLink aria-hidden="true" />} onClick={() => void openFile(file).then((ok) => { if (!ok) toast(t('docs.file.gone'), true); })} data-testid="docs-file-open">{t('docs.file.open')}</Button>
            <Button size="sm" variant="primary" icon={<LuDownload aria-hidden="true" />} onClick={() => void downloadFile(file).then((ok) => { if (!ok) toast(t('docs.file.gone'), true); })} data-testid="docs-file-download">{t('docs.file.download')}</Button>
          </> : undefined}>
            {file ? <FilePreview file={file} /> : <p className="muted">{t('docs.file.none')}</p>}
          </Card>
        </div>
        <aside className="stack docs-side">
          <Card title={t('docs.file.title')}>
            {file && <dl className="kv" data-testid="docs-file-facts">
              <dt>{t('docs.file.name')}</dt><dd>{file.name}</dd>
              <dt>{t('docs.file.size')}</dt><dd>{fileSize(file.size)}</dd>
              <dt>{t('docs.created.on')}</dt><dd>{date(doc.created)}</dd>
              <dt>{t('docs.col.updated')}</dt><dd>{date(doc.updated)}</dd>
            </dl>}
            <p className="small muted docs-private"><LuLock aria-hidden="true" /><span>{t(live ? 'docs.private.live' : 'docs.private.sample')}</span></p>
            {!isVoid && <CanWrite>
              <div className="stack tight" style={{ marginTop: 12 }}>
                {picker.field}
                <Button icon={<LuUpload aria-hidden="true" />} onClick={picker.pick} disabled={picker.busy || out} data-testid="docs-file-version">{t(picker.busy ? 'docs.up.storing' : 'docs.file.newVersion')}</Button>
                <p className="xs dim">{out ? t('docs.file.versionRefused') : t('docs.up.limit', { limit: fileSize(uploadLimit()) })}</p>
              </div>
            </CanWrite>}
          </Card>
          {moduleOn(data, pack, 'esign') && !isVoid && <EnvelopeCard doc={doc} blocked={{ notPdf: !isPdf(file) }} />}
          <Card title={t('docs.details')}>
            <CanWrite>
              <div className="stack tight">
                <Field label={t('docs.col.title')}><input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveMeta} disabled={isVoid} data-testid="docs-file-title" /></Field>
                <Field label={t('docs.folder')} hint={t('docs.folderHint')}><input value={folder} list="docs-folders" onChange={(e) => setFolder(e.target.value)} onBlur={saveMeta} disabled={isVoid} data-testid="docs-file-folder" /></Field>
                <datalist id="docs-folders">{folders.map((f) => <option key={f} value={f} />)}</datalist>
                {!isVoid && doc.status === 'draft' && <Button size="sm" onClick={() => { act(setDocStatus, doc.id, 'sent'); toast(t('docs.markedSent')); }} data-testid="docs-mark-sent">{t('docs.markSent')}</Button>}
              </div>
            </CanWrite>
            {!can('write') && <dl className="kv"><dt>{t('docs.folder')}</dt><dd>{doc.folder || t('docs.noFolder')}</dd></dl>}
            <div style={{ marginTop: 12 }}>
              {isVoid
                ? <CanWrite><Button size="sm" icon={<LuRotateCcw aria-hidden="true" />} onClick={() => act(setDocStatus, doc.id, 'draft')}>{t('docs.unvoid')}</Button></CanWrite>
                : can('delete') && can('write') && !out && <button type="button" className="linkbtn small neg" onClick={() => void setVoid()} data-testid="docs-void">{t('docs.void')}</button>}
            </div>
          </Card>
          <HistoryCard doc={doc} />
        </aside>
      </div>
    </>
  );
}
