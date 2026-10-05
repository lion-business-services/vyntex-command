// The three moments of the tax ID vault that touch the number itself: typing one in, asking to see one, and seeing it.
//
// How the number is handled here, because this is the most sensitive thing the product holds:
//   * Typing: the field is not a React controlled input. What is typed lives in the page's own field and nowhere else; it
//     is read once when the form is sent, handed to the gateway, and the field is emptied whatever the answer is. It is never
//     written to the console, the address, the store or browser storage. It is masked while typing (a "show" switch lifts
//     the mask), and the browser is told not to remember or autofill it.
//   * Seeing: the value the server returns is kept in a plain holder outside React state. It is drawn masked, shown only
//     while "show" is on, cannot be selected or copied with the keyboard, and is let go of when the countdown ends, when
//     the panel closes, and when the page is left. The one way to copy it is the Copy button, which is logged first.
//   * A sample workspace has no number at all: storing one keeps the type and last four digits and drops the rest, and
//     opening one shows the whole flow with the sentence "no real tax ID exists to show".
import { useEffect, useRef, useState } from 'react';
import { LuCopy, LuEye, LuEyeOff, LuTimer } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Button, Field, Modal, Note, cx, toast } from '@/ui';
import type { Client, RevealRequest } from '@/domain/types';
import { vaultRules } from '@/domain/config';
import { MIN_REASON, TAX_ID_TYPES, approversFor, formatTaxId, maskedTaxId, onlyDigits, taxIdProblem, type TaxIdType } from '@/domain/actions/security';
import { ops } from './ops';
import { askStepUp } from './stepup';
import { SampleNote, reasonText, sampleWord } from './parts';

/** Whether the browser can mask a text field by itself. Where it cannot, a password field does the masking. */
const CAN_MASK = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('-webkit-text-security', 'disc');

