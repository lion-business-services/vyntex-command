// The sections of the Settings page, in order. A module adds its section by keeping a `SettingsPanel.tsx` in its own folder;
// the entries here point at those files. Each section has its own address: /settings/<id>.
// A section shows only where it means something: `perm` is the capability it needs on top of `settings`, `module` the screen
// it belongs to, `when` anything else (a priced edition, a family of editions, the deployment).
import { lazy, type ComponentType } from 'react';
import { LuBuilding2, LuCalendarClock, LuDatabase, LuFileText, LuGlobe, LuLanguages, LuLayers, LuLayoutGrid, LuLink2, LuListTree, LuMail, LuMailCheck, LuMapPin, LuPalette, LuPlug, LuSparkles, LuUsers, LuWorkflow } from 'react-icons/lu';
import type { ModuleId } from '@/domain/types';
import type { Permission } from '@/domain/permissions';
import { moduleOn } from '@/domain/config';
import type { App } from '@/app/hooks';
import { DEPLOY } from '@/config/deployment';

type Icon = ComponentType<{ 'aria-hidden'?: boolean | 'true' | 'false' }>;
export interface SettingsPanelDef {
  id: string;
  /** Label in the section list, a dictionary key. */
  labelKey: string;
  icon: Icon;
  /** Capability needed on top of `settings`, which the whole page already requires. */
  perm?: Permission;
  /** The section exists only where this module does. */
  module?: ModuleId;
  when?: (app: App) => boolean;
  /** The section's content, loaded the first time it is opened. */
  view: ComponentType;
}

/** Sections that only an office edition has screens for today. */
const practiceOnly = (app: App) => app.pack.family === 'practice';

export const SETTINGS_PANELS: SettingsPanelDef[] = [
  { id: 'business', labelKey: 'settings.tab.business', icon: LuBuilding2, view: lazy(() => import('./business')) },
  { id: 'team', labelKey: 'settings.tab.team', icon: LuUsers, view: lazy(() => import('./team').then((m) => ({ default: m.TeamSection }))) },
  // plans and prices: only for an edition that is in the pricing file, in a deployment that shows plans
  { id: 'plan', labelKey: 'settings.tab.plan', icon: LuLayers, when: (app) => app.priced, view: lazy(() => import('./plan').then((m) => ({ default: m.PlanSection }))) },
  { id: 'connections', labelKey: 'settings.tab.connections', icon: LuPlug, when: (app) => app.priced, view: lazy(() => import('./plan').then((m) => ({ default: m.ConnectionsSection }))) },
  // how the company set the product up for itself
  { id: 'modules', labelKey: 'settings.tab.modules', icon: LuLayoutGrid, perm: 'config', view: lazy(() => import('./modules')) },
  { id: 'wording', labelKey: 'settings.tab.wording', icon: LuLanguages, perm: 'config', view: lazy(() => import('./wording')) },
  { id: 'lists', labelKey: 'settings.tab.lists', icon: LuListTree, perm: 'config', when: practiceOnly, view: lazy(() => import('./lists')) },
  // the links exist where a deployment ships some or an office edition shows them on its home screen
  { id: 'links', labelKey: 'settings.tab.links', icon: LuLink2, perm: 'config', when: (app) => DEPLOY.quickLinks.length > 0 || practiceOnly(app), view: lazy(() => import('./links')) },
  { id: 'emails', labelKey: 'settings.tab.emails', icon: LuMailCheck, view: lazy(() => import('./more').then((m) => ({ default: m.EmailsSection }))) },
  { id: 'pipeline', labelKey: 'settings.tab.pipeline', icon: LuWorkflow, perm: 'config', module: 'leads', when: practiceOnly, view: lazy(() => import('@/features/leads/SettingsPanel')) },
  { id: 'offices', labelKey: 'settings.tab.offices', icon: LuMapPin, perm: 'config', module: 'team', when: practiceOnly, view: lazy(() => import('@/features/team/SettingsPanel')) },
  { id: 'appointments', labelKey: 'nav.appointments', icon: LuCalendarClock, perm: 'config', module: 'appointments', view: lazy(() => import('@/features/appointments/SettingsPanel')) },
  { id: 'documents', labelKey: 'settings.tab.templates', icon: LuFileText, perm: 'config', module: 'documents', when: practiceOnly, view: lazy(() => import('@/features/documents/SettingsPanel')) },
  { id: 'communications', labelKey: 'settings.tab.communications', icon: LuMail, perm: 'config', module: 'messages', when: practiceOnly, view: lazy(() => import('@/features/messages/SettingsPanel')) },
  { id: 'assistant', labelKey: 'asst.set.title', icon: LuSparkles, perm: 'config', view: lazy(() => import('@/features/assistant/SettingsPanel')) },
  { id: 'appearance', labelKey: 'settings.tab.appearance', icon: LuPalette, view: lazy(() => import('./more').then((m) => ({ default: m.AppearanceSection }))) },
  { id: 'data', labelKey: 'settings.tab.data', icon: LuDatabase, view: lazy(() => import('./more').then((m) => ({ default: m.DataSection }))) },
  // a company's own address is a matter between it and VYNTEX; the single-company deployment has its address already
  { id: 'domain', labelKey: 'settings.tab.domain', icon: LuGlobe, when: () => DEPLOY.id === 'vyntex', view: lazy(() => import('./domain')) },
];

/** The sections this viewer gets for this company, in order. */
export function settingsPanelsFor(app: App): SettingsPanelDef[] {
  return SETTINGS_PANELS.filter((p) => (!p.perm || app.can(p.perm)) && (!p.module || moduleOn(app.data, app.pack, p.module)) && (!p.when || p.when(app)));
}
