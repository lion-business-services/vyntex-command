// What a live workspace shows about the session itself, next to the person's name in the top bar:
//   SyncIndicator   whether what is on screen is saved (saved, saving, offline, not saved), with "try again"
//   AccountMenu     who is signed in, the language, change password, sign out, sign out everywhere
//   LiveChrome      both, plus the identity check prompt, mounted by src/app/App.tsx whenever a live workspace is open
// None of it exists in a sample workspace: there is nobody signed in and nothing to save to a server.
import { useEffect, useId, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { LuCircleCheck, LuCloudUpload, LuCloudOff, LuTriangleAlert, LuChevronDown, LuKeyRound, LuLogOut } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { navigate, useRoute } from '@/app/router';
import { DEPLOY } from '@/config/deployment';
import type { Lang } from '@/domain/types';
import { Button, IconButton, Menu, Modal, confirmDialog, toast } from '@/ui';
import { setLanguage, syncNow, unsavedCount } from '@/store/store';
import { session } from '@/platform/session';
import { useSyncStatus } from '@/platform/live/status';
import { retryNow } from '@/platform/live/sync';
import { signOut } from '@/platform/live/workspace';
import { post } from '@/platform/live/http';
import { StepUpHost } from './stepup';
import { ErrorLine, PasswordField, failText } from './flow';
import './auth.css';

const LANG_NAME: Record<Lang, string> = { en: 'English', es: 'Español', zh: '中文' };
const ICON = { saved: LuCircleCheck, saving: LuCloudUpload, offline: LuCloudOff, problem: LuTriangleAlert } as const;

/** Whether the last change is in the database. Quiet when it is; says so plainly when it is not. */
export function SyncIndicator() {
  const { t } = useApp();
  const s = useSyncStatus();
  if (!s.live) return null;
  const Icon = ICON[s.state];
  const again = () => { retryNow(); syncNow(); };
  return (
    <span className="auth-sync" data-state={s.state} role="status" aria-live="polite" title={t(`auth.sync.${s.state}Hint`)} data-testid="sync-status">
      <Icon aria-hidden="true" />
      <span className="auth-sync-t">{t('auth.sync.' + s.state)}{s.state !== 'saved' && s.pending > 1 ? ` · ${t('auth.sync.waiting', { n: s.pending })}` : ''}</span>
      {(s.state === 'offline' || s.state === 'problem') && <button type="button" onClick={again} data-testid="sync-retry">{t('auth.sync.retry')}</button>}
    </span>
  );
}

/** Choosing a new password while signed in. The server asks for a fresh identity check first; the shared prompt handles it. */
function ChangePassword({ onClose }: { onClose: () => void }) {
  const { t } = useApp();
  const [password, setPassword] = useState(''); const [again, setAgain] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const id = useId();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (password !== again) { setError(t('auth.invite.mismatch')); return; }
    setBusy(true); setError('');
    const a = await post('/api/auth/password/update', { password }, { session: true });
    setBusy(false);
    if (a.ok) { toast(t('auth.password.done')); onClose(); return; }
    if (a.code === 'stepup_cancelled') return;
    setError(failText(a, t, 'auth.password.failed'));
  };
  return (
    <Modal title={t('auth.account.change')} onClose={onClose} size="narrow" labelClose={t('common.cancel')}>
      <form onSubmit={submit} className="stack" noValidate data-testid="auth-change-password">
        <p className="small muted">{t('auth.password.sub')}</p>
        <PasswordField id={id + 'p'} label={t('auth.reset.new')} value={password} onChange={setPassword} autoComplete="new-password" invalid={!!error} describedBy={error ? id + 'x' : undefined} hint={t('auth.invite.rule')} testId="auth-new-password" />
        <PasswordField id={id + 'a'} label={t('auth.invite.again')} value={again} onChange={setAgain} autoComplete="new-password" testId="auth-new-password-again" />
        {error && <ErrorLine id={id + 'x'}>{error}</ErrorLine>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={busy || !password} data-testid="auth-change-password-save">{busy ? t('auth.wait') : t('auth.password.save')}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Where the sign-in page of this deployment is. */
const signInAddress = (): string => (DEPLOY.marketing ? '/signin' : '/');

/** The person's own controls: language, password, signing out. */
export function AccountMenu() {
  const { t, lang } = useApp();
  const [changing, setChanging] = useState(false);
  const who = session();
  if (!who) return null;
  const leave = async (everywhere: boolean) => {
    const waiting = unsavedCount();
    if (waiting > 0 && !(await confirmDialog(t('auth.account.unsaved', { n: waiting }), t('auth.account.signout'), t('common.cancel')))) return;
    if (everywhere && !(await confirmDialog(t('auth.account.signoutAllConfirm'), t('auth.account.signoutAll'), t('common.cancel'), false))) return;
    await signOut(everywhere);
    navigate(signInAddress());
  };
  return (
    <span className="auth-menu">
      <Menu label={t('auth.account.menu')} button={<IconButton label={t('auth.account.menu')} size="sm" data-testid="account-menu"><LuChevronDown /></IconButton>}>
        <div className="cap" data-testid="account-email">{t('auth.account.signedIn', { email: who.email ?? who.name ?? '' })}</div>
        {DEPLOY.languages.length > 1 && (
          <div className="seg" role="group" aria-label={t('auth.language')} onClick={(e) => e.stopPropagation()}>
            {DEPLOY.languages.map((code) => <button type="button" key={code} aria-pressed={lang === code} onClick={() => setLanguage(code)} lang={code} data-testid={`account-lang-${code}`}>{LANG_NAME[code]}</button>)}
          </div>
        )}
        <div className="sep" />
        <button type="button" role="menuitem" onClick={() => setChanging(true)} data-testid="account-password"><LuKeyRound aria-hidden="true" />{t('auth.account.change')}</button>
        <button type="button" role="menuitem" onClick={() => { void leave(false); }} data-testid="account-signout"><LuLogOut aria-hidden="true" />{t('auth.account.signout')}</button>
        <button type="button" role="menuitem" onClick={() => { void leave(true); }} data-testid="account-signout-all"><LuLogOut aria-hidden="true" />{t('auth.account.signoutAll')}</button>
      </Menu>
      {changing && <ChangePassword onClose={() => setChanging(false)} />}
    </span>
  );
}

/**
 * Mounted next to a live workspace. The identity check prompt needs no place of its own. The indicator and the account
 * menu belong in the top bar; until the workspace frame draws them itself they are attached to the end of its top bar
 * from here, in a holder of their own, so the frame's file does not have to change for a live workspace to be usable.
 * `dock={false}` leaves them out once the frame renders `<SyncIndicator />` and `<AccountMenu />` itself.
 */
export function LiveChrome({ dock = true }: { dock?: boolean }) {
  const route = useRoute();
  const [holder, setHolder] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!dock) { setHolder(null); return; }
    const bar = document.querySelector('.shell .topbar');
    if (!bar) { setHolder(null); return; }
    let el = bar.querySelector<HTMLElement>(':scope > .auth-dock');
    if (!el) { el = document.createElement('span'); el.className = 'auth-dock'; bar.appendChild(el); }
    setHolder(el);
  }, [dock, route.path]);
  // the holder goes when the workspace closes
  useEffect(() => () => { document.querySelector('.shell .topbar > .auth-dock')?.remove(); }, []);
  return (
    <>
      <StepUpHost />
      {holder && holder.isConnected && createPortal(<><SyncIndicator /><AccountMenu /></>, holder)}
    </>
  );
}
