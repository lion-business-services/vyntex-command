// The fresh identity check. Some actions (revealing a tax ID, inviting, changing roles, exports, connecting a provider,
// changing the password) are only accepted by the server within five minutes of the person proving who they are.
// When the server asks, the fetch code opens this one small prompt, and repeats the action once it was passed.
// With an authenticator enrolled the proof is its code; without one it is the password. The server decides which.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useApp } from '@/app/hooks';
import { Button, Field, Modal } from '@/ui';
import { post, setStepUpPrompt } from '@/platform/live/http';
import { fetchSession } from '@/platform/live/auth';
import { ErrorLine, PasswordField, failText } from './flow';

/** Mounted once while a live workspace is open. Draws nothing until the server asks for the check. */
export function StepUpHost() {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'code' | 'password'>('password');
  const [value, setValue] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const waiting = useRef<((ok: boolean) => void)[]>([]);
  const id = useId();

  useEffect(() => {
    setStepUpPrompt(() => new Promise<boolean>((resolve) => {
      waiting.current.push(resolve);
      // several actions asking at once share the one prompt
      if (waiting.current.length > 1) return;
      setValue(''); setError(''); setBusy(false);
      void fetchSession(true).then((s) => { setMode(s?.mfa?.enrolled ? 'code' : 'password'); setOpen(true); });
    }));
    return () => { setStepUpPrompt(null); waiting.current.splice(0).forEach((r) => r(false)); };
  }, []);

  const finish = (ok: boolean) => { setOpen(false); waiting.current.splice(0).forEach((r) => r(ok)); };
  const send = async (v: string) => {
    if (busy || !v) return;
    setBusy(true); setError('');
    const a = await post('/api/auth/stepup', mode === 'code' ? { code: v } : { password: v }, { stepUp: false, session: true });
    if (a.ok) { finish(true); return; }
    setBusy(false); setValue('');
    // the server knows better than the page which proof this person owes
    if (a.code === 'code_required') { setMode('code'); return; }
    if (a.code === 'password_required') { setMode('password'); return; }
    if (a.status === 401 && a.code !== 'invalid_code') { finish(false); return; }   // the session itself ended
    setError(failText(a, t, mode === 'code' ? 'auth.mfa.err' : 'auth.stepup.errPassword'));
    document.getElementById(id)?.focus();
  };
  if (!open) return null;
  const submit = (e: FormEvent) => { e.preventDefault(); void send(value); };
  return (
    <Modal title={t('auth.stepup.title')} onClose={() => finish(false)} size="narrow" labelClose={t('common.cancel')}>
      <form onSubmit={submit} className="stack" noValidate data-testid="auth-stepup" data-mode={mode}>
        <p>{t(mode === 'code' ? 'auth.stepup.code' : 'auth.stepup.password')}</p>
        {mode === 'code' ? (
          <Field label={t('auth.mfa.code')} htmlFor={id} error={!!error}>
            <div className="auth-code"><input id={id} value={value} inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" maxLength={6} required aria-invalid={error ? true : undefined} aria-describedby={error ? id + 'x' : undefined} data-testid="auth-stepup-code"
              onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); setValue(v); if (v.length === 6 && v !== value) void send(v); }} /></div>
          </Field>
        ) : <PasswordField id={id} label={t('auth.password')} value={value} onChange={setValue} autoComplete="current-password" invalid={!!error} describedBy={error ? id + 'x' : undefined} testId="auth-stepup-password" />}
        {error && <ErrorLine id={id + 'x'}>{error}</ErrorLine>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={() => finish(false)} data-testid="auth-stepup-cancel">{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={busy || (mode === 'code' ? value.length < 6 : !value)} data-testid="auth-stepup-submit">{busy ? t('auth.wait') : t('auth.stepup.confirm')}</Button>
        </div>
      </form>
    </Modal>
  );
}
