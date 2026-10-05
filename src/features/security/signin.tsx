// Sign-in security: the company's rules (which roles must use the second sign-in step, when an idle session ends, how a
// tax ID reveal is approved) and the viewer's own sign-in (second step, recovery codes, sign out everywhere).
// The pages where a person sets up or replaces their authenticator belong to the sign-in module (/mfa); this screen shows
// the state and links to them. In a sample workspace nobody is signed in, so the personal part is shown as a labelled sample.
import { useEffect, useState } from 'react';
import { LuKeyRound, LuLogOut, LuShieldCheck, LuTimer } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Link, navigate } from '@/app/router';
import { DemoTag } from '@/app/shared';
import { act } from '@/store/store';
import { Badge, Button, Card, Note, confirmDialog, cx, toast } from '@/ui';
import type { OfficeRole } from '@/domain/types';
import { OFFICE_ROLES } from '@/domain/permissions';
import { roleLabel, vaultRules } from '@/domain/config';
import { setSecurityRules, setVaultRules } from '@/domain/actions';
import { IDLE_MAX, IDLE_MIN, approversFor } from '@/domain/actions/security';
import { fetchSession } from '@/platform/live/auth';
import { ops } from './ops';
import { signInRules } from './rules';
import { SampleNote, sampleWord } from './parts';

const IDLE_CHOICES = [15, 30, 45, 60, 120, 240, 480, 720];
const SECONDS_CHOICES = [15, 30, 45, 60, 90, 120, 180, 300];

