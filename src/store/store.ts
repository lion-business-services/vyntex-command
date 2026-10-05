// The workspace state the pages read and change. Two ways of running:
//
//   sample   /demo (VYNTEX) and /preview (LBS review builds). One saved copy of a sample business per edition, kept in this
//            browser only. Nothing leaves it.
//   live     after sign-in. The records come from the company's database through the gateway (src/platform/gateway.ts),
//            are never written to browser storage, and every change is sent to the server right after it is made.
//
// The pages do not know which one is running: they use `useStore`, `act`, `mutate` and the selectors either way.
import { useSyncExternalStore } from 'react';
import type { DemoState, IndustryId, Lang, ModuleCollection, ViewAs } from '@/domain/types';
import type { PlanTier } from '@/lib/pricing';
import { PACKS, isIndustry } from '@/packs';
import type { IndustryPack } from '@/packs/types';
import { loadSeed, seedOf, seedReady } from '@/packs/seeds';
import { makeT, type TFn } from '@/i18n';
import type { Ctx } from '@/domain/context';
import { runDaily } from '@/domain/actions';
import { primeDemo } from '@/domain/automations';
import { can as roleCan } from '@/domain/config';
import { daysBetween, today } from '@/lib/dates';
import { isOfficeRole, isWorkerView, workerIdOf, type Permission } from '@/domain/permissions';
import { DEPLOY } from '@/config/deployment';
import { isLive, session, setSession } from '@/platform/session';
import { applyOps, diffState, rowsOf, APPEND_ONLY, COLLECTIONS, type CollectionId, type Op } from '@/platform/diff';
import type { ApplyResult, ServerPatch, SyncFn, WorkspaceData, WorkspaceSession } from '@/platform/gateway';
import { hold, inFlight, newKey, whoKey, SessionEnded, SyncCancelled } from '@/platform/live/carry';
import { resetSyncStatus, setSyncStatus, syncStatus } from '@/platform/live/status';
import { plansFor } from '@/lib/pricing';
import { toast } from '@/ui';

declare const __VX_DEPLOY__: string | undefined;

export const DATA_VERSION = 7;
// each deployment keeps its own entries, so a browser that has seen both never mixes them
const NS = DEPLOY.id === 'lbs' ? 'lbs' : 'vyntex';
const PREFS_KEY = `${NS}.prefs`;
const dataKey = (id: IndustryId) => `${NS}.demo.${id}`;
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

const offered = (lang: unknown): lang is Lang => typeof lang === 'string' && (DEPLOY.languages as string[]).includes(lang);
/** The edition this deployment starts in: the one it is locked to, or VYNTEX BUILD. */
const HOME_PACK: IndustryId = DEPLOY.lockedEdition ?? 'build';

function defaultPrefs(): Prefs {
  let lang: Lang = 'en';
  try { const nav = navigator.language?.toLowerCase().slice(0, 2); if (offered(nav)) lang = nav; } catch { /* keep English */ }
  return { lang, theme: 'dark', pack: HOME_PACK, viewAs: 'owner', planTier: 1, tourSeen: false };
}
function loadPrefs(): Prefs {
  const p = defaultPrefs();
  try { Object.assign(p, JSON.parse(storage.get(PREFS_KEY) || '{}')); } catch { /* ignore */ }
  try {
    const q = new URLSearchParams(location.search);
    const ind = q.get('industry'); if (isIndustry(ind)) p.pack = ind;
    const lang = q.get('lang'); if (offered(lang)) p.lang = lang;
  } catch { /* ignore */ }
  // a deployment with one edition never shows another, whatever the address or an old saved choice says
  if (DEPLOY.lockedEdition) p.pack = DEPLOY.lockedEdition;
  if (!isIndustry(p.pack)) p.pack = HOME_PACK;
  if (!offered(p.lang)) p.lang = 'en';
  if (!isWorkerView(p.viewAs) && !isOfficeRole(p.viewAs)) p.viewAs = 'owner';
  return p;
}

const MODULE_COLLECTIONS: ModuleCollection[] = ['offices', 'grants', 'accessRequests', 'catalog', 'playbooks', 'apptTypes', 'appointments', 'credits', 'crossSell', 'opportunities',
  'reviews', 'templates', 'envelopes', 'connections', 'posts', 'cash', 'cashCloses', 'complianceItems', 'rules', 'reveals', 'secureLog', 'audit'];
