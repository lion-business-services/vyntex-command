// Storing a file someone picked: the type and the size are checked here first, so the person gets a plain reason
// instead of a failed upload. Files are private: the sample keeps them in this browser, a live workspace in private
// storage that is only ever read through a short-lived address.
import type { FileRef } from '@/domain/types';
import { gateway } from '@/platform/gateway';
import { ACCEPT_TYPES, uploadLimit } from '@/features/esign/prepare';

export type StoreProblem = 'too_large' | 'bad_type' | 'empty' | 'failed';
const BY_EXTENSION: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', txt: 'text/plain', csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
/** The type of a file: what the browser says, or what its extension says when the browser does not know. */
export const mimeOf = (file: Pick<File, 'name' | 'type'>): string => file.type || BY_EXTENSION[(file.name.split('.').pop() || '').toLowerCase()] || '';

export async function storeFile(file: File, where: { clientId?: string; jobId?: string; docId?: string; folder?: string }): Promise<{ ok: true; file: FileRef } | { ok: false; reason: StoreProblem }> {
  if (!file.size) return { ok: false, reason: 'empty' };
  if (file.size > uploadLimit()) return { ok: false, reason: 'too_large' };
  const mime = mimeOf(file);
  if (!ACCEPT_TYPES.includes(mime)) return { ok: false, reason: 'bad_type' };
  try {
    const out = await gateway().files.upload(file.type === mime ? file : new File([file], file.name, { type: mime }), where);
    if (!out.ok) return { ok: false, reason: out.reason === 'too_large' ? 'too_large' : 'failed' };
    return { ok: true, file: { ...out.data, mime: out.data.mime || mime } };
  } catch { return { ok: false, reason: 'failed' }; }
}
