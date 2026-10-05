// A rule as a person reads it: "When a new lead comes in, if the lead source is Website, then create a task for the
// owner and prepare an email for review." The same parts fill the rule card (When, Only if, Then) and the builder's preview.
// Everything is read from the rule's data and the field catalogue; nothing here knows a particular rule.
import type { DemoState, Lang, RuleCond, RuleDef, RuleStep } from '@/domain/types';
import type { IndustryPack } from '@/packs/types';
import type { TFn } from '@/i18n';
import { RULES } from '@/domain/automations';
import { eventDef, fieldDef } from '@/domain/rules/fields';
import { money } from '@/lib/money';
import { ruleLine } from './format';

export interface Reader { data: DemoState; pack: IndustryPack; t: TFn; lang: Lang }
export interface RuleText { when: string; conds: string[]; thens: string[]; sentence: string }

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
export const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "a", "a and b", "a, b and c". */
export const listOf = (items: string[], and: string): string => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}`);
/** Merge fields as a person reads them: `{{first_name}}` becomes [first name]. */
export const pretty = (text: string, t: TFn): string => text.replace(/\{\{\s*([a-z_.]+)\s*\}\}/gi, (_m, k: string) => { const key = 'auto.m.' + k.toLowerCase(); const label = t(key); return `[${label === key ? k : label}]`; });
const clip = (s: string, n = 90) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

/** The coded rule behind a shipped rule, when its one step is `builtin`. */
export const builtinOf = (rule: RuleDef) => { const step = rule.then.find((s) => s.do === 'builtin'); return step ? RULES.find((r) => r.id === String(step.params.rule ?? rule.id)) : undefined; };

/** The event as the words after "When". Counted events read with their number of days. */
export function eventText(event: string, days: number | undefined, r: Reader): string {
  const def = eventDef(event); const key = 'auto.ev.' + event; const has = (k: string) => r.t(k) !== k;
  if (!def?.days) return r.t(key);
  if (days === undefined && has(key + '.none')) return r.t(key + '.none');
  const n = days ?? def.days.default;
  if (n === 0 && has(key + '.zero')) return r.t(key + '.zero');
  if (n === 1 && has(key + '.one')) return r.t(key + '.one');
  return r.t(key, { n });
}

const MONEY = /(price|value|amount|fee|balance)$/;
/** One condition: "the lead source is Website". */
export function condText(event: string, c: RuleCond, r: Reader): string {
  const def = fieldDef(event, c.field);
  const field = r.t('auto.f.' + c.field); const op = r.t('auto.op.' + c.op);
  if (c.op === 'empty' || c.op === 'not_empty') return `${field} ${op}`;
  const options = def?.options?.(r.data, r.pack, r.t, r.lang);
  const one = (v: unknown): string => {
    if (def?.type === 'bool' || typeof v === 'boolean') return r.t(v === true || v === 'true' ? 'auto.val.yes' : 'auto.val.no');
    if (options) return options.find((o) => o.id === String(v))?.label ?? (def?.type === 'list' && !def.options ? String(v) : r.t('auto.val.gone'));
    if (def?.type === 'number') return MONEY.test(c.field) ? money(Number(v)) : String(v);
    return `"${String(v ?? '')}"`;
  };
  // a yes or no field reads as a statement: "the client agreed to texts: yes"
  if (def?.type === 'bool') return `${field}: ${one(c.value)}`;
  const value = Array.isArray(c.value) ? listOf(c.value.map(one), r.t('auto.or')) : one(c.value);
  return `${field} ${op} ${value}`;
}

const say = (step: RuleStep, k: string, lang: Lang): string => String((lang === 'es' ? step.params[k + 'Es'] : undefined) || step.params[k] || '');
/** Who a step is for, in words. */
export function whoText(who: unknown, r: Reader): string {
  const w = String(who ?? 'owner');
  if (w.startsWith('user:')) return r.data.users.find((u) => u.id === w.slice(5))?.name ?? r.t('auto.who.gone');
  if (w === 'manager') return r.t('auto.who.manager', { role: lowerFirst(r.t('role.manager')) });
  return r.t(w === 'record_owner' || w === 'next' ? 'auto.who.' + w : 'auto.who.owner');
}
/** One step, as the words after "then". A coded rule answers with its own lines. */
export function stepTexts(rule: RuleDef, step: RuleStep, r: Reader): string[] {
  const { t, lang } = r; const p = step.params;
  switch (step.do) {
    case 'builtin': {
      const coded = RULES.find((x) => x.id === String(p.rule ?? rule.id));
      if (!coded) return [t('auto.do.builtin')];
      return Array.from({ length: coded.thens }, (_x, i) => lowerFirst(ruleLine(`auto.${coded.id}.then${i + 1}`, t, lang)));
    }
    case 'task': return [t('auto.do.task', { who: whoText(p.for, r), title: clip(pretty(say(step, 'title', lang), t)) })];
    case 'message': {
      const channel = t('auto.chA.' + (['email', 'text', 'whatsapp'].includes(String(p.channel)) ? p.channel : 'email'));
      return [t(p.mode === 'send' ? 'auto.do.message.send' : 'auto.do.message.draft', { channel, subject: clip(pretty(say(step, 'subject', lang) || say(step, 'body', lang), t), 70) })];
    }
    case 'notify': return [t('auto.do.notify', { who: whoText(p.who, r), text: clip(pretty(say(step, 'text', lang), t)) })];
    case 'assign': return [t('auto.do.assign', { who: whoText(p.to, r) })];
    case 'stage': return [t('auto.do.stage', { stage: p.stage ? t('ls_' + p.stage) : p.status ? t('st_' + p.status) : '' })];
    case 'document': return [t('auto.do.document', { doc: t('doc.kind.' + p.kind) })];
    case 'playbook': return [t('auto.do.playbook')];
    case 'opportunity': return [t('auto.do.opportunity', { service: (r.data.catalog ?? []).find((s) => s.id === p.serviceId)?.name ?? t('auto.val.gone') })];
    case 'review': return [t('auto.do.review', { channel: lowerFirst(t('auto.ch.' + (p.channel ?? 'email'))) })];
    case 'tag': return [t('auto.do.tag', { tag: String(p.tag ?? '') })];
    default: return [t('auto.do.other')];
  }
}

/** The rule in words. A shipped rule that runs a coded rule keeps the wording it has always had for its event and steps. */
export function ruleText(rule: RuleDef, r: Reader): RuleText {
  const { t } = r; const coded = builtinOf(rule);
  const when = coded && t(`auto.${coded.id}.when`) !== `auto.${coded.id}.when` ? ruleLine(`auto.${coded.id}.when`, t, r.lang) : capFirst(eventText(rule.when.event, rule.when.days, r));
  const conds = (rule.if ?? []).map((c) => condText(rule.when.event, c, r));
  const thens = rule.then.flatMap((s) => stepTexts(rule, s, r));
  const sentence = `${t('auto.sentence.when')} ${lowerFirst(when)}${conds.length ? `, ${t('auto.sentence.if')} ${listOf(conds, t('auto.and'))}` : ''}, ${t('auto.sentence.then')} ${listOf(thens, t('auto.and'))}.`;
  return { when, conds, thens: thens.map(capFirst), sentence };
}
