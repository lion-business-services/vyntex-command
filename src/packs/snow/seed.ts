import type { Lang, SeedData } from '@/domain/types';
import { seedKit } from '../seedkit';

/** Sample business for this edition. Fictional data only. */
export function seed(lang: Lang): SeedData {
  const k = seedKit(lang, 'VS-');
  const { tx } = k;

  // wording that repeats
  const saltSupplier = tx('Salt supplier', 'Proveedor de sal');
  const fuel = tx('Fuel', 'Gasolina');
  const sidewalkCrew = tx('Sidewalk crew', 'Cuadrilla de aceras');
  const insurer = 'Sample Mutual Insurance';
  const pay = (n: number, of: number) => tx(`Payment ${n} of ${of}`, `Pago ${n} de ${of}`);

  /* ---------- crew ---------- */
  k.worker({ id: 'w1', name: 'Rick Donovan', trade: tx('Plow driver, own truck', 'Operador de quitanieves, camión propio'), phone: '609-555-0141', email: 'rick@example.com', payType: 'hourly', rate: 85, w9: 400, coi: 200, insurer });
  k.worker({ id: 'w2', name: 'Luis Mejía', trade: tx('Sidewalk crew lead', 'Encargado de la cuadrilla de aceras'), phone: '609-555-0142', email: 'luis@example.com', payType: 'hourly', rate: 25 });
  k.worker({ id: 'w3', name: 'Sample Salt Supply LLC', trade: tx('Salting, spreader truck', 'Sal, camión esparcidor'), phone: '609-555-0143', email: 'salt@example.com', payType: 'project', w9: 380, coi: -10, insurer });
  k.worker({ id: 'w4', name: 'Dwayne Carter', trade: tx('Loader operator', 'Operador de cargador'), phone: '609-555-0144', email: 'dwayne@example.com', payType: 'hourly', rate: 45, w9: 150, coi: 21, insurer });
  k.worker({ id: 'w5', name: 'Marta Quintero', trade: sidewalkCrew, phone: '609-555-0145', email: 'marta@example.com', payType: 'hourly', rate: 22, w9: 100 });
  k.worker({ id: 'w6', name: 'Brian Kowalski', trade: tx('Plow driver, company truck', 'Operador de quitanieves, camión de la compañía'), phone: '609-555-0146', email: 'brian@example.com', payType: 'hourly', rate: 32, w9: 250 });
  k.worker({ id: 'w7', name: 'Tyrone Bell', trade: sidewalkCrew, phone: '609-555-0147', email: 'tyrone@example.com', payType: 'hourly', rate: 22, w9: 80 });
  k.worker({ id: 'w8', name: 'Óscar Pineda', trade: tx('Plow driver, own truck', 'Operador de quitanieves, camión propio'), phone: '609-555-0148', email: 'oscar@example.com', payType: 'hourly', rate: 80, w9: 300, coi: 60, insurer, active: false });

  /* ---------- clients ---------- */
  k.client({ id: 'c1', name: 'Deborah Lin', company: 'Harbor Medical Center', phone: '609-555-0101', email: 'deborah@example.com', addresses: ['200 Sample Plaza, Somers Point, NJ'], since: -100,
    note: tx('Facilities manager. The ambulance lane must be clear at all times. Wants a storm log with every invoice.', 'Gerente de mantenimiento. El carril de ambulancias tiene que estar libre siempre. Quiere el registro de la tormenta con cada factura.') });
  k.client({ id: 'c2', name: 'Gary Whitfield', company: 'Pine Ridge HOA', phone: '609-555-0102', email: 'gary@example.com', addresses: ['1 Sample Dr, Galloway, NJ'], since: -95,
    note: tx('Board president. Billed per storm. Storm reports go to him and he forwards them to the board.', 'Presidente de la mesa directiva. Se le cobra por tormenta. Los reportes se le mandan a él y él los pasa a la mesa.') });
  k.client({ id: 'c3', name: 'Nina Patel', company: 'Sample Retail Plaza', phone: '609-555-0103', email: 'nina@example.com', addresses: ['450 Sample Ave, Northfield, NJ'], since: -90 });
  k.client({ id: 'c4', name: 'Karen Doyle', company: 'Sample Community Bank', phone: '609-555-0104', email: 'karen@example.com', addresses: ['12 Sample St, Linwood, NJ', '90 Sample Rd, Egg Harbor Twp, NJ'], since: -85 });
  k.client({ id: 'c5', name: 'Edith Larsen', phone: '609-555-0105', email: 'edith@example.com', addresses: ['7 Sample Ln, Linwood, NJ'], since: -80,
    note: tx('Lives alone. Driveway and front walk have to be clear by 7 am so her aide can get in.', 'Vive sola. La entrada y el caminito del frente tienen que estar limpios a las 7 am para que pueda entrar su cuidadora.') });
  k.client({ id: 'c6', name: 'Victor Ramos', company: 'Sample Logistics Warehouse', phone: '609-555-0106', email: 'victor@example.com', addresses: ['600 Sample Pike, Egg Harbor Twp, NJ'], since: -40 });
  k.client({ id: 'c7', name: 'Dr. Alan Brooks', company: 'Sample Dental Group', phone: '609-555-0107', email: 'office.dental@example.com', addresses: ['25 Sample Blvd, Absecon, NJ'], since: -24 });
  k.client({ id: 'c8', name: 'George Antonelli', phone: '609-555-0108', email: 'george@example.com', addresses: ['16 Sample Ct, Margate, NJ'], since: -30, emailOptOut: true,
    note: tx('Call him, he does not read email. No automatic emails.', 'Hay que llamarlo, no lee el correo. Nada de correos automáticos.') });
  k.client({ id: 'c9', name: 'Latoya Green', company: 'Sample Daycare Center', phone: '609-555-0109', email: 'latoya@example.com', addresses: ['34 Sample Way, Mays Landing, NJ'], since: -8 });
  k.client({ id: 'c10', name: 'Rachel Stein', company: 'Sample Property Management', phone: '609-555-0110', email: 'rachel@example.com', addresses: ['101 Sample Ave, Ventnor, NJ', '115 Sample Ave, Ventnor, NJ', '9 Sample Ter, Ventnor, NJ', '22 Sample Ter, Ventnor, NJ'], since: -75,
    note: tx('Manages 4 apartment buildings in Ventnor. We service 3 of them. Wants photos of the city sidewalk after every storm.', 'Administra 4 edificios de apartamentos en Ventnor. Atendemos 3. Quiere fotos de la acera de la ciudad después de cada tormenta.') });
  k.client({ id: 'c11', name: 'Hank Morrison', company: 'Sample Motors', phone: '609-555-0111', email: 'hank@example.com', addresses: ['800 Sample Pike, Egg Harbor Twp, NJ'], since: -40 });

  /* ---------- jobs ---------- */
  k.job({
    id: 'j1', name: tx('Seasonal lot contract', 'Contrato de temporada, estacionamiento'), clientId: 'c1', type: 'season', status: 'progress', price: 12500, start: -75, end: 45,
    scope: tx('Plow and salt the main lot and the ambulance lane at 2 inches. Sidewalks and entrances shoveled and salted by 6 am. Piles go in the back corner of the lot, never by the entrance.', 'Pasar la pala y echar sal en el estacionamiento principal y el carril de ambulancias a partir de 2 pulgadas. Aceras y entradas limpias y con sal antes de las 6 am. Los montones van en la esquina de atrás, nunca junto a la entrada.'),
    payTerms: tx('5 monthly payments of $2,500. Salt is included, up to 12 applications.', '5 pagos mensuales de $2,500. La sal va incluida, hasta 12 aplicaciones.'),
    assign: [
      { workerId: 'w1', scope: tx('Plowing, main lot and ambulance lane', 'Pala, estacionamiento principal y carril de ambulancias'), price: 3060, payType: 'hourly', rate: 85, qty: 36, status: 'progress' },
      { workerId: 'w2', scope: tx('Sidewalks and entrances', 'Aceras y entradas'), price: 1500, payType: 'hourly', rate: 25, qty: 60, status: 'progress' },
      { workerId: 'w3', scope: tx('Salting, 10 applications', 'Sal, 10 aplicaciones'), price: 2400, payType: 'project', rate: 240, qty: 10, status: 'progress' },
    ],
    expenses: [
      { date: -78, vendor: tx('Supply store', 'Tienda de suministros'), desc: tx('Marker stakes and reflective tape', 'Estacas y cinta reflejante'), amount: 85 },
      { date: -76, vendor: saltSupplier, desc: tx('Bulk rock salt, 14 tons', 'Sal en grano a granel, 14 toneladas'), amount: 1330 },
      { date: -30, vendor: saltSupplier, desc: tx('Ice melt for sidewalks, 20 bags', 'Derretidor de hielo para aceras, 20 sacos'), amount: 310 },
    ],
    received: [
      { date: -75, method: 'check', ref: pay(1, 5), amount: 2500 },
      { date: -45, method: 'check', ref: pay(2, 5), amount: 2500 },
      { date: -15, method: 'check', ref: pay(3, 5), amount: 2500 },
    ],
    workerPays: [
      { date: -52, workerId: 'w1', method: 'check', ref: '3102', amount: 1360, payType: 'hourly', from: -75, to: -53 },
      { date: -22, workerId: 'w1', method: 'check', ref: '3118', amount: 765, payType: 'hourly', from: -52, to: -23 },
      { date: -52, workerId: 'w2', method: 'zelle', amount: 500, payType: 'hourly', from: -75, to: -53 },
      { date: -22, workerId: 'w2', method: 'cash', amount: 375, payType: 'hourly', from: -52, to: -23 },
      { date: -40, workerId: 'w3', method: 'check', ref: '3109', amount: 1440, payType: 'project', from: -75, to: -41 },
      { date: -8, workerId: 'w3', method: 'check', ref: '3126', amount: 240, payType: 'project', from: -9, to: -9 },
    ],
    tasks: [
      { title: tx('Stake the lot and mark the drains', 'Poner estacas en el estacionamiento y marcar los drenajes'), who: 'w2', due: -77, status: 'done' },
      { title: tx('Storm: plow twice and salt, 5 in', 'Tormenta: dos pasadas de pala y sal, 5 pulgadas'), who: 'w1', due: -23, status: 'done', pri: 'high' },
      { title: tx('De-icing run before the freeze', 'Aplicación de sal antes de la helada'), who: 'w3', due: -9, status: 'done' },
      { title: tx('Put back the 3 stakes knocked down by the loading dock', 'Volver a poner las 3 estacas que tumbaron junto al andén de carga'), who: 'w2', due: -2 },
      { title: tx('Send Deborah the storm log', 'Mandarle a Deborah el registro de la tormenta'), who: 'u3', due: 0, status: 'doing' },
      { title: tx('Salt count: 7 of 12 applications used', 'Conteo de sal: van 7 de 12 aplicaciones'), who: 'u1', due: 2, status: 'review' },
      { title: tx('Invoice payment 4 of 5 with the storm log', 'Facturar el pago 4 de 5 con el registro de tormenta'), who: 'u2', due: 13 },
    ],
    log: [
      { date: -23, workerId: 'w1', text: tx('Plowed at 3 am and again at 6. The ambulance lane stayed open the whole storm. Piles are in the back corner.', 'Pasé la pala a las 3 am y otra vez a las 6. El carril de ambulancias estuvo libre toda la tormenta. Los montones quedaron en la esquina de atrás.') },
      { date: -9, workerId: 'w2', text: tx('All entrances and the ramp salted by 5:30 am. The mat at the north door was frozen to the ground, told security.', 'Todas las entradas y la rampa con sal a las 5:30 am. El tapete de la puerta norte estaba pegado al piso por el hielo, le avisé a seguridad.') },
    ],
    notes: [
      [-78, 'call', tx('The ambulance lane must be clear at all times. Piles go in the back corner, never by the entrance.', 'El carril de ambulancias tiene que estar libre todo el tiempo. Los montones van en la esquina de atrás, nunca junto a la entrada.')],
      [-22, 'email', tx('Deborah wants the storm log with each invoice: time in, time out, inches and salt used.', 'Deborah quiere el registro de la tormenta con cada factura: hora de entrada, hora de salida, pulgadas y sal usada.')],
    ],
  });

  k.job({
    id: 'j2', name: tx('Community roads, renewal for next season', 'Calles de la comunidad, renovación para la próxima temporada'), clientId: 'c2', type: 'hoa', status: 'contract', price: 8400,
    scope: tx('Plow the community roads and cul-de-sacs at 3 inches. Salt the intersections and the hill at the entrance. Same terms as this season, plus the new cul-de-sac.', 'Pasar la pala en las calles y cerradas de la comunidad a partir de 3 pulgadas. Sal en los cruces y en la subida de la entrada. Mismos términos de esta temporada, más la cerrada nueva.'),
    payTerms: tx('Billed per storm at $700, season cap $8,400.', 'Se cobra $700 por tormenta, con tope de $8,400 por temporada.'),
    tasks: [
      { title: tx('Send Gary the updated map with the new cul-de-sac', 'Mandarle a Gary el mapa actualizado con la cerrada nueva'), who: 'u3', due: -2, status: 'done' },
      { title: tx('Renewal: the board votes at its next meeting', 'Renovación: la mesa directiva vota en su próxima junta'), who: 'u1', due: 6, status: 'waiting' },
      { title: tx('Walk the new cul-de-sac and pick the spot for the piles', 'Recorrer la cerrada nueva y escoger dónde van los montones'), who: 'w1', due: 9 },
    ],
    notes: [[-4, 'call', tx('Gary says the board is happy with the service. They vote at the next meeting and he wants the same price per storm.', 'Dice Gary que la mesa está contenta con el servicio. Votan en la próxima junta y quiere el mismo precio por tormenta.')]],
  });

  k.job({
    id: 'j3', name: tx('Seasonal contract, retail plaza', 'Contrato de temporada, plaza comercial'), clientId: 'c3', type: 'lot', status: 'progress', price: 6800, start: -75, end: 45, manager: 'u2',
    scope: tx('Plow the plaza lot and the delivery lane behind the stores at 2 inches. Shovel and salt the storefront sidewalk before the stores open at 9. No piles at the pharmacy drive-through or on the corner island.', 'Pasar la pala en el estacionamiento de la plaza y en el carril de entregas detrás de las tiendas a partir de 2 pulgadas. Acera del frente limpia y con sal antes de que abran a las 9. Nada de montones en el carril de autoservicio de la farmacia ni en la isleta de la esquina.'),
    payTerms: tx('4 payments of $1,700, due at the start of each month.', '4 pagos de $1,700, al inicio de cada mes.'),
    assign: [
      { workerId: 'w6', scope: tx('Plowing with the company truck', 'Pala con el camión de la compañía'), price: 1536, payType: 'hourly', rate: 32, qty: 48, status: 'progress' },
      { workerId: 'w5', scope: tx('Storefront sidewalk', 'Acera del frente de las tiendas'), price: 968, payType: 'hourly', rate: 22, qty: 44, status: 'progress' },
      { workerId: 'w3', scope: tx('Salting, 6 applications', 'Sal, 6 aplicaciones'), price: 900, payType: 'project', rate: 150, qty: 6, status: 'progress' },
    ],
    expenses: [
      { date: -74, vendor: saltSupplier, desc: tx('Bulk rock salt, 6 tons', 'Sal en grano a granel, 6 toneladas'), amount: 570 },
      { date: -60, vendor: tx('Truck shop', 'Taller de camiones'), desc: tx('New cutting edge for the plow', 'Cuchilla nueva para la pala'), amount: 240 },
      { date: -40, vendor: fuel, desc: tx('Diesel, company truck', 'Diésel, camión de la compañía'), amount: 180 },
      { date: -21, vendor: fuel, desc: tx('Diesel, company truck', 'Diésel, camión de la compañía'), amount: 130 },
    ],
    received: [
      { date: -74, method: 'transfer', ref: pay(1, 4), amount: 1700 },
      { date: -44, method: 'transfer', ref: pay(2, 4), amount: 1700 },
    ],
    workerPays: [
      { date: -50, workerId: 'w6', method: 'check', ref: '3104', amount: 640, payType: 'hourly', from: -75, to: -51 },
      { date: -20, workerId: 'w6', method: 'check', ref: '3121', amount: 320, payType: 'hourly', from: -50, to: -21 },
      { date: -50, workerId: 'w5', method: 'zelle', amount: 396, payType: 'hourly', from: -75, to: -51 },
      { date: -20, workerId: 'w5', method: 'zelle', amount: 264, payType: 'hourly', from: -50, to: -21 },
      { date: -38, workerId: 'w3', method: 'check', ref: '3111', amount: 450, payType: 'project', from: -75, to: -39 },
    ],
    tasks: [
      { title: tx('Storm: plow and salt, 5 in', 'Tormenta: pala y sal, 5 pulgadas'), who: 'w6', due: -23, status: 'done', pri: 'high' },
      { title: tx('Payment 3 is late: call Nina', 'El pago 3 está atrasado: llamar a Nina'), who: 'u2', due: -3, pri: 'high' },
      { title: tx('Extra salt at the downspout by the nail salon', 'Sal extra en la bajada de agua junto al salón de uñas'), who: 'w5', due: 1 },
      { title: tx('End of season: repair the sod at the corner island', 'Fin de temporada: reparar el pasto de la isleta de la esquina'), who: 'u2', due: 40, status: 'waiting', pri: 'low' },
    ],
    log: [
      { date: -23, workerId: 'w6', text: tx('Lot done by 7:40. Two trailers were parked in the delivery lane, plowed around them and came back at 10.', 'Estacionamiento listo a las 7:40. Había dos tráileres en el carril de entregas, limpié alrededor y regresé a las 10.') },
      { date: -22, workerId: 'w5', text: tx('Salted the sidewalk twice. The downspout by the nail salon makes ice every night, it needs extra salt.', 'Eché sal dos veces en la acera. La bajada de agua junto al salón de uñas hace hielo cada noche, necesita más sal.') },
    ],
    notes: [[-76, 'visit', tx('Stores open at 9, sidewalk goes first. Never pile snow at the pharmacy drive-through or on the corner island.', 'Las tiendas abren a las 9, primero va la acera. Nunca amontonar nieve en el autoservicio de la farmacia ni en la isleta de la esquina.')]],
  });

  k.job({
    id: 'j4', name: tx('Seasonal contract, 2 bank branches', 'Contrato de temporada, 2 sucursales de banco'), clientId: 'c4', type: 'lot', status: 'progress', price: 9600, start: -70, end: 45,
    scope: tx('Both branches: plow the lot and the drive-through lanes at 1.5 inches, shovel and salt the walks and the ATM area before 7:30 am. Ice checks on freezing mornings.', 'Las dos sucursales: pasar la pala en el estacionamiento y los carriles de autoservicio a partir de 1.5 pulgadas, limpiar y echar sal en las aceras y el área del cajero antes de las 7:30 am. Revisión de hielo las mañanas de helada.'),
    payTerms: tx('4 payments of $2,400.', '4 pagos de $2,400.'),
    assign: [
      { workerId: 'w1', scope: tx('Plowing, both branches', 'Pala, las dos sucursales'), price: 2380, payType: 'hourly', rate: 85, qty: 28, status: 'progress' },
      { workerId: 'w7', scope: tx('Walks and ATM areas', 'Aceras y áreas de cajeros'), price: 1056, payType: 'hourly', rate: 22, qty: 48, status: 'progress' },
      { workerId: 'w3', scope: tx('Salting, 8 applications at both lots', 'Sal, 8 aplicaciones en los dos estacionamientos'), price: 1440, payType: 'project', rate: 180, qty: 8, status: 'progress' },
    ],
    expenses: [{ date: -68, vendor: saltSupplier, desc: tx('Ice melt for walks, 30 bags', 'Derretidor de hielo para aceras, 30 sacos'), amount: 465 }],
    received: [
      { date: -70, method: 'check', ref: pay(1, 4), amount: 2400 },
      { date: -40, method: 'check', ref: pay(2, 4), amount: 2400 },
      { date: -10, method: 'check', ref: pay(3, 4), amount: 2400 },
    ],
    workerPays: [
      { date: -50, workerId: 'w1', method: 'check', ref: '3103', amount: 1020, payType: 'hourly', from: -70, to: -51 },
      { date: -20, workerId: 'w1', method: 'check', ref: '3119', amount: 680, payType: 'hourly', from: -50, to: -21 },
      { date: -50, workerId: 'w7', method: 'zelle', amount: 440, payType: 'hourly', from: -70, to: -51 },
      { date: -20, workerId: 'w7', method: 'zelle', amount: 220, payType: 'hourly', from: -50, to: -21 },
      { date: -38, workerId: 'w3', method: 'check', ref: '3112', amount: 900, payType: 'project', from: -70, to: -39 },
    ],
    tasks: [
      { title: tx('Storm: plow both lots, 5 in', 'Tormenta: pala en los dos estacionamientos, 5 pulgadas'), who: 'w1', due: -23, status: 'done', pri: 'high' },
      { title: tx('Ice check at both ATMs', 'Revisión de hielo en los dos cajeros'), who: 'w7', due: -9, status: 'done' },
      { title: tx('Stake the new speed bump at the Egg Harbor Twp branch', 'Marcar con estacas el tope nuevo de la sucursal de Egg Harbor Twp'), who: 'w7', due: 0, status: 'doing' },
      { title: tx('Ice check at both branches before opening', 'Revisión de hielo en las dos sucursales antes de abrir'), who: 'w7', due: 1 },
      { title: tx('Send Karen the service log for the month', 'Mandarle a Karen el registro de servicio del mes'), who: 'u3', due: 3 },
    ],
    log: [
      { date: -23, workerId: 'w1', text: tx('Linwood branch first at 4 am, Egg Harbor Twp by 5:30. The drive-through lanes are tight, used the back blade.', 'Primero la sucursal de Linwood a las 4 am, la de Egg Harbor Twp a las 5:30. Los carriles de autoservicio están angostos, usé la pala trasera.') },
      { date: -9, workerId: 'w7', text: tx('ATM pads salted at both branches. No refreeze by 9 am.', 'Sal en el área de cajeros de las dos sucursales. A las 9 am no se había vuelto a congelar.') },
    ],
    notes: [[-71, 'call', tx('Karen: both branches open at 8:30. The ATM areas are the priority, people use them all night.', 'Karen: las dos sucursales abren a las 8:30. La prioridad son los cajeros, la gente los usa toda la noche.')]],
  });

  k.job({
    id: 'j5', name: tx('Driveway and front walk, season price', 'Entrada y caminito del frente, precio de temporada'), clientId: 'c5', type: 'season', status: 'progress', price: 650, start: -72, end: 45, manager: 'u3',
    scope: tx('Driveway and front walk cleared at 2 inches for the whole season, by 7 am. Salt on the front steps.', 'Entrada y caminito del frente limpios a partir de 2 pulgadas toda la temporada, antes de las 7 am. Sal en los escalones del frente.'),
    payTerms: tx('$650 for the season, paid up front.', '$650 por la temporada, pagados por adelantado.'),
    assign: [
      { workerId: 'w6', scope: tx('Driveway with the truck', 'Entrada con el camión'), price: 192, payType: 'hourly', rate: 32, qty: 6, status: 'progress' },
      { workerId: 'w5', scope: tx('Front walk and steps', 'Caminito y escalones del frente'), price: 110, payType: 'hourly', rate: 22, qty: 5, status: 'progress' },
    ],
    expenses: [{ date: -70, vendor: saltSupplier, desc: tx('Pet-safe ice melt, 2 bags', 'Derretidor de hielo seguro para mascotas, 2 sacos'), amount: 38 }],
    received: [{ date: -73, method: 'check', ref: tx('Season paid', 'Temporada pagada'), amount: 650 }],
    workerPays: [
      { date: -20, workerId: 'w6', method: 'check', ref: '3122', amount: 96, payType: 'hourly', from: -72, to: -21 },
      { date: -22, workerId: 'w5', method: 'zelle', amount: 44, payType: 'hourly', from: -72, to: -23 },
    ],
    tasks: [
      { title: tx('Storm: driveway and walk by 7 am', 'Tormenta: entrada y caminito antes de las 7 am'), who: 'w6', due: -23, status: 'done', pri: 'high' },
      { title: tx('Call Edith after the storm to check she can get out', 'Llamar a Edith después de la tormenta para ver que pueda salir'), who: 'u3', due: -23, status: 'done' },
      { title: tx('Offer the renewal for next season', 'Ofrecerle la renovación para la próxima temporada'), who: 'u3', due: 10, pri: 'low' },
    ],
    log: [{ date: -23, workerId: 'w5', text: tx('Walk and steps done at 6:15. Left the newspaper on the porch like she asked.', 'Caminito y escalones listos a las 6:15. Le dejé el periódico en el porche como pidió.') }],
  });

  k.job({
    id: 'j6', name: tx('De-icing run, loading docks and truck court', 'Aplicación de sal, andenes de carga y patio de camiones'), clientId: 'c6', type: 'salt', status: 'done', price: 480, start: -9, end: -9, manager: 'u2',
    scope: tx('Salt the truck court, the 12 dock aprons and the employee lot before the 5 am shift.', 'Echar sal en el patio de camiones, los 12 andenes y el estacionamiento de empleados antes del turno de las 5 am.'),
    payTerms: tx('Per application, net 15.', 'Por aplicación, a 15 días.'),
    assign: [{ workerId: 'w3', scope: tx('Spreader truck, 1 application', 'Camión esparcidor, 1 aplicación'), price: 190, status: 'done' }],
    expenses: [{ date: -9, vendor: saltSupplier, desc: tx('Rock salt, 1.5 tons', 'Sal en grano, 1.5 toneladas'), amount: 145 }],
    received: [{ date: -1, method: 'transfer', ref: tx('Paid in full', 'Pagado completo'), amount: 480 }],
    workerPays: [{ date: -4, workerId: 'w3', method: 'check', ref: '3127', amount: 190, payType: 'project' }],
    tasks: [
      { title: tx('Confirm the gate code with the night supervisor', 'Confirmar el código del portón con el supervisor de noche'), who: 'u2', due: -10, status: 'done' },
      { title: tx('Salt everything before the 5 am shift', 'Echar sal en todo antes del turno de las 5 am'), who: 'w3', due: -9, status: 'done', pri: 'high' },
      { title: tx('Send the invoice with the time-stamped photos', 'Mandar la factura con las fotos con hora'), who: 'u3', due: -8, status: 'done' },
      { title: tx('Price per application for the rest of the season, for Victor', 'Precio por aplicación para el resto de la temporada, para Victor'), who: 'u2', due: 1, status: 'review' },
    ],
    log: [{ date: -9, workerId: 'w3', text: tx('On site at 3:50 am, out at 4:35. All 12 dock aprons and the truck court are done. Photos sent.', 'Llegamos 3:50 am, salimos 4:35. Los 12 andenes y el patio de camiones quedaron listos. Fotos enviadas.') }],
    notes: [[-10, 'call', tx('Victor called the afternoon before the freeze. A truck slid at dock 7 the last time. Gate code comes from the night supervisor.', 'Victor llamó la tarde antes de la helada. La vez pasada un camión se patinó en el andén 7. El código del portón lo da el supervisor de noche.')]],
  });

  k.job({
    id: 'j7', name: tx('Driveway push after the storm', 'Limpieza de entrada después de la tormenta'), clientId: 'c8', type: 'push', status: 'done', price: 95, start: -23, end: -23, manager: 'u3',
    scope: tx('One push: driveway and the walk to the side door. 5 inches.', 'Una limpieza: la entrada y el caminito a la puerta de al lado. 5 pulgadas.'),
    payTerms: tx('$95 per push, paid when done.', '$95 por limpieza, se paga al terminar.'),
    assign: [{ workerId: 'w5', scope: tx('Shovel and blower', 'Pala y sopladora'), price: 33, payType: 'hourly', rate: 22, qty: 1.5, status: 'done' }],
    received: [{ date: -23, method: 'cash', ref: tx('Paid in full', 'Pagado completo'), amount: 95 }],
    workerPays: [{ date: -22, workerId: 'w5', method: 'cash', amount: 33, payType: 'hourly', from: -23, to: -23 }],
    tasks: [
      { title: tx('Driveway and side door walk', 'Entrada y caminito de la puerta de al lado'), who: 'w5', due: -23, status: 'done' },
      { title: tx('Call George when it is done, no email', 'Llamar a George cuando esté listo, sin correo'), who: 'u3', due: -23, status: 'done' },
      { title: tx('Ask George if he wants the season price', 'Preguntarle a George si quiere el precio de temporada'), who: 'u3', due: -20, status: 'done', pri: 'low' },
    ],
    log: [{ date: -23, workerId: 'w5', text: tx('Done at 8:10. He paid cash at the door. The side gate sticks, lift it to open.', 'Listo a las 8:10. Pagó en efectivo en la puerta. El portón de al lado se atora, hay que levantarlo para abrir.') }],
  });

  k.job({
    id: 'j8', name: tx('Storm service: 2 pushes and salt', 'Servicio de tormenta: 2 limpiezas y sal'), clientId: 'c7', type: 'push', status: 'done', price: 780, start: -23, end: -22, manager: 'u2', leadId: 'l12',
    scope: tx('Parking lot and patient walkway. Push at 5 am and again at 11 am, salt after each push. 5 inches total.', 'Estacionamiento y pasillo de pacientes. Limpieza a las 5 am y otra a las 11 am, sal después de cada una. 5 pulgadas en total.'),
    payTerms: tx('$290 per push, $100 per salt application. Net 15.', '$290 por limpieza, $100 por aplicación de sal. A 15 días.'),
    assign: [
      { workerId: 'w6', scope: tx('Plowing, 2 pushes', 'Pala, 2 limpiezas'), price: 160, payType: 'hourly', rate: 32, qty: 5, status: 'done' },
      { workerId: 'w7', scope: tx('Walkway and steps', 'Pasillo y escalones'), price: 88, payType: 'hourly', rate: 22, qty: 4, status: 'done' },
    ],
    expenses: [{ date: -23, vendor: saltSupplier, desc: tx('Rock salt, 0.75 ton', 'Sal en grano, 0.75 tonelada'), amount: 72 }],
    workerPays: [
      { date: -20, workerId: 'w6', method: 'check', ref: '3123', amount: 160, payType: 'hourly', from: -23, to: -22 },
      { date: -20, workerId: 'w7', method: 'zelle', amount: 88, payType: 'hourly', from: -23, to: -22 },
    ],
    tasks: [
      { title: tx('Send the invoice with the storm log', 'Mandar la factura con el registro de la tormenta'), who: 'u3', due: -21, status: 'done' },
      { title: tx('Balance of $780: the office says the check goes out this week', 'Saldo de $780: la oficina dice que el cheque sale esta semana'), who: 'u2', due: 2, status: 'waiting', pri: 'high' },
      { title: tx('Offer Dr. Brooks a seasonal contract', 'Ofrecerle al Dr. Brooks un contrato de temporada'), who: 'u1', due: 5 },
    ],
    log: [{ date: -23, workerId: 'w6', text: tx('First push done at 5:40, second at 11:15. Salted both times. Cars were already in the lot for the second one.', 'Primera limpieza lista a las 5:40, la segunda a las 11:15. Sal las dos veces. Para la segunda ya había carros en el estacionamiento.') }],
    notes: [
      [-24, 'call', tx('Called the night before the storm, their regular plow guy did not answer. Patients start at 8.', 'Llamaron la noche antes de la tormenta, el que les limpia siempre no contestó. Los pacientes llegan desde las 8.')],
      [-3, 'call', tx('Office manager says the check goes out this week.', 'La gerente de la oficina dice que el cheque sale esta semana.')],
    ],
  });

  k.job({
    id: 'j9', name: tx('Lot and walkways, rest of the season', 'Estacionamiento y pasillos, resto de la temporada'), clientId: 'c9', type: 'lot', status: 'contract', price: 3900, start: 5, end: 45, leadId: 'l11',
    scope: tx('Plow the parking lot and the drop-off loop at 1 inch, shovel and salt the walkways and the path to the playground gate. Everything open by 6 am, first drop-off is at 6:30.', 'Pasar la pala en el estacionamiento y la vuelta donde dejan a los niños a partir de 1 pulgada, limpiar y echar sal en los pasillos y el camino al portón del área de juegos. Todo abierto a las 6 am, los primeros niños llegan a las 6:30.'),
    payTerms: tx('3 payments of $1,300. The first one is due at signing.', '3 pagos de $1,300. El primero se paga al firmar.'),
    assign: [
      { workerId: 'w6', scope: tx('Plowing, lot and drop-off loop', 'Pala, estacionamiento y vuelta de entrada'), price: 512, payType: 'hourly', rate: 32, qty: 16, status: 'pending' },
      { workerId: 'w7', scope: tx('Walkways and playground gate path', 'Pasillos y camino al área de juegos'), price: 308, payType: 'hourly', rate: 22, qty: 14, status: 'pending' },
    ],
    tasks: [
      { title: tx('Send the agreement to Latoya', 'Mandarle el acuerdo a Latoya'), who: 'u1', due: -1, status: 'done' },
      { title: tx('Signed agreement and first payment', 'Acuerdo firmado y primer pago'), who: 'u1', due: 2, status: 'waiting', pri: 'high' },
      { title: tx('Site walk: stake the drop-off loop and mark the drains', 'Recorrido: estacas en la vuelta de entrada y marcar los drenajes'), who: 'w6', due: 4 },
      { title: tx('Add the daycare to the storm route sheet', 'Agregar la guardería a la hoja de ruta de tormenta'), who: 'u3', due: 4 },
      { title: tx('Send Latoya the storm contact sheet', 'Mandarle a Latoya la hoja de contactos para tormentas'), who: 'u3', due: 7 },
    ],
    notes: [[-2, 'visit', tx('Their plow vendor quit in the middle of the season. Trigger is 1 inch because of the kids. No piles near the playground fence.', 'El que les limpiaba los dejó a media temporada. Se sale a partir de 1 pulgada por los niños. Nada de montones cerca de la cerca del área de juegos.')]],
  });

  k.job({
    id: 'j10', name: tx('Seasonal contract, 3 apartment buildings', 'Contrato de temporada, 3 edificios de apartamentos'), clientId: 'c10', type: 'season', status: 'progress', price: 7200, start: -68, end: 45, manager: 'u2',
    scope: tx('Three buildings on Sample Ave and Sample Ter: plow the tenant lots at 2 inches, shovel and salt sidewalks, steps and the paths to the trash enclosures. The city sidewalk has to be clear within 12 hours after the snow stops.', 'Tres edificios en Sample Ave y Sample Ter: pasar la pala en los estacionamientos de inquilinos a partir de 2 pulgadas, limpiar y echar sal en aceras, escalones y caminos a los botes de basura. La acera de la ciudad tiene que quedar limpia dentro de las 12 horas después de que pare la nieve.'),
    payTerms: tx('4 monthly payments of $1,800.', '4 pagos mensuales de $1,800.'),
    assign: [
      { workerId: 'w6', scope: tx('Plowing, 3 tenant lots', 'Pala, 3 estacionamientos de inquilinos'), price: 960, payType: 'hourly', rate: 32, qty: 30, status: 'progress' },
      { workerId: 'w2', scope: tx('Sidewalks, steps and trash paths', 'Aceras, escalones y caminos a la basura'), price: 1400, payType: 'hourly', rate: 25, qty: 56, status: 'progress' },
      { workerId: 'w5', scope: tx('Sidewalks, second shovel', 'Aceras, segunda pala'), price: 660, payType: 'hourly', rate: 22, qty: 30, status: 'progress' },
    ],
    expenses: [
      { date: -66, vendor: saltSupplier, desc: tx('Ice melt, 40 bags for the building closets', 'Derretidor de hielo, 40 sacos para los cuartos de los edificios'), amount: 620 },
      { date: -30, vendor: fuel, desc: tx('Diesel, company truck', 'Diésel, camión de la compañía'), amount: 150 },
    ],
    received: [
      { date: -68, method: 'transfer', ref: pay(1, 4), amount: 1800 },
      { date: -38, method: 'transfer', ref: pay(2, 4), amount: 1800 },
      { date: 0, method: 'transfer', ref: pay(3, 4), amount: 1800 },
    ],
    workerPays: [
      { date: -50, workerId: 'w6', method: 'check', ref: '3105', amount: 480, payType: 'hourly', from: -68, to: -51 },
      { date: -50, workerId: 'w2', method: 'zelle', amount: 450, payType: 'hourly', from: -68, to: -51 },
      { date: -50, workerId: 'w5', method: 'zelle', amount: 330, payType: 'hourly', from: -68, to: -51 },
      { date: -20, workerId: 'w6', method: 'check', ref: '3125', amount: 224, payType: 'hourly', from: -50, to: -21 },
      { date: -20, workerId: 'w2', method: 'zelle', amount: 350, payType: 'hourly', from: -50, to: -21 },
      { date: -20, workerId: 'w5', method: 'zelle', amount: 132, payType: 'hourly', from: -50, to: -21 },
    ],
    tasks: [
      { title: tx('Storm: lots, sidewalks and steps at all 3 buildings', 'Tormenta: estacionamientos, aceras y escalones en los 3 edificios'), who: 'w2', due: -23, status: 'done', pri: 'high' },
      { title: tx('Tenant complaint: ice on the back steps at 115', 'Queja de inquilino: hielo en los escalones de atrás del 115'), who: 'w2', due: -8, status: 'done' },
      { title: tx('Count the ice melt left in each building closet', 'Contar el derretidor que queda en el cuarto de cada edificio'), who: 'w5', due: 0 },
      { title: tx('Send Rachel the sidewalk photos from the last storm', 'Mandarle a Rachel las fotos de las aceras de la última tormenta'), who: 'u3', due: 1, status: 'doing' },
      { title: tx('Price to add the 4th building', 'Precio para agregar el 4.º edificio'), who: 'u2', due: 2, status: 'review' },
    ],
    log: [
      { date: -23, workerId: 'w2', text: tx('All 3 buildings done by 9. Nobody moved their cars at 101, so we plowed the lanes and came back at 2 pm for the spaces.', 'Los 3 edificios listos a las 9. En el 101 nadie movió su carro, limpiamos los carriles y regresamos a las 2 pm por los cajones.') },
      { date: -8, workerId: 'w2', text: tx('Back steps at 115 had ice from the gutter. Chipped it and salted. Told the super about the gutter.', 'Los escalones de atrás del 115 tenían hielo por la canaleta. Lo picamos y echamos sal. Le avisé al encargado del edificio.') },
    ],
    notes: [[-69, 'visit', tx('Rachel wants photos of the city sidewalk after every storm, in case somebody complains. The supers have the keys to the salt closets.', 'Rachel quiere fotos de la acera de la ciudad después de cada tormenta, por si alguien se queja. Los encargados tienen las llaves de los cuartos de la sal.')]],
  });

  k.job({
    id: 'j11', name: tx('Salt bin refills and site check', 'Relleno de botes de sal y revisión del sitio'), clientId: 'c1', type: 'salt', status: 'progress', price: 1360, start: -56, end: 45, repeat: 'monthly', manager: 'u3',
    scope: tx('Once a month: refill the 6 salt bins at the entrances, check the stakes and walk the lot with security to look for problem spots.', 'Una vez al mes: rellenar los 6 botes de sal de las entradas, revisar las estacas y recorrer el estacionamiento con seguridad para ver puntos de riesgo.'),
    payTerms: tx('$340 per visit, 4 visits this season, billed after each visit.', '$340 por visita, 4 visitas esta temporada, se factura después de cada una.'),
    assign: [{ workerId: 'w5', scope: tx('Bin refills and site walk, 4 visits', 'Relleno de botes y recorrido, 4 visitas'), price: 352, payType: 'hourly', rate: 22, qty: 16, status: 'progress' }],
    expenses: [
      { date: -56, vendor: saltSupplier, desc: tx('Ice melt, 12 bags', 'Derretidor de hielo, 12 sacos'), amount: 186 },
      { date: -28, vendor: saltSupplier, desc: tx('Ice melt, 12 bags', 'Derretidor de hielo, 12 sacos'), amount: 186 },
    ],
    received: [
      { date: -54, method: 'check', ref: tx('Visit 1', 'Visita 1'), amount: 340 },
      { date: -26, method: 'check', ref: tx('Visit 2', 'Visita 2'), amount: 340 },
    ],
    workerPays: [{ date: -27, workerId: 'w5', method: 'zelle', amount: 176, payType: 'hourly', from: -56, to: -28 }],
    tasks: [
      { title: tx('Visit 2: refill the bins and walk the lot', 'Visita 2: rellenar los botes y recorrer el estacionamiento'), who: 'w5', due: -28, status: 'done' },
      { title: tx('Visit 3: refill the bins and walk the lot', 'Visita 3: rellenar los botes y recorrer el estacionamiento'), who: 'w5', due: 0, pri: 'high' },
      { title: tx('Invoice visit 3', 'Facturar la visita 3'), who: 'u3', due: 1 },
    ],
    log: [{ date: -28, workerId: 'w5', text: tx('All 6 bins are full. The bin at the ER door has a broken lid, security will tape it for now.', 'Los 6 botes quedaron llenos. El de la puerta de emergencias tiene la tapa rota, seguridad le va a poner cinta por mientras.') }],
  });

  k.job({
    id: 'j12', name: tx('Dealership lot, rest of the season', 'Estacionamiento de la agencia, resto de la temporada'), clientId: 'c11', type: 'lot', status: 'hold', price: 4200, start: -32, end: 45, leadId: 'l13',
    scope: tx('Plow the customer lot and the service lanes at 2 inches and salt the service entrance. The display rows are cleared by their own staff.', 'Pasar la pala en el estacionamiento de clientes y los carriles de servicio a partir de 2 pulgadas y echar sal en la entrada de servicio. Las filas de exhibición las limpia su propio personal.'),
    payTerms: tx('3 payments of $1,400.', '3 pagos de $1,400.'),
    assign: [
      { workerId: 'w8', scope: tx('Plowing, first storm', 'Pala, primera tormenta'), price: 480, payType: 'hourly', rate: 80, qty: 6, status: 'done' },
      { workerId: 'w6', scope: tx('Plowing, when service starts again', 'Pala, cuando se reanude el servicio'), price: 768, payType: 'hourly', rate: 32, qty: 24, status: 'pending' },
    ],
    expenses: [{ date: -31, vendor: saltSupplier, desc: tx('Rock salt, 2 tons', 'Sal en grano, 2 toneladas'), amount: 190 }],
    received: [{ date: -30, method: 'check', ref: pay(1, 3), amount: 1400 }],
    workerPays: [{ date: -20, workerId: 'w8', method: 'check', ref: '3120', amount: 480, payType: 'hourly', from: -32, to: -23 }],
    tasks: [
      { title: tx('Pull the stakes before the paving crew starts', 'Quitar las estacas antes de que empiece la pavimentación'), who: 'w6', due: -5, status: 'done' },
      { title: tx('Ask Hank for the paving schedule', 'Pedirle a Hank el calendario de la pavimentación'), who: 'u1', due: 3, status: 'waiting' },
      { title: tx('Stake the lot again after paving', 'Volver a poner estacas después de la pavimentación'), who: 'w6' },
    ],
    log: [{ date: -23, workerId: 'w8', text: tx('Customer lot and service lanes done by 7. Their guys had not touched the display rows yet.', 'Estacionamiento de clientes y carriles de servicio listos a las 7. Los de la agencia todavía no tocaban las filas de exhibición.') }],
    notes: [
      [-33, 'visit', tx('The display rows are theirs. We do the customer lot, the service lanes and the service entrance.', 'Las filas de exhibición les tocan a ellos. Nosotros hacemos el estacionamiento de clientes, los carriles de servicio y la entrada de servicio.')],
      [-6, 'call', tx('On hold. The lot is being repaved and Hank asked us to stay off until the paving company is done. He will call with the date. Payments are paused too.', 'En pausa. Están repavimentando el estacionamiento y Hank pidió que no entremos hasta que termine la pavimentadora. Él llama con la fecha. Los pagos también quedan en pausa.')],
    ],
  });

  k.job({
    id: 'j13', name: tx('Add the 4th building to the seasonal contract', 'Agregar el 4.º edificio al contrato de temporada'), clientId: 'c10', address: '22 Sample Ter, Ventnor, NJ', type: 'sidewalk', status: 'estimate', price: 2100, manager: 'u2',
    scope: tx('Add the building at 22 Sample Ter for the rest of the season: 8-car lot, sidewalk on two sides (corner lot) and the front steps.', 'Agregar el edificio de 22 Sample Ter por el resto de la temporada: estacionamiento de 8 carros, acera por dos lados (es esquina) y los escalones del frente.'),
    payTerms: tx('Added to the monthly payment: $700 more per month.', 'Se suma al pago mensual: $700 más por mes.'),
    assign: [
      { workerId: 'w2', scope: tx('Sidewalks and steps', 'Aceras y escalones'), price: 500, payType: 'hourly', rate: 25, qty: 20, status: 'pending' },
      { workerId: 'w6', scope: tx('Plowing, 8-car lot', 'Pala, estacionamiento de 8 carros'), price: 256, payType: 'hourly', rate: 32, qty: 8, status: 'pending' },
    ],
    tasks: [{ title: tx('Follow up with Rachel on the 4th building', 'Darle seguimiento a Rachel con el 4.º edificio'), who: 'u2', due: 2 }],
    notes: [[-2, 'email', tx('Rachel asked for a price to add 22 Sample Ter. Corner lot, so the city sidewalk is twice as long.', 'Rachel pidió precio para agregar 22 Sample Ter. Es esquina, así que la acera de la ciudad es el doble de larga.')]],
  });

  k.job({
    id: 'j14', name: tx('Pile relocation with the loader', 'Mover montones con el cargador'), clientId: 'c3', type: 'other', status: 'done', price: 1450, start: -21, end: -21, manager: 'u2',
    scope: tx('Extra work, not part of the seasonal price: move the 4 snow piles from the front rows to the back lot line and open both fire lanes.', 'Trabajo extra, fuera del precio de temporada: mover los 4 montones de nieve de las filas del frente al fondo del estacionamiento y abrir los dos carriles de bomberos.'),
    payTerms: tx('Flat price, billed with the next invoice.', 'Precio fijo, se cobra con la siguiente factura.'),
    assign: [{ workerId: 'w4', scope: tx('Loader operator, 1 day', 'Operador de cargador, 1 día'), price: 360, payType: 'hourly', rate: 45, qty: 8, status: 'done' }],
    expenses: [
      { date: -21, vendor: tx('Equipment rental', 'Renta de equipo'), desc: tx('Skid steer with bucket, 1 day', 'Minicargador con cucharón, 1 día'), amount: 420 },
      { date: -21, vendor: fuel, desc: tx('Diesel for the skid steer', 'Diésel para el minicargador'), amount: 60 },
    ],
    received: [{ date: -12, method: 'transfer', ref: tx('Paid in full', 'Pagado completo'), amount: 1450 }],
    workerPays: [{ date: -19, workerId: 'w4', method: 'check', ref: '3124', amount: 360, payType: 'hourly', from: -21, to: -21 }],
    tasks: [
      { title: tx('Get the extra work approved by Nina in writing', 'Conseguir que Nina apruebe por escrito el trabajo extra'), who: 'u2', due: -22, status: 'done' },
      { title: tx('Reserve the skid steer', 'Apartar el minicargador'), who: 'u3', due: -22, status: 'done' },
      { title: tx('Move the piles to the back lot line', 'Mover los montones al fondo del estacionamiento'), who: 'w4', due: -21, status: 'done' },
    ],
    log: [{ date: -21, workerId: 'w4', text: tx('Moved 4 piles to the back lot line. The drive-through and both fire lanes are open. 8 hours on the machine.', 'Moví los 4 montones al fondo. El autoservicio y los dos carriles de bomberos quedaron abiertos. 8 horas en la máquina.') }],
  });

  /* ---------- leads ---------- */
  k.lead({ id: 'l1', name: 'Marcus Reid', company: 'Oakwood Apartments', phone: '609-555-0151', email: 'marcus@example.com', address: '500 Sample Blvd, Absecon, NJ', type: 'lot', source: 'google', status: 'sent', pri: 'high', value: 9800, appt: [-5, '14:00'], followUp: 4, created: -12,
    notes: [[-12, 'call', tx('Wants a seasonal contract for 2 lots and all the sidewalks, salt included. The board meets next week.', 'Quiere contrato de temporada para 2 estacionamientos y todas las aceras, con sal incluida. La mesa directiva se junta la próxima semana.')], [-4, 'email', tx('Sent the seasonal price and a per push option so the board can compare.', 'Se mandó el precio de temporada y la opción por limpieza para que la mesa compare.')]] });
  k.lead({ id: 'l2', name: 'Paul Richards', phone: '609-555-0152', address: '11 Sample Ln, Linwood, NJ', type: 'push', source: 'phone', status: 'new', value: 75, followUp: 0, created: -1,
    notes: [[-1, 'call', tx('Driveway, per push. Elderly homeowner, needs it cleared before 7 am.', 'Entrada, por cada limpieza. Señor mayor, la necesita limpia antes de las 7 am.')]] });
  k.lead({ id: 'l3', name: 'Francisco Reyes', phone: '609-555-0153', email: 'francisco@example.com', address: '48 Sample St, Pleasantville, NJ', type: 'push', source: 'facebook', status: 'new', owner: 'u3', created: 0,
    notes: [[0, 'text', tx('Message from the page: driveway and sidewalk, corner house. Asks for the price per push and for the season. Prefers Spanish.', 'Mensaje por la página: entrada y acera, casa de esquina. Pregunta el precio por limpieza y por temporada. Prefiere español.')]] });
  k.lead({ id: 'l4', name: 'Angela Morris', company: 'Sample Charter School', phone: '609-555-0154', email: 'angela@example.com', address: '75 Sample Rd, Galloway, NJ', type: 'lot', source: 'website', status: 'scheduled', pri: 'high', value: 14500, appt: [1, '09:30'], created: -4,
    notes: [[-4, 'note', tx('Web form: bus loop, staff lot and all walkways. Buses arrive at 7:15. Wants a site visit before the season starts.', 'Formulario web: vuelta de autobuses, estacionamiento del personal y todos los pasillos. Los autobuses llegan a las 7:15. Quiere una visita antes de que empiece la temporada.')], [-2, 'call', tx('Site visit confirmed. Bring the measuring wheel, she wants a price per storm and a seasonal price.', 'Visita confirmada. Llevar la rueda de medir, quiere precio por tormenta y precio de temporada.')]] });
  k.lead({ id: 'l5', name: 'Raj Mehta', company: 'Sample Shopping Center', phone: '609-555-0155', email: 'raj@example.com', address: '900 Sample Pike, Mays Landing, NJ', type: 'season', source: 'referral', status: 'scheduled', owner: 'u2', value: 16000, appt: [0, '13:00'], created: -3,
    notes: [[-3, 'call', tx('Referred by Nina at the retail plaza. 3 acre lot with 9 stores. Unhappy with slow response from the current company.', 'Lo recomendó Nina, de la plaza comercial. Estacionamiento de 3 acres con 9 tiendas. No está contento con lo lento de la compañía que tiene ahora.')]] });
  k.lead({ id: 'l6', name: 'Helen Brodsky', phone: '609-555-0156', address: '3 Sample Ct, Ventnor, NJ', type: 'sidewalk', source: 'phone', status: 'contacted', followUp: -1, created: -6,
    notes: [[-6, 'call', tx('Corner house, long city sidewalk. Got a warning from the city last season. Wants sidewalk only, she has someone for the driveway.', 'Casa de esquina con acera larga de la ciudad. La temporada pasada le llegó un aviso de la ciudad. Solo quiere la acera, para la entrada ya tiene a alguien.')], [-3, 'call', tx('Gave her the price by phone. She wants to think about it, call back.', 'Le di el precio por teléfono. Lo quiere pensar, hay que volver a llamar.')]] });
  k.lead({ id: 'l7', name: 'Dr. Paula Jensen', company: 'Sample Veterinary Clinic', phone: '609-555-0157', email: 'paula@example.com', address: '60 Sample Ave, Somers Point, NJ', type: 'lot', source: 'instagram', status: 'contacted', followUp: 2, created: -5,
    notes: [[-5, 'text', tx('Small lot, 14 spaces, and a ramp for carts. Emergency hours, so they need salt at night too.', 'Estacionamiento chico, 14 cajones, y una rampa para carritos. Atienden emergencias, así que también necesitan sal de noche.')]] });
  k.lead({ id: 'l8', name: 'Steve Marino', company: 'Lakeside Condo Association', phone: '609-555-0158', email: 'steve@example.com', address: '40 Sample Dr, Egg Harbor Twp, NJ', type: 'hoa', source: 'website', status: 'sent', owner: 'u2', value: 11200, appt: [-9, '10:00'], followUp: 1, created: -16,
    notes: [[-16, 'note', tx('Web form: 64 units, 2 roads and 8 shared driveways. Board wants 3 bids.', 'Formulario web: 64 unidades, 2 calles y 8 entradas compartidas. La mesa quiere 3 cotizaciones.')], [-8, 'email', tx('Bid sent: seasonal price with a 2 inch trigger, sidewalks to each front door included.', 'Cotización enviada: precio de temporada a partir de 2 pulgadas, con aceras hasta cada puerta.')]] });
  k.lead({ id: 'l9', name: 'Dennis Cole', company: 'Sample Hardware', phone: '609-555-0159', email: 'dennis@example.com', address: '18 Sample St, Hammonton, NJ', type: 'salt', source: 'other', status: 'scheduled', value: 1800, appt: [3, '15:00'], created: -7,
    notes: [[-7, 'visit', tx('Stopped Brian while he was fueling the truck. Wants salting only for the customer lot, his own guys plow.', 'Paró a Brian mientras cargaba diésel. Solo quiere sal en el estacionamiento de clientes, la pala la pasan sus muchachos.')]] });
  k.lead({ id: 'l10', name: 'Marisela Ortiz', phone: '609-555-0160', email: 'marisela@example.com', address: '27 Sample Way, Galloway, NJ', type: 'season', source: 'google', status: 'new', followUp: 1, created: 0,
    notes: [[0, 'note', tx('Found us online and called: season price for a double driveway and the walk. Works nights, needs it clear by 9 pm.', 'Nos encontró en internet: precio de temporada para una entrada doble y el caminito. Trabaja de noche, lo necesita limpio a las 9 pm.')]] });
  k.lead({ id: 'l11', name: 'Latoya Green', company: 'Sample Daycare Center', phone: '609-555-0109', email: 'latoya@example.com', address: '34 Sample Way, Mays Landing, NJ', type: 'lot', source: 'referral', status: 'won', pri: 'high', value: 3900, created: -8, clientId: 'c9', jobId: 'j9',
    notes: [[-8, 'call', tx('Their plow vendor quit mid-season. A parent who works at the medical center gave her our name. Needs someone before the next storm.', 'El que les limpiaba los dejó a media temporada. Una mamá que trabaja en el centro médico le dio nuestro nombre. Necesita a alguien antes de la próxima tormenta.')], [-6, 'visit', tx('Walked the site. Trigger at 1 inch, open by 6 am. Quoted $3,900 for the rest of the season and she said yes.', 'Recorrimos el sitio. Se sale a partir de 1 pulgada, abierto a las 6 am. Cotizamos $3,900 por el resto de la temporada y dijo que sí.')]] });
  k.lead({ id: 'l12', name: 'Dr. Alan Brooks', company: 'Sample Dental Group', phone: '609-555-0107', email: 'office.dental@example.com', address: '25 Sample Blvd, Absecon, NJ', type: 'push', source: 'phone', status: 'won', owner: 'u2', value: 780, created: -24, clientId: 'c7', jobId: 'j8',
    notes: [[-24, 'call', tx('Emergency call the night before the storm. Their regular plow guy did not answer. Lot and patient walkway.', 'Llamada de emergencia la noche antes de la tormenta. El que les limpia siempre no contestó. Estacionamiento y pasillo de pacientes.')]] });
  k.lead({ id: 'l13', name: 'Hank Morrison', company: 'Sample Motors', phone: '609-555-0111', email: 'hank@example.com', address: '800 Sample Pike, Egg Harbor Twp, NJ', type: 'lot', source: 'other', status: 'won', value: 4200, created: -40, clientId: 'c11', jobId: 'j12',
    notes: [[-40, 'visit', tx('Saw our truck at the bank next door and walked over. Wants the customer lot and service lanes only.', 'Vio nuestro camión en el banco de al lado y se acercó. Solo quiere el estacionamiento de clientes y los carriles de servicio.')]] });
  k.lead({ id: 'l14', name: 'Monica Hall', company: 'Sample Assisted Living', phone: '609-555-0161', email: 'monica@example.com', address: '150 Sample Blvd, Northfield, NJ', type: 'season', source: 'referral', status: 'contacted', pri: 'high', followUp: 0, created: -2,
    notes: [[-2, 'call', tx('Referred by Deborah at the medical center. Needs zero tolerance at the entrances, staff changes shift at 6 am and 2 pm. Sending the site map.', 'La recomendó Deborah, del centro médico. No puede haber nada de hielo en las entradas, el personal cambia de turno a las 6 am y a las 2 pm. Va a mandar el plano del sitio.')]] });
  k.lead({ id: 'l15', name: 'Bill Tanner', company: 'Sample Supermarket', phone: '609-555-0162', email: 'bill@example.com', address: '1000 Sample Pike, Egg Harbor Twp, NJ', type: 'lot', source: 'google', status: 'lost', value: 18000, created: -33,
    notes: [[-33, 'call', tx('5 acre lot, open 24 hours. Wants a loader on site for every storm.', 'Estacionamiento de 5 acres, abierto las 24 horas. Quiere un cargador en el sitio en cada tormenta.')]],
    lostReason: tx('Went with a larger company that keeps its own loaders on site. We could not promise a 2 hour response on a lot that size.', 'Se fue con una compañía más grande que deja sus cargadores en el sitio. No podíamos prometer respuesta en 2 horas en un estacionamiento de ese tamaño.') });
  k.lead({ id: 'l16', name: 'Nancy Feldman', phone: '609-555-0163', address: '9 Sample Ln, Margate, NJ', type: 'push', source: 'facebook', status: 'lost', owner: 'u3', value: 70, created: -25,
    notes: [[-25, 'text', tx('Short driveway, per push. Asked if we do the steps too.', 'Entrada corta, por cada limpieza. Preguntó si también hacemos los escalones.')]],
    lostReason: tx('Her nephew bought a snow blower and will do it himself.', 'Su sobrino compró una sopladora de nieve y lo va a hacer él.') });

  /* ---------- office tasks ---------- */
  k.task({ title: tx('Order bulk salt: 25 tons before prices go up', 'Pedir sal a granel: 25 toneladas antes de que suba el precio'), who: 'u1', due: 2, status: 'doing', pri: 'high' });
  k.task({ title: tx('Company truck: service the plow hydraulics and check the spreader', 'Camión de la compañía: servicio al hidráulico de la pala y revisar el esparcidor'), who: 'u2', due: 6 });
  k.task({ title: tx('Renew the commercial auto and general liability insurance', 'Renovar el seguro comercial de auto y de responsabilidad civil'), who: 'u1', due: 20, pri: 'high' });
  k.task({ title: tx('Get a current insurance certificate from Sample Salt Supply', 'Pedirle a Sample Salt Supply un certificado de seguro vigente'), who: 'u3', due: -2, status: 'waiting', pri: 'high' });
  k.task({ title: tx('Update the storm call list and route sheets', 'Actualizar la lista de llamadas y las hojas de ruta de tormenta'), who: 'u3', due: 0, status: 'review' });
  k.task({ title: tx('Pre-season site visit and measurements for the charter school', 'Visita de pretemporada y medidas para la escuela'), who: 'u1', due: 1, leadId: 'l4' });
  k.task({ title: tx('Buy 200 marker stakes and 2 extra shovels', 'Comprar 200 estacas y 2 palas extra'), who: 'u3', due: 8, pri: 'low' });
  k.task({ title: tx('Crew meeting: storm roles, call times and safety', 'Junta con la cuadrilla: quién hace qué en tormenta, horarios de llamada y seguridad'), who: 'u1', due: 11 });
  k.task({ title: tx('Test the backup spreader and load the spare hydraulic hose', 'Probar el esparcidor de repuesto y subir la manguera hidráulica extra'), who: 'u2', due: 13, pri: 'low' });
  k.task({ title: tx('Calibrate the salt spreader', 'Calibrar el esparcidor de sal'), who: 'w6', due: -1, status: 'done' });

  return k.finish();
}
