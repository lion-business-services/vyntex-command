// Changes that have left the screen and are not acknowledged yet, kept in memory only (never in browser storage).
// Two small lists, shared by the store and the fetch code without either importing the other:
//
//   in flight   requests that were sent and not answered. Each has its idempotency key, so sending it again can never
//               apply it twice (the server answers a repeated key with the stored answer).
//   held        what was still unsaved when a session ended. If the same person signs in to the same company again
//               from this page, it is sent first, with the same keys. Closing or reloading the page discards it,
//               and so does anyone else signing in.
import type { Op } from '../diff';

export interface Batch { ops: Op[]; idem: string }
/** Thrown by the sync function when the session ended while a request was on its way. */
export class SessionEnded extends Error { constructor(public code: string) { super(code); this.name = 'SessionEnded'; } }
/** Thrown when the workspace closed while a request was waiting to be sent again. */
export class SyncCancelled extends Error { constructor() { super('cancelled'); this.name = 'SyncCancelled'; } }

/** A new idempotency key: 8 to 80 of A-Z a-z 0-9 _ - (api/ws.js). */
export const newKey = (): string => crypto.randomUUID();

const flying: Batch[] = [];
export const inFlight = (): Batch[] => [...flying];
export function track(b: Batch): void { flying.push(b); }
export function untrack(b: Batch): void { const i = flying.indexOf(b); if (i >= 0) flying.splice(i, 1); }
export function clearInFlight(): void { flying.length = 0; }

let held: { who: string; batches: Batch[] } | null = null;
/** `who` names the person and the company (sign-in email and company id), so only they get the changes back. */
export function hold(who: string, batches: Batch[]): void { held = batches.length ? { who, batches } : null; }
export const heldCount = (): number => (held ? held.batches.reduce((n, b) => n + b.ops.length, 0) : 0);
/** Hands the held changes over, once, to the person they belong to. Anyone else signing in drops them. */
export function takeHeld(who: string): Batch[] {
  const mine = held && held.who === who ? held.batches : [];
  held = null;
  return mine;
}
export const whoKey = (email: string | undefined, tenantId: string | null): string => `${(email ?? '').toLowerCase()}|${tenantId ?? ''}`;
