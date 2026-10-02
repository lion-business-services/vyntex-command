import type { Lang, SeedData } from '@/domain/types';
import { seedKit } from '../seedkit';

/** Sample business for this edition. Fictional data only. */
export function seed(lang: Lang): SeedData {
  const k = seedKit(lang, 'VW-');
  const { tx } = k;
  /** Visits and follow-ups with a prospect never land on a Sunday: move those to Monday. */
  const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.getDay() === 0 ? n + 1 : n; };
  const chem = tx('Chemical supplier', 'Proveedor de químicos');
  const gas = tx('Gas station', 'Gasolinera');

  /* ---------- crew ---------- */
  k.worker({ id: 'w1', name: 'Kevin Ortiz', trade: tx('Crew lead', 'Líder de cuadrilla'), phone: '609-555-0121', email: 'kevin@example.com', payType: 'daily', rate: 200, w9: 60, coi: 140, insurer: 'Sample Mutual Insurance' });
  // W-9 missing while he is on active jobs
  k.worker({ id: 'w2', name: 'Jonathan Reyes', trade: tx('Pressure washing tech', 'Técnico de lavado a presión'), phone: '609-555-0122', email: 'jonathan@example.com', payType: 'daily', rate: 160, coi: 170, insurer: 'Garden Sample Insurance' });
  // insurance certificate expires within 30 days
  k.worker({ id: 'w3', name: 'Andre Mills', trade: tx('Window & gutter tech', 'Técnico de ventanas y canaletas'), phone: '609-555-0123', email: 'andre@example.com', payType: 'project', w9: 60, coi: 15, insurer: 'Shoreline Sample Insurance' });
  // insurance certificate already expired
  k.worker({ id: 'w4', name: 'Sergio Navarro', trade: tx('Roof soft wash tech', 'Técnico de lavado suave de techos'), phone: '609-555-0124', email: 'sergio@example.com', payType: 'daily', rate: 190, w9: 140, coi: -8, insurer: 'Sample Mutual Insurance' });
  k.worker({ id: 'w5', name: 'Brianna Scott', trade: tx('Window cleaner', 'Limpiadora de ventanas'), phone: '609-555-0125', email: 'brianna@example.com', payType: 'hourly', rate: 22, w9: 66, coi: 200, insurer: 'Garden Sample Insurance' });
  k.worker({ id: 'w6', name: 'Mateo Rojas', trade: tx('Helper', 'Ayudante'), phone: '609-555-0126', email: 'mateo@example.com', payType: 'hourly', rate: 18, w9: 82, coi: 110, insurer: 'Garden Sample Insurance' });
  // left at the end of the summer
  k.worker({ id: 'w7', name: 'Dwayne Foster', trade: tx('Pressure washing tech', 'Técnico de lavado a presión'), phone: '609-555-0127', email: 'dwayne@example.com', payType: 'daily', rate: 160, w9: 180, coi: 60, insurer: 'Sample Mutual Insurance', active: false });

  /* ---------- clients ---------- */
  k.client({ id: 'c1', name: 'Monica Harris', phone: '609-555-0101', email: 'harris@example.com', addresses: ['12 Sample Rd, Galloway, NJ'], since: -8,
    note: tx("Water spigot on the left side of the house. Don't spray near the koi pond.", 'La llave de agua está del lado izquierdo de la casa. No rociar cerca del estanque de peces koi.') });
  k.client({ id: 'c2', name: 'Alicia Moreno', company: 'Sample Coffee Co.', phone: '609-555-0102', email: 'samplecoffee@example.com', addresses: ['55 Sample Plaza, Northfield, NJ'], since: -92,
    note: tx('We must be finished before they open at 6:30 am. Card on file, charge the day of the service.', 'Hay que terminar antes de que abran a las 6:30 am. Tarjeta registrada, cobrar el día del servicio.') });
  k.client({ id: 'c3', name: 'Trevor Banks', company: 'Sample Property Group', phone: '609-555-0103', email: 'propertygroup@example.com', addresses: ['120 Sample St, Absecon, NJ', '14, 16 and 18 Sample Ct, Absecon, NJ'], since: -88,
    note: tx('Manages an apartment complex and several rental houses. Needs a certificate of insurance naming the company before any job. Pays by check, about two weeks.', 'Administra un complejo de apartamentos y varias casas de renta. Pide certificado de seguro a nombre de la compañía antes de cada trabajo. Paga con cheque, unas dos semanas.') });
  k.client({ id: 'c4', name: 'Gail Winters', company: 'Mill Pond Sample HOA', phone: '609-555-0104', email: 'millpondhoa@example.com', addresses: ['1 Sample Mill Pond Dr, Egg Harbor Twp, NJ'], since: -13,
    note: tx('Six townhome buildings. Residents get a notice 48 hours before: close windows, move cars and patio furniture.', 'Seis edificios de townhomes. A los residentes se les avisa 48 horas antes: cerrar ventanas, mover autos y muebles de patio.') });
  k.client({ id: 'c5', name: 'Anthony Russo', phone: '609-555-0105', email: 'anthony@example.com', addresses: ['9 Sample Pl, Margate, NJ'], since: -38 });
  k.client({ id: 'c6', name: 'Nikos Pappas', company: 'Sample Seafood Grill', phone: '609-555-0106', email: 'seafoodgrill@example.com', addresses: ['400 Sample Bay Ave, Somers Point, NJ'], since: -80,
    note: tx('Wash before 9 am, the kitchen crew arrives at 10. Grease trap lid stays closed. Nikos pays by check when he sees the invoice.', 'Lavar antes de las 9 am, la gente de cocina llega a las 10. La tapa de la trampa de grasa se queda cerrada. Nikos paga con cheque cuando ve la factura.') });
  k.client({ id: 'c7', name: 'Joanne Fitzgerald', company: 'Northfield Sample Office Park', phone: '609-555-0107', email: 'officepark@example.com', addresses: ['800 Sample Rd, Northfield, NJ'], since: -66 });
  k.client({ id: 'c8', name: 'Claire Donovan', phone: '609-555-0108', email: 'claire@example.com', addresses: ['27 Sample Ave, Linwood, NJ'], since: -15 });
  k.client({ id: 'c9', name: 'Luis & Marta Peña', phone: '609-555-0109', email: 'pena@example.com', addresses: ['63 Sample Dr, Egg Harbor Twp, NJ'], since: -9,
    note: tx('Prefer Spanish. Saltwater pool, do not let wash water run into it.', 'Prefieren español. Piscina de agua salada, que el agua del lavado no escurra hacia ella.') });
  k.client({ id: 'c10', name: 'Ed Kowalski', company: 'Sample Plumbing & Heating', phone: '609-555-0110', email: 'sampleplumbing@example.com', addresses: ['75 Sample Industrial Way, Pleasantville, NJ'], since: -73 });
  k.client({ id: 'c11', name: 'Grace Okafor', phone: '609-555-0111', email: 'grace@example.com', addresses: ['5 Sample Ter, Absecon, NJ'], since: -5 });
  // asked for phone calls only
  k.client({ id: 'c12', name: 'Walter Simmons', phone: '609-555-0112', email: 'walter@example.com', addresses: ['31 Sample St, Ventnor, NJ'], since: -49, emailOptOut: true,
    note: tx('No automatic emails, he asked for phone calls only.', 'Sin correos automáticos, pidió solo llamadas.') });

  /* ---------- jobs ---------- */
  k.job({ id: 'j1', name: tx('House wash and driveway', 'Lavado de casa y entrada'), clientId: 'c1', type: 'house', status: 'progress', price: 780, start: 0, end: 0, manager: 'u1',
    scope: tx('Soft wash vinyl siding, clean driveway and front walk, rinse landscaping before and after.', 'Lavado suave del revestimiento de vinil, limpieza de la entrada de autos y el camino de entrada, enjuagar las plantas antes y después.'),
    payTerms: tx('Paid in full on completion.', 'Pago total al terminar.'),
    assign: [
      { workerId: 'w2', scope: tx('House soft wash', 'Lavado suave de la casa'), price: 160, payType: 'daily', rate: 160, qty: 1, status: 'progress' },
      { workerId: 'w6', scope: tx('Driveway and walk, 8 hours', 'Entrada de autos y camino de entrada, 8 horas'), price: 144, payType: 'hourly', rate: 18, qty: 8, status: 'progress' },
    ],
    expenses: [{ date: -1, vendor: chem, desc: tx('Sodium hypochlorite and surfactant', 'Hipoclorito de sodio y surfactante'), amount: 64 }],
    tasks: [
      { title: tx('Confirm the day with Monica and ask her to close the windows', 'Confirmar el día con Monica y pedirle que cierre las ventanas'), who: 'u3', due: -1, status: 'done' },
      { title: tx('Cover outlets and light fixtures', 'Cubrir tomacorrientes y lámparas'), who: 'w2', due: 0, status: 'doing', pri: 'high' },
      { title: tx('Before and after photos', 'Fotos de antes y después'), who: 'w6', due: 0 },
      { title: tx('Collect payment when the crew finishes, $780', 'Cobrar cuando termine la cuadrilla, $780'), who: 'u3', due: 0 },
    ],
    log: [{ date: 0, workerId: 'w2', text: tx('On site at 8. Outlets and the doorbell are taped. Koi pond is covered with a tarp, starting on the back wall.', 'En el sitio a las 8. Tomacorrientes y timbre tapados con cinta. El estanque de koi está cubierto con una lona, empiezo por la pared de atrás.') }],
    notes: [
      [-3, 'call', tx("Water spigot on the left side of the house. Don't spray near the koi pond.", 'La llave de agua está del lado izquierdo de la casa. No rociar cerca del estanque de peces koi.')],
      [-1, 'text', tx('Forecast is dry and under 10 mph wind. Good to go.', 'El pronóstico es seco y con viento de menos de 10 mph. Todo listo.')],
    ] });

  k.job({ id: 'j2', name: tx('Monthly storefront cleaning', 'Limpieza mensual de fachada'), clientId: 'c2', type: 'storefront', status: 'progress', price: 720, start: -84, repeat: 'monthly', manager: 'u2',
    scope: tx('Storefront windows inside and out, sidewalk wash, gum removal at the entrance.', 'Ventanas de la fachada por dentro y por fuera, lavado de la acera, quitar chicles en la entrada.'),
    payTerms: tx('$180 per visit, card on file charged the day of the service. Total shown is the 4 visits so far.', '$180 por visita, se cobra a la tarjeta registrada el día del servicio. El total son las 4 visitas hasta ahora.'),
    assign: [{ workerId: 'w3', scope: tx('Windows and sidewalk', 'Ventanas y acera'), price: 300, payType: 'project', rate: 75, qty: 4, status: 'progress' }],
    expenses: [{ date: -60, vendor: tx('Janitorial supply', 'Proveedor de limpieza'), desc: tx('Squeegee rubbers and glass soap', 'Gomas para jalador y jabón para vidrio'), amount: 22 }],
    received: [
      { date: -84, method: 'card', ref: tx('Visit 1', 'Visita 1'), amount: 180 },
      { date: -56, method: 'card', ref: tx('Visit 2', 'Visita 2'), amount: 180 },
      { date: -28, method: 'card', ref: tx('Visit 3', 'Visita 3'), amount: 180 },
    ],
    workerPays: [
      { date: -83, workerId: 'w3', method: 'zelle', amount: 75 },
      { date: -55, workerId: 'w3', method: 'zelle', amount: 75 },
      { date: -27, workerId: 'w3', method: 'zelle', amount: 75 },
    ],
    tasks: [
      { title: tx("Charge the card for today's visit, $180", 'Cobrar a la tarjeta la visita de hoy, $180'), who: 'u3', due: 0, status: 'doing' },
      { title: tx('Photo of the clean entrance for Alicia', 'Foto de la entrada limpia para Alicia'), who: 'w3', status: 'review' },
    ],
    log: [
      { date: -28, workerId: 'w3', text: tx('Done by 6:10. A lot of gum by the door this month, used the hot water lance.', 'Terminé a las 6:10. Mucho chicle junto a la puerta este mes, usé la lanza de agua caliente.') },
      { date: 0, workerId: 'w3', text: tx('Windows and sidewalk done before opening. The awning has green algae, could be an extra.', 'Ventanas y acera listas antes de abrir. El toldo tiene algas verdes, podría ser un extra.') },
    ],
    notes: [[-86, 'visit', tx('Start at 5 am, finish before 6:30. Hose connection is inside, the opener lets us in.', 'Empezar a las 5 am, terminar antes de las 6:30. La toma de agua está adentro, la persona que abre nos deja pasar.')]] });

  k.job({ id: 'j3', name: tx('Gutter cleaning, 3 homes', 'Limpieza de canaletas, 3 casas'), clientId: 'c3', address: '14, 16 and 18 Sample Ct, Absecon, NJ', type: 'gutters', status: 'done', price: 900, start: -20, end: -20, manager: 'u2',
    scope: tx('Clean gutters and downspouts on 3 rental houses, bag the debris, flush every downspout and photo each roofline.', 'Limpiar canaletas y bajantes en 3 casas de renta, embolsar la basura, enjuagar cada bajante y tomar foto de cada techo.'),
    payTerms: tx('$300 per house, paid by check within 15 days.', '$300 por casa, pago con cheque en 15 días.'),
    assign: [
      { workerId: 'w3', scope: tx('Gutters on 3 homes', 'Canaletas de 3 casas'), price: 300, status: 'done' },
      { workerId: 'w6', scope: tx('Ladder helper and bagging', 'Apoyo con la escalera y embolsado'), price: 126, payType: 'hourly', rate: 18, qty: 7, status: 'done' },
    ],
    expenses: [{ date: -20, vendor: tx('Dump fees', 'Vertedero'), desc: tx('Leaves and debris disposal', 'Desecho de hojas y basura'), amount: 40 }],
    received: [{ date: -18, method: 'check', ref: tx('Paid in full', 'Pago total'), amount: 900 }],
    workerPays: [
      { date: -19, workerId: 'w3', method: 'check', ref: '4018', amount: 300 },
      { date: -19, workerId: 'w6', method: 'cash', amount: 126, payType: 'hourly', from: -20, to: -20 },
    ],
    tasks: [{ title: tx('Send the roofline photos to Trevor', 'Mandarle a Trevor las fotos de los techos'), who: 'u3', due: -19, status: 'done' }],
    log: [{ date: -20, workerId: 'w3', text: tx('All three done. House 16 has a loose downspout strap in the back, photo attached. Did not fix it, not in the job.', 'Las tres listas. La casa 16 tiene una abrazadera de bajante suelta atrás, va la foto. No la arreglé, no está en el trabajo.') }],
    notes: [[-22, 'email', tx('Trevor wants this every fall. Remind him next year in September.', 'Trevor lo quiere cada otoño. Recordarle el año que viene en septiembre.')]] });

  k.job({ id: 'j4', name: tx('Building wash, 6 townhome buildings', 'Lavado de 6 edificios de townhomes'), clientId: 'c4', type: 'house', status: 'progress', price: 9600, start: -3, end: 4, manager: 'u1', leadId: 'l12',
    scope: tx('Soft wash siding and trim on 6 townhome buildings (24 units), pressure wash front walks and steps, rinse plants before and after. One building per day.', 'Lavado suave de revestimiento y molduras en 6 edificios de townhomes (24 unidades), lavado a presión de caminos de entrada y escalones, enjuagar plantas antes y después. Un edificio por día.'),
    payTerms: tx('One third deposit, one third after building 3, balance at the final walkthrough with the board.', 'Un tercio de depósito, un tercio después del edificio 3, el resto en el recorrido final con la mesa directiva.'),
    assign: [
      { workerId: 'w1', scope: tx('Crew lead, soft wash', 'Líder de cuadrilla, lavado suave'), price: 1200, payType: 'daily', rate: 200, qty: 6, status: 'progress' },
      { workerId: 'w2', scope: tx('Walks, steps and rinse', 'Caminos de entrada, escalones y enjuague'), price: 960, payType: 'daily', rate: 160, qty: 6, status: 'progress' },
      { workerId: 'w4', scope: tx('High gables from the lift', 'Partes altas desde la plataforma'), price: 760, payType: 'daily', rate: 190, qty: 4, status: 'progress' },
      { workerId: 'w6', scope: tx('Hoses, plant covers and cleanup', 'Mangueras, cubrir plantas y limpieza'), price: 720, payType: 'hourly', rate: 18, qty: 40, status: 'progress' },
    ],
    expenses: [
      { date: -4, vendor: chem, desc: tx('Sodium hypochlorite, 2 drums, and surfactant', 'Hipoclorito de sodio, 2 tambores, y surfactante'), amount: 620 },
      { date: -3, vendor: tx('Equipment rental', 'Renta de equipo'), desc: tx('Towable lift, 1 week', 'Plataforma elevadora remolcable, 1 semana'), amount: 880 },
      { date: -2, vendor: gas, desc: tx('Gas for the washers and the truck', 'Gasolina para las hidrolavadoras y la camioneta'), amount: 140 },
    ],
    received: [{ date: -6, method: 'transfer', ref: tx('Deposit', 'Depósito'), amount: 3200 }],
    workerPays: [
      { date: -1, workerId: 'w1', method: 'zelle', amount: 600, payType: 'daily', from: -3, to: -1 },
      { date: -1, workerId: 'w2', method: 'zelle', amount: 480, payType: 'daily', from: -3, to: -1 },
      { date: -1, workerId: 'w4', method: 'zelle', amount: 380, payType: 'daily', from: -2, to: -1 },
      { date: -1, workerId: 'w6', method: 'cash', amount: 216, payType: 'hourly', from: -3, to: -1 },
    ],
    tasks: [
      { title: tx('48-hour notice delivered to buildings 1 to 3', 'Aviso de 48 horas entregado en los edificios 1 a 3'), who: 'u3', due: -5, status: 'done' },
      { title: tx('Invoice the second payment after building 3', 'Facturar el segundo pago después del edificio 3'), who: 'u3', due: 1, pri: 'high' },
      { title: tx('Building 4: soft wash and rinse', 'Edificio 4: lavado suave y enjuague'), who: 'w1', due: 0, status: 'doing' },
      { title: tx('48-hour notice for buildings 5 and 6', 'Aviso de 48 horas para los edificios 5 y 6'), who: 'u3', due: -1, pri: 'high' },
      { title: tx('Unit 12 says a window screen was bent, check and take photos', 'La unidad 12 dice que se dobló un mosquitero, revisar y tomar fotos'), who: 'w1', due: 1, status: 'review' },
      { title: tx('Cover the plants at building 5 before the wash', 'Cubrir las plantas del edificio 5 antes del lavado'), who: 'w6', due: 1 },
      { title: tx('High gables on buildings 4 to 6', 'Partes altas de los edificios 4 a 6'), who: 'w4', due: 3 },
      { title: tx('Test spot on the oxidized siding of building 5', 'Punto de prueba en el revestimiento oxidado del edificio 5'), who: 'w1', due: 1, pri: 'high' },
      { title: tx('Final walkthrough with the board', 'Recorrido final con la mesa directiva'), who: 'u1', due: 5 },
    ],
    log: [
      { date: -2, workerId: 'w1', text: tx('Building 2 done. North side had heavy algae, needed two passes. Plants rinsed, no burn.', 'Edificio 2 listo. El lado norte tenía muchas algas, hicieron falta dos pasadas. Plantas enjuagadas, sin quemaduras.') },
      { date: -1, workerId: 'w4', text: tx('Gables on buildings 2 and 3 done from the lift. One vent cover is loose on building 3, left it as found.', 'Las partes altas de los edificios 2 y 3 quedaron desde la plataforma. Hay una tapa de ventilación suelta en el edificio 3, la dejé como estaba.') },
      { date: -1, workerId: 'w6', text: tx('Two cars were still parked at building 3, we worked around them. Residents need the reminder again.', 'Había dos autos estacionados en el edificio 3, trabajamos alrededor. Hay que recordarles otra vez a los residentes.') },
    ],
    notes: [
      [-10, 'visit', tx('Walked all 6 buildings with Gail. Water from the common spigots, key from the maintenance shed. Oxidized siding on building 5, test a spot first.', 'Recorrí los 6 edificios con Gail. Agua de las llaves comunes, la llave está en la bodega de mantenimiento. El revestimiento del edificio 5 está oxidado, probar primero en un punto.')],
      [-1, 'call', tx('Gail is happy with the first three buildings. A resident in unit 12 reported a bent screen, we check it tomorrow.', 'Gail está contenta con los tres primeros edificios. Un residente de la unidad 12 reportó un mosquitero doblado, lo revisamos mañana.')],
    ] });

  k.job({ id: 'j5', name: tx('Roof soft wash', 'Lavado suave de techo'), clientId: 'c5', type: 'roof', status: 'done', price: 850, start: -30, end: -30, manager: 'u1',
    scope: tx('Soft wash asphalt shingle roof to remove black streaks and moss, low pressure only. Protect plants and rinse gutters after.', 'Lavado suave del techo de teja asfáltica para quitar rayas negras y musgo, solo a baja presión. Proteger las plantas y enjuagar las canaletas al final.'),
    payTerms: tx('Paid in full on completion.', 'Pago total al terminar.'),
    assign: [
      { workerId: 'w4', scope: tx('Roof soft wash', 'Lavado suave del techo'), price: 190, payType: 'daily', rate: 190, qty: 1, status: 'done' },
      { workerId: 'w6', scope: tx('Ground help and plant rinse', 'Apoyo en tierra y enjuague de plantas'), price: 108, payType: 'hourly', rate: 18, qty: 6, status: 'done' },
    ],
    expenses: [{ date: -31, vendor: chem, desc: tx('Roof mix and plant neutralizer', 'Mezcla para techo y neutralizador para plantas'), amount: 95 }],
    received: [{ date: -30, method: 'zelle', ref: tx('Paid in full', 'Pago total'), amount: 850 }],
    workerPays: [
      { date: -29, workerId: 'w4', method: 'zelle', amount: 190, payType: 'daily', from: -30, to: -30 },
      { date: -29, workerId: 'w6', method: 'cash', amount: 108, payType: 'hourly', from: -30, to: -30 },
    ],
    tasks: [{ title: tx('Ask Anthony for a review with the before and after photos', 'Pedirle a Anthony una reseña con las fotos de antes y después'), who: 'u3', due: -27, status: 'done', pri: 'low' }],
    log: [{ date: -30, workerId: 'w4', text: tx('Streaks are gone. The moss on the north side will fall off with the next rains, I told the client.', 'Las rayas desaparecieron. El musgo del lado norte se cae con las próximas lluvias, ya le avisé al cliente.') }],
    notes: [[-33, 'call', tx('Roof is 12 years old. He got a letter from his insurance about the streaks.', 'El techo tiene 12 años. Le llegó una carta de su aseguradora por las rayas.')]] });

  k.job({ id: 'j6', name: tx('Sidewalk and dumpster pad wash', 'Lavado de acera y área de contenedores'), clientId: 'c6', type: 'concrete', status: 'progress', price: 1320, start: -72, repeat: 'biweekly', manager: 'u2',
    scope: tx('Every 2 weeks: hot water wash of the front sidewalk, the patio and the dumpster pad with degreaser. Rinse toward the drain, never toward the bay.', 'Cada 2 semanas: lavado con agua caliente de la acera de enfrente, la terraza y el área de contenedores con desengrasante. Enjuagar hacia el drenaje, nunca hacia la bahía.'),
    payTerms: tx('$220 per visit, invoiced every 2 visits ($440). Total shown is the 6 visits so far.', '$220 por visita, se factura cada 2 visitas ($440). El total son las 6 visitas hasta ahora.'),
    assign: [{ workerId: 'w2', scope: tx('Hot water wash, half day per visit', 'Lavado con agua caliente, medio día por visita'), price: 480, payType: 'daily', rate: 80, qty: 6, status: 'progress' }],
    expenses: [
      { date: -70, vendor: chem, desc: tx('Degreaser, 5 gallons', 'Desengrasante, 5 galones'), amount: 48 },
      { date: -30, vendor: chem, desc: tx('Degreaser, 5 gallons', 'Desengrasante, 5 galones'), amount: 48 },
    ],
    received: [
      { date: -42, method: 'check', ref: tx('Invoice 1, visits 1 and 2', 'Factura 1, visitas 1 y 2'), amount: 440 },
      { date: 0, method: 'check', ref: tx('Invoice 2, visits 3 and 4', 'Factura 2, visitas 3 y 4'), amount: 440 },
    ],
    workerPays: [
      { date: -44, workerId: 'w2', method: 'cash', amount: 160, payType: 'daily', from: -72, to: -58 },
      { date: -16, workerId: 'w2', method: 'cash', amount: 160, payType: 'daily', from: -44, to: -30 },
    ],
    tasks: [
      { title: tx('Send invoice 3 (visits 5 and 6), $440', 'Enviar la factura 3 (visitas 5 y 6), $440'), who: 'u3', due: 1 },
      { title: tx('Bring the long lance for the back corner of the pad', 'Llevar la lanza larga para la esquina de atrás del área de contenedores'), who: 'w2', due: 12 },
      { title: tx('Nikos to move the grease barrels before the next visit', 'Nikos debe mover los barriles de grasa antes de la próxima visita'), who: 'u2', due: 10, status: 'waiting' },
    ],
    log: [{ date: -2, workerId: 'w2', text: tx('Pad and sidewalk done. Grease barrels are in the way again, could not reach the back corner.', 'Área de contenedores y acera listas. Los barriles de grasa estorban otra vez, no pude llegar a la esquina de atrás.') }],
    notes: [[-74, 'visit', tx('Wash before 9 am. Hot water machine only, cold does not move the grease. Nikos pays slowly but always pays.', 'Lavar antes de las 9 am. Solo con máquina de agua caliente, la fría no quita la grasa. Nikos paga lento pero siempre paga.')]] });

  k.job({ id: 'j7', name: tx('Office park window cleaning', 'Limpieza de ventanas del parque de oficinas'), clientId: 'c7', type: 'windows', status: 'progress', price: 1920, start: -58, repeat: 'monthly', manager: 'u2',
    scope: tx('Monthly exterior window cleaning on 3 two-story office buildings with water-fed pole, entrance glass inside and out.', 'Limpieza mensual de ventanas exteriores en 3 edificios de oficinas de dos pisos con pértiga de agua, vidrios de las entradas por dentro y por fuera.'),
    payTerms: tx('$640 per visit, invoiced after each visit, due in 15 days. Total shown is the 3 visits so far.', '$640 por visita, se factura después de cada visita, a pagar en 15 días. El total son las 3 visitas hasta ahora.'),
    assign: [
      { workerId: 'w3', scope: tx('Water-fed pole, second floor', 'Pértiga de agua, segundo piso'), price: 660, payType: 'project', rate: 220, qty: 3, status: 'progress' },
      { workerId: 'w5', scope: tx('Ground floor and entrance glass, 6 hours per visit', 'Planta baja y vidrios de entrada, 6 horas por visita'), price: 396, payType: 'hourly', rate: 22, qty: 18, status: 'progress' },
    ],
    expenses: [
      { date: -58, vendor: tx('Janitorial supply', 'Proveedor de limpieza'), desc: tx('Resin for the water filter', 'Resina para el filtro de agua'), amount: 44 },
      { date: -2, vendor: tx('Janitorial supply', 'Proveedor de limpieza'), desc: tx('Scrubber sleeves and squeegee rubbers', 'Fundas de mojador y gomas de jalador'), amount: 22 },
    ],
    received: [
      { date: -50, method: 'check', ref: tx('Visit 1', 'Visita 1'), amount: 640 },
      { date: -21, method: 'check', ref: tx('Visit 2', 'Visita 2'), amount: 640 },
    ],
    workerPays: [
      { date: -57, workerId: 'w3', method: 'zelle', amount: 220 },
      { date: -57, workerId: 'w5', method: 'zelle', amount: 132, payType: 'hourly', from: -58, to: -58 },
      { date: -29, workerId: 'w3', method: 'zelle', amount: 220 },
      { date: -29, workerId: 'w5', method: 'zelle', amount: 132, payType: 'hourly', from: -30, to: -30 },
    ],
    tasks: [
      { title: tx('Send the invoice for visit 3', 'Enviar la factura de la visita 3'), who: 'u3', due: -1, status: 'done' },
      { title: tx('Treat the hard water spots on building B', 'Tratar las manchas de sarro del edificio B'), who: 'w5', due: 26, pri: 'low' },
      { title: tx('Suite 204 asked for inside glass, price it as an extra', 'La suite 204 pidió vidrios por dentro, cotizarlo como extra'), who: 'u2', due: 2 },
    ],
    log: [{ date: -2, workerId: 'w5', text: tx('Ground floor done on all three buildings. Sprinklers leave hard water spots on building B, they come back every month.', 'Planta baja lista en los tres edificios. Los aspersores dejan manchas de sarro en el edificio B, vuelven cada mes.') }],
    notes: [[-60, 'visit', tx('Work on Wednesdays, the lot is half empty. Water from the spigot behind building A.', 'Trabajar los miércoles, el estacionamiento está medio vacío. Agua de la llave detrás del edificio A.')]] });

  k.job({ id: 'j8', name: tx('Deck and fence wash', 'Lavado de deck y cerca'), clientId: 'c8', type: 'deck', status: 'done', price: 520, start: -8, end: -8, manager: 'u2', leadId: 'l13',
    scope: tx('Clean and brighten a 300 sq ft wood deck and 80 ft of cedar fence at low pressure. No staining.', 'Limpiar y aclarar un deck de madera de 300 pies cuadrados y 80 pies de cerca de cedro a baja presión. Sin teñir.'),
    payTerms: tx('50% deposit by card, balance the day of the service.', '50% de depósito con tarjeta, el resto el día del servicio.'),
    assign: [
      { workerId: 'w2', scope: tx('Deck and fence', 'Deck y cerca'), price: 160, payType: 'daily', rate: 160, qty: 1, status: 'done' },
      { workerId: 'w6', scope: tx('Moving furniture and rinse', 'Mover muebles y enjuague'), price: 126, payType: 'hourly', rate: 18, qty: 7, status: 'done' },
    ],
    expenses: [{ date: -9, vendor: chem, desc: tx('Wood cleaner and brightener', 'Limpiador y aclarador de madera'), amount: 58 }],
    received: [{ date: -10, method: 'card', ref: tx('Deposit', 'Depósito'), amount: 260 }],
    workerPays: [
      { date: -7, workerId: 'w2', method: 'zelle', amount: 160, payType: 'daily', from: -8, to: -8 },
      { date: -7, workerId: 'w6', method: 'cash', amount: 126, payType: 'hourly', from: -8, to: -8 },
    ],
    tasks: [
      { title: tx('Call Claire about the $260 balance', 'Llamar a Claire por el saldo de $260'), who: 'u3', due: -4, pri: 'high' },
      { title: tx('Send her the name of a deck stain crew', 'Mandarle el nombre de una cuadrilla que tiñe decks'), who: 'u2', due: -6, status: 'done', pri: 'low' },
    ],
    log: [{ date: -8, workerId: 'w2', text: tx('Deck and fence came out clean. Two boards by the steps are soft, I showed her. Wood needs 2 dry days before stain.', 'El deck y la cerca quedaron limpios. Dos tablas junto a los escalones están blandas, se las enseñé. La madera necesita 2 días secos antes de teñir.') }],
    notes: [[-8, 'text', tx('Claire was at work when we finished. She said she will pay the rest by card over the phone. No answer yet.', 'Claire estaba en el trabajo cuando terminamos. Dijo que paga el resto con tarjeta por teléfono. Todavía no contesta.')]] });

  k.job({ id: 'j9', name: tx('Paver patio and pool deck cleaning', 'Limpieza de patio de adoquín y área de piscina'), clientId: 'c9', type: 'concrete', status: 'hold', price: 690, manager: 'u2',
    scope: tx('Surface clean 900 sq ft of pavers around the pool, treat the black spots and re-sand the joints with polymeric sand.', 'Limpiar con disco 900 pies cuadrados de adoquín alrededor de la piscina, tratar las manchas negras y volver a poner arena polimérica en las juntas.'),
    payTerms: tx('Paid in full on completion.', 'Pago total al terminar.'),
    tasks: [
      { title: tx('Ask the Peña family for the pool closing date', 'Preguntar a la familia Peña la fecha de cierre de la piscina'), who: 'u2', due: 4, status: 'waiting' },
    ],
    notes: [
      [-5, 'note', tx('ON HOLD: we cannot wash with the pool open, dirty water and sand would run into it. The pool company closes and covers it in about 10 days. Reschedule right after.', 'EN PAUSA: no podemos lavar con la piscina abierta, el agua sucia y la arena escurrirían hacia ella. La compañía de piscinas la cierra y la cubre en unos 10 días. Reagendar justo después.')],
      [-4, 'call', tx('Marta agreed to wait. She will text when the cover is on.', 'Marta está de acuerdo en esperar. Manda texto cuando esté puesta la cubierta.')],
    ] });

  k.job({ id: 'j10', name: tx('Fleet washing, 8 vans', 'Lavado de flotilla, 8 camionetas'), clientId: 'c10', type: 'other', status: 'progress', price: 1800, start: -65, repeat: 'biweekly', manager: 'u2',
    scope: tx('Every 2 weeks on Saturday morning: wash 8 service vans in the yard, wheels and windows included. We bring the water tank.', 'Cada 2 semanas el sábado en la mañana: lavar 8 camionetas de servicio en el patio, con rines y vidrios. Llevamos el tanque de agua.'),
    payTerms: tx('$45 per van ($360 per visit), invoiced every 2 visits ($720). Total shown is the 5 visits so far.', '$45 por camioneta ($360 por visita), se factura cada 2 visitas ($720). El total son las 5 visitas hasta ahora.'),
    assign: [
      { workerId: 'w2', scope: tx('Wash and rinse', 'Lavado y enjuague'), price: 450, payType: 'daily', rate: 90, qty: 5, status: 'progress' },
      { workerId: 'w6', scope: tx('Wheels, windows and drying, 4 hours per visit', 'Rines, vidrios y secado, 4 horas por visita'), price: 360, payType: 'hourly', rate: 18, qty: 20, status: 'progress' },
    ],
    expenses: [
      { date: -64, vendor: chem, desc: tx('Truck wash soap, 5 gallons', 'Jabón para camiones, 5 galones'), amount: 62 },
      { date: -22, vendor: chem, desc: tx('Truck wash soap, 5 gallons', 'Jabón para camiones, 5 galones'), amount: 62 },
    ],
    received: [
      { date: -36, method: 'transfer', ref: tx('Invoice 1, visits 1 and 2', 'Factura 1, visitas 1 y 2'), amount: 720 },
      { date: 0, method: 'transfer', ref: tx('Invoice 2, visits 3 and 4', 'Factura 2, visitas 3 y 4'), amount: 720 },
    ],
    workerPays: [
      { date: -51, workerId: 'w2', method: 'cash', amount: 180, payType: 'daily', from: -65, to: -51 },
      { date: -51, workerId: 'w6', method: 'cash', amount: 144, payType: 'hourly', from: -65, to: -51 },
      { date: -23, workerId: 'w2', method: 'cash', amount: 180, payType: 'daily', from: -37, to: -23 },
      { date: -23, workerId: 'w6', method: 'cash', amount: 144, payType: 'hourly', from: -37, to: -23 },
    ],
    tasks: [
      { title: tx('Fill the water tank on Friday night', 'Llenar el tanque de agua el viernes en la noche'), who: 'w2', due: 4 },
      { title: tx('Ed wants a price to add the 2 box trucks', 'Ed quiere precio para sumar los 2 camiones de caja'), who: 'u2', due: 2 },
    ],
    log: [{ date: -9, workerId: 'w6', text: tx('8 vans done in 3 and a half hours. Van 5 had tar on the rocker panels, needed the tar remover.', '8 camionetas en 3 horas y media. La camioneta 5 traía chapopote en los estribos, hizo falta el quitabrea.') }],
    notes: [[-66, 'visit', tx('Vans are parked in the back yard on Saturdays. Gate code from Ed. No water on site, bring the tank full.', 'Las camionetas están en el patio de atrás los sábados. El código del portón lo da Ed. No hay agua en el sitio, llevar el tanque lleno.')]] });

  k.job({ id: 'j11', name: tx('House wash and windows', 'Lavado de casa y ventanas'), clientId: 'c11', type: 'house', status: 'contract', price: 695, start: 5, end: 5, manager: 'u2', leadId: 'l14',
    scope: tx('Soft wash a one-story ranch with vinyl siding, clean 14 windows outside and flush the gutters.', 'Lavado suave de una casa de un piso con revestimiento de vinil, limpiar 14 ventanas por fuera y enjuagar las canaletas.'),
    payTerms: tx('Paid in full on completion.', 'Pago total al terminar.'),
    tasks: [
      { title: tx('Get the agreement signed', 'Conseguir la firma del acuerdo'), who: 'u3', due: 1, status: 'doing', pri: 'high' },
      { title: tx('Check the forecast and confirm the day', 'Revisar el pronóstico y confirmar el día'), who: 'u2', due: 3 },
    ],
    notes: [[-2, 'email', tx('Agreement sent. Grace asked us to be careful with the hydrangeas by the front door.', 'Acuerdo enviado. Grace pidió cuidado con las hortensias junto a la puerta de enfrente.')]] });

  k.job({ id: 'j12', name: tx('Yearly gutter cleaning, 6 buildings', 'Limpieza anual de canaletas, 6 edificios'), clientId: 'c4', type: 'gutters', status: 'estimate', price: 2700, manager: 'u1',
    scope: tx('Clean gutters and downspouts on the 6 townhome buildings after the leaves drop, flush and photo each run.', 'Limpiar canaletas y bajantes de los 6 edificios de townhomes cuando caigan las hojas, enjuagar y tomar foto de cada tramo.'),
    payTerms: tx('$450 per building, paid within 15 days.', '$450 por edificio, a pagar en 15 días.'),
    notes: [[-1, 'call', tx('Gail asked for this while we were washing. She takes it to the board next month.', 'Gail lo pidió mientras lavábamos. Lo lleva a la mesa directiva el próximo mes.')]] });

  k.job({ id: 'j13', name: tx('Apartment complex wash, 8 buildings', 'Lavado de complejo de apartamentos, 8 edificios'), clientId: 'c3', type: 'house', status: 'done', price: 11800, start: -75, end: -68, manager: 'u1',
    scope: tx('Soft wash 8 two-story apartment buildings, pressure wash breezeways, stairs and the dumpster enclosures.', 'Lavado suave de 8 edificios de apartamentos de dos pisos, lavado a presión de pasillos, escaleras y áreas de contenedores.'),
    payTerms: tx('One third deposit, balance by check within 15 days of the final walkthrough.', 'Un tercio de depósito, el resto con cheque dentro de 15 días después del recorrido final.'),
    assign: [
      { workerId: 'w1', scope: tx('Crew lead, soft wash', 'Líder de cuadrilla, lavado suave'), price: 1400, payType: 'daily', rate: 200, qty: 7, status: 'done' },
      { workerId: 'w2', scope: tx('Breezeways and stairs', 'Pasillos y escaleras'), price: 1120, payType: 'daily', rate: 160, qty: 7, status: 'done' },
      { workerId: 'w4', scope: tx('High walls from the lift', 'Paredes altas desde la plataforma'), price: 950, payType: 'daily', rate: 190, qty: 5, status: 'done' },
      { workerId: 'w7', scope: tx('Dumpster enclosures and rinse', 'Áreas de contenedores y enjuague'), price: 960, payType: 'daily', rate: 160, qty: 6, status: 'done' },
    ],
    expenses: [
      { date: -76, vendor: chem, desc: tx('Sodium hypochlorite, 3 drums, and surfactant', 'Hipoclorito de sodio, 3 tambores, y surfactante'), amount: 780 },
      { date: -75, vendor: tx('Equipment rental', 'Renta de equipo'), desc: tx('Towable lift, 8 days', 'Plataforma elevadora remolcable, 8 días'), amount: 1240 },
      { date: -70, vendor: gas, desc: tx('Gas for the washers and the truck', 'Gasolina para las hidrolavadoras y la camioneta'), amount: 190 },
    ],
    received: [
      { date: -80, method: 'check', ref: tx('Deposit', 'Depósito'), amount: 3900 },
      { date: -56, method: 'check', ref: tx('Balance', 'Saldo'), amount: 7900 },
    ],
    workerPays: [
      { date: -71, workerId: 'w1', method: 'zelle', amount: 800, payType: 'daily', from: -75, to: -72 },
      { date: -71, workerId: 'w2', method: 'zelle', amount: 640, payType: 'daily', from: -75, to: -72 },
      { date: -68, workerId: 'w1', method: 'zelle', amount: 600, payType: 'daily', from: -71, to: -68 },
      { date: -68, workerId: 'w2', method: 'zelle', amount: 480, payType: 'daily', from: -71, to: -68 },
      { date: -68, workerId: 'w4', method: 'zelle', amount: 950, payType: 'daily', from: -74, to: -69 },
      { date: -68, workerId: 'w7', method: 'card', amount: 960, payType: 'daily', from: -75, to: -69 },
    ],
    tasks: [
      { title: tx('Final walkthrough with Trevor', 'Recorrido final con Trevor'), who: 'u1', due: -67, status: 'done' },
      { title: tx('Send the before and after photo set', 'Mandar el juego de fotos de antes y después'), who: 'u3', due: -66, status: 'done' },
    ],
    log: [
      { date: -72, workerId: 'w1', text: tx('Four buildings done. Building C had bird nests in two light fixtures, washed around them.', 'Cuatro edificios listos. El edificio C tenía nidos de pájaros en dos lámparas, lavamos alrededor.') },
      { date: -68, workerId: 'w7', text: tx('Dumpster enclosures finished, they were the worst part. Rinsed the parking spots next to them too.', 'Áreas de contenedores terminadas, eran lo peor. También enjuagué los cajones de estacionamiento de al lado.') },
    ],
    notes: [
      [-82, 'visit', tx('Trevor needs the certificate of insurance before we start. Tenants get a notice on every door 2 days before their building.', 'Trevor pide el certificado de seguro antes de empezar. A los inquilinos se les deja aviso en cada puerta 2 días antes de su edificio.')],
      [-56, 'call', tx('Trevor paid the balance and asked about the gutters on his 3 rental houses.', 'Trevor pagó el saldo y preguntó por las canaletas de sus 3 casas de renta.')],
    ] });

  // the one job that lost money, with the reason written down
  k.job({ id: 'j14', name: tx('House wash, two visits', 'Lavado de casa, dos visitas'), clientId: 'c12', type: 'house', status: 'done', price: 450, start: -41, end: -40, manager: 'u1',
    scope: tx('Soft wash a two-story house with older aluminum siding.', 'Lavado suave de una casa de dos pisos con revestimiento de aluminio viejo.'),
    payTerms: tx('Paid in full on completion.', 'Pago total al terminar.'),
    assign: [
      { workerId: 'w1', scope: tx('House wash and second visit to even out the streaks', 'Lavado de la casa y segunda visita para emparejar las rayas'), price: 400, payType: 'daily', rate: 200, qty: 2, status: 'done' },
      { workerId: 'w2', scope: tx('Rinse and plant protection', 'Enjuague y protección de plantas'), price: 160, payType: 'daily', rate: 160, qty: 1, status: 'done' },
    ],
    expenses: [{ date: -41, vendor: chem, desc: tx('Sodium hypochlorite, surfactant and oxidation cleaner', 'Hipoclorito de sodio, surfactante y limpiador de oxidación'), amount: 64 }],
    received: [{ date: -40, method: 'check', ref: tx('Paid in full', 'Pago total'), amount: 450 }],
    workerPays: [
      { date: -39, workerId: 'w1', method: 'zelle', amount: 400, payType: 'daily', from: -41, to: -40 },
      { date: -39, workerId: 'w2', method: 'zelle', amount: 160, payType: 'daily', from: -41, to: -41 },
    ],
    tasks: [{ title: tx('Add an oxidation test to the estimate checklist', 'Agregar la prueba de oxidación a la lista del presupuesto'), who: 'u1', due: -37, status: 'done' }],
    log: [{ date: -41, workerId: 'w1', text: tx('The siding is chalky and the wash left streaks on the sunny side. We have to come back tomorrow with the oxidation cleaner and brush it by hand.', 'El revestimiento suelta polvo y el lavado dejó rayas del lado del sol. Hay que regresar mañana con el limpiador de oxidación y cepillarlo a mano.') }],
    notes: [
      [-40, 'note', tx('We lost money here. The siding was oxidized and the first wash left streaks, so we came back a second day at no charge. From now on we rub a test spot at every estimate and warn the client in writing.', 'Aquí perdimos dinero. El revestimiento estaba oxidado y el primer lavado dejó rayas, así que regresamos un segundo día sin cobrar. Desde ahora frotamos un punto de prueba en cada presupuesto y avisamos al cliente por escrito.')],
      [-40, 'call', tx('Walter is satisfied with the result. Phone calls only.', 'Walter quedó conforme con el resultado. Solo llamadas.')],
    ] });

  /* ---------- leads ---------- */
  k.lead({ id: 'l1', name: 'Linda Park', phone: '609-555-0151', email: 'linda@example.com', address: '38 Sample Ln, Linwood, NJ', type: 'house', source: 'website', status: 'scheduled', pri: 'high', value: 650, appt: [day(2), '10:00'], created: -2,
    notes: [[-2, 'note', tx('Two-story vinyl siding with green algae on the north side. Wants the driveway too.', 'Dos pisos de revestimiento de vinil con algas verdes del lado norte. También quiere la entrada de autos.')]] });
  k.lead({ id: 'l2', name: 'Stavros Demos', company: 'Shore Sample Diner', phone: '609-555-0152', address: '210 Sample Ave, Somers Point, NJ', type: 'storefront', source: 'phone', status: 'new', value: 180, followUp: 0, created: -1,
    notes: [[-1, 'call', tx('Wants storefront windows and sidewalk washed every month before opening.', 'Quiere las ventanas de la fachada y la acera lavadas cada mes antes de abrir.')]] });
  k.lead({ id: 'l3', name: 'Héctor Maldonado', phone: '609-555-0153', address: '17 Sample Ct, Pleasantville, NJ', type: 'concrete', source: 'google', status: 'new', created: 0,
    notes: [[0, 'call', tx('Driveway with oil stains and a paver walkway. Asked if we seal after washing. Prefers Spanish.', 'Entrada de autos con manchas de aceite y un camino de adoquín. Preguntó si sellamos después de lavar. Prefiere español.')]] });
  k.lead({ id: 'l4', name: 'Jasmine Tate', phone: '609-555-0154', email: 'jasmine@example.com', address: '82 Sample Dr, Mays Landing, NJ', type: 'deck', source: 'facebook', status: 'new', pri: 'low', created: 0,
    notes: [[0, 'text', tx('Facebook message with photos: gray wood deck, about 250 sq ft, and a vinyl fence with green spots.', 'Mensaje por Facebook con fotos: deck de madera gris, unos 250 pies cuadrados, y una cerca de vinil con manchas verdes.')]] });
  k.lead({ id: 'l5', name: 'Vince Carbone', company: 'Sample Auto Sales', phone: '609-555-0155', email: 'autosales@example.com', address: '1500 Sample Pike, Egg Harbor Twp, NJ', type: 'storefront', source: 'phone', status: 'contacted', value: 1450, followUp: -2, created: -8,
    notes: [[-8, 'call', tx('Wants the showroom glass, the building and the front lot washed before a sales event.', 'Quiere lavar los vidrios de la sala de ventas, el edificio y el lote de enfrente antes de un evento de ventas.')],
      [-5, 'call', tx('Gave him a range by phone. He wants a visit but has not picked a day.', 'Le di un rango por teléfono. Quiere visita pero no ha elegido día.')]] });
  k.lead({ id: 'l6', name: 'Margaret Flynn', phone: '609-555-0156', email: 'margaret@example.com', address: '4 Sample Way, Ocean City, NJ', type: 'windows', source: 'referral', status: 'contacted', value: 320, followUp: day(1), created: -3, owner: 'u2',
    notes: [[-3, 'call', tx('Referred by Anthony Russo. 22 windows with salt spray, second floor needs the pole.', 'Recomendada por Anthony Russo. 22 ventanas con salitre, el segundo piso necesita la pértiga.')]] });
  k.lead({ id: 'l7', name: 'Rosa Delgado', phone: '609-555-0157', email: 'rosa@example.com', address: '29 Sample St, Absecon, NJ', type: 'roof', source: 'instagram', status: 'scheduled', value: 1250, appt: [0, '13:00'], created: -3,
    notes: [[-3, 'text', tx('Saw the roof video on Instagram. Black streaks on the roof and algae on the siding, wants both.', 'Vio el video del techo en Instagram. Rayas negras en el techo y algas en el revestimiento, quiere las dos cosas.')]] });
  k.lead({ id: 'l8', name: 'Rick Tanaka', company: 'Dockside Sample Marina', phone: '609-555-0158', email: 'marina@example.com', address: '1 Sample Harbor Rd, Somers Point, NJ', type: 'other', source: 'google', status: 'scheduled', pri: 'high', value: 4800, appt: [day(1), '09:30'], created: -6, owner: 'u1',
    notes: [[-6, 'call', tx('Docks and the boardwalk are slippery with algae. About 6,000 sq ft of wood. Needs it before they haul the boats out.', 'Los muelles y el paseo de madera están resbalosos por las algas. Unos 6,000 pies cuadrados de madera. Lo necesita antes de sacar los botes.')]] });
  k.lead({ id: 'l9', name: 'Ben Holloway', phone: '609-555-0159', email: 'ben@example.com', address: '51 Sample Rd, Northfield, NJ', type: 'gutters', source: 'website', status: 'scheduled', value: 240, appt: [day(4), '15:00'], created: -1, owner: 'u2',
    notes: [[-1, 'note', tx('Website request: gutters overflow at the back corner. Two-story colonial with pine trees.', 'Solicitud del sitio web: las canaletas se desbordan en la esquina de atrás. Casa de dos pisos con pinos.')]] });
  k.lead({ id: 'l10', name: 'Carol Bennett', company: 'Ocean Sample Townhomes HOA', phone: '609-555-0160', email: 'oceantownhomes@example.com', address: '20 Sample Shore Dr, Brigantine, NJ', type: 'house', source: 'referral', status: 'sent', pri: 'high', value: 7400, followUp: day(2), created: -15, owner: 'u1',
    notes: [[-15, 'call', tx('Referred by Gail at Mill Pond. 5 buildings near the beach, salt and algae on the north walls.', 'Recomendada por Gail de Mill Pond. 5 edificios cerca de la playa, salitre y algas en las paredes del norte.')],
      [-11, 'visit', tx('Walked the buildings. Cedar shake on two of them, soft wash only.', 'Recorrí los edificios. Dos tienen tejamanil de cedro, solo lavado suave.')],
      [-9, 'email', tx('Estimate sent for $7,400. The board votes at the next meeting.', 'Presupuesto enviado por $7,400. La mesa directiva vota en la próxima junta.')]] });
  k.lead({ id: 'l11', name: 'Samir Qureshi', phone: '609-555-0161', email: 'samir@example.com', address: '73 Sample Pl, Galloway, NJ', type: 'roof', source: 'google', status: 'sent', value: 780, followUp: 0, created: -10,
    notes: [[-10, 'call', tx('Roof streaks on the front side only. Asked if it voids the shingle warranty, explained the low pressure method.', 'Rayas en el techo solo del lado de enfrente. Preguntó si anula la garantía de las tejas, le expliqué el método de baja presión.')],
      [-7, 'email', tx('Estimate sent for $780. Follow up today.', 'Presupuesto enviado por $780. Darle seguimiento hoy.')]] });
  k.lead({ id: 'l12', name: 'Gail Winters', company: 'Mill Pond Sample HOA', phone: '609-555-0104', email: 'millpondhoa@example.com', address: '1 Sample Mill Pond Dr, Egg Harbor Twp, NJ', type: 'house', source: 'referral', status: 'won', value: 9600, created: -16, clientId: 'c4', jobId: 'j4',
    notes: [[-16, 'call', tx('Referred by Trevor Banks. Six townhome buildings, green siding on the shaded sides.', 'Recomendada por Trevor Banks. Seis edificios de townhomes, revestimiento verde en los lados con sombra.')],
      [-10, 'visit', tx('Board approved $9,600. Start as soon as the notices go out.', 'La mesa directiva aprobó $9,600. Empezamos en cuanto salgan los avisos.')]] });
  k.lead({ id: 'l13', name: 'Claire Donovan', phone: '609-555-0108', email: 'claire@example.com', address: '27 Sample Ave, Linwood, NJ', type: 'deck', source: 'instagram', status: 'won', value: 520, created: -18, clientId: 'c8', jobId: 'j8', owner: 'u2',
    notes: [[-18, 'text', tx('Instagram message: wants the deck and fence cleaned before staining.', 'Mensaje por Instagram: quiere limpiar el deck y la cerca antes de teñir.')],
      [-10, 'call', tx('Booked, deposit paid by card.', 'Reservado, depósito pagado con tarjeta.')]] });
  k.lead({ id: 'l14', name: 'Grace Okafor', phone: '609-555-0111', email: 'grace@example.com', address: '5 Sample Ter, Absecon, NJ', type: 'house', source: 'website', status: 'won', value: 695, created: -5, clientId: 'c11', jobId: 'j11', owner: 'u2',
    notes: [[-5, 'note', tx('Website request with photos. One-story ranch, wants the house, windows and gutters in one visit.', 'Solicitud del sitio web con fotos. Casa de un piso, quiere casa, ventanas y canaletas en una sola visita.')],
      [-3, 'call', tx('Accepted $695 by phone. Agreement goes out today.', 'Aceptó $695 por teléfono. El acuerdo sale hoy.')]] });
  k.lead({ id: 'l15', name: 'Pete Garrison', phone: '609-555-0162', address: '66 Sample Blvd, Egg Harbor City, NJ', type: 'house', source: 'other', status: 'lost', value: 400, created: -27,
    lostReason: tx('Decided to rent a machine and do it himself.', 'Decidió rentar una máquina y hacerlo él mismo.'),
    notes: [[-27, 'call', tx('Called from our door hanger. One-story house, mostly green on the back.', 'Llamó por el volante que dejamos en su puerta. Casa de un piso, verde sobre todo atrás.')]] });
  k.lead({ id: 'l16', name: 'Lorraine Katz', company: 'Sample Shopping Plaza', phone: '609-555-0163', email: 'shoppingplaza@example.com', address: '2000 Sample Pike, Egg Harbor Twp, NJ', type: 'storefront', source: 'phone', status: 'lost', value: 12000, created: -40,
    lostReason: tx('The management company requires a $5 million umbrella policy. We carry $2 million.', 'La administradora exige una póliza paraguas de $5 millones. Nosotros tenemos $2 millones.'),
    notes: [[-40, 'call', tx('Quarterly sidewalk and storefront washing for a plaza with 14 stores.', 'Lavado trimestral de aceras y fachadas para una plaza con 14 locales.')],
      [-34, 'email', tx('Their vendor form asks for $5 million in umbrella coverage. Asked our agent for a price, too expensive for one account.', 'Su formulario de proveedores pide $5 millones de cobertura paraguas. Pedí precio a nuestro agente, muy caro para una sola cuenta.')]] });

  /* ---------- office tasks ---------- */
  k.task({ title: tx('Call Vince Carbone to set the visit at Sample Auto Sales', 'Llamar a Vince Carbone para agendar la visita en Sample Auto Sales'), who: 'u1', due: -2, leadId: 'l5' });
  k.task({ title: tx('Get the W-9 from Jonathan Reyes', 'Conseguir el W-9 de Jonathan Reyes'), who: 'u3', due: -3, pri: 'high', description: tx('He is on three active jobs and already over the 1099 amount for the year.', 'Está en tres trabajos activos y ya pasó el monto del 1099 de este año.') });
  k.task({ title: tx('Ask Sergio Navarro for his renewed insurance certificate', 'Pedirle a Sergio Navarro su certificado de seguro renovado'), who: 'u3', due: 1, status: 'waiting', pri: 'high' });
  k.task({ title: tx('Order 2 drums of sodium hypochlorite and surfactant', 'Pedir 2 tambores de hipoclorito de sodio y surfactante'), who: 'u2', due: 1, status: 'doing' });
  k.task({ title: tx('Replace the surface cleaner swivel and 2 hose gaskets', 'Cambiar el giratorio del disco de lavado y 2 empaques de manguera'), who: 'w1', due: 2 });
  k.task({ title: tx('Check the revised numbers for Ocean Sample Townhomes', 'Revisar los números corregidos de Ocean Sample Townhomes'), who: 'u1', due: 2, status: 'review', leadId: 'l10' });
  k.task({ title: tx('Winterize the trailer rig before the first freeze', 'Preparar el remolque para el invierno antes de la primera helada'), who: 'u2', due: 30, pri: 'low' });

  return k.finish();
}
