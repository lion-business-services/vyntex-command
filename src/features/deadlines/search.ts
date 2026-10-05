// How the command palette finds deadlines (see src/app/search.ts). A deadline of a client the person may not open is not found.
import type { SearchProvider } from '@/app/search';
import { visibleClientIds } from '@/domain/access';
import { byId } from '@/domain/selectors';

export const search: SearchProvider[] = [
  { id: 'deadlines', groupKey: 'search.deadlines', perm: 'deadlines', module: 'deadlines',
    find: (app, has) => { const mine = visibleClientIds(app.data, app.user, app.perms); return app.data.complianceItems.filter((i) => (!i.clientId || mine.has(i.clientId)) && has(i.title, i.authority, byId(app.data.clients, i.clientId)?.name, byId(app.data.clients, i.clientId)?.company))
      .sort((a, b) => Number(a.status !== 'open') - Number(b.status !== 'open') || a.due.localeCompare(b.due))
      .map((i) => ({ id: i.id, title: i.title, sub: `${app.date(i.due)} · ${byId(app.data.clients, i.clientId)?.name ?? app.t('deadlines.firm')}`, to: `/deadlines/${i.id}` })); } },
];