/* ---------- putting a number on file, or replacing it ---------- */
export function TaxIdModal({ client, onClose }: { client: Client; onClose: () => void }) {
  const { t, live } = useApp();
  const [type, setType] = useState<TaxIdType>(client.taxIdType ?? (client.kind === 'business' ? 'ein' : 'ssn'));
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const empty = () => { if (field.current) field.current.value = ''; };
  // nothing typed outlives the dialog
  useEffect(() => empty, []);

  // dashes are put in as the person types, straight in the field: the digits never pass through React state
  const tidy = (e: React.FormEvent<HTMLInputElement>) => { const el = e.currentTarget; const next = formatTaxId(type, el.value); if (next !== el.value) el.value = next; if (err) setErr(''); };
  const changeType = (next: TaxIdType) => { setType(next); if (field.current) field.current.value = formatTaxId(next, field.current.value); setErr(''); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const typed = field.current?.value ?? '';
    const problem = taxIdProblem(type, typed);
    if (problem) { setErr(t(problem === 'length' ? 'security.tax.errLength' : 'security.tax.errPattern.' + type)); field.current?.focus(); return; }
    setBusy(true); setErr('');
    const res = await ops.vaultSet(client.id, type, typed);
    // whatever the answer, the number leaves the page now
    empty();
    setBusy(false);
    if (!res.ok) { setErr(reasonText(t, res.reason)); return; }
    toast(t(res.sample ? 'security.tax.savedSample' : 'security.tax.saved', { type: t('security.tax.type.' + type), last4: res.data.taxIdLast4 }));
    onClose();
  };
  return (
    <Modal title={t(client.taxIdType ? 'security.tax.replace' : 'security.tax.add')} onClose={onClose} labelClose={t('common.cancel')}>
      {/* a plain form with no name on the field, so the browser has nothing to remember it under */}
      <form onSubmit={save} noValidate autoComplete="off" data-testid="security-tax-form">
        <div className="fgrid">
          <Field label={t('security.tax.kind')} htmlFor="security-tax-type" full>
            <select id="security-tax-type" value={type} onChange={(e) => changeType(e.target.value as TaxIdType)} data-testid="security-tax-type">
              {TAX_ID_TYPES.map((x) => <option key={x} value={x}>{t('security.tax.type.' + x)}</option>)}
            </select>
          </Field>
          <Field label={t('security.tax.number')} htmlFor="security-tax-value" hint={t('security.tax.shape.' + type)} error={!!err} full>
            <div className="security-secretfield">
              <input id="security-tax-value" ref={field} type={show || CAN_MASK ? 'text' : 'password'} className={cx(!show && CAN_MASK && 'security-masked')} inputMode="numeric" maxLength={11}
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} data-lpignore="true" data-1p-ignore="true" data-form-type="other" aria-invalid={!!err || undefined}
                onInput={tidy} onPaste={(e) => { e.preventDefault(); const el = e.currentTarget; el.value = formatTaxId(type, onlyDigits(e.clipboardData.getData('text'))); }} data-autofocus data-testid="security-tax-value" />
              <button type="button" className="iconbtn" aria-pressed={show} aria-label={t(show ? 'security.tax.hide' : 'security.tax.show')} title={t(show ? 'security.tax.hide' : 'security.tax.show')} onClick={() => setShow((s) => !s)} data-testid="security-tax-toggle">{show ? <LuEyeOff /> : <LuEye />}</button>
            </div>
          </Field>
        </div>
        {err && <p className="small neg" role="alert" style={{ marginTop: 10 }} data-testid="security-tax-error">{err}</p>}
        <p className="small muted" style={{ marginTop: 12 }}>{t('security.tax.kept')}</p>
        {!live && <SampleNote>{t('security.tax.sample', { sample: sampleWord(t) })}</SampleNote>}
        <div className="modal-f" style={{ margin: '18px -18px -18px' }}>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" disabled={busy} data-testid="security-tax-save">{t('security.tax.save')}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- asking to see it ---------- */
const QUICK_REASONS = ['return', 'letter', 'state', 'verify', 'review'] as const;

export function RequestModal({ client, onClose }: { client: Client; onClose: () => void }) {
  const { t, data, pack, user, live } = useApp();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const rule = vaultRules(data).approval;
  const others = approversFor(data, pack, user?.id);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < MIN_REASON) { setErr(t('security.ask.needReason')); return; }
    setBusy(true); setErr('');
    const res = await ops.vaultRequest(client.id, reason);
    if (!res.ok) { setBusy(false); setErr(reasonText(t, res.reason)); return; }
    if (rule === 'step_up') {
      // one authorised person: they confirm who they are and the request is approved by themselves. A live workspace asks
      // for the check by itself when the approval is sent; a sample one shows where it happens.
      const confirmed = live || (await askStepUp());
      const ok = confirmed ? await ops.vaultDecide(res.data.id, true) : null;
      setBusy(false);
      toast(t(ok?.ok ? 'security.ask.readyNow' : 'security.ask.filedConfirm'), !ok?.ok && !!ok);
    } else {
      setBusy(false);
      toast(t('security.ask.filed'));
    }
    onClose();
  };
  return (
    <Modal title={t('security.ask.title')} onClose={onClose} labelClose={t('common.cancel')}>
      <form onSubmit={send} noValidate data-testid="security-ask-form">
        <p className="muted" style={{ marginBottom: 12 }}>{t('security.ask.lead', { client: client.name, type: t('security.tax.type.' + (client.taxIdType ?? 'ssn')) })}</p>
        <Field label={<>{t('security.ask.reason')}<span aria-hidden="true"> *</span></>} htmlFor="security-ask-reason" hint={t('security.ask.reasonHint')} error={!!err} full>
          <textarea id="security-ask-reason" rows={3} value={reason} onChange={(e) => { setReason(e.target.value); setErr(''); }} maxLength={300} aria-required="true" data-autofocus data-testid="security-ask-reason" />
        </Field>
        <div className="security-quick" role="group" aria-label={t('security.ask.quick')}>
          {QUICK_REASONS.map((k) => <button key={k} type="button" className="btn sm" onClick={() => { setReason(t('security.ask.q.' + k)); setErr(''); }}>{t('security.ask.q.' + k)}</button>)}
        </div>
        {err && <p className="small neg" role="alert" style={{ marginTop: 10 }}>{err}</p>}
        <div className="security-next">
          <b>{t('security.ask.next')}</b>
          <p className="small muted">{t(rule === 'step_up' ? 'security.ask.nextStepUp' : 'security.ask.nextSecond', { minutes: 15, seconds: vaultRules(data).revealSeconds })}</p>
          {rule === 'second_person' && !others.length && <Note tone="warn">{t('security.ask.noApprover')}</Note>}
        </div>
        <div className="modal-f" style={{ margin: '18px -18px -18px' }}>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" disabled={busy} data-testid="security-ask-send">{t(rule === 'step_up' ? 'security.ask.sendStepUp' : 'security.ask.send')}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- seeing it ---------- */

/** Holds a revealed value outside React state, so letting go of it is one assignment and nothing re-renders with it. */
export interface Secret { value: string | null }
export interface Opened { requestId: string; secret: Secret; hideAt: string; last4?: string; sample: boolean; seconds: number }

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function RevealPanel({ client, request, opened, onClose }: { client: Client; request: RevealRequest; opened: Opened; onClose: () => void }) {
  const { t } = useApp();
  const type = client.taxIdType ?? 'ssn';
  const [visible, setVisible] = useState(false);
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((new Date(opened.hideAt).getTime() - Date.now()) / 1000)));
  const [copied, setCopied] = useState(false);
  const closed = useRef(false);
  const close = () => { if (closed.current) return; closed.current = true; opened.secret.value = null; onClose(); };
  useEffect(() => {
    const tick = setInterval(() => {
      const s = Math.max(0, Math.ceil((new Date(opened.hideAt).getTime() - Date.now()) / 1000));
      setLeft(s);
      if (s <= 0) close();
    }, 250);
    // looking away covers it again; leaving the page lets go of it
    const cover = () => { if (document.hidden) setVisible(false); };
    document.addEventListener('visibilitychange', cover);
    window.addEventListener('pagehide', close);
    return () => { clearInterval(tick); document.removeEventListener('visibilitychange', cover); window.removeEventListener('pagehide', close); opened.secret.value = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const has = opened.secret.value !== null;
  const copy = async () => {
    // the copy is written to the access log first; without that entry nothing reaches the clipboard
    const res = await ops.vaultCopied(request.id);
    if (!res.ok) { toast(t(res.reason === 'not_available' ? 'security.see.copyOff' : 'security.see.copyRefused'), true); return; }
    if (res.sample || opened.secret.value === null) { setCopied(true); toast(t('security.see.copiedSample')); return; }
    try { await navigator.clipboard.writeText(opened.secret.value); setCopied(true); toast(t('security.see.copied')); }
    catch { toast(t('security.see.copyBlocked'), true); }
  };
  const stop = (e: React.SyntheticEvent) => e.preventDefault();
  return (
    <div className="security-reveal" role="region" aria-label={t('security.see.title')} data-testid="security-reveal">
      <div className="row between nowrap">
        <b>{t('security.see.title')}</b>
        <span className={cx('security-timer', left <= 10 && 'low')} role="timer" aria-live="off" data-testid="security-reveal-timer"><LuTimer aria-hidden="true" />{t('security.see.hidesIn', { time: mmss(left) })}</span>
      </div>
      <div className="security-meter" aria-hidden="true"><span style={{ transform: `scaleX(${Math.min(1, left / Math.max(1, opened.seconds))})` }} /></div>
      {/* not selectable, not draggable, no copy with the keyboard or the menu: the Copy button is the only way out, and it is logged */}
      <div className="security-secret" onCopy={stop} onCut={stop} onContextMenu={stop} onDragStart={stop} draggable={false} data-testid="security-reveal-value">
        <span className="xs dim">{t('security.tax.type.' + type)}</span>
        <output>{visible && opened.secret.value !== null ? formatTaxId(type, opened.secret.value) : maskedTaxId(type, opened.last4)}</output>
      </div>
      {has
        ? <p className="small muted">{t('security.see.once')}</p>
        : <SampleNote>{t('security.see.sample')}</SampleNote>}
      <div className="row">
        {has && <Button icon={visible ? <LuEyeOff aria-hidden="true" /> : <LuEye aria-hidden="true" />} onClick={() => setVisible((v) => !v)} aria-pressed={visible} data-testid="security-reveal-toggle">{t(visible ? 'security.tax.hide' : 'security.tax.show')}</Button>}
        <Button icon={<LuCopy aria-hidden="true" />} onClick={copy} disabled={copied} data-testid="security-reveal-copy">{t(copied ? 'security.see.copyDone' : 'security.see.copy')}</Button>
        <span className="grow" />
        <Button variant="primary" onClick={close} data-testid="security-reveal-close">{t('security.see.close')}</Button>
      </div>
    </div>
  );
}
