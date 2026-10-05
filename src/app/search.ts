// What the command palette can find. One provider per kind of record; the palette asks each in turn and shows the hits
// under the provider's heading. A module adds its records by filling the `search.ts` in its own folder: the entries below
// already import those files, so this file does not change when a module is built.
import type { ModuleId } from '@/domain/types';
import type { Permission } from '@/domain/permissions';
import { moduleOn } from '@/domain/config';
import { visibleClientIds, visibleClients, visibleLeads } from '@/domain/access';
import { assigneeName, byId } from '@/domain/selectors';
import type { App } from './hooks';
import { search as appointments } from '@/features/appointments/search';
import { search as catalog } from '@/features/catalog/search';
import { search as opportunities } from '@/features/opportunities/search';
import { search as deadlines } from '@/features/deadlines/search';
import { search as esign } from '@/features/esign/search';

export interface SearchHit {
  id: string;
  title: string;
  sub?: string;
  /** Address inside the workspace, e.g. `/clients/c1`. */
  to: string;
}
/** True when any of the values contains what was typed. */
export type Matcher = (...values: (string | undefined)[]) => boolean;
export interface SearchProvider {
  id: string;
  /** Heading of the group, a dictionary key. */
  groupKey: string;
  /** Capability the viewer needs for these records to be searched at all. */
  perm?: Permission;
  /** Searched only where this module exists. */
  module?: ModuleId;
  when?: (app: App) => boolean;
  /** Most hits to show. Default 6. */
  max?: number;
  find: (app: App, has: Matcher, q: string) => SearchHit[];
}

const core: SearchProvider[] = [
  { id: 'leads', groupKey: 'search.leads', perm: 'leads', module: 'leads',
    find: (app, has) => visibleLeads(app.data, app.user, app.perms).filter((l) => has(l.name, l.phone, l.email, l.address, l.ticket, l.company))
      .map((l) => ({ id: l.id, title: l.name, sub: `${l.ticket} · ${app.t('ls_' + l.status)}`, to: `/leads/${l.id}` })) },
  // office scoping applies to search as it does to the list: a client of another office is not found
  { id: 'clients', groupKey: 'search.clients', perm: 'clients', module: 'clients',
    find: (app, has) => visibleClients(app.data, app.user, app.perms).filter((c) => has(c.name, c.phone, c.email, c.company, ...c.addresses))
      .map((c) => ({ id: c.id, title: c.name, sub: c.company || c.phone || c.email, to: `/clients/${c.id}` })) },
  { id: 'jobs', groupKey: 'search.jobs', perm: 'jobs', module: 'jobs',
    find: (app, has) => { const mine = visibleClientIds(app.data, app.user, app.perms); return app.data.jobs.filter((j) => mine.has(j.clientId) && has(j.name, j.address, j.number, byId(app.data.clients, j.clientId)?.name))
      .map((j) => ({ id: j.id, title: j.name, sub: `${byId(app.data.clients, j.clientId)?.name ?? ''} · ${app.t('st_' + j.status)}`, to: `/jobs/${j.id}` })); } },
  { id: 'tasks', groupKey: 'search.tasks', perm: 'tasks', module: 'tasks',
    find: (app, has) => app.data.tasks.filter((x) => has(x.title, x.description))
      .map((x) => ({ id: x.id, title: x.title, sub: `${assigneeName(app.data, x.assignee)} · ${app.t('ts.' + x.status)}`, to: `/tasks?task=${x.id}` })) },
  { id: 'workers', groupKey: 'search.workers', perm: 'team', module: 'team', when: (app) => app.pack.usesWorkers,
    find: (app, has) => app.data.workers.filter((w) => has(w.name, w.trade, w.phone, w.email)).map((w) => ({ id: w.id, title: w.name, sub: w.trade, to: `/team/${w.id}` })) },
  { id: 'docs', groupKey: 'search.docs', perm: 'documents', module: 'documents',
    find: (app, has) => { const mine = visibleClientIds(app.data, app.user, app.perms); return app.data.docs.filter((d) => mine.has(d.clientId) && has(d.title, d.number, byId(app.data.clients, d.clientId)?.name))
      .map((d) => ({ id: d.id, title: `${app.t('doc.kind.' + d.kind)} ${d.number}`, sub: `${d.title} · ${app.t('doc.status.' + d.status)}`, to: `/documents/${d.id}` })); } },
];

/** Every provider, in the order the groups appear. */
export const SEARCH_PROVIDERS: SearchProvider[] = [...core, ...appointments, ...catalog, ...opportunities, ...deadlines, ...esign];

/** Runs what was typed against every provider the viewer may use. Groups without a hit are left out. */
export function searchAll(app: App, q: string): { key: string; hits: SearchHit[] }[] {
  const s = q.trim().toLowerCase();
  if (s.length < 2) return [];
  const has: Matcher = (...v) => v.some((x) => !!x && x.toLowerCase().includes(s));
  const out: { key: string; hits: SearchHit[] }[] = [];
  for (const p of SEARCH_PROVIDERS) {
    if (p.perm && !app.can(p.perm)) continue;
    if (p.module && !moduleOn(app.data, app.pack, p.module)) continue;
    if (p.when && !p.when(app)) continue;
    const hits = p.find(app, has, s).slice(0, p.max ?? 6);
    if (hits.length) out.push({ key: p.groupKey, hits });
  }
  return out;
}
