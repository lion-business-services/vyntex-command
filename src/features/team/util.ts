// Small helpers shared by Team, 1099 and compliance, Payments and the worker portal.
import type { TFn } from '@/i18n';
import type { DemoState, PayType, Worker, WorkerPayment } from '@/domain/types';
import { insuranceState } from '@/domain/selectors';
import { money2 } from '@/lib/money';

/** Pay type in the wording of the selected industry ("Per project" in BUILD, "Per job" in CLEAN). */
export const payTypeLabel = (t: TFn, type: PayType | undefined): string => (!type ? '' : type === 'project' ? t('team.pt.project') : t('pt_' + type));
/** "$250.00 per day", or an empty string when no rate is on file. */
export function rateLabel(t: TFn, type: PayType | undefined, rate: number | undefined): string {
  if (!rate || !type) return '';
  return t('team.ratePer', { rate: money2(rate), unit: type === 'project' ? t('team.pu.project') : t('pu_' + type) });
}

/** Paperwork problems that need someone's attention. A person with no certificate at all is not flagged, only an expired or expiring one. */
export type AttentionKind = 'w9' | 'expired' | 'soon';
export function attentionOf(w: Worker): AttentionKind[] {
  const out: AttentionKind[] = [];
  if (!w.w9) out.push('w9');
  const ins = insuranceState(w);
  if (ins === 'expired' || ins === 'soon') out.push(ins);
  return out;
}
export interface AttentionItem { worker: Worker; kind: AttentionKind }
/** Every open paperwork item of the active team, worst first. */
export function attentionItems(d: DemoState): AttentionItem[] {
  const rank: Record<AttentionKind, number> = { expired: 0, w9: 1, soon: 2 };
  return d.workers.filter((w) => w.active !== false).flatMap((w) => attentionOf(w).map((kind) => ({ worker: w, kind })))
    .sort((a, b) => rank[a.kind] - rank[b.kind] || a.worker.name.localeCompare(b.worker.name));
}

/** "Mar 1, 2026 to Mar 7, 2026" for a payment that covers a period, otherwise an empty string. */
export function periodText(t: TFn, p: Pick<WorkerPayment, 'from' | 'to'>, date: (d: string | undefined) => string): string {
  if (p.from && p.to) return p.from === p.to ? date(p.from) : t('team.period', { from: date(p.from), to: date(p.to) });
  return p.from || p.to ? date(p.from || p.to) : '';
}

/** Years that have worker payments, newest first, always including the current year. */
export function paymentYears(d: DemoState): number[] {
  const set = new Set<number>([new Date().getFullYear()]);
  for (const p of d.workerPays) { const y = Number(String(p.date).slice(0, 4)); if (y > 1990) set.add(y); }
  return [...set].sort((a, b) => b - a);
}

type Cell = string | number | null | undefined;
/** Amount for a spreadsheet: plain number with two decimals. */
export const csvAmount = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
function csvCell(v: Cell): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // a spreadsheet would run text that starts with one of these as a formula
  if (typeof v === 'string' && /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export const toCsv = (rows: Cell[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
/** Builds the file in the browser and hands it to the visitor as a download. Nothing is uploaded anywhere. */
export function downloadCsv(filename: string, rows: Cell[][]) {
  const url = URL.createObjectURL(new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
