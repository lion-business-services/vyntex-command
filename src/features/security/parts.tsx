// Small pieces shared by the security screens: who a record is about, how a refusal is worded, the state of a request,
// and the access log of the protected values. The log has no edit or delete control anywhere: it is a record, not a list.
import type { ReactNode } from 'react';
import { LuFlaskConical } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { Avatar, Badge, type Tone } from '@/ui';
import type { TFn } from '@/i18n';
import type { DemoState, RevealRequest, SecureAccessLog } from '@/domain/types';
import { revealState } from '@/domain/actions/security';
import { DEPLOY } from '@/config/deployment';

/** The name behind an id in a log: a person of the team, or the system itself. */
export function whoName(d: DemoState, t: TFn, id: string | undefined): string {
  if (!id) return t('common.none');
  if (id === 'system' || id === ['service', 'role'].join('_')) return t('common.system');
  if (id === 'automation') return t('common.automation');
  return d.users.find((u) => u.id === id)?.name ?? t('security.someone');
}
export function Person({ id }: { id: string | undefined }) {
  const { data, t } = useApp();
  const name = whoName(data, t, id);
  const known = !!id && data.users.some((u) => u.id === id);
  return <span className="security-person">{known && <Avatar name={name} size="sm" />}<span>{name}</span></span>;
}

/** A refusal in words. The codes are the gateway's (`not_allowed`, `needs_other_person`, `expired`, ...). */
export function reasonText(t: TFn, reason: string): string {
  const key = 'security.reason.' + reason;
  const worded = t(key);
  return worded === key ? t('security.reason.other') : worded;
}

/** The label a sample workspace puts on anything that would be real in a live one. */
export function SampleNote({ children }: { children: ReactNode }) {
  return <div className="note security-sample" data-testid="security-sample-note"><LuFlaskConical aria-hidden="true" /><span>{children}</span></div>;
}
/** "sample workspace" or "sample preview", whichever this deployment calls it. */
export const sampleWord = (t: TFn): string => t(DEPLOY.publicDemo ? 'security.sampleName.demo' : 'security.sampleName.preview');

const REVEAL_TONE: Record<RevealRequest['status'], Tone> = { pending: 'warn', approved: 'ok', denied: 'bad', expired: 'neutral', used: 'info' };
export function RevealBadge({ request }: { request: RevealRequest }) {
  const { t } = useApp();
  const state = revealState(request);
  return <Badge tone={REVEAL_TONE[state]}>{t('security.rv.' + state)}</Badge>;
}

const LOG_TONE: Record<SecureAccessLog['action'], Tone> = { set: 'accent', clear: 'bad', request: 'warn', approve: 'ok', deny: 'bad', reveal: 'info', expire: 'neutral', export: 'violet' };
/**
 * The access log of the protected values: who did what, to which client, when and why. Read only by construction.
 * `showClient` adds the client column (the security center shows every client, a client's page only its own).
 */
export function SecureLogTable({ entries, showClient, limit }: { entries: SecureAccessLog[]; showClient?: boolean; limit?: number }) {
  const { t, data, dateTime, can } = useApp();
  const shown = limit ? entries.slice(0, limit) : entries;
  return (
    <div className="table-wrap">
      <table className="tbl stackable security-log" data-testid="security-log">
        <thead><tr><th>{t('security.log.when')}</th><th>{t('security.log.who')}</th><th>{t('security.log.what')}</th>{showClient && <th>{t('security.log.client')}</th>}<th>{t('security.log.why')}</th></tr></thead>
        <tbody>
          {shown.map((e) => {
            const c = data.clients.find((x) => x.id === e.clientId);
            return (
              <tr key={e.id} data-action={e.action}>
                <td className="t1 nowrap">{dateTime(e.at)}</td>
                <td data-label={t('security.log.who')}><Person id={e.userId} /></td>
                <td data-label={t('security.log.what')}><Badge tone={LOG_TONE[e.action]}>{t('security.log.a.' + e.action)}</Badge></td>
                {showClient && <td data-label={t('security.log.client')}>{c ? (can('clients') ? <A to={`/clients/${c.id}/secure`}>{c.name}</A> : c.name) : <span className="dim">{t('security.log.otherOffice')}</span>}</td>}
                <td data-label={t('security.log.why')} className="small security-why">{e.reason || (e.action === 'request' || e.action === 'reveal' ? <span className="dim">{t('security.log.noReason')}</span> : null)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
