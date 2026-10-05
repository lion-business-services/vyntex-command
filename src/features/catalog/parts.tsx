// Small pieces shared by the catalog screens and by the other modules that show a service (engagement forms, opportunities).
import { LuLink2 } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import type { CatalogService, CatalogTier, PlaybookStep, Repeat } from '@/domain/types';
import type { TFn } from '@/i18n';
import type { IndustryPack } from '@/packs/types';
import { money, money2 } from '@/lib/money';
import { type Service, serviceName } from '@/domain/actions/catalog';

export const REPEAT_OPTIONS: Repeat[] = ['once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];

/** A category is the id of one of the edition's service lines when it matches one, otherwise the text the company typed. */
export function categoryLabel(t: TFn, pack: IndustryPack, category: string): string {
  if (!category) return t('catalog.cat.none');
  return pack.serviceTypes.some((x) => x.id === category) ? t('ty_' + category) : category;
}
/** Categories in use, the edition's own order first, then the company's in alphabetical order. An empty category comes last. */
export function categoriesOf(pack: IndustryPack, services: CatalogService[]): string[] {
  const used = new Set(services.map((s) => s.category));
  const known = pack.serviceTypes.map((x) => x.id).filter((id) => used.has(id));
  const own = [...used].filter((c) => c && !known.includes(c)).sort((a, b) => a.localeCompare(b));
  return [...known, ...own, ...(used.has('') ? [''] : [])];
}

/** "$180", "$220 / month", "$60 / hour". A tier at zero is quoted for each client. Cents are shown only when there are any. */
export function tierPrice(t: TFn, tier: Pick<CatalogTier, 'price' | 'unit'>): string {
  if (!tier.price) return t('catalog.tier.quoted');
  const amount = Number.isInteger(tier.price) ? money(tier.price) : money2(tier.price);
  return tier.unit === 'flat' ? amount : `${amount} / ${t('catalog.per.' + tier.unit)}`;
}
/** From the lowest tier that has a price: what a list shows when a service has several. */
export function priceFrom(t: TFn, s: CatalogService): string {
  const priced = s.tiers.filter((x) => x.price > 0);
  if (!priced.length) return t('catalog.tier.quoted');
  const low = priced.reduce((a, b) => (b.price < a.price ? b : a));
  return s.tiers.length > 1 ? t('catalog.from', { price: tierPrice(t, low) }) : tierPrice(t, low);
}

/** Who a playbook step is for, in the words of the edition: the person responsible for the work, or a role as the company names it. */
export const whoLabel = (t: TFn, who: PlaybookStep['for']): string => (who === 'assignee' ? t('catalog.pb.for.assignee') : t('role.' + who));

/** What a person types to find a service: its names in every language, its code, its category and its tier names. */
export function serviceText(t: TFn, pack: IndustryPack, s: Service): string {
  return [s.name, s.i18n?.en?.name, s.i18n?.es?.name, s.i18n?.zh?.name, s.code, s.description, categoryLabel(t, pack, s.category), ...s.tiers.map((x) => x.name)].filter(Boolean).join(' ').toLowerCase();
}

/** Ids a connected system gave this record. Shown, never edited here: they are written once by the sync that created the record over there. */
export function ExternalChips({ ids, none }: { ids?: Record<string, string>; none?: boolean }) {
  const { t } = useApp();
  const list = Object.entries(ids ?? {});
  if (!list.length) return none ? <span className="dim small">{t('catalog.ext.none')}</span> : null;
  return (
    <span className="row tight catalog-ext">
      {list.map(([provider, id]) => <span key={provider} className="catalog-chip" title={t('catalog.ext.hint')}><LuLink2 aria-hidden="true" /><b>{t('catalog.ext.' + provider) === 'catalog.ext.' + provider ? provider : t('catalog.ext.' + provider)}</b><code>{id}</code></span>)}
    </span>
  );
}

/** The name of a service by id, in the viewer's language; the fallback when it no longer exists. */
export function useServiceName() {
  const { data, lang, t } = useApp();
  return (id: string | undefined): string => { const s = (data.catalog ?? []).find((x) => x.id === id); return s ? serviceName(s, lang) : t('catalog.gone'); };
}
