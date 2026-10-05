// Small pieces shared by the office screens (petty cash, deadlines, payments, licensing): a dollar field that reads what a
// person types, a file picker that stores through the gateway, a viewer for a stored file, and the export of a table.
import { useState, type ReactNode } from 'react';
import { LuDownload, LuPaperclip } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Button, Modal, toast } from '@/ui';
import { gateway, type ExportKind } from '@/platform/gateway';
import type { FileRef } from '@/domain/types';
import { parseMoney } from '@/lib/money';
import { today } from '@/lib/dates';
import { downloadCsv } from '@/features/data/csv';
import '@/features/leads/work.css';
import './cash.css';

/**
 * A dollar amount as text while it is being typed ("1,250.50", "$40"), so the person is never fought by the field.
 * Read the number with `parseMoney(value)`; it is null until what is typed is an amount.
 */
export function MoneyInput({ value, onChange, id, invalid, testId, autoFocus, label }: { value: string; onChange: (v: string) => void; id?: string; invalid?: boolean; testId?: string; autoFocus?: boolean; label?: string }) {
  return (
    <span className="ops-money">
      <span aria-hidden="true">$</span>
      <input id={id} type="text" inputMode="decimal" autoComplete="off" value={value} placeholder="0.00" aria-invalid={invalid || undefined} aria-label={label} data-testid={testId} data-autofocus={autoFocus || undefined}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.,$ ]/g, ''))}
        onBlur={() => { const n = parseMoney(value); if (n !== null && n >= 0) onChange(n.toFixed(2)); }} />
    </span>
  );
}

/** Why a file could not be stored, in words. */
const uploadProblem = (reason: string) => (reason === 'too_large' ? 'cash.file.tooLarge' : reason === 'not_allowed' ? 'cash.file.notAllowed' : 'cash.file.failed');

/**
 * Picks one file and stores it through the gateway: private storage in a live workspace, this browser in a sample one.
 * Shows the stored file's name with a way to take it off again.
 */
export function FilePick({ file, onChange, where, label, testId }: { file?: FileRef; onChange: (f: FileRef | undefined) => void; where: { clientId?: string; jobId?: string; folder?: string }; label: string; testId?: string }) {
  const { t } = useApp();
  const [busy, setBusy] = useState(false);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const out = await gateway().files.upload(f, where);
      if (out.ok) onChange(out.data); else toast(t(uploadProblem(out.reason)), true);
    } catch { toast(t('cash.file.failed'), true); } finally { setBusy(false); }
  };
  return (
    <div className="ops-file team-file">
      {file ? (
        <span className="row tight"><LuPaperclip aria-hidden="true" /><span className="clip small strong">{file.name}</span><button type="button" className="linkbtn small" onClick={() => onChange(undefined)}>{t('cash.file.remove')}</button></span>
      ) : (
        <input type="file" accept="image/*,application/pdf" aria-label={label} disabled={busy} data-testid={testId} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
      )}
      {busy && <span className="xs muted" role="status">{t('cash.file.storing')}</span>}
    </div>
  );
}

/** Opens a stored file: a picture is shown, anything else is offered to save. The address is asked for only when it is opened. */
export function FileLink({ file, children, title }: { file: FileRef; children?: ReactNode; title: string }) {
  const { t } = useApp();
  const [url, setUrl] = useState<string | null>(null);
  const open = async () => {
    try { const out = await gateway().files.url(file); if (out.ok) setUrl(out.data); else toast(t('cash.file.gone'), true); } catch { toast(t('cash.file.gone'), true); }
  };
  return (
    <>
      <button type="button" className="linkbtn small ops-filelink" onClick={() => { void open(); }} title={file.name}><LuPaperclip aria-hidden="true" />{children ?? file.name}</button>
      {url && (
        <Modal title={title} onClose={() => setUrl(null)} labelClose={t('common.close')} footer={<a className="btn" href={url} download={file.name}><LuDownload aria-hidden="true" />{t('common.download')}</a>}>
          {file.mime.startsWith('image/') ? <img className="ops-fileimg" src={url} alt={file.name} /> : <p className="muted">{file.name}</p>}
        </Modal>
      )}
    </>
  );
}

/**
 * Downloads a table as a CSV file. Exports are for people who hold the `export` capability. When the table is one of the
 * kinds the server audits (payments, tasks, ...), the export is announced first so it lands in the audit trail.
 * Returns false when nothing was downloaded.
 */
export async function exportTable(t: (k: string, p?: Record<string, string | number>) => string, name: string, rows: unknown[][], kind?: ExportKind): Promise<boolean> {
  if (rows.length < 2) { toast(t('cash.export.none'), true); return false; }
  if (kind) {
    try { const out = await gateway().protected.exportRequest(kind); if (!out.ok) { toast(t(out.reason === 'not_allowed' ? 'cash.export.no' : 'cash.export.failed'), true); return false; } }
    catch { toast(t('cash.export.failed'), true); return false; }
  }
  downloadCsv(`${name}-${today()}.csv`, rows);
  toast(t('cash.export.done', { n: rows.length - 1 }));
  return true;
}
/** The Export button of an office screen. Draws nothing for a person who may not export. */
export function ExportCsv({ name, rows, kind, testId, size }: { name: string; rows: () => unknown[][]; kind?: ExportKind; testId: string; size?: 'sm' }) {
  const { t, can } = useApp();
  if (!can('export')) return null;
  return <Button size={size} icon={<LuDownload aria-hidden="true" />} onClick={() => { void exportTable(t, name, rows(), kind); }} data-testid={testId}>{t('cash.export')}</Button>;
}