/** Every list a workspace has, empty. An edition that does not use a module simply leaves its list this way. */
function emptyCollections(): Pick<DemoState, ModuleCollection> {
  return Object.fromEntries(MODULE_COLLECTIONS.map((c) => [c, []])) as unknown as Pick<DemoState, ModuleCollection>;
}
/** What a new company of an edition starts with, before anyone configures anything: its appointment types and automations. */
function starters(pack: IndustryPack): Pick<DemoState, 'apptTypes' | 'rules'> {
  return {
    apptTypes: pack.appointmentTypes.map((a, i) => ({ ...a, id: 'at' + (i + 1) })),
    rules: pack.rules.map((r) => ({ ...r, when: { ...r.when }, if: r.if.map((c) => ({ ...c })), then: r.then.map((s) => ({ ...s, params: { ...s.params } })) })),
  };
}
/** The company shown in a sample workspace. The LBS review build shows its own name over the same fictional records. */
function sampleCompany(pack: IndustryPack) {
  // tested on the build constant itself so the other deployment's bundle does not carry this name
  if (typeof __VX_DEPLOY__ !== 'undefined' && __VX_DEPLOY__ === 'lbs') return { name: 'Lion Business Services', initials: 'LBS', license: '', phone: '', email: '' };
  return { ...pack.sampleCompany };
}

export function freshData(id: IndustryId, lang: Lang): DemoState {
  const pack = PACKS[id];
  const seed = seedOf(id)(lang);
  const d: DemoState = {
    v: DATA_VERSION, pack: id, seededOn: today(), seedLang: lang, touched: false, company: sampleCompany(pack),
    ...emptyCollections(), ...starters(pack), config: {}, ...seed,
    automation: { enabled: {}, runs: [] }, readNotifications: [], settings: {},
  };
  // a sample that brings no appointment types or rules of its own still gets the edition's
  if (!d.apptTypes.length) d.apptTypes = starters(pack).apptTypes;
  if (!d.rules.length) d.rules = starters(pack).rules;
  primeDemo(d, { pack, lang, t: makeT(lang, pack, d.config), actor: d.users[0]?.id ?? 'u1' });
  return d;
}
/** A workspace with no records at all: what is in memory before a sample is asked for, or while someone signs in. */
function blankData(id: IndustryId, lang: Lang): DemoState {
  const pack = PACKS[id];
  return {
    v: DATA_VERSION, pack: id, seededOn: today(), seedLang: lang, touched: false, company: { name: DEPLOY.productName, initials: '', license: '', phone: '', email: '' },
    users: [], leads: [], clients: [], jobs: [], tasks: [], workers: [], workerPays: [], docs: [], activity: [], messages: [],
    ...emptyCollections(), ...starters(pack), config: {}, automation: { enabled: {}, runs: [] }, readNotifications: [], settings: {},
  };
}
/** The copy this browser saved earlier, when it is still usable. */
function savedData(id: IndustryId, lang: Lang): DemoState | null {
  try {
    const d = JSON.parse(storage.get(dataKey(id)) || 'null') as DemoState | null;
    if (d && d.v === DATA_VERSION && d.pack === id && Array.isArray(d.jobs) && d.config && daysBetween(d.seededOn, today()) <= STALE_AFTER_DAYS && (d.touched || d.seedLang === lang)) return d;
  } catch { /* fall through to a fresh copy */ }
  return null;
}

let prefs = loadPrefs();
/** The choices of the sample workspace (edition, role, plan), set aside while a live workspace is open. Null otherwise. */
let samplePrefs: Prefs | null = null;
// Filled in before the first screen is drawn: see `ready` at the end of this file.
let data = null as unknown as DemoState;
let snapshot: Snapshot = { prefs, data };
const listeners = new Set<() => void>();

function commit(persistData = true) {
  snapshot = { prefs, data };
  // Someone signed in keeps their own choices (language, theme) in this browser. The edition, the role and the plan of a
  // live workspace belong to the company, so the choices saved for the sample workspace are left as they were.
  storage.set(PREFS_KEY, JSON.stringify(samplePrefs ? { ...samplePrefs, lang: prefs.lang, theme: prefs.theme } : prefs));
  // business records of a live workspace are never written to browser storage
  if (isLive()) { if (persistData) syncSoon(); }
  else if (persistData && sampleLoaded) storage.set(dataKey(data.pack), JSON.stringify(data));
  listeners.forEach((l) => l());
}

