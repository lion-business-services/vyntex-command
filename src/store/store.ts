// Demo-mode state. One saved copy per industry edition, kept in this browser only.
// In customer production mode the same actions run against the tenant's database instead (see docs/ARCHITECTURE.md).
import { useSyncExternalStore } from 'react';
import type { DemoState, IndustryId, Lang, ViewAs } from '@/domain/types';
import type { PlanTier } from '@/lib/pricing';
import { PACKS, isIndustry } from '@/packs';
import { loadSeed, seedOf, seedReady } from '@/packs/seeds';
import { makeT, type TFn } from '@/i18n';
import type { Ctx } from '@/domain/context';
import { runDaily } from '@/domain/actions';
import { primeDemo } from '@/domain/automations';
import { daysBetween, today } from '@/lib/dates';
import { isWorkerView, workerIdOf } from '@/domain/permissions';

const DATA_VERSION = 6;
const PREFS_KEY = 'vyntex.prefs';
const dataKey = (id: IndustryId) => `vyntex.demo.${id}`;
/** Sample dates are relative to the day the demo was loaded; after this many days it is rebuilt so it always looks current. */
const STALE_AFTER_DAYS = 3;

export interface Prefs {
  lang: Lang;
  theme: 'dark' | 'light';
  pack: IndustryId;
  viewAs: ViewAs;
  /** Plan being previewed: 0 entry, 1 middle, 2 top. */
  planTier: PlanTier;
  tourSeen: boolean;
}
export interface Snapshot { prefs: Prefs; data: DemoState }

const mem: Record<string, string> = {};
const storage = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return mem[k] ?? null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { mem[k] = v; } },
  del(k: string) { try { localStorage.removeItem(k); } catch { delete mem[k]; } },
};

function defaultPrefs(): Prefs {
  let lang: Lang = 'en';
  try { if (navigator.language?.toLowerCase().startsWith('es')) lang = 'es'; } catch { /* keep English */ }
  return { lang, theme: 'dark', pack: 'build', viewAs: 'owner', planTier: 1, tourSeen: false };
}
function loadPrefs(): Prefs {
  const p = defaultPrefs();
  try { Object.assign(p, JSON.parse(storage.get(PREFS_KEY) || '{}')); } catch { /* ignore */ }
  try {
    const q = new URLSearchParams(location.search);
    const ind = q.get('industry'); if (isIndustry(ind)) p.pack = ind;
    const lang = q.get('lang'); if (lang === 'en' || lang === 'es') p.lang = lang;
  } catch { /* ignore */ }
  if (!isIndustry(p.pack)) p.pack = 'build';
  return p;
}

export function freshData(id: IndustryId, lang: Lang): DemoState {
  const pack = PACKS[id];
  const d: DemoState = { v: DATA_VERSION, pack: id, seededOn: today(), seedLang: lang, touched: false, company: { ...pack.sampleCompany }, ...seedOf(id)(lang), automation: { enabled: {}, runs: [] }, readNotifications: [], settings: {} };
  primeDemo(d, { pack, lang, t: makeT(lang, pack), actor: d.users[0]?.id ?? 'u1' });
  return d;
}
/** The copy this browser saved earlier, when it is still usable. */
function savedData(id: IndustryId, lang: Lang): DemoState | null {
  try {
    const d = JSON.parse(storage.get(dataKey(id)) || 'null') as DemoState | null;
    if (d && d.v === DATA_VERSION && d.pack === id && Array.isArray(d.jobs) && daysBetween(d.seededOn, today()) <= STALE_AFTER_DAYS && (d.touched || d.seedLang === lang)) return d;
  } catch { /* fall through to a fresh copy */ }
  return null;
}

let prefs = loadPrefs();
// Filled in before the first screen is drawn: see `ready` at the end of this file.
let data = null as unknown as DemoState;
let snapshot: Snapshot = { prefs, data };
const listeners = new Set<() => void>();

function commit(persistData = true) {
  snapshot = { prefs, data };
  storage.set(PREFS_KEY, JSON.stringify(prefs));
  if (persistData) storage.set(dataKey(data.pack), JSON.stringify(data));
  listeners.forEach((l) => l());
}

