// The one list of screens. The menu (Shell), the addresses (routes.tsx) and the "Go to" list of the command palette are all
// built from it, so a screen is added in exactly one place. Which screens a company sees is decided by its edition and its
// own configuration (`moduleOn`) and by the viewer's role (`can`): see `modulesFor` below.
// A module owns src/features/<id>/ (index.tsx, i18n.ts, <id>.css) and its actions in src/domain/actions/<area>.ts.
import { lazy, type ComponentType } from 'react';
import {
  LuAlarmClock, LuBadgeCheck, LuBanknote, LuBookOpen, LuBriefcase, LuCalculator, LuCalendarClock, LuCalendarDays, LuChartColumn, LuFileText, LuHandCoins,
  LuHardHat, LuLayoutDashboard, LuLightbulb, LuListChecks, LuLock, LuMail, LuPlug, LuScrollText, LuSettings, LuShare2, LuShieldCheck, LuSignature, LuSparkles,
  LuStar, LuUserPlus, LuUsers, LuUsersRound, LuWallet, LuZap,
} from 'react-icons/lu';
import type { ModuleId } from '@/domain/types';
import type { Permission } from '@/domain/permissions';
import { moduleOn } from '@/domain/config';
import { isOverdue, newLeads } from '@/domain/selectors';
import type { App } from './hooks';
import { envelopesWaiting } from '@/domain/actions/esign';
import { assistantOn } from '@/features/assistant/deploy';

/** `id` is the record in the address (/jobs/<id>), `sub` anything after it. */
export interface PageProps { id?: string; sub?: string }
export type ModuleGroup = 'work' | 'business' | 'system';
type Icon = ComponentType<{ 'aria-hidden'?: boolean | 'true' | 'false'; className?: string }>;

export interface ModuleDef {
  id: ModuleId | 'dashboard';
  /** First segment of the address inside the workspace. '' is the dashboard. */
  path: string;
  /** Capability the viewer needs to see the screen at all. */
  perm?: Permission;
  group: ModuleGroup;
  icon: Icon;
  /** Menu label, a key of the dictionaries (tokens such as {Jobs} are filled with the edition's wording). */
  labelKey: string;
  /** The page, loaded the first time it is opened so the first screen stays light. */
  page: ComponentType<PageProps>;
  /** Number shown next to the menu entry (things waiting for someone). */
  count?: (app: Pick<App, 'data' | 'pack'>) => number;
  /** The count means something is late, not just new. */
  countBad?: boolean;
  /** An extra condition on top of the edition's module list, read from the pack. */
  when?: (app: Pick<App, 'data' | 'pack'>) => boolean;
}