export const getSnapshot = () => snapshot;
export const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function useStore(): Snapshot { return useSyncExternalStore(subscribe, getSnapshot, getSnapshot); }

export const currentPack = () => PACKS[prefs.pack];
export const currentT = (): TFn => makeT(prefs.lang, currentPack(), data?.config);
/** Office user or worker the viewer is acting as. */
export function actorId(): string {
  const live = session(); if (live && isLive()) return live.actorId;
  if (isWorkerView(prefs.viewAs)) return workerIdOf(prefs.viewAs);
  return data.users.find((u) => u.role === prefs.viewAs && u.active !== false)?.id ?? data.users[0]?.id ?? 'u1';
}
export const ctx = (): Ctx => ({ pack: currentPack(), lang: prefs.lang, t: currentT(), actor: actorId() });

/**
 * Whether whoever is looking may do something. Office roles are resolved through the company's configuration; a field
 * worker in the portal holds no office capability but may record their own work, which is what `write` means there.
 */
export function viewerCan(p: Permission): boolean {
  if (isWorkerView(prefs.viewAs)) return p === 'write';
  return roleCan(data, currentPack(), prefs.viewAs, p);
}
/** Thrown when a change is attempted by someone who may not make it. The screens hide those controls; this is the backstop. */
export class NotAllowed extends Error { constructor(public need: Permission) { super(`This role cannot change records (${need}).`); this.name = 'NotAllowed'; } }
function refuse(need: Permission): never { toast(currentT()('common.readOnly'), true); throw new NotAllowed(need); }

/**
 * Runs a change against the data and saves it. Usage: `act(setJobStatus, jobId, 'done')` or `mutate(d => { … })`.
 * A viewer who lacks `write` (or the capability named in `need`) is refused: a notice is shown and nothing changes.
 */
export function mutate(fn: (d: DemoState) => void, need: Permission = 'write') {
  if (!viewerCan(need)) refuse(need);
  fn(data);
  data = { ...data, touched: true };
  commit();
}
/** Like `mutate`, for housekeeping that should not count as the visitor changing the sample business (e.g. marking a notification read). */
export function mutateQuiet(fn: (d: DemoState) => void) { fn(data); data = { ...data }; commit(); }
export function act<A extends unknown[], R>(action: (d: DemoState, c: Ctx, ...args: A) => R, ...args: A): R {
  if (!viewerCan('write')) refuse('write');
  const out = action(data, ctx(), ...args);
  data = { ...data, touched: true };
  commit();
  return out;
}
export function setPrefs(patch: Partial<Prefs>) {
  // someone signed in is who the server says they are: the role cannot be switched from the browser
  if (isLive()) { const { viewAs: _role, pack: _pack, ...rest } = patch; patch = rest; }
  if (patch.lang && !offered(patch.lang)) patch = { ...patch, lang: prefs.lang };
  prefs = { ...prefs, ...patch };
  commit(false);
}
/** Changes the language. The sample business is rebuilt in the new language unless the visitor already changed something. */
export function setLanguage(lang: Lang) {
  if (lang === prefs.lang || !offered(lang)) return;
  prefs = { ...prefs, lang };
  if (isLive() || !sampleLoaded) { commit(false); return; }
  const rebuild = () => { if (prefs.lang === lang && !data.touched && data.seedLang !== lang) { data = freshData(prefs.pack, lang); runDaily(data, ctx()); data.touched = false; } };
  if (seedReady(prefs.pack)) rebuild();
  else { const id = prefs.pack; void loadSeed(id).then(() => { if (prefs.pack === id) { rebuild(); commit(); } }, () => undefined); }
  commit();
}
let wanted: IndustryId | null = null;
/** Switches the edition. When its sample business has not been downloaded yet, the switch happens as soon as it arrives. */
export function switchPack(id: IndustryId) {
  // not in a deployment that has one edition, and never in a live workspace: the edition belongs to the company
  if (DEPLOY.lockedEdition || isLive() || !isIndustry(id)) return;
  if (id === prefs.pack && sampleLoaded) { wanted = null; return; }
  const saved = savedData(id, prefs.lang);
  if (!saved && !seedReady(id)) {
    wanted = id;
    void loadSeed(id).then(() => { if (wanted === id) switchPack(id); }, () => undefined);
    return;
  }
  wanted = null;
  // "read only" exists in every edition, so only a worker view has to go back to the owner
  prefs = { ...prefs, pack: id, viewAs: isWorkerView(prefs.viewAs) ? 'owner' : prefs.viewAs };
  data = saved ?? freshData(id, prefs.lang);
  sampleLoaded = true;
  runDaily(data, ctx());
  commit();
  if (!seedReady(id)) void loadSeed(id).catch(() => undefined);
}
/** Restores the sample business of the current edition, including the company name, logo and colours. */
export function resetDemo() {
  if (isLive()) return;
  const id = prefs.pack;
  if (!seedReady(id)) { void loadSeed(id).then(() => { if (prefs.pack === id) resetDemo(); }, () => undefined); return; }
  storage.del(dataKey(id));
  prefs = { ...prefs, viewAs: 'owner' };
  data = freshData(id, prefs.lang);
  sampleLoaded = true;
  runDaily(data, ctx());
  commit();
}

