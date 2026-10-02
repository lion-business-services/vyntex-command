import type { DemoState, Lang, Ref } from './types';
import type { IndustryPack } from '@/packs/types';
import type { TFn } from '@/i18n';
import { nowIso } from '@/lib/dates';
import { uid } from '@/lib/id';

/** What an action needs to know about who is acting and in which edition. */
export interface Ctx { pack: IndustryPack; lang: Lang; t: TFn; /** TeamUser id or worker id of the person acting. */ actor: string }

export function logActivity(d: DemoState, by: string, kind: string, ref: Ref, params?: Record<string, string | number>, also?: Ref[]) {
  d.activity.unshift({ id: uid('a'), at: nowIso(), kind, params, ref, also, by });
  if (d.activity.length > 600) d.activity.length = 600;
}
