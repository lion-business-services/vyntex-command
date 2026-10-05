// Settings: which screens this company uses. Every screen of the edition is listed with one sentence on what it is for; a
// company switches off what it does not use and can switch it back on at any time. The records of a screen that is off are
// kept. The screens everything else depends on, and the ones that govern access, cannot be switched off.
import { LuLock } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { MODULES } from '@/app/modules';
import { act } from '@/store/store';
import { Badge, Card, toast } from '@/ui';
import type { ModuleId } from '@/domain/types';
import { moduleOn } from '@/domain/config';
import { CORE_MODULES, setModule } from './actions';

export default function ModulesSection() {
  const { t, data, pack } = useApp();
  // the screens of this edition, in menu order; a screen the edition does not have is arranged during setup, not here
  const list = MODULES.filter((m) => m.id !== 'dashboard' && pack.modules.includes(m.id as ModuleId) && (!m.when || m.when({ data, pack })));
  const toggle = (id: ModuleId, name: string, next: boolean) => { if (act(setModule, id, next)) toast(t(next ? 'settings.mod.on' : 'settings.mod.off', { name })); };
  return (
    <Card title={t('settings.mod.title')}>
      <p className="muted settings-lead">{t('settings.mod.intro')}</p>
      <div className="list" data-testid="settings-modules">
        {list.map((m) => {
          const id = m.id as ModuleId; const Icon = m.icon; const name = t(m.labelKey); const core = CORE_MODULES.includes(id); const on = moduleOn(data, pack, id);
          return (
            <div className="item settings-rule" key={id} data-module={id} data-on={on}>
              <span className="settings-conn-ic"><Icon aria-hidden="true" /></span>
              <div className="grow">
                <div className="t">{name} {core ? <Badge outline><LuLock aria-hidden="true" />{t('settings.mod.core')}</Badge> : <Badge tone={on ? 'ok' : 'neutral'}>{t(on ? 'auto.on' : 'auto.off')}</Badge>}</div>
                <div className="small muted">{t('settings.mod.d.' + id)}</div>
              </div>
              {!core && <button type="button" role="switch" aria-checked={on} aria-label={`${t(on ? 'settings.mod.turnOff' : 'settings.mod.turnOn')}: ${name}`} className="settings-switch" onClick={() => toggle(id, name, !on)} data-testid={`settings-module-${id}`}><span aria-hidden="true" /></button>}
            </div>
          );
        })}
      </div>
      <p className="xs dim" style={{ marginTop: 12 }}>{t('settings.mod.note')}</p>
    </Card>
  );
}
