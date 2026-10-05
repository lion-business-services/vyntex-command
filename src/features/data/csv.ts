// Reading and writing CSV files, shared by every import and export in the workspace.
// A CSV file looks simple and is not: a cell may hold commas, quotes and line breaks, a file saved by Excel starts with an
// invisible mark, and Excel in Spanish separates cells with semicolons. This file handles those cases in one place so no
// module writes its own split(',').
// No dependencies and no browser calls except in `downloadCsv`, so the parser and the writer run in a Node test too.

/** The separators a spreadsheet program may use. */
export type Delimiter = ',' | ';' | '\t';
export interface ParseOptions {
  /** Force a separator. Left out, it is worked out from the first line. */
  delimiter?: Delimiter;
  /** Keep rows in which every cell is empty. They are dropped by default. */
  keepEmptyRows?: boolean;
}
export interface WriteOptions {
  delimiter?: Delimiter;
  /** Start the text with the mark Excel needs to read accents correctly. `downloadCsv` adds it by itself. */
  bom?: boolean;
  /** Line ending. Excel expects the Windows one, which is the default. */
  eol?: '\r\n' | '\n';
}

const BOM = '\uFEFF';

/**
 * Which separator a file uses: the one that appears most often in its first line, outside quotes.
 * A file with one column has none, and reads as comma separated.
 */
export function detectDelimiter(text: string): Delimiter {
  const counts: Record<Delimiter, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && (ch === ',' || ch === ';' || ch === '\t')) counts[ch]++;
  }
  // a comma wins a tie: it is the standard
  return counts[';'] > counts[','] && counts[';'] >= counts['\t'] ? ';' : counts['\t'] > counts[','] ? '\t' : ',';
}

/**
 * Turns CSV text into rows of cells. Follows the usual rules (RFC 4180) and forgives what real files get wrong:
 * a quote in the middle of an unquoted cell is kept as typed, a quoted cell that never closes takes the rest of the file,
 * and any of the three line endings is accepted. Cells are returned exactly as written, apart from the quoting.
 */
export function parseCsv(text: string, options: ParseOptions = {}): string[][] {
  if (!text) return [];
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const sep = options.delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = []; let cell = ''; let quoted = false;
  /** True once the current cell started with a quote, so `"",` reads as an empty cell and not as the end of nothing. */
  let wasQuoted = false;
  const endCell = () => { row.push(cell); cell = ''; wasQuoted = false; };
  const endRow = () => { endCell(); if (options.keepEmptyRows || row.some((c) => c !== '')) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') { cell += ch; continue; }
      // two quotes in a row inside a quoted cell are one quote
      if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      continue;
    }
    if (ch === '"' && cell === '' && !wasQuoted) { quoted = true; wasQuoted = true; continue; }
    if (ch === sep) { endCell(); continue; }
    if (ch === '\r') { if (text[i + 1] === '\n') i++; endRow(); continue; }
    if (ch === '\n') { endRow(); continue; }
    cell += ch;
  }
  // the last line of a file often has no line ending
  if (cell !== '' || wasQuoted || row.length) endRow();
  return rows;
}

/** The first row as column names and the rest as records, for a file with a header line. */
export function parseCsvRecords(text: string, options: ParseOptions = {}): { header: string[]; rows: string[][] } {
  const [header = [], ...rows] = parseCsv(text, options);
  return { header: header.map((h) => h.trim()), rows };
}

/**
 * A spreadsheet program runs a cell that starts with `=`, `+`, `-` or `@` as a formula. A value typed by a stranger into a
 * web form must never be run, so such a cell gets a leading apostrophe, which the spreadsheet shows as plain text.
 * A plain number or a phone number that starts with a sign is left alone: it is not a formula.
 */
function defuse(s: string): string {
  if (!/^[=+\-@\t\r]/.test(s)) return s;
  if (/^[+-][\d\s().,-]*$/.test(s)) return s;
  return "'" + s;
}
function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString();
  return defuse(String(v));
}

/** Turns rows of values into CSV text. The first row is normally the column names. */
export function toCsv(rows: unknown[][], options: WriteOptions = {}): string {
  const sep = options.delimiter ?? ','; const eol = options.eol ?? '\r\n';
  const needsQuotes = new RegExp(`["\\r\\n${sep === '\t' ? '\\t' : sep}]|^\\s|\\s$`);
  const line = (r: unknown[]) => r.map((v) => { const s = cellText(v); return needsQuotes.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(sep);
  return (options.bom ? BOM : '') + rows.map(line).join(eol) + (rows.length ? eol : '');
}

/**
 * Hands a CSV file to the browser to save. `content` is rows of values, or text that is already CSV.
 * The file starts with the mark Excel needs, so names with accents open correctly there.
 */
export function downloadCsv(fileName: string, content: unknown[][] | string): void {
  const text = typeof content === 'string' ? content : toCsv(content);
  const blob = new Blob([text.startsWith(BOM) ? text : BOM + text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = /\.csv$/i.test(fileName) ? fileName : fileName + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  // the browser needs the address for a moment after the click
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Reads a file the person picked as text. Files saved by Excel as "CSV UTF-8" and as plain "CSV" both read correctly. */
export async function readCsvFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  // not UTF-8: an older Excel on Windows saves in its own Western encoding, where accents are single bytes
  catch { return new TextDecoder('windows-1252').decode(bytes); }
}
