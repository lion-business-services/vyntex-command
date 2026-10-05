// Bringing clients or leads in from a CSV file, in steps the person can check: match the columns, look at what each row
// would become, see which rows are wrong and which people are already on file, and only then write anything.
// This file is the logic, with no screen in it: `autoMap`, `planImport` (the dry run, writes nothing) and `applyImport`.
// The rules follow the office's earlier system: a row needs a name and a way to reach the person; someone already on file
// (same email, same phone, same id in a connected system) is skipped unless the person importing decides otherwise;
// tax IDs are never read from a file, whatever the column is called.
import type { Client, DemoState, Lang, Lead, Note, OptionDef, Priority, TeamUser } from '@/domain/types';
import type { Ctx } from '@/domain/context';
import { logActivity } from '@/domain/context';
import type { IndustryPack } from '@/packs/types';
import { clientTypesOf, firstStage, routingOf, sourcesOf, stagesOf } from '@/domain/config';
import { clientIndex, findClientMatches, isLikelyDuplicate, normEmail, normName, normPhone } from '@/domain/actions/clients';
import { assignNextLead, nextTicket } from '@/domain/actions/leads';
import { nowIso, today, toISODate } from '@/lib/dates';
import { parseMoney } from '@/lib/money';
import { uid } from '@/lib/id';
import { dict } from './i18n';

export type ImportKind = 'clients' | 'leads';
type FieldType = 'text' | 'email' | 'phone' | 'date' | 'money' | 'bool' | 'lang' | 'kind' | 'priority' | 'lifecycle' | 'clientType' | 'source' | 'stage' | 'service' | 'office' | 'person';
export interface ImportField {
  key: string;
  /** Dictionary key of the name shown in the column picker. */
  labelKey: string;
  type: FieldType;
  /** Column names that mean this field, in English and Spanish, already in the normal form of `headerKey`. */
  aliases: string[];
  /** Shown in the template file as the example value. */
  sample?: string;
}

/** A column name in a form that compares well: lowercase, no accents, words separated by single spaces. */
export const headerKey = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const PERSON: ImportField[] = [
  { key: 'name', labelKey: 'data.f.name', type: 'text', aliases: ['name', 'full name', 'client', 'client name', 'contact', 'contact name', 'lead', 'lead name', 'nombre', 'nombre completo', 'cliente', 'contacto', 'prospecto'], sample: 'Jordan Sample' },
  { key: 'firstName', labelKey: 'data.f.firstName', type: 'text', aliases: ['first name', 'first', 'given name', 'primer nombre', 'nombres', 'nombre de pila'] },
  { key: 'lastName', labelKey: 'data.f.lastName', type: 'text', aliases: ['last name', 'last', 'surname', 'family name', 'apellido', 'apellidos'] },
  { key: 'company', labelKey: 'data.f.company', type: 'text', aliases: ['company', 'company name', 'business', 'business name', 'organization', 'empresa', 'negocio', 'nombre del negocio', 'nombre de la empresa', 'razon social', 'compania'], sample: 'Sample Company LLC' },
  { key: 'email', labelKey: 'data.f.email', type: 'email', aliases: ['email', 'e mail', 'email address', 'mail', 'correo', 'correo electronico'], sample: 'jordan@example.com' },
  { key: 'phone', labelKey: 'data.f.phone', type: 'phone', aliases: ['phone', 'phone number', 'telephone', 'tel', 'mobile', 'cell', 'cell phone', 'telefono', 'celular', 'movil', 'numero de telefono'], sample: '609-555-0100' },
  { key: 'address', labelKey: 'data.f.address', type: 'text', aliases: ['address', 'street', 'street address', 'address line 1', 'address 1', 'direccion', 'domicilio', 'calle'], sample: '1 Sample Street' },
  { key: 'address2', labelKey: 'data.f.address2', type: 'text', aliases: ['address line 2', 'address 2', 'apt', 'suite', 'unit', 'direccion 2', 'apartamento', 'interior'] },
  { key: 'city', labelKey: 'data.f.city', type: 'text', aliases: ['city', 'town', 'ciudad', 'municipio'], sample: 'Northfield' },
  { key: 'state', labelKey: 'data.f.state', type: 'text', aliases: ['state', 'province', 'estado', 'provincia'], sample: 'NJ' },
  { key: 'zip', labelKey: 'data.f.zip', type: 'text', aliases: ['zip', 'zip code', 'postal code', 'postcode', 'codigo postal', 'cp'], sample: '08225' },
  { key: 'kind', labelKey: 'data.f.kind', type: 'kind', aliases: ['kind', 'client kind', 'individual or business', 'persona o empresa', 'tipo de persona'], sample: 'individual' },
  { key: 'lang', labelKey: 'data.f.lang', type: 'lang', aliases: ['language', 'preferred language', 'lang', 'idioma', 'idioma preferido'], sample: 'en' },
  { key: 'office', labelKey: 'data.f.office', type: 'office', aliases: ['office', 'location', 'branch', 'oficina', 'sucursal'] },
  { key: 'smsOptIn', labelKey: 'data.f.smsOptIn', type: 'bool', aliases: ['sms opt in', 'text opt in', 'sms', 'texts', 'text messages', 'acepta sms', 'acepta mensajes', 'acepta mensajes de texto', 'mensajes de texto'], sample: 'no' },
  { key: 'note', labelKey: 'data.f.note', type: 'text', aliases: ['note', 'notes', 'comment', 'comments', 'nota', 'notas', 'comentario', 'comentarios', 'observaciones'] },
];
const only = (keys: string[]) => PERSON.filter((f) => keys.includes(f.key));

