// Automatic emails, language and appearance, and data and privacy.
import { useState } from 'react';
import { LuArrowRight, LuDownload, LuFileDown, LuRotateCcw } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, PREVIEW } from '@/app/router';
import { DemoTag, PlanBadge } from '@/app/shared';
import { act, mutate, resetDemo, setLanguage, setPrefs } from '@/store/store';
import { Badge, Button, Card, Note, Seg, confirmDialog, toast } from '@/ui';
import { RULES } from '@/domain/automations';
import { planName } from '@/lib/pricing';
import { today } from '@/lib/dates';
import type { Lang } from '@/domain/types';
import { DEPLOY } from '@/config/deployment';
import type { ExportKind } from '@/platform/gateway';
import type { Permission } from '@/domain/permissions';
import { ops, saveFile } from '@/features/security/ops';
import { reasonText } from '@/features/security/parts';
import { StepUpHost } from '@/features/security/stepup';
import { downloadFile, emailSendingRule } from './helpers';
import { defaultLang, setDefaultLang } from './actions';

function Switch({ on, onChange, label, testId }: { on: boolean; onChange: (next: boolean) => void; label: string; testId?: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="settings-switch" onClick={() => onChange(!on)} data-testid={testId}><span aria-hidden="true" /></button>;
}

/* ---------- automatic client emails: one switch per rule, the same switch as on the Automations page ---------- */
export function EmailsSection() {
  const { t, data, pack, lang, standing } = useApp();
  const rules = RULES.filter((r) => r.entitlement === 'clientEmails');
  const s = standing('clientEmails');
  const rule = emailSendingRule(pack.id, lang, t);
  const optedOut = data.clients.filter((c) => c.emailOptOut).length;
  const isOn = (id: string) => data.automation.enabled[id] !== false;
  const lines = (id: string, n: number) => Array.from({ length: n }, (_, i) => t(`auto.${id}.then${i + 1}`));
  return (
    <>
      <Card title={t('settings.emails.title')} actions={<><PlanBadge feature="clientEmails" detail /><DemoTag /></>}>
        <p className="muted settings-lead">{t('settings.emails.intro')}</p>
        {s.state === 'upgrade' && s.plan && <Note tone="warn">{t('ent.upgradeHint', { plan: planName(s.plan, lang) })} {t('settings.emails.upgradeDemo')}</Note>}
        <div className="list" data-testid="settings-email-rules">
          {rules.map((r) => {
            const on = isOn(r.id);
            return (
              <div className="item settings-rule" key={r.id} data-rule={r.id}>
                <div className="grow">
                  <div className="t">{t(`auto.${r.id}.name`)} <Badge tone={on ? 'ok' : 'neutral'}>{t(on ? 'auto.on' : 'auto.off')}</Badge></div>
                  <div className="small muted">{t('auto.when')}: {t(`auto.${r.id}.when`)}</div>
                  <div className="xs dim">{t('auto.then')}: {lines(r.id, r.thens).join(' · ')}</div>
                </div>
                <Switch on={on} label={`${t(on ? 'auto.turnOff' : 'auto.turnOn')}: ${t(`auto.${r.id}.name`)}`} testId={`settings-email-${r.id}`}
                  onChange={(next) => { mutate((d) => { d.automation.enabled[r.id] = next; }); toast(t(next ? 'settings.emails.turnedOn' : 'settings.emails.turnedOff', { name: t(`auto.${r.id}.name`) })); }} />
              </div>
            );
          })}
          {!rules.length && <p className="muted small">{t('settings.emails.none')}</p>}
        </div>
        <p className="small muted" style={{ marginTop: 12 }}>{t('settings.emails.whole')}</p>
        <div className="card-foot">
          <span className="small muted">{t('settings.emails.optOut', { n: optedOut })}</span>
          <div className="row">
            <A to="/messages" className="btn sm">{t('nav.messages')}</A>
            <A to="/automations" className="btn sm primary" data-testid="settings-open-automations">{t('settings.emails.openAuto')}<LuArrowRight aria-hidden="true" /></A>
          </div>
        </div>
      </Card>
      <Note>{t('auto.emailNote')}{rule ? ` ${rule}` : ''}</Note>
    </>
  );
}

/* ---------- language and appearance ---------- */
export function AppearanceSection() {
  const { t, data, prefs, lang, can } = useApp();
  const company = defaultLang(data);
  return (
    <>
      <Card title={t('settings.look.title')}>
        <div className="settings-prefs">
          <div>
            <div className="label">{t('demo.language')}</div>
            {/* only the languages this deployment offers */}
            <Seg<Lang> label={t('demo.language')} value={lang} onChange={(v) => setLanguage(v)} options={DEPLOY.languages.map((code) => ({ value: code, label: <span data-testid={`settings-lang-${code}`} lang={code}>{code === 'zh' ? '中文' : t('settings.look.' + code)}</span> }))} />
            <p className="xs dim settings-hint">{t('settings.look.langHint')}</p>
          </div>
          <div>
            <div className="label">{t('demo.theme')}</div>
            <Seg<'dark' | 'light'> label={t('demo.theme')} value={prefs.theme} onChange={(v) => setPrefs({ theme: v })} options={[{ value: 'dark', label: <span data-testid="settings-theme-dark">{t('demo.dark')}</span> }, { value: 'light', label: <span data-testid="settings-theme-light">{t('demo.light')}</span> }]} />
            <p className="xs dim settings-hint">{t('settings.look.themeHint')}</p>
          </div>
        </div>
        <p className="xs dim" style={{ marginTop: 14 }}>{t('settings.look.mine')}</p>
      </Card>
      {can('config') && (
        <Card title={t('settings.look.companyTitle')}>
          <div className="settings-actions" style={{ borderTop: 0, paddingTop: 0 }}>
            <div>
              <b>{t('settings.look.companyLang')}</b>
              <p className="small muted">{t('settings.look.companyLangHint')}</p>
            </div>
            <select className="input settings-select" value={company} onChange={(e) => { act(setDefaultLang, e.target.value as Lang | ''); toast(t('common.saved')); }} aria-label={t('settings.look.companyLang')} data-testid="settings-company-lang">
              <option value="">{t('settings.look.companyLangNone')}</option>
              {DEPLOY.languages.map((code) => <option key={code} value={code}>{code === 'zh' ? '中文' : t('settings.look.' + code)}</option>)}
            </select>
          </div>
          <p className="xs dim" style={{ marginTop: 12 }}>{t(DEPLOY.languages.includes('zh') ? 'settings.look.offeredZh' : 'settings.look.offered')}</p>
        </Card>
      )}
    </>
  );
}

/* ---------- data and privacy ---------- */
/** The files a person can take out, and what they must be allowed to see to take each one. */
const EXPORTS: { kind: ExportKind; label: string; need: Permission }[] = [
  { kind: 'clients', label: 'nav.clients', need: 'clients' }, { kind: 'leads', label: 'nav.leads', need: 'leads' }, { kind: 'jobs', label: 'nav.jobs', need: 'jobs' },
  { kind: 'tasks', label: 'nav.tasks', need: 'tasks' }, { kind: 'payments', label: 'nav.money', need: 'money' }, { kind: 'appointments', label: 'nav.appointments', need: 'appointments' },
];

export function DataSection() {
  const { t, data, pack, can, live } = useApp();
  const [busy, setBusy] = useState('');
  const counts: [string, number][] = [
    [t('nav.leads'), data.leads.length], [t('nav.clients'), data.clients.length], [t('nav.jobs'), data.jobs.length], [t('nav.tasks'), data.tasks.length],
    ...(pack.usesWorkers ? [[t('nav.team'), data.workers.length] as [string, number]] : []), [t('nav.documents'), data.docs.length], [t('nav.messages'), data.messages.length],
    [t('settings.data.payments'), data.workerPays.length + data.jobs.reduce((n, j) => n + j.received.length, 0)],
  ];
  const download = () => {
    downloadFile(`${DEPLOY.id === 'lbs' ? 'lbs-sample' : 'vyntex-demo'}-${pack.id}-${today()}.json`, JSON.stringify(data, null, 2));
    if (!PREVIEW) toast(t('settings.data.downloaded'));
  };
  // the public demo and a sample preview word the same reset differently (same keys as the bar at the top)
  const k = (key: string) => t((DEPLOY.publicDemo ? 'demo.' : 'demo.preview.') + key);
  const reset = async () => {
    if (!(await confirmDialog(k('resetConfirm'), k('reset'), t('common.cancel'), false))) return;
    resetDemo(); toast(k('resetDone'));
  };
  const kinds = EXPORTS.filter((e) => can(e.need) && (e.kind !== 'appointments' || pack.modules.includes('appointments')));
  const take = async (kind: ExportKind) => {
    setBusy(kind);
    const res = await ops.exportFile(kind);
    setBusy('');
    if (!res.ok) { toast(reasonText(t, res.reason), true); return; }
    if (PREVIEW) { toast(t('preview.noDownload')); return; }
    saveFile(res.data);
    toast(t(res.sample ? 'settings.data.exportedSample' : 'settings.data.exported'));
  };
  return (
    <>
      <Card title={t('settings.data.title')}>
        <p className="muted settings-lead">{t(live ? 'settings.data.introLive' : 'settings.data.intro', { company: data.company.name })}</p>
        <dl className="settings-counts" data-testid="settings-counts">{counts.map(([name, n]) => <div key={name}><dt>{name}</dt><dd>{n}</dd></div>)}</dl>
        {can('export') && kinds.length > 0 && (
          <div className="settings-actions" data-testid="settings-exports">
            <div>
              <b>{t('settings.data.exportTitle')}</b>
              <p className="small muted">{t('settings.data.exportText')}</p>
            </div>
            <div className="row settings-exportbtns">
              {kinds.map((e) => <Button key={e.kind} size="sm" icon={<LuFileDown aria-hidden="true" />} onClick={() => take(e.kind)} disabled={busy === e.kind} data-testid={`settings-export-${e.kind}`}>{t(e.label)}</Button>)}
            </div>
          </div>
        )}
        {!live && (
          <>
            <div className="settings-actions">
              <div>
                <b>{t('settings.data.downloadTitle')}</b>
                <p className="small muted">{t('settings.data.downloadText')}</p>
              </div>
              <Button icon={<LuDownload aria-hidden="true" />} onClick={download} data-testid="settings-export">{t('settings.data.download')}</Button>
            </div>
            <div className="settings-actions">
              <div>
                <b>{k('reset')}</b>
                <p className="small muted">{t('settings.data.resetText')}</p>
              </div>
              <Button variant="danger" icon={<LuRotateCcw aria-hidden="true" />} onClick={reset} data-testid="settings-reset">{k('reset')}</Button>
            </div>
          </>
        )}
      </Card>
      <Card title={t('settings.data.keepTitle')}>
        <p className="muted settings-lead">{t('settings.data.keepIntro')}</p>
        <ul className="settings-notes" data-testid="settings-retention">
          <li>{t('settings.data.keep1')}</li>
          <li>{t('settings.data.keep2')}</li>
          <li>{t('settings.data.keep3')}</li>
          <li>{t('settings.data.keep4')}</li>
        </ul>
        <p className="xs dim" style={{ marginTop: 12 }}>{t('settings.data.keepNote')}</p>
      </Card>
      <Card title={t('settings.data.whereTitle')}>
        <p>{t(live ? 'settings.data.whereLive' : 'settings.data.where')}</p>
      </Card>
      <StepUpHost />
    </>
  );
}
