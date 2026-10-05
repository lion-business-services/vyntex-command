// The Export button of a list. The file holds what the list shows right now (the filters and the office rule already
// applied), so a person can never export more than they can see. Every export first goes through the gateway's
// `exportRequest`: that is where the capability is checked and where the export is written to the audit trail, on the
// server in a live workspace and in the sample trail otherwise. Tax IDs are never a column, not even their last digits.
import { useState } from 'react';
import { LuDownload } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Button, toast } from '@/ui';
import { gateway, type ExportKind } from '@/platform/gateway';
import { downloadCsv } from './csv';
import { stampToday } from './importer';

export function ExportButton({ kind, rows, testId }: {
  kind: Extract<ExportKind, 'clients' | 'leads'>;
  /** Header row first, then one row per record in the list as filtered. */
  rows: () => unknown[][];
  testId?: string;
}) {
  const { t, can } = useApp();
  const [busy, setBusy] = useState(false);
  if (!can('export')) return null;
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const table = rows();
      // an empty list is not an export: nothing is asked of the server and nothing is logged
      if (table.length < 2) { toast(t('data.exportNone'), true); return; }
      const out = await gateway().protected.exportRequest(kind);
      if (!out.ok) { toast(t(out.reason === 'not_allowed' ? 'data.exportNo' : 'data.exportFailed'), true); return; }
      downloadCsv(`${kind}-${stampToday()}.csv`, table);
      toast(t('data.exported', { n: table.length - 1 }));
    } catch { toast(t('data.exportFailed'), true); } finally { setBusy(false); }
  };
  return <Button icon={<LuDownload />} onClick={run} disabled={busy} title={t('data.exportHint')} data-testid={testId ?? `${kind}-export`}>{t('data.export')}</Button>;
}
