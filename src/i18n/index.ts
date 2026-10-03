// Translation with industry wording. Lookup order: industry pack > feature dictionaries > app > base (English as last resort).
import type { Lang } from '@/domain/types';
import type { IndustryPack } from '@/packs/types';
import { baseEN } from './base.en';
import { baseES } from './base.es';
import { appDict } from './app';
import { featureDicts } from './features';

export type Dict = Record<Lang, Record<string, string>>;
export type TFn = (key: string, params?: Record<string, string | number>) => string;

const merged: Dict = { en: { ...baseEN, ...appDict.en }, es: { ...baseES, ...appDict.es } };
for (const d of featureDicts) { Object.assign(merged.en, d.en); Object.assign(merged.es, d.es); }

const cache = new Map<string, TFn>();
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
/**
 * Small grammar repairs after an industry word is dropped into a sentence, so shared sentences stay correct in every edition:
 * English "a event" becomes "an event"; Spanish articles and endings follow a feminine word ("el unidad" becomes "la unidad").
 */
type Fix = [RegExp, (m: string, ...rest: string[]) => string];
function agreement(lang: Lang, pack: IndustryPack, tokens: Record<string, string>): Fix[] {
  const out: Fix[] = [];
  const words = (...keys: string[]) => keys.map((k) => tokens[k]).filter(Boolean);
  if (lang === 'en') {
    // by sound, not by letter: "an event", but "a unit", "a user", "a one-time visit"
    const vowel = words('job', 'worker', 'client').filter((w) => /^[aeiou]/i.test(w) && !/^(?:uni|us[ae]|ut[ei]|eu|one|once)/i.test(w));
    if (vowel.length) out.push([new RegExp(`\\b([Aa]) (?=(?:new )?(?:${vowel.map(esc).join('|')})\\b)`, 'gi'), (_m, a) => (a === 'A' ? 'An ' : 'an ')]);
    return out;
  }
  if (pack.grammar?.es?.job === 'f') {
    const one = esc(tokens.job), many = esc(tokens.jobs);
    const det: Record<string, string> = { el: 'la', un: 'una', del: 'de la', al: 'a la', otro: 'otra', nuevo: 'nueva', 'ningún': 'ninguna', este: 'esta', ese: 'esa', mismo: 'misma', primer: 'primera', 'último': 'última' };
    const dets: Record<string, string> = { los: 'las', unos: 'unas', otros: 'otras', nuevos: 'nuevas', estos: 'estas', todos: 'todas', 'ningunos': 'ningunas' };
    const sw = (map: Record<string, string>) => (_m: string, d: string, w: string) => { const to = map[d.toLowerCase()]; return (d[0] === d[0].toUpperCase() ? cap(to) : to) + ' ' + w; };
    out.push([new RegExp(`(?<![\\p{L}])(${Object.keys(det).join('|')}) (${one})(?![\\p{L}])`, 'giu'), sw(det)]);
    out.push([new RegExp(`(?<![\\p{L}])(${Object.keys(dets).join('|')}) (${many})(?![\\p{L}])`, 'giu'), sw(dets)]);
    out.push([new RegExp(`(?<![\\p{L}])todos las (${many})`, 'giu'), (_m, w) => `todas las ${w}`]);
    // adjectives and participles right after the word: "unidad creado" -> "unidad creada"
    out.push([new RegExp(`(${one}) ([\\p{L}]+?)o(?![\\p{L}])`, 'giu'), (m, w, adj) => (ADJ.test(adj + 'o') ? `${w} ${adj}a` : m)]);
    out.push([new RegExp(`(${many}) ([\\p{L}]+?)os(?![\\p{L}])`, 'giu'), (m, w, adj) => (ADJ.test(adj + 'o') ? `${w} ${adj}as` : m)]);
    out.push([new RegExp(`(${one}) (fue|está|quedó|queda|ya está) ([\\p{L}]+?)o(?![\\p{L}])`, 'giu'), (m, w, v, adj) => (ADJ.test(adj + 'o') ? `${w} ${v} ${adj}a` : m)]);
  }
  return out;
}
const ADJ = /^(cread|asociad|asignad|agregad|borrad|actualizad|guardad|terminad|seleccionad|pagad|completad|activ|abiert|nuev|list|programad|firmad|atrasad|cerrad|facturad|cobrad|pendiente)o$/i;

/** Returns the translate function for a language and industry pack. Cached, so it is cheap to call on every render. */
export function makeT(lang: Lang, pack: IndustryPack): TFn {
  const key = lang + ':' + pack.id;
  const hit = cache.get(key); if (hit) return hit;
  const types: Record<string, string> = {};
  for (const s of pack.serviceTypes) types['ty_' + s.id] = s[lang];
  const dict: Record<string, string> = { ...merged.en, ...merged[lang], ...types, ...pack.terms[lang] };
  const term = (k: string) => dict[k] ?? k;
  const tokens: Record<string, string> = {
    Job: term('project'), Jobs: term('projects'), Worker: term('sub'), Client: term('client'), Clients: term('clients'),
    // `subs` is the short label of the team page ("Crew"); sentences that count people need a true plural ("crew members")
    Workers: dict.workersPlural ?? term('subs'), Team: term('subs'),
  };
  for (const k of Object.keys(tokens)) tokens[lower(k)] = lower(tokens[k]);
  tokens.product = pack.product;
  const fixes = agreement(lang, pack, tokens);
  // A two-part client word ("Property manager / owner") reads badly inside the plan and add-on lines, which come from the
  // pricing file's plain "client". Those lines use the plain word in such an edition; every other screen keeps the trade's word.
  const plain: Record<string, string> | null = tokens.client.includes('/')
    ? (lang === 'es' ? { client: 'cliente', clients: 'clientes', Client: 'Cliente', Clients: 'Clientes' } : { client: 'client', clients: 'clients', Client: 'Client', Clients: 'Clients' })
    : null;
  const t: TFn = (k, params) => {
    const raw = dict[k]; if (raw === undefined) return k;
    if (raw.indexOf('{') < 0) return raw;
    const words = plain && k.startsWith('price.') ? { ...tokens, ...plain } : tokens;
    let out = raw.replace(/\{(\w+)\}/g, (m, name) => (params && params[name] !== undefined ? String(params[name]) : words[name] ?? m));
    for (const [re, to] of fixes) out = out.replace(re, to as (m: string, ...rest: string[]) => string);
    return out;
  };
  cache.set(key, t);
  return t;
}
/** Keys that exist in English but not Spanish; used by the translation check. */
export function missingSpanish(): string[] { return Object.keys(merged.en).filter((k) => !(k in merged.es)); }

/** Every key in the shared dictionaries, used by scripts/check-i18n.mjs. */
export const sharedKeys = () => ({ en: Object.keys(merged.en), es: Object.keys(merged.es) });
