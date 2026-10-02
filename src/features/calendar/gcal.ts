// "Add to Google": builds the address of Google Calendar's own new-event form, filled in.
// It is a plain link that opens in a new tab; nothing is connected and nothing is sent from here.
import type { DemoState } from '@/domain/types';
import type { CalEvent } from '@/domain/selectors';
import { assigneeName, byId } from '@/domain/selectors';
import type { TFn } from '@/i18n';
import { addDaysFrom } from '@/lib/dates';

export interface GoogleItem { date: string; time?: string; title: string; detail?: string; note?: string; where?: string }

const p2 = (n: number) => String(n).padStart(2, '0');
function timeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'; } catch { return 'America/New_York'; }
}

/** Same link the original demo built: timed items last one hour, items without a time are all-day. */
export function gcalUrl(e: GoogleItem): string {
  const d = e.date.replace(/-/g, ''); let dates: string;
  if (e.time) {
    const [h, m] = e.time.split(':').map(Number); const en = new Date(2000, 0, 1, h + 1, m);
    const endDay = h + 1 >= 24 ? addDaysFrom(e.date, 1).replace(/-/g, '') : d;
    dates = `${d}T${p2(h)}${p2(m)}00/${endDay}T${p2(en.getHours())}${p2(en.getMinutes())}00`;
  } else dates = `${d}/${addDaysFrom(e.date, 1).replace(/-/g, '')}`;
  const q = new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates, details: [e.detail, e.note].filter(Boolean).join('\n\n'), location: e.where || '', ctz: timeZone() });
  return 'https://calendar.google.com/calendar/render?' + q.toString();
}

export const kindLabel = (t: TFn, kind: CalEvent['kind']) => t(kind === 'visit' ? 'calendar.ev_visit' : 'ev_' + kind);

/** What goes into the Google event for a calendar item: title, place, who to call and the pinned notes. */
export function googleItem(s: DemoState, t: TFn, e: CalEvent): GoogleItem {
  const pinned = (notes: { pin?: boolean; text: string }[] | undefined) => (notes || []).filter((n) => n.pin).map((n) => n.text).join(' • ');
  if (e.ref.type === 'lead') {
    const l = byId(s.leads, e.ref.id);
    const detail = e.kind === 'appt' ? [l ? t('ty_' + l.type) : '', l?.phone].filter(Boolean).join(' · ') : l?.phone || '';
    return { date: e.date, time: e.time, title: `${kindLabel(t, e.kind)}: ${e.title}`, where: e.kind === 'appt' ? e.address : '', detail, note: pinned(l?.notes) };
  }
  if (e.ref.type === 'job') {
    const j = byId(s.jobs, e.ref.id);
    return { date: e.date, title: `${kindLabel(t, e.kind)}: ${e.sub ? e.sub + ', ' : ''}${e.title}`, where: e.address, detail: j?.number ?? '', note: pinned(j?.notes) };
  }
  const task = byId(s.tasks, e.ref.id); const j = byId(s.jobs, task?.jobId);
  const c = byId(s.clients, j?.clientId);
  return { date: e.date, title: e.title, where: j?.address, detail: [j ? `${c ? c.name + ', ' : ''}${j.name}` : '', assigneeName(s, task?.assignee)].filter(Boolean).join(' · '), note: task?.description };
}