/* ---------- sample workspaces ---------- */

/** True once a sample business is in memory. False on the sign-in pages and in a live workspace. */
let sampleLoaded = false;
let sampleLoading: Promise<void> | null = null;
/**
 * Puts the sample business of the selected edition in memory. A returning visitor's saved copy is used at once and the
 * sample data arrives in the background (it is only needed again for Reset or a language change). A first visit
 * downloads the one edition being shown.
 */
export function loadSample(): Promise<void> {
  if (sampleLoaded) return Promise.resolve();
  if (sampleLoading) return sampleLoading;
  const start = () => { sampleLoaded = true; runDaily(data, ctx()); commit(); };   // start-of-day automations for the edition that loads first
  const saved = savedData(prefs.pack, prefs.lang);
  if (saved) { data = saved; start(); void loadSeed(prefs.pack).catch(() => undefined); return Promise.resolve(); }
  sampleLoading = loadSeed(prefs.pack).then(() => { data = freshData(prefs.pack, prefs.lang); start(); }).finally(() => { sampleLoading = null; });
  return sampleLoading;
}
export const hasSample = () => sampleLoaded;

/* ---------- live workspaces ---------- */

/** The last copy of the data the server acknowledged. What `syncSoon` compares against. Never changed in place. */
let acked: DemoState | null = null;
let syncFn: SyncFn | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let busy = false;
let again = false;
/** Lists the server said this workspace does not have yet. What is typed there stays on screen and out of the queue. */
let unavailable = new Set<string>();
const SYNC_DELAY_MS = 350;
const clone = <T,>(v: T): T => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
type Rows = { id: string; updatedAt?: string }[];
const listOf = (d: DemoState, c: string): Rows => rowsOf(d, c as CollectionId);
function withList(d: DemoState, c: string, rows: Rows): DemoState {
  if (c === 'automationRuns' || c === 'runs') return { ...d, automation: { ...d.automation, runs: rows as unknown as DemoState['automation']['runs'] } };
  return { ...d, [c]: rows } as DemoState;
}
const initialsOf = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/** The workspace the pages read, from what the server returned. Every list the pages expect is there, even when empty. */
function liveData(live: WorkspaceData): DemoState {
  const blank = blankData(prefs.pack, prefs.lang);
  const d = { ...blank, ...live, pack: prefs.pack, touched: true } as DemoState;
  const lists = d as unknown as Record<string, unknown>;
  for (const c of COLLECTIONS) if (!Array.isArray(lists[c])) lists[c] = [];
  d.automation = { enabled: { ...(live.automation?.enabled ?? {}) }, runs: Array.isArray(live.automation?.runs) ? live.automation.runs : [] };
  d.readNotifications = Array.isArray(live.readNotifications) ? live.readNotifications : [];
  d.config = live.config ?? {}; d.settings = live.settings ?? {};
  d.company = { ...blank.company, ...(live.company ?? {}) };
  if (!d.company.initials) d.company.initials = initialsOf(d.company.name);
  // Automations: the rules the edition ships, each in the company's own version once the company has changed it, then the
  // rules the company wrote itself. A shipped rule is switched off, never removed, so it cannot go missing by accident.
  // Appointment types are the company's own records and are shown as the server has them.
  const own = new Map(d.rules.map((r) => [r.id, r]));
  d.rules = [...blank.rules.map((r) => own.get(r.id) ?? r), ...d.rules.filter((r) => !blank.rules.some((b) => b.id === r.id))];
  return d;
}

