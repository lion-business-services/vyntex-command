import type { Dict } from '@/i18n';

// Wording the assistant gained with the newer records: appointments, the service catalog, opportunities, documents
// waiting for a signature, deadlines, credits and reviews. The chip and example sentences (asst.chip.*, asst.ex.*) are
// requests the built-in assistant has to understand, so changing them means checking engine.ts still reads them
// (tests/unit/assistant.test.mjs asks every one of them).
export const more: Dict = {
  en: {
    'asst.off.title': 'The assistant is switched off', 'asst.off.text': 'It is off for this company, so it reads no records and nothing is sent to an AI model.',
    'asst.off.how': 'An owner can switch it on in Settings.', 'asst.off.on': 'Switch it on', 'asst.off.done': 'The assistant is on.',
    'asst.set.title': 'Assistant', 'asst.set.about': 'The assistant answers questions from the records of this workspace and prepares changes that a person has to confirm. It never shows a tax ID.',
    'asst.set.on': 'The assistant is on', 'asst.set.off': 'The assistant is off', 'asst.set.offNote': 'While it is off there is no assistant in the menu, in the search box or in the command palette, and no record is read by it.',
    'asst.set.modelNote': 'With an AI model connected, a summary of the records (names, dates, statuses and, for roles that see money, amounts) is sent to that model with each question. No phone number, email, address or tax ID is included.',
    'asst.set.turnOn': 'Switch on', 'asst.set.turnOff': 'Switch off', 'asst.set.saved.on': 'The assistant is on.', 'asst.set.saved.off': 'The assistant is off.',
    'asst.taxId': 'I do not have access to tax IDs and I never show them. They are kept in the secure section of the {client} record, for people who are allowed to see them.',
    // appointments
    'asst.chip.appts': 'Which appointments are coming up?', 'asst.ex.appt': 'Book an appointment with {name} tomorrow at 10am', 'asst.ex.review': 'Ask {name} for a review',
    'asst.appt.none': 'No appointment is on the books from today through {to}.', 'asst.appt.head': 'Appointments from today through {to}: {n}.', 'asst.appt.open': 'Open Appointments',
    'asst.appt.unpaid': 'waiting for payment', 'asst.appt.requested': 'requested, not confirmed',
    'asst.card.appt': 'Book an appointment', 'asst.row.with': 'With', 'asst.row.apptType': 'Type', 'asst.row.staff': 'Held by', 'asst.card.apptNote': 'The time is checked against the calendar when you confirm. Any confirmation message is prepared as a draft.',
    'asst.card.apptPrepay': 'This type is paid in advance: the appointment waits for payment before it is confirmed.',
    'asst.need.apptWho': 'Tell me who the appointment is with.', 'asst.need.apptWhen': 'Tell me the day and the time, for example tomorrow at 10am.', 'asst.appt.noTypes': 'There are no appointment types set up yet, so I cannot book one.',
    'asst.notFound.person': 'I could not find a {client} or an open lead matching "{q}".', 'asst.which.person2': 'More than one person matches. Who is the appointment with?', 'asst.which.apptType': 'Which kind of appointment?',
    'asst.done.appt': 'Done. The appointment with {name} is booked for {date}.', 'asst.done.apptPay': 'Done. The appointment with {name} is held for {date} and waits for payment.', 'asst.open.appt': 'Open the appointment',
    'asst.appt.double_booked': 'That time is already taken on the calendar, so nothing was booked.', 'asst.appt.past': 'That time has already passed, so nothing was booked.', 'asst.appt.unknown_type': 'That appointment type no longer exists.',
    'asst.appt.invalid': 'The appointment could not be booked with those details.', 'asst.appt.closed': 'The office is closed at that time, so nothing was booked.',
    // review requests
    'asst.card.review': 'Prepare a review request', 'asst.card.reviewNote': 'A draft message with the private link is prepared. Nothing is sent until someone sends it.', 'asst.row.about': 'About', 'asst.row.channel': 'Channel',
    'asst.need.reviewWho': 'Tell me which {client} to ask.', 'asst.done.review': 'Done. The review request for {name} is prepared as a draft.', 'asst.open.reviews': 'Open Reviews',
    'asst.review.none': 'No review request has been made yet.', 'asst.review.head': 'Review requests: {n}. Waiting for an answer: {waiting}. Answered: {rated}.', 'asst.review.avg': 'Average rating from the answers on record: {avg} of 5.',
    'asst.review.noAvg': 'Nobody has answered yet, so there is no average.',
    // catalog and engagements by service
    'asst.chip.services': 'What services do we offer?', 'asst.chip.byService': '{Jobs} by service', 'asst.cat.none': 'The service catalog is empty.', 'asst.cat.head': 'Active services in the catalog: {n}.',
    'asst.cat.from': 'from {price}', 'asst.cat.noPrice': 'no price set', 'asst.cat.open': 'Open the catalog', 'asst.cat.one': '{name}: {n} price options.', 'asst.cat.unit.flat': 'flat fee', 'asst.cat.unit.hour': 'per hour',
    'asst.cat.unit.month': 'per month', 'asst.cat.unit.quarter': 'per quarter', 'asst.cat.unit.year': 'per year',
    'asst.bySvc.none': 'There are no {jobs} under way right now.', 'asst.bySvc.head': '{Jobs} under way: {n}, by service.', 'asst.bySvc.one': '{Jobs} for {service}: {n}.', 'asst.bySvc.other': 'No service',
    // opportunities, signatures, deadlines, credits
    'asst.chip.opps': 'Which opportunities are open?', 'asst.opp.none': 'There are no open opportunities right now.', 'asst.opp.head': 'Open opportunities: {n}.', 'asst.opp.open': 'Open Opportunities', 'asst.opp.contacted': 'contacted',
    'asst.chip.sign': 'Which documents are waiting for a signature?', 'asst.sign.none': 'No document is waiting for a signature.', 'asst.sign.head': 'Documents waiting for a signature: {n}.', 'asst.sign.since': 'sent {date}',
    'asst.sign.waiting': 'waiting on {names}', 'asst.sign.open': 'Open Signatures',
    'asst.chip.deadlines': 'Which deadlines are coming up?', 'asst.dl.none': 'No deadline is overdue or due in the next 30 days.', 'asst.dl.head': 'Deadlines overdue or due in the next 30 days: {n}.', 'asst.dl.open': 'Open Deadlines',
    'asst.credit.none': 'No {client} has a credit that can still be used.', 'asst.credit.head': '{Clients} with a credit to use: {n}. Total: {total}.', 'asst.credit.exp': 'expires {date}', 'asst.credit.noExp': 'no expiry',
    'asst.chip.reviews': 'How are our reviews?',
  },
  es: {
    'asst.off.title': 'El asistente está apagado', 'asst.off.text': 'Está apagado para esta empresa, así que no lee ningún registro y no se envía nada a un modelo de IA.',
    'asst.off.how': 'Un dueño puede activarlo en Configuración.', 'asst.off.on': 'Activarlo', 'asst.off.done': 'El asistente está activo.',
    'asst.set.title': 'Asistente', 'asst.set.about': 'El asistente responde preguntas con los registros de este espacio y prepara cambios que una persona tiene que confirmar. Nunca muestra una identificación fiscal.',
    'asst.set.on': 'El asistente está activo', 'asst.set.off': 'El asistente está apagado', 'asst.set.offNote': 'Mientras esté apagado no hay asistente en el menú, en el buscador ni en la paleta de comandos, y no lee ningún registro.',
    'asst.set.modelNote': 'Con un modelo de IA conectado, con cada pregunta se le envía un resumen de los registros (nombres, fechas, estados y, para los roles que ven dinero, montos). No se incluyen teléfonos, correos, direcciones ni identificaciones fiscales.',
    'asst.set.turnOn': 'Activar', 'asst.set.turnOff': 'Apagar', 'asst.set.saved.on': 'El asistente está activo.', 'asst.set.saved.off': 'El asistente está apagado.',
    'asst.taxId': 'No tengo acceso a las identificaciones fiscales y nunca las muestro. Se guardan en la sección segura del registro del {client}, para las personas autorizadas a verlas.',
    'asst.chip.appts': '¿Qué citas vienen?', 'asst.ex.appt': 'Programa una cita con {name} mañana a las 10am', 'asst.ex.review': 'Pide una reseña a {name}',
    'asst.appt.none': 'No hay citas desde hoy hasta el {to}.', 'asst.appt.head': 'Citas desde hoy hasta el {to}: {n}.', 'asst.appt.open': 'Abrir Citas',
    'asst.appt.unpaid': 'esperando pago', 'asst.appt.requested': 'solicitada, sin confirmar',
    'asst.card.appt': 'Programar una cita', 'asst.row.with': 'Con', 'asst.row.apptType': 'Tipo', 'asst.row.staff': 'Atiende', 'asst.card.apptNote': 'El horario se revisa contra el calendario cuando usted confirma. Si hay un mensaje de confirmación, queda como borrador.',
    'asst.card.apptPrepay': 'Este tipo se paga por adelantado: la cita espera el pago antes de confirmarse.',
    'asst.need.apptWho': 'Dígame con quién es la cita.', 'asst.need.apptWhen': 'Dígame el día y la hora, por ejemplo mañana a las 10am.', 'asst.appt.noTypes': 'Todavía no hay tipos de cita configurados, así que no puedo programar una.',
    'asst.notFound.person': 'No encontré un {client} ni un prospecto abierto que coincida con "{q}".', 'asst.which.person2': 'Hay más de una persona que coincide. ¿Con quién es la cita?', 'asst.which.apptType': '¿Qué tipo de cita?',
    'asst.done.appt': 'Listo. La cita con {name} quedó para el {date}.', 'asst.done.apptPay': 'Listo. La cita con {name} quedó apartada para el {date} y espera el pago.', 'asst.open.appt': 'Abrir la cita',
    'asst.appt.double_booked': 'Ese horario ya está ocupado en el calendario, así que no se programó nada.', 'asst.appt.past': 'Ese horario ya pasó, así que no se programó nada.', 'asst.appt.unknown_type': 'Ese tipo de cita ya no existe.',
    'asst.appt.invalid': 'No se pudo programar la cita con esos datos.', 'asst.appt.closed': 'La oficina está cerrada a esa hora, así que no se programó nada.',
    'asst.card.review': 'Preparar una solicitud de reseña', 'asst.card.reviewNote': 'Se prepara un borrador con el enlace privado. No se envía nada hasta que alguien lo envíe.', 'asst.row.about': 'Sobre', 'asst.row.channel': 'Canal',
    'asst.need.reviewWho': 'Dígame a qué {client} pedirle la reseña.', 'asst.done.review': 'Listo. La solicitud de reseña para {name} quedó como borrador.', 'asst.open.reviews': 'Abrir Reseñas',
    'asst.review.none': 'Todavía no se ha hecho ninguna solicitud de reseña.', 'asst.review.head': 'Solicitudes de reseña: {n}. Esperando respuesta: {waiting}. Respondidas: {rated}.', 'asst.review.avg': 'Calificación promedio de las respuestas registradas: {avg} de 5.',
    'asst.review.noAvg': 'Nadie ha respondido todavía, así que no hay promedio.',
    'asst.chip.services': '¿Qué servicios ofrecemos?', 'asst.chip.byService': '{Jobs} por servicio', 'asst.cat.none': 'El catálogo de servicios está vacío.', 'asst.cat.head': 'Servicios activos en el catálogo: {n}.',
    'asst.cat.from': 'desde {price}', 'asst.cat.noPrice': 'sin precio', 'asst.cat.open': 'Abrir el catálogo', 'asst.cat.one': '{name}: {n} opciones de precio.', 'asst.cat.unit.flat': 'tarifa fija', 'asst.cat.unit.hour': 'por hora',
    'asst.cat.unit.month': 'por mes', 'asst.cat.unit.quarter': 'por trimestre', 'asst.cat.unit.year': 'por año',
    'asst.bySvc.none': 'Por ahora no hay {jobs} en curso.', 'asst.bySvc.head': '{Jobs} en curso: {n}, por servicio.', 'asst.bySvc.one': '{Jobs} de {service}: {n}.', 'asst.bySvc.other': 'Sin servicio',
    'asst.chip.opps': '¿Qué oportunidades están abiertas?', 'asst.opp.none': 'Por ahora no hay oportunidades abiertas.', 'asst.opp.head': 'Oportunidades abiertas: {n}.', 'asst.opp.open': 'Abrir Oportunidades', 'asst.opp.contacted': 'contactado',
    'asst.chip.sign': '¿Qué documentos esperan firma?', 'asst.sign.none': 'Ningún documento espera firma.', 'asst.sign.head': 'Documentos que esperan firma: {n}.', 'asst.sign.since': 'enviado el {date}',
    'asst.sign.waiting': 'falta {names}', 'asst.sign.open': 'Abrir Firmas',
    'asst.chip.deadlines': '¿Qué fechas límite vienen?', 'asst.dl.none': 'No hay fechas límite atrasadas ni en los próximos 30 días.', 'asst.dl.head': 'Fechas límite atrasadas o en los próximos 30 días: {n}.', 'asst.dl.open': 'Abrir Fechas límite',
    'asst.credit.none': 'Ningún {client} tiene un crédito por usar.', 'asst.credit.head': '{Clients} con crédito por usar: {n}. Total: {total}.', 'asst.credit.exp': 'vence el {date}', 'asst.credit.noExp': 'sin vencimiento',
    'asst.chip.reviews': '¿Cómo van nuestras reseñas?',
  },
};