const CLIENT_FIELDS: ImportField[] = [
  ...only(['name', 'firstName', 'lastName', 'company', 'email', 'phone', 'address', 'address2', 'city', 'state', 'zip', 'kind']),
  { key: 'clientType', labelKey: 'data.f.clientType', type: 'clientType', aliases: ['type', 'client type', 'entity type', 'tipo', 'tipo de cliente', 'tipo de entidad'] },
  ...only(['lang']),
  { key: 'birthday', labelKey: 'data.f.birthday', type: 'date', aliases: ['birthday', 'birth date', 'date of birth', 'dob', 'cumpleanos', 'fecha de nacimiento', 'nacimiento'] },
  { key: 'since', labelKey: 'data.f.since', type: 'date', aliases: ['client since', 'since', 'customer since', 'start date', 'cliente desde', 'desde', 'fecha de alta'] },
  ...only(['office']),
  { key: 'assignedTo', labelKey: 'data.f.assignedTo', type: 'person', aliases: ['assigned to', 'assigned', 'responsible', 'account manager', 'asignado a', 'responsable', 'atendido por', 'lo atiende'] },
  { key: 'lifecycle', labelKey: 'data.f.lifecycle', type: 'lifecycle', aliases: ['status', 'lifecycle', 'client status', 'estatus', 'situacion', 'estado del cliente'], sample: 'active' },
  { key: 'tags', labelKey: 'data.f.tags', type: 'text', aliases: ['tags', 'labels', 'etiquetas'] },
  { key: 'referredBy', labelKey: 'data.f.referredBy', type: 'text', aliases: ['referred by', 'referral', 'referido por', 'recomendado por'] },
  { key: 'emailOptOut', labelKey: 'data.f.emailOptOut', type: 'bool', aliases: ['email opt out', 'no email', 'do not email', 'unsubscribed', 'sin correos', 'no enviar correo', 'no enviar correos'], sample: 'no' },
  ...only(['smsOptIn']),
  { key: 'whatsappOptIn', labelKey: 'data.f.whatsappOptIn', type: 'bool', aliases: ['whatsapp opt in', 'acepta whatsapp'] },
  { key: 'whatsapp', labelKey: 'data.f.whatsapp', type: 'phone', aliases: ['whatsapp', 'whatsapp number', 'numero de whatsapp'] },
  { key: 'facebook', labelKey: 'data.f.facebook', type: 'text', aliases: ['facebook'] },
  { key: 'instagram', labelKey: 'data.f.instagram', type: 'text', aliases: ['instagram'] },
  { key: 'squareId', labelKey: 'data.f.squareId', type: 'text', aliases: ['square customer id', 'square id', 'square'] },
  { key: 'quickbooksId', labelKey: 'data.f.quickbooksId', type: 'text', aliases: ['quickbooks customer id', 'quickbooks id', 'quickbooks', 'qbo id'] },
  ...only(['note']),
];
const LEAD_FIELDS: ImportField[] = [
  ...only(['name', 'firstName', 'lastName', 'company', 'email', 'phone', 'address', 'address2', 'city', 'state', 'zip']),
  { key: 'source', labelKey: 'data.f.source', type: 'source', aliases: ['source', 'lead source', 'how they found us', 'origen', 'fuente', 'como nos encontro'], sample: 'referral' },
  { key: 'sourceDetail', labelKey: 'data.f.sourceDetail', type: 'text', aliases: ['source detail', 'detail', 'campaign', 'referred by', 'detalle', 'detalle del origen', 'campana', 'referido por'] },
  { key: 'type', labelKey: 'data.f.service', type: 'service', aliases: ['service', 'service type', 'service line', 'service needed', 'servicio', 'tipo de servicio', 'linea de servicio'] },
  { key: 'value', labelKey: 'data.f.value', type: 'money', aliases: ['value', 'estimated value', 'deal value', 'amount', 'valor', 'valor estimado', 'monto'] },
  { key: 'pri', labelKey: 'data.f.priority', type: 'priority', aliases: ['priority', 'prioridad'] },
  { key: 'status', labelKey: 'data.f.stage', type: 'stage', aliases: ['stage', 'status', 'lead status', 'etapa', 'estatus', 'estado del prospecto'] },
  { key: 'ownerId', labelKey: 'data.f.owner', type: 'person', aliases: ['owner', 'assigned to', 'assignee', 'responsable', 'asignado a'] },
  { key: 'nextAction', labelKey: 'data.f.nextAction', type: 'text', aliases: ['next action', 'next step', 'proxima accion', 'proximo paso', 'siguiente paso'] },
  { key: 'nextDue', labelKey: 'data.f.nextDue', type: 'date', aliases: ['next action due', 'next action date', 'due', 'due date', 'follow up', 'follow up date', 'fecha del proximo paso', 'fecha de seguimiento', 'seguimiento', 'vence'] },
  { key: 'created', labelKey: 'data.f.created', type: 'date', aliases: ['created', 'received', 'date', 'created at', 'date received', 'fecha', 'recibido', 'fecha de recibido', 'creado'] },
  ...only(['kind', 'lang', 'office', 'smsOptIn', 'note']),
];
export const importFields = (kind: ImportKind): ImportField[] => (kind === 'clients' ? CLIENT_FIELDS : LEAD_FIELDS);

