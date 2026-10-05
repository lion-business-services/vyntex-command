// Settings section: the kinds of appointment the company offers, and its rules for booking, prepayment, cancellations,
// no-shows and credits. Registered in src/features/settings/panels.ts (needs the `config` capability).
import { useEffect, useState } from 'react';
import { LuPencil, LuPlus, LuTrash2 } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { ctx, mutate } from '@/store/store';
import { Badge, Button, Card, Field, FormModal, IconButton, Note, confirmDialog, toast, type FieldDef } from '@/ui';
import { pick } from '@/i18n';
import { appointmentRules } from '@/domain/config';
import { APPT_POLICY, apptPolicy, deleteApptType, hoursOf, saveApptRules, saveApptType, type ApptRulesInput } from '@/domain/actions/appointments';
import type { AppointmentType } from '@/domain/types';
import { money2 } from '@/lib/money';
import { ModeIcon } from './parts';
import './appointments.css';

const MODES: AppointmentType['mode'][] = ['office', 'phone', 'video'];

export default function AppointmentsSettingsPanel() {
  const { t, data, can, lang } = useApp();
  const mayEdit = can('write') && can('config');
  const [editing, setEditing] = useState<AppointmentType | 'new' | null>(null);
  const services = data.catalog.filter((s) => s.active);
  const serviceName = (id: string | undefined) => { const s = data.catalog.find((x) => x.id === id); return s ? s.i18n?.[lang]?.name ?? s.name : ''; };

  const fields: FieldDef[] = [
    { k: 'en', label: t('appointments.set.nameEn'), req: true }, { k: 'es', label: t('appointments.set.nameEs'), req: true },
    { k: 'minutes', label: t('appointments.set.minutes'), type: 'number', req: true }, { k: 'buffer', label: t('appointments.set.buffer'), type: 'number', hint: t('appointments.set.bufferHint') },
    { k: 'mode', label: t('appointments.f.mode'), type: 'select', options: MODES.map((m) => [m, t('appointments.mode.' + m)]) }, { k: 'fee', label: t('appointments.col.fee'), type: 'money', hint: t('appointments.set.feeHint') },
    ...(services.length ? [{ k: 'serviceId', label: `${t('appointments.set.service')} (${t('common.optional')})`, type: 'select' as const, full: true, options: [['', t('common.none')] as [string, string], ...services.map((s) => [s.id, serviceName(s.id)] as [string, string])] }] : []),
    { k: 'prepay', label: t('appointments.set.prepay'), type: 'checkbox', full: true }, { k: 'active', label: t('appointments.set.active'), type: 'checkbox', full: true },
  ];
  const remove = async (x: AppointmentType) => {
    if (!(await confirmDialog(t('appointments.set.deleteAsk', { name: pick(x.name, lang) }), t('common.delete'), t('common.cancel')))) return;
    const did = { what: '' };
    mutate((d) => { did.what = deleteApptType(d, ctx(), x.id); }, 'config');
    toast(t(did.what === 'switched_off' ? 'appointments.set.switchedOff' : 'common.deleted'));
  };

  return (
    <>
      <Card title={t('appointments.set.types')} actions={mayEdit ? <Button size="sm" icon={<LuPlus />} onClick={() => setEditing('new')} data-testid="appointments-set-add">{t('appointments.set.add')}</Button> : undefined}>
        <p className="muted settings-lead">{t('appointments.set.typesIntro')}</p>
        {!data.apptTypes.length ? <p className="muted small">{t('appointments.noTypes')}</p> : (
          <div className="settings-flush table-wrap">
            <table className="tbl stackable" data-testid="appointments-set-types">
              <thead><tr><th>{t('common.name')}</th><th>{t('appointments.set.how')}</th><th className="num">{t('appointments.col.fee')}</th><th>{t('common.status')}</th><th /></tr></thead>
              <tbody>
                {data.apptTypes.map((x) => (
                  <tr key={x.id} data-type={x.id}>
                    <td className="t1">{x.name.en}<div className="xs dim">{x.name.es}{x.serviceId && serviceName(x.serviceId) ? ` · ${serviceName(x.serviceId)}` : ''}</div></td>
                    <td data-label={t('appointments.set.how')}><span><span className="appointments-type"><ModeIcon mode={x.mode} />{t('appointments.minutes', { n: x.minutes })} · {t('appointments.mode.' + x.mode)}</span>
                      {x.buffer ? <span className="xs dim appointments-block">{t('appointments.bufferNote', { n: x.buffer })}</span> : null}</span></td>
                    <td data-label={t('appointments.col.fee')} className="num"><span>{x.fee > 0 ? money2(x.fee) : t('appointments.free')}{x.prepay && x.fee > 0 && <span className="xs dim appointments-block">{t('appointments.set.inAdvance')}</span>}</span></td>
                    <td data-label={t('common.status')}>{x.active ? <Badge tone="ok">{t('appointments.set.on')}</Badge> : <Badge outline>{t('appointments.set.off')}</Badge>}</td>
                    <td className="num">{mayEdit && <span className="row tight nowrap appointments-rowacts">
                      <IconButton size="sm" label={`${t('common.edit')}: ${pick(x.name, lang)}`} onClick={() => setEditing(x)} data-testid="appointments-set-edit"><LuPencil /></IconButton>
                      <IconButton size="sm" label={`${t('common.delete')}: ${pick(x.name, lang)}`} onClick={() => remove(x)}><LuTrash2 /></IconButton>
                    </span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Rules mayEdit={mayEdit} />

      {editing && (
        <FormModal title={t(editing === 'new' ? 'appointments.set.add' : 'appointments.set.edit')} fields={fields} onClose={() => setEditing(null)} saveLabel={t('common.save')} cancelLabel={t('common.cancel')} requiredMsg={t('common.required')}
          initial={editing === 'new' ? { en: '', es: '', minutes: 30, buffer: '', mode: 'office', fee: 0, prepay: false, active: true, serviceId: '' }
            : { en: editing.name.en, es: editing.name.es, minutes: editing.minutes, buffer: editing.buffer ?? '', mode: editing.mode, fee: editing.fee, prepay: editing.prepay, active: editing.active, serviceId: editing.serviceId ?? '' }}
          validate={(v) => (!Number.isInteger(v.minutes) || v.minutes < 5 || v.minutes > 600 ? t('appointments.set.badMinutes') : v.prepay && !(v.fee > 0) ? t('appointments.set.prepayNeedsFee') : null)}
          onSave={(v) => {
            const did = { ok: false };
            mutate((d) => {
              did.ok = !!saveApptType(d, ctx(), {
                id: editing === 'new' ? undefined : editing.id, name: { ...(editing === 'new' ? {} : editing.name), en: v.en, es: v.es }, minutes: v.minutes, buffer: v.buffer ? Math.round(v.buffer) : undefined,
                mode: v.mode, fee: v.fee ?? 0, prepay: v.prepay, active: v.active, serviceId: v.serviceId || undefined,
              });
            }, 'config');
            toast(t(did.ok ? 'common.saved' : 'appointments.set.badMinutes'), !did.ok);
          }} />
      )}
    </>
  );
}

/** The company's rules. Saved together, so a half-typed change never takes effect. */
function Rules({ mayEdit }: { mayEdit: boolean }) {
  const { t, data, lang } = useApp();
  const read = (): ApptRulesInput => ({ ...appointmentRules(data), ...apptPolicy(data), hours: { ...hoursOf(data), days: [...hoursOf(data).days] } });
  const [f, setF] = useState<ApptRulesInput>(read);
  const [err, setErr] = useState('');
  const saved = JSON.stringify(read());
  // a reset of the sample or a change from another tab: start again from what is saved
  useEffect(() => { setF(JSON.parse(saved) as ApptRulesInput); setErr(''); }, [saved]);
  const dirty = JSON.stringify(f) !== saved;
  const set = (patch: Partial<ApptRulesInput>) => { setErr(''); setF((cur) => ({ ...cur, ...patch })); };
  const num = (v: string) => (v === '' ? NaN : Number(v));
  const days = [...Array(7)].map((_, i) => new Date(2023, 0, 1 + i).toLocaleDateString(lang === 'es' ? 'es-US' : lang === 'zh' ? 'zh-CN' : 'en-US', { weekday: 'short' }));
  const toggleDay = (i: number) => set({ hours: { ...f.hours, days: f.hours.days.includes(i) ? f.hours.days.filter((x) => x !== i) : [...f.hours.days, i].sort() } });
  const save = () => {
    const did = { ok: false };
    mutate((d) => { did.ok = saveApptRules(d, ctx(), f); }, 'config');
    if (did.ok) toast(t('appointments.set.rulesSaved')); else setErr(t('appointments.set.badRules'));
  };
  return (
    <Card title={t('appointments.set.rules')}>
      <div className="fgrid appointments-rules" data-testid="appointments-set-rules">
        <label className="check full"><input type="checkbox" checked={f.noDoubleBooking} disabled={!mayEdit} onChange={(e) => set({ noDoubleBooking: e.target.checked })} data-testid="appointments-set-nodouble" /><span>{t('appointments.set.noDouble')}<span className="xs dim appointments-block">{t('appointments.set.noDoubleHint')}</span></span></label>
        <Field label={t('appointments.set.prepayHours')} hint={t('appointments.set.prepayHoursHint')}><input type="number" min={0} className="input" value={Number.isNaN(f.prepayHours) ? '' : f.prepayHours} disabled={!mayEdit} onChange={(e) => set({ prepayHours: num(e.target.value) })} data-testid="appointments-set-prepay" /></Field>
        <Field label={t('appointments.set.creditDays')} hint={t('appointments.set.creditDaysHint')}><input type="number" min={0} className="input" value={Number.isNaN(f.creditDays) ? '' : f.creditDays} disabled={!mayEdit} onChange={(e) => set({ creditDays: num(e.target.value) })} data-testid="appointments-set-creditdays" /></Field>
        <Field label={t('appointments.set.clientCancel')} hint={t('appointments.set.clientCancelHint', { n: Number.isNaN(f.prepayHours) ? 0 : f.prepayHours, def: t('appointments.set.cc.' + APPT_POLICY.clientCancel) })} full>
          <select value={f.clientCancel} disabled={!mayEdit} onChange={(e) => set({ clientCancel: e.target.value as ApptRulesInput['clientCancel'] })} data-testid="appointments-set-clientcancel">
            <option value="credit">{t('appointments.set.cc.credit')}</option><option value="forfeit">{t('appointments.set.cc.forfeit')}</option>
          </select>
        </Field>
        <Field label={t('appointments.set.noShowLimit')} hint={t('appointments.set.noShowLimitHint')}><input type="number" min={0} className="input" value={Number.isNaN(f.noShowLimit) ? '' : f.noShowLimit} disabled={!mayEdit} onChange={(e) => set({ noShowLimit: num(e.target.value) })} data-testid="appointments-set-noshow" /></Field>
        <div className="field">
          <span className="label">{t('appointments.set.hours')}</span>
          <div className="appointments-hoursrow"><input type="time" className="input" value={f.hours.open} disabled={!mayEdit} aria-label={t('appointments.set.open')} onChange={(e) => set({ hours: { ...f.hours, open: e.target.value } })} />
            <span className="muted small">{t('appointments.set.to')}</span>
            <input type="time" className="input" value={f.hours.close} disabled={!mayEdit} aria-label={t('appointments.set.close')} onChange={(e) => set({ hours: { ...f.hours, close: e.target.value } })} /></div>
          <span className="hint">{t('appointments.set.hoursHint')}</span>
        </div>
        <div className="field full">
          <span className="label">{t('appointments.set.days')}</span>
          <div className="appointments-days" role="group" aria-label={t('appointments.set.days')}>
            {days.map((d, i) => <button key={i} type="button" className="appointments-daybtn" aria-pressed={f.hours.days.includes(i)} disabled={!mayEdit} onClick={() => toggleDay(i)}>{d}</button>)}
          </div>
        </div>
      </div>
      {f.clientCancel === 'forfeit' && <div className="appointments-gap"><Note tone="warn">{t('appointments.set.forfeitNote')}</Note></div>}
      {err && <p className="small neg" role="alert" style={{ marginTop: 10 }}>{err}</p>}
      {mayEdit && <div className="row appointments-gap"><Button variant="primary" onClick={save} disabled={!dirty} data-testid="appointments-set-save">{t('appointments.set.saveRules')}</Button></div>}
    </Card>
  );
}
