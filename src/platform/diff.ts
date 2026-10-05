// What changed between two copies of a workspace, as a list of small operations the server can apply one by one.
// The live store keeps the last copy the server acknowledged; after every change it compares the current data with that
// copy and sends the difference (src/store/store.ts, syncSoon). Pure: no DOM, no network, no store.
//
// The operations are the ones the database gateway understands (docs/DATABASE.md, section 7):
//   a list row          { c: '<collection>', op: 'upsert' | 'delete', id, row }
//   a single part       { c: 'company' | 'config' | 'settings', op: 'upsert', id: <same name>, row: <the whole record> }
//   read notifications  { c: 'readNotifications', op: 'upsert', id: 'readNotifications', row: { ids } }
//   an automation       { c: 'automation', op: 'upsert', id: <rule id>, row: { enabled } }
//   automation history  the collection `automationRuns` (it loads inside data.automation.runs)
import type { DemoState } from '@/domain/types';

/** Lists whose rows have an `id`: every list of the workspace except the read marks. */
export const COLLECTIONS = [
  'users', 'leads', 'clients', 'jobs', 'tasks', 'workers', 'workerPays', 'docs', 'activity', 'messages',
  'offices', 'grants', 'accessRequests', 'catalog', 'playbooks', 'apptTypes', 'appointments', 'credits', 'crossSell', 'opportunities', 'reviews', 'templates',
  'envelopes', 'connections', 'posts', 'cash', 'cashCloses', 'complianceItems', 'rules', 'reveals', 'secureLog', 'audit',
] as const;
/** `automationRuns` is the automation history (data.automation.runs). `runs` is its older name, still accepted when rows come back. */
export type CollectionId = (typeof COLLECTIONS)[number] | 'automationRuns' | 'runs';
/** Parts of the workspace that are one record, not a list. */
export const SINGLES = ['company', 'config', 'settings'] as const;
export type SingleId = (typeof SINGLES)[number];

/**
 * Lists the server keeps itself. The browser shows them and never sends them: people, grants, credits, connections, the
 * tax ID requests and their log and the audit trail change only through the protected operations (src/platform/gateway.ts).
 */
export const READ_ONLY: readonly CollectionId[] = ['audit', 'secureLog', 'reveals', 'credits', 'connections', 'grants', 'users'];
/** History: a new entry is sent, an entry that exists is never changed or removed (the browser trims its own copy only). */
export const APPEND_ONLY: readonly CollectionId[] = ['activity', 'automationRuns'];
/**
 * The order rows are written in, so a record arrives before the records that point at it: reference lists first, then
 * people and clients, the work, what hangs off the work, and history last. Removals travel after every write, in the
 * opposite order. The database sorts a request the same way; this matters when a large change is split over requests.
 */
export const APPLY_ORDER: readonly CollectionId[] = [
  'offices', 'catalog', 'playbooks', 'apptTypes', 'templates', 'workers', 'clients', 'leads', 'jobs', 'tasks', 'workerPays', 'docs', 'messages',
  'appointments', 'opportunities', 'crossSell', 'reviews', 'envelopes', 'posts', 'cash', 'cashCloses', 'complianceItems', 'rules', 'accessRequests',
  'activity', 'automationRuns',
];

/**
 * Fields the server owns: it sets them, returns them, and ignores them on the way in. A difference in one of them is never
 * a change to send (the tax ID markers of a client, signature evidence, what a provider reported about a message).
 */
const SERVER_FIELDS: Partial<Record<string, readonly string[]>> = {
  clients: ['taxIdType', 'taxIdLast4'], docs: ['esign'], messages: ['provider', 'externalId', 'error'],
};

