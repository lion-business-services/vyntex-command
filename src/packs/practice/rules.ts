// The automations the professional-services edition ships with. Plain data: WHEN an event, IF conditions, THEN steps.
// A company can switch each one off, change it, add its own next to them, and put a shipped one back the way it shipped.
//
// What is on from the start is only what is safe without anyone looking: tasks, notes to the team, and messages to a
// client PREPARED AS A DRAFT for a person to read and send. No rule here sends anything to a client by itself.
// The wording of the messages is ours, plain and short; a firm edits it in the rule before relying on it.
// Merge fields are filled from the records of the event: {{first_name}}, {{company}}, {{appointment.date}}, ...
// (the list is in src/domain/rules/steps.ts).
//
// This file imports nothing but types, so the edition's pack, the wording and the engine can all read it.
import type { L10n, MessageChannel, Priority, RuleCond, RuleDef, RuleEvent, RuleStep } from '@/domain/types';

const l = (en: string, es: string): L10n => ({ en, es });
/** Events the engine knows that the data model's list does not name yet (see src/domain/rules/fields.ts). */
const extra = (e: 'appointment.soon' | 'appointment.pay_soon' | 'opportunity.created' | 'credit.expiring') => e as RuleEvent;

type Who = 'owner' | 'manager' | 'record_owner';
const task = (title: string, titleEs: string, who: Who, dueIn = 0, pri: Priority = 'medium', type?: string): RuleStep =>
  ({ do: 'task', params: { title, titleEs, for: who, dueIn, pri, ...(type ? { type } : {}) } });
/** A message to the client or lead, prepared for a person to review. Never `send`. */
const draft = (subject: string, subjectEs: string, body: string, bodyEs: string, channel: MessageChannel = 'email'): RuleStep =>
  ({ do: 'message', params: { channel, mode: 'draft', subject, subjectEs, body, bodyEs } });
const notify = (who: Who, text: string, textEs: string): RuleStep => ({ do: 'notify', params: { who, text, textEs } });
/** One of the coded rules every edition has always had (src/domain/automations.ts), run unchanged. */
const builtin = (id: string, event: RuleEvent, name: L10n): RuleDef => ({ id, name, active: true, when: { event }, if: [], then: [{ do: 'builtin', params: { rule: id } }], shipped: true });
const rule = (id: string, name: L10n, about: L10n, event: RuleEvent, then: RuleStep[], more: { if?: RuleCond[]; days?: number; off?: boolean } = {}): RuleDef =>
  ({ id, name, about, active: !more.off, when: { event, ...(more.days !== undefined ? { days: more.days } : {}) }, if: more.if ?? [], then, shipped: true });

const SIGN = '\n\n{{company}}';
const SIGN_ES = '\n\n{{company}}';

