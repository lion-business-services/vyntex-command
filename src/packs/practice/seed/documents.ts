// Documents of the sample firm: the paperwork every engagement already has (a proposal, an engagement letter, an
// invoice), a document of each template kind, the firm's templates, one uploaded file with two versions, and two
// signature requests (one waiting on the second of two signers, one completed).
// Everything here is made up. In particular there is no legal or tax wording: the starter templates are structure only,
// the one "approved" template of the sample firm says in its own text that it is a sample with no legal meaning, and the
// two small PDF files say the same. The signature requests come without their PDF (a sample is built without a browser);
// the app draws it the first time a request is opened.
import type { DocRecord, DocTemplate, Envelope, FileRef, Job, Lang } from '@/domain/types';
import { TEMPLATE_KINDS, starterId, starterTemplates, type ConsentTemplate } from '@/domain/esign/templates';
import type { DocVersionX, EnvelopeX, SampleFileRef } from '@/domain/esign/types';
import { tinyPdf } from '@/domain/esign/tinypdf';
import { at } from '@/lib/dates';
import { day, stamp, txFor } from './util';

/**
 * A made-up file of the sample: its name, its size, and the lines of text of its one page. The record carries no bytes
 * (a file's bytes never live in a record); the app writes the small PDF from these lines when the file is opened.
 */
const tinyFile = (name: string, lines: string[]): SampleFileRef => ({ name, size: tinyPdf(lines).length, mime: 'application/pdf', sample: lines });

/** Engagements whose engagement letter is written out below from the starter template (still a draft, waiting on signature). */
const OWN_LETTER = new Set(['pe6']);

