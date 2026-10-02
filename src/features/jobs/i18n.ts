import type { Dict } from '@/i18n';

// Wording for the jobs module. A "job" is the generic record: it reads project, job, unit or event depending on the industry,
// so sentences here use the tokens and stay free of articles and adjectives that would have to agree with them in Spanish.
// Field names the industry packs already word for themselves (price, scope, start, end, who is doing what…) are reused from the shared keys.
export const dict: Dict = {
  en: {
    'jobs.noCosts': 'No costs yet',
    'jobs.sub': 'Every {job} with its team, money, tasks and documents in one place.', 'jobs.edit': 'Edit {job}',
    'jobs.view': 'View', 'jobs.view.table': 'Table', 'jobs.view.board': 'Board',
    'jobs.search': 'Search name, {client}, address or number', 'jobs.allManagers': 'Anyone managing', 'jobs.manager': 'Managed by',
    'jobs.col.dates': 'Dates', 'jobs.col.received': 'Received',
    'jobs.sum.count': '{n} {jobs}', 'jobs.sum.active': '{n} active', 'jobs.sum.value': 'Active value',
    'jobs.empty': 'No {jobs} yet', 'jobs.emptyHint': 'Add the first one here. When a lead is won, it is also created for you.',
    'jobs.noDates': 'No dates yet', 'jobs.to': 'to', 'jobs.until': 'Until {date}', 'jobs.notSet': 'Not set',
    'jobs.repeat': 'Repeats', 'jobs.rp.once': 'One time', 'jobs.rp.weekly': 'Every week', 'jobs.rp.biweekly': 'Every 2 weeks', 'jobs.rp.monthly': 'Every month',
    'jobs.moveTo': 'Move to', 'jobs.drop': 'Drop a card here', 'jobs.paid': 'Paid in full',

    'jobs.statusNow': 'Status: {status}.', 'jobs.created': 'Created: {name}.', 'jobs.saved': 'Changes saved.',
    'jobs.auto.title': 'Done for you by the automations',
    'jobs.auto.invoice': 'The invoice was created as a draft.', 'jobs.auto.task1': '1 follow-up task was added.', 'jobs.auto.tasks': '{n} follow-up tasks were added.',
    'jobs.auto.email': 'An email to the {client} was prepared for you to review.',
    'jobs.auto.worker1': 'The person assigned can see the work in their portal.', 'jobs.auto.workers': 'Everyone assigned ({n}) can see the work in their portal.',
    'jobs.auto.emailNote': 'Nothing is sent from the demo. Prepared emails wait in Messages.',
    'jobs.auto.seeDocs': 'See documents', 'jobs.auto.seeTasks': 'See tasks', 'jobs.auto.seeMessages': 'See messages',

    'jobs.notFound': 'That record does not exist any more. It may have been deleted.', 'jobs.noAddress': 'No address yet',
    'jobs.deleteConfirm': 'Delete "{name}"? Its tasks, documents and recorded payments are deleted too. This cannot be undone.',
    'jobs.tabs': 'Sections', 'jobs.tab.overview': 'Overview', 'jobs.tab.team': 'Team', 'jobs.tab.money': 'Money', 'jobs.tab.tasks': 'Tasks',
    'jobs.tab.documents': 'Documents', 'jobs.tab.log': 'Log and notes', 'jobs.tab.activity': 'Activity',

    'jobs.ov.money': 'Money', 'jobs.ov.profit': 'Expected profit', 'jobs.ov.margin': '{pct} margin', 'jobs.ov.collected': '{pct} of the price collected',
    'jobs.ov.split': 'Where the price goes', 'jobs.ov.left': 'Left after labor and expenses',
    'jobs.m.received': 'Received from the {client}', 'jobs.m.clientOwes': '{Client} still owes', 'jobs.m.oweWorkers': 'Still owed to the team',
    'jobs.ov.noScope': 'Nothing written yet. Use Edit to describe the work; it is carried into the estimate and the agreement.',
    'jobs.ov.noTerms': 'No payment terms written yet.', 'jobs.ov.fromLead': 'Started as lead', 'jobs.ov.nextVisits': 'Next visits', 'jobs.ov.calendar': 'Open the calendar',
    'jobs.ov.openTasks': 'Open tasks', 'jobs.ov.allTasks': 'All tasks', 'jobs.ov.noOpenTasks': 'No open tasks.', 'jobs.ov.contact': 'Contact',

    'jobs.team.empty': 'Nobody is assigned yet', 'jobs.team.emptyHint': 'Assign someone and agree on how the work is paid.',
    'jobs.team.col.pay': 'How it is paid', 'jobs.team.col.paid': 'Paid so far', 'jobs.team.col.owed': 'Still owed',
    'jobs.team.edit': 'Edit assignment', 'jobs.team.remove': 'Remove from the team', 'jobs.team.removeConfirm': 'Remove {name}? Payments already recorded stay in the history.',
    'jobs.team.removed': 'Removed from the team', 'jobs.team.saved': 'Assignment saved', 'jobs.team.payName': 'Pay {name}', 'jobs.team.gone': 'No longer on the team',
    'jobs.team.others': 'Includes {amount} paid to people who are not assigned here.', 'jobs.team.openTeam': 'Open the team',
    'jobs.pt.project': 'Fixed price', 'jobs.pt.milestone': 'By stage', 'jobs.pt.daily': 'By the day', 'jobs.pt.weekly': 'By the week', 'jobs.pt.monthly': 'By the month', 'jobs.pt.hourly': 'By the hour',
    'jobs.as.price': 'Agreed price', 'jobs.as.rate': 'Rate per {unit}', 'jobs.as.total': 'Agreed total', 'jobs.as.rateErr': 'Enter the agreed amount.',
    'jobs.as.qty.daily': 'Days', 'jobs.as.qty.weekly': 'Weeks', 'jobs.as.qty.monthly': 'Months', 'jobs.as.qty.hourly': 'Hours',

    'jobs.money.noRecv': 'No payments received yet.', 'jobs.money.noExp': 'No expenses recorded yet.', 'jobs.money.noPays': 'No payments to the team recorded here yet.',
    'jobs.money.removeRecv': 'Remove this payment of {amount}? The balance goes back up.', 'jobs.money.removeExp': 'Remove this expense of {amount}?',
    'jobs.money.removePay': 'Remove this payment of {amount} to {name}? It also leaves their totals.', 'jobs.money.removed': 'Removed', 'jobs.money.expAdded': 'Expense added',
    'jobs.money.period': '{type}, {from} to {to}', 'jobs.money.who': 'Paid to',

    'jobs.tasks.add': 'Add task', 'jobs.tasks.open': 'Open', 'jobs.tasks.done': 'Completed', 'jobs.tasks.none': 'No tasks here yet.', 'jobs.tasks.noneOpen': 'Nothing open. Everything here is done.',
    'jobs.tasks.noneHint': 'Add what has to happen and who does it.',

    'jobs.docs.none': 'No documents yet', 'jobs.docs.hint': 'Each document is filled in from this page: {client}, address, details, price and payments.',
    'jobs.docs.create': 'Create {doc}', 'jobs.docs.open': 'Open {doc}', 'jobs.docs.updated': 'Updated {date}', 'jobs.docs.make': 'Create or open', 'jobs.docs.demoSign': 'Signature status in the demo is simulated.',

    'jobs.log.add': 'Add update', 'jobs.log.who': 'Who is reporting', 'jobs.log.what': 'What was done', 'jobs.log.none': 'No updates yet.', 'jobs.log.added': 'Update added',
    'jobs.log.portalHint': 'Updates written from the team portal appear here too.', 'jobs.log.you': '{name} (you)',

    'jobs.f.newClient': 'New {client}', 'jobs.f.newName': 'Name of the new {client}', 'jobs.f.addressHint': 'Filled in from the {client} record. Change it if the work is somewhere else.',
    'jobs.f.datesErr': 'The end date is before the start date.', 'jobs.f.repeatHint': 'Repeat visits go on the calendar by themselves.', 'jobs.f.priceHint': 'Leave it empty until the price is agreed.',
  },
  es: {
    'jobs.noCosts': 'Sin costos aún',
    'jobs.sub': 'Cada {job} con su equipo, dinero, tareas y documentos en un solo lugar.', 'jobs.edit': 'Editar {job}',
    'jobs.view': 'Vista', 'jobs.view.table': 'Tabla', 'jobs.view.board': 'Tablero',
    'jobs.search': 'Buscar por nombre, {client}, dirección o número', 'jobs.allManagers': 'Cualquier responsable', 'jobs.manager': 'Responsable',
    'jobs.col.dates': 'Fechas', 'jobs.col.received': 'Recibido',
    'jobs.sum.count': '{n} {jobs}', 'jobs.sum.active': '{n} en marcha', 'jobs.sum.value': 'Valor en marcha',
    'jobs.empty': 'Aún no hay {jobs}', 'jobs.emptyHint': 'Agregue el primero aquí. Cuando se gana un prospecto, también se crea solo.',
    'jobs.noDates': 'Sin fechas todavía', 'jobs.to': 'a', 'jobs.until': 'Hasta el {date}', 'jobs.notSet': 'Sin definir',
    'jobs.repeat': 'Se repite', 'jobs.rp.once': 'Una vez', 'jobs.rp.weekly': 'Cada semana', 'jobs.rp.biweekly': 'Cada 2 semanas', 'jobs.rp.monthly': 'Cada mes',
    'jobs.moveTo': 'Mover a', 'jobs.drop': 'Suelte una tarjeta aquí', 'jobs.paid': 'Pagado por completo',

    'jobs.statusNow': 'Estado: {status}.', 'jobs.created': 'Se creó: {name}.', 'jobs.saved': 'Cambios guardados.',
    'jobs.auto.title': 'Lo que las automatizaciones hicieron por usted',
    'jobs.auto.invoice': 'Se creó la factura como borrador.', 'jobs.auto.task1': 'Se agregó 1 tarea de seguimiento.', 'jobs.auto.tasks': 'Se agregaron {n} tareas de seguimiento.',
    'jobs.auto.email': 'Se preparó un correo para el {client}, listo para que usted lo revise.',
    'jobs.auto.worker1': 'La persona asignada ya ve el trabajo en su portal.', 'jobs.auto.workers': 'Las {n} personas asignadas ya ven el trabajo en su portal.',
    'jobs.auto.emailNote': 'Desde la demo no se envía nada. Los correos preparados esperan en Mensajes.',
    'jobs.auto.seeDocs': 'Ver documentos', 'jobs.auto.seeTasks': 'Ver tareas', 'jobs.auto.seeMessages': 'Ver mensajes',

    'jobs.notFound': 'Ese registro ya no existe. Es posible que lo hayan borrado.', 'jobs.noAddress': 'Sin dirección todavía',
    'jobs.deleteConfirm': '¿Borrar "{name}"? También se borran sus tareas, documentos y pagos registrados. No se puede deshacer.',
    'jobs.tabs': 'Secciones', 'jobs.tab.overview': 'Resumen', 'jobs.tab.team': 'Equipo', 'jobs.tab.money': 'Dinero', 'jobs.tab.tasks': 'Tareas',
    'jobs.tab.documents': 'Documentos', 'jobs.tab.log': 'Bitácora y notas', 'jobs.tab.activity': 'Actividad',

    'jobs.ov.money': 'Dinero', 'jobs.ov.profit': 'Ganancia esperada', 'jobs.ov.margin': '{pct} de margen', 'jobs.ov.collected': 'Cobrado el {pct} del precio',
    'jobs.ov.split': 'A dónde va el precio', 'jobs.ov.left': 'Lo que queda después de mano de obra y gastos',
    'jobs.m.received': 'Recibido del {client}', 'jobs.m.clientOwes': 'El {client} aún debe', 'jobs.m.oweWorkers': 'Falta pagar al equipo',
    'jobs.ov.noScope': 'Todavía no hay nada escrito. Use Editar para describir el trabajo; pasa al presupuesto y al acuerdo.',
    'jobs.ov.noTerms': 'Aún no se escriben las condiciones de pago.', 'jobs.ov.fromLead': 'Empezó como prospecto', 'jobs.ov.nextVisits': 'Próximas visitas', 'jobs.ov.calendar': 'Abrir el calendario',
    'jobs.ov.openTasks': 'Tareas abiertas', 'jobs.ov.allTasks': 'Todas las tareas', 'jobs.ov.noOpenTasks': 'No hay tareas abiertas.', 'jobs.ov.contact': 'Contacto',

    'jobs.team.empty': 'Aún no hay nadie asignado', 'jobs.team.emptyHint': 'Asigne a alguien y acuerde cómo se le paga el trabajo.',
    'jobs.team.col.pay': 'Cómo se paga', 'jobs.team.col.paid': 'Pagado hasta hoy', 'jobs.team.col.owed': 'Falta pagar',
    'jobs.team.edit': 'Editar asignación', 'jobs.team.remove': 'Quitar del equipo', 'jobs.team.removeConfirm': '¿Quitar a {name}? Los pagos ya registrados se conservan en el historial.',
    'jobs.team.removed': 'Se quitó del equipo', 'jobs.team.saved': 'Asignación guardada', 'jobs.team.payName': 'Pagar a {name}', 'jobs.team.gone': 'Ya no está en el equipo',
    'jobs.team.others': 'Incluye {amount} pagados a personas que no están asignadas aquí.', 'jobs.team.openTeam': 'Abrir el equipo',
    'jobs.pt.project': 'Precio fijo', 'jobs.pt.milestone': 'Por etapa', 'jobs.pt.daily': 'Por día', 'jobs.pt.weekly': 'Por semana', 'jobs.pt.monthly': 'Por mes', 'jobs.pt.hourly': 'Por hora',
    'jobs.as.price': 'Precio acordado', 'jobs.as.rate': 'Tarifa por {unit}', 'jobs.as.total': 'Total acordado', 'jobs.as.rateErr': 'Escriba el monto acordado.',
    'jobs.as.qty.daily': 'Días', 'jobs.as.qty.weekly': 'Semanas', 'jobs.as.qty.monthly': 'Meses', 'jobs.as.qty.hourly': 'Horas',

    'jobs.money.noRecv': 'Aún no se reciben pagos.', 'jobs.money.noExp': 'Aún no hay gastos registrados.', 'jobs.money.noPays': 'Aún no hay pagos al equipo registrados aquí.',
    'jobs.money.removeRecv': '¿Quitar este pago de {amount}? El saldo vuelve a subir.', 'jobs.money.removeExp': '¿Quitar este gasto de {amount}?',
    'jobs.money.removePay': '¿Quitar este pago de {amount} a {name}? También sale de sus totales.', 'jobs.money.removed': 'Se quitó', 'jobs.money.expAdded': 'Gasto agregado',
    'jobs.money.period': '{type}, del {from} al {to}', 'jobs.money.who': 'Pagado a',

    'jobs.tasks.add': 'Agregar tarea', 'jobs.tasks.open': 'Abiertas', 'jobs.tasks.done': 'Completadas', 'jobs.tasks.none': 'Aún no hay tareas aquí.', 'jobs.tasks.noneOpen': 'No hay nada abierto. Todo está hecho.',
    'jobs.tasks.noneHint': 'Agregue lo que hay que hacer y quién lo hace.',

    'jobs.docs.none': 'Aún no hay documentos', 'jobs.docs.hint': 'Cada documento se llena con los datos de esta página: {client}, dirección, detalles, precio y pagos.',
    'jobs.docs.create': 'Crear {doc}', 'jobs.docs.open': 'Abrir {doc}', 'jobs.docs.updated': 'Actualizado el {date}', 'jobs.docs.make': 'Crear o abrir', 'jobs.docs.demoSign': 'En la demo, el estado de la firma es simulado.',

    'jobs.log.add': 'Agregar avance', 'jobs.log.who': 'Quién reporta', 'jobs.log.what': 'Qué se hizo', 'jobs.log.none': 'Aún no hay avances.', 'jobs.log.added': 'Avance agregado',
    'jobs.log.portalHint': 'Los avances que su equipo escribe desde su portal también aparecen aquí.', 'jobs.log.you': '{name} (usted)',

    'jobs.f.newClient': 'Nuevo {client}', 'jobs.f.newName': 'Nombre del nuevo {client}', 'jobs.f.addressHint': 'Se llena con la dirección del {client}. Cámbiela si el trabajo es en otro lugar.',
    'jobs.f.datesErr': 'La fecha final es anterior a la fecha de inicio.', 'jobs.f.repeatHint': 'Las visitas que se repiten entran solas al calendario.', 'jobs.f.priceHint': 'Déjelo vacío hasta que se acuerde el precio.',
  },
};
