// A client's conversations, on the client page: the same thread the inbox shows, for this one client. Every channel in
// time order, the notes kept on the record, and the place to answer. Registered in src/features/clients/tabs.ts.
import { useMemo } from 'react';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { Card } from '@/ui';
import type { ClientTabProps } from '@/features/clients/tabs';
import { conversationFor } from './model';
import { Thread } from './Thread';
import './messages.css';

export default function MessagesClientTab({ client }: ClientTabProps) {
  const { t, data, user, perms, live } = useApp();
  const conv = useMemo(() => conversationFor(data, { user, perms }, 'c_' + client.id), [data, user, perms, client.id]);
  if (!conv) return null;
  return (
    <Card className="messages-tab">
      <div className="row between messages-tabh">
        <p className="small muted">{t(live ? 'messages.ctab.intro' : 'messages.ctab.introSample')}</p>
        <A to={`/messages?c=c_${client.id}`} className="btn sm" data-testid="messages-open-inbox">{t('messages.ctab.openInbox')}</A>
      </div>
      <Thread key={conv.key} conv={conv} embedded />
    </Card>
  );
}