export type Op =
  | { c: CollectionId; op: 'upsert'; id: string; row: Record<string, unknown> }
  | { c: CollectionId; op: 'delete'; id: string }
  /** A single-row part: the whole record is sent. `id` repeats the name so every operation has one. */
  | { c: SingleId; op: 'upsert'; id: SingleId; row: Record<string, unknown> }
  /** Which notifications the person signed in has read. */
  | { c: 'readNotifications'; op: 'upsert'; id: 'readNotifications'; row: { ids: string[] } }
  /** One automation switched on or off. `id` is the rule. */
  | { c: 'automation'; op: 'upsert'; id: string; row: { enabled: boolean } };

type Row = { id: string; updatedAt?: string };
type State = Partial<Pick<DemoState, (typeof COLLECTIONS)[number] | SingleId | 'automation' | 'readNotifications'>>;

export const rowsOf = (d: State, c: CollectionId): Row[] => ((c === 'automationRuns' || c === 'runs' ? d.automation?.runs : d[c as (typeof COLLECTIONS)[number]]) as Row[] | undefined) ?? [];

/** `updatedAt` is the version the server gave a row. It travels with the row and is never a change by itself. */
const dropVersion = (key: string, value: unknown) => (key === 'updatedAt' ? undefined : value);
/** A row as text, without what the server owns: two rows that read the same here need no operation. */
function comparable(c: string, row: Row): string {
  const owned = SERVER_FIELDS[c];
  if (!owned) return JSON.stringify(row, dropVersion);
  const rest: Record<string, unknown> = { ...row };
  for (const k of owned) delete rest[k];
  return JSON.stringify(rest, dropVersion);
}
// The acknowledged copy is never changed in place (the store replaces its lists), so its rows are read as text once.
const indexCache = new WeakMap<object, Map<string, string>>();
function indexOf(c: string, rows: Row[], keep: boolean): Map<string, string> {
  const hit = keep ? indexCache.get(rows) : undefined;
  if (hit) return hit;
  const made = new Map(rows.map((r) => [r.id, comparable(c, r)]));
  if (keep) indexCache.set(rows, made);
  return made;
}
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
/** The company configuration without the turn of the lead rotation, which belongs to the database. */
function configText(config: unknown): string {
  const c = (config ?? {}) as { routing?: Record<string, unknown> };
  if (!c.routing || !('cursor' in c.routing)) return JSON.stringify(c);
  const { cursor: _turn, ...routing } = c.routing;
  return JSON.stringify({ ...c, routing });
}
/** The workspace settings without the 1099 consent record, which only the consent operation writes. */
function settingsText(settings: unknown): string {
  const { consent1099: _consent, ...rest } = (settings ?? {}) as Record<string, unknown>;
  return JSON.stringify(rest);
}
const singleText = (c: SingleId, v: unknown): string => (c === 'config' ? configText(v) : c === 'settings' ? settingsText(v) : JSON.stringify(v ?? {}));

export interface DiffOptions {
  /** Collections to leave out: the ones the server said this workspace does not have yet. */
  skip?: ReadonlySet<string>;
}

/**
 * Operations that turn `prev` into `next`. Single parts first, then an upsert for every row that is new or different in
 * the order of APPLY_ORDER, the automation switches, then a delete for every row that is gone, in the opposite order.
 * Rows are compared by value, so a row that was rebuilt but reads the same produces nothing. Each operation carries its own
 * copy of the row, with the version the server last gave it, so later changes on screen do not alter what was sent.
 * `prev` must not be changed in place afterwards (it is the copy the server acknowledged).
 */
