// Two records for the same client, made into one. The person picks the other record, sees which one stays and what
// moves, and confirms. Needs the `delete` capability, because one record goes away. The rules are in
// `mergeClients` (src/domain/actions/clients.ts): a record with a tax ID on file, protected-data history or credits is
// never the one removed, because only the server may touch those.
import { useMemo, useState } from 'react';
import { LuArrowLeftRight, LuArrowRight } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { go } from '@/app/router';
import { act } from '@/store/store';
import { Button, Modal, Note, SearchBox, toast } from '@/ui';
import { findClientMatches, mergeBlock, mergeClients, mergeCounts } from '@/domain/actions/clients';
import { visibleClients } from '@/domain/access';
import { byId } from '@/domain/selectors';
import type { Client } from '@/domain/types';
import { useDebounced } from '@/features/data/list';

export function MergeDialog({ client, onClose }: { client: Client; onClose: () => void }) {
  const { t, data, user, perms } = useApp();
  const [typed, setTyped] = useState('');
  const q = useDebounced(typed);
  const [otherId, setOtherId] = useState('');
  /** True when the record the dialog was opened from is the one that goes away. */
  const [flipped, setFlipped] = useState(false);
  const other = byId(data.clients, otherId);

  // only records the person may open can be merged; likely duplicates of this client come first
  const mine = useMemo(() => visibleClients(data, user, perms).filter((c) => c.id !== client.id), [data, user, perms, client.id]);
  const suggested = useMemo(() => findClientMatches({ clients: mine }, { name: client.name, email: client.email, phone: client.phone, address: client.addresses[0] }).map((m) => m.client), [mine, client, data]);
  const found = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return suggested.slice(0, 6);
    return mine.filter((c) => [c.name, c.company, c.phone, c.email].some((v) => v && v.toLowerCase().includes(s))).slice(0, 8);
  }, [mine, q, suggested]);

  // start with the record the dialog was opened from as the one that stays, unless only the other way round can be done
  const pickOther = (c: Client) => { setOtherId(c.id); setFlipped(!!mergeBlock(data, client.id, c.id) && !mergeBlock(data, c.id, client.id)); };
  const keep = other && flipped ? other : client; const drop = other ? (flipped ? client : other) : undefined;
  const block = drop ? mergeBlock(data, keep.id, drop.id) : null;
  // the other way round may work: the record with the tax ID or the credits is the one to keep
  const canFlip = !!drop && !!block && !mergeBlock(data, drop.id, keep.id);
  const counts = drop ? mergeCounts(data, drop.id) : null;
  const moving = counts ? ([['jobs', counts.jobs], ['tasks', counts.tasks], ['docs', counts.docs], ['messages', counts.messages], ['appointments', counts.appointments], ['opportunities', counts.opportunities], ['notes', counts.notes]] as [string, number][]).filter(([, n]) => n > 0) : [];
  const label = (c: Client) => (c.company ? `${c.name} · ${c.company}` : c.name);

  const run = () => {
    if (!drop || block) return;
    const out = act(mergeClients, keep.id, drop.id);
    if (!out.ok) { toast(t('clients.merge.block.' + out.reason), true); return; }
    toast(t('clients.merge.done', { name: keep.name })); onClose(); go(`/clients/${keep.id}`);
  };

  return (
    <Modal title={t('clients.merge.title')} onClose={onClose} labelClose={t('common.close')} footer={<>
      <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
      <Button variant="primary" disabled={!drop || !!block} onClick={run} data-testid="clients-merge-run">{drop ? t('clients.merge.go', { name: keep.name }) : t('clients.merge.pick')}</Button>
    </>}>
      <p className="small muted">{t('clients.merge.hint')}</p>
      {!other ? (
        <div className="stack tight clients-gap">
          <SearchBox value={typed} onChange={setTyped} placeholder={t('clients.merge.search')} />
          {!q.trim() && suggested.length > 0 && <p className="xs dim">{t('clients.merge.suggested')}</p>}
          {found.length ? (
            <div className="list" data-testid="clients-merge-list">
              {found.map((c) => <button type="button" key={c.id} className="item click clients-pick" onClick={() => pickOther(c)}><span className="grow"><span className="t">{c.name}</span><span className="xs dim clients-co">{[c.company, c.phone, c.email].filter(Boolean).join(' · ')}</span></span></button>)}
            </div>
          ) : <p className="small muted">{t(q.trim() ? 'common.noResults' : 'clients.merge.type')}</p>}
        </div>
      ) : (
        <div className="stack clients-gap" data-testid="clients-merge-plan">
          <div className="clients-merge">
            <div><span className="xs dim">{t('clients.merge.remove')}</span><span className="t">{drop ? label(drop) : ''}</span></div>
            <LuArrowRight aria-hidden="true" />
            <div className="keep"><span className="xs dim">{t('clients.merge.keep')}</span><span className="t">{label(keep)}</span></div>
          </div>
          <div className="row">
            <Button size="sm" icon={<LuArrowLeftRight />} onClick={() => setFlipped((f) => !f)} data-testid="clients-merge-flip">{t('clients.merge.flip')}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setOtherId(''); setFlipped(false); }}>{t('clients.merge.other')}</Button>
          </div>
          {block ? (
            <Note tone="bad"><span data-testid="clients-merge-block">{t('clients.merge.block.' + block)}{canFlip ? ' ' + t('clients.merge.tryFlip') : ''}</span></Note>
          ) : (
            <>
              <div>
                <p className="small strong">{t('clients.merge.moves')}</p>
                {moving.length ? <ul className="clients-moves">{moving.map(([k, n]) => <li key={k}>{t('clients.merge.n.' + k, { n })}</li>)}</ul> : <p className="small muted">{t('clients.merge.nothing')}</p>}
              </div>
              <p className="small muted">{t('clients.merge.rules')}</p>
              <Note tone="warn">{t('clients.merge.warn')}</Note>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
