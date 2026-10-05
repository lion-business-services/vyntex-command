// The emails a signer receives: the request to sign and the reminder. Plain text, English or Spanish by the language
// of the request. The only address in them is the signer's own signing page on this site.
import { sendSystemEmail, productName } from '../mail.js';
import { sealToken, openToken, sha256Hex } from '../crypto.js';
import { enqueue } from '../jobs.js';
import { env } from '../env.js';

const AAD = 'esign-notify';
const clean = (s, n) => String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, n);

export function signerEmail({ kind, lang, company, title, name, link, message, expiresAt }) {
  const es = lang === 'es';
  const until = expiresAt ? new Date(expiresAt).toLocaleDateString(es ? 'es-US' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '';
  const product = productName();
  if (es) {
    return {
      subject: kind === 'reminder' ? `Recordatorio: ${clean(company, 120)} espera su firma` : `${clean(company, 120)} le solicita su firma`,
      text: [
        `Hola ${clean(name, 120)}:`, '',
        kind === 'reminder' ? `Le recordamos que ${clean(company, 200)} espera su firma en el documento "${clean(title, 200)}".` : `${clean(company, 200)} le envió el documento "${clean(title, 200)}" para su firma.`,
        ...(message && kind !== 'reminder' ? ['', clean(message, 1000)] : []), '',
        'Abra este enlace para leerlo y firmarlo:', link, '',
        'El enlace es personal: no lo reenvíe.', ...(until ? [`Funciona hasta el ${until}.`] : []),
        'Si no esperaba este mensaje, puede ignorarlo.', '', `Enviado con ${product}.`, '',
      ].join('\n'),
    };
  }
  return {
    subject: kind === 'reminder' ? `Reminder: ${clean(company, 120)} is waiting for your signature` : `${clean(company, 120)} asks for your signature`,
    text: [
      `Hello ${clean(name, 120)},`, '',
      kind === 'reminder' ? `This is a reminder that ${clean(company, 200)} is waiting for your signature on "${clean(title, 200)}".` : `${clean(company, 200)} sent you "${clean(title, 200)}" to sign.`,
      ...(message && kind !== 'reminder' ? ['', clean(message, 1000)] : []), '',
      'Open this link to read and sign it:', link, '',
      'The link is personal: please do not forward it.', ...(until ? [`It works until ${until}.`] : []),
      'If you did not expect this message, you can ignore it.', '', `Sent with ${product}.`, '',
    ].join('\n'),
  };
}

/** What one email needs. `token` is the signer's link token: it exists here, in the email, and nowhere else. */
export const notice = (ctx, signer, token, kind) => ({
  kind, to: signer.email, name: signer.name, token, tenant: ctx.tenantId, lang: ctx.envelope.lang === 'es' ? 'es' : 'en',
  company: ctx.company, title: ctx.envelope.title, message: ctx.envelope.message || '', expiresAt: ctx.envelope.expiresAt || '',
});

/** Sends one notice now. { delivered, reason }. The provider's idempotency key makes a repeat of the same notice harmless. */
export async function sendNotice(n, origin) {
  const mail = signerEmail({ ...n, link: `${origin || env('APP_ORIGIN').replace(/\/+$/, '')}/sign/${n.token}` });
  return sendSystemEmail({ to: n.to, subject: mail.subject, text: mail.text, tenant: n.tenant, idem: `esign:${n.kind}:${sha256Hex(n.token).slice(0, 40)}` });
}

/**
 * Sends a notice, and when that does not work queues it for the job runner. The queued copy is sealed with the
 * deployment's key: the jobs table never holds a link token or an address in the clear.
 */
export async function sendOrQueue(n, origin) {
  const sent = await sendNotice(n, origin);
  if (sent.delivered) return 'sent';
  if (sent.reason === 'not_configured') return 'not_configured';
  const id = await enqueue('esign.notify', { sealed: sealToken(n, AAD) }, { tenant: n.tenant, idem: `esign:${n.kind}:${sha256Hex(n.token).slice(0, 40)}`, maxAttempts: 6 });
  return id ? 'queued' : 'failed';
}
export const openNotice = (sealed) => openToken(sealed, AAD);
