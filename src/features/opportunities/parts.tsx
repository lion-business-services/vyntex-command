// Pieces shared by the opportunities screen and the opportunities tab of a client: what can be done with one opportunity,
// and the small dialogs for it (dismiss with a reason, follow up later, pick a price tier, add one by hand).
import { useState } from 'react';
import { LuBriefcase, LuCheck, LuClock, LuEllipsis, LuMessageCircle, LuRotateCcw, LuUserPlus, LuX } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, go } from '@/app/router';
import { act } from '@/store/store';
import { Badge, Button, Field, IconButton, Menu, Modal, toast, type Tone } from '@/ui';
import { addOpportunity, opportunityToEngagement, opportunityToLead, setOpportunityStatus, snoozeOpportunity } from '@/domain/actions';
import { serviceName, serviceOf, tierOf } from '@/domain/actions/catalog';
import type { Opp } from '@/domain/actions/opportunities';
import { visibleClients } from '@/domain/access';
import { moduleOn } from '@/domain/config';
import { byId } from '@/domain/selectors';
import type { Opportunity } from '@/domain/types';
import { categoriesOf, categoryLabel, tierPrice } from '@/features/catalog/parts';
import { addDays, today } from '@/lib/dates';

export const STATUS_TONE: Record<Opportunity['status'], Tone> = { open: 'accent', contacted: 'info', won: 'ok', dismissed: 'neutral' };
/** Set aside until a later day: still open, out of the way until then. */
export const isLater = (o: Opp, day = today()) => (o.status === 'open' || o.status === 'contacted') && !!o.followUp && o.followUp > day;
const REASONS = ['notInterested', 'hasProvider', 'notNow', 'notFit'] as const;

export function StatusBadge({ o }: { o: Opp }) {
  const { t, day } = useApp();
  return isLater(o) ? <Badge tone="violet"><LuClock aria-hidden="true" />{t('opportunities.laterUntil', { date: day(o.followUp) })}</Badge> : <Badge tone={STATUS_TONE[o.status]}>{t('opportunities.is.' + o.status)}</Badge>;
}

