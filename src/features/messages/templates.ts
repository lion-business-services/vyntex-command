// Starter emails for writing to a client, and the small helpers both Messages and Documents use to word an email.
// Every template is a service email (confirming, following up, reminding, thanking). None of them is marketing.
import type { Client, Company, Job } from '@/domain/types';
import type { TFn } from '@/i18n';

const ORG = /\b(family|familia|llc|inc|corp|co|group|grupo|company|properties|property|dental|plaza|hoa|association|restaurant|office|center|shop|store|cafe|coffee|club|management|realty|services?|builders|church|school)\b|[&0-9]/i;
/** How to greet someone: the first name for a person, the full name for a family or a business. */
export function greetName(name: string): string {
  const n = (name || '').trim();
  return ORG.test(n) ? n : n.split(/\s+/)[0] || n;
}

export const TEMPLATES = ['appt', 'estimate', 'payment', 'thanks'] as const;
export type TemplateId = (typeof TEMPLATES)[number];

export interface TemplateInput { client?: Client; job?: Job; company: Company; /** Formatted date of the visit, when the job has one. */ when?: string; /** Formatted balance, when there is one to mention. */ amount?: string }

/** Fills a starter template in the language of `mt` with the client's name, the company and the job. */
export function fillTemplate(id: TemplateId, mt: TFn, x: TemplateInput): { subject: string; body: string } {
  const p = {
    name: greetName(x.client?.name ?? '') || mt('messages.tpl.there'),
    company: x.company.name, phone: x.company.phone,
    jobName: x.job?.name ?? mt('messages.tpl.yourService'),
    address: x.job?.address || x.client?.addresses[0] || '__________',
    when: x.when || '__________', amount: x.amount ?? '',
  };
  const body = id === 'payment' && !x.amount ? 'messages.tpl.payment.bodyNoAmount' : `messages.tpl.${id}.body`;
  return { subject: mt(`messages.tpl.${id}.subject`, p), body: mt(body, p) };
}
