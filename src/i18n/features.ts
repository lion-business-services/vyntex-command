// Every feature folder owns its wording. Register a new feature dictionary here.
import type { Dict } from './index';
import { dict as dashboard } from '@/features/dashboard/i18n';
import { dict as leads } from '@/features/leads/i18n';
import { dict as clients } from '@/features/clients/i18n';
import { dict as jobs } from '@/features/jobs/i18n';
import { dict as tasks } from '@/features/tasks/i18n';
import { dict as calendar } from '@/features/calendar/i18n';
import { dict as team } from '@/features/team/i18n';
import { dict as documents } from '@/features/documents/i18n';
import { dict as payments } from '@/features/payments/i18n';
import { dict as reports } from '@/features/reports/i18n';
import { dict as automations } from '@/features/automations/i18n';
import { dict as assistant } from '@/features/assistant/i18n';
import { dict as settings } from '@/features/settings/i18n';
import { dict as portal } from '@/features/portal/i18n';
import { dict as marketing } from '@/features/marketing/i18n';
import { dict as tour } from '@/features/tour/i18n';
import { dict as messages } from '@/features/messages/i18n';
import { dict as compliance } from '@/features/compliance/i18n';
import { dict as pricingCopy } from '@/lib/pricing-copy';
import { dict as marketingSections } from '@/features/marketing/sections/i18n';
import { dict as marketingPages } from '@/features/marketing/pages-i18n';

import { dict as appointments } from '@/features/appointments/i18n';
import { dict as catalog } from '@/features/catalog/i18n';
import { dict as opportunities } from '@/features/opportunities/i18n';
import { dict as reviews } from '@/features/reviews/i18n';
import { dict as esign } from '@/features/esign/i18n';
import { dict as integrations } from '@/features/integrations/i18n';
import { dict as social } from '@/features/social/i18n';
import { dict as cash } from '@/features/cash/i18n';
import { dict as payroll } from '@/features/payroll/i18n';
import { dict as bookkeeping } from '@/features/bookkeeping/i18n';
import { dict as licensing } from '@/features/licensing/i18n';
import { dict as deadlines } from '@/features/deadlines/i18n';
import { dict as security } from '@/features/security/i18n';
import { dict as audit } from '@/features/audit/i18n';
import { dict as auth } from '@/features/auth/i18n';
import { dict as publicPages } from '@/features/public/i18n';
import { dict as settingsLbs } from '@/features/settings/i18n-lbs';

// Read straight from the build constant so the bundler leaves the sales wording out of a deployment without sales pages.
declare const __VX_DEPLOY__: string | undefined;

/** Wording of the sales pages, the guided tour and the plans: only in a deployment that has them. */
const sales: Dict[] = (typeof __VX_DEPLOY__ !== 'undefined' && __VX_DEPLOY__ === 'lbs') ? [] : [marketing, tour, pricingCopy, marketingSections, marketingPages];

/** Lines that read differently in LBS Command. They come last, so they replace the shared line of the same key. */
const lbsOnly: Dict[] = (typeof __VX_DEPLOY__ !== 'undefined' && __VX_DEPLOY__ === 'lbs') ? [settingsLbs] : [];

export const featureDicts: Dict[] = [
  dashboard, leads, clients, jobs, tasks, calendar, team, documents, payments, reports, automations, assistant, settings, portal, messages, compliance,
  appointments, catalog, opportunities, reviews, esign, integrations, social, cash, payroll, bookkeeping, licensing, deadlines, security, audit, auth, publicPages,
  ...sales,
  ...lbsOnly,
];
