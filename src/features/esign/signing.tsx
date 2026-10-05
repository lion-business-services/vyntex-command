// The signer's page: agree to sign electronically, fill each box in order, review, finish. Or decline, with a reason.
// The same component serves the sample page inside the app and the public page a signer opens from their link; what
// differs is the adapter that loads the request and sends the answer (the sample workspace, or the server).
// Every box is filled on the document itself and also listed beside it as an ordinary form control, so the page works
// with a keyboard, a screen reader and a phone.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { LuArrowLeft, LuArrowRight, LuCheck, LuDownload, LuExternalLink, LuPenLine, LuSignature } from 'react-icons/lu';
import { Badge, Button, Card, Field, Modal, Note, cx } from '@/ui';
import type { TFn } from '@/i18n';
import type { Lang } from '@/domain/types';
import type { SignPayload, SignerView } from '@/domain/esign/types';
import { missingRequired, signDate } from '@/domain/esign/envelope';
import { roleLabel } from '@/domain/esign/certificate';
import { hasPlaceholder } from '@/domain/esign/merge';
import { SuccessCheck } from '@/features/documents/success';
import { PageSheet, pageMode, pageSizes, useViewer } from './pages';
import { SignaturePad } from './pad';

export type SubmitResult = { ok: true; completed: boolean } | { ok: false; reason: string; fields?: string[] };
/** How the page reaches the request: the sample workspace in this browser, or the server behind a private link. */
export interface SigningAdapter {
  load(): Promise<SignerView | null>;
  /** The signer opened the page. Recorded once. */
  opened(): Promise<void>;
  submit(p: SignPayload): Promise<SubmitResult>;
  decline(reason: string): Promise<{ ok: boolean }>;
  /** Opens the document as it was sent in a new tab, when that is possible. */
  openDocument?(): Promise<boolean>;
  /** Downloads the signed copy, once the request is complete. */
  signedCopy?(): Promise<boolean>;
}
type FieldView = SignerView['fields'][number];

