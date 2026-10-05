// The identity check before a sensitive action ("confirm it is you"). The server asks for it before a tax ID is approved
// or opened, before people or roles change, and before an export; it is good for five minutes (docs/SERVER.md, section 5).
//
// `askStepUp()` opens the dialog from anywhere and resolves true once the person has confirmed. A page that can trigger it
// mounts `<StepUpHost />` once. In a live workspace the dialog sends the code (or the password, for someone without an
// authenticator) to the server and nothing else: what was typed is read from the field when the form is sent and the
// field is emptied straight after. In a sample workspace nobody is signed in, so there is nothing to confirm: the dialog
// says so, shows where the step happens, and lets the reviewer continue.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { LuShieldCheck } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { authGateway } from '@/platform/gateway';
import { isLive, session } from '@/platform/session';
import { Button, Modal, Note } from '@/ui';

type Ask = { resolve: (ok: boolean) => void };
let asking: Ask | null = null;
let hosts = 0;
const subs = new Set<() => void>();
const ping = () => subs.forEach((f) => f());

/** Opens the identity check. Resolves true when the person confirmed, false when they closed it or no page can show it. */
export function askStepUp(): Promise<boolean> {
  if (!hosts) return Promise.resolve(false);
  // one question at a time: a second caller gets the answer of the dialog already open
  if (asking) { const prev = asking.resolve; return new Promise((resolve) => { asking = { resolve: (ok) => { prev(ok); resolve(ok); } }; }); }
  return new Promise((resolve) => { asking = { resolve }; ping(); });
}
const done = (ok: boolean) => { const a = asking; asking = null; ping(); a?.resolve(ok); };

export function StepUpHost() {
  const open = useSyncExternalStore((l) => { subs.add(l); return () => { subs.delete(l); }; }, () => asking, () => asking);
  useEffect(() => { hosts++; return () => { hosts--; if (!hosts && asking) done(false); }; }, []);
  if (!open) return null;
  return isLive() ? <LiveCheck /> : <SampleCheck />;
}

function SampleCheck() {
  const { t } = useApp();
  return (
    <Modal title={t('security.stepup.title')} onClose={() => done(false)} size="narrow" labelClose={t('common.cancel')}
      footer={<><Button variant="ghost" onClick={() => done(false)}>{t('common.cancel')}</Button><Button variant="primary" onClick={() => done(true)} data-autofocus data-testid="security-stepup-continue">{t('security.stepup.sampleGo')}</Button></>}>
      <div className="stack tight" data-testid="security-stepup">
        <p>{t('security.stepup.liveText')}</p>
        <Note>{t('security.stepup.sample')}</Note>
      </div>
    </Modal>
  );
}

function LiveCheck() {
  const { t } = useApp();
  // someone who passed the second step in this session has an authenticator: they confirm with a code, the others with their password
  const [mode, setMode] = useState<'code' | 'password'>(session()?.aal === 'aal2' ? 'code' : 'password');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const field = useRef<HTMLInputElement>(null);
  // whatever is still in the field goes when the dialog closes
  useEffect(() => () => { if (field.current) field.current.value = ''; }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const typed = field.current?.value.trim() ?? '';
    if (!typed) { setErr(t(mode === 'code' ? 'security.stepup.needCode' : 'security.stepup.needPassword')); return; }
    setBusy(true); setErr('');
    let reason = 'not_available';
    try {
      const res = await authGateway().stepUp(mode === 'code' ? { code: typed.replace(/\s/g, '') } : { password: typed });
      if (res.ok) { if (field.current) field.current.value = ''; done(true); return; }
      reason = res.reason;
    } catch { /* worded below */ }
    if (field.current) { field.current.value = ''; field.current.focus(); }
    setBusy(false);
    if (reason === 'code_required') { setMode('code'); setErr(t('security.stepup.codeRequired')); return; }
    setErr(t(reason === 'locked' || reason === 'rate_limited' ? 'security.stepup.locked' : reason.startsWith('invalid') ? 'security.stepup.wrong' : 'security.stepup.failed'));
  };
  return (
    <Modal title={t('security.stepup.title')} onClose={() => done(false)} size="narrow" labelClose={t('common.cancel')}>
      <form onSubmit={submit} noValidate autoComplete="off" data-testid="security-stepup">
        <p className="security-stepup-lead"><LuShieldCheck aria-hidden="true" />{t('security.stepup.liveText')}</p>
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="security-stepup-field">{t(mode === 'code' ? 'security.stepup.code' : 'security.stepup.password')}</label>
          {mode === 'code'
            ? <input id="security-stepup-field" key="code" ref={field} type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={10} spellCheck={false} data-autofocus />
            : <input id="security-stepup-field" key="password" ref={field} type="password" autoComplete="current-password" data-autofocus />}
          <span className="hint">{t(mode === 'code' ? 'security.stepup.codeHint' : 'security.stepup.passwordHint')}</span>
        </div>
        {err && <p className="small neg" role="alert" style={{ marginTop: 10 }}>{err}</p>}
        <div className="modal-f" style={{ margin: '18px -18px -18px' }}>
          <Button variant="ghost" onClick={() => done(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" disabled={busy}>{t('security.stepup.confirm')}</Button>
        </div>
      </form>
    </Modal>
  );
}
