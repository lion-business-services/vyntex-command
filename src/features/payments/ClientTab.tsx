// What a client was billed and paid, on the client page. Registered in src/features/clients/tabs.ts.
import { ClientMoney, ClientPayments } from '@/features/clients/parts';
import type { ClientTabProps } from '@/features/clients/tabs';

export default function BillingClientTab({ client }: ClientTabProps) {
  return <div className="stack"><ClientMoney client={client} /><ClientPayments client={client} /></div>;
}
