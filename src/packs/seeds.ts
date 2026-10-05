// Sample businesses, loaded on demand. Each edition's sample data is its own file, so a visitor downloads the one being shown
// first and the others afterwards, in the background (see main.tsx), instead of all of them before the first screen.
import type { IndustryId } from '@/domain/types';
import type { SeedFn } from './types';

// The conditions are written on the build constants themselves so the bundler can leave out what a deployment never shows:
// a deployment with one edition does not carry the other sample businesses, and without the review preview it carries none.
declare const __VX_DEPLOY__: string | undefined;
declare const __VX_SAMPLE_PREVIEW__: boolean | undefined;

type Loader = () => Promise<{ seed: SeedFn }>;
const LOADERS: Partial<Record<IndustryId, Loader>> = (typeof __VX_DEPLOY__ !== 'undefined' && __VX_DEPLOY__ === 'lbs')
  ? ((typeof __VX_SAMPLE_PREVIEW__ !== 'undefined' && __VX_SAMPLE_PREVIEW__ === true) ? { practice: () => import('./practice/seed') } : {})
  : {
    build: () => import('./build/seed'), clean: () => import('./clean/seed'), landscape: () => import('./landscape/seed'), wash: () => import('./wash/seed'),
    haul: () => import('./haul/seed'), snow: () => import('./snow/seed'), turnover: () => import('./turnover/seed'), events: () => import('./events/seed'),
    practice: () => import('./practice/seed'),
  };
const cache: Partial<Record<IndustryId, SeedFn>> = {};
const pending: Partial<Record<IndustryId, Promise<SeedFn>>> = {};

/** True once the sample business of this edition is in memory. */
export const seedReady = (id: IndustryId) => !!cache[id];
/** The sample-business builder of an edition. Call `loadSeed` first; this throws when it has not been loaded. */
export function seedOf(id: IndustryId): SeedFn {
  const f = cache[id];
  if (!f) throw new Error(`sample data for "${id}" is not loaded yet`);
  return f;
}
/** Loads the sample business of an edition (once). One retry covers a dropped connection. */
export function loadSeed(id: IndustryId): Promise<SeedFn> {
  const hit = cache[id]; if (hit) return Promise.resolve(hit);
  const load = LOADERS[id];
  if (!load) return Promise.reject(new Error(`this build has no sample data for "${id}"`));
  const get = () => load().then((m) => (cache[id] = m.seed));
  return (pending[id] ??= get().catch(() => get()).finally(() => { delete pending[id]; }));
}
/** Loads every edition's sample business, one after another. Used in the background and by the check scripts. */
export async function loadAllSeeds(): Promise<void> {
  for (const id of Object.keys(LOADERS) as IndustryId[]) await loadSeed(id);
}
