// Ready-to-show pricing lines for the selected industry and language. Pages use these instead of reading the pricing file directly,
// so a plan, an add-on or a rule reads the same on the sales pages, in Settings and in the plan badges.
import type { IndustryId, Lang } from '@/domain/types';
import type { TFn } from '@/i18n';
import { ADD_ONS, PRICING_RULES, addOn, planByTier, planName, plansFor, type AddOn, type Plan } from './pricing';
import { addOnCopy, pricingKey, RULE_COPY } from './pricing-copy';
import { money } from './money';

function names(industry: IndustryId, lang: Lang) {
  const [entry, mid, top] = plansFor(industry).map((p) => planName(p, lang));
  return { entry, mid, top, prep: money(addOn('1099_prep').priceUsd), efile: money(addOn('1099_efile_mail').priceUsd) };
}
const line = (source: string, t: TFn, params: Record<string, string | number>) => { const k = pricingKey(source); return k ? t(k, params) : source; };

/** The feature list of a plan, worded for the industry and language. */
export function planFeatures(plan: Plan, industry: IndustryId, lang: Lang, t: TFn): string[] {
  const n = names(industry, lang);
  const below = plan.tier > 0 ? planName(planByTier(industry, (plan.tier - 1) as 0 | 1), lang) : '';
  return plan.features.map((f) => line(f, t, { ...n, below }));
}
export const planSupport = (plan: Plan, industry: IndustryId, lang: Lang, t: TFn) => line(plan.support, t, names(industry, lang));
export const planUsers = (plan: Plan) => plan.users;

export interface AddOnView { id: string; name: string; /** Formatted price, or null when it is quoted or usage-based. */ price: string | null; billing: string | null; note: string | null; kind: 'addon' | 'usage' | 'custom'; /** True when the pricing file says it does not exist yet. */ notBuilt: boolean }
export function addOnView(a: AddOn, industry: IndustryId, lang: Lang, t: TFn): AddOnView {
  const n = names(industry, lang); const c = addOnCopy(a.id);
  const has = (k: string) => t(k) !== k;
  return {
    id: a.id, name: c ? t(c.key, n) : a.name, price: a.priceUsd !== null ? money(a.priceUsd) : null,
    billing: c && has(c.key + '.billing') ? t(c.key + '.billing', n) : a.billing, note: c && has(c.key + '.note') ? t(c.key + '.note', n) : a.priceNote,
    kind: a.id === 'sms' ? 'usage' : a.priceUsd === null ? 'custom' : a.id === '1099_efile_mail' ? 'usage' : 'addon',
    notBuilt: !!a.status && /not built/i.test(a.status),
  };
}
export const addOnViews = (industry: IndustryId, lang: Lang, t: TFn) => ADD_ONS.map((a) => addOnView(a, industry, lang, t));

/** The pricing rules customers should read, in the order of the pricing file. Internal instructions are left out. */
export function publicRules(industry: IndustryId, lang: Lang, t: TFn): string[] {
  const n = names(industry, lang);
  return PRICING_RULES.map((r) => { const c = RULE_COPY.find((x) => x.source === r); return c ? (c.internal ? '' : t(c.key, n)) : r; }).filter(Boolean);
}