export const practiceRules: RuleDef[] = [
  // ---- leads
  builtin('lead-intake', 'lead.created', l('New lead intake', 'Entrada de prospectos')),
  rule('p-lead-ack', l('New lead acknowledgement', 'Acuse de recibo al prospecto'),
    l('Prepares a short email telling a new lead their request arrived.', 'Prepara un correo breve para avisar al prospecto que su solicitud llegó.'),
    'lead.created', [draft('We received your request', 'Recibimos su solicitud',
      'Hello {{first_name}},\n\nThank you for contacting {{company}}. We received your request and someone from our office will call you to go over it.' + SIGN,
      'Hola {{first_name}}:\n\nGracias por comunicarse con {{company}}. Recibimos su solicitud y alguien de nuestra oficina le llamará para revisarla.' + SIGN_ES)],
    { if: [{ field: 'lead.email', op: 'not_empty' }] }),
  rule('p-lead-idle', l('Idle lead nudge', 'Aviso de prospecto sin contacto'),
    l('Creates a task for the lead owner when nobody has been in touch for a few days.', 'Crea una tarea para el responsable cuando nadie ha contactado al prospecto en varios días.'),
    'lead.idle', [task('Follow up with {{lead.name}}: no contact for {{days}} days', 'Dar seguimiento a {{lead.name}}: {{days}} días sin contacto', 'record_owner', 0, 'medium', 'call')], { days: 3 }),
  builtin('visit-prep', 'lead.stage', l('Appointment preparation', 'Preparación de la cita')),
  builtin('estimate-follow-up', 'lead.stage', l('Proposal follow-up', 'Seguimiento de la propuesta')),
  builtin('lead-won', 'lead.won', l('Won lead to engagement', 'De prospecto ganado a encargo')),
  rule('p-lead-won-notify', l('Won lead notice', 'Aviso de prospecto ganado'),
    l('Tells the senior associate when a lead becomes a client.', 'Avisa al asociado sénior cuando un prospecto se convierte en cliente.'),
    'lead.won', [notify('manager', '{{lead.name}} is now a client. The engagement "{{job.name}}" is open.', '{{lead.name}} ya es cliente. El encargo "{{job.name}}" está abierto.')]),

  // ---- appointments
  rule('p-appt-confirm', l('Appointment confirmation', 'Confirmación de cita'),
    l('Prepares a confirmation when an appointment is booked or moved.', 'Prepara una confirmación cuando se programa o se cambia una cita.'),
    'appointment.booked', [draft('Your appointment on {{appointment.date}}', 'Su cita del {{appointment.date}}',
      'Hello {{first_name}},\n\nYour appointment with {{company}} is set for {{appointment.date}} at {{appointment.time}}.\n\nIf you need to change it, reply to this message or call us.' + SIGN,
      'Hola {{first_name}}:\n\nSu cita con {{company}} quedó para el {{appointment.date}} a las {{appointment.time}}.\n\nSi necesita cambiarla, responda a este mensaje o llámenos.' + SIGN_ES)]),
  rule('p-appt-reminder', l('Appointment reminder', 'Recordatorio de cita'),
    l('Prepares a reminder the day before an appointment.', 'Prepara un recordatorio el día anterior a la cita.'),
    extra('appointment.soon'), [draft('Reminder: your appointment on {{appointment.date}}', 'Recordatorio: su cita del {{appointment.date}}',
      'Hello {{first_name}},\n\nThis is a reminder of your appointment with {{company}} on {{appointment.date}} at {{appointment.time}}.\n\nIf you cannot make it, please let us know.' + SIGN,
      'Hola {{first_name}}:\n\nLe recordamos su cita con {{company}} el {{appointment.date}} a las {{appointment.time}}.\n\nSi no puede asistir, por favor avísenos.' + SIGN_ES)], { days: 1 }),
  rule('p-appt-pay-reminder', l('Unpaid appointment reminder', 'Recordatorio de cita sin pagar'),
    l('Prepares a reminder when a prepaid appointment is still unpaid a day before its deadline.', 'Prepara un recordatorio cuando una cita con pago anticipado sigue sin pagar un día antes del plazo.'),
    extra('appointment.pay_soon'), [draft('Payment needed to keep your appointment', 'Falta el pago para conservar su cita',
      'Hello {{first_name}},\n\nYour appointment on {{appointment.date}} at {{appointment.time}} is held until we receive the payment. Please pay before the deadline so the time stays yours.' + SIGN,
      'Hola {{first_name}}:\n\nSu cita del {{appointment.date}} a las {{appointment.time}} queda apartada hasta que recibamos el pago. Por favor pague antes del plazo para conservar el horario.' + SIGN_ES)]),
  rule('p-appt-released', l('Unpaid appointment released', 'Cita sin pagar liberada'),
    l('Prepares a notice when an unpaid appointment is released, and a task to call the person.', 'Prepara un aviso cuando se libera una cita sin pagar y una tarea para llamar a la persona.'),
    'appointment.unpaid', [
      draft('Your appointment time was released', 'El horario de su cita fue liberado',
        'Hello {{first_name}},\n\nWe did not receive the payment for your appointment on {{appointment.date}}, so that time was released. Reply to this message or call us to set a new one.' + SIGN,
        'Hola {{first_name}}:\n\nNo recibimos el pago de su cita del {{appointment.date}}, así que ese horario fue liberado. Responda a este mensaje o llámenos para programar otra.' + SIGN_ES),
      task('Call {{name}}: the unpaid appointment was released', 'Llamar a {{name}}: se liberó la cita sin pagar', 'record_owner', 1, 'medium', 'call'),
    ]),
  rule('p-appt-paid', l('Appointment payment confirmation', 'Confirmación de pago de cita'),
    l('Prepares a confirmation when an appointment is paid.', 'Prepara una confirmación cuando se paga una cita.'),
    'appointment.paid', [draft('Payment received, your appointment is confirmed', 'Pago recibido, su cita está confirmada',
      'Hello {{first_name}},\n\nWe received your payment. Your appointment on {{appointment.date}} at {{appointment.time}} is confirmed.' + SIGN,
      'Hola {{first_name}}:\n\nRecibimos su pago. Su cita del {{appointment.date}} a las {{appointment.time}} está confirmada.' + SIGN_ES)]),
  rule('p-appt-cancelled', l('Appointment cancellation notice', 'Aviso de cita cancelada'),
    l('Prepares a notice when an appointment is cancelled.', 'Prepara un aviso cuando se cancela una cita.'),
    'appointment.cancelled', [draft('Your appointment was cancelled', 'Su cita fue cancelada',
      'Hello {{first_name}},\n\nYour appointment on {{appointment.date}} at {{appointment.time}} was cancelled. To set a new time, reply to this message or call us.' + SIGN,
      'Hola {{first_name}}:\n\nSu cita del {{appointment.date}} a las {{appointment.time}} fue cancelada. Para programar otra, responda a este mensaje o llámenos.' + SIGN_ES)], { off: true }),
  rule('p-appt-noshow', l('No-show follow-up', 'Seguimiento de inasistencia'),
    l('Creates a task to call the person and prepares a message when someone misses an appointment.', 'Crea una tarea para llamar a la persona y prepara un mensaje cuando alguien falta a su cita.'),
    'appointment.no_show', [
      task('Call {{name}} about the missed appointment', 'Llamar a {{name}} por la cita a la que no asistió', 'record_owner', 0, 'high', 'call'),
      draft('We missed you', 'No pudimos atenderle',
        'Hello {{first_name}},\n\nWe had you down for {{appointment.date}} at {{appointment.time}} and did not see you. Reply to this message or call us and we will find a new time.' + SIGN,
        'Hola {{first_name}}:\n\nLe esperábamos el {{appointment.date}} a las {{appointment.time}} y no pudimos atenderle. Responda a este mensaje o llámenos y buscamos otro horario.' + SIGN_ES),
    ]),
  rule('p-appt-noshow-repeat', l('Repeated no-show notice', 'Aviso de inasistencia repetida'),
    l('Tells the senior associate when the same person misses a second appointment.', 'Avisa al asociado sénior cuando la misma persona falta a una segunda cita.'),
    'appointment.no_show', [notify('manager', '{{name}} missed another appointment, on {{appointment.date}}.', '{{name}} volvió a faltar a una cita, el {{appointment.date}}.')],
    { if: [{ field: 'extra.noShows', op: 'gt', value: 1 }] }),
  rule('p-appt-followup', l('After-appointment follow-up', 'Seguimiento después de la cita'),
    l('Creates a task to write down what was agreed once an appointment is completed.', 'Crea una tarea para anotar lo acordado cuando se completa una cita.'),
    'appointment.completed', [task('Write down what was agreed with {{name}} and the next step', 'Anotar lo acordado con {{name}} y el siguiente paso', 'record_owner', 1)]),
  rule('p-credit-expiring', l('Credit about to expire', 'Crédito por vencer'),
    l('Prepares a reminder when a client credit is two weeks from running out.', 'Prepara un recordatorio cuando a un crédito del cliente le quedan dos semanas.'),
    extra('credit.expiring'), [draft('Your credit with us expires soon', 'Su crédito con nosotros está por vencer',
      'Hello {{first_name}},\n\nYou have a credit of {{amount}} with {{company}} that expires in {{days}} days. Reply to this message or call us to use it.' + SIGN,
      'Hola {{first_name}}:\n\nUsted tiene un crédito de {{amount}} con {{company}} que vence en {{days}} días. Responda a este mensaje o llámenos para usarlo.' + SIGN_ES)], { days: 14 }),

  // ---- engagements
  builtin('job-started', 'job.status', l('Engagement started', 'Inicio del encargo')),
  builtin('job-completed', 'job.status', l('Engagement completed', 'Cierre del encargo')),
  rule('p-review-request', l('Review request after completed work', 'Solicitud de reseña al terminar'),
    l('Prepares a review request a few days after an engagement is completed. The number of days is set on the Reviews screen.', 'Prepara una solicitud de reseña unos días después de completar un encargo. Los días se configuran en la pantalla de Reseñas.'),
    'review.due', [{ do: 'review', params: { channel: 'email' } }]),
  rule('p-cross-sell', l('Opportunity follow-up', 'Seguimiento de oportunidad'),
    l('Creates a task to talk to the client when a new opportunity is opened for them.', 'Crea una tarea para hablar con el cliente cuando se abre una oportunidad nueva.'),
    extra('opportunity.created'), [task('Talk to {{client.name}} about {{service}}', 'Hablar con {{client.name}} sobre {{service}}', 'record_owner', 3)]),

  // ---- billing
  builtin('payment-posted', 'payment.received', l('Payment posted', 'Pago registrado')),
  rule('p-payment-thanks', l('Payment thank-you', 'Agradecimiento por el pago'),
    l('Prepares a short thank-you when a payment is recorded.', 'Prepara un agradecimiento breve cuando se registra un pago.'),
    'payment.received', [draft('Thank you for your payment', 'Gracias por su pago',
      'Hello {{first_name}},\n\nWe received your payment of {{amount}} for "{{job.name}}". Thank you.' + SIGN,
      'Hola {{first_name}}:\n\nRecibimos su pago de {{amount}} por "{{job.name}}". Muchas gracias.' + SIGN_ES)], { off: true }),

  // ---- documents and signatures
  rule('p-doc-sent', l('Document sent check', 'Verificación de documento enviado'),
    l('Creates a task to check that the client received a document that was sent.', 'Crea una tarea para verificar que el cliente recibió un documento enviado.'),
    'doc.sent', [task('Check that {{client.name}} received {{doc.title}}', 'Verificar que {{client.name}} recibió {{doc.title}}', 'record_owner', 2, 'low', 'document')]),
  rule('p-envelope-idle', l('Unsigned document follow-up', 'Seguimiento de documento sin firmar'),
    l('Creates a task to call the client when a signature request has been reminded and is still not signed.', 'Crea una tarea para llamar al cliente cuando una solicitud de firma ya se recordó y sigue sin firmarse.'),
    'envelope.idle', [task('Call {{client.name}}: {{doc.title}} is still not signed', 'Llamar a {{client.name}}: {{doc.title}} sigue sin firmarse', 'record_owner', 0, 'medium', 'call')]),
  rule('p-envelope-completed', l('Signed document filing', 'Archivo de documento firmado'),
    l('Creates a task to file the signed copy when everyone has signed.', 'Crea una tarea para archivar la copia firmada cuando todos firmaron.'),
    'envelope.completed', [task('File the signed copy of {{doc.title}}', 'Archivar la copia firmada de {{doc.title}}', 'record_owner', 1, 'medium', 'document')]),

  // ---- tasks, deadlines and clients
  rule('p-task-overdue', l('Overdue task escalation', 'Escalamiento de tarea atrasada'),
    l('Tells the senior associate when a task is two days past its date.', 'Avisa al asociado sénior cuando una tarea lleva dos días de atraso.'),
    'task.overdue', [notify('manager', 'Overdue by {{days}} days: {{task.title}} ({{owner}})', 'Atrasada {{days}} días: {{task.title}} ({{owner}})')], { days: 2 }),
  rule('p-deadline-near', l('Deadline approaching', 'Fecha límite próxima'),
    l('Creates a task two weeks before a filing, renewal or other deadline.', 'Crea una tarea dos semanas antes de una presentación, renovación u otra fecha límite.'),
    'deadline.near', [task('Due in {{days}} days: {{title}}', 'Vence en {{days}} días: {{title}}', 'record_owner', 0, 'high')], { days: 14 }),
  rule('p-birthday', l('Birthday greeting', 'Felicitación de cumpleaños'),
    l('Prepares a greeting on a client\'s birthday.', 'Prepara una felicitación el día del cumpleaños del cliente.'),
    'client.birthday', [draft('Happy birthday, {{first_name}}', 'Feliz cumpleaños, {{first_name}}',
      'Hello {{first_name}},\n\nEveryone at {{company}} wishes you a happy birthday.' + SIGN,
      'Hola {{first_name}}:\n\nTodos en {{company}} le deseamos un feliz cumpleaños.' + SIGN_ES)], { days: 0, off: true }),
];
