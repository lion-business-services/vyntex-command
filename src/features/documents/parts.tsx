// The pieces a document page is built from: the paper itself (screen and print), the payment card of an invoice, the
// one-signer demo signature of the field editions with its signing page, and the email card.
import { useEffect, useRef, useState } from 'react';
import { LuEraser, LuMail, LuPenLine, LuSend, LuSignature, LuType } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { act } from '@/store/store';
import { Badge, Button, Card, Field, Modal, Note, cx, toast } from '@/ui';
import { DemoTag, PlanBadge, CanWrite } from '@/app/shared';
import { advanceSignature, sendForSignature, setDocStatus } from '@/domain/actions';
import { jobMoney } from '@/domain/selectors';
import type { Client, DocRecord, Job, Lang } from '@/domain/types';
import { makeT } from '@/i18n';
import { planName } from '@/lib/pricing';
import { money2 } from '@/lib/money';
import { splitPlaceholders } from '@/domain/esign/merge';
import { greetName } from '@/features/messages/templates';
import { prepareDocEmail, recordSignature } from './actions';
import type { DocModel, TextBlock } from './model';
import { SuccessCheck, useBecame } from './success';

const isEmail = (s: string) => /^\S+@\S+\.\S+$/.test(s.trim());

/* ---------- the paper: screen and print ---------- */
function plainPaste(e: React.ClipboardEvent<HTMLElement>) {
  e.preventDefault();
  const text = e.clipboardData.getData('text/plain');
  if (text) document.execCommand('insertText', false, text);
}

