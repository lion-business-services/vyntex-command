// Creating a document. An estimate, agreement or invoice is written from a job. Every other kind is written from a
// template for a client (with or without an engagement), or is a file: an upload, or the firm's own form.
// Which kinds are offered comes from the edition.
import { useState } from 'react';
import { LuUpload } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { go } from '@/app/router';
import { act } from '@/store/store';
import { Button, Field, FormModal, Modal, Note, Seg, toast, type FieldDef } from '@/ui';
import { A } from '@/app/router';
import { addUpload, createDocFromTemplate } from '@/domain/actions';
import { visibleClients, visibleLeads } from '@/domain/access';
import { openLeads } from '@/domain/config';
import { byId } from '@/domain/selectors';
import type { DocKind, FileRef } from '@/domain/types';
import { FORM_KINDS, isConsentTemplate, isTemplateKind, pickTemplate } from '@/domain/esign/templates';
import { ACCEPT_ATTR, fileSize, uploadLimit } from '@/features/esign/prepare';
import { newDocument } from './actions';
import { storeFile } from './upload';

const JOB_KINDS: DocKind[] = ['estimate', 'contract', 'invoice'];
export interface NewDocPreset { kind?: DocKind; clientId?: string; jobId?: string; leadId?: string }

/** The kinds a person can pick. Where the edition has its own engagement letter, the older job agreement is not offered a second time under the same name. */
export function offeredKinds(kinds: DocKind[]): DocKind[] { return kinds.includes('engagement_letter') ? kinds.filter((k) => k !== 'contract') : kinds; }

/** The field editions' form, as it always was: a job and a kind. */
function JobDocModal({ onClose, kinds }: { onClose: () => void; kinds: DocKind[] }) {
  const { t, data } = useApp();
  if (!data.jobs.length) {
    return <Modal title={t('docs.new')} onClose={onClose} size="narrow" labelClose={t('common.close')} footer={<A to="/jobs" className="btn primary">{t('docs.goJobs')}</A>}><p className="muted">{t('docs.noJobs')}</p></Modal>;
  }
  const fields: FieldDef[] = [
    { k: 'jobId', label: t('docs.f.job'), type: 'select', req: true, full: true, options: data.jobs.map((j) => [j.id, `${byId(data.clients, j.clientId)?.name ?? ''} · ${j.name}`] as [string, string]) },
    { k: 'kind', label: t('docs.f.kind'), type: 'select', req: true, full: true, options: kinds.map((k) => [k, t('doc.kind.' + k)] as [string, string]) },
  ];
  const first = data.jobs[0];
  return (
    <FormModal title={t('docs.new')} fields={fields} initial={{ jobId: first.id, kind: first.status === 'estimate' ? 'estimate' : 'contract' }} onClose={onClose} saveLabel={t('docs.create')} cancelLabel={t('common.cancel')} requiredMsg={t('common.required')}
      onSave={(v) => {
        const kind = v.kind as DocKind;
        const made = act(newDocument, v.jobId, kind);
        if (!made) return;
        toast(made.created ? t('docs.created', { doc: t('doc.kind.' + kind) }) : t('docs.exists'));
        go(`/documents/${made.doc.id}`);
      }} />
  );
}

