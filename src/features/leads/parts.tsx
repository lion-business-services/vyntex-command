// Small pieces shared by the lead list, the pipeline board and the lead page, so a next step or a waiting time reads the
// same wherever it appears.
import { useCallback } from 'react';
import { LuFlame, LuTriangleAlert } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { cx } from '@/ui';
import { relDay, toISODate } from '@/lib/dates';
import type { CatalogService, Lead } from '@/domain/types';
import { STALE_DAYS, type LeadSignals, type NextStep } from './model';

/** The words for a next step: what the person wrote, or the visit or follow-up date. */
export function useNextText() {
  const { t, day, time } = useApp();
  return (n: NextStep): string => {
    if (n.kind === 'action') return n.text ?? '';
    if (n.kind === 'appt') return t('leads.visitOn', { date: `${day(n.due)}${n.time ? ', ' + time(n.time) : ''}` });
    if (n.kind === 'follow') return t(n.late ? 'leads.followLate' : 'leads.followOn', { date: day(n.due) });
    return t('leads.noNext');
  };
}

/**
 * The next step of a lead in one or two short lines. A late one is red; a lead with nothing planned says so with a
 * warning mark, because a lead nobody plans to touch is a lead that gets lost. `plain` keeps the look the field editions
 * have always had: one quiet line.
 */
export function NextStepLine({ lead, signals, plain, compact }: { lead: Lead; signals: LeadSignals; plain?: boolean; compact?: boolean }) {
  const { t, day } = useApp();
  const text = useNextText();
  const n = signals.next;
  if (!signals.open) return null;
  if (n.kind === 'none') return plain ? <span className={cx(compact ? 'xs dim' : 'small')}>{text(n)}</span> : <span className={cx('leads-flag warn', compact ? 'xs' : 'small')} data-flag="no-next"><LuTriangleAlert aria-hidden="true" />{text(n)}</span>;
  if (n.kind !== 'action') return <span className={cx(compact ? 'xs' : 'small', n.late ? 'neg strong' : compact && 'dim')} data-flag={n.late ? 'overdue' : undefined}>{text(n)}</span>;
  return (
    <span className={cx('leads-nextline', compact ? 'xs' : 'small')} data-lead-next={lead.id}>
      <span className={cx(compact && 'dim')}>{n.text}</span>
      {n.due && <span className={cx('nowrap', n.late ? 'neg strong' : n.dueToday ? 'leads-today strong' : 'dim')} data-flag={n.late ? 'overdue' : undefined}>{n.late ? t('leads.next.overdue', { date: day(n.due) }) : n.dueToday ? t('leads.next.today') : t('leads.next.due', { date: day(n.due) })}</span>}
    </span>
  );
}

/** When the person was last contacted, in everyday words, and a mark when the lead has been waiting a week or more. */
export function ContactAge({ signals, compact }: { signals: LeadSignals; compact?: boolean }) {
  const { t, lang } = useApp();
  const when = signals.lastContact ? relDay(toISODate(new Date(signals.lastContact)), lang) : t('leads.contact.never');
  return (
    <span className={cx(compact ? 'xs' : 'small', signals.stale ? 'leads-flag warn' : 'muted')} data-flag={signals.stale ? 'stale' : undefined} title={signals.stale ? t('leads.contact.staleHint', { n: STALE_DAYS }) : undefined}>
      {signals.stale && <LuTriangleAlert aria-hidden="true" />}{when}
    </span>
  );
}

/** A small flame next to a lead that sits in a stage the company counts as close to a decision. */
export function HotMark({ signals }: { signals: LeadSignals }) {
  const { t } = useApp();
  return signals.hot ? <span className="leads-hot" title={t('leads.hot')}><LuFlame aria-hidden="true" /><span className="sr">{t('leads.hot')}</span></span> : null;
}

/** A catalog service in the viewer's language. */
export const serviceName = (s: CatalogService, lang: string): string => s.i18n?.[lang as 'en' | 'es' | 'zh']?.name ?? s.name;

/** The label of a lost reason: the company's wording when the reason is one from its list, the text as typed otherwise. */
export function useReasonLabel() {
  const { t } = useApp();
  return useCallback((reason: string | undefined): string => { if (!reason) return ''; const label = t('lr_' + reason); return label === 'lr_' + reason ? reason : label; }, [t]);
}
