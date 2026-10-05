import { useMemo } from 'react';
import { useStore, type Prefs } from '@/store/store';
import { PACKS } from '@/packs';
import type { IndustryPack } from '@/packs/types';
import { makeT, type TFn } from '@/i18n';
import type { DemoState, Lang, TeamUser } from '@/domain/types';
import { type Permission, isWorkerView, officeRole } from '@/domain/permissions';
import { permissionsOf } from '@/domain/config';
import { fmtDate, fmtDateTime, fmtDay, fmtTime } from '@/lib/dates';
import { NO_PLANS, standing, type EntitlementId, type Standing } from '@/domain/entitlements';
import { planByTier, planName, type Plan } from '@/lib/pricing';
import { DEPLOY } from '@/config/deployment';
import { isLive, session } from '@/platform/session';

export interface App {
  /** Business data of the workspace being viewed. */
  data: DemoState;
  prefs: Prefs;
  lang: Lang;
  pack: IndustryPack;
  /** Translate with the wording of the selected industry and the company's own. */
  t: TFn;
  /**
   * Whether the viewer holds a capability: an area (`can('reports')`) or an act (`can('write')`, `can('delete')`).
   * Hide or disable every control that changes records with `can('write')`; a read-only person looks and changes nothing.
   */
  can: (p: Permission) => boolean;
  /** Every capability the viewer holds. Empty in the worker portal. */
  perms: Permission[];
  isWorker: boolean;
  /** The office person looking: whoever is signed in, or whoever "View as" stands for. Undefined in the worker portal. */
  user: TeamUser | undefined;
  /** True when the records come from the company's database; false in a sample workspace. */
  live: boolean;
  /** True when plans and prices apply to what is on screen. False for an edition that is quoted and in a deployment without plans. */
  priced: boolean;
  /** Plan being previewed and its localized name. Null and '' when `priced` is false. */
  plan: Plan | null;
  planLabel: string;
  /** Commercial standing of a capability for the previewed plan. `none` when `priced` is false. */
  standing: (id: EntitlementId) => Standing;
  date: (d: string | undefined) => string;
  day: (d: string | undefined) => string;
  dateTime: (iso: string | undefined) => string;
  time: (hhmm: string | undefined) => string;
}

/** Everything a page needs: data, wording, role, plan and formatters. Re-renders when the data or settings change. */
export function useApp(): App {
  const { prefs, data } = useStore();
  return useMemo(() => {
    const pack = PACKS[prefs.pack];
    const t = makeT(prefs.lang, pack, data.config);
    const live = isLive();
    const role = officeRole(prefs.viewAs);
    const perms = role ? permissionsOf(data, pack, role) : [];
    const priced = pack.priced && DEPLOY.showPlans;
    const plan = priced ? planByTier(pack.id, prefs.planTier) ?? null : null;
    const actor = live ? session()?.actorId : undefined;
    const user = role ? (actor ? data.users.find((u) => u.id === actor) : data.users.find((u) => u.role === role && u.active !== false)) : undefined;
    return {
      data, prefs, lang: prefs.lang, pack, t,
      can: (p: Permission) => perms.includes(p), perms,
      isWorker: isWorkerView(prefs.viewAs), user, live,
      priced: priced && !!plan, plan, planLabel: plan ? planName(plan, prefs.lang) : '',
      standing: (id: EntitlementId) => (priced ? standing(id, pack.id, prefs.planTier) : NO_PLANS),
      date: (d) => fmtDate(d, prefs.lang), day: (d) => fmtDay(d, prefs.lang),
      dateTime: (iso) => fmtDateTime(iso, prefs.lang), time: (h) => fmtTime(h, prefs.lang),
    };
  }, [prefs, data]);
}
