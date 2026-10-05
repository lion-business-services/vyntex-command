// Changes a company makes to its own setup from the Settings page: its details and hours, which screens it uses, its own
// words for the key nouns, its task and client types, its numbering prefix and its default language.
// Same signature as the shared actions (src/domain/actions): run with `act(action, ...)`. Each one leaves a line in the
// audit trail of a sample workspace; in a live workspace the database records the change itself.
import type { Company, CompanyConfig, DemoState, Lang, ModuleId, OptionDef } from '@/domain/types';
import type { Ctx } from '@/domain/context';
import { auditSample } from '@/domain/actions/security';

const text = (v: string | undefined, max: number) => (v ?? '').trim().slice(0, max);

export type Hours = NonNullable<CompanyConfig['hours']>;
/** The company's details as shown on screen and printed on documents, and its opening hours. */
export function saveCompany(d: DemoState, ctx: Ctx, company: Company, hours?: Hours | null): void {
  d.company = company;
  if (hours !== undefined) {
    const config = { ...d.config };
    if (hours && hours.days.length && hours.open < hours.close) config.hours = { days: [...new Set(hours.days)].filter((n) => n >= 0 && n <= 6).sort(), open: hours.open, close: hours.close };
    else delete config.hours;
    d.config = config;
  }
  auditSample(d, ctx.actor, 'company.updated', 'company');
}

/** Screens a company can never switch off: the records everything else hangs on, and the screens that govern access. */
export const CORE_MODULES: ModuleId[] = ['leads', 'clients', 'jobs', 'tasks', 'calendar', 'documents', 'team', 'settings', 'security', 'audit'];
/** Switches a screen of the edition off or back on. A core screen stays on. Back to the edition's default removes the override. */
export function setModule(d: DemoState, ctx: Ctx, id: ModuleId, on: boolean): boolean {
  if (!ctx.pack.modules.includes(id) || (CORE_MODULES.includes(id) && !on)) return false;
  const modules = { ...(d.config.modules ?? {}) };
  if (on) delete modules[id]; else modules[id] = false;
  const config: CompanyConfig = { ...d.config, modules };
  if (!Object.keys(modules).length) delete config.modules;
  d.config = config;
  auditSample(d, ctx.actor, 'config.modules', 'company', undefined, `${on ? '+' : '-'}${id}`);
  return true;
}

/** The words a company can replace, by the key the wording uses for each. */
export const TERM_KEYS = ['project', 'projects', 'client', 'clients', 'sub', 'subs', 'workersPlural'] as const;
export type TermKey = (typeof TERM_KEYS)[number];
/** The company's own words for the key nouns, per language. An empty word goes back to the edition's. Null clears them all. */
export function setTerms(d: DemoState, ctx: Ctx, terms: Partial<Record<Lang, Partial<Record<TermKey, string>>>> | null): void {
  const next: NonNullable<CompanyConfig['terms']> = {};
  for (const lang of ['en', 'es', 'zh'] as Lang[]) {
    const own: Record<string, string> = {};
    for (const k of TERM_KEYS) { const v = text(terms?.[lang]?.[k], 40); if (v) own[k] = v; }
    // anything else a company had (set by an import or an earlier version) is left as it was
    for (const [k, v] of Object.entries(d.config.terms?.[lang] ?? {})) if (!(TERM_KEYS as readonly string[]).includes(k)) own[k] = v;
    if (Object.keys(own).length) next[lang] = own;
  }
  const config: CompanyConfig = { ...d.config, terms: next };
  if (!Object.keys(next).length) delete config.terms;
  d.config = config;
  auditSample(d, ctx.actor, 'config.terms', 'company');
}

export type ListKey = 'taskTypes' | 'clientTypes';
/** An id for a new entry of a list, made from its English name and unlike any id already there. */
export function optionId(label: string, taken: string[]): string {
  const base = label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'type';
  let id = base; let n = 2;
  while (taken.includes(id)) id = `${base}_${n++}`;
  return id;
}
/** How many records use an entry, so the screen can refuse to remove one that is in use. */
export function optionUse(d: DemoState, key: ListKey, id: string): number {
  return key === 'taskTypes' ? d.tasks.filter((x) => (x.type ?? 'todo') === id).length : d.clients.filter((c) => c.clientType === id).length;
}
/** Replaces the company's list of task types or client types. Null goes back to the edition's list. `todo` always stays. */
export function setOptionList(d: DemoState, ctx: Ctx, key: ListKey, list: OptionDef[] | null): boolean {
  const config = { ...d.config };
  if (!list) delete config[key];
  else {
    const clean = list.map((o) => ({ id: o.id, label: { en: text(o.label.en, 40), es: text(o.label.es, 40) || text(o.label.en, 40), ...(o.label.zh ? { zh: text(o.label.zh, 40) } : {}) } })).filter((o) => o.id && o.label.en);
    if (!clean.length || new Set(clean.map((o) => o.id)).size !== clean.length) return false;
    if (key === 'taskTypes' && !clean.some((o) => o.id === 'todo')) return false;
    config[key] = clean;
  }
  d.config = config;
  auditSample(d, ctx.actor, 'config.lists', 'company', undefined, key);
  return true;
}

/** Where the workspace keeps the company's own numbering prefix: `settings.numbering.prefix`. Empty means the edition's. */
export const ownPrefix = (d: Pick<DemoState, 'settings'>): string => { const n = d.settings?.numbering as { prefix?: unknown } | undefined; return typeof n?.prefix === 'string' ? n.prefix : ''; };
/** Letters, digits and a dash: "HL-". */
export const cleanPrefix = (v: string): string => v.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 6);
export function setNumberPrefix(d: DemoState, ctx: Ctx, prefix: string): void {
  const clean = cleanPrefix(prefix);
  const settings = { ...d.settings };
  if (clean && clean !== ctx.pack.ticketPrefix) settings.numbering = { prefix: clean }; else delete settings.numbering;
  d.settings = settings;
  auditSample(d, ctx.actor, 'config.numbering', 'company', undefined, clean || ctx.pack.ticketPrefix);
}

/** The language the company works in by default: `settings.language.default`. Used where a person or a client has none of their own. */
export const defaultLang = (d: Pick<DemoState, 'settings'>): Lang | '' => { const l = (d.settings?.language as { default?: unknown } | undefined)?.default; return l === 'en' || l === 'es' || l === 'zh' ? l : ''; };
export function setDefaultLang(d: DemoState, _ctx: Ctx, lang: Lang | ''): void {
  const settings = { ...d.settings };
  if (lang) settings.language = { default: lang }; else delete settings.language;
  d.settings = settings;
}