/** One box on the page, showing what is in it. `onPick` makes it a button that jumps to its control. */
export function FieldBox({ f, page, value, ink, inkName, active, todo, onPick, label }: { f: FieldView; page: { w: number; h: number }; value?: string; ink?: string; /** Written in the box when a signature has no image. */ inkName?: string; active?: boolean; todo?: boolean; onPick?: () => void; label: string }) {
  // text is sized from the height of the box, in units of the page width, so it scales with the page
  const style = { left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%`, fontSize: `${Math.min(1.9, 0.7 * f.h * (page.h / page.w) * 100)}cqw` };
  const body = ink ? <img src={ink} alt="" /> : inkName ? <span className="es-inkname">{inkName}</span> : f.type === 'checkbox' ? (value === 'yes' ? <LuCheck aria-hidden="true" /> : null) : value ? <span>{value}</span> : null;
  const cls = cx('es-box', `es-s${f.color % 6}`, `es-t-${f.type}`, f.mine && 'mine', active && 'on', todo && 'todo', !!(ink || inkName || value) && 'filled');
  return onPick
    ? <button type="button" className={cls} style={style} onClick={onPick} aria-label={label} data-field={f.id}>{body}</button>
    : <div className={cls} style={style} data-field={f.id}>{body}</div>;
}

export function SigningFlow({ adapter, wording, sample, exit }: {
  adapter: SigningAdapter;
  /** Wording for the page: the language of the request once it is loaded, the visitor's until then. */
  wording: (lang: Lang | undefined) => TFn;
  /** True for the sample page inside the app. */
  sample?: boolean; exit?: { label: string; go: () => void };
}) {
  const [view, setView] = useState<SignerView | null | undefined>(undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const t = useMemo(() => wording(view?.lang), [view?.lang]);
  const [step, setStep] = useState<'agree' | 'fill' | 'review'>('agree');
  const [consent, setConsent] = useState(false);
  const [name, setName] = useState('');
  const [signature, setSignature] = useState('');
  const [initials, setInitials] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [pad, setPad] = useState<null | 'signature' | 'initials'>(null);
  const [active, setActive] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<null | 'signed' | 'completed' | 'declined'>(null);
  const viewer = useViewer();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void adapter.load().then((v) => { if (!live) return; setView(v); if (v) { setName(v.signer.name); if (v.state === 'open') void adapter.opened(); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mine = useMemo(() => (view?.fields ?? []).filter((f) => f.mine), [view]);
  const payload: SignPayload = { consent, typedName: name, signature, initials: initials || undefined, values };
  const missing = view ? missingRequired({ fields: mine }, view.signerId, payload).map((f) => f.id) : [];
  const required = mine.filter((f) => f.required && f.type !== 'date');
  const sizes = pageSizes(view?.pages, view?.view);
  const mode = pageMode(view?.view, view?.fileUrl, viewer, sizes.length);
  const today = signDate(new Date().toISOString(), view?.lang);

  if (view === undefined) return <Card><p className="muted" role="status">{t('esign.sign.loading')}</p></Card>;
  if (view === null) return <div data-testid="esign-sign-state" data-state="invalid"><Card><h2>{t('esign.sign.invalidTitle')}</h2><p className="muted">{t('esign.sign.invalid')}</p></Card></div>;

  const valueOf = (f: FieldView): string | undefined => (!f.mine ? f.value && f.type !== 'signature' && f.type !== 'initials' ? f.value : undefined : f.type === 'date' ? today : f.type === 'checkbox' ? values[f.id] : f.type === 'text' ? values[f.id] : undefined);
  const inkOf = (f: FieldView): string | undefined => (!f.mine ? f.ink : f.type === 'signature' ? signature || undefined : f.type === 'initials' ? initials || undefined : undefined);
  const fieldName = (f: FieldView, n: number) => `${n}. ${f.label || t('esign.field.' + f.type)}`;
  const focusControl = (id: string) => { setActive(id); const el = panel.current?.querySelector<HTMLElement>(`[data-control="${id}"]`); el?.focus(); el?.scrollIntoView({ block: 'nearest' }); };
  const showBox = (id: string) => { setActive(id); document.querySelector(`.es-box[data-field="${id}"]`)?.scrollIntoView({ block: 'nearest' }); };
  const next = () => { const id = missing[0]; if (id) focusControl(id); };

  const people = (
    <ul className="es-people" aria-label={t('esign.sign.people')}>
      {view.people.map((p, i) => (
        <li key={i} className={p.me ? 'me' : undefined}>
          <span className="es-num">{view.ordered ? i + 1 : ''}</span>
          <span className="grow"><b>{p.name}</b>{p.me && <span className="muted"> ({t('esign.sign.you')})</span>}{p.role && <span className="xs dim"> · {roleLabel(p.role, view.lang)}</span>}</span>
          <Badge tone={p.status === 'signed' ? 'ok' : p.status === 'declined' ? 'bad' : p.status === 'waiting' ? 'neutral' : 'info'}>{t('esign.signer.' + p.status)}</Badge>
        </li>
      ))}
    </ul>
  );
  const head = (
    <header className="es-sign-head">
      <p className="small muted">{t('esign.sign.from', { company: view.company })}</p>
      <h1 data-testid="esign-sign-title">{view.title}</h1>
      {(sample || view.demo) && <Note>{t('esign.sign.sampleNote')}</Note>}
    </header>
  );
  const pages = (pick: boolean) => (
    <div className="es-pages" data-testid="esign-sign-pages">
      {mode !== 'drawn' && <Note>{t(mode === 'viewer' ? 'esign.pages.viewer' : 'esign.pages.blank')}{adapter.openDocument && <> <button type="button" className="linkbtn" onClick={() => void adapter.openDocument!()}><LuExternalLink aria-hidden="true" /> {t('esign.pages.open')}</button></>}</Note>}
      {sizes.map((size, i) => (
        <PageSheet key={i} index={i} size={size} view={view.view?.[i]} images={view.images} pdfUrl={view.fileUrl} mode={mode} label={t('esign.pages.page', { n: i + 1, total: sizes.length })} blankNote={t('esign.pages.blankSheet')}>
          {view.fields.filter((f) => f.page === i + 1).map((f) => {
            const n = mine.indexOf(f) + 1;
            return <FieldBox key={f.id} f={f} page={size} value={valueOf(f)} ink={inkOf(f)} inkName={f.mine ? undefined : f.inkName} active={active === f.id} todo={f.mine && missing.includes(f.id)} label={f.mine ? fieldName(f, n) : ''} onPick={pick && f.mine ? () => focusControl(f.id) : undefined} />;
          })}
        </PageSheet>
      ))}
    </div>
  );

  /* ---------- states where there is nothing to sign ---------- */
  const final = done ?? (view.state !== 'open' ? view.state : null);
  if (final) {
    const good = final === 'signed' || final === 'completed';
    return (
      <div className="es-sign" lang={view.lang}>
        {head}
        <div data-testid="esign-sign-state" data-state={final}><Card className="es-final">
          <h2>{good && <SuccessCheck draw={!!done} size={22} />}{t('esign.sign.state.' + final)}</h2>
          <p className="muted">{t('esign.sign.stateNote.' + final)}</p>
          {(sample || view.demo) && good && <p className="small dim">{t('esign.sign.sampleDone')}</p>}
          {people}
          <div className="row">
            {final === 'completed' && adapter.signedCopy && <Button icon={<LuDownload aria-hidden="true" />} onClick={() => void adapter.signedCopy!()} data-testid="esign-sign-copy">{t('esign.sign.signedCopy')}</Button>}
            {exit && <Button variant="primary" onClick={exit.go} data-testid="esign-sign-exit">{exit.label}</Button>}
          </div>
        </Card></div>
      </div>
    );
  }

  /** After an answer went through, the list of signers is read again so it shows who is next. */
  const refresh = async () => { const v = await adapter.load(); if (v) setView(v); };
  const send = async () => {
    setBusy(true); setErr('');
    const r = await adapter.submit(payload);
    setBusy(false);
    if (r.ok) { setDone(r.completed ? 'completed' : 'signed'); window.scrollTo(0, 0); void refresh(); return; }
    setErr(t(r.reason === 'missing_fields' ? 'esign.sign.err.missing' : r.reason === 'expired' ? 'esign.sign.stateNote.expired' : r.reason === 'not_open' || r.reason === 'not_your_turn' ? 'esign.sign.err.closed' : 'esign.sign.err.other'));
    if (r.reason === 'missing_fields') setStep('fill');
  };
  const refuse = async () => {
    setBusy(true);
    const r = await adapter.decline(reason);
    setBusy(false); setDeclining(false);
    if (r.ok) { setDone('declined'); window.scrollTo(0, 0); void refresh(); } else setErr(t('esign.sign.err.other'));
  };
  const steps: ['agree' | 'fill' | 'review', string][] = [['agree', t('esign.sign.step.agree')], ['fill', t('esign.sign.step.fill')], ['review', t('esign.sign.step.review')]];
  const consentMissing = !view.consentText.trim() || hasPlaceholder(view.consentText);

  return (
    <div className="es-sign" lang={view.lang} data-testid="esign-sign" data-step={step}>
      {head}
      <ol className="es-steps" aria-label={t('esign.sign.steps')}>
        {steps.map(([id, label], i) => <li key={id} aria-current={step === id ? 'step' : undefined} className={steps.findIndex((s) => s[0] === step) > i ? 'done' : undefined}><span>{i + 1}</span>{label}</li>)}
      </ol>

      {step === 'agree' && (
        <Card className="raised">
          {view.message && <blockquote className="es-msg">{view.message}</blockquote>}
          <h2>{t('esign.sign.whoSigns')}</h2>
          {people}
          <h2 className="es-gap">{t('esign.sign.consentTitle')}</h2>
          {consentMissing && <Note tone="warn">{t('esign.sign.consentMissing')}</Note>}
          <label className="check es-consent"><input type="checkbox" checked={consent} onChange={(e) => { setConsent(e.target.checked); setErr(''); }} data-testid="esign-sign-consent" /><span>{view.consentText || t('esign.sign.consentPlaceholder')}</span></label>
          <p className="xs dim">{t('esign.sign.consentRecord')}</p>
          {err && <p className="small neg" role="alert" data-testid="esign-sign-error">{err}</p>}
          <div className="row between es-gap">
            <button type="button" className="linkbtn small" onClick={() => setDeclining(true)} data-testid="esign-sign-decline">{t('esign.sign.decline')}</button>
            <Button variant="primary" onClick={() => { if (!consent) { setErr(t('esign.sign.err.consent')); return; } setErr(''); setStep('fill'); window.scrollTo(0, 0); }} data-testid="esign-sign-continue">{t('esign.sign.continue')}<LuArrowRight aria-hidden="true" /></Button>
          </div>
        </Card>
      )}

      {step === 'fill' && (
        <div className="es-fill">
          <div className="es-panel" ref={panel}>
            <Card className="raised" title={t('esign.sign.yourBoxes')} actions={<span className="small muted" data-testid="esign-sign-progress">{t('esign.sign.progress', { done: required.length - missing.length, total: required.length })}</span>}>
              <div className="stack tight">
                <Field label={t('esign.sign.fullName')} error={!!err && name.trim().length < 2}><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" data-testid="esign-sign-name" /></Field>
                {mine.map((f, i) => {
                  const lab = <>{fieldName(f, i + 1)}{f.required ? <span aria-hidden="true"> *</span> : <span className="xs dim"> ({t('esign.sign.optional')})</span>}</>;
                  // a control that is clicked only lights its box up: scrolling the page under the pointer would lose the click.
                  // A text box also brings its place on the page into view, so the signer sees where they are typing.
                  const on = () => setActive(f.id);
                  if (f.type === 'signature' || f.type === 'initials') {
                    const img = f.type === 'signature' ? signature : initials;
                    return (
                      <div className={cx('field', active === f.id && 'on')} key={f.id}>
                        <span className="label">{lab}</span>
                        <div className="row">
                          {img && <span className="es-inkprev"><img src={img} alt={t(f.type === 'signature' ? 'esign.sign.yourSignature' : 'esign.sign.yourInitials')} /></span>}
                          <Button size="sm" variant={img ? 'default' : 'primary'} icon={<LuPenLine aria-hidden="true" />} onFocus={on} onClick={() => { on(); setPad(f.type as 'signature' | 'initials'); }} data-control={f.id} data-testid={`esign-sign-${f.type}`}>{t(img ? 'esign.sign.change' : f.type === 'signature' ? 'esign.sign.addSignature' : 'esign.sign.addInitials')}</Button>
                        </div>
                      </div>
                    );
                  }
                  if (f.type === 'date') return <div className="field" key={f.id}><span className="label">{lab}</span><p className="small muted" tabIndex={0} data-control={f.id} onFocus={on}>{t('esign.sign.dateAuto', { date: today })}</p></div>;
                  if (f.type === 'checkbox') return <label className={cx('check', active === f.id && 'on')} key={f.id}><input type="checkbox" checked={values[f.id] === 'yes'} onFocus={on} onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.checked ? 'yes' : '' }))} data-control={f.id} data-testid="esign-sign-check" /><span>{lab}</span></label>;
                  return <Field key={f.id} label={lab}><input value={values[f.id] ?? ''} maxLength={300} onFocus={() => showBox(f.id)} onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))} data-control={f.id} data-testid="esign-sign-text" /></Field>;
                })}
                {err && <p className="small neg" role="alert" data-testid="esign-sign-error">{err}</p>}
                <div className="row between">
                  <Button variant="ghost" icon={<LuArrowLeft aria-hidden="true" />} onClick={() => setStep('agree')}>{t('esign.sign.back')}</Button>
                  {missing.length > 0
                    ? <Button onClick={next} data-testid="esign-sign-next">{t('esign.sign.next')}</Button>
                    : <Button variant="primary" onClick={() => { if (name.trim().length < 2) { setErr(t('esign.sign.err.name')); return; } setErr(''); setStep('review'); window.scrollTo(0, 0); }} data-testid="esign-sign-review">{t('esign.sign.toReview')}<LuArrowRight aria-hidden="true" /></Button>}
                </div>
              </div>
            </Card>
          </div>
          {pages(true)}
        </div>
      )}

      {step === 'review' && (
        <div className="es-fill">
          <div className="es-panel">
            <Card className="raised" title={t('esign.sign.reviewTitle')}>
              <p className="small muted">{t('esign.sign.reviewHint')}</p>
              <dl className="kv es-gap">
                <dt>{t('esign.sign.fullName')}</dt><dd>{name}</dd>
                {mine.filter((f) => f.type === 'text' || f.type === 'checkbox').map((f, i) => <Fragment key={f.id}><dt>{f.label || t('esign.field.' + f.type) + ' ' + (i + 1)}</dt><dd>{f.type === 'checkbox' ? t(values[f.id] === 'yes' ? 'esign.sign.checked' : 'esign.sign.notChecked') : values[f.id] || t('esign.sign.empty')}</dd></Fragment>)}
                <dt>{t('esign.field.date')}</dt><dd>{today}</dd>
              </dl>
              {err && <p className="small neg" role="alert" data-testid="esign-sign-error">{err}</p>}
              <div className="row between es-gap">
                <Button variant="ghost" icon={<LuArrowLeft aria-hidden="true" />} onClick={() => setStep('fill')}>{t('esign.sign.back')}</Button>
                <Button variant="primary" icon={<LuSignature aria-hidden="true" />} disabled={busy} onClick={() => void send()} data-testid="esign-sign-finish">{t(busy ? 'esign.sign.finishing' : 'esign.sign.finish')}</Button>
              </div>
              <button type="button" className="linkbtn small es-gap" onClick={() => setDeclining(true)}>{t('esign.sign.decline')}</button>
            </Card>
          </div>
          {pages(false)}
        </div>
      )}

      {pad && <SignaturePad kind={pad} name={name || view.signer.name} t={t} onClose={() => setPad(null)}
        onDone={(png, typed) => { if (pad === 'signature') { setSignature(png); setName(typed); } else setInitials(png); setPad(null); setErr(''); }} />}
      {declining && (
        <Modal title={t('esign.sign.declineTitle')} onClose={() => setDeclining(false)} size="narrow" labelClose={t('esign.sign.close')}
          footer={<><Button variant="ghost" onClick={() => setDeclining(false)}>{t('esign.sign.cancel')}</Button><Button variant="danger" disabled={busy} onClick={() => void refuse()} data-testid="esign-sign-decline-confirm">{t('esign.sign.declineConfirm')}</Button></>}>
          <Field label={t('esign.sign.declineReason')}><textarea rows={3} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} data-testid="esign-sign-decline-reason" /></Field>
          <p className="xs dim">{t('esign.sign.declineNote')}</p>
        </Modal>
      )}
    </div>
  );
}