function Switch({ on, onChange, label, disabled, testId }: { on: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean; testId?: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="security-switch" disabled={disabled} onClick={() => onChange(!on)} data-testid={testId}><span aria-hidden="true" /></button>;
}

export function SignInSection() {
  const { t, data, pack, lang, can, user, live } = useApp();
  const rules = signInRules(data);
  // the database lets only an owner change who must use the second step and how reveals are approved
  const mayEdit = can('config') && can('write') && user?.role === 'owner';
  const [roles, setRoles] = useState<OfficeRole[]>(rules.mfaRoles);
  const [idle, setIdle] = useState(rules.idleMinutes);
  useEffect(() => { setRoles(rules.mfaRoles); setIdle(rules.idleMinutes); }, [rules.mfaRoles.join(','), rules.idleMinutes]);
  const dirty = roles.join(',') !== rules.mfaRoles.join(',') || idle !== rules.idleMinutes;
  const allFixed = OFFICE_ROLES.every((r) => rules.fixed.includes(r));
  const save = () => { act(setSecurityRules, { idleMinutes: idle, mfaRoles: roles }, rules.fixed); toast(t('security.signin.saved')); };
  const idleChoices = [...new Set([...IDLE_CHOICES, rules.idleMinutes])].filter((m) => m >= IDLE_MIN && m <= IDLE_MAX).sort((a, b) => a - b);
  const minutes = (m: number) => (m >= 60 && m % 60 === 0 ? t('security.signin.hours', { n: m / 60 }) : t('security.signin.minutes', { n: m }));

  return (
    <>
      <Card title={t('security.signin.rulesTitle')}>
        <p className="muted security-lead">{t(allFixed ? 'security.signin.rulesIntroFixed' : 'security.signin.rulesIntro')}</p>
        <div className="list" data-testid="security-mfa-roles">
          {OFFICE_ROLES.map((r) => {
            const fixed = rules.fixed.includes(r); const on = roles.includes(r);
            const count = data.users.filter((u) => u.role === r && u.active !== false).length;
            return (
              <div className="item security-rule" key={r} data-role={r}>
                <LuShieldCheck aria-hidden="true" className={cx('security-ic', on && 'on')} />
                <div className="grow">
                  <div className="t">{roleLabel(data, pack, r, lang)} {fixed ? <Badge tone="accent" outline>{t('security.signin.fixed')}</Badge> : <Badge tone={on ? 'ok' : 'neutral'}>{t(on ? 'security.signin.required' : 'security.signin.optional')}</Badge>}</div>
                  <div className="small muted">{t('security.signin.people', { n: count })}</div>
                </div>
                {!fixed && mayEdit && <Switch on={on} onChange={(next) => setRoles((cur) => OFFICE_ROLES.filter((x) => (x === r ? next : cur.includes(x))))} label={`${t('security.signin.requireFor')}: ${roleLabel(data, pack, r, lang)}`} testId={`security-mfa-${r}`} />}
              </div>
            );
          })}
        </div>
        <div className="security-setting">
          <div><b><LuTimer aria-hidden="true" /> {t('security.signin.idle')}</b><p className="small muted">{t('security.signin.idleHint')}</p></div>
          {mayEdit
            ? <select className="input security-select" value={idle} onChange={(e) => setIdle(Number(e.target.value))} aria-label={t('security.signin.idle')} data-testid="security-idle">{idleChoices.map((m) => <option key={m} value={m}>{minutes(m)}</option>)}</select>
            : <b data-testid="security-idle-value">{minutes(rules.idleMinutes)}</b>}
        </div>
        {mayEdit && (
          <div className="card-foot">
            <span className={cx('small', dirty ? 'strong' : 'muted')}>{t(dirty ? 'settings.biz.unsaved' : 'settings.biz.upToDate')}</span>
            <div className="row">
              {dirty && <Button variant="ghost" onClick={() => { setRoles(rules.mfaRoles); setIdle(rules.idleMinutes); }}>{t('settings.biz.discard')}</Button>}
              <Button variant="primary" onClick={save} disabled={!dirty} data-testid="security-signin-save">{t('settings.biz.save')}</Button>
            </div>
          </div>
        )}
        {!mayEdit && <p className="xs dim security-foot">{t('security.signin.ownerOnly')}</p>}
      </Card>

      <VaultRulesCard mayEdit={mayEdit} />
      <MySignIn />
      {!live && <SampleNote>{t('security.signin.sample', { sample: sampleWord(t) })}</SampleNote>}
    </>
  );
}

/* ---------- how a tax ID reveal is approved ---------- */
function VaultRulesCard({ mayEdit }: { mayEdit: boolean }) {
  const { t, data, pack } = useApp();
  const saved = vaultRules(data);
  const [approval, setApproval] = useState(saved.approval);
  const [seconds, setSeconds] = useState(saved.revealSeconds);
  useEffect(() => { setApproval(saved.approval); setSeconds(saved.revealSeconds); }, [saved.approval, saved.revealSeconds]);
  const dirty = approval !== saved.approval || seconds !== saved.revealSeconds;
  const approvers = approversFor(data, pack);
  const choices = [...new Set([...SECONDS_CHOICES, saved.revealSeconds])].sort((a, b) => a - b);
  return (
    <Card title={t('security.vault.title')}>
      <p className="muted security-lead">{t('security.vault.intro')}</p>
      <div className="security-options" role="radiogroup" aria-label={t('security.vault.title')}>
        {(['second_person', 'step_up'] as const).map((k) => (
          <label key={k} className={cx('security-option', approval === k && 'on')}>
            <input type="radio" name="security-vault-approval" checked={approval === k} disabled={!mayEdit} onChange={() => setApproval(k)} data-testid={`security-vault-${k}`} />
            <span><b>{t('security.vault.' + k)}</b><span className="small muted">{t('security.vault.' + k + '.d')}</span></span>
          </label>
        ))}
      </div>
      {approval === 'second_person' && approvers.length < 2 && <Note tone="warn">{t('security.vault.fewApprovers', { n: approvers.length })}</Note>}
      <div className="security-setting">
        <div><b>{t('security.vault.seconds')}</b><p className="small muted">{t('security.vault.secondsHint')}</p></div>
        {mayEdit
          ? <select className="input security-select" value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} aria-label={t('security.vault.seconds')} data-testid="security-vault-seconds">{choices.map((s) => <option key={s} value={s}>{t('security.vault.sec', { n: s })}</option>)}</select>
          : <b>{t('security.vault.sec', { n: saved.revealSeconds })}</b>}
      </div>
      {mayEdit && (
        <div className="card-foot">
          <span className={cx('small', dirty ? 'strong' : 'muted')}>{t(dirty ? 'settings.biz.unsaved' : 'settings.biz.upToDate')}</span>
          <div className="row">
            {dirty && <Button variant="ghost" onClick={() => { setApproval(saved.approval); setSeconds(saved.revealSeconds); }}>{t('settings.biz.discard')}</Button>}
            <Button variant="primary" disabled={!dirty} onClick={() => { act(setVaultRules, { approval, revealSeconds: seconds }); toast(t('security.vault.saved')); }} data-testid="security-vault-save">{t('settings.biz.save')}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ---------- my own sign-in ---------- */
interface Mine { enrolled: boolean; required: boolean; codes: number }

function MySignIn() {
  const { t, data, user, live } = useApp();
  const rules = signInRules(data);
  const [mine, setMine] = useState<Mine | null>(null);
  const [failed, setFailed] = useState(false);
  // a live workspace asks the server; a background question, so it does not count as activity
  useEffect(() => {
    if (!live) return;
    let on = true;
    fetchSession(true).then((s) => { if (!on) return; if (s?.mfa) setMine({ enrolled: s.mfa.enrolled, required: s.mfa.required, codes: s.mfa.recoveryCodesLeft }); else setFailed(true); }, () => { if (on) setFailed(true); });
    return () => { on = false; };
  }, [live]);
  // the sample shows the state of the sample person being viewed, labelled as a sample
  const shown: Mine | null = live ? mine : user ? { enrolled: !!user.mfa, required: rules.mfaRoles.includes(user.role), codes: 0 } : null;

  const everywhere = async () => {
    if (!live) { toast(t('security.me.outSample')); return; }
    if (!(await confirmDialog(t('security.me.outConfirm'), t('security.me.out'), t('common.cancel')))) return;
    if (await ops.signOutAll()) navigate('/signin'); else toast(t('security.reason.offline'), true);
  };
  return (
    <Card title={t('security.me.title')} actions={!live ? <DemoTag kind="preview" /> : undefined}>
      {!shown ? <p className="muted small">{t(failed ? 'security.me.unknown' : 'common.loading')}</p> : (
        <div className="list" data-testid="security-me">
          <div className="item security-rule">
            <LuShieldCheck aria-hidden="true" className={cx('security-ic', shown.enrolled && 'on')} />
            <div className="grow">
              <div className="t">{t('security.me.second')} <Badge tone={shown.enrolled ? 'ok' : shown.required ? 'warn' : 'neutral'}>{t(shown.enrolled ? 'security.people.mfa.on' : shown.required ? 'security.people.mfa.due' : 'security.people.mfa.off')}</Badge></div>
              <div className="small muted">{t(shown.enrolled ? 'security.me.secondOn' : shown.required ? 'security.me.secondDue' : 'security.me.secondOff')}</div>
            </div>
            {live && <Link to="/mfa" className="btn sm" data-testid="security-me-mfa">{t(shown.enrolled ? 'security.me.replace' : 'security.me.setup')}</Link>}
          </div>
          <div className="item security-rule">
            <LuKeyRound aria-hidden="true" className="security-ic" />
            <div className="grow">
              <div className="t">{t('security.me.codes')} {live && shown.enrolled && <Badge tone={shown.codes <= 2 ? 'warn' : 'neutral'}>{t('security.me.codesLeft', { n: shown.codes })}</Badge>}</div>
              <div className="small muted">{t(live ? (shown.enrolled ? 'security.me.codesHint' : 'security.me.codesNone') : 'security.me.codesSample')}</div>
            </div>
          </div>
          <div className="item security-rule">
            <LuLogOut aria-hidden="true" className="security-ic" />
            <div className="grow">
              <div className="t">{t('security.me.out')}</div>
              <div className="small muted">{t('security.me.outHint')}</div>
            </div>
            <Button size="sm" onClick={everywhere} data-testid="security-me-out">{t('security.me.out')}</Button>
          </div>
        </div>
      )}
      {!live && <p className="xs dim security-foot">{t('security.me.sample')}</p>}
    </Card>
  );
}
