// Business actions for Documents that the shared actions do not cover yet.
// E-signature here is a demo simulation: nothing is legally executed and no email is sent.
import type { DemoState, DocKind, DocRecord, Message } from '@/domain/types';
import type { Ctx } from '@/domain/context';
import { today } from '@/lib/dates';
import { composeMessage } from '@/features/messages/actions';
import { createDoc } from '@/domain/actions';

/** Creates the document with the shared `createDoc`, then makes sure its number is not already in use by another document. */
export function newDocument(d: DemoState, ctx: Ctx, jobId: string, kind: DocKind): { doc: DocRecord; created: boolean } | null {
  const known = new Set(d.docs.map((x) => x.id));
  const doc = createDoc(d, ctx, jobId, kind);
  if (!doc) return null;
  const created = !known.has(doc.id);
  if (created && d.docs.some((x) => x.id !== doc.id && x.number === doc.number)) {
    const tail = (n: string) => parseInt((n.match(/(\d+)$/) || ['', '0'])[1], 10) || 0;
    const top = Math.max(1000, ...d.docs.filter((x) => x.kind === kind && x.id !== doc.id).map((x) => tail(x.number)));
    doc.number = doc.number.replace(/\d+$/, '') + (top + 1);
  }
  return { doc, created };
}

/** Stores what the demo signing page collected. Call `advanceSignature(docId, 'signed')` right after. */
export function recordSignature(d: DemoState, _ctx: Ctx, docId: string, sig: { typedName: string; signature: string; consent: boolean }) {
  const doc = d.docs.find((x) => x.id === docId); if (!doc || !doc.esign) return;
  doc.esign.typedName = sig.typedName.trim(); doc.esign.signature = sig.signature; doc.esign.consent = sig.consent;
}
/** Removes the demo signature request, e.g. after the text changed. The document goes back to Draft. */
export function clearSignature(d: DemoState, _ctx: Ctx, docId: string) {
  const doc = d.docs.find((x) => x.id === docId); if (!doc) return;
  doc.esign = undefined; doc.status = 'draft'; doc.updated = today();
}
/** "Email to client": in the demo this prepares the message in Messages for review. Nothing is sent. */
export function prepareDocEmail(d: DemoState, ctx: Ctx, docId: string, mail: { to: string; subject: string; body: string }): Message | null {
  const doc = d.docs.find((x) => x.id === docId); if (!doc) return null;
  return composeMessage(d, ctx, { ...mail, ref: { type: 'job', id: doc.jobId } });
}
