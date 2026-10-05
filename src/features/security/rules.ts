// The sign-in rules of the workspace on screen: the company's own choice with what the deployment itself requires on top.
// LBS Command requires the second sign-in step of every office role (docs/SERVER.md, section 5); a company can add roles to
// the list and never take a required one off. The server and the database enforce the same list; this is the mirror the
// screens read.
import type { DemoState, OfficeRole } from '@/domain/types';
import { OFFICE_ROLES } from '@/domain/permissions';
import { securityRules } from '@/domain/config';
import { DEPLOY } from '@/config/deployment';

/** Roles this deployment makes use the second step, whatever the company chooses. */
export const FIXED_MFA_ROLES: OfficeRole[] = DEPLOY.id === 'lbs' ? [...OFFICE_ROLES] : [];

export interface SignInRules { idleMinutes: number; mfaRoles: OfficeRole[]; fixed: OfficeRole[] }
export function signInRules(d: Pick<DemoState, 'config'>): SignInRules {
  const own = securityRules(d);
  return { idleMinutes: own.idleMinutes, mfaRoles: OFFICE_ROLES.filter((r) => FIXED_MFA_ROLES.includes(r) || own.mfaRoles.includes(r)), fixed: FIXED_MFA_ROLES };
}
