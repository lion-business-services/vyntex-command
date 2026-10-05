// How the last change of a live workspace stands. One small value the store and the fetch code write and the workspace
// frame reads, so a person always knows whether what is on screen is in the database.
// A sample workspace never touches this: there the answer is always "saved" and `live` is false.
import { useSyncExternalStore } from 'react';
import type { SyncState } from '../gateway';
import { isLive, onSession } from '../session';

export interface SyncStatus {
  state: SyncState;
  /** False in a sample workspace and on the public pages: draw no indicator there. */
  live: boolean;
  /** Changes made on screen that the server has not acknowledged yet. */
  pending: number;
  /** When the server last acknowledged a change, as an ISO time. Null before the first change of this visit. */
  savedAt: string | null;
  /** With `problem`: a short code the screen words (`session`, `refused`, `too_large`). */
  detail?: string;
  /** Collections the server said this workspace does not have yet (their screens can say what is typed there is not saved). */
  unavailable: readonly string[];
}

const idle: SyncStatus = { state: 'saved', live: false, pending: 0, savedAt: null, unavailable: [] };
let current: SyncStatus = idle;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const syncStatus = (): SyncStatus => current;
/** Written by the store (how much is waiting) and by the fetch code (whether the server can be reached). */
export function setSyncStatus(patch: Partial<Omit<SyncStatus, 'live'>>): void {
  const next = { ...current, ...patch, live: isLive() };
  if (next.state === 'saved' && current.state !== 'saved') next.savedAt = new Date().toISOString();
  if (next.state !== 'problem') delete next.detail;
  if (next.state === current.state && next.pending === current.pending && next.detail === current.detail && next.live === current.live && next.unavailable === current.unavailable && next.savedAt === current.savedAt) return;
  current = next; emit();
}
/** Back to the quiet state: a workspace opened or closed. */
export function resetSyncStatus(): void { current = { ...idle, live: isLive() }; emit(); }
// signing in or out changes `live` without any change being made
onSession(() => { if (current.live !== isLive()) { current = isLive() ? { ...current, live: true } : idle; emit(); } });

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
/**
 * For the workspace frame: `const { state, live, pending } = useSyncStatus()`. Draw nothing when `live` is false.
 * `SyncIndicator` in src/features/auth/live.tsx is a ready-made drawing of it.
 */
export function useSyncStatus(): SyncStatus { return useSyncExternalStore(subscribe, syncStatus, syncStatus); }
