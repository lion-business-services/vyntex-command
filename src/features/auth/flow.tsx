// The way in. One component walks a person from "nobody is signed in" to their workspace, one step at a time:
// email and password, the code of the second step (or a recovery code), setting that step up the first time, the recovery
// codes shown once, and, for someone who belongs to several companies, which one to open.
// There is no sign-up anywhere in it: accounts are opened by invitation (src/features/auth/invite.tsx).
// Each step asks the server and shows what the server said. Wrong email and wrong password read the same.
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { LuEye, LuEyeOff, LuCopy, LuDownload, LuCheck, LuBuilding2, LuArrowRight } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Link, SAMPLE_BASE, navigate } from '@/app/router';
import { DEPLOY } from '@/config/deployment';
import { PACKS, isIndustry } from '@/packs';
import { Button, Field, Note, cx } from '@/ui';
import type { TFn } from '@/i18n';
import { onSession, sessionEnd, setSessionEnd } from '@/platform/session';
import { post, type Fail } from '@/platform/live/http';
import { deploymentState, fetchSession, membershipFor, usable, workspaceAddress, type Membership } from '@/platform/live/auth';
import { openWorkspace } from '@/platform/live/workspace';
import { AuthFrame } from './frame';
import { qrPath } from './qr';

type Stage =
  | { at: 'checking' } | { at: 'unconfigured' } | { at: 'offline' }
  | { at: 'form'; error?: string } | { at: 'forgot' }
  | { at: 'verify' } | { at: 'recovery' } | { at: 'enroll' } | { at: 'codes'; codes: string[]; email: string }
  | { at: 'picker'; list: Membership[] };

const quiet = { stepUp: false, session: false } as const;

/** A refused request as one sentence. Nothing here says whether an account exists. */
export function failText(a: Fail, t: TFn, wrong = 'auth.err.invalid'): string {
  if (a.code === 'locked' || a.code === 'rate_limited') {
    const s = typeof a.data.retryAfterSeconds === 'number' ? a.data.retryAfterSeconds : 0;
    return s > 0 ? t('auth.err.locked', { minutes: Math.max(1, Math.ceil(s / 60)) }) : t('auth.err.lockedSoon');
  }
  if (a.code === 'weak_password') { const k = 'auth.weak.' + String(a.data.reason); const w = t(k); return w === k ? t('auth.weak.too_short') : w; }
  if (a.status === 0 || a.status >= 500) return t('auth.err.offline');
  return t(wrong);
}

/** Copies text. Returns false when the browser will not allow it (the text is on screen to copy by hand either way). */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* not a secure address, or not allowed: the older way below */ }
  try {
    const area = document.createElement('textarea');
    area.value = text; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.appendChild(area); area.select();
    const done = document.execCommand('copy');
    area.remove();
    return done;
  } catch { return false; }
}
function CopyButton({ text, label, testId }: { text: string; label: string; testId?: string }) {
  const { t } = useApp();
  const [done, setDone] = useState(false);
  useEffect(() => { if (!done) return; const id = setTimeout(() => setDone(false), 2200); return () => clearTimeout(id); }, [done]);
  return <Button size="sm" icon={done ? <LuCheck aria-hidden="true" /> : <LuCopy aria-hidden="true" />} onClick={async () => setDone(await copyText(text))} data-testid={testId}><span aria-live="polite">{done ? t('auth.enroll.copied') : label}</span></Button>;
}

/** An error line that screen readers announce the moment it appears. */
export function ErrorLine({ id, children }: { id: string; children: ReactNode }) {
  return <p className="auth-err" role="alert" id={id} data-testid="auth-error">{children}</p>;
}

