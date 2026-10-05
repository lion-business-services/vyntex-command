// Starter messages for writing to a client, and the small helpers both Messages and Documents use to word an email.
// Every starter is a service message (confirming, following up, reminding, thanking). None of them is marketing.
// A company's own templates are kept in its communications settings (src/domain/actions/messages.ts) and use
// {{merge.fields}}; `starterAsTemplate` turns a starter into one of those so the company can edit it.
import type { Client, Company, Job } from '@/domain/types';
import type { TFn } from '@/i18n';
import type { MessageTemplate, SendChannel } from '@/domain/actions/messages';

const ORG = /\b(family|familia|llc|inc|corp|co|group|grupo|company|properties|property|dental|plaza|hoa|association|restaurant|office|center|shop|store|cafe|coffee|club|management|realty|services?|builders|church|school)\b|[&0-9]/i;
/** How to greet someone: the first name for a person, the full name for a family or a business. */
export function greetName(name: string): string {
  const n = (name || '').trim();
  return ORG.test(n) ? n : n.split(/\s+/)[0] || n;
}

/** Starter emails. */
export const TEMPLATES = ['appt', 'estimate', 'payment', 'thanks'] as const;
/** Starter texts: short, and they say how to stop them. Used for text messages and WhatsApp. */
export const TEXT_TEMPLATES = ['remind', 'docs'] as const;
export type TemplateId = (typeof TEMPLATES)[number] | (typeof TEXT_TEMPLATES)[number];
const isText = (id: TemplateId): boolean => (TEXT_TEMPLATES as readonly string[]).includes(id);
/** The starters that fit a channel. Facebook and Instagram replies are written by hand. */
export const startersFor = (channel: SendChannel): readonly TemplateId[] => (channel === 'email' ? TEMPLATES : channel === 'text' || channel === 'whatsapp' ? TEXT_TEMPLATES : []);

export interface TemplateInput { client?: Pick<Client, 'name' | 'addresses'>; job?: Job; company: Company; /** Formatted date of the visit or appointment, when there is one. */ when?: string; /** Formatted balance, when there is one to mention. */ amount?: string }

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
  return { subject: isText(id) ? '' : mt(`messages.tpl.${id}.subject`, p), body: mt(body, p) };
}

/** A starter as a template the company owns: the same wording in both languages, with merge fields where the names go. */
export function starterAsTemplate(id: TemplateId, en: TFn, es: TFn, newId: string, channel: MessageTemplate['channel']): MessageTemplate {
  const p = { name: '{{client.first}}', company: '{{company.name}}', phone: '{{company.phone}}', jobName: '{{job.name}}', address: '__________', when: '{{appointment.date}}', amount: '' };
  const text = (mt: TFn) => ({ subject: isText(id) ? '' : mt(`messages.tpl.${id}.subject`, p), body: mt(id === 'payment' ? 'messages.tpl.payment.bodyNoAmount' : `messages.tpl.${id}.body`, p) });
  const a = text(en), b = text(es);
  return { id: newId, name: en('messages.tpl.' + id), channel, purpose: 'service', subject: { en: a.subject, es: b.subject }, body: { en: a.body, es: b.body }, active: true };
}
