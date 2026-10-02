import type { IndustryId } from '@/domain/types';
import type { IndustryPack } from './types';
import { buildPack } from './build/pack';
import { cleanPack } from './clean/pack';
import { landscapePack } from './landscape/pack';
import { washPack } from './wash/pack';
import { haulPack } from './haul/pack';
import { snowPack } from './snow/pack';
import { turnoverPack } from './turnover/pack';
import { eventsPack } from './events/pack';

/** Registry of industry editions. Adding a ninth industry means adding one folder and one line here. */
export const PACKS: Record<IndustryId, IndustryPack> = {
  build: buildPack, clean: cleanPack, landscape: landscapePack, wash: washPack,
  haul: haulPack, snow: snowPack, turnover: turnoverPack, events: eventsPack,
};
export const PACK_LIST: IndustryPack[] = Object.values(PACKS);
export const isIndustry = (v: unknown): v is IndustryId => typeof v === 'string' && v in PACKS;
export type { IndustryPack } from './types';