/** A password field with a way to look at what was typed. */
export function PasswordField({ id, label, value, onChange, autoComplete, describedBy, invalid, hint, testId }: {
  id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: 'current-password' | 'new-password'; describedBy?: string; invalid?: boolean; hint?: string; testId?: string;
}) {
  const { t } = useApp();
  const [show, setShow] = useState(false);
  return (
    <Field label={label} htmlFor={id} error={invalid} hint={hint}>
      <div className="auth-pass">
        <input id={id} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required maxLength={200}
          aria-invalid={invalid || undefined} aria-describedby={describedBy} autoCapitalize="none" spellCheck={false} data-testid={testId} />
        <button type="button" onClick={() => setShow((s) => !s)} aria-pressed={show} aria-label={t(show ? 'auth.hidePassword' : 'auth.showPassword')}>
          {show ? <LuEyeOff aria-hidden="true" /> : <LuEye aria-hidden="true" />}{t(show ? 'auth.hide' : 'auth.show')}
        </button>
      </div>
    </Field>
  );
}

/** The six digits of an authenticator app. Sends itself when the sixth digit is typed. */
function CodeField({ id, value, onChange, onFull, invalid, describedBy }: { id: string; value: string; onChange: (v: string) => void; onFull: (v: string) => void; invalid?: boolean; describedBy?: string }) {
  const { t } = useApp();
  return (
    <Field label={t('auth.mfa.code')} htmlFor={id} error={invalid}>
      <div className="auth-code">
        <input id={id} value={value} inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" maxLength={6} required aria-invalid={invalid || undefined} aria-describedby={describedBy} data-testid="auth-code"
          onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); onChange(v); if (v.length === 6 && v !== value) onFull(v); }} />
      </div>
    </Field>
  );
}

/** What the sign-in page says about the session that just ended, when one did. */
function EndedNote() {
  const { t } = useApp();
  const [, bump] = useState(0);
  useEffect(() => onSession(() => bump((n) => n + 1)), []);
  const end = sessionEnd();
  if (!end) return null;
  return (
    <div className={cx('note', end.reason !== 'signed_out' && 'warn')} role="status" data-testid="auth-ended" data-reason={end.reason}>
      <p>{t('auth.ended.' + end.reason)}</p>
      {end.unsaved > 0 && <p className="small" data-testid="auth-unsaved">{end.unsaved === 1 ? t('auth.ended.unsavedOne') : t('auth.ended.unsaved', { n: end.unsaved })}</p>}
    </div>
  );
}

function SignInForm({ error: initial, onDone, onForgot }: { error?: string; onDone: () => void; onForgot: () => void }) {
  const { t } = useApp();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState(initial ?? ''); const [busy, setBusy] = useState(false);
  const id = useId();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!email.trim() || !password) { setError(t('auth.err.required')); return; }
    setBusy(true); setError('');
    const a = await post('/api/auth/signin', { email: email.trim(), password }, quiet);
    if (!a.ok) { setBusy(false); setPassword(''); setError(failText(a, t)); document.getElementById(id + 'p')?.focus(); return; }
    onDone();
  };
  return (
    <form onSubmit={submit} noValidate data-testid="auth-form">
      <EndedNote />
      <Field label={t('auth.email')} htmlFor={id + 'e'} error={!!error}>
        <input id={id + 'e'} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} required maxLength={320}
          aria-invalid={error ? true : undefined} aria-describedby={error ? id + 'x' : undefined} data-testid="auth-email" />
      </Field>
      <PasswordField id={id + 'p'} label={t('auth.password')} value={password} onChange={setPassword} autoComplete="current-password" invalid={!!error} describedBy={error ? id + 'x' : undefined} testId="auth-password" />
      {error && <ErrorLine id={id + 'x'}>{error}</ErrorLine>}
      <Button type="submit" variant="primary" block disabled={busy} data-testid="auth-submit">{busy ? t('auth.wait') : t('auth.signin.submit')}</Button>
      <div className="auth-links"><button type="button" className="linkbtn" onClick={onForgot} data-testid="auth-forgot">{t('auth.forgot')}</button></div>
    </form>
  );
}

