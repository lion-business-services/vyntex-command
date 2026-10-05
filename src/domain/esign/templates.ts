// Document templates: which one a new document is made from, and the starter structures an edition ships.
//
// A starter is STRUCTURE ONLY: headings, merge fields, signature lines and bracketed placeholders that say where the
// company's own approved wording goes. No legal or tax wording is written here, on purpose: the owner's rule is that
// wording is supplied and approved by the business, never assumed. A starter is `approved: false`, a document made from
// an unapproved template cannot be sent for signature, and a template can only be approved once every placeholder was
// replaced. For the Section 7216 consent and Form 2848 there is no consent or authorization language at all: the record,
// the upload of the firm's own approved form and the signature steps around it are what the product provides.
import type { DemoState, DocKind, DocTemplate, Lang } from '../types';
import { hasPlaceholder, unknownMarkers } from './merge';
import { SIGNER_ROLES, type SignerRole } from './types';

type Blocks = DocTemplate['blocks'];
/** Kinds written from a template. Estimates, agreements and invoices of a job are written from the job; an upload is a file. */
export const TEMPLATE_KINDS: DocKind[] = ['engagement_letter', 'service_agreement', 'service_order', 'consent_7216', 'poa_2848', 'custom'];
export const isTemplateKind = (k: DocKind): boolean => TEMPLATE_KINDS.includes(k);
/** Kinds where the usual document is the firm's own form, uploaded as a file. */
export const FORM_KINDS: DocKind[] = ['consent_7216', 'poa_2848'];

/**
 * The sentence a signer agrees to is kept like any other wording: a template record per language, with its source and its
 * approval. It is marked `use: 'consent'` so it never shows up as a template to make documents from.
 */
export type ConsentTemplate = DocTemplate & { use?: 'consent' };
export const isConsentTemplate = (t: DocTemplate): boolean => (t as ConsentTemplate).use === 'consent';

const b = (...rows: [Blocks[number]['type'], string][]): Blocks => rows.map(([type, text], i) => ({ id: 'b' + (i + 1), type, text }));

