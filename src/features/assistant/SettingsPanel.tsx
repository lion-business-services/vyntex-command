// Settings section: whether the company uses the assistant at all. Off means off everywhere: no menu entry, no mention in
// the search box or the command palette, and no record is read by it or sent to an AI model.
// Shown at /settings/assistant once the section list (src/features/settings/panels.ts) names it.
import { LuSparkles } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { mutate } from '@/store/store';
import { Badge, Button, Card, Note, toast } from '@/ui';
import { assistantOn, setAssistant } from './deploy';

export default function AssistantSettings() {
  const { t, data, pack, can } = useApp();
  const on = assistantOn(data, pack);
  const may = can('config') && can('write');
  const flip = () => { mutate((d) => setAssistant(d, !on), 'config'); toast(t(on ? 'asst.set.saved.off' : 'asst.set.saved.on')); };
  return (
    <Card title={<><LuSparkles aria-hidden="true" /> {t('asst.set.title')}</>}>
      <div className="stack" data-testid="asst-settings" data-on={on}>
        <p className="small muted">{t('asst.set.about')}</p>
        <div className="row between">
          <span className="row tight"><Badge tone={on ? 'ok' : 'neutral'}>{t(on ? 'asst.set.on' : 'asst.set.off')}</Badge></span>
          {may && <Button variant={on ? 'default' : 'primary'} onClick={flip} data-testid="asst-settings-toggle">{t(on ? 'asst.set.turnOff' : 'asst.set.turnOn')}</Button>}
        </div>
        {!on && <p className="small muted">{t('asst.set.offNote')}</p>}
        <Note>{t('asst.set.modelNote')}</Note>
      </div>
    </Card>
  );
}
