// Figures the client list and the client page read. No React here.
import type { Appointment, Client, DemoState } from '@/domain/types';
import { today } from '@/lib/dates';

export interface ClientTotals { jobs: number; billed: number; received: number; owes: number }
const NONE: ClientTotals = { jobs: 0, billed: 0, received: 0, owes: 0 };
/**
 * Billed, received and balance of every client in one pass over the jobs. The same sums as `clientMoney` in
 * src/domain/selectors.ts (tests/unit/clients.test.mjs holds the two together); that one walks every job for one client,
 * which is right for one client page and too slow for a list of hundreds.
 */
export function moneyByClient(d: Pick<DemoState, 'jobs'>): (clientId: string) => ClientTotals {
  const map = new Map<string, ClientTotals>();
  for (const j of d.jobs) {
    let m = map.get(j.clientId);
    if (!m) { m = { jobs: 0, billed: 0, received: 0, owes: 0 }; map.set(j.clientId, m); }
    const price = Number(j.price) || 0;
    let got = 0; for (const r of j.received) got += Number(r.amount) || 0;
    m.jobs++; m.received += got;
    if (j.status !== 'estimate') m.billed += price;
    if (j.status === 'progress' || j.status === 'done') m.owes += price - got;
  }
  return (clientId) => map.get(clientId) ?? NONE;
}

const UPCOMING: Appointment['status'][] = ['requested', 'scheduled', 'awaiting_payment', 'confirmed'];
/** The client's next appointment that is still on, if any. */
export function nextAppointment(d: Pick<DemoState, 'appointments'>, clientId: string): Appointment | undefined {
  const td = today();
  return (d.appointments ?? []).filter((a) => a.clientId === clientId && a.date >= td && UPCOMING.includes(a.status)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
}

/** Individual or business, for a record that does not say: a record with a company name is a business. */
export const kindOf = (c: Pick<Client, 'kind' | 'company' | 'clientType'>): 'individual' | 'business' => c.kind ?? (c.clientType ? (c.clientType === 'individual' ? 'individual' : 'business') : c.company ? 'business' : 'individual');

/** What a client said about being written to, said out loud: explicit refusals only. A client nobody asked is not marked. */
export function optOuts(c: Client): ('email' | 'text' | 'whatsapp')[] {
  return [...(c.emailOptOut ? ['email' as const] : []), ...(c.smsOptIn === false ? ['text' as const] : []), ...(c.whatsappOptIn === false ? ['whatsapp' as const] : [])];
}