/** Columns that look like a tax ID. They are never imported: a tax ID goes into the protected store, one client at a time. */
const SECURE = ['ssn', 'ein', 'itin', 'tin', 'tax id', 'taxid', 'tax id number', 'tax number', 'social security', 'social security number', 'seguro social', 'numero de seguro social', 'id fiscal', 'identificacion fiscal', 'rfc', 'nif'];
export const isSecureColumn = (header: string): boolean => { const k = headerKey(header); return SECURE.includes(k) || /\b(ssn|itin|ein|tin)\b/.test(k) || k.includes('tax id') || k.includes('seguro social'); };

/** The names a field goes by: its own name on screen in each language (so a template or an export reads back in), then its aliases. */
const namesOf = (f: ImportField): string[] => [headerKey(f.key), headerKey(dict.en[f.labelKey] ?? ''), headerKey(dict.es[f.labelKey] ?? ''), ...f.aliases];
/**
 * For each column of the file, the field it most likely is ('' = leave it out). A field is used once. A column whose name
 * is exactly what the field is called on screen is matched before a column that only uses another word for it.
 */
export function autoMap(header: string[], kind: ImportKind): string[] {
  const fields = importFields(kind); const used = new Set<string>();
  const out = header.map(() => '');
  const keys = header.map((h) => (isSecureColumn(h) ? '' : headerKey(h)));
  for (const exact of [true, false]) {
    keys.forEach((k, col) => {
      if (!k || out[col]) return;
      const f = fields.find((x) => !used.has(x.key) && (exact ? namesOf(x).slice(0, 3).includes(k) : x.aliases.includes(k)));
      if (f) { used.add(f.key); out[col] = f.key; }
    });
  }
  return out;
}
/** The example row of the template, left in the file by mistake. It is recognised by its note, in either language. */
const isExampleRow = (note: unknown): boolean => typeof note === 'string' && [dict.en['data.tpl.example'], dict.es['data.tpl.example']].includes(note.trim());

