// Service catalog: /catalog is the list of services, /catalog/<id> one service, /catalog/playbooks the playbooks.
// Everyone with the `catalog` capability can look. Changing the catalog takes `write` on top, or the right to configure the company.
import type { PageProps } from '@/app/routes';
import { useApp } from '@/app/hooks';
import { go } from '@/app/router';
import { PageHeader, Tabs } from '@/ui';
import { ServiceList } from './list';
import { ServicePage } from './service';
import { Playbooks } from './playbooks';
import '@/features/leads/work.css';
import './catalog.css';

export default function CatalogPage({ id }: PageProps) {
  const { t, data, can } = useApp();
  // a read-only person holds `catalog` without `write`: the same screens, no controls that change anything
  const canEdit = can('write') && (can('catalog') || can('config'));
  if (id && id !== 'playbooks') return <ServicePage id={id} canEdit={canEdit} />;
  const tab = id === 'playbooks' ? 'playbooks' : 'services';
  return (
    <>
      <PageHeader title={t('nav.catalog')} sub={t('catalog.sub')} />
      <Tabs value={tab} onChange={(x) => go(x === 'playbooks' ? '/catalog/playbooks' : '/catalog')} tabs={[
        { id: 'services', label: t('nav.catalog'), count: (data.catalog ?? []).filter((s) => s.active).length },
        { id: 'playbooks', label: t('catalog.pb.tab'), count: (data.playbooks ?? []).length },
      ]} />
      {tab === 'playbooks' ? <Playbooks canEdit={canEdit} /> : <ServiceList canEdit={canEdit} />}
    </>
  );
}