export const MODULES: ModuleDef[] = [
  { id: 'dashboard', path: '', group: 'work', icon: LuLayoutDashboard, labelKey: 'nav.dashboard', page: lazy(() => import('@/features/dashboard')) },
  // ---- work
  { id: 'leads', path: 'leads', perm: 'leads', group: 'work', icon: LuUserPlus, labelKey: 'nav.leads', page: lazy(() => import('@/features/leads')), count: ({ data }) => newLeads(data).length },
  { id: 'clients', path: 'clients', perm: 'clients', group: 'work', icon: LuUsers, labelKey: 'nav.clients', page: lazy(() => import('@/features/clients')) },
  { id: 'jobs', path: 'jobs', perm: 'jobs', group: 'work', icon: LuBriefcase, labelKey: 'nav.jobs', page: lazy(() => import('@/features/jobs')) },
  { id: 'appointments', path: 'appointments', perm: 'appointments', group: 'work', icon: LuCalendarClock, labelKey: 'nav.appointments', page: lazy(() => import('@/features/appointments')) },
  { id: 'calendar', path: 'calendar', perm: 'calendar', group: 'work', icon: LuCalendarDays, labelKey: 'nav.calendar', page: lazy(() => import('@/features/calendar')) },
  { id: 'tasks', path: 'tasks', perm: 'tasks', group: 'work', icon: LuListChecks, labelKey: 'nav.tasks', page: lazy(() => import('@/features/tasks')), count: ({ data }) => data.tasks.filter(isOverdue).length, countBad: true },
  // ---- business
  { id: 'team', path: 'team', perm: 'team', group: 'business', icon: LuHardHat, labelKey: 'nav.team', page: lazy(() => import('@/features/team')) },
  { id: 'catalog', path: 'catalog', perm: 'catalog', group: 'business', icon: LuBookOpen, labelKey: 'nav.catalog', page: lazy(() => import('@/features/catalog')) },
  { id: 'opportunities', path: 'opportunities', perm: 'opportunities', group: 'business', icon: LuLightbulb, labelKey: 'nav.opportunities', page: lazy(() => import('@/features/opportunities')) },
  { id: 'documents', path: 'documents', perm: 'documents', group: 'business', icon: LuFileText, labelKey: 'nav.documents', page: lazy(() => import('@/features/documents')) },
  { id: 'esign', path: 'esign', perm: 'esign', group: 'business', icon: LuSignature, labelKey: 'nav.esign', page: lazy(() => import('@/features/esign')), count: ({ data }) => envelopesWaiting(data) },
  { id: 'messages', path: 'messages', perm: 'comms', group: 'business', icon: LuMail, labelKey: 'nav.messages', page: lazy(() => import('@/features/messages')), count: ({ data }) => data.messages.filter((m) => m.status === 'draft').length },
  { id: 'payments', path: 'payments', perm: 'money', group: 'business', icon: LuWallet, labelKey: 'nav.money', page: lazy(() => import('@/features/payments')) },
  { id: 'reviews', path: 'reviews', perm: 'reviews', group: 'business', icon: LuStar, labelKey: 'nav.reviews', page: lazy(() => import('@/features/reviews')) },
  { id: 'deadlines', path: 'deadlines', perm: 'deadlines', group: 'business', icon: LuAlarmClock, labelKey: 'nav.deadlines', page: lazy(() => import('@/features/deadlines')) },
  { id: 'reports', path: 'reports', perm: 'reports', group: 'business', icon: LuChartColumn, labelKey: 'nav.reports', page: lazy(() => import('@/features/reports')) },
  // the subcontractor W-9 and 1099 screens: only where the edition has them
  { id: 'compliance', path: 'compliance', perm: 'compliance', group: 'business', icon: LuShieldCheck, labelKey: 'nav.compliance', page: lazy(() => import('@/features/compliance')), when: ({ pack }) => pack.compliance },
  { id: 'social', path: 'social', perm: 'social', group: 'business', icon: LuShare2, labelKey: 'nav.social', page: lazy(() => import('@/features/social')) },
  { id: 'cash', path: 'cash', perm: 'cash', group: 'business', icon: LuBanknote, labelKey: 'nav.cash', page: lazy(() => import('@/features/cash')) },
  { id: 'payroll', path: 'payroll', perm: 'payroll', group: 'business', icon: LuHandCoins, labelKey: 'nav.payroll', page: lazy(() => import('@/features/payroll')) },
  { id: 'bookkeeping', path: 'bookkeeping', perm: 'bookkeeping', group: 'business', icon: LuCalculator, labelKey: 'nav.bookkeeping', page: lazy(() => import('@/features/bookkeeping')) },
  { id: 'licensing', path: 'licensing', perm: 'licensing', group: 'business', icon: LuBadgeCheck, labelKey: 'nav.licensing', page: lazy(() => import('@/features/licensing')) },
  // ---- system
  { id: 'automations', path: 'automations', perm: 'automations', group: 'system', icon: LuZap, labelKey: 'nav.automations', page: lazy(() => import('@/features/automations')) },
  { id: 'integrations', path: 'integrations', perm: 'integrations', group: 'system', icon: LuPlug, labelKey: 'nav.integrations', page: lazy(() => import('@/features/integrations')) },
  { id: 'assistant', path: 'assistant', perm: 'assistant', group: 'system', icon: LuSparkles, labelKey: 'nav.assistant', page: lazy(() => import('@/features/assistant')), when: ({ data, pack }) => assistantOn(data, pack) },
  { id: 'settings', path: 'settings', perm: 'settings', group: 'system', icon: LuSettings, labelKey: 'nav.settings', page: lazy(() => import('@/features/settings')) },
  { id: 'security', path: 'security', perm: 'users', group: 'system', icon: LuLock, labelKey: 'nav.security', page: lazy(() => import('@/features/security')) },
  { id: 'audit', path: 'audit', perm: 'audit', group: 'system', icon: LuScrollText, labelKey: 'nav.audit', page: lazy(() => import('@/features/audit')) },
];
/** An edition whose team page is the office team shows people, not hard hats. */
export const TEAM_ICON_OFFICE: Icon = LuUsersRound;

export const GROUPS: ModuleGroup[] = ['work', 'business', 'system'];
export const moduleByPath = (path: string): ModuleDef | undefined => MODULES.find((m) => m.path === path);
export const moduleById = (id: ModuleDef['id']): ModuleDef | undefined => MODULES.find((m) => m.id === id);

/** Whether a screen exists for the company on screen (edition, company configuration and the module's own condition). Says nothing about the viewer's role. */
export function moduleExists(m: ModuleDef, app: Pick<App, 'data' | 'pack'>): boolean {
  if (m.id === 'dashboard') return true;
  return moduleOn(app.data, app.pack, m.id) && (!m.when || m.when(app));
}
/**
 * The screens the viewer gets, in menu order: the edition lists its modules in the order it wants them inside each group;
 * a module the edition does not list but the company switched on comes after those.
 */
export function modulesFor(app: Pick<App, 'data' | 'pack' | 'can'>): ModuleDef[] {
  const order = (m: ModuleDef) => { const at = app.pack.modules.indexOf(m.id as ModuleId); return m.id === 'dashboard' ? -1 : at < 0 ? 999 : at; };
  return MODULES.filter((m) => moduleExists(m, app) && (!m.perm || app.can(m.perm))).sort((a, b) => order(a) - order(b));
}
