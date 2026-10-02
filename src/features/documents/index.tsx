// Documents: estimates, agreements and invoices written from each job. One description of the document (model.ts)
// feeds the screen, the printout and the PDF. E-signature is a demo simulation and is labelled as one everywhere.
import { useEffect, useMemo, useRef, useState } from 'react';
import { LuCircleCheck, LuDownload, LuEraser, LuFilePlus, LuMail, LuPenLine, LuPrinter, LuRotateCcw, LuSend, LuSignature, LuType } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, go, PREVIEW } from '@/app/router';
import { BackLink } from '@/app/Shell';
import type { PageProps } from '@/app/routes';
import { act } from '@/store/store';
import { Badge, Button, Card, Empty, Field, FormModal, Modal, Note, PageHeader, SearchBox, cx, confirmDialog, toast, type FieldDef } from '@/ui';
import { DemoTag, DocStatusBadge, PlanBadge } from '@/app/shared';
import { ClientPaymentModal } from '@/app/forms';
import { advanceSignature, saveDocEdits, sendForSignature, setDocStatus } from '@/domain/actions';
import { byId, jobMoney } from '@/domain/selectors';
import type { Client, DocKind, DocRecord, DocStatus, Job, Lang } from '@/domain/types';
import { makeT } from '@/i18n';
import { planName } from '@/lib/pricing';
import { money2 } from '@/lib/money';
import { greetName } from '@/features/messages/templates';
import { clearSignature, newDocument, prepareDocEmail, recordSignature } from './actions';
import { buildDoc, editKey, editableBlocks, hasEdits, type DocModel, type TextBlock } from './model';
import './documents.css';

const KINDS: DocKind[] = ['estimate', 'contract', 'invoice'];
const STATUSES: DocStatus[] = ['draft', 'sent', 'viewed', 'signed', 'paid', 'void'];
const LANGS: Lang[] = ['en', 'es'];
const NBSP = new RegExp(String.fromCharCode(160), 'g');
/** What a person typed, tidied the same way as the generated text so the two can be compared. */
const tidy = (s: string) => s.replace(NBSP, ' ').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const isEmail = (s: string) => /^\S+@\S+\.\S+$/.test(s.trim());
const waitsOnSignature = (d: DocRecord) => d.kind !== 'invoice' && (d.status === 'sent' || d.status === 'viewed');

export default function DocumentsPage({ id }: PageProps) {
  return id ? <DocDetail key={id} id={id} /> : <DocList />;
}

