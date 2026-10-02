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

export const featureDicts: Dict[] = [dashboard, leads, clients, jobs, tasks, calendar, team, documents, payments, reports, automations, assistant, settings, portal, marketing, tour, messages, compliance, pricingCopy];
