// Opportunities: services a client could use and does not have yet. /opportunities is the list, /opportunities/rules the
// cross-sell rules that create them, /opportunities/<id> the list opened on one opportunity.
import { useMemo, useState } from 'react';
import { LuPlay, LuPlus } from 'react-icons/lu';
import type { PageProps } from '@/app/routes';
import { useApp } from '@/app/hooks';
import { A, go } from '@/app/router';
import { act } from '@/store/store';
import { Avatar, Button, Card, Empty, PageHeader, SearchBox, Seg, Tabs, cx, toast } from '@/ui';
import { CanWrite } from '@/app/shared';
import { evaluateCrossSell } from '@/domain/actions';
import { serviceName, serviceOf } from '@/domain/actions/catalog';
import type { Opp } from '@/domain/actions/opportunities';
import { visibleClientIds } from '@/domain/access';
import { byId } from '@/domain/selectors';
import { tierPrice } from '@/features/catalog/parts';
import { money, sum } from '@/lib/money';
import { Actions, AddModal, StatusBadge, isLater } from './parts';
import { Rules } from './rules';
import '@/features/leads/work.css';
import './opportunities.css';

type Show = 'open' | 'later' | 'contacted' | 'won' | 'dismissed';
const bucket = (o: Opp): Show => (isLater(o) ? 'later' : o.status);

export default function OpportunitiesPage({ id }: PageProps) {
  const { t, data, can } = useApp();
  const canEdit = can('write') && (can('opportunities') || can('config'));
  const tab = id === 'rules' ? 'rules' : 'list';
  return (
    <>
      <PageHeader title={t('nav.opportunities')} sub={t('opportunities.sub')} />
      <Tabs value={tab} onChange={(x) => go(x === 'rules' ? '/opportunities/rules' : '/opportunities')} tabs={[
        { id: 'list', label: t('nav.opportunities'), count: (data.opportunities ?? []).filter((o) => bucket(o) === 'open').length },
        { id: 'rules', label: t('opportunities.rules'), count: (data.crossSell ?? []).filter((r) => r.active).length },
      ]} />
      {tab === 'rules' ? <Rules canEdit={canEdit} /> : <List focus={id} />}
    </>
  );
}

