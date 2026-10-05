// How the lines of the pricing file read on screen, in English and Spanish, with industry wording.
// The pricing file stays the source of truth for WHAT is sold and for every number. This file only words it:
// each entry quotes the exact line of the pricing file (`source`) and scripts/check-pricing.mjs fails when a line
// of the pricing file has no wording here or the wording here points at a line that no longer exists.
// Numbers are never typed here: {tokens} are filled from the pricing file by lib/pricing.ts callers.
import type { Dict } from '@/i18n';

// The wording of the plans belongs to the deployment that sells plans. Each list reads the build constant itself, so the
// bundler leaves the wording out of a deployment without plans (LBS Command).
declare const __VX_DEPLOY__: string | undefined;

export interface PricingCopy { /** Exact text in config/vyntex-build-pricing.json. */ source: string; key: string; en: string; es: string; /** Internal instruction, never shown to customers. */ internal?: boolean }

export const FEATURE_COPY: PricingCopy[] = (typeof __VX_DEPLOY__ !== 'undefined' && __VX_DEPLOY__ === 'lbs') ? [] : [
  { source: 'Every core feature: leads, jobs, subs, payments, tasks, calendar', key: 'price.f.core', en: 'Every core feature: leads, {jobs}, {workers}, payments, tasks and calendar', es: 'Todas las funciones principales: prospectos, {jobs}, {workers}, pagos, tareas y calendario' },
  { source: 'Contracts, invoices and 1099 report', key: 'price.f.docs', en: 'Agreements, invoices and the 1099 report', es: 'Acuerdos, facturas y el reporte 1099' },
  { source: 'Google Calendar: send items (Add to Google)', key: 'price.f.calSend', en: 'Google Calendar: send any item with "Add to Google"', es: 'Google Calendar: envíe cualquier cita con "Agregar a Google"' },
  { source: 'Everything in Foundation', key: 'price.f.allBelow1', en: 'Everything in {below}', es: 'Todo lo de {below}' },
  { source: 'Subcontractor portal', key: 'price.f.portal', en: '{Worker} portal', es: 'Portal de {workers}' },
  { source: 'W-9 and insurance uploads with alerts', key: 'price.f.compliance', en: 'W-9 and insurance uploads with alerts', es: 'Carga de W-9 y seguros, con alertas' },
  { source: 'Google Calendar: automatic two-way sync', key: 'price.f.calSync', en: 'Google Calendar: automatic two-way sync', es: 'Google Calendar: sincronización automática en ambos sentidos' },
  { source: 'Email contracts and invoices', key: 'price.f.emailDocs', en: 'Email agreements and invoices', es: 'Envío de acuerdos y facturas por correo' },
  { source: 'Daily morning reminder email', key: 'price.f.daily', en: 'Daily morning reminder email', es: 'Correo de recordatorio cada mañana' },
  { source: 'Automatic client emails at every stage (each email on/off, plus per-client opt-out)', key: 'price.f.clientEmails', en: 'Automatic {client} emails at every stage (turn each email on or off, and let any {client} opt out)', es: 'Correos automáticos al {client} en cada etapa (active o apague cada correo, y cualquier {client} puede darse de baja)' },
  { source: 'Everything in Builder', key: 'price.f.allBelow2', en: 'Everything in {below}', es: 'Todo lo de {below}' },
  { source: 'Profit reports by job, type of work and month', key: 'price.f.profit', en: 'Profit reports by {job}, type of work and month', es: 'Reportes de ganancia por {job}, tipo de trabajo y mes' },
  { source: 'Website estimate form feeds Leads', key: 'price.f.webLeads', en: 'Your website request form feeds Leads', es: 'El formulario de su sitio web alimenta Prospectos' },
  { source: 'W-9 collection done for them (up to 25 subs per year)', key: 'price.f.w9', en: 'W-9 collection done for you (up to 25 {workers} per year)', es: 'Nosotros recolectamos los W-9 por usted (hasta 25 {workers} al año)' },
  { source: '1099 preparation: first 10 forms per year free, then $15 each', key: 'price.f.prep1099', en: '1099 preparation: first 10 forms per year free, then {prep} each', es: 'Preparación de 1099: las primeras 10 formas del año sin costo, después {prep} cada una' },
  { source: '1099 e-file and mail: $10 per form', key: 'price.f.efile', en: '1099 e-file and mail: {efile} per form', es: 'Presentación electrónica y envío por correo del 1099: {efile} por forma' },
  { source: '2 business review calls per year', key: 'price.f.reviews', en: '2 business review calls per year', es: '2 llamadas de revisión del negocio al año' },
  { source: 'Automatic client emails, with templates set up during setup', key: 'price.f.templates', en: 'Automatic {client} emails, with your templates set up during setup', es: 'Correos automáticos al {client}, con sus plantillas listas desde la instalación' },
];

