import type { Lang, SeedData } from '@/domain/types';
import { seedKit } from '../seedkit';

/** Sample business for this edition. Fictional data only. */
export function seed(lang: Lang): SeedData {
  const k = seedKit(lang, 'VL-');
  const { tx } = k;
  /** Visits and follow-ups with a prospect never land on a Sunday: move those to Monday. */
  const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.getDay() === 0 ? n + 1 : n; };
  const gas = tx('Gas station', 'Gasolinera');
  const fuel = tx('Gas for mowers and trimmers', 'Gasolina para cortadoras y orilladoras');
  const dump = tx('Dump fees', 'Vertedero');

  /* ---------- crew ---------- */
  k.worker({ id: 'w1', name: 'Pedro Sánchez', trade: tx('Crew lead', 'Líder de cuadrilla'), phone: '609-555-0121', email: 'pedro@example.com', payType: 'weekly', rate: 900, w9: 100, coi: 160, insurer: 'Sample Mutual Insurance' });
  // insurance certificate expires within 30 days
  k.worker({ id: 'w2', name: 'Miguel Torres', trade: tx('Mowing and maintenance', 'Corte y mantenimiento'), phone: '609-555-0122', email: 'miguel@example.com', payType: 'daily', rate: 160, w9: 60, coi: 25, insurer: 'Garden Sample Insurance' });
  // W-9 missing while he is on an active job
  k.worker({ id: 'w3', name: 'Luis Herrera', trade: tx('Hardscape installer', 'Instalador de adoquines y muros'), phone: '609-555-0123', email: 'luis@example.com', payType: 'daily', rate: 180, coi: 140, insurer: 'Garden Sample Insurance' });
  // insurance certificate already expired
  k.worker({ id: 'w4', name: 'Sample Tree Service LLC', trade: tx('Tree work (outside crew)', 'Poda de árboles (cuadrilla externa)'), phone: '609-555-0124', email: 'trees@example.com', payType: 'project', w9: 200, coi: -4, insurer: 'Shoreline Sample Insurance' });
  k.worker({ id: 'w5', name: 'Jamal Carter', trade: tx('Irrigation tech', 'Técnico de riego'), phone: '609-555-0125', email: 'jamal@example.com', payType: 'hourly', rate: 32, w9: 130, coi: 210, insurer: 'Sample Mutual Insurance' });
  k.worker({ id: 'w6', name: 'Óscar Pineda', trade: tx('Mowing crew', 'Cuadrilla de corte'), phone: '609-555-0126', email: 'oscar@example.com', payType: 'daily', rate: 150, w9: 105, coi: 120, insurer: 'Garden Sample Insurance' });
  k.worker({ id: 'w7', name: 'Tyler Brennan', trade: tx('Equipment operator', 'Operador de maquinaria'), phone: '609-555-0127', email: 'tyler@example.com', payType: 'daily', rate: 220, w9: 70, coi: 75, insurer: 'Sample Mutual Insurance' });
  // seasonal helper, went back to school
  k.worker({ id: 'w8', name: 'Ramón Aguilar', trade: tx('Seasonal helper', 'Ayudante de temporada'), phone: '609-555-0128', email: 'ramon@example.com', payType: 'hourly', rate: 18, w9: 115, coi: 40, insurer: 'Garden Sample Insurance', active: false });

  /* ---------- clients ---------- */
  k.client({ id: 'c1', name: 'Greg Martin', phone: '609-555-0101', email: 'martin@example.com', addresses: ['7 Sample Ave, Linwood, NJ'], since: -95,
    note: tx('Gate code 1357. Irrigation heads along the driveway, mow carefully. Dog inside until 9 am.', 'Código del portón 1357. Hay aspersores a lo largo de la entrada, cortar con cuidado. El perro está adentro hasta las 9 am.') });
  k.client({ id: 'c2', name: 'Daniel Rivera', phone: '609-555-0102', email: 'rivera@example.com', addresses: ['33 Sample Rd, Egg Harbor Twp, NJ'], since: -19,
    note: tx('Found us on Instagram. Wants the patio now and the front walkway in the spring if the budget allows.', 'Nos encontró en Instagram. Quiere el patio ahora y el camino de enfrente en primavera si alcanza el presupuesto.') });
  k.client({ id: 'c3', name: 'Susan Feldman', company: 'Harbor Pointe Sample HOA', phone: '609-555-0103', email: 'hoa@example.com', addresses: ['1 Sample Pointe Dr, Somers Point, NJ'], since: -92,
    note: tx('Susan is the property manager. The board meets the second Tuesday of the month and approves anything extra. Send a short report after every visit.', 'Susan es la administradora. La mesa directiva se reúne el segundo martes del mes y aprueba todo lo extra. Mandar un reporte corto después de cada visita.') });
  k.client({ id: 'c4', name: 'Thanh Nguyen', phone: '609-555-0104', email: 'nguyen@example.com', addresses: ['4 Sample Ct, Absecon, NJ'], since: -43 });
  k.client({ id: 'c5', name: "Patricia O'Connor", phone: '609-555-0105', email: 'oconnor@example.com', addresses: ['52 Sample Dr, Northfield, NJ'], since: -87 });
  k.client({ id: 'c6', name: 'Marcus Bell', company: 'Bayside Sample Properties', phone: '609-555-0106', email: 'baysideproperties@example.com', addresses: ['16 Sample St, Pleasantville, NJ', '40 Sample Blvd, Pleasantville, NJ', '9 Sample Ter, Absecon, NJ'], since: -106,
    note: tx('Three rental houses on one route. Tenants are told the day before. Marcus wants a photo of each front yard after every visit.', 'Tres casas de renta en una sola ruta. A los inquilinos se les avisa un día antes. Marcus quiere una foto de cada jardín de enfrente después de cada visita.') });
  k.client({ id: 'c7', name: 'Angela DeMarco', phone: '609-555-0107', email: 'angela@example.com', addresses: ['21 Sample Pl, Margate, NJ'], since: -72 });
  // wants paper invoices by mail, no automatic emails
  k.client({ id: 'c8', name: 'Howard Levin', phone: '609-555-0108', email: 'howard@example.com', addresses: ['66 Sample Ave, Ventnor, NJ'], since: -16, emailOptOut: true,
    note: tx('No automatic emails. He wants a paper invoice in the mail and pays by check.', 'Sin correos automáticos. Quiere la factura en papel por correo postal y paga con cheque.') });
  k.client({ id: 'c9', name: 'Priscilla Adeyemi', phone: '609-555-0109', email: 'priscilla@example.com', addresses: ['11 Sample Way, Galloway, NJ'], since: -22 });
  k.client({ id: 'c10', name: 'Victor Almeida', company: 'Seaview Sample Homes', phone: '609-555-0110', email: 'seaviewhomes@example.com', addresses: ['Lot 14, Sample Farm Rd, Egg Harbor City, NJ'], since: -12,
    note: tx('Home builder. Needs lawns in before each closing date. If this one goes well there are 5 more lots.', 'Constructor de casas. Necesita el césped puesto antes de cada fecha de entrega. Si esta sale bien hay 5 lotes más.') });
  k.client({ id: 'c11', name: 'Hannah Weiss', phone: '609-555-0111', email: 'hannah@example.com', addresses: ['8 Sample Ln, Somers Point, NJ'], since: -7 });
  k.client({ id: 'c12', name: 'Dana Kessler', company: 'Linwood Sample Swim Club', phone: '609-555-0112', email: 'swimclub@example.com', addresses: ['300 Sample Park Rd, Linwood, NJ'], since: -97 });

  /* ---------- jobs ---------- */
  k.job({ id: 'j1', name: tx('Weekly lawn maintenance', 'Mantenimiento semanal de césped'), clientId: 'c1', type: 'lawn', status: 'progress', price: 960, start: -86, repeat: 'weekly', manager: 'u2',
    scope: tx('Mow, edge, trim and blow front and back yard. Weed beds every other visit.', 'Cortar, orillar, recortar y soplar el jardín de enfrente y de atrás. Deshierbar los arriates una visita sí y una no.'),
    payTerms: tx('$60 per visit. Card on file is charged at the start of every 4 visits ($240). Total shown covers the 16 visits booked so far.', '$60 por visita. Se cobra a la tarjeta registrada al inicio de cada 4 visitas ($240). El total cubre las 16 visitas reservadas hasta ahora.'),
    assign: [{ workerId: 'w2', scope: tx('Mowing and edging', 'Corte y orillado'), price: 400, payType: 'daily', rate: 25, qty: 16, status: 'progress' }],
    expenses: [
      { date: -80, vendor: gas, desc: fuel, amount: 18 },
      { date: -45, vendor: gas, desc: fuel, amount: 21 },
      { date: -12, vendor: gas, desc: fuel, amount: 19 },
    ],
    received: [
      { date: -86, method: 'card', ref: tx('Visits 1 to 4', 'Visitas 1 a 4'), amount: 240 },
      { date: -58, method: 'card', ref: tx('Visits 5 to 8', 'Visitas 5 a 8'), amount: 240 },
      { date: -30, method: 'card', ref: tx('Visits 9 to 12', 'Visitas 9 a 12'), amount: 240 },
      { date: -2, method: 'card', ref: tx('Visits 13 to 16', 'Visitas 13 a 16'), amount: 240 },
    ],
    workerPays: [
      { date: -65, workerId: 'w2', method: 'cash', amount: 100, payType: 'daily', from: -86, to: -65 },
      { date: -37, workerId: 'w2', method: 'cash', amount: 100, payType: 'daily', from: -58, to: -37 },
      { date: -9, workerId: 'w2', method: 'cash', amount: 100, payType: 'daily', from: -30, to: -9 },
    ],
    tasks: [
      { title: tx('Edge the driveway and front walk', 'Orillar la entrada y el camino de enfrente'), who: 'w2', due: 5 },
      { title: tx('Weed the beds (every other visit)', 'Deshierbar los arriates (una visita sí y una no)'), who: 'w2', due: 5 },
      { title: tx('Offer fall aeration and overseeding', 'Ofrecer aireación y resiembra de otoño'), who: 'u3', due: 3, pri: 'low' },
    ],
    log: [
      { date: -9, workerId: 'w2', text: tx('Cut at 3.5 inches, the grass is stressed from the dry weeks. Back gate latch is loose.', 'Corté a 3.5 pulgadas, el pasto está resentido por las semanas secas. El pasador del portón de atrás está flojo.') },
      { date: -2, workerId: 'w2', text: tx('Mowed, edged and blew. Weeded the front beds. One sprinkler head by the mailbox is leaning, I did not touch it.', 'Corté, orillé y soplé. Deshierbé los arriates de enfrente. Un aspersor junto al buzón está inclinado, no lo toqué.') },
    ],
    notes: [
      [-86, 'visit', tx('Gate code 1357. Irrigation heads along the driveway, mow carefully. Dog inside until 9 am.', 'Código del portón 1357. Aspersores a lo largo de la entrada, cortar con cuidado. El perro está adentro hasta las 9 am.')],
      [-30, 'text', tx('Greg asked us to bag the clippings in the back yard because of the dog. No extra charge.', 'Greg pidió que embolsemos el pasto cortado del patio de atrás por el perro. Sin cargo extra.')],
    ] });

  k.job({ id: 'j2', name: tx('Paver patio and fire pit', 'Patio de adoquín y fogata'), clientId: 'c2', type: 'hardscape', status: 'progress', price: 14500, start: -5, end: 9, manager: 'u1', leadId: 'l14',
    scope: tx('Excavate and install 380 sq ft paver patio with gravel base, seat wall and round fire pit. Haul away soil.', 'Excavar e instalar un patio de adoquín de 380 pies cuadrados con base de grava, muro de asiento y fogata redonda. Retirar la tierra.'),
    payTerms: tx('40% deposit, 40% when base is done, 20% at completion.', '40% de depósito, 40% al terminar la base, 20% al terminar.'),
    assign: [
      { workerId: 'w1', scope: tx('Crew lead, excavation and base', 'Líder de cuadrilla, excavación y base'), price: 1800, payType: 'weekly', rate: 900, qty: 2, status: 'progress' },
      { workerId: 'w3', scope: tx('Paver and wall installation', 'Instalación de adoquín y muro'), price: 1440, payType: 'daily', rate: 180, qty: 8, status: 'progress' },
      { workerId: 'w7', scope: tx('Mini excavator, dig and haul', 'Mini excavadora, excavación y acarreo'), price: 440, payType: 'daily', rate: 220, qty: 2, status: 'done' },
    ],
    expenses: [
      { date: -6, vendor: tx('Stone yard', 'Proveedor de piedra'), desc: tx('Pavers, wall block and caps', 'Adoquines, block para muro y tapas'), amount: 4800 },
      { date: -5, vendor: tx('Stone yard', 'Proveedor de piedra'), desc: tx('Gravel base and sand', 'Grava para base y arena'), amount: 900 },
      { date: -5, vendor: tx('Equipment rental', 'Renta de equipo'), desc: tx('Mini excavator, 2 days', 'Mini excavadora, 2 días'), amount: 650 },
      { date: -1, vendor: tx('Stone yard', 'Proveedor de piedra'), desc: tx('Polymeric sand and edge restraint', 'Arena polimérica y borde de contención'), amount: 310 },
    ],
    received: [{ date: -8, method: 'check', ref: tx('Deposit', 'Depósito'), amount: 5800 }],
    workerPays: [
      { date: -3, workerId: 'w7', method: 'zelle', amount: 440, payType: 'daily', from: -5, to: -4 },
      { date: -1, workerId: 'w1', method: 'zelle', amount: 900, payType: 'weekly', from: -5, to: -1 },
      { date: -1, workerId: 'w3', method: 'cash', amount: 360, payType: 'daily', from: -2, to: -1 },
    ],
    tasks: [
      { title: tx('Utility mark-out confirmed (811)', 'Marcación de servicios confirmada (811)'), who: 'u1', due: -7, status: 'done', pri: 'high' },
      { title: tx('Order the fire pit kit and wall caps', 'Pedir el kit de la fogata y las tapas del muro'), who: 'u1', due: 0, pri: 'high' },
      { title: tx('Compact base and check slope', 'Compactar la base y revisar la pendiente'), who: 'w1', due: 1, status: 'doing', pri: 'high' },
      { title: tx('Invoice the second payment (40%) when the base is done', 'Facturar el segundo pago (40%) al terminar la base'), who: 'u3', due: 2 },
      { title: tx('Start paver install', 'Empezar a instalar el adoquín'), who: 'w3', due: 3 },
    ],
    log: [
      { date: -4, workerId: 'w7', text: tx('Dug out 9 inches across the patio area. Two loads of soil hauled out. Found an old drain pipe, capped and marked it.', 'Excavé 9 pulgadas en toda el área del patio. Saqué dos cargas de tierra. Salió un tubo viejo de drenaje, lo tapé y lo marqué.') },
      { date: -1, workerId: 'w1', text: tx('Fabric down and first 4 inches of gravel compacted. Slope runs away from the house, quarter inch per foot.', 'Tela puesta y las primeras 4 pulgadas de grava compactadas. La pendiente corre hacia afuera de la casa, un cuarto de pulgada por pie.') },
    ],
    notes: [
      [-9, 'call', tx('Client wants the fire pit centered with the back door. Keep the maple tree roots safe.', 'El cliente quiere la fogata centrada con la puerta de atrás. Cuidar las raíces del arce.')],
      [-2, 'visit', tx('Daniel picked the darker paver blend at the stone yard. Same price.', 'Daniel eligió la mezcla de adoquín más oscura en el proveedor. Mismo precio.')],
    ] });

  k.job({ id: 'j3', name: tx('Common areas maintenance', 'Mantenimiento de áreas comunes'), clientId: 'c3', type: 'lawn', status: 'progress', price: 6300, start: -85, repeat: 'biweekly', manager: 'u2',
    scope: tx('Mow and trim all common areas, entrance beds, trash pickup along the pond. Seasonal flowers at the entrance sign.', 'Cortar y recortar todas las áreas comunes, arriates de la entrada, recoger basura a lo largo del estanque. Flores de temporada en el letrero de la entrada.'),
    payTerms: tx('$900 per visit, invoiced every 2 visits ($1,800), due in 15 days. Total shown is the 7 visits done so far.', '$900 por visita, se factura cada 2 visitas ($1,800), a pagar en 15 días. El total son las 7 visitas hechas hasta ahora.'),
    assign: [
      { workerId: 'w1', scope: tx('Crew lead', 'Líder de cuadrilla'), price: 1400, payType: 'daily', rate: 200, qty: 7, status: 'progress' },
      { workerId: 'w2', scope: tx('Mowing', 'Corte'), price: 1120, payType: 'daily', rate: 160, qty: 7, status: 'progress' },
      { workerId: 'w6', scope: tx('Trimming, beds and trash pickup', 'Recorte, arriates y recoger basura'), price: 1050, payType: 'daily', rate: 150, qty: 7, status: 'progress' },
    ],
    expenses: [
      { date: -84, vendor: tx('Nursery', 'Vivero'), desc: tx('Annual flowers for entrance beds', 'Flores de temporada para la entrada'), amount: 210 },
      { date: -70, vendor: gas, desc: fuel, amount: 64 },
      { date: -56, vendor: tx('Landscape supply', 'Proveedor de jardinería'), desc: tx('Mulch for the entrance beds, 3 yards', 'Mulch para la entrada, 3 yardas'), amount: 140 },
      { date: -42, vendor: gas, desc: fuel, amount: 58 },
      { date: -28, vendor: dump, desc: tx('Brush and clippings', 'Ramas y pasto cortado'), amount: 95 },
      { date: -14, vendor: gas, desc: fuel, amount: 61 },
    ],
    received: [
      { date: -60, method: 'transfer', ref: tx('Invoice 1, visits 1 and 2', 'Factura 1, visitas 1 y 2'), amount: 1800 },
      { date: -32, method: 'transfer', ref: tx('Invoice 2, visits 3 and 4', 'Factura 2, visitas 3 y 4'), amount: 1800 },
      { date: -4, method: 'transfer', ref: tx('Invoice 3, visits 5 and 6', 'Factura 3, visitas 5 y 6'), amount: 1800 },
    ],
    workerPays: [
      { date: -43, workerId: 'w1', method: 'zelle', amount: 800, payType: 'daily', from: -85, to: -43 },
      { date: -43, workerId: 'w2', method: 'zelle', amount: 640, payType: 'daily', from: -85, to: -43 },
      { date: -43, workerId: 'w6', method: 'zelle', amount: 600, payType: 'daily', from: -85, to: -43 },
      { date: -15, workerId: 'w1', method: 'zelle', amount: 400, payType: 'daily', from: -29, to: -15 },
      { date: -15, workerId: 'w2', method: 'zelle', amount: 320, payType: 'daily', from: -29, to: -15 },
      { date: -15, workerId: 'w6', method: 'zelle', amount: 300, payType: 'daily', from: -29, to: -15 },
    ],
    tasks: [
      { title: tx('Price fall aeration and overseeding for the board meeting', 'Cotizar aireación y resiembra de otoño para la junta de la mesa directiva'), who: 'u1', due: -2, pri: 'high' },
      { title: tx('Send Susan the visit report with photos', 'Mandarle a Susan el reporte de la visita con fotos'), who: 'u3', due: 1, status: 'doing' },
      { title: tx('Board approval to replace 4 dead boxwoods at the entrance', 'Aprobación de la mesa directiva para cambiar 4 bojes secos de la entrada'), who: 'u2', due: 11, status: 'waiting' },
      { title: tx('Trash pickup along the pond', 'Recoger basura a lo largo del estanque'), who: 'w6', due: 13 },
    ],
    log: [
      { date: -15, workerId: 'w6', text: tx('Picked up two bags of trash by the pond. Geese are tearing up the grass near the dock.', 'Junté dos bolsas de basura junto al estanque. Los gansos están maltratando el pasto cerca del muelle.') },
      { date: -1, workerId: 'w1', text: tx('Mowed and trimmed everything. Sprinkler head broken by the pool gate, that zone is leaking. Four boxwoods at the entrance are dead.', 'Cortamos y recortamos todo. Hay un aspersor roto junto a la reja de la piscina, esa zona tiene fuga. Cuatro bojes de la entrada están secos.') },
    ],
    notes: [
      [-88, 'visit', tx('Walked the property with Susan. No mowing before 8 am. Park the trailer by the clubhouse, never on the street.', 'Recorrí la propiedad con Susan. No cortar antes de las 8 am. Estacionar el tráiler junto a la casa club, nunca en la calle.')],
      [-4, 'email', tx('Susan asked for a price on aeration and overseeding before the board meeting.', 'Susan pidió precio de aireación y resiembra antes de la junta de la mesa directiva.')],
    ] });

  k.job({ id: 'j4', name: tx('Fall cleanup and tree trimming', 'Limpieza de otoño y poda de árboles'), clientId: 'c4', type: 'cleanup', status: 'done', price: 1350, start: -35, end: -34, manager: 'u2',
    scope: tx('Leaf and bed cleanup front and back, cut back perennials, trim 2 oaks over the roof and haul everything away.', 'Limpieza de hojas y arriates enfrente y atrás, recortar plantas perennes, podar 2 robles sobre el techo y llevarse todo.'),
    payTerms: tx('Paid in full on completion.', 'Pago total al terminar.'),
    assign: [
      { workerId: 'w4', scope: tx('Trim 2 oaks over the roof', 'Podar 2 robles sobre el techo'), price: 600, status: 'done' },
      { workerId: 'w6', scope: tx('Cleanup and hauling', 'Limpieza y acarreo'), price: 150, payType: 'daily', rate: 150, qty: 1, status: 'done' },
    ],
    expenses: [{ date: -34, vendor: dump, desc: tx('Brush and leaves disposal', 'Desecho de ramas y hojas'), amount: 85 }],
    received: [{ date: -33, method: 'check', ref: tx('Paid in full', 'Pago total'), amount: 1350 }],
    workerPays: [
      { date: -34, workerId: 'w6', method: 'cash', amount: 150, payType: 'daily', from: -35, to: -35 },
      { date: -33, workerId: 'w4', method: 'check', ref: '3102', amount: 600 },
    ],
    tasks: [{ title: tx('Ask the Nguyen family for a review', 'Pedirle una reseña a la familia Nguyen'), who: 'u3', due: -30, status: 'done', pri: 'low' }],
    log: [{ date: -35, workerId: 'w6', text: tx('Beds cleaned and perennials cut back. Filled the trailer once. The tree crew comes tomorrow morning.', 'Arriates limpios y perennes recortadas. Llené el tráiler una vez. La cuadrilla de árboles viene mañana temprano.') }],
    notes: [[-38, 'call', tx('Branches are touching the roof and the gutters fill up. Wants it done before the leaves drop.', 'Las ramas tocan el techo y se llenan las canaletas. Lo quiere antes de que caigan las hojas.')]] });

  k.job({ id: 'j5', name: tx('Weekly lawn maintenance', 'Mantenimiento semanal de césped'), clientId: 'c5', type: 'lawn', status: 'progress', price: 660, start: -79, repeat: 'weekly', manager: 'u2',
    scope: tx('Mow, edge and blow front and back. Trim around the pool fence. Hedge along the driveway once a month.', 'Cortar, orillar y soplar enfrente y atrás. Recortar alrededor de la cerca de la piscina. Seto de la entrada una vez al mes.'),
    payTerms: tx('$55 per visit, invoiced every 4 visits ($220). Total shown is the 12 visits done so far.', '$55 por visita, se factura cada 4 visitas ($220). El total son las 12 visitas hechas hasta ahora.'),
    assign: [{ workerId: 'w6', scope: tx('Mowing, edging and hedge', 'Corte, orillado y seto'), price: 264, payType: 'daily', rate: 22, qty: 12, status: 'progress' }],
    expenses: [
      { date: -60, vendor: gas, desc: fuel, amount: 16 },
      { date: -20, vendor: gas, desc: fuel, amount: 17 },
    ],
    received: [
      { date: -50, method: 'zelle', ref: tx('Visits 1 to 4', 'Visitas 1 a 4'), amount: 220 },
      { date: -22, method: 'zelle', ref: tx('Visits 5 to 8', 'Visitas 5 a 8'), amount: 220 },
    ],
    workerPays: [
      { date: -51, workerId: 'w6', method: 'cash', amount: 88, payType: 'daily', from: -79, to: -58 },
      { date: -23, workerId: 'w6', method: 'cash', amount: 88, payType: 'daily', from: -51, to: -30 },
    ],
    tasks: [
      { title: tx('Send the invoice for visits 9 to 12', 'Enviar la factura de las visitas 9 a 12'), who: 'u3', due: -1, status: 'done' },
      { title: tx('Trim the hedge along the driveway', 'Recortar el seto de la entrada'), who: 'w6', due: 5 },
    ],
    log: [{ date: -2, workerId: 'w6', text: tx('Mowed and edged. Pool gate was locked so I trimmed outside the fence only.', 'Corté y orillé. La reja de la piscina estaba con llave, así que recorté solo por fuera de la cerca.') }],
    notes: [[-80, 'call', tx('Pool gate must stay closed. She leaves it unlocked on service days, text her if it is locked.', 'La reja de la piscina debe quedar cerrada. La deja sin llave los días de servicio; mandarle texto si está cerrada.')]] });

  k.job({ id: 'j6', name: tx('Lawn and bed maintenance, 3 rental houses', 'Mantenimiento de césped y arriates, 3 casas de renta'), clientId: 'c6', type: 'lawn', status: 'progress', price: 2280, start: -98, repeat: 'biweekly', manager: 'u2',
    scope: tx('Every 2 weeks at three rental houses: mow, edge, blow, pull weeds in the front beds and pick up litter. One photo of each front yard after the visit.', 'Cada 2 semanas en tres casas de renta: cortar, orillar, soplar, deshierbar los arriates de enfrente y recoger basura. Una foto de cada jardín de enfrente después de la visita.'),
    payTerms: tx('$95 per house per visit ($285), invoiced every 2 visits ($570). Total shown is the 8 visits done so far.', '$95 por casa por visita ($285), se factura cada 2 visitas ($570). El total son las 8 visitas hechas hasta ahora.'),
    assign: [
      { workerId: 'w2', scope: tx('Mowing at the 3 houses', 'Corte en las 3 casas'), price: 640, payType: 'daily', rate: 80, qty: 8, status: 'progress' },
      { workerId: 'w6', scope: tx('Edging, beds and photos', 'Orillado, arriates y fotos'), price: 600, payType: 'daily', rate: 75, qty: 8, status: 'progress' },
    ],
    expenses: [
      { date: -91, vendor: gas, desc: fuel, amount: 26 },
      { date: -63, vendor: gas, desc: fuel, amount: 24 },
      { date: -35, vendor: gas, desc: fuel, amount: 27 },
      { date: -7, vendor: gas, desc: fuel, amount: 25 },
    ],
    received: [
      { date: -68, method: 'check', ref: tx('Invoice 1, visits 1 and 2', 'Factura 1, visitas 1 y 2'), amount: 570 },
      { date: -40, method: 'check', ref: tx('Invoice 2, visits 3 and 4', 'Factura 2, visitas 3 y 4'), amount: 570 },
      { date: -12, method: 'check', ref: tx('Invoice 3, visits 5 and 6', 'Factura 3, visitas 5 y 6'), amount: 570 },
    ],
    workerPays: [
      { date: -56, workerId: 'w2', method: 'cash', amount: 320, payType: 'daily', from: -98, to: -56 },
      { date: -56, workerId: 'w6', method: 'cash', amount: 300, payType: 'daily', from: -98, to: -56 },
      { date: -28, workerId: 'w2', method: 'cash', amount: 160, payType: 'daily', from: -42, to: -28 },
      { date: -28, workerId: 'w6', method: 'cash', amount: 150, payType: 'daily', from: -42, to: -28 },
      { date: -14, workerId: 'w2', method: 'cash', amount: 80, payType: 'daily', from: -14, to: -14 },
      { date: -14, workerId: 'w6', method: 'cash', amount: 75, payType: 'daily', from: -14, to: -14 },
    ],
    tasks: [
      { title: tx('Send invoice 4 to Bayside ($570)', 'Enviar la factura 4 a Bayside ($570)'), who: 'u3', due: 0 },
      { title: tx('Photos of the 3 front yards from the last visit', 'Fotos de los 3 jardines de enfrente de la última visita'), who: 'w6', status: 'review' },
      { title: tx('Tell Marcus about the fallen fence panel at 40 Sample Blvd', 'Avisarle a Marcus del panel de cerca caído en 40 Sample Blvd'), who: 'u2', due: 1 },
    ],
    log: [
      { date: -14, workerId: 'w2', text: tx('All three done. Tenant at 16 Sample St left toys on the lawn again, we moved them to the porch.', 'Las tres listas. El inquilino de 16 Sample St volvió a dejar juguetes en el pasto, los pasamos al porche.') },
      { date: 0, workerId: 'w6', text: tx('Three houses done before noon. A fence panel is down in the back of 40 Sample Blvd, photo sent to the office.', 'Tres casas listas antes del mediodía. Hay un panel de cerca caído atrás de 40 Sample Blvd, mandé foto a la oficina.') },
    ],
    notes: [[-100, 'call', tx('Marcus wants the same day every 2 weeks so tenants know. Bill the company, never the tenants.', 'Marcus quiere el mismo día cada 2 semanas para que los inquilinos sepan. Facturar a la compañía, nunca a los inquilinos.')]] });

  k.job({ id: 'j7', name: tx('Front yard planting and mulch', 'Plantación y mulch del jardín de enfrente'), clientId: 'c7', type: 'design', status: 'done', price: 6800, start: -62, end: -57, manager: 'u1',
    scope: tx('Remove overgrown shrubs, reshape the front beds, plant 14 shrubs, 3 ornamental grasses and a dogwood tree, install steel edging and 8 yards of mulch.', 'Quitar arbustos descuidados, rehacer los arriates de enfrente, plantar 14 arbustos, 3 pastos ornamentales y un cornejo, instalar borde de acero y 8 yardas de mulch.'),
    payTerms: tx('40% deposit, balance at completion. Plants guaranteed for one year with regular watering.', '40% de depósito, el resto al terminar. Plantas garantizadas por un año con riego regular.'),
    assign: [
      { workerId: 'w1', scope: tx('Crew lead, layout and planting', 'Líder de cuadrilla, trazo y plantación'), price: 900, payType: 'weekly', rate: 900, qty: 1, status: 'done' },
      { workerId: 'w2', scope: tx('Shrub removal and planting', 'Retiro de arbustos y plantación'), price: 640, payType: 'daily', rate: 160, qty: 4, status: 'done' },
      { workerId: 'w6', scope: tx('Edging, mulch and cleanup', 'Borde, mulch y limpieza'), price: 600, payType: 'daily', rate: 150, qty: 4, status: 'done' },
    ],
    expenses: [
      { date: -63, vendor: tx('Nursery', 'Vivero'), desc: tx('Shrubs, grasses and dogwood', 'Arbustos, pastos ornamentales y cornejo'), amount: 1950 },
      { date: -62, vendor: tx('Landscape supply', 'Proveedor de jardinería'), desc: tx('Mulch, 8 yards, and planting soil', 'Mulch, 8 yardas, y tierra para plantar'), amount: 480 },
      { date: -62, vendor: tx('Landscape supply', 'Proveedor de jardinería'), desc: tx('Steel edging and landscape fabric', 'Borde de acero y tela para jardín'), amount: 160 },
      { date: -58, vendor: dump, desc: tx('Old shrubs and roots', 'Arbustos viejos y raíces'), amount: 90 },
    ],
    received: [
      { date: -66, method: 'check', ref: tx('Deposit', 'Depósito'), amount: 2720 },
      { date: -55, method: 'zelle', ref: tx('Final payment', 'Pago final'), amount: 4080 },
    ],
    workerPays: [
      { date: -57, workerId: 'w1', method: 'zelle', amount: 900, payType: 'weekly', from: -62, to: -57 },
      { date: -57, workerId: 'w2', method: 'zelle', amount: 640, payType: 'daily', from: -62, to: -58 },
      { date: -57, workerId: 'w6', method: 'zelle', amount: 600, payType: 'daily', from: -62, to: -58 },
    ],
    tasks: [
      { title: tx('Send watering instructions for the new plants', 'Mandar instrucciones de riego para las plantas nuevas'), who: 'u3', due: -56, status: 'done' },
      { title: tx('30-day plant check', 'Revisión de plantas a los 30 días'), who: 'w1', due: -27, status: 'done' },
    ],
    log: [{ date: -57, workerId: 'w1', text: tx('All planted and mulched. Dogwood staked. Showed Angela how deep to water the first month.', 'Todo plantado y con mulch. El cornejo quedó con tutores. Le enseñé a Angela cuánto regar el primer mes.') }],
    notes: [
      [-70, 'visit', tx('Angela wants low maintenance and color in spring. No plants that drop berries on the walkway.', 'Angela quiere poco mantenimiento y color en primavera. Nada que tire bayas en el camino de entrada.')],
      [-27, 'visit', tx('30-day check: everything alive. One grass looked dry, asked her to water twice a week.', 'Revisión de 30 días: todo vivo. Un pasto ornamental se veía seco, le pedí regar dos veces por semana.')],
    ] });

  k.job({ id: 'j8', name: tx('Irrigation repair and winterization', 'Reparación de riego y purgado de invierno'), clientId: 'c8', type: 'irrigation', status: 'done', price: 780, start: -9, end: -9, manager: 'u2',
    scope: tx('Find and fix the zones that do not turn on, replace 6 broken heads and one valve, then blow out the system for winter.', 'Encontrar y arreglar las zonas que no prenden, cambiar 6 aspersores rotos y una válvula, y después purgar el sistema para el invierno.'),
    payTerms: tx('$400 deposit, balance by mail within 10 days.', '$400 de depósito, el resto por correo en 10 días.'),
    assign: [{ workerId: 'w5', scope: tx('Diagnosis, repair and blowout', 'Diagnóstico, reparación y purgado'), price: 256, payType: 'hourly', rate: 32, qty: 8, status: 'done' }],
    expenses: [{ date: -9, vendor: tx('Irrigation supplier', 'Proveedor de riego'), desc: tx('6 heads, 1 valve, fittings and wire connectors', '6 aspersores, 1 válvula, conexiones y conectores de cable'), amount: 145 }],
    received: [{ date: -9, method: 'check', ref: tx('Deposit', 'Depósito'), amount: 400 }],
    workerPays: [{ date: -8, workerId: 'w5', method: 'zelle', amount: 256, payType: 'hourly', from: -9, to: -9 }],
    tasks: [
      { title: tx('Mail the paper invoice to Howard', 'Mandar por correo la factura en papel a Howard'), who: 'u3', due: -8, status: 'done' },
      { title: tx('Call Howard about the $380 balance', 'Llamar a Howard por el saldo de $380'), who: 'u3', due: -3, pri: 'high' },
    ],
    log: [{ date: -9, workerId: 'w5', text: tx('Zones 3 and 4 had a cut wire by the new fence post. Spliced it, replaced 6 heads and the zone 2 valve. System blown out and controller set to off.', 'Las zonas 3 y 4 tenían un cable cortado junto al poste nuevo de la cerca. Lo empalmé, cambié 6 aspersores y la válvula de la zona 2. Sistema purgado y control en apagado.') }],
    notes: [[-6, 'call', tx('Howard says the check went out. He does not use email, call him or send paper.', 'Howard dice que ya mandó el cheque. No usa correo electrónico, llamarle o mandar papel.')]] });

  k.job({ id: 'j9', name: tx('Retaining wall and steps', 'Muro de contención y escalones'), clientId: 'c9', type: 'hardscape', status: 'hold', price: 11200, start: -12, end: 20, manager: 'u1',
    scope: tx('Build a 42 ft retaining wall, 3 ft high, with drainage stone and pipe behind it, and 5 block steps down to the lower yard. Regrade and seed the disturbed area.', 'Construir un muro de contención de 42 pies de largo y 3 de alto, con piedra y tubo de drenaje por detrás, y 5 escalones de block hacia el patio de abajo. Nivelar y sembrar el área removida.'),
    payTerms: tx('40% deposit, 40% when the wall is up, 20% at completion.', '40% de depósito, 40% al levantar el muro, 20% al terminar.'),
    assign: [{ workerId: 'w7', scope: tx('Excavation for the wall footing', 'Excavación para la base del muro'), price: 440, payType: 'daily', rate: 220, qty: 2, status: 'done' }],
    expenses: [
      { date: -14, vendor: tx('Stone yard', 'Proveedor de piedra'), desc: tx('Deposit on wall block and caps', 'Depósito del block para muro y tapas'), amount: 1800 },
      { date: -12, vendor: tx('Equipment rental', 'Renta de equipo'), desc: tx('Mini excavator, 2 days', 'Mini excavadora, 2 días'), amount: 520 },
      { date: -11, vendor: tx('Stone yard', 'Proveedor de piedra'), desc: tx('Drainage stone and base gravel', 'Piedra de drenaje y grava para base'), amount: 610 },
    ],
    received: [{ date: -15, method: 'check', ref: tx('Deposit', 'Depósito'), amount: 4480 }],
    workerPays: [{ date: -10, workerId: 'w7', method: 'zelle', amount: 440, payType: 'daily', from: -12, to: -11 }],
    tasks: [
      { title: tx('Cover the excavation and check the silt fence', 'Cubrir la excavación y revisar la barrera de sedimento'), who: 'w7', due: -9, status: 'done' },
      { title: tx('Get a delivery date for the wall block from the stone yard', 'Conseguir fecha de entrega del block con el proveedor de piedra'), who: 'u2', due: 3, status: 'waiting', pri: 'high', description: tx('Backordered. They said 2 to 3 weeks.', 'En espera de fábrica. Dijeron 2 a 3 semanas.') },
      { title: tx('Assign Luis and Pedro once the block arrives', 'Asignar a Luis y a Pedro cuando llegue el block'), who: 'u1', due: 14, pri: 'low' },
    ],
    log: [{ date: -11, workerId: 'w7', text: tx('Trench is dug and level. Base gravel is on site under a tarp. Ready for block.', 'La zanja está excavada y a nivel. La grava de base está en el sitio bajo una lona. Listo para el block.') }],
    notes: [
      [-8, 'note', tx('ON HOLD: the wall block Priscilla picked is backordered 2 to 3 weeks at the stone yard. Excavation is done and covered. She prefers to wait instead of changing the color.', 'EN PAUSA: el block que eligió Priscilla está en espera de fábrica 2 a 3 semanas. La excavación está hecha y cubierta. Prefiere esperar a cambiar de color.')],
      [-7, 'call', tx('Told Priscilla about the delay. She is fine as long as the yard is safe for her kids, we added orange fence.', 'Le avisé a Priscilla del retraso. No hay problema mientras el patio sea seguro para sus hijos, pusimos malla naranja.')],
    ] });

  k.job({ id: 'j10', name: tx('Final grading and sod, new house', 'Nivelación final y pasto en rollo, casa nueva'), clientId: 'c10', type: 'design', status: 'progress', price: 8600, start: -2, end: 2, manager: 'u2', leadId: 'l13',
    scope: tx('Final grade the front and side yards of a new house, spread 20 yards of topsoil, install 6,500 sq ft of sod and starter fertilizer. Water in the first day.', 'Nivelación final del jardín de enfrente y los costados de una casa nueva, extender 20 yardas de tierra negra, instalar 6,500 pies cuadrados de pasto en rollo y fertilizante de arranque. Regar el primer día.'),
    payTerms: tx('50% deposit, 50% at the builder walkthrough.', '50% de depósito, 50% en el recorrido con el constructor.'),
    assign: [
      { workerId: 'w7', scope: tx('Skid steer grading and topsoil', 'Nivelación con minicargador y tierra negra'), price: 440, payType: 'daily', rate: 220, qty: 2, status: 'done' },
      { workerId: 'w2', scope: tx('Sod install', 'Instalación de pasto en rollo'), price: 480, payType: 'daily', rate: 160, qty: 3, status: 'progress' },
      { workerId: 'w6', scope: tx('Sod install and watering', 'Instalación de pasto en rollo y riego'), price: 450, payType: 'daily', rate: 150, qty: 3, status: 'progress' },
    ],
    expenses: [
      { date: -3, vendor: tx('Landscape supply', 'Proveedor de jardinería'), desc: tx('Screened topsoil, 20 yards delivered', 'Tierra negra cribada, 20 yardas entregadas'), amount: 950 },
      { date: -1, vendor: tx('Sod farm', 'Granja de pasto'), desc: tx('Sod, 6,500 sq ft delivered', 'Pasto en rollo, 6,500 pies cuadrados entregados'), amount: 3400 },
      { date: -1, vendor: tx('Landscape supply', 'Proveedor de jardinería'), desc: tx('Starter fertilizer', 'Fertilizante de arranque'), amount: 120 },
    ],
    received: [{ date: -4, method: 'transfer', ref: tx('Deposit', 'Depósito'), amount: 4300 }],
    workerPays: [{ date: -1, workerId: 'w7', method: 'zelle', amount: 440, payType: 'daily', from: -2, to: -1 }],
    tasks: [
      { title: tx('Photo of the finished grade for the builder', 'Foto de la nivelación terminada para el constructor'), who: 'w7', status: 'review' },
      { title: tx('Lay sod on the front and side yards', 'Poner el pasto en rollo enfrente y en los costados'), who: 'w2', due: 0, status: 'doing', pri: 'high' },
      { title: tx('Set up sprinklers and a timer until closing', 'Poner aspersores y un temporizador hasta la entrega'), who: 'w6', due: 1 },
      { title: tx('Walkthrough with Victor', 'Recorrido con Victor'), who: 'u2', due: 2 },
    ],
    log: [
      { date: -1, workerId: 'w7', text: tx('Graded away from the foundation and spread all the topsoil. Sod truck dropped 14 pallets by the driveway.', 'Nivelé con caída hacia afuera de la cimentación y extendí toda la tierra. El camión dejó 14 tarimas de pasto junto a la entrada.') },
      { date: 0, workerId: 'w2', text: tx('Front yard is down and rolled. Side yards after lunch. We need the water turned on, the outside spigot is dry.', 'El jardín de enfrente ya está puesto y rodillado. Los costados después de comer. Necesitamos que abran el agua, la llave de afuera está seca.') },
    ],
    notes: [[-11, 'call', tx('Victor has the closing in about a week and the township wants the lawn in for the certificate. Sod, not seed.', 'Victor entrega la casa en una semana y el municipio pide el césped puesto para el certificado. Pasto en rollo, no semilla.')]] });

  k.job({ id: 'j11', name: tx('Mulch and shrub refresh', 'Mulch y renovación de arbustos'), clientId: 'c11', type: 'mulch', status: 'contract', price: 1650, start: 6, end: 7, manager: 'u2', leadId: 'l15',
    scope: tx('Edge all beds, pull weeds, replace 6 dead boxwoods along the front walk and spread 9 yards of brown mulch.', 'Orillar todos los arriates, deshierbar, cambiar 6 bojes secos del camino de enfrente y extender 9 yardas de mulch café.'),
    payTerms: tx('Paid in full on completion.', 'Pago total al terminar.'),
    tasks: [
      { title: tx('Get the agreement signed', 'Conseguir la firma del acuerdo'), who: 'u3', due: 0, status: 'doing', pri: 'high' },
      { title: tx('Order 9 yards of brown mulch and 6 boxwoods', 'Pedir 9 yardas de mulch café y 6 bojes'), who: 'u2', due: 3 },
    ],
    notes: [[-3, 'email', tx('Agreement sent. Hannah wants it done before her open house next weekend.', 'Acuerdo enviado. Hannah lo quiere antes de su reunión del próximo fin de semana.')]] });

  k.job({ id: 'j12', name: tx('Front walkway pavers', 'Camino de adoquín de enfrente'), clientId: 'c2', type: 'hardscape', status: 'estimate', price: 5400, manager: 'u1',
    scope: tx('Replace the cracked concrete walk with a 4 ft wide paver walkway, about 110 sq ft, matching the patio pavers.', 'Cambiar el camino de concreto agrietado por uno de adoquín de 4 pies de ancho, unos 110 pies cuadrados, igual al adoquín del patio.'),
    payTerms: tx('40% deposit, balance at completion.', '40% de depósito, el resto al terminar.'),
    notes: [[-2, 'visit', tx('Daniel asked for this while we were on the patio. He will decide after he sees the patio finished.', 'Daniel lo pidió mientras hacíamos el patio. Decide cuando vea el patio terminado.')]] });

  k.job({ id: 'j13', name: tx('Snow removal, winter season', 'Remoción de nieve, temporada de invierno'), clientId: 'c3', type: 'snow', status: 'estimate', price: 7200, manager: 'u1',
    scope: tx('Plow the entrance road and clubhouse lot, shovel and salt clubhouse walks after every snowfall of 2 inches or more, December through March.', 'Limpiar con pala mecánica el camino de entrada y el estacionamiento de la casa club, palear y poner sal en las aceras después de cada nevada de 2 pulgadas o más, de diciembre a marzo.'),
    payTerms: tx('Season price in 4 monthly payments of $1,800. Salt billed per bag used.', 'Precio de temporada en 4 pagos mensuales de $1,800. La sal se cobra por bolsa usada.'),
    notes: [[-10, 'email', tx('Susan asked for a season price to show the board. Sent the estimate with the per-storm option too.', 'Susan pidió precio de temporada para la mesa directiva. Mandé el presupuesto con la opción por nevada también.')]] });

  k.job({ id: 'j14', name: tx('Tree and hedge trimming', 'Poda de árboles y setos'), clientId: 'c12', type: 'trees', status: 'done', price: 2600, start: -90, end: -89, manager: 'u2',
    scope: tx('Raise the canopy on 5 trees around the pool deck, remove dead limbs, trim 120 ft of privacy hedge and chip everything.', 'Levantar la copa de 5 árboles alrededor de la piscina, quitar ramas secas, recortar 120 pies de seto de privacidad y triturar todo.'),
    payTerms: tx('Paid by check within 10 days.', 'Pago con cheque en 10 días.'),
    assign: [
      { workerId: 'w4', scope: tx('Canopy raise and dead limbs, 5 trees', 'Levantar copas y quitar ramas secas, 5 árboles'), price: 1100, status: 'done' },
      { workerId: 'w6', scope: tx('Hedge trimming', 'Recorte de setos'), price: 300, payType: 'daily', rate: 150, qty: 2, status: 'done' },
      { workerId: 'w8', scope: tx('Dragging brush and cleanup', 'Arrastrar ramas y limpieza'), price: 252, payType: 'hourly', rate: 18, qty: 14, status: 'done' },
    ],
    expenses: [
      { date: -90, vendor: tx('Equipment rental', 'Renta de equipo'), desc: tx('Chipper, 2 days', 'Trituradora, 2 días'), amount: 180 },
      { date: -89, vendor: dump, desc: tx('Wood chips and brush', 'Astillas y ramas'), amount: 110 },
    ],
    received: [{ date: -85, method: 'check', ref: tx('Paid in full', 'Pago total'), amount: 2600 }],
    workerPays: [
      { date: -89, workerId: 'w6', method: 'cash', amount: 300, payType: 'daily', from: -90, to: -89 },
      { date: -89, workerId: 'w8', method: 'cash', amount: 252, payType: 'hourly', from: -90, to: -89 },
      { date: -88, workerId: 'w4', method: 'check', ref: '3066', amount: 1100 },
    ],
    tasks: [{ title: tx('Send photos and the paid invoice to the club', 'Mandar fotos y la factura pagada al club'), who: 'u3', due: -84, status: 'done' }],
    log: [{ date: -89, workerId: 'w6', text: tx('Hedge is done and level. Pool deck blown clean. Lifeguards asked us to finish before 11, we did.', 'El seto quedó parejo. Soplé toda el área de la piscina. Los salvavidas pidieron terminar antes de las 11 y cumplimos.') }],
    notes: [[-96, 'visit', tx('Work only before the pool opens at 11 am. No chips left on the pool deck.', 'Trabajar solo antes de que abra la piscina a las 11 am. Nada de astillas en el área de la piscina.')]] });

  /* ---------- leads ---------- */
  k.lead({ id: 'l1', name: 'Brian Walsh', phone: '609-555-0151', email: 'brian@example.com', address: '19 Sample Ln, Galloway, NJ', type: 'hardscape', source: 'website', status: 'scheduled', pri: 'high', value: 18000, appt: [day(2), '09:30'], created: -3,
    notes: [[-3, 'note', tx('Wants a paver patio with a fire pit, about 400 sq ft. Sent photos of the backyard slope.', 'Quiere un patio de adoquín con fogata, unos 400 pies cuadrados. Mandó fotos de la pendiente del patio de atrás.')]] });
  k.lead({ id: 'l2', name: 'Carmen Díaz', phone: '609-555-0152', address: '70 Sample St, Absecon, NJ', type: 'mulch', source: 'referral', status: 'new', value: 900, followUp: 0, created: 0,
    notes: [[0, 'call', tx('Mulch refresh and new shrubs by the front walk. Prefers texts in Spanish. Referred by the Nguyen family.', 'Renovar el mulch y arbustos nuevos junto al camino de enfrente. Prefiere textos en español. Recomendada por la familia Nguyen.')]] });
  k.lead({ id: 'l3', name: 'Ruth Abrams', company: 'Bayview Sample HOA', phone: '609-555-0153', email: 'board@example.com', address: '2 Sample Bay Blvd, Ventnor, NJ', type: 'snow', source: 'google', status: 'sent', value: 6500, followUp: day(3), created: -10,
    notes: [[-10, 'call', tx('Snow removal for 2 parking lots and the walks. Last company showed up late twice.', 'Remoción de nieve para 2 estacionamientos y las aceras. La compañía anterior llegó tarde dos veces.')],
      [-6, 'visit', tx('Measured both lots. Space to pile snow at the back of lot 2 only.', 'Medí los dos estacionamientos. Solo hay dónde apilar nieve al fondo del lote 2.')],
      [-5, 'email', tx('Estimate sent, per push and per season.', 'Presupuesto enviado, por nevada y por temporada.')]] });
  k.lead({ id: 'l4', name: 'Jason Miller', phone: '609-555-0154', email: 'jason@example.com', address: '44 Sample Dr, Egg Harbor Twp, NJ', type: 'lawn', source: 'website', status: 'new', created: -1,
    notes: [[-1, 'note', tx('Website request: weekly mowing on a corner lot, about a third of an acre. His mower broke.', 'Solicitud del sitio web: corte semanal en un lote de esquina, como un tercio de acre. Se le descompuso la cortadora.')]] });
  k.lead({ id: 'l5', name: 'Fatima Rahman', phone: '609-555-0155', email: 'fatima@example.com', address: '6 Sample Ct, Northfield, NJ', type: 'design', source: 'instagram', status: 'new', created: 0,
    notes: [[0, 'text', tx('Saw the DeMarco front yard on Instagram. Wants native plants and less lawn. Budget around $5,000.', 'Vio el jardín de la señora DeMarco en Instagram. Quiere plantas nativas y menos césped. Presupuesto de unos $5,000.')]] });
  k.lead({ id: 'l6', name: 'Bill Hartman', company: 'Sample Storage Center', phone: '609-555-0156', email: 'storagecenter@example.com', address: '900 Sample Pike, Pleasantville, NJ', type: 'lawn', source: 'phone', status: 'contacted', value: 1200, followUp: -3, created: -9, owner: 'u2',
    notes: [[-9, 'call', tx('Commercial mowing around the storage buildings and the front strip by the road. Wants a monthly price.', 'Corte comercial alrededor de las bodegas y la franja de enfrente junto a la carretera. Quiere precio mensual.')],
      [-6, 'call', tx('Bill was out. The front desk said to call back, he decides this month.', 'Bill no estaba. En recepción dijeron que llamemos de nuevo, decide este mes.')]] });
  k.lead({ id: 'l7', name: 'Elena Marchetti', phone: '609-555-0157', email: 'elena@example.com', address: '13 Sample Pl, Margate, NJ', type: 'trees', source: 'facebook', status: 'contacted', value: 850, followUp: day(1), created: -4,
    notes: [[-4, 'text', tx('Privacy hedge is 9 ft tall and leaning on the neighbor side. Wants it brought down to 6 ft.', 'El seto de privacidad mide 9 pies y se va hacia el lado del vecino. Quiere bajarlo a 6 pies.')],
      [-2, 'call', tx('Gave her a range of $800 to $900. She is talking to the neighbor about access.', 'Le di un rango de $800 a $900. Está hablando con el vecino por el acceso.')]] });
  k.lead({ id: 'l8', name: 'Derrick Johnson', phone: '609-555-0158', email: 'derrick@example.com', address: '25 Sample Ave, Mays Landing, NJ', type: 'irrigation', source: 'referral', status: 'scheduled', value: 450, appt: [0, '14:00'], created: -2, owner: 'u2',
    notes: [[-2, 'call', tx('Two zones do not turn on and he wants the system winterized. Referred by Howard Levin. Jamal goes today at 2 pm.', 'Dos zonas no prenden y quiere purgar el sistema para el invierno. Recomendado por Howard Levin. Jamal va hoy a las 2 pm.')]] });
  k.lead({ id: 'l9', name: 'Marisol Cruz', phone: '609-555-0159', address: '58 Sample Rd, Pleasantville, NJ', type: 'cleanup', source: 'google', status: 'scheduled', value: 700, appt: [day(1), '10:30'], created: -5,
    notes: [[-5, 'call', tx('Fall cleanup, big yard with 4 oak trees. Wants leaves hauled away, not blown to the curb. Prefers Spanish.', 'Limpieza de otoño, patio grande con 4 robles. Quiere que nos llevemos las hojas, no solo soplarlas a la calle. Prefiere español.')]] });
  k.lead({ id: 'l10', name: 'Leon Whitaker', company: 'Oceanview Sample Condos', phone: '609-555-0160', email: 'oceanviewcondos@example.com', address: '700 Sample Shore Rd, Brigantine, NJ', type: 'lawn', source: 'phone', status: 'scheduled', pri: 'high', value: 2400, appt: [day(5), '11:00'], created: -6,
    notes: [[-6, 'call', tx('Condo association, 3 buildings. Lawn, beds and the pool area. Their agreement with the current company ends next month.', 'Asociación de condominios, 3 edificios. Césped, arriates y área de piscina. Su acuerdo con la compañía actual termina el próximo mes.')]] });
  k.lead({ id: 'l11', name: 'Paul & Jenny Kim', phone: '609-555-0161', email: 'kim@example.com', address: '31 Sample Way, Linwood, NJ', type: 'hardscape', source: 'referral', status: 'sent', value: 9800, followUp: 0, created: -14,
    notes: [[-14, 'call', tx('Referred by Greg Martin. Paver apron at the end of the driveway and a border along both sides.', 'Recomendados por Greg Martin. Franja de adoquín al final de la entrada de autos y un borde a los dos lados.')],
      [-11, 'visit', tx('Measured 260 sq ft of apron plus 90 ft of border. Driveway is asphalt in good shape.', 'Medí 260 pies cuadrados de entrada más 90 pies de borde. El asfalto está en buen estado.')],
      [-8, 'email', tx('Estimate sent for $9,800. Follow up today.', 'Presupuesto enviado por $9,800. Darle seguimiento hoy.')]] });
  k.lead({ id: 'l12', name: 'Tom Gallagher', phone: '609-555-0162', address: '84 Sample St, Somers Point, NJ', type: 'lawn', source: 'google', status: 'lost', value: 60, created: -22,
    lostReason: tx('Went with a cheaper mowing service, $15 less per cut.', 'Se fue con un servicio de corte más barato, $15 menos por corte.'),
    notes: [[-22, 'call', tx('Weekly mowing, small yard. We said $60 per visit, he has a quote for $45.', 'Corte semanal, patio chico. Dijimos $60 por visita, tiene otro precio de $45.')]] });
  k.lead({ id: 'l13', name: 'Victor Almeida', company: 'Seaview Sample Homes', phone: '609-555-0110', email: 'seaviewhomes@example.com', address: 'Lot 14, Sample Farm Rd, Egg Harbor City, NJ', type: 'design', source: 'other', status: 'won', value: 8600, created: -12, clientId: 'c10', jobId: 'j10', owner: 'u2',
    notes: [[-12, 'visit', tx('Victor stopped our truck at the gas station and asked for a card. Needs a lawn in before a closing.', 'Victor paró nuestra camioneta en la gasolinera y pidió una tarjeta. Necesita un césped puesto antes de una entrega.')],
      [-9, 'email', tx('Accepted $8,600 for grading and sod. Deposit by transfer this week.', 'Aceptó $8,600 por nivelación y pasto en rollo. Depósito por transferencia esta semana.')]] });
  k.lead({ id: 'l14', name: 'Daniel Rivera', phone: '609-555-0102', email: 'rivera@example.com', address: '33 Sample Rd, Egg Harbor Twp, NJ', type: 'hardscape', source: 'instagram', status: 'won', value: 14500, created: -19, clientId: 'c2', jobId: 'j2',
    notes: [[-19, 'text', tx('Instagram message with a photo of the patio he wants. About 380 sq ft with a fire pit.', 'Mensaje por Instagram con foto del patio que quiere. Unos 380 pies cuadrados con fogata.')],
      [-15, 'visit', tx('Measured and marked the patio with paint. He accepted the estimate on the spot.', 'Medí y marqué el patio con pintura. Aceptó el presupuesto ahí mismo.')]] });
  k.lead({ id: 'l15', name: 'Hannah Weiss', phone: '609-555-0111', email: 'hannah@example.com', address: '8 Sample Ln, Somers Point, NJ', type: 'mulch', source: 'facebook', status: 'won', value: 1650, created: -7, clientId: 'c11', jobId: 'j11', owner: 'u2',
    notes: [[-7, 'text', tx('Facebook message: needs the front beds cleaned up and mulched before a family event.', 'Mensaje por Facebook: necesita los arriates de enfrente limpios y con mulch antes de un evento familiar.')],
      [-4, 'visit', tx('Six boxwoods are dead from the summer. Price accepted with the replacements.', 'Seis bojes se secaron en el verano. Aceptó el precio con los reemplazos.')]] });
  k.lead({ id: 'l16', name: 'Neil Banerjee', company: 'Sample Car Wash', phone: '609-555-0163', email: 'carwash@example.com', address: '150 Sample Hwy, Egg Harbor Twp, NJ', type: 'hardscape', source: 'phone', status: 'lost', value: 22000, created: -38,
    lostReason: tx('The landlord would not approve the work.', 'El dueño del terreno no aprobó el trabajo.'),
    notes: [[-38, 'call', tx('Wants a paver waiting area and planters at the exit of the car wash.', 'Quiere un área de espera de adoquín y jardineras a la salida del autolavado.')],
      [-31, 'call', tx('Neil rents the property and the landlord said no to any changes.', 'Neil renta el terreno y el dueño dijo que no a cualquier cambio.')]] });

  /* ---------- office tasks ---------- */
  k.task({ title: tx('Call Bill Hartman again about the storage center price', 'Volver a llamar a Bill Hartman por el precio de las bodegas'), who: 'u2', due: -3, leadId: 'l6' });
  k.task({ title: tx('Get the W-9 from Luis Herrera', 'Conseguir el W-9 de Luis Herrera'), who: 'u3', due: -2, pri: 'high', description: tx('He is on the Rivera patio. No more payments until it is on file.', 'Está en el patio de los Rivera. No más pagos hasta tenerlo en el expediente.') });
  k.task({ title: tx('Ask Sample Tree Service for their renewed insurance certificate', 'Pedirle a Sample Tree Service su certificado de seguro renovado'), who: 'u3', due: 1, status: 'waiting', pri: 'high' });
  k.task({ title: tx('Check the Bayview HOA snow numbers before the follow-up', 'Revisar los números de nieve de Bayview HOA antes del seguimiento'), who: 'u1', due: 2, status: 'review', leadId: 'l3' });
  k.task({ title: tx('Sharpen blades and change oil on both mowers', 'Afilar cuchillas y cambiar aceite a las dos cortadoras'), who: 'w2', due: 2, status: 'doing' });
  k.task({ title: tx('Order salt and snow stakes for the winter accounts', 'Pedir sal y estacas de nieve para las cuentas de invierno'), who: 'u2', due: 10 });
  k.task({ title: tx('Renew the commercial auto policy for the dump truck', 'Renovar la póliza de auto comercial del camión de volteo'), who: 'u1', due: 9, pri: 'high' });

  return k.finish();
}
