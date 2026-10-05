// What the calendar shows: the events derived from leads, jobs and tasks, plus booked appointments where the edition has
// the appointments screen. An edition without it gets exactly the list it always had.
import type { Appointment, DemoState, Lang } from '@/domain/types';
import { calendarEvents } from '@/domain/selectors';
import { holdsSlot, isCancelled, personOf } from '@/domain/actions/appointments';
import { pick } from '@/i18n';
import type { CalItem } from './gcal';

/**
 * `appointments` is the list the viewer may see, or null when the edition has no appointments screen (or the viewer may
 * not open it). With appointments, a lead's own appointment date is drawn the same way as a booking, so there is one kind
 * of thing called an appointment on the calendar; when the lead's date already has a booking behind it, only the booking shows.
 */
export function calendarItems(d: DemoState, horizonDays: number, appointments: Appointment[] | null, lang: Lang): CalItem[] {
  const base: CalItem[] = calendarEvents(d, horizonDays);
  if (!appointments) return base;
  // cancelled ones are off the calendar; that includes the record of the earlier slot of an appointment that was moved
  const on = appointments.filter((a) => !isCancelled(a));
  const booked = new Set(on.filter((a) => a.leadId && holdsSlot(a)).map((a) => `${a.leadId}|${a.date}`));
  const out: CalItem[] = base.filter((e) => !(e.kind === 'appt' && booked.has(`${e.ref.id}|${e.date}`))).map((e) => (e.kind === 'appt' ? { ...e, kind: 'meet' as const } : e));
  for (const a of on) {
    const type = d.apptTypes.find((x) => x.id === a.typeId); const who = personOf(d, a);
    out.push({
      id: 'ev-m-' + a.id, date: a.date, time: a.time, kind: 'meet', title: who?.name ?? (type ? pick(type.name, lang) : ''),
      sub: [type ? pick(type.name, lang) : '', d.users.find((u) => u.id === a.staffId)?.name.split(' ')[0]].filter(Boolean).join(' · '),
      ref: { type: 'appointment', id: a.id }, address: a.location, done: a.status === 'completed' || a.status === 'no_show', appt: a,
    });
  }
  return out.sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
}
