// Roles and capabilities. A capability is a plain name; which role holds which one comes from the edition's matrix
// (src/packs/blueprint.ts and each pack) and the company's own overrides, resolved in src/domain/config.ts.
// The database enforces the same names in app.can() (supabase/tests/parity.mjs compares the two matrices per edition).
import type { OfficeRole, ViewAs } from './types';

export type Permission =
  // screens and areas
  | 'leads' | 'clients' | 'jobs' | 'tasks' | 'calendar' | 'team' | 'documents' | 'money' | 'reports' | 'automations' | 'assistant' | 'settings' | 'compliance'
  | 'appointments' | 'catalog' | 'opportunities' | 'reviews' | 'integrations' | 'social' | 'comms' | 'esign' | 'cash' | 'payroll' | 'bookkeeping' | 'licensing'
  | 'deadlines' | 'audit'
  // what a person may do
  /** See profit and margin figures. */
  | 'profit'
  | 'delete'
  /** Invite people, change roles, switch a person off. */
  | 'users'
  | 'export' | 'import'
  /** Change stages, sources, wording, modules and other company configuration. */
  | 'config'
  /** Reassign leads and change the automatic assignment. */
  | 'assignLeads'
  /** See every client, whatever office they belong to. */
  | 'allClients'
  /** Issue, apply and void client credits. */
  | 'credits'
  /** See that a protected value is on file (its type and last four digits). */
  | 'secureView'
  /** Reveal a protected value without waiting for another person (the company may still require a second check). */
  | 'secureReveal'
  /** Approve or deny someone else's request to see a protected value. */
  | 'secureApprove'
  /** Change records at all. A read-only person holds every viewing capability of office staff and lacks this one. */
  | 'write';

export const OFFICE_ROLES: OfficeRole[] = ['owner', 'manager', 'staff', 'readonly'];
export const isOfficeRole = (v: unknown): v is OfficeRole => typeof v === 'string' && (OFFICE_ROLES as string[]).includes(v);
export const isWorkerView = (v: ViewAs): v is `worker:${string}` => v.startsWith('worker:');
export const workerIdOf = (v: ViewAs) => (isWorkerView(v) ? v.slice(7) : '');
export const officeRole = (v: ViewAs): OfficeRole | null => (isWorkerView(v) ? null : (v as OfficeRole));