/**
 * Starts a live workspace: the records the server returned, who is signed in, and the function that sends changes back.
 * From here on nothing is read from or written to browser storage except the viewer's own preferences (language, theme).
 */
export function bootLive(live: WorkspaceData, who: WorkspaceSession, sync: SyncFn): void {
  clearTimeout(timer); busy = false; again = false; unavailable = new Set();
  samplePrefs ??= prefs;
  setSession(who);
  const role: ViewAs = who.role === 'worker' ? `worker:${who.actorId}` : who.role;
  const pack = DEPLOY.lockedEdition ?? who.industry;
  // the plan is the company's: the plan picker of the demo has no say here
  const tier = plansFor(pack).find((p) => p.id === who.planId)?.tier;
  prefs = { ...prefs, pack, viewAs: role, lang: who.lang && offered(who.lang) ? who.lang : prefs.lang, planTier: tier ?? prefs.planTier };
  data = liveData(live);
  acked = clone(data);
  syncFn = sync;
  sampleLoaded = false;
  resetSyncStatus();
  commit(false);
}
/** The person's role or name changed while the workspace was open (an owner changed it): the screens follow at once. */
export function updateLiveSession(who: WorkspaceSession): void {
  if (!isLive()) return;
  setSession(who);
  prefs = { ...prefs, viewAs: who.role === 'worker' ? `worker:${who.actorId}` : who.role };
  commit(false);
}
/** Ends the live workspace (sign-out, or the session ran out): the records leave memory. */
export function endLive(): void {
  clearTimeout(timer); syncFn = null; acked = null; busy = false; again = false; unavailable = new Set();
  setSession(null);
  // back to the choices this browser had for the sample workspace, keeping the language and theme chosen meanwhile
  prefs = samplePrefs ? { ...samplePrefs, lang: prefs.lang, theme: prefs.theme } : { ...prefs, viewAs: 'owner' };
  samplePrefs = null;
  data = blankData(prefs.pack, prefs.lang);
  resetSyncStatus();
  commit(false);
}
/**
 * Puts a newer copy from the server on screen (the background check of src/platform/live/workspace.ts), so what a
 * colleague changed shows up without a reload. Only when nothing of this person's is waiting: a change in progress is
 * never overwritten. Returns false when it was not the moment.
 */
export function refreshLive(live: WorkspaceData): boolean {
  if (!acked || !isLive() || busy || hasUnsaved()) return false;
  let fresh = liveData(live);
  // what was typed into a part this workspace does not have yet exists on this screen only: it stays
  for (const c of unavailable) if (COLLECTIONS.includes(c as (typeof COLLECTIONS)[number])) fresh = withList(fresh, c, listOf(data, c));
  if (JSON.stringify(fresh) === JSON.stringify(data)) return true;
  data = fresh;
  acked = clone(fresh);
  commit(false);
  return true;
}

function mergeRows<T extends { id: string }>(cur: T[], rows: { id: string }[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r as T]));
  const out = cur.map((r) => { const hit = byId.get(r.id); if (hit) byId.delete(r.id); return hit ?? r; });
  return [...out, ...byId.values()];
}
/** One state with the server's rows merged in by id and its single parts replaced. Lists are rebuilt, never changed in place. */
function patched(d: DemoState, patch: ServerPatch, keep?: (c: string, id: string) => boolean): DemoState {
  let next: DemoState = { ...d };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null) continue;
    if (key === 'company' || key === 'config' || key === 'settings') { (next as unknown as Record<string, unknown>)[key] = clone(value); continue; }
    if (key === 'readNotifications') { next.readNotifications = [...(value as string[])]; continue; }
    if (key === 'automation') { const a = value as Partial<DemoState['automation']>; next.automation = { enabled: { ...(a.enabled ?? next.automation.enabled) }, runs: a.runs?.length ? mergeRows(next.automation.runs, a.runs) : next.automation.runs }; continue; }
    if (!Array.isArray(value)) continue;
    const rows = (value as { id: string }[]).filter((r) => !keep || !keep(key, r.id));
    if (key === 'runs' || key === 'automationRuns' || Array.isArray((next as unknown as Record<string, unknown>)[key])) next = withList(next, key, mergeRows(listOf(next, key), clone(rows)));
  }
  return next;
}
/** Merges rows the server sent (after a change, or pushed later) into the data and into the acknowledged copy. */
export function applyServer(patch: ServerPatch): void {
  data = patched(data, patch);
  if (acked) acked = patched(acked, patch);
  commit(false);
}

