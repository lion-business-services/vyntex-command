// Everything that happened on this client's record, newest first: the record itself and the work done for the client.
// Amounts are left out for a role that may not see money.
import { ClientActivity } from './parts';
import type { ClientTabProps } from './tabs';

export default function ActivityTab({ client }: ClientTabProps) {
  return <div className="clients-narrow"><ClientActivity client={client} limit={40} linkRecords /></div>;
}
