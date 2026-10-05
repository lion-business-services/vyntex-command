// One written document: the paper, its tools (language, edit, print, PDF), and beside it the next step for its kind
// (record a payment, send for signature, email it) and its history. A document written from a template shows whether
// its wording was approved and which merge values are missing.
import { useMemo, useRef, useState } from 'react';
import { LuDownload, LuHistory, LuPenLine, LuPrinter, LuRotateCcw } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, PREVIEW } from '@/app/router';
import { BackLink } from '@/app/Shell';
import { act } from '@/store/store';
import { Badge, Button, Card, Empty, Note, PageHeader, confirmDialog, toast } from '@/ui';
import { DocStatusBadge, CanWrite } from '@/app/shared';
import { ClientPaymentModal } from '@/app/forms';
import { restoreDocVersion, saveDocEdits, setDocStatus } from '@/domain/actions';
import { moduleOn } from '@/domain/config';
import { actorName, byId, jobMoney } from '@/domain/selectors';
import type { DocRecord, Lang } from '@/domain/types';
import type { DocVersionX, EnvelopeX } from '@/domain/esign/types';
import { isOpenEnvelope } from '@/domain/esign/envelope';
import { mergeLabel } from '@/domain/esign/merge';
import { downloadFile } from '@/features/esign/prepare';
import { clearSignature } from './actions';
import { buildDoc, editKey, editableBlocks } from './model';
import { EnvelopeCard } from './EnvelopeCard';
import { ESignCard, MailCard, Paper, PayCard, SigningModal } from './parts';

const LANGS: Lang[] = ['en', 'es'];
const NBSP = new RegExp(String.fromCharCode(160), 'g');
/** What a person typed, tidied the same way as the generated text so the two can be compared. */
const tidy = (s: string) => s.replace(NBSP, ' ').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/** Versions of a document: saved edits (with the way back), uploaded files and the signed copy. */
export function HistoryCard({ doc, canRestore }: { doc: DocRecord; canRestore?: boolean }) {
  const { t, data, dateTime } = useApp();
  const versions = [...((doc.versions ?? []) as DocVersionX[])].reverse();
  if (!versions.length) return null;
  const restore = async (v: number) => { if (await confirmDialog(t('docs.hist.restoreConfirm'), t('docs.hist.restore'), t('common.cancel'), false)) { act(restoreDocVersion, doc.id, v); toast(t('docs.hist.restored')); } };
  return (
    <Card title={<><LuHistory aria-hidden="true" />{t('docs.hist.title')}</>}>
      <ol className="docs-versions" data-testid="docs-versions">
        {versions.map((v) => (
          <li key={v.v}>
            <div className="grow">
              <div className="small strong">{t('docs.hist.v', { n: v.v })} · {t('docs.hist.kind.' + (v.kind ?? (v.file ? 'upload' : 'edit')))}</div>
              <div className="xs dim">{dateTime(v.at)} · {actorName(data, v.by) ?? t('common.system')}{v.note ? ` · ${v.note}` : ''}</div>
              {v.file && <div className="xs muted docs-clipname">{v.file.name}</div>}
            </div>
            {v.file ? <Button size="sm" variant="ghost" icon={<LuDownload aria-hidden="true" />} onClick={() => void downloadFile(v.file).then((ok) => { if (!ok) toast(t('docs.file.gone'), true); })} data-testid="docs-version-download"><span className="sr">{t('docs.file.download')} {v.file.name}</span></Button>
              : canRestore && v.kind === 'edit' ? <CanWrite><Button size="sm" variant="ghost" onClick={() => void restore(v.v)} data-testid="docs-version-restore">{t('docs.hist.restore')}</Button></CanWrite> : null}
          </li>
        ))}
      </ol>
      <p className="xs dim">{t('docs.hist.note')}</p>
    </Card>
  );
}