const EN: Partial<Record<DocKind, { name: string; blocks: Blocks }>> = {
  engagement_letter: { name: 'Engagement letter (starter structure)', blocks: b(
    ['p', 'Date: {{date.today}}'],
    ['list', 'Client: {{client.name}}\nBusiness: {{client.business?}}\nAddress: {{client.address}}'],
    ['h', '1. Services'], ['list', 'Service: {{service.name}}\nPeriod: {{service.period?}}'], ['p', '[Scope of services: add your approved wording]'],
    ['h', '2. Fees and billing'], ['list', 'Fee: {{service.price}}'], ['p', '[Fees and billing: add your approved wording]'],
    ['h', '3. What the client provides'], ['p', '[Client responsibilities: add your approved wording]'],
    ['h', '4. What the firm is responsible for'], ['p', '[Firm responsibilities: add your approved wording]'],
    ['h', '5. Ending the engagement'], ['p', '[Term and termination: add your approved wording]'],
    ['h', 'Signatures'], ['sign', 'client, firm']) },
  service_agreement: { name: 'Service agreement (starter structure)', blocks: b(
    ['p', 'Date: {{date.today}}'],
    ['list', 'Client: {{client.name}}\nBusiness: {{client.business?}}\nAddress: {{client.address}}\nProvider: {{firm.name}}'],
    ['h', '1. Services'], ['list', 'Service: {{service.name}}\nPrice tier: {{service.tier?}}\nPeriod: {{service.period?}}'], ['p', '[Services: add your approved wording]'],
    ['h', '2. Fees and payment'], ['list', 'Price: {{service.price}}'], ['p', '[Fees and payment: add your approved wording]'],
    ['h', '3. Term'], ['p', '[Term, renewal and ending the agreement: add your approved wording]'],
    ['h', '4. Other terms'], ['p', '[Other terms: add your approved wording]'],
    ['h', 'Signatures'], ['sign', 'client, firm']) },
  service_order: { name: 'Service order (starter structure)', blocks: b(
    ['p', 'Date: {{date.today}}'],
    ['list', 'Client: {{client.name}}\nBusiness: {{client.business?}}\nEmail: {{client.email?}}\nPhone: {{client.phone?}}'],
    ['h', 'Service ordered'], ['list', 'Service: {{service.name}}\nPrice tier: {{service.tier?}}\nPrice: {{service.price}}\nPeriod: {{service.period?}}'],
    ['p', '[Terms of this order: add your approved wording]'],
    ['h', 'Signature'], ['sign', 'client']) },
  consent_7216: { name: 'Section 7216 consent (record and signature only)', blocks: b(
    ['list', 'Taxpayer: {{client.name}}\nPreparer: {{firm.name}}\nDate: {{date.today}}'],
    ['p', '[Consent text: paste the consent your firm has approved here, or upload your firm\'s approved form as a file instead. This starter contains no consent wording.]'],
    ['h', 'Signature'], ['sign', 'client']) },
  poa_2848: { name: 'Form 2848 (record and signature only)', blocks: b(
    ['list', 'Taxpayer: {{client.name}}\nRepresentative: {{firm.name}}\nDate: {{date.today}}'],
    ['p', '[Form 2848: upload the completed form as a file for this client and send that file for signature. This starter contains no authorization wording.]'],
    ['h', 'Signature'], ['sign', 'client']) },
  custom: { name: 'Custom document (starter structure)', blocks: b(
    ['p', 'Date: {{date.today}}'], ['list', 'Client: {{client.name}}\nBusiness: {{client.business?}}'],
    ['h', '[Heading]'], ['p', '[Write the text of this document]'],
    ['h', 'Signature'], ['sign', 'client']) },
};
const ES: Partial<Record<DocKind, { name: string; blocks: Blocks }>> = {
  engagement_letter: { name: 'Carta de encargo (estructura inicial)', blocks: b(
    ['p', 'Fecha: {{date.today}}'],
    ['list', 'Cliente: {{client.name}}\nNegocio: {{client.business?}}\nDirección: {{client.address}}'],
    ['h', '1. Servicios'], ['list', 'Servicio: {{service.name}}\nPeriodo: {{service.period?}}'], ['p', '[Alcance de los servicios: agregue su texto aprobado]'],
    ['h', '2. Honorarios y cobro'], ['list', 'Honorarios: {{service.price}}'], ['p', '[Honorarios y cobro: agregue su texto aprobado]'],
    ['h', '3. Lo que aporta el cliente'], ['p', '[Responsabilidades del cliente: agregue su texto aprobado]'],
    ['h', '4. De qué es responsable el despacho'], ['p', '[Responsabilidades del despacho: agregue su texto aprobado]'],
    ['h', '5. Terminación del encargo'], ['p', '[Vigencia y terminación: agregue su texto aprobado]'],
    ['h', 'Firmas'], ['sign', 'client, firm']) },
  service_agreement: { name: 'Acuerdo de servicio (estructura inicial)', blocks: b(
    ['p', 'Fecha: {{date.today}}'],
    ['list', 'Cliente: {{client.name}}\nNegocio: {{client.business?}}\nDirección: {{client.address}}\nProveedor: {{firm.name}}'],
    ['h', '1. Servicios'], ['list', 'Servicio: {{service.name}}\nNivel de precio: {{service.tier?}}\nPeriodo: {{service.period?}}'], ['p', '[Servicios: agregue su texto aprobado]'],
    ['h', '2. Honorarios y pago'], ['list', 'Precio: {{service.price}}'], ['p', '[Honorarios y pago: agregue su texto aprobado]'],
    ['h', '3. Vigencia'], ['p', '[Vigencia, renovación y terminación del acuerdo: agregue su texto aprobado]'],
    ['h', '4. Otros términos'], ['p', '[Otros términos: agregue su texto aprobado]'],
    ['h', 'Firmas'], ['sign', 'client, firm']) },
  service_order: { name: 'Orden de servicio (estructura inicial)', blocks: b(
    ['p', 'Fecha: {{date.today}}'],
    ['list', 'Cliente: {{client.name}}\nNegocio: {{client.business?}}\nCorreo: {{client.email?}}\nTeléfono: {{client.phone?}}'],
    ['h', 'Servicio solicitado'], ['list', 'Servicio: {{service.name}}\nNivel de precio: {{service.tier?}}\nPrecio: {{service.price}}\nPeriodo: {{service.period?}}'],
    ['p', '[Términos de esta orden: agregue su texto aprobado]'],
    ['h', 'Firma'], ['sign', 'client']) },
  consent_7216: { name: 'Consentimiento de la sección 7216 (solo registro y firma)', blocks: b(
    ['list', 'Contribuyente: {{client.name}}\nPreparador: {{firm.name}}\nFecha: {{date.today}}'],
    ['p', '[Texto del consentimiento: pegue aquí el consentimiento que su despacho aprobó, o suba como archivo el formulario aprobado de su despacho. Esta estructura no contiene texto de consentimiento.]'],
    ['h', 'Firma'], ['sign', 'client']) },
  poa_2848: { name: 'Formulario 2848 (solo registro y firma)', blocks: b(
    ['list', 'Contribuyente: {{client.name}}\nRepresentante: {{firm.name}}\nFecha: {{date.today}}'],
    ['p', '[Formulario 2848: suba como archivo el formulario ya completado de este cliente y envíe ese archivo para firma. Esta estructura no contiene texto de autorización.]'],
    ['h', 'Firma'], ['sign', 'client']) },
  custom: { name: 'Documento personalizado (estructura inicial)', blocks: b(
    ['p', 'Fecha: {{date.today}}'], ['list', 'Cliente: {{client.name}}\nNegocio: {{client.business?}}'],
    ['h', '[Encabezado]'], ['p', '[Escriba el texto de este documento]'],
    ['h', 'Firma'], ['sign', 'client']) },
};

