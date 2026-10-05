// The capabilities a role can hold, grouped the way the roles screen shows them. The names are the ones the database
// enforces (src/domain/permissions.ts); the wording for each is `security.cap.<name>` and `security.cap.<name>.d`.
import type { ModuleId } from '@/domain/types';
import type { Permission } from '@/domain/permissions';
import { moduleOn } from '@/domain/config';
import type { App } from '@/app/hooks';

export interface CapGroup { id: 'work' | 'business' | 'records' | 'secure' | 'admin'; caps: Permission[] }
const GROUPS: CapGroup[] = [
  { id: 'work', caps: ['leads', 'clients', 'jobs', 'tasks', 'calendar', 'appointments', 'documents', 'esign', 'comms', 'catalog', 'opportunities', 'reviews', 'deadlines'] },
  { id: 'business', caps: ['money', 'profit', 'credits', 'cash', 'payroll', 'bookkeeping', 'licensing', 'reports', 'team', 'compliance', 'social'] },
  { id: 'records', caps: ['write', 'delete', 'export', 'import', 'assignLeads', 'allClients'] },
  { id: 'secure', caps: ['secureView', 'secureReveal', 'secureApprove'] },
  { id: 'admin', caps: ['settings', 'config', 'users', 'audit', 'integrations', 'automations', 'assistant'] },
];
/** The screen a capability opens. A capability whose screen this company does not have is left off the matrix. */
const MODULE: Partial<Record<Permission, ModuleId>> = {
  leads: 'leads', clients: 'clients', jobs: 'jobs', tasks: 'tasks', calendar: 'calendar', appointments: 'appointments', documents: 'documents', esign: 'esign', comms: 'messages',
  catalog: 'catalog', opportunities: 'opportunities', reviews: 'reviews', deadlines: 'deadlines', money: 'payments', credits: 'appointments', cash: 'cash', payroll: 'payroll',
  bookkeeping: 'bookkeeping', licensing: 'licensing', reports: 'reports', team: 'team', compliance: 'compliance', social: 'social', settings: 'settings', audit: 'audit',
  integrations: 'integrations', automations: 'automations', assistant: 'assistant', secureView: 'security', secureReveal: 'security', secureApprove: 'security',
};

/** The groups and capabilities that mean something for the company on screen, in display order. */
export function capGroupsFor(app: Pick<App, 'data' | 'pack'>): CapGroup[] {
  const exists = (p: Permission) => {
    if (!app.pack.rolePermissions.owner.includes(p)) return false;
    if (p === 'compliance' && !app.pack.compliance) return false;
    // seeing every office only matters where there are offices
    if (p === 'allClients' && !app.data.offices.length && app.pack.family !== 'practice') return false;
    const m = MODULE[p];
    return !m || moduleOn(app.data, app.pack, m);
  };
  return GROUPS.map((g) => ({ id: g.id, caps: g.caps.filter(exists) })).filter((g) => g.caps.length > 0);
}
