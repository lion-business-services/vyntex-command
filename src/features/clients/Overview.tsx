// The first tab of a client's page. Shown alone (field editions) it is the whole page: money, work, documents, payments,
// notes, contact and history. Next to other tabs it is the summary: who the client is, who is behind the business, what
// is open, how to reach them and what they agreed to receive.
import { useApp } from '@/app/hooks';
import { NotesPanel } from '@/app/shared';
import { ClientActivity, ClientAddresses, ClientContact, ClientDocs, ClientEmails, ClientJobs, ClientLeads, ClientMoney, ClientPayments, ClientPeople, ClientPortalCard, ClientPrefs, ClientProfile } from './parts';
import type { ClientTabProps } from './tabs';

export default function Overview({ client, tabbed }: ClientTabProps) {
  const { can, pack } = useApp();
  const showMoney = can('money');
  const full = pack.family === 'practice';
  // an edition that keeps a fuller record always shows it; a field business shows the card once there is something in it
  const profile = full || !!(client.tags?.length || client.referredBy || client.lang || (client.lifecycle && client.lifecycle !== 'active') || Object.keys(client.externalIds ?? {}).length);
  return (
    <div className="split">
      <div className="stack">
        {showMoney && <ClientMoney client={client} />}
        {profile && <ClientProfile client={client} />}
        <ClientPeople client={client} />
        <ClientJobs client={client} />
        {!tabbed && can('documents') && <ClientDocs client={client} />}
        {!tabbed && showMoney && <ClientPayments client={client} />}
        {!tabbed && <NotesPanel target={{ type: 'client', id: client.id }} notes={client.notes} />}
      </div>
      <div className="stack">
        <ClientContact client={client} />
        <ClientAddresses client={client} />
        {full && <ClientPrefs client={client} />}
        {can('leads') && <ClientLeads client={client} />}
        {!full && <ClientEmails client={client} />}
        <ClientPortalCard />
        <ClientActivity client={client} limit={tabbed ? 5 : 8} />
      </div>
    </div>
  );
}