export const getSnapshot = () => snapshot;
export const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function useStore(): Snapshot { return useSyncExternalStore(subscribe, getSnapshot, getSnapshot); }

export const currentPack = () => PACKS[prefs.pack];
export const currentT = (): TFn => makeT(prefs.lang, currentPack());
/** Office user or worker the viewer is acting as. */
export function actorId(): string {
  if (isWorkerView(prefs.viewAs)) return workerIdOf(prefs.viewAs);
  return data.users.find((u) => u.role === prefs.viewAs)?.id ?? data.users[0]?.id ?? 'u1';
}
export const ctx = (): Ctx => ({ pack: currentPack(), lang: prefs.lang, t: currentT(), actor: actorId() });

/** Runs a change against the data and saves it. Usage: `act(setJobStatus, jobId, 'done')` or `mutate(d => { … })`. */
export function mutate(fn: (d: DemoState) => void) {
  fn(data);
  data = { ...data, touched: true };
  commit();
}
/** Like `mutate`, for housekeeping that should not count as the visitor changing the sample business (e.g. marking a notification read). */
export function mutateQuiet(fn: (d: DemoState) => void) { fn(data); data = { ...data }; commit(); }
export function act<A extends unknown[], R>(action: (d: DemoState, c: Ctx, ...args: A) => R, ...args: A): R {
  const out = action(data, ctx(), ...args);
  data = { ...data, touched: true };
  commit();
  return out;
}
export function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch };
  commit(false);
}
/** Changes the language. The sample business is rebuilt in the new language unless the visitor already changed something. */
export function setLanguage(lang: Lang) {
  if (lang === prefs.lang) return;
  prefs = { ...prefs, lang };
  const rebuild = () => { if (prefs.lang === lang && !data.touched && data.seedLang !== lang) { data = freshData(prefs.pack, lang); runDaily(data, ctx()); data.touched = false; } };
  if (seedReady(prefs.pack)) rebuild();
  else { const id = prefs.pack; void loadSeed(id).then(() => { if (prefs.pack === id) { rebuild(); commit(); } }, () => undefined); }
  commit();
}
let wanted: IndustryId | null = null;
/** Switches the edition. When its sample business has not been downloaded yet, the switch happens as soon as it arrives. */
export function switchPack(id: IndustryId) {
  if (id === prefs.pack) { wanted = null; return; }
  const saved = savedData(id, prefs.lang);
  if (!saved && !seedReady(id)) {
    wanted = id;
    void loadSeed(id).then(() => { if (wanted === id) switchPack(id); }, () => undefined);
    return;
  }
  wanted = null;
  prefs = { ...prefs, pack: id, viewAs: isWorkerView(prefs.viewAs) ? 'owner' : prefs.viewAs };
  data = saved ?? freshData(id, prefs.lang);
  runDaily(data, ctx());
  commit();
  if (!seedReady(id)) void loadSeed(id).catch(() => undefined);
}
/** Restores the sample business of the current edition, including the company name, logo and colours. */
export function resetDemo() {
  const id = prefs.pack;
  if (!seedReady(id)) { void loadSeed(id).then(() => { if (prefs.pack === id) resetDemo(); }, () => undefined); return; }
  storage.del(dataKey(id));
  prefs = { ...prefs, viewAs: 'owner' };
  data = freshData(id, prefs.lang);
  runDaily(data, ctx());
  commit();
}

/**
 * Resolves when the sample business of the selected edition is in memory; main.tsx waits for it before drawing anything.
 * A returning visitor's saved copy is used at once and the sample data arrives in the background (it is only needed again
 * for Reset or a language change). A first visit downloads the one edition being shown.
 */
export const ready: Promise<void> = (() => {
  const start = () => { runDaily(data, ctx()); commit(); };   // start-of-day automations for the edition that loads first
  const saved = savedData(prefs.pack, prefs.lang);
  if (saved) { data = saved; start(); void loadSeed(prefs.pack).catch(() => undefined); return Promise.resolve(); }
  return loadSeed(prefs.pack).then(() => { data = freshData(prefs.pack, prefs.lang); start(); });
})();
