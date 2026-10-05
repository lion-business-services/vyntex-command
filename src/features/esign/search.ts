// How the command palette finds signature requests, and the uploaded files the general document search does not reach
// (it looks at titles, numbers and client names; a file is also found by its file name, its folder or the lead it belongs to).
import type { SearchProvider } from '@/app/search';
import { visibleClientIds, visibleLeads } from '@/domain/access';
import { byId } from '@/domain/selectors';
import type { Envelope } from '@/domain/types';

type WithClient = Envelope & { clientId?: string; docNumber?: string };

export const search: SearchProvider[] = [
  { id: 'envelopes', groupKey: 'esign.search.group', perm: 'esign', module: 'esign',
    find: (app, has) => {
      const mine = visibleClientIds(app.data, app.user, app.perms);
      return (app.data.envelopes as WithClient[]).filter((e) => (!e.clientId || mine.has(e.clientId)) && has(e.title, e.docNumber, byId(app.data.clients, e.clientId)?.name, ...e.signers.flatMap((s) => [s.name, s.email])))
        .map((e) => ({ id: e.id, title: e.title, sub: [app.t('esign.status.' + e.status), ...e.signers.map((s) => s.name)].join(' · '), to: `/esign/${e.id}` }));
    } },
  { id: 'docfiles', groupKey: 'esign.search.files', perm: 'documents', module: 'documents',
    find: (app, has) => {
      const mine = visibleClientIds(app.data, app.user, app.perms);
      const leads = new Set(visibleLeads(app.data, app.user, app.perms).map((l) => l.id));
      return app.data.docs.filter((d) => {
        const seen = d.clientId ? mine.has(d.clientId) : !!d.leadId && leads.has(d.leadId);
        if (!seen) return false;
        // what the general document search already finds is left to it, so nothing shows twice
        if (d.clientId && has(d.title, d.number, byId(app.data.clients, d.clientId)?.name)) return false;
        return has(d.file?.name, d.folder, ...(d.versions ?? []).map((v) => v.file?.name), d.clientId ? undefined : d.title, d.clientId ? undefined : d.number, byId(app.data.leads, d.leadId)?.name);
      }).map((d) => ({ id: d.id, title: d.file?.name ?? d.title, sub: [app.t('doc.kind.' + d.kind), d.number, d.folder].filter(Boolean).join(' · '), to: `/documents/${d.id}` }));
    } },
];