/** What a person can do with one opportunity, as one main button and a menu. Opens the dialogs it needs itself. */
export function Actions({ o }: { o: Opp }) {
  const { t, data, pack, can } = useApp();
  const [ask, setAsk] = useState<'dismiss' | 'later' | 'tier' | null>(null);
  if (!can('write')) return null;
  const service = serviceOf(data, o.serviceId);
  const lead = byId(data.leads, o.leadId); const job = byId(data.jobs, o.jobId);
  const sellable = !!service && service.active;
  const canLead = can('leads') && moduleOn(data, pack, 'leads'); const canJob = can('jobs') && moduleOn(data, pack, 'jobs');
  const toLead = () => { const l = act(opportunityToLead, o.id); if (l) { toast(t('opportunities.toLead.done')); go(`/leads/${l.id}`); } };
  const toJob = (tierId?: string) => { const j = act(opportunityToEngagement, o.id, tierId); if (j) { toast(t('opportunities.toJob.done')); go(`/jobs/${j.id}`); } };
  const startJob = () => (service && service.tiers.length > 1 ? setAsk('tier') : toJob());
  const set = (status: Opportunity['status'], msg: string) => { act(setOpportunityStatus, o.id, status); toast(t(msg)); };

  if (o.status === 'won') return job && canJob ? <A to={`/jobs/${job.id}`} className="btn sm" data-testid="opp-open-job">{t('opportunities.openJob')}</A> : null;
  if (o.status === 'dismissed') return <Button size="sm" icon={<LuRotateCcw aria-hidden="true" />} onClick={() => set('open', 'opportunities.reopened')} data-testid="opp-reopen">{t('opportunities.reopen')}</Button>;
  return (
    <span className="row tight nowrap opportunities-acts">
      {o.status === 'open'
        ? <Button size="sm" icon={<LuMessageCircle aria-hidden="true" />} onClick={() => set('contacted', 'opportunities.contacted.done')} data-testid="opp-contacted">{t('opportunities.contacted')}</Button>
        : sellable && canJob ? <Button size="sm" icon={<LuBriefcase aria-hidden="true" />} onClick={startJob} data-testid="opp-to-job">{t('opportunities.toJob')}</Button> : null}
      <span className="opportunities-more"><Menu label={t('common.more')} button={<IconButton size="sm" label={t('common.more')} data-testid="opp-more"><LuEllipsis /></IconButton>}>
        {lead && canLead ? <A to={`/leads/${lead.id}`}><LuUserPlus aria-hidden="true" />{t('opportunities.openLead')}</A>
          : sellable && canLead ? <button type="button" onClick={toLead} data-testid="opp-to-lead"><LuUserPlus aria-hidden="true" />{t('opportunities.toLead')}</button> : null}
        {sellable && canJob && o.status === 'open' && <button type="button" onClick={startJob} data-testid="opp-to-job"><LuBriefcase aria-hidden="true" />{t('opportunities.toJob')}</button>}
        <button type="button" onClick={() => set('won', 'opportunities.won.done')} data-testid="opp-won"><LuCheck aria-hidden="true" />{t('opportunities.markWon')}</button>
        <button type="button" onClick={() => setAsk('later')} data-testid="opp-later"><LuClock aria-hidden="true" />{t('opportunities.later')}</button>
        {o.status === 'contacted' && <button type="button" onClick={() => set('open', 'opportunities.reopened')}><LuRotateCcw aria-hidden="true" />{t('opportunities.backToOpen')}</button>}
        <div className="sep" />
        <button type="button" onClick={() => setAsk('dismiss')} data-testid="opp-dismiss"><LuX aria-hidden="true" />{t('opportunities.dismiss')}</button>
      </Menu></span>
      {ask === 'dismiss' && <DismissModal o={o} onClose={() => setAsk(null)} />}
      {ask === 'later' && <LaterModal o={o} onClose={() => setAsk(null)} />}
      {ask === 'tier' && service && <TierModal o={o} onPick={(id) => { setAsk(null); toJob(id); }} onClose={() => setAsk(null)} />}
    </span>
  );
}

function DismissModal({ o, onClose }: { o: Opp; onClose: () => void }) {
  const { t } = useApp();
  const [why, setWhy] = useState<string>(REASONS[0]);
  const [text, setText] = useState('');
  const save = () => {
    const reason = [why === 'other' ? '' : t('opportunities.reason.' + why), text.trim()].filter(Boolean).join('. ');
    act(setOpportunityStatus, o.id, 'dismissed', reason); toast(t('opportunities.dismissed.done')); onClose();
  };
  return (
    <Modal title={t('opportunities.dismiss')} onClose={onClose} size="narrow" labelClose={t('common.close')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={save} disabled={why === 'other' && !text.trim()} data-testid="opp-dismiss-save">{t('opportunities.dismiss')}</Button></>}>
      <div className="stack tight">
        <p className="small muted">{t('opportunities.dismiss.hint')}</p>
        <Field label={t('opportunities.reason')}>
          <select value={why} onChange={(e) => setWhy(e.target.value)} data-testid="opp-dismiss-reason">{[...REASONS, 'other'].map((r) => <option key={r} value={r}>{t('opportunities.reason.' + r)}</option>)}</select>
        </Field>
        <Field label={why === 'other' ? t('opportunities.reason.write') : `${t('opportunities.reason.more')} (${t('common.optional')})`}>
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} data-testid="opp-dismiss-text" />
        </Field>
      </div>
    </Modal>
  );
}

