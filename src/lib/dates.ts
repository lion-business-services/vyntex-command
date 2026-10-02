import type { ISODate, ISODateTime, Lang } from '@/domain/types';

const pad = (n: number) => String(n).padStart(2, '0');
export const toISODate = (d: Date): ISODate => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = (): ISODate => toISODate(new Date());
/** Date n days from today (negative for the past). */
export function addDays(n: number): ISODate { const d = new Date(); d.setDate(d.getDate() + n); return toISODate(d); }
export function addDaysFrom(date: ISODate, n: number): ISODate { const [y, m, d] = date.split('-').map(Number); return toISODate(new Date(y, m - 1, d + n)); }
export function parseDate(date: ISODate): Date { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d); }
export const nowIso = (): ISODateTime => new Date().toISOString();
/** ISO timestamp n days from now at the given local hour, used by sample data. */
export function at(daysFromToday: number, hour = 10, minute = 0): ISODateTime { const d = new Date(); d.setDate(d.getDate() + daysFromToday); d.setHours(hour, minute, 0, 0); return d.toISOString(); }
export const daysBetween = (a: ISODate, b: ISODate) => Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000);

const locale = (lang: Lang) => (lang === 'es' ? 'es-US' : 'en-US');
export function fmtDate(date: ISODate | '' | undefined, lang: Lang, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }): string {
  if (!date) return '—';
  return parseDate(date).toLocaleDateString(locale(lang), opts);
}
export const fmtDay = (date: ISODate | '' | undefined, lang: Lang) => fmtDate(date, lang, { weekday: 'short', month: 'short', day: 'numeric' });
export function fmtDateTime(iso: ISODateTime | undefined, lang: Lang): string {
  if (!iso) return '—';
  const d = new Date(iso); if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(locale(lang), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
export function fmtTime(hhmm: string | undefined, lang: Lang): string {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(locale(lang), { hour: 'numeric', minute: '2-digit' });
}
export const monthLabel = (ym: string, lang: Lang) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString(locale(lang), { month: 'long', year: 'numeric' });
/** "3 days ago", "in 2 days", "today". */
export function relDay(date: ISODate, lang: Lang): string {
  const n = daysBetween(today(), date);
  return new Intl.RelativeTimeFormat(locale(lang), { numeric: 'auto' }).format(n, 'day');
}