export function diffState(prev: State, next: State, options: DiffOptions = {}): Op[] {
  const skip = options.skip;
  const ops: Op[] = [];
  for (const c of SINGLES) {
    if (skip?.has(c)) continue;
    const b = next[c];
    if (b !== undefined && singleText(c, prev[c]) !== singleText(c, b)) ops.push({ c, op: 'upsert', id: c, row: copy(b) as unknown as Record<string, unknown> });
  }
  if (!skip?.has('readNotifications') && next.readNotifications && JSON.stringify(prev.readNotifications ?? []) !== JSON.stringify(next.readNotifications)) {
    ops.push({ c: 'readNotifications', op: 'upsert', id: 'readNotifications', row: { ids: [...next.readNotifications] } });
  }
  const deletes: Op[] = [];
  for (const c of APPLY_ORDER) {
    if (skip?.has(c)) continue;
    const before = rowsOf(prev, c); const after = rowsOf(next, c);
    if (before === after) continue;
    const was = indexOf(c, before, true);
    const versions = new Map(before.map((r) => [r.id, r.updatedAt]));
    const appendOnly = APPEND_ONLY.includes(c);
    const seen = new Set<string>();
    for (const row of after) {
      seen.add(row.id);
      const old = was.get(row.id);
      if (old !== undefined && (appendOnly || old === comparable(c, row))) continue;
      const sent = copy(row) as Row & Record<string, unknown>;
      // an action that rebuilt the row may have dropped its version: it goes back so the server can tell a stale edit
      const version = row.updatedAt ?? versions.get(row.id);
      if (version) sent.updatedAt = version;
      ops.push({ c, op: 'upsert', id: row.id, row: sent });
    }
    if (!appendOnly) for (const id of was.keys()) if (!seen.has(id)) deletes.push({ c, op: 'delete', id });
  }
  if (!skip?.has('automation')) {
    const a = prev.automation?.enabled ?? {}; const b = next.automation?.enabled ?? {};
    for (const [rule, enabled] of Object.entries(b)) if (a[rule] !== enabled) ops.push({ c: 'automation', op: 'upsert', id: rule, row: { enabled } });
  }
  return [...ops, ...deletes.reverse()];
}

/**
 * A copy of `state` with the operations applied, the way the server applies them: what the acknowledged copy becomes once a
 * request was accepted. `versions` are the row versions the server answered with. Nothing of `state` is changed in place:
 * every list that is touched is a new list, and rows that are written are the operations' own copies.
 */
export function applyOps<S extends State>(state: S, ops: readonly Op[], versions: Record<string, Record<string, string>> = {}): S {
  const next: Record<string, unknown> = { ...state };
  const puts = new Map<string, Map<string, Row>>();
  const drops = new Map<string, Set<string>>();
  for (const o of ops) {
    if (o.c === 'company' || o.c === 'config' || o.c === 'settings') { next[o.c] = copy((o as { row: unknown }).row); continue; }
    if (o.c === 'readNotifications') { next.readNotifications = [...(o as { row: { ids: string[] } }).row.ids]; continue; }
    if (o.c === 'automation') {
      const a = (next.automation ?? { enabled: {}, runs: [] }) as NonNullable<State['automation']>;
      next.automation = { ...a, enabled: { ...a.enabled, [o.id]: (o as { row: { enabled: boolean } }).row.enabled } };
      continue;
    }
    if (o.op === 'delete') { (drops.get(o.c) ?? drops.set(o.c, new Set()).get(o.c)!).add(o.id); puts.get(o.c)?.delete(o.id); continue; }
    const version = versions[o.c]?.[o.id];
    const row = { ...copy(o.row), ...(version ? { updatedAt: version } : {}) } as Row;
    (puts.get(o.c) ?? puts.set(o.c, new Map()).get(o.c)!).set(o.id, row);
    drops.get(o.c)?.delete(o.id);
  }
  for (const c of new Set([...puts.keys(), ...drops.keys()])) {
    const put = new Map(puts.get(c) ?? []); const drop = drops.get(c) ?? new Set<string>();
    const rows: Row[] = [];
    for (const r of rowsOf(next as State, c as CollectionId)) {
      if (drop.has(r.id)) continue;
      const hit = put.get(r.id);
      if (hit) { rows.push(hit); put.delete(r.id); } else rows.push(r);
    }
    rows.push(...put.values());
    if (c === 'automationRuns' || c === 'runs') { const a = (next.automation ?? { enabled: {}, runs: [] }) as NonNullable<State['automation']>; next.automation = { ...a, runs: rows as typeof a.runs }; }
    else next[c] = rows;
  }
  return next as S;
}
