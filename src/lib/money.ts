// All money in the product is US dollars, stored as numbers and formatted only for display.
const whole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** $48,000 (no cents). Use for totals and KPIs. */
export const money = (n: number | null | undefined) => whole.format(Math.round(Number(n) || 0));
/** $1,250.50 (always two decimals). Use for payments and documents. */
export const money2 = (n: number | null | undefined) => cents.format(Number(n) || 0);
/** Parses what a person types ("$1,250.50", "1250", "(300)") into a number, or null when it is not a number. */
export function parseMoney(input: string | number | null | undefined): number | null {
  if (typeof input === 'number') return isFinite(input) ? Math.round(input * 100) / 100 : null;
  const s = String(input ?? '').trim(); if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s);
  const n = Number(s.replace(/[^0-9.]/g, ''));
  if (!isFinite(n) || !/[0-9]/.test(s)) return null;
  return Math.round((neg ? -n : n) * 100) / 100;
}
export const sum = <T,>(list: T[] | undefined, pick: (x: T) => number | null | undefined) => (list || []).reduce((a, x) => a + (Number(pick(x)) || 0), 0);
export const pct = (v: number) => `${Math.round(v * 100)}%`;
