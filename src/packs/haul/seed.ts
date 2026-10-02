import type { Lang, SeedData } from '@/domain/types';
import { seedKit } from '../seedkit';

/** Sample business for this edition. Fictional data only. */
export function seed(lang: Lang): SeedData {
  const k = seedKit(lang, 'VH-');
  const { tx } = k;

  // wording that repeats
  const station = tx('Transfer station', 'Estación de transferencia');
  const fuel = tx('Fuel', 'Gasolina');
  const truckFuel = tx('Truck fuel', 'Gasolina del camión');
  const truckRental = tx('Truck rental', 'Renta de camión');
  const deposit = tx('Deposit', 'Depósito');
  const balance = tx('Balance', 'Saldo');
  const paidFull = tx('Paid in full', 'Pagado completo');
  const insurer = 'Sample Mutual Insurance';

  /* ---------- crew ---------- */
  k.worker({ id: 'w1', name: 'Tony Brooks', trade: tx('Driver and crew lead', 'Chofer y jefe de cuadrilla'), phone: '609-555-0141', email: 'tony@example.com', payType: 'daily', rate: 220, w9: 300, coi: 95, insurer });
  k.worker({ id: 'w2', name: 'Eddie Cruz', trade: tx('Mover', 'Mudancero'), phone: '609-555-0142', email: 'eddie@example.com', payType: 'daily', rate: 180, w9: 240 });
  k.worker({ id: 'w3', name: 'Sam Patel', trade: tx('Mover', 'Mudancero'), phone: '609-555-0143', email: 'spatel@example.com', payType: 'daily', rate: 150 });
  k.worker({ id: 'w4', name: 'Marisol Vega', trade: tx('Packer', 'Empacadora'), phone: '609-555-0144', email: 'marisol@example.com', payType: 'hourly', rate: 22, w9: 150 });
  k.worker({ id: 'w5', name: 'Darnell Hayes', trade: tx('Driver, box truck', 'Chofer de camión de caja'), phone: '609-555-0145', email: 'darnell@example.com', payType: 'daily', rate: 200, w9: 120, coi: 18, insurer });
  k.worker({ id: 'w6', name: 'Héctor Lima', trade: tx('Loader', 'Cargador'), phone: '609-555-0146', email: 'hector@example.com', payType: 'hourly', rate: 20, w9: 90 });
  k.worker({ id: 'w7', name: 'Sample Piano Movers LLC', trade: tx('Pianos and heavy items', 'Pianos y objetos pesados'), phone: '609-555-0147', email: 'pianos@example.com', payType: 'project', w9: 400, coi: -9, insurer });
  k.worker({ id: 'w8', name: 'Kyle Jensen', trade: tx('Loader', 'Cargador'), phone: '609-555-0148', email: 'kyle@example.com', payType: 'daily', rate: 150, w9: 200, active: false });

  /* ---------- clients ---------- */
  k.client({ id: 'c1', name: 'Renee Allen', phone: '609-555-0101', email: 'renee@example.com', addresses: ['31 Sample Rd, Linwood, NJ', '8 Sample Ln, Northfield, NJ'], since: -6 });
  k.client({ id: 'c2', name: 'David Chen', phone: '609-555-0102', email: 'david@example.com', addresses: ['9 Sample St, Absecon, NJ'], since: -14 });
  k.client({ id: 'c3', name: 'Greg Novak', company: 'Sample Builders LLC', phone: '609-555-0103', email: 'greg@example.com', addresses: ['5 Sample Ct, Galloway, NJ', '77 Sample Ave, Egg Harbor City, NJ'], since: -84,
    note: tx('Contractor account. Calls us when a dumpster is not worth it. Pays by check and always wants the weight tickets.', 'Cuenta de contratista. Nos llama cuando no le conviene rentar un contenedor. Paga con cheque y siempre pide los tickets de peso.') });
  k.client({ id: 'c4', name: 'Monique Carter', company: 'Sample Shore Property Management', phone: '609-555-0104', email: 'monique@example.com', addresses: ['200 Sample Blvd, Pleasantville, NJ', '14 Sample Ter, Ventnor, NJ'], since: -108,
    note: tx('Manages two apartment communities. Wants photos of every pickup and one invoice every two weeks.', 'Administra dos comunidades de apartamentos. Quiere fotos de cada recogida y una sola factura cada dos semanas.') });
  k.client({ id: 'c5', name: 'Rosa Delgado', phone: '609-555-0105', email: 'rosa.delgado@example.com', addresses: ['18 Sample Ave, Pleasantville, NJ'], since: -42 });
  k.client({ id: 'c6', name: 'Walter Kim', phone: '609-555-0106', email: 'walter@example.com', addresses: ['42 Sample Dr, Northfield, NJ'], since: -26 });
  k.client({ id: 'c7', name: 'Ahmed Farouk', company: 'Sample Self Storage', phone: '609-555-0107', email: 'ahmed@example.com', addresses: ['300 Sample Pike, Egg Harbor Twp, NJ'], since: -21 });
  k.client({ id: 'c8', name: 'Ingrid Sorensen', phone: '609-555-0108', email: 'ingrid@example.com', addresses: ['55 Sample Ave, Ventnor, NJ', '120 Sample Way, Somers Point, NJ'], since: -13, emailOptOut: true,
    note: tx('Asked for calls or texts only. No automatic emails.', 'Pidió solo llamadas o mensajes de texto. Nada de correos automáticos.') });
  k.client({ id: 'c9', name: 'Luis Carrasco', phone: '609-555-0109', email: 'luis.carrasco@example.com', addresses: ['64 Sample Dr, Hammonton, NJ'], since: -15 });
  k.client({ id: 'c10', name: 'Priscilla Okafor', company: 'Sample Realty Group', phone: '609-555-0110', email: 'priscilla@example.com', addresses: ['3 Sample Pl, Margate, NJ'], since: -66,
    note: tx('Realtor. Sends us cleanouts before a house goes on the market. Always on a deadline for the photographer.', 'Agente de bienes raíces. Nos manda vaciados antes de poner una casa en venta. Siempre con fecha encima por el fotógrafo.') });
  k.client({ id: 'c11', name: 'Bernard Holt', phone: '609-555-0111', email: 'bernard@example.com', addresses: ['27 Sample Ln, Somers Point, NJ'], since: -12 });
  k.client({ id: 'c12', name: 'Ana María Fuentes', phone: '609-555-0112', email: 'anamaria@example.com', addresses: ['12 Sample Ave, Galloway, NJ'], since: -2 });

  /* ---------- jobs ---------- */
  k.job({
    id: 'j1', name: tx('Local move, 3 bedrooms', 'Mudanza local, 3 recámaras'), clientId: 'c1', address: '31 Sample Rd, Linwood, NJ', type: 'local', status: 'contract', price: 1450, start: 4, end: 4, manager: 'u2',
    scope: tx('Load, move and unload a 3-bedroom house from Linwood to 8 Sample Ln, Northfield. Take apart and put back together 3 beds. Wrap furniture with blankets and shrink wrap. The glass cabinet gets extra padding.',
      'Cargar, mover y descargar una casa de 3 recámaras de Linwood a 8 Sample Ln, Northfield. Desarmar y armar 3 camas. Envolver los muebles con cobijas y plástico. La vitrina de vidrio lleva protección extra.'),
    payTerms: tx('$300 deposit when you sign, balance at delivery.', 'Depósito de $300 al firmar, saldo al entregar.'),
    assign: [
      { workerId: 'w1', scope: tx('Driver and lead', 'Chofer y encargado'), price: 220, payType: 'daily', rate: 220, qty: 1, status: 'pending' },
      { workerId: 'w2', scope: tx('Mover', 'Mudancero'), price: 180, payType: 'daily', rate: 180, qty: 1, status: 'pending' },
      { workerId: 'w3', scope: tx('Mover', 'Mudancero'), price: 150, payType: 'daily', rate: 150, qty: 1, status: 'pending' },
    ],
    tasks: [
      { title: tx('Get the agreement signed and collect the $300 deposit', 'Conseguir la firma del acuerdo y cobrar el depósito de $300'), who: 'u2', due: 0, pri: 'high' },
      { title: tx('Confirm parking at the new address', 'Confirmar dónde estacionar en la casa nueva'), who: 'u3', due: 3 },
      { title: tx('Bring extra blankets and both dollies', 'Llevar cobijas extra y los dos dollies'), who: 'w1', due: 4 },
    ],
    notes: [
      [-3, 'call', tx('Tight driveway at the new house, park on the street. The glass cabinet needs extra wrapping.', 'La entrada de la casa nueva es angosta, hay que estacionar en la calle. La vitrina de vidrio necesita protección extra.')],
      [-1, 'text', tx('Renee asked for the 8 to 10 am window. Told her we confirm the day before.', 'Renee pidió la ventana de 8 a 10 am. Le dije que confirmamos un día antes.')],
    ],
  });

  k.job({
    id: 'j2', name: tx('Garage junk removal', 'Retiro de basura del garaje'), clientId: 'c2', type: 'junk', status: 'done', price: 620, start: 0, end: 0,
    scope: tx('Clear out a 2-car garage: old shelving, bikes, a treadmill, boxes and dried-out paint cans. Sweep when done.', 'Vaciar un garaje de 2 carros: estantes viejos, bicicletas, una caminadora, cajas y latas de pintura ya secas. Barrer al terminar.'),
    payTerms: tx('Paid in full when the truck is loaded.', 'Se paga completo cuando el camión está cargado.'),
    assign: [
      { workerId: 'w1', scope: tx('Driver, half day', 'Chofer, medio día'), price: 110, payType: 'daily', rate: 220, qty: 0.5, status: 'done' },
      { workerId: 'w6', scope: tx('Loader', 'Cargador'), price: 80, payType: 'hourly', rate: 20, qty: 4, status: 'done' },
    ],
    expenses: [
      { date: 0, vendor: station, desc: tx('Dump fee, 1 load', 'Tarifa del vertedero, 1 carga'), amount: 115 },
      { date: 0, vendor: fuel, desc: truckFuel, amount: 35 },
    ],
    received: [{ date: 0, method: 'card', ref: paidFull, amount: 620 }],
    workerPays: [
      { date: 0, workerId: 'w1', method: 'cash', amount: 110, payType: 'daily', from: 0, to: 0 },
      { date: 0, workerId: 'w6', method: 'zelle', amount: 80, payType: 'hourly', from: 0, to: 0 },
    ],
    tasks: [
      { title: tx('Before and after photos', 'Fotos de antes y después'), who: 'w6', due: 0, status: 'done' },
      { title: tx('Drop the bikes at the donation center', 'Dejar las bicicletas en el centro de donación'), who: 'w1', due: 0, status: 'done' },
      { title: tx('Ask David for a review', 'Pedirle una reseña a David'), who: 'u3', due: 2, pri: 'low' },
    ],
    notes: [[-3, 'call', tx('David will be home all morning. The garage door opener is broken, lift the door by hand.', 'David va a estar en casa toda la mañana. El control del garaje no sirve, hay que subir la puerta a mano.')]],
    log: [{ date: 0, workerId: 'w1', text: tx('Full truck, one trip to the transfer station. Bikes and the treadmill went to the donation center. Garage swept.', 'Camión lleno, un solo viaje a la estación de transferencia. Las bicicletas y la caminadora se fueron a donación. Garaje barrido.') }],
  });

  k.job({
    id: 'j3', name: tx('Construction debris pickup', 'Recogida de escombros de construcción'), clientId: 'c3', address: '5 Sample Ct, Galloway, NJ', type: 'debris', status: 'progress', price: 1380, start: -1, end: 2,
    scope: tx('Pick up demolition debris from a kitchen and bathroom remodel: drywall, tile, cabinets and lumber. 2 truck loads, the second one after the tile demo.', 'Recoger los escombros de la remodelación de una cocina y un baño: drywall, loseta, gabinetes y madera. 2 cargas de camión, la segunda después de la demolición de la loseta.'),
    payTerms: tx('50% deposit, balance by check when the second load is gone.', '50% de depósito, saldo con cheque cuando salga la segunda carga.'),
    assign: [
      { workerId: 'w1', scope: tx('Driver, 2 loads', 'Chofer, 2 cargas'), price: 440, payType: 'daily', rate: 220, qty: 2, status: 'progress' },
      { workerId: 'w3', scope: tx('Loader, 2 loads', 'Cargador, 2 cargas'), price: 300, payType: 'daily', rate: 150, qty: 2, status: 'progress' },
    ],
    expenses: [
      { date: -1, vendor: station, desc: tx('Dump fee, load 1 (2.1 tons)', 'Tarifa del vertedero, carga 1 (2.1 toneladas)'), amount: 180 },
      { date: -1, vendor: fuel, desc: truckFuel, amount: 38 },
    ],
    received: [{ date: -1, method: 'check', ref: tx('50% deposit', 'Depósito del 50%'), amount: 690 }],
    workerPays: [{ date: -1, workerId: 'w3', method: 'zelle', amount: 150, payType: 'daily', from: -1, to: -1 }],
    tasks: [
      { title: tx('Load 1: drywall and cabinets', 'Carga 1: drywall y gabinetes'), who: 'w1', due: -1, status: 'done' },
      { title: tx('Load 2, after the tile demo', 'Carga 2, después de la demolición de la loseta'), who: 'w3', due: 2 },
      { title: tx('Save the weight tickets for Greg', 'Guardar los tickets de peso para Greg'), who: 'u3', due: 2, status: 'doing' },
      { title: tx('Collect the balance check', 'Cobrar el cheque del saldo'), who: 'u1', due: 3, status: 'waiting' },
    ],
    log: [{ date: -1, workerId: 'w1', text: tx('Load 1 is out. Heavy with tile, 2.1 tons on the ticket. Left the driveway clear for the plumber.', 'Ya salió la carga 1. Pesada por la loseta, 2.1 toneladas en el ticket. Dejamos la entrada libre para el plomero.') }],
    notes: [[-4, 'call', tx('Greg wants the weight tickets attached to the invoice. The pile is on the driveway side, do not block the garage.', 'Greg quiere los tickets de peso junto con la factura. El montón está del lado de la entrada, no tapar el garaje.')]],
  });

  k.job({
    id: 'j4', name: tx('Weekly bulk pickup, apartment community', 'Recogida semanal de voluminosos, comunidad de apartamentos'), clientId: 'c4', address: '200 Sample Blvd, Pleasantville, NJ', type: 'junk', status: 'progress', price: 1520, start: -24, repeat: 'weekly', manager: 'u2',
    scope: tx('Weekly bulk pickup at the 3 dumpster enclosures: mattresses, furniture and whatever move-outs leave behind. Photo of each enclosure before and after.', 'Recogida semanal de voluminosos en los 3 corrales de basura: colchones, muebles y lo que dejan los inquilinos al salir. Foto de cada corral antes y después.'),
    payTerms: tx('$380 per pickup, 4 pickups per cycle, billed every two weeks.', '$380 por recogida, 4 recogidas por ciclo, se factura cada dos semanas.'),
    assign: [
      { workerId: 'w5', scope: tx('Driver, 4 pickups (half days)', 'Chofer, 4 recogidas (medios días)'), price: 400, payType: 'daily', rate: 200, qty: 2, status: 'progress' },
      { workerId: 'w6', scope: tx('Loader, 4 hours per pickup', 'Cargador, 4 horas por recogida'), price: 320, payType: 'hourly', rate: 20, qty: 16, status: 'progress' },
    ],
    expenses: [
      { date: -24, vendor: station, desc: tx('Dump fee, pickup 1', 'Tarifa del vertedero, recogida 1'), amount: 88 },
      { date: -17, vendor: station, desc: tx('Dump fee, pickup 2', 'Tarifa del vertedero, recogida 2'), amount: 96 },
      { date: -17, vendor: fuel, desc: truckFuel, amount: 32 },
      { date: -10, vendor: station, desc: tx('Dump fee, pickup 3, plus 6 mattresses', 'Tarifa del vertedero, recogida 3, más 6 colchones'), amount: 139 },
      { date: -3, vendor: station, desc: tx('Dump fee, pickup 4', 'Tarifa del vertedero, recogida 4'), amount: 91 },
      { date: -3, vendor: fuel, desc: truckFuel, amount: 34 },
    ],
    received: [{ date: -9, method: 'transfer', ref: tx('Pickups 1 and 2', 'Recogidas 1 y 2'), amount: 760 }],
    workerPays: [
      { date: -10, workerId: 'w5', method: 'check', ref: '2051', amount: 200, payType: 'daily', from: -24, to: -17 },
      { date: -10, workerId: 'w6', method: 'zelle', amount: 160, payType: 'hourly', from: -24, to: -17 },
    ],
    tasks: [
      { title: tx('Report the sectional left outside enclosure C', 'Reportar el sofá seccional que dejaron fuera del corral C'), who: 'w6', due: -3, status: 'done' },
      { title: tx('Invoice pickups 3 and 4', 'Facturar las recogidas 3 y 4'), who: 'u2', due: 0, pri: 'high' },
      { title: tx('Send the pickup 4 photos to Monique', 'Mandarle a Monique las fotos de la recogida 4'), who: 'u3', due: 0, status: 'review' },
      { title: tx('Pickup 5: all 3 enclosures', 'Recogida 5: los 3 corrales'), who: 'w5', due: 4 },
    ],
    log: [
      { date: -10, workerId: 'w5', text: tx('6 mattresses this week. The transfer station charges extra for each one, it is on the ticket.', 'Esta semana salieron 6 colchones. La estación cobra extra por cada uno, viene en el ticket.') },
      { date: -3, workerId: 'w6', text: tx('Somebody left a sectional outside enclosure C again. We took it and sent the photo.', 'Otra vez dejaron un seccional afuera del corral C. Nos lo llevamos y mandamos la foto.') },
    ],
    notes: [[-24, 'visit', tx('Three enclosures: A by the office, B behind building 2, C at the back gate. Get the gate code at the office. No pickups before 8 am.', 'Tres corrales: A junto a la oficina, B detrás del edificio 2, C en el portón de atrás. El código del portón se pide en la oficina. Nada de recogidas antes de las 8 am.')]],
  });

  k.job({
    id: 'j5', name: tx('Estate cleanout, 4 bedrooms', 'Vaciado de casa, 4 recámaras'), clientId: 'c5', type: 'cleanout', status: 'done', price: 3400, start: -34, end: -32,
    scope: tx('Clear out a 4-bedroom house, the basement and the shed. The family keeps anything tagged with blue tape. Donate usable furniture and haul the rest. Broom clean at the end.', 'Vaciar una casa de 4 recámaras, el sótano y el cobertizo. La familia se queda con lo que tenga cinta azul. Donar los muebles que sirvan y llevarse lo demás. Dejar todo barrido.'),
    payTerms: tx('50% deposit, balance on the last day.', '50% de depósito, saldo el último día.'),
    assign: [
      { workerId: 'w1', scope: tx('Driver and lead, 3 days', 'Chofer y encargado, 3 días'), price: 660, payType: 'daily', rate: 220, qty: 3, status: 'done' },
      { workerId: 'w2', scope: tx('Mover, 3 days', 'Mudancero, 3 días'), price: 540, payType: 'daily', rate: 180, qty: 3, status: 'done' },
      { workerId: 'w6', scope: tx('Loader, basement and shed', 'Cargador, sótano y cobertizo'), price: 400, payType: 'hourly', rate: 20, qty: 20, status: 'done' },
    ],
    expenses: [
      { date: -33, vendor: station, desc: tx('Dump fees, 4 loads', 'Tarifas del vertedero, 4 cargas'), amount: 540 },
      { date: -33, vendor: truckRental, desc: tx('Second box truck, 1 day', 'Segundo camión de caja, 1 día'), amount: 140 },
      { date: -32, vendor: fuel, desc: tx('Fuel, both trucks', 'Gasolina, los dos camiones'), amount: 70 },
    ],
    received: [{ date: -36, method: 'check', ref: deposit, amount: 1700 }, { date: -32, method: 'zelle', ref: balance, amount: 1700 }],
    workerPays: [
      { date: -31, workerId: 'w1', method: 'check', ref: '2041', amount: 660, payType: 'daily', from: -34, to: -32 },
      { date: -31, workerId: 'w2', method: 'check', ref: '2042', amount: 540, payType: 'daily', from: -34, to: -32 },
      { date: -31, workerId: 'w6', method: 'zelle', amount: 400, payType: 'hourly', from: -34, to: -32 },
    ],
    tasks: [
      { title: tx('Walk the house with the family and tag what stays', 'Recorrer la casa con la familia y marcar lo que se queda'), who: 'u1', due: -35, status: 'done' },
      { title: tx('Photos of anything valuable before loading', 'Fotos de todo lo de valor antes de cargar'), who: 'w2', due: -34, status: 'done' },
      { title: tx('Send the donation receipt to Rosa', 'Mandarle a Rosa el recibo de la donación'), who: 'u3', due: -30, status: 'done' },
    ],
    log: [
      { date: -34, workerId: 'w1', text: tx('Day 1: upstairs bedrooms and attic are done. Found a box of photo albums in the attic and set it aside for Rosa.', 'Día 1: recámaras de arriba y ático listos. Encontramos una caja de álbumes de fotos en el ático, se la apartamos a Rosa.') },
      { date: -32, workerId: 'w2', text: tx('Basement and shed are empty. House is broom clean. Keys are back in the lockbox.', 'Sótano y cobertizo vacíos. Casa barrida. Las llaves quedaron en el lockbox.') },
    ],
    notes: [[-37, 'visit', tx('The family keeps anything with blue tape. The piano stays for the buyer. Rosa prefers calls in Spanish.', 'La familia se queda con todo lo que tenga cinta azul. El piano se queda para el comprador. Rosa prefiere que la llamen en español.')]],
  });

  k.job({
    id: 'j6', name: tx('Upright piano move', 'Mudanza de piano vertical'), clientId: 'c6', type: 'heavy', status: 'done', price: 580, start: -18, end: -18, manager: 'u2',
    scope: tx('Move an upright piano out of the living room (3 steps down to the walk) and deliver it to a ground floor across town.', 'Sacar un piano vertical de la sala (3 escalones hasta la acera) y entregarlo en una planta baja al otro lado del pueblo.'),
    payTerms: tx('Paid in full on delivery.', 'Se paga completo al entregar.'),
    assign: [{ workerId: 'w7', scope: tx('Piano crew, 2 people with skid board', 'Cuadrilla de pianos, 2 personas con tabla'), price: 350, status: 'done' }],
    expenses: [{ date: -18, vendor: fuel, desc: truckFuel, amount: 25 }],
    received: [{ date: -18, method: 'card', ref: paidFull, amount: 580 }],
    workerPays: [{ date: -16, workerId: 'w7', method: 'card', amount: 350, payType: 'project' }],
    tasks: [
      { title: tx('Confirm steps and door width at both houses', 'Confirmar escalones y ancho de puerta en las dos casas'), who: 'u2', due: -20, status: 'done' },
      { title: tx('Book the piano crew', 'Apartar a la cuadrilla de pianos'), who: 'u2', due: -19, status: 'done' },
      { title: tx('Ask Walter for a review', 'Pedirle una reseña a Walter'), who: 'u3', due: -15, status: 'done', pri: 'low' },
    ],
    notes: [[-21, 'call', tx('Upright piano, about 500 lb. Walter wants it tuned after the move, gave him the name of a tuner.', 'Piano vertical de unas 500 libras. Walter quiere afinarlo después de la mudanza, le pasamos el nombre de un afinador.')]],
    log: [{ date: -18, workerId: 'w7', text: tx('Piano delivered, not a mark on it. Used the skid board on the 3 front steps.', 'Piano entregado, sin un rayón. Usamos la tabla en los 3 escalones del frente.') }],
  });

  k.job({
    id: 'j7', name: tx('Storage unit cleanouts, 3 units', 'Vaciado de bodegas, 3 unidades'), clientId: 'c7', type: 'cleanout', status: 'done', price: 1650, start: -12, end: -11, manager: 'u2', leadId: 'l13',
    scope: tx('Empty 3 abandoned storage units after the auction (two 10x10 and one 10x20). Sweep each unit and send photos to the office.', 'Vaciar 3 bodegas abandonadas después de la subasta (dos de 10x10 y una de 10x20). Barrer cada una y mandar fotos a la oficina.'),
    payTerms: tx('50% to get on the schedule, balance net 15 after the photos.', '50% para apartar la fecha, saldo a 15 días después de las fotos.'),
    assign: [
      { workerId: 'w1', scope: tx('Driver and lead, 2 days', 'Chofer y encargado, 2 días'), price: 440, payType: 'daily', rate: 220, qty: 2, status: 'done' },
      { workerId: 'w2', scope: tx('Mover, 2 days', 'Mudancero, 2 días'), price: 360, payType: 'daily', rate: 180, qty: 2, status: 'done' },
    ],
    expenses: [
      { date: -11, vendor: station, desc: tx('Dump fees, 3 loads', 'Tarifas del vertedero, 3 cargas'), amount: 390 },
      { date: -11, vendor: fuel, desc: truckFuel, amount: 45 },
    ],
    received: [{ date: -13, method: 'transfer', ref: deposit, amount: 825 }],
    workerPays: [
      { date: -10, workerId: 'w1', method: 'zelle', amount: 440, payType: 'daily', from: -12, to: -11 },
      { date: -10, workerId: 'w2', method: 'cash', amount: 360, payType: 'daily', from: -12, to: -11 },
    ],
    tasks: [
      { title: tx('Send the unit photos to Ahmed', 'Mandarle a Ahmed las fotos de las bodegas'), who: 'u3', due: -11, status: 'done' },
      { title: tx('Send the final invoice to their main office', 'Mandar la factura final a su oficina central'), who: 'u2', due: -10, status: 'done' },
      { title: tx('Collect the $825 balance', 'Cobrar el saldo de $825'), who: 'u2', due: 4, status: 'waiting', pri: 'high' },
    ],
    log: [{ date: -11, workerId: 'w2', text: tx('All 3 units are empty and swept. Unit 214 had a lot of wet boxes, that load was extra heavy.', 'Las 3 bodegas vacías y barridas. La 214 tenía muchas cajas mojadas, esa carga salió bien pesada.') }],
    notes: [[-13, 'call', tx('Ahmed will have more units after the next auction. Balance goes through their main office, net 15.', 'Ahmed va a tener más bodegas después de la próxima subasta. El saldo lo paga su oficina central, a 15 días.')]],
  });

  k.job({
    id: 'j8', name: tx('Local move with packing, 2-bedroom condo', 'Mudanza local con empaque, condominio de 2 recámaras'), clientId: 'c8', address: '55 Sample Ave, Ventnor, NJ', type: 'local', status: 'progress', price: 2350, start: 0, end: 1, leadId: 'l12',
    scope: tx('Day 1: pack the kitchen, the china cabinet and the books. Day 2: load, move and unload a 2-bedroom condo (2nd floor, elevator) to 120 Sample Way, Somers Point. Put the beds and the dining table back together.', 'Día 1: empacar la cocina, la vitrina y los libros. Día 2: cargar, mover y descargar un condominio de 2 recámaras (2.º piso, con elevador) a 120 Sample Way, Somers Point. Armar las camas y la mesa del comedor.'),
    payTerms: tx('$500 deposit, balance on delivery.', 'Depósito de $500, saldo al entregar.'),
    assign: [
      { workerId: 'w4', scope: tx('Packing, day 1', 'Empaque, día 1'), price: 264, payType: 'hourly', rate: 22, qty: 12, status: 'progress' },
      { workerId: 'w1', scope: tx('Driver and lead, moving day', 'Chofer y encargado, día de la mudanza'), price: 220, payType: 'daily', rate: 220, qty: 1, status: 'pending' },
      { workerId: 'w2', scope: tx('Mover, moving day', 'Mudancero, día de la mudanza'), price: 180, payType: 'daily', rate: 180, qty: 1, status: 'pending' },
      { workerId: 'w6', scope: tx('Loader, moving day', 'Cargador, día de la mudanza'), price: 160, payType: 'hourly', rate: 20, qty: 8, status: 'pending' },
    ],
    expenses: [
      { date: -1, vendor: tx('Moving supply store', 'Tienda de artículos para mudanza'), desc: tx('Boxes, packing paper, tape and 2 wardrobe boxes', 'Cajas, papel de empaque, cinta y 2 cajas de ropero'), amount: 185 },
      { date: -1, vendor: truckRental, desc: tx('26 ft box truck, 1 day', 'Camión de caja de 26 pies, 1 día'), amount: 189 },
    ],
    received: [{ date: -6, method: 'zelle', ref: deposit, amount: 500 }],
    tasks: [
      { title: tx('Reserve the elevator at both buildings', 'Apartar el elevador en los dos edificios'), who: 'u3', due: -2, status: 'done' },
      { title: tx('Pack the kitchen and the china cabinet', 'Empacar la cocina y la vitrina'), who: 'w4', due: 0, status: 'doing', pri: 'high' },
      { title: tx('Load at 8 am, elevator is reserved 8 to 11', 'Cargar a las 8 am, el elevador está apartado de 8 a 11'), who: 'w1', due: 1, pri: 'high' },
      { title: tx('Collect the balance on delivery', 'Cobrar el saldo al entregar'), who: 'u1', due: 1 },
    ],
    log: [{ date: 0, workerId: 'w4', text: tx('Kitchen is packed, 31 boxes labeled by room. China cabinet after lunch.', 'La cocina ya está empacada, 31 cajas marcadas por cuarto. La vitrina después de comer.') }],
    notes: [
      [-7, 'call', tx('Ingrid wants calls or texts, no emails. The elevator has to be reserved with the front desk at both buildings.', 'Ingrid quiere llamadas o textos, nada de correos. El elevador se aparta con la recepción en los dos edificios.')],
      [-1, 'text', tx('Front desk confirmed the elevator: 8 to 11 am at pickup, 1 to 4 pm at the new building.', 'La recepción confirmó el elevador: de 8 a 11 am en la salida y de 1 a 4 pm en el edificio nuevo.')],
    ],
  });

  k.job({
    id: 'j9', name: tx('Long-distance move to North Carolina', 'Mudanza de larga distancia a Carolina del Norte'), clientId: 'c9', type: 'longdist', status: 'progress', price: 5800, start: 9, end: 11, leadId: 'l11',
    scope: tx('Load a 3-bedroom house in Hammonton, drive to Raleigh, NC and unload. 2 movers travel with the truck. The client packs the boxes, we wrap and pad the furniture. Inventory list signed at pickup and at delivery.', 'Cargar una casa de 3 recámaras en Hammonton, manejar a Raleigh, NC y descargar. Viajan 2 mudanceros con el camión. El cliente empaca las cajas, nosotros envolvemos y protegemos los muebles. Inventario firmado al cargar y al entregar.'),
    payTerms: tx('30% deposit, 40% at pickup, 30% at delivery.', '30% de depósito, 40% al cargar, 30% al entregar.'),
    assign: [
      { workerId: 'w1', scope: tx('Driver and lead, 3 days', 'Chofer y encargado, 3 días'), price: 660, payType: 'daily', rate: 220, qty: 3, status: 'pending' },
      { workerId: 'w2', scope: tx('Mover, 3 days', 'Mudancero, 3 días'), price: 540, payType: 'daily', rate: 180, qty: 3, status: 'pending' },
    ],
    expenses: [
      { date: -4, vendor: truckRental, desc: tx('One-way 26 ft truck, reserved', 'Camión de 26 pies de un solo sentido, reservado'), amount: 1150 },
      { date: -3, vendor: tx('Lodging', 'Hospedaje'), desc: tx('2 rooms, 1 night on the road', '2 cuartos, 1 noche en el camino'), amount: 240 },
    ],
    received: [{ date: -5, method: 'transfer', ref: tx('30% deposit', 'Depósito del 30%'), amount: 1740 }],
    tasks: [
      { title: tx('Book the one-way truck', 'Reservar el camión de un solo sentido'), who: 'u2', due: -4, status: 'done' },
      { title: tx('Inventory list ready for Luis to check', 'Inventario listo para que Luis lo revise'), who: 'u3', due: 1, status: 'review' },
      { title: tx('Confirm the delivery address and truck parking in Raleigh', 'Confirmar la dirección de entrega y dónde estacionar el camión en Raleigh'), who: 'u1', due: 5, status: 'waiting' },
      { title: tx('Remind Luis: defrost the freezer 24 hours before', 'Recordarle a Luis: descongelar el congelador 24 horas antes'), who: 'u3', due: 7 },
      { title: tx('Print the inventory sheets and load 60 blankets', 'Imprimir las hojas de inventario y subir 60 cobijas'), who: 'w1', due: 8 },
    ],
    notes: [
      [-10, 'visit', tx('Walked the house, about 1,100 cubic feet. The upright freezer in the garage goes too and has to be defrosted 24 hours before.', 'Recorrimos la casa, como 1,100 pies cúbicos. El congelador vertical del garaje también se va y hay que descongelarlo 24 horas antes.')],
      [-5, 'email', tx('Deposit is in. Luis asked for delivery before noon on day 3, it is an HOA rule at the new place.', 'Ya entró el depósito. Luis pidió la entrega antes del mediodía del día 3, es regla del HOA en la casa nueva.')],
    ],
  });

  k.job({
    id: 'j10', name: tx('Hot tub and shed removal', 'Retiro de jacuzzi y cobertizo'), clientId: 'c11', type: 'junk', status: 'hold', price: 950, start: -3, manager: 'u2',
    scope: tx('Cut up and remove a 6-person hot tub, take down an 8x10 wood shed and haul everything away. The concrete pad stays. Rake the area.', 'Cortar y sacar un jacuzzi de 6 personas, tumbar un cobertizo de madera de 8x10 y llevarse todo. La plancha de concreto se queda. Rastrillar el área.'),
    payTerms: tx('$200 deposit, balance when the yard is clear.', 'Depósito de $200, saldo cuando el patio quede limpio.'),
    assign: [
      { workerId: 'w1', scope: tx('Driver and lead', 'Chofer y encargado'), price: 220, payType: 'daily', rate: 220, qty: 1, status: 'pending' },
      { workerId: 'w3', scope: tx('Demo and loading', 'Demolición y carga'), price: 150, payType: 'daily', rate: 150, qty: 1, status: 'pending' },
    ],
    expenses: [{ date: -3, vendor: fuel, desc: tx('Truck fuel, trip with no work done', 'Gasolina del camión, viaje sin poder trabajar'), amount: 22 }],
    received: [{ date: -9, method: 'card', ref: deposit, amount: 200 }],
    tasks: [
      { title: tx('Check the dump fee for a fiberglass hot tub', 'Preguntar la tarifa del vertedero para un jacuzzi de fibra de vidrio'), who: 'u3', due: -8, status: 'done' },
      { title: tx('Call Bernard: did the electrician disconnect the hot tub?', 'Llamar a Bernard: ¿ya desconectó el electricista el jacuzzi?'), who: 'u2', due: 2, status: 'waiting' },
      { title: tx('Put the crew back on the schedule once the power is off', 'Volver a programar a la cuadrilla cuando ya no haya corriente'), who: 'u2' },
    ],
    notes: [
      [-10, 'visit', tx('The hot tub is hard wired to the panel. The shed sits on a concrete pad that stays.', 'El jacuzzi está conectado directo al panel. El cobertizo está sobre una plancha de concreto que se queda.')],
      [-3, 'call', tx('On hold. We showed up and the hot tub still had power. Bernard is getting an electrician to disconnect it, we come back when he confirms. Tony and Sam went to other jobs that day.', 'En pausa. Llegamos y el jacuzzi seguía con corriente. Bernard va a traer a un electricista para desconectarlo, regresamos cuando confirme. Tony y Sam se fueron a otros trabajos ese día.')],
    ],
  });

  k.job({
    id: 'j11', name: tx('Basement junk removal', 'Retiro de basura del sótano'), clientId: 'c12', type: 'junk', status: 'estimate', price: 540, start: 6, end: 6,
    scope: tx('Half a truck load from the basement: an old couch, 2 dressers, an exercise bike, boxes and a dehumidifier. Narrow stairs, 2 people.', 'Medio camión del sótano: un sofá viejo, 2 cómodas, una bicicleta fija, cajas y un deshumidificador. Escalera angosta, 2 personas.'),
    payTerms: tx('Paid in full when the truck is loaded. Cash, Zelle or card.', 'Se paga completo cuando el camión está cargado. Efectivo, Zelle o tarjeta.'),
    assign: [
      { workerId: 'w1', scope: tx('Driver, half day', 'Chofer, medio día'), price: 110, payType: 'daily', rate: 220, qty: 0.5, status: 'pending' },
      { workerId: 'w6', scope: tx('Loader', 'Cargador'), price: 60, payType: 'hourly', rate: 20, qty: 3, status: 'pending' },
    ],
    tasks: [{ title: tx('Follow up with Ana María on the estimate', 'Darle seguimiento a Ana María con el estimado'), who: 'u1', due: 1 }],
    notes: [[-1, 'call', tx('Prefers Spanish. Wants a Saturday morning if we can.', 'Prefiere español. Quiere un sábado en la mañana si se puede.')]],
  });

  k.job({
    id: 'j12', name: tx('House cleanout before listing', 'Vaciado de casa antes de ponerla en venta'), clientId: 'c10', type: 'cleanout', status: 'done', price: 7400, start: -58, end: -54,
    scope: tx('Full cleanout of a packed 3-bedroom house and garage before it goes on the market. 5 days, 2 trucks. Bag and haul everything, save documents and photos for the family, pull up the old carpet in 2 rooms.', 'Vaciado completo de una casa de 3 recámaras y garaje, llenos hasta el techo, antes de ponerla en venta. 5 días, 2 camiones. Embolsar y llevarse todo, apartar documentos y fotos para la familia y levantar la alfombra vieja de 2 cuartos.'),
    payTerms: tx('One third to start, one third on day 3, balance when the realtor walks the house.', 'Un tercio para empezar, un tercio el día 3 y el saldo cuando la agente recorra la casa.'),
    assign: [
      { workerId: 'w1', scope: tx('Driver and lead, 5 days', 'Chofer y encargado, 5 días'), price: 1100, payType: 'daily', rate: 220, qty: 5, status: 'done' },
      { workerId: 'w2', scope: tx('Mover, 5 days', 'Mudancero, 5 días'), price: 900, payType: 'daily', rate: 180, qty: 5, status: 'done' },
      { workerId: 'w8', scope: tx('Loader, 5 days', 'Cargador, 5 días'), price: 750, payType: 'daily', rate: 150, qty: 5, status: 'done' },
      { workerId: 'w6', scope: tx('Loader and second truck helper', 'Cargador y ayudante del segundo camión'), price: 800, payType: 'hourly', rate: 20, qty: 40, status: 'done' },
    ],
    expenses: [
      { date: -58, vendor: tx('Supply store', 'Tienda de suministros'), desc: tx('Contractor bags, respirators and gloves', 'Bolsas de contratista, respiradores y guantes'), amount: 95 },
      { date: -56, vendor: truckRental, desc: tx('Second box truck, 3 days', 'Segundo camión de caja, 3 días'), amount: 420 },
      { date: -55, vendor: station, desc: tx('Dump fees, 9 loads', 'Tarifas del vertedero, 9 cargas'), amount: 1215 },
      { date: -54, vendor: fuel, desc: tx('Fuel, both trucks, 5 days', 'Gasolina, los dos camiones, 5 días'), amount: 140 },
    ],
    received: [
      { date: -59, method: 'check', ref: tx('First third', 'Primer tercio'), amount: 2400 },
      { date: -56, method: 'check', ref: tx('Second third', 'Segundo tercio'), amount: 2500 },
      { date: -50, method: 'check', ref: balance, amount: 2500 },
    ],
    workerPays: [
      { date: -55, workerId: 'w1', method: 'check', ref: '2028', amount: 550, payType: 'daily', from: -58, to: -56 },
      { date: -52, workerId: 'w1', method: 'check', ref: '2033', amount: 550, payType: 'daily', from: -55, to: -54 },
      { date: -52, workerId: 'w2', method: 'check', ref: '2034', amount: 900, payType: 'daily', from: -58, to: -54 },
      { date: -52, workerId: 'w8', method: 'cash', amount: 750, payType: 'daily', from: -58, to: -54 },
      { date: -52, workerId: 'w6', method: 'zelle', amount: 800, payType: 'hourly', from: -58, to: -54 },
    ],
    tasks: [
      { title: tx('Box documents and photos for the family', 'Guardar en cajas los documentos y fotos para la familia'), who: 'w2', due: -55, status: 'done' },
      { title: tx('Daily progress photos to Priscilla', 'Fotos diarias del avance para Priscilla'), who: 'u3', due: -54, status: 'done' },
      { title: tx('Final walk with the realtor', 'Recorrido final con la agente'), who: 'u1', due: -51, status: 'done' },
    ],
    log: [
      { date: -57, workerId: 'w1', text: tx('Day 2: kitchen and living room are clear, 2 loads today. Found a folder with deeds and bank papers, it is in the box for the family.', 'Día 2: cocina y sala libres, 2 cargas hoy. Encontramos un fólder con escrituras y papeles del banco, está en la caja para la familia.') },
      { date: -54, workerId: 'w2', text: tx('Last load is out. Carpet is up in both back bedrooms. House is empty and swept.', 'Salió la última carga. Alfombra levantada en las dos recámaras de atrás. Casa vacía y barrida.') },
    ],
    notes: [[-60, 'visit', tx('Rooms are packed to the ceiling. The realtor needs the house empty in one week for the photographer.', 'Los cuartos están llenos hasta el techo. La agente necesita la casa vacía en una semana para el fotógrafo.')]],
  });

  k.job({
    id: 'j13', name: tx('Apartment cleanout after move-out, unit 12', 'Vaciado de apartamento después de una salida, unidad 12'), clientId: 'c4', address: '14 Sample Ter, Ventnor, NJ', type: 'cleanout', status: 'done', price: 980, start: -98, end: -98, manager: 'u2',
    scope: tx('Clear a 1-bedroom apartment after a move-out: furniture, mattress, kitchen items and trash. Leave it ready for the make-ready crew.', 'Vaciar un apartamento de 1 recámara después de una salida: muebles, colchón, cosas de cocina y basura. Dejarlo listo para la cuadrilla que lo prepara.'),
    payTerms: tx('Net 15.', 'A 15 días.'),
    assign: [
      { workerId: 'w5', scope: tx('Driver', 'Chofer'), price: 200, payType: 'daily', rate: 200, qty: 1, status: 'done' },
      { workerId: 'w2', scope: tx('Mover', 'Mudancero'), price: 180, payType: 'daily', rate: 180, qty: 1, status: 'done' },
    ],
    expenses: [
      { date: -98, vendor: station, desc: tx('Dump fee, 1 load and 1 mattress', 'Tarifa del vertedero, 1 carga y 1 colchón'), amount: 150 },
      { date: -98, vendor: fuel, desc: truckFuel, amount: 30 },
    ],
    received: [{ date: -88, method: 'transfer', ref: paidFull, amount: 980 }],
    workerPays: [
      { date: -96, workerId: 'w5', method: 'check', ref: '2011', amount: 200, payType: 'daily', from: -98, to: -98 },
      { date: -96, workerId: 'w2', method: 'check', ref: '2012', amount: 180, payType: 'daily', from: -98, to: -98 },
    ],
    tasks: [
      { title: tx('Pick up the key at the office', 'Recoger la llave en la oficina'), who: 'w5', due: -98, status: 'done' },
      { title: tx('Photos of the empty unit for Monique', 'Fotos de la unidad vacía para Monique'), who: 'u3', due: -97, status: 'done' },
      { title: tx('Send the invoice, net 15', 'Mandar la factura, a 15 días'), who: 'u2', due: -97, status: 'done' },
    ],
    log: [{ date: -98, workerId: 'w5', text: tx('Unit is empty. Left the fridge and stove, they belong to the building. Key is back at the office.', 'La unidad quedó vacía. Dejamos el refri y la estufa porque son del edificio. La llave ya está en la oficina.') }],
  });

  k.job({
    id: 'j14', name: tx('Kitchen demo debris', 'Escombros de demolición de cocina'), clientId: 'c3', address: '77 Sample Ave, Egg Harbor City, NJ', type: 'debris', status: 'done', price: 980, start: -75, end: -75,
    scope: tx('One heavy load from a kitchen demo: cabinets, countertop, drywall and old flooring.', 'Una carga pesada de la demolición de una cocina: gabinetes, cubierta, drywall y piso viejo.'),
    payTerms: tx('Check on pickup or net 7.', 'Cheque al recoger o a 7 días.'),
    assign: [
      { workerId: 'w5', scope: tx('Driver', 'Chofer'), price: 200, payType: 'daily', rate: 200, qty: 1, status: 'done' },
      { workerId: 'w2', scope: tx('Mover', 'Mudancero'), price: 180, payType: 'daily', rate: 180, qty: 1, status: 'done' },
    ],
    expenses: [
      { date: -75, vendor: station, desc: tx('Dump fee, 1 load (2.9 tons)', 'Tarifa del vertedero, 1 carga (2.9 toneladas)'), amount: 265 },
      { date: -75, vendor: fuel, desc: truckFuel, amount: 35 },
    ],
    received: [{ date: -68, method: 'check', ref: '4417', amount: 980 }],
    workerPays: [
      { date: -74, workerId: 'w5', method: 'check', ref: '2019', amount: 200, payType: 'daily', from: -75, to: -75 },
      { date: -74, workerId: 'w2', method: 'check', ref: '2020', amount: 180, payType: 'daily', from: -75, to: -75 },
    ],
    tasks: [
      { title: tx('Confirm with Greg that the pile is ready', 'Confirmar con Greg que el montón ya está listo'), who: 'u1', due: -76, status: 'done' },
      { title: tx('Sweep the driveway for nails', 'Barrer la entrada por si quedaron clavos'), who: 'w2', due: -75, status: 'done' },
      { title: tx('Email the weight ticket with the invoice', 'Mandar el ticket de peso con la factura'), who: 'u3', due: -74, status: 'done' },
    ],
    log: [{ date: -75, workerId: 'w5', text: tx('One load, 2.9 tons with the countertop. Driveway swept, used the magnet for the nails.', 'Una carga, 2.9 toneladas con la cubierta. Entrada barrida, pasamos el imán por los clavos.') }],
  });

  /* ---------- leads ---------- */
  k.lead({ id: 'l1', name: 'Denise Moore', phone: '609-555-0151', email: 'denise@example.com', address: '6 Sample Ct, Egg Harbor Twp, NJ', type: 'cleanout', source: 'website', status: 'scheduled', pri: 'high', value: 2400, appt: [3, '09:00'], created: -2,
    notes: [[-2, 'note', tx('Estate cleanout of a 3-bedroom house. The family wants photos of anything valuable before we haul it.', 'Vaciado de una casa de 3 recámaras por herencia. La familia quiere fotos de todo lo de valor antes de llevárnoslo.')], [-1, 'call', tx('Walkthrough is set. Her brother will open the house, she joins by video call.', 'Ya quedó la visita. Su hermano abre la casa y ella se conecta por videollamada.')]] });
  k.lead({ id: 'l2', name: 'Marcos Silva', phone: '609-555-0152', address: '40 Sample Ave, Pleasantville, NJ', type: 'local', source: 'referral', status: 'new', value: 850, followUp: 0, created: -1,
    notes: [[-1, 'call', tx('2-bedroom apartment, 2nd floor, no elevator. Moving on the 1st of next month. Eddie gave him our number.', 'Apartamento de 2 recámaras, 2.º piso, sin elevador. Se muda el día 1 del mes que entra. Eddie le dio nuestro número.')]] });
  k.lead({ id: 'l3', name: 'Gloria Estévez', phone: '609-555-0153', email: 'gloria@example.com', address: '15 Sample St, Absecon, NJ', type: 'junk', source: 'facebook', status: 'new', owner: 'u3', created: 0,
    notes: [[0, 'text', tx('Message from the page: old sectional and 2 mattresses, already at the curb. Wants a price today.', 'Mensaje por la página: un seccional viejo y 2 colchones, ya están en la orilla de la calle. Quiere precio hoy.')]] });
  k.lead({ id: 'l4', name: 'Dr. Neil Shapiro', company: 'Sample Dental Office', phone: '609-555-0154', email: 'frontdesk@example.com', address: '9 Sample Plaza, Somers Point, NJ', type: 'local', source: 'google', status: 'sent', owner: 'u2', value: 3100, appt: [-6, '17:30'], followUp: 2, created: -11,
    notes: [[-11, 'call', tx('Office move, 4 operatories and the front desk, two blocks away. Has to happen on a weekend. The dental chairs are moved by their equipment company, not by us.', 'Mudanza de consultorio, 4 cubículos y la recepción, a dos cuadras. Tiene que ser en fin de semana. Los sillones dentales los mueve su proveedor de equipo, no nosotros.')], [-5, 'email', tx('Estimate sent for $3,100: Saturday load, Sunday setup, 4 movers.', 'Se mandó el estimado por $3,100: cargar el sábado, acomodar el domingo, 4 mudanceros.')]] });
  k.lead({ id: 'l5', name: 'Tom Brennan', phone: '609-555-0155', address: '71 Sample Rd, Mays Landing, NJ', type: 'heavy', source: 'phone', status: 'contacted', value: 480, followUp: -2, created: -7,
    notes: [[-7, 'call', tx('Gun safe, about 800 lb, from the basement to the garage. 12 steps with a turn. Needs the piano crew.', 'Caja fuerte de unas 800 libras, del sótano al garaje. 12 escalones con vuelta. Necesita a la cuadrilla de pianos.')], [-4, 'call', tx('Left a voicemail with the price range. He said he would call back after talking to his wife.', 'Le dejé mensaje de voz con el rango de precio. Dijo que llamaba después de hablar con su esposa.')]] });
  k.lead({ id: 'l6', name: 'Yolanda Pérez', phone: '609-555-0156', email: 'yolanda@example.com', address: '220 Sample Blvd, Atlantic City, NJ', type: 'cleanout', source: 'referral', status: 'scheduled', pri: 'high', value: 1900, appt: [0, '15:30'], created: -3,
    notes: [[-3, 'call', tx('Her mother is moving to assisted living. 1-bedroom apartment on the 6th floor, needs to be empty by the end of the month. Prefers Spanish.', 'Su mamá se va a una residencia. Apartamento de 1 recámara en el 6.º piso, tiene que quedar vacío antes de fin de mes. Prefiere español.')]] });
  k.lead({ id: 'l7', name: 'Carla Mendes', company: 'Sample Fitness Studio', phone: '609-555-0157', email: 'carla@example.com', address: '33 Sample Ave, Northfield, NJ', type: 'junk', source: 'instagram', status: 'scheduled', owner: 'u2', value: 1400, appt: [1, '10:00'], created: -4,
    notes: [[-4, 'text', tx('Replacing equipment: 6 treadmills, 2 ellipticals and rubber flooring to remove. Loading door in the back.', 'Van a cambiar el equipo: hay que sacar 6 caminadoras, 2 elípticas y el piso de hule. Puerta de carga atrás.')]] });
  k.lead({ id: 'l8', name: 'Harold Greene', phone: '609-555-0158', email: 'harold@example.com', address: '5 Sample Ln, Linwood, NJ', type: 'junk', source: 'website', status: 'contacted', followUp: 1, created: -5,
    notes: [[-5, 'note', tx('Web form: take down a metal shed and haul it with what is inside. Asked for photos before we quote.', 'Formulario web: desarmar un cobertizo de metal y llevárselo con lo que tiene adentro. Le pedimos fotos antes de cotizar.')], [-2, 'email', tx('Photos received. Shed is 10x12, half full of lawn equipment. One load.', 'Llegaron las fotos. El cobertizo es de 10x12, medio lleno de equipo de jardín. Una carga.')]] });
  k.lead({ id: 'l9', name: 'Mike Dolan', company: 'Sample Roofing Co.', phone: '609-555-0159', email: 'mike.dolan@example.com', address: '88 Sample Pike, Egg Harbor Twp, NJ', type: 'debris', source: 'other', status: 'sent', value: 1800, appt: [-8, '07:30'], followUp: 4, created: -9,
    notes: [[-9, 'visit', tx('Met him at the supply yard. Wants shingle tear-off hauled from small jobs where a dumpster does not fit. About 3 loads a month.', 'Lo conocí en el patio de materiales. Quiere que le saquemos las tejas viejas en trabajos chicos donde no cabe un contenedor. Como 3 cargas al mes.')], [-6, 'email', tx('Sent pricing per load with the weight limit and the extra per ton.', 'Se mandó el precio por carga con el límite de peso y el extra por tonelada.')]] });
  k.lead({ id: 'l10', name: 'Jasmine Wright', phone: '609-555-0160', email: 'jasmine@example.com', address: '19 Sample Dr, Galloway, NJ', type: 'packing', source: 'instagram', status: 'new', followUp: 1, owner: 'u3', created: 0,
    notes: [[0, 'text', tx('Needs packing help only, 1-bedroom, she already has a truck. Asked if we sell boxes.', 'Solo necesita ayuda para empacar, 1 recámara, ya tiene camión. Preguntó si vendemos cajas.')]] });
  k.lead({ id: 'l11', name: 'Luis Carrasco', phone: '609-555-0109', email: 'luis.carrasco@example.com', address: '64 Sample Dr, Hammonton, NJ', type: 'longdist', source: 'google', status: 'won', pri: 'high', value: 5800, created: -15, clientId: 'c9', jobId: 'j9',
    notes: [[-15, 'call', tx('Moving to Raleigh, NC for work. 3-bedroom house. Wants one crew from start to finish, no transfers.', 'Se muda a Raleigh, NC por trabajo. Casa de 3 recámaras. Quiere la misma cuadrilla de principio a fin, sin transbordos.')], [-10, 'visit', tx('Walkthrough done. Quoted $5,800 with a one-way truck. He accepted on the spot.', 'Visita hecha. Cotizamos $5,800 con camión de un solo sentido. Aceptó ahí mismo.')]] });
  k.lead({ id: 'l12', name: 'Ingrid Sorensen', phone: '609-555-0108', email: 'ingrid@example.com', address: '55 Sample Ave, Ventnor, NJ', type: 'local', source: 'referral', status: 'won', value: 2350, created: -13, clientId: 'c8', jobId: 'j8',
    notes: [[-13, 'call', tx('Downsizing to a condo in Somers Point. Wants us to pack the kitchen and the china. Referred by Renee Allen.', 'Se cambia a un condominio más chico en Somers Point. Quiere que empaquemos la cocina y la vajilla. La recomendó Renee Allen.')]] });
  k.lead({ id: 'l13', name: 'Ahmed Farouk', company: 'Sample Self Storage', phone: '609-555-0107', email: 'ahmed@example.com', address: '300 Sample Pike, Egg Harbor Twp, NJ', type: 'cleanout', source: 'phone', status: 'won', owner: 'u2', value: 1650, created: -21, clientId: 'c7', jobId: 'j7',
    notes: [[-21, 'call', tx('3 units to empty after the auction. If it goes well they have this every couple of months.', '3 bodegas por vaciar después de la subasta. Si sale bien, tienen esto cada par de meses.')]] });
  k.lead({ id: 'l14', name: 'Peter Vance', phone: '609-555-0161', email: 'peter@example.com', address: '2 Sample Way, Ocean City, NJ', type: 'longdist', source: 'website', status: 'lost', value: 4200, created: -30,
    notes: [[-30, 'note', tx('Web form: 2-bedroom move to Florida, flexible on dates.', 'Formulario web: mudanza de 2 recámaras a Florida, flexible con las fechas.')], [-24, 'call', tx('Went with a national van line.', 'Se fue con una compañía nacional de mudanzas.')]],
    lostReason: tx('Went with a national van line. He wanted a guaranteed delivery date that we could not promise.', 'Se fue con una compañía nacional. Quería una fecha de entrega garantizada que no podíamos prometer.') });
  k.lead({ id: 'l15', name: 'Carmen Ortiz', phone: '609-555-0162', address: '47 Sample St, Hammonton, NJ', type: 'junk', source: 'facebook', status: 'lost', owner: 'u3', value: 280, created: -38,
    notes: [[-38, 'text', tx('Old washer, dryer and a recliner. Asked for the price for a quarter load.', 'Lavadora y secadora viejas y un sillón reclinable. Preguntó el precio de un cuarto de carga.')]],
    lostReason: tx('A neighbor with a pickup took it for free.', 'Un vecino con camioneta se lo llevó gratis.') });

  /* ---------- office tasks ---------- */
  k.task({ title: tx('Renew the commercial auto and cargo insurance', 'Renovar el seguro comercial de auto y de carga'), who: 'u1', due: 12, pri: 'high' });
  k.task({ title: tx('Box truck: oil change and brake check', 'Camión de caja: cambio de aceite y revisión de frenos'), who: 'u2', due: -1, status: 'doing' });
  k.task({ title: tx('Order moving blankets, shrink wrap and mattress bags', 'Pedir cobijas de mudanza, plástico para envolver y bolsas para colchón'), who: 'u3', due: 0 });
  k.task({ title: tx('Call Tom Brennan back with the price for the safe', 'Llamar a Tom Brennan con el precio de la caja fuerte'), who: 'u1', due: -2, pri: 'high', leadId: 'l5' });
  k.task({ title: tx('Get a new insurance certificate from Sample Piano Movers', 'Pedirle un certificado de seguro nuevo a Sample Piano Movers'), who: 'u3', due: -1, status: 'waiting' });
  k.task({ title: tx('Truck 2: state inspection sticker', 'Camión 2: calcomanía de inspección estatal'), who: 'u2', due: 6 });
  k.task({ title: tx('Safety talk with the crew: lifting, straps and ramps', 'Plática de seguridad con la cuadrilla: cómo cargar, correas y rampas'), who: 'u2', due: 9, pri: 'low' });
  k.task({ title: tx('Match the transfer station statement against the dump tickets', 'Cuadrar el estado de cuenta de la estación de transferencia con los tickets'), who: 'u3', due: 5, status: 'review' });

  return k.finish();
}
