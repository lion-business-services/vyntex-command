// Small helpers shared by the parts of the practice sample business.
// Every date is a day offset from today (negative = past), so the sample always looks current.
import type { ISODate, ISODateTime, Lang, Note, NoteKind } from '@/domain/types';
import { addDays, at } from '@/lib/dates';

/** Picks the wording for the language the sample is viewed in. */
export const txFor = (lang: Lang) => (en: string, es: string): string => (lang === 'es' ? es : en);
/** Date n days from today. */
export const day = (n: number): ISODate => addDays(n);
/** Timestamp n days from today at an hour of the working day, never in the future. */
export function stamp(n: number, hour = 10, minute = 0): ISODateTime {
  const iso = at(n, hour, minute); const now = new Date(Date.now() - 5 * 60000).toISOString();
  return iso > now ? now : iso;
}
/** Notes, oldest first: [days, kind, text]. The first one is pinned. */
export const notes = (owner: string, by: string, list: [number, NoteKind, string][]): Note[] =>
  list.map(([n, kind, text], i) => ({ id: `${owner}-n${i + 1}`, at: stamp(n, 9 + (i % 7), 15), kind, text, pin: i === 0 || undefined, by })).reverse();
