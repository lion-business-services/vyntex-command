// Reading what a person typed: accent and case folding, dates, times, amounts, phone numbers and names.
// Works on English and Spanish at the same time, so a Spanish request is understood while the screen is in English.
import type { ISODate } from '@/domain/types';
import { addDays, parseDate, toISODate, today } from '@/lib/dates';
import { parseMoney } from '@/lib/money';

const SWAP: Record<string, string> = { '’': "'", '‘': "'", '“': '"', '”': '"', '¿': ' ', '¡': ' ', '\n': ' ', '\t': ' ', '\u00a0': ' ' };

/** Lower case without accents, one character out for every character in, so positions match the original text. */
export function fold(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const swap = SWAP[c];
    if (swap !== undefined) { out += swap; continue; }
    const f = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    out += f.length === 1 ? f : f.length > 1 ? f[0] : c;
  }
  return out;
}

/** A request being taken apart: recognised pieces are cut out, what is left is the free text (a name, a title, a note). */
export class Work {
  raw: string;
  norm: string;
  constructor(text: string) { this.raw = text.normalize('NFC'); this.norm = fold(this.raw); }
  cut(from: number, to: number) {
    this.raw = this.raw.slice(0, from) + ' ' + this.raw.slice(to);
    this.norm = this.norm.slice(0, from) + ' ' + this.norm.slice(to);
  }
  /** Cuts the first match out and returns it together with the original (unfolded) wording. */
  take(re: RegExp): { m: RegExpExecArray; raw: string } | null {
    const m = re.exec(this.norm); if (!m) return null;
    const raw = this.raw.slice(m.index, m.index + m[0].length);
    this.cut(m.index, m.index + m[0].length);
    return { m, raw };
  }
  /** Original wording between two positions. */
  slice(from: number, to?: number) { return this.raw.slice(from, to); }
  /** What is left, tidied: no stray punctuation or connecting words at the edges. */
  rest(lead?: string[], trail?: string[]): string { return tidy(this.raw, lead, trail); }
}

const PUNCT = /^[\s,;:.\-\u2013\u2014"'()]+|[\s,;:.\-\u2013\u2014"'()]+$/g;
/** Connecting words that may be left hanging at the edges of a title or a name once the recognised pieces are cut out. */
export const TITLE_LEAD = ['to', 'that', 'que', 'para', 'de'];
export const TITLE_TRAIL = ['for', 'para', 'on', 'el', 'by', 'due', 'a', 'to', 'at', 'con', 'with', 'and', 'y', 'de'];
export const NAME_LEAD = ['the', 'el', 'la', 'a', 'al', 'to', 'for', 'para', 'de', 'del', 'with', 'con', 'from', 'named', 'called', 'llamado', 'llamada', 'about', 'on', 'of', 'and', 'y', 'is', 'es'];
export const NAME_TRAIL = ['and', 'y', 'for', 'para', 'a', 'de', 'with', 'con', 'on', 'en', 'the', 'el', 'la', 'at', 'as', 'to', 'from', 'que', 'is', 'es', 'al', 'del'];
/** Collapses spaces and removes stray punctuation and the given connecting words from both ends. */
export function tidy(s: string, lead: string[] = [], trail: string[] = []): string {
  let out = s.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 8; i++) {
    let next = out.replace(PUNCT, '');
    const first = /^(\S+)\s+/.exec(next); if (first && lead.includes(fold(first[1]))) next = next.slice(first[0].length);
    const last = /\s+(\S+)$/.exec(next); if (last && trail.includes(fold(last[1]))) next = next.slice(0, last.index);
    if (lead.includes(fold(next)) || trail.includes(fold(next))) next = '';
    if (next === out) break;
    out = next;
  }
  return out.replace(/\s+([,.;:])/g, '$1');
}
export const capFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/** "ana lopez" -> "Ana Lopez". Text that already has capitals is left as typed. */
export const properName = (s: string) => (s === s.toLowerCase() ? s.replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()) : s);

/* ---------- dates ---------- */
const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
};
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12, ene: 1, abr: 4, ago: 8, set: 9, dic: 12 };
const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 };
/** Small words that lead into a date ("by Friday", "para el viernes") and belong to it, not to the title. */
const LEAD_IN = /(?:\b(?:due|by|on|for|before|para|antes del|antes de|vence|el|del)\s+)+$/;

function cutWithLeadIn(w: Work, index: number, length: number) {
  const pre = LEAD_IN.exec(w.norm.slice(0, index));
  w.cut(pre ? pre.index : index, index + length);
}
function nearestYear(month: number, day: number, year?: number): ISODate | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const now = new Date();
  let y = year ?? now.getFullYear(); if (y < 100) y += 2000;
  let d = new Date(y, month - 1, day);
  if (d.getMonth() !== month - 1) return undefined;
  // a date without a year that is long past means next year
  if (year === undefined && (now.getTime() - d.getTime()) / 86400000 > 60) d = new Date(y + 1, month - 1, day);
  return toISODate(d);
}

