// The dialogs of the leads screens: add or edit a lead, mark it lost, set the next action, hand it to someone else.
import { useState } from 'react';
import { LuCopy } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { appPath, go } from '@/app/router';
import { act } from '@/store/store';
import { Button, FormModal, Modal, cx, toast, type FieldDef } from '@/ui';
import { createLead, handoffLead, updateLead } from '@/domain/actions';
import { findLeadMatches, markLeadLost, setNextAction, upcomingTurns, type LeadMatch } from '@/domain/actions/leads';
import { findClientMatches, isLikelyDuplicate, normEmail, normPhone } from '@/domain/actions/clients';
import { canSeeClient, canSeeLead, officesFor } from '@/domain/access';
import { isOpen, lostReasonsOf, lostStage, routingOf, sourcesOf } from '@/domain/config';
import { byId } from '@/domain/selectors';
import type { Lang, Lead, LeadSource, LeadStage, Priority } from '@/domain/types';
import { today } from '@/lib/dates';
import { serviceName } from './parts';

export const PRIORITIES: Priority[] = ['high', 'medium', 'low'];
const LANGS: Lang[] = ['en', 'es', 'zh'];

/* ---------- add / edit ---------- */
export function LeadForm({ lead, onClose }: { lead?: Lead; onClose: () => void }) {
  const { t, data, pack, lang, user, perms, can } = useApp();
  const sources = sourcesOf(data, pack);
  // a new lead can be given to anyone; changing the owner of an existing one is a handoff and takes the capability for it
  const mayPickOwner = !lead || can('assignLeads');
  // an office that keeps a full pipeline records more about each lead; the field editions keep the short form they always had
  const full = pack.family === 'practice';
  // when the company assigns leads in turn, "next in turn" is the first choice and a person can still be picked by hand
  const auto = !lead && routingOf(data).mode === 'round_robin';
  const people = data.users.filter((u) => u.active !== false && u.role !== 'readonly');
  const services = data.catalog.filter((x) => x.active || lead?.serviceIds?.includes(x.id));
  const offices = officesFor(data, user, perms);
  const [picked, setPicked] = useState<string[]>(() => lead?.serviceIds ?? []);
  /** People already in the pipeline with the same email or phone, found when the form is saved. */
  const [dup, setDup] = useState<{ key: string; leads: LeadMatch[] } | null>(null);
  const [sure, setSure] = useState('');

  const fields: FieldDef[] = [
    { k: 'name', label: t('leads.f.name'), req: true }, { k: 'company', label: `${t('leads.f.company')} (${t('common.optional')})` },
    { k: 'phone', label: t('common.phone'), type: 'tel', req: true }, { k: 'email', label: t('common.email'), type: 'email' },
    { k: 'address', label: t('common.address'), full: true },
    { k: 'type', label: t('leads.f.service'), type: 'select', options: pack.serviceTypes.map((s) => [s.id, t('ty_' + s.id)]) },
    ...(!full && services.length ? [{ k: 'serviceId', label: t('leads.f.catalog'), type: 'select' as const, options: [['', t('common.none')] as [string, string], ...services.map((x) => [x.id, serviceName(x, lang)] as [string, string])] }] : []),
    { k: 'source', label: t('leads.f.source'), type: 'select', options: sources.map((s) => [s.id, t('src_' + s.id)]) },
    ...(full ? [{ k: 'sourceDetail', label: `${t('leads.f.sourceDetail')} (${t('common.optional')})`, placeholder: t('leads.f.sourceDetailPh') }] : []),
    { k: 'value', label: t('leads.f.value'), type: 'money' }, { k: 'pri', label: t('common.priority'), type: 'select', options: PRIORITIES.map((p) => [p, t('pr.' + p)]) },
    ...(mayPickOwner ? [{ k: 'ownerId', label: t('leads.f.owner'), type: 'select' as const, options: [...(auto ? [['', t('leads.f.ownerAuto')] as [string, string]] : []), ...people.map((u) => [u.id, u.name] as [string, string]), ...(lead && !people.some((u) => u.id === lead.ownerId) && lead.ownerId ? [[lead.ownerId, byId(data.users, lead.ownerId)?.name ?? t('common.unassigned')] as [string, string]] : [])] }] : []),
    ...(full ? [
      { k: 'kind', label: t('leads.f.kind'), type: 'select' as const, options: [['individual', t('leads.kind.individual')], ['business', t('leads.kind.business')]] as [string, string][] },
      { k: 'lang', label: t('leads.f.lang'), type: 'select' as const, options: LANGS.map((x) => [x, t('lang.' + x)] as [string, string]) },
      ...(offices.length ? [{ k: 'officeId', label: t('leads.f.office'), type: 'select' as const, options: [...(perms.includes('allClients') ? [['', t('leads.f.noOffice')] as [string, string]] : []), ...offices.map((o) => [o.id, o.name] as [string, string])] }] : []),
      { k: 'nextText', label: t('leads.next.text'), full: true, placeholder: t('leads.next.textPh') },
      { k: 'nextDue', label: t('leads.next.dueField'), type: 'date' as const },
    ] : []),
    { k: 'followUp', label: t('leads.f.followUp'), type: 'date' }, { k: 'apptDate', label: t('leads.f.visitDate'), type: 'date' }, { k: 'apptTime', label: t('leads.f.visitTime'), type: 'time' },
    ...(full ? [{ k: 'smsOptIn', label: t('leads.f.smsOptIn'), type: 'checkbox' as const, full: true }] : []),
    ...(lead ? [] : [{ k: 'firstNote', label: t('leads.f.firstNote'), type: 'textarea' as const }]),
  ];
  const initial = lead
    ? { ...lead, value: lead.value ?? '', serviceId: lead.serviceIds?.[0] ?? '', kind: lead.kind ?? (lead.company ? 'business' : 'individual'), lang: lead.lang ?? 'en', officeId: lead.officeId ?? '', nextText: lead.nextAction?.text ?? '', nextDue: lead.nextAction?.due ?? '', sourceDetail: lead.sourceDetail ?? '', smsOptIn: !!lead.smsOptIn }
    : { type: pack.serviceTypes[0]?.id, source: sources.some((x) => x.id === 'phone') ? 'phone' : sources[0]?.id, pri: 'medium', ownerId: auto ? '' : people.find((u) => u.id === user?.id)?.id ?? people[0]?.id, serviceId: '',
      kind: 'individual', lang: 'en', officeId: user?.officeIds?.[0] ?? '', nextText: '', nextDue: '', smsOptIn: false };

  const toggle = (id: string) => setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  /** Stops a new lead once when the same person is already in the pipeline, so adding a second one is a decision. */
  const check = (v: Record<string, any>): string | null => {
    if (lead) return null;
    const key = normEmail(v.email) + '|' + normPhone(v.phone);
    const hits = findLeadMatches(data, pack, { email: v.email, phone: v.phone }).filter((m) => isOpen(data, pack, m.lead.status));
    if (!hits.length || sure === key) return null;
    setDup({ key, leads: hits });
    return t('leads.dup.stop');
  };

  const extra = (
    <>
      {full && services.length > 0 && (
        <fieldset className="leads-services" data-testid="leads-services">
          <legend>{t('leads.f.services')}</legend>
          <div className="leads-chips">
            {services.map((x) => <label key={x.id} className={cx('leads-chip', picked.includes(x.id) && 'on')}><input type="checkbox" checked={picked.includes(x.id)} onChange={() => toggle(x.id)} /><span>{serviceName(x, lang)}</span></label>)}
          </div>
          <p className="xs dim">{t('leads.f.servicesHint')}</p>
        </fieldset>
      )}
      {dup && (
        <div className="note warn leads-dup" role="alert" data-testid="leads-dup">
          <p className="strong"><LuCopy aria-hidden="true" /> {t('leads.dup.title')}</p>
          <ul>
            {dup.leads.slice(0, 4).map(({ lead: l, by }) => (
              <li key={l.id}>
                {canSeeLead(user, perms, l)
                  ? <><a href={appPath(`/leads/${l.id}`)} target="_blank" rel="noopener noreferrer">{l.name}</a> · {l.ticket} · {t('ls_' + l.status)} · {t('leads.dup.same', { by: by.map((b) => t('data.by.' + b)).join(', ') })}</>
                  : <>{l.name} · {t('leads.dup.otherOffice')}</>}
              </li>
            ))}
          </ul>
          <label className="check"><input type="checkbox" checked={sure === dup.key} onChange={(e) => setSure(e.target.checked ? dup.key : '')} data-testid="leads-dup-sure" /><span>{t('leads.dup.sure')}</span></label>
        </div>
      )}
    </>
  );

  return (
    <FormModal title={t(lead ? 'leads.edit' : 'leads.new')} fields={fields} initial={initial} onClose={onClose} saveLabel={t('common.save')} cancelLabel={t('common.cancel')} requiredMsg={t('common.required')} extra={extra} validate={check}
      onSave={(v) => {
        const serviceIds = full ? (picked.length ? picked : undefined) : v.serviceId ? [v.serviceId, ...(lead?.serviceIds ?? []).filter((x) => x !== v.serviceId)] : undefined;
        const patch = { name: v.name, company: v.company || undefined, phone: v.phone, email: v.email, address: v.address, type: v.type, source: v.source as LeadSource, value: v.value, pri: v.pri as Priority, followUp: v.followUp || undefined, apptDate: v.apptDate || undefined, apptTime: v.apptTime || undefined,
          ...(services.length ? { serviceIds } : {}),
          ...(full ? { kind: v.kind as Lead['kind'], lang: v.lang as Lang, officeId: v.officeId || undefined, sourceDetail: v.sourceDetail || undefined, smsOptIn: !!v.smsOptIn,
            nextAction: v.nextText ? { text: v.nextText, ...(v.nextDue ? { due: v.nextDue } : {}) } : undefined } : {}) };
        if (lead) {
          act(updateLead, lead.id, patch);
          // a different owner chosen in the form is a handoff like any other: it is recorded with who made it
          if (mayPickOwner && v.ownerId && v.ownerId !== lead.ownerId) act(handoffLead, lead.id, v.ownerId);
          toast(t('leads.saved')); return;
        }
        // someone who is already a client: say so, and winning the lead will use that record instead of making a second one
        const known = findClientMatches(data, { name: v.name, email: v.email, phone: v.phone, address: v.address }).find(isLikelyDuplicate);
        const l = act(createLead, { ...patch, ownerId: v.ownerId || undefined, firstNote: v.firstNote || undefined });
        toast(known ? t('leads.createdKnown', { name: canSeeClient(data, user, perms, known.client) ? known.client.name : t('leads.dup.otherOffice') }) : t('leads.created'));
        go(`/leads/${l.id}`);
      }} />
  );
}