export function NewDocModal({ onClose, preset = {} }: { onClose: () => void; preset?: NewDocPreset }) {
  const { t, data, pack, user, perms, lang } = useApp();
  const kinds = offeredKinds(pack.docKinds);
  const onlyJobs = kinds.every((k) => JOB_KINDS.includes(k));
  const [kind, setKind] = useState<DocKind>(preset.kind && kinds.includes(preset.kind) ? preset.kind : kinds[0]);
  const presetJob = byId(data.jobs, preset.jobId);
  const [clientId, setClientId] = useState(preset.clientId ?? presetJob?.clientId ?? '');
  const [jobId, setJobId] = useState(preset.jobId ?? '');
  const [leadId, setLeadId] = useState(preset.leadId ?? '');
  const [templateId, setTemplateId] = useState('');
  const [how, setHow] = useState<'file' | 'text'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [folder, setFolder] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (onlyJobs) return <JobDocModal onClose={onClose} kinds={kinds} />;

  const clients = visibleClients(data, user, perms);
  const jobs = data.jobs.filter((j) => (clientId ? j.clientId === clientId : clients.some((c) => c.id === j.clientId)));
  const leads = visibleLeads(data, user, perms).filter((l) => openLeads(data).includes(l));
  const fromJob = JOB_KINDS.includes(kind);
  const asFile = kind === 'upload' || (FORM_KINDS.includes(kind) && how === 'file');
  const templates = data.templates.filter((x) => x.kind === kind && x.active && !isConsentTemplate(x));
  const client = byId(data.clients, clientId);
  const auto = isTemplateKind(kind) ? pickTemplate(data, kind, client?.lang ?? lang) : null;
  const folders = [...new Set(data.docs.map((d) => d.folder).filter((x): x is string => !!x))].sort();
  const name = (c: { name: string; company?: string }) => (c.company ? `${c.name} · ${c.company}` : c.name);

  const create = async () => {
    setErr('');
    if (fromJob) {
      if (!jobId) { setErr(t('docs.nd.needJob')); return; }
      const made = act(newDocument, jobId, kind);
      if (!made) return;
      toast(made.created ? t('docs.created', { doc: t('doc.kind.' + kind) }) : t('docs.exists'));
      onClose(); go(`/documents/${made.doc.id}`); return;
    }
    if (asFile) {
      if (!file) { setErr(t('docs.nd.needFile')); return; }
      if (!clientId && !jobId && !leadId) { setErr(t('docs.nd.needOwner')); return; }
      setBusy(true);
      const stored = await storeFile(file, { clientId: clientId || undefined, jobId: jobId || undefined, folder: folder.trim() || undefined });
      setBusy(false);
      if (!stored.ok) { setErr(t('docs.up.err.' + stored.reason, { limit: fileSize(uploadLimit()) })); return; }
      const ref: FileRef = stored.file;
      const doc = act(addUpload, { file: ref, kind, title, clientId: clientId || undefined, jobId: jobId || undefined, leadId: leadId || undefined, folder });
      if (!doc) { setErr(t('docs.nd.needOwner')); return; }
      toast(t('docs.up.done', { file: ref.name }));
      onClose(); go(`/documents/${doc.id}`); return;
    }
    if (!clientId && !leadId) { setErr(t('docs.nd.needClient')); return; }
    const doc = act(createDocFromTemplate, { kind, clientId, jobId: jobId || undefined, leadId: leadId || undefined, templateId: templateId || undefined });
    if (!doc) { setErr(t('docs.nd.failed')); return; }
    toast(t('docs.nd.created', { doc: t('doc.kind.' + kind) }));
    onClose(); go(`/documents/${doc.id}`);
  };

  return (
    <Modal title={t('docs.new')} onClose={onClose} labelClose={t('common.close')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" icon={asFile ? <LuUpload aria-hidden="true" /> : undefined} disabled={busy} onClick={() => void create()} data-testid="docs-nd-create">{t(busy ? 'docs.up.storing' : asFile ? 'docs.nd.upload' : 'docs.create')}</Button></>}>
      <div className="fgrid" data-testid="docs-nd">
        <Field label={t('docs.f.kind')} full>
          <select value={kind} onChange={(e) => { setKind(e.target.value as DocKind); setTemplateId(''); setErr(''); }} data-testid="docs-nd-kind">{kinds.map((k) => <option key={k} value={k}>{t('doc.kind.' + k)}</option>)}</select>
        </Field>
        {FORM_KINDS.includes(kind) && (
          <div className="full stack tight">
            <Seg label={t('docs.nd.how')} value={how} onChange={setHow} options={[{ value: 'file', label: t('docs.nd.how.file') }, { value: 'text', label: t('docs.nd.how.text') }]} />
            <Note>{t('docs.nd.formNote')}</Note>
          </div>
        )}
        {!fromJob && (
          <Field label={t('docs.col.client')} full={asFile ? false : true}>
            <select value={clientId} onChange={(e) => { setClientId(e.target.value); setJobId(''); }} data-testid="docs-nd-client"><option value="">{t('docs.nd.pick')}</option>{clients.map((c) => <option key={c.id} value={c.id}>{name(c)}</option>)}</select>
          </Field>
        )}
        <Field label={fromJob ? t('docs.f.job') : t('docs.nd.jobOptional')} full={fromJob}>
          <select value={jobId} onChange={(e) => { setJobId(e.target.value); const j = byId(data.jobs, e.target.value); if (j && !fromJob) setClientId(j.clientId); }} data-testid="docs-nd-job">
            <option value="">{fromJob ? t('docs.nd.pick') : t('docs.nd.none')}</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{`${byId(data.clients, j.clientId)?.name ?? ''} · ${j.name}`}</option>)}
          </select>
        </Field>
        {asFile && leads.length > 0 && (
          <Field label={t('docs.nd.lead')}>
            <select value={leadId} onChange={(e) => setLeadId(e.target.value)} data-testid="docs-nd-lead"><option value="">{t('docs.nd.none')}</option>{leads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          </Field>
        )}
        {asFile && <>
          <Field label={t('docs.nd.file')} full hint={`${t('docs.up.limit', { limit: fileSize(uploadLimit()) })} ${t('docs.up.types')}`}>
            <input type="file" accept={ACCEPT_ATTR} onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0] ?? null; setFile(f); setErr(''); if (f && !title) setTitle(f.name.replace(/\.[A-Za-z0-9]{1,5}$/, '')); }} data-testid="docs-nd-file" />
          </Field>
          <Field label={t('docs.col.title')}><input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="docs-nd-title" /></Field>
          <Field label={t('docs.folder')} hint={t('docs.folderHint')}><input value={folder} list="docs-nd-folders" onChange={(e) => setFolder(e.target.value)} data-testid="docs-nd-folder" /><datalist id="docs-nd-folders">{folders.map((f) => <option key={f} value={f} />)}</datalist></Field>
        </>}
        {!fromJob && !asFile && (
          <Field label={t('docs.template')} full hint={auto && !templateId ? t(auto.approved ? 'docs.nd.tplAuto' : 'docs.nd.tplAutoUnapproved', { name: auto.name }) : undefined}>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} data-testid="docs-nd-template">
              <option value="">{t('docs.nd.tplBest')}</option>
              {templates.map((x) => <option key={x.id} value={x.id}>{`${x.name} · ${t('docs.lang.' + (x.lang === 'es' ? 'es' : 'en'))} · ${t(x.approved ? 'docs.tpl.approved' : 'docs.tpl.notApproved')}`}</option>)}
            </select>
          </Field>
        )}
      </div>
      {asFile && <p className="xs dim" style={{ marginTop: 10 }}>{t('docs.private.note')}</p>}
      {err && <p className="small neg" role="alert" style={{ marginTop: 10 }} data-testid="docs-nd-error">{err}</p>}
    </Modal>
  );
}
