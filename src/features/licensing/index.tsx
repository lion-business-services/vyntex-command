// Licensing: the licenses and registrations the firm keeps track of, for each client and for itself, with their renewal
// dates and the document that proves each one. A license is a deadline of kind `license` or `renewal`, so it also shows
// on the deadlines screen and in the reminders. The rest of the screen is the service-line shell (bookkeeping/line.tsx).
import { useState } from 'react';
import { LuPlus } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import type { PageProps } from '@/app/routes';
import { Button, Card, Empty, Seg } from '@/ui';
import { byId } from '@/domain/selectors';
import { visibleClientIds } from '@/domain/access';
import type { ComplianceItem } from '@/domain/types';
import { ServiceLine } from '@/features/bookkeeping/line';
import { DeadlineFormModal, DeadlineRow } from '@/features/deadlines/parts';
import './licensing.css';

const KINDS: ComplianceItem['kind'][] = ['license', 'renewal'];

export default function LicensingPage(_props: PageProps) {
  return <ServiceLine line="licensing" deadlineKinds={KINDS}><Licenses /></ServiceLine>;
}

/** Licenses and registrations, grouped by who holds them. */
function Licenses() {
  const { t, data, can, user, perms } = useApp();
  const [scope, setScope] = useState<'open' | 'all'>('open');
  const [form, setForm] = useState<{ item?: ComplianceItem; clientId?: string } | null>(null);
  const mine = visibleClientIds(data, user, perms);
  const all = data.complianceItems.filter((i) => KINDS.includes(i.kind) && (!i.clientId || mine.has(i.clientId)));
  const items = all.filter((i) => scope === 'all' || i.status === 'open').sort((a, b) => a.due.localeCompare(b.due));
  const holders = [...new Set(items.map((i) => i.clientId ?? ''))].sort((a, b) => (a ? byId(data.clients, a)?.name ?? '' : '').localeCompare(b ? byId(data.clients, b)?.name ?? '' : ''));
  const write = can('write');
  return (
    <Card title={<>{t('licensing.list')} <span className="count">{items.length}</span></>} className="licensing-list" actions={<>
      {all.length > 0 && <Seg label={t('common.status')} value={scope} onChange={setScope} options={[{ value: 'open', label: t('licensing.scope.open') }, { value: 'all', label: t('common.all') }]} />}
      {write && <Button size="sm" variant="primary" icon={<LuPlus aria-hidden="true" />} onClick={() => setForm({})} data-testid="licensing-new">{t('licensing.new')}</Button>}
    </>}>
      {!items.length ? (
        <Empty title={t(all.length ? 'licensing.noneOpen' : 'licensing.empty')}>{t('licensing.emptyHint')}</Empty>
      ) : (
        <div className="stack" data-testid="licensing-holders">
          {holders.map((h) => {
            const c = byId(data.clients, h); const list = items.filter((i) => (i.clientId ?? '') === h);
            return (
              <section key={h || 'firm'} className="licensing-holder" aria-label={c ? c.company || c.name : t('deadlines.firm')}>
                <h3>{c ? <A to={`/clients/${c.id}`}>{c.company || c.name}</A> : t('deadlines.firm')}<span className="count">{list.length}</span>{write && <button type="button" className="linkbtn small licensing-add" onClick={() => setForm({ clientId: h || undefined })}>{t('licensing.addFor')}</button>}</h3>
                <div className="list">{list.map((i) => <DeadlineRow key={i.id} item={i} showClient={false} onEdit={(item) => setForm({ item })} />)}</div>
              </section>
            );
          })}
        </div>
      )}
      <p className="xs dim licensing-note">{t('licensing.note')}</p>
      {form && <DeadlineFormModal key={form.item?.id ?? 'new' + (form.clientId ?? '')} item={form.item} kinds={KINDS} defaults={{ kind: 'license', repeat: 'yearly', clientId: form.clientId }} onClose={() => setForm(null)} />}
    </Card>
  );
}
