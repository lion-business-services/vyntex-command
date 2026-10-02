// Role awareness. In production the same matrix is enforced on the server (see supabase/migrations: row level security).
import type { OfficeRole, ViewAs } from './types';

export type Permission =
  | 'leads' | 'clients' | 'jobs' | 'tasks' | 'calendar' | 'team' | 'documents'
  | 'money' | 'reports' | 'automations' | 'assistant' | 'settings' | 'compliance' | 'profit' | 'delete';

const MATRIX: Record<OfficeRole, Permission[]> = {
  owner: ['leads', 'clients', 'jobs', 'tasks', 'calendar', 'team', 'documents', 'money', 'reports', 'automations', 'assistant', 'settings', 'compliance', 'profit', 'delete'],
  manager: ['leads', 'clients', 'jobs', 'tasks', 'calendar', 'team', 'documents', 'money', 'reports', 'automations', 'assistant', 'compliance', 'delete'],
  staff: ['leads', 'clients', 'jobs', 'tasks', 'calendar', 'documents', 'assistant'],
};
export const isWorkerView = (v: ViewAs): v is `worker:${string}` => v.startsWith('worker:');
export const workerIdOf = (v: ViewAs) => (isWorkerView(v) ? v.slice(7) : '');
export const officeRole = (v: ViewAs): OfficeRole | null => (isWorkerView(v) ? null : (v as OfficeRole));
export function can(viewAs: ViewAs, p: Permission): boolean { const r = officeRole(viewAs); return !!r && MATRIX[r].includes(p); }
