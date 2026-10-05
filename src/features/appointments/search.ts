// How the command palette finds appointments: by the person, the type, the team member or a word in the notes.
// What is still ahead comes first. The office rule applies here as it does on the list.
import type { SearchProvider } from '@/app/search';
import { pick } from '@/i18n';
import { isOpenAppt, personOf, typeOfAppt, visibleAppointments, wasMoved } from '@/domain/actions/appointments';
import { byId } from '@/domain/selectors';

export const search: SearchProvider[] = [
  { id: 'appointments', groupKey: 'appointments.search.group', perm: 'appointments', module: 'appointments',
    find: (app, has) => {
      const { data } = app;
      return visibleAppointments(data, app.user, app.perms)
        .filter((a) => !wasMoved(data, a))
        .filter((a) => { const p = personOf(data, a); const type = typeOfAppt(data, a); return has(p?.name, p?.company, type ? pick(type.name, app.lang) : undefined, byId(data.users, a.staffId)?.name, a.notes); })
        .sort((a, b) => Number(isOpenAppt(b)) - Number(isOpenAppt(a)) || (isOpenAppt(a) ? (a.date + a.time).localeCompare(b.date + b.time) : (b.date + b.time).localeCompare(a.date + a.time)))
        .map((a) => {
          const type = typeOfAppt(data, a);
          return { id: a.id, title: `${personOf(data, a)?.name ?? ''} · ${type ? pick(type.name, app.lang) : ''}`, sub: `${app.day(a.date)}, ${app.time(a.time)} · ${app.t('appointments.st.' + a.status)}`, to: `/appointments/${a.id}` };
        });
    } },
];
