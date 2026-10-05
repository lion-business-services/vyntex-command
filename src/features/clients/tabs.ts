// The tabs of a client's page. One list: a module adds its tab by replacing the `ClientTab.tsx` in its own folder; the
// entries here already point at those files, so this file does not change when a module is built.
// Field editions show the overview alone (everything on one page, as before). The professional-services edition shows the
// tabs, because a client there has much more on record.
import { lazy, type ComponentType } from 'react';
import type { Client, ModuleId } from '@/domain/types';
import type { Permission } from '@/domain/permissions';
import { moduleOn } from '@/domain/config';
import type { App } from '@/app/hooks';
import { today } from '@/lib/dates';

/** What every tab receives. `tabbed` is false when the tab is shown alone, as the whole page. */
export interface ClientTabProps { client: Client; tabbed: boolean }
export interface ClientTabDef {
  id: string;
  /** Tab label, a dictionary key. */
  labelKey: string;
  /** Capability the viewer needs to see the tab. */
  perm?: Permission;
  /** The tab exists only where this module does. */
  module?: ModuleId;
  /** Number shown on the tab. */
  count?: (app: App, client: Client) => number;
  /** The tab's content, loaded the first time the tab is opened. */
  view: ComponentType<ClientTabProps>;
}

export const CLIENT_TABS: ClientTabDef[] = [
  { id: 'overview', labelKey: 'clients.tab.overview', view: lazy(() => import('./Overview')) },
  { id: 'engagements', labelKey: 'nav.jobs', perm: 'jobs', module: 'jobs', count: (app, c) => app.data.jobs.filter((j) => j.clientId === c.id).length, view: lazy(() => import('@/features/jobs/ClientTab')) },
  // appointments still to come; past ones are on the tab, not in the number
  { id: 'appointments', labelKey: 'nav.appointments', perm: 'appointments', module: 'appointments', count: (app, c) => app.data.appointments.filter((a) => a.clientId === c.id && a.date >= today() && !a.status.startsWith('cancelled') && a.status !== 'completed' && a.status !== 'no_show').length, view: lazy(() => import('@/features/appointments/ClientTab')) },
  { id: 'tasks', labelKey: 'nav.tasks', perm: 'tasks', module: 'tasks', count: (app, c) => app.data.tasks.filter((x) => x.clientId === c.id && x.status !== 'done').length, view: lazy(() => import('@/features/tasks/ClientTab')) },
  { id: 'documents', labelKey: 'nav.documents', perm: 'documents', module: 'documents', count: (app, c) => app.data.docs.filter((d) => d.clientId === c.id).length, view: lazy(() => import('@/features/documents/ClientTab')) },
  { id: 'billing', labelKey: 'clients.tab.billing', perm: 'money', module: 'payments', view: lazy(() => import('@/features/payments/ClientTab')) },
  // the number on this tab is what nobody has opened yet, not the whole history
  { id: 'communications', labelKey: 'nav.messages', perm: 'comms', module: 'messages', count: (app, c) => app.data.messages.filter((m) => m.clientId === c.id && m.dir === 'in' && m.read === false).length, view: lazy(() => import('@/features/messages/ClientTab')) },
  { id: 'notes', labelKey: 'common.notes', count: (_app, c) => c.notes.length, view: lazy(() => import('./NotesTab')) },
  { id: 'opportunities', labelKey: 'nav.opportunities', perm: 'opportunities', module: 'opportunities', count: (app, c) => app.data.opportunities.filter((o) => o.clientId === c.id && o.status === 'open').length, view: lazy(() => import('@/features/opportunities/ClientTab')) },
  { id: 'activity', labelKey: 'common.activity', view: lazy(() => import('./ActivityTab')) },
  { id: 'secure', labelKey: 'clients.tab.secure', perm: 'secureView', module: 'security', view: lazy(() => import('@/features/security/ClientTab')) },
];

/** The tabs this viewer gets for this company. One tab means no tab bar: the overview is the whole page. */
export function clientTabsFor(app: App): ClientTabDef[] {
  if (app.pack.family !== 'practice') return CLIENT_TABS.slice(0, 1);
  return CLIENT_TABS.filter((tab) => (!tab.perm || app.can(tab.perm)) && (!tab.module || moduleOn(app.data, app.pack, tab.module)));
}
