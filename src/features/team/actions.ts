// Paperwork changes for a worker. Both go through `saveWorker` and leave a line in the person's history.
import type { DemoState, ISODate, Worker } from '@/domain/types';
import { type Ctx, logActivity } from '@/domain/context';
import { saveWorker } from '@/domain/actions';

function patchWorker(d: DemoState, ctx: Ctx, workerId: string, patch: Partial<Worker>): Worker | null {
  const w = d.workers.find((x) => x.id === workerId); if (!w) return null;
  const { id, ...rest } = w;
  return saveWorker(d, ctx, { ...rest, ...patch }, id);
}

/** W-9 received on `date`, or back to missing when `date` is null. */
export function recordW9(d: DemoState, ctx: Ctx, workerId: string, date: ISODate | null) {
  if (!patchWorker(d, ctx, workerId, { w9: !!date, w9Date: date || undefined })) return;
  logActivity(d, ctx.actor, 'worker.doc', { type: 'worker', id: workerId });
}

/** New insurance certificate: expiry date and insurer. */
export function recordInsurance(d: DemoState, ctx: Ctx, workerId: string, coiExp: ISODate, insurer: string) {
  if (!patchWorker(d, ctx, workerId, { coiExp, insurer: insurer.trim() || undefined })) return;
  logActivity(d, ctx.actor, 'worker.doc', { type: 'worker', id: workerId });
}