/* ---------- lost: why ---------- */
export function LostModal({ lead, to, onClose }: { lead: Lead; /** The lost stage to file it under; the company's first one when not given. */ to?: LeadStage; onClose: () => void }) {
  const { t, data, pack } = useApp();
  const reasons = lostReasonsOf(data, pack);
  const [reason, setReason] = useState(() => (reasons.some((r) => r.id === lead.lostReason) ? lead.lostReason ?? '' : ''));
  const [detail, setDetail] = useState('');
  const [missing, setMissing] = useState(false);
  const stage = to ?? lostStage(data, pack)?.id;
  const save = () => {
    if (!stage) return;
    // a company with a list of reasons files every lost lead under one of them, so the reasons can be counted
    if (reasons.length && !reason) { setMissing(true); return; }
    act(markLeadLost, lead.id, stage, reason || detail.trim(), reason ? detail : undefined);
    toast(t('leads.moved', { stage: t('ls_' + stage) })); onClose();
  };
  return (
    <Modal title={t('leads.markLost')} onClose={onClose} size="narrow" labelClose={t('common.close')} footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={save} data-testid="leads-lost-save">{t('leads.markLost')}</Button></>}>
      {reasons.length > 0 && (
        <fieldset className="leads-reasons" data-testid="leads-lost-reasons">
          <legend>{t('leads.lostReason')}</legend>
          <div className="row tight">{reasons.map((r) => <button type="button" key={r.id} className={cx('btn sm', reason === r.id && 'on')} aria-pressed={reason === r.id} onClick={() => { setReason(r.id); setMissing(false); }} data-reason={r.id}>{t('lr_' + r.id)}</button>)}</div>
          {missing && <p className="small neg" role="alert">{t('leads.lostPick')}</p>}
        </fieldset>
      )}
      <label className="field leads-lost-note"><span className="label">{t(reasons.length ? 'leads.lostDetail' : 'leads.lostReason')}</span><textarea className="input" rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder={t('leads.lostPh')} /></label>
    </Modal>
  );
}