/* ---------- list ---------- */
function DocList() {
  const { t, data, date } = useApp();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'' | DocKind>('');
  const [status, setStatus] = useState<'' | DocStatus>('');
  const [form, setForm] = useState(false);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.docs
      .filter((d) => (!kind || d.kind === kind) && (!status || d.status === status))
      .filter((d) => !s || [d.number, d.title, byId(data.clients, d.clientId)?.name, byId(data.jobs, d.jobId)?.number].some((v) => v && v.toLowerCase().includes(s)))
      .sort((a, b) => b.updated.localeCompare(a.updated) || b.created.localeCompare(a.created));
  }, [data.docs, data.clients, data.jobs, q, kind, status]);
  const waiting = data.docs.filter(waitsOnSignature).length;
  const unpaid = data.docs.filter((d) => { const j = byId(data.jobs, d.jobId); return d.kind === 'invoice' && d.status !== 'void' && !!j && jobMoney(data, j).clientOwes > 0.005; }).length;
  const filtered = !!(q || kind || status);
  const clear = () => { setQ(''); setKind(''); setStatus(''); };
  const add = <Button variant="primary" icon={<LuFilePlus />} onClick={() => setForm(true)} data-testid="docs-new">{t('docs.new')}</Button>;

  return (
    <>
      <PageHeader title={t('docs.title')} sub={t('docs.sub')} actions={add} />
      <div className="filters">
        <SearchBox value={q} onChange={setQ} placeholder={t('docs.search')} />
        <select value={kind} onChange={(e) => setKind(e.target.value as DocKind | '')} aria-label={t('docs.kind')} data-testid="docs-filter-kind">
          <option value="">{t('docs.allKinds')}</option>{KINDS.map((k) => <option key={k} value={k}>{t('docs.kinds.' + k)}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as DocStatus | '')} aria-label={t('common.status')} data-testid="docs-filter-status">
          <option value="">{t('docs.allStatuses')}</option>{STATUSES.map((s) => <option key={s} value={s}>{t('doc.status.' + s)}</option>)}
        </select>
        {filtered && <button type="button" className="linkbtn small" onClick={clear}>{t('common.clearFilters')}</button>}
      </div>
      {!!data.docs.length && (
        <p className="small muted docs-sum"><span>{t('docs.sum.waiting', { n: waiting })}</span><span>{t('docs.sum.unpaid', { n: unpaid })}</span><span className="dim">{t('docs.sum.demo')}</span></p>
      )}

      {!data.docs.length ? (
        <Card><Empty title={t('docs.empty')} action={<Button variant="primary" onClick={() => setForm(true)}>{t('docs.new')}</Button>}>{t('docs.emptyHint')}</Empty></Card>
      ) : !rows.length ? (
        <Card><Empty title={t('common.noResults')} action={<Button onClick={clear}>{t('common.clearFilters')}</Button>} /></Card>
      ) : (
        <Card flush>
          <div className="table-wrap">
            <table className="tbl stackable" data-testid="docs-table">
              <thead><tr><th>{t('docs.col.doc')}</th><th>{t('docs.col.title')}</th><th>{t('docs.col.client')}</th><th>{t('docs.col.job')}</th><th>{t('docs.col.status')}</th><th>{t('docs.col.updated')}</th></tr></thead>
              <tbody>
                {rows.map((d) => {
                  const client = byId(data.clients, d.clientId); const job = byId(data.jobs, d.jobId);
                  return (
                    <tr key={d.id} className="click" onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button')) go(`/documents/${d.id}`); }}>
                      <td className="t1"><A to={`/documents/${d.id}`} className="docs-name">{d.number}</A>{hasEdits(d) && <span className="docs-edited"><Badge tone="warn" outline>{t('docs.edited')}</Badge></span>}<div className="xs dim">{t('doc.kind.' + d.kind)}</div></td>
                      <td data-label={t('docs.col.title')}>{d.title}</td>
                      <td data-label={t('docs.col.client')}>{client ? <A to={`/clients/${client.id}`}>{client.name}</A> : null}</td>
                      <td data-label={t('docs.col.job')}>{job ? <A to={`/jobs/${job.id}`}>{job.number}</A> : <span className="dim small">{t('docs.noJob')}</span>}</td>
                      <td data-label={t('docs.col.status')}><span className="row tight nowrap"><DocStatusBadge status={d.status} />{d.esign && d.status !== 'draft' && d.status !== 'void' && <span className="xs dim">{t('docs.demoMark')}</span>}</span></td>
                      <td data-label={t('docs.col.updated')} className="small muted nowrap">{date(d.updated)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {form && <NewDocModal onClose={() => setForm(false)} />}
    </>
  );
}

function NewDocModal({ onClose }: { onClose: () => void }) {
  const { t, data } = useApp();
  if (!data.jobs.length) {
    return <Modal title={t('docs.new')} onClose={onClose} size="narrow" labelClose={t('common.close')} footer={<A to="/jobs" className="btn primary">{t('docs.goJobs')}</A>}><p className="muted">{t('docs.noJobs')}</p></Modal>;
  }
  const fields: FieldDef[] = [
    { k: 'jobId', label: t('docs.f.job'), type: 'select', req: true, full: true, options: data.jobs.map((j) => [j.id, `${byId(data.clients, j.clientId)?.name ?? ''} · ${j.name}`] as [string, string]) },
    { k: 'kind', label: t('docs.f.kind'), type: 'select', req: true, full: true, options: KINDS.map((k) => [k, t('doc.kind.' + k)] as [string, string]) },
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

/* ---------- the paper: screen and print ---------- */
function plainPaste(e: React.ClipboardEvent<HTMLElement>) {
  e.preventDefault();
  const text = e.clipboardData.getData('text/plain');
  if (text) document.execCommand('insertText', false, text);
}

function Paper({ model, editing, label, paperRef }: { model: DocModel; editing?: boolean; label: string; paperRef?: React.RefObject<HTMLDivElement | null> }) {
  const edit = (b: TextBlock) => (editing && !b.locked
    ? { 'data-key': b.key, contentEditable: true, suppressContentEditableWarning: true, spellCheck: true, role: 'textbox', 'aria-multiline': true, 'aria-label': b.base.slice(0, 60), onPaste: plainPaste }
    : { 'data-key': b.key });
  const line = (b: TextBlock) => (b.style === 'h'
    ? <h4 key={b.key} {...edit(b)}>{b.text}</h4>
    : <p key={b.key} className={b.style === 'strong' ? 'strong' : b.style === 'small' ? 'small' : undefined} {...edit(b)}>{b.text}</p>);
  return (
    <article className="paper docs-paper" lang={model.lang} aria-label={label} ref={paperRef}>
      <div className="docs-head">
        <div className="docs-co">
          {model.company.logo && <img src={model.company.logo} alt="" />}
          <div><b>{model.company.name}</b>{model.company.lines.map((l, i) => <span key={i}>{l}</span>)}</div>
        </div>
        <div className="docs-headr"><h2 {...edit(model.title)}>{model.title.text}</h2>{model.meta.map((l, i) => <span key={i}>{l}</span>)}</div>
      </div>
      {model.blocks.map((b, i) => {
        if (b.t === 'text') return line(b);
        if (b.t === 'cols') return <div className="docs-two" key={i}>{b.cols.map((c) => <div key={c.body.key}><h4>{c.head}</h4>{line(c.body)}</div>)}</div>;
        if (b.t === 'table') return (
          <div key={i}>
            <table className="docs-amounts"><tbody>{b.rows.map((r, n) => <tr key={n} className={r.kind === 'total' ? 'tot' : undefined}><td>{r.label}</td><td>{r.kind === 'minus' ? '-' : ''}{r.amount}</td></tr>)}</tbody></table>
            {b.paidNote && <p className="docs-paidnote">{b.paidNote}</p>}
          </div>
        );
        if (b.t === 'sign') return (
          <div className="docs-sigs" key={i}>
            {b.parties.map((p) => (
              <div className="docs-sig" key={p.role} data-signed={p.signed ? 'yes' : undefined}>
                <div className="ink">{p.signed?.image ? <img src={p.signed.image} alt={p.signed.name} /> : p.signed ? <i>{p.signed.name}</i> : null}</div>
                <p>{p.label}</p>
                {p.signed?.image && <p>{p.signed.name}</p>}
                <p>{p.dateLabel}: {p.signed ? p.signed.date : '________________'}</p>
                {p.signed && <p className="demo">{p.signed.note}</p>}
              </div>
            ))}
          </div>
        );
        return <div key={i} className={cx('docs-notice', b.tone === 'void' && 'void')} role="note">{b.text}</div>;
      })}
    </article>
  );
}

/* ---------- one document ---------- */
function DocDetail({ id }: { id: string }) {
  const { t, data, pack, lang, can, date } = useApp();
  const doc = byId(data.docs, id);
  const [docLang, setDocLang] = useState<Lang>(lang);
  const [editing, setEditing] = useState(false);
  const [rev, setRev] = useState(0);
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState(false);
  const [pay, setPay] = useState(false);
  const paperRef = useRef<HTMLDivElement>(null);
  const model = useMemo(() => (doc ? buildDoc(doc, data, pack, docLang) : null), [doc, data, pack, docLang]);

  if (!doc) return <Empty title={t('docs.notFound')} action={<A to="/documents" className="btn">{t('docs.back')}</A>} />;
  const job = byId(data.jobs, doc.jobId);
  const client = byId(data.clients, doc.clientId);
  if (!model || !job) return <><BackLink to="/documents">{t('docs.back')}</BackLink><Card><Empty title={t('docs.jobGone')} action={<A to="/documents" className="btn">{t('docs.back')}</A>} /></Card></>;

  const kindLabel = t('doc.kind.' + doc.kind);
  const isVoid = doc.status === 'void';
  const signed = doc.esign?.status === 'signed';
  const stop = () => { setEditing(false); setRev((n) => n + 1); };

  const save = () => {
    const root = paperRef.current; if (!root) return;
    const typed = new Map<string, string>();
    root.querySelectorAll<HTMLElement>('[data-key][contenteditable="true"]').forEach((el) => typed.set(el.dataset.key!, tidy(el.innerText)));
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(doc.edits || {})) if (!k.startsWith(docLang + ':')) next[k] = v;
    const before = Object.entries(doc.edits || {}).filter(([k]) => k.startsWith(docLang + ':'));
    let count = 0; let same = true;
    for (const b of editableBlocks(model)) {
      const now = typed.get(b.key);
      if (now === undefined || now === tidy(b.base)) continue;
      next[editKey(docLang, b.key)] = now; count++;
      if ((doc.edits || {})[editKey(docLang, b.key)] !== now) same = false;
    }
    if (same && count === before.length) { toast(t('docs.noChanges')); stop(); return; }
    act(saveDocEdits, doc.id, next);
    if (signed) act(clearSignature, doc.id);
    toast(t('docs.savedEdits')); stop();
  };
  const restore = async () => {
    if (!(await confirmDialog(t('docs.restoreConfirm'), t('docs.restore'), t('common.cancel'), false))) return;
    const rest: Record<string, string> = {};
    for (const [k, v] of Object.entries(doc.edits || {})) if (!k.startsWith(docLang + ':')) rest[k] = v;
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
          sub={<>{doc.title}{client && <> · <A to={`/clients/${client.id}`}>{client.name}</A></>} · <A to={`/jobs/${job.id}`}>{job.number}</A></>} />
      </div>

      <div className="docs-layout">
        <div>
          <div className="docs-tools no-print">
            <div className="grp">
              <div className="seg" role="group" aria-label={t('docs.lang')} data-testid="docs-lang">
                {LANGS.map((l) => <button key={l} type="button" aria-pressed={docLang === l} disabled={editing} data-lang={l} onClick={() => { setDocLang(l); setRev((n) => n + 1); }}>{t('docs.lang.' + l)}</button>)}
              </div>
              {model.edited && <Badge tone="warn" outline title={t('docs.editedNote')}>{t('docs.edited')}</Badge>}
            </div>
            {editing ? (
              <div className="grp">
                <Button variant="ghost" onClick={stop}>{t('common.cancel')}</Button>
                <Button variant="primary" onClick={save} data-testid="docs-save">{t('docs.save')}</Button>
              </div>
            ) : (
              <div className="grp">
                {model.edited && <Button size="sm" variant="ghost" icon={<LuRotateCcw />} onClick={restore} data-testid="docs-restore">{t('docs.restore')}</Button>}
                {!isVoid && <Button size="sm" icon={<LuPenLine />} onClick={() => setEditing(true)} data-testid="docs-edit">{t('docs.edit')}</Button>}
                <Button size="sm" icon={<LuPrinter />} onClick={() => window.print()} data-testid="docs-print">{t('docs.print')}</Button>
                <Button size="sm" variant="primary" icon={<LuDownload />} onClick={pdf} disabled={busy} data-testid="docs-pdf">{busy ? t('docs.pdfMaking') : t('docs.pdf')}</Button>
              </div>
            )}
          </div>
          {editing && <div className="docs-hint no-print"><Note tone={signed ? 'warn' : undefined}>{t(signed ? 'docs.editSigned' : 'docs.editHint')}</Note></div>}
          <Paper key={`${docLang}-${editing ? 'edit' : 'view'}-${rev}`} model={model} editing={editing} label={t('docs.paperLabel')} paperRef={paperRef} />
        </div>

        <aside className="stack docs-side no-print">
          {doc.kind === 'invoice' && !isVoid && <PayCard job={job} onPay={can('money') ? () => setPay(true) : undefined} />}
          {doc.kind !== 'invoice' && !isVoid && <ESignCard doc={doc} client={client} onOpen={() => setSigning(true)} />}
          {!isVoid && <MailCard doc={doc} job={job} client={client} docLang={docLang} />}
          <Card title={t('docs.details')}>
            <dl className="kv">
              <dt>{t('docs.col.job')}</dt><dd><A to={`/jobs/${job.id}`}>{job.name}</A></dd>
              {client && <><dt>{t('docs.col.client')}</dt><dd><A to={`/clients/${client.id}`}>{client.name}</A></dd></>}
              <dt>{t('docs.created.on')}</dt><dd>{date(doc.created)}</dd>
              <dt>{t('docs.col.updated')}</dt><dd>{date(doc.updated)}</dd>
            </dl>
            <div style={{ marginTop: 12 }}>
              {isVoid
                ? <Button size="sm" icon={<LuRotateCcw />} onClick={() => act(setDocStatus, doc.id, 'draft')}>{t('docs.unvoid')}</Button>
                : can('delete') && <button type="button" className="linkbtn small neg" onClick={setVoid} data-testid="docs-void">{t('docs.void')}</button>}
            </div>
          </Card>
        </aside>
      </div>

      {signing && doc.esign && <SigningModal doc={doc} model={model} onClose={() => setSigning(false)} />}
      {pay && <ClientPaymentModal jobId={job.id} onClose={() => setPay(false)} />}
    </>
  );
}

/* ---------- invoice: balance and payment ---------- */
function PayCard({ job, onPay }: { job: Job; onPay?: () => void }) {
  const { t, data } = useApp();
  const m = jobMoney(data, job);
  const paid = m.price > 0 && m.clientOwes <= 0.005;
  return (
    <Card title={t('docs.pay.title')} actions={paid ? <Badge tone="ok"><LuCircleCheck aria-hidden="true" />{t('docs.pay.paid')}</Badge> : undefined}>
      {onPay && (
        <dl className="docs-figs">
          <dt>{t('docs.pay.price')}</dt><dd>{money2(m.price)}</dd>
          <dt>{t('docs.pay.received')}</dt><dd>{money2(m.received)}</dd>
          <dt className="tot">{t('docs.pay.balance')}</dt><dd className="tot">{money2(m.clientOwes)}</dd>
        </dl>
      )}
      {onPay && !paid && m.clientOwes > 0.005 && <Button variant="primary" onClick={onPay} data-testid="docs-pay">{t('docs.pay.record')}</Button>}
      <p className="xs dim" style={{ marginTop: onPay ? 10 : 0 }}>{t('docs.pay.auto')}</p>
    </Card>
  );
}

/* ---------- e-signature (demo simulation) ---------- */
function ESignCard({ doc, client, onOpen }: { doc: DocRecord; client?: Client; onOpen: () => void }) {
  const { t, dateTime } = useApp();
  const es = doc.esign;
  const [again, setAgain] = useState(false);
  const [name, setName] = useState(es?.signerName || client?.name || '');
  const [email, setEmail] = useState(es?.signerEmail || client?.email || '');
  const [err, setErr] = useState(false);
  const send = () => {
    if (!name.trim() || !isEmail(email)) { setErr(true); return; }
    act(sendForSignature, doc.id, name.trim(), email.trim());
    setErr(false); setAgain(false); toast(t('docs.esign.sentToast'));
  };
  const steps: [string, string | undefined][] = es ? [['sent', es.sentAt], ['viewed', es.viewedAt], ['signed', es.signedAt]] : [];
  return (
    <Card title={<><LuSignature aria-hidden="true" />{t('docs.esign.title')}</>} actions={<><PlanBadge feature="esignature" /><DemoTag /></>}>
      <p className="small muted">{t('docs.esign.intro')}</p>
      {!es || again ? (
        <div className="stack tight" style={{ marginTop: 12 }}>
          <Field label={t('docs.esign.signerName')} error={err && !name.trim()}><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" data-testid="docs-send-name" /></Field>
          <Field label={t('docs.esign.signerEmail')} error={err && !isEmail(email)}><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" data-testid="docs-send-email" /></Field>
          {err && <p className="small neg" role="alert">{t('docs.esign.needSigner')}</p>}
          <div className="row">
            <Button variant="primary" icon={<LuSend />} onClick={send} data-testid="docs-send">{t('docs.esign.send')}</Button>
            {again && <Button variant="ghost" onClick={() => setAgain(false)}>{t('common.cancel')}</Button>}
          </div>
        </div>
      ) : (
        <>
          <ol className="timeline docs-steps" aria-label={t('docs.esign.timeline')} data-testid="docs-esign-steps">
            {steps.map(([k, at]) => <li key={k} className={at ? undefined : 'wait'} data-step={k} data-done={at ? 'yes' : 'no'}><span>{t('docs.esign.step.' + k)}</span><time>{at ? dateTime(at) : t('docs.esign.pending')}</time></li>)}
          </ol>
          <p className="small muted" style={{ margin: '10px 0' }}>{t('docs.esign.to', { name: es.signerName })}{es.signerEmail ? ` · ${es.signerEmail}` : ''}</p>
          {es.status === 'signed'
            ? <p className="small">{t('docs.esign.signedNote')}</p>
            : <Button variant="primary" block icon={<LuPenLine />} onClick={onOpen} data-testid="docs-sign-open" style={{ whiteSpace: 'normal' }}>{t('docs.esign.openSign')}</Button>}
          <div style={{ marginTop: 10 }}><button type="button" className="linkbtn small" onClick={() => setAgain(true)} data-testid="docs-send-again">{t('docs.esign.again')}</button></div>
        </>
      )}
      <p className="xs dim" style={{ marginTop: 12 }}>{t('docs.esign.preview')}</p>
    </Card>
  );
}

/** What the client would see: the document, a consent tick, the typed name and a signature drawn with the mouse or a finger. */
function SigningModal({ doc, model, onClose }: { doc: DocRecord; model: DocModel; onClose: () => void }) {
  const { t, pack } = useApp();
  const dt = makeT(model.lang, pack);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [inked, setInked] = useState(false);
  const [err, setErr] = useState(false);

  // opening the page is the "Viewed" step
  useEffect(() => { if (doc.esign?.status === 'sent') act(advanceSignature, doc.id, 'viewed'); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => {
    const c = canvas.current; if (!c) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(c.clientWidth * ratio); c.height = Math.round(c.clientHeight * ratio);
    const g = c.getContext('2d'); if (!g) return;
    g.scale(ratio, ratio); g.lineWidth = 2.2; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#0B1B33'; g.fillStyle = '#0B1B33';
  }, []);
  const at = (e: { clientX: number; clientY: number }) => { const r = canvas.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e: any) => {
    const g = canvas.current?.getContext('2d'); if (!g) return;
    e.preventDefault();
    try { canvas.current!.setPointerCapture(e.pointerId); } catch { /* the stroke still works without capture */ }
    const p = at(e); drawing.current = true;
    g.beginPath(); g.arc(p.x, p.y, 1.1, 0, Math.PI * 2); g.fill(); g.beginPath(); g.moveTo(p.x, p.y);
    setInked(true); setErr(false);
  };
  const move = (e: any) => { if (!drawing.current) return; const g = canvas.current?.getContext('2d'); if (!g) return; const p = at(e); g.lineTo(p.x, p.y); g.stroke(); };
  const up = () => { drawing.current = false; };
  const clear = () => { const c = canvas.current; const g = c?.getContext('2d'); if (!c || !g) return; g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height); g.restore(); setInked(false); };
  const useTyped = () => {
    const c = canvas.current; const g = c?.getContext('2d'); if (!c || !g || !name.trim()) { setErr(true); return; }
    clear();
    let size = 40; const w = c.clientWidth - 32;
    do { g.font = `italic ${size}px Georgia, 'Times New Roman', serif`; size -= 2; } while (g.measureText(name.trim()).width > w && size > 14);
    g.textBaseline = 'middle'; g.fillText(name.trim(), 16, c.clientHeight / 2);
    setInked(true); setErr(false);
  };
  /** The drawn signature as a PNG: trimmed to the ink and scaled down, so it sits well on the line and the saved demo data stays small. */
  const image = (): string => {
    const c = canvas.current!;
    const g = c.getContext('2d')!;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    try {
      const px = g.getImageData(0, 0, c.width, c.height).data;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (px[(y * c.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    } catch { x1 = -1; }
    if (x1 < 0) { x0 = 0; y0 = 0; x1 = c.width - 1; y1 = c.height - 1; }
    const pad = 6; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(c.width - 1, x1 + pad); y1 = Math.min(c.height - 1, y1 + pad);
    const w = x1 - x0 + 1, h = y1 - y0 + 1; const k = Math.min(1, 520 / w, 160 / h);
    const s = document.createElement('canvas'); s.width = Math.max(1, Math.round(w * k)); s.height = Math.max(1, Math.round(h * k));
    s.getContext('2d')!.drawImage(c, x0, y0, w, h, 0, 0, s.width, s.height);
    return s.toDataURL('image/png');
  };
  const sign = () => {
    if (!name.trim() || !consent || !inked) { setErr(true); return; }
    act(recordSignature, doc.id, { typedName: name, signature: image(), consent: true });
    act(advanceSignature, doc.id, 'signed');
    toast(t('docs.sign.done')); onClose();
  };

  return (
    <Modal title={<>{dt('docs.sign.title')} <DemoTag /></>} onClose={onClose} size="wide" labelClose={t('common.close')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" icon={<LuSignature />} onClick={sign} data-testid="docs-sign-submit">{dt('docs.sign.submit')}</Button></>}>
      <div lang={model.lang} data-testid="docs-sign-page">
        <Note>{dt('docs.sign.banner', { name: doc.esign?.signerName ?? '' })}</Note>
        <p className="small muted" style={{ marginTop: 12 }}>{dt('docs.sign.review')}</p>
        <div className="docs-signview" tabIndex={0} role="region" aria-label={t('docs.paperLabel')} data-autofocus><Paper model={model} label={t('docs.paperLabel')} /></div>
        <h3 style={{ marginBottom: 10 }}>{dt('docs.sign.heading')}</h3>
        <div className="stack tight">
          <Field label={dt('docs.sign.name')} error={err && !name.trim()}><input value={name} onChange={(e) => { setName(e.target.value); setErr(false); }} autoComplete="off" data-testid="docs-sign-name" /></Field>
          <div>
            <div className="label" id="docs-pad-label">{dt('docs.sign.pad')}</div>
            <canvas ref={canvas} className="docs-pad" role="img" aria-labelledby="docs-pad-label" data-testid="docs-sign-pad" data-inked={inked ? 'yes' : 'no'}
              onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} onPointerCancel={up} />
            <div className="docs-padbar">
              <span className="xs dim">{dt('docs.sign.padHint')}</span>
              <span className="row tight">
                <Button size="sm" variant="ghost" icon={<LuType />} onClick={useTyped} data-testid="docs-sign-typed">{dt('docs.sign.useTyped')}</Button>
                <Button size="sm" variant="ghost" icon={<LuEraser />} onClick={clear} data-testid="docs-sign-clear">{dt('docs.sign.clear')}</Button>
              </span>
            </div>
          </div>
          <label className="check"><input type="checkbox" checked={consent} onChange={(e) => { setConsent(e.target.checked); setErr(false); }} data-testid="docs-sign-consent" /><span>{dt('docs.sign.consent')}</span></label>
          {err && <p className="small neg" role="alert" data-testid="docs-sign-error">{dt('signErr')}</p>}
        </div>
      </div>
    </Modal>
  );
}

/* ---------- email to the client: prepared in Messages, never sent in the demo ---------- */
function MailCard({ doc, job, client, docLang }: { doc: DocRecord; job: Job; client?: Client; docLang: Lang }) {
  const { t, data, pack, lang, standing } = useApp();
  const st = standing('emailDocs');
  const waiting = data.messages.find((m) => m.status === 'draft' && m.ref.type === 'job' && m.ref.id === job.id && m.subject.includes(doc.number));
  const prepare = () => {
    const dt = makeT(docLang, pack);
    const m = jobMoney(data, job);
    const p = { number: doc.number, jobName: job.name, company: data.company.name, name: greetName(client?.name ?? ''), kind: dt('doc.kind.' + doc.kind), amount: money2(doc.kind === 'invoice' ? m.clientOwes : m.price) };
    const middle = doc.kind === 'invoice' ? (m.price > 0 && m.clientOwes <= 0.005 ? 'docs.mail.invoicePaid' : 'docs.mail.invoice') : doc.kind === 'contract' ? 'docs.mail.contract' : 'docs.mail.estimate';
    const body = [dt('docs.mail.hello', p), '', dt(middle, p), '', dt('docs.mail.bye'), data.company.name, data.company.phone].join('\n');
    act(prepareDocEmail, doc.id, { to: client?.email ?? '', subject: dt('docs.mail.subject', p), body });
    toast(t('docs.mail.done'));
  };
  return (
    <Card title={t('docs.mail.title')} actions={<PlanBadge feature="emailDocs" detail />}>
      {st.state === 'upgrade' && st.plan && <p className="small muted" style={{ marginBottom: 10 }}>{t('ent.upgradeHint', { plan: planName(st.plan, lang) })}</p>}
      <div className="row"><Button icon={<LuMail />} onClick={prepare} data-testid="docs-email">{t('docs.mail.button')}</Button><DemoTag /></div>
      <p className="xs dim" style={{ marginTop: 10 }}>{t('docs.mail.note')}</p>
      {waiting && <p className="small" style={{ marginTop: 10 }} data-testid="docs-email-waiting">{t('docs.mail.waiting')} <A to={`/messages?open=${waiting.id}`} className="linkbtn">{t('docs.mail.open')}</A></p>}
      {doc.status === 'draft' && (
        <div style={{ borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 12 }}>
          <p className="small muted" style={{ marginBottom: 8 }}>{t('docs.markSentHint')}</p>
          <Button size="sm" onClick={() => { act(setDocStatus, doc.id, 'sent'); toast(t('docs.markedSent')); }} data-testid="docs-mark-sent">{t('docs.markSent')}</Button>
        </div>
      )}
    </Card>
  );
}
