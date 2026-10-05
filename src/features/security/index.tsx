// The security center: people and access, the approvals queue, sign-in security, roles and permissions, offices and the
// access log of the protected values. Each part shows only to someone who holds the capability it needs; the server and
// the database enforce the same capabilities, this screen is the mirror. Each part has its own address: /security/<part>.
// Nothing on this screen states a certification or a compliance standing: it shows the controls that exist and their state.
import { useMemo, useState } from 'react';
import { useApp, type App } from '@/app/hooks';
import { go } from '@/app/router';
import type { PageProps } from '@/app/routes';
import { NoAccess } from '@/app/shared';
import { Button, Card, Empty, PageHeader, SearchBox, Tabs } from '@/ui';
import type { SecureAccessLog } from '@/domain/types';
import { waitingFor } from '@/domain/actions/security';
import { PeopleCard } from './people';
import { ApprovalsSection } from './approvals';
import { SignInSection } from './signin';
import { RolesCard } from './roles';
import { OfficesCard } from './offices';
import { SampleNote, SecureLogTable, sampleWord, whoName } from './parts';
import { StepUpHost } from './stepup';
import './security.css';

type TabId = 'people' | 'approvals' | 'signin' | 'roles' | 'offices' | 'log';
/** Which parts this viewer gets. The page itself opens for whoever manages people; the parts ask for their own capability. */
function tabsFor(app: App): TabId[] {
  const { can, pack } = app;
  const out: TabId[] = [];
  if (can('users')) out.push('people');
  if (can('secureApprove') || can('allClients')) out.push('approvals');
  out.push('signin');
  if (can('config')) out.push('roles');
  if (can('config') && pack.family === 'practice') out.push('offices');
  if (can('audit') || can('secureApprove')) out.push('log');
  return out;
}

export default function SecurityPage({ id }: PageProps) {
  const app = useApp();
  const { t, data, perms, user, live } = app;
  const tabs = tabsFor(app);
  const current = tabs.find((x) => x === id) ?? tabs[0];
  const queue = waitingFor(data, user?.id, perms);
  const waiting = queue.reveals.length + queue.access.length;
  if (!current) return <NoAccess />;
  return (
    <>
      <PageHeader title={t('nav.security')} sub={t('security.sub')} />
      {!live && <SampleNote>{t('security.sample', { sample: sampleWord(t) })}</SampleNote>}
      <div className="security-tabs" data-testid="security-tabs">
        <Tabs<TabId> value={current} onChange={(next) => go(next === tabs[0] ? '/security' : `/security/${next}`)}
          tabs={tabs.map((x) => ({ id: x, label: <span data-testid={`security-tab-${x}`}>{t('security.tab.' + x)}</span>, count: x === 'approvals' ? waiting : undefined }))} />
      </div>
      <div className="stack" data-section={current}>
        {current === 'people' && <PeopleCard />}
        {current === 'approvals' && <ApprovalsSection />}
        {current === 'signin' && <SignInSection />}
        {current === 'roles' && <RolesCard />}
        {current === 'offices' && <OfficesCard />}
        {current === 'log' && <SecureLog />}
      </div>
      <StepUpHost />
    </>
  );
}

/* ---------- the access log of the protected values, for every client ---------- */
function SecureLog() {
  const { t, data } = useApp();
  const [q, setQ] = useState('');
  const [action, setAction] = useState<'' | SecureAccessLog['action']>('');
  const [more, setMore] = useState(60);
  const s = q.trim().toLowerCase();
  const rows = useMemo(() => data.secureLog.filter((e) => {
    if (action && e.action !== action) return false;
    if (!s) return true;
    const client = data.clients.find((c) => c.id === e.clientId)?.name ?? '';
    return [client, whoName(data, t, e.userId), e.reason ?? ''].some((v) => v.toLowerCase().includes(s));
  }), [data, action, s, t]);
  const actions = [...new Set(data.secureLog.map((e) => e.action))];
  return (
    <Card flush title={t('security.log.titleAll')}>
      <p className="muted security-pad security-lead">{t('security.log.intro')}</p>
      <div className="filters security-pad">
        <SearchBox value={q} onChange={setQ} placeholder={t('security.log.search')} />
        <select value={action} onChange={(e) => setAction(e.target.value as typeof action)} aria-label={t('security.log.what')} data-testid="security-log-action">
          <option value="">{t('security.log.allActions')}</option>
          {actions.map((a) => <option key={a} value={a}>{t('security.log.a.' + a)}</option>)}
        </select>
        {(s || action) && <button type="button" className="linkbtn small" onClick={() => { setQ(''); setAction(''); }}>{t('common.clearFilters')}</button>}
      </div>
      {!data.secureLog.length ? <Empty title={t('security.log.empty')} />
        : !rows.length ? <Empty title={t('common.noResults')} action={<Button onClick={() => { setQ(''); setAction(''); }}>{t('common.clearFilters')}</Button>} />
        : <SecureLogTable entries={rows} showClient limit={more} />}
      {rows.length > more && <div className="security-pad"><Button onClick={() => setMore((n) => n + 60)}>{t('security.log.more', { n: rows.length - more })}</Button></div>}
      <p className="xs dim security-pad">{t('security.log.fixed')}</p>
    </Card>
  );
}
