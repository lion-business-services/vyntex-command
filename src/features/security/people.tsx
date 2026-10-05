// People and access: who can sign in, with which role, from which offices, whether they use the second sign-in step, and
// where each invitation stands. There is no public sign-up anywhere in the product: a person exists because someone with
// the `users` capability invited them, and the invitation is sent by the server, never shown to the inviter.
// Every change here is a protected operation (invite, change role, switch off): the server checks each one, asks for a
// fresh identity check where it wants one, and writes it to the audit trail. The same card is the "Team" section of Settings.
import { useEffect, useState } from 'react';
import { LuEllipsis, LuMailPlus, LuRotateCcw, LuUserCheck, LuUserPlus, LuUserX, LuX } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { Avatar, Badge, Button, Card, Field, IconButton, Menu, Modal, confirmDialog, cx, toast } from '@/ui';
import type { Lang, OfficeRole, TeamUser } from '@/domain/types';
import { OFFICE_ROLES } from '@/domain/permissions';
import { roleLabel } from '@/domain/config';
import { INVITE_HOURS, memberState, type InviteState } from '@/domain/actions/security';
import { DEPLOY } from '@/config/deployment';
import { defaultLang } from '@/features/settings/actions';
import { ops } from './ops';
import { signInRules } from './rules';
import { SampleNote, reasonText, sampleWord } from './parts';

const hoursLeft = (u: TeamUser) => (u.invitedAt ? Math.max(0, Math.ceil((new Date(u.invitedAt).getTime() + INVITE_HOURS * 3600000 - Date.now()) / 3600000)) : 0);
const STATE_ORDER: Record<InviteState, number> = { member: 0, invited: 1, invite_expired: 2, disabled: 3 };

