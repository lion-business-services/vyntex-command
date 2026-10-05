// IF: whether the records an event came with satisfy a rule's conditions. Every condition has to hold (AND).
// A condition names a field from the catalogue (fields.ts), a comparison and, for most comparisons, a value.
import type { RuleCond, RuleDef } from '../types';
import { readField } from './fields';
import type { RuleSubject } from './engine';

const isEmpty = (v: unknown): boolean => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const text = (v: unknown): string => String(v ?? '').trim().toLowerCase();
const num = (v: unknown): number => (typeof v === 'number' ? v : v === '' || v === null || v === undefined ? NaN : Number(v));
/** A stored yes or no, however the builder or an import wrote it. */
const truthy = (v: unknown): boolean => v === true || v === 'true' || v === 'yes' || v === 1 || v === '1';

/** The value of a yes or no condition. A yes or no field that was never set reads as no. */
const yesNo = (v: unknown): boolean => typeof v === 'boolean' || v === 'true' || v === 'false';

/** Two single values are the same: numbers by value, yes and no by meaning, everything else as text without regard to case. */
function same(field: unknown, want: unknown): boolean {
  if (typeof field === 'boolean' || typeof want === 'boolean') return truthy(field) === truthy(want);
  if (typeof field === 'number' && isFinite(num(want))) return field === num(want);
  return text(field) === text(want);
}

/**
 * One condition against one set of records.
 *   is / is_not      equal, or not. On a list field: the list contains the value, or does not.
 *   in               the field is one of the listed values (a list field: shares at least one with them)
 *   gt / lt          greater than, less than; both sides must be numbers
 *   has              a list contains the value; a text contains it as a part
 *   empty / not_empty  nothing there (missing, blank or an empty list), or something
 * A field the event does not carry reads as empty: `empty` holds, `is_not` holds, `is no` holds for a yes or no field,
 * everything else does not.
 */
export function testCond(c: RuleCond, subject: RuleSubject): boolean {
  const v = readField(subject, c.field);
  switch (c.op) {
    case 'empty': return isEmpty(v);
    case 'not_empty': return !isEmpty(v);
    case 'is':
      if (Array.isArray(v)) return v.some((x) => same(x, c.value));
      if (yesNo(c.value)) return truthy(v) === truthy(c.value);
      return !isEmpty(v) && same(v, c.value);
    case 'is_not':
      if (Array.isArray(v)) return !v.some((x) => same(x, c.value));
      if (yesNo(c.value)) return truthy(v) !== truthy(c.value);
      return isEmpty(v) || !same(v, c.value);
    case 'in': {
      const list = Array.isArray(c.value) ? c.value : isEmpty(c.value) ? [] : [c.value];
      if (isEmpty(v)) return false;
      return Array.isArray(v) ? v.some((x) => list.some((w) => same(x, w))) : list.some((w) => same(v, w));
    }
    case 'gt': { const a = num(v), b = num(c.value); return isFinite(a) && isFinite(b) && a > b; }
    case 'lt': { const a = num(v), b = num(c.value); return isFinite(a) && isFinite(b) && a < b; }
    case 'has': {
      if (isEmpty(v) || isEmpty(c.value)) return false;
      return Array.isArray(v) ? v.some((x) => same(x, c.value)) : text(v).includes(text(c.value));
    }
    default: return false;
  }
}

/** True when every condition of the rule holds. A rule without conditions always matches. */
export const matches = (rule: Pick<RuleDef, 'if'>, subject: RuleSubject): boolean => (rule.if ?? []).every((c) => testCond(c, subject));
