import type { Dict } from '@/i18n';

// Wording for the dashboard. Industry words come from tokens ({job}, {workers}, {clients}); Spanish avoids
// adjectives that would have to agree with them, because the industry word changes gender between editions.
export const dict: Dict = {
  en: {
    'dash.hi.morning': 'Good morning', 'dash.hi.afternoon': 'Good afternoon', 'dash.hi.evening': 'Good evening',
    'dash.sum.items': '{n} items need attention', 'dash.sum.items.one': '1 item needs attention',
    'dash.sum.tasks': '{n} tasks due', 'dash.sum.tasks.one': '1 task due', 'dash.sum.clear': 'Nothing urgent right now',
    'dash.actions': 'Quick actions', 'dash.act.lead': 'New lead', 'dash.act.payment': 'Record payment', 'dash.act.task': 'New task',

    'dash.tour.title': 'First time here? Take the guided tour', 'dash.tour.text': 'A short walk through leads, {jobs}, payments and the work that runs by itself. This is a sample company, so click anything.',
    'dash.tour.start': 'Start the tour', 'dash.tour.dismiss': 'Hide this invitation',

    'dash.kpis': 'Key figures',
    'dash.kpi.activeJobs': '{Jobs} in progress', 'dash.kpi.activeValue': 'Value in progress', 'dash.kpi.expectedProfit': 'Expected profit',
    'dash.kpi.clientsOwe': '{Clients} owe you', 'dash.kpi.oweWorkers': 'You owe {workers}', 'dash.kpi.newLeads': 'New leads', 'dash.kpi.pipelineValue': 'Open pipeline',
    'dash.kpi.visitsThisWeek': 'Visits, next 7 days', 'dash.kpi.overdueTasks': 'Overdue tasks', 'dash.kpi.recurringClients': 'Recurring {clients}', 'dash.kpi.collectedMonth': 'Collected this month',
    'dash.hint.waiting': '{n} waiting to start', 'dash.hint.acrossJobs': 'Across {n} {jobs}', 'dash.hint.acrossJobs.one': 'On 1 {job}', 'dash.hint.margin': '{pct} margin',
    'dash.hint.balances': 'On {n} {jobs}', 'dash.hint.balances.one': 'On 1 {job}', 'dash.hint.nobodyOwes': 'Everything is collected',
    'dash.hint.oweWorkers': 'Agreed, not paid yet', 'dash.hint.oweNothing': 'Everyone is paid up',
    'dash.hint.openLeads': '{n} open in total', 'dash.hint.pipeline': 'Open leads: {n}', 'dash.hint.visits': 'Visits and start dates',
    'dash.hint.dueToday': '{n} more due today', 'dash.hint.noneLate': 'Nothing is late', 'dash.hint.recurring': 'On a repeating schedule', 'dash.hint.payments': '{n} payments received', 'dash.hint.payments.one': '1 payment received',
    'dash.kpi.hiddenMoney': 'Money figures are hidden for the {role} role.', 'dash.kpi.hiddenProfit': 'Profit is visible to the {role} role only.',

    'dash.att.title': 'Needs attention', 'dash.att.clear': 'Nothing needs attention', 'dash.att.clearHint': 'No overdue tasks, late follow-ups or missing paperwork. Nice work.',
    'dash.att.overdueTask': 'Overdue tasks', 'dash.att.followUp': 'Follow-ups due', 'dash.att.w9Missing': 'W-9 missing', 'dash.att.coiExpired': 'Insurance expired',
    'dash.att.coiSoon': 'Insurance expiring soon', 'dash.att.docWaiting': 'Waiting on signature', 'dash.att.balance': 'Completed, not paid in full', 'dash.att.newLead': 'New leads to contact',
    'dash.att.more': '{n} more', 'dash.att.sentOn': 'Sent {date}', 'dash.att.expired': 'Expired {date}', 'dash.att.expires': 'Expires {date}', 'dash.att.owes': '{amount} open',

    'dash.today.title': 'Today and overdue', 'dash.today.mine': 'Mine', 'dash.today.team': 'Everyone', 'dash.today.who': 'Whose tasks',
    'dash.today.empty': 'Nothing due today', 'dash.today.emptyHint': 'Tasks due today or already late show here.', 'dash.today.emptyMine': 'Nothing is due for you today. The team still has {n}.',
    'dash.today.all': 'All tasks', 'dash.today.more': 'Show {n} more', 'dash.today.showTeam': 'Show everyone',

    'dash.up.title': 'Coming up', 'dash.up.sub': 'Next 7 days', 'dash.up.empty': 'Nothing is scheduled for the next 7 days.', 'dash.up.calendar': 'Calendar', 'dash.up.tomorrow': 'Tomorrow',
    'dash.up.more': '{n} more on the calendar', 'dash.ev.visit': 'Repeat visit',

    'dash.active.title': 'Active {jobs}', 'dash.active.all': 'All {jobs}', 'dash.active.empty': 'Nothing is active right now', 'dash.active.emptyHint': 'Win a lead or add one directly and it shows here.',
    'dash.active.col.job': '{Job}', 'dash.active.col.received': 'Received', 'dash.active.col.profit': 'Expected profit', 'dash.active.col.start': 'Start',
    'dash.active.received': '{received} of {price}', 'dash.active.receivedLabel': '{received} received of {price}', 'dash.active.noPrice': 'No price yet', 'dash.active.more': '{n} more',

    'dash.pipe.title': 'Pipeline', 'dash.pipe.board': 'Open the board', 'dash.pipe.empty': 'No open leads right now.', 'dash.pipe.total': '{n} open leads', 'dash.pipe.total.one': '1 open lead',
    'dash.pipe.row': '{stage}: {n}, {value}',

    'dash.activity.title': 'Recent activity', 'dash.auto.title': 'Handled for you', 'dash.auto.all': 'Automations', 'dash.auto.empty': 'When a rule does routine work for you, it shows here.',
    'dash.auto.more': '+{n} more',
  },
  es: {
    'dash.hi.morning': 'Buenos días', 'dash.hi.afternoon': 'Buenas tardes', 'dash.hi.evening': 'Buenas noches',
    'dash.sum.items': '{n} asuntos requieren atención', 'dash.sum.items.one': '1 asunto requiere atención',
    'dash.sum.tasks': '{n} tareas por hacer', 'dash.sum.tasks.one': '1 tarea por hacer', 'dash.sum.clear': 'Nada urgente por ahora',
    'dash.actions': 'Acciones rápidas', 'dash.act.lead': 'Nuevo prospecto', 'dash.act.payment': 'Registrar pago', 'dash.act.task': 'Nueva tarea',

    'dash.tour.title': '¿Primera vez aquí? Haga el recorrido guiado', 'dash.tour.text': 'Un paseo breve por prospectos, {jobs}, pagos y el trabajo que se hace solo. Es una empresa de ejemplo, así que puede tocar todo.',
    'dash.tour.start': 'Iniciar el recorrido', 'dash.tour.dismiss': 'Ocultar esta invitación',

    'dash.kpis': 'Cifras clave',
    'dash.kpi.activeJobs': '{Jobs} en curso', 'dash.kpi.activeValue': 'Valor en curso', 'dash.kpi.expectedProfit': 'Ganancia esperada',
    'dash.kpi.clientsOwe': 'Por cobrar: {clients}', 'dash.kpi.oweWorkers': 'Por pagar: {workers}', 'dash.kpi.newLeads': 'Prospectos nuevos', 'dash.kpi.pipelineValue': 'Embudo abierto',
    'dash.kpi.visitsThisWeek': 'Visitas, próximos 7 días', 'dash.kpi.overdueTasks': 'Tareas atrasadas', 'dash.kpi.recurringClients': '{Clients} con servicio recurrente', 'dash.kpi.collectedMonth': 'Cobrado este mes',
    'dash.hint.waiting': '{n} por empezar', 'dash.hint.acrossJobs': 'En {n} {jobs}', 'dash.hint.acrossJobs.one': 'En 1 {job}', 'dash.hint.margin': 'Margen de {pct}',
    'dash.hint.balances': 'En {n} {jobs}', 'dash.hint.balances.one': 'En 1 {job}', 'dash.hint.nobodyOwes': 'Todo está cobrado',
    'dash.hint.oweWorkers': 'Acordado, falta pagar', 'dash.hint.oweNothing': 'Todos están al día',
    'dash.hint.openLeads': '{n} abiertos en total', 'dash.hint.pipeline': 'Prospectos abiertos: {n}', 'dash.hint.visits': 'Visitas e inicios',
    'dash.hint.dueToday': '{n} más para hoy', 'dash.hint.noneLate': 'Nada está atrasado', 'dash.hint.recurring': 'Con un horario que se repite', 'dash.hint.payments': '{n} pagos recibidos', 'dash.hint.payments.one': '1 pago recibido',
    'dash.kpi.hiddenMoney': 'Las cifras de dinero están ocultas para el rol {role}.', 'dash.kpi.hiddenProfit': 'La ganancia solo la ve el rol {role}.',

    'dash.att.title': 'Requiere atención', 'dash.att.clear': 'Nada requiere atención', 'dash.att.clearHint': 'No hay tareas atrasadas, seguimientos vencidos ni papeles pendientes. Buen trabajo.',
    'dash.att.overdueTask': 'Tareas atrasadas', 'dash.att.followUp': 'Seguimientos pendientes', 'dash.att.w9Missing': 'Falta el W-9', 'dash.att.coiExpired': 'Seguro vencido',
    'dash.att.coiSoon': 'Seguro por vencer', 'dash.att.docWaiting': 'Esperando firma', 'dash.att.balance': 'Terminado, con saldo pendiente', 'dash.att.newLead': 'Prospectos nuevos por contactar',
    'dash.att.more': '{n} más', 'dash.att.sentOn': 'Enviado el {date}', 'dash.att.expired': 'Venció el {date}', 'dash.att.expires': 'Vence el {date}', 'dash.att.owes': '{amount} pendiente',

    'dash.today.title': 'Hoy y atrasadas', 'dash.today.mine': 'Mías', 'dash.today.team': 'Todo el equipo', 'dash.today.who': 'Tareas de quién',
    'dash.today.empty': 'Nada vence hoy', 'dash.today.emptyHint': 'Aquí aparecen las tareas de hoy y las atrasadas.', 'dash.today.emptyMine': 'Usted no tiene nada para hoy. El equipo todavía tiene {n}.',
    'dash.today.all': 'Todas las tareas', 'dash.today.more': 'Ver {n} más', 'dash.today.showTeam': 'Ver todo el equipo',

    'dash.up.title': 'Lo que viene', 'dash.up.sub': 'Próximos 7 días', 'dash.up.empty': 'No hay nada programado para los próximos 7 días.', 'dash.up.calendar': 'Calendario', 'dash.up.tomorrow': 'Mañana',
    'dash.up.more': '{n} más en el calendario', 'dash.ev.visit': 'Visita recurrente',

    'dash.active.title': '{Jobs} vigentes', 'dash.active.all': 'Ver todo', 'dash.active.empty': 'No hay nada en curso por ahora', 'dash.active.emptyHint': 'Cuando gane un prospecto o agregue trabajo nuevo, aparecerá aquí.',
    'dash.active.col.job': '{Job}', 'dash.active.col.received': 'Recibido', 'dash.active.col.profit': 'Ganancia esperada', 'dash.active.col.start': 'Inicio',
    'dash.active.received': '{received} de {price}', 'dash.active.receivedLabel': 'Recibido {received} de {price}', 'dash.active.noPrice': 'Sin precio todavía', 'dash.active.more': '{n} más',

    'dash.pipe.title': 'Embudo', 'dash.pipe.board': 'Abrir el tablero', 'dash.pipe.empty': 'No hay prospectos abiertos por ahora.', 'dash.pipe.total': '{n} prospectos abiertos', 'dash.pipe.total.one': '1 prospecto abierto',
    'dash.pipe.row': '{stage}: {n}, {value}',

    'dash.activity.title': 'Actividad reciente', 'dash.auto.title': 'Hecho automáticamente', 'dash.auto.all': 'Automatizaciones', 'dash.auto.empty': 'Cuando una regla haga trabajo de rutina por usted, aparecerá aquí.',
    'dash.auto.more': '+{n} más',
  },
};
