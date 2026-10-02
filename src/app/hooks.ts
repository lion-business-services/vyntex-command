import { useMemo } from 'react';
import { useStore, type Prefs } from '@/store/store';
import { PACKS } from '@/packs';
import type { IndustryPack } from '@/packs/types';
import { makeT, type TFn } from '@/i18n';
import type { DemoState, Lang } from '@/domain/types';
import { can as canDo, type Permission, isWorkerView } from '@/domain/permissions';
import { fmtDate, fmtDateTime, fmtDay, fmtTime } from '@/lib/dates';
import { standing, type EntitlementId, type Standing } from '@/domain/entitlements';
import { planByTier, planName, type Plan } from '@/lib/pricing';

export interface App {
  /** Business data of the workspace being viewed. */
  data: DemoState;
  prefs: Prefs;
  lang: Lang;
  pack: IndustryPack;
  /** Translate with the wording of the selected industry. */
  t: TFn;
  /** Whether the current role may use an area. */
  can: (p: Permission) => boolean;
  isWorker: boolean;
  /** Plan being previewed and its localized name. */
  plan: Plan;
  planLabel: string;
  /** Commercial standing of a capability for the previewed plan. */
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
    const t = makeT(prefs.lang, pack);
    const plan = planByTier(pack.id, prefs.planTier);
    return {
      data, prefs, lang: prefs.lang, pack, t,
      can: (p: Permission) => canDo(prefs.viewAs, p),
      isWorker: isWorkerView(prefs.viewAs),
      plan, planLabel: planName(plan, prefs.lang),
      standing: (id: EntitlementId) => standing(id, pack.id, prefs.planTier),
      date: (d) => fmtDate(d, prefs.lang), day: (d) => fmtDay(d, prefs.lang),
      dateTime: (iso) => fmtDateTime(iso, prefs.lang), time: (h) => fmtTime(h, prefs.lang),
    };
  }, [prefs, data]);
}
