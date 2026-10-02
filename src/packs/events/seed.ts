import type { Lang, SeedData } from '@/domain/types';
import { seedKit } from '../seedkit';

/** Sample business for this edition. Fictional data only. */
export function seed(lang: Lang): SeedData {
  const k = seedKit(lang, 'VE-');
  const { tx } = k;

  // Weddings and parties happen on weekends. `sat` is the coming Saturday as a day offset from today (1 to 7),
  // so weekend events always land on a weekend whatever day the demo is opened.
  const sat = (6 - new Date().getDay() + 7) % 7 || 7;
  const soon = (n: number) => Math.max(0, n);

  // wording that repeats
  const linen = tx('Linen rental', 'Renta de mantelería');
  const partySupply = tx('Party supply', 'Artículos para fiestas');
  const deposit = tx('Deposit', 'Depósito');
  const balance = tx('Balance', 'Saldo');
  const paidFull = tx('Paid in full', 'Pagado completo');
  const captain = tx('Event captain', 'Capitana del evento');
  const bartender = tx('Bartender', 'Bartender');
  const hall = 'Sample Hall, 80 Sample Rd, Egg Harbor Twp, NJ';
  const insurer = 'Sample Mutual Insurance';
  const servers = (n: number) => tx(`Servers x${n}`, `Meseros x${n}`);

  /* ---------- staff ---------- */
  k.worker({ id: 'w1', name: 'Nicole Grant', trade: tx('Event captain', 'Capitana de eventos'), phone: '609-555-0141', email: 'nicole@example.com', payType: 'project', w9: 350, coi: 300, insurer });
  k.worker({ id: 'w2', name: 'Carlos Vega', trade: tx('Lead server, brings his team', 'Jefe de meseros, trae a su equipo'), phone: '609-555-0142', email: 'carlos@example.com', payType: 'daily', rate: 180, w9: 280 });
  k.worker({ id: 'w3', name: 'Brianna Hill', trade: bartender, phone: '609-555-0143', email: 'brianna@example.com', payType: 'daily', rate: 220 });
  k.worker({ id: 'w4', name: 'Sample Tents & Rentals LLC', trade: tx('Tents, tables and chairs', 'Carpas, mesas y sillas'), phone: '609-555-0144', email: 'tents@example.com', payType: 'project', w9: 200, coi: 22, insurer });
  k.worker({ id: 'w5', name: 'Mateo Rojas', trade: tx('Setup and teardown lead', 'Encargado de montaje y desmontaje'), phone: '609-555-0145', email: 'mateo@example.com', payType: 'daily', rate: 200, w9: 150 });
  k.worker({ id: 'w6', name: 'Aaliyah Brooks', trade: bartender, phone: '609-555-0146', email: 'aaliyah@example.com', payType: 'hourly', rate: 30, w9: 120 });
  k.worker({ id: 'w7', name: 'Sample Valet & Parking LLC', trade: tx('Parking attendants', 'Estacionamiento y valet'), phone: '609-555-0147', email: 'parking@example.com', payType: 'project', w9: 260, coi: -4, insurer });
  k.worker({ id: 'w8', name: 'Hannah Weiss', trade: tx('Registration desk and coat check', 'Mesa de registro y guardarropa'), phone: '609-555-0148', email: 'hannah@example.com', payType: 'hourly', rate: 20, w9: 70 });
  k.worker({ id: 'w9', name: 'Diego Salazar', trade: tx('Server and wine service', 'Mesero y servicio de vino'), phone: '609-555-0149', email: 'diego@example.com', payType: 'hourly', rate: 22, w9: 210, active: false });

  /* ---------- clients ---------- */
  k.client({ id: 'c1', name: 'Marisol Rodríguez', phone: '609-555-0101', email: 'marisol@example.com', addresses: ['21 Sample St, Egg Harbor Twp, NJ'], since: -12,
    note: tx('The family speaks Spanish. Marisol, the mother, makes the decisions.', 'La familia habla español. Marisol, la mamá, es quien decide.') });
  k.client({ id: 'c2', name: 'Brett Sullivan', company: 'Sample Logistics Co.', phone: '609-555-0102', email: 'brett@example.com', addresses: ['700 Sample Pike, Egg Harbor Twp, NJ'], since: -112,
    note: tx('HR manager. Books the company picnic and a few lunches every year. Pays by check, net 15.', 'Gerente de recursos humanos. Contrata el picnic de la compañía y algunas comidas al año. Paga con cheque, a 15 días.') });
  k.client({ id: 'c3', name: 'Eleanor Whitmore', company: 'Sample Foundation', phone: '609-555-0103', email: 'eleanor@example.com', addresses: ['15 Sample Plaza, Northfield, NJ'], since: -6 });
  k.client({ id: 'c4', name: 'Angela Greco', company: 'Sample Banquet Hall', phone: '609-555-0104', email: 'angela@example.com', addresses: ['350 Sample Ave, Northfield, NJ'], since: -60,
    note: tx('Venue. We staff their Saturday events. She wants the same faces every week, black on black.', 'Salón de eventos. Les ponemos el personal de los sábados. Quiere las mismas caras cada semana, todo de negro.') });
  k.client({ id: 'c5', name: 'Claire Donnelly', company: 'Sample Vineyard & Events', phone: '609-555-0105', email: 'claire@example.com', addresses: ['95 Sample Ln, Hammonton, NJ'], since: -100,
    note: tx('Venue coordinator. Sends us her couples when they need service staff.', 'Coordinadora del lugar. Nos manda a sus parejas cuando necesitan personal de servicio.') });
  k.client({ id: 'c6', name: 'Anjali Desai', phone: '609-555-0106', email: 'anjali@example.com', addresses: ['8 Sample Ct, Linwood, NJ'], since: -30 });
  k.client({ id: 'c7', name: 'Ron Hartley', company: 'Sample Chamber of Commerce', phone: '609-555-0107', email: 'ron@example.com', addresses: ['40 Sample St, Somers Point, NJ'], since: -24 });
  k.client({ id: 'c8', name: 'Keisha Thompson', phone: '609-555-0108', email: 'keisha@example.com', addresses: ['63 Sample Dr, Pleasantville, NJ'], since: -45 });
  k.client({ id: 'c9', name: 'Paul Becker', company: 'Sample Marina Club', phone: '609-555-0109', email: 'paul@example.com', addresses: ['1 Sample Way, Somers Point, NJ'], since: -95 });
  k.client({ id: 'c10', name: 'Miriam Katz', company: 'Sample Arts Council', phone: '609-555-0110', email: 'miriam@example.com', addresses: ['22 Sample Ave, Ventnor, NJ'], since: -18 });
  k.client({ id: 'c11', name: 'Fernando Castillo', phone: '609-555-0111', email: 'fernando@example.com', addresses: ['17 Sample Ln, Galloway, NJ'], since: -2, emailOptOut: true,
    note: tx('It is a surprise party. Text or call his cell only, no emails to the house.', 'Es fiesta sorpresa. Solo mensaje o llamada a su celular, nada de correos a la casa.') });
  k.client({ id: 'c12', name: 'Andre Baptiste', company: 'Sample Catering Co.', phone: '609-555-0112', email: 'andre@example.com', addresses: ['210 Sample Blvd, Absecon, NJ'], since: -70,
    note: tx('Caterer. Hires our servers and bartenders for his events. Pays net 15, always on time.', 'Banquetero. Contrata a nuestros meseros y bartenders para sus eventos. Paga a 15 días, siempre puntual.') });

  /* ---------- events ---------- */
  k.job({
    id: 'j1', name: tx('Rodríguez quinceañera', 'Quinceañera Rodríguez'), clientId: 'c1', address: hall, type: 'party', status: 'progress', price: 3600, start: sat + 7, end: sat + 8,
    scope: tx('Setup of 20 tables with linens and decor. 6 servers, 1 bartender and a captain. Teardown after midnight.', 'Montaje de 20 mesas con mantelería y decoración. 6 meseros, 1 bartender y una capitana. Desmontaje después de la medianoche.'),
    payTerms: tx('50% deposit, balance 7 days before the event.', '50% de depósito, saldo 7 días antes del evento.'),
    assign: [
      { workerId: 'w1', scope: captain, price: 400, status: 'pending' },
      { workerId: 'w2', scope: servers(6), price: 1080, payType: 'daily', rate: 180, qty: 6, status: 'pending' },
      { workerId: 'w3', scope: bartender, price: 220, payType: 'daily', rate: 220, qty: 1, status: 'pending' },
    ],
    expenses: [{ date: -4, vendor: linen, desc: tx('Linens and chair covers, deposit', 'Mantelería y fundas de sillas, anticipo'), amount: 420 }],
    received: [{ date: -10, method: 'zelle', ref: deposit, amount: 1800 }],
    tasks: [
      { title: tx('Reserve the linens and chair covers', 'Apartar la mantelería y las fundas de sillas'), who: 'u3', due: -4, status: 'done' },
      { title: tx('Confirm the final guest count', 'Confirmar el número final de invitados'), who: 'u1', due: 2, pri: 'high' },
      { title: tx('Collect the balance, due 7 days before', 'Cobrar el saldo, vence 7 días antes'), who: 'u3', due: sat },
      { title: tx('Seating chart from Marisol: check the table count', 'Acomodo de mesas de Marisol: revisar cuántas mesas son'), who: 'u2', due: 3, status: 'review' },
      { title: tx('Send call times to Carlos and Brianna', 'Mandar las horas de llegada a Carlos y a Brianna'), who: 'u2', due: sat + 4 },
      { title: tx('Run of show: grand entrance at 7:30 pm, waltz at 8', 'Programa: entrada a las 7:30 pm, vals a las 8'), who: 'w1', due: sat + 7 },
    ],
    notes: [
      [-10, 'call', tx('The family speaks Spanish. Waltz at 8 pm, keep the dance floor clear by 7:45.', 'La familia habla español. El vals es a las 8 pm, la pista tiene que estar libre a las 7:45.')],
      [-3, 'text', tx('Marisol: 160 guests so far, final number in a couple of days. The court of honor is 14 kids and they eat first.', 'Marisol: van 160 invitados, el número final en un par de días. La corte de honor son 14 jóvenes y comen primero.')],
    ],
  });

  k.job({
    id: 'j2', name: tx('Company picnic', 'Picnic de la compañía'), clientId: 'c2', address: 'Sample Park Pavilion, Galloway, NJ', type: 'corporate', status: 'done', price: 5200, start: sat - 42, end: sat - 42, manager: 'u2',
    scope: tx('Company picnic for 250 at the park pavilion: tent, tables and chairs, 5 servers for the buffet line and a captain. Setup at 8 am, teardown by 6 pm.', 'Picnic de la compañía para 250 en el pabellón del parque: carpa, mesas y sillas, 5 meseros para la línea de buffet y una capitana. Montaje a las 8 am, desmontaje antes de las 6 pm.'),
    payTerms: tx('50% deposit, balance net 15 after the event.', '50% de depósito, saldo a 15 días después del evento.'),
    assign: [
      { workerId: 'w1', scope: captain, price: 400, status: 'done' },
      { workerId: 'w2', scope: servers(5), price: 900, payType: 'daily', rate: 180, qty: 5, status: 'done' },
      { workerId: 'w4', scope: tx('Tent, tables and chairs', 'Carpa, mesas y sillas'), price: 1600, status: 'done' },
    ],
    expenses: [{ date: sat - 43, vendor: partySupply, desc: tx('Plates, cups and ice', 'Platos, vasos y hielo'), amount: 260 }],
    received: [{ date: sat - 56, method: 'check', ref: deposit, amount: 2600 }, { date: sat - 34, method: 'check', ref: balance, amount: 2600 }],
    workerPays: [
      { date: sat - 42, workerId: 'w2', method: 'cash', amount: 900, payType: 'daily', from: sat - 42, to: sat - 42 },
      { date: sat - 42, workerId: 'w1', method: 'zelle', amount: 400, payType: 'project' },
      { date: sat - 40, workerId: 'w4', method: 'check', ref: '1184', amount: 1600, payType: 'project' },
    ],
    tasks: [
      { title: tx('Copy of the park permit from Brett', 'Copia del permiso del parque, con Brett'), who: 'u3', due: sat - 45, status: 'done' },
      { title: tx('Tent up by 8 am', 'Carpa montada a las 8 am'), who: 'w4', due: sat - 42, status: 'done' },
      { title: tx('Send the final invoice', 'Mandar la factura final'), who: 'u2', due: sat - 41, status: 'done' },
    ],
    log: [{ date: sat - 42, workerId: 'w1', text: tx('The buffet line ran smooth, 250 served in 40 minutes. Tent was down and the pavilion swept by 5:30.', 'La línea de buffet salió bien, 250 servidos en 40 minutos. Carpa desmontada y pabellón barrido a las 5:30.') }],
  });

  k.job({
    id: 'j3', name: tx('Gala setup and teardown', 'Montaje y desmontaje de gala'), clientId: 'c3', address: 'Sample Hotel Ballroom, Atlantic City, NJ', type: 'setup', status: 'contract', price: 2800, start: sat + 13, end: sat + 14, manager: 'u2',
    scope: tx('Set up the ballroom for 300: 30 round tables, stage skirting, auction tables and the registration desk. Teardown the same night, after midnight.', 'Montar el salón para 300: 30 mesas redondas, faldón del escenario, mesas de subasta y mesa de registro. Desmontaje esa misma noche, después de la medianoche.'),
    payTerms: tx('50% deposit at signing, balance on the day of the event.', '50% de depósito al firmar, saldo el día del evento.'),
    assign: [
      { workerId: 'w1', scope: captain, price: 350, status: 'pending' },
      { workerId: 'w5', scope: tx('Setup crew of 4, setup and teardown', 'Cuadrilla de montaje de 4, montaje y desmontaje'), price: 720, payType: 'daily', rate: 180, qty: 4, status: 'pending' },
    ],
    tasks: [
      { title: tx('Signed agreement and deposit', 'Acuerdo firmado y depósito'), who: 'u2', due: 1, status: 'waiting', pri: 'high' },
      { title: tx('Get the floor plan from the hotel', 'Pedirle el plano del salón al hotel'), who: 'u3', due: 5 },
      { title: tx('Book the loading dock time with the hotel', 'Apartar el horario del andén de carga con el hotel'), who: 'u2', due: sat + 6 },
    ],
    notes: [[-1, 'email', tx('Eleanor is waiting for the board treasurer to sign. Same layout as last year, 30 rounds of 10.', 'Eleanor está esperando la firma del tesorero de la mesa. Mismo acomodo del año pasado, 30 mesas redondas de 10.')]],
  });

  k.job({
    id: 'j4', name: tx('Saturday service staff, banquet hall', 'Personal de servicio de los sábados, salón de eventos'), clientId: 'c4', type: 'service', status: 'progress', price: 5800, start: sat - 21, repeat: 'weekly', manager: 'u2',
    scope: tx('Every Saturday: 4 servers and 1 bartender for the events at the hall, 6 hour shift. Black on black. Staff parks behind the building and comes in through the kitchen door.', 'Cada sábado: 4 meseros y 1 bartender para los eventos del salón, turno de 6 horas. Todo de negro. El personal se estaciona atrás y entra por la puerta de la cocina.'),
    payTerms: tx('$1,450 per Saturday, 4 Saturdays per cycle, billed every two weeks.', '$1,450 por sábado, 4 sábados por ciclo, se factura cada dos semanas.'),
    assign: [
      { workerId: 'w2', scope: tx('Servers x4, 4 Saturdays', 'Meseros x4, 4 sábados'), price: 2880, payType: 'daily', rate: 180, qty: 16, status: 'progress' },
      { workerId: 'w6', scope: tx('Bartender, 6 hours per Saturday', 'Bartender, 6 horas por sábado'), price: 720, payType: 'hourly', rate: 30, qty: 24, status: 'progress' },
    ],
    expenses: [{ date: sat - 22, vendor: tx('Uniform supply', 'Tienda de uniformes'), desc: tx('Black aprons, 6', 'Mandiles negros, 6'), amount: 96 }],
    received: [{ date: sat - 12, method: 'transfer', ref: tx('Saturdays 1 and 2', 'Sábados 1 y 2'), amount: 2900 }],
    workerPays: [
      { date: sat - 20, workerId: 'w2', method: 'zelle', amount: 720, payType: 'daily', from: sat - 21, to: sat - 21 },
      { date: sat - 13, workerId: 'w2', method: 'zelle', amount: 720, payType: 'daily', from: sat - 14, to: sat - 14 },
      { date: sat - 13, workerId: 'w6', method: 'zelle', amount: 360, payType: 'hourly', from: sat - 21, to: sat - 14 },
    ],
    tasks: [
      { title: tx('Timesheets from Carlos for last Saturday', 'Hojas de horas de Carlos del sábado pasado'), who: 'u3', due: 0, status: 'review' },
      { title: tx('Send the Saturday staff list to Angela', 'Mandarle a Angela la lista del personal del sábado'), who: 'u3', due: soon(sat - 2) },
      { title: tx('Saturday: wedding reception for 180, 4 servers and the bar', 'Sábado: recepción de boda para 180, 4 meseros y la barra'), who: 'w2', due: sat },
      { title: tx('Invoice Saturdays 3 and 4', 'Facturar los sábados 3 y 4'), who: 'u2', due: sat + 2 },
    ],
    log: [
      { date: sat - 14, workerId: 'w6', text: tx('Cash bar closed at 11. We ran out of lime juice at 10, the hall needs to stock more.', 'La barra cerró a las 11. A las 10 se acabó el jugo de limón, el salón tiene que surtir más.') },
      { date: sat - 7, workerId: 'w2', text: tx('Sweet sixteen for 140. The kitchen ran 20 minutes late, we held the salads. The hall manager was happy.', 'Fiesta de dieciséis años para 140. La cocina se atrasó 20 minutos, aguantamos las ensaladas. La gerente del salón quedó contenta.') },
    ],
    notes: [[sat - 22, 'visit', tx('Angela wants the same faces every week. Staff parks behind the building and uses the kitchen door. Call time is 2 hours before doors.', 'Angela quiere las mismas caras cada semana. El personal se estaciona atrás y entra por la cocina. Se llega 2 horas antes de abrir puertas.')]],
  });

  k.job({
    id: 'j5', name: tx('Desai and Kaplan wedding', 'Boda Desai y Kaplan'), clientId: 'c6', address: 'Sample Vineyard & Events, 95 Sample Ln, Hammonton, NJ', type: 'wedding', status: 'progress', price: 4900, start: sat, end: sat, leadId: 'l11',
    scope: tx('Wedding for 190 guests at the vineyard: 8 servers, 2 bartenders, a captain and a setup lead. Cocktail hour on the lawn, plated dinner in the barn, sparkler exit at 10:30 pm. Teardown the same night.', 'Boda para 190 invitados en el viñedo: 8 meseros, 2 bartenders, una capitana y un encargado de montaje. Coctel en el jardín, cena servida en el granero, salida con luces de bengala a las 10:30 pm. Desmontaje esa misma noche.'),
    payTerms: tx('50% deposit, balance 7 days before the wedding.', '50% de depósito, saldo 7 días antes de la boda.'),
    assign: [
      { workerId: 'w1', scope: captain, price: 450, status: 'pending' },
      { workerId: 'w2', scope: servers(8), price: 1440, payType: 'daily', rate: 180, qty: 8, status: 'pending' },
      { workerId: 'w3', scope: tx('Bartender, main bar', 'Bartender, barra principal'), price: 220, payType: 'daily', rate: 220, qty: 1, status: 'pending' },
      { workerId: 'w6', scope: tx('Bartender, lawn bar', 'Bartender, barra del jardín'), price: 210, payType: 'hourly', rate: 30, qty: 7, status: 'pending' },
      { workerId: 'w5', scope: tx('Setup and teardown', 'Montaje y desmontaje'), price: 200, payType: 'daily', rate: 200, qty: 1, status: 'pending' },
    ],
    expenses: [{ date: -6, vendor: tx('Glassware rental', 'Renta de cristalería'), desc: tx('Champagne flutes and wine glasses, 200 of each', 'Copas de champaña y de vino, 200 de cada una'), amount: 310 }],
    received: [{ date: -25, method: 'zelle', ref: deposit, amount: 2450 }, { date: sat - 8, method: 'zelle', ref: balance, amount: 2450 }],
    tasks: [
      { title: tx('Reserve the glassware', 'Apartar la cristalería'), who: 'u3', due: -6, status: 'done' },
      { title: tx('Final timeline from the planner', 'Programa final de la organizadora'), who: 'u1', due: -3, status: 'done' },
      { title: tx('Send call times to all staff', 'Mandar las horas de llegada a todo el personal'), who: 'u2', due: 0, status: 'doing', pri: 'high' },
      { title: tx('Pack the bar kits and the sparkler buckets', 'Empacar los kits de barra y las cubetas para las bengalas'), who: 'w5', due: soon(sat - 1) },
      { title: tx('Run of show: ceremony 4:30, dinner 6:15, sparkler exit 10:30', 'Programa: ceremonia 4:30, cena 6:15, salida con bengalas 10:30'), who: 'w1', due: sat, pri: 'high' },
    ],
    notes: [
      [-26, 'call', tx('Two ceremonies: a short Hindu ceremony at 3 and the main one at 4:30. Vegetarian plates are marked with a green card. No beef on the menu.', 'Dos ceremonias: una ceremonia hindú corta a las 3 y la principal a las 4:30. Los platos vegetarianos van marcados con una tarjeta verde. Nada de res en el menú.')],
      [-3, 'email', tx('The planner sent the final timeline: 190 guests, 22 vegetarian, 6 kids.', 'La organizadora mandó el programa final: 190 invitados, 22 vegetarianos, 6 niños.')],
    ],
  });

  k.job({
    id: 'j6', name: tx('Chamber awards dinner', 'Cena de premios de la cámara'), clientId: 'c7', address: 'Sample Banquet Hall, 350 Sample Ave, Northfield, NJ', type: 'corporate', status: 'done', price: 3600, start: -6, end: -6, manager: 'u2',
    scope: tx('Awards dinner for 160: registration desk and coat check, 6 servers, 1 bartender and a captain. Plated dinner, awards at 8 pm.', 'Cena de premios para 160: mesa de registro y guardarropa, 6 meseros, 1 bartender y una capitana. Cena servida, premios a las 8 pm.'),
    payTerms: tx('50% deposit, balance net 15 after the event.', '50% de depósito, saldo a 15 días después del evento.'),
    assign: [
      { workerId: 'w1', scope: captain, price: 400, status: 'done' },
      { workerId: 'w2', scope: servers(6), price: 1080, payType: 'daily', rate: 180, qty: 6, status: 'done' },
      { workerId: 'w6', scope: bartender, price: 180, payType: 'hourly', rate: 30, qty: 6, status: 'done' },
      { workerId: 'w8', scope: tx('Registration desk and coat check', 'Mesa de registro y guardarropa'), price: 120, payType: 'hourly', rate: 20, qty: 6, status: 'done' },
    ],
    expenses: [{ date: -7, vendor: linen, desc: tx('Navy linens and napkins', 'Manteles y servilletas azul marino'), amount: 280 }],
    received: [{ date: -20, method: 'check', ref: deposit, amount: 1800 }],
    workerPays: [
      { date: -6, workerId: 'w8', method: 'cash', amount: 120, payType: 'hourly', from: -6, to: -6 },
      { date: -5, workerId: 'w1', method: 'zelle', amount: 400, payType: 'project' },
      { date: -5, workerId: 'w2', method: 'zelle', amount: 1080, payType: 'daily', from: -6, to: -6 },
      { date: -5, workerId: 'w6', method: 'zelle', amount: 180, payType: 'hourly', from: -6, to: -6 },
    ],
    tasks: [
      { title: tx('Name badges and the registration list', 'Gafetes y lista de registro'), who: 'w8', due: -6, status: 'done' },
      { title: tx('Send the final invoice', 'Mandar la factura final'), who: 'u2', due: -5, status: 'done' },
      { title: tx('Return the linens', 'Devolver la mantelería'), who: 'u3', due: -4, status: 'done' },
      { title: tx('Ask Ron for a review', 'Pedirle una reseña a Ron'), who: 'u3', due: 1, pri: 'low' },
      { title: tx('Collect the balance of $1,800', 'Cobrar el saldo de $1,800'), who: 'u2', due: 9, status: 'waiting' },
    ],
    log: [{ date: -6, workerId: 'w1', text: tx('Dinner went out on time. The awards ran 25 minutes long and staff stayed to clear. No overtime billed, it was inside the 30 minute cushion.', 'La cena salió a tiempo. Los premios se alargaron 25 minutos y el personal se quedó a recoger. No se cobró tiempo extra, entró en los 30 minutos de margen.') }],
    notes: [[-21, 'call', tx('Ron wants the registration desk open at 5:30. Award winners sit at tables 1 to 4, serve those first.', 'Ron quiere la mesa de registro abierta a las 5:30. Los premiados van en las mesas 1 a 4, esas se sirven primero.')]],
  });

  k.job({
    id: 'j7', name: tx('Thompson 50th birthday', 'Cumpleaños 50 de Keisha Thompson'), clientId: 'c8', type: 'party', status: 'done', price: 1480, start: sat - 28, end: sat - 28,
    scope: tx('Backyard party for 70: 3 servers and 1 bartender for 5 hours. The client supplies the food and the alcohol, we bring the bar kit and the ice.', 'Fiesta en el patio para 70: 3 meseros y 1 bartender por 5 horas. La clienta pone la comida y el alcohol, nosotros llevamos el kit de barra y el hielo.'),
    payTerms: tx('Half to book the date, half the week of the party.', 'La mitad para apartar la fecha, la otra mitad la semana de la fiesta.'),
    assign: [
      { workerId: 'w3', scope: bartender, price: 220, payType: 'daily', rate: 220, qty: 1, status: 'done' },
      { workerId: 'w2', scope: servers(3), price: 540, payType: 'daily', rate: 180, qty: 3, status: 'done' },
    ],
    expenses: [{ date: sat - 28, vendor: partySupply, desc: tx('Ice, garnish and cups', 'Hielo, guarniciones y vasos'), amount: 85 }],
    received: [{ date: sat - 40, method: 'zelle', ref: tx('First half', 'Primera mitad'), amount: 740 }, { date: sat - 30, method: 'zelle', ref: balance, amount: 740 }],
    workerPays: [
      { date: sat - 28, workerId: 'w3', method: 'cash', amount: 220, payType: 'daily', from: sat - 28, to: sat - 28 },
      { date: sat - 28, workerId: 'w2', method: 'cash', amount: 540, payType: 'daily', from: sat - 28, to: sat - 28 },
    ],
    tasks: [
      { title: tx('Signature cocktail list from Keisha', 'Lista de cocteles de la casa, con Keisha'), who: 'u3', due: sat - 33, status: 'done' },
      { title: tx('Bar set up by 5 pm', 'Barra montada a las 5 pm'), who: 'w3', due: sat - 28, status: 'done' },
      { title: tx('Ask Keisha for a review', 'Pedirle una reseña a Keisha'), who: 'u3', due: sat - 25, status: 'done', pri: 'low' },
    ],
    log: [{ date: sat - 28, workerId: 'w3', text: tx('Great party. The signature punch was gone by 9, switched to the backup batch. We left the yard clean.', 'Muy buena fiesta. El ponche de la casa se acabó a las 9, pasamos a la tanda de repuesto. Dejamos el patio limpio.') }],
  });

  k.job({
    id: 'j8', name: tx('Seafood festival, 2 days', 'Festival de mariscos, 2 días'), clientId: 'c9', type: 'festival', status: 'done', price: 9400, start: sat - 63, end: sat - 62,
    scope: tx('Two-day seafood festival at the marina: tents and tables, 6 servers and runners each day, wristbands at the gate, parking attendants, setup the day before and teardown Sunday night.', 'Festival de mariscos de dos días en la marina: carpas y mesas, 6 meseros y corredores cada día, pulseras en la entrada, personal de estacionamiento, montaje un día antes y desmontaje el domingo en la noche.'),
    payTerms: tx('One third at signing, one third 14 days before, balance net 15.', 'Un tercio al firmar, un tercio 14 días antes y el saldo a 15 días.'),
    assign: [
      { workerId: 'w1', scope: tx('Event captain, 2 days', 'Capitana del evento, 2 días'), price: 800, payType: 'daily', rate: 400, qty: 2, status: 'done' },
      { workerId: 'w2', scope: tx('Servers and runners x6, 2 days', 'Meseros y corredores x6, 2 días'), price: 2160, payType: 'daily', rate: 180, qty: 12, status: 'done' },
      { workerId: 'w7', scope: tx('Parking attendants, 2 lots, 2 days', 'Personal de estacionamiento, 2 lotes, 2 días'), price: 1500, status: 'done' },
      { workerId: 'w8', scope: tx('Gate and wristbands', 'Entrada y pulseras'), price: 320, payType: 'hourly', rate: 20, qty: 16, status: 'done' },
      { workerId: 'w5', scope: tx('Setup and teardown', 'Montaje y desmontaje'), price: 400, payType: 'daily', rate: 200, qty: 2, status: 'done' },
      { workerId: 'w4', scope: tx('Tents and tables', 'Carpas y mesas'), price: 1200, status: 'done' },
    ],
    expenses: [
      { date: sat - 65, vendor: tx('Print shop', 'Imprenta'), desc: tx('Wristbands and signs', 'Pulseras y letreros'), amount: 190 },
      { date: sat - 64, vendor: tx('Equipment rental', 'Renta de equipo'), desc: tx('Radios, 10 units', 'Radios, 10 unidades'), amount: 120 },
    ],
    received: [
      { date: sat - 90, method: 'check', ref: tx('First third', 'Primer tercio'), amount: 3100 },
      { date: sat - 77, method: 'check', ref: tx('Second third', 'Segundo tercio'), amount: 3100 },
      { date: sat - 50, method: 'check', ref: balance, amount: 3200 },
    ],
    workerPays: [
      { date: sat - 61, workerId: 'w1', method: 'zelle', amount: 800, payType: 'daily', from: sat - 63, to: sat - 62 },
      { date: sat - 61, workerId: 'w2', method: 'check', ref: '1171', amount: 2160, payType: 'daily', from: sat - 63, to: sat - 62 },
      { date: sat - 61, workerId: 'w8', method: 'zelle', amount: 320, payType: 'hourly', from: sat - 63, to: sat - 62 },
      { date: sat - 61, workerId: 'w5', method: 'zelle', amount: 400, payType: 'daily', from: sat - 64, to: sat - 62 },
      { date: sat - 58, workerId: 'w7', method: 'check', ref: '1173', amount: 1500, payType: 'project' },
      { date: sat - 58, workerId: 'w4', method: 'card', amount: 1200, payType: 'project' },
    ],
    tasks: [
      { title: tx('Parking plan approved by the marina', 'Plan de estacionamiento aprobado por la marina'), who: 'u1', due: sat - 70, status: 'done' },
      { title: tx('Pick up the wristbands and signs', 'Recoger las pulseras y los letreros'), who: 'u3', due: sat - 65, status: 'done' },
      { title: tx('Tents up the afternoon before', 'Carpas montadas la tarde anterior'), who: 'w4', due: sat - 64, status: 'done' },
      { title: tx('Send the final invoice', 'Mandar la factura final'), who: 'u2', due: sat - 60, status: 'done' },
    ],
    log: [
      { date: sat - 63, workerId: 'w1', text: tx('Day 1: about 1,400 people through the gate. The line backed up at noon, so I moved Hannah to a second wristband table.', 'Día 1: como 1,400 personas por la entrada. A mediodía se hizo fila, así que pasé a Hannah a una segunda mesa de pulseras.') },
      { date: sat - 62, workerId: 'w5', text: tx('Teardown done by 9 pm. Everything is back on the truck. One table has a broken leg, told the rental company.', 'Desmontaje terminado a las 9 pm. Todo de vuelta en el camión. Una mesa tiene la pata rota, ya le avisé a la compañía de rentas.') },
    ],
    notes: [[sat - 92, 'visit', tx('Walked the marina with Paul. Two gravel lots for parking, the gate goes at the boat ramp. He wants one captain on the radio both days.', 'Recorrimos la marina con Paul. Dos lotes de grava para estacionar, la entrada va en la rampa de botes. Quiere una capitana en el radio los dos días.')]],
  });

  k.job({
    id: 'j9', name: tx('Arts council street fair', 'Feria callejera del consejo de artes'), clientId: 'c10', type: 'festival', status: 'hold', price: 4300, start: sat + 15, end: sat + 15, manager: 'u2', leadId: 'l12',
    scope: tx('Street fair with 40 artist booths: setup crew of 4 at 6 am, parking attendants for 2 lots, an information table and teardown at 5 pm.', 'Feria callejera con 40 puestos de artistas: cuadrilla de montaje de 4 a las 6 am, personal de estacionamiento para 2 lotes, mesa de información y desmontaje a las 5 pm.'),
    payTerms: tx('$1,000 deposit, balance 7 days before the fair.', 'Depósito de $1,000, saldo 7 días antes de la feria.'),
    assign: [
      { workerId: 'w5', scope: tx('Setup crew of 4', 'Cuadrilla de montaje de 4'), price: 720, payType: 'daily', rate: 180, qty: 4, status: 'pending' },
      { workerId: 'w7', scope: tx('Parking attendants, 2 lots', 'Personal de estacionamiento, 2 lotes'), price: 900, status: 'pending' },
    ],
    received: [{ date: -14, method: 'check', ref: deposit, amount: 1000 }],
    tasks: [
      { title: tx('Booth map from Miriam', 'Mapa de puestos, con Miriam'), who: 'u3', due: -9, status: 'done' },
      { title: tx('Street closure permit: Miriam is waiting on the city', 'Permiso para cerrar la calle: Miriam está esperando a la ciudad'), who: 'u2', due: 3, status: 'waiting', pri: 'high' },
      { title: tx('Ask the staff who can work the rain date', 'Preguntar al personal quién puede la fecha alterna'), who: 'u2' },
    ],
    notes: [
      [-15, 'call', tx('Miriam wants the same crew that worked the marina festival.', 'Miriam quiere a la misma gente que trabajó el festival de la marina.')],
      [-5, 'call', tx('On hold. The city has not issued the street closure permit and the date may move one week. The deposit stays on the account. Miriam calls as soon as she hears.', 'En pausa. La ciudad no ha dado el permiso para cerrar la calle y la fecha se puede mover una semana. El depósito se queda a cuenta. Miriam llama en cuanto sepa algo.')],
    ],
  });

  k.job({
    id: 'j10', name: tx('Castillo 40th anniversary', 'Aniversario 40 de los Castillo'), clientId: 'c11', address: hall, type: 'party', status: 'estimate', price: 2150, start: sat + 21, end: sat + 21,
    scope: tx('Anniversary party for 90 guests: 4 servers, 1 bartender and a captain for 6 hours. Family style dinner, toast at 8 pm.', 'Fiesta de aniversario para 90 invitados: 4 meseros, 1 bartender y una capitana por 6 horas. Cena al centro de la mesa, brindis a las 8 pm.'),
    payTerms: tx('50% deposit to hold the date, balance 7 days before.', '50% de depósito para apartar la fecha, saldo 7 días antes.'),
    assign: [
      { workerId: 'w1', scope: captain, price: 350, status: 'pending' },
      { workerId: 'w2', scope: servers(4), price: 720, payType: 'daily', rate: 180, qty: 4, status: 'pending' },
      { workerId: 'w6', scope: bartender, price: 180, payType: 'hourly', rate: 30, qty: 6, status: 'pending' },
    ],
    tasks: [{ title: tx('Follow up with Fernando on the estimate', 'Darle seguimiento a Fernando con el estimado'), who: 'u1', due: 2 }],
    notes: [[-1, 'call', tx('It is a surprise for his wife. Text Fernando or call his cell, never the house. Prefers Spanish.', 'Es sorpresa para su esposa. Mensaje o llamada al celular de Fernando, nunca a la casa. Prefiere español.')]],
  });

  k.job({
    id: 'j11', name: tx('Product launch reception', 'Recepción de lanzamiento de producto'), clientId: 'c12', address: 'Sample Convention Hall, Atlantic City, NJ', type: 'service', status: 'done', price: 2240, start: -13, end: -13, manager: 'u2',
    scope: tx('Servers and a bartender for a reception catered by Sample Catering Co.: 5 servers for passed appetizers, 1 bartender and a captain. 5 hours.', 'Meseros y bartender para una recepción con banquete de Sample Catering Co.: 5 meseros para pasar bocadillos, 1 bartender y una capitana. 5 horas.'),
    payTerms: tx('Net 15.', 'A 15 días.'),
    assign: [
      { workerId: 'w1', scope: captain, price: 350, status: 'done' },
      { workerId: 'w2', scope: servers(5), price: 900, payType: 'daily', rate: 180, qty: 5, status: 'done' },
      { workerId: 'w6', scope: bartender, price: 180, payType: 'hourly', rate: 30, qty: 6, status: 'done' },
    ],
    received: [{ date: 0, method: 'transfer', ref: paidFull, amount: 2240 }],
    workerPays: [
      { date: -12, workerId: 'w1', method: 'zelle', amount: 350, payType: 'project' },
      { date: -12, workerId: 'w2', method: 'zelle', amount: 900, payType: 'daily', from: -13, to: -13 },
      { date: -12, workerId: 'w6', method: 'zelle', amount: 180, payType: 'hourly', from: -13, to: -13 },
    ],
    tasks: [
      { title: tx('Staff list to Andre', 'Lista del personal para Andre'), who: 'u3', due: -15, status: 'done' },
      { title: tx('Call time 4 pm at the loading dock', 'Llegada a las 4 pm por el andén de carga'), who: 'w1', due: -13, status: 'done' },
      { title: tx('Send the invoice', 'Mandar la factura'), who: 'u2', due: -12, status: 'done' },
    ],
    log: [{ date: -13, workerId: 'w1', text: tx('The passed appetizers went fast and the kitchen sent 2 extra rounds. The client asked for the names of two of our servers.', 'Los bocadillos volaron y la cocina mandó 2 rondas extra. El cliente pidió los nombres de dos de nuestros meseros.') }],
  });

  k.job({
    id: 'j12', name: tx('Wedding service staff for the caterer', 'Personal de servicio para boda, con el banquetero'), clientId: 'c12', address: 'Sample Lakeside Pavilion, Mays Landing, NJ', type: 'service', status: 'progress', price: 2900, start: sat + 1, end: sat + 1, manager: 'u2', leadId: 'l13',
    scope: tx('Service staff for a wedding catered by Sample Catering Co.: 7 servers and 2 bartenders. Plated dinner for 150. The caterer runs the kitchen and brings his own captain.', 'Personal de servicio para una boda con banquete de Sample Catering Co.: 7 meseros y 2 bartenders. Cena servida para 150. El banquetero lleva la cocina y trae a su propio capitán.'),
    payTerms: tx('Net 15 after the event.', 'A 15 días después del evento.'),
    assign: [
      { workerId: 'w2', scope: servers(7), price: 1260, payType: 'daily', rate: 180, qty: 7, status: 'pending' },
      { workerId: 'w3', scope: bartender, price: 220, payType: 'daily', rate: 220, qty: 1, status: 'pending' },
      { workerId: 'w6', scope: bartender, price: 210, payType: 'hourly', rate: 30, qty: 7, status: 'pending' },
    ],
    tasks: [
      { title: tx('Confirm 7 servers with Carlos', 'Confirmar 7 meseros con Carlos'), who: 'u2', due: 0, status: 'doing' },
      { title: tx('Send the staff list and call times to Andre', 'Mandarle a Andre la lista del personal y las horas de llegada'), who: 'u3', due: 1 },
      { title: tx('Uniform check: black vests for this one, not aprons', 'Revisar uniformes: aquí van chalecos negros, no mandiles'), who: 'w2', due: sat + 1 },
    ],
    notes: [[-1, 'call', tx('Andre: 150 guests, plated, three courses. He wants our best 7. Black vests, not the aprons.', 'Andre: 150 invitados, cena servida, tres tiempos. Quiere a nuestros 7 mejores. Chalecos negros, no los mandiles.')]],
  });

  k.job({
    id: 'j13', name: tx('Wine dinner, 90 guests', 'Cena maridaje, 90 invitados'), clientId: 'c5', type: 'service', status: 'done', price: 2650, start: -89, end: -89,
    scope: tx('Five-course wine dinner for 90 in the barrel room: 5 servers, a wine pourer and a captain. All tables are served at the same time for each course.', 'Cena maridaje de cinco tiempos para 90 en la sala de barricas: 5 meseros, una persona para servir el vino y una capitana. Todas las mesas se sirven al mismo tiempo en cada tiempo.'),
    payTerms: tx('Paid in full 7 days before.', 'Se paga completo 7 días antes.'),
    assign: [
      { workerId: 'w1', scope: captain, price: 350, status: 'done' },
      { workerId: 'w2', scope: servers(5), price: 900, payType: 'daily', rate: 180, qty: 5, status: 'done' },
      { workerId: 'w9', scope: tx('Wine service', 'Servicio de vino'), price: 154, payType: 'hourly', rate: 22, qty: 7, status: 'done' },
    ],
    expenses: [{ date: -90, vendor: linen, desc: tx('Ivory linens and napkins', 'Manteles y servilletas color marfil'), amount: 160 }],
    received: [{ date: -97, method: 'check', ref: paidFull, amount: 2650 }],
    workerPays: [
      { date: -89, workerId: 'w9', method: 'cash', amount: 154, payType: 'hourly', from: -89, to: -89 },
      { date: -88, workerId: 'w1', method: 'zelle', amount: 350, payType: 'project' },
      { date: -88, workerId: 'w2', method: 'zelle', amount: 900, payType: 'daily', from: -89, to: -89 },
    ],
    tasks: [
      { title: tx('Course timing with the chef', 'Tiempos de cada platillo con el chef'), who: 'w1', due: -90, status: 'done' },
      { title: tx('Return the linens', 'Devolver la mantelería'), who: 'u3', due: -87, status: 'done' },
      { title: tx('Thank you note to Claire', 'Nota de agradecimiento para Claire'), who: 'u1', due: -86, status: 'done', pri: 'low' },
    ],
    log: [{ date: -89, workerId: 'w9', text: tx('Poured all five pairings. Table 6 asked for the dessert wine twice and the vineyard said yes.', 'Serví los cinco maridajes. La mesa 6 pidió dos veces el vino de postre y el viñedo dijo que sí.') }],
  });

  k.job({
    id: 'j14', name: tx('Retirement luncheon', 'Comida de jubilación'), clientId: 'c2', type: 'corporate', status: 'done', price: 1900, start: -104, end: -104, manager: 'u2',
    scope: tx('Retirement luncheon for 80 in the company cafeteria: setup, 4 servers for the buffet, a check-in table and cleanup.', 'Comida de jubilación para 80 en la cafetería de la compañía: montaje, 4 meseros para el buffet, mesa de registro y limpieza.'),
    payTerms: tx('Net 15.', 'A 15 días.'),
    assign: [
      { workerId: 'w2', scope: servers(4), price: 720, payType: 'daily', rate: 180, qty: 4, status: 'done' },
      { workerId: 'w8', scope: tx('Check-in table', 'Mesa de registro'), price: 100, payType: 'hourly', rate: 20, qty: 5, status: 'done' },
      { workerId: 'w5', scope: tx('Setup and cleanup', 'Montaje y limpieza'), price: 200, payType: 'daily', rate: 200, qty: 1, status: 'done' },
    ],
    expenses: [{ date: -104, vendor: partySupply, desc: tx('Table covers and centerpieces', 'Manteles desechables y centros de mesa'), amount: 90 }],
    received: [{ date: -92, method: 'check', ref: paidFull, amount: 1900 }],
    workerPays: [
      { date: -103, workerId: 'w2', method: 'zelle', amount: 720, payType: 'daily', from: -104, to: -104 },
      { date: -103, workerId: 'w8', method: 'zelle', amount: 100, payType: 'hourly', from: -104, to: -104 },
      { date: -103, workerId: 'w5', method: 'zelle', amount: 200, payType: 'daily', from: -104, to: -104 },
    ],
    tasks: [
      { title: tx('Guest list from Brett for the check-in table', 'Lista de invitados para la mesa de registro, con Brett'), who: 'u3', due: -106, status: 'done' },
      { title: tx('Cafeteria set by 11 am', 'Cafetería lista a las 11 am'), who: 'w5', due: -104, status: 'done' },
      { title: tx('Send the invoice', 'Mandar la factura'), who: 'u2', due: -103, status: 'done' },
    ],
    log: [{ date: -104, workerId: 'w5', text: tx('Room was set by 10:40. 80 served and the cafeteria was back to normal by 2 pm.', 'El salón quedó listo a las 10:40. Se sirvió a 80 y la cafetería estaba como siempre a las 2 pm.') }],
  });

  /* ---------- leads ---------- */
  k.lead({ id: 'l1', name: 'Jessica & Mark', phone: '609-555-0151', email: 'jessica@example.com', address: 'Sample Estate Venue, Cape May, NJ', type: 'wedding', source: 'instagram', status: 'scheduled', pri: 'high', value: 4800, appt: [5, '15:00'], created: -2,
    notes: [[-2, 'note', tx('Wedding for 180 guests. Needs setup, 8 servers, 2 bartenders and teardown. Venue walkthrough first.', 'Boda para 180 invitados. Necesitan montaje, 8 meseros, 2 bartenders y desmontaje. Primero un recorrido del lugar.')]] });
  k.lead({ id: 'l2', name: 'Dana Whitfield', company: 'Sample Tech Inc.', phone: '609-555-0152', email: 'dana@example.com', address: 'Sample Convention Center, Atlantic City, NJ', type: 'corporate', source: 'website', status: 'new', value: 6500, followUp: 0, created: -1,
    notes: [[-1, 'note', tx('Web form: 2-day conference, registration staff both days and booth setup the night before.', 'Formulario web: conferencia de 2 días, personal de registro los dos días y montaje de stands la noche anterior.')]] });
  k.lead({ id: 'l3', name: 'Valeria Montoya', phone: '609-555-0153', address: '30 Sample St, Hammonton, NJ', type: 'party', source: 'facebook', status: 'new', owner: 'u3', created: 0,
    notes: [[0, 'text', tx('Message from the page: quinceañera for her daughter, about 200 guests. Saw the photos from another quinceañera we worked. Prefers Spanish.', 'Mensaje por la página: quinceañera de su hija, como 200 invitados. Vio las fotos de otra quinceañera que trabajamos. Prefiere español.')]] });
  k.lead({ id: 'l4', name: 'Ed Malone', company: 'Sample Volunteer Fire Company', phone: '609-555-0154', address: '12 Sample Rd, Mays Landing, NJ', type: 'party', source: 'phone', status: 'new', followUp: 1, created: 0,
    notes: [[0, 'call', tx('Annual awards banquet at the firehouse hall, 120 guests. Needs 2 bartenders and 4 servers. Budget is tight, asked if we have a nonprofit rate.', 'Banquete anual de premios en el salón de la estación, 120 invitados. Necesita 2 bartenders y 4 meseros. Presupuesto apretado, preguntó si hay tarifa para organizaciones sin fines de lucro.')]] });
  k.lead({ id: 'l5', name: 'Heather Lang', company: 'Sample Golf Club', phone: '609-555-0155', email: 'heather@example.com', address: '500 Sample Dr, Galloway, NJ', type: 'service', source: 'referral', status: 'sent', owner: 'u2', value: 3200, appt: [-8, '11:00'], followUp: 2, created: -12,
    notes: [[-12, 'call', tx('Needs on-call servers for outings and member dinners, about 2 events a month. Andre from the catering company gave her our name.', 'Necesita meseros de guardia para torneos y cenas de socios, como 2 eventos al mes. Andre, el banquetero, le dio nuestro nombre.')], [-7, 'email', tx('Sent the rate sheet and an estimate for the first month: $3,200.', 'Se mandó la lista de tarifas y un estimado del primer mes: $3,200.')]] });
  k.lead({ id: 'l6', name: 'Omar Haddad', phone: '609-555-0156', email: 'omar@example.com', address: 'Sample Grand Ballroom, Atlantic City, NJ', type: 'wedding', source: 'google', status: 'contacted', pri: 'high', value: 7800, followUp: -2, created: -6,
    notes: [[-6, 'call', tx('Two-day wedding, 300 guests the second night. Wants 12 servers, 3 bartenders and valet. Two families are paying, both want to see the estimate.', 'Boda de dos días, 300 invitados la segunda noche. Quiere 12 meseros, 3 bartenders y valet. Pagan las dos familias y las dos quieren ver el estimado.')], [-4, 'call', tx('Left a voicemail. He said evenings after 7 are best.', 'Le dejé mensaje de voz. Dijo que es mejor llamarle después de las 7 de la noche.')]] });
  k.lead({ id: 'l7', name: 'Tessa Brandt', company: 'Sample Brewery', phone: '609-555-0157', email: 'tessa@example.com', address: '77 Sample Ave, Egg Harbor City, NJ', type: 'festival', source: 'instagram', status: 'contacted', followUp: 1, created: -5,
    notes: [[-5, 'text', tx('Anniversary party at the brewery, expects 600 over the day. Needs ID checkers at the gate and a cleanup crew.', 'Fiesta de aniversario en la cervecería, esperan 600 personas durante el día. Necesita quien revise identificaciones en la entrada y cuadrilla de limpieza.')]] });
  k.lead({ id: 'l8', name: 'Gina Marchetti', company: 'Sample Realty Group', phone: '609-555-0158', email: 'gina@example.com', address: '3 Sample Pl, Margate, NJ', type: 'corporate', source: 'website', status: 'scheduled', owner: 'u2', value: 2400, appt: [0, '14:00'], created: -3,
    notes: [[-3, 'note', tx('Web form: client appreciation night at their office, 100 guests, passed appetizers and a bar. Wants to walk the space with us.', 'Formulario web: noche de agradecimiento a clientes en su oficina, 100 invitados, bocadillos y barra. Quiere recorrer el espacio con nosotros.')]] });
  k.lead({ id: 'l9', name: 'Grace Liu', phone: '609-555-0159', email: 'grace@example.com', address: 'Sample Vineyard & Events, 95 Sample Ln, Hammonton, NJ', type: 'wedding', source: 'referral', status: 'scheduled', value: 5200, appt: [2, '11:00'], created: -4,
    notes: [[-4, 'call', tx('Wedding at the vineyard, 170 guests. Claire, the venue coordinator, sent her. Tea ceremony before the reception, needs 2 people to help serve it.', 'Boda en el viñedo, 170 invitados. La mandó Claire, la coordinadora del lugar. Ceremonia del té antes de la recepción, necesita 2 personas que ayuden a servirla.')]] });
  k.lead({ id: 'l10', name: 'Walt Jennings', company: 'Sample County Fair Committee', phone: '609-555-0160', email: 'walt@example.com', address: 'Sample Fairgrounds, Egg Harbor City, NJ', type: 'security', source: 'other', status: 'sent', value: 8400, appt: [-10, '18:00'], followUp: 5, created: -15,
    notes: [[-15, 'visit', tx('Met the committee at their monthly meeting. 4-day fair, they need gate staff and parking for 3 fields.', 'Conocí al comité en su junta mensual. Feria de 4 días, necesitan personal de entrada y de estacionamiento para 3 campos.')], [-9, 'email', tx('Estimate sent: $8,400 for gate and parking, 4 days. They vote at the next meeting.', 'Estimado enviado: $8,400 por entrada y estacionamiento, 4 días. Votan en la próxima junta.')]] });
  k.lead({ id: 'l11', name: 'Anjali Desai', phone: '609-555-0106', email: 'anjali@example.com', address: 'Sample Vineyard & Events, 95 Sample Ln, Hammonton, NJ', type: 'wedding', source: 'instagram', status: 'won', pri: 'high', value: 4900, created: -33, clientId: 'c6', jobId: 'j5',
    notes: [[-33, 'text', tx('Wedding at the vineyard for 190. Found us through the venue page. Needs servers, 2 bars and a captain.', 'Boda en el viñedo para 190. Nos encontró por la página del lugar. Necesita meseros, 2 barras y una capitana.')], [-27, 'call', tx('Went over the estimate with Anjali and her planner. She booked and paid the deposit.', 'Revisamos el estimado con Anjali y su organizadora. Apartó la fecha y pagó el depósito.')]] });
  k.lead({ id: 'l12', name: 'Miriam Katz', company: 'Sample Arts Council', phone: '609-555-0110', email: 'miriam@example.com', address: '22 Sample Ave, Ventnor, NJ', type: 'festival', source: 'website', status: 'won', owner: 'u2', value: 4300, created: -21, clientId: 'c10', jobId: 'j9',
    notes: [[-21, 'note', tx('Web form: street fair with 40 artist booths, needs setup, parking and teardown. She was at the marina festival and liked how the gate ran.', 'Formulario web: feria callejera con 40 puestos de artistas, necesita montaje, estacionamiento y desmontaje. Estuvo en el festival de la marina y le gustó cómo se manejó la entrada.')]] });
  k.lead({ id: 'l13', name: 'Andre Baptiste', company: 'Sample Catering Co.', phone: '609-555-0112', email: 'andre@example.com', address: 'Sample Lakeside Pavilion, Mays Landing, NJ', type: 'service', source: 'phone', status: 'won', owner: 'u2', value: 2900, created: -8, clientId: 'c12', jobId: 'j12',
    notes: [[-8, 'call', tx('Andre has a wedding for 150 and needs 7 servers and 2 bartenders. Plated, three courses. Same terms as always.', 'Andre tiene una boda para 150 y necesita 7 meseros y 2 bartenders. Cena servida, tres tiempos. Los mismos términos de siempre.')]] });
  k.lead({ id: 'l14', name: 'Rebecca Stone', phone: '609-555-0161', email: 'rebecca@example.com', address: 'Sample Oceanfront Hotel, Atlantic City, NJ', type: 'wedding', source: 'google', status: 'lost', value: 5600, created: -26,
    notes: [[-26, 'call', tx('Wedding for 220 at a hotel. Wanted servers, bartenders and teardown.', 'Boda para 220 en un hotel. Quería meseros, bartenders y desmontaje.')]],
    lostReason: tx('The hotel requires its own in-house staff. They could only use us for teardown and passed.', 'El hotel exige su propio personal. Solo nos podían usar para el desmontaje y no les convino.') });
  k.lead({ id: 'l15', name: 'Kurt Lindholm', company: 'Sample Fitness Expo', phone: '609-555-0162', email: 'kurt@example.com', address: 'Sample Convention Center, Atlantic City, NJ', type: 'corporate', source: 'facebook', status: 'lost', owner: 'u3', value: 3300, created: -35,
    notes: [[-35, 'text', tx('Expo with 60 vendors. Asked for registration staff and floor runners for one day.', 'Expo con 60 expositores. Pidió personal de registro y corredores de piso por un día.')]],
    lostReason: tx('Their budget was cut. They are using volunteers at the registration desk.', 'Les recortaron el presupuesto. Van a usar voluntarios en la mesa de registro.') });

  /* ---------- office tasks ---------- */
  k.task({ title: tx('Renew the general liability and liquor liability insurance', 'Renovar el seguro de responsabilidad civil y el de responsabilidad por alcohol'), who: 'u1', due: 15, pri: 'high' });
  k.task({ title: tx('Order 12 black aprons and 6 vests', 'Pedir 12 mandiles negros y 6 chalecos'), who: 'u3', due: 0 });
  k.task({ title: tx('On-call list: who is free the next two weekends', 'Lista de guardia: quién puede los próximos dos fines de semana'), who: 'u2', due: 1, status: 'doing' });
  k.task({ title: tx('Get a current insurance certificate from Sample Valet & Parking', 'Pedirle a Sample Valet & Parking un certificado de seguro vigente'), who: 'u3', due: -2, status: 'waiting', pri: 'high' });
  k.task({ title: tx('Check the alcohol server certificates of all bartenders', 'Revisar los certificados para servir alcohol de todos los bartenders'), who: 'u2', due: -1, status: 'review' });
  k.task({ title: tx('Call Omar Haddad back about the two-day wedding', 'Volver a llamar a Omar Haddad por la boda de dos días'), who: 'u1', due: -2, pri: 'high', leadId: 'l6' });
  k.task({ title: tx('Count the bar kits and restock what is missing', 'Contar los kits de barra y reponer lo que falte'), who: 'w5', due: 4 });
  k.task({ title: tx('Orientation for 3 new servers', 'Orientación para 3 meseros nuevos'), who: 'u2', due: 10 });
  k.task({ title: tx('Update the staff rate sheet', 'Actualizar la lista de tarifas del personal'), who: 'u2', due: -1, status: 'done' });

  return k.finish();
}