export const SUPPORT_COPY: PricingCopy[] = (typeof __VX_DEPLOY__ !== 'undefined' && __VX_DEPLOY__ === 'lbs') ? [] : [
  { source: 'Email or WhatsApp, 1 business day', key: 'price.s.entry', en: 'Support by email or WhatsApp, reply within 1 business day', es: 'Soporte por correo o WhatsApp, respuesta en 1 día hábil' },
  { source: 'Same business day', key: 'price.s.mid', en: 'Support reply the same business day', es: 'Respuesta de soporte el mismo día hábil' },
  { source: 'Priority phone', key: 'price.s.top', en: 'Priority phone support', es: 'Soporte prioritario por teléfono' },
];

/** Add-ons, keyed by their id in the pricing file. `source` is the add-on name there. */
export const ADDON_COPY: (PricingCopy & { id: string; /** Wording of the billing line, when the pricing file has one. */ billing?: { en: string; es: string }; note?: { en: string; es: string } })[] = (typeof __VX_DEPLOY__ !== 'undefined' && __VX_DEPLOY__ === 'lbs') ? [] : [
  { id: 'client_portal', source: 'VYNTEX Client Portal', key: 'price.a.client_portal', en: 'VYNTEX {Client} Portal', es: 'Portal de {clients} VYNTEX',
    billing: { en: 'Setup plus a monthly fee, on its own invoice line, 12-month term', es: 'Instalación más una mensualidad, en su propia línea de factura, plazo de 12 meses' },
    note: { en: 'Not built yet. Quoted in a consultation. Available with {mid}, {top} and any VYNTEX service.', es: 'Aún no está construido. Se cotiza en una consulta. Disponible con {mid}, {top} y cualquier servicio de VYNTEX.' } },
  { id: 'extra_user_foundation', source: 'Extra user (Foundation)', key: 'price.a.extra_user_foundation', en: 'Extra user on the {entry} plan', es: 'Usuario adicional en el plan {entry}', billing: { en: 'per user, per month', es: 'por usuario, al mes' } },
  { id: '1099_prep', source: '1099 organization and preparation (Foundation or Builder)', key: 'price.a.1099_prep', en: '1099 organization and preparation ({entry} or {mid})', es: 'Organización y preparación de 1099 ({entry} o {mid})', billing: { en: 'per form, invoiced at year end', es: 'por forma, se factura al cierre del año' } },
  { id: '1099_efile_mail', source: '1099 e-file and mail to subcontractor', key: 'price.a.1099_efile_mail', en: '1099 e-file and mail to the {worker}', es: 'Presentación electrónica del 1099 y envío por correo al {worker}', billing: { en: 'per form, invoiced at year end', es: 'por forma, se factura al cierre del año' } },
  { id: 'training', source: 'Extra training session', key: 'price.a.training', en: 'Extra training session', es: 'Sesión de capacitación adicional', billing: { en: 'one time', es: 'pago único' } },
  { id: 'data_entry', source: 'Data entry', key: 'price.a.data_entry', en: 'Data entry', es: 'Captura de datos', billing: { en: 'per hour', es: 'por hora' } },
  { id: 'custom', source: 'Custom report or feature', key: 'price.a.custom', en: 'Custom report or feature', es: 'Reporte o función a la medida', note: { en: 'Quoted per request.', es: 'Se cotiza por solicitud.' } },
  { id: 'sms', source: 'Text-message reminders', key: 'price.a.sms', en: 'Text-message reminders', es: 'Recordatorios por mensaje de texto', note: { en: 'Through VYNTEX CRM. Usage is billed at cost and is never included in a plan.', es: 'A través de VYNTEX CRM. El uso se cobra al costo y nunca está incluido en un plan.' } },
];

