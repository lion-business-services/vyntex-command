// Settings (owner only). Each section has its own address: /settings/<section>. The sections are listed in ./panels.ts.
import { Suspense } from 'react';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import type { PageProps } from '@/app/routes';
import { PageHeader } from '@/ui';
import { settingsPanelsFor } from './panels';
import './settings.css';

export default function SettingsPage({ id }: PageProps) {
  const app = useApp();
  const { t } = app;
  const panels = settingsPanelsFor(app);
  const current = panels.find((p) => p.id === id) ?? panels[0];
  const View = current.view;
  return (
    <>
      <PageHeader title={t('nav.settings')} sub={t('settings.sub')} />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t('settings.sections')}>
          {panels.map((p) => { const Icon = p.icon; return (
            <A key={p.id} to={`/settings/${p.id}`} aria-current={p.id === current.id ? 'page' : undefined} data-testid={`settings-tab-${p.id}`}><Icon aria-hidden="true" /><span>{t(p.labelKey)}</span></A>
          ); })}
        </nav>
        <div className="stack settings-body" data-section={current.id}>
          <Suspense fallback={<div className="page-loading" role="status" aria-live="polite"><span className="sr">{t('common.loading')}</span></div>}><View key={current.id} /></Suspense>
        </div>
      </div>
    </>
  );
}
