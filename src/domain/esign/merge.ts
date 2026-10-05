// Merge fields: the {{client.name}} markers a template may contain, and the one place they are filled in.
// A marker with no value is never left blank and never guessed: it becomes a bracketed "[Missing: ...]" note that shows
// on the document, and a document with one cannot be sent for signature.
import type { Client, DemoState, ISODate, Job, L10n, Lang, Lead } from '../types';
import type { IndustryPack } from '@/packs/types';
import { pick } from '@/i18n';
import { money2 } from '@/lib/money';
import { fmtDate, today } from '@/lib/dates';

export interface MergeField { id: string; label: L10n; group: 'client' | 'service' | 'firm' | 'dates' }
const l = (en: string, es: string): L10n => ({ en, es });

/** Every field a template may use, in the order the settings screen lists them. */
export const MERGE_FIELDS: MergeField[] = [
  { id: 'client.name', label: l('Client name', 'Nombre del cliente'), group: 'client' },
  { id: 'client.business', label: l('Business name', 'Nombre del negocio'), group: 'client' },
  { id: 'client.owners', label: l('Owners', 'Dueños'), group: 'client' },
  { id: 'client.address', label: l('Client address', 'Dirección del cliente'), group: 'client' },
  { id: 'client.email', label: l('Client email', 'Correo del cliente'), group: 'client' },
  { id: 'client.phone', label: l('Client phone', 'Teléfono del cliente'), group: 'client' },
  { id: 'service.name', label: l('Service', 'Servicio'), group: 'service' },
  { id: 'service.tier', label: l('Price tier', 'Nivel de precio'), group: 'service' },
  { id: 'service.price', label: l('Price', 'Precio'), group: 'service' },
  { id: 'service.period', label: l('Period', 'Periodo'), group: 'service' },
  { id: 'service.scope', label: l('What the service covers', 'Qué cubre el servicio'), group: 'service' },
  { id: 'service.terms', label: l('Fee and billing notes', 'Notas de honorarios y cobro'), group: 'service' },
  { id: 'firm.name', label: l('Firm name', 'Nombre del despacho'), group: 'firm' },
  { id: 'firm.address', label: l('Firm address', 'Dirección del despacho'), group: 'firm' },
  { id: 'firm.phone', label: l('Firm phone', 'Teléfono del despacho'), group: 'firm' },
  { id: 'firm.email', label: l('Firm email', 'Correo del despacho'), group: 'firm' },
  { id: 'date.today', label: l('Today', 'Fecha de hoy'), group: 'dates' },
  { id: 'date.start', label: l('Start date', 'Fecha de inicio'), group: 'dates' },
  { id: 'date.due', label: l('Due date', 'Fecha límite'), group: 'dates' },
];
const FIELD_BY_ID = new Map(MERGE_FIELDS.map((f) => [f.id, f]));
const MISSING: L10n = l('Missing', 'Falta');
// {{client.name}} must have a value; {{client.business?}} may be empty (the line is simply shorter, or dropped from a list)
const MARKER = /\{\{\s*([a-z]+\.[a-z]+)(\?)?\s*\}\}/gi;

export type MergeValues = Record<string, string>;
export interface MergeSubject {
  client?: Client; job?: Job; lead?: Lead; lang: Lang;
  /** The day "today" stands for. A document that went out for signature keeps the day it was sent. */
  on?: ISODate;
}