/** The rules of the pricing file, in the order they appear there. Internal ones are instructions for the team, not for customers. */
export const RULE_COPY: PricingCopy[] = (typeof __VX_DEPLOY__ !== 'undefined' && __VX_DEPLOY__ === 'lbs') ? [] : [
  { source: 'Welcome credits are one-time, not cash, apply only to the setup fee of ANOTHER VYNTEX service (website, branding, social media, etc.), expire in 90 days, require an active paid subscription, and cannot be combined. They can never be used on VYNTEX BUILD / VYNTEX CLEAN (setup, monthly fees or add-ons).', key: 'price.r.credit',
    en: 'Welcome credits are one time and are not cash. They apply only to the setup fee of another VYNTEX service (website, branding, social media and similar), expire in 90 days, need an active paid subscription and cannot be combined. They cannot be used on {product} itself: not on setup, monthly fees or add-ons.',
    es: 'Los créditos de bienvenida son por única vez y no son dinero en efectivo. Solo aplican a la instalación de otro servicio de VYNTEX (sitio web, marca, redes sociales y similares), vencen a los 90 días, requieren una suscripción activa y pagada, y no se pueden combinar. No se pueden usar en {product}: ni en la instalación, ni en las mensualidades, ni en los complementos.' },
  { source: 'All usage (texts, calls, extra storage) is pass-through, never included.', key: 'price.r.usage', en: 'Usage (texts, calls, extra storage) is billed at cost and is never included in a plan.', es: 'El uso (mensajes de texto, llamadas, almacenamiento adicional) se cobra al costo y nunca está incluido en un plan.' },
  { source: 'Every item is a separate invoice line: subscription, setup, add-ons, usage.', key: 'price.r.lines', en: 'Every item is its own invoice line: subscription, setup, add-ons and usage.', es: 'Cada concepto va en su propia línea de factura: suscripción, instalación, complementos y uso.' },
  { source: "1099 work is performed by Lion Business Services and requires the customer's written consent to share subcontractor payment data.", key: 'price.r.1099', en: '1099 work is performed by Lion Business Services and needs your written consent to share {worker} payment data.', es: 'El trabajo de 1099 lo realiza Lion Business Services y requiere su consentimiento por escrito para compartir los datos de pagos a {workers}.' },
  { source: 'Do not turn on Stripe Tax until Daysi confirms the tax setup.', key: 'price.r.tax', en: '', es: '', internal: true },
  { source: 'Automatic client emails are service emails only (no marketing). Fair use: up to 2,000 emails per company per month. Each company verifies its own sending domain (SPF/DKIM); until then, send from a VYNTEX address with the company name and reply-to set to the company email.', key: 'price.r.emails',
    en: 'Automatic {client} emails are service emails only, never marketing. Fair use is up to 2,000 emails per company per month. Each company verifies its own sending domain; until then, emails go out from a VYNTEX address showing your company name, and replies come to your company email.',
    es: 'Los correos automáticos al {client} son solo de servicio, nunca de publicidad. El uso razonable es de hasta 2,000 correos por empresa al mes. Cada empresa verifica su propio dominio de envío; mientras tanto, los correos salen de una dirección de VYNTEX con el nombre de su empresa y las respuestas llegan al correo de su empresa.' },
  { source: 'No 2.9% service fee line on VYNTEX BUILD or any industry edition: VYNTEX absorbs processing fees.', key: 'price.r.fee', en: 'No service fee line on {product}: VYNTEX absorbs the payment processing fees.', es: 'Sin línea de cargo por servicio en {product}: VYNTEX absorbe las comisiones de procesamiento de pagos.' },
  { source: 'Payment methods: cards, Apple Pay/Google Pay and ACH bank debit (recommended for subscriptions). Klarna, Afterpay and Affirm stay turned off.', key: 'price.r.methods', en: 'Pay by card, Apple Pay, Google Pay or ACH bank debit (recommended for subscriptions).', es: 'Pague con tarjeta, Apple Pay, Google Pay o débito bancario ACH (recomendado para suscripciones).' },
  { source: 'Plan names: VYNTEX BUILD = Foundation / Builder / Master Builder. Every other industry = Essential / Pro / Elite (Esencial / Pro / Élite).', key: 'price.r.names', en: '', es: '', internal: true },
];

const all = [...FEATURE_COPY, ...SUPPORT_COPY, ...ADDON_COPY, ...RULE_COPY];
const bySource = new Map(all.map((c) => [c.source, c.key]));
/** Dictionary key for a line of the pricing file, or undefined when the line has no wording yet (show the raw line then). */
export const pricingKey = (source: string): string | undefined => bySource.get(source);
export const addOnCopy = (id: string) => ADDON_COPY.find((a) => a.id === id);

export const dict: Dict = { en: {}, es: {} };
for (const c of all) { if (c.internal) continue; dict.en[c.key] = c.en; dict.es[c.key] = c.es; }
for (const a of ADDON_COPY) {
  if (a.billing) { dict.en[a.key + '.billing'] = a.billing.en; dict.es[a.key + '.billing'] = a.billing.es; }
  if (a.note) { dict.en[a.key + '.note'] = a.note.en; dict.es[a.key + '.note'] = a.note.es; }
}
