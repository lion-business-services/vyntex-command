// The approvals queue: requests to see a tax ID and requests to see a client of another office, each with who asks, for
// which client, why and when. Approving a tax ID request never shows the approver the number: it lets the person who asked
// open it once, for a short time. Approving an access request creates the access, optionally until a date.
import { useState } from 'react';
import { LuCheck, LuUndo2, LuX } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { Badge, Button, Card, Empty, confirmDialog, toast } from '@/ui';
import type { AccessRequest, RevealRequest } from '@/domain/types';
import { vaultRules } from '@/domain/config';
import { maskedTaxId, revealState, waitingFor } from '@/domain/actions/security';
import { today } from '@/lib/dates';
import { ops } from './ops';
import { Person, RevealBadge, reasonText, whoName } from './parts';

export function ApprovalsSection() {
  const { t, data, can, perms, user, date, dateTime } = useApp();
  const [busy, setBusy] = useState('');
  const [until, setUntil] = useState<Record<string, string>>({});
  const mayReveal = can('secureApprove') && can('write');
  const mayAccess = can('allClients') && can('write');
  const queue = waitingFor(data, user?.id, perms);
  const own = data.reveals.filter((r) => revealState(r) === 'pending' && r.requestedBy === user?.id);
  const client = (id: string) => data.clients.find((c) => c.id === id);
  const office = (id: string | undefined) => data.offices.find((o) => o.id === id)?.name;
  const decided = data.reveals.filter((r) => revealState(r) !== 'pending').slice(0, 8);
  const grants = data.grants.filter((g) => !g.expires || g.expires >= today());

  const decideReveal = async (r: RevealRequest, approve: boolean) => {
    setBusy(r.id);
    const res = await ops.vaultDecide(r.id, approve);
    setBusy('');
    toast(res.ok ? t(approve ? 'security.q.approved' : 'security.q.denied', { name: whoName(data, t, r.requestedBy) }) : reasonText(t, res.reason), !res.ok);
  };
  const decideAccess = async (r: AccessRequest, approve: boolean) => {
    setBusy(r.id);
    const res = await ops.grantDecide(r.id, approve, approve ? until[r.id] || undefined : undefined);
    setBusy('');
    toast(res.ok ? t(approve ? 'security.q.accessGranted' : 'security.q.accessDenied', { name: whoName(data, t, r.userId) }) : reasonText(t, res.reason), !res.ok);
  };
  const takeBack = async (grantId: string, name: string, clientName: string) => {
    if (!(await confirmDialog(t('security.q.revokeConfirm', { name, client: clientName }), t('security.q.revoke'), t('common.cancel')))) return;
    const res = await ops.grantRevoke(grantId);
    toast(res.ok ? t('security.q.revoked') : reasonText(t, res.reason), !res.ok);
  };

  return (
    <>
      {(mayReveal || own.length > 0) && (
        <Card title={<>{t('security.q.revealTitle')}{queue.reveals.length > 0 && <span className="count">{queue.reveals.length}</span>}</>}>
          <p className="muted security-lead">{t(vaultRules(data).approval === 'second_person' ? 'security.q.revealIntro' : 'security.q.revealIntroStepUp')}</p>
          {!queue.reveals.length && !own.length ? <Empty title={t('security.q.revealNone')} /> : (
            <div className="list" data-testid="security-queue-reveals">
              {queue.reveals.map((r) => { const c = client(r.clientId); return (
                <div className="item security-req" key={r.id} data-request={r.id}>
                  <div className="grow">
                    <div className="t row tight"><Person id={r.requestedBy} /><span className="muted small">{t('security.q.asksFor')}</span>{c ? <A to={`/clients/${c.id}/secure`}>{c.name}</A> : <span className="dim">{t('security.log.otherOffice')}</span>}{c?.company && <span className="muted small">{c.company}</span>}</div>
                    {c?.taxIdType && <div className="xs dim">{t('security.tax.type.' + c.taxIdType)} · <span className="security-mono">{maskedTaxId(c.taxIdType, c.taxIdLast4)}</span></div>}
                    <div className="small security-why">{r.reason}</div>
                    <div className="xs dim">{dateTime(r.at)}</div>
                  </div>
                  <div className="row tight security-req-act">
                    <Button size="sm" icon={<LuCheck aria-hidden="true" />} onClick={() => decideReveal(r, true)} disabled={busy === r.id} data-testid="security-approve">{t('security.q.approve')}</Button>
                    <Button size="sm" variant="ghost" icon={<LuX aria-hidden="true" />} onClick={() => decideReveal(r, false)} disabled={busy === r.id} data-testid="security-deny">{t('security.q.deny')}</Button>
                  </div>
                </div>
              ); })}
              {own.map((r) => { const c = client(r.clientId); return (
                <div className="item security-req" key={r.id} data-own="">
                  <div className="grow">
                    <div className="t row tight"><span>{t('security.q.yours')}</span>{c && <A to={`/clients/${c.id}/secure`}>{c.name}</A>}<RevealBadge request={r} /></div>
                    <div className="small security-why">{r.reason}</div>
                    <div className="xs dim">{t('security.q.yoursHint')}</div>
                  </div>
                </div>
              ); })}
            </div>
          )}
          {decided.length > 0 && (
            <details className="security-more">
              <summary>{t('security.q.recent')}</summary>
              <div className="list">
                {decided.map((r) => { const c = client(r.clientId); return (
                  <div className="item" key={r.id}>
                    <div className="grow">
                      <div className="t row tight"><Person id={r.requestedBy} />{c && <span className="muted small">{c.name}</span>}<RevealBadge request={r} /></div>
                      <div className="xs dim">{dateTime(r.at)}{r.approverId && r.approverId !== r.requestedBy ? ` · ${t('security.req.decidedBy', { name: whoName(data, t, r.approverId) })}` : ''}</div>
                    </div>
                  </div>
                ); })}
              </div>
            </details>
          )}
        </Card>
      )}

      {mayAccess && (
        <Card title={<>{t('security.q.accessTitle')}{queue.access.length > 0 && <span className="count">{queue.access.length}</span>}</>}>
          <p className="muted security-lead">{t('security.q.accessIntro')}</p>
          {!queue.access.length ? <Empty title={t('security.q.accessNone')} /> : (
            <div className="list" data-testid="security-queue-access">
              {queue.access.map((r) => { const c = client(r.clientId); return (
                <div className="item security-req" key={r.id} data-request={r.id}>
                  <div className="grow">
                    <div className="t row tight"><Person id={r.userId} /><span className="muted small">{t('security.q.asksToSee')}</span>{c ? <A to={`/clients/${c.id}`}>{c.name}</A> : null}{office(c?.officeId) && <Badge outline>{office(c?.officeId)}</Badge>}</div>
                    <div className="small security-why">{r.reason || <span className="dim">{t('security.log.noReason')}</span>}</div>
                    <div className="xs dim">{dateTime(r.at)}</div>
                  </div>
                  <div className="security-req-act security-grant">
                    <label className="xs muted">{t('security.q.until')} ({t('common.optional')})
                      <input className="input" type="date" min={today()} value={until[r.id] ?? ''} onChange={(e) => setUntil((u) => ({ ...u, [r.id]: e.target.value }))} data-testid="security-access-until" />
                    </label>
                    <div className="row tight">
                      <Button size="sm" icon={<LuCheck aria-hidden="true" />} onClick={() => decideAccess(r, true)} disabled={busy === r.id} data-testid="security-access-approve">{t('security.q.approve')}</Button>
                      <Button size="sm" variant="ghost" icon={<LuX aria-hidden="true" />} onClick={() => decideAccess(r, false)} disabled={busy === r.id} data-testid="security-access-deny">{t('security.q.deny')}</Button>
                    </div>
                  </div>
                </div>
              ); })}
            </div>
          )}
          {grants.length > 0 && (
            <>
              <h3 className="security-h3">{t('security.q.inForce')}</h3>
              <div className="list" data-testid="security-grants">
                {grants.map((g) => { const c = client(g.clientId); const name = whoName(data, t, g.userId); return (
                  <div className="item security-req" key={g.id}>
                    <div className="grow">
                      <div className="t row tight"><Person id={g.userId} /><span className="muted small">{t('security.q.sees')}</span>{c ? <A to={`/clients/${c.id}`}>{c.name}</A> : null}</div>
                      <div className="xs dim">{g.expires ? t('security.q.untilDate', { date: date(g.expires) }) : t('security.q.noEnd')} · {t('security.q.grantedBy', { name: whoName(data, t, g.grantedBy) })}</div>
                    </div>
                    <Button size="sm" variant="ghost" icon={<LuUndo2 aria-hidden="true" />} onClick={() => takeBack(g.id, name, c?.name ?? '')} data-testid="security-grant-revoke">{t('security.q.revoke')}</Button>
                  </div>
                ); })}
              </div>
            </>
          )}
        </Card>
      )}
    </>
  );
}
