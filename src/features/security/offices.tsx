// Offices: where the company works from, and who works from each one. An office is what decides who sees a client:
// the sentence at the top of the card says how. The same card is the "Offices" section of Settings.
// Adding and editing an office is an ordinary change. Who works from which office is part of a person's membership, so
// that part goes through the server (ops.memberUpdate).
import { useState } from 'react';
import { LuBuilding2, LuPencil, LuPlus, LuTrash2 } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { act } from '@/store/store';
import { Badge, Button, Card, Empty, Field, IconButton, Modal, confirmDialog, toast } from '@/ui';
import type { Office } from '@/domain/types';
import { removeOffice, saveOffice } from '@/domain/actions';
import { officeUse } from '@/domain/actions/security';
import { timeZones, zoneLabel } from '@/features/settings/helpers';
import { ops } from './ops';
import { reasonText } from './parts';

export function OfficesCard() {
  const { t, data, can, lang } = useApp();
  const [editing, setEditing] = useState<Office | 'new' | null>(null);
  const mayEdit = can('config') && can('write');
  const remove = async (o: Office) => {
    if (!(await confirmDialog(t('security.offices.removeConfirm', { name: o.name }), t('security.offices.remove'), t('common.cancel')))) return;
    const done = act(removeOffice, o.id);
    toast(t(done ? 'security.offices.removed' : 'security.offices.inUse', { name: o.name }), !done);
  };
  return (
    <>
      <Card title={t('security.offices.title')} actions={mayEdit ? <Button variant="primary" size="sm" icon={<LuPlus aria-hidden="true" />} onClick={() => setEditing('new')} data-testid="security-office-add">{t('security.offices.add')}</Button> : undefined}>
        <p className="muted security-lead">{t('security.offices.scope')}</p>
        {!data.offices.length ? <Empty title={t('security.offices.none')}>{t('security.offices.noneHint')}</Empty> : (
          <div className="list" data-testid="security-offices">
            {data.offices.map((o) => {
              const use = officeUse(data, o.id);
              const people = data.users.filter((u) => u.active !== false && u.officeIds?.includes(o.id));
              return (
                <div className="item security-office" key={o.id} data-office={o.id}>
                  <span className="security-office-ic" aria-hidden="true"><LuBuilding2 /></span>
                  <div className="grow">
                    <div className="t">{o.name} {o.main && <Badge tone="accent">{t('security.offices.main')}</Badge>}</div>
                    {o.address && <div className="small muted">{o.address}</div>}
                    <div className="xs dim">{[o.phone, o.timezone ? zoneLabel(o.timezone, lang) : ''].filter(Boolean).join(' · ')}</div>
                    <div className="small security-office-use">{t('security.offices.use', { people: people.length, clients: use.clients })}{people.length > 0 && <span className="muted">: {people.map((u) => u.name).join(', ')}</span>}</div>
                  </div>
                  {mayEdit && (
                    <div className="row tight nowrap">
                      <IconButton size="sm" label={`${t('common.edit')}: ${o.name}`} onClick={() => setEditing(o)} data-testid="security-office-edit"><LuPencil /></IconButton>
                      {use.clients === 0 && data.offices.length > 1 && <IconButton size="sm" label={`${t('security.offices.remove')}: ${o.name}`} onClick={() => remove(o)} data-testid="security-office-remove"><LuTrash2 /></IconButton>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
      {editing && <OfficeModal office={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function OfficeModal({ office, onClose }: { office: Office | null; onClose: () => void }) {
  const { t, data, can, lang } = useApp();
  const [f, setF] = useState({ name: office?.name ?? '', address: office?.address ?? '', phone: office?.phone ?? '', timezone: office?.timezone ?? data.company.timezone ?? data.offices.find((o) => o.main)?.timezone ?? '', main: office ? !!office.main : !data.offices.length });
  const members = data.users.filter((u) => u.active !== false);
  const [people, setPeople] = useState<string[]>(() => (office ? members.filter((u) => u.officeIds?.includes(office.id)).map((u) => u.id) : []));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const mayAssign = can('users');
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) { setErr(t('security.offices.needName')); return; }
    const saved = act(saveOffice, { name: f.name, address: f.address, phone: f.phone, timezone: f.timezone, main: f.main }, office?.id);
    if (!saved) { setErr(t('security.reason.invalid')); return; }
    if (mayAssign) {
      // only the people whose list of offices actually changes are sent to the server
      setBusy(true);
      let failed = '';
      for (const u of members) {
        const has = !!u.officeIds?.includes(saved.id); const wants = people.includes(u.id);
        if (has === wants) continue;
        const next = wants ? [...(u.officeIds ?? []), saved.id] : (u.officeIds ?? []).filter((x) => x !== saved.id);
        const res = await ops.memberUpdate(u.id, { officeIds: next });
        if (!res.ok) failed = res.reason;
      }
      setBusy(false);
      if (failed) { toast(t('security.offices.peopleFailed', { why: reasonText(t, failed) }), true); onClose(); return; }
    }
    toast(t(office ? 'security.offices.saved' : 'security.offices.added', { name: saved.name }));
    onClose();
  };
  return (
    <Modal title={t(office ? 'security.offices.edit' : 'security.offices.add')} onClose={onClose} labelClose={t('common.cancel')}>
      <form onSubmit={save} noValidate data-testid="security-office-form">
        <div className="fgrid">
          <Field label={<>{t('security.offices.name')}<span aria-hidden="true"> *</span></>} htmlFor="security-of-name" full error={!!err}><input id="security-of-name" value={f.name} onChange={(e) => { setF({ ...f, name: e.target.value }); setErr(''); }} maxLength={80} aria-required="true" data-autofocus data-testid="security-office-name" /></Field>
          <Field label={t('common.address')} htmlFor="security-of-address" full><input id="security-of-address" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} maxLength={160} autoComplete="street-address" /></Field>
          <Field label={t('common.phone')} htmlFor="security-of-phone"><input id="security-of-phone" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={40} /></Field>
          <Field label={t('security.offices.zone')} htmlFor="security-of-zone">
            <select id="security-of-zone" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
              <option value="">{t('security.offices.zoneNone')}</option>
              {timeZones(f.timezone).map((z) => <option key={z} value={z}>{zoneLabel(z, lang)}</option>)}
            </select>
          </Field>
          <label className="check full"><input type="checkbox" checked={f.main} disabled={!!office?.main} onChange={(e) => setF({ ...f, main: e.target.checked })} data-testid="security-office-main" /><span>{t('security.offices.makeMain')}</span></label>
          {mayAssign && members.length > 0 && (
            <fieldset className="full security-checks">
              <legend className="label">{t('security.offices.people')}</legend>
              {members.map((u) => (
                <label className="check" key={u.id}><input type="checkbox" checked={people.includes(u.id)} onChange={(e) => setPeople((cur) => (e.target.checked ? [...cur, u.id] : cur.filter((x) => x !== u.id)))} /><span>{u.name}{u.title ? <span className="muted"> · {u.title}</span> : null}</span></label>
              ))}
            </fieldset>
          )}
        </div>
        {err && <p className="small neg" role="alert" style={{ marginTop: 10 }}>{err}</p>}
        <div className="modal-f" style={{ margin: '18px -18px -18px' }}>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" disabled={busy} data-testid="security-office-save">{t('common.save')}</Button>
        </div>
      </form>
    </Modal>
  );
}