/* ---------- reading a value ---------- */
const YES = ['yes', 'y', 'true', '1', 'x', 'si', 's', 'verdadero', 'opt in', 'opted in'];
const NO = ['no', 'n', 'false', '0', 'falso', 'opt out', 'opted out'];
const LANGS: Record<string, Lang> = { en: 'en', eng: 'en', english: 'en', ingles: 'en', es: 'es', spa: 'es', spanish: 'es', espanol: 'es', castellano: 'es', zh: 'zh', chinese: 'zh', chino: 'zh', mandarin: 'zh', '中文': 'zh' };
const KINDS: Record<string, 'individual' | 'business'> = { individual: 'individual', person: 'individual', persona: 'individual', personal: 'individual', business: 'business', company: 'business', empresa: 'business', negocio: 'business' };
const PRIORITIES: Record<string, Priority> = { high: 'high', alta: 'high', urgent: 'high', urgente: 'high', medium: 'medium', media: 'medium', normal: 'medium', low: 'low', baja: 'low' };
const LIFECYCLES: Record<string, NonNullable<Client['lifecycle']>> = { active: 'active', activo: 'active', activa: 'active', inactive: 'inactive', inactivo: 'inactive', inactiva: 'inactive', former: 'former', anterior: 'former', antiguo: 'former', 'ex cliente': 'former' };

const pad = (n: number) => String(n).padStart(2, '0');
/** YYYY-MM-DD, or month/day/year the way a US spreadsheet writes it. Returns '' for a date that does not exist. */
export function readDate(s: string): string {
  const v = s.trim(); let y = 0, m = 0, d = 0;
  let hit = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(v);
  if (hit) { y = +hit[1]; m = +hit[2]; d = +hit[3]; }
  else if ((hit = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(v))) { m = +hit[1]; d = +hit[2]; y = +hit[3]; if (y < 100) y += y > 30 ? 1900 : 2000; }
  else return '';
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? `${y}-${pad(m)}-${pad(d)}` : '';
}
/** An option by its id or by its label in any language, however it is typed. */
function findOption(list: OptionDef[], v: string): string | undefined {
  const k = headerKey(v);
  return list.find((o) => headerKey(o.id) === k || headerKey(o.label.en) === k || headerKey(o.label.es) === k || (o.label.zh && o.label.zh === v.trim()))?.id;
}

