// The catalog as a spreadsheet: one line per price tier, the service repeated on each of its lines.
// Reading and writing the file itself is done by the shared helpers in src/features/data/csv.ts; this file only knows the columns.
import type { CatalogService, DemoState } from '@/domain/types';
import type { TFn } from '@/i18n';
import type { IndustryPack } from '@/packs/types';
import { type CatalogRow, type Service, playbookOf } from '@/domain/actions/catalog';
import { parseCsvRecords } from '@/features/data/csv';
import { parseMoney } from '@/lib/money';

/** Column names of the file. They stay in English in every language so a file made in one office opens in another. */
export const COLUMNS = ['category', 'service', 'service_es', 'description', 'description_es', 'code', 'repeats', 'active', 'tier', 'price', 'unit', 'note', 'playbook', 'documents', 'appointment_type', 'external_ids'] as const;
/** The columns an import reads. The rest are information: a playbook or an id of a connected system is never set from a file. */
export const IMPORT_COLUMNS = COLUMNS.slice(0, 12);
type Column = (typeof COLUMNS)[number];

/** Other ways people head the same columns, Spanish included. Compared without accents, spaces or capitals. */
const ALIASES: Record<string, Column> = {
  categoria: 'category', servicio: 'service', name: 'service', nombre: 'service', servicioes: 'service_es', nombrees: 'service_es', servicees: 'service_es', descripcion: 'description',
  descripciones: 'description_es', descriptiones: 'description_es', codigo: 'code', sku: 'code', serepite: 'repeats', repeat: 'repeats', frecuencia: 'repeats', activo: 'active', nivel: 'tier',
  tiername: 'tier', variation: 'tier', precio: 'price', unidad: 'unit', nota: 'note', notes: 'note',
};
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** Anything else, an empty cell included, means the service is active. */
const NO = new Set(['no', 'n', 'false', '0', 'retired', 'retirado', 'inactive', 'inactivo']);
const REPEAT_WORDS: Record<string, string> = { unavez: 'once', onetime: 'once', semanal: 'weekly', cadasemana: 'weekly', quincenal: 'biweekly', cada2semanas: 'biweekly', mensual: 'monthly', cadames: 'monthly', trimestral: 'quarterly', cadatrimestre: 'quarterly', anual: 'yearly', cadaano: 'yearly', annual: 'yearly' };
const UNIT_WORDS: Record<string, string> = { fixed: 'flat', fijo: 'flat', unico: 'flat', hora: 'hour', hourly: 'hour', mes: 'month', monthly: 'month', mensual: 'month', trimestre: 'quarter', quarterly: 'quarter', trimestral: 'quarter', ano: 'year', yearly: 'year', anual: 'year', annual: 'year' };

export interface ParsedCatalog { rows: CatalogRow[]; /** Columns of the file that were recognised. */ found: Column[]; /** Headings nobody recognised; they are ignored. */ unknown: string[]; missing: Column[] }

/** Reads a catalog file into rows. A category written as the name of one of the edition's service lines becomes that line. */
export function readCatalogCsv(text: string, pack: IndustryPack): ParsedCatalog {
  const { header, rows } = parseCsvRecords(text);
  const at: Partial<Record<Column, number>> = {}; const unknown: string[] = [];
  header.forEach((h, i) => {
    const k = norm(h); const col = (COLUMNS as readonly string[]).find((c) => norm(c) === k) as Column | undefined ?? ALIASES[k];
    if (col && at[col] === undefined) at[col] = i; else if (h) unknown.push(h);
  });
  const cell = (r: string[], c: Column) => (at[c] === undefined ? '' : (r[at[c] as number] ?? '').trim());
  const line = (id: string) => pack.serviceTypes.find((x) => [x.id, x.en, x.es, x.zh].some((v) => v && norm(v) === norm(id)))?.id;
  const out: CatalogRow[] = rows.map((r) => {
    const active = norm(cell(r, 'active')); const repeat = norm(cell(r, 'repeats')); const unit = norm(cell(r, 'unit')); const category = cell(r, 'category');
    return {
      category: line(category) ?? category, service: cell(r, 'service'), serviceEs: cell(r, 'service_es'), description: cell(r, 'description'), descriptionEs: cell(r, 'description_es'), code: cell(r, 'code'),
      repeat: REPEAT_WORDS[repeat] ?? repeat, active: !NO.has(active), tier: cell(r, 'tier'),
      // an empty price is zero (quoted for each client); text that is not a number is refused by the import
      price: cell(r, 'price') ? parseMoney(cell(r, 'price')) ?? NaN : 0, unit: UNIT_WORDS[unit] ?? unit, note: cell(r, 'note'),
    };
  });
  const found = (Object.keys(at) as Column[]);
  return { rows: out, found, unknown, missing: (['service'] as Column[]).filter((c) => at[c] === undefined) };
}

/** Rows for the file: the header and one line per tier. */
export function catalogCsvRows(d: DemoState, services: CatalogService[], t: TFn, pack: IndustryPack): unknown[][] {
  const out: unknown[][] = [[...COLUMNS]];
  const ext = (ids?: Record<string, string>) => Object.entries(ids ?? {}).map(([k, v]) => `${k}=${v}`).join('; ');
  for (const s of services as Service[]) {
    const category = pack.serviceTypes.some((x) => x.id === s.category) ? t('ty_' + s.category) : s.category;
    const appt = (d.apptTypes ?? []).find((a) => a.id === s.appointmentTypeId);
    for (const tier of s.tiers) {
      out.push([category, s.i18n?.en?.name || s.name, s.i18n?.es?.name ?? '', s.i18n?.en?.description || s.description || '', s.i18n?.es?.description ?? '', s.code ?? '', s.repeat ?? 'once', s.active,
        tier.name, tier.price, tier.unit, tier.note ?? '', playbookOf(d, s.playbookId)?.name ?? '', (s.docKinds ?? []).join('; '), appt ? appt.name.en : '', [ext(s.externalIds), ext(tier.externalIds)].filter(Boolean).join(' | ')]);
    }
  }
  return out;
}
