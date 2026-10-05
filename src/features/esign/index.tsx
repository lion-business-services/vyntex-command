// Signatures: every signature request, who it is waiting on, and what happened to it.
//   /esign                      the lists: drafts, out for signature, completed, closed
//   /esign/<id>                 a draft is prepared here (signers, boxes on the pages, send); a sent one shows its trail
//   /esign/<id>/sign/<signer>   the signer's page, opened inside the app in a sample workspace
// In a sample workspace nothing is emailed and nothing is legally signed; the screens say so wherever it matters.
import { useEffect, useMemo, useState } from 'react';
import { LuBellRing, LuBan, LuDownload, LuExternalLink, LuFilePen, LuPenLine, LuPlus, LuSend, LuTrash2, LuArrowUp, LuArrowDown, LuScanSearch } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, go, useRoute } from '@/app/router';
import { BackLink } from '@/app/Shell';
import type { PageProps } from '@/app/routes';
import { act, getSnapshot } from '@/store/store';
import { Badge, Button, Card, Empty, Field, Modal, Note, PageHeader, SearchBox, Seg, cx, confirmDialog, toast, type Tone } from '@/ui';
import { CanWrite, DemoTag } from '@/app/shared';
import { byId } from '@/domain/selectors';
import { visibleClientIds } from '@/domain/access';
import { makeT } from '@/i18n';
import { createEnvelope, declineEnvelope, deleteEnvelope, saveEnvelope, signEnvelope, viewEnvelope, voidEnvelope } from '@/domain/actions';
import { envelopeBlockers } from '@/domain/actions/esign';
import type { DocRecord, Envelope, SignField } from '@/domain/types';
import type { EnvelopeX, SignerRole, SignerX } from '@/domain/esign/types';
import { SIGNER_ROLES } from '@/domain/esign/types';
import { autoPlace, bucketOf, cannotSign, fieldImage, fieldInkName, isExpired, isOpenEnvelope, signerIndex, signerView, waitingOn, type EnvelopeBucket, type SendBlocker } from '@/domain/esign/envelope';
import { roleLabel, utcStamp } from '@/domain/esign/certificate';
import { uid } from '@/lib/id';
import { saveFile } from '@/features/documents/pdf';
import { FieldEditor } from './fields';
import { FieldBox, SigningFlow, type SigningAdapter } from './signing';
import { PageSheet, pageMode, pageSizes, useViewer } from './pages';
import { downloadFile, drawDocument, ensureSource, finishEnvelope, objectUrl, openFile, placementPreview, remindRequest, sendDrawn, sendingPending, type DrawnDocument, type DrawProblem } from './prepare';
import './esign.css';

const STATUS_TONE: Record<Envelope['status'], Tone> = { draft: 'neutral', sent: 'warn', partly_signed: 'info', completed: 'ok', declined: 'bad', expired: 'neutral', void: 'neutral' };
const SIGNER_TONE: Record<SignerX['status'], Tone> = { waiting: 'neutral', sent: 'warn', viewed: 'info', signed: 'ok', declined: 'bad' };
const BUCKETS: EnvelopeBucket[] = ['draft', 'out', 'completed', 'closed'];

export function EnvelopeStatus({ env }: { env: Envelope }) { const { t } = useApp(); return <Badge tone={STATUS_TONE[env.status]}>{t('esign.status.' + env.status)}</Badge>; }
/** The requests the viewer may see: office scoping applies as it does to the client itself. */
export function useEnvelopes(): EnvelopeX[] {
  const { data, user, perms } = useApp();
  return useMemo(() => { const mine = visibleClientIds(data, user, perms); return (data.envelopes as EnvelopeX[]).filter((e) => !e.clientId || mine.has(e.clientId)); }, [data, user, perms]);
}

/** The reasons a request is held back that the screen has a sentence for (`esign.block.*`). */
const BLOCKERS: readonly string[] = ['not_draft', 'template_unapproved', 'consent_unapproved', 'placeholders', 'no_document', 'no_signers', 'bad_signer', 'no_fields', 'no_signature_box'];
/** Why sending or reminding did not happen, as a wording key. An answer this screen has no sentence for gets the general one. */
const FAILS: readonly string[] = ['server_only', 'delivery_not_configured', 'delivery_failed', 'not_saved', 'busy', 'not_allowed', 'not_found', 'not_draft', 'expired', 'rate_limited', 'offline', 'session'];
const failWord = (reason: string, other: string): string => (FAILS.includes(reason) ? 'esign.err.' + reason : other);

export default function EsignPage({ id, sub }: PageProps) {
  if (id && sub?.startsWith('sign/')) return <SampleSigner key={id + sub} id={id} signerId={sub.slice(5)} />;
  return id ? <EnvelopePage key={id} id={id} /> : <EnvelopeList />;
}

