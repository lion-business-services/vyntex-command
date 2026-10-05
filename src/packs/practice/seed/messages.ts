// Sample conversations of the sample firm, across the channels an office uses: email, text messages, WhatsApp, Facebook,
// Instagram, a call, a system notice, and emails an automation prepared for review.
// A message in a sample workspace is `draft`, `demo` or `received`, never `sent`: nothing leaves the browser, and no
// record names a provider or an account, because none is connected. Every person and every word here is made up; the
// screens label incoming messages as sample records.
// What the sample shows on purpose: one conversation nobody has opened yet (Gabriela Montes), people waiting for an answer,
// a lead who wrote on WhatsApp and has not agreed to be written to there, a reminder that was not sent because the client
// never agreed to texts (Harold Whitcombe), and someone who is not on file at all.
import type { Lang, Message, MessageChannel, Ref } from '@/domain/types';
import { stamp, txFor } from './util';

type Extra = Partial<Pick<Message, 'subject' | 'by' | 'read' | 'seconds' | 'auto' | 'status' | 'clientId'>>;

export function messages(lang: Lang): { messages: Message[] } {
  const tx = txFor(lang);
  const client = (id: string): Ref => ({ type: 'client', id });
  const thread = (ref: Ref, channel: MessageChannel) => `${ref.type === 'client' ? 'c' : 'l'}:${ref.id}:${channel}`;
  /** Something the person sent us. Opened already unless `read: false`. */
  const inc = (id: string, at: string, channel: MessageChannel, ref: Ref, from: string, body: string, x: Extra = {}): Message => ({
    id, at, channel, to: '', from, subject: '', body, status: 'received', dir: 'in', read: true, ref, threadId: thread(ref, channel), ...(ref.type === 'client' ? { clientId: ref.id } : {}), ...x,
  });
  /** Something the office wrote: marked as sent in the sample (`demo`) unless it is still a draft. */
  const out = (id: string, at: string, channel: MessageChannel, ref: Ref, to: string, body: string, x: Extra = {}): Message => ({
    id, at, channel, to, subject: '', body, status: 'demo', ref, threadId: thread(ref, channel), ...(ref.type === 'client' ? { clientId: ref.id } : {}), ...x,
  });
  const gabriela = client('pc1'), harold = client('pc2'), priscila = client('pc3'), marcus = client('pc5'), teresa = client('pc6'), owen = client('pc7'), esteban = client('pc9'), grace = client('pc10');
  const yolanda: Ref = { type: 'lead', id: 'pl4' };
  const list: Message[] = [
    // WhatsApp with a client who agreed to it. The newest message has not been opened.
    inc('pm1', stamp(-3, 16, 10), 'whatsapp', gabriela, '609-555-0931', tx('Good afternoon. Are my copies ready? I can come by on Friday.', 'Buenas tardes. ¿Ya están listas mis copias? Puedo pasar el viernes.')),
    out('pm2', stamp(-3, 16, 40), 'whatsapp', gabriela, '609-555-0931', tx('Hello Gabriela. Yes, your copies are ready. We are open until 5.\nAna Lucía', 'Hola, Gabriela. Sí, sus copias ya están listas. Atendemos hasta las 5.\nAna Lucía'), { by: 'u3' }),
    inc('pm3', stamp(-1, 9, 5), 'whatsapp', gabriela, '609-555-0931', tx('Thank you. I also have the property tax bill, can I leave it with you then?', 'Gracias. También tengo el recibo del impuesto predial, ¿se lo puedo dejar ese día?')),
    inc('pm4', stamp(0, 8, 50), 'whatsapp', gabriela, '609-555-0931', tx('I am on my way, I should be there around 11:30.', 'Ya voy en camino, llego como a las 11:30.'), { read: false }),

    // email back and forth, then a call the phone system would report (here: a sample record)
    inc('pm5', stamp(-6, 10, 20), 'email', harold, 'harold@example.com', tx('Hello Daniel,\n\nI received the invoice for my return. Can I pay the rest by check when I come in?\n\nHarold', 'Hola, Daniel:\n\nRecibí la factura de mi declaración. ¿Puedo pagar el resto con cheque cuando vaya?\n\nHarold'),
      { subject: tx('Question about my balance', 'Pregunta sobre mi saldo') }),
    out('pm6', stamp(-6, 14, 2), 'email', harold, 'harold@example.com', tx('Hello Harold,\n\nYes, a check is fine. You can bring it to the office or mail it, whichever is easier for you.\n\nDaniel Okafor', 'Hola, Harold:\n\nSí, puede pagar con cheque. Tráigalo a la oficina o envíelo por correo, como le resulte más fácil.\n\nDaniel Okafor'),
      { subject: tx('Re: Question about my balance', 'Re: Pregunta sobre mi saldo'), by: 'u2' }),
    inc('pm7', stamp(-2, 11, 15), 'call', harold, '609-555-0932', tx('Asked to move the call about his balance to the afternoon. His daughter Joan will join.', 'Pidió pasar a la tarde la llamada sobre su saldo. Se va a unir su hija Joan.'), { seconds: 372 }),
    // a notice from the platform: the reminder was not sent, because nobody recorded that he agreed to texts
    inc('pm13', stamp(-1, 8, 0), 'system', harold, '', tx('A text reminder for the phone consultation was not sent: this client has not agreed to text messages.', 'No se envió el recordatorio por mensaje de texto de la consulta por teléfono: este cliente no ha aceptado recibir mensajes de texto.')),
    // prepared by the "work completed" rule, waiting for someone to read it and send it
    out('pm8', stamp(-1, 15, 30), 'email', { type: 'job', id: 'pe5' }, 'harold@example.com',
      tx('Hi Harold,\n\n"Individual tax return" is complete. Thank you for trusting us with it.\n\nYour final invoice is on its way with the remaining balance.', 'Hola, Harold:\n\n"Declaración de impuestos personal" quedó terminada. Gracias por confiarnos el trabajo.\n\nLe enviamos la factura final con el saldo pendiente.'),
      { subject: tx('Completed: Individual tax return', 'Terminado: Declaración de impuestos personal'), status: 'draft', auto: 'job-completed:pe5', clientId: 'pc2' }),

    // text messages with a client who agreed to them; she is waiting for an answer
    out('pm9', stamp(-7, 15, 0), 'text', priscila, '856-555-0933', tx('Hello Priscila. A reminder of your appointment tomorrow at 10:00 at the east office. Reply STOP to stop these messages.', 'Hola, Priscila. Le recordamos su cita de mañana a las 10:00 en la oficina este. Responda STOP para dejar de recibir estos mensajes.'), { by: 'u4' }),
    inc('pm10', stamp(-5, 10, 40), 'text', priscila, '856-555-0933', tx('Sorry I missed it, my shift changed. Can I come next week?', 'Perdón por no llegar, me cambiaron el turno. ¿Puedo ir la próxima semana?')),

    // a business client by email
    inc('pm11', stamp(-4, 9, 30), 'email', teresa, 'coastbakery@example.com', tx('Good morning,\n\nI approved the hours for this period. One new employee starts on Monday. What do you need from her?\n\nTeresa', 'Buenos días:\n\nYa aprobé las horas de este periodo. El lunes empieza una empleada nueva. ¿Qué necesitan de ella?\n\nTeresa'),
      { subject: tx('Hours for this pay period', 'Horas de este periodo de pago') }),
    out('pm12', stamp(-4, 11, 0), 'email', teresa, 'coastbakery@example.com', tx('Thank you, Teresa.\n\nFor the new employee, please send her completed hiring forms and a copy of her ID. I will add her before Friday.\n\nAna Lucía Paredes', 'Gracias, Teresa.\n\nPara la empleada nueva, por favor envíe sus formularios de ingreso llenos y una copia de su identificación. La agrego antes del viernes.\n\nAna Lucía Paredes'),
      { subject: tx('Re: Hours for this pay period', 'Re: Horas de este periodo de pago'), by: 'u3' }),

    // prepared by the "work started" and "won lead" rules
    out('pm14', stamp(-12, 9, 10), 'email', { type: 'job', id: 'pe3' }, 'driscollelectric@example.com',
      tx('Hi Owen,\n\nWork on "Business tax return" has started. We will keep you posted as it moves along.\n\nQuestions at any point, reply here or call us.', 'Hola, Owen:\n\nYa empezamos a trabajar en "Declaración de impuestos de negocio". Le iremos avisando conforme avance.\n\nSi tiene alguna duda, responda aquí o llámenos.'),
      { subject: tx('We have started: Business tax return', 'Ya empezamos: Declaración de impuestos de negocio'), status: 'draft', auto: 'job-started:pe3', clientId: owen.id }),
    out('pm15', stamp(-30, 13, 0), 'email', { type: 'job', id: 'pe6' }, 'marcus@example.com',
      tx('Hi Marcus,\n\nThank you for choosing us. We have opened your file for "Individual tax return" and will send the engagement letter for your signature next.\n\nIf anything changes on your side, reply to this email or call us.', 'Hola, Marcus:\n\nGracias por elegirnos. Ya abrimos su expediente para "Declaración de impuestos personal" y lo siguiente es enviarle la carta de encargo para su firma.\n\nSi algo cambia de su lado, responda a este correo o llámenos.'),
      { subject: tx('Welcome', 'Bienvenido'), status: 'draft', auto: 'lead-won:pe6', clientId: marcus.id }),

    // a client who wrote to the firm's Facebook Page, answered there
    inc('pm16', stamp(-9, 8, 45), 'facebook', esteban, 'Esteban Fuentes', tx('Good morning. Is the sales tax filing for this quarter already in? We want to plan the payment.', 'Buenos días. ¿Ya quedó presentada la declaración del impuesto sobre ventas de este trimestre? Queremos planear el pago.')),
    out('pm17', stamp(-9, 9, 20), 'facebook', esteban, 'Esteban Fuentes', tx('Good morning, Esteban. Yes, it is in. I will send you the confirmation by email today.\nWei', 'Buenos días, Esteban. Sí, ya quedó presentada. Hoy le envío la confirmación por correo.\nWei'), { by: 'u4' }),

    // a lead who wrote on WhatsApp. Nobody has recorded that she agreed to be written to there, so the answer waits.
    inc('pm18', stamp(-6, 18, 5), 'whatsapp', yolanda, '856-555-0954', tx('Hello, how much do you charge to file taxes? A friend gave me your number.', 'Hola, ¿cuánto cobran por hacer la declaración de impuestos? Una amiga me dio su número.')),

    // someone who is not on file: the conversation offers to create a lead
    { id: 'pm19', at: stamp(-2, 19, 20), channel: 'instagram', to: '', from: 'sample.shore.sweets', subject: '', status: 'received', dir: 'in', read: true, ref: { type: 'lead', id: '' }, threadId: 'a:sample.shore.sweets:instagram',
      body: tx('Hi! Do you help new businesses get registered? We are opening a bakery stand in the spring.', '¡Hola! ¿Ayudan a registrar negocios nuevos? Vamos a abrir un puesto de repostería en la primavera.') },

    // written by a person and saved for later
    out('pm20', stamp(-1, 16, 45), 'email', grace, 'shoreyoutharts@example.com', tx('Hello Grace,\n\nTo finish the annual report we still need the list of board members with their addresses. Could you send it this week?\n\nMarisol Vega', 'Hola, Grace:\n\nPara terminar el informe anual todavía necesitamos la lista de los miembros de la junta con sus direcciones. ¿Podría enviarla esta semana?\n\nMarisol Vega'),
      { subject: tx('Annual report: what we still need', 'Informe anual: lo que todavía necesitamos'), status: 'draft', by: 'u1' }),
  ];
  return { messages: list.sort((a, b) => b.at.localeCompare(a.at)) };
}
