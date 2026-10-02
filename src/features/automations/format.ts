// How an automation step is worded for display. Shared by the Automations page and the dashboard.
import type { TFn } from '@/i18n';
import type { AutomationRun } from '@/domain/types';
import { money } from '@/lib/money';

type Step = AutomationRun['steps'][number];

/** Step text in the viewer's language. Amounts and dates are stored raw and formatted here. */
export function stepText(step: Step, t: TFn, date: (d: string | undefined) => string): string {
  if (!step.params) return t(step.key);
  const p: Record<string, string | number> = { ...step.params };
  if (typeof p.amount === 'number') p.amount = money(p.amount);
  if (typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date)) p.date = date(p.date);
  return t(step.key, p);
}

/** A rule line with the industry word in it. English needs "an" before a vowel ("An event is marked as completed"). */
export function ruleLine(key: string, t: TFn, lang: string): string {
  const s = t(key);
  return lang === 'en' ? s.replace(/\b([Aa]) (?=[aeiouAEIOU])/g, '$1n ') : s;
}

/** Display name of a rule, with a safe fallback when a saved run points at a rule that no longer exists. */
export function ruleName(ruleId: string, t: TFn): string {
  const k = `auto.${ruleId}.name`;
  const s = t(k);
  return s === k ? t('common.automation') : s;
}
