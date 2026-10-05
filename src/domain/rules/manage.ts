// Changing a company's rules: switching one on or off, saving one from the builder, copying, resetting a shipped rule to
// how it shipped, deleting one the company made. The rules in force are the company's own list plus whatever the edition
// ships that the list does not hold yet; the first change writes the whole set into the company's list, so from then on
// what is saved is exactly what runs.
import type { DemoState, L10n, RuleDef } from '../types';
import type { Ctx } from '../context';
import type { IndustryPack } from '@/packs/types';
import { uid } from '@/lib/id';
import { cloneRule, effectiveRules, shippedRule } from './engine';
import { NO_VALUE, eventDef, fieldDef } from './fields';
import { stepProblem } from './steps';

/** The company's own copy of every rule in force. Shipped rules it did not hold yet are copied in, as shipped. */
function own(d: DemoState, pack: IndustryPack): RuleDef[] {
  const mine = d.rules ?? [];
  d.rules = effectiveRules(d, pack).map((r) => (mine.includes(r) ? r : cloneRule(r)));
  return d.rules;
}

export function setRuleActive(d: DemoState, ctx: Ctx, id: string, on: boolean): boolean {
  const rule = own(d, ctx.pack).find((r) => r.id === id); if (!rule) return false;
  rule.active = on;
  // the older switch is kept in step, so every screen that reads it agrees
  d.automation.enabled = { ...d.automation.enabled, [id]: on };
  return true;
}

export type RuleProblem = { what: 'name' } | { what: 'event' } | { what: 'step' } | { what: 'cond'; at: number } | { what: 'param'; at: number; param: string };
/** What stops a rule from being saved: no name, no step, a half-written condition, a step missing something it needs. Null when it is complete. */
export function ruleProblem(rule: RuleDef): RuleProblem | null {
  if (!rule.name?.en?.trim() && !rule.name?.es?.trim()) return { what: 'name' };
  const event = eventDef(rule.when?.event); if (!event) return { what: 'event' };
  if (!rule.then?.length) return { what: 'step' };
  for (let i = 0; i < (rule.if ?? []).length; i++) {
    const c = rule.if[i]; const def = fieldDef(event.id, c.field);
    const empty = c.value === undefined || c.value === '' || (Array.isArray(c.value) && !c.value.length);
    if (!def || !c.op || (!NO_VALUE.includes(c.op) && empty)) return { what: 'cond', at: i };
  }
  for (let i = 0; i < rule.then.length; i++) { const missing = stepProblem(rule.then[i], event.subjects); if (missing) return { what: 'param', at: i, param: missing }; }
  return null;
}

/** Saves a rule from the builder: a new one gets an id, an existing one is replaced. A shipped rule stays marked as shipped. */
export function saveRule(d: DemoState, ctx: Ctx, input: RuleDef): { ok: true; rule: RuleDef } | { ok: false; problem: RuleProblem } {
  const problem = ruleProblem(input); if (problem) return { ok: false, problem };
  const rules = own(d, ctx.pack);
  const name: L10n = { ...input.name, en: (input.name.en || input.name.es).trim(), es: (input.name.es || input.name.en).trim() };
  const at = input.id ? rules.findIndex((r) => r.id === input.id) : -1;
  const rule: RuleDef = { ...cloneRule(input), id: at >= 0 ? input.id : uid('rule'), name, ...(at >= 0 && rules[at].shipped ? { shipped: true } : { shipped: undefined }) };
  if (!rule.shipped) delete rule.shipped;
  if (!rule.about?.en?.trim() && !rule.about?.es?.trim()) delete rule.about;
  if (at >= 0) rules[at] = rule; else rules.push(rule);
  d.rules = [...rules];
  d.automation.enabled = { ...d.automation.enabled, [rule.id]: rule.active !== false };
  return { ok: true, rule };
}

/** A copy the company owns, switched off so it does nothing until someone has looked at it. A coded rule cannot be copied. */
export function duplicateRule(d: DemoState, ctx: Ctx, id: string, name: L10n): RuleDef | null {
  const rules = own(d, ctx.pack); const from = rules.find((r) => r.id === id);
  if (!from || from.then.some((s) => s.do === 'builtin')) return null;
  const copy: RuleDef = { ...cloneRule(from), id: uid('rule'), name, active: false };
  delete copy.shipped;
  d.rules = [...rules, copy];
  d.automation.enabled = { ...d.automation.enabled, [copy.id]: false };
  return copy;
}

/** Puts a shipped rule back exactly as the edition ships it, including whether it starts on. */
export function resetRule(d: DemoState, ctx: Ctx, id: string): RuleDef | null {
  const was = shippedRule(ctx.pack, id); if (!was) return null;
  const rules = own(d, ctx.pack); const at = rules.findIndex((r) => r.id === id);
  const fresh = cloneRule(was);
  if (at >= 0) rules[at] = fresh; else rules.push(fresh);
  d.rules = [...rules];
  const { [id]: _gone, ...rest } = d.automation.enabled; d.automation.enabled = rest;
  return fresh;
}

/** Deletes a rule the company made. A shipped rule is switched off instead: it cannot be deleted. */
export function deleteRule(d: DemoState, ctx: Ctx, id: string): boolean {
  const rules = own(d, ctx.pack); const rule = rules.find((r) => r.id === id);
  if (!rule || rule.shipped || shippedRule(ctx.pack, id)) return false;
  d.rules = rules.filter((r) => r.id !== id);
  const { [id]: _gone, ...rest } = d.automation.enabled; d.automation.enabled = rest;
  return true;
}