export const starterId = (kind: DocKind, lang: Lang): string => `starter-${kind}-${lang === 'es' ? 'es' : 'en'}`;
/** The starter structure of a kind, in Spanish or English (any other language gets the English one). Null for a kind that is not written from a template. */
export function starterTemplate(kind: DocKind, lang: Lang): DocTemplate | null {
  const src = (lang === 'es' ? ES : EN)[kind];
  if (!src) return null;
  const id = starterId(kind, lang);
  // a block is a record of its own in the database, so its id says which template it belongs to
  return { id, kind, name: src.name, lang: lang === 'es' ? 'es' : 'en', blocks: src.blocks.map((x) => ({ ...x, id: `${id}-${x.id}` })), source: 'starter', approved: false, active: true };
}
/** A template that began as a starter remembers which one, so that starter is not offered to the company a second time. */
export type StarterCopy = DocTemplate & { starter?: string };
export const fromStarter = (t: DocTemplate, starter: string): boolean => t.id === starter || (t as StarterCopy).starter === starter;
/**
 * A starter becomes a record of the company the first time it is used or edited. In a company workspace the record and
 * its blocks need ids of the database's kind: `newId` makes them. Without it (the sample) the starter keeps its own.
 */
export function adoptStarter(s: DocTemplate, newId?: (prefix: string) => string): DocTemplate {
  if (!newId) return s;
  return { ...s, id: newId('tp'), blocks: s.blocks.map((x) => ({ ...x, id: newId('b') })), starter: s.id } as StarterCopy;
}
/** Every starter of the kinds an edition offers, in both languages: what a new company begins with. */
export function starterTemplates(kinds: DocKind[]): DocTemplate[] {
  return kinds.filter(isTemplateKind).flatMap((k) => (['en', 'es'] as Lang[]).map((lang) => starterTemplate(k, lang))).filter((x): x is DocTemplate => !!x);
}

/**
 * The template a new document of a kind is made from: the one asked for, else the company's active template in the
 * client's language, else its English one, else any, else the edition's starter (in that language, else English).
 */
export function pickTemplate(d: Pick<DemoState, 'templates'>, kind: DocKind, lang: Lang, templateId?: string): DocTemplate | null {
  if (templateId) { const asked = d.templates.find((x) => x.id === templateId && !isConsentTemplate(x)) ?? null; if (asked) return asked; }
  const own = d.templates.filter((x) => x.kind === kind && x.active && !isConsentTemplate(x));
  // an approved template is preferred over an unapproved one of the same language
  const best = (list: DocTemplate[]) => list.find((x) => x.approved) ?? list[0];
  return best(own.filter((x) => x.lang === lang)) ?? best(own.filter((x) => x.lang === 'en')) ?? best(own) ?? starterTemplate(kind, lang);
}

/** The signers a signature block asks for: "client, firm" -> ['client', 'firm']. Unknown words are ignored; an empty block means the client. */
export function signRoles(text: string): SignerRole[] {
  const roles = text.split(/[,\n]/).map((x) => x.trim().toLowerCase().replace(/[\s-]+/g, '_')).filter((x): x is SignerRole => (SIGNER_ROLES as string[]).includes(x));
  return roles.length ? [...new Set(roles)] : ['client'];
}

/** Why a template cannot be approved yet. Empty when it can. */
export function templateIssues(tpl: Pick<DocTemplate, 'blocks' | 'name'>): { placeholders: number; unknown: string[]; empty: boolean; noSignature: boolean } {
  const texts = tpl.blocks.filter((x) => x.type !== 'sign');
  return {
    placeholders: texts.filter((x) => hasPlaceholder(x.text)).length,
    unknown: [...new Set(texts.flatMap((x) => unknownMarkers(x.text)))],
    empty: !texts.some((x) => x.text.trim()),
    noSignature: !tpl.blocks.some((x) => x.type === 'sign'),
  };
}
export const canApprove = (tpl: Pick<DocTemplate, 'blocks' | 'name'>): boolean => { const i = templateIssues(tpl); return !i.placeholders && !i.unknown.length && !i.empty; };