function List({ focus }: { focus?: string }) {
  const { t, data, lang, date, can, user, perms } = useApp();
  const mine = useMemo(() => visibleClientIds(data, user, perms), [data, user, perms]);
  const all = ((data.opportunities ?? []) as Opp[]).filter((o) => mine.has(o.clientId));
  const focused = all.find((o) => o.id === focus);
  const [show, setShow] = useState<Show>(focused ? bucket(focused) : 'open');
  const [q, setQ] = useState('');
  const [service, setService] = useState('');
  const [who, setWho] = useState('');
  const [add, setAdd] = useState(false);
  const showMoney = can('money');

  const count = (b: Show) => all.filter((o) => bucket(o) === b).length;
  const s = q.trim().toLowerCase();
  const rows = all.filter((o) => {
    const c = byId(data.clients, o.clientId); const sv = serviceOf(data, o.serviceId);
    return bucket(o) === show && (!service || o.serviceId === service) && (!who || c?.assignedTo === who)
      && (!s || [c?.name, c?.company, sv ? serviceName(sv, lang) : '', o.note].some((x) => x && x.toLowerCase().includes(s)));
  }).sort((a, b) => b.created.localeCompare(a.created));
  const filtered = !!(q || service || who);
  const clear = () => { setQ(''); setService(''); setWho(''); };
  const services = [...new Set(all.map((o) => o.serviceId))].map((x) => serviceOf(data, x)).filter((x) => !!x);
  const people = data.users.filter((u) => all.some((o) => byId(data.clients, o.clientId)?.assignedTo === u.id));
  const open = all.filter((o) => bucket(o) === 'open' || bucket(o) === 'contacted');
  const run = () => { const made = act(evaluateCrossSell); toast(t(made.length ? 'opportunities.run.made' : 'opportunities.run.none', { n: made.length })); if (made.length) setShow('open'); };
  const options: { value: Show; label: string; count?: number }[] = [
    { value: 'open', label: t('opportunities.st.open'), count: count('open') }, ...(count('later') || show === 'later' ? [{ value: 'later' as Show, label: t('opportunities.st.later'), count: count('later') }] : []),
    { value: 'contacted', label: t('opportunities.st.contacted'), count: count('contacted') }, { value: 'won', label: t('opportunities.st.won'), count: count('won') },
    { value: 'dismissed', label: t('opportunities.st.dismissed'), count: count('dismissed') },
  ];

  return (
    <>
      <div className="opportunities-bar">
        <Seg label={t('common.status')} value={show} onChange={setShow} options={options} />
        <div className="row tight opportunities-top">
          {(data.crossSell ?? []).some((r) => r.active) && <CanWrite><Button icon={<LuPlay aria-hidden="true" />} onClick={run} data-testid="opp-run">{t('opportunities.run')}</Button></CanWrite>}
          <CanWrite><Button variant={all.length ? 'primary' : 'default'} icon={<LuPlus aria-hidden="true" />} onClick={() => setAdd(true)} data-testid="opp-add">{t('opportunities.add')}</Button></CanWrite>
        </div>
      </div>
      <div className="filters opportunities-filters">
        <SearchBox value={q} onChange={setQ} placeholder={t('opportunities.search')} />
        <select value={service} onChange={(e) => setService(e.target.value)} aria-label={t('opportunities.col.service')} data-testid="opp-filter-service">
          <option value="">{t('opportunities.allServices')}</option>{services.map((x) => <option key={x!.id} value={x!.id}>{serviceName(x!, lang)}</option>)}
        </select>
        {people.length > 1 && (
          <select value={who} onChange={(e) => setWho(e.target.value)} aria-label={t('opportunities.col.who')} data-testid="opp-filter-who">
            <option value="">{t('opportunities.allPeople')}</option>{people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
        {filtered && <button type="button" className="linkbtn small" onClick={clear} data-testid="opp-clear">{t('common.clearFilters')}</button>}
      </div>
      {all.length > 0 && <p className="small muted opportunities-sum" data-testid="opp-sum">{t('opportunities.sum', { n: open.length })}{showMoney && <> · {t('opportunities.sum.value')}: <b>{money(sum(open, (o) => o.value))}</b></>}</p>}

      {!all.length ? (
        <Card className="work-none"><Empty title={t('opportunities.empty')} action={<A to="/opportunities/rules" className="btn" data-testid="opp-to-rules">{t('opportunities.rules')}</A>}>{t('opportunities.emptyHint')}</Empty></Card>
      ) : !rows.length ? (
        <Card className="work-none"><Empty title={filtered ? t('common.noResults') : t('opportunities.none.' + show)} action={filtered ? <Button onClick={clear}>{t('common.clearFilters')}</Button> : undefined} /></Card>
      ) : (
        <Card flush>
          <div className="table-wrap opportunities-wrap">
            <table className="tbl stackable opportunities-table" data-testid="opp-table">
              <thead><tr><th>{t('client')}</th><th>{t('opportunities.col.service')}</th>{showMoney && <th className="num">{t('common.value')}</th>}<th>{t('opportunities.col.since')}</th><th className="opportunities-c-acts"><span className="sr">{t('common.actions')}</span></th></tr></thead>
              <tbody>
                {rows.map((o) => {
                  const c = byId(data.clients, o.clientId); const sv = serviceOf(data, o.serviceId); const rule = byId(data.crossSell ?? [], o.ruleId);
                  const u = byId(data.users, c?.assignedTo); const tier = sv?.tiers[0];
                  return (
                    <tr key={o.id} data-opp={o.id} className={cx(o.id === focus && 'opportunities-focus')}>
                      <td className="t1">{c ? <A to={`/clients/${c.id}/opportunities`} className="opportunities-name">{c.name}</A> : null}{c?.company && <div className="xs dim opportunities-under">{c.company}</div>}
                        {u && <div className="xs dim opportunities-under opportunities-who"><Avatar name={u.name} size="sm" />{u.name}</div>}</td>
                      <td data-label={t('opportunities.col.service')} className="opportunities-c-service">
                        <div><b>{sv ? serviceName(sv, lang) : t('catalog.gone')}</b>{sv && !sv.active && <span className="badge opportunities-gap">{t('catalog.retired')}</span>}</div>
                        <div className="xs muted">{rule ? t('opportunities.byRule', { rule: rule.name }) : o.by === 'automation' ? t('opportunities.byRuleGone') : t('opportunities.byPerson', { name: byId(data.users, o.by)?.name ?? '' })}</div>
                        {o.note && <p className="small opportunities-note">{o.note}</p>}
                        {o.status === 'dismissed' && o.dismissedReason && <p className="small muted opportunities-note">{t('opportunities.reason')}: {o.dismissedReason}</p>}
                      </td>
                      {showMoney && <td data-label={t('common.value')} className="num nowrap">{tier && sv ? <><b>{money(o.value ?? tier.price)}</b>{tier.unit !== 'flat' && <div className="xs muted">{tierPrice(t, { price: o.value ?? tier.price, unit: tier.unit })}</div>}</> : null}</td>}
                      <td data-label={t('opportunities.col.since')} className="small"><div className="opportunities-state"><StatusBadge o={o} /><span className="muted nowrap">{date(o.created)}</span></div></td>
                      <td className="opportunities-c-acts"><Actions o={o} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {add && <AddModal onClose={() => setAdd(false)} />}
    </>
  );
}