/* ---------- the lists ---------- */
function Signers({ env }: { env: EnvelopeX }) {
  const { t } = useApp();
  return <span className="es-signers">{env.signers.map((s) => <span key={s.id} className={cx('es-who', `es-s${signerIndex(env, s.id) % 6}`)}><i aria-hidden="true" />{s.name || t('esign.prep.unnamed')}<Badge tone={SIGNER_TONE[s.status]}>{t('esign.signer.' + s.status)}</Badge></span>)}</span>;
}

function EnvelopeList() {
  const { t, data, date, can, live } = useApp();
  const route = useRoute();
  const all = useEnvelopes();
  const [bucket, setBucket] = useState<'all' | EnvelopeBucket>('all');
  const [q, setQ] = useState('');
  const [picking, setPicking] = useState(false);
  const mayAct = can('write') && can('esign');
  // arriving from a document ("Prepare a signature request"): the draft is made and opened
  const fromDoc = route.query.get('doc');
  useEffect(() => { if (fromDoc && mayAct) { const r = act(createEnvelope, fromDoc); if (r.ok) go(`/esign/${r.data.id}`); else toast(t('esign.err.' + r.reason), true); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [fromDoc]);

  const counts = Object.fromEntries(BUCKETS.map((b) => [b, all.filter((e) => bucketOf(e) === b).length])) as Record<EnvelopeBucket, number>;
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all.filter((e) => bucket === 'all' || bucketOf(e) === bucket)
      .filter((e) => !s || [e.title, e.docNumber, byId(data.clients, e.clientId)?.name, ...e.signers.flatMap((x) => [x.name, x.email])].some((v) => v && v.toLowerCase().includes(s)))
      .sort((a, b) => (b.sentAt ?? b.created).localeCompare(a.sentAt ?? a.created));
  }, [all, bucket, q, data.clients]);
  const clear = () => { setQ(''); setBucket('all'); };
  const doRemind = (e: EnvelopeX) => { void remindRequest(e.id).then((r) => toast(r.ok ? t(live ? 'esign.reminded' : 'esign.remindedSample', { n: r.data.reminded }) : t(failWord(r.reason, 'esign.err.not_open')), !r.ok)); };
  const doVoid = async (e: EnvelopeX) => { if (await confirmDialog(t('esign.voidConfirm'), t('esign.void'), t('common.cancel'))) { act(voidEnvelope, e.id); toast(t('esign.voided')); } };

  return (
    <>
      <PageHeader title={t('nav.esign')} sub={t('esign.sub')} actions={mayAct ? <Button variant="primary" icon={<LuPlus aria-hidden="true" />} onClick={() => setPicking(true)} data-testid="esign-new">{t('esign.new')}</Button> : undefined} />
      {!live && <p className="small muted es-samplenote"><DemoTag /> {t('esign.sampleNote')}</p>}
      <div className="filters">
        <Seg label={t('esign.filter')} value={bucket} onChange={setBucket} options={[{ value: 'all', label: t('esign.bucket.all'), count: all.length }, ...BUCKETS.map((b) => ({ value: b, label: t('esign.bucket.' + b), count: counts[b] }))]} />
        <SearchBox value={q} onChange={setQ} placeholder={t('esign.search')} />
      </div>
      {!all.length ? (
        <Card><Empty title={t('esign.empty')} action={mayAct ? <Button variant="primary" onClick={() => setPicking(true)}>{t('esign.new')}</Button> : undefined}>{t('esign.emptyHint')}</Empty></Card>
      ) : !rows.length ? (
        <Card><Empty title={t('common.noResults')} action={<Button onClick={clear}>{t('common.clearFilters')}</Button>} /></Card>
      ) : (
        <Card flush>
          <div className="table-wrap">
            <table className="tbl stackable es-tbl" data-testid="esign-table">
              <thead><tr><th>{t('esign.col.request')}</th><th>{t('esign.col.client')}</th><th>{t('esign.col.signers')}</th><th>{t('esign.col.waiting')}</th><th>{t('esign.col.dates')}</th><th><span className="sr">{t('esign.col.actions')}</span></th></tr></thead>
              <tbody>
                {rows.map((e) => {
                  const client = byId(data.clients, e.clientId); const wait = waitingOn(e);
                  return (
                    <tr key={e.id} className="click" data-status={e.status} onClick={(ev) => { if (!(ev.target as HTMLElement).closest('a,button')) go(`/esign/${e.id}`); }}>
                      <td className="t1"><A to={`/esign/${e.id}`} className="es-name">{e.title}</A><div className="row tight es-st"><EnvelopeStatus env={e} />{e.demo && e.status !== 'draft' && <span className="xs dim">{t('esign.sampleMark')}</span>}</div></td>
                      <td data-label={t('esign.col.client')}>{client ? <A to={`/clients/${client.id}`}>{client.name}</A> : <span className="dim">{t('esign.noClient')}</span>}</td>
                      <td data-label={t('esign.col.signers')}><Signers env={e} /></td>
                      <td data-label={t('esign.col.waiting')} className="small">{wait.length ? wait.map((s) => s.name).join(', ') : <span className="dim">{t('esign.nobody')}</span>}</td>
                      <td data-label={t('esign.col.dates')} className="small muted">
                        {e.sentAt ? <div>{t('esign.sentOn', { date: date(e.sentAt.slice(0, 10)) })}</div> : <div>{t('esign.createdOn', { date: date(e.created.slice(0, 10)) })}</div>}
                        {isOpenEnvelope(e) && e.expiresAt && <div>{t('esign.expiresOn', { date: date(e.expiresAt.slice(0, 10)) })}</div>}
                        {e.completedAt && <div>{t('esign.completedOn', { date: date(e.completedAt.slice(0, 10)) })}</div>}
                      </td>
                      <td data-label={t('esign.col.actions')}>
                        {mayAct && isOpenEnvelope(e) && <span className="row tight nowrap">
                          <Button size="sm" icon={<LuBellRing aria-hidden="true" />} onClick={() => doRemind(e)} data-testid="esign-remind">{t('esign.remind')}</Button>
                          <Button size="sm" variant="ghost" icon={<LuBan aria-hidden="true" />} onClick={() => void doVoid(e)} data-testid="esign-void">{t('esign.void')}</Button>
                        </span>}
                        {mayAct && e.status === 'draft' && <A to={`/esign/${e.id}`} className="btn sm">{t('esign.continue')}</A>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {picking && <PickDocument onClose={() => setPicking(false)} />}
    </>
  );
}

/** Starting a request: choose the document to send. */
function PickDocument({ onClose }: { onClose: () => void }) {
  const { t, data, user, perms } = useApp();
  const mine = visibleClientIds(data, user, perms);
  const docs = data.docs.filter((d) => d.status !== 'void' && d.kind !== 'invoice' && (!d.clientId || mine.has(d.clientId)) && !isOpenEnvelope(byId(data.envelopes, d.envelopeId) ?? ({ status: 'draft' } as Envelope)) && byId(data.envelopes, d.envelopeId)?.status !== 'completed');
  const [docId, setDocId] = useState(docs[0]?.id ?? '');
  const start = () => { const r = act(createEnvelope, docId); if (r.ok) { onClose(); go(`/esign/${r.data.id}`); } else toast(t('esign.err.' + r.reason), true); };
  return (
    <Modal title={t('esign.new')} onClose={onClose} size="narrow" labelClose={t('common.close')}
      footer={docs.length ? <><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={start} data-testid="esign-pick-go">{t('esign.pick.go')}</Button></> : <A to="/documents" className="btn primary">{t('esign.pick.toDocs')}</A>}>
      {docs.length ? (
        <Field label={t('esign.pick.doc')} hint={t('esign.pick.hint')}>
          <select value={docId} onChange={(e) => setDocId(e.target.value)} data-testid="esign-pick-doc">
            {docs.map((d) => <option key={d.id} value={d.id}>{[t('doc.kind.' + d.kind), d.number, byId(data.clients, d.clientId)?.name, d.title].filter(Boolean).join(' · ')}</option>)}
          </select>
        </Field>
      ) : <p className="muted">{t('esign.pick.none')}</p>}
    </Modal>
  );
}

/* ---------- one request ---------- */
function EnvelopePage({ id }: { id: string }) {
  const { t, data } = useApp();
  const all = useEnvelopes();
  const env = all.find((e) => e.id === id);
  if (!env) return <Empty title={t('esign.notFound')} action={<A to="/esign" className="btn">{t('esign.back')}</A>} />;
  const doc = byId(data.docs, env.docId);
  return (
    <>
      <BackLink to="/esign">{t('esign.back')}</BackLink>
      {env.status === 'draft' ? <Prepare env={env} doc={doc} /> : <Detail env={env} doc={doc} />}
    </>
  );
}

/** Loads the document a request is about, drawn as it stands now (a draft) or as it was sent. */
function useDrawn(env: EnvelopeX, doc: DocRecord | undefined) {
  const { data, pack, lang } = useApp();
  const [state, setState] = useState<{ doc?: DrawnDocument; problem?: DrawProblem; url?: string | null }>({});
  const stamp = doc ? `${doc.id}:${doc.updated}:${JSON.stringify(doc.edits ?? {})}:${doc.file?.name ?? ''}:${doc.file?.size ?? 0}` : '';
  useEffect(() => {
    let live = true; let url: string | null = null;
    if (!doc) { setState({ problem: 'no_document' }); return; }
    void drawDocument({ data, pack, lang: env.lang ?? lang }, doc).then((r) => {
      if (!live) return;
      if (!r.ok) { setState({ problem: r.reason }); return; }
      // an uploaded PDF has no drawing: the browser's own viewer shows it, from an address this page made for it
      if (!r.doc.view) url = URL.createObjectURL(new Blob([r.doc.bytes as BlobPart], { type: 'application/pdf' }));
      setState({ doc: r.doc, url });
    });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp, env.lang]);
  return state;
}

function Prepare({ env, doc }: { env: EnvelopeX; doc?: DocRecord }) {
  const { t, data, lang, can, live } = useApp();
  const drawn = useDrawn(env, doc);
  const viewer = useViewer();
  const [signers, setSigners] = useState(env.signers.map((s) => ({ id: s.id, name: s.name, email: s.email, role: s.role as string | undefined, userId: s.userId })));
  const [message, setMessage] = useState(env.message ?? '');
  const [busy, setBusy] = useState(false);
  const mayAct = can('write') && can('esign');
  const d = drawn.doc;
  const mode = pageMode(d?.view, drawn.url, viewer, d?.pages.length);

  // the first time a generated document is opened here, its signature lines get their boxes
  useEffect(() => {
    if (!d || env.fields.length || !d.anchors.length || !mayAct) return;
    const placed = autoPlace(d.anchors, env.signers, () => uid('fd'));
    if (placed.length) act(saveEnvelope, env.id, { fields: placed });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);

  const saveSigners = (next: typeof signers) => { setSigners(next); act(saveEnvelope, env.id, { signers: next }); };
  const setSigner = (i: number, p: Partial<(typeof signers)[number]>, save: boolean) => { const next = signers.map((s, k) => (k === i ? { ...s, ...p } : s)); if (save) saveSigners(next); else setSigners(next); };
  const move = (i: number, by: number) => { const next = [...signers]; const [x] = next.splice(i, 1); next.splice(i + by, 0, x); saveSigners(next); };
  const blockers = envelopeBlockers(data, env, d ? { hasPlaceholders: d.hasPlaceholders, source: d.file ?? { name: d.name, size: d.bytes.length, mime: 'application/pdf' } } : undefined);
  const [refused, setRefused] = useState<SendBlocker[]>([]);
  const own = blockers.filter((b) => b !== 'not_draft');
  const shown = own.length ? own : refused.filter((b) => b !== 'not_draft');
  // a company workspace prepares the draft; sending is the server's and is not built yet (prepare.ts)
  const pending = sendingPending();
  const send = async () => {
    if (!doc || !d) return;
    setBusy(true);
    const r = await sendDrawn(env.id, doc, d);
    setBusy(false);
    // what the server found missing is listed like the screen's own checks, so the person sees every reason at once
    setRefused(r.ok ? [] : (r.blockers ?? []).filter((b): b is SendBlocker => BLOCKERS.includes(b)));
    if (r.ok) toast(t(live ? 'esign.sent' : 'esign.sentSample'));
    else toast(t(BLOCKERS.includes(r.reason) ? 'esign.block.' + r.reason : failWord(r.reason, 'esign.err.send_failed')), true);
  };
  const check = async () => {
    if (!d) return;
    const bytes = await placementPreview(d.bytes, env.fields, (f) => `${t('esign.field.' + f.type)}: ${env.signers.find((s) => s.id === f.signerId)?.name ?? ''}`);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    // a browser that cannot open the PDF in a tab gets it as a download instead
    if (!window.open(url, '_blank', 'noopener')) saveFile(bytes, 'placement-check.pdf');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  const drop = async () => { if (await confirmDialog(t('esign.prep.deleteConfirm'), t('esign.prep.delete'), t('common.cancel'))) { act(deleteEnvelope, env.id); go(doc ? `/documents/${doc.id}` : '/esign'); } };
  const blockLink = (b: SendBlocker) => (b === 'template_unapproved' || b === 'consent_unapproved' ? <A to="/settings/documents" className="linkbtn">{t('esign.block.toSettings')}</A> : b === 'placeholders' && doc ? <A to={`/documents/${doc.id}`} className="linkbtn">{t('esign.block.toDoc')}</A> : null);

  return (
    <>
      <PageHeader title={<>{t('esign.prep.title')} <EnvelopeStatus env={env} /></>} sub={<>{env.title}{doc && <> · <A to={`/documents/${doc.id}`}>{t('esign.openDoc')}</A></>}</>}
        actions={mayAct ? <button type="button" className="linkbtn small neg" onClick={() => void drop()} data-testid="esign-draft-delete"><LuTrash2 aria-hidden="true" /> {t('esign.prep.delete')}</button> : undefined} />
      {!mayAct && <Note>{t('esign.readOnly')}</Note>}

      <Card title={t('esign.prep.signers')} className="es-section">
        <p className="small muted">{t('esign.prep.signersHint')}</p>
        <div className="es-signerlist" data-testid="esign-signers">
          {signers.map((s, i) => (
            <div key={s.id} className={cx('es-signer', `es-s${i % 6}`)}>
              <span className="es-num" aria-hidden="true">{i + 1}</span>
              <Field label={t('esign.prep.role')}>
                <select value={SIGNER_ROLES.includes(s.role as SignerRole) ? s.role : 'client'} disabled={!mayAct} onChange={(e) => setSigner(i, { role: e.target.value }, true)} data-testid="esign-signer-role">{SIGNER_ROLES.map((r) => <option key={r} value={r}>{roleLabel(r, lang)}</option>)}</select>
              </Field>
              <Field label={t('esign.prep.name')} error={s.name.trim().length < 2}><input value={s.name} disabled={!mayAct} onChange={(e) => setSigner(i, { name: e.target.value }, false)} onBlur={() => saveSigners(signers)} autoComplete="off" data-testid="esign-signer-name" /></Field>
              <Field label={t('esign.prep.email')} error={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email)}><input type="email" value={s.email} disabled={!mayAct} onChange={(e) => setSigner(i, { email: e.target.value }, false)} onBlur={() => saveSigners(signers)} autoComplete="off" data-testid="esign-signer-email" /></Field>
              {mayAct && <span className="row tight es-signer-act">
                <button type="button" className="iconbtn sm" aria-label={t('esign.prep.up')} title={t('esign.prep.up')} disabled={i === 0} onClick={() => move(i, -1)}><LuArrowUp aria-hidden="true" /></button>
                <button type="button" className="iconbtn sm" aria-label={t('esign.prep.down')} title={t('esign.prep.down')} disabled={i === signers.length - 1} onClick={() => move(i, 1)}><LuArrowDown aria-hidden="true" /></button>
                <button type="button" className="iconbtn sm" aria-label={t('esign.prep.remove')} title={t('esign.prep.remove')} disabled={signers.length < 2} onClick={() => saveSigners(signers.filter((_, k) => k !== i))} data-testid="esign-signer-remove"><LuTrash2 aria-hidden="true" /></button>
              </span>}
            </div>
          ))}
        </div>
        {mayAct && <div className="row es-gap">
          <Button size="sm" icon={<LuPlus aria-hidden="true" />} disabled={signers.length >= 6} onClick={() => saveSigners([...signers, { id: uid('sg'), name: '', email: '', role: signers.some((s) => s.role === 'client') ? 'co_owner' : 'client', userId: undefined }])} data-testid="esign-signer-add">{t('esign.prep.addSigner')}</Button>
        </div>}
        <div className="es-opts">
          <label className="check"><input type="checkbox" checked={env.ordered} disabled={!mayAct || signers.length < 2} onChange={(e) => act(saveEnvelope, env.id, { ordered: e.target.checked })} data-testid="esign-ordered" /><span>{t('esign.prep.ordered')}</span></label>
          <Field label={t('esign.prep.expiry')}><input type="number" min={1} max={120} value={env.expiryDays ?? 30} disabled={!mayAct} onChange={(e) => act(saveEnvelope, env.id, { expiryDays: Number(e.target.value) })} data-testid="esign-expiry" /></Field>
          <Field label={t('esign.prep.remindEvery')} hint={t('esign.prep.remindHint')}><input type="number" min={0} max={30} value={env.remindEvery ?? 0} disabled={!mayAct} onChange={(e) => act(saveEnvelope, env.id, { remindEvery: Number(e.target.value) })} data-testid="esign-remind-every" /></Field>
        </div>
        <Field label={t('esign.prep.message')}><textarea rows={2} value={message} maxLength={2000} disabled={!mayAct} onChange={(e) => setMessage(e.target.value)} onBlur={() => act(saveEnvelope, env.id, { message })} data-testid="esign-message" /></Field>
      </Card>

      <h2 className="es-h">{t('esign.prep.boxes')}</h2>
      {drawn.problem ? <Card><Note tone="bad">{t('esign.draw.' + drawn.problem)}</Note></Card>
        : !d ? <Card><p className="muted" role="status">{t('esign.prep.loading')}</p></Card>
        : mayAct ? <FieldEditor envelope={env} pages={d.pages} view={d.view} images={d.images} pdfUrl={drawn.url} mode={mode} anchors={d.anchors} onChange={(fields: SignField[]) => act(saveEnvelope, env.id, { fields })} />
        : <ReadPages env={env} pages={d.pages} view={d.view} images={d.images} url={drawn.url} />}

      <Card title={t('esign.prep.send')} className="es-section raised">
        {shown.length > 0 ? (
          <>
            <p className="small muted">{t('esign.block.title')}</p>
            <ul className="es-blockers" data-testid="esign-blockers">{shown.map((b) => <li key={b} data-blocker={b}>{t('esign.block.' + b)} {blockLink(b)}</li>)}</ul>
          </>
        ) : pending ? <div data-testid="esign-pending"><Note>{t('esign.prep.pendingLive')}</Note></div>
          : <p className="small muted" data-testid="esign-ready">{t(live ? 'esign.prep.readyLive' : 'esign.prep.readySample')}</p>}
        <div className="row es-gap">
          <CanWrite need="esign"><Button variant="primary" icon={<LuSend aria-hidden="true" />} disabled={busy || own.length > 0 || !d || pending} onClick={() => void send()} data-testid="esign-send">{t(busy ? 'esign.prep.sending' : 'esign.prep.sendNow')}</Button></CanWrite>
          {d && env.fields.length > 0 && <Button icon={<LuScanSearch aria-hidden="true" />} onClick={() => void check()} data-testid="esign-check">{t('esign.prep.check')}</Button>}
          {!live && <DemoTag />}
        </div>
        <p className="xs dim es-gap">{t('esign.prep.checkHint')}</p>
      </Card>
    </>
  );
}

/** The pages with the boxes on them, to look at. What a box holds is shown once it was filled. */
function ReadPages({ env, pages, view, images, url }: { env: EnvelopeX; pages: { w: number; h: number }[]; view?: EnvelopeX['view']; images?: Record<string, string>; url?: string | null }) {
  const { t } = useApp();
  const viewer = useViewer();
  const mode = pageMode(view, url, viewer, pages.length);
  return (
    <div className="es-pages es-read" data-testid="esign-pages">
      {mode !== 'drawn' && <Note>{t(mode === 'viewer' ? 'esign.pages.viewer' : 'esign.pages.blank')}</Note>}
      {pages.map((size, i) => (
        <PageSheet key={i} index={i} size={size} view={view?.[i]} images={images} pdfUrl={url} mode={mode} label={t('esign.pages.page', { n: i + 1, total: pages.length })} blankNote={t('esign.pages.blankSheet')}>
          {env.fields.filter((f) => f.page === i + 1).map((f) => <FieldBox key={f.id} f={{ ...f, mine: false, color: signerIndex(env, f.signerId) }} page={size} label="" value={f.value && f.type !== 'signature' && f.type !== 'initials' ? f.value : undefined} ink={fieldImage(env, f) ?? undefined} inkName={fieldInkName(env, f) ?? undefined} />)}
        </PageSheet>
      ))}
    </div>
  );
}

function Detail({ env, doc }: { env: EnvelopeX; doc?: DocRecord }) {
  const { t, data, lang, can, live, dateTime } = useApp();
  const mayAct = can('write') && can('esign');
  const open = isOpenEnvelope(env);
  const client = byId(data.clients, env.clientId);
  const [url, setUrl] = useState<string | null>(null);
  const [copy, setCopy] = useState<'idle' | 'working' | 'failed'>('idle');
  const now = new Date().toISOString();
  const late = isExpired(env, now);

  // a request that came with the sample business gets its document the first time it is opened
  useEffect(() => { if (!env.source) void ensureSource(env.id); }, [env.id, env.source]);
  // an uploaded PDF is shown by the browser's viewer, from the file exactly as it was sent
  useEffect(() => {
    if (env.view?.length || !env.source) return;
    let live2 = true; let made: string | null = null;
    void objectUrl(env.source).then((u) => { if (live2) { made = u; setUrl(u); } else if (u) URL.revokeObjectURL(u); });
    return () => { live2 = false; if (made) URL.revokeObjectURL(made); };
  }, [env.source, env.view]);
  // sample: the signed copy is made in this browser the first time the completed request is opened
  useEffect(() => {
    if (env.status !== 'completed' || env.signedFile || live) return;
    setCopy('working');
    void finishEnvelope(env.id).then((r) => setCopy(r === 'failed' ? 'failed' : 'idle'));
  }, [env.id, env.status, env.signedFile, live]);

  const doRemind = () => { void remindRequest(env.id).then((r) => toast(r.ok ? t(live ? 'esign.reminded' : 'esign.remindedSample', { n: r.data.reminded }) : t(failWord(r.reason, 'esign.err.not_open')), !r.ok)); };
  const doVoid = async () => { if (await confirmDialog(t('esign.voidConfirm'), t('esign.void'), t('common.cancel'))) { act(voidEnvelope, env.id); toast(t('esign.voided')); } };
  const again = () => { if (!doc) return; const r = act(createEnvelope, doc.id, { signers: env.signers.map((s) => ({ id: uid('sg'), name: s.name, email: s.email, role: s.role, userId: s.userId })), ordered: env.ordered, message: env.message }); if (r.ok) go(`/esign/${r.data.id}`); else toast(t('esign.err.' + r.reason), true); };
  const who = (id?: string) => env.signers.find((s) => s.id === id)?.name ?? '';
  const pages = pageSizes(env.pages, env.view);

  return (
    <>
      <PageHeader title={<>{env.title} <EnvelopeStatus env={env} />{env.demo && <> <DemoTag /></>}</>}
        sub={<>{client && <><A to={`/clients/${client.id}`}>{client.name}</A> · </>}{doc && <A to={`/documents/${doc.id}`}>{t('esign.openDoc')}</A>}</>} />
      {env.demo && <Note>{t('esign.detail.sample')}</Note>}
      {late && <div className="es-gap"><Note tone="warn">{t('esign.detail.late')}</Note></div>}

      <div className="es-detail">
        <div className="stack">
          <Card title={t('esign.detail.signers')}>
            <ol className="es-signers-full" data-testid="esign-detail-signers">
              {[...env.signers].sort((a, b) => a.order - b.order).map((s) => (
                <li key={s.id} className={`es-s${signerIndex(env, s.id) % 6}`} data-status={s.status}>
                  <span className="es-num" aria-hidden="true">{env.ordered ? s.order : ''}</span>
                  <div className="grow">
                    <div className="row tight"><b>{s.name}</b><Badge tone={SIGNER_TONE[s.status]}>{t('esign.signer.' + s.status)}</Badge></div>
                    <div className="small muted">{s.email}{s.role ? ` · ${roleLabel(s.role, lang)}` : ''}</div>
                    <div className="xs dim">
                      {s.sentAt && <span>{t('esign.detail.linkAt', { at: dateTime(s.sentAt) })} </span>}
                      {s.viewedAt && <span>· {t('esign.detail.viewedAt', { at: dateTime(s.viewedAt) })} </span>}
                      {s.signedAt && <span>· {t('esign.detail.signedAt', { at: dateTime(s.signedAt) })}</span>}
                      {s.declinedAt && <span>· {t('esign.detail.declinedAt', { at: dateTime(s.declinedAt) })}{s.declineReason ? `: ${s.declineReason}` : ''}</span>}
                    </div>
                  </div>
                  {!live && mayAct && !cannotSign(env, s.id, now) && <A to={`/esign/${env.id}/sign/${s.id}`} className="btn sm primary" data-testid="esign-open-signer"><LuPenLine aria-hidden="true" />{t('esign.detail.openSigner')}</A>}
                </li>
              ))}
            </ol>
            {open && <p className="small muted es-gap" data-testid="esign-waiting">{t('esign.detail.waiting', { names: waitingOn(env).map((s) => s.name).join(', ') })}</p>}
            {!live && open && <p className="xs dim">{t('esign.detail.signerHint')}</p>}
            {live && open && <p className="xs dim">{t('esign.detail.liveHint')}</p>}
          </Card>

          <Card title={t('esign.detail.pages')}>
            {pages.length ? <ReadPages env={env} pages={pages} view={env.view} images={env.images} url={url} /> : <p className="muted small">{t('esign.detail.noPages')}</p>}
          </Card>
        </div>

        <aside className="stack">
          <Card title={t('esign.detail.actions')} className={open ? 'raised' : undefined}>
            <div className="stack tight">
              {open && mayAct && <Button icon={<LuBellRing aria-hidden="true" />} onClick={doRemind} data-testid="esign-remind">{t('esign.remind')}</Button>}
              {open && mayAct && <Button variant="danger" icon={<LuBan aria-hidden="true" />} onClick={() => void doVoid()} data-testid="esign-void">{t('esign.void')}</Button>}
              {env.status === 'completed' && (env.signedFile
                ? <Button variant="primary" icon={<LuDownload aria-hidden="true" />} onClick={() => void downloadFile(env.signedFile)} data-testid="esign-download-signed">{t('esign.detail.signedCopy')}</Button>
                : <p className="small muted" role="status" data-testid="esign-copy-state">{t(copy === 'failed' ? 'esign.detail.copyFailed' : live ? 'esign.detail.copyLive' : 'esign.detail.copyWorking')}</p>)}
              {env.source && <Button icon={<LuDownload aria-hidden="true" />} onClick={() => void downloadFile(env.source)} data-testid="esign-download-original">{t('esign.detail.original')}</Button>}
              {env.signedFile && <Button variant="ghost" icon={<LuExternalLink aria-hidden="true" />} onClick={() => void openFile(env.signedFile)}>{t('esign.detail.openSigned')}</Button>}
              {!open && env.status !== 'completed' && mayAct && doc && doc.status !== 'void' && <Button icon={<LuFilePen aria-hidden="true" />} onClick={again} data-testid="esign-again">{t('esign.detail.again')}</Button>}
            </div>
          </Card>

          <Card title={t('esign.detail.facts')}>
            <dl className="kv">
              <dt>{t('esign.detail.id')}</dt><dd className="es-mono">{env.id}</dd>
              <dt>{t('esign.detail.sentBy')}</dt><dd>{byId(data.users, env.createdBy)?.name ?? ''}</dd>
              {env.sentAt && <><dt>{t('esign.detail.sent')}</dt><dd>{dateTime(env.sentAt)}</dd></>}
              {open && env.expiresAt && <><dt>{t('esign.detail.expires')}</dt><dd>{dateTime(env.expiresAt)}</dd></>}
              {env.completedAt && <><dt>{t('esign.detail.completed')}</dt><dd>{dateTime(env.completedAt)}</dd></>}
              <dt>{t('esign.detail.order')}</dt><dd>{t(env.ordered && env.signers.length > 1 ? 'esign.detail.inOrder' : 'esign.detail.anyOrder')}</dd>
              <dt>{t('esign.detail.reminders')}</dt><dd>{env.remindEvery ? t('esign.detail.everyDays', { n: env.remindEvery }) : t('esign.detail.remindOff')}</dd>
            </dl>
            {env.message && <blockquote className="es-msg es-gap">{env.message}</blockquote>}
            {env.voidReason && <p className="small es-gap">{t('esign.detail.voidReason')}: {env.voidReason}</p>}
          </Card>

          {env.hashes && (
            <Card title={t('esign.detail.prints')}>
              <dl className="es-hashes" data-testid="esign-hashes">
                <dt>{t('esign.detail.hashOriginal')}</dt><dd className="es-mono">{env.hashes.original}</dd>
                {env.hashes.signed && <><dt>{t('esign.detail.hashSigned')}</dt><dd className="es-mono">{env.hashes.signed}</dd></>}
                {env.hashes.final && <><dt>{t('esign.detail.hashFinal')}</dt><dd className="es-mono">{env.hashes.final}</dd></>}
              </dl>
              <p className="xs dim es-gap">{t('esign.detail.printsHint')}</p>
            </Card>
          )}

          <Card title={t('esign.detail.trail')}>
            <ol className="timeline" data-testid="esign-trail">
              {[...env.events].reverse().map((ev, i) => (
                <li key={i} className={ev.note === 'auto' ? 'auto' : undefined}>
                  <span>{t('esign.ev.' + ev.kind, { name: who(ev.signerId) })}{ev.kind === 'reminded' && ev.note === 'auto' ? ` (${t('esign.ev.auto')})` : ''}{ev.note && ev.kind !== 'signed_copy' && ev.note !== 'auto' ? `: ${ev.note}` : ''}</span>
                  <time title={utcStamp(ev.at)}>{dateTime(ev.at)}</time>
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>
    </>
  );
}

/* ---------- the signer's page, inside the app (sample workspaces) ---------- */
function SampleSigner({ id, signerId }: { id: string; signerId: string }) {
  const { t, data, pack, live, can } = useApp();
  const all = useEnvelopes();
  const env = all.find((e) => e.id === id);
  const back = <BackLink to={`/esign/${id}`}>{t('esign.sign.backToRequest')}</BackLink>;
  const adapter = useMemo((): SigningAdapter => {
    const cur = () => (getSnapshot().data.envelopes as EnvelopeX[]).find((e) => e.id === id);
    let url: string | null = null;
    return {
      async load() {
        await ensureSource(id);
        const e = cur(); if (!e) return null;
        if (!e.view?.length && e.source) url = await objectUrl(e.source);
        return signerView(e, signerId, { company: data.company.name, now: new Date().toISOString(), fileUrl: url ?? undefined });
      },
      async opened() { act(viewEnvelope, id, signerId); },
      async submit(p) {
        const r = act(signEnvelope, id, signerId, p);
        if (!r.ok) return { ok: false, reason: r.reason, fields: r.fields };
        // the last signature completes the request: the signed copy is made right away
        if (r.data.completed) void finishEnvelope(id);
        return { ok: true, completed: r.data.completed };
      },
      async decline(reason) { return { ok: act(declineEnvelope, id, signerId, reason).ok }; },
      openDocument: () => openFile(cur()?.source),
      signedCopy: async () => { await finishEnvelope(id); return downloadFile(cur()?.signedFile); },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, signerId]);

  if (!env) return <Empty title={t('esign.notFound')} action={<A to="/esign" className="btn">{t('esign.back')}</A>} />;
  // a live workspace sends each signer a private link; this inside view exists for sample records only
  if (live) return <>{back}<PageHeader title={env.title} /><Card><Note>{t('esign.sign.liveOnly')}</Note></Card></>;
  if (!can('write') || !can('esign')) return <>{back}<PageHeader title={env.title} /><Card><Note>{t('esign.readOnly')}</Note></Card></>;
  return (
    <>
      <div className="no-print">{back}</div>
      <Note>{t('esign.sign.sampleFrame', { name: env.signers.find((s) => s.id === signerId)?.name ?? '' })}</Note>
      <div className="es-signframe"><SigningFlow adapter={adapter} wording={(l) => makeT(l ?? env.lang ?? 'en', pack, data.config)} sample exit={{ label: t('esign.sign.backToRequest'), go: () => go(`/esign/${id}`) }} /></div>
    </>
  );
}
