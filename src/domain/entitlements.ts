// What each capability costs the customer: included in a plan, a paid add-on, usage-based, or a custom quote.
// Every entry points at the exact line in the pricing file it comes from, and scripts/check-pricing.mjs fails the
// build if that line disappears. Capabilities the pricing file does not mention are marked `preview`, never "included".
import type { IndustryId } from './types';
import { ADD_ONS, isPriced, planByTier, type Plan, type PlanTier } from '@/lib/pricing';

export type Commercial =
  | { kind: 'plan'; tier: PlanTier; /** Exact feature text in the pricing file. */ source: string }
  | { kind: 'addon'; addOnId: string }
  | { kind: 'usage'; addOnId: string }
  | { kind: 'custom'; addOnId: string }
  | { kind: 'preview' };

export const ENTITLEMENTS = {
  core: { kind: 'plan', tier: 0, source: 'Every core feature: leads, jobs, subs, payments, tasks, calendar' },
  documents: { kind: 'plan', tier: 0, source: 'Contracts, invoices and 1099 report' },
  report1099: { kind: 'plan', tier: 0, source: 'Contracts, invoices and 1099 report' },
  calendarSend: { kind: 'plan', tier: 0, source: 'Google Calendar: send items (Add to Google)' },
  workerPortal: { kind: 'plan', tier: 1, source: 'Subcontractor portal' },
  complianceUploads: { kind: 'plan', tier: 1, source: 'W-9 and insurance uploads with alerts' },
  calendarSync: { kind: 'plan', tier: 1, source: 'Google Calendar: automatic two-way sync' },
  emailDocs: { kind: 'plan', tier: 1, source: 'Email contracts and invoices' },
  dailyReminder: { kind: 'plan', tier: 1, source: 'Daily morning reminder email' },
  clientEmails: { kind: 'plan', tier: 1, source: 'Automatic client emails at every stage (each email on/off, plus per-client opt-out)' },
  profitReports: { kind: 'plan', tier: 2, source: 'Profit reports by job, type of work and month' },
  websiteLeads: { kind: 'plan', tier: 2, source: 'Website estimate form feeds Leads' },
  w9Collection: { kind: 'plan', tier: 2, source: 'W-9 collection done for them (up to 25 subs per year)' },
  prep1099Included: { kind: 'plan', tier: 2, source: '1099 preparation: first 10 forms per year free, then $15 each' },
  reviewCalls: { kind: 'plan', tier: 2, source: '2 business review calls per year' },
  emailTemplates: { kind: 'plan', tier: 2, source: 'Automatic client emails, with templates set up during setup' },
  clientPortal: { kind: 'custom', addOnId: 'client_portal' },
  extraUser: { kind: 'addon', addOnId: 'extra_user_foundation' },
  prep1099: { kind: 'addon', addOnId: '1099_prep' },
  efile1099: { kind: 'usage', addOnId: '1099_efile_mail' },
  training: { kind: 'addon', addOnId: 'training' },
  dataEntry: { kind: 'addon', addOnId: 'data_entry' },
  customWork: { kind: 'custom', addOnId: 'custom' },
  sms: { kind: 'usage', addOnId: 'sms' },
  /** Shown in the demo to illustrate direction. Not part of any current plan or add-on in the pricing file. */
  assistant: { kind: 'preview' },
  esignature: { kind: 'preview' },
  inbox: { kind: 'preview' },
} as const satisfies Record<string, Commercial>;

export type EntitlementId = keyof typeof ENTITLEMENTS;

export interface Standing {
  /**
   * included = part of the viewed plan; upgrade = part of a higher plan; the rest mirror the commercial kind.
   * none = plans do not apply here (an edition that is quoted, or a deployment that shows no plans): nothing is shown.
   */
  state: 'included' | 'upgrade' | 'addon' | 'usage' | 'custom' | 'preview' | 'none';
  /** Plan where the capability first appears, when it is plan-based. */
  plan?: Plan;
  addOnId?: string;
}

/** What every capability answers where plans do not apply. */
export const NO_PLANS: Standing = { state: 'none' };

/** How a capability stands for someone on the given plan of the given edition. */
export function standing(id: EntitlementId, industry: IndustryId, tier: PlanTier): Standing {
  if (!isPriced(industry)) return NO_PLANS;
  const e: Commercial = ENTITLEMENTS[id];
  if (e.kind === 'plan') return { state: tier >= e.tier ? 'included' : 'upgrade', plan: planByTier(industry, e.tier) };
  if (e.kind === 'preview') return { state: 'preview' };
  return { state: e.kind, addOnId: e.addOnId };
}
export const isIncluded = (id: EntitlementId, industry: IndustryId, tier: PlanTier) => standing(id, industry, tier).state === 'included';
export const addOnOf = (s: Standing) => ADD_ONS.find((a) => a.id === s.addOnId);