/**
 * Lines that read differently where the assistant is not called VYNTEX AI (LBS Command): its name in the menu, on its own
 * page, in the search box and in the command palette, and the dashboard card that links to it.
 */
export const plainName: Dict = {
  en: {
    'asst.title': 'Assistant', 'asst.name': 'Assistant', 'nav.assistant': 'Assistant',
    'asst.sub': 'Ask in plain words, in English or Spanish, or tell it what to record. It answers from your records and asks before it changes anything.',
    'cmd.placeholder': 'Search or ask the assistant…', 'cmd.ai': 'Assistant', 'cmd.ask': 'Ask the assistant', 'cmd.askQ': 'Ask the assistant: “{q}”',
    'dash.ai.title': 'The assistant suggests', 'dash.ai.open': 'Open the assistant',
    'asst.mode.builtin': 'Built-in assistant', 'asst.mode.builtinHint': 'No AI model is connected. The built-in assistant understands a fixed list of requests and answers only from the records in this workspace.',
    'asst.mode.plan': '',
  },
  es: {
    'asst.title': 'Asistente', 'asst.name': 'Asistente', 'nav.assistant': 'Asistente',
    'asst.sub': 'Pregunte con sus palabras, en español o en inglés, o dígale qué registrar. Responde con sus registros y pregunta antes de cambiar algo.',
    'cmd.placeholder': 'Busque o pregunte al asistente…', 'cmd.ai': 'Asistente', 'cmd.ask': 'Preguntar al asistente', 'cmd.askQ': 'Preguntar al asistente: “{q}”',
    'dash.ai.title': 'El asistente sugiere', 'dash.ai.open': 'Abrir el asistente',
    'asst.mode.builtin': 'Asistente integrado', 'asst.mode.builtinHint': 'No hay un modelo de IA conectado. El asistente integrado entiende una lista fija de solicitudes y responde solo con los registros de este espacio.',
    'asst.mode.plan': '',
  },
  zh: { 'asst.title': '助手', 'asst.name': '助手', 'nav.assistant': '助手' },
};
