// The office team and the offices of the sample firm. Fictional people: example.com addresses and 555 numbers.
// The offices carry neutral names (main, east) on purpose, so nobody takes a sample office for a real one.
// Ids are fixed because the other parts point at them: users u1 to u6, offices o1 and o2. u7 is an invitation that nobody
// has accepted yet, so the people screen has one to show; she holds no work and cannot be assigned any.
import type { CompanyConfig, ISODate, Lang, Office, TeamUser } from '@/domain/types';
import { addDays } from '@/lib/dates';
import { stamp, txFor } from './util';

/** Monday to Friday of next week, whatever day the sample is opened on. */
function nextWeek(): { from: ISODate; to: ISODate } {
  const dow = new Date().getDay();            // 0 Sunday ... 6 Saturday
  const toMonday = ((8 - dow) % 7) || 7;
  return { from: addDays(toMonday), to: addDays(toMonday + 4) };
}

export function people(lang: Lang): { users: TeamUser[]; offices: Office[]; config: CompanyConfig } {
  const tx = txFor(lang);
  const offices: Office[] = [
    { id: 'o1', name: tx('Main office', 'Oficina principal'), address: '100 Sample Avenue, Suite 2, Northfield, NJ 08225', phone: '609-555-0900', timezone: 'America/New_York', main: true },
    { id: 'o2', name: tx('East office', 'Oficina este'), address: '20 Sample Street, Vineland, NJ 08360', phone: '856-555-0910', timezone: 'America/New_York' },
  ];
  const users: TeamUser[] = [
    { id: 'u1', name: 'Marisol Vega', role: 'owner', email: 'marisol@example.com', phone: '609-555-0901', title: tx('Founder and managing partner', 'Fundadora y socia directora'), languages: ['en', 'es'], officeIds: ['o1', 'o2'], active: true,
      bio: tx('Started the firm and still reviews every business return before it is filed. Works from both offices.', 'Fundó el despacho y todavía revisa cada declaración de negocio antes de presentarla. Trabaja desde las dos oficinas.'),
      mfa: true, lastSeen: stamp(0, 8, 40) },
    { id: 'u2', name: 'Daniel Okafor', role: 'manager', email: 'daniel@example.com', phone: '609-555-0902', title: tx('Senior tax associate', 'Asociado sénior de impuestos'), languages: ['en'], officeIds: ['o1'], active: true, inLeadPool: true,
      bio: tx('Leads tax preparation for businesses and approves the work of the associates at the main office.', 'Dirige la preparación de impuestos de negocios y aprueba el trabajo de los asociados en la oficina principal.'),
      mfa: true, lastSeen: stamp(0, 9, 5) },
    { id: 'u3', name: 'Ana Lucía Paredes', role: 'staff', email: 'analucia@example.com', phone: '609-555-0903', title: tx('Bookkeeping and payroll associate', 'Asociada de contabilidad y nómina'), languages: ['en', 'es'], officeIds: ['o1'], active: true, inLeadPool: true,
      bio: tx('Keeps the books and runs payroll for the firm\'s business clients.', 'Lleva la contabilidad y corre la nómina de los clientes de negocio del despacho.'),
      mfa: true, lastSeen: stamp(0, 9, 20) },
    // works from the second office; out next week, so automatic assignment will skip her turn then
    { id: 'u4', name: 'Wei Chen', role: 'staff', email: 'wei@example.com', phone: '856-555-0904', title: tx('Tax associate', 'Asociada de impuestos'), languages: ['en', 'zh'], officeIds: ['o2'], active: true, inLeadPool: true,
      bio: tx('Prepares individual returns and helps Chinese-speaking clients at the East office.', 'Prepara declaraciones individuales y atiende a los clientes que hablan chino en la oficina este.'),
      away: { ...nextWeek(), note: tx('Out of the office', 'Fuera de la oficina') }, mfa: true, lastSeen: stamp(-1, 16, 45) },
    { id: 'u5', name: 'Tomás Rivera', role: 'readonly', email: 'tomas@example.com', phone: '609-555-0905', title: tx('Front desk', 'Recepción'), languages: ['en', 'es'], officeIds: ['o1'], active: true,
      bio: tx('Greets clients, answers the phone and books appointments at the main office.', 'Recibe a los clientes, contesta el teléfono y agenda citas en la oficina principal.'),
      mfa: false, lastSeen: stamp(0, 8, 55) },
    { id: 'u6', name: 'Imani Brooks', role: 'staff', email: 'imani@example.com', phone: '856-555-0906', title: tx('Payroll associate', 'Asociada de nómina'), languages: ['en'], officeIds: ['o2'], active: true,
      bio: tx('Runs payroll and quarterly filings for the clients of the East office.', 'Corre la nómina y las declaraciones trimestrales de los clientes de la oficina este.'),
      mfa: true, lastSeen: stamp(-2, 15, 10) },
    // invited yesterday, has not accepted yet: not active until she does
    { id: 'u7', name: 'Renata Solís', role: 'staff', email: 'renata@example.com', title: tx('Tax associate', 'Asociada de impuestos'), languages: ['en', 'es'], officeIds: ['o2'], active: false, invitedAt: stamp(-1, 11, 30) },
  ];
  const config: CompanyConfig = {
    // the sample firm hands new leads out in turn: the senior associate, then the two associates; the owner is the fallback
    routing: { mode: 'round_robin', pool: ['u2', 'u3', 'u4'], cursor: 1, exclude: [], skipAway: true, fallbackId: 'u1' },
    // the people who can reach everything use the second sign-in step; the session ends after half an hour without activity
    security: { idleMinutes: 30, mfaRoles: ['owner', 'manager'] },
    // open on weekdays
    hours: { days: [1, 2, 3, 4, 5], open: '09:00', close: '17:00' },
  };
  return { users, offices, config };
}
