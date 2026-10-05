// Engagements: a catalog service being done for a client for a period. In the data model an engagement is a job.
// Ids pe1 to pe9 are fixed because tasks, leads and documents point at them; the rest are the earlier periods of the
// repeating ones (each period is its own engagement and points back at the one before with `parentId`).
// Prices are the sample prices of the catalog tiers, per period.
import type { ISODate, Lang, Payment, Repeat } from '@/domain/types';
import { type Engagement, periodFor, shiftDate } from '@/domain/actions/jobs';
import { toISODate } from '@/lib/dates';
import { day, notes, txFor } from './util';

/** First day of the month (or quarter) n periods from the current one. */
function periodStart(repeat: Repeat, n: number): ISODate {
  const now = new Date(); const months = repeat === 'quarterly' ? 3 : 1;
  const first = repeat === 'quarterly' ? Math.floor(now.getMonth() / 3) * 3 : now.getMonth();
  return toISODate(new Date(now.getFullYear(), first + n * months, 1));
}
/** Last day of the period that starts on `start`. */
const periodEnd = (start: ISODate, repeat: Repeat): ISODate => { const next = shiftDate(start, repeat); const [y, m, d] = next.split('-').map(Number); return toISODate(new Date(y, m - 1, d - 1)); };
/** Never later than today: a payment cannot be dated in the future. */
const past = (date: ISODate): ISODate => (date > day(0) ? day(0) : date);