export function Paper({ model, editing, label, paperRef }: { model: DocModel; editing?: boolean; label: string; paperRef?: React.RefObject<HTMLDivElement | null> }) {
  const edit = (b: TextBlock) => (editing && !b.locked
    ? { 'data-key': b.key, contentEditable: true, suppressContentEditableWarning: true, spellCheck: true, role: 'textbox', 'aria-multiline': true, 'aria-label': b.base.slice(0, 60), onPaste: plainPaste }
    : { 'data-key': b.key });
  // a bracketed part (wording nobody wrote yet, a value that is missing) is marked, so it cannot be overlooked;
  // while editing, the text is plain so it can be typed over
  const shown = (b: TextBlock) => (editing && !b.locked ? b.text : splitPlaceholders(b.text).map((x, i) => (x.ph ? <mark key={i} className="docs-ph">{x.s}</mark> : x.s)));
  const line = (b: TextBlock) => (b.style === 'h'
    ? <h4 key={b.key} {...edit(b)}>{shown(b)}</h4>
    : <p key={b.key} className={b.style === 'strong' ? 'strong' : b.style === 'small' ? 'small' : b.style === 'list' ? 'docs-list' : undefined} {...edit(b)}>{shown(b)}</p>);
  return (
    <article className="paper docs-paper" lang={model.lang} aria-label={label} ref={paperRef}>
      <div className="docs-head">
        <div className="docs-co">
          {model.company.logo && <img src={model.company.logo} alt="" />}
          <div><b>{model.company.name}</b>{model.company.lines.map((l, i) => <span key={i}>{l}</span>)}</div>
        </div>
        <div className="docs-headr"><h2 {...edit(model.title)}>{shown(model.title)}</h2>{model.meta.map((l, i) => <span key={i}>{l}</span>)}</div>
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
              <div className="docs-sig" key={p.signer} data-signed={p.signed ? 'yes' : undefined}>
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

/* ---------- invoice: balance and payment ---------- */
export function PayCard({ job, onPay }: { job: Job; onPay?: () => void }) {
  const { t, data } = useApp();
  const m = jobMoney(data, job);
  const paid = m.price > 0 && m.clientOwes <= 0.005;
  const justPaid = useBecame(paid);
  const due = !!onPay && !paid && m.clientOwes > 0.005;
  return (
    <Card className={due ? 'raised' : undefined} title={t('docs.pay.title')} actions={paid ? <Badge tone="ok"><SuccessCheck draw={justPaid} size={13} />{t('docs.pay.paid')}</Badge> : undefined}>
      {onPay && (
        <dl className="docs-figs">
          <dt>{t('docs.pay.price')}</dt><dd>{money2(m.price)}</dd>
          <dt>{t('docs.pay.received')}</dt><dd>{money2(m.received)}</dd>
          <dt className="tot">{t('docs.pay.balance')}</dt><dd className="tot">{money2(m.clientOwes)}</dd>
        </dl>
      )}
      {due && <CanWrite><Button variant="primary" onClick={onPay} data-testid="docs-pay">{t('docs.pay.record')}</Button></CanWrite>}
      <p className="xs dim" style={{ marginTop: onPay ? 10 : 0 }}>{t('docs.pay.auto')}</p>
    </Card>
  );
}

/* ---------- e-signature (demo simulation) ---------- */
export function ESignCard({ doc, client, onOpen }: { doc: DocRecord; client?: Client; onOpen: () => void }) {
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
  const justSigned = useBecame(es?.status === 'signed');
  return (
    <Card className={es?.status === 'signed' ? undefined : 'raised'} title={<><LuSignature aria-hidden="true" />{t('docs.esign.title')}</>} actions={<><PlanBadge feature="esignature" /><DemoTag /></>}>
      <p className="small muted">{t('docs.esign.intro')}</p>
      {!es || again ? (
        <div className="stack tight" style={{ marginTop: 12 }}>
          <Field label={t('docs.esign.signerName')} error={err && !name.trim()}><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" data-testid="docs-send-name" /></Field>
          <Field label={t('docs.esign.signerEmail')} error={err && !isEmail(email)}><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" data-testid="docs-send-email" /></Field>
          {err && <p className="small neg" role="alert">{t('docs.esign.needSigner')}</p>}
          <div className="row">
            <CanWrite><Button variant="primary" icon={<LuSend />} onClick={send} data-testid="docs-send">{t('docs.esign.send')}</Button></CanWrite>
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
            ? <p className="small docs-signed" data-testid="docs-signed"><SuccessCheck draw={justSigned} /><span>{t('docs.esign.signedNote')}</span></p>
            : <CanWrite><Button variant="primary" block icon={<LuPenLine />} onClick={onOpen} data-testid="docs-sign-open" style={{ whiteSpace: 'normal' }}>{t('docs.esign.openSign')}</Button></CanWrite>}
          <div style={{ marginTop: 10 }}><button type="button" className="linkbtn small" onClick={() => setAgain(true)} data-testid="docs-send-again">{t('docs.esign.again')}</button></div>
        </>
      )}
      <p className="xs dim" style={{ marginTop: 12 }}>{t('docs.esign.preview')}</p>
    </Card>
  );
}

/** What the client would see: the document, a consent tick, the typed name and a signature drawn with the mouse or a finger. */
export function SigningModal({ doc, model, onClose }: { doc: DocRecord; model: DocModel; onClose: () => void }) {
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
export function MailCard({ doc, job, client, docLang }: { doc: DocRecord; job: Job; client?: Client; docLang: Lang }) {
  const { t, data, pack, lang, standing, priced } = useApp();
  const st = standing('emailDocs');
  const waiting = data.messages.find((m) => m.status === 'draft' && m.ref.type === 'job' && m.ref.id === job.id && m.subject.includes(doc.number));
  const prepare = () => {
    const dt = makeT(docLang, pack);
    const m = jobMoney(data, job);
    const p = { number: doc.number, jobName: job.name, company: data.company.name, name: greetName(client?.name ?? ''), kind: dt('doc.kind.' + doc.kind), amount: money2(doc.kind === 'invoice' ? m.clientOwes : m.price) };
    const middle = doc.kind === 'invoice' ? (m.price > 0 && m.clientOwes <= 0.005 ? 'docs.mail.invoicePaid' : 'docs.mail.invoice') : doc.kind === 'contract' ? 'docs.mail.contract' : doc.kind === 'estimate' ? 'docs.mail.estimate' : 'docs.mail.other';
    const body = [dt('docs.mail.hello', p), '', dt(middle, p), '', dt('docs.mail.bye'), data.company.name, data.company.phone].join('\n');
    act(prepareDocEmail, doc.id, { to: client?.email ?? '', subject: dt('docs.mail.subject', p), body });
    toast(t('docs.mail.done'));
  };
  return (
    <Card title={t('docs.mail.title')} actions={<PlanBadge feature="emailDocs" detail />}>
      {st.state === 'upgrade' && st.plan && <p className="small muted" style={{ marginBottom: 10 }}>{t('ent.upgradeHint', { plan: planName(st.plan, lang) })}</p>}
      <div className="row"><CanWrite><Button icon={<LuMail />} onClick={prepare} data-testid="docs-email">{t('docs.mail.button')}</Button></CanWrite><DemoTag /></div>
      <p className="xs dim" style={{ marginTop: 10 }}>{t(priced ? 'docs.mail.note' : 'docs.mail.noteNoPlan')}</p>
      {waiting && <p className="small" style={{ marginTop: 10 }} data-testid="docs-email-waiting">{t('docs.mail.waiting')} <A to={`/messages?open=${waiting.id}`} className="linkbtn">{t('docs.mail.open')}</A></p>}
      {doc.status === 'draft' && (
        <div style={{ borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 12 }}>
          <p className="small muted" style={{ marginBottom: 8 }}>{t('docs.markSentHint')}</p>
          <CanWrite><Button size="sm" onClick={() => { act(setDocStatus, doc.id, 'sent'); toast(t('docs.markedSent')); }} data-testid="docs-mark-sent">{t('docs.markSent')}</Button></CanWrite>
        </div>
      )}
    </Card>
  );
}
