// "Secure data" on a client's page: whether a tax ID is on file (its type and last four digits, never more), putting one on
// file, asking to see it, approving someone else's request, the one viewing, and the access log of all of it.
// Registered in src/features/clients/tabs.ts; the tab needs `secureView`.
import { useEffect, useRef, useState } from 'react';
import { LuCheck, LuEye, LuFingerprint, LuKeyRound, LuPencil, LuTrash2, LuX } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { Button, Card, Empty, Note, confirmDialog, toast } from '@/ui';
import type { ClientTabProps } from '@/features/clients/tabs';
import type { RevealRequest } from '@/domain/types';
import { vaultRules } from '@/domain/config';
import { maskedTaxId, revealState } from '@/domain/actions/security';
import { ops } from './ops';
import { StepUpHost, askStepUp } from './stepup';
import { Person, RevealBadge, SampleNote, SecureLogTable, reasonText, sampleWord, whoName } from './parts';
import { RequestModal, RevealPanel, TaxIdModal, type Opened } from './vault';
import './security.css';

/** Redraws once a second while something on screen is counting down (an approval's window). */
function useTick(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!on) return; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [on]);
  return now;
}
const minutesLeft = (iso: string | undefined, now: number) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 60000)) : 0);

export default function SecureClientTab({ client }: ClientTabProps) {
  const { t, data, can, user, live, date, dateTime } = useApp();
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [busy, setBusy] = useState('');
  const openedRequest = useRef<RevealRequest | null>(null);

  const mayAct = can('secureReveal') && can('write');
  const mayApprove = can('secureApprove') && can('write');
  const seesLog = can('audit') || can('secureApprove');
  const rule = vaultRules(data).approval;
  const all = data.reveals.filter((r) => r.clientId === client.id);
  const mine = all.find((r) => r.requestedBy === user?.id && ['pending', 'approved'].includes(revealState(r)));
  const mineState = mine ? revealState(mine) : null;
  const now = useTick(mineState === 'approved');
  const waiting = all.filter((r) => revealState(r) === 'pending' && r.requestedBy !== user?.id);
  const log = data.secureLog.filter((e) => e.clientId === client.id);
  const lastSet = log.find((e) => e.action === 'set');
  // what this person may see of the history: everything for whoever reads the log, otherwise their own requests
  const history = (seesLog ? all : all.filter((r) => r.requestedBy === user?.id)).filter((r) => r !== mine && !waiting.includes(r));

  const decide = async (r: RevealRequest, approve: boolean) => {
    setBusy(r.id);
    const res = await ops.vaultDecide(r.id, approve);
    setBusy('');
    if (!res.ok) { toast(reasonText(t, res.reason), true); return; }
    toast(t(approve ? 'security.q.approved' : 'security.q.denied', { name: whoName(data, t, r.requestedBy) }));
  };
  const approveMine = async () => {
    if (!mine) return;
    // the single authorised person confirms who they are; a live workspace asks for it when the approval is sent
    if (!live && !(await askStepUp())) return;
    const res = await ops.vaultDecide(mine.id, true);
    if (!res.ok) toast(reasonText(t, res.reason), true);
  };
  const withdraw = async () => {
    if (!mine || !(await confirmDialog(t('security.mine.withdrawConfirm'), t('security.mine.withdraw'), t('common.cancel')))) return;
    const res = await ops.vaultDecide(mine.id, false);
    if (!res.ok) toast(reasonText(t, res.reason), true);
  };
  const open = async () => {
    if (!mine) return;
    setBusy('open');
    const res = await ops.vaultReveal(mine.id);
    setBusy('');
    if (!res.ok) { toast(reasonText(t, res.reason), true); return; }
    // the value moves into a holder outside React state and is taken out of the answer it arrived in
    const secret = { value: res.data.value };
    res.data.value = null;
    openedRequest.current = mine;
    setOpened({ requestId: mine.id, secret, hideAt: res.data.hideAt, last4: res.data.last4 ?? client.taxIdLast4, sample: res.sample, seconds: Math.max(1, Math.round((new Date(res.data.hideAt).getTime() - Date.now()) / 1000)) });
  };
  const remove = async () => {
    if (!client.taxIdType || !(await confirmDialog(t('security.tax.removeConfirm', { client: client.name }), t('security.tax.remove'), t('common.cancel')))) return;
    // an empty value takes the number off file
    const res = await ops.vaultSet(client.id, client.taxIdType, '');
    toast(res.ok ? t('security.tax.removed') : reasonText(t, res.reason), !res.ok);
  };

  return (
    <div className="stack security-tab" data-testid="security-client-tab">
      {!live && <SampleNote>{t('security.tab.sample', { sample: sampleWord(t) })}</SampleNote>}

      <Card title={t('security.tax.title')} actions={mayAct && !opened ? <>
        {client.taxIdType && <Button size="sm" variant="ghost" icon={<LuTrash2 aria-hidden="true" />} onClick={remove} data-testid="security-tax-remove">{t('security.tax.remove')}</Button>}
        <Button size="sm" icon={<LuPencil aria-hidden="true" />} onClick={() => setEditing(true)} data-testid="security-tax-edit">{t(client.taxIdType ? 'security.tax.replace' : 'security.tax.add')}</Button>
      </> : undefined}>
        {!client.taxIdType ? (
          <Empty title={t('security.tax.none')} action={mayAct ? <Button variant="primary" icon={<LuKeyRound aria-hidden="true" />} onClick={() => setEditing(true)} data-testid="security-tax-add">{t('security.tax.add')}</Button> : undefined}>{t(mayAct ? 'security.tax.noneHint' : 'security.tax.noneHintView')}</Empty>
        ) : (
          <>
            <div className="security-onfile" data-testid="security-onfile">
              <span className="security-onfile-ic" aria-hidden="true"><LuFingerprint /></span>
              <div className="grow">
                <div className="xs dim">{t('security.tax.type.' + client.taxIdType)}</div>
                <div className="security-marker" aria-label={t('security.tax.ending', { last4: client.taxIdLast4 ?? '' })}>{maskedTaxId(client.taxIdType, client.taxIdLast4)}</div>
                <div className="small muted">{lastSet ? t('security.tax.setBy', { name: whoName(data, t, lastSet.userId), date: date(lastSet.at.slice(0, 10)) }) : t('security.tax.onFile')}</div>
              </div>
              {mayAct && !mine && !opened && <Button variant="primary" icon={<LuEye aria-hidden="true" />} onClick={() => setAsking(true)} data-testid="security-ask">{t('security.ask.open')}</Button>}
            </div>

            {!mayAct && <p className="small muted security-foot">{t(can('write') ? 'security.tax.cannotAsk' : 'security.tax.cannotAskRead')}</p>}

            {mine && !opened && (
              <div className="security-mine" data-state={mineState} data-testid="security-mine">
                <div className="row tight"><b>{t('security.mine.title')}</b><RevealBadge request={mine} /></div>
                <p className="small">{t('security.mine.reason')}: {mine.reason}</p>
                {mineState === 'pending' && (rule === 'step_up' && mayAct
                  ? <p className="small muted">{t('security.mine.confirmFirst')}</p>
                  : <p className="small muted">{t('security.mine.waiting')}</p>)}
                {mineState === 'approved' && <p className="small muted">{t('security.mine.approved', { name: whoName(data, t, mine.approverId), minutes: minutesLeft(mine.expiresAt, now) })}</p>}
                <div className="row">
                  {mineState === 'approved' && <Button variant="primary" icon={<LuEye aria-hidden="true" />} onClick={open} disabled={busy === 'open'} data-testid="security-open">{t('security.mine.open')}</Button>}
                  {mineState === 'pending' && rule === 'step_up' && mayAct && <Button variant="primary" onClick={approveMine} data-testid="security-confirm-self">{t('security.mine.confirm')}</Button>}
                  {mineState === 'pending' && <Button variant="ghost" onClick={withdraw} data-testid="security-withdraw">{t('security.mine.withdraw')}</Button>}
                </div>
              </div>
            )}

            {opened && openedRequest.current && <RevealPanel client={client} request={openedRequest.current} opened={opened} onClose={() => { setOpened(null); openedRequest.current = null; }} />}
          </>
        )}
      </Card>

      {(waiting.length > 0 || history.length > 0) && (
        <Card title={t('security.req.title')}>
          <div className="list" data-testid="security-requests">
            {waiting.map((r) => (
              <div className="item security-req" key={r.id} data-request={r.id}>
                <div className="grow">
                  <div className="t row tight"><Person id={r.requestedBy} /><RevealBadge request={r} /></div>
                  <div className="small">{r.reason}</div>
                  <div className="xs dim">{dateTime(r.at)}</div>
                </div>
                {mayApprove && (
                  <div className="row tight security-req-act">
                    <Button size="sm" icon={<LuCheck aria-hidden="true" />} onClick={() => decide(r, true)} disabled={busy === r.id} data-testid="security-approve">{t('security.q.approve')}</Button>
                    <Button size="sm" variant="ghost" icon={<LuX aria-hidden="true" />} onClick={() => decide(r, false)} disabled={busy === r.id} data-testid="security-deny">{t('security.q.deny')}</Button>
                  </div>
                )}
              </div>
            ))}
            {history.slice(0, 6).map((r) => (
              <div className="item security-req" key={r.id}>
                <div className="grow">
                  <div className="t row tight"><Person id={r.requestedBy} /><RevealBadge request={r} /></div>
                  <div className="small">{r.reason}</div>
                  <div className="xs dim">{dateTime(r.at)}{r.approverId && r.approverId !== r.requestedBy ? ` · ${t('security.req.decidedBy', { name: whoName(data, t, r.approverId) })}` : ''}</div>
                </div>
              </div>
            ))}
          </div>
          {waiting.length > 0 && mayApprove && rule === 'second_person' && <p className="xs dim security-foot">{t('security.req.rule')}</p>}
        </Card>
      )}

      {seesLog && (
        <Card flush title={t('security.log.title')} actions={can('users') ? <A to="/security/log" className="btn sm ghost">{t('security.log.all')}</A> : undefined}>
          {log.length ? <SecureLogTable entries={log} limit={25} /> : <p className="muted small security-pad">{t('security.log.empty')}</p>}
          <p className="xs dim security-pad">{t('security.log.fixed')}</p>
        </Card>
      )}
      {!seesLog && <Note>{t('security.log.kept')}</Note>}

      {editing && <TaxIdModal client={client} onClose={() => setEditing(false)} />}
      {asking && <RequestModal client={client} onClose={() => setAsking(false)} />}
      <StepUpHost />
    </div>
  );
}