export type IssueCode = 'no_name' | 'no_contact' | 'email' | 'phone' | 'date' | 'money' | 'bool' | 'option' | 'person' | 'office';
export interface ImportIssue { field: string; code: IssueCode; value?: string }
export interface ImportDuplicate { where: 'client' | 'lead' | 'file'; id?: string; name: string; by: string; /** Line of the file that holds the same person, for a repeat inside the file. */ line?: number; /** The match is a record of another office: the name is all the person may see. */ restricted?: boolean }
export interface PlanRow {
  /** Line in the file, counting the header as line 1. */
  line: number;
  raw: string[];
  /** What the row would become. Fields the file did not have are absent. */
  values: Record<string, string | number | boolean | undefined>;
  status: 'new' | 'duplicate' | 'invalid';
  issues: ImportIssue[];
  duplicate?: ImportDuplicate;
}
export interface ImportPlan {
  kind: ImportKind;
  header: string[];
  mapping: string[];
  rows: PlanRow[];
  counts: { total: number; fresh: number; duplicate: number; invalid: number; /** Example rows of the template that were left in the file and are ignored. */ examples: number };
  /** Columns left out because they look like tax IDs. */
  secureColumns: string[];
}
export interface ImportWorld { data: DemoState; pack: IndustryPack; user: TeamUser | undefined; /** The person importing may see every client, whatever the office. */ allClients: boolean; /** Clients the person may open (for saying whether a match is theirs to see). */ canSee?: (c: Client) => boolean }

/**
 * The dry run. Reads every row through the column mapping, checks it, and looks for the same person among the records on
 * file and earlier in the same file. Writes nothing.
 */
