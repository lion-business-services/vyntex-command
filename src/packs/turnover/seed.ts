import type { Lang, SeedData } from '@/domain/types';
import { seedKit } from '../seedkit';

/** Sample business for this edition. Fictional data only. */
export function seed(lang: Lang): SeedData {
  const k = seedKit(lang, 'VT-');
  const { tx } = k;

  // wording that repeats
  const paintStore = tx('Paint store', 'Tienda de pintura');
  const hardware = tx('Hardware store', 'Ferretería');
  const supply = tx('Supply store', 'Tienda de suministros');
  const cleaner = tx('Cleaner', 'Limpieza');
  const deposit = tx('Deposit', 'Depósito');
  const balance = tx('Balance', 'Saldo');
  const insurer = 'Sample Mutual Insurance';

  /* ---------- subcontractors ---------- */
  k.worker({ id: 'w1', name: 'Sample Painting LLC', trade: tx('Painter', 'Pintor'), phone: '609-555-0141', email: 'painting@example.com', payType: 'project', w9: 300, coi: 120, insurer });
  k.worker({ id: 'w2', name: 'Rosa Martínez', trade: cleaner, phone: '609-555-0142', email: 'rosa@example.com', payType: 'daily', rate: 150, w9: 200 });
  k.worker({ id: 'w3', name: 'Sample Flooring Co.', trade: tx('Flooring and carpet', 'Pisos y alfombra'), phone: '609-555-0143', email: 'flooring@example.com', payType: 'project', w9: 260, coi: -6, insurer });
  k.worker({ id: 'w4', name: 'Jorge Díaz', trade: tx('Handyman', 'Reparaciones generales'), phone: '609-555-0144', email: 'jorge@example.com', payType: 'daily', rate: 200 });
  k.worker({ id: 'w5', name: 'Andre Whitaker', trade: tx('Carpet cleaning', 'Lavado de alfombras'), phone: '609-555-0145', email: 'andre@example.com', payType: 'project', w9: 140, coi: 16, insurer });
  k.worker({ id: 'w6', name: 'Sample Appliance Service LLC', trade: tx('Appliances', 'Electrodomésticos'), phone: '609-555-0146', email: 'appliance@example.com', payType: 'project', w9: 180, coi: 150, insurer });
  k.worker({ id: 'w7', name: 'Milagros Peña', trade: cleaner, phone: '609-555-0147', email: 'milagros@example.com', payType: 'daily', rate: 140, w9: 60 });
  k.worker({ id: 'w8', name: 'Dmitri Volkov', trade: tx('Drywall and patching', 'Drywall y resanes'), phone: '609-555-0148', email: 'dmitri@example.com', payType: 'daily', rate: 220, w9: 320, active: false });
  k.worker({ id: 'w9', name: 'Kwame Mensah', trade: tx('Locksmith', 'Cerrajero'), phone: '609-555-0149', email: 'kwame@example.com', payType: 'project', w9: 90, coi: 240, insurer });

  /* ---------- property managers and owners ---------- */
  k.client({ id: 'c1', name: 'Stephanie Howard', company: 'Bayside Property Management', phone: '609-555-0101', email: 'stephanie@example.com', addresses: ['100 Sample Blvd, Absecon, NJ', '40 Sample Ter, Ventnor, NJ'], since: -110,
    note: tx('Manages about 60 units. Pays net 15 after she approves the walkthrough photos. Every unit needs before and after photos.', 'Administra unas 60 unidades. Paga a 15 días después de aprobar las fotos del recorrido. Cada unidad lleva fotos de antes y después.') });
  k.client({ id: 'c2', name: 'Marcus Bell', company: 'Sample Rentals LLC', phone: '609-555-0102', email: 'marcus@example.com', addresses: ['6 Sample Ct, Northfield, NJ'], since: -40 });
  k.client({ id: 'c3', name: 'Tasha Coleman', company: 'Sample Gardens Apartments', phone: '609-555-0103', email: 'tasha@example.com', addresses: ['250 Sample Blvd, Pleasantville, NJ'], since: -95,
    note: tx('On-site manager. 140 units in 3 buildings. Keys are signed out and back in at the leasing office.', 'Administradora en el sitio. 140 unidades en 3 edificios. Las llaves se piden y se devuelven con firma en la oficina de rentas.') });
  k.client({ id: 'c4', name: 'Hyun-woo Park', phone: '609-555-0104', email: 'hyunwoo@example.com', addresses: ['72 Sample Rd, Egg Harbor Twp, NJ', '74 Sample Rd, Egg Harbor Twp, NJ'], since: -50,
    note: tx('Owns two duplexes side by side. Likes to walk the unit himself at the end.', 'Es dueño de dos dúplex, uno junto al otro. Le gusta recorrer la unidad él mismo al final.') });
  k.client({ id: 'c5', name: 'Joanne Fischer', company: 'Sample Realty & Rentals', phone: '609-555-0105', email: 'joanne@example.com', addresses: ['18 Sample Ave, Margate, NJ'], since: -35 });
  k.client({ id: 'c6', name: 'Ernesto Vargas', phone: '609-555-0106', email: 'ernesto@example.com', addresses: ['210 Sample Ave, Atlantic City, NJ'], since: -9 });
  k.client({ id: 'c7', name: 'Denise Okoye', company: 'Sample Housing Partners', phone: '609-555-0107', email: 'denise@example.com', addresses: ['500 Sample St, Pleasantville, NJ'], since: -24,
    note: tx('Nonprofit housing. Every unit is inspected before move-in. Pays net 30 and approves changes in writing.', 'Vivienda sin fines de lucro. Cada unidad pasa inspección antes de la mudanza. Paga a 30 días y aprueba los cambios por escrito.') });
  k.client({ id: 'c8', name: 'Linda Kowalczyk', phone: '609-555-0108', email: 'linda@example.com', addresses: ['12 Sample Ct, Galloway, NJ'], since: -85, emailOptOut: true,
    note: tx('Lives out of state. Wants a phone call and photos by text. No automatic emails.', 'Vive en otro estado. Quiere llamada y fotos por mensaje de texto. Nada de correos automáticos.') });
  k.client({ id: 'c9', name: 'Rob Castellano', company: 'Sample Student Housing', phone: '609-555-0109', email: 'rob@example.com', addresses: ['33 Sample Dr, Galloway, NJ'], since: -18 });
  k.client({ id: 'c10', name: 'Carlos Benítez', phone: '609-555-0110', email: 'carlos@example.com', addresses: ['45 Sample Ln, Hammonton, NJ'], since: -106 });

  /* ---------- units ---------- */
  k.job({
    id: 'j1', name: tx('Unit 2B', 'Unidad 2B'), clientId: 'c1', address: '100 Sample Blvd, Absecon, NJ', type: 'full', status: 'progress', price: 3200, start: -3, end: 4,
    scope: tx('Patch and paint all walls, replace the carpet in 2 bedrooms, deep clean, replace the blinds and fix the bathroom faucet.', 'Resanar y pintar todas las paredes, cambiar la alfombra de 2 recámaras, limpieza profunda, cambiar las persianas y arreglar la llave del baño.'),
    payTerms: tx('Net 15 after the manager approves the walkthrough.', 'A 15 días después de que la administradora apruebe el recorrido.'),
    assign: [
      { workerId: 'w1', scope: tx('Paint the whole unit', 'Pintar toda la unidad'), price: 950, status: 'progress' },
      { workerId: 'w3', scope: tx('Carpet, 2 bedrooms', 'Alfombra, 2 recámaras'), price: 780, status: 'pending' },
      { workerId: 'w2', scope: tx('Deep clean', 'Limpieza profunda'), price: 150, payType: 'daily', rate: 150, qty: 1, status: 'pending' },
      { workerId: 'w4', scope: tx('Faucet and blinds', 'Llave del baño y persianas'), price: 200, payType: 'daily', rate: 200, qty: 1, status: 'done' },
    ],
    expenses: [
      { date: -3, vendor: hardware, desc: tx('Blinds, faucet cartridge and patch kit', 'Persianas, cartucho de la llave y kit de resane'), amount: 145 },
      { date: -2, vendor: paintStore, desc: tx('Paint, 8 gallons, and primer', 'Pintura, 8 galones, y sellador'), amount: 265 },
    ],
    workerPays: [{ date: -1, workerId: 'w4', method: 'zelle', amount: 200, payType: 'daily', from: -1, to: -1 }],
    tasks: [
      { title: tx('Fix the bathroom faucet and hang the blinds', 'Arreglar la llave del baño y poner las persianas'), who: 'w4', due: -1, status: 'done' },
      { title: tx('Second coat in the bedrooms', 'Segunda mano en las recámaras'), who: 'w1', due: 0, status: 'doing' },
      { title: tx('Carpet install, 2 bedrooms', 'Instalar alfombra, 2 recámaras'), who: 'w3', due: 2 },
      { title: tx('Deep clean after the carpet is in', 'Limpieza profunda después de la alfombra'), who: 'w2', due: 3 },
      { title: tx('Change the locks', 'Cambiar las chapas'), who: 'w4', due: 4, pri: 'high' },
      { title: tx('Photos of every room for the manager', 'Fotos de cada cuarto para la administradora'), who: 'u1', due: 4, pri: 'high' },
    ],
    log: [
      { date: -1, workerId: 'w4', text: tx('Faucet cartridge replaced, no more drip. Blinds are up in every window. The closet door in bedroom 2 was off its track, fixed it.', 'Cambié el cartucho de la llave, ya no gotea. Persianas puestas en todas las ventanas. La puerta del clóset de la recámara 2 estaba fuera del riel, ya quedó.') },
      { date: 0, workerId: 'w1', text: tx('First coat is done everywhere. The kitchen ceiling needed stain blocker. Second coat in the bedrooms today.', 'Primera mano lista en todo. El techo de la cocina necesitó sellador antimanchas. Hoy va la segunda mano en las recámaras.') },
    ],
    notes: [[-4, 'call', tx('Lockbox 8246 on the door. Stephanie needs the unit rent-ready in one week, the new tenant already signed.', 'Caja de llaves 8246 en la puerta. Stephanie necesita la unidad lista para rentar en una semana, el inquilino nuevo ya firmó.')]],
  });

  k.job({
    id: 'j2', name: tx('Unit 4C', 'Unidad 4C'), clientId: 'c1', address: '100 Sample Blvd, Absecon, NJ', type: 'paint', status: 'estimate', price: 1400, start: 6, end: 9,
    scope: tx('Paint the whole 2-bedroom unit in one color, patch the nail holes and do a standard move-out clean.', 'Pintar toda la unidad de 2 recámaras en un solo color, resanar los hoyos de clavos y hacer la limpieza normal de salida.'),
    payTerms: tx('Net 15 after the walkthrough.', 'A 15 días después del recorrido.'),
    assign: [
      { workerId: 'w1', scope: tx('Paint', 'Pintura'), price: 700, status: 'pending' },
      { workerId: 'w2', scope: tx('Clean', 'Limpieza'), price: 150, payType: 'daily', rate: 150, qty: 1, status: 'pending' },
    ],
    tasks: [{ title: tx('Walk Unit 4C with Stephanie and confirm the scope', 'Recorrer la Unidad 4C con Stephanie y confirmar el alcance'), who: 'u1', due: 1 }],
    notes: [[-1, 'call', tx('The tenant moves out at the end of the week. Stephanie wants the price before then so we can start the next day.', 'El inquilino sale a fin de semana. Stephanie quiere el precio antes para que empecemos al día siguiente.')]],
  });

  k.job({
    id: 'j3', name: tx('Unit 1A', 'Unidad 1A'), clientId: 'c2', type: 'clean', status: 'done', price: 650, start: -15, end: -14, manager: 'u2',
    scope: tx('Move-out clean of a 2-bedroom unit: inside the oven, fridge and cabinets, bathrooms, baseboards, windows inside and all floors.', 'Limpieza de salida de una unidad de 2 recámaras: horno, refrigerador y gabinetes por dentro, baños, zoclos, ventanas por dentro y todos los pisos.'),
    payTerms: tx('Due when the unit is ready.', 'Se paga cuando la unidad está lista.'),
    assign: [{ workerId: 'w2', scope: tx('Move-out clean, 2 days', 'Limpieza de salida, 2 días'), price: 300, payType: 'daily', rate: 150, qty: 2, status: 'done' }],
    expenses: [{ date: -15, vendor: supply, desc: tx('Cleaning supplies and oven cleaner', 'Productos de limpieza y limpiador de horno'), amount: 35 }],
    received: [{ date: -1, method: 'check', ref: tx('Paid in full', 'Pagado completo'), amount: 650 }],
    workerPays: [{ date: -14, workerId: 'w2', method: 'cash', amount: 300, payType: 'daily', from: -15, to: -14 }],
    tasks: [
      { title: tx('Pick up the key from Marcus', 'Recoger la llave con Marcus'), who: 'u3', due: -16, status: 'done' },
      { title: tx('Inside the oven and the fridge', 'Horno y refrigerador por dentro'), who: 'w2', due: -15, status: 'done' },
      { title: tx('After photos to Marcus', 'Fotos de después para Marcus'), who: 'u2', due: -14, status: 'done' },
      { title: tx('Remind Marcus about the invoice', 'Recordarle a Marcus la factura'), who: 'u3', due: -3, status: 'done' },
    ],
    log: [{ date: -14, workerId: 'w2', text: tx('Unit is done. The oven took 2 hours, it was really bad. Left the windows open to air it out.', 'Unidad lista. El horno me llevó 2 horas, estaba muy mal. Dejé las ventanas abiertas para que se ventile.') }],
  });

  k.job({
    id: 'j4', name: tx('Unit 12, Building C', 'Unidad 12, Edificio C'), clientId: 'c3', type: 'full', status: 'progress', price: 5400, start: -8, end: 2, manager: 'u2',
    scope: tx('Full turnover of a 2-bedroom unit: patch and paint, new vinyl plank in the kitchen and bath, new carpet in the bedrooms and hallway, replace the range, new blinds and a full clean.', 'Preparación completa de una unidad de 2 recámaras: resanar y pintar, piso de vinil nuevo en cocina y baño, alfombra nueva en recámaras y pasillo, cambiar la estufa, persianas nuevas y limpieza completa.'),
    payTerms: tx('50% to start, balance at the final walkthrough.', '50% para empezar, saldo en el recorrido final.'),
    assign: [
      { workerId: 'w1', scope: tx('Patch and paint', 'Resanar y pintar'), price: 1150, status: 'done' },
      { workerId: 'w3', scope: tx('Vinyl plank and carpet', 'Piso de vinil y alfombra'), price: 1480, status: 'progress' },
      { workerId: 'w6', scope: tx('Install the range and check the dishwasher', 'Instalar la estufa y revisar el lavaplatos'), price: 260, status: 'pending' },
      { workerId: 'w7', scope: tx('Final clean, 2 days', 'Limpieza final, 2 días'), price: 280, payType: 'daily', rate: 140, qty: 2, status: 'pending' },
    ],
    expenses: [
      { date: -8, vendor: paintStore, desc: tx('Paint, 10 gallons, and stain-blocking primer', 'Pintura, 10 galones, y sellador antimanchas'), amount: 385 },
      { date: -6, vendor: tx('Appliance outlet', 'Tienda de electrodomésticos'), desc: tx('Electric range, 30 in', 'Estufa eléctrica de 30 pulgadas'), amount: 540 },
      { date: -5, vendor: hardware, desc: tx('Blinds, outlet covers and door stops', 'Persianas, tapas de contactos y topes de puerta'), amount: 165 },
    ],
    received: [{ date: -9, method: 'transfer', ref: deposit, amount: 2700 }],
    workerPays: [
      { date: -4, workerId: 'w1', method: 'check', ref: '5131', amount: 1150, payType: 'project' },
      { date: -2, workerId: 'w3', method: 'check', ref: '5134', amount: 700, payType: 'project' },
    ],
    tasks: [
      { title: tx('Patch and paint', 'Resanar y pintar'), who: 'w1', due: -5, status: 'done' },
      { title: tx('Vinyl plank in the kitchen and bath', 'Piso de vinil en cocina y baño'), who: 'w3', due: -3, status: 'done' },
      { title: tx('Carpet in the bedrooms and hallway', 'Alfombra en recámaras y pasillo'), who: 'w3', due: 0, status: 'doing' },
      { title: tx('Range delivery: someone has to be in the unit', 'Entrega de la estufa: alguien tiene que estar en la unidad'), who: 'u3', due: 1, status: 'waiting' },
      { title: tx('Final clean', 'Limpieza final'), who: 'w7', due: 1 },
      { title: tx('Final walkthrough with Tasha', 'Recorrido final con Tasha'), who: 'u2', due: 2, pri: 'high' },
    ],
    log: [
      { date: -5, workerId: 'w1', text: tx('Paint is done. Heavy patching in the hallway where a shelf was pulled out of the wall.', 'Pintura terminada. Mucho resane en el pasillo, donde arrancaron una repisa de la pared.') },
      { date: -3, workerId: 'w3', text: tx('Vinyl plank is down in the kitchen and the bath. The subfloor was fine. Carpet is on order.', 'Ya quedó el piso de vinil en la cocina y el baño. El subpiso estaba bien. La alfombra ya está pedida.') },
    ],
    notes: [[-9, 'visit', tx('Walked the unit with Tasha. The range is original and one burner is dead, she approved a new one. Keys are signed out at the leasing office.', 'Recorrimos la unidad con Tasha. La estufa es la original y un quemador ya no sirve, aprobó una nueva. Las llaves se piden en la oficina de rentas.')]],
  });

  k.job({
    id: 'j5', name: tx('Unit 7, Building A', 'Unidad 7, Edificio A'), clientId: 'c3', type: 'paint', status: 'done', price: 1850, start: -21, end: -18, manager: 'u2',
    scope: tx('Paint a 1-bedroom unit and do a standard move-out clean.', 'Pintar una unidad de 1 recámara y hacer la limpieza normal de salida.'),
    payTerms: tx('50% to start, balance net 15 after the walkthrough.', '50% para empezar, saldo a 15 días después del recorrido.'),
    assign: [
      { workerId: 'w1', scope: tx('Paint, plus stain blocker and a third coat', 'Pintura, más sellador antimanchas y una tercera mano'), price: 1450, status: 'done' },
      { workerId: 'w2', scope: tx('Clean, 2 days', 'Limpieza, 2 días'), price: 300, payType: 'daily', rate: 150, qty: 2, status: 'done' },
    ],
    expenses: [
      { date: -21, vendor: paintStore, desc: tx('Stain-blocking primer, 5 gallons, and extra paint', 'Sellador antimanchas, 5 galones, y pintura extra'), amount: 185 },
      { date: -20, vendor: supply, desc: tx('Degreaser and odor treatment', 'Desengrasante y tratamiento contra olores'), amount: 40 },
    ],
    received: [{ date: -22, method: 'transfer', ref: deposit, amount: 925 }],
    workerPays: [
      { date: -17, workerId: 'w1', method: 'check', ref: '5122', amount: 1450, payType: 'project' },
      { date: -18, workerId: 'w2', method: 'cash', amount: 300, payType: 'daily', from: -19, to: -18 },
    ],
    tasks: [
      { title: tx('Tell Tasha about the smoke damage before painting', 'Avisarle a Tasha del daño por humo antes de pintar'), who: 'u2', due: -21, status: 'done' },
      { title: tx('Stain blocker on all walls and ceilings', 'Sellador antimanchas en todas las paredes y techos'), who: 'w1', due: -20, status: 'done' },
      { title: tx('Second day of cleaning for the kitchen', 'Segundo día de limpieza para la cocina'), who: 'w2', due: -18, status: 'done' },
      { title: tx('Collect the balance of $925', 'Cobrar el saldo de $925'), who: 'u2', due: 3, status: 'waiting' },
    ],
    log: [{ date: -20, workerId: 'w1', text: tx('Nicotine is bleeding through the first coat. Every wall and the ceilings need stain blocker or it comes back yellow.', 'La nicotina se está pasando en la primera mano. Todas las paredes y los techos necesitan sellador antimanchas o vuelve a salir lo amarillo.') }],
    notes: [
      [-22, 'note', tx('Priced from the photos Tasha sent, as a standard paint and clean.', 'Se cotizó con las fotos que mandó Tasha, como pintura y limpieza normales.')],
      [-19, 'note', tx('This unit lost money. The tenant smoked inside for years: the walls needed stain blocker and a third coat, and the cleaning took a second day. We kept the quoted price to keep the account. From now on, smoke units are priced after a visit, not from photos.', 'Esta unidad dejó pérdida. El inquilino fumó adentro por años: las paredes necesitaron sellador y una tercera mano, y la limpieza llevó un segundo día. Respetamos el precio cotizado para cuidar la cuenta. De ahora en adelante, las unidades con humo se cotizan con visita, no con fotos.')],
    ],
  });

  k.job({
    id: 'j6', name: tx('Unit 3, upstairs', 'Unidad 3, planta alta'), clientId: 'c4', type: 'full', status: 'done', price: 3300, start: -45, end: -39,
    scope: tx('Upstairs unit of the duplex: paint, new carpet on the stairs and in 2 bedrooms, repair the kitchen cabinet doors, replace 2 interior doors and clean.', 'Unidad de arriba del dúplex: pintura, alfombra nueva en la escalera y en 2 recámaras, reparar las puertas de los gabinetes de cocina, cambiar 2 puertas interiores y limpiar.'),
    payTerms: tx('50% to start, 50% when the unit is ready.', '50% para empezar, 50% cuando la unidad esté lista.'),
    assign: [
      { workerId: 'w1', scope: tx('Paint the whole unit', 'Pintar toda la unidad'), price: 900, status: 'done' },
      { workerId: 'w3', scope: tx('Carpet, stairs and 2 bedrooms', 'Alfombra, escalera y 2 recámaras'), price: 650, status: 'done' },
      { workerId: 'w4', scope: tx('Doors and cabinet repairs, 2 days', 'Puertas y reparación de gabinetes, 2 días'), price: 400, payType: 'daily', rate: 200, qty: 2, status: 'done' },
      { workerId: 'w2', scope: tx('Final clean', 'Limpieza final'), price: 150, payType: 'daily', rate: 150, qty: 1, status: 'done' },
    ],
    expenses: [
      { date: -45, vendor: paintStore, desc: tx('Paint, 7 gallons', 'Pintura, 7 galones'), amount: 185 },
      { date: -44, vendor: hardware, desc: tx('2 interior doors, hinges and cabinet hardware', '2 puertas interiores, bisagras y herrajes de gabinete'), amount: 240 },
    ],
    received: [{ date: -47, method: 'zelle', ref: deposit, amount: 1650 }, { date: -37, method: 'zelle', ref: balance, amount: 1650 }],
    workerPays: [
      { date: -40, workerId: 'w4', method: 'zelle', amount: 400, payType: 'daily', from: -43, to: -42 },
      { date: -39, workerId: 'w2', method: 'cash', amount: 150, payType: 'daily', from: -39, to: -39 },
      { date: -38, workerId: 'w1', method: 'check', ref: '5108', amount: 900, payType: 'project' },
      { date: -38, workerId: 'w3', method: 'check', ref: '5109', amount: 650, payType: 'project' },
    ],
    tasks: [
      { title: tx('Order 2 interior doors', 'Pedir 2 puertas interiores'), who: 'u3', due: -46, status: 'done' },
      { title: tx('Hang the doors and fix the cabinet doors', 'Colgar las puertas y arreglar las de los gabinetes'), who: 'w4', due: -42, status: 'done' },
      { title: tx('Stair carpet', 'Alfombra de la escalera'), who: 'w3', due: -40, status: 'done' },
      { title: tx('Walkthrough with Mr. Park', 'Recorrido con el Sr. Park'), who: 'u1', due: -38, status: 'done' },
    ],
    log: [{ date: -42, workerId: 'w4', text: tx('Both doors are hung and painted. The cabinet doors got new hinges, 3 of the old ones were stripped.', 'Las dos puertas ya están colgadas y pintadas. A las de los gabinetes les puse bisagras nuevas, 3 de las viejas estaban barridas.') }],
  });

  k.job({
    id: 'j7', name: tx('Vacant units punch list, monthly', 'Lista de pendientes de unidades vacías, mensual'), clientId: 'c3', type: 'repairs', status: 'progress', price: 1800, start: -56, repeat: 'monthly', manager: 'u2',
    scope: tx('One handyman day each month: walk the vacant units with the manager, fix the small items on her list (caulk, doors, outlet covers, smoke detectors) and report anything bigger.', 'Un día de reparaciones al mes: recorrer las unidades vacías con la administradora, arreglar lo chico de su lista (sellado, puertas, tapas de contactos, detectores de humo) y reportar lo que sea más grande.'),
    payTerms: tx('$450 per visit, 4 visits, billed after each one.', '$450 por visita, 4 visitas, se factura después de cada una.'),
    assign: [{ workerId: 'w4', scope: tx('Handyman day, 4 visits', 'Día de reparaciones, 4 visitas'), price: 800, payType: 'daily', rate: 200, qty: 4, status: 'progress' }],
    expenses: [
      { date: -56, vendor: hardware, desc: tx('Caulk, outlet covers and smoke detector batteries', 'Sellador, tapas de contactos y pilas para detectores de humo'), amount: 68 },
      { date: -28, vendor: hardware, desc: tx('Door stops, weatherstrip and cabinet latches', 'Topes de puerta, burlete y pasadores de gabinete'), amount: 74 },
    ],
    received: [
      { date: -52, method: 'check', ref: tx('Visit 1', 'Visita 1'), amount: 450 },
      { date: -24, method: 'check', ref: tx('Visit 2', 'Visita 2'), amount: 450 },
    ],
    workerPays: [
      { date: -55, workerId: 'w4', method: 'zelle', amount: 200, payType: 'daily', from: -56, to: -56 },
      { date: -27, workerId: 'w4', method: 'zelle', amount: 200, payType: 'daily', from: -28, to: -28 },
    ],
    tasks: [
      { title: tx('Visit 2: 6 vacant units', 'Visita 2: 6 unidades vacías'), who: 'w4', due: -28, status: 'done' },
      { title: tx('Visit 3: walk the vacant units with Tasha', 'Visita 3: recorrer las unidades vacías con Tasha'), who: 'w4', due: 0, pri: 'high' },
      { title: tx('Send the punch list report with photos', 'Mandar el reporte de pendientes con fotos'), who: 'u3', due: 1 },
      { title: tx('Price the ceiling repair in Unit 31', 'Cotizar la reparación del techo de la Unidad 31'), who: 'u2', due: 2, status: 'review' },
    ],
    log: [{ date: -28, workerId: 'w4', text: tx('6 vacant units checked. Unit 31 has a water stain on the bathroom ceiling, it looks like it comes from the unit above. Photos sent.', 'Revisé 6 unidades vacías. La 31 tiene una mancha de agua en el techo del baño, parece que viene de la unidad de arriba. Mandé fotos.') }],
    notes: [[-57, 'call', tx('Tasha keeps a list on her clipboard for each vacant unit. Anything over $150 needs her OK before we do it.', 'Tasha lleva una lista en su tabla por cada unidad vacía. Todo lo que pase de $150 necesita su visto bueno antes de hacerlo.')]],
  });

  k.job({
    id: 'j8', name: tx('Unit 5B', 'Unidad 5B'), clientId: 'c5', type: 'clean', status: 'done', price: 720, start: -30, end: -30, manager: 'u2',
    scope: tx('Turnover clean and carpet cleaning between tenants in a 2-bedroom condo. Check and replace light bulbs and smoke detector batteries.', 'Limpieza y lavado de alfombras entre inquilinos en un condominio de 2 recámaras. Revisar y cambiar focos y pilas de los detectores de humo.'),
    payTerms: tx('Paid by card when the unit is ready.', 'Se paga con tarjeta cuando la unidad está lista.'),
    assign: [
      { workerId: 'w7', scope: tx('Turnover clean', 'Limpieza entre inquilinos'), price: 140, payType: 'daily', rate: 140, qty: 1, status: 'done' },
      { workerId: 'w5', scope: tx('Carpet cleaning, 3 rooms and hallway', 'Lavado de alfombras, 3 cuartos y pasillo'), price: 220, status: 'done' },
    ],
    expenses: [{ date: -30, vendor: supply, desc: tx('Light bulbs and batteries', 'Focos y pilas'), amount: 30 }],
    received: [{ date: -29, method: 'card', ref: tx('Paid in full', 'Pagado completo'), amount: 720 }],
    workerPays: [
      { date: -30, workerId: 'w7', method: 'cash', amount: 140, payType: 'daily', from: -30, to: -30 },
      { date: -27, workerId: 'w5', method: 'check', ref: '5116', amount: 220, payType: 'project' },
    ],
    tasks: [
      { title: tx('Get the door code from Joanne', 'Pedirle a Joanne el código de la puerta'), who: 'u3', due: -31, status: 'done' },
      { title: tx('Carpet cleaning, 3 rooms', 'Lavado de alfombras, 3 cuartos'), who: 'w5', due: -30, status: 'done' },
      { title: tx('Photos to Joanne before the new tenant arrives', 'Fotos para Joanne antes de que llegue el inquilino nuevo'), who: 'u3', due: -30, status: 'done' },
    ],
    log: [{ date: -30, workerId: 'w5', text: tx('Carpets are done, 3 rooms and the hallway. The pet stain in the back bedroom came out about 90%.', 'Alfombras listas, 3 cuartos y el pasillo. La mancha de mascota de la recámara de atrás salió como en un 90%.') }],
  });

  k.job({
    id: 'j9', name: tx('Unit 2, second floor', 'Unidad 2, segundo piso'), clientId: 'c6', type: 'repairs', status: 'contract', price: 2150, start: 5, end: 9, leadId: 'l11',
    scope: tx('Repairs from the city inspection list: new smoke and CO detectors, fix 2 window locks, repair the bathroom door frame, re-caulk the tub, patch and paint the living room and hallway.', 'Reparaciones de la lista de la inspección de la ciudad: detectores nuevos de humo y de monóxido, arreglar 2 seguros de ventana, reparar el marco de la puerta del baño, volver a sellar la tina, resanar y pintar la sala y el pasillo.'),
    payTerms: tx('40% to start, balance when the unit passes the reinspection.', '40% para empezar, saldo cuando la unidad pase la reinspección.'),
    assign: [
      { workerId: 'w4', scope: tx('Repairs, 3 days', 'Reparaciones, 3 días'), price: 600, payType: 'daily', rate: 200, qty: 3, status: 'pending' },
      { workerId: 'w1', scope: tx('Patch and paint living room and hallway', 'Resanar y pintar sala y pasillo'), price: 600, status: 'pending' },
    ],
    tasks: [
      { title: tx('Send the work order to Ernesto', 'Mandarle la orden de trabajo a Ernesto'), who: 'u1', due: -1, status: 'done' },
      { title: tx('Signed work order and the 40% to start', 'Orden de trabajo firmada y el 40% para empezar'), who: 'u1', due: 2, status: 'waiting', pri: 'high' },
      { title: tx('Buy the detectors and the window locks', 'Comprar los detectores y los seguros de ventana'), who: 'u3', due: 4 },
      { title: tx('Day 1: detectors, window locks and the door frame', 'Día 1: detectores, seguros de ventana y el marco de la puerta'), who: 'w4', due: 5 },
      { title: tx('Paint the living room and hallway', 'Pintar la sala y el pasillo'), who: 'w1', due: 8 },
      { title: tx('City reinspection: be there with Ernesto', 'Reinspección de la ciudad: estar ahí con Ernesto'), who: 'u1', due: 12, pri: 'high' },
    ],
    notes: [[-2, 'call', tx('Ernesto has the city reinspection in two weeks. The tenant lives in the unit, so work is 9 to 4 only. Prefers Spanish.', 'Ernesto tiene la reinspección de la ciudad en dos semanas. El inquilino vive en la unidad, así que se trabaja solo de 9 a 4. Prefiere español.')]],
  });

  k.job({
    id: 'j10', name: tx('Unit 214', 'Unidad 214'), clientId: 'c7', type: 'full', status: 'hold', price: 4200, start: -12, manager: 'u2', leadId: 'l13',
    scope: tx('Full turnover: patch and paint, new vinyl plank in the bathroom and kitchen, carpet in the bedroom, new blinds and a full clean.', 'Preparación completa: resanar y pintar, piso de vinil nuevo en baño y cocina, alfombra en la recámara, persianas nuevas y limpieza completa.'),
    payTerms: tx('Net 30 after the unit passes inspection.', 'A 30 días después de que la unidad pase la inspección.'),
    assign: [
      { workerId: 'w1', scope: tx('Patch and paint', 'Resanar y pintar'), price: 1100, status: 'done' },
      { workerId: 'w3', scope: tx('Vinyl plank and carpet', 'Piso de vinil y alfombra'), price: 1250, status: 'pending' },
      { workerId: 'w2', scope: tx('Final clean', 'Limpieza final'), price: 150, payType: 'daily', rate: 150, qty: 1, status: 'pending' },
    ],
    expenses: [{ date: -12, vendor: paintStore, desc: tx('Paint, 9 gallons', 'Pintura, 9 galones'), amount: 210 }],
    workerPays: [{ date: -6, workerId: 'w1', method: 'check', ref: '5129', amount: 550, payType: 'project' }],
    tasks: [
      { title: tx('Patch and paint', 'Resanar y pintar'), who: 'w1', due: -8, status: 'done' },
      { title: tx('Send Denise the photos of the soft subfloor', 'Mandarle a Denise las fotos del subpiso blando'), who: 'u2', due: -7, status: 'done' },
      { title: tx('Their plumber fixes the leak under the tub', 'Su plomero arregla la fuga debajo de la tina'), who: 'u2', due: 4, status: 'waiting' },
      { title: tx('Put flooring back on the schedule once the leak is fixed', 'Volver a programar el piso cuando arreglen la fuga'), who: 'u2' },
    ],
    log: [{ date: -7, workerId: 'w3', text: tx('Pulled the old vinyl in the bathroom. The subfloor is wet and soft next to the tub. Stopped work and sent photos.', 'Levanté el vinil viejo del baño. El subpiso está mojado y blando junto a la tina. Paré el trabajo y mandé fotos.') }],
    notes: [
      [-13, 'visit', tx('The unit has to pass the housing inspection before move-in. Denise approves every change in writing.', 'La unidad tiene que pasar la inspección de vivienda antes de la mudanza. Denise aprueba cada cambio por escrito.')],
      [-7, 'call', tx('On hold. When the old vinyl came up in the bathroom the subfloor was soft: there is a leak under the tub. Their plumber has to fix it before we put the floor down. Denise will call when it is done.', 'En pausa. Al levantar el vinil viejo del baño, el subpiso estaba blando: hay una fuga debajo de la tina. Su plomero la tiene que arreglar antes de que pongamos el piso. Denise avisa cuando quede.')],
    ],
  });

  k.job({
    id: 'j11', name: tx('Unit 9A', 'Unidad 9A'), clientId: 'c9', type: 'full', status: 'progress', price: 2600, start: -2, end: 3, manager: 'u2', leadId: 'l12',
    scope: tx('Student unit, 3 bedrooms: paint, rekey the locks, carpet cleaning, full clean and replace 4 blinds.', 'Unidad de estudiantes, 3 recámaras: pintura, cambiar la combinación de las chapas, lavado de alfombras, limpieza completa y cambiar 4 persianas.'),
    payTerms: tx('Net 15. One invoice for 9A and 9B.', 'A 15 días. Una sola factura para la 9A y la 9B.'),
    assign: [
      { workerId: 'w1', scope: tx('Paint 3 bedrooms and hallway', 'Pintar 3 recámaras y pasillo'), price: 850, status: 'progress' },
      { workerId: 'w9', scope: tx('Rekey, 2 locks', 'Cambio de combinación, 2 chapas'), price: 120, status: 'done' },
      { workerId: 'w5', scope: tx('Carpet cleaning, 3 bedrooms', 'Lavado de alfombras, 3 recámaras'), price: 240, status: 'pending' },
      { workerId: 'w7', scope: tx('Final clean, 2 days', 'Limpieza final, 2 días'), price: 280, payType: 'daily', rate: 140, qty: 2, status: 'pending' },
    ],
    expenses: [{ date: -2, vendor: hardware, desc: tx('Blinds and wall anchors', 'Persianas y taquetes'), amount: 130 }],
    workerPays: [{ date: -1, workerId: 'w9', method: 'zelle', amount: 120, payType: 'project' }],
    tasks: [
      { title: tx('Rekey both locks', 'Cambiar la combinación de las dos chapas'), who: 'w9', due: -2, status: 'done' },
      { title: tx('Paint the 3 bedrooms and the hallway', 'Pintar las 3 recámaras y el pasillo'), who: 'w1', due: 1, status: 'doing' },
      { title: tx('Carpet cleaning', 'Lavado de alfombras'), who: 'w5', due: 2 },
      { title: tx('Final clean', 'Limpieza final'), who: 'w7', due: 3 },
      { title: tx('Check the paint in bedroom 3 before the carpet cleaning', 'Revisar la pintura de la recámara 3 antes del lavado de alfombras'), who: 'u2', due: 1, status: 'review' },
      { title: tx('After photos to Rob', 'Fotos de después para Rob'), who: 'u3', due: 3 },
    ],
    log: [{ date: -1, workerId: 'w1', text: tx('Bedrooms 1 and 2 are painted. Bedroom 3 had posters stuck with tape everywhere, lots of small patches.', 'Recámaras 1 y 2 pintadas. La 3 tenía pósters pegados con cinta por todos lados, muchos resanes chiquitos.') }],
    notes: [[-3, 'visit', tx('Rob has new students moving in next week. 9A and 9B are next door to each other and the keys are in the same box at the office.', 'Rob tiene estudiantes nuevos que llegan la próxima semana. La 9A y la 9B están pegadas y las llaves están en la misma caja en la oficina.')]],
  });

  k.job({
    id: 'j12', name: tx('Unit 9B', 'Unidad 9B'), clientId: 'c9', type: 'paint', status: 'progress', price: 1900, start: 0, end: 4, manager: 'u2',
    scope: tx('Student unit, 2 bedrooms: paint, replace 2 interior doors and a standard clean.', 'Unidad de estudiantes, 2 recámaras: pintura, cambiar 2 puertas interiores y limpieza normal.'),
    payTerms: tx('Net 15. One invoice for 9A and 9B.', 'A 15 días. Una sola factura para la 9A y la 9B.'),
    assign: [
      { workerId: 'w1', scope: tx('Paint 2 bedrooms and living room', 'Pintar 2 recámaras y sala'), price: 700, status: 'pending' },
      { workerId: 'w4', scope: tx('Replace 2 interior doors', 'Cambiar 2 puertas interiores'), price: 200, payType: 'daily', rate: 200, qty: 1, status: 'pending' },
      { workerId: 'w2', scope: tx('Clean', 'Limpieza'), price: 150, payType: 'daily', rate: 150, qty: 1, status: 'pending' },
    ],
    expenses: [{ date: -1, vendor: hardware, desc: tx('2 interior doors and hardware', '2 puertas interiores y herrajes'), amount: 190 }],
    tasks: [
      { title: tx('Before photos of every room', 'Fotos de antes de cada cuarto'), who: 'u3', due: 0, status: 'doing' },
      { title: tx('Hang the 2 doors', 'Colgar las 2 puertas'), who: 'w4', due: 1 },
      { title: tx('Paint, right after 9A', 'Pintura, en cuanto acaben la 9A'), who: 'w1', due: 2 },
      { title: tx('Clean', 'Limpieza'), who: 'w2', due: 4 },
    ],
    notes: [[-1, 'text', tx('Rob: one bedroom door has a hole and the other does not close. Replace both, same style as 9A.', 'Rob: una puerta de recámara tiene un hoyo y la otra no cierra. Cambiar las dos, del mismo estilo que la 9A.')]],
  });

  k.job({
    id: 'j13', name: tx('Single-family rental, 3 bedrooms', 'Casa de renta, 3 recámaras'), clientId: 'c8', type: 'full', status: 'done', price: 6400, start: -80, end: -70,
    scope: tx('Single-family rental after a long-term tenant: drywall repairs in 2 rooms, paint the whole house, new carpet upstairs, vinyl plank in the kitchen and a deep clean.', 'Casa de renta después de un inquilino de muchos años: reparar drywall en 2 cuartos, pintar toda la casa, alfombra nueva arriba, piso de vinil en la cocina y limpieza profunda.'),
    payTerms: tx('50% to start, 50% after the walkthrough by video call.', '50% para empezar, 50% después del recorrido por videollamada.'),
    assign: [
      { workerId: 'w8', scope: tx('Drywall repairs, 3 days', 'Reparación de drywall, 3 días'), price: 660, payType: 'daily', rate: 220, qty: 3, status: 'done' },
      { workerId: 'w1', scope: tx('Paint the whole house', 'Pintar toda la casa'), price: 1900, status: 'done' },
      { workerId: 'w3', scope: tx('Carpet upstairs and vinyl plank in the kitchen', 'Alfombra arriba y piso de vinil en la cocina'), price: 1650, status: 'done' },
      { workerId: 'w2', scope: tx('Deep clean, 2 days', 'Limpieza profunda, 2 días'), price: 300, payType: 'daily', rate: 150, qty: 2, status: 'done' },
    ],
    expenses: [
      { date: -80, vendor: tx('Supply house', 'Casa de materiales'), desc: tx('Drywall, joint compound and corner bead', 'Drywall, pasta y esquineros'), amount: 150 },
      { date: -77, vendor: paintStore, desc: tx('Paint, 16 gallons', 'Pintura, 16 galones'), amount: 420 },
    ],
    received: [{ date: -82, method: 'transfer', ref: deposit, amount: 3200 }, { date: -68, method: 'transfer', ref: balance, amount: 3200 }],
    workerPays: [
      { date: -77, workerId: 'w8', method: 'cash', amount: 660, payType: 'daily', from: -80, to: -78 },
      { date: -71, workerId: 'w1', method: 'check', ref: '5088', amount: 1900, payType: 'project' },
      { date: -70, workerId: 'w3', method: 'card', amount: 1650, payType: 'project' },
      { date: -70, workerId: 'w2', method: 'zelle', amount: 300, payType: 'daily', from: -71, to: -70 },
    ],
    tasks: [
      { title: tx('Drywall repairs in 2 rooms', 'Reparar drywall en 2 cuartos'), who: 'w8', due: -78, status: 'done' },
      { title: tx('Paint the whole house', 'Pintar toda la casa'), who: 'w1', due: -73, status: 'done' },
      { title: tx('Walkthrough with Linda by video call', 'Recorrido con Linda por videollamada'), who: 'u1', due: -69, status: 'done' },
      { title: tx('Mail the keys back to the owner', 'Mandarle las llaves a la dueña por correo'), who: 'u3', due: -68, status: 'done' },
    ],
    log: [{ date: -78, workerId: 'w8', text: tx('Both rooms are patched. The hole behind the bedroom door needed a full piece of drywall, not just a patch.', 'Los dos cuartos ya están resanados. El hoyo detrás de la puerta de la recámara necesitó una pieza completa de drywall, no solo un parche.') }],
    notes: [[-83, 'call', tx('Linda lives out of state. She wants a call and photos by text, no emails. Walkthrough by video call.', 'Linda vive en otro estado. Quiere llamada y fotos por texto, sin correos. El recorrido es por videollamada.')]],
  });

  k.job({
    id: 'j14', name: tx('Upstairs unit, two-family house', 'Unidad de arriba, casa de dos familias'), clientId: 'c10', type: 'flooring', status: 'done', price: 2300, start: -100, end: -98,
    scope: tx('Remove the old carpet in the living room and 2 bedrooms and install vinyl plank. New quarter round and paint touch-ups at the baseboards.', 'Quitar la alfombra vieja de la sala y 2 recámaras e instalar piso de vinil. Moldura nueva y retoques de pintura en los zoclos.'),
    payTerms: tx('Half to order the flooring, half when it is done.', 'La mitad para pedir el piso, la otra mitad al terminar.'),
    assign: [{ workerId: 'w3', scope: tx('Remove carpet and install vinyl plank, 3 rooms', 'Quitar alfombra e instalar piso de vinil, 3 cuartos'), price: 1500, status: 'done' }],
    expenses: [{ date: -100, vendor: hardware, desc: tx('Quarter round, transition strips and touch-up paint', 'Moldura, tiras de transición y pintura para retoques'), amount: 90 }],
    received: [{ date: -104, method: 'cash', ref: tx('First half', 'Primera mitad'), amount: 1150 }, { date: -97, method: 'cash', ref: balance, amount: 1150 }],
    workerPays: [{ date: -96, workerId: 'w3', method: 'check', ref: '5061', amount: 1500, payType: 'project' }],
    tasks: [
      { title: tx('Measure the 3 rooms', 'Medir los 3 cuartos'), who: 'u1', due: -105, status: 'done' },
      { title: tx('Order the vinyl plank', 'Pedir el piso de vinil'), who: 'u3', due: -103, status: 'done' },
      { title: tx('Walkthrough with Carlos', 'Recorrido con Carlos'), who: 'u1', due: -97, status: 'done' },
    ],
    log: [{ date: -98, workerId: 'w3', text: tx('All 3 rooms are done. Old carpet and pad went to the dump. One transition strip at the bathroom door.', 'Los 3 cuartos quedaron listos. La alfombra y el bajoalfombra viejos se fueron al tiradero. Una tira de transición en la puerta del baño.') }],
  });

  /* ---------- leads ---------- */
  k.lead({ id: 'l1', name: 'Karen Whitlock', company: 'Sample Seaview Management', phone: '609-555-0151', email: 'karen@example.com', address: '60 Sample Blvd, Ventnor, NJ', type: 'full', source: 'referral', status: 'scheduled', pri: 'high', value: 3500, appt: [1, '11:00'], created: -2,
    notes: [[-2, 'call', tx('Manages 40 units. Wants one vendor for all move-out turnovers. First a walkthrough of Unit 6D. Stephanie at Bayside gave her our name.', 'Administra 40 unidades. Quiere un solo proveedor para todas las preparaciones de salida. Primero un recorrido de la Unidad 6D. Stephanie, de Bayside, le dio nuestro nombre.')]] });
  k.lead({ id: 'l2', name: 'Gloria Méndez', phone: '609-555-0152', email: 'gloria@example.com', address: '14 Sample St, Pleasantville, NJ', type: 'paint', source: 'website', status: 'new', value: 1200, followUp: 0, created: -1,
    notes: [[-1, 'note', tx('Web form: duplex, the tenant left last week. Paint and deep clean both bedrooms. She is the owner.', 'Formulario web: dúplex, el inquilino salió la semana pasada. Pintura y limpieza profunda de las dos recámaras. Ella es la dueña.')]] });
  k.lead({ id: 'l3', name: 'Tom Egan', company: 'Sample Bayfront Condos', phone: '609-555-0153', email: 'tom@example.com', address: '5 Sample Way, Somers Point, NJ', type: 'flooring', source: 'phone', status: 'new', created: 0,
    notes: [[0, 'call', tx('Condo association office. Hallway carpet on 2 floors is worn out, wants a price for carpet tile. Call back after 2 pm.', 'Oficina de la asociación del condominio. La alfombra del pasillo de 2 pisos ya está gastada, quiere precio de alfombra modular. Llamar después de las 2 pm.')]] });
  k.lead({ id: 'l4', name: 'Darius Freeman', phone: '609-555-0154', address: '29 Sample Ave, Egg Harbor City, NJ', type: 'clean', source: 'facebook', status: 'new', followUp: 1, owner: 'u3', created: 0,
    notes: [[0, 'text', tx('Message from the page: rents out a 1-bedroom over his garage. Tenant leaves on the 30th, needs clean and carpet cleaning.', 'Mensaje por la página: renta un apartamento de 1 recámara arriba de su garaje. El inquilino sale el día 30, necesita limpieza y lavado de alfombra.')]] });
  k.lead({ id: 'l5', name: 'Lucía Herrera', company: 'Sample Property Group', phone: '609-555-0155', email: 'lucia@example.com', address: '300 Sample Pike, Egg Harbor Twp, NJ', type: 'full', source: 'google', status: 'sent', owner: 'u2', pri: 'high', value: 6900, appt: [-7, '10:30'], followUp: 2, created: -13,
    notes: [[-13, 'call', tx('About 12 units turn every month across 3 properties. Their current vendor takes 2 weeks per unit. Wants a price sheet per unit size.', 'Se les desocupan unas 12 unidades al mes en 3 propiedades. Su proveedor actual se tarda 2 semanas por unidad. Quiere una lista de precios por tamaño de unidad.')], [-6, 'email', tx('Sent the price sheet and an estimate for the first 3 units: $6,900.', 'Se mandó la lista de precios y un estimado por las primeras 3 unidades: $6,900.')]] });
  k.lead({ id: 'l6', name: 'Nick Papadakis', phone: '609-555-0156', email: 'nick@example.com', address: '81 Sample Rd, Absecon, NJ', type: 'repairs', source: 'phone', status: 'contacted', value: 900, followUp: -3, created: -8,
    notes: [[-8, 'call', tx('Landlord with a punch list from the rental inspection: handrail, 2 smoke detectors, a torn screen and a loose toilet.', 'Dueño con una lista de pendientes de la inspección de renta: pasamanos, 2 detectores de humo, un mosquitero roto y una taza floja.')], [-5, 'call', tx('Gave a rough price by phone. He is waiting for the inspector to send the written list.', 'Le di un precio aproximado por teléfono. Está esperando que el inspector le mande la lista por escrito.')]] });
  k.lead({ id: 'l7', name: 'Brenda Wallace', company: 'Sample Village Apartments', phone: '609-555-0157', email: 'brenda@example.com', address: '400 Sample Blvd, Mays Landing, NJ', type: 'appliance', source: 'website', status: 'contacted', followUp: 1, created: -4,
    notes: [[-4, 'note', tx('Web form: needs someone to swap ranges and fridges in 5 units as they turn. They buy the appliances, we haul the old ones.', 'Formulario web: necesita quien cambie estufas y refrigeradores en 5 unidades conforme se desocupan. Ellos compran los aparatos, nosotros nos llevamos los viejos.')]] });
  k.lead({ id: 'l8', name: 'Mei Tanaka', phone: '609-555-0158', email: 'mei@example.com', address: '7 Sample Ln, Linwood, NJ', type: 'full', source: 'instagram', status: 'scheduled', value: 2800, appt: [0, '16:00'], created: -3,
    notes: [[-3, 'text', tx('Owns a 2-bedroom condo, tenant of 6 years just left. Needs paint, carpet and a new vanity top. Wants it listed by the 15th.', 'Es dueña de un condominio de 2 recámaras, el inquilino de 6 años acaba de salir. Necesita pintura, alfombra y una cubierta nueva para el lavabo. Quiere anunciarlo antes del día 15.')]] });
  k.lead({ id: 'l9', name: 'Jason Whitman', company: 'Sample Corporate Housing', phone: '609-555-0159', email: 'jason@example.com', address: '90 Sample Dr, Northfield, NJ', type: 'clean', source: 'other', status: 'scheduled', owner: 'u2', value: 1500, appt: [4, '10:00'], created: -6,
    notes: [[-6, 'visit', tx('Met him at the landlord association meeting. 9 furnished units, guests change every 30 to 90 days. Wants a flat price per turnover clean.', 'Lo conocí en la junta de la asociación de dueños. 9 unidades amuebladas, los huéspedes cambian cada 30 a 90 días. Quiere precio fijo por limpieza entre huéspedes.')]] });
  k.lead({ id: 'l10', name: 'Abdi Hassan', phone: '609-555-0160', email: 'abdi@example.com', address: '52 Sample St, Atlantic City, NJ', type: 'paint', source: 'referral', status: 'sent', value: 2450, appt: [-5, '09:00'], followUp: 5, created: -10,
    notes: [[-10, 'call', tx('Two units in the same building need paint before new tenants. Ernesto Vargas gave him our number.', 'Dos unidades del mismo edificio necesitan pintura antes de los inquilinos nuevos. Ernesto Vargas le dio nuestro número.')], [-4, 'email', tx('Estimate sent: $2,450 for both units, one color, ceilings included.', 'Estimado enviado: $2,450 por las dos unidades, un solo color, techos incluidos.')]] });
  k.lead({ id: 'l11', name: 'Ernesto Vargas', phone: '609-555-0106', email: 'ernesto@example.com', address: '210 Sample Ave, Atlantic City, NJ', type: 'repairs', source: 'referral', status: 'won', value: 2150, created: -9, clientId: 'c6', jobId: 'j9',
    notes: [[-9, 'call', tx('Triplex owner. Failed the city inspection on the second floor unit, has a list of repairs. Prefers Spanish.', 'Dueño de un tríplex. No pasó la inspección de la ciudad en la unidad del segundo piso, tiene una lista de reparaciones. Prefiere español.')], [-5, 'visit', tx('Went through the inspection list with him. Quoted $2,150 and he said go ahead.', 'Revisamos la lista de la inspección con él. Cotizamos $2,150 y dijo que adelante.')]] });
  k.lead({ id: 'l12', name: 'Rob Castellano', company: 'Sample Student Housing', phone: '609-555-0109', email: 'rob@example.com', address: '33 Sample Dr, Galloway, NJ', type: 'full', source: 'google', status: 'won', owner: 'u2', value: 4500, created: -18, clientId: 'c9', jobId: 'j11',
    notes: [[-18, 'call', tx('Student rentals, 22 units. Two units need to be ready before the next group moves in. More at the end of each semester.', 'Renta a estudiantes, 22 unidades. Dos tienen que estar listas antes de que llegue el siguiente grupo. Habrá más al final de cada semestre.')]] });
  k.lead({ id: 'l13', name: 'Denise Okoye', company: 'Sample Housing Partners', phone: '609-555-0107', email: 'denise@example.com', address: '500 Sample St, Pleasantville, NJ', type: 'full', source: 'website', status: 'won', owner: 'u2', value: 4200, created: -24, clientId: 'c7', jobId: 'j10',
    notes: [[-24, 'note', tx('Web form: nonprofit housing, needs an insured vendor for turnovers. Units are inspected before move-in.', 'Formulario web: vivienda sin fines de lucro, necesita un proveedor asegurado para las preparaciones. Las unidades se inspeccionan antes de la mudanza.')]] });
  k.lead({ id: 'l14', name: 'Vince Romano', company: 'Sample Boardwalk Rentals', phone: '609-555-0161', email: 'vince@example.com', address: '11 Sample Ave, Ventnor, NJ', type: 'full', source: 'facebook', status: 'lost', value: 3900, created: -28,
    notes: [[-28, 'call', tx('Weekly vacation rentals. Wanted paint, flooring and clean done between a Friday checkout and a Sunday check-in.', 'Rentas vacacionales por semana. Quería pintura, piso y limpieza entre una salida de viernes y una entrada de domingo.')]],
    lostReason: tx('He needed everything done in 2 days for a weekend check-in. We could not staff it that fast.', 'Necesitaba todo en 2 días para una entrada de fin de semana. No podíamos juntar a la gente tan rápido.') });
  k.lead({ id: 'l15', name: 'Patricia Nowak', phone: '609-555-0162', email: 'patricia@example.com', address: '36 Sample Ct, Hammonton, NJ', type: 'flooring', source: 'google', status: 'lost', owner: 'u3', value: 1700, created: -36,
    notes: [[-36, 'call', tx('Rental house, wants the carpet replaced with vinyl plank in 2 rooms.', 'Casa de renta, quiere cambiar la alfombra por piso de vinil en 2 cuartos.')]],
    lostReason: tx('She decided to sell the house instead of renting it again.', 'Decidió vender la casa en lugar de volver a rentarla.') });

  /* ---------- office tasks ---------- */
  k.task({ title: tx('Renew the general liability insurance', 'Renovar el seguro de responsabilidad civil'), who: 'u1', due: 14, pri: 'high' });
  k.task({ title: tx('Get a current insurance certificate from Sample Flooring Co.', 'Pedirle a Sample Flooring Co. un certificado de seguro vigente'), who: 'u3', due: -2, status: 'waiting', pri: 'high' });
  k.task({ title: tx('Restock the van: caulk, outlet covers, blinds and smoke detector batteries', 'Surtir la camioneta: sellador, tapas de contactos, persianas y pilas para detectores'), who: 'u3', due: 0 });
  k.task({ title: tx('Order paint for next week: 20 gallons of the standard white', 'Pedir pintura para la próxima semana: 20 galones del blanco de siempre'), who: 'u2', due: 1, status: 'doing' });
  k.task({ title: tx('Monthly statement for Bayside: units done and open balances', 'Estado de cuenta mensual para Bayside: unidades terminadas y saldos abiertos'), who: 'u3', due: -1, status: 'review' });
  k.task({ title: tx('Call Nick Papadakis: did the inspector send the list?', 'Llamar a Nick Papadakis: ¿ya mandó la lista el inspector?'), who: 'u1', due: -3, leadId: 'l6' });
  k.task({ title: tx('Price sheet for Sample Property Group: add 3-bedroom units', 'Lista de precios para Sample Property Group: agregar unidades de 3 recámaras'), who: 'u2', due: 8, leadId: 'l5' });
  k.task({ title: tx('Count the lockboxes and key tags', 'Contar las cajas de llaves y las etiquetas'), who: 'u3', due: 6, pri: 'low' });
  k.task({ title: tx('Price review with the painter and the flooring subcontractor', 'Revisar precios con el pintor y el subcontratista de pisos'), who: 'u1', due: 10 });
  k.task({ title: tx('Update the carpet price per square yard', 'Actualizar el precio de alfombra por yarda cuadrada'), who: 'u2', due: -1, status: 'done' });

  return k.finish();
}