export function DocDetail({ doc }: { doc: DocRecord }) {
  const { t, data, pack, lang, can, date } = useApp();
  const [docLang, setDocLang] = useState<Lang>(lang === 'zh' ? 'en' : lang);
  const [editing, setEditing] = useState(false);
  const [rev, setRev] = useState(0);
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState(false);
  const [pay, setPay] = useState(false);
  const paperRef = useRef<HTMLDivElement>(null);
  const model = useMemo(() => buildDoc(doc, data, pack, docLang), [doc, data, pack, docLang]);

  const job = byId(data.jobs, doc.jobId);
  const client = byId(data.clients, doc.clientId);
  const lead = byId(data.leads, doc.leadId);
  if (!model) return <><BackLink to="/documents">{t('docs.back')}</BackLink><Card className="docs-none"><Empty title={t('docs.jobGone')} action={<A to="/documents" className="btn">{t('docs.back')}</A>} /></Card></>;

  const fromTemplate = model.source === 'template';
  const mLang = model.lang;
  const kindLabel = t('doc.kind.' + doc.kind);
  const isVoid = doc.status === 'void';
  const signed = doc.esign?.status === 'signed';
  // an edition with the Signatures screen sends through a request with signers and boxes; the others keep the one-signer demo
  const envelopes = moduleOn(data, pack, 'esign');
  const env = byId(data.envelopes, doc.envelopeId) as EnvelopeX | undefined;
  // what was sent is what gets signed: while a request is out, or once it is complete, the text stays as it is
  const frozen = !!env && (isOpenEnvelope(env) || env.status === 'completed');
  const owes = !!job && jobMoney(data, job).clientOwes > 0.005;
  // one primary action per view: when the side panel asks for the next step (send or sign, or record a payment), the PDF button steps down
  const nextStep = !isVoid && (doc.kind === 'invoice' ? can('money') && owes : envelopes ? env?.status !== 'completed' : !signed);
  const stop = () => { setEditing(false); setRev((n) => n + 1); };

  const save = () => {
    const root = paperRef.current; if (!root) return;
    const typed = new Map<string, string>();
    root.querySelectorAll<HTMLElement>('[data-key][contenteditable="true"]').forEach((el) => typed.set(el.dataset.key!, tidy(el.innerText)));
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(doc.edits || {})) if (!k.startsWith(mLang + ':')) next[k] = v;
    const before = Object.entries(doc.edits || {}).filter(([k]) => k.startsWith(mLang + ':'));
    let count = 0; let same = true;
    for (const b of editableBlocks(model)) {
      const now = typed.get(b.key);
      if (now === undefined || now === tidy(b.base)) continue;
      next[editKey(mLang, b.key)] = now; count++;
      if ((doc.edits || {})[editKey(mLang, b.key)] !== now) same = false;
    }
    if (same && count === before.length) { toast(t('docs.noChanges')); stop(); return; }
    act(saveDocEdits, doc.id, next);
    if (signed) act(clearSignature, doc.id);
    toast(t('docs.savedEdits')); stop();
  };
  const restore = async () => {
    if (!(await confirmDialog(t('docs.restoreConfirm'), t('docs.restore'), t('common.cancel'), false))) return;
    const rest: Record<string, string> = {};
    for (const [k, v] of Object.entries(doc.edits || {})) if (!k.startsWith(mLang + ':')) rest[k] = v;
    act(saveDocEdits, doc.id, Object.keys(rest).length ? rest : undefined);
    if (signed) act(clearSignature, doc.id);
    toast(t('docs.restored')); stop();
  };
  const pdf = async () => {
    setBusy(true);
    try {
      const { buildPdf, saveFile } = await import('./pdf');
      saveFile(await buildPdf(model), model.fileName);
      if (!PREVIEW) toast(t('docs.pdfDone', { file: model.fileName }));
    } catch (err) { console.warn('pdf', err); toast(t('docs.pdfFail'), true); }
    setBusy(false);
  };
  const setVoid = async () => { if (await confirmDialog(t('docs.voidConfirm'), t('docs.void'), t('common.cancel'))) { act(setDocStatus, doc.id, 'void'); toast(t('docs.voided')); } };

  return (
    <>
      <div className="no-print">
        <BackLink to="/documents">{t('docs.back')}</BackLink>
        <PageHeader
          title={<>{kindLabel} {doc.number} <DocStatusBadge status={doc.status} />{doc.esign && !isVoid && doc.status !== 'draft' && <> <span className="xs dim">{t('docs.demoMark')}</span></>}</>}
          sub={<>{doc.title}{client && <> · <A to={`/clients/${client.id}`}>{client.name}</A></>}{job && <> · <A to={`/jobs/${job.id}`}>{job.number}</A></>}{!client && lead && <> · <A to={`/leads/${lead.id}`}>{lead.name}</A></>}</>} />
      </div>

      <div className="docs-layout">
        <div>
          {fromTemplate && model.unapproved && !isVoid && (
            <div className="docs-hint no-print" data-testid="docs-unapproved"><Note tone="warn"><b>{t('docs.unapproved.title')}</b> {t('docs.unapproved.body')}{can('config') ? <> <A to="/settings/documents" className="linkbtn">{t('docs.unapproved.fix')}</A></> : <> {t('docs.unapproved.ask')}</>}</Note></div>
          )}
          {model.missing.length > 0 && !isVoid && (
            <div className="docs-hint no-print" data-testid="docs-missing"><Note tone="warn">{t('docs.missing', { fields: model.missing.map((id) => mergeLabel(id, lang)).join(', ') })}</Note></div>
          )}
          {frozen && <div className="docs-hint no-print" data-testid="docs-frozen"><Note>{t(env?.status === 'completed' ? 'docs.frozen.completed' : 'docs.frozen.out')}</Note></div>}
          <div className="docs-tools no-print">
            <div className="grp">
              {!fromTemplate && (
                <div className="seg" role="group" aria-label={t('docs.lang')} data-testid="docs-lang">
                  {LANGS.map((l) => <button key={l} type="button" aria-pressed={docLang === l} disabled={editing} data-lang={l} onClick={() => { setDocLang(l); setRev((n) => n + 1); }}>{t('docs.lang.' + l)}</button>)}
                </div>
              )}
              {fromTemplate && <span className="small muted">{t('docs.lang')}: {t('docs.lang.' + mLang)}</span>}
              {model.edited && <Badge tone="warn" outline title={t('docs.editedNote')}>{t('docs.edited')}</Badge>}
            </div>
            {editing ? (
              <div className="grp">
                <Button variant="ghost" onClick={stop}>{t('common.cancel')}</Button>
                <Button variant="primary" onClick={save} data-testid="docs-save">{t('docs.save')}</Button>
              </div>
            ) : (
              <div className="grp">
                {model.edited && !frozen && <CanWrite><Button size="sm" variant="ghost" icon={<LuRotateCcw />} onClick={restore} data-testid="docs-restore">{t('docs.restore')}</Button></CanWrite>}
                {!isVoid && !frozen && <CanWrite><Button size="sm" icon={<LuPenLine />} onClick={() => setEditing(true)} data-testid="docs-edit">{t('docs.edit')}</Button></CanWrite>}
                <Button size="sm" icon={<LuPrinter />} onClick={() => window.print()} data-testid="docs-print">{t('docs.print')}</Button>
                <Button size="sm" variant={nextStep ? 'default' : 'primary'} icon={<LuDownload />} onClick={pdf} disabled={busy} data-testid="docs-pdf">{busy ? t('docs.pdfMaking') : t('docs.pdf')}</Button>
              </div>
            )}
          </div>
          {editing && <div className="docs-hint no-print"><Note tone={signed ? 'warn' : undefined}>{t(signed ? 'docs.editSigned' : fromTemplate ? 'docs.editHintTpl' : 'docs.editHint')}</Note></div>}
          <Paper key={`${mLang}-${editing ? 'edit' : 'view'}-${rev}`} model={model} editing={editing} label={t('docs.paperLabel')} paperRef={paperRef} />
        </div>

        <aside className="stack docs-side no-print">
          {doc.kind === 'invoice' && !isVoid && job && <PayCard job={job} onPay={can('money') ? () => setPay(true) : undefined} />}
          {doc.kind !== 'invoice' && !isVoid && (envelopes
            ? <EnvelopeCard doc={doc} blocked={{ unapproved: model.unapproved, placeholders: model.placeholders }} />
            : <ESignCard doc={doc} client={client} onOpen={() => setSigning(true)} />)}
          {/* wording nobody approved is not prepared for sending either */}
          {!isVoid && job && !model.unapproved && <MailCard doc={doc} job={job} client={client} docLang={mLang} />}
          <Card title={t('docs.details')}>
            <dl className="kv">
              {job && <><dt>{t('docs.col.job')}</dt><dd><A to={`/jobs/${job.id}`}>{job.name}</A></dd></>}
              {client && <><dt>{t('docs.col.client')}</dt><dd><A to={`/clients/${client.id}`}>{client.name}</A></dd></>}
              {fromTemplate && <><dt>{t('docs.template')}</dt><dd>{data.templates.find((x) => x.id === doc.templateId)?.name ?? t('docs.tpl.starter')}</dd></>}
              <dt>{t('docs.created.on')}</dt><dd>{date(doc.created)}</dd>
              <dt>{t('docs.col.updated')}</dt><dd>{date(doc.updated)}</dd>
            </dl>
            <div style={{ marginTop: 12 }}>
              {isVoid
                ? <CanWrite><Button size="sm" icon={<LuRotateCcw />} onClick={() => act(setDocStatus, doc.id, 'draft')}>{t('docs.unvoid')}</Button></CanWrite>
                : can('delete') && can('write') && !frozen && <button type="button" className="linkbtn small neg" onClick={setVoid} data-testid="docs-void">{t('docs.void')}</button>}
            </div>
          </Card>
          <HistoryCard doc={doc} canRestore={!frozen && !isVoid} />
        </aside>
      </div>

      {signing && doc.esign && <SigningModal doc={doc} model={model} onClose={() => setSigning(false)} />}
      {pay && job && <ClientPaymentModal jobId={job.id} onClose={() => setPay(false)} />}
    </>
  );
}
