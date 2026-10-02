import type { Lang, SeedData } from '@/domain/types';
import { seedKit } from '../seedkit';

/** Sample business for this edition. Fictional data only. */
export function seed(lang: Lang): SeedData {
  const k = seedKit(lang, 'VC-');
  const { tx } = k;
  /** Visits and follow-ups with a prospect never land on a Sunday: move those to Monday. */
  const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.getDay() === 0 ? n + 1 : n; };
  const supply = tx('Cleaning supply store', 'Tienda de productos de limpieza');

  /* ---------- cleaners ---------- */
  k.worker({ id: 'w1', name: 'Rosa Martínez', trade: tx('Lead house cleaner', 'Limpiadora líder de casas'), phone: '609-555-0121', email: 'rosa@example.com', payType: 'daily', rate: 160, w9: 80, coi: 150, insurer: 'Sample Mutual Insurance' });
  // W-9 missing while she is on active jobs
  k.worker({ id: 'w2', name: 'Ana López', trade: tx('House cleaner', 'Limpiadora de casas'), phone: '609-555-0122', email: 'ana@example.com', payType: 'daily', rate: 140, coi: 200, insurer: 'Garden Sample Insurance' });
  // insurance certificate expires within 30 days
  k.worker({ id: 'w3', name: 'Carmen Ruiz', trade: tx('Deep clean specialist', 'Especialista en limpieza profunda'), phone: '609-555-0123', email: 'carmen@example.com', payType: 'project', w9: 30, coi: 20, insurer: 'Garden Sample Insurance' });
  // insurance certificate already expired
  k.worker({ id: 'w4', name: 'Diego Flores', trade: tx('Post-construction crew lead', 'Líder de cuadrilla post-construcción'), phone: '609-555-0124', email: 'diego@example.com', payType: 'weekly', rate: 750, w9: 120, coi: -3, insurer: 'Sample Mutual Insurance' });
  k.worker({ id: 'w5', name: 'Tanisha Greene', trade: tx('Office cleaner (evenings)', 'Limpiadora de oficinas (tardes)'), phone: '609-555-0125', email: 'tanisha@example.com', payType: 'hourly', rate: 22, w9: 95, coi: 180, insurer: 'Shoreline Sample Insurance' });
  k.worker({ id: 'w6', name: 'Marisol Vega', trade: tx('Rental turnover cleaner', 'Limpiadora de rentas vacacionales'), phone: '609-555-0126', email: 'marisol@example.com', payType: 'daily', rate: 150, w9: 118, coi: 240, insurer: 'Shoreline Sample Insurance' });
  k.worker({ id: 'w7', name: "Kevin O'Neill", trade: tx('Carpet, floor and window tech', 'Técnico de alfombras, pisos y ventanas'), phone: '609-555-0127', email: 'kevin@example.com', payType: 'project', w9: 64, coi: 90, insurer: 'Sample Mutual Insurance' });
  // moved away, no longer on the team
  k.worker({ id: 'w8', name: 'Lucía Herrera', trade: tx('House cleaner', 'Limpiadora de casas'), phone: '609-555-0128', email: 'lucia@example.com', payType: 'daily', rate: 140, w9: 300, coi: 45, insurer: 'Garden Sample Insurance', active: false });

  /* ---------- clients ---------- */
  k.client({ id: 'c1', name: 'Michelle Johnson', phone: '609-555-0101', email: 'johnson@example.com', addresses: ['8 Sample Ave, Linwood, NJ'], since: -93,
    note: tx('Dog stays in the backyard. Key in the lockbox by the side door. Do not use bleach on the wood floors.', 'El perro se queda en el patio. La llave está en la caja de llaves junto a la puerta lateral. No usar cloro en los pisos de madera.') });
  k.client({ id: 'c2', name: 'Dana Whitfield', company: 'Sample Realty Group', phone: '609-555-0102', email: 'listings@example.com', addresses: ['22 Sample Rd, Egg Harbor Twp, NJ', '18 Sample Ter, Northfield, NJ'], since: -34,
    note: tx('Listing agent. Sends move-out cleanings before showings, always with a hard deadline. Wants before and after photos every time.', 'Agente de bienes raíces. Manda limpiezas de mudanza antes de mostrar las casas, siempre con hora límite. Quiere fotos de antes y después cada vez.') });
  k.client({ id: 'c3', name: 'Dr. Alan Brooks', company: 'Sample Dental Office', phone: '609-555-0103', email: 'dentaloffice@example.com', addresses: ['140 Sample Plaza, Somers Point, NJ'], since: -88,
    note: tx('Cleaning after 6 pm only. Alarm code comes from the office manager, never write it on paper. Red bins are medical waste, we do not touch them.', 'Limpieza solo después de las 6 pm. El código de la alarma lo da la gerente, nunca apuntarlo en papel. Los botes rojos son desechos médicos, no los tocamos.') });
  k.client({ id: 'c4', name: 'Nick Santoro', company: 'Sample Builders LLC', phone: '609-555-0104', email: 'samplebuilders@example.com', addresses: ['5 Sample Ct, Galloway, NJ', '12 Sample Ave, Galloway, NJ'], since: -47,
    note: tx('Remodeling company. Calls us when a kitchen or bath is finished, usually with two days notice. Pays by check within two weeks.', 'Compañía de remodelaciones. Nos llama cuando termina una cocina o un baño, casi siempre con dos días de aviso. Paga con cheque en dos semanas.') });
  k.client({ id: 'c5', name: 'Vanessa Ortiz', company: 'Shoreline Sample Rentals', phone: '609-555-0105', email: 'shorelinerentals@example.com', addresses: ['31 Sample Beach Ave, Unit A, Ventnor, NJ', '31 Sample Beach Ave, Unit B, Ventnor, NJ'], since: -120,
    note: tx('Two vacation rentals, checkout Saturday at 10 am, check-in at 4 pm. She texts the guest count on Thursday.', 'Dos rentas vacacionales, salida el sábado a las 10 am, entrada a las 4 pm. Manda por texto el número de huéspedes el jueves.') });
  k.client({ id: 'c6', name: 'Deborah Klein', phone: '609-555-0106', email: 'deborah@example.com', addresses: ['64 Sample Pl, Margate, NJ'], since: -78 });
  // her daughter handles everything by phone, no automatic emails
  k.client({ id: 'c7', name: 'Eleanor Whitman', phone: '609-555-0107', email: 'whitman@example.com', addresses: ['9 Sample Way, Ocean City, NJ'], since: -90, emailOptOut: true,
    note: tx('Mrs. Whitman is 84. Her daughter Susan pays and schedules, by phone only. No automatic emails. Ring the bell and wait, she walks slowly.', 'La señora Whitman tiene 84 años. Su hija Susan paga y agenda, solo por teléfono. Nada de correos automáticos. Tocar el timbre y esperar, camina despacio.') });
  k.client({ id: 'c8', name: 'Chris Delgado', company: 'Sample Fitness Studio', phone: '609-555-0108', email: 'fitnessstudio@example.com', addresses: ['77 Sample Blvd, Somers Point, NJ'], since: -40 });
  k.client({ id: 'c9', name: 'Sofía Castellanos', phone: '609-555-0109', email: 'sofia@example.com', addresses: ['15 Sample Dr, Galloway, NJ'], since: -58,
    note: tx('Prefers Spanish. Two cats, keep the front door closed.', 'Prefiere español. Tiene dos gatos, mantener cerrada la puerta de enfrente.') });
  k.client({ id: 'c10', name: 'Raj Mehta', phone: '609-555-0110', email: 'raj@example.com', addresses: ['40 Sample Ln, Egg Harbor Twp, NJ'], since: -21 });
  k.client({ id: 'c11', name: 'Karen Liu', company: 'Atlantic Sample Law Office', phone: '609-555-0111', email: 'lawoffice@example.com', addresses: ['210 Sample St, Suite 4, Northfield, NJ'], since: -70 });

  /* ---------- jobs ---------- */
  k.job({ id: 'j1', name: tx('Weekly home cleaning', 'Limpieza semanal de casa'), clientId: 'c1', type: 'standard', status: 'progress', price: 2560, start: -86, repeat: 'weekly', manager: 'u2',
    scope: tx('Kitchen, 3 bedrooms, 2 bathrooms and living areas. Change bed linens. Dust blinds once a month. Patio door glass inside and out.',
      'Cocina, 3 habitaciones, 2 baños y áreas comunes. Cambiar sábanas. Sacudir persianas una vez al mes. Vidrio de la puerta del patio por dentro y por fuera.'),
    payTerms: tx('$160 per visit. Card on file is charged at the start of every 4 visits ($640). Total shown covers the 16 visits booked so far.', '$160 por visita. Se cobra a la tarjeta registrada al inicio de cada 4 visitas ($640). El total cubre las 16 visitas reservadas hasta ahora.'),
    assign: [{ workerId: 'w1', scope: tx('Whole house, half day per visit', 'Toda la casa, medio día por visita'), price: 1280, payType: 'daily', rate: 80, qty: 16, status: 'progress' }],
    expenses: [
      { date: -80, vendor: supply, desc: tx('Microfiber cloths, all-purpose cleaner', 'Paños de microfibra, limpiador multiusos'), amount: 38 },
      { date: -37, vendor: supply, desc: tx('Wood floor cleaner, vacuum bags', 'Limpiador para piso de madera, bolsas de aspiradora'), amount: 41 },
    ],
    received: [
      { date: -86, method: 'card', ref: tx('Visits 1 to 4', 'Visitas 1 a 4'), amount: 640 },
      { date: -58, method: 'card', ref: tx('Visits 5 to 8', 'Visitas 5 a 8'), amount: 640 },
      { date: -30, method: 'card', ref: tx('Visits 9 to 12', 'Visitas 9 a 12'), amount: 640 },
      { date: -2, method: 'card', ref: tx('Visits 13 to 16', 'Visitas 13 a 16'), amount: 640 },
    ],
    workerPays: [
      { date: -65, workerId: 'w1', method: 'zelle', amount: 320, payType: 'daily', from: -86, to: -65 },
      { date: -37, workerId: 'w1', method: 'zelle', amount: 320, payType: 'daily', from: -58, to: -37 },
      { date: -9, workerId: 'w1', method: 'zelle', amount: 320, payType: 'daily', from: -30, to: -9 },
      { date: -2, workerId: 'w1', method: 'cash', amount: 80, payType: 'daily', from: -2, to: -2 },
    ],
    tasks: [
      { title: tx('Kitchen: counters, stovetop, sink, microwave', 'Cocina: encimeras, estufa, fregadero, microondas'), who: 'w1', due: 5 },
      { title: tx('Bathrooms: tub, toilet, mirrors, floors', 'Baños: tina, inodoro, espejos, pisos'), who: 'w1', due: 5 },
      { title: tx('Bedrooms: change linens, dust, vacuum', 'Habitaciones: cambiar sábanas, sacudir, aspirar'), who: 'w1', due: 5 },
      { title: tx('Dust the blinds (monthly)', 'Sacudir las persianas (mensual)'), who: 'w1', status: 'review' },
      { title: tx('Ask Michelle if she wants the fridge cleaned before the holidays', 'Preguntarle a Michelle si quiere limpieza del refrigerador antes de las fiestas'), who: 'u3', due: 4, pri: 'low' },
    ],
    log: [
      { date: -9, workerId: 'w1', text: tx('All done. Vacuum bag was full, I changed it. We are low on wood floor cleaner.', 'Todo listo. La bolsa de la aspiradora estaba llena, la cambié. Queda poco limpiador de piso de madera.') },
      { date: -2, workerId: 'w1', text: tx('All done. Client left a note asking to also clean the patio door glass every week.', 'Todo listo. La clienta dejó una nota pidiendo que también limpiemos el vidrio de la puerta del patio cada semana.') },
    ],
    notes: [
      [-86, 'visit', tx('Dog stays in the backyard. Key in the lockbox, code 4412. Do not use bleach on the wood floors.', 'El perro se queda en el patio. Llave en la caja, código 4412. No usar cloro en los pisos de madera.')],
      [-2, 'text', tx('Michelle asked to add the patio door glass. Added to the checklist, same price.', 'Michelle pidió agregar el vidrio de la puerta del patio. Agregado a la lista, mismo precio.')],
    ] });

  k.job({ id: 'j2', name: tx('Move-out deep clean', 'Limpieza profunda de mudanza'), clientId: 'c2', type: 'moveout', status: 'contract', price: 550, start: 1, end: 1, manager: 'u2', leadId: 'l14',
    scope: tx('Empty 3-bedroom house. Inside oven, fridge and cabinets. Baseboards, windows inside, all floors. Carpet shampoo in the two back bedrooms.',
      'Casa vacía de 3 habitaciones. Horno, refrigerador y gabinetes por dentro. Zócalos, ventanas por dentro, todos los pisos. Lavado de alfombra en las dos habitaciones de atrás.'),
    payTerms: tx('50% deposit, balance when the listing agent approves the cleaning.', '50% de depósito, el resto cuando la agente apruebe la limpieza.'),
    assign: [
      { workerId: 'w2', scope: tx('Kitchen and bathrooms', 'Cocina y baños'), price: 140, payType: 'daily', rate: 140, qty: 1, status: 'pending' },
      { workerId: 'w3', scope: tx('Bedrooms, baseboards, carpets and floors', 'Habitaciones, zócalos, alfombras y pisos'), price: 130, status: 'pending' },
    ],
    expenses: [{ date: 0, vendor: tx('Equipment rental', 'Renta de equipo'), desc: tx('Carpet shampooer rental', 'Renta de máquina para lavar alfombras'), amount: 45 }],
    received: [{ date: -1, method: 'check', ref: tx('Deposit', 'Depósito'), amount: 275 }],
    tasks: [
      { title: tx('Get the agreement signed before the cleaners go in', 'Conseguir la firma del acuerdo antes de que entren las limpiadoras'), who: 'u3', due: 0, pri: 'high', status: 'doing' },
      { title: tx('Inside oven and fridge', 'Horno y refrigerador por dentro'), who: 'w2', due: 1 },
      { title: tx('Before and after photos for the listing agent', 'Fotos de antes y después para la agente'), who: 'w3', due: 1, pri: 'high' },
    ],
    notes: [
      [-2, 'call', tx('Dana needs it ready by 3 pm for a showing. Garage code 2580, key is on the kitchen counter.', 'Dana lo necesita listo a las 3 pm para mostrar la casa. Código del garaje 2580, la llave está en la encimera de la cocina.')],
    ] });

  k.job({ id: 'j3', name: tx('Dental office cleaning', 'Limpieza de consultorio dental'), clientId: 'c3', type: 'office', status: 'progress', price: 2880, start: -80, repeat: 'weekly', manager: 'u2',
    scope: tx('Waiting room, 4 operatories, restrooms, break room. Disinfect all touch points. Trash and recycling. Mop every visit, machine scrub once a month.',
      'Sala de espera, 4 cubículos, baños, comedor. Desinfectar todo lo que se toca. Basura y reciclaje. Trapear en cada visita, tallar con máquina una vez al mes.'),
    payTerms: tx('$240 per visit, invoiced every 4 visits ($960), due in 15 days. Total shown is the 12 visits invoiced so far.', '$240 por visita, se factura cada 4 visitas ($960), a pagar en 15 días. El total son las 12 visitas facturadas hasta ahora.'),
    assign: [
      { workerId: 'w1', scope: tx('Operatories and restrooms', 'Cubículos y baños'), price: 960, payType: 'daily', rate: 80, qty: 12, status: 'progress' },
      { workerId: 'w5', scope: tx('Waiting room, break room and floors, 3 hours per visit', 'Sala de espera, comedor y pisos, 3 horas por visita'), price: 792, payType: 'hourly', rate: 22, qty: 36, status: 'progress' },
    ],
    expenses: [
      { date: -79, vendor: supply, desc: tx('Disinfectant, trash bags', 'Desinfectante, bolsas de basura'), amount: 62 },
      { date: -44, vendor: supply, desc: tx('Disinfectant, glass cleaner, mop heads', 'Desinfectante, limpiavidrios, repuestos de trapeador'), amount: 58 },
      { date: -10, vendor: supply, desc: tx('Paper towels and hand soap refill', 'Toallas de papel y jabón de manos'), amount: 47 },
    ],
    received: [
      { date: -50, method: 'transfer', ref: tx('Invoice 1, visits 1 to 4', 'Factura 1, visitas 1 a 4'), amount: 960 },
      { date: -21, method: 'transfer', ref: tx('Invoice 2, visits 5 to 8', 'Factura 2, visitas 5 a 8'), amount: 960 },
    ],
    workerPays: [
      { date: -59, workerId: 'w1', method: 'zelle', amount: 320, payType: 'daily', from: -80, to: -59 },
      { date: -59, workerId: 'w5', method: 'zelle', amount: 264, payType: 'hourly', from: -80, to: -59 },
      { date: -31, workerId: 'w1', method: 'zelle', amount: 320, payType: 'daily', from: -52, to: -31 },
      { date: -31, workerId: 'w5', method: 'zelle', amount: 264, payType: 'hourly', from: -52, to: -31 },
      { date: -3, workerId: 'w1', method: 'zelle', amount: 320, payType: 'daily', from: -24, to: -3 },
      { date: -3, workerId: 'w5', method: 'zelle', amount: 198, payType: 'hourly', from: -24, to: -10 },
    ],
    tasks: [
      { title: tx('Send invoice 3 (visits 9 to 12)', 'Enviar la factura 3 (visitas 9 a 12)'), who: 'u3', due: -2, pri: 'high', status: 'done' },
      { title: tx('Remind the office about invoice 3, $960', 'Recordarle al consultorio la factura 3, $960'), who: 'u3', due: 6, status: 'waiting', description: tx('They pay on the 10th and the 25th.', 'Pagan los días 10 y 25.') },
      { title: tx('Machine scrub the operatory floors', 'Tallar con máquina los pisos de los cubículos'), who: 'w5', due: 4 },
      { title: tx('Restock paper towels and soap in both restrooms', 'Reponer toallas de papel y jabón en los dos baños'), who: 'w1', status: 'review' },
    ],
    log: [
      { date: -10, workerId: 'w5', text: tx('Floors done. The break room fridge leaked again, I mopped it and told the front desk.', 'Pisos listos. El refrigerador del comedor volvió a gotear, lo sequé y avisé en recepción.') },
      { date: -3, workerId: 'w1', text: tx('Operatory 3 had a spill under the chair, cleaned and disinfected. Hand soap is almost out.', 'En el cubículo 3 había un derrame debajo del sillón, limpié y desinfecté. El jabón de manos casi se acaba.') },
    ],
    notes: [
      [-80, 'visit', tx('Evenings after 6 pm. Lock the back door and set the alarm when leaving. Do not move anything on the instrument trays.', 'Tardes, después de las 6 pm. Cerrar la puerta de atrás y poner la alarma al salir. No mover nada de las bandejas de instrumentos.')],
      [-21, 'email', tx('Office manager says payments go out on the 10th and 25th. Invoice before those dates to get paid faster.', 'La gerente dice que pagan los días 10 y 25. Facturar antes de esas fechas para cobrar más rápido.')],
    ] });

  k.job({ id: 'j4', name: tx('Post-construction clean, whole house', 'Limpieza post-construcción, casa completa'), clientId: 'c4', type: 'postcon', status: 'done', price: 1800, start: -40, end: -38, manager: 'u1',
    scope: tx('Full house after a remodel, 2,400 sq ft. Remove drywall dust from every surface, clean inside cabinets and windows, scrape paint spots, vacuum vents, final mop.',
      'Casa completa después de una remodelación, 2,400 pies cuadrados. Quitar el polvo de tablaroca de todas las superficies, limpiar gabinetes por dentro y ventanas, raspar manchas de pintura, aspirar rejillas, trapeado final.'),
    payTerms: tx('Fixed price. Paid by check within 15 days of the final walkthrough.', 'Precio fijo. Pago con cheque dentro de 15 días después del recorrido final.'),
    assign: [
      { workerId: 'w4', scope: tx('Crew lead, 3 days with his helper', 'Líder de cuadrilla, 3 días con su ayudante'), price: 750, payType: 'weekly', rate: 750, qty: 1, status: 'done' },
      { workerId: 'w8', scope: tx('Kitchen, bathrooms and windows', 'Cocina, baños y ventanas'), price: 280, payType: 'daily', rate: 140, qty: 2, status: 'done' },
    ],
    expenses: [{ date: -41, vendor: supply, desc: tx('Heavy-duty bags, drywall dust filters', 'Bolsas de uso rudo, filtros para polvo de tablaroca'), amount: 120 }],
    received: [{ date: -35, method: 'check', ref: tx('Paid in full', 'Pago total'), amount: 1800 }],
    workerPays: [
      { date: -38, workerId: 'w8', method: 'cash', amount: 280, payType: 'daily', from: -40, to: -39 },
      { date: -37, workerId: 'w4', method: 'check', ref: '2031', amount: 750, payType: 'weekly', from: -41, to: -37 },
    ],
    tasks: [
      { title: tx('Final walkthrough with the builder', 'Recorrido final con el constructor'), who: 'u1', due: -38, status: 'done' },
    ],
    log: [
      { date: -38, workerId: 'w4', text: tx('Finished. Changed the vacuum filter twice, the dust was heavy upstairs. Builder walked it and signed off.', 'Terminado. Cambié el filtro de la aspiradora dos veces, había mucho polvo arriba. El constructor lo revisó y dio el visto bueno.') },
    ],
    notes: [[-42, 'call', tx('Nick needs it done before the family moves back in on the weekend. Floors are new hardwood, no wet mops.', 'Nick lo necesita antes de que la familia regrese el fin de semana. Los pisos son de madera nueva, nada de trapeador mojado.')]] });

  k.job({ id: 'j5', name: tx('Post-construction clean, kitchen remodel', 'Limpieza post-construcción, cocina remodelada'), clientId: 'c4', address: '12 Sample Ave, Galloway, NJ', type: 'postcon', status: 'progress', price: 1450, start: -1, end: 1, manager: 'u1',
    scope: tx('Kitchen, dining room and hallway after a kitchen remodel. Dust from all surfaces, inside the new cabinets and drawers, appliances, windows, light fixtures and floors.',
      'Cocina, comedor y pasillo después de remodelar la cocina. Polvo de todas las superficies, gabinetes y cajones nuevos por dentro, electrodomésticos, ventanas, lámparas y pisos.'),
    payTerms: tx('Fixed price. Paid by check within 15 days of the final walkthrough.', 'Precio fijo. Pago con cheque dentro de 15 días después del recorrido final.'),
    assign: [
      { workerId: 'w4', scope: tx('Crew lead, dust removal and floors', 'Líder de cuadrilla, polvo y pisos'), price: 600, payType: 'daily', rate: 200, qty: 3, status: 'progress' },
      { workerId: 'w3', scope: tx('Cabinets inside, appliances and windows', 'Gabinetes por dentro, electrodomésticos y ventanas'), price: 300, status: 'progress' },
    ],
    expenses: [{ date: -1, vendor: supply, desc: tx('Vacuum filters, razor scrapers, stone-safe cleaner', 'Filtros de aspiradora, raspadores, limpiador para piedra'), amount: 95 }],
    tasks: [
      { title: tx('First pass: vacuum all dust top to bottom', 'Primera pasada: aspirar todo el polvo de arriba a abajo'), who: 'w4', due: -1, status: 'done' },
      { title: tx('Inside cabinets and drawers', 'Gabinetes y cajones por dentro'), who: 'w3', due: 0, status: 'doing' },
      { title: tx('Photos of the finished kitchen for the builder', 'Fotos de la cocina terminada para el constructor'), who: 'w4', due: 1, status: 'todo' },
      { title: tx('Walkthrough with Nick and the homeowner', 'Recorrido con Nick y la dueña de la casa'), who: 'u1', due: 1, pri: 'high' },
    ],
    log: [
      { date: -1, workerId: 'w4', text: tx('First pass done. Quartz counters still have the plastic film on the edges, the installer has to take it off. Coming back tomorrow for detail.', 'Primera pasada lista. Las encimeras de cuarzo todavía traen el plástico en las orillas, lo tiene que quitar el instalador. Mañana regreso al detalle.') },
    ],
    notes: [[-6, 'call', tx('Nick called: the kitchen is finished this week. Homeowner works from home, keep the noise down before 9 am.', 'Llamó Nick: la cocina queda esta semana. La dueña trabaja desde casa, sin ruido antes de las 9 am.')]] });

  k.job({ id: 'j6', name: tx('Rental turnovers, 2 beach units', 'Cambios de huéspedes, 2 unidades de playa'), clientId: 'c5', type: 'rental', status: 'progress', price: 5280, start: -111, repeat: 'weekly', manager: 'u2',
    scope: tx('Saturday turnover of Unit A and Unit B between 10 am and 4 pm: strip and make beds, bathrooms, kitchen, floors, patio sweep, restock paper goods and soap, report anything broken or missing.',
      'Cambio de huéspedes los sábados en Unidad A y Unidad B, entre 10 am y 4 pm: quitar y tender camas, baños, cocina, pisos, barrer el patio, reponer papel y jabón, reportar lo que esté roto o falte.'),
    payTerms: tx('$165 per unit per turnover ($330 each Saturday), invoiced every 4 weeks, due in 10 days. Total shown is the 16 Saturdays invoiced so far.', '$165 por unidad por cambio ($330 cada sábado), se factura cada 4 semanas, a pagar en 10 días. El total son los 16 sábados facturados hasta ahora.'),
    assign: [
      { workerId: 'w6', scope: tx('Both units, cleaning and beds', 'Las dos unidades, limpieza y camas'), price: 2400, payType: 'daily', rate: 150, qty: 16, status: 'progress' },
      { workerId: 'w2', scope: tx('Laundry and restocking, 3 hours each Saturday', 'Lavandería y reposición, 3 horas cada sábado'), price: 864, payType: 'hourly', rate: 18, qty: 48, status: 'progress' },
    ],
    expenses: [
      { date: -104, vendor: supply, desc: tx('Paper goods and soap for both units', 'Papel y jabón para las dos unidades'), amount: 86 },
      { date: -76, vendor: tx('Laundromat', 'Lavandería'), desc: tx('Linens wash and fold, 4 weeks', 'Lavado y doblado de ropa de cama, 4 semanas'), amount: 132 },
      { date: -48, vendor: tx('Laundromat', 'Lavandería'), desc: tx('Linens wash and fold, 4 weeks', 'Lavado y doblado de ropa de cama, 4 semanas'), amount: 128 },
      { date: -41, vendor: supply, desc: tx('Paper goods, dish soap, trash bags', 'Papel, jabón para platos, bolsas de basura'), amount: 74 },
      { date: -20, vendor: tx('Laundromat', 'Lavandería'), desc: tx('Linens wash and fold, 4 weeks', 'Lavado y doblado de ropa de cama, 4 semanas'), amount: 135 },
    ],
    received: [
      { date: -78, method: 'transfer', ref: tx('Invoice 1, 4 Saturdays', 'Factura 1, 4 sábados'), amount: 1320 },
      { date: -51, method: 'transfer', ref: tx('Invoice 2, 4 Saturdays', 'Factura 2, 4 sábados'), amount: 1320 },
      { date: -22, method: 'transfer', ref: tx('Invoice 3, 4 Saturdays', 'Factura 3, 4 sábados'), amount: 1320 },
    ],
    workerPays: [
      { date: -83, workerId: 'w6', method: 'zelle', amount: 750, payType: 'daily', from: -111, to: -83 },
      { date: -83, workerId: 'w2', method: 'cash', amount: 270, payType: 'hourly', from: -111, to: -83 },
      { date: -55, workerId: 'w6', method: 'zelle', amount: 600, payType: 'daily', from: -76, to: -55 },
      { date: -55, workerId: 'w2', method: 'cash', amount: 216, payType: 'hourly', from: -76, to: -55 },
      { date: -27, workerId: 'w6', method: 'zelle', amount: 600, payType: 'daily', from: -48, to: -27 },
      { date: -27, workerId: 'w2', method: 'cash', amount: 216, payType: 'hourly', from: -48, to: -27 },
      { date: -6, workerId: 'w6', method: 'zelle', amount: 450, payType: 'daily', from: -20, to: -6 },
    ],
    tasks: [
      { title: tx('Send invoice 4 to Vanessa ($1,320)', 'Enviar la factura 4 a Vanessa ($1,320)'), who: 'u3', due: -3, pri: 'high' },
      { title: tx('Confirm guest count and late checkout for Saturday', 'Confirmar número de huéspedes y salida tarde del sábado'), who: 'u2', due: 0, status: 'waiting', description: tx('Vanessa answers on Thursday or Friday.', 'Vanessa contesta jueves o viernes.') },
      { title: tx('Unit B: report the broken blind in the front bedroom', 'Unidad B: reportar la persiana rota de la habitación de enfrente'), who: 'w6', due: 1, status: 'review' },
      { title: tx('Count linens and order 2 extra queen sets', 'Contar la ropa de cama y pedir 2 juegos queen extra'), who: 'u3', due: 3 },
    ],
    log: [
      { date: -13, workerId: 'w6', text: tx('Both units ready by 2:30. Unit A guests left the grill dirty, took 20 extra minutes. Photos sent.', 'Las dos unidades listas a las 2:30. Los huéspedes de la Unidad A dejaron sucia la parrilla, 20 minutos extra. Mandé fotos.') },
      { date: -6, workerId: 'w6', text: tx('Unit B has a broken blind in the front bedroom and one wine glass is missing. Everything else ready on time.', 'La Unidad B tiene una persiana rota en la habitación de enfrente y falta una copa. Lo demás quedó listo a tiempo.') },
      { date: -6, workerId: 'w2', text: tx('Laundry done, 2 sets of sheets have stains that did not come out. We need replacements.', 'Lavandería lista, 2 juegos de sábanas tienen manchas que no salieron. Hay que reponerlos.') },
    ],
    notes: [
      [-111, 'visit', tx('Door codes change every week, Vanessa texts them Friday night. Supplies closet is locked, key hangs inside the water heater door.', 'Los códigos de las puertas cambian cada semana, Vanessa los manda el viernes en la noche. El clóset de productos tiene llave, cuelga dentro de la puerta del calentador.')],
      [-22, 'call', tx('Vanessa wants to keep Saturdays through the fall, fewer bookings but same price. She may add a third unit in the spring.', 'Vanessa quiere seguir con los sábados en otoño, menos reservas pero mismo precio. Puede que sume una tercera unidad en primavera.')],
    ] });

  k.job({ id: 'j7', name: tx('Home cleaning every 2 weeks', 'Limpieza de casa cada 2 semanas'), clientId: 'c6', type: 'standard', status: 'progress', price: 1050, start: -70, repeat: 'biweekly', manager: 'u2',
    scope: tx('2-bedroom condo: kitchen, 2 bathrooms, bedrooms, living room and balcony. Inside the microwave every visit, inside the fridge every other visit.',
      'Condominio de 2 habitaciones: cocina, 2 baños, habitaciones, sala y balcón. Microondas por dentro en cada visita, refrigerador por dentro una visita sí y una no.'),
    payTerms: tx('$175 per visit, paid the day of the cleaning by check or Zelle. Total shown is the 6 visits so far.', '$175 por visita, se paga el día de la limpieza con cheque o Zelle. El total son las 6 visitas hasta ahora.'),
    assign: [{ workerId: 'w2', scope: tx('Whole condo', 'Todo el condominio'), price: 480, payType: 'daily', rate: 80, qty: 6, status: 'progress' }],
    expenses: [{ date: -55, vendor: supply, desc: tx('Granite cleaner and sponges', 'Limpiador de granito y esponjas'), amount: 27 }],
    received: [
      { date: -70, method: 'check', ref: tx('Visit 1', 'Visita 1'), amount: 175 },
      { date: -56, method: 'check', ref: tx('Visit 2', 'Visita 2'), amount: 175 },
      { date: -42, method: 'zelle', ref: tx('Visit 3', 'Visita 3'), amount: 175 },
      { date: -28, method: 'zelle', ref: tx('Visit 4', 'Visita 4'), amount: 175 },
      { date: -14, method: 'zelle', ref: tx('Visit 5', 'Visita 5'), amount: 175 },
    ],
    workerPays: [
      { date: -56, workerId: 'w2', method: 'cash', amount: 160, payType: 'daily', from: -70, to: -56 },
      { date: -28, workerId: 'w2', method: 'cash', amount: 160, payType: 'daily', from: -42, to: -28 },
      { date: -14, workerId: 'w2', method: 'cash', amount: 80, payType: 'daily', from: -14, to: -14 },
    ],
    tasks: [
      { title: tx('Inside the fridge (this visit)', 'Refrigerador por dentro (esta visita)'), who: 'w2', due: 0 },
      { title: tx("Collect today's payment, $175", 'Cobrar la visita de hoy, $175'), who: 'u3', due: 0 },
    ],
    log: [{ date: -14, workerId: 'w2', text: tx('Done by noon. She asked us to use her own product on the granite, it is under the sink.', 'Terminé al mediodía. Pidió que usemos su propio producto en el granito, está debajo del fregadero.') }],
    notes: [[-72, 'call', tx('Referred by Michelle Johnson. Doorman has our names, sign in at the front desk. Parking in the visitor spots only.', 'Recomendada por Michelle Johnson. El portero tiene nuestros nombres, registrarse en recepción. Estacionarse solo en los lugares de visitas.')]] });

  k.job({ id: 'j8', name: tx('Monthly home cleaning', 'Limpieza mensual de casa'), clientId: 'c7', type: 'deep', status: 'progress', price: 880, start: -81, repeat: 'monthly', manager: 'u3',
    scope: tx('Monthly detailed cleaning of a one-story house: kitchen, 2 bathrooms, bedrooms, sunroom. Change the bed, take out trash and recycling, wipe the walker and handrails.',
      'Limpieza detallada mensual de una casa de un piso: cocina, 2 baños, habitaciones, terraza cerrada. Cambiar la cama, sacar basura y reciclaje, limpiar el andador y los pasamanos.'),
    payTerms: tx('$220 per visit. Her daughter pays by bank transfer before each visit. Total shown covers 4 visits.', '$220 por visita. Su hija paga por transferencia antes de cada visita. El total cubre 4 visitas.'),
    assign: [{ workerId: 'w3', scope: tx('Whole house, about 4 hours', 'Toda la casa, unas 4 horas'), price: 440, payType: 'project', rate: 110, qty: 4, status: 'progress' }],
    received: [
      { date: -84, method: 'transfer', ref: tx('First 3 visits', 'Primeras 3 visitas'), amount: 660 },
      { date: -1, method: 'transfer', ref: tx('Visit 4', 'Visita 4'), amount: 220 },
    ],
    workerPays: [
      { date: -81, workerId: 'w3', method: 'zelle', amount: 110 },
      { date: -53, workerId: 'w3', method: 'zelle', amount: 110 },
      { date: -25, workerId: 'w3', method: 'zelle', amount: 110 },
    ],
    tasks: [
      { title: tx('Call Susan (daughter) to confirm the visit', 'Llamar a Susan (la hija) para confirmar la visita'), who: 'u3', due: 2 },
      { title: tx('Wipe the walker, handrails and light switches', 'Limpiar el andador, los pasamanos y los interruptores'), who: 'w3', due: 3 },
    ],
    log: [{ date: -25, workerId: 'w3', text: tx('Mrs. Whitman was home and very kind. The sunroom windows need a ladder, I did what I could reach.', 'La señora Whitman estaba en casa, muy amable. Las ventanas de la terraza necesitan escalera, limpié hasta donde alcancé.') }],
    notes: [[-84, 'call', tx('Susan asked for the same cleaner every time, her mother gets nervous with new people. No emails, call her cell.', 'Susan pidió que vaya siempre la misma persona, su mamá se pone nerviosa con gente nueva. Sin correos, llamarle al celular.')]] });

  k.job({ id: 'j9', name: tx('Fitness studio cleaning', 'Limpieza de estudio de ejercicio'), clientId: 'c8', type: 'office', status: 'progress', price: 3360, start: -30, repeat: 'weekly', manager: 'u2', leadId: 'l12',
    scope: tx('Three nights a week (Monday, Wednesday, Friday) after closing: studio floor, mirrors, locker rooms and showers, front desk, trash. Machine scrub of the rubber floor once a month.',
      'Tres noches por semana (lunes, miércoles, viernes) después del cierre: piso del estudio, espejos, vestidores y duchas, recepción, basura. Tallado con máquina del piso de goma una vez al mes.'),
    payTerms: tx('$420 per week, paid by transfer at the start of every 4 weeks ($1,680). Total shown covers the first 8 weeks.', '$420 por semana, se paga por transferencia al inicio de cada 4 semanas ($1,680). El total cubre las primeras 8 semanas.'),
    assign: [
      { workerId: 'w5', scope: tx('Three nights a week, 3 hours each', 'Tres noches por semana, 3 horas cada una'), price: 1584, payType: 'hourly', rate: 22, qty: 72, status: 'progress' },
      { workerId: 'w7', scope: tx('Monthly machine scrub of the rubber floor', 'Tallado mensual con máquina del piso de goma'), price: 360, payType: 'project', rate: 180, qty: 2, status: 'progress' },
    ],
    expenses: [
      { date: -30, vendor: supply, desc: tx('Disinfectant, glass cleaner, shower cleaner', 'Desinfectante, limpiavidrios, limpiador de duchas'), amount: 96 },
      { date: -11, vendor: supply, desc: tx('Rubber floor cleaner and pads', 'Limpiador para piso de goma y discos'), amount: 74 },
    ],
    received: [
      { date: -31, method: 'transfer', ref: tx('Weeks 1 to 4', 'Semanas 1 a 4'), amount: 1680 },
      { date: -3, method: 'transfer', ref: tx('Weeks 5 to 8', 'Semanas 5 a 8'), amount: 1680 },
    ],
    workerPays: [
      { date: -17, workerId: 'w5', method: 'zelle', amount: 396, payType: 'hourly', from: -30, to: -17 },
      { date: -13, workerId: 'w7', method: 'check', ref: '2044', amount: 180 },
      { date: -3, workerId: 'w5', method: 'zelle', amount: 396, payType: 'hourly', from: -16, to: -3 },
    ],
    tasks: [
      { title: tx('Second machine scrub of the studio floor', 'Segundo tallado con máquina del piso del estudio'), who: 'w7', due: 6 },
      { title: tx('Check the locker room drains, members complained about a smell', 'Revisar los drenajes de los vestidores, los socios se quejaron de olor'), who: 'w5', due: 1, status: 'doing', pri: 'high' },
      { title: tx('Quality check visit after the first three weeks', 'Visita de control de calidad a las tres semanas'), who: 'u2', due: -5, status: 'done' },
    ],
    log: [
      { date: -16, workerId: 'w5', text: tx('Mirrors take longer than planned, 20 minutes extra each night. A squeegee on a pole would help.', 'Los espejos tardan más de lo planeado, 20 minutos extra cada noche. Ayudaría un jalador con extensión.') },
      { date: -2, workerId: 'w5', text: tx('Poured enzyme cleaner in the two shower drains. Smell is better, I will check again on Friday.', 'Eché limpiador de enzimas en los dos drenajes de las duchas. Huele mejor, el viernes reviso otra vez.') },
    ],
    notes: [
      [-32, 'visit', tx('Chris gave us a key fob. Last class ends at 8:30 pm, we start at 9. Do not use anything oily on the rubber floor.', 'Chris nos dio una llave electrónica. La última clase termina a las 8:30 pm, empezamos a las 9. Nada aceitoso en el piso de goma.')],
      [-5, 'visit', tx('Three-week check with Chris. Happy with the floors and mirrors, wants more attention on the shower corners.', 'Revisión de las tres semanas con Chris. Contento con pisos y espejos, quiere más atención en las esquinas de las duchas.')],
    ] });

  // the one job that lost money, with the reason written down
  k.job({ id: 'j10', name: tx('One-time deep clean', 'Limpieza profunda, una vez'), clientId: 'c9', type: 'deep', status: 'done', price: 420, start: -50, end: -50, manager: 'u1',
    scope: tx('Deep clean of a 3-bedroom house before family visits: kitchen with inside oven and fridge, 2 bathrooms, baseboards, ceiling fans, inside windows.',
      'Limpieza profunda de una casa de 3 habitaciones antes de una visita familiar: cocina con horno y refrigerador por dentro, 2 baños, zócalos, ventiladores de techo, ventanas por dentro.'),
    payTerms: tx('Fixed price, paid by card the day of the cleaning.', 'Precio fijo, se paga con tarjeta el día de la limpieza.'),
    assign: [
      { workerId: 'w3', scope: tx('Kitchen, oven, fridge and bathrooms', 'Cocina, horno, refrigerador y baños'), price: 220, status: 'done' },
      { workerId: 'w1', scope: tx('Bedrooms, fans, baseboards and windows, full day', 'Habitaciones, ventiladores, zócalos y ventanas, día completo'), price: 160, payType: 'daily', rate: 160, qty: 1, status: 'done' },
    ],
    expenses: [{ date: -50, vendor: supply, desc: tx('Oven cleaner, degreaser, extra microfiber', 'Limpiador de horno, desengrasante, microfibra extra'), amount: 52 }],
    received: [{ date: -50, method: 'card', ref: tx('Paid in full', 'Pago total'), amount: 420 }],
    workerPays: [
      { date: -49, workerId: 'w3', method: 'zelle', amount: 220 },
      { date: -49, workerId: 'w1', method: 'zelle', amount: 160, payType: 'daily', from: -50, to: -50 },
    ],
    tasks: [{ title: tx('Ask Sofía for a review', 'Pedirle una reseña a Sofía'), who: 'u3', due: -46, status: 'done', pri: 'low' }],
    log: [{ date: -50, workerId: 'w3', text: tx('The oven and the kitchen took almost 5 hours, there was a lot of built-up grease. We stayed until 6 to finish.', 'El horno y la cocina tomaron casi 5 horas, había mucha grasa acumulada. Nos quedamos hasta las 6 para terminar.') }],
    notes: [
      [-50, 'note', tx('We lost a little money here. I quoted $420 by phone without seeing the house and it took two people the whole day. I kept the price. From now on every deep clean gets a walkthrough or photos before I give a number.', 'Aquí perdimos un poco. Coticé $420 por teléfono sin ver la casa y tomó a dos personas todo el día. Respeté el precio. Desde ahora toda limpieza profunda lleva visita o fotos antes de dar un número.')],
      [-46, 'call', tx('Sofía loved it and asked for a price for regular service every 2 weeks.', 'A Sofía le encantó y pidió precio para servicio regular cada 2 semanas.')],
    ] });

  k.job({ id: 'j11', name: tx('Home cleaning every 2 weeks', 'Limpieza de casa cada 2 semanas'), clientId: 'c9', type: 'standard', status: 'estimate', price: 145, repeat: 'biweekly', manager: 'u2',
    scope: tx('3-bedroom house: kitchen, 2 bathrooms, bedrooms and living areas. Lint roll the sofas (2 cats).', 'Casa de 3 habitaciones: cocina, 2 baños, habitaciones y áreas comunes. Pasar rodillo quitapelusa en los sofás (2 gatos).'),
    payTerms: tx('$145 per visit, card on file charged after each cleaning.', '$145 por visita, se cobra a la tarjeta registrada después de cada limpieza.'),
    notes: [[-44, 'email', tx('Sent the estimate after the deep clean. She is thinking about it, her husband wants to try once a month first.', 'Mandé el presupuesto después de la limpieza profunda. Lo está pensando, su esposo quiere probar primero una vez al mes.')]] });

  k.job({ id: 'j12', name: tx('Carpet and sofa cleaning', 'Lavado de alfombras y sofá'), clientId: 'c10', type: 'carpet', status: 'done', price: 385, start: -12, end: -12, manager: 'u2', leadId: 'l13',
    scope: tx('Hot water extraction on stairs, hallway and 3 bedrooms. Sectional sofa and 2 armchairs. Pet stain treatment in the hallway.',
      'Lavado con extracción de agua caliente en escalera, pasillo y 3 habitaciones. Sofá seccional y 2 sillones. Tratamiento de manchas de mascota en el pasillo.'),
    payTerms: tx('$200 deposit by card when booking, balance the day of the service.', '$200 de depósito con tarjeta al reservar, el resto el día del servicio.'),
    assign: [{ workerId: 'w7', scope: tx('Carpets and upholstery', 'Alfombras y tapicería'), price: 150, status: 'done' }],
    expenses: [{ date: -13, vendor: supply, desc: tx('Extraction detergent and pet stain enzyme', 'Detergente para extracción y enzima para manchas de mascota'), amount: 34 }],
    received: [{ date: -15, method: 'card', ref: tx('Deposit', 'Depósito'), amount: 200 }],
    workerPays: [{ date: -11, workerId: 'w7', method: 'zelle', amount: 150 }],
    tasks: [
      { title: tx('Text Raj about the $185 balance', 'Mandarle texto a Raj por el saldo de $185'), who: 'u3', due: -5, pri: 'high' },
    ],
    log: [{ date: -12, workerId: 'w7', text: tx('All done. The hallway stain came out about 90 percent. Told him to keep the fans on for 6 hours.', 'Todo listo. La mancha del pasillo salió como en un 90 por ciento. Le dije que deje los ventiladores prendidos 6 horas.') }],
    notes: [[-12, 'text', tx('Raj was not home when we finished, his son let us out. He said he will send the rest by Zelle. Nothing yet.', 'Raj no estaba cuando terminamos, su hijo nos abrió. Dijo que manda el resto por Zelle. Todavía nada.')]] });

  k.job({ id: 'j13', name: tx('Law office cleaning', 'Limpieza de despacho de abogados'), clientId: 'c11', type: 'office', status: 'hold', price: 1140, start: -63, repeat: 'weekly', manager: 'u2',
    scope: tx('Weekly evening cleaning: 5 offices, conference room, kitchenette and restroom. Trash, dusting, vacuum and glass doors.',
      'Limpieza semanal por la tarde: 5 oficinas, sala de juntas, cocineta y baño. Basura, sacudido, aspirado y puertas de vidrio.'),
    payTerms: tx('$190 per visit, invoiced every 4 visits. Total shown is the 6 visits done before the pause.', '$190 por visita, se factura cada 4 visitas. El total son las 6 visitas hechas antes de la pausa.'),
    assign: [{ workerId: 'w5', scope: tx('Whole office, 4 hours per visit', 'Toda la oficina, 4 horas por visita'), price: 528, payType: 'hourly', rate: 22, qty: 24, status: 'progress' }],
    expenses: [{ date: -62, vendor: supply, desc: tx('Vacuum bags, glass cleaner, trash liners', 'Bolsas de aspiradora, limpiavidrios, bolsas de basura'), amount: 44 }],
    received: [
      { date: -36, method: 'check', ref: tx('Invoice 1, visits 1 to 4', 'Factura 1, visitas 1 a 4'), amount: 760 },
      { date: -19, method: 'check', ref: tx('Invoice 2, visits 5 and 6', 'Factura 2, visitas 5 y 6'), amount: 380 },
    ],
    workerPays: [
      { date: -42, workerId: 'w5', method: 'zelle', amount: 352, payType: 'hourly', from: -63, to: -42 },
      { date: -27, workerId: 'w5', method: 'zelle', amount: 176, payType: 'hourly', from: -35, to: -28 },
    ],
    tasks: [
      { title: tx('Call Karen to ask when the office reopens', 'Llamar a Karen para saber cuándo reabre la oficina'), who: 'u2', due: 4, status: 'waiting' },
    ],
    notes: [
      [-26, 'call', tx('PAUSED: a pipe broke upstairs and the office is closed for repairs. Karen thinks they reopen in about 3 weeks. We keep their slot on Tuesday evenings.', 'EN PAUSA: se rompió una tubería en el piso de arriba y la oficina está cerrada por reparación. Karen cree que reabren en unas 3 semanas. Les guardamos su turno de los martes en la tarde.')],
    ] });

  k.job({ id: 'j14', name: tx('Move-out clean, townhouse', 'Limpieza de mudanza, townhouse'), clientId: 'c2', address: '18 Sample Ter, Northfield, NJ', type: 'moveout', status: 'done', price: 620, start: -27, end: -27, manager: 'u2',
    scope: tx('Empty 2-bedroom townhouse. Kitchen with inside appliances and cabinets, 2.5 bathrooms, closets, baseboards, inside windows and all floors.',
      'Townhouse vacío de 2 habitaciones. Cocina con electrodomésticos y gabinetes por dentro, 2 baños y medio, clósets, zócalos, ventanas por dentro y todos los pisos.'),
    payTerms: tx('50% deposit, balance when the listing agent approves the cleaning.', '50% de depósito, el resto cuando la agente apruebe la limpieza.'),
    assign: [
      { workerId: 'w2', scope: tx('Kitchen and bathrooms', 'Cocina y baños'), price: 140, payType: 'daily', rate: 140, qty: 1, status: 'done' },
      { workerId: 'w3', scope: tx('Bedrooms, closets, baseboards and floors', 'Habitaciones, clósets, zócalos y pisos'), price: 150, status: 'done' },
    ],
    expenses: [{ date: -27, vendor: supply, desc: tx('Oven cleaner, magic sponges, trash bags', 'Limpiador de horno, esponjas mágicas, bolsas de basura'), amount: 36 }],
    received: [
      { date: -29, method: 'check', ref: tx('Deposit', 'Depósito'), amount: 310 },
      { date: -20, method: 'check', ref: tx('Balance', 'Saldo'), amount: 310 },
    ],
    workerPays: [
      { date: -27, workerId: 'w2', method: 'cash', amount: 140, payType: 'daily', from: -27, to: -27 },
      { date: -26, workerId: 'w3', method: 'zelle', amount: 150 },
    ],
    tasks: [{ title: tx('Send before and after photos to Dana', 'Mandar fotos de antes y después a Dana'), who: 'u3', due: -26, status: 'done' }],
    log: [{ date: -27, workerId: 'w3', text: tx('Finished at 2 pm. The previous tenant left paint cans in the garage, we did not touch them. Photos sent to the office.', 'Terminamos a las 2 pm. El inquilino anterior dejó botes de pintura en el garaje, no los tocamos. Mandé fotos a la oficina.') }],
    notes: [[-20, 'email', tx('Dana approved and paid. Said the house showed great and she has another one for us soon.', 'Dana aprobó y pagó. Dijo que la casa se vio muy bien y que pronto tiene otra para nosotros.')]] });

  /* ---------- leads ---------- */
  k.lead({ id: 'l1', name: 'Olivia Carter', phone: '609-555-0151', email: 'olivia@example.com', address: '14 Sample Ln, Ventnor, NJ', type: 'rental', source: 'website', status: 'scheduled', pri: 'high', value: 180, appt: [day(1), '11:00'], created: -2,
    notes: [[-2, 'note', tx('Vacation rental with 3 bedrooms. Wants turnover cleaning after every checkout, about 6 per month. Lockbox code by text the day before.', 'Renta vacacional de 3 habitaciones. Quiere limpieza después de cada salida, unas 6 al mes. El código de la caja de llaves llega por texto un día antes.')]] });
  k.lead({ id: 'l2', name: 'Jorge Ramírez', phone: '609-555-0152', address: '63 Sample St, Pleasantville, NJ', type: 'deep', source: 'referral', status: 'new', value: 350, followUp: 0, created: 0,
    notes: [[0, 'call', tx('Deep clean before a family party. Has 2 cats, bring the lint rollers. Referred by Sofía Castellanos. Needs photos or a visit before we confirm the price.', 'Limpieza profunda antes de una fiesta familiar. Tiene 2 gatos, llevar rodillos quitapelusa. Recomendado por Sofía Castellanos. Hacen falta fotos o visita antes de confirmar el precio.')]] });
  k.lead({ id: 'l3', name: 'Paul Brennan', company: 'Harbor Sample Insurance Office', phone: '609-555-0153', email: 'harborinsurance@example.com', address: '300 Sample Blvd, Northfield, NJ', type: 'office', source: 'google', status: 'sent', value: 1100, followUp: day(2), created: -9,
    notes: [[-9, 'call', tx('After-hours only, twice a week. 8 desks, 2 restrooms, small kitchen.', 'Solo fuera de horario, dos veces por semana. 8 escritorios, 2 baños, cocina chica.')],
      [-4, 'visit', tx('Walked the office at 5:30 pm. Carpet in all offices, tile in the lobby.', 'Recorrí la oficina a las 5:30 pm. Alfombra en todas las oficinas, loseta en el lobby.')],
      [-3, 'email', tx('Estimate sent for $1,100 per month.', 'Presupuesto enviado por $1,100 al mes.')]] });
  k.lead({ id: 'l4', name: 'Stephanie Wu', phone: '609-555-0154', email: 'stephanie@example.com', address: '27 Sample Dr, Linwood, NJ', type: 'standard', source: 'website', status: 'new', created: 0,
    notes: [[0, 'note', tx('Website request: 4 bedrooms, 3 bathrooms, wants every 2 weeks. Has a toddler, asks for unscented products.', 'Solicitud del sitio web: 4 habitaciones, 3 baños, quiere cada 2 semanas. Tiene un niño pequeño, pide productos sin aroma.')]] });
  k.lead({ id: 'l5', name: 'Marcus Hill', phone: '609-555-0155', address: '5 Sample Ct, Absecon, NJ', type: 'carpet', source: 'instagram', status: 'new', pri: 'low', created: -1,
    notes: [[-1, 'text', tx('Instagram message: two sofas and the stair carpet. Asked if we work Saturdays.', 'Mensaje por Instagram: dos sofás y la alfombra de la escalera. Preguntó si trabajamos sábados.')]] });
  k.lead({ id: 'l6', name: 'Paola Gutiérrez', phone: '609-555-0156', email: 'paola@example.com', address: '88 Sample Ave, Apt 2C, Atlantic City, NJ', type: 'moveout', source: 'facebook', status: 'contacted', value: 480, followUp: -1, created: -6,
    notes: [[-6, 'text', tx('Moving out at the end of the month. The landlord wants a receipt from a cleaning company to return the deposit.', 'Se muda a fin de mes. El dueño pide recibo de una compañía de limpieza para devolver el depósito.')],
      [-4, 'call', tx('2 bedrooms, 1 bathroom. Told her around $480. She will confirm the date when she knows her moving day.', '2 habitaciones, 1 baño. Le dije que unos $480. Confirma la fecha cuando sepa el día de la mudanza.')]] });
  k.lead({ id: 'l7', name: 'Renee Jackson', company: 'Sample Pediatrics', phone: '609-555-0157', email: 'pediatrics@example.com', address: '45 Sample Plaza, Egg Harbor Twp, NJ', type: 'office', source: 'phone', status: 'contacted', pri: 'high', value: 1400, followUp: day(2), created: -8, owner: 'u2',
    notes: [[-8, 'call', tx('Their cleaner quit. 6 exam rooms and a waiting room, 3 nights a week. Needs someone within two weeks.', 'Su limpiadora renunció. 6 consultorios y sala de espera, 3 noches por semana. Necesitan a alguien en dos semanas.')],
      [-5, 'email', tx('Sent our insurance certificate and two references. Renee is checking with the doctors.', 'Mandé nuestro certificado de seguro y dos referencias. Renee lo está viendo con los doctores.')]] });
  k.lead({ id: 'l8', name: 'Greg Sullivan', phone: '609-555-0158', email: 'greg@example.com', address: '19 Sample Way, Somers Point, NJ', type: 'standard', source: 'referral', status: 'scheduled', value: 170, appt: [0, '15:30'], created: -4,
    notes: [[-4, 'call', tx('Neighbor of Deborah Klein. Wants weekly cleaning, 3 bedrooms. Visit today to see the house and give a price.', 'Vecino de Deborah Klein. Quiere limpieza semanal, 3 habitaciones. Visita hoy para ver la casa y dar precio.')]] });
  k.lead({ id: 'l9', name: 'Imani Brooks', company: 'Bayshore Sample Condos', phone: '609-555-0159', email: 'bayshorecondos@example.com', address: '500 Sample Bay Ave, Margate, NJ', type: 'office', source: 'google', status: 'scheduled', pri: 'high', value: 2200, appt: [day(3), '10:00'], created: -7, owner: 'u1',
    notes: [[-7, 'call', tx('Condo association: lobby, 2 elevators, hallways on 4 floors and the gym. Wants a monthly price, 3 visits a week.', 'Asociación de condominios: lobby, 2 elevadores, pasillos de 4 pisos y el gimnasio. Quiere precio mensual, 3 visitas por semana.')]] });
  k.lead({ id: 'l10', name: 'Natalie Romano', phone: '609-555-0160', email: 'natalie@example.com', address: '7 Sample Pl, Northfield, NJ', type: 'deep', source: 'website', status: 'sent', value: 390, followUp: 0, created: -11,
    notes: [[-11, 'note', tx('Deep clean before a baby arrives. Sent photos of the kitchen and bathrooms.', 'Limpieza profunda antes de que nazca su bebé. Mandó fotos de la cocina y los baños.')],
      [-8, 'email', tx('Estimate sent for $390 with the fridge and oven included. Follow up today.', 'Presupuesto enviado por $390 con refrigerador y horno incluidos. Darle seguimiento hoy.')]] });
  k.lead({ id: 'l11', name: 'Aisha Khan', company: 'Sample Yoga Loft', phone: '609-555-0161', email: 'yogaloft@example.com', address: '12 Sample St, 2nd Floor, Ocean City, NJ', type: 'office', source: 'instagram', status: 'sent', value: 640, followUp: day(4), created: -16, owner: 'u2',
    notes: [[-16, 'text', tx('Saw our post about the fitness studio. Small studio, wants twice a week early morning.', 'Vio nuestra publicación del estudio de ejercicio. Estudio chico, quiere dos veces por semana temprano en la mañana.')],
      [-12, 'email', tx('Estimate sent for $640 per month. She is comparing with her current cleaner.', 'Presupuesto enviado por $640 al mes. Lo está comparando con su limpiadora actual.')]] });
  k.lead({ id: 'l12', name: 'Chris Delgado', company: 'Sample Fitness Studio', phone: '609-555-0108', email: 'fitnessstudio@example.com', address: '77 Sample Blvd, Somers Point, NJ', type: 'office', source: 'google', status: 'won', value: 1680, created: -42, clientId: 'c8', jobId: 'j9', owner: 'u2',
    notes: [[-42, 'call', tx('Found us on Google. Members complained about the locker rooms. Wants three nights a week.', 'Nos encontró en Google. Los socios se quejaban de los vestidores. Quiere tres noches por semana.')],
      [-40, 'visit', tx('Walked the studio with Chris. Accepted $420 per week, start next Wednesday.', 'Recorrí el estudio con Chris. Aceptó $420 por semana, empezamos el próximo miércoles.')]] });
  k.lead({ id: 'l13', name: 'Raj Mehta', phone: '609-555-0110', email: 'raj@example.com', address: '40 Sample Ln, Egg Harbor Twp, NJ', type: 'carpet', source: 'facebook', status: 'won', value: 385, created: -22, clientId: 'c10', jobId: 'j12', owner: 'u2',
    notes: [[-22, 'text', tx('Facebook message: carpets and a sectional, there is a pet stain in the hallway.', 'Mensaje por Facebook: alfombras y un seccional, hay una mancha de mascota en el pasillo.')],
      [-15, 'call', tx('Booked. Paid the $200 deposit by card.', 'Reservado. Pagó el depósito de $200 con tarjeta.')]] });
  k.lead({ id: 'l14', name: 'Dana Whitfield', company: 'Sample Realty Group', phone: '609-555-0102', email: 'listings@example.com', address: '22 Sample Rd, Egg Harbor Twp, NJ', type: 'moveout', source: 'other', status: 'won', value: 550, created: -8, clientId: 'c2', jobId: 'j2', owner: 'u2',
    notes: [[-8, 'email', tx('Dana emailed a new listing: empty 3-bedroom house, showing in a few days. Same terms as the townhouse.', 'Dana mandó por correo una casa nueva: 3 habitaciones, vacía, la muestran en unos días. Mismas condiciones que el townhouse.')]] });
  k.lead({ id: 'l15', name: 'Derek Lawson', phone: '609-555-0162', address: '90 Sample Rd, Mays Landing, NJ', type: 'standard', source: 'google', status: 'lost', value: 150, created: -25,
    lostReason: tx('Wanted $90 per visit for a 5-bedroom house. Below our minimum.', 'Quería $90 por visita para una casa de 5 habitaciones. Por debajo de nuestro mínimo.'),
    notes: [[-25, 'call', tx('5 bedrooms, 3 bathrooms, weekly. He has a quote for $90 from someone who works alone.', '5 habitaciones, 3 baños, semanal. Tiene un precio de $90 de alguien que trabaja sola.')]] });
  k.lead({ id: 'l16', name: 'Monique Davis', company: 'Sample Daycare Center', phone: '609-555-0163', email: 'daycare@example.com', address: '33 Sample Ave, Galloway, NJ', type: 'office', source: 'phone', status: 'lost', value: 1800, created: -33, owner: 'u2',
    lostReason: tx('Needs daily cleaning at 5 am. We cannot staff that shift yet.', 'Necesita limpieza diaria a las 5 am. Todavía no tenemos personal para ese turno.'),
    notes: [[-33, 'call', tx('Daycare with 5 classrooms. Cleaning has to be finished before 6:30 am every weekday.', 'Guardería con 5 salones. La limpieza tiene que terminar antes de las 6:30 am todos los días hábiles.')],
      [-29, 'call', tx('Told Monique honestly that we do not have an early crew. She asked us to call if that changes.', 'Le dije a Monique con franqueza que no tenemos cuadrilla de madrugada. Pidió que le llamemos si eso cambia.')]] });

  /* ---------- office tasks ---------- */
  k.task({ title: tx('Prepare the monthly price for Bayshore Sample Condos before the visit', 'Preparar el precio mensual de Bayshore Sample Condos antes de la visita'), who: 'u1', due: 2, pri: 'high', leadId: 'l9' });
  k.task({ title: tx('Call Paola Gutiérrez about her move-out date', 'Llamar a Paola Gutiérrez por su fecha de mudanza'), who: 'u3', due: -1, leadId: 'l6' });
  k.task({ title: tx('Get the W-9 from Ana López', 'Conseguir el W-9 de Ana López'), who: 'u3', due: -3, pri: 'high', description: tx('She works three active jobs. She said she would bring it on Monday.', 'Trabaja en tres trabajos activos. Dijo que lo trae el lunes.') });
  k.task({ title: tx('Ask Diego Flores for his renewed insurance certificate', 'Pedirle a Diego Flores su certificado de seguro renovado'), who: 'u3', due: 1, status: 'waiting', pri: 'high' });
  k.task({ title: tx('Order supplies: disinfectant, microfiber, vacuum bags', 'Pedir productos: desinfectante, microfibra, bolsas de aspiradora'), who: 'u3', due: 1, status: 'doing' });
  k.task({ title: tx('Review the price list for deep cleans (add a walkthrough rule)', 'Revisar la lista de precios de limpieza profunda (agregar la regla de visita previa)'), who: 'u1', due: 2, status: 'review' });
  k.task({ title: tx('Renew the janitorial bond and liability policy', 'Renovar la fianza y la póliza de responsabilidad'), who: 'u1', due: 14 });

  return k.finish();
}
