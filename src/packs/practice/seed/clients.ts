// Clients of the sample firm: individuals and businesses, with owners and their shares, other contacts, client types,
// two offices (the clients of the east office are outside the access of the main office associates), tags, what each
// client agreed to receive, a record linked to a connected system, an inactive and a former client, and one person entered
// twice so the duplicate check and the merge have something to show.
// Fictional people and companies. A tax ID is never stored here: only its type and last four digits, as a marker.
// Ids pc1 to pc10 are fixed because leads, engagements, tasks and documents point at them.
import type { Client, Lang } from '@/domain/types';
import { day, notes, txFor } from './util';

export function clients(lang: Lang): { clients: Client[] } {
  const tx = txFor(lang);
  const person = (id: string, name: string, phone: string, email: string, address: string, since: number, more: Partial<Client> = {}): Client => ({
    id, name, phone, email, addresses: [address], since: day(since), notes: [], kind: 'individual', clientType: 'individual', taxIdType: 'ssn', lifecycle: 'active', officeId: 'o1', assignedTo: 'u3', lang: 'en', ...more,
  });
  const business = (id: string, contact: string, company: string, clientType: string, phone: string, email: string, address: string, since: number, more: Partial<Client> = {}): Client => ({
    id, name: contact, company, phone, email, addresses: [address], since: day(since), notes: [], kind: 'business', clientType, taxIdType: 'ein', lifecycle: 'active', officeId: 'o1', assignedTo: 'u2', lang: 'en', ...more,
  });
  return {
    clients: [
      person('pc1', 'Gabriela Montes', '609-555-0931', 'gabriela@example.com', '14 Sample Lane, Pleasantville, NJ', -410, { taxIdLast4: '0142', lang: 'es', birthday: '1984-03-12', smsOptIn: true, whatsappOptIn: true, whatsapp: '609-555-0931', tags: [tx('walk-in', 'visita')],
        notes: notes('pc1', 'u3', [[-410, 'note', tx('Prefers Spanish and a call before any email. Brings her documents in person in February.', 'Prefiere español y una llamada antes de cualquier correo. Trae sus documentos en persona en febrero.')]]) }),
      person('pc2', 'Harold Whitcombe', '609-555-0932', 'harold@example.com', '7 Sample Court, Linwood, NJ', -820, { taxIdLast4: '0377', birthday: '1957-11-02', assignedTo: 'u2', tags: ['retired'],
        notes: notes('pc2', 'u2', [[-300, 'call', tx('Retired. His daughter Joan is allowed to ask about his file; her number is in contacts.', 'Jubilado. Su hija Joan puede preguntar por su expediente; su número está en contactos.')]]),
        contacts: [{ id: 'pc2-k1', name: 'Joan Whitcombe', title: tx('Daughter', 'Hija'), phone: '609-555-0941', email: 'joan@example.com' }] }),
      person('pc3', 'Priscila Andrade', '856-555-0933', 'priscila@example.com', '31 Sample Road, Vineland, NJ', -95, { taxIdType: 'itin', taxIdLast4: '0519', lang: 'es', officeId: 'o2', assignedTo: 'u4', smsOptIn: true }),
      person('pc4', 'Liang Zhou', '856-555-0934', 'liang@example.com', '88 Sample Boulevard, Vineland, NJ', -210, { taxIdLast4: '0468', lang: 'zh', officeId: 'o2', assignedTo: 'u4', clientType: 'sole_prop', company: 'Zhou Sample Tailoring' }),
      person('pc5', 'Marcus Bellamy', '609-555-0935', 'marcus@example.com', '5 Sample Terrace, Somers Point, NJ', -30, { taxIdLast4: '0725', referredBy: 'Harold Whitcombe' }),
      business('pc6', 'Teresa Maldonado', 'Sample Coast Bakery LLC', 'llc', '609-555-0936', 'coastbakery@example.com', '212 Sample Street, Northfield, NJ', -540, { taxIdLast4: '4410', lang: 'es', tags: [tx('payroll', 'nómina'), tx('monthly', 'mensual')], smsOptIn: true, whatsappOptIn: true, whatsapp: '609-555-0936', social: { instagram: 'samplecoastbakery' },
        // the same customer in the card processor: shown as a read-only mark on the record
        externalIds: { square: 'SAMPLE-SQ-0006' },
        contacts: [{ id: 'pc6-k1', name: 'Inés Carrasco', title: tx('Shift lead, sends the hours', 'Jefa de turno, envía las horas'), phone: '609-555-0943', email: 'ines@example.com' }],
        owners: [{ id: 'pc6-o1', name: 'Teresa Maldonado', title: tx('Member', 'Miembro'), pct: 60, primary: true, phone: '609-555-0936' }, { id: 'pc6-o2', name: 'Rubén Maldonado', title: tx('Member', 'Miembro'), pct: 40 }],
        notes: notes('pc6', 'u3', [[-200, 'note', tx('Payroll runs every other Friday for 6 employees. Teresa approves hours by Wednesday noon.', 'La nómina corre cada dos viernes para 6 empleados. Teresa aprueba las horas antes del miércoles al mediodía.')]]) }),
      business('pc7', 'Owen Driscoll', 'Driscoll Sample Electric Inc', 's_corp', '609-555-0937', 'driscollelectric@example.com', '40 Sample Industrial Way, Egg Harbor Twp, NJ', -700, { taxIdLast4: '7203', tags: [tx('contractor', 'contratista')],
        owners: [{ id: 'pc7-o1', name: 'Owen Driscoll', title: tx('President', 'Presidente'), pct: 100, primary: true }],
        contacts: [{ id: 'pc7-k1', name: 'Nadia Farouk', title: tx('Office manager', 'Gerente de oficina'), phone: '609-555-0942', email: 'nadia@example.com' }] }),
      business('pc8', 'Sunita Rao', 'Sample Harbor Dental PC', 'c_corp', '609-555-0938', 'harbordental@example.com', '9 Sample Plaza, Margate, NJ', -260, { taxIdLast4: '1186', emailOptOut: true, smsOptIn: false,
        owners: [{ id: 'pc8-o1', name: 'Sunita Rao', title: tx('Owner', 'Dueña'), pct: 100, primary: true }],
        notes: notes('pc8', 'u2', [[-120, 'call', tx('Asked not to get automatic emails or texts. Call the front desk of the practice instead.', 'Pidió no recibir correos automáticos ni mensajes de texto. Mejor llamar a la recepción del consultorio.')]]) }),
      business('pc9', 'Esteban Fuentes', 'Fuentes y Lara Sample Landscaping', 'partnership', '856-555-0939', 'fuenteslara@example.com', '63 Sample Farm Road, Vineland, NJ', -150, { taxIdLast4: '5527', lang: 'es', officeId: 'o2', assignedTo: 'u4',
        owners: [{ id: 'pc9-o1', name: 'Esteban Fuentes', title: tx('Partner', 'Socio'), pct: 50, primary: true }, { id: 'pc9-o2', name: 'Camila Lara', title: tx('Partner', 'Socia'), pct: 50 }] }),
      // no office yet: a client without one is visible to everyone in the company
      business('pc10', 'Grace Adeyemi', 'Sample Shore Youth Arts', 'nonprofit', '609-555-0940', 'shoreyoutharts@example.com', '18 Sample Avenue, Atlantic City, NJ', -60, { taxIdLast4: '9034', officeId: undefined, assignedTo: 'u1',
        owners: [{ id: 'pc10-o1', name: 'Grace Adeyemi', title: tx('Executive director', 'Directora ejecutiva'), primary: true }, { id: 'pc10-o2', name: 'Leonard Achebe', title: tx('Board treasurer', 'Tesorero del consejo') }] }),
      // no work this year: still a client, marked inactive
      person('pc11', 'Eleanor Whitfield', '609-555-0944', 'eleanor@example.com', '3 Sample Dune Road, Brigantine, NJ', -900, { taxIdLast4: '0816', lifecycle: 'inactive', assignedTo: 'u2', birthday: '1949-06-21', tags: [tx('seasonal', 'de temporada')], smsOptIn: false,
        notes: notes('pc11', 'u2', [[-380, 'call', tx('Spends the winter out of state. Files here every other year.', 'Pasa el invierno fuera del estado. Declara aquí un año sí y otro no.')]]) }),
      // closed the business: kept on record as a former client
      business('pc12', 'Dario Benedetti', 'Sample Boardwalk Cafe LLC', 'llc', '609-555-0945', 'boardwalkcafe@example.com', '71 Sample Boardwalk, Ventnor, NJ', -1100, { taxIdLast4: '6642', lifecycle: 'former',
        owners: [{ id: 'pc12-o1', name: 'Dario Benedetti', title: tx('Member', 'Miembro'), pct: 100, primary: true }],
        notes: notes('pc12', 'u2', [[-200, 'note', tx('The cafe closed. Final return filed. Keep the file for the retention period.', 'La cafetería cerró. Se presentó la declaración final. Conservar el expediente durante el plazo de retención.')]]) }),
      // the same person as pc1, entered a second time at the front desk: what the duplicate check finds and the merge fixes
      person('pc13', 'Gabriela M. Montes', '609-555-0931', '', '14 Sample Lane, Pleasantville, NJ', -18, { taxIdType: undefined, lang: 'es', assignedTo: 'u2',
        notes: notes('pc13', 'u2', [[-18, 'visit', tx('Came in to ask about amending last year. Entered at the front desk on a busy day.', 'Vino a preguntar por una enmienda del año pasado. Se capturó en recepción en un día de mucho movimiento.')]]) }),
    ],
  };
}
