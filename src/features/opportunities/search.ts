// How the command palette finds opportunities: by the client or the suggested service. Only the ones still being worked,
// and only for clients the viewer may open.
import type { SearchProvider } from '@/app/search';
import { visibleClientIds } from '@/domain/access';
import { serviceName, serviceOf } from '@/domain/actions/catalog';
import { byId } from '@/domain/selectors';

export const search: SearchProvider[] = [
  { id: 'opportunities', groupKey: 'nav.opportunities', perm: 'opportunities', module: 'opportunities',
    find: (app, has) => {
      const mine = visibleClientIds(app.data, app.user, app.perms);
      return (app.data.opportunities ?? []).filter((o) => (o.status === 'open' || o.status === 'contacted') && mine.has(o.clientId)).flatMap((o) => {
        const c = byId(app.data.clients, o.clientId); const s = serviceOf(app.data, o.serviceId);
        const name = s ? serviceName(s, app.lang) : '';
        return c && has(c.name, c.company, name) ? [{ id: o.id, title: `${c.name} · ${name}`, sub: app.t('opportunities.is.' + o.status), to: `/opportunities/${o.id}` }] : [];
      });
    } },
];