/** Sends what changed since the server's last acknowledgement, shortly after the change. Several quick changes travel together. */
export function syncSoon(): void {
  if (!syncFn || !isLive()) return;
  if (syncStatus().state === 'saved') setSyncStatus({ state: 'saving' });
  clearTimeout(timer);
  timer = setTimeout(() => { void runSync(); }, SYNC_DELAY_MS);
}
/** Sends now, without the short wait: the "try again" of the indicator, and before leaving the workspace. */
export function syncNow(): void { if (syncFn && isLive()) { clearTimeout(timer); void runSync(); } }

const versionless = (key: string, value: unknown) => (key === 'updatedAt' ? undefined : value);
const sameRow = (a: unknown, b: unknown): boolean => JSON.stringify(a, versionless) === JSON.stringify(b, versionless);

/**
 * Takes the server's answer to a request in:
 *   written rows    become the acknowledged copy, with the version the server gave them
 *   refused rows    go back to the server's copy on screen (a new row disappears, a removed row returns), with one message
 *   not there yet   a list this workspace does not have: the row stays on screen, the list leaves the queue, one notice
 *   server rows     what the database stored differently (a number it assigned, a stamped author) replaces the row,
 *                   unless the person has already changed that row again
 */
function absorb(ops: Op[], res: ApplyResult): void {
  if (!acked) return;
  const before = acked;
  const refused = new Map(res.rejected.map((r) => [r.c + '\n' + r.id, r]));
  const accepted: Op[] = []; const lost: ApplyResult['rejected'] = []; const missing: string[] = [];
  let cur = data;
  for (const op of ops) {
    const no = refused.get(op.c + '\n' + op.id);
    if (!no) { accepted.push(op); continue; }
    if (no.reason === 'not_ready' || no.reason === 'unknown_collection') { if (!unavailable.has(op.c)) { unavailable.add(op.c); missing.push(op.c); } continue; }
    lost.push(no);
    // back to the server's copy
    if (op.c === 'company' || op.c === 'config' || op.c === 'settings') { cur = { ...cur, [op.c]: clone(before[op.c]) }; continue; }
    if (op.c === 'readNotifications') { cur = { ...cur, readNotifications: [...before.readNotifications] }; continue; }
    if (op.c === 'automation') { const enabled = { ...cur.automation.enabled }; if (op.id in before.automation.enabled) enabled[op.id] = before.automation.enabled[op.id]; else delete enabled[op.id]; cur = { ...cur, automation: { ...cur.automation, enabled } }; continue; }
    const was = listOf(before, op.c); const at = was.findIndex((r) => r.id === op.id);
    const rows = listOf(cur, op.c).filter((r) => r.id !== op.id);
    if (at >= 0) rows.splice(Math.min(at, rows.length), 0, clone(was[at]));
    cur = withList(cur, op.c, rows);
  }
  acked = applyOps(before, accepted, res.versions);
  // the version of a row that was written goes onto the row on screen, so the next change to it carries it
  for (const [c, byId] of Object.entries(res.versions ?? {})) for (const row of listOf(cur, c)) { const v = byId[row.id]; if (v) row.updatedAt = v; }
  data = cur;
  if (res.server) {
    const sent = new Map(accepted.filter((o) => o.op === 'upsert').map((o) => [o.c + '\n' + o.id, (o as { row: unknown }).row]));
    // a row the person changed again while the request was out keeps their newer text; it is sent with the next request
    const changedSince = (c: string, id: string): boolean => { const was = sent.get(c + '\n' + id); const now = listOf(data, c).find((r) => r.id === id); return was !== undefined && now !== undefined && !sameRow(was, now); };
    data = patched(data, res.server, changedSince);
    acked = patched(acked, res.server);
  } else data = { ...data };
  if (missing.length) setSyncStatus({ unavailable: [...unavailable] });
  const t = currentT();
  if (lost.length) {
    const reason = t('auth.sync.reason.' + lost[0].reason);
    const worded = reason === 'auth.sync.reason.' + lost[0].reason ? t('auth.sync.reason.other') : reason;
    toast(lost.length === 1 ? t('auth.sync.rejected', { reason: worded }) : t('auth.sync.rejectedMany', { n: lost.length, reason: worded }), true);
  }
  if (missing.length) toast(t('auth.sync.notReady'), true);
  commit(false);
}

