// Automatic emails, language and appearance, and your data.
import { LuArrowRight, LuDownload, LuRotateCcw } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, PREVIEW } from '@/app/router';
import { DemoTag, PlanBadge } from '@/app/shared';
import { mutate, resetDemo, setLanguage, setPrefs } from '@/store/store';
import { Badge, Button, Card, Note, Seg, confirmDialog, toast } from '@/ui';
import { RULES } from '@/domain/automations';
import { planName } from '@/lib/pricing';
import { today } from '@/lib/dates';
import type { Lang } from '@/domain/types';
import { downloadFile, emailSendingRule } from './helpers';

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
  const { t, prefs, lang } = useApp();
  return (
    <Card title={t('settings.look.title')}>
      <div className="settings-prefs">
        <div>
          <div className="label">{t('demo.language')}</div>
          <Seg<Lang> label={t('demo.language')} value={lang} onChange={(v) => setLanguage(v)} options={[{ value: 'en', label: <span data-testid="settings-lang-en">{t('settings.look.en')}</span> }, { value: 'es', label: <span data-testid="settings-lang-es">{t('settings.look.es')}</span> }]} />
          <p className="xs dim settings-hint">{t('settings.look.langHint')}</p>
        </div>
        <div>
          <div className="label">{t('demo.theme')}</div>
          <Seg<'dark' | 'light'> label={t('demo.theme')} value={prefs.theme} onChange={(v) => setPrefs({ theme: v })} options={[{ value: 'dark', label: <span data-testid="settings-theme-dark">{t('demo.dark')}</span> }, { value: 'light', label: <span data-testid="settings-theme-light">{t('demo.light')}</span> }]} />
          <p className="xs dim settings-hint">{t('settings.look.themeHint')}</p>
        </div>
      </div>
    </Card>
  );
}

/* ---------- your data ---------- */
export function DataSection() {
  const { t, data, pack } = useApp();
  const counts: [string, number][] = [
    [t('nav.leads'), data.leads.length], [t('nav.clients'), data.clients.length], [t('nav.jobs'), data.jobs.length], [t('nav.tasks'), data.tasks.length],
    [t('nav.team'), data.workers.length], [t('nav.documents'), data.docs.length], [t('nav.messages'), data.messages.length],
    [t('settings.data.payments'), data.workerPays.length + data.jobs.reduce((n, j) => n + j.received.length, 0)],
  ];
  const download = () => {
    downloadFile(`vyntex-demo-${pack.id}-${today()}.json`, JSON.stringify(data, null, 2));
    if (!PREVIEW) toast(t('settings.data.downloaded'));
  };
  const reset = async () => {
    if (!(await confirmDialog(t('demo.resetConfirm'), t('demo.reset'), t('common.cancel'), false))) return;
    resetDemo(); toast(t('demo.resetDone'));
  };
  return (
    <>
      <Card title={t('settings.data.title')}>
        <p className="muted settings-lead">{t('settings.data.intro', { company: data.company.name })}</p>
        <dl className="settings-counts" data-testid="settings-counts">{counts.map(([k, n]) => <div key={k}><dt>{k}</dt><dd>{n}</dd></div>)}</dl>
        <div className="settings-actions">
          <div>
            <b>{t('settings.data.downloadTitle')}</b>
            <p className="small muted">{t('settings.data.downloadText')}</p>
          </div>
          <Button icon={<LuDownload aria-hidden="true" />} onClick={download} data-testid="settings-export">{t('settings.data.download')}</Button>
        </div>
        <div className="settings-actions">
          <div>
            <b>{t('demo.reset')}</b>
            <p className="small muted">{t('settings.data.resetText')}</p>
          </div>
          <Button variant="danger" icon={<LuRotateCcw aria-hidden="true" />} onClick={reset} data-testid="settings-reset">{t('demo.reset')}</Button>
        </div>
      </Card>
      <Card title={t('settings.data.whereTitle')}>
        <p>{t('settings.data.where')}</p>
      </Card>
    </>
  );
}
