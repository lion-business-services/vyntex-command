// Tasks of the sample firm: ordinary to-dos, client requests, calls, documents and reviews, in every status.
// The client requests show who asked and how the request arrived; a few tasks carry comments, and some comments mention
// a colleague by name, which is what puts a notification in that person's list. Everyone here is fictional.
import type { Lang, Task, TaskComment } from '@/domain/types';
import { day, stamp, txFor } from './util';

export function tasks(lang: Lang): { tasks: Task[] } {
  const tx = txFor(lang);
  let n = 0;
  const task = (o: Pick<Task, 'title' | 'assignee'> & Partial<Task>): Task => ({ id: `pt${++n}`, status: 'todo', pri: 'medium', type: 'todo', created: day(-6), ...o });
  /** Comments, oldest first: [days from today, hour, author, text, people mentioned]. */
  const talk = (owner: string, list: [number, number, string, string, string[]?][]): TaskComment[] =>
    list.map(([d, hour, by, text, mentions], i) => ({ id: `${owner}-c${i + 1}`, at: stamp(d, hour, 10 + i * 7), by, text, ...(mentions?.length ? { mentions } : {}) }));
  return {
    tasks: [
      task({ title: tx('Ask for the December bank statement', 'Pedir el estado de cuenta de diciembre'), assignee: 'u:u2', jobId: 'pe3', clientId: 'pc7', type: 'document', due: day(-2), pri: 'high', status: 'waiting',
        comments: talk('pt1', [
          [-4, 10, 'u2', tx('Asked Nadia by email. She says the bank is slow with paper statements.', 'Se lo pedí a Nadia por correo. Dice que el banco tarda con los estados en papel.')],
          [-1, 15, 'u2', tx('@Marisol Vega still no statement. Can we start the review with what we have?', '@Marisol Vega todavía no llega el estado de cuenta. ¿Podemos empezar la revisión con lo que tenemos?'), ['u1']],
        ]) }),
      task({ title: tx('Review the draft return before it goes to the client', 'Revisar el borrador de la declaración antes de enviarlo al cliente'), assignee: 'u:u1', jobId: 'pe3', clientId: 'pc7', type: 'review', due: day(6), status: 'todo' }),
      task({ title: tx('Reconcile the bank account for last month', 'Conciliar la cuenta de banco del mes pasado'), assignee: 'u:u3', jobId: 'pe1', clientId: 'pc6', due: day(1), status: 'doing',
        comments: talk('pt3', [
          [-1, 11, 'u3', tx('Two deposits do not match the sales report. @Daniel Okafor have you seen this with a card processor before?', 'Dos depósitos no coinciden con el reporte de ventas. @Daniel Okafor ¿ya te había pasado con un procesador de tarjetas?'), ['u2']],
          [-1, 14, 'u2', tx('Yes: the processor holds back its fee. Compare against the net amount.', 'Sí: el procesador descuenta su comisión. Compáralo contra el monto neto.')],
        ]) }),
      task({ title: tx('Run payroll for this Friday', 'Correr la nómina de este viernes'), assignee: 'u:u3', jobId: 'pe2', clientId: 'pc6', due: day(0), pri: 'high', status: 'todo' }),
      task({ title: tx('Copy of last year\'s return', 'Copia de la declaración del año pasado'), assignee: 'u:u3', clientId: 'pc1', type: 'client_request', requestedBy: 'Gabriela Montes', channel: 'whatsapp', created: day(-1), due: day(0), status: 'todo',
        description: tx('She needs it for a loan application and asked for a PDF.', 'La necesita para una solicitud de préstamo y la pidió en PDF.') }),
      task({ title: tx('Call about the balance on the tax return', 'Llamar por el saldo de la declaración'), assignee: 'u:u2', jobId: 'pe5', clientId: 'pc2', type: 'call', due: day(-4), status: 'todo' }),
      task({ title: tx('Send the engagement letter for signature', 'Enviar la carta de encargo para firma'), assignee: 'u:u3', jobId: 'pe6', clientId: 'pc5', type: 'document', due: day(1), pri: 'high', status: 'todo' }),
      task({ title: tx('Prepare the quarterly sales figures for the client', 'Preparar las cifras de ventas del trimestre para el cliente'), assignee: 'u:u4', jobId: 'pe7', clientId: 'pc9', due: day(9), status: 'todo' }),
      task({ title: tx('Send the proposal for the second company', 'Enviar la propuesta para la segunda empresa'), assignee: 'u:u2', jobId: 'pe9', clientId: 'pc8', type: 'document', due: day(2), status: 'review' }),
      task({ title: tx('Call back the website lead', 'Devolver la llamada al prospecto del sitio web'), assignee: 'u:u3', leadId: 'pl1', type: 'call', due: day(0), pri: 'high', status: 'todo' }),
      task({ title: tx('Deliver the signed return and the copies', 'Entregar la declaración firmada y las copias'), assignee: 'u:u3', jobId: 'pe4', clientId: 'pc1', created: day(-40), due: day(-36), status: 'done', doneAt: day(-36) }),
      task({ title: tx('Order more client folders for the front desk', 'Pedir más carpetas de clientes para recepción'), assignee: 'u:u1', due: day(4), pri: 'low', status: 'todo' }),

      // more client requests, at different ages and in different hands
      task({ title: tx('Letter confirming the business is in good standing', 'Carta que confirme que el negocio está al corriente'), assignee: 'u:u2', clientId: 'pc7', jobId: 'pe3', type: 'client_request', requestedBy: 'Nadia Farouk', channel: 'email', created: day(-5), due: day(-1), pri: 'high', status: 'doing',
        description: tx('Their bank asked for it. Nadia is the office manager and may receive it.', 'Se la pidió su banco. Nadia es la gerente de oficina y puede recibirla.'),
        comments: talk('pt13', [[-2, 9, 'u2', tx('Draft is ready. @Marisol Vega it needs your signature before it goes out.', 'El borrador está listo. @Marisol Vega necesita su firma antes de enviarse.'), ['u1']]]) }),
      task({ title: tx('Change the payroll bank account for one employee', 'Cambiar la cuenta de banco de nómina de una empleada'), assignee: 'u:u3', clientId: 'pc6', jobId: 'pe2', type: 'client_request', requestedBy: 'Teresa Maldonado', channel: 'call', created: day(-3), due: day(2), status: 'waiting',
        description: tx('Waiting for the signed form from the employee.', 'En espera del formulario firmado por la empleada.') }),
      task({ title: tx('Explain a notice received in the mail', 'Explicar un aviso que llegó por correo'), assignee: 'u:u4', clientId: 'pc3', type: 'client_request', requestedBy: 'Priscila Andrade', channel: 'text', created: day(-8), due: day(-3), status: 'todo' }),
      task({ title: tx('Copies of two years of returns for a new landlord', 'Copias de dos años de declaraciones para un nuevo arrendador'), assignee: 'u:u2', clientId: 'pc2', type: 'client_request', requestedBy: 'Joan Whitcombe', channel: 'call', created: day(-12), due: day(-9), status: 'done', doneAt: day(-10) }),
      task({ title: tx('Add the new partner to the records', 'Agregar a la nueva socia a los registros'), assignee: 'u:u4', clientId: 'pc9', type: 'client_request', requestedBy: 'Esteban Fuentes', channel: 'whatsapp', created: day(-20), due: day(-15), status: 'done', doneAt: day(-14) }),
      task({ title: tx('Check the reminder list for next month', 'Revisar la lista de recordatorios del próximo mes'), assignee: 'u:u6', type: 'review', due: day(5), status: 'todo' }),
    ],
  };
}
