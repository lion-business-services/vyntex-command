// Integrations: every outside service the company can connect, with the state the server reports and the exact reason
// for it. Nothing on this screen is decided in the browser: a card says "Connected" only when the server said so after
// the provider answered a real call, and in a sample workspace every card says "Not connected", because nothing is.
// Connecting sends the person to the provider through the server (the browser never sees a token); connecting and
// disconnecting ask them to confirm who they are first.
import { useCallback, useEffect, useRef, useState } from 'react';
import { LuActivity, LuChevronDown, LuCircleAlert, LuCircleCheck, LuFlaskConical, LuPlug, LuRefreshCw, LuShieldCheck, LuUnplug } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { appPath, navigate, useRoute } from '@/app/router';
import type { PageProps } from '@/app/routes';
import { Badge, Button, Card, Empty, Modal, Note, PageHeader, confirmDialog, cx, toast, type Tone } from '@/ui';
import { actorName } from '@/domain/selectors';
import type { ConnState, ProviderId } from '@/domain/types';
import { authGateway, gateway } from '@/platform/gateway';
import { session } from '@/platform/session';
import { GROUPS, PROVIDERS, modeOf, type ConnectionInfo, type ProviderInfo } from './catalog';
import './integrations.css';

const TONE: Record<ConnState, Tone> = { not_connected: 'neutral', setup: 'accent', connected: 'ok', attention: 'warn', reauth: 'warn', error: 'bad', pending_approval: 'violet' };
/** The server asks for a fresh identity check with this answer (docs/SERVER.md, section 6). */
const STEP_UP = 'stepup_required';
type Busy = { id: ProviderId; what: 'connect' | 'test' | 'sync' | 'disconnect' } | null;
/** What an action answered. `note` is an explanation, not a failure (a sample workspace has nothing to act on). */
type Result = { tone: 'ok' | 'bad' | 'note'; text: string };

