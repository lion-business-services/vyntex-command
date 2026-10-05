// How the command palette finds catalog services: by name in any language, code, category or tier name.
import type { SearchProvider } from '@/app/search';
import { type Service, serviceName } from '@/domain/actions/catalog';
import { categoryLabel, priceFrom } from './parts';

export const search: SearchProvider[] = [
  { id: 'catalog', groupKey: 'catalog.search.group', perm: 'catalog', module: 'catalog',
    find: (app, has) => ((app.data.catalog ?? []) as Service[])
      .filter((s) => has(s.name, s.i18n?.en?.name, s.i18n?.es?.name, s.i18n?.zh?.name, s.code, categoryLabel(app.t, app.pack, s.category), ...s.tiers.map((x) => x.name)))
      // services that can be sold first, retired ones after
      .sort((a, b) => Number(b.active) - Number(a.active))
      .map((s) => ({ id: s.id, title: serviceName(s, app.lang), sub: `${categoryLabel(app.t, app.pack, s.category)} · ${s.active ? priceFrom(app.t, s) : app.t('catalog.retired')}`, to: `/catalog/${s.id}` })) },
];
