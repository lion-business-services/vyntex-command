// Clients of other offices. A person sees how many records are outside their access and the names only, and can ask for
// access to one, with the reason. The request is a record (`AccessRequest`); deciding it and the grant that follows are
// the server's, on the security screen. Here the person sees where their request stands and can take it back.
import { useMemo, useState } from 'react';
import { LuLock } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { act } from '@/store/store';
import { Badge, Button, Card, FormModal, SearchBox, toast } from '@/ui';
import { requestClientAccess, withdrawAccessRequest } from '@/domain/actions/clients';
import { accessState, type HiddenClient } from '@/domain/access';
import { byId } from '@/domain/selectors';
import type { Client } from '@/domain/types';

const FIRST = 6;

function AskModal({ client, onClose }: { client: { id: string; name: string }; onClose: () => void }) {
  const { t } = useApp();
  return (
    <FormModal title={t('clients.other.askTitle', { name: client.name })} initial={{ reason: '' }} onClose={onClose} saveLabel={t('clients.other.send')} cancelLabel={t('common.cancel')} requiredMsg={t('clients.other.reasonNeeded')}
      fields={[{ k: 'reason', label: t('clients.other.reason'), type: 'textarea', req: true, hint: t('clients.other.reasonHint') }]}
      onSave={(v) => { if (act(requestClientAccess, client.id, v.reason)) toast(t('clients.other.asked', { name: client.name })); }} />
  );
}

/** Where the person's request for one client stands, and what they can do about it. */
function AccessControl({ client }: { client: { id: string; name: string } }) {
  const { t, data, can, user, date } = useApp();
  const [asking, setAsking] = useState(false);
  const { state, request } = accessState(data, user, client.id);
  return (
    <span className="row tight clients-access" data-access={state}>
      {state === 'pending' && <><Badge tone="warn">{t('clients.other.pending')}</Badge>{can('write') && request && <button type="button" className="linkbtn small" onClick={() => { if (act(withdrawAccessRequest, request.id)) toast(t('clients.other.withdrawn')); }}>{t('clients.other.withdraw')}</button>}</>}
      {state === 'denied' && <Badge title={request?.decidedAt ? date(request.decidedAt.slice(0, 10)) : undefined}>{t('clients.other.denied')}</Badge>}
      {state !== 'pending' && can('write') && <Button size="sm" onClick={() => setAsking(true)} data-testid="clients-ask-access">{t(state === 'denied' ? 'clients.other.askAgain' : 'clients.other.ask')}</Button>}
      {asking && <AskModal client={client} onClose={() => setAsking(false)} />}
    </span>
  );
}

/** Under the client list: how many records are outside the person's access, and the names, so they can ask for one. */
export function OtherOffices({ list }: { list: HiddenClient[] }) {
  const { t, data } = useApp();
  const [all, setAll] = useState(false);
  const [q, setQ] = useState('');
  const found = useMemo(() => { const s = q.trim().toLowerCase(); return s ? list.filter((c) => c.name.toLowerCase().includes(s)) : list; }, [list, q]);
  // requests the person already made come first, so their state is in view
  const sorted = useMemo(() => [...found].sort((a, b) => Number(!!b.request && b.request.status !== 'approved') - Number(!!a.request && a.request.status !== 'approved') || a.name.localeCompare(b.name)), [found]);
  const shown = all || q ? sorted.slice(0, 60) : sorted.slice(0, FIRST);
  return (
    <Card title={<><LuLock aria-hidden="true" className="clients-ico" /> {t('clients.other.count', { n: list.length })}</>} className="clients-other">
      <p className="small muted" style={{ marginBottom: 10 }}>{t('clients.other.hint')}</p>
      {list.length > FIRST && <div className="clients-other-find"><SearchBox value={q} onChange={setQ} placeholder={t('clients.other.search')} /></div>}
      <div className="list" data-testid="clients-other">
        {shown.map((c) => (
          <div className="item" key={c.id}>
            <span className="grow"><span className="t">{c.name}</span><span className="xs dim clients-co">{byId(data.offices, c.officeId)?.name ?? ''}</span></span>
            <AccessControl client={c} />
          </div>
        ))}
        {!shown.length && <p className="small muted">{t('common.noResults')}</p>}
      </div>
      {!all && !q && sorted.length > FIRST && <button type="button" className="linkbtn small clients-gap" onClick={() => setAll(true)}>{t('common.seeAll')} ({sorted.length})</button>}
      {(all || q) && sorted.length > shown.length && <p className="xs dim clients-gap">{t('clients.other.more', { n: sorted.length - shown.length })}</p>}
    </Card>
  );
}

/** The page of a client the person may not open: the name, the office, and the way to ask. Nothing else about the client. */
export function ClosedClient({ client }: { client: Client }) {
  const { t, data } = useApp();
  return (
    <Card className="clients-closed">
      <div className="row between">
        <div>
          <h2><LuLock aria-hidden="true" className="clients-ico" /> {client.name}</h2>
          <p className="small muted clients-gap">{t('clients.other.closed', { office: byId(data.offices, client.officeId)?.name ?? '' })}</p>
        </div>
        <AccessControl client={client} />
      </div>
    </Card>
  );
}