export default function IntegrationsPage(_props: PageProps) {
  const { t, data, can, live, dateTime } = useApp();
  const route = useRoute();
  const write = can('write');
  const [rows, setRows] = useState<ConnectionInfo[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [back, setBack] = useState<{ id: string; ok: boolean; reason: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const stepUp = useRef<((ok: boolean) => void) | null>(null);
  const [asking, setAsking] = useState(false);

  const load = useCallback(async () => {
    try { setRows(await gateway().integrations.list() as ConnectionInfo[]); setFailed(false); }
    catch { setFailed(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // back from the provider: /integrations?integration=<id>&result=<connected|error>&reason=<code>
  useEffect(() => {
    const id = route.query.get('integration'); const result = route.query.get('result');
    if (!id || !result) return;
    setBack({ id, ok: result === 'connected' || result === 'ok', reason: route.query.get('reason') ?? '' });
    navigate(appPath('/integrations'), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  const nameOf = (p: ProviderInfo) => (p.nameKey ? t(p.nameKey) : p.name);
  /** The server's reason in words. A code this screen has no words for is shown as it came. */
  const reasonText = (code: string | undefined, fallback = 'integrations.reason.other') => {
    if (!code) return '';
    const worded = t('integrations.reason.' + code);
    return worded === 'integrations.reason.' + code ? t(fallback, { code }) : worded;
  };
  /** Opens the identity check and resolves once the person confirmed (true) or closed it (false). */
  const confirmIdentity = () => new Promise<boolean>((resolve) => { stepUp.current = resolve; setAsking(true); });
  const answered = (ok: boolean) => { setAsking(false); stepUp.current?.(ok); stepUp.current = null; };

  /** Runs a call that may need a fresh identity check: when the server asks for one, the person confirms and the call is made again, once. */
  async function guarded<T extends { ok: boolean; reason?: string }>(call: () => Promise<T>): Promise<T> {
    let out = await call();
    if (!out.ok && out.reason === STEP_UP && (await confirmIdentity())) out = await call();
    return out;
  }
  const say = (id: ProviderId, ok: boolean, text: string, sample = false) => setResults((r) => ({ ...r, [id]: { tone: ok ? 'ok' : sample ? 'note' : 'bad', text } }));
  const run = async (p: ProviderInfo, what: NonNullable<Busy>['what']) => {
    if (busy) return;
    const g = gateway().integrations;
    if (what === 'disconnect' && !(await confirmDialog(t('integrations.disconnectAsk', { name: nameOf(p) }), t('integrations.disconnect'), t('common.cancel')))) return;
    setBusy({ id: p.id, what });
    try {
      if (what === 'connect') {
        const out = await guarded(() => g.connect(p.id));
        if (out.ok && out.data.redirect) { window.location.assign(out.data.redirect); return; }
        if (out.ok) say(p.id, true, t('integrations.done.connect'));
        else say(p.id, false, out.sample ? t('integrations.sample.connect') : reasonText(out.reason), out.sample);
      } else if (what === 'disconnect') {
        const out = await guarded(() => g.disconnect(p.id));
        say(p.id, out.ok, out.ok ? t('integrations.done.disconnect') : out.sample ? t('integrations.sample.other') : reasonText(out.reason), out.sample);
      } else if (what === 'sync') {
        const out = await g.sync(p.id);
        say(p.id, out.ok, out.ok ? t('integrations.done.sync') : out.sample ? t('integrations.sample.other') : reasonText(out.reason), out.sample);
      } else {
        const out = await g.test(p.id);
        if (out.ok) say(p.id, out.data.healthy, out.data.healthy ? t('integrations.done.test') : t('integrations.done.testBad', { reason: reasonText(out.data.detail) || t('integrations.reason.unknown') }));
        else say(p.id, false, out.sample ? t('integrations.sample.other') : reasonText(out.reason), out.sample);
      }
      await load();
    } catch {
      say(p.id, false, t('integrations.reason.unavailable'));
    } finally { setBusy(null); }
  };

  const backFor = back ? PROVIDERS.find((p) => p.id === back.id) : undefined;
  const byId = new Map((rows ?? []).map((r) => [r.id, r]));

  return (
    <>
      <PageHeader title={t('nav.integrations')} sub={t('integrations.sub')} actions={rows && live ? <Button icon={<LuRefreshCw />} onClick={() => void load()} data-testid="integrations-refresh">{t('integrations.refresh')}</Button> : undefined} />

      {!live && <p className="note small integrations-sample" data-testid="integrations-sample"><b>{t('integrations.sample.title')}</b> {t('integrations.sample.body')}</p>}
      {back && (
        <div className={cx('note integrations-back', !back.ok && 'bad')} role="status" data-testid="integrations-back" data-result={back.ok ? 'ok' : 'error'}>
          {back.ok ? <LuCircleCheck aria-hidden="true" /> : <LuCircleAlert aria-hidden="true" />}
          <span className="grow">{back.ok ? t('integrations.back.ok', { name: backFor ? nameOf(backFor) : back.id }) : t('integrations.back.error', { name: backFor ? nameOf(backFor) : back.id, reason: reasonText(back.reason) || t('integrations.reason.unknown') })}</span>
          <button type="button" className="linkbtn small" onClick={() => setBack(null)}>{t('common.close')}</button>
        </div>
      )}

      {failed ? (
        <Card><Empty title={t('integrations.loadFailed')} action={<Button onClick={() => void load()}>{t('integrations.refresh')}</Button>}>{t('integrations.loadFailedHint')}</Empty></Card>
      ) : !rows ? (
        <div className="page-loading" role="status" aria-live="polite"><span className="sr">{t('common.loading')}</span></div>
      ) : (
        <div className="stack integrations-groups">
          {GROUPS.map((gid) => (
            <section key={gid} aria-labelledby={'int-' + gid} className="integrations-group">
              <h2 id={'int-' + gid} className="integrations-gh">{t('integrations.group.' + gid)}</h2>
              <div className="integrations-grid">
                {PROVIDERS.filter((p) => p.group === gid).map((p) => {
                  const c: ConnectionInfo = byId.get(p.id) ?? { id: p.id, state: 'not_connected', reason: 'unknown' };
                  const Icon = p.icon; const mode = modeOf(c); const res = results[p.id]; const mine = busy?.id === p.id;
                  // a service the platform itself holds the key for (the server says so) has nothing for a company to connect or remove
                  const own = c.kind !== 'platform';
                  const row = own && byId.has(p.id) && c.state !== 'not_connected' && c.state !== 'setup' && c.state !== 'pending_approval';
                  const canConnect = own && (c.state === 'setup' || c.state === 'error' || c.state === 'reauth' || c.state === 'attention' || (c.state === 'not_connected' && c.reason === 'sample'));
                  // in a sample workspace the note at the top of the page gives the reason once, for every card
                  const why = c.reason ?? c.lastError;
                  const reason = c.state === 'connected' || c.reason === 'sample' ? '' : reasonText(why);
                  // the last error is its own line only when it says something the reason above does not
                  const lastError = c.lastError && c.lastError !== why && c.state !== 'connected' ? c.lastError : '';
                  return (
                    <article key={p.id} className={cx('card integrations-card', c.state === 'connected' && 'on')} data-provider={p.id} data-state={c.state} data-testid="integrations-card">
                      <header className="integrations-ch">
                        <span className="integrations-ic" aria-hidden="true"><Icon /></span>
                        <h3 className="grow">{nameOf(p)}</h3>
                        <Badge tone={TONE[c.state]}>{t('integrations.state.' + c.state)}</Badge>
                      </header>
                      <p className="small muted">{t(`integrations.what.${p.id}`)}</p>

                      {reason && <p className="small integrations-reason" data-testid="integrations-reason">{reason}</p>}
                      {!!c.missing?.length && <p className="xs dim integrations-missing">{t('integrations.missing')} {c.missing.map((m) => <code key={m}>{m}</code>)}</p>}
                      {c.state === 'pending_approval' && c.approval?.note && <p className="xs dim">{c.approval.note}</p>}

                      {(c.account || c.connectedAt || !!c.scopes?.length || c.lastSyncAt || lastError) && (
                        <dl className="kv integrations-kv">
                          {c.account && <><dt>{t('integrations.account')}</dt><dd data-testid="integrations-account">{c.account}</dd></>}
                          {c.connectedAt && <><dt>{t('integrations.connectedAt')}</dt><dd>{dateTime(c.connectedAt)}{c.by && actorName(data, c.by) ? ` · ${actorName(data, c.by)}` : ''}</dd></>}
                          {!!c.scopes?.length && <><dt>{t('integrations.scopes')}</dt><dd className="integrations-scopes">{c.scopes.map((s) => <code key={s}>{s}</code>)}</dd></>}
                          {c.lastSyncAt && <><dt>{t('integrations.lastSync')}</dt><dd>{dateTime(c.lastSyncAt)}</dd></>}
                          {lastError && <><dt>{t('integrations.lastError')}</dt><dd className="neg">{reasonText(lastError)}</dd></>}
                        </dl>
                      )}
                      {p.modes && (
                        <p className="xs integrations-mode">
                          <LuFlaskConical aria-hidden="true" />
                          {mode ? <Badge tone={mode === 'sandbox' ? 'warn' : 'ok'}>{t('integrations.mode.' + mode)}</Badge> : <span className="dim">{t('integrations.mode.unknown')}</span>}
                          {mode === 'sandbox' && <span className="dim">{t('integrations.mode.sandboxNote')}</span>}
                        </p>
                      )}

                      {res && <p className={cx('small integrations-result', res.tone === 'ok' ? 'pos' : res.tone === 'bad' ? 'neg' : 'muted')} role="status" data-testid="integrations-result" data-tone={res.tone}>{res.text}</p>}

                      <div className="integrations-actions">
                        {write && canConnect && <Button size="sm" variant={c.state === 'setup' || c.state === 'reauth' ? 'primary' : 'default'} icon={<LuPlug />} disabled={!!busy} onClick={() => run(p, 'connect')} data-testid="integrations-connect">{t(c.state === 'setup' || c.reason === 'sample' ? 'integrations.connect' : 'integrations.reconnect')}{mine && busy?.what === 'connect' ? '…' : ''}</Button>}
                        {write && (c.state === 'connected' || c.state === 'attention' || c.state === 'error') && <Button size="sm" icon={<LuActivity />} disabled={!!busy} onClick={() => run(p, 'test')} data-testid="integrations-test">{t('integrations.test')}{mine && busy?.what === 'test' ? '…' : ''}</Button>}
                        {write && own && (c.state === 'connected' || c.state === 'attention') && <Button size="sm" icon={<LuRefreshCw />} disabled={!!busy} onClick={() => run(p, 'sync')} data-testid="integrations-sync">{t('integrations.sync')}{mine && busy?.what === 'sync' ? '…' : ''}</Button>}
                        {write && row && <Button size="sm" variant="ghost" icon={<LuUnplug />} disabled={!!busy} onClick={() => run(p, 'disconnect')} data-testid="integrations-disconnect">{t('integrations.disconnect')}</Button>}
                        <button type="button" className="linkbtn small integrations-more" aria-expanded={open === p.id} aria-controls={'need-' + p.id} onClick={() => setOpen(open === p.id ? null : p.id)} data-testid="integrations-needs">
                          {t('integrations.needs')}<LuChevronDown aria-hidden="true" className={open === p.id ? 'up' : undefined} />
                        </button>
                      </div>

                      {open === p.id && (
                        <div className="integrations-need" id={'need-' + p.id} data-testid="integrations-need">
                          <p className="xs strong">{t('integrations.needs.title', { name: nameOf(p) })}</p>
                          <ul>{Array.from({ length: p.needs }, (_, i) => <li key={i}>{t(`integrations.need.${p.id}.${i + 1}`)}</li>)}</ul>
                          <p className="xs dim">{t('integrations.needs.note')}</p>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <Note><LuShieldCheck aria-hidden="true" className="integrations-shield" /> {t('integrations.security')}</Note>

      {asking && <IdentityCheck onDone={answered} />}
    </>
  );
}

/* ---------- "confirm it is you", asked by the server before a connection is made or removed ---------- */
function IdentityCheck({ onDone }: { onDone: (ok: boolean) => void }) {
  const { t } = useApp();
  // someone who signed in with a second step confirms with a code from their authenticator; anyone else with their password
  const [mode, setMode] = useState<'code' | 'password'>(session()?.aal === 'aal2' ? 'code' : 'password');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const field = useRef<HTMLInputElement>(null);
  // what was typed never stays in memory longer than the request: the field is emptied when the dialog closes
  useEffect(() => () => { if (field.current) field.current.value = ''; }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = field.current?.value ?? ''; if (!value || busy) return;
    setBusy(true); setErr('');
    try {
      const out = await authGateway().stepUp(mode === 'code' ? { code: value.trim() } : { password: value });
      if (field.current) field.current.value = '';
      if (out.ok) { onDone(true); return; }
      if (out.reason === 'code_required') { setMode('code'); setErr(t('integrations.identity.codeRequired')); }
      else setErr(t(out.reason === 'locked' || out.reason === 'rate_limited' ? 'integrations.identity.locked' : out.reason === 'offline' ? 'integrations.reason.offline' : 'integrations.identity.wrong'));
    } catch { setErr(t('integrations.reason.unavailable')); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={t('integrations.identity.title')} onClose={() => onDone(false)} size="narrow" labelClose={t('common.cancel')}>
      <form onSubmit={submit} className="stack tight" data-testid="integrations-identity">
        <p className="small">{t('integrations.identity.text')}</p>
        <div className={cx('field', err && 'err')}>
          <label htmlFor="int-identity">{t(mode === 'code' ? 'integrations.identity.code' : 'integrations.identity.password')}</label>
          <input id="int-identity" ref={field} type={mode === 'code' ? 'text' : 'password'} inputMode={mode === 'code' ? 'numeric' : undefined} autoComplete={mode === 'code' ? 'one-time-code' : 'current-password'} data-autofocus />
        </div>
        {err && <p className="small neg" role="alert">{err}</p>}
        <div className="row"><span className="grow" /><Button variant="ghost" onClick={() => onDone(false)}>{t('common.cancel')}</Button><Button variant="primary" type="submit" disabled={busy}>{t('integrations.identity.confirm')}</Button></div>
      </form>
    </Modal>
  );
}
