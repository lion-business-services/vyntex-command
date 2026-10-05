// What the assistant is allowed to read: the same records the person asking may see on the screens, and no others.
// Office scoping (a client of another office is hidden from someone without access) applies here as it does to the lists
// and to search: the assistant gets a copy of the workspace with those records left out, so it cannot find, summarise or
// act on something the person could not open.
import type { DemoState, TeamUser } from '@/domain/types';
import type { Permission } from '@/domain/permissions';
import { visibleClientIds, visibleLeads } from '@/domain/access';

export function scopedData(data: DemoState, user: TeamUser | undefined, perms: Permission[]): DemoState {
  const clients = visibleClientIds(data, user, perms);
  if (clients.size === data.clients.length && visibleLeads(data, user, perms).length === data.leads.length) return data;
  const leads = visibleLeads(data, user, perms).filter((l) => !l.clientId || clients.has(l.clientId));
  const leadIds = new Set(leads.map((l) => l.id));
  const jobs = data.jobs.filter((j) => clients.has(j.clientId));
  const jobIds = new Set(jobs.map((j) => j.id));
  const docs = data.docs.filter((x) => (x.clientId ? clients.has(x.clientId) : !x.leadId || leadIds.has(x.leadId)));
  const docIds = new Set(docs.map((x) => x.id));
  /** A record tied to a client, a job or a lead is kept when that one is; a record tied to none is kept. */
  const seen = (x: { clientId?: string; jobId?: string; leadId?: string }) => (!x.clientId || clients.has(x.clientId)) && (!x.jobId || jobIds.has(x.jobId)) && (!x.leadId || leadIds.has(x.leadId));
  return {
    ...data,
    clients: data.clients.filter((c) => clients.has(c.id)), leads, jobs, docs,
    tasks: data.tasks.filter(seen),
    appointments: (data.appointments ?? []).filter(seen),
    opportunities: (data.opportunities ?? []).filter(seen),
    reviews: (data.reviews ?? []).filter(seen),
    credits: (data.credits ?? []).filter(seen),
    complianceItems: (data.complianceItems ?? []).filter(seen),
    envelopes: (data.envelopes ?? []).filter((e) => docIds.has(e.docId)),
    messages: data.messages.filter((m) => !m.clientId || clients.has(m.clientId)),
  };
}
