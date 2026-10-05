// Sample records of the office modules: petty cash and deadlines.
// Petty cash: two drawers (one per office) over the last two working weeks, with one day counted and closed, so the
// ledger, the lock and the history of closes all have something to show. Amounts are made up.
// Deadlines: fictional items with neutral titles, each marked "(sample)". None of them is a real filing date, agency
// rule or rate: the product ships no calendar of its own, the business enters its own or imports a file.
// Reviews, opportunities, social posts and security records each have their own file next to this one.
import type { CashClose, CashEntry, ComplianceItem, Lang } from '@/domain/types';
import { day, stamp, txFor } from './util';

/** Day offsets of the last `n` working days (Monday to Friday), most recent first. Today counts when it is one. */
function workdays(n: number): number[] {
  const out: number[] = [];
  for (let off = 0; out.length < n; off--) { const d = new Date(); d.setDate(d.getDate() + off); if (d.getDay() !== 0 && d.getDay() !== 6) out.push(off); }
  return out;
}

export function ops(lang: Lang): { cash: CashEntry[]; cashCloses: CashClose[]; complianceItems: ComplianceItem[] } {
  const tx = txFor(lang);
  const w = workdays(10);
  let n = 0;
  const entry = (back: number, officeId: string, dir: 'in' | 'out', amount: number, category: string, memo: string, by: string): CashEntry =>
    ({ id: `pk${++n}`, date: day(w[back]), officeId, dir, amount, category, memo, by });
  const cash: CashEntry[] = [
    // main office drawer
    entry(9, 'o1', 'in', 200, 'change_fund', tx('Starting float for the drawer (sample)', 'Fondo inicial de la caja (muestra)'), 'u1'),
    entry(9, 'o1', 'out', 18.45, 'supplies', tx('Printer paper', 'Papel para la impresora'), 'u3'),
    entry(8, 'o1', 'in', 180, 'client_payment', tx('Cash payment for a personal return', 'Pago en efectivo de una declaración personal'), 'u3'),
    entry(8, 'o1', 'out', 9.9, 'postage', tx('Certified mail', 'Correo certificado'), 'u3'),
    entry(7, 'o1', 'out', 24.3, 'meals', tx('Lunch for the team on a late day', 'Comida del equipo en un día largo'), 'u2'),
    entry(7, 'o1', 'out', 150, 'bank_deposit', tx('Taken to the bank', 'Llevado al banco'), 'u1'),
    entry(6, 'o1', 'in', 75, 'client_payment', tx('Cash payment for a consultation', 'Pago en efectivo de una consulta'), 'u3'),
    entry(6, 'o1', 'out', 25, 'filing_fees', tx('Fee paid at the counter for a client', 'Cuota pagada en ventanilla por un cliente'), 'u2'),
    entry(5, 'o1', 'out', 12, 'transport', tx('Parking at the bank', 'Estacionamiento en el banco'), 'u2'),
    entry(4, 'o1', 'out', 32.1, 'supplies', tx('Folders and labels', 'Carpetas y etiquetas'), 'u3'),
    entry(3, 'o1', 'in', 120, 'client_payment', tx('Cash payment on an open balance', 'Pago en efectivo a un saldo pendiente'), 'u3'),
    entry(2, 'o1', 'out', 14.75, 'postage', tx('Stamps', 'Estampillas'), 'u3'),
    entry(1, 'o1', 'in', 100, 'bank_withdrawal', tx('Small bills for change', 'Billetes chicos para cambio'), 'u1'),
    entry(0, 'o1', 'out', 7.25, 'supplies', tx('Coffee for the waiting room', 'Café para la sala de espera'), 'u3'),
    // east office drawer
    entry(6, 'o2', 'in', 150, 'change_fund', tx('Starting float for the drawer (sample)', 'Fondo inicial de la caja (muestra)'), 'u1'),
    entry(4, 'o2', 'out', 8.2, 'postage', tx('Certified mail', 'Correo certificado'), 'u4'),
    entry(2, 'o2', 'in', 95, 'client_payment', tx('Cash payment for a consultation', 'Pago en efectivo de una consulta'), 'u4'),
    entry(1, 'o2', 'out', 21.6, 'supplies', tx('Toner', 'Tóner'), 'u6'),
  ];
  // the main office drawer was counted five working days ago: $1.50 short, noted, and approved by the owner
  const closedOn = day(w[5]);
  const counted = cash.filter((e) => e.officeId === 'o1' && e.date <= closedOn);
  const expectedCents = counted.reduce((a, e) => a + Math.round(e.amount * 100) * (e.dir === 'in' ? 1 : -1), 0);
  const close: CashClose = {
    id: 'pkc1', date: closedOn, officeId: 'o1', expected: expectedCents / 100, counted: (expectedCents - 150) / 100, diff: -1.5, by: 'u3', at: stamp(w[5], 17, 20),
    note: tx('A roll of coins was one short. Checked twice.', 'A un rollo de monedas le faltaba una. Se contó dos veces.'), approvedBy: 'u1',
  };
  for (const e of counted) e.closeId = close.id;

  let k = 0;
  const sample = tx('Sample item. The date is made up for this preview.', 'Registro de muestra. La fecha es inventada para esta vista previa.');
  const item = (o: Pick<ComplianceItem, 'title' | 'kind' | 'due'> & Partial<ComplianceItem>): ComplianceItem => ({ id: `pd${++k}`, status: 'open', note: sample, ...o });
  const complianceItems: ComplianceItem[] = [
    item({ title: tx('Annual report (sample)', 'Informe anual (muestra)'), kind: 'filing', clientId: 'pc10', jobId: 'pe8', due: day(-3), repeat: 'yearly', assignee: 'u1', authority: tx('State agency (sample)', 'Agencia estatal (muestra)'), remind: [30, 7] }),
    item({ title: tx('Monthly reminder (sample)', 'Recordatorio mensual (muestra)'), kind: 'deadline', clientId: 'pc6', jobId: 'pe2', due: day(2), repeat: 'monthly', assignee: 'u3', remind: [3] }),
    item({ title: tx('Insurance certificate renewal (sample)', 'Renovación del certificado de seguro (muestra)'), kind: 'insurance', due: day(5), repeat: 'yearly', assignee: 'u1', authority: tx('Insurance carrier (sample)', 'Aseguradora (muestra)'), remind: [30, 7] }),
    item({ title: tx('Quarterly filing (sample)', 'Declaración trimestral (muestra)'), kind: 'filing', clientId: 'pc9', jobId: 'pe7', due: day(12), repeat: 'quarterly', assignee: 'u4', authority: tx('State agency (sample)', 'Agencia estatal (muestra)'), remind: [14, 3] }),
    item({ title: tx('Business license renewal (sample)', 'Renovación de la licencia de negocio (muestra)'), kind: 'license', clientId: 'pc6', due: day(25), repeat: 'yearly', assignee: 'u3', authority: tx('City clerk (sample)', 'Secretaría municipal (muestra)'), remind: [30, 7] }),
    item({ title: tx('Registration renewal (sample)', 'Renovación del registro (muestra)'), kind: 'renewal', clientId: 'pc8', due: day(48), repeat: 'yearly', assignee: 'u2', authority: tx('State agency (sample)', 'Agencia estatal (muestra)'), remind: [30] }),
    item({ title: tx('Professional license renewal (sample)', 'Renovación de la licencia profesional (muestra)'), kind: 'license', due: day(75), repeat: 'yearly', assignee: 'u1', authority: tx('Licensing board (sample)', 'Junta de licencias (muestra)'), remind: [60, 14] }),
    item({ title: tx('Trade license (sample)', 'Licencia del oficio (muestra)'), kind: 'license', clientId: 'pc7', due: day(130), repeat: 'yearly', assignee: 'u2', authority: tx('Licensing board (sample)', 'Junta de licencias (muestra)'), remind: [30] }),
    // history: one that was met and one that did not apply
    item({ title: tx('Quarterly filing (sample)', 'Declaración trimestral (muestra)'), kind: 'filing', clientId: 'pc9', jobId: 'pe7', due: day(-79), repeat: 'quarterly', assignee: 'u4', authority: tx('State agency (sample)', 'Agencia estatal (muestra)'), status: 'done', doneAt: day(-82) }),
    item({ title: tx('Permit renewal (sample)', 'Renovación del permiso (muestra)'), kind: 'renewal', clientId: 'pc4', due: day(-10), assignee: 'u4', status: 'waived', note: tx('Sample item. Set aside: it did not apply this year.', 'Registro de muestra. Se apartó: este año no aplicaba.') }),
  ];
  return { cash, cashCloses: [close], complianceItems };
}