export function planImport(world: ImportWorld, kind: ImportKind, header: string[], rows: string[][], mapping: string[]): ImportPlan {
  const { data: d, pack } = world;
  const fields = new Map(importFields(kind).map((f) => [f.key, f]));
  const types = clientTypesOf(d, pack); const sources = sourcesOf(d, pack); const stages = stagesOf(d, pack);
  const services: OptionDef[] = pack.serviceTypes.map((s) => ({ id: s.id, label: { en: s.en, es: s.es, ...(s.zh ? { zh: s.zh } : {}) } }));
  const person = (v: string) => { const k = headerKey(v); return d.users.find((u) => u.active !== false && (headerKey(u.name) === k || u.email.toLowerCase() === v.trim().toLowerCase() || u.id === v.trim())); };
  const office = (v: string) => { const k = headerKey(v); return d.offices.find((o) => headerKey(o.name) === k || o.id === v.trim() || headerKey(o.name).startsWith(k + ' ')); };
  const index = clientIndex(d.clients);
  const leadEmails = new Map<string, Lead>(); const leadPhones = new Map<string, Lead>();
  if (kind === 'leads') for (const l of d.leads) { const e = normEmail(l.email); if (e) leadEmails.set(e, l); const p = normPhone(l.phone); if (p.length >= 7) leadPhones.set(p, l); }
  const seenEmail = new Map<string, number>(); const seenPhone = new Map<string, number>();
  const out: PlanRow[] = [];
  const noteCol = mapping.indexOf('note'); let examples = 0;

  rows.forEach((raw, i) => {
    if (noteCol >= 0 && isExampleRow(raw[noteCol])) { examples++; return; }
    const line = i + 2; const values: PlanRow['values'] = {}; const issues: ImportIssue[] = [];
    mapping.forEach((key, col) => {
      const f = fields.get(key); const v = (raw[col] ?? '').trim();
      if (!f || !v) return;
      const bad = (code: IssueCode) => { issues.push({ field: key, code, value: v.slice(0, 60) }); };
      switch (f.type) {
        case 'email': if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) values[key] = v; else bad('email'); break;
        case 'phone': if (v.replace(/\D/g, '').length >= 7) values[key] = v; else bad('phone'); break;
        case 'date': { const date = readDate(v); if (date) values[key] = date; else bad('date'); break; }
        case 'money': { const n = parseMoney(v); if (n !== null && n >= 0) values[key] = n; else bad('money'); break; }
        case 'bool': { const k = headerKey(v); if (YES.includes(k)) values[key] = true; else if (NO.includes(k)) values[key] = false; else bad('bool'); break; }
        case 'lang': { const lang = LANGS[headerKey(v)] ?? LANGS[v]; if (lang) values[key] = lang; else bad('option'); break; }
        case 'kind': { const k = KINDS[headerKey(v)]; if (k) values[key] = k; else bad('option'); break; }
        case 'priority': { const p = PRIORITIES[headerKey(v)]; if (p) values[key] = p; else bad('option'); break; }
        case 'lifecycle': { const s = LIFECYCLES[headerKey(v)]; if (s) values[key] = s; else bad('option'); break; }
        case 'clientType': { const id = findOption(types, v); if (id) values[key] = id; else if (types.length) bad('option'); break; }
        case 'source': { const id = findOption(sources, v); if (id) values[key] = id; else bad('option'); break; }
        case 'stage': { const id = findOption(stages, v); if (id) values[key] = id; else bad('option'); break; }
        case 'service': { const id = findOption(services, v); if (id) values[key] = id; else bad('option'); break; }
        case 'office': { const o = office(v); if (o) values[key] = o.id; else bad('office'); break; }
        case 'person': { const u = person(v); if (u) values[key] = u.id; else bad('person'); break; }
        default: values[key] = v;
      }
    });
    // a file with first and last name in two columns
    if (!values.name) { const joined = [values.firstName, values.lastName].filter(Boolean).join(' ').trim(); if (joined) values.name = joined; }
    delete values.firstName; delete values.lastName;
    // a business with no contact person is filed under its own name
    if (!values.name && values.company) values.name = values.company;
    const where = [values.address, values.address2].filter(Boolean).join(', ');
    const region = [values.city, [values.state, values.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const address = [where, region].filter(Boolean).join(', ');
    delete values.address2; delete values.city; delete values.state; delete values.zip;
    if (address) values.address = address; else delete values.address;

    const mappedEmail = mapping.includes('email'); const mappedPhone = mapping.includes('phone');
    if (!values.name) issues.push({ field: 'name', code: 'no_name' });
    // the earlier system asked for a way to reach the person; a row whose email or phone was typed wrong already says so
    if (!values.email && !values.phone && !issues.some((x) => x.field === 'email' || x.field === 'phone') && (mappedEmail || mappedPhone || kind === 'clients')) issues.push({ field: 'email', code: 'no_contact' });

    const row: PlanRow = { line, raw, values, status: issues.length ? 'invalid' : 'new', issues };
    if (!issues.length) {
      const email = normEmail(values.email as string); const phone = normPhone(values.phone as string);
      const probe = { name: values.name as string, email: values.email as string, phone: values.phone as string, address: values.address as string,
        externalIds: { ...(values.squareId ? { square: String(values.squareId) } : {}), ...(values.quickbooksId ? { quickbooks: String(values.quickbooksId) } : {}) } };
      const earlier = (email && seenEmail.get(email)) || (phone.length >= 7 && seenPhone.get(phone)) || 0;
      if (kind === 'clients') {
        const hit = findClientMatches(d, probe, { index }).find(isLikelyDuplicate);
        if (hit) { const mine = world.allClients || !world.canSee || world.canSee(hit.client); row.duplicate = { where: 'client', id: mine ? hit.client.id : undefined, name: hit.client.name, by: hit.by[0] === 'name' ? 'name_address' : hit.by[0], restricted: !mine }; }
      } else {
        const lead = (email && leadEmails.get(email)) || (phone.length >= 7 && leadPhones.get(phone)) || undefined;
        if (lead) row.duplicate = { where: 'lead', id: lead.id, name: lead.name, by: email && normEmail(lead.email) === email ? 'email' : 'phone' };
      }
      if (!row.duplicate && earlier) row.duplicate = { where: 'file', name: String(values.name), by: email && seenEmail.get(email) ? 'email' : 'phone', line: earlier };
      if (row.duplicate) row.status = 'duplicate';
      if (email && !seenEmail.has(email)) seenEmail.set(email, line);
      if (phone.length >= 7 && !seenPhone.has(phone)) seenPhone.set(phone, line);
    }
    out.push(row);
  });
  const count = (s: PlanRow['status']) => out.filter((r) => r.status === s).length;
  return { kind, header, mapping, rows: out, counts: { total: out.length, fresh: count('new'), duplicate: count('duplicate'), invalid: count('invalid'), examples }, secureColumns: header.filter(isSecureColumn) };
}

export interface ImportResult { created: number; skippedDuplicates: number; invalid: number; ids: string[] }
/**
 * Writes the rows of a plan. New rows always; rows that look like someone already on file only when the person importing
 * ticked them (`alsoLines`). Invalid rows are never written. One line in the history says what was imported and by whom.
 * Someone who only sees their own office files the records under it, or they would import clients they cannot open.
 */
export function applyImport(d: DemoState, ctx: Ctx, world: Pick<ImportWorld, 'user' | 'allClients'>, plan: ImportPlan, alsoLines: number[] = []): ImportResult {
  const also = new Set(alsoLines);
  const take = plan.rows.filter((r) => r.status === 'new' || (r.status === 'duplicate' && also.has(r.line)));
  const ownOffice = world.user?.officeIds?.[0];
  const officeFor = (v: unknown): string | undefined => {
    const asked = typeof v === 'string' && v ? v : undefined;
    if (world.allClients) return asked;
    return asked && world.user?.officeIds?.includes(asked) ? asked : ownOffice;
  };
  const note = (text: unknown): Note[] => (typeof text === 'string' && text ? [{ id: uid('n'), at: nowIso(), kind: 'note', text, by: ctx.actor }] : []);
  const ids: string[] = [];

  if (plan.kind === 'clients') {
    const types = clientTypesOf(d, ctx.pack);
    const fresh: Client[] = take.map(({ values: v }) => {
      const kind = (v.kind as Client['kind']) ?? (v.clientType ? (v.clientType === 'individual' ? 'individual' : 'business') : v.company ? 'business' : 'individual');
      const c: Client = { id: uid('c'), name: String(v.name), phone: String(v.phone ?? ''), email: String(v.email ?? ''), addresses: v.address ? [String(v.address)] : [], since: (v.since as string) || today(), notes: note(v.note), kind, lifecycle: (v.lifecycle as Client['lifecycle']) ?? 'active' };
      if (v.company) c.company = String(v.company);
      // an edition that keeps client types files a row without one as a person or as the first business type
      if (types.length) c.clientType = (v.clientType as string) ?? (kind === 'individual' ? types.find((t) => t.id === 'individual')?.id ?? types[0].id : types.find((t) => t.id !== 'individual')?.id ?? types[0].id);
      if (v.lang) c.lang = v.lang as Lang;
      if (v.birthday) c.birthday = v.birthday as string;
      const office = officeFor(v.office); if (office) c.officeId = office;
      if (v.assignedTo) c.assignedTo = v.assignedTo as string;
      if (v.tags) c.tags = [...new Set(String(v.tags).split(/[,;|]/).map((t) => t.trim()).filter(Boolean))];
      if (v.referredBy) c.referredBy = String(v.referredBy);
      if (v.emailOptOut === true) c.emailOptOut = true;
      if (typeof v.smsOptIn === 'boolean') c.smsOptIn = v.smsOptIn;
      if (typeof v.whatsappOptIn === 'boolean') c.whatsappOptIn = v.whatsappOptIn;
      if (v.whatsapp) c.whatsapp = String(v.whatsapp);
      if (v.facebook || v.instagram) c.social = { ...(v.facebook ? { facebook: String(v.facebook) } : {}), ...(v.instagram ? { instagram: String(v.instagram) } : {}) };
      if (v.squareId || v.quickbooksId) c.externalIds = { ...(v.squareId ? { square: String(v.squareId) } : {}), ...(v.quickbooksId ? { quickbooks: String(v.quickbooksId) } : {}) };
      ids.push(c.id);
      return c;
    });
    d.clients.unshift(...fresh);
  } else {
    const first = firstStage(d, ctx.pack).id; const turns = routingOf(d).mode === 'round_robin';
    const fallbackSource = sourcesOf(d, ctx.pack).find((s) => s.id === 'other')?.id ?? sourcesOf(d, ctx.pack)[0]?.id ?? 'other';
    const fallbackType = ctx.pack.serviceTypes.find((s) => s.id === 'other')?.id ?? ctx.pack.serviceTypes[0]?.id ?? 'other';
    // Imported leads are records being brought over, not people who just wrote in: they get an owner and a ticket, and no
    // automation runs for them (no call-back task for five hundred old leads, no engagement for one that was won years ago).
    for (const { values: v } of take) {
      let ownerId = v.ownerId as string | undefined; let handoffs: Lead['handoffs'];
      if (!ownerId) {
        ownerId = (turns ? assignNextLead(d, ctx) : null) ?? ctx.actor;
        if (turns) handoffs = [{ id: uid('h'), at: nowIso(), from: '', to: ownerId, by: 'automation', how: 'round_robin' }];
      }
      const l: Lead = {
        id: uid('l'), ticket: nextTicket(d, ctx), name: String(v.name), phone: String(v.phone ?? ''), email: String(v.email ?? ''), address: String(v.address ?? ''),
        type: (v.type as string) ?? fallbackType, source: (v.source as string) ?? fallbackSource, status: (v.status as string) ?? first, pri: (v.pri as Priority) ?? 'medium',
        ownerId, value: typeof v.value === 'number' ? v.value : null, created: (v.created as string) || today(), notes: note(v.note),
      };
      if (v.company) l.company = String(v.company);
      if (v.sourceDetail) l.sourceDetail = String(v.sourceDetail);
      if (v.nextAction) l.nextAction = { text: String(v.nextAction), ...(v.nextDue ? { due: v.nextDue as string } : {}) };
      else if (v.nextDue) l.followUp = v.nextDue as string;
      if (v.kind) l.kind = v.kind as Lead['kind']; else if (v.company) l.kind = 'business';
      if (v.lang) l.lang = v.lang as Lang;
      if (typeof v.smsOptIn === 'boolean') l.smsOptIn = v.smsOptIn;
      const office = officeFor(v.office); if (office) l.officeId = office;
      if (handoffs) { l.handoffs = handoffs; l.originalOwnerId = ownerId; }
      d.leads.unshift(l); ids.push(l.id);
    }
  }
  if (ids.length) logActivity(d, ctx.actor, plan.kind === 'clients' ? 'data.importedClients' : 'data.importedLeads', { type: 'user', id: ctx.actor }, { n: ids.length });
  return { created: ids.length, skippedDuplicates: plan.rows.filter((r) => r.status === 'duplicate' && !also.has(r.line)).length, invalid: plan.counts.invalid, ids };
}

/** The rows that were not imported, with the reason in a last column, as rows for a CSV file the person can fix and import again. */
export function errorRows(plan: ImportPlan, reason: (r: PlanRow) => string, reasonHeader: string, alsoLines: number[] = []): string[][] {
  const also = new Set(alsoLines);
  const left = plan.rows.filter((r) => r.status === 'invalid' || (r.status === 'duplicate' && !also.has(r.line)));
  // a column that looks like a tax ID is left out of this file too: what was never read is not written back out either
  const keep = plan.header.map((h, i) => (isSecureColumn(h) ? -1 : i)).filter((i) => i >= 0);
  return [[...keep.map((i) => plan.header[i]), reasonHeader], ...left.map((r) => [...keep.map((i) => r.raw[i] ?? ''), reason(r)])];
}

/** An empty file with the right column names and one example row, so the person knows what to fill in. */
export function templateRows(kind: ImportKind, label: (f: ImportField) => string, exampleNote: string): string[][] {
  const skip = ['firstName', 'lastName', 'address2', 'squareId', 'quickbooksId', 'facebook', 'instagram'];
  const fields = importFields(kind).filter((f) => !skip.includes(f.key));
  return [fields.map(label), fields.map((f) => (f.key === 'note' ? exampleNote : f.sample ?? ''))];
}
export const stampToday = (): string => toISODate(new Date()).replace(/-/g, '');
