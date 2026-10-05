// Who is signed in, when someone is. The sample workspaces (/demo, /preview) never have a session: there the viewer is whoever
// the "View as" control says. A live workspace gets its session from the server after sign-in (src/platform/gateway.ts).
// Kept free of imports so the id helper, the store and the pages can all ask without pulling anything else in.
import type { WorkspaceSession } from './gateway';

let current: WorkspaceSession | null = null;
const listeners = new Set<() => void>();

/** The signed-in person and their company, or null in a sample workspace and on the public pages. */
export const session = (): WorkspaceSession | null => current;
/** True when the records on screen come from the company's database. False for every sample workspace. */
export const isLive = (): boolean => current !== null && current.mode === 'workspace';
/** Set after sign-in and cleared on sign-out. Never called in a sample workspace. */
export function setSession(next: WorkspaceSession | null): void { current = next; listeners.forEach((l) => l()); }
/** Lets the interface redraw when someone signs in or out. */
export function onSession(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }

/**
 * Why the last session of this page ended, for the one sentence the sign-in page shows afterwards:
 *   signed_out  the person chose to sign out          idle     nothing happened for the company's idle time
 *   expired     the session reached its longest life  revoked  it was ended from elsewhere (sign out everywhere, a
 *                                                              password change, an owner ending the person's sessions)
 * `unsaved` is how many changes had not reached the server when it ended.
 */
export type SessionEndReason = 'signed_out' | 'idle' | 'expired' | 'revoked';
export interface SessionEnd { reason: SessionEndReason; unsaved: number }
let ended: SessionEnd | null = null;
export const sessionEnd = (): SessionEnd | null => ended;
export function setSessionEnd(next: SessionEnd | null): void { ended = next; listeners.forEach((l) => l()); }
