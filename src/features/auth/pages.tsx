// The pages a person opens from a private link: accepting an invitation and choosing a new password.
// Both read their one-time value from the address once and take it out of the address bar at once, so it does not stay
// in the browser's history. Neither page says whether an email address has an account.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useApp } from '@/app/hooks';
import { Link, navigate } from '@/app/router';
import { DEPLOY } from '@/config/deployment';
import { APP_SEGMENT } from '@/platform/mode';
import { Button, Field } from '@/ui';
import { post } from '@/platform/live/http';
import { deploymentState } from '@/platform/live/auth';
import { AuthFrame } from './frame';
import { ErrorLine, ForgotForm, PasswordField, failText } from './flow';

const quiet = { stepUp: false, session: false } as const;
const TOKEN = /^[A-Za-z0-9_-]{20,200}$/;

function Unconfigured() {
  const { t } = useApp();
  return <div className="note warn" role="status" data-testid="auth-unconfigured" tabIndex={-1} data-autofocus><p className="strong">{t('auth.unconfigured.title')}</p><p className="small">{t('auth.unconfigured.body')}</p></div>;
}

type InviteState = { at: 'checking' } | { at: 'unconfigured' } | { at: 'offline' } | { at: 'invalid' } | { at: 'form'; company: string; email: string; expiresAt: string } | { at: 'made' };

/** `/invite/<token>`: the only way an account comes to exist. */
export function Invite({ token: fromAddress }: { token?: string }) {
  const { t, dateTime } = useApp();
  // kept in memory; the address bar loses it right away
  const [token] = useState(fromAddress ?? '');
  const [state, setState] = useState<InviteState>({ at: 'checking' });
  const [name, setName] = useState(''); const [password, setPassword] = useState(''); const [again, setAgain] = useState('');
  const [existing, setExisting] = useState(false);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const asked = useRef(false);
  const id = useId();

  useEffect(() => {
    if (asked.current) return; asked.current = true;
    if (fromAddress) navigate('/invite', { replace: true });
    void (async () => {
      const there = await deploymentState();
      if (there !== 'yes') { setState({ at: there === 'no' ? 'unconfigured' : 'offline' }); return; }
      if (!TOKEN.test(token)) { setState({ at: 'invalid' }); return; }
      const a = await post<{ company: string; emailHint: string; expiresAt: string }>('/api/auth/invite/check', { token }, quiet);
      if (a.ok) setState({ at: 'form', company: a.data.company, email: a.data.emailHint, expiresAt: a.data.expiresAt });
      else setState({ at: a.status === 0 || a.status >= 500 ? 'offline' : 'invalid' });
    })();
  }, [fromAddress, token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || state.at !== 'form') return;
    if (!existing && !name.trim()) { setError(t('auth.invite.nameRequired')); document.getElementById(id + 'n')?.focus(); return; }
    if (!existing && password !== again) { setError(t('auth.invite.mismatch')); document.getElementById(id + 'a')?.focus(); return; }
    setBusy(true); setError('');
    const a = await post<{ signedIn: boolean; slug: string }>('/api/auth/invite/accept', { token, password, name: name.trim() }, quiet);
    if (a.ok) {
      if (!a.data.signedIn) { setState({ at: 'made' }); return; }
      // signed in: the company's address opens the workspace, or asks for the second step first when the role needs one
      navigate(DEPLOY.liveBase === 'app' ? '/' + APP_SEGMENT : '/' + a.data.slug, { replace: true });
      return;
    }
    setBusy(false);
    if (a.code === 'invite_invalid') { setState({ at: 'invalid' }); return; }
    if (a.code === 'account_exists') { setExisting(true); setPassword(''); setAgain(''); setError(t('auth.invite.exists', { company: state.company })); document.getElementById(id + 'p')?.focus(); return; }
    setError(failText(a, t, 'auth.err.offline'));
    document.getElementById(id + 'p')?.focus();
  };

  let sub: string | undefined; let body;
  if (state.at === 'checking') body = <div className="auth-wait" role="status" aria-live="polite">{t('auth.wait')}</div>;
  else if (state.at === 'unconfigured') body = <Unconfigured />;
  else if (state.at === 'offline') body = <><p className="auth-err" role="alert">{t('auth.err.offline')}</p><div className="row"><Button onClick={() => location.reload()} data-autofocus>{t('auth.err.retry')}</Button></div></>;
  else if (state.at === 'invalid') body = <><div className="note warn" role="alert" data-testid="auth-invite-invalid" tabIndex={-1} data-autofocus>{t('auth.invite.invalid')}</div><div className="auth-links"><Link to="/signin" className="linkbtn">{t('auth.back')}</Link></div></>;
  else if (state.at === 'made') body = <><div className="note" role="status" tabIndex={-1} data-autofocus>{t('auth.invite.signIn')}</div><div className="row"><Link to="/signin" className="btn primary">{t('auth.signin.title')}</Link></div></>;
  else {
    sub = t('auth.invite.sub', { company: state.company });
    body = (
      <form onSubmit={submit} noValidate data-testid="auth-invite-form">
        <p className="small muted" data-testid="auth-invite-for">{t('auth.invite.for', { email: state.email, date: dateTime(state.expiresAt) })}</p>
        {!existing && (
          <Field label={t('auth.invite.name')} htmlFor={id + 'n'}>
            <input id={id + 'n'} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={200} data-testid="auth-invite-name" />
          </Field>
        )}
        <PasswordField id={id + 'p'} label={t(existing ? 'auth.password' : 'auth.invite.password')} value={password} onChange={setPassword} autoComplete={existing ? 'current-password' : 'new-password'}
          invalid={!!error} describedBy={error ? id + 'x' : undefined} hint={existing ? undefined : t('auth.invite.rule')} testId="auth-invite-password" />
        {!existing && <PasswordField id={id + 'a'} label={t('auth.invite.again')} value={again} onChange={setAgain} autoComplete="new-password" testId="auth-invite-again" />}
        {error && <ErrorLine id={id + 'x'}>{error}</ErrorLine>}
        <Button type="submit" variant="primary" block disabled={busy} data-testid="auth-submit">{busy ? t('auth.wait') : t('auth.invite.submit')}</Button>
      </form>
    );
  }
  return <AuthFrame title={t('auth.invite.title')} sub={sub} testId="auth-invite" step={state.at + (existing ? '-existing' : '')}>{body}</AuthFrame>;
}

