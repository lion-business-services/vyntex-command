// Leads of the sample firm, one or more in each of the seven stages, so every state of the pipeline has something to show:
// a next action due today, one that is overdue, a lead with nothing planned that is going cold, one handed from one
// associate to another, one given out by the rotation, two won (linked to their client and engagement) and two lost with
// a reason from the firm's list. Fictional people: example.com addresses and 555 numbers.
// Ids pl1 to pl11 are fixed because tasks and engagements point at them.
import type { Lang, Lead } from '@/domain/types';
import { day, notes, stamp, txFor } from './util';

export function leads(lang: Lang): { leads: Lead[] } {
  const tx = txFor(lang);
  let n = 1000;
  const lead = (o: Omit<Lead, 'ticket' | 'notes' | 'pri' | 'address' | 'email' | 'value'> & Partial<Pick<Lead, 'notes' | 'pri' | 'address' | 'email' | 'value'>>): Lead =>
    ({ ticket: `VP-${++n}`, notes: [], pri: 'medium', address: '', email: '', value: null, officeId: 'o1', ...o });
  return {
    leads: [
      lead({ id: 'pl1', name: 'Rafael Quintero', phone: '609-555-0951', email: 'rafael@example.com', type: 'tax', serviceIds: ['s-1040'], source: 'website', status: 'new', ownerId: 'u3', kind: 'individual', lang: 'es', created: day(0), pri: 'high', value: 180,
        nextAction: { text: tx('Call back and ask which year he needs filed', 'Devolver la llamada y preguntar qué año necesita declarar'), due: day(0) },
        notes: notes('pl1', 'u3', [[0, 'note', tx('Website form: needs last year filed, has a W-2 and a 1099.', 'Formulario del sitio: necesita declarar el año pasado, tiene un W-2 y un 1099.')]]) }),
      lead({ id: 'pl2', name: 'Bianca Ferraro', company: 'Ferraro Sample Catering', phone: '609-555-0952', email: 'bianca@example.com', type: 'bookkeeping', serviceIds: ['s-books', 's-payroll'], source: 'walk_in', status: 'new', ownerId: 'u2', kind: 'business', created: day(-1), value: 345, smsOptIn: true,
        nextAction: { text: tx('Send the list of documents to bring', 'Enviar la lista de documentos que debe traer'), due: day(1) } }),
      lead({ id: 'pl3', name: 'Dmitri Volkov', phone: '609-555-0953', email: 'dmitri@example.com', type: 'formation', serviceIds: ['s-formation'], source: 'google', status: 'contacted', ownerId: 'u2', kind: 'business', created: day(-4), value: 450,
        followUp: day(1), lastContact: stamp(-2, 15), nextAction: { text: tx('Follow up on the company name he wants', 'Dar seguimiento al nombre de empresa que quiere'), due: day(1) },
        notes: notes('pl3', 'u2', [[-2, 'call', tx('Opening a moving company with his brother. Not sure yet between an LLC and a corporation.', 'Va a abrir una compañía de mudanzas con su hermano. Todavía no decide entre una LLC y una corporación.')]]) }),
      lead({ id: 'pl4', name: 'Yolanda Pacheco', phone: '856-555-0954', type: 'tax', serviceIds: ['s-1040'], source: 'whatsapp', status: 'contacted', ownerId: 'u4', kind: 'individual', lang: 'es', officeId: 'o2', created: day(-6), smsOptIn: true,
        followUp: day(-1), lastContact: stamp(-5, 11), nextAction: { text: tx('Second attempt: she did not answer the first call', 'Segundo intento: no contestó la primera llamada'), due: day(-1) } }),
      lead({ id: 'pl5', name: 'Keisha Lambert', company: 'Lambert Sample Hair Studio', phone: '609-555-0955', email: 'keisha@example.com', type: 'payroll', serviceIds: ['s-payroll'], source: 'referral', sourceDetail: 'Teresa Maldonado', status: 'appointment', ownerId: 'u3', kind: 'business', created: day(-8), value: 95, pri: 'high',
        apptDate: day(2), apptTime: '10:30', lastContact: stamp(-3, 14), nextAction: { text: tx('First consultation at the main office', 'Primera consulta en la oficina principal'), due: day(2) },
        notes: notes('pl5', 'u3', [[-3, 'call', tx('Three stylists on payroll, one booth renter. Wants to stop doing payroll by hand.', 'Tres estilistas en nómina y una que renta su silla. Quiere dejar de hacer la nómina a mano.')]]) }),
      // handed from the senior associate to the associate who speaks the client's language
      lead({ id: 'pl6', name: 'Hao Lin', phone: '856-555-0956', email: 'hao@example.com', type: 'tax', serviceIds: ['s-biztax', 's-salestax'], source: 'facebook', status: 'proposal', ownerId: 'u4', originalOwnerId: 'u2', kind: 'business', company: 'Lin Sample Market', lang: 'zh', officeId: 'o2', created: day(-14), value: 725,
        followUp: day(2), lastContact: stamp(-4, 16), nextAction: { text: tx('Ask whether the proposal has everything he expected', 'Preguntar si la propuesta tiene todo lo que esperaba'), due: day(2) },
        handoffs: [{ id: 'pl6-h1', at: stamp(-12, 10), from: 'u2', to: 'u4', by: 'u1', how: 'manual', reason: tx('Client prefers Chinese and lives near the east office', 'El cliente prefiere chino y vive cerca de la oficina este') }] }),
      lead({ id: 'pl7', name: 'Olivia Brandt', company: 'Brandt Sample Veterinary', phone: '609-555-0957', email: 'olivia@example.com', type: 'bookkeeping', serviceIds: ['s-books'], source: 'referral', sourceDetail: 'Sunita Rao', status: 'negotiating', ownerId: 'u2', kind: 'business', created: day(-21), value: 250, pri: 'high',
        followUp: day(0), lastContact: stamp(-1, 13), nextAction: { text: tx('She asked for quarterly instead of monthly: confirm what that changes', 'Pidió trimestral en lugar de mensual: confirmar qué cambia'), due: day(0) },
        notes: notes('pl7', 'u2', [[-15, 'visit', tx('Came by the office with last year\'s books. Two locations, one set of accounts.', 'Pasó por la oficina con la contabilidad del año pasado. Dos sucursales, una sola contabilidad.')], [-1, 'call', tx('Likes the proposal. Asked whether quarterly bookkeeping would cost less.', 'Le gusta la propuesta. Preguntó si la contabilidad trimestral costaría menos.')]]) }),
      lead({ id: 'pl8', name: 'Marcus Bellamy', phone: '609-555-0935', email: 'marcus@example.com', address: '5 Sample Terrace, Somers Point, NJ', type: 'tax', serviceIds: ['s-1040'], source: 'referral', sourceDetail: 'Harold Whitcombe', status: 'won', ownerId: 'u3', kind: 'individual', created: day(-34), value: 180, clientId: 'pc5', jobId: 'pe6' }),
      lead({ id: 'pl9', name: 'Grace Adeyemi', company: 'Sample Shore Youth Arts', phone: '609-555-0940', email: 'shoreyoutharts@example.com', type: 'licensing', serviceIds: ['s-annual'], source: 'existing_client', status: 'won', ownerId: 'u1', kind: 'business', officeId: undefined, created: day(-62), value: 120, clientId: 'pc10', jobId: 'pe8' }),
      lead({ id: 'pl10', name: 'Trevor Naismith', phone: '609-555-0958', type: 'tax', serviceIds: ['s-1040'], source: 'instagram', status: 'lost', ownerId: 'u2', kind: 'individual', created: day(-40), value: 180, lostReason: 'competitor', lostAt: day(-31), lastContact: stamp(-33, 11),
        notes: notes('pl10', 'u2', [[-33, 'call', tx('Went with the preparer his brother uses. Said he may come back next year.', 'Se fue con el preparador que usa su hermano. Dijo que tal vez regrese el próximo año.')]]) }),
      lead({ id: 'pl11', name: 'Paloma Ibarra', company: 'Ibarra Sample Cleaning', phone: '856-555-0959', type: 'formation', serviceIds: ['s-formation'], source: 'phone', status: 'lost', ownerId: 'u4', kind: 'business', lang: 'es', officeId: 'o2', created: day(-52), value: 450, lostReason: 'not_ready', lostAt: day(-45), lastContact: stamp(-46, 15) }),
      // nothing planned and nobody in touch for more than a week: the list marks it as needing attention and going cold
      lead({ id: 'pl12', name: 'Nikolai Petrov', company: 'Petrov Sample Auto Repair', phone: '609-555-0960', email: 'nikolai@example.com', type: 'tax', serviceIds: ['s-salestax'], source: 'google', status: 'contacted', ownerId: 'u3', kind: 'business', created: day(-12), value: 300, smsOptIn: true,
        lastContact: stamp(-9, 10),
        notes: notes('pl12', 'u3', [[-9, 'call', tx('Files sales tax himself and is late on two quarters. Asked for a price and said he would call back.', 'Presenta el impuesto sobre ventas él mismo y debe dos trimestres. Pidió precio y dijo que llamaría de vuelta.')]]) }),
      // came in through the website with nobody chosen: the rotation gave it to the next associate in turn
      lead({ id: 'pl13', name: 'Marisela Ortega', company: 'Ortega Sample Daycare', phone: '609-555-0961', email: 'marisela@example.com', address: '27 Sample Avenue, Pleasantville, NJ', type: 'payroll', serviceIds: ['s-payroll', 's-books'], source: 'website', sourceDetail: tx('Payroll page form', 'Formulario de la página de nómina'), status: 'proposal', ownerId: 'u3', originalOwnerId: 'u3', kind: 'business', lang: 'es', created: day(-9), value: 345,
        lastContact: stamp(-2, 12), nextAction: { text: tx('Walk her through the proposal by phone', 'Explicarle la propuesta por teléfono'), due: day(3) },
        handoffs: [{ id: 'pl13-h1', at: stamp(-9, 9), from: '', to: 'u3', by: 'automation', how: 'round_robin' }],
        notes: notes('pl13', 'u3', [[-8, 'call', tx('Five employees, pays by hand every week. Wants payroll first and bookkeeping once the year closes.', 'Cinco empleados, paga a mano cada semana. Quiere primero la nómina y la contabilidad cuando cierre el año.')], [-2, 'email', tx('Sent the proposal for payroll and monthly bookkeeping.', 'Se envió la propuesta de nómina y contabilidad mensual.')]]) }),
    ],
  };
}