/** Ask for a link to choose a new password. The answer is the same whether or not the address has an account. */
export function ForgotForm({ onBack }: { onBack?: () => void }) {
  const { t, lang } = useApp();
  const [email, setEmail] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [sent, setSent] = useState<null | boolean>(null);
  const id = useId();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true); setError('');
    const a = await post<{ emailConfigured?: boolean }>('/api/auth/password/reset', { email: email.trim(), lang }, quiet);
    setBusy(false);
    if (!a.ok) { setError(failText(a, t, 'auth.err.offline')); return; }
    setSent(a.data.emailConfigured !== false);
  };
  const back = onBack ? <button type="button" className="linkbtn" onClick={onBack} data-testid="auth-back">{t('auth.back')}</button> : <Link to="/signin" className="linkbtn" data-testid="auth-back">{t('auth.back')}</Link>;
  if (sent !== null) return <><div className={cx('note', !sent && 'warn')} role="status" data-testid="auth-reset-sent" data-sent={String(sent)} tabIndex={-1} data-autofocus>{t(sent ? 'auth.reset.sent' : 'auth.reset.noEmail')}</div><div className="auth-links">{back}</div></>;
  return (
    <form onSubmit={submit} noValidate>
      <p className="muted">{t('auth.reset.ask')}</p>
      <Field label={t('auth.email')} htmlFor={id}>
        <input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} required maxLength={320} aria-describedby={error ? id + 'x' : undefined} data-testid="auth-reset-email" />
      </Field>
      {error && <ErrorLine id={id + 'x'}>{error}</ErrorLine>}
      <Button type="submit" variant="primary" block disabled={busy} data-testid="auth-reset-send">{busy ? t('auth.wait') : t('auth.reset.send')}</Button>
      <div className="auth-links">{back}</div>
    </form>
  );
}

/** The second step at sign-in: the authenticator code, or one recovery code instead. */
function VerifyForm({ recovery, onDone, onSwitch, onOther }: { recovery: boolean; onDone: () => void; onSwitch: () => void; onOther: () => void }) {
  const { t } = useApp();
  const [code, setCode] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const id = useId();
  const send = async (value: string) => {
    if (busy) return;
    setBusy(true); setError('');
    const a = recovery ? await post('/api/auth/mfa/recovery', { code: value }, quiet) : await post('/api/auth/mfa/verify', { code: value }, quiet);
    if (a.ok || a.code === 'not_enrolled') { onDone(); return; }
    setBusy(false); setCode('');
    setError(failText(a, t, recovery ? 'auth.recovery.err' : 'auth.mfa.err'));
    document.getElementById(id)?.focus();
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); void send(code); }} noValidate data-testid={recovery ? 'auth-recovery' : 'auth-verify'}>
      {recovery ? (
        <Field label={t('auth.recovery.code')} htmlFor={id} error={!!error}>
          <div className="auth-code recovery"><input id={id} value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 24))} autoComplete="off" autoCapitalize="characters" spellCheck={false} required aria-invalid={error ? true : undefined} aria-describedby={error ? id + 'x' : undefined} data-testid="auth-recovery-code" /></div>
        </Field>
      ) : <CodeField id={id} value={code} onChange={setCode} onFull={(v) => { void send(v); }} invalid={!!error} describedBy={error ? id + 'x' : undefined} />}
      {error && <ErrorLine id={id + 'x'}>{error}</ErrorLine>}
      <Button type="submit" variant="primary" block disabled={busy || (recovery ? code.replace(/[^A-Z0-9]/g, '').length < 16 : code.length < 6)} data-testid="auth-submit">{busy ? t('auth.wait') : t(recovery ? 'auth.recovery.submit' : 'auth.mfa.verify')}</Button>
      <div className="auth-links">
        <button type="button" className="linkbtn" onClick={onSwitch} data-testid="auth-switch">{t(recovery ? 'auth.mfa.useCode' : 'auth.mfa.useRecovery')}</button>
        <button type="button" className="linkbtn" onClick={onOther} data-testid="auth-other">{t('auth.other')}</button>
      </div>
    </form>
  );
}