/* ---------- next action ---------- */
export function NextActionModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const { t } = useApp();
  return (
    <FormModal title={t('leads.next.title')} initial={{ text: lead.nextAction?.text ?? '', due: lead.nextAction?.due ?? today() }} onClose={onClose} saveLabel={t('common.save')} cancelLabel={t('common.cancel')} requiredMsg={t('common.required')}
      fields={[{ k: 'text', label: t('leads.next.text'), req: true, full: true, placeholder: t('leads.next.textPh') }, { k: 'due', label: t('leads.next.dueField'), type: 'date', full: true, hint: t('leads.next.dueHint') }]}
      onSave={(v) => { act(setNextAction, lead.id, v.text, v.due || undefined); toast(t('leads.next.saved')); }} />
  );
}

/* ---------- hand off ---------- */
export function HandoffModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const { t, data, pack } = useApp();
  // whoever is next in the rotation is offered first; the choice stays with the person handing the lead over
  const next = upcomingTurns(data, pack, 2).map((x) => x.userId).find((id) => id !== lead.ownerId);
  const people = data.users.filter((u) => u.id !== lead.ownerId && u.active !== false && u.role !== 'readonly');
  return (
    <FormModal title={t('leads.handoff')} initial={{ to: next && people.some((u) => u.id === next) ? next : '', reason: '' }} onClose={onClose} saveLabel={t('leads.handoff')} cancelLabel={t('common.cancel')} requiredMsg={t('common.required')}
      fields={[{ k: 'to', label: t('leads.handoff.to'), type: 'select', req: true, full: true, options: [['', t('common.none')] as [string, string], ...people.map((u) => [u.id, u.id === next ? t('leads.handoff.nextUp', { name: u.name }) : u.name] as [string, string])] }, { k: 'reason', label: t('leads.handoff.reason'), type: 'textarea' }]}
      onSave={(v) => { if (act(handoffLead, lead.id, v.to, v.reason)) toast(t('leads.handoff.done', { name: byId(data.users, v.to)?.name ?? '' })); }} />
  );
}
