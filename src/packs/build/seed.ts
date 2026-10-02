import type { Lang, SeedData } from '@/domain/types';
import { seedKit } from '../seedkit';

/** Sample business for this edition. Fictional data only. */
export function seed(lang: Lang): SeedData {
  const k = seedKit(lang, 'VB-');
  const { tx } = k;
  /** Visits and follow-ups with a prospect never land on a Sunday: move those to Monday. */
  const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.getDay() === 0 ? n + 1 : n; };

  /* ---------- subcontractors ---------- */
  k.worker({ id: 'w1', name: 'Carlos Méndez', trade: tx('Framing & carpentry', 'Estructura y carpintería'), phone: '609-555-0121', email: 'carlos@example.com', payType: 'project', w9: 90, coi: 120, insurer: 'Sample Mutual Insurance' });
  // W-9 missing while he is on two active projects
  k.worker({ id: 'w2', name: 'Luis Ortega', trade: tx('Tile & flooring', 'Azulejo y pisos'), phone: '609-555-0122', email: 'luis@example.com', payType: 'daily', rate: 300, coi: 160, insurer: 'Garden Sample Insurance' });
  // insurance certificate already expired
  k.worker({ id: 'w3', name: 'Mike Russo', trade: tx('Electrical', 'Electricidad'), phone: '609-555-0123', email: 'mike@example.com', payType: 'project', w9: 200, coi: -5, insurer: 'Sample Mutual Insurance' });
  k.worker({ id: 'w4', name: 'José Paredes', trade: tx('Plumbing', 'Plomería'), phone: '609-555-0124', email: 'jose@example.com', payType: 'weekly', rate: 900, w9: 60, coi: 210, insurer: 'Shoreline Sample Insurance' });
  // insurance certificate expires within 30 days
  k.worker({ id: 'w5', name: 'Darnell Brooks', trade: tx('Drywall & painting', 'Tablaroca y pintura'), phone: '609-555-0125', email: 'darnell@example.com', payType: 'daily', rate: 280, w9: 110, coi: 18, insurer: 'Garden Sample Insurance' });
  k.worker({ id: 'w6', name: 'Tony Tran', trade: tx('Heating & cooling (HVAC)', 'Calefacción y aire (HVAC)'), phone: '609-555-0126', email: 'tony@example.com', payType: 'project', w9: 150, coi: 95, insurer: 'Sample Mutual Insurance' });
  k.worker({ id: 'w7', name: 'Shore Sample Exteriors LLC', trade: tx('Windows, siding & roofing', 'Ventanas, revestimiento y techos'), phone: '609-555-0127', email: 'shoreexteriors@example.com', payType: 'project', w9: 75, coi: 300, insurer: 'Shoreline Sample Insurance' });
  k.worker({ id: 'w8', name: 'Andrés Castillo', trade: tx('Laborer & helper', 'Ayudante general'), phone: '609-555-0128', email: 'andres@example.com', payType: 'hourly', rate: 24, w9: 45, coi: 240, insurer: 'Garden Sample Insurance' });
  // no longer working with the company
  k.worker({ id: 'w9', name: 'Frank DeLuca', trade: tx('Masonry & concrete', 'Albañilería y concreto'), phone: '609-555-0129', email: 'frank@example.com', payType: 'project', w9: 400, coi: -40, insurer: 'Sample Mutual Insurance', active: false });

  /* ---------- clients ---------- */
  k.client({ id: 'c1', name: 'Laura Smith', phone: '609-555-0101', email: 'laura@example.com', addresses: ['12 Sample Ave, Galloway, NJ'], since: -27,
    note: tx('Works from home on Tuesdays and Thursdays, no loud work before 9 am on those days. She referred Maria Torres to us.', 'Trabaja desde casa martes y jueves, nada de ruido antes de las 9 am esos días. Nos recomendó con Maria Torres.') });
  k.client({ id: 'c2', name: 'Marco Rivera', phone: '609-555-0102', email: 'marco@example.com', addresses: ['48 Sample Rd, Egg Harbor Twp, NJ'], since: -24,
    note: tx('Prefers text messages. Sprinkler lines run along the back fence, mark them before digging footings.', 'Prefiere mensajes de texto. Las líneas de riego corren por la cerca de atrás, marcarlas antes de excavar.') });
  k.client({ id: 'c3', name: 'Anh Nguyen', phone: '609-555-0103', email: 'anh@example.com', addresses: ['7 Sample Ct, Absecon, NJ'], since: -6 });
  k.client({ id: 'c4', name: 'Denise Carter', company: 'Harbor Dental Group', phone: '609-555-0104', email: 'harbordental@example.com', addresses: ['200 Sample Plaza, Somers Point, NJ'], since: -119,
    note: tx('Denise is the office manager and approves everything. Work only after 5 pm or on weekends, patients during the day.', 'Denise es la gerente de la oficina y aprueba todo. Trabajar solo después de las 5 pm o fines de semana, hay pacientes de día.') });
  k.client({ id: 'c5', name: 'Tom & Erin Gallagher', phone: '609-555-0105', email: 'gallagher@example.com', addresses: ['31 Sample Dr, Linwood, NJ'], since: -42 });
  k.client({ id: 'c6', name: 'Rachel Kim', company: 'Coastal Sample Property Management', phone: '609-555-0106', email: 'coastalpm@example.com', addresses: ['85 Sample St, Unit 3B, Ventnor, NJ', '14 Sample Ter, Ventnor, NJ'], since: -70,
    note: tx('Manages about 40 rental units. Invoices go to Rachel, the building owner signs off on anything over $5,000, so final payments take a few weeks.', 'Administra unas 40 unidades de renta. Las facturas van a Rachel; el dueño del edificio aprueba todo lo que pase de $5,000, así que los pagos finales tardan unas semanas.') });
  k.client({ id: 'c7', name: 'Neha Patel', phone: '609-555-0107', email: 'neha@example.com', addresses: ['9 Sample Way, Northfield, NJ'], since: -86 });
  k.client({ id: 'c8', name: 'Gloria Vázquez', phone: '609-555-0108', email: 'gloria@example.com', addresses: ['64 Sample Blvd, Pleasantville, NJ'], since: -112,
    note: tx('Prefers that we speak Spanish. Her son Daniel helps with emails.', 'Prefiere que le hablemos en español. Su hijo Daniel le ayuda con los correos.') });
  k.client({ id: 'c9', name: 'William Hughes', phone: '609-555-0109', email: 'william@example.com', addresses: ['3 Sample Ln, Ocean City, NJ'], since: -30 });
  k.client({ id: 'c10', name: 'Samantha Lee', phone: '609-555-0110', email: 'samantha@example.com', addresses: ['27 Sample Pl, Margate, NJ'], since: -8 });
  k.client({ id: 'c11', name: 'Omar Haddad', company: 'Bayfront Sample Realty', phone: '609-555-0111', email: 'bayfrontrealty@example.com', addresses: ['410 Sample Ave, Unit 2, Ventnor, NJ'], since: -10 });
  // asked not to get automatic emails
  k.client({ id: 'c12', name: 'Robert & Diane Fischer', phone: '609-555-0112', email: 'fischer@example.com', addresses: ['18 Sample Cir, Mays Landing, NJ'], since: -55, emailOptOut: true,
    note: tx('No automatic emails, they asked for phone calls only. Best time is after 6 pm.', 'Nada de correos automáticos, pidieron solo llamadas. Mejor hora: después de las 6 pm.') });

  /* ---------- projects ---------- */
  k.job({ id: 'j1', name: tx('Kitchen remodel', 'Remodelación de cocina'), clientId: 'c1', type: 'kitchen', status: 'progress', price: 48000, start: -20, end: 25, manager: 'u1',
    scope: tx('Remove existing kitchen. Install new cabinets, quartz countertops, tile backsplash and LVP flooring. Relocate sink, add under-cabinet lighting and install appliances supplied by the client.',
      'Quitar la cocina existente. Instalar gabinetes nuevos, encimeras de cuarzo, backsplash de azulejo y piso LVP. Reubicar el fregadero, agregar luces bajo los gabinetes e instalar los electrodomésticos que pone el cliente.'),
    payTerms: tx('$16,000 deposit at signing; $12,000 at cabinet install; $12,000 at countertop install; $8,000 at completion.', '$16,000 de depósito al firmar; $12,000 al instalar gabinetes; $12,000 al instalar encimeras; $8,000 al terminar.'),
    assign: [
      { workerId: 'w1', scope: tx('Cabinet install & trim', 'Instalación de gabinetes y molduras'), price: 6500, status: 'progress' },
      { workerId: 'w2', scope: tx('Backsplash & floor tile', 'Azulejo del backsplash y piso'), price: 4800, payType: 'daily', rate: 300, qty: 16, status: 'pending' },
      { workerId: 'w3', scope: tx('Electrical & lighting', 'Electricidad e iluminación'), price: 3200, status: 'done' },
      { workerId: 'w4', scope: tx('Sink relocation & hookups', 'Reubicación del fregadero y conexiones'), price: 1800, payType: 'weekly', rate: 900, qty: 2, status: 'progress' },
    ],
    expenses: [
      { date: -24, vendor: tx('Township', 'Municipio'), desc: tx('Building and electrical permit', 'Permiso de construcción y eléctrico'), amount: 310 },
      { date: -19, vendor: tx('Dumpster rental', 'Renta de contenedor'), desc: tx('15-yard dumpster, 2 weeks', 'Contenedor de 15 yardas, 2 semanas'), amount: 540 },
      { date: -18, vendor: tx('Cabinet supplier', 'Proveedor de gabinetes'), desc: tx('Cabinets (22 boxes)', 'Gabinetes (22 cajas)'), amount: 12400 },
      { date: -8, vendor: tx('Stone fabricator', 'Marmolería'), desc: tx('Quartz countertops', 'Encimeras de cuarzo'), amount: 6800 },
      { date: -2, vendor: tx('Tile store', 'Tienda de azulejos'), desc: tx('Backsplash & floor tile', 'Azulejo para backsplash y piso'), amount: 1650 },
    ],
    received: [
      { date: -21, method: 'check', ref: tx('Deposit', 'Depósito'), amount: 16000 },
      { date: -9, method: 'transfer', ref: tx('Cabinet install', 'Instalación de gabinetes'), amount: 12000 },
    ],
    workerPays: [
      { date: -10, workerId: 'w1', method: 'check', ref: '1045', amount: 3000 },
      { date: -5, workerId: 'w3', method: 'transfer', amount: 3200 },
      { date: -3, workerId: 'w4', method: 'cash', amount: 900, payType: 'weekly', from: -9, to: -3 },
    ],
    tasks: [
      { title: tx('Demo & haul-away', 'Demolición y retiro de escombro'), who: 'w1', due: -18, status: 'done' },
      { title: tx('Template countertops with the fabricator', 'Tomar plantilla de encimeras con la marmolería'), who: 'u2', due: -11, status: 'done' },
      { title: tx('Final electrical inspection (waiting on the township)', 'Inspección eléctrica final (esperando al municipio)'), who: 'u2', due: -2, status: 'waiting', pri: 'high', description: tx('Inspector cancelled once. Called the office twice, they promised a new date this week.', 'El inspector canceló una vez. Llamé dos veces a la oficina, prometieron nueva fecha esta semana.') },
      { title: tx('Order range hood vent kit', 'Pedir el kit de ventilación de la campana'), who: 'u1', due: 0, pri: 'high' },
      { title: tx('Install crown molding on upper cabinets', 'Instalar moldura de corona en los gabinetes altos'), who: 'w1', due: 1, status: 'doing' },
      { title: tx('Start backsplash tile', 'Empezar el azulejo del backsplash'), who: 'w2', due: 3 },
      { title: tx('Schedule final walkthrough with client', 'Agendar el recorrido final con la clienta'), who: 'u1', due: 20, pri: 'low' },
    ],
    log: [
      { date: -6, workerId: 'w3', text: tx('Rough-in passed. All new circuits labeled in the panel. Under-cabinet lights wired, waiting on the fixtures.', 'Pasó la inspección de la instalación. Circuitos nuevos marcados en el panel. Luces bajo gabinetes cableadas, faltan las lámparas.') },
      { date: -3, workerId: 'w4', text: tx('Sink drain and supply lines moved to the window wall. Pressure tested, no leaks.', 'Drenaje y líneas de agua del fregadero movidos a la pared de la ventana. Prueba de presión hecha, sin fugas.') },
      { date: -1, workerId: 'w1', text: tx('Installed upper cabinets on the sink wall. Crown molding tomorrow.', 'Instalé los gabinetes altos de la pared del fregadero. Mañana la moldura de corona.') },
    ],
    notes: [
      [-22, 'visit', tx('Appliances are supplied by the client and arrive in two weeks. Keep the garage side door clear for delivery. The dog (Milo) stays out of the work area.', 'Los electrodomésticos los pone la clienta y llegan en dos semanas. Dejar libre la puerta lateral del garaje para la entrega. El perro (Milo) no entra al área de trabajo.')],
      [-9, 'call', tx('Laura approved moving the outlet for the microwave drawer. Already inside the electrical price, no change order.', 'Laura aprobó mover el tomacorriente del microondas. Ya está dentro del precio eléctrico, sin orden de cambio.')],
      [-2, 'text', tx('Sent her photos of the uppers. She loves the color and asked if the hood can go 2 inches higher. Checking with Carlos.', 'Le mandé fotos de los gabinetes altos. Le encantó el color y preguntó si la campana puede ir 2 pulgadas más arriba. Lo veo con Carlos.')],
    ] });

  k.job({ id: 'j2', name: tx('Deck & pergola', 'Deck y pérgola'), clientId: 'c2', type: 'deck', status: 'progress', price: 26500, start: -6, end: 14, manager: 'u1', leadId: 'l13',
    scope: tx('Build a 16x20 composite deck with aluminum railing and a 12x14 cedar pergola. Includes footings, township inspections and removal of the old concrete steps.',
      'Construir un deck de material compuesto de 16x20 con barandal de aluminio y una pérgola de cedro de 12x14. Incluye zapatas, inspecciones del municipio y retiro de los escalones viejos de concreto.'),
    payTerms: tx('50% deposit at signing; 50% at completion.', '50% de depósito al firmar; 50% al terminar.'),
    assign: [
      { workerId: 'w1', scope: tx('Deck framing, decking & pergola', 'Estructura, tablas del deck y pérgola'), price: 9400, status: 'progress' },
      { workerId: 'w8', scope: tx('Footings, hauling and cleanup', 'Zapatas, acarreo y limpieza'), price: 1440, payType: 'hourly', rate: 24, qty: 60, status: 'progress' },
    ],
    expenses: [
      { date: -6, vendor: tx('Lumber yard', 'Maderería'), desc: tx('Framing lumber & composite decking', 'Madera para estructura y tablas compuestas'), amount: 6900 },
      { date: -4, vendor: tx('Hardware store', 'Ferretería'), desc: tx('Footings, hardware, fasteners', 'Zapatas, herrajes y tornillería'), amount: 850 },
      { date: -1, vendor: tx('Lumber yard', 'Maderería'), desc: tx('Cedar posts and beams for the pergola', 'Postes y vigas de cedro para la pérgola'), amount: 2100 },
    ],
    received: [{ date: -7, method: 'zelle', ref: tx('Deposit', 'Depósito'), amount: 13250 }],
    workerPays: [
      { date: -2, workerId: 'w1', method: 'zelle', amount: 3600 },
      { date: -1, workerId: 'w8', method: 'cash', amount: 480, payType: 'hourly', from: -6, to: -1 },
    ],
    tasks: [
      { title: tx('Township footing inspection', 'Inspección de zapatas del municipio'), who: 'u1', due: -1, status: 'done' },
      { title: tx('Framing photos for the permit file', 'Fotos de la estructura para el expediente del permiso'), who: 'w1', due: 0, status: 'review' },
      { title: tx('Order pergola stain', 'Pedir el tinte de la pérgola'), who: 'u1', due: 1 },
      { title: tx('Install railing posts', 'Instalar los postes del barandal'), who: 'w1', due: 5 },
    ],
    log: [
      { date: -4, workerId: 'w8', text: tx('Dug and poured 9 footings. Old concrete steps are broken up and in the trailer.', 'Excavé y colé 9 zapatas. Los escalones viejos de concreto ya están rotos y en el tráiler.') },
      { date: -1, workerId: 'w1', text: tx('Frame is up and square. Joists at 12 inches on center for the composite. Starting decking tomorrow.', 'La estructura está armada y a escuadra. Vigas a 12 pulgadas para el compuesto. Mañana empiezo con las tablas.') },
    ],
    notes: [
      [-8, 'visit', tx('Marked the sprinkler lines with Marco. Pergola posts land on the deck, not in the lawn.', 'Marcamos las líneas de riego con Marco. Los postes de la pérgola van sobre el deck, no en el césped.')],
      [-3, 'text', tx('Marco asked about adding two post lights. Told him we can price it as an extra once the railing is in.', 'Marco preguntó por dos luces en los postes. Le dije que lo cotizamos como extra cuando esté el barandal.')],
    ] });

  k.job({ id: 'j3', name: tx('Bathroom remodel', 'Remodelación de baño'), clientId: 'c3', type: 'bathroom', status: 'contract', price: 18900, start: 21, end: 40, manager: 'u1',
    scope: tx('Full primary bath remodel: tub-to-shower conversion with glass door, new vanity, tile floor and walls, new fixtures and exhaust fan.',
      'Remodelación completa del baño principal: cambiar la tina por ducha con puerta de vidrio, mueble de lavabo nuevo, azulejo en piso y paredes, llaves nuevas y extractor.'),
    payTerms: tx('30% deposit at signing; 40% when tile starts; 30% at completion.', '30% de depósito al firmar; 40% al empezar el azulejo; 30% al terminar.'),
    tasks: [
      { title: tx('Follow up on the contract signature', 'Dar seguimiento a la firma del contrato'), who: 'u1', due: 0, status: 'doing', pri: 'high' },
      { title: tx('Order the vanity (6-week lead time)', 'Pedir el mueble de lavabo (6 semanas de entrega)'), who: 'u2', due: 2, status: 'waiting', description: tx('Cannot order until the deposit is in.', 'No se puede pedir hasta que entre el depósito.') },
      { title: tx('Confirm tile selection with client', 'Confirmar la selección de azulejo con el cliente'), who: 'u3', due: 4 },
    ],
    notes: [
      [-5, 'visit', tx('Measured the bathroom. Subfloor feels soft by the tub, wrote an allowance for plywood into the contract.', 'Medí el baño. El subpiso se siente blando junto a la tina, puse una partida para triplay en el contrato.')],
      [-1, 'email', tx('Sent the contract. Anh wants to read it with his wife over the weekend.', 'Mandé el contrato. Anh quiere leerlo con su esposa el fin de semana.')],
    ] });

  k.job({ id: 'j4', name: tx('Office buildout', 'Adecuación de consultorio'), clientId: 'c4', type: 'commercial', status: 'done', price: 64000, start: -112, end: -30, manager: 'u2',
    scope: tx('Build out 2,100 sq ft dental office: 4 operatories, sterilization room, reception and staff room. Framing, drywall, electrical, plumbing for the chairs, HVAC changes, LVT flooring and paint.',
      'Adecuar un consultorio dental de 2,100 pies cuadrados: 4 cubículos, cuarto de esterilización, recepción y cuarto de personal. Estructura, tablaroca, electricidad, plomería para los sillones, cambios de HVAC, piso LVT y pintura.'),
    payTerms: tx('$20,000 deposit; $24,000 after rough inspections; $20,000 at certificate of occupancy.', '$20,000 de depósito; $24,000 al pasar las inspecciones preliminares; $20,000 con el certificado de ocupación.'),
    assign: [
      { workerId: 'w1', scope: tx('Framing & drywall', 'Estructura y tablaroca'), price: 9000, status: 'done' },
      { workerId: 'w3', scope: tx('Electrical', 'Electricidad'), price: 11000, status: 'done' },
      { workerId: 'w4', scope: tx('Plumbing for 4 operatories', 'Plomería para 4 cubículos'), price: 5200, status: 'done' },
      { workerId: 'w6', scope: tx('Ductwork changes and 2 new returns', 'Cambios de ductos y 2 retornos nuevos'), price: 5400, status: 'done' },
    ],
    expenses: [
      { date: -111, vendor: tx('Township', 'Municipio'), desc: tx('Commercial permit', 'Permiso comercial'), amount: 1150 },
      { date: -105, vendor: tx('Supply house', 'Casa de materiales'), desc: tx('Drywall, studs, insulation', 'Tablaroca, postes metálicos y aislamiento'), amount: 7400 },
      { date: -78, vendor: tx('Flooring distributor', 'Distribuidor de pisos'), desc: tx('Commercial LVT', 'Piso LVT comercial'), amount: 6200 },
      { date: -66, vendor: tx('Lighting supplier', 'Proveedor de iluminación'), desc: tx('LED fixtures', 'Lámparas LED'), amount: 4200 },
    ],
    received: [
      { date: -113, method: 'check', ref: tx('Deposit', 'Depósito'), amount: 20000 },
      { date: -70, method: 'check', ref: tx('Progress payment', 'Pago de avance'), amount: 24000 },
      { date: -28, method: 'check', ref: tx('Final payment', 'Pago final'), amount: 20000 },
    ],
    workerPays: [
      { date: -60, workerId: 'w1', method: 'check', ref: '1012', amount: 9000 },
      { date: -50, workerId: 'w6', method: 'check', ref: '1015', amount: 5400 },
      { date: -45, workerId: 'w3', method: 'check', ref: '1013', amount: 11000 },
      { date: -40, workerId: 'w4', method: 'check', ref: '1014', amount: 4000 },
      { date: -35, workerId: 'w4', method: 'card', amount: 1200 },
    ],
    tasks: [
      { title: tx('Collect final lien waivers', 'Reunir las renuncias de gravamen finales'), who: 'u1', due: -27, status: 'done' },
      { title: tx('Send warranty letter and closeout binder', 'Enviar carta de garantía y carpeta de cierre'), who: 'u3', due: -25, status: 'done' },
    ],
    log: [
      { date: -44, workerId: 'w3', text: tx('Final electrical done. All chair circuits tested with the equipment tech on site.', 'Eléctrico final terminado. Probé los circuitos de los sillones con el técnico del equipo presente.') },
    ],
    notes: [
      [-110, 'visit', tx('Night and weekend work only. Building manager needs the certificate of insurance for every subcontractor before they come in.', 'Solo trabajo de noche y fin de semana. El administrador del edificio pide el certificado de seguro de cada subcontratista antes de entrar.')],
      [-29, 'call', tx('Denise confirmed the certificate of occupancy arrived. Final check goes out this week. She wants a price for sterilization room cabinets next.', 'Denise confirmó que llegó el certificado de ocupación. El cheque final sale esta semana. Ahora quiere precio para gabinetes del cuarto de esterilización.')],
    ] });

  k.job({ id: 'j5', name: tx('Basement finishing', 'Acabado de sótano'), clientId: 'c5', type: 'remodel', status: 'progress', price: 38500, start: -30, end: 12, manager: 'u2', leadId: 'l14',
    scope: tx('Finish 900 sq ft basement: frame and insulate exterior walls, drywall, recessed lights, LVP flooring, a half bath and a storage closet. Painted and ready for furniture.',
      'Terminar un sótano de 900 pies cuadrados: estructura y aislamiento en paredes exteriores, tablaroca, luces empotradas, piso LVP, medio baño y un clóset. Pintado y listo para amueblar.'),
    payTerms: tx('30% deposit at signing; 30% after rough inspections; 30% when flooring starts; 10% at completion.', '30% de depósito al firmar; 30% al pasar las inspecciones preliminares; 30% al empezar el piso; 10% al terminar.'),
    assign: [
      { workerId: 'w1', scope: tx('Framing, doors and trim', 'Estructura, puertas y molduras'), price: 5200, status: 'done' },
      { workerId: 'w3', scope: tx('Electrical: 14 recessed lights, outlets, bath fan', 'Electricidad: 14 luces empotradas, tomacorrientes, extractor'), price: 4100, status: 'progress' },
      { workerId: 'w4', scope: tx('Half bath rough and finish plumbing', 'Plomería del medio baño, preliminar y final'), price: 1800, payType: 'weekly', rate: 900, qty: 2, status: 'progress' },
      { workerId: 'w5', scope: tx('Drywall, tape and paint', 'Tablaroca, encintado y pintura'), price: 6160, payType: 'daily', rate: 280, qty: 22, status: 'progress' },
      { workerId: 'w2', scope: tx('LVP flooring', 'Piso LVP'), price: 1500, payType: 'daily', rate: 300, qty: 5, status: 'pending' },
    ],
    expenses: [
      { date: -31, vendor: tx('Township', 'Municipio'), desc: tx('Building permit', 'Permiso de construcción'), amount: 480 },
      { date: -29, vendor: tx('Lumber yard', 'Maderería'), desc: tx('Studs, plates and insulation', 'Postes, soleras y aislamiento'), amount: 4300 },
      { date: -17, vendor: tx('Supply house', 'Casa de materiales'), desc: tx('Drywall, compound and corner bead', 'Tablaroca, pasta y esquineros'), amount: 2150 },
      { date: -5, vendor: tx('Flooring distributor', 'Distribuidor de pisos'), desc: tx('LVP flooring and underlayment', 'Piso LVP y bajopiso'), amount: 3400 },
      { date: -3, vendor: tx('Plumbing supply', 'Proveedor de plomería'), desc: tx('Vanity, toilet and faucet', 'Mueble de lavabo, inodoro y llave'), amount: 1250 },
    ],
    received: [
      { date: -33, method: 'check', ref: tx('Deposit', 'Depósito'), amount: 11550 },
      { date: -14, method: 'transfer', ref: tx('Rough inspections passed', 'Inspecciones preliminares aprobadas'), amount: 11550 },
    ],
    workerPays: [
      { date: -20, workerId: 'w1', method: 'check', ref: '1052', amount: 5200 },
      { date: -16, workerId: 'w4', method: 'zelle', amount: 900, payType: 'weekly', from: -22, to: -16 },
      { date: -12, workerId: 'w5', method: 'zelle', amount: 2800, payType: 'daily', from: -24, to: -12 },
      { date: -9, workerId: 'w3', method: 'check', ref: '1056', amount: 2000 },
      { date: -4, workerId: 'w5', method: 'zelle', amount: 1400, payType: 'daily', from: -11, to: -4 },
    ],
    tasks: [
      { title: tx('Rough electrical and framing inspection', 'Inspección preliminar eléctrica y de estructura'), who: 'u2', due: -15, status: 'done' },
      { title: tx('Clients to pick paint colors', 'Los clientes deben elegir los colores de pintura'), who: 'u2', due: -1, status: 'waiting', description: tx('Erin has the fan deck. Darnell needs the colors before he primes.', 'Erin tiene el muestrario. Darnell necesita los colores antes de aplicar el sellador.') },
      { title: tx('Second coat of compound, main room', 'Segunda mano de pasta, cuarto principal'), who: 'w5', due: 1, status: 'doing' },
      { title: tx('Check the invoice for the third payment before it goes out', 'Revisar la factura del tercer pago antes de enviarla'), who: 'u1', due: 2, status: 'review' },
      { title: tx('Punch list walk with Tom', 'Recorrido de pendientes con Tom'), who: 'u2', due: 10, pri: 'low' },
    ],
    log: [
      { date: -21, workerId: 'w1', text: tx('Framing done, including the soffit around the main duct. Closet moved 6 inches to clear the cleanout.', 'Estructura terminada, incluido el cajón alrededor del ducto principal. Moví el clóset 6 pulgadas para librar el registro.') },
      { date: -10, workerId: 'w3', text: tx('All boxes and cans in. Need the vanity light location confirmed before drywall closes that wall.', 'Todas las cajas y luces puestas. Necesito confirmar dónde va la luz del lavabo antes de cerrar esa pared.') },
      { date: -2, workerId: 'w5', text: tx('Board is hung everywhere. First coat on. Humidity is high down here, running the dehumidifier overnight.', 'Tablaroca colgada en todo. Primera mano puesta. Hay mucha humedad aquí abajo, dejo el deshumidificador prendido toda la noche.') },
    ],
    notes: [
      [-32, 'visit', tx('Use the side entrance and cover the stairs. Sump pump closet has to stay accessible.', 'Usar la entrada lateral y cubrir las escaleras. El clóset de la bomba de sumidero debe quedar accesible.')],
      [-14, 'call', tx('Tom asked for two extra outlets behind the TV wall. Change order for $380 signed by text, not added to the price yet.', 'Tom pidió dos tomacorrientes más detrás de la pared de la TV. Orden de cambio por $380 aprobada por texto, todavía no sumada al precio.')],
    ] });

  k.job({ id: 'j6', name: tx('Flooring replacement, Unit 3B', 'Cambio de piso, Unidad 3B'), clientId: 'c6', type: 'flooring', status: 'progress', price: 7800, start: -3, end: 3, manager: 'u2',
    scope: tx('Remove carpet and vinyl in a 2-bedroom rental. Install LVP throughout (about 850 sq ft) with new baseboard shoe and transitions. Haul away the old flooring.',
      'Quitar alfombra y vinil en una renta de 2 habitaciones. Instalar LVP en todo (unos 850 pies cuadrados) con moldura de zócalo nueva y transiciones. Retirar el piso viejo.'),
    payTerms: tx('50% deposit; 50% when the unit is ready for the new tenant.', '50% de depósito; 50% cuando la unidad esté lista para el nuevo inquilino.'),
    assign: [
      { workerId: 'w2', scope: tx('LVP install', 'Instalación de LVP'), price: 1500, payType: 'daily', rate: 300, qty: 5, status: 'progress' },
      { workerId: 'w8', scope: tx('Tear-out and haul-away', 'Retiro del piso viejo y acarreo'), price: 576, payType: 'hourly', rate: 24, qty: 24, status: 'done' },
    ],
    expenses: [
      { date: -4, vendor: tx('Flooring distributor', 'Distribuidor de pisos'), desc: tx('LVP, 900 sq ft', 'LVP, 900 pies cuadrados'), amount: 2950 },
      { date: -4, vendor: tx('Flooring distributor', 'Distribuidor de pisos'), desc: tx('Underlayment, shoe molding and transitions', 'Bajopiso, moldura de zócalo y transiciones'), amount: 380 },
      { date: -2, vendor: tx('Transfer station', 'Estación de transferencia'), desc: tx('Disposal of old carpet and pad', 'Desecho de alfombra y bajoalfombra'), amount: 220 },
    ],
    received: [{ date: -5, method: 'check', ref: tx('Deposit', 'Depósito'), amount: 3900 }],
    workerPays: [
      { date: -1, workerId: 'w8', method: 'cash', amount: 480, payType: 'hourly', from: -3, to: -2 },
      { date: -1, workerId: 'w2', method: 'zelle', amount: 600, payType: 'daily', from: -2, to: -1 },
    ],
    tasks: [
      { title: tx('Confirm access with the building super for Monday', 'Confirmar el acceso del lunes con el encargado del edificio'), who: 'u3', due: 1 },
      { title: tx('Check transitions at kitchen and bath doors', 'Revisar las transiciones en las puertas de cocina y baño'), who: 'w2', due: 2 },
      { title: tx('Photos of the finished floor for the property manager', 'Fotos del piso terminado para la administradora'), who: 'w2', due: 3 },
    ],
    log: [
      { date: -2, workerId: 'w8', text: tx('Carpet, pad and tack strip are out. Found two soft spots by the slider, screwed them down.', 'Alfombra, bajoalfombra y tiras fuera. Encontré dos partes blandas junto a la puerta corrediza, las atornillé.') },
      { date: -1, workerId: 'w2', text: tx('Both bedrooms and the hall are done. Living room and kitchen next.', 'Las dos habitaciones y el pasillo listos. Sigue la sala y la cocina.') },
    ],
    notes: [
      [-6, 'call', tx('New tenant moves in next weekend, so the unit must be finished by Thursday. Lockbox on the door, code from Rachel.', 'El nuevo inquilino entra el próximo fin de semana, la unidad debe quedar lista el jueves. Hay caja de llaves en la puerta, el código lo da Rachel.')],
    ] });

  k.job({ id: 'j7', name: tx('Window replacement, duplex', 'Cambio de ventanas, dúplex'), clientId: 'c6', address: '14 Sample Ter, Ventnor, NJ', type: 'windows', status: 'done', price: 16400, start: -58, end: -51, manager: 'u2',
    scope: tx('Replace 12 double-hung windows in a two-unit rental with vinyl replacement windows. New exterior trim wrap and interior casing touch-up.',
      'Cambiar 12 ventanas de guillotina en una renta de dos unidades por ventanas de vinil. Forro nuevo de molduras exteriores y retoque de marcos interiores.'),
    payTerms: tx('50% deposit to order the windows; 50% at completion.', '50% de depósito para pedir las ventanas; 50% al terminar.'),
    assign: [
      { workerId: 'w7', scope: tx('Install 12 windows and wrap exterior trim', 'Instalar 12 ventanas y forrar molduras exteriores'), price: 3600, status: 'done' },
      { workerId: 'w5', scope: tx('Interior casing touch-up and paint', 'Retoque de marcos interiores y pintura'), price: 560, payType: 'daily', rate: 280, qty: 2, status: 'done' },
    ],
    expenses: [
      { date: -66, vendor: tx('Window supplier', 'Proveedor de ventanas'), desc: tx('12 vinyl replacement windows', '12 ventanas de vinil de reemplazo'), amount: 7450 },
      { date: -57, vendor: tx('Supply house', 'Casa de materiales'), desc: tx('Coil stock, flashing tape and caulk', 'Lámina para forro, cinta selladora y sellador'), amount: 420 },
      { date: -51, vendor: tx('Transfer station', 'Estación de transferencia'), desc: tx('Disposal of old windows', 'Desecho de ventanas viejas'), amount: 180 },
    ],
    received: [
      { date: -68, method: 'check', ref: tx('Deposit', 'Depósito'), amount: 8200 },
      { date: -44, method: 'check', ref: tx('Partial final payment', 'Pago final parcial'), amount: 5000 },
    ],
    workerPays: [
      { date: -50, workerId: 'w7', method: 'check', ref: '1038', amount: 1800 },
      { date: -49, workerId: 'w5', method: 'zelle', amount: 560, payType: 'daily', from: -52, to: -51 },
    ],
    tasks: [
      { title: tx('Final photos to the property manager', 'Fotos finales para la administradora'), who: 'u3', due: -50, status: 'done' },
      { title: tx('Call Rachel about the $3,200 balance', 'Llamar a Rachel por el saldo de $3,200'), who: 'u1', due: -4, pri: 'high', description: tx('The owner wanted one sash adjusted before releasing the rest. That was done last week.', 'El dueño quería un ajuste en una hoja antes de soltar el resto. Eso se hizo la semana pasada.') },
      { title: tx('Sash adjustment in Unit B, check that it closes right', 'Ajuste de hoja en la Unidad B, revisar que cierre bien'), who: 'w7', due: 1, status: 'review' },
    ],
    log: [
      { date: -52, workerId: 'w7', text: tx('All 12 windows in, foamed and trimmed. One sash in Unit B rear bedroom is tight, will come back to adjust.', 'Las 12 ventanas puestas, con espuma y molduras. Una hoja de la habitación trasera de la Unidad B quedó apretada, regreso a ajustarla.') },
    ],
    notes: [
      [-44, 'email', tx('Rachel sent $5,000. The owner is holding $3,200 until the tight sash in Unit B is fixed.', 'Rachel mandó $5,000. El dueño retiene $3,200 hasta que se arregle la hoja apretada de la Unidad B.')],
      [-6, 'visit', tx('Sash adjusted and tested with the tenant present. Sent photos to Rachel the same day.', 'Hoja ajustada y probada con el inquilino presente. Le mandé fotos a Rachel el mismo día.')],
    ] });

  k.job({ id: 'j8', name: tx('Hardwood refinishing and new LVP', 'Pulido de madera y LVP nuevo'), clientId: 'c7', type: 'flooring', status: 'done', price: 9200, start: -75, end: -69, manager: 'u2',
    scope: tx('Sand and refinish oak floors in living and dining room (480 sq ft), three coats of water-based finish. New LVP in kitchen and mudroom.',
      'Lijar y pulir pisos de roble en sala y comedor (480 pies cuadrados), tres manos de acabado base agua. LVP nuevo en cocina y entrada.'),
    payTerms: tx('50% deposit; 50% at completion.', '50% de depósito; 50% al terminar.'),
    assign: [
      { workerId: 'w2', scope: tx('Sanding, finish and LVP', 'Lijado, acabado y LVP'), price: 2100, payType: 'daily', rate: 300, qty: 7, status: 'done' },
      { workerId: 'w8', scope: tx('Moving furniture, prep and cleanup', 'Mover muebles, preparación y limpieza'), price: 480, payType: 'hourly', rate: 24, qty: 20, status: 'done' },
    ],
    expenses: [
      { date: -76, vendor: tx('Flooring distributor', 'Distribuidor de pisos'), desc: tx('LVP, finish and stain', 'LVP, acabado y tinte'), amount: 3350 },
      { date: -75, vendor: tx('Equipment rental', 'Renta de equipo'), desc: tx('Drum sander and edger, 3 days', 'Lijadora de tambor y orilladora, 3 días'), amount: 410 },
      { date: -74, vendor: tx('Hardware store', 'Ferretería'), desc: tx('Sandpaper, plastic and tape', 'Lijas, plástico y cinta'), amount: 190 },
    ],
    received: [
      { date: -80, method: 'zelle', ref: tx('Deposit', 'Depósito'), amount: 4600 },
      { date: -68, method: 'zelle', ref: tx('Final payment', 'Pago final'), amount: 4600 },
    ],
    workerPays: [
      { date: -70, workerId: 'w8', method: 'cash', amount: 480, payType: 'hourly', from: -75, to: -70 },
      { date: -68, workerId: 'w2', method: 'zelle', amount: 2100, payType: 'daily', from: -75, to: -69 },
    ],
    tasks: [
      { title: tx('Ask Neha for a review', 'Pedirle una reseña a Neha'), who: 'u3', due: -62, status: 'done', pri: 'low' },
    ],
    log: [
      { date: -70, workerId: 'w2', text: tx('Third coat is down. No walking for 24 hours, furniture back after 3 days. Left felt pads with the client.', 'Tercera mano puesta. Sin pisar 24 horas, muebles después de 3 días. Le dejé protectores de fieltro a la clienta.') },
    ],
    notes: [
      [-81, 'visit', tx('Neha picked the natural finish, no stain in the dining room. Family stays with relatives during the sanding.', 'Neha eligió acabado natural, sin tinte en el comedor. La familia se queda con parientes durante el lijado.')],
    ] });

  k.job({ id: 'j9', name: tx('Hall bathroom remodel', 'Remodelación del baño del pasillo'), clientId: 'c8', type: 'bathroom', status: 'done', price: 14800, start: -98, end: -80, manager: 'u1',
    scope: tx('Gut the hall bathroom. New tub with tile surround, tile floor, vanity, toilet, lighting and exhaust fan. Glass sliding door on the tub.',
      'Desmantelar el baño del pasillo. Tina nueva con azulejo en las paredes, piso de azulejo, mueble de lavabo, inodoro, iluminación y extractor. Puerta corrediza de vidrio en la tina.'),
    payTerms: tx('30% deposit at signing; 40% when tile starts; 30% at completion.', '30% de depósito al firmar; 40% al empezar el azulejo; 30% al terminar.'),
    assign: [
      { workerId: 'w2', scope: tx('Tub surround and floor tile', 'Azulejo de la tina y del piso'), price: 2400, payType: 'daily', rate: 300, qty: 8, status: 'done' },
      { workerId: 'w4', scope: tx('Tub, drain, valve and fixtures', 'Tina, drenaje, válvula y llaves'), price: 1650, status: 'done' },
      { workerId: 'w3', scope: tx('Fan, vanity light and GFCI outlet', 'Extractor, luz del lavabo y tomacorriente GFCI'), price: 850, status: 'done' },
      { workerId: 'w5', scope: tx('Drywall patch and paint', 'Reparación de tablaroca y pintura'), price: 560, payType: 'daily', rate: 280, qty: 2, status: 'done' },
    ],
    expenses: [
      { date: -99, vendor: tx('Dumpster rental', 'Renta de contenedor'), desc: tx('10-yard dumpster', 'Contenedor de 10 yardas'), amount: 380 },
      { date: -97, vendor: tx('Plumbing supply', 'Proveedor de plomería'), desc: tx('Tub, valve, vanity and toilet', 'Tina, válvula, mueble de lavabo e inodoro'), amount: 3070 },
      { date: -92, vendor: tx('Tile store', 'Tienda de azulejos'), desc: tx('Wall and floor tile, grout, backer board', 'Azulejo de pared y piso, boquilla y tablero base'), amount: 1900 },
      { date: -84, vendor: tx('Glass shop', 'Vidriería'), desc: tx('Sliding tub door', 'Puerta corrediza para tina'), amount: 1150 },
    ],
    received: [
      { date: -104, method: 'check', ref: tx('Deposit', 'Depósito'), amount: 4440 },
      { date: -91, method: 'check', ref: tx('Tile start', 'Inicio del azulejo'), amount: 5920 },
      { date: -78, method: 'zelle', ref: tx('Final payment', 'Pago final'), amount: 4440 },
    ],
    workerPays: [
      { date: -88, workerId: 'w4', method: 'check', ref: '1021', amount: 1650 },
      { date: -86, workerId: 'w3', method: 'check', ref: '1023', amount: 850 },
      { date: -82, workerId: 'w2', method: 'zelle', amount: 2400, payType: 'daily', from: -92, to: -83 },
      { date: -80, workerId: 'w5', method: 'zelle', amount: 560, payType: 'daily', from: -82, to: -81 },
    ],
    tasks: [
      { title: tx('Close the permit with the township', 'Cerrar el permiso con el municipio'), who: 'u2', due: -76, status: 'done' },
    ],
    notes: [
      [-100, 'visit', tx('Only bathroom with a tub in the house, so we keep the downstairs half bath working at all times.', 'Es el único baño con tina de la casa, así que el medio baño de abajo debe funcionar todo el tiempo.')],
      [-78, 'call', tx('Gloria is very happy. Paid the same day and said her sister in Egg Harbor City wants a kitchen price.', 'Gloria quedó muy contenta. Pagó el mismo día y dijo que su hermana en Egg Harbor City quiere precio para una cocina.')],
    ] });

  k.job({ id: 'j10', name: tx('Sunroom addition', 'Ampliación de solárium'), clientId: 'c9', type: 'addition', status: 'hold', price: 72000, start: -14, end: 60, manager: 'u1',
    scope: tx('Build a 14x18 four-season sunroom on the back of the house: footings and slab, framing, roof tied into the existing roofline, 6 windows and a patio door, electrical and a ductless heat pump.',
      'Construir un solárium de cuatro estaciones de 14x18 en la parte trasera: zapatas y losa, estructura, techo unido al existente, 6 ventanas y una puerta de patio, electricidad y un minisplit.'),
    payTerms: tx('30% deposit; 30% when framing is complete; 30% at drywall; 10% at completion.', '30% de depósito; 30% al terminar la estructura; 30% en tablaroca; 10% al terminar.'),
    assign: [
      { workerId: 'w9', scope: tx('Footings and slab', 'Zapatas y losa'), price: 4800, status: 'done' },
    ],
    expenses: [
      { date: -24, vendor: tx('Engineer', 'Ingeniero'), desc: tx('Stamped drawings', 'Planos sellados'), amount: 1800 },
      { date: -18, vendor: tx('Township', 'Municipio'), desc: tx('Building permit and zoning review', 'Permiso de construcción y revisión de zonificación'), amount: 950 },
      { date: -12, vendor: tx('Concrete supplier', 'Proveedor de concreto'), desc: tx('Concrete, rebar and forms', 'Concreto, varilla y moldes'), amount: 2300 },
    ],
    received: [{ date: -20, method: 'check', ref: tx('Deposit', 'Depósito'), amount: 21600 }],
    workerPays: [{ date: -8, workerId: 'w9', method: 'check', ref: '1058', amount: 4800 }],
    tasks: [
      { title: tx('Resubmit the revised drawings to the township', 'Volver a presentar los planos corregidos al municipio'), who: 'u2', due: 5, status: 'waiting', pri: 'high', description: tx('Engineer promised the revised sheet in a few days.', 'El ingeniero prometió la hoja corregida en unos días.') },
      { title: tx('Call William with an update', 'Llamar a William para ponerlo al día'), who: 'u1', due: 1 },
      { title: tx('Cover the slab and secure the site', 'Cubrir la losa y asegurar el sitio'), who: 'w1', due: -7, status: 'done' },
    ],
    log: [
      { date: -9, workerId: 'w9', text: tx('Slab poured and finished. Anchor bolts set per the drawing. This was my last pour before I retire, good luck with the rest.', 'Losa colada y terminada. Anclas puestas según el plano. Fue mi último colado antes de retirarme, suerte con lo que sigue.') },
    ],
    notes: [
      [-7, 'note', tx('ON HOLD: the zoning officer says the roof overhang is 8 inches inside the rear setback. Engineer is revising the drawing. No framing until the township approves it.', 'EN PAUSA: el oficial de zonificación dice que el alero del techo invade 8 pulgadas el límite trasero. El ingeniero está corrigiendo el plano. No hay estructura hasta que el municipio lo apruebe.')],
      [-5, 'call', tx('William understands and is fine waiting. Asked us to keep the yard tidy in the meantime.', 'William entiende y no tiene problema en esperar. Pidió que dejemos el patio ordenado mientras tanto.')],
    ] });

  k.job({ id: 'j11', name: tx('Windows and patio door', 'Ventanas y puerta de patio'), clientId: 'c10', type: 'windows', status: 'estimate', price: 12600, manager: 'u1',
    scope: tx('Replace 7 windows on the second floor and the sliding patio door in the kitchen. Includes interior trim and disposal.',
      'Cambiar 7 ventanas del segundo piso y la puerta corrediza de la cocina. Incluye molduras interiores y retiro de lo viejo.'),
    payTerms: tx('50% deposit to order; 50% at completion.', '50% de depósito para pedir; 50% al terminar.'),
    notes: [[-4, 'visit', tx('Measured everything. Two windows face the bay, she wants the better glass on those. Estimate has both options.', 'Medí todo. Dos ventanas dan a la bahía y quiere mejor vidrio en esas. El presupuesto lleva las dos opciones.')]] });

  k.job({ id: 'j12', name: tx('Retail unit buildout', 'Adecuación de local comercial'), clientId: 'c11', type: 'commercial', status: 'contract', price: 41500, start: 10, end: 45, manager: 'u2', leadId: 'l15',
    scope: tx('Prepare a 1,400 sq ft retail unit for a new tenant: demo of old partitions, new storefront entry door, accessible restroom, drop ceiling repairs, LED lighting, flooring and paint.',
      'Preparar un local de 1,400 pies cuadrados para un nuevo inquilino: demolición de divisiones viejas, puerta de entrada nueva, baño accesible, reparación del plafón, iluminación LED, piso y pintura.'),
    payTerms: tx('25% deposit; 50% at rough inspections; 25% at completion.', '25% de depósito; 50% en inspecciones preliminares; 25% al terminar.'),
    tasks: [
      { title: tx('Get the certificate of insurance request from the landlord', 'Pedir al arrendador su solicitud de certificado de seguro'), who: 'u3', due: 3 },
      { title: tx('Order the storefront door (3-week lead time)', 'Pedir la puerta de entrada (3 semanas de entrega)'), who: 'u2', due: 6 },
    ],
    notes: [
      [-3, 'email', tx('Contract sent to Omar. The tenant opens in about seven weeks, so he wants to sign fast.', 'Contrato enviado a Omar. El inquilino abre en unas siete semanas, así que quiere firmar rápido.')],
    ] });

  k.job({ id: 'j13', name: tx('Sterilization room cabinets', 'Gabinetes del cuarto de esterilización'), clientId: 'c4', type: 'commercial', status: 'estimate', price: 8900, manager: 'u2',
    scope: tx('Supply and install 14 ft of laminate base and wall cabinets with a solid surface top and sink cutout in the sterilization room.',
      'Suministrar e instalar 14 pies de gabinetes laminados de piso y pared con cubierta de superficie sólida y corte para fregadero en el cuarto de esterilización.'),
    payTerms: tx('50% deposit to order; 50% at completion.', '50% de depósito para pedir; 50% al terminar.'),
    notes: [[-12, 'call', tx('Denise asked for this after the buildout. Wants it done over a long weekend so the office does not close.', 'Denise lo pidió después de la adecuación. Quiere que se haga en un fin de semana largo para no cerrar el consultorio.')]] });

  // the one job that lost money, with the reason written down
  k.job({ id: 'j14', name: tx('Deck repair and new stairs', 'Reparación de deck y escalera nueva'), clientId: 'c12', type: 'deck', status: 'done', price: 4200, start: -47, end: -43, manager: 'u1',
    scope: tx('Replace damaged deck boards (about 60 sq ft), rebuild the stairs with new stringers and add a graspable handrail.',
      'Cambiar tablas dañadas del deck (unos 60 pies cuadrados), rehacer la escalera con zancas nuevas y poner un pasamanos.'),
    payTerms: tx('Fixed price, paid in full at completion.', 'Precio fijo, pago total al terminar.'),
    assign: [
      { workerId: 'w1', scope: tx('Boards, ledger repair and stairs', 'Tablas, reparación de la viga de apoyo y escalera'), price: 2600, status: 'done' },
      { workerId: 'w8', scope: tx('Tear-out and cleanup', 'Retiro y limpieza'), price: 528, payType: 'hourly', rate: 24, qty: 22, status: 'done' },
    ],
    expenses: [
      { date: -47, vendor: tx('Lumber yard', 'Maderería'), desc: tx('Pressure-treated lumber and stringers', 'Madera tratada y zancas'), amount: 980 },
      { date: -45, vendor: tx('Lumber yard', 'Maderería'), desc: tx('Extra joists and ledger board (rot found)', 'Vigas y viga de apoyo extra (se encontró pudrición)'), amount: 310 },
      { date: -45, vendor: tx('Hardware store', 'Ferretería'), desc: tx('Joist hangers, flashing and screws', 'Soportes para vigas, tapajuntas y tornillos'), amount: 240 },
    ],
    received: [{ date: -42, method: 'check', ref: tx('Paid in full', 'Pago total'), amount: 4200 }],
    workerPays: [
      { date: -43, workerId: 'w8', method: 'cash', amount: 528, payType: 'hourly', from: -47, to: -43 },
      { date: -41, workerId: 'w1', method: 'check', ref: '1049', amount: 2600 },
    ],
    tasks: [
      { title: tx('Add a hidden-damage allowance to the deck repair estimate template', 'Agregar una partida por daños ocultos a la plantilla de presupuesto de reparación de decks'), who: 'u1', due: -38, status: 'done' },
    ],
    log: [
      { date: -45, workerId: 'w1', text: tx('Pulled the boards by the house and the ledger is rotted along 8 feet. Three joists too. Replacing all of it, this adds about a day and a half.', 'Quité las tablas junto a la casa y la viga de apoyo está podrida en 8 pies. Tres vigas también. Lo cambio todo, esto suma como día y medio.') },
    ],
    notes: [
      [-45, 'note', tx('We lost money here. The price was fixed and we found a rotted ledger once the boards came up. I did not write a change order and decided to honor the price. From now on every deck repair estimate carries an allowance for hidden damage.', 'Aquí perdimos dinero. El precio era fijo y al levantar las tablas salió podrida la viga de apoyo. No hice orden de cambio y decidí respetar el precio. Desde ahora todo presupuesto de reparación de deck lleva una partida por daños ocultos.')],
      [-42, 'call', tx('Robert thanked us for not charging extra. Phone calls only, no emails.', 'Robert agradeció que no cobráramos de más. Solo llamadas, nada de correos.')],
    ] });

  /* ---------- leads ---------- */
  k.lead({ id: 'l1', name: 'Patricia Gómez', phone: '609-555-0151', email: 'patricia@example.com', address: '22 Sample Ln, Mays Landing, NJ', type: 'pergola', source: 'website', status: 'scheduled', pri: 'high', value: 14000, appt: [day(2), '10:00'], created: -3,
    notes: [[-3, 'note', tx('Wants a cedar pergola over the existing patio. Sent photos with the request.', 'Quiere una pérgola de cedro sobre el patio existente. Mandó fotos con la solicitud.')],
      [-2, 'call', tx('Confirmed the visit. Patio is 14x16 pavers, she wants posts on footings, not on the pavers.', 'Confirmé la visita. El patio es de adoquín de 14x16; quiere los postes sobre zapatas, no sobre el adoquín.')]] });
  k.lead({ id: 'l2', name: 'Robert Klein', phone: '609-555-0152', address: '5 Sample St, Linwood, NJ', type: 'bathroom', source: 'phone', status: 'new', pri: 'high', followUp: 0, created: 0,
    notes: [[0, 'call', tx('Called about a walk-in shower. Call back after 4 pm.', 'Llamó por una ducha a nivel de piso. Devolver la llamada después de las 4 pm.')]] });
  k.lead({ id: 'l3', name: 'Maria Torres', phone: '609-555-0153', email: 'maria@example.com', address: '71 Sample Dr, Hammonton, NJ', type: 'addition', source: 'referral', status: 'sent', pri: 'high', value: 85000, followUp: day(3), created: -12,
    notes: [[-12, 'call', tx('Referred by Laura Smith. Wants a primary bedroom and bath addition over the garage.', 'Recomendada por Laura Smith. Quiere una ampliación de habitación principal con baño sobre el garaje.')],
      [-5, 'visit', tx('Walked the house with Maria and her husband. Garage framing looks good for a second floor, engineer has to confirm.', 'Recorrí la casa con Maria y su esposo. La estructura del garaje se ve bien para un segundo piso, falta que lo confirme el ingeniero.')],
      [-3, 'email', tx('Estimate sent: $85,000 with allowances for tile and fixtures.', 'Presupuesto enviado: $85,000 con partidas para azulejo y accesorios.')]] });
  k.lead({ id: 'l4', name: 'Kevin Walsh', phone: '609-555-0154', email: 'kevin@example.com', address: '36 Sample Way, Egg Harbor City, NJ', type: 'deck', source: 'facebook', status: 'contacted', value: 18000, followUp: day(1), created: -2,
    notes: [[-2, 'note', tx('Composite deck, about 300 sq ft. Asked through Facebook after seeing the Rivera deck photos.', 'Deck de material compuesto, unos 300 pies cuadrados. Escribió por Facebook al ver las fotos del deck de los Rivera.')],
      [-1, 'call', tx('Talked for ten minutes. He is comparing two contractors. Will send me a survey of the yard.', 'Hablamos diez minutos. Está comparando dos contratistas. Me va a mandar el plano del terreno.')]] });
  k.lead({ id: 'l5', name: 'Hannah Becker', company: 'Sunrise Sample Bakery', phone: '609-555-0155', email: 'sunrisebakery@example.com', address: '120 Sample Plaza, Ventnor, NJ', type: 'commercial', source: 'google', status: 'lost', value: 40000, created: -30,
    lostReason: tx('Went with another contractor on price.', 'Se fue con otro contratista por precio.'),
    notes: [[-30, 'call', tx('Wants to expand the kitchen into the unit next door. Needs a hood and grease trap.', 'Quiere ampliar la cocina hacia el local de al lado. Necesita campana y trampa de grasa.')],
      [-24, 'email', tx('We were $6,000 higher. She said the other bid did not include the permit, but still went with them.', 'Quedamos $6,000 arriba. Dijo que la otra oferta no incluía el permiso, pero igual se fue con ellos.')]] });
  k.lead({ id: 'l6', name: 'Angela Russo', phone: '609-555-0156', email: 'angela@example.com', address: '15 Sample Ave, Ventnor, NJ', type: 'kitchen', source: 'website', status: 'new', created: 0,
    notes: [[0, 'note', tx('Website request: wants to open the wall between kitchen and dining room and add an island. House from the 1950s.', 'Solicitud del sitio web: quiere abrir la pared entre cocina y comedor y poner una isla. Casa de los años 50.')]] });
  k.lead({ id: 'l7', name: 'Darius Coleman', phone: '609-555-0157', email: 'darius@example.com', address: '8 Sample Blvd, Atlantic City, NJ', type: 'flooring', source: 'instagram', status: 'new', pri: 'low', created: -1,
    notes: [[-1, 'text', tx('Message on Instagram after the flooring video. About 900 sq ft of LVP on the first floor, has a dog and two kids.', 'Mensaje por Instagram después del video de pisos. Unos 900 pies cuadrados de LVP en el primer piso, tiene un perro y dos niños.')]] });
  k.lead({ id: 'l8', name: 'Linh Pham', phone: '609-555-0158', email: 'linh@example.com', address: '42 Sample Rd, Northfield, NJ', type: 'bathroom', source: 'google', status: 'contacted', value: 16000, followUp: -2, created: -7,
    notes: [[-7, 'call', tx('Primary bath, wants a curbless shower and double vanity. Budget around $16,000.', 'Baño principal, quiere ducha sin escalón y lavabo doble. Presupuesto de unos $16,000.')],
      [-4, 'call', tx('Left a voicemail to set up a visit. No answer yet.', 'Dejé mensaje de voz para agendar visita. Todavía sin respuesta.')]] });
  k.lead({ id: 'l9', name: "Stephen O'Brien", phone: '609-555-0159', email: 'stephen@example.com', address: '60 Sample Pl, Margate, NJ', type: 'windows', source: 'referral', status: 'scheduled', value: 22000, appt: [0, '16:30'], created: -6, owner: 'u2',
    notes: [[-6, 'call', tx('Referred by Rachel Kim at Coastal. 16 original windows, some painted shut. Wants them done before winter.', 'Recomendado por Rachel Kim de Coastal. 16 ventanas originales, algunas pegadas con pintura. Las quiere antes del invierno.')]] });
  k.lead({ id: 'l10', name: 'Yolanda Cruz', phone: '609-555-0160', address: '77 Sample Ct, Egg Harbor Twp, NJ', type: 'deck', source: 'phone', status: 'scheduled', value: 15000, appt: [day(1), '09:00'], created: -4, owner: 'u2',
    notes: [[-4, 'call', tx('Old wood deck is unsafe, wants it replaced the same size. Prefers Spanish. Saturday morning works best.', 'El deck viejo de madera ya no es seguro, lo quiere cambiar del mismo tamaño. Prefiere español. Le queda mejor el sábado en la mañana.')]] });
  k.lead({ id: 'l11', name: 'Greg Novak', phone: '609-555-0161', email: 'greg@example.com', address: '9 Sample Ter, Brigantine, NJ', type: 'remodel', source: 'website', status: 'sent', value: 31000, followUp: day(1), created: -18,
    notes: [[-18, 'note', tx('First floor refresh on a shore house: new flooring, paint, interior doors and trim.', 'Renovación del primer piso de una casa de playa: piso nuevo, pintura, puertas interiores y molduras.')],
      [-13, 'visit', tx('Measured 1,150 sq ft. Wants it finished before the holidays.', 'Medí 1,150 pies cuadrados. Lo quiere terminado antes de las fiestas.')],
      [-9, 'email', tx('Estimate sent for $31,000. He asked for a version without the doors.', 'Presupuesto enviado por $31,000. Pidió una versión sin las puertas.')]] });
  k.lead({ id: 'l12', name: 'Carmen Delgado', phone: '609-555-0162', email: 'carmen@example.com', address: '28 Sample St, Pleasantville, NJ', type: 'bathroom', source: 'facebook', status: 'sent', value: 12400, followUp: 0, created: -9,
    notes: [[-9, 'text', tx('Saw the Vázquez bathroom on Facebook. Wants the same tub and tile.', 'Vio el baño de la señora Vázquez en Facebook. Quiere la misma tina y el mismo azulejo.')],
      [-5, 'email', tx('Estimate sent for $12,400. Follow up today, she was waiting on her tax refund.', 'Presupuesto enviado por $12,400. Darle seguimiento hoy, estaba esperando su reembolso de impuestos.')]] });
  k.lead({ id: 'l13', name: 'Marco Rivera', phone: '609-555-0102', email: 'marco@example.com', address: '48 Sample Rd, Egg Harbor Twp, NJ', type: 'deck', source: 'referral', status: 'won', value: 26500, created: -26, clientId: 'c2', jobId: 'j2',
    notes: [[-26, 'call', tx('Neighbor of a past client. Deck plus pergola, wants composite and low maintenance.', 'Vecino de un cliente anterior. Deck con pérgola, quiere material compuesto y poco mantenimiento.')],
      [-24, 'visit', tx('Signed on the spot after the visit. Deposit by Zelle once the permit is in.', 'Firmó ahí mismo después de la visita. Depósito por Zelle cuando entre el permiso.')]] });
  k.lead({ id: 'l14', name: 'Tom & Erin Gallagher', phone: '609-555-0105', email: 'gallagher@example.com', address: '31 Sample Dr, Linwood, NJ', type: 'remodel', source: 'google', status: 'won', value: 38500, created: -42, clientId: 'c5', jobId: 'j5', owner: 'u2',
    notes: [[-42, 'note', tx('Found us on Google. Unfinished basement, want a family room, half bath and storage.', 'Nos encontraron en Google. Sótano sin terminar, quieren sala familiar, medio baño y bodega.')],
      [-38, 'visit', tx('Dry basement, 7 ft 8 in ceiling. Estimate accepted at $38,500.', 'Sótano seco, techo de 7 pies 8 pulgadas. Presupuesto aceptado en $38,500.')]] });
  k.lead({ id: 'l15', name: 'Omar Haddad', company: 'Bayfront Sample Realty', phone: '609-555-0111', email: 'bayfrontrealty@example.com', address: '410 Sample Ave, Unit 2, Ventnor, NJ', type: 'commercial', source: 'other', status: 'won', value: 41500, created: -10, clientId: 'c11', jobId: 'j12', owner: 'u2',
    notes: [[-10, 'visit', tx('Stopped by the dental office job site and asked for a card. Has a retail unit to get ready for a new tenant.', 'Pasó por la obra del consultorio dental y pidió una tarjeta. Tiene un local que preparar para un nuevo inquilino.')],
      [-6, 'email', tx('Accepted the number. Contract goes out this week.', 'Aceptó el número. El contrato sale esta semana.')]] });
  k.lead({ id: 'l16', name: 'Paul Reinhardt', phone: '609-555-0163', email: 'paul@example.com', address: '54 Sample Ln, Somers Point, NJ', type: 'addition', source: 'other', status: 'lost', value: 120000, created: -36,
    lostReason: tx('Financing fell through. Asked us to check back in the spring.', 'No le aprobaron el financiamiento. Pidió que lo busquemos en la primavera.'),
    notes: [[-36, 'call', tx('Saw our yard sign on Sample Ave. Second-story addition, 600 sq ft.', 'Vio nuestro letrero en Sample Ave. Ampliación de segundo piso, 600 pies cuadrados.')],
      [-28, 'call', tx('The bank did not approve the home equity loan. Good candidate for next year.', 'El banco no aprobó el préstamo sobre la casa. Buen candidato para el año que viene.')]] });

  /* ---------- office tasks ---------- */
  k.task({ title: tx('Call Robert Klein back after 4 pm', 'Devolverle la llamada a Robert Klein después de las 4 pm'), who: 'u1', due: 0, pri: 'high', leadId: 'l2' });
  k.task({ title: tx('Prepare the pergola estimate for Patricia Gómez', 'Preparar el presupuesto de la pérgola de Patricia Gómez'), who: 'u1', due: 3, leadId: 'l1' });
  k.task({ title: tx('Get the W-9 from Luis Ortega', 'Conseguir el W-9 de Luis Ortega'), who: 'u3', due: -3, pri: 'high', description: tx('He is on two active projects. No more payments until it is on file.', 'Está en dos proyectos activos. No más pagos hasta tenerlo en el expediente.') });
  k.task({ title: tx('Ask Mike Russo for his renewed insurance certificate', 'Pedirle a Mike Russo su certificado de seguro renovado'), who: 'u3', due: 2, status: 'waiting', pri: 'high', description: tx('He says his agent is emailing it.', 'Dice que su agente lo manda por correo.') });
  k.task({ title: tx('Call the lumber yard about the railing backorder', 'Llamar a la maderería por el barandal en espera'), who: 'u2', due: 1, status: 'doing' });
  k.task({ title: tx('Renew the general liability policy', 'Renovar la póliza de responsabilidad general'), who: 'u1', due: 12, pri: 'high' });
  k.task({ title: tx('Send last month\'s receipts to the accountant', 'Enviar los recibos del mes pasado al contador'), who: 'u3', due: 4, status: 'review', pri: 'low' });

  return k.finish();
}