const grouped = (secret: string) => secret.replace(/(.{4})/g, '$1 ').trim();

/** Setting the second step up for the first time: scan the code (or type the key), then prove it with the first code. */
function EnrollForm({ onCodes, onDone, onOther }: { onCodes: (codes: string[]) => void; onDone: () => void; onOther: () => void }) {
  const { t } = useApp();
  const [setup, setSetup] = useState<{ factorId: string; secret: string; uri: string } | null>(null);
  const [code, setCode] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const asked = useRef(false);
  const id = useId();
  const start = useCallback(async () => {
    setError('');
    const a = await post<{ factorId: string; secret: string; uri: string }>('/api/auth/mfa/enroll', {}, quiet);
    if (a.ok) setSetup({ factorId: a.data.factorId, secret: a.data.secret, uri: a.data.uri });
    else if (a.code === 'already_enrolled') onDone();
    else setError(failText(a, t, 'auth.enroll.failed'));
  }, [onDone, t]);
  useEffect(() => { if (!asked.current) { asked.current = true; void start(); } }, [start]);
  useEffect(() => { if (setup) document.getElementById(id)?.focus({ preventScroll: true }); }, [setup, id]);
  const send = async (value: string) => {
    if (busy || !setup) return;
    setBusy(true); setError('');
    const a = await post<{ recoveryCodes: string[] }>('/api/auth/mfa/confirm', { factorId: setup.factorId, code: value }, quiet);
    if (a.ok) { onCodes(a.data.recoveryCodes ?? []); return; }
    setBusy(false); setCode(''); setError(failText(a, t, 'auth.mfa.err'));
    document.getElementById(id)?.focus();
  };
  if (!setup) return error ? <><ErrorLine id={id + 'x'}>{error}</ErrorLine><div className="row"><Button onClick={() => { void start(); }} data-autofocus>{t('auth.err.retry')}</Button></div></> : <div className="auth-wait" role="status">{t('auth.wait')}</div>;
  // drawn here from the address the server returned: no picture is fetched and the key goes nowhere else
  let qr: { d: string; size: number } | null = null;
  try { qr = qrPath(setup.uri); } catch { qr = null; }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void send(code); }} noValidate data-testid="auth-enroll">
      <div className="auth-setup">
        {qr && <div className="paper auth-qr"><svg viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={t('auth.enroll.qrAlt')} shapeRendering="crispEdges" data-testid="auth-qr"><path d={qr.d} fill="currentColor" /></svg></div>}
        <div className="stack tight">
          {qr && <p>{t('auth.enroll.scan')}</p>}
          <p className="small muted">{t('auth.enroll.manual')}</p>
          <code className="auth-key" aria-label={t('auth.enroll.key')} data-testid="auth-secret" data-secret={setup.secret}>{grouped(setup.secret)}</code>
          <div className="row tight"><CopyButton text={setup.secret} label={t('auth.enroll.copyKey')} testId="auth-copy-key" /><CopyButton text={setup.uri} label={t('auth.enroll.copyUri')} testId="auth-copy-uri" /></div>
        </div>
      </div>
      <p>{t('auth.enroll.enter')}</p>
      <CodeField id={id} value={code} onChange={setCode} onFull={(v) => { void send(v); }} invalid={!!error} describedBy={error ? id + 'x' : undefined} />
      {error && <ErrorLine id={id + 'x'}>{error}</ErrorLine>}
      <Button type="submit" variant="primary" block disabled={busy || code.length < 6} data-testid="auth-submit">{busy ? t('auth.wait') : t('auth.enroll.confirm')}</Button>
      <div className="auth-links"><button type="button" className="linkbtn" onClick={onOther} data-testid="auth-other">{t('auth.other')}</button></div>
    </form>
  );
}