/** Finds a date in the text (today, tomorrow, a weekday, "in 3 days", 10/15, October 15, 15 de octubre), removes it and returns it. */
export function takeDate(w: Work): ISODate | undefined {
  let m: RegExpExecArray | null;
  if ((m = /\b(day after tomorrow|pasado manana)\b/.exec(w.norm))) { cutWithLeadIn(w, m.index, m[0].length); return addDays(2); }
  if ((m = /\b(yesterday|ayer)\b/.exec(w.norm))) { cutWithLeadIn(w, m.index, m[0].length); return addDays(-1); }
  if ((m = /\b(today|hoy|tonight|esta noche|this afternoon|esta tarde|this morning|esta manana)\b/.exec(w.norm))) { cutWithLeadIn(w, m.index, m[0].length); return today(); }
  // "mañana" is tomorrow, except in "por la mañana" (in the morning)
  const tom = /\b(tomorrow|manana)\b/g;
  while ((m = tom.exec(w.norm))) {
    if (m[1] === 'manana' && /\b(?:la|las)\s+$/.test(w.norm.slice(0, m.index))) continue;
    cutWithLeadIn(w, m.index, m[0].length); return addDays(1);
  }
  if ((m = /\b(?:(?:this|next|este|esta|proximo|proxima)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b(?:\s+(?:que viene|proximo|proxima))?/.exec(w.norm))) {
    const delta = (WEEKDAYS[m[1]] - new Date().getDay() + 7) % 7 || 7;
    cutWithLeadIn(w, m.index, m[0].length); return addDays(delta);
  }
  if ((m = /\b(?:in|en)\s+(\d{1,2}|a|an|one|two|three|four|five|un|una|dos|tres|cuatro|cinco)\s+(day|days|dia|dias|week|weeks|semana|semanas)\b/.exec(w.norm))) {
    const n = NUM[m[1]] ?? Number(m[1]); const unit = /^(week|semana)/.test(m[2]) ? 7 : 1;
    w.cut(m.index, m.index + m[0].length); return addDays(n * unit);
  }
  if ((m = /\b(?:next week|(?:la\s+)?proxima semana|(?:la\s+)?semana que viene)\b/.exec(w.norm))) { cutWithLeadIn(w, m.index, m[0].length); return addDays(7); }
  if ((m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(w.norm))) {
    const d = nearestYear(Number(m[2]), Number(m[3]), Number(m[1]));
    if (d) { cutWithLeadIn(w, m.index, m[0].length); return d; }
  }
  if ((m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(w.norm))) {
    const d = nearestYear(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined);
    if (d) { cutWithLeadIn(w, m.index, m[0].length); return d; }
  }
  if ((m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/.exec(w.norm))) {
    const d = nearestYear(MONTHS[m[1]], Number(m[2]));
    if (d) { cutWithLeadIn(w, m.index, m[0].length); return d; }
  }
  if ((m = /\b(\d{1,2})\s+de\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)[a-z]*\b/.exec(w.norm))) {
    const d = nearestYear(MONTHS[m[2]], Number(m[1]));
    if (d) { cutWithLeadIn(w, m.index, m[0].length); return d; }
  }
  return undefined;
}

/* ---------- time of day ---------- */
const pad = (n: number) => String(n).padStart(2, '0');
function clock(hour: number, minute: number, meridiem: string | undefined, part: string | undefined): string | undefined {
  if (hour > 23 || minute > 59) return undefined;
  const mer = (meridiem || '').replace(/[^apm]/g, '');
  let h = hour;
  if (mer === 'pm' || (part && /tarde|noche|afternoon|evening/.test(part))) { if (h < 12) h += 12; }
  else if (mer === 'am' || (part && /manana|morning/.test(part))) { if (h === 12) h = 0; }
  else if (h >= 1 && h <= 6) h += 12; // "at 3" on a work day means the afternoon
  return `${pad(h)}:${pad(minute)}`;
}
const PART = '(?:\\s+(?:de la|por la|en la|in the)\\s+(manana|tarde|noche|morning|afternoon|evening))?';
const AT = '(?:\\b(?:at|a las|a la)\\s+|@\\s*)';

/** Finds a time (10am, 10:30, at 3, a las 3 de la tarde, noon), removes it and returns it as HH:MM. */
export function takeTime(w: Work): string | undefined {
  let hit = w.take(new RegExp(`${AT}?\\b(\\d{1,2}):(\\d{2})\\s*(a\\.?\\s?m\\.?|p\\.?\\s?m\\.?)?(?![a-z0-9])${PART}`));
  if (hit) return clock(Number(hit.m[1]), Number(hit.m[2]), hit.m[3], hit.m[4]);
  hit = w.take(new RegExp(`${AT}?\\b(\\d{1,2})\\s*(a\\.?\\s?m\\.?|p\\.?\\s?m\\.?)(?![a-z0-9])`));
  if (hit) return clock(Number(hit.m[1]), 0, hit.m[2], undefined);
  hit = w.take(new RegExp(`${AT}(\\d{1,2})\\b(?![/:.\\d])${PART}`));
  if (hit) return clock(Number(hit.m[1]), 0, undefined, hit.m[2]);
  hit = w.take(/\b(?:at\s+|al\s+|a\s+)?(noon|midday|mediodia|medio dia)\b/);
  if (hit) return '12:00';
  w.take(/\b(?:de la|por la|en la|in the)\s+(?:manana|tarde|noche|morning|afternoon|evening)\b/);
  return undefined;
}

