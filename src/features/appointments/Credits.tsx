// Credits: what the business owes clients in service. A balance per client and the ledger behind it.
// An entry is never edited: a credit is used once, voided with a reason, or runs out on its date.
import { useMemo, useState } from 'react';
import { LuBan } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, go, useRoute } from '@/app/router';
import { BackLink } from '@/app/Shell';
import { gateway } from '@/platform/gateway';
import { Button, Card, Empty, FormModal, PageHeader, Stat } from '@/ui';
import { NoAccess } from '@/app/shared';
import { byId } from '@/domain/selectors';
import { visibleClients } from '@/domain/access';
import { appointmentRules } from '@/domain/config';
import { activeCredits, creditBalance, creditState, creditsExpiringSoon, sumMoney, type CreditState } from '@/domain/actions/appointments';
import type { Credit } from '@/domain/types';
import { money2 } from '@/lib/money';
import { CreditStateBadge, useProtected } from './parts';

const STATES: CreditState[] = ['active', 'used', 'expired', 'void'];

export function CreditsView() {
  const { t, data, user, perms, can, date, dateTime } = useApp();
  const route = useRoute();
  const run = useProtected();
  const clients = useMemo(() => visibleClients(data, user, perms), [data, user, perms]);
  const mine = useMemo(() => { const ids = new Set(clients.map((c) => c.id)); return data.credits.filter((c) => ids.has(c.clientId)); }, [data.credits, clients]);
  const [client, setClient] = useState(route.query.get('client') ?? '');
  const [state, setState] = useState<'' | CreditState>('');
  const [voiding, setVoiding] = useState<Credit | null>(null);
  if (!can('money')) return <><PageHeader title={t('appointments.credits')} /><NoAccess /></>;

  const rules = appointmentRules(data);
  const rows = mine.filter((c) => (!client || c.clientId === client) && (!state || creditState(c) === state)).sort((a, b) => b.at.localeCompare(a.at));
  const holders = clients.filter((c) => mine.some((x) => x.clientId === c.id)).map((c) => ({ c, usable: activeCredits(data, c.id) })).sort((a, b) => creditBalance(data, b.c.id) - creditBalance(data, a.c.id));
  const usable = mine.filter((c) => creditState(c) === 'active');
  const soon = creditsExpiringSoon({ credits: mine }, 7);
  const filtered = !!(client || state);
  const clear = () => { setClient(''); setState(''); };
  const mayVoid = can('write') && can('credits');
  const name = (id: string | undefined) => byId(data.users, id)?.name ?? t('common.system');

  return (
    <>
      <BackLink to="/appointments">{t('appointments.back')}</BackLink>
      <PageHeader title={t('appointments.credits')} sub={t('appointments.cr.sub')} />
      <div className="kpis appointments-kpis">
        <Stat label={t('appointments.cr.usable')} value={money2(sumMoney(usable, (c) => c.amount))} hint={t('appointments.cr.usableHint', { n: usable.length })} testId="appointments-cr-usable" />
        <Stat label={t('appointments.cr.soon')} value={soon.length} attention={soon.length > 0} hint={t('appointments.cr.soonHint')} onClick={soon.length ? () => setState('active') : undefined} />
        <Stat label={t('appointments.cr.rule')} value={rules.creditDays > 0 ? t('appointments.cr.ruleDays', { n: rules.creditDays }) : t('appointments.cr.ruleNever')} hint={t('appointments.cr.ruleHint')} onClick={can('settings') && can('config') ? () => go('/settings/appointments') : undefined} />
      </div>

      {!mine.length ? <Card><Empty title={t('appointments.cr.empty')}>{t('appointments.cr.emptyHint')}</Empty></Card> : (
        <div className="stack">
          <Card title={t('appointments.cr.balances')} flush>
            <div className="table-wrap">
              <table className="tbl stackable" data-testid="appointments-cr-balances">
                <thead><tr><th>{t('client')}</th><th className="num">{t('appointments.cr.balance')}</th><th className="num">{t('appointments.cr.count')}</th><th>{t('appointments.cr.nextExpiry')}</th></tr></thead>
                <tbody>
                  {holders.map(({ c, usable: u }) => {
                    const next = u.find((x) => x.expires)?.expires;
                    return (
                      <tr key={c.id} className="click" onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button')) setClient(c.id); }}>
                        <td className="t1"><A to={`/clients/${c.id}`}>{c.name}</A>{c.company && <div className="xs dim">{c.company}</div>}</td>
                        <td data-label={t('appointments.cr.balance')} className="num appointments-figure">{money2(creditBalance(data, c.id))}</td>
                        <td data-label={t('appointments.cr.count')} className="num">{u.length}</td>
                        <td data-label={t('appointments.cr.nextExpiry')}>{u.length ? (next ? date(next) : t('appointments.cr.noExpiry')) : <span className="dim">{t('common.none')}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={t('appointments.cr.ledger')} flush>
            <div className="filters appointments-ledger-filters">
              <select value={client} onChange={(e) => setClient(e.target.value)} aria-label={t('client')} data-testid="appointments-cr-client">
                <option value="">{t('appointments.cr.allClients')}</option>{holders.map(({ c }) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={state} onChange={(e) => setState(e.target.value as CreditState | '')} aria-label={t('common.status')} data-testid="appointments-cr-state">
                <option value="">{t('appointments.all.statuses')}</option>{STATES.map((s) => <option key={s} value={s}>{t('appointments.cr.st.' + s)}</option>)}
              </select>
              {filtered && <button type="button" className="linkbtn small" onClick={clear}>{t('common.clearFilters')}</button>}
            </div>
            {!rows.length ? <Empty title={t('common.noResults')} action={<Button onClick={clear}>{t('common.clearFilters')}</Button>} /> : (
              <div className="table-wrap">
                <table className="tbl stackable" data-testid="appointments-cr-ledger">
                  <thead><tr><th>{t('common.date')}</th><th>{t('client')}</th><th className="num">{t('common.amount')}</th><th>{t('appointments.cr.reason')}</th><th>{t('common.status')}</th><th>{t('appointments.cr.expires')}</th><th /></tr></thead>
                  <tbody>
                    {rows.map((c) => {
                      const s = creditState(c); const who = byId(data.clients, c.clientId);
                      return (
                        <tr key={c.id} data-credit={c.id} data-state={s}>
                          <td className="t1">{dateTime(c.at)}<div className="xs dim">{name(c.by)}</div></td>
                          <td data-label={t('client')}>{who ? <A to={`/clients/${who.id}`}>{who.name}</A> : null}</td>
                          <td data-label={t('common.amount')} className="num appointments-figure">{money2(c.amount)}</td>
                          <td data-label={t('appointments.cr.reason')}><span>{t('appointments.cr.why.' + c.reason)}{c.fromApptId && <A to={`/appointments/${c.fromApptId}`} className="xs appointments-block">{t('appointments.cr.source')}</A>}</span></td>
                          <td data-label={t('common.status')}><span><CreditStateBadge credit={c} />
                            {c.used && <A to={`/appointments/${c.used.apptId}`} className="xs appointments-block">{t('appointments.cr.usedOn', { date: dateTime(c.used.at) })}</A>}
                            {c.void && <span className="xs dim appointments-block">{t('appointments.cr.voidBy', { name: name(c.void.by), reason: c.void.reason })}</span>}</span></td>
                          <td data-label={t('appointments.cr.expires')}>{c.expires ? date(c.expires) : <span className="dim">{t('appointments.cr.noExpiry')}</span>}</td>
                          <td className="num">{mayVoid && s === 'active' && <Button size="sm" variant="ghost" icon={<LuBan />} onClick={() => setVoiding(c)} data-testid="appointments-cr-void">{t('appointments.cr.void')}</Button>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <p className="xs dim">{t('appointments.cr.ledgerNote')}</p>
        </div>
      )}

      {voiding && (
        <FormModal title={t('appointments.cr.voidTitle', { amount: money2(voiding.amount) })} onClose={() => setVoiding(null)} saveLabel={t('appointments.cr.void')} cancelLabel={t('common.cancel')} requiredMsg={t('common.required')}
          fields={[{ k: 'reason', label: t('appointments.f.reason'), type: 'textarea', req: true, hint: t('appointments.cr.voidHint') }]}
          onSave={(v) => { void run(gateway().protected.creditVoid(voiding.id, v.reason), t('appointments.cr.voided')); }} />
      )}
    </>
  );
}