/** The recovery codes, shown once. The person downloads or copies them and says they kept them before going on. */
function RecoveryCodes({ codes, email, onDone }: { codes: string[]; email: string; onDone: () => void }) {
  const { t } = useApp();
  const [kept, setKept] = useState(false);
  const text = [t('auth.codes.file', { product: DEPLOY.productName, email }), '', ...codes, ''].join('\n');
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'recovery-codes.txt';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (kept) onDone(); }} data-testid="auth-codes">
      <ul className="auth-codes" data-autofocus tabIndex={-1} aria-label={t('auth.codes.title')}>{codes.map((c) => <li key={c} data-testid="auth-recovery-item">{c}</li>)}</ul>
      <div className="row tight">
        <Button size="sm" icon={<LuDownload aria-hidden="true" />} onClick={download} data-testid="auth-codes-download">{t('auth.codes.download')}</Button>
        <CopyButton text={codes.join('\n')} label={t('auth.codes.copy')} testId="auth-codes-copy" />
      </div>
      <label className="auth-check"><input type="checkbox" checked={kept} onChange={(e) => setKept(e.target.checked)} data-testid="auth-codes-kept" /><span>{t('auth.codes.saved')}</span></label>
      <Button type="submit" variant="primary" block disabled={!kept} data-testid="auth-codes-continue">{t('auth.codes.continue')}</Button>
    </form>
  );
}