async function runSync(): Promise<void> {
  if (!syncFn || !acked) return;
  if (busy) { again = true; return; }
  const ops = diffState(acked, data, { skip: unavailable });
  if (!ops.length) { setSyncStatus({ state: 'saved', pending: 0 }); return; }
  busy = true;
  const fn = syncFn;
  setSyncStatus({ state: syncStatus().state === 'offline' ? 'offline' : 'saving', pending: records(ops) });
  try {
    const res = await fn(ops);
    if (syncFn !== fn || !acked) return;   // signed out, or another workspace opened, while the request was on its way
    absorb(ops, res);
    const left = records(diffState(acked, data, { skip: unavailable }));
    setSyncStatus({ state: left ? 'saving' : 'saved', pending: left });
    if (left) again = true;
  } catch (e) {
    // the session ended or the workspace closed: whoever closed it has already dealt with what was unsaved
    if (e instanceof SessionEnded || e instanceof SyncCancelled || syncFn !== fn) return;
    // the server refused the whole request: repeating it would not help, so it waits for the person
    setSyncStatus({ state: 'problem', detail: 'refused' });
    toast(currentT()('auth.sync.problemHint'), true);
  } finally {
    busy = false;
    if (again) { again = false; if (syncFn === fn) syncSoon(); }
  }
}
/** What a person would call a change: a record, not the history line or the automation note written along with it. */
const records = (ops: Op[]): number => { const n = ops.filter((o) => !APPEND_ONLY.includes(o.c as CollectionId)).length; return n || (ops.length ? 1 : 0); };
/** How many changes on screen the server has not acknowledged yet. */
export const unsavedCount = (): number => (acked ? records(diffState(acked, data, { skip: unavailable })) : 0);
/** True while there are changes the server has not acknowledged yet. */
export const hasUnsaved = (): boolean => unsavedCount() > 0;
/**
 * Called when a session ends with changes still unsaved: they are set aside in memory, requests already on their way
 * first (with their keys, so a repeat cannot apply them twice), then everything made since. Returns how many.
 */
export function parkUnsaved(): number {
  if (!acked) return 0;
  const stuck = inFlight();
  const base = stuck.length ? applyOps(acked, stuck.flatMap((b) => b.ops)) : acked;
  const rest = diffState(base, data, { skip: unavailable });
  hold(whoKey(session()?.email, session()?.tenantId ?? null), [...stuck, ...(rest.length ? [{ ops: rest, idem: newKey() }] : [])]);
  return records([...stuck.flatMap((b) => b.ops), ...rest]);
}

/**
 * Resolves when there is something to draw; main.tsx waits for it before drawing anything. On a sample address that is the
 * sample business of the selected edition. Everywhere else (the sales pages are the exception, they show the sample too)
 * it is an empty workspace: the sign-in page needs no records, and a live workspace gets its own after sign-in.
 */
export function boot(wantsSample: boolean): Promise<void> {
  data = blankData(prefs.pack, prefs.lang);
  snapshot = { prefs, data };
  const done = wantsSample ? loadSample() : Promise.resolve();
  void done.then(markReady, () => undefined);
  return done;
}
let markReady: () => void = () => undefined;
/** Resolves once `boot` has finished: there is data to draw. Kept for code that waits on the store without starting it. */
export const ready: Promise<void> = new Promise((resolve) => { markReady = resolve; });
