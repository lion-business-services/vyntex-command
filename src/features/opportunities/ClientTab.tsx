// A client's opportunities, on the client page. Registered in src/features/clients/tabs.ts.
// The same records and the same actions as the Opportunities screen, for one client, with what the client already has above them.
import { useState } from 'react';
import { LuPlus } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Button, Card, Empty } from '@/ui';
import { CanWrite } from '@/app/shared';
import type { ClientTabProps } from '@/features/clients/tabs';
import { serviceName, serviceOf } from '@/domain/actions/catalog';
import { type Opp, clientServices } from '@/domain/actions/opportunities';
import { byId } from '@/domain/selectors';
import { money } from '@/lib/money';
import { Actions, AddModal, StatusBadge } from './parts';
import '@/features/leads/work.css';
import './opportunities.css';

const ORDER: Record<Opp['status'], number> = { open: 0, contacted: 1, won: 2, dismissed: 3 };

export default function OpportunitiesClientTab({ client }: ClientTabProps) {
  const { t, data, lang, date, can } = useApp();
  const [add, setAdd] = useState(false);
  const list = ((data.opportunities ?? []) as Opp[]).filter((o) => o.clientId === client.id).sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.created.localeCompare(a.created));
  const has = [...clientServices(data, client.id).has.keys()].map((id) => serviceOf(data, id)).filter((s) => !!s);
  const addBtn = <CanWrite><Button size="sm" icon={<LuPlus aria-hidden="true" />} onClick={() => setAdd(true)} data-testid="opp-client-add">{t('opportunities.add')}</Button></CanWrite>;
  return (
    <div className="stack">
      <Card className="work-none" title={<>{t('nav.opportunities')} <span className="count">{list.filter((o) => o.status === 'open' || o.status === 'contacted').length}</span></>} actions={addBtn}>
        <p className="small muted opportunities-has">{has.length ? <>{t('opportunities.client.has')} {has.map((s) => serviceName(s!, lang)).join(', ')}.</> : t('opportunities.client.hasNone')}</p>
        {list.length ? (
          <div className="list" data-testid="opp-client-list">
            {list.map((o) => {
              const sv = serviceOf(data, o.serviceId); const rule = byId(data.crossSell ?? [], o.ruleId);
              return (
                <div className="item opportunities-item" key={o.id} data-opp={o.id}>
                  <div className="grow">
                    <div className="t">{sv ? serviceName(sv, lang) : t('catalog.gone')}{can('money') && o.value ? <span className="muted opportunities-val"> · {money(o.value)}</span> : null}</div>
                    <div className="xs muted">{rule ? t('opportunities.byRule', { rule: rule.name }) : o.by === 'automation' ? t('opportunities.byRuleGone') : t('opportunities.byPerson', { name: byId(data.users, o.by)?.name ?? '' })} · {date(o.created)}</div>
                    {o.note && <p className="small opportunities-note">{o.note}</p>}
                    {o.status === 'dismissed' && o.dismissedReason && <p className="small muted opportunities-note">{t('opportunities.reason')}: {o.dismissedReason}</p>}
                  </div>
                  <div className="opportunities-side"><StatusBadge o={o} /><Actions o={o} /></div>
                </div>
              );
            })}
          </div>
        ) : <Empty title={t('opportunities.client.none')}>{t('opportunities.client.noneHint')}</Empty>}
      </Card>
      {add && <AddModal clientId={client.id} onClose={() => setAdd(false)} />}
    </div>
  );
}