/** Someone who belongs to more than one company chooses which to open. */
function Picker({ list }: { list: Membership[] }) {
  const { t, lang } = useApp();
  return (
    <div className="auth-pick" data-testid="auth-picker">
      {list.map((m, i) => (
        <button type="button" key={m.tenantId} onClick={() => navigate(workspaceAddress(m))} data-testid="auth-pick" data-slug={m.slug} data-autofocus={i === 0 ? '' : undefined}>
          <LuBuilding2 aria-hidden="true" />
          <span className="grow"><b>{m.name}</b><small>{DEPLOY.lockedEdition ? DEPLOY.productName : isIndustry(m.industry) ? PACKS[m.industry].product : ''}{m.role !== 'worker' && isIndustry(m.industry) ? ' · ' + (PACKS[m.industry].roleLabels[m.role]?.[lang] ?? PACKS[m.industry].roleLabels[m.role]?.en ?? '') : ''}</small></span>
          <LuArrowRight aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

/** The lines every sign-in page ends with: how accounts come to exist, and the way to the sample workspace when the build has one. */
function Foot() {
  const { t } = useApp();
  return (
    <>
      <p className="auth-fine" data-testid="auth-invite-only">{t('auth.noSignup')}</p>
      {(SAMPLE_BASE || DEPLOY.marketing) && (
        <div className="auth-links">
          {SAMPLE_BASE && <Link to={SAMPLE_BASE} className="linkbtn" data-testid="auth-open-sample">{t(DEPLOY.publicDemo ? 'auth.openDemo' : 'auth.openPreview')}</Link>}
          {DEPLOY.marketing && <Link to="/" className="linkbtn">{t('auth.home')}</Link>}
        </div>
      )}
    </>
  );
}

/**
 * `slug`: the company address the page stands at (`/acme` or `/app`), when it does. Without one (the sign-in page itself)
 * the person lands in their company, or chooses when they have several.
 */
export function AuthFlow({ slug }: { slug?: string }) {
  const { t } = useApp();
  const [stage, setStage] = useState<Stage>({ at: 'checking' });
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  /** Asks the server where things stand and shows the step that is due. `fresh`: the person just completed a step. */
  const advance = useCallback(async (fresh = false) => {
    const show = (s: Stage) => { if (alive.current) setStage(s); };
    if (fresh) show({ at: 'checking' });
    const there = await deploymentState();
    if (there !== 'yes') { show({ at: there === 'no' ? 'unconfigured' : 'offline' }); return; }
    const s = await fetchSession();
    if (!s) { show({ at: 'offline' }); return; }
    if (!s.signedIn) { show({ at: 'form' }); return; }
    if (s.mfa?.state === 'verify') { show({ at: 'verify' }); return; }
    if (s.mfa?.state === 'enroll') { show({ at: 'enroll' }); return; }
    const list = usable(s);
    if (slug && membershipFor(s, slug)) {
      const gate = await openWorkspace(slug);
      if (gate.state === 'ready') return;   // the session is set: the page above draws the workspace
      if (gate.state === 'mfa') { show({ at: gate.step === 'enroll' ? 'enroll' : 'verify' }); return; }
      if (gate.state === 'unconfigured' || gate.state === 'offline') { show({ at: gate.state }); return; }
      show({ at: 'form' }); return;
    }
    // An address the person does not belong to looks exactly like not being signed in. Only someone who has just
    // signed in is taken on to a company of their own.
    if (slug && !fresh) { show({ at: 'form' }); return; }
    if (!list.length) { show({ at: 'form', error: t('auth.err.invalid') }); return; }
    if (list.length === 1 || DEPLOY.liveBase === 'app') { navigate(workspaceAddress(list[0]), { replace: true }); return; }
    show({ at: 'picker', list });
  }, [slug, t]);
  useEffect(() => { void advance(); }, [advance]);

  const other = async () => { await post('/api/auth/signout', {}, quiet); setSessionEnd(null); setStage({ at: 'form' }); };
  const email = useRef('');
  const toCodes = async (codes: string[]) => { const s = await fetchSession(true); email.current = s?.user?.email ?? ''; setStage({ at: 'codes', codes, email: email.current }); };

  let title = t('auth.signin.title'); let sub: string | undefined; let body: ReactNode;
  switch (stage.at) {
    case 'checking': body = <div className="auth-wait" role="status" aria-live="polite">{t('auth.checking')}</div>; break;
    case 'unconfigured':
      body = <><div className="note warn" role="status" data-testid="auth-unconfigured" tabIndex={-1} data-autofocus><p className="strong">{t('auth.unconfigured.title')}</p><p className="small">{t('auth.unconfigured.body')}</p></div><Foot /></>;
      break;
    case 'offline':
      body = <><Note tone="bad"><span role="alert" data-testid="auth-offline">{t('auth.err.offline')}</span></Note><div className="row"><Button onClick={() => { void advance(true); }} data-autofocus data-testid="auth-retry">{t('auth.err.retry')}</Button></div></>;
      break;
    case 'form': body = <><SignInForm error={stage.error} onDone={() => { void advance(true); }} onForgot={() => setStage({ at: 'forgot' })} /><Foot /></>; break;
    case 'forgot': title = t('auth.reset.title'); body = <ForgotForm onBack={() => setStage({ at: 'form' })} />; break;
    case 'verify': title = t('auth.mfa.title'); sub = t('auth.mfa.sub'); body = <VerifyForm key="code" recovery={false} onDone={() => { void advance(true); }} onSwitch={() => setStage({ at: 'recovery' })} onOther={() => { void other(); }} />; break;
    case 'recovery': title = t('auth.mfa.title'); sub = t('auth.recovery.sub'); body = <VerifyForm key="recovery" recovery onDone={() => { void advance(true); }} onSwitch={() => setStage({ at: 'verify' })} onOther={() => { void other(); }} />; break;
    case 'enroll': title = t('auth.enroll.title'); sub = t('auth.enroll.sub'); body = <EnrollForm onCodes={(codes) => { void toCodes(codes); }} onDone={() => { void advance(true); }} onOther={() => { void other(); }} />; break;
    case 'codes': title = t('auth.codes.title'); sub = t('auth.codes.sub'); body = <RecoveryCodes codes={stage.codes} email={stage.email} onDone={() => { void advance(true); }} />; break;
    case 'picker': title = t('auth.picker.title'); sub = t('auth.picker.sub'); body = <Picker list={stage.list} />; break;
  }
  return <AuthFrame title={title} sub={sub} testId="auth-signin" step={stage.at}>{body}</AuthFrame>;
}
