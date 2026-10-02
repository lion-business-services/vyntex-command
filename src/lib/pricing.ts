// Single gateway to the commercial source of truth (config/vyntex-build-pricing.json).
// Nothing else in the app may hard-code a price, a plan name, an allowance or a rule.
import raw from '../../config/vyntex-build-pricing.json';
import type { IndustryId, Lang } from '@/domain/types';

export type PlanTier = 0 | 1 | 2;
export interface WelcomeCredit { amount_usd: number; applies_to: string; expires_days: number; excludes?: string; yearly_plan_condition?: string }
export interface Plan {
  /** Position in the ladder: 0 entry, 1 middle, 2 top. */
  tier: PlanTier;
  id: string;
  name: string;
  nameEs: string;
  mostPopular: boolean;
  monthly: number;
  yearly: number;
  /** Months free on yearly billing compared with paying monthly. */
  yearlyFreeMonths: number;
  setup: number;
  users: number | 'unlimited';
  welcomeCredit: WelcomeCredit | null;
  features: string[];
  support: string;
}
export interface AddOn { id: string; name: string; priceUsd: number | null; priceNote: string | null; billing: string | null; availableWith: string | null; status: string | null }

interface RawPlan { id: string; name: string; name_es: string; most_popular?: boolean; monthly_usd: number; yearly_usd: number; yearly_free_months?: number; setup_usd: number; users?: number | 'unlimited'; welcome_credit?: WelcomeCredit | null; features?: string[]; support?: string; same_features_as?: string }
const src = raw as unknown as { product: string; owner: string; version: string; plans: RawPlan[]; add_ons: any[]; rules: string[]; other_industries: { products: string[]; plans: RawPlan[] } };

const base: Plan[] = src.plans.map((p, i) => ({
  tier: i as PlanTier, id: p.id, name: p.name, nameEs: p.name_es, mostPopular: !!p.most_popular,
  monthly: p.monthly_usd, yearly: p.yearly_usd, yearlyFreeMonths: p.yearly_free_months ?? 0, setup: p.setup_usd,
  users: p.users ?? 1, welcomeCredit: p.welcome_credit ?? null, features: p.features ?? [], support: p.support ?? '',
}));

/** Other industries reuse the VYNTEX BUILD plans under their own plan names (Essential / Pro / Elite). */
const other: Plan[] = src.other_industries.plans.map((p) => {
  const twin = base.find((b) => b.id === p.same_features_as)!;
  return { ...twin, id: p.id, name: p.name, nameEs: p.name_es, mostPopular: !!p.most_popular, monthly: p.monthly_usd, yearly: p.yearly_usd, setup: p.setup_usd };
});

export const PRICING_VERSION = src.version;
export const PRICING_RULES: readonly string[] = src.rules;
export function plansFor(industry: IndustryId): Plan[] { return industry === 'build' ? base : other; }
export function planByTier(industry: IndustryId, tier: PlanTier): Plan { return plansFor(industry)[tier]; }
export const planName = (p: Plan, lang: Lang) => (lang === 'es' ? p.nameEs : p.name);
/** What 12 monthly payments cost, to compare with the yearly price. */
export const yearlySavings = (p: Plan) => p.monthly * 12 - p.yearly;

export const ADD_ONS: AddOn[] = src.add_ons.map((a) => ({
  id: a.id, name: a.name, priceUsd: typeof a.price_usd === 'number' ? a.price_usd : null, priceNote: a.price ?? null,
  billing: a.billing ?? null, availableWith: a.available_with ?? null, status: a.status ?? null,
}));
export const addOn = (id: string) => ADD_ONS.find((a) => a.id === id)!;