function LaterModal({ o, onClose }: { o: Opp; onClose: () => void }) {
  const { t, can } = useApp();
  const [until, setUntil] = useState(addDays(30));
  const [task, setTask] = useState(can('tasks'));
  const save = () => { act(snoozeOpportunity, o.id, until, task); toast(t('opportunities.later.done')); onClose(); };
  return (
    <Modal title={t('opportunities.later')} onClose={onClose} size="narrow" labelClose={t('common.close')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={save} disabled={!until || until <= today()} data-testid="opp-later-save">{t('common.save')}</Button></>}>
      <div className="stack tight">
        <p className="small muted">{t('opportunities.later.hint')}</p>
        <Field label={t('opportunities.later.until')}><input type="date" value={until} min={addDays(1)} onChange={(e) => setUntil(e.target.value)} data-testid="opp-later-date" /></Field>
        {can('tasks') && <label className="check"><input type="checkbox" checked={task} onChange={(e) => setTask(e.target.checked)} /><span>{t('opportunities.later.task')}</span></label>}
      </div>
    </Modal>
  );
}

/** A service with several price tiers: which one did the client agree to? */
function TierModal({ o, onPick, onClose }: { o: Opp; onPick: (tierId: string) => void; onClose: () => void }) {
  const { t, data, lang, can } = useApp();
  const service = serviceOf(data, o.serviceId);
  const [tierId, setTierId] = useState(tierOf(service)?.id ?? '');
  if (!service) return null;
  return (
    <Modal title={t('opportunities.toJob')} onClose={onClose} size="narrow" labelClose={t('common.close')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={() => onPick(tierId)} data-testid="opp-tier-save">{t('opportunities.toJob')}</Button></>}>
      <div className="stack tight">
        <p className="small"><b>{serviceName(service, lang)}</b></p>
        <div role="radiogroup" aria-label={t('jobs.f.tier')} className="stack tight">
          {service.tiers.map((x) => <label key={x.id} className="check"><input type="radio" name="opp-tier" checked={tierId === x.id} onChange={() => setTierId(x.id)} /><span>{x.name}{can('money') && <span className="muted"> · {tierPrice(t, x)}</span>}</span></label>)}
        </div>
        <p className="xs muted">{t('opportunities.toJob.hint')}</p>
      </div>
    </Modal>
  );
}

/** An opportunity a person noticed, for a client they may open and a service that can still be sold. */
export function AddModal({ clientId, onClose }: { clientId?: string; onClose: () => void }) {
  const { t, data, pack, lang, user, perms } = useApp();
  const clients = visibleClients(data, user, perms).filter((c) => c.lifecycle !== 'former' || c.id === clientId);
  const services = (data.catalog ?? []).filter((s) => s.active);
  const [client, setClient] = useState(clientId ?? clients[0]?.id ?? '');
  const [service, setService] = useState(services[0]?.id ?? '');
  const [note, setNote] = useState('');
  const save = () => {
    // one open opportunity per client and service: a second one is not created, and the person is told so
    const already = (data.opportunities ?? []).some((o) => o.clientId === client && o.serviceId === service && (o.status === 'open' || o.status === 'contacted'));
    if (!act(addOpportunity, { clientId: client, serviceId: service, note })) return;
    toast(t(already ? 'opportunities.add.exists' : 'opportunities.add.done')); onClose();
  };
  return (
    <Modal title={t('opportunities.add')} onClose={onClose} labelClose={t('common.close')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={save} disabled={!client || !service} data-testid="opp-add-save">{t('common.save')}</Button></>}>
      {!services.length ? <p className="muted">{t('opportunities.add.noServices')}</p> : (
        <div className="fgrid">
          {!clientId && (
            <Field label={t('client')} full>
              <select value={client} onChange={(e) => setClient(e.target.value)} data-testid="opp-add-client">{clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` · ${c.company}` : ''}</option>)}</select>
            </Field>
          )}
          <Field label={t('opportunities.col.service')} full>
            <select value={service} onChange={(e) => setService(e.target.value)} data-testid="opp-add-service">
              {categoriesOf(pack, services).map((g) => <optgroup key={g} label={categoryLabel(t, pack, g)}>{services.filter((s) => s.category === g).map((s) => <option key={s.id} value={s.id}>{serviceName(s, lang)}</option>)}</optgroup>)}
            </select>
          </Field>
          <Field label={`${t('opportunities.add.note')} (${t('common.optional')})`} full><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} data-testid="opp-add-note" /></Field>
        </div>
      )}
    </Modal>
  );
}