export function engagements(lang: Lang): { jobs: Engagement[] } {
  const tx = txFor(lang);
  let n = 1000;
  const job = (o: Pick<Engagement, 'id' | 'name' | 'clientId' | 'type' | 'status' | 'price' | 'managerId'> & Partial<Engagement>): Engagement =>
    ({ number: `VP-J-${++n}`, address: '', start: '', end: '', repeat: 'once', scope: '', payTerms: '', assign: [], expenses: [], received: [], log: [], notes: [], created: day(-20), officeId: 'o1', ...o });
  const pay = (id: string, date: ISODate, method: Payment['method'], amount: number, ref = ''): Payment => ({ id, date: past(date), method, ref, amount });
  const year = String(new Date().getFullYear() - 1);
  const month = (k: number) => periodStart('monthly', k); const quarter = (k: number) => periodStart('quarterly', k);
  const label = (repeat: Repeat, start: ISODate) => periodFor(repeat, start, lang);

  const books = { name: tx('Monthly bookkeeping', 'Contabilidad mensual'), type: 'bookkeeping', serviceId: 's-books', repeat: 'monthly' as Repeat, unit: 'month' as const,
    scope: tx('Record sales and expenses, reconcile the bank and card accounts, and send a monthly summary.', 'Registrar ventas y gastos, conciliar las cuentas de banco y tarjeta, y enviar un resumen mensual.') };
  const payroll = { name: tx('Payroll processing', 'Procesamiento de nómina'), type: 'payroll', serviceId: 's-payroll', tierId: 's-payroll-t1', repeat: 'monthly' as Repeat, unit: 'month' as const, price: 85,
    scope: tx('Run payroll every other Friday for the employees on the list and keep the payroll records.', 'Correr la nómina cada dos viernes para los empleados de la lista y llevar los registros de nómina.'),
    payTerms: tx('$85 per month, billed with the last payroll of the month.', '$85 al mes, se cobra con la última nómina del mes.') };
  const sales = { name: tx('Sales tax return', 'Declaración de impuesto sobre ventas'), type: 'tax', serviceId: 's-salestax', tierId: 's-salestax-t1', repeat: 'quarterly' as Repeat, unit: 'quarter' as const, price: 90, officeId: 'o2',
    scope: tx('Prepare and file the quarterly sales tax return from the sales records the client sends.', 'Preparar y presentar la declaración trimestral del impuesto sobre ventas con los registros que envíe el cliente.'),
    payTerms: tx('$90 per quarter, due when the return is filed.', '$90 por trimestre, se paga al presentar la declaración.') };
  const booksTerms = tx('$220 per month, billed on the first.', '$220 al mes, se cobra el día primero.');
  const personal = { name: tx('Individual tax return', 'Declaración de impuestos personal'), type: 'tax', serviceId: 's-1040', repeat: 'yearly' as Repeat, unit: 'flat' as const };

  return {
    jobs: [
      job({ ...books, id: 'pe1', clientId: 'pc6', status: 'progress', price: 220, tierId: 's-books-t1', managerId: 'u3', start: month(0), end: periodEnd(month(0), 'monthly'), created: month(0), period: label('monthly', month(0)), parentId: 'pe10', payTerms: booksTerms }),
      job({ ...payroll, id: 'pe2', clientId: 'pc6', status: 'progress', managerId: 'u3', start: month(0), end: periodEnd(month(0), 'monthly'), created: month(0), period: label('monthly', month(0)), parentId: 'pe12' }),
      job({ id: 'pe3', name: tx('Business tax return', 'Declaración de impuestos de negocio'), clientId: 'pc7', type: 'tax', status: 'progress', price: 650, managerId: 'u2', serviceId: 's-biztax', tierId: 's-biztax-t1', repeat: 'yearly', unit: 'flat', start: day(-12), end: day(18), created: day(-16), period: year,
        scope: tx('Prepare the business return for the year from the books and the documents the client provides.', 'Preparar la declaración del negocio del año con la contabilidad y los documentos que entregue el cliente.'),
        payTerms: tx('$650, half at the start and half before filing.', '$650, la mitad al inicio y la mitad antes de presentar.'),
        received: [pay('pe3-r1', day(-12), 'check', 325, '2041')],
        notes: notes('pe3', 'u2', [[-10, 'note', tx('Waiting on the December bank statement and the vehicle log.', 'Esperando el estado de cuenta de diciembre y la bitácora del vehículo.')]]) }),
      job({ ...personal, id: 'pe4', clientId: 'pc1', status: 'done', price: 180, managerId: 'u3', tierId: 's-1040-t1', start: day(-48), end: day(-36), created: day(-52), period: year,
        scope: tx('Prepare the personal return for the year.', 'Preparar la declaración personal del año.'), payTerms: tx('$180, due when the return is ready.', '$180, se paga cuando la declaración está lista.'),
        received: [pay('pe4-r1', day(-36), 'cash', 180)] }),
      job({ ...personal, id: 'pe5', clientId: 'pc2', status: 'done', price: 320, managerId: 'u2', tierId: 's-1040-t2', start: day(-40), end: day(-25), created: day(-44), period: year,
        scope: tx('Prepare the personal return for the year, including the rental schedule.', 'Preparar la declaración personal del año, con el anexo de la renta.'), payTerms: tx('$320, due when the return is ready.', '$320, se paga cuando la declaración está lista.'),
        received: [pay('pe5-r1', day(-25), 'check', 200, '1187')] }),
      job({ ...personal, id: 'pe6', clientId: 'pc5', status: 'contract', price: 180, managerId: 'u3', tierId: 's-1040-t1', created: day(-30), leadId: 'pl8', period: year,
        scope: tx('Prepare the personal return for the year.', 'Preparar la declaración personal del año.'), payTerms: tx('$180, due when the return is ready.', '$180, se paga cuando la declaración está lista.') }),
      job({ ...sales, id: 'pe7', clientId: 'pc9', status: 'progress', managerId: 'u4', start: quarter(0), end: periodEnd(quarter(0), 'quarterly'), created: quarter(0), period: label('quarterly', quarter(0)), parentId: 'pe14' }),
      job({ id: 'pe8', name: tx('Annual report filing', 'Presentación del informe anual'), clientId: 'pc10', type: 'licensing', status: 'hold', price: 110, managerId: 'u1', serviceId: 's-annual', tierId: 's-annual-t1', repeat: 'yearly', unit: 'year', start: day(-20), created: day(-58), leadId: 'pl9', officeId: undefined,
        period: String(new Date().getFullYear()),
        scope: tx('Prepare and file the annual report with the state.', 'Preparar y presentar el informe anual ante el estado.'), payTerms: tx('$110 per year.', '$110 al año.'),
        notes: notes('pe8', 'u1', [[-6, 'email', tx('On hold until the board confirms the new officers.', 'En pausa hasta que el consejo confirme a los nuevos directivos.')]]) }),
      job({ id: 'pe9', name: tx('Company formation', 'Constitución de empresa'), clientId: 'pc8', type: 'formation', status: 'estimate', price: 420, managerId: 'u2', serviceId: 's-formation', tierId: 's-formation-t1', unit: 'flat', created: day(-5),
        scope: tx('Form a second company for the new location and register it with the state.', 'Constituir una segunda empresa para la nueva sucursal y registrarla ante el estado.'), payTerms: tx('$420, due before filing. State fees are separate.', '$420, se paga antes de presentar. Las cuotas del estado van aparte.') }),

      // earlier periods of the repeating engagements above, completed and paid
      job({ ...books, id: 'pe10', clientId: 'pc6', status: 'done', price: 220, tierId: 's-books-t1', managerId: 'u3', start: month(-1), end: periodEnd(month(-1), 'monthly'), created: month(-1), period: label('monthly', month(-1)), parentId: 'pe11', payTerms: booksTerms,
        received: [pay('pe10-r1', month(-1), 'transfer', 220)] }),
      job({ ...books, id: 'pe11', clientId: 'pc6', status: 'done', price: 220, tierId: 's-books-t1', managerId: 'u3', start: month(-2), end: periodEnd(month(-2), 'monthly'), created: month(-2), period: label('monthly', month(-2)), payTerms: booksTerms,
        received: [pay('pe11-r1', month(-2), 'transfer', 220)] }),
      job({ ...payroll, id: 'pe12', clientId: 'pc6', status: 'done', managerId: 'u3', start: month(-1), end: periodEnd(month(-1), 'monthly'), created: month(-1), period: label('monthly', month(-1)),
        received: [pay('pe12-r1', periodEnd(month(-1), 'monthly'), 'card', 85)] }),
      job({ ...sales, id: 'pe14', clientId: 'pc9', status: 'done', managerId: 'u4', start: quarter(-1), end: periodEnd(quarter(-1), 'quarterly'), created: quarter(-1), period: label('quarterly', quarter(-1)),
        received: [pay('pe14-r1', periodEnd(quarter(-1), 'quarterly'), 'zelle', 90)] }),
      // a second bookkeeping client, on the larger tier, and a one-time advisory session that came from a suggestion
      job({ ...books, id: 'pe15', clientId: 'pc8', status: 'progress', price: 340, tierId: 's-books-t2', managerId: 'u2', start: month(0), end: periodEnd(month(0), 'monthly'), created: month(0), period: label('monthly', month(0)),
        payTerms: tx('$340 per month, billed on the first.', '$340 al mes, se cobra el día primero.'), received: [pay('pe15-r1', month(0), 'card', 340)] }),
      job({ id: 'pe16', name: tx('Advisory session', 'Sesión de asesoría'), clientId: 'pc1', type: 'advisory', status: 'done', price: 120, managerId: 'u2', serviceId: 's-advisory', tierId: 's-advisory-t1', unit: 'hour', start: day(-8), end: day(-8), created: day(-10),
        scope: tx('One hour to go over withholding and what to set aside for next year.', 'Una hora para revisar las retenciones y cuánto apartar para el próximo año.'), payTerms: tx('$120, one hour.', '$120, una hora.'),
        received: [pay('pe16-r1', day(-8), 'card', 120)] }),
    ],
  };
}
