// Money for the payment and accounting adapters: whole cents as integers, from the provider's answer to the database.
// No amount is ever held as a fraction in a JavaScript number, added as one, or rounded. A value that is not an exact
// number of cents is refused (null), never rounded to the nearest cent: a wrong cent in a ledger is worse than a
// payment a person has to look at.

/** True for an amount this code accepts: a whole number of cents that JavaScript can hold exactly. */
export const isCents = (n) => Number.isSafeInteger(n);

/**
 * A decimal amount ("12.34", "12.3", "12", 12.34) as cents. Null for anything that is not an exact amount with at
 * most two decimals. Numbers are read through their shortest text form, so 0.1 + 0.2 (0.30000000000000004) is refused.
 */
export function toCents(value) {
  const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : typeof value === 'string' ? value.trim() : '';
  const m = /^(-?)(\d{1,13})(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return null;
  const cents = Number(m[2]) * 100 + Number((m[3] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return null;
  return m[1] && cents !== 0 ? -cents : cents;
}

/** Cents as the decimal text an accounting system expects: 1234 -> "12.34". Throws on anything that is not whole cents. */
export function centsToDecimal(cents) {
  if (!isCents(cents)) throw new TypeError('not_cents');
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Square's Money object ({ amount: 1234, currency: "USD" }, amount already in the smallest unit) -> { cents, currency } or null. */
export function squareMoney(m) {
  if (!m || typeof m !== 'object') return null;
  const cents = typeof m.amount === 'number' ? m.amount : typeof m.amount === 'string' && /^-?\d{1,15}$/.test(m.amount) ? Number(m.amount) : NaN;
  const currency = typeof m.currency === 'string' && /^[A-Z]{3}$/.test(m.currency) ? m.currency : '';
  return isCents(cents) && currency ? { cents, currency } : null;
}

/** Adds whole cents. Throws when a value is not whole cents, so a mistake cannot pass quietly into a total. */
export function sumCents(list) {
  let total = 0;
  for (const n of list) { if (!isCents(n)) throw new TypeError('not_cents'); total += n; }
  if (!isCents(total)) throw new TypeError('not_cents');
  return total;
}