/** `/reset-password`: asks for the link, or, opened from the link (`#token=...`), takes the new password. */
export function ResetPassword() {
  const { t } = useApp();
  // the token travels after "#", which is never sent to a server; it is read once and removed from the address bar
  const [token, setToken] = useState('');
  const [there, setThere] = useState<'checking' | 'yes' | 'no' | 'offline'>('checking');
  const [password, setPassword] = useState(''); const [again, setAgain] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'form' | 'done' | 'invalid'>('form');
  // after the link was used once the server keeps the open reset in a short-lived cookie: a second try sends no token
  const [used, setUsed] = useState(false);
  const id = useId();
  useEffect(() => {
    // also when the link is opened in a tab that already shows this page: only the part after "#" changes then
    const take = () => {
      let found = '';
      try { found = new URLSearchParams(location.hash.replace(/^#/, '')).get('token') ?? ''; } catch { found = ''; }
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
      if (found) { setToken(found); setState('form'); setUsed(false); setError(''); setPassword(''); setAgain(''); }
    };
    take();
    window.addEventListener('hashchange', take);
    void deploymentState().then(setThere);
    return () => window.removeEventListener('hashchange', take);
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (password !== again) { setError(t('auth.invite.mismatch')); document.getElementById(id + 'a')?.focus(); return; }
    setBusy(true); setError('');
    const a = await post('/api/auth/password/reset', used ? { password } : { token, password }, quiet);
    setBusy(false);
    if (a.ok) { setState('done'); return; }
    if (a.code === 'weak_password') {
      // "built from your email" can only be judged once the link was accepted, so from here on the link counts as used
      if (a.data.reason === 'contains_email') setUsed(true);
      setError(failText(a, t)); document.getElementById(id + 'p')?.focus(); return;
    }
    if (a.code === 'reset_invalid') { setState('invalid'); return; }
    setError(failText(a, t, 'auth.err.offline'));
  };
  let body;
  if (there === 'checking') body = <div className="auth-wait" role="status" aria-live="polite">{t('auth.wait')}</div>;
  else if (there === 'no') body = <Unconfigured />;
  else if (there === 'offline') body = <p className="auth-err" role="alert">{t('auth.err.offline')}</p>;
  else if (!token) body = <ForgotForm />;
  else if (state === 'done') body = <><div className="note" role="status" data-testid="auth-reset-done" tabIndex={-1} data-autofocus>{t('auth.reset.done')}</div><div className="row"><Link to="/signin" className="btn primary" data-testid="auth-back">{t('auth.signin.title')}</Link></div></>;
  else if (state === 'invalid' || !TOKEN.test(token)) body = <><div className="note warn" role="alert" data-testid="auth-reset-invalid" tabIndex={-1} data-autofocus>{t('auth.reset.invalid')}</div><div className="auth-links"><Link to="/reset-password" className="linkbtn">{t('auth.reset.send')}</Link><Link to="/signin" className="linkbtn">{t('auth.back')}</Link></div></>;
  else body = (
    <form onSubmit={submit} noValidate data-testid="auth-reset-form">
      <p className="muted">{t('auth.reset.choose')}</p>
      <PasswordField id={id + 'p'} label={t('auth.reset.new')} value={password} onChange={setPassword} autoComplete="new-password" invalid={!!error} describedBy={error ? id + 'x' : undefined} hint={t('auth.invite.rule')} testId="auth-reset-password" />
      <PasswordField id={id + 'a'} label={t('auth.invite.again')} value={again} onChange={setAgain} autoComplete="new-password" testId="auth-reset-again" />
      {error && <ErrorLine id={id + 'x'}>{error}</ErrorLine>}
      <Button type="submit" variant="primary" block disabled={busy} data-testid="auth-submit">{busy ? t('auth.wait') : t('auth.reset.submit')}</Button>
    </form>
  );
  return <AuthFrame title={t('auth.reset.title')} testId="auth-reset" step={there + state + (token ? 't' : '')}>{body}</AuthFrame>;
}