/** `note` adds the sample label under the card, for a page that does not already carry one. */
export function PeopleCard({ ids = 'security', note }: { ids?: 'security' | 'settings'; note?: boolean }) {
  const { t, data, pack, lang, can, user, live, dateTime } = useApp();
  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState('');
  const mayManage = can('users') && can('write');
  const rules = signInRules(data);
  const profiles = pack.family === 'practice' && can('team');
  const activeOwners = data.users.filter((u) => u.role === 'owner' && u.active !== false);
  const lastOwner = (u: TeamUser) => u.role === 'owner' && activeOwners.length === 1 && activeOwners[0].id === u.id;
  const people = [...data.users].sort((a, b) => STATE_ORDER[memberState(a)] - STATE_ORDER[memberState(b)]);
  const officeNames = (u: TeamUser) => (u.officeIds ?? []).map((id) => data.offices.find((o) => o.id === id)?.name).filter(Boolean).join(', ');

  const run = async (id: string, what: () => Promise<{ ok: boolean; reason?: string }>, done: string) => {
    setBusy(id);
    const res = await what();
    setBusy('');
    toast(res.ok ? done : reasonText(t, res.reason ?? ''), !res.ok);
  };
  const setRole = (u: TeamUser, role: OfficeRole) => run(u.id, () => ops.memberSetRole(u.id, role), t('security.people.roleSaved', { name: u.name, role: roleLabel(data, pack, role, lang) }));
  const disable = async (u: TeamUser) => {
    if (!(await confirmDialog(t('security.people.disableConfirm', { name: u.name }), t('security.people.disable'), t('common.cancel')))) return;
    void run(u.id, () => ops.memberDisable(u.id), t('security.people.disabled', { name: u.name }));
  };
  const revoke = async (u: TeamUser) => {
    if (!(await confirmDialog(t('security.people.revokeConfirm', { name: u.name }), t('security.people.revoke'), t('common.cancel')))) return;
    void run(u.id, () => ops.inviteRevoke(u.id), t('security.people.revoked', { name: u.name }));
  };

  return (
    <>
      <Card flush title={t('security.people.title')} actions={mayManage ? <Button variant="primary" size="sm" icon={<LuUserPlus aria-hidden="true" />} onClick={() => setInviting(true)} data-testid={`${ids}-user-add`}>{t('security.people.invite')}</Button> : undefined}>
        <p className="muted security-pad security-lead">{t('security.people.intro')}</p>
        <div className="table-wrap">
          <table className="tbl stackable security-people" data-testid={`${ids}-users`}>
            <thead><tr>
              <th>{t('common.name')}</th><th>{t('security.people.role')}</th>{data.offices.length > 0 && <th>{t('security.people.offices')}</th>}
              <th>{t('security.people.second')}</th><th>{t('security.people.seen')}</th><th><span className="sr">{t('common.actions')}</span></th>
            </tr></thead>
            <tbody>
              {people.map((u) => {
                const state = memberState(u);
                const required = rules.mfaRoles.includes(u.role);
                const self = u.id === user?.id;
                const locked = lastOwner(u) || (u.role === 'owner' && user?.role !== 'owner') || state !== 'member';
                return (
                  <tr key={u.id} data-user={u.id} data-state={state} className={cx(state === 'disabled' && 'security-off')}>
                    <td className="t1">
                      <span className="security-who"><Avatar name={u.name} size="sm" />
                        <span className="grow">
                          {profiles && state === 'member' ? <A to={`/team/${u.id}`} className="security-name">{u.name}</A> : <span className="security-name">{u.name}</span>}
                          {self && <> <Badge outline>{t('security.people.you')}</Badge></>}
                          {state === 'invited' && <> <Badge tone="info">{t('security.people.st.invited')}</Badge></>}
                          {state === 'invite_expired' && <> <Badge tone="warn">{t('security.people.st.invite_expired')}</Badge></>}
                          {state === 'disabled' && <> <Badge outline>{t('security.people.st.disabled')}</Badge></>}
                          <span className="xs dim security-sub">{u.email}</span>
                        </span>
                      </span>
                    </td>
                    <td data-label={t('security.people.role')}>
                      {mayManage ? (
                        <select className="input security-role" value={u.role} onChange={(e) => setRole(u, e.target.value as OfficeRole)} disabled={locked || busy === u.id}
                          aria-label={`${t('security.people.role')}: ${u.name}`} title={lastOwner(u) ? t('security.people.lastOwner') : undefined} data-testid={`${ids}-user-role`}>
                          {OFFICE_ROLES.filter((r) => r !== 'owner' || user?.role === 'owner' || u.role === 'owner').map((r) => <option key={r} value={r}>{roleLabel(data, pack, r, lang)}</option>)}
                        </select>
                      ) : roleLabel(data, pack, u.role, lang)}
                      {mayManage && lastOwner(u) && <span className="xs dim security-sub">{t('security.people.lastOwner')}</span>}
                    </td>
                    {data.offices.length > 0 && <td data-label={t('security.people.offices')}>{officeNames(u) || <span className="dim">{t('security.people.noOffice')}</span>}</td>}
                    <td data-label={t('security.people.second')}>
                      {state !== 'member' ? <span className="dim">{t('security.people.notYet')}</span>
                        : live && u.mfa === undefined ? <Badge tone={required ? 'accent' : 'neutral'} outline>{t(required ? 'security.people.mfa.required' : 'security.people.mfa.optional')}</Badge>
                        : u.mfa ? <Badge tone="ok">{t('security.people.mfa.on')}</Badge>
                        : required ? <Badge tone="warn">{t('security.people.mfa.due')}</Badge>
                        : <Badge>{t('security.people.mfa.off')}</Badge>}
                    </td>
                    <td data-label={t('security.people.seen')} className="small">
                      {state === 'invited' ? t('security.people.expiresIn', { hours: hoursLeft(u) })
                        : state === 'invite_expired' ? <span className="dim">{t('security.people.expired')}</span>
                        : u.lastSeen ? dateTime(u.lastSeen) : <span className="dim">{t('security.people.never')}</span>}
                    </td>
                    <td className="num security-act">
                      {mayManage && !(state === 'member' && (self || lastOwner(u))) && (
                        <Menu label={`${t('common.actions')}: ${u.name}`} button={<IconButton size="sm" label={`${t('common.actions')}: ${u.name}`} data-testid={`${ids}-user-menu`}><LuEllipsis /></IconButton>}>
                          {state === 'member' && <button type="button" role="menuitem" onClick={() => disable(u)} data-testid={`${ids}-user-disable`}><LuUserX aria-hidden="true" />{t('security.people.disable')}</button>}
                          {state === 'disabled' && <button type="button" role="menuitem" onClick={() => run(u.id, () => ops.memberEnable(u.id), t('security.people.enabled', { name: u.name }))} data-testid={`${ids}-user-enable`}><LuUserCheck aria-hidden="true" />{t('security.people.enable')}</button>}
                          {(state === 'invited' || state === 'invite_expired') && <>
                            <button type="button" role="menuitem" onClick={() => run(u.id, () => ops.inviteResend(u.id), t(live ? 'security.people.resent' : 'security.people.resentSample', { name: u.name }))} data-testid={`${ids}-user-resend`}><LuRotateCcw aria-hidden="true" />{t('security.people.resend')}</button>
                            <button type="button" role="menuitem" onClick={() => revoke(u)} data-testid={`${ids}-user-revoke`}><LuX aria-hidden="true" />{t('security.people.revoke')}</button>
                          </>}
                        </Menu>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="xs dim security-pad">{t('security.people.noSignup')}</p>
      </Card>
      {!live && note && <SampleNote>{t('security.people.sample', { sample: sampleWord(t) })}</SampleNote>}
      {inviting && <InviteModal onClose={() => setInviting(false)} />}
    </>
  );
}

function InviteModal({ onClose }: { onClose: () => void }) {
  const { t, data, pack, lang, user, live } = useApp();
  // the invitation is written in the company's default language unless the inviter picks another
  const [f, setF] = useState({ name: '', email: '', role: 'staff' as OfficeRole, title: '', lang: (defaultLang(data) || lang) as Lang });
  const [offices, setOffices] = useState<string[]>(() => { const main = data.offices.find((o) => o.main); return main ? [main.id] : []; });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setErr(''); }, [f, offices]);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) { setErr(t('security.invite.needName')); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) { setErr(t('security.invite.badEmail')); return; }
    setBusy(true);
    const res = await ops.memberInvite({ name: f.name, email: f.email, role: f.role, title: f.title || undefined, officeIds: offices.length ? offices : undefined, lang: f.lang });
    setBusy(false);
    if (!res.ok) { setErr(res.reason === 'conflict' ? t('security.invite.taken') : reasonText(t, res.reason)); return; }
    toast(t(res.sample ? 'security.invite.sentSample' : 'security.invite.sent', { name: res.data.name, email: res.data.email, hours: INVITE_HOURS }));
    onClose();
  };
  return (
    <Modal title={t('security.people.invite')} onClose={onClose} labelClose={t('common.cancel')}>
      <form onSubmit={send} noValidate data-testid="security-invite-form">
        <div className="fgrid">
          <Field label={<>{t('common.name')}<span aria-hidden="true"> *</span></>} htmlFor="security-inv-name"><input id="security-inv-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} autoComplete="off" aria-required="true" data-autofocus data-testid="security-invite-name" /></Field>
          <Field label={<>{t('common.email')}<span aria-hidden="true"> *</span></>} htmlFor="security-inv-email"><input id="security-inv-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} maxLength={120} autoComplete="off" aria-required="true" data-testid="security-invite-email" /></Field>
          <Field label={t('security.people.role')} htmlFor="security-inv-role">
            <select id="security-inv-role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as OfficeRole })} data-testid="security-invite-role">
              {OFFICE_ROLES.filter((r) => r !== 'owner' || user?.role === 'owner').map((r) => <option key={r} value={r}>{roleLabel(data, pack, r, lang)}</option>)}
            </select>
          </Field>
          <Field label={`${t('security.invite.jobTitle')} (${t('common.optional')})`} htmlFor="security-inv-title"><input id="security-inv-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={80} /></Field>
          {data.offices.length > 0 && (
            <fieldset className="full security-checks">
              <legend className="label">{t('security.people.offices')}</legend>
              {data.offices.map((o) => (
                <label className="check" key={o.id}><input type="checkbox" checked={offices.includes(o.id)} onChange={(e) => setOffices((cur) => (e.target.checked ? [...cur, o.id] : cur.filter((x) => x !== o.id)))} /><span>{o.name}</span></label>
              ))}
            </fieldset>
          )}
          {DEPLOY.languages.length > 1 && (
            <Field label={t('security.invite.lang')} htmlFor="security-inv-lang" full>
              <select id="security-inv-lang" value={f.lang} onChange={(e) => setF({ ...f, lang: e.target.value as Lang })}>
                {DEPLOY.languages.map((code) => <option key={code} value={code}>{t('lang.' + code)}</option>)}
              </select>
            </Field>
          )}
        </div>
        {err && <p className="small neg" role="alert" style={{ marginTop: 10 }} data-testid="security-invite-error">{err}</p>}
        <p className="small muted security-invite-how"><LuMailPlus aria-hidden="true" />{t('security.invite.how', { hours: INVITE_HOURS })}</p>
        {!live && <SampleNote>{t('security.invite.sample', { sample: sampleWord(t) })}</SampleNote>}
        <div className="modal-f" style={{ margin: '18px -18px -18px' }}>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" disabled={busy} data-testid="security-invite-send">{t('security.invite.send')}</Button>
        </div>
      </form>
    </Modal>
  );
}
