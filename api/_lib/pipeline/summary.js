// The daily summary for a company's owners: a few counts taken from its records. It names no client, no lead and no
// amount: an inbox is not the place for those, and the subject line least of all. English and Spanish in one email,
// because the job that sends it does not know which language each owner reads.
import { productName } from '../mail.js';

const LINES = [
  ['newLeads', 'new leads since yesterday', 'prospectos nuevos desde ayer'],
  ['tasksDue', 'tasks due today or overdue', 'tareas para hoy o atrasadas'],
  ['appointmentsToday', 'appointments today', 'citas hoy'],
  ['signaturesWaiting', 'signature requests waiting for a signer', 'solicitudes de firma en espera'],
  ['reviewsAnswered', 'review requests answered since yesterday', 'solicitudes de opinión respondidas desde ayer'],
  ['messagesFailed', 'messages that could not be delivered since yesterday', 'mensajes que no se pudieron entregar desde ayer'],
];

/** { subject, text }, or null when every count is zero. */
export function summaryEmail(counts) {
  const rows = LINES.map(([k, en, es]) => ({ n: Math.max(0, Math.floor(Number(counts[k]) || 0)), en, es })).filter((r) => r.n > 0);
  if (!rows.length) return null;
  const product = productName();
  return {
    subject: `Your daily summary from ${product}`,
    text: [
      `Today in ${product}:`, ...rows.map((r) => `  ${r.n} ${r.en}`), 'Open your workspace for the details.', '',
      `Hoy en ${product}:`, ...rows.map((r) => `  ${r.n} ${r.es}`), 'Abra su espacio de trabajo para ver los detalles.', '',
    ].join('\n'),
  };
}