/* ---------- money and phone ---------- */
/** Finds an amount ($1,250.50, 500 dollars, 2k), removes it and returns it. Prefers one written with a dollar sign. */
export function takeAmount(w: Work): number | null {
  const hit = w.take(/\$\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(k\b)?/)
    ?? w.take(/\b(\d[\d,]*(?:\.\d{1,2})?)\s*(k\b)?\s*(?:dollars?|dolares?|usd|bucks)\b/)
    ?? w.take(/\b(?:of|de|por)\s+(\d[\d,]*(?:\.\d{1,2})?)\s*(k\b)?(?![\d/:])/)
    ?? w.take(/\b(\d[\d,]*(?:\.\d{1,2})?)\s*(k\b)?(?![\d/:])/);
  if (!hit) return null;
  const n = parseMoney(hit.m[1]);
  return n === null ? null : Math.round((hit.m[2] ? n * 1000 : n) * 100) / 100;
}

/** Finds a US phone number, removes it (and a leading "phone", "tel", "cel") and returns it as typed. */
export function takePhone(w: Work): string | undefined {
  const m = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/.exec(w.norm);
  if (!m || (m.index > 0 && /\d/.test(w.norm[m.index - 1]))) return undefined;
  const phone = w.slice(m.index, m.index + m[0].length).trim();
  const pre = /(?:\b(?:phone|tel|telefono|cel|celular|movil|numero|number|at|al)\b[\s:.#]*)+$/.exec(w.norm.slice(0, m.index));
  w.cut(pre ? pre.index : m.index, m.index + m[0].length);
  return phone;
}

/* ---------- finding a record by name ---------- */
const STOP = new Set(('the a an of for to from on in at with by and or my our me i we you it its is are was be do does did has have please this that these those there here ' +
  'job jobs project projects client clients customer customers lead leads task tasks payment payments note notes visit visits status about going doing how what which who ' +
  'el la los las un una unos unas de del para por al en con y o mi mis nuestro nuestra su sus se le les lo que es son esta este estos estas hay favor ' +
  'cliente clientes prospecto prospectos tarea tareas trabajo trabajos proyecto proyectos servicio servicios pago pagos nota notas visita visitas estado sobre como va van cual quien').split(' '));

export function words(s: string, extraStop?: Set<string>): string[] {
  return fold(s).split(/[^a-z0-9]+/).filter((x) => x && (x.length > 1 || /\d/.test(x)) && !STOP.has(x) && !(extraStop && extraStop.has(x)));
}
const flat = (s: string) => ' ' + fold(s).replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
const same = (q: string, r: string) => q === r || (q.length >= 4 && r.startsWith(q)) || (r.length >= 4 && q.startsWith(r) && q.length - r.length <= 2);

export interface Candidate<T> { rec: T; /** The record's own name. */ name: string; /** Other words that identify it, at half weight (the client of a job, a ticket number). */ also?: string; /** Small nudge when the request names this kind of record. */ boost?: number }
export interface Hit<T> { rec: T; score: number; /** Share of the typed words that belong to this record. */ precision: number }

/** Ranks records by how well their name matches the typed words. Best first; records that share no word are left out. */
export function rank<T>(query: string, list: Candidate<T>[], extraStop?: Set<string>): Hit<T>[] {
  const q = [...new Set(words(query, extraStop))];
  const qFlat = flat(query);
  const hits: Hit<T>[] = [];
  for (const c of list) {
    const own = words(c.name, extraStop); const also = c.also ? words(c.also, extraStop) : [];
    const inOwn = q.filter((x) => own.some((r) => same(x, r)));
    const inAlso = q.filter((x) => !inOwn.includes(x) && also.some((r) => same(x, r)));
    let score = inOwn.length + 0.5 * inAlso.length;
    const whole = flat(c.name);
    if (whole.trim() && qFlat.includes(whole)) score += 2; // the whole name was typed
    if (score <= 0) continue;
    if (own.length) score += 0.2 * (inOwn.length / own.length);
    score += c.boost ?? 0;
    hits.push({ rec: c.rec, score, precision: q.length ? (inOwn.length + inAlso.length) / q.length : 1 });
  }
  return hits.sort((a, b) => b.score - a.score);
}
/** One clear winner, several equally good ones, or nothing. */
export function best<T>(hits: Hit<T>[]): { one?: T; many?: T[] } {
  if (!hits.length) return {};
  const top = hits.filter((h) => h.score >= hits[0].score - 0.001);
  return top.length === 1 ? { one: top[0].rec } : { many: top.slice(0, 5).map((h) => h.rec) };
}
export const isoToDate = parseDate;