export function documents(lang: Lang, jobs: Job[], signer: (clientId: string) => { name: string; email: string }): { docs: DocRecord[]; templates: DocTemplate[]; envelopes: Envelope[] } {
  const tx = txFor(lang);
  const docs: DocRecord[] = [];
  jobs.forEach((j, i) => {
    const n = 1001 + i; const who = signer(j.clientId);
    if (j.status === 'estimate') { docs.push({ id: `pd-${j.id}-e`, kind: 'estimate', number: `VP-EST-${n}`, title: j.name, jobId: j.id, clientId: j.clientId, status: 'draft', created: j.created, updated: j.created }); return; }
    const signed = j.status !== 'contract';
    // this engagement already has its own engagement letter further down; a second one here would read as a duplicate
    if (OWN_LETTER.has(j.id)) return;
    docs.push({ id: `pd-${j.id}-c`, kind: 'contract', number: `VP-C-${n}`, title: j.name, jobId: j.id, clientId: j.clientId, status: signed ? 'signed' : 'draft', created: j.created, updated: j.created,
      // a demo signature: nothing was legally signed
      esign: signed ? { demo: true, signerName: who.name, signerEmail: who.email, status: 'signed', sentAt: stamp(-60, 11), viewedAt: stamp(-59, 10), signedAt: stamp(-58, 12) } : undefined });
    if (j.status === 'progress' || j.status === 'done') {
      const paid = j.received.reduce((a, r) => a + r.amount, 0); const last = j.received[j.received.length - 1];
      docs.push({ id: `pd-${j.id}-i`, kind: 'invoice', number: `VP-INV-${n}`, title: j.name, jobId: j.id, clientId: j.clientId, status: paid >= j.price && j.price > 0 ? 'paid' : 'sent', created: j.start || j.created, updated: last ? last.date : j.start || j.created });
    }
  });

  /* ---------- templates ---------- */
  // the sample firm's own template: approved, and plain about what it is. It lets the signing steps be tried end to end.
  const sample = (l: 'en' | 'es'): DocTemplate => ({
    id: 'pt-sample-' + l, kind: 'custom', lang: l, source: 'company', approved: true, approvedBy: 'u1', approvedAt: stamp(-40, 15), active: true,
    name: l === 'es' ? 'Documento de muestra para probar la firma' : 'Sample document for trying the signing steps',
    blocks: l === 'es' ? [
      { id: 'b1', type: 'p', text: 'Fecha: {{date.today}}' },
      { id: 'b2', type: 'list', text: 'Cliente: {{client.name}}\nNegocio: {{client.business?}}\nServicio: {{service.name}}\nPeriodo: {{service.period?}}' },
      { id: 'b3', type: 'h', text: 'Texto de muestra' },
      { id: 'b4', type: 'p', text: 'Esta página de muestra no tiene ningún valor legal. Ocupa el lugar del texto que un despacho redactaría y aprobaría, para que los pasos de firma se puedan probar con registros inventados.' },
      { id: 'b5', type: 'h', text: 'Firmas' }, { id: 'b6', type: 'sign', text: 'client, co_owner' }, { id: 'b7', type: 'sign', text: 'firm' },
    ] : [
      { id: 'b1', type: 'p', text: 'Date: {{date.today}}' },
      { id: 'b2', type: 'list', text: 'Client: {{client.name}}\nBusiness: {{client.business?}}\nService: {{service.name}}\nPeriod: {{service.period?}}' },
      { id: 'b3', type: 'h', text: 'Sample text' },
      { id: 'b4', type: 'p', text: 'This sample page has no legal meaning. It stands in for wording a firm would write and approve, so the signing steps can be tried with made-up records.' },
      { id: 'b5', type: 'h', text: 'Signatures' }, { id: 'b6', type: 'sign', text: 'client, co_owner' }, { id: 'b7', type: 'sign', text: 'firm' },
    ],
  });
  // the sentence a signer ticks, as the sample firm wrote it; it says it is sample wording
  const consent = (l: 'en' | 'es'): ConsentTemplate => ({
    id: 'pt-consent-' + l, kind: 'custom', lang: l, source: 'company', approved: true, approvedBy: 'u1', approvedAt: stamp(-40, 15), active: true, use: 'consent',
    name: l === 'es' ? 'Consentimiento para firmar electrónicamente' : 'Consent to sign electronically',
    blocks: [{ id: 'b1', type: 'p', text: l === 'es' ? 'Texto de muestra: acepto firmar este documento de forma electrónica.' : 'Sample wording: I agree to sign this document electronically.' }],
  });
  // a block is a record of its own in the database: its id carries the id of its template
  const own = <T extends DocTemplate>(tpl: T): T => ({ ...tpl, blocks: tpl.blocks.map((b) => ({ ...b, id: `${tpl.id}-${b.id}` })) });
  const templates: DocTemplate[] = [...starterTemplates(TEMPLATE_KINDS), own(sample('en')), own(sample('es')), own(consent('en')), own(consent('es'))];

  /* ---------- a document of each template kind ---------- */
  const job = (id: string) => jobs.find((j) => j.id === id);
  const made = (id: string, kind: DocRecord['kind'], number: string, clientId: string, jobId: string, tplLang: 'en' | 'es', days: number, more: Partial<DocRecord> = {}): DocRecord =>
    ({ id, kind, number, title: job(jobId)?.name ?? '', jobId: job(jobId) ? jobId : '', clientId, status: 'draft', created: day(days), updated: day(days), templateId: starterId(kind, tplLang), ...more });
  docs.push(
    // written from the starter structures: each one says its wording is not approved yet
    made('pd-el-pe6', 'engagement_letter', 'VP-EL-1001', 'pc5', 'pe6', 'en', -28),
    made('pd-sa-pe3', 'service_agreement', 'VP-SA-1001', 'pc7', 'pe3', 'en', -15),
    made('pd-so-pe9', 'service_order', 'VP-SO-1001', 'pc8', 'pe9', 'en', -4),
    made('pd-con-pc1', 'consent_7216', 'VP-CON-1001', 'pc1', '', 'es', -45, { title: tx('Section 7216 consent', 'Consentimiento de la sección 7216') }),
  );

  /* ---------- files ---------- */
  const fileNote = tx('Sample file. It holds no real information and has no legal meaning.', 'Archivo de muestra. No contiene información real y no tiene ningún valor legal.');
  // the firm's own form, uploaded as a file: the product writes no authorization wording
  const form = tinyFile(tx('form-2848-sample.pdf', 'formulario-2848-muestra.pdf'), [tx('Stands in for a completed Form 2848.', 'Ocupa el lugar de un Formulario 2848 ya completado.'), fileNote]);
  const v1 = tinyFile(tx('statement-december.pdf', 'estado-de-cuenta-diciembre.pdf'), [tx('Bank statement, December (sample file, first upload).', 'Estado de cuenta, diciembre (archivo de muestra, primera carga).'), fileNote]);
  const v2 = tinyFile(tx('statement-december-complete.pdf', 'estado-de-cuenta-diciembre-completo.pdf'), [tx('Bank statement, December (sample file, complete version).', 'Estado de cuenta, diciembre (archivo de muestra, versión completa).'), fileNote]);
  const version = (v: number, days: number, by: string, file: FileRef, note?: string): DocVersionX => ({ v, at: stamp(days, 11), by, kind: 'upload', file, ...(note ? { note } : {}) });
  docs.push(
    { id: 'pd-poa-pc2', kind: 'poa_2848', number: 'VP-POA-1001', title: tx('Form 2848 (sample file)', 'Formulario 2848 (archivo de muestra)'), jobId: 'pe5', clientId: 'pc2', status: 'draft', created: day(-22), updated: day(-22),
      file: form, versions: [version(1, -22, 'u2', form)], folder: tx('Forms', 'Formularios') },
    { id: 'pd-up-pc7', kind: 'upload', number: 'VP-FILE-1001', title: tx('December bank statement', 'Estado de cuenta de diciembre'), jobId: 'pe3', clientId: 'pc7', status: 'draft', created: day(-9), updated: day(-3),
      file: v2, versions: [version(1, -9, 'u2', v1), version(2, -3, 'u2', v2, tx('The first upload was missing a page.', 'A la primera carga le faltaba una página.'))], folder: tx('Bank statements', 'Estados de cuenta') },
  );

  /* ---------- signature requests ---------- */
  // A document made from a template is in the template's language, whatever language the workspace is viewed in.
  // The first one is for a client who prefers Spanish, so it is Spanish in both samples; the second follows the sample.
  // 1. two signers, one after the other: the first has signed, the second has the link
  const who6 = signer('pc6');
  docs.push({ id: 'pd-doc-pe1', kind: 'custom', number: 'VP-DOC-1001', title: 'Documento de muestra para firma', jobId: 'pe1', clientId: 'pc6', status: 'viewed', created: day(-5), updated: day(-2), templateId: 'pt-sample-es', envelopeId: 'pv1' });
  const waiting: EnvelopeX = {
    id: 'pv1', docId: 'pd-doc-pe1', title: 'Documento de muestra para firma VP-DOC-1001', status: 'partly_signed', ordered: true, fields: [], demo: true,
    created: stamp(-5, 10), createdBy: 'u3', sentAt: stamp(-4, 10), expiresAt: at(26, 10), expiryDays: 30, remindEvery: 3, lastReminder: stamp(-1, 9), lang: 'es', clientId: 'pc6', jobId: 'pe1', docNumber: 'VP-DOC-1001', docKind: 'custom', consentText: consent('es').blocks[0].text,
    signers: [
      { id: 'pv1-s1', name: who6.name, email: who6.email, role: 'client', order: 1, status: 'signed', sentAt: stamp(-4, 10), viewedAt: stamp(-3, 18), signedAt: stamp(-2, 9, 12), typedName: who6.name, consent: true, consentAt: stamp(-2, 9, 12) },
      { id: 'pv1-s2', name: 'Rubén Maldonado', email: 'ruben@example.com', role: 'co_owner', order: 2, status: 'sent', sentAt: stamp(-2, 9, 12), lastReminder: stamp(-1, 9) },
    ],
    events: [
      { at: stamp(-5, 10), kind: 'created' }, { at: stamp(-4, 10), kind: 'sent', signerId: 'pv1-s1' }, { at: stamp(-3, 18), kind: 'viewed', signerId: 'pv1-s1' },
      { at: stamp(-2, 9, 12), kind: 'signed', signerId: 'pv1-s1' }, { at: stamp(-2, 9, 12), kind: 'sent', signerId: 'pv1-s2' }, { at: stamp(-1, 9), kind: 'reminded', signerId: 'pv1-s2', note: 'auto' },
    ],
  };
  // 2. completed: the client, then the firm
  const who7 = signer('pc7');
  const l2 = lang === 'es' ? 'es' : 'en';
  docs.push({ id: 'pd-doc-pe3', kind: 'custom', number: 'VP-DOC-1002', title: tx('Sample document for signature', 'Documento de muestra para firma'), jobId: 'pe3', clientId: 'pc7', status: 'signed', created: day(-14), updated: day(-11), templateId: 'pt-sample-' + l2, envelopeId: 'pv2' });
  const completed: EnvelopeX = {
    id: 'pv2', docId: 'pd-doc-pe3', title: tx('Sample document for signature', 'Documento de muestra para firma') + ' VP-DOC-1002', status: 'completed', ordered: true, fields: [], demo: true,
    created: stamp(-14, 14), createdBy: 'u2', sentAt: stamp(-14, 14, 20), expiresAt: at(16, 14), expiryDays: 30, remindEvery: 3, completedAt: stamp(-11, 16, 40), lang: l2, clientId: 'pc7', jobId: 'pe3', docNumber: 'VP-DOC-1002', docKind: 'custom', consentText: consent(l2).blocks[0].text,
    signers: [
      { id: 'pv2-s1', name: who7.name, email: who7.email, role: 'client', order: 1, status: 'signed', sentAt: stamp(-14, 14, 20), viewedAt: stamp(-13, 8, 5), signedAt: stamp(-13, 8, 11), typedName: who7.name, consent: true, consentAt: stamp(-13, 8, 11) },
      { id: 'pv2-s2', name: 'Daniel Okafor', email: 'daniel@example.com', role: 'firm', userId: 'u2', order: 2, status: 'signed', sentAt: stamp(-13, 8, 11), viewedAt: stamp(-11, 16, 32), signedAt: stamp(-11, 16, 40), typedName: 'Daniel Okafor', consent: true, consentAt: stamp(-11, 16, 40) },
    ],
    events: [
      { at: stamp(-14, 14), kind: 'created' }, { at: stamp(-14, 14, 20), kind: 'sent', signerId: 'pv2-s1' }, { at: stamp(-13, 8, 5), kind: 'viewed', signerId: 'pv2-s1' }, { at: stamp(-13, 8, 11), kind: 'signed', signerId: 'pv2-s1' },
      { at: stamp(-13, 8, 11), kind: 'sent', signerId: 'pv2-s2' }, { at: stamp(-11, 16, 32), kind: 'viewed', signerId: 'pv2-s2' }, { at: stamp(-11, 16, 40), kind: 'signed', signerId: 'pv2-s2' }, { at: stamp(-11, 16, 40), kind: 'completed' },
    ],
  };
  return { docs, templates, envelopes: [waiting, completed] };
}
