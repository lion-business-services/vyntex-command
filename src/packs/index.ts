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
import { practicePack } from './practice/pack';

// Read straight from the build constant so the bundler leaves the other editions out of a deployment that has one.
declare const __VX_DEPLOY__: string | undefined;

/**
 * Registry of editions: eight field editions and the professional-services one. Adding another means one folder and one
 * line here. The LBS deployment is locked to the professional-services edition and carries only that one.
 */
export const PACKS: Record<IndustryId, IndustryPack> = (typeof __VX_DEPLOY__ !== 'undefined' && __VX_DEPLOY__ === 'lbs')
  ? ({ practice: practicePack } as Record<IndustryId, IndustryPack>)
  : {
    build: buildPack, clean: cleanPack, landscape: landscapePack, wash: washPack,
    haul: haulPack, snow: snowPack, turnover: turnoverPack, events: eventsPack, practice: practicePack,
  };
export const PACK_LIST: IndustryPack[] = Object.values(PACKS);
export const isIndustry = (v: unknown): v is IndustryId => typeof v === 'string' && v in PACKS;
export type { IndustryPack } from './types';
