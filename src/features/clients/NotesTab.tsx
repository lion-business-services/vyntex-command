// Notes and conversations kept on the client: what was said on a call, at the counter, in a message. Pinned notes stay on top.
import { useApp } from '@/app/hooks';
import { NotesPanel } from '@/app/shared';
import type { ClientTabProps } from './tabs';

export default function NotesTab({ client }: ClientTabProps) {
  const { t } = useApp();
  return (
    <div className="clients-narrow">
      <NotesPanel target={{ type: 'client', id: client.id }} notes={client.notes} />
      <p className="xs dim clients-gap">{t('clients.notes.hint')}</p>
    </div>
  );
}