/** The value of every merge field for a client, with or without an engagement. An empty string means "not on record". */
export function mergeValues(d: DemoState, _pack: IndustryPack, s: MergeSubject): MergeValues {
  const { client, job, lead, lang } = s;
  const service = d.catalog.find((x) => x.id === job?.serviceId) ?? d.catalog.find((x) => !!lead?.serviceIds?.includes(x.id));
  const tier = service?.tiers.find((x) => x.id === job?.tierId) ?? (service && !job ? service.tiers[0] : undefined);
  const price = job ? job.price : tier?.price ?? lead?.value ?? null;
  const co = d.company;
  return {
    'client.name': client?.name ?? lead?.name ?? '',
    'client.business': client?.company ?? lead?.company ?? '',
    'client.owners': (client?.owners ?? []).map((o) => o.name).filter(Boolean).join(', '),
    'client.address': client?.addresses?.[0] ?? lead?.address ?? '',
    'client.email': client?.email ?? lead?.email ?? '',
    'client.phone': client?.phone ?? lead?.phone ?? '',
    'service.name': service ? service.i18n?.[lang]?.name ?? service.name : job?.name ?? '',
    'service.tier': tier?.name ?? '',
    'service.price': price === null || price === undefined ? '' : money2(price),
    'service.period': job?.period ?? '',
    'service.scope': job?.scope?.trim() ?? '',
    'service.terms': job?.payTerms?.trim() ?? '',
    'firm.name': co.legalName || co.name,
    'firm.address': co.address ?? d.offices.find((o) => o.main)?.address ?? d.offices[0]?.address ?? '',
    'firm.phone': co.phone,
    'firm.email': co.email,
    'date.today': fmtDate(s.on || today(), lang),
    'date.start': job?.start ? fmtDate(job.start, lang) : '',
    'date.due': job?.end ? fmtDate(job.end, lang) : '',
  };
}

/** Label of a merge field in a language; an unknown marker is shown as it was typed. */
export const mergeLabel = (id: string, lang: Lang): string => { const f = FIELD_BY_ID.get(id.toLowerCase()); return f ? pick(f.label, lang) : id; };
/** The note that stands where a value is missing. Bracketed on purpose: see `hasPlaceholder`. */
export const missingNote = (id: string, lang: Lang): string => `[${pick(MISSING, lang)}: ${mergeLabel(id, lang)}]`;

/** Fills the markers of one text. Returns the text and the ids that had no value (or do not exist). */
export function resolveMerge(text: string, values: MergeValues, lang: Lang): { text: string; missing: string[] } {
  const missing: string[] = [];
  const out = text.replace(MARKER, (_all, raw: string, optional?: string) => {
    const id = raw.toLowerCase();
    const v = values[id];
    if (v && v.trim()) return v;
    if (optional && FIELD_BY_ID.has(id)) return '';
    if (!missing.includes(id)) missing.push(id);
    return missingNote(id, lang);
  });
  return { text: out, missing };
}
/**
 * Fills a list block: one item per line. A line whose only content was optional values that are empty is left out, so
 * "Business: {{client.business?}}" does not print for a person.
 */
export function resolveList(text: string, values: MergeValues, lang: Lang): { text: string; missing: string[] } {
  const missing: string[] = []; const lines: string[] = [];
  for (const raw of text.split('\n')) {
    const r = resolveMerge(raw, values, lang);
    for (const m of r.missing) if (!missing.includes(m)) missing.push(m);
    const optionalOnly = /\?\s*\}\}/.test(raw) && r.text.replace(/^[^:]*:\s*/, '').trim() === '';
    if (r.text.trim() && !optionalOnly) lines.push(r.text.trim());
  }
  return { text: lines.join('\n'), missing };
}
/** The markers a text uses, known or not. */
export const markersIn = (text: string): string[] => [...new Set([...text.matchAll(MARKER)].map((m) => m[1].toLowerCase()))];
export const unknownMarkers = (text: string): string[] => markersIn(text).filter((id) => !FIELD_BY_ID.has(id));

/** True when a text still has a bracketed part: a placeholder of a starter template, or a missing value. */
export const hasPlaceholder = (text: string): boolean => /\[[^\[\]\n]{2,}\]/.test(text);
/** Splits a text at its bracketed parts, so a screen can mark them. */
export function splitPlaceholders(text: string): { s: string; ph: boolean }[] {
  const out: { s: string; ph: boolean }[] = []; let at = 0;
  for (const m of text.matchAll(/\[[^\[\]\n]{2,}\]/g)) {
    if (m.index! > at) out.push({ s: text.slice(at, m.index), ph: false });
    out.push({ s: m[0], ph: true }); at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ s: text.slice(at), ph: false });
  return out;
}
