// W-9 and insurance certificate: the two small forms used on the team page and in the worker portal.
// In the demo only the date and the insurer are recorded. A chosen file never leaves the device, and the form says so.
import { useId, useState } from 'react';
import { useApp } from '@/app/hooks';
import { act } from '@/store/store';
import { FormModal, toast } from '@/ui';
import { DemoTag } from '@/app/shared';
import type { Worker } from '@/domain/types';
import { today } from '@/lib/dates';
import { recordInsurance, recordW9 } from './actions';

function FilePick({ label }: { label: string }) {
  const { t } = useApp();
  const [name, setName] = useState('');
  const id = useId();
  return (
    <div className="team-file">
      <div className="row between"><label htmlFor={id} className="label">{label} ({t('common.optional')})</label><DemoTag /></div>
      <input id={id} type="file" accept=".pdf,image/*" onChange={(e) => setName(e.target.files?.[0]?.name ?? '')} data-testid="team-file" />
      <p className="xs dim">{name ? t('team.fileKept', { file: name }) : t('team.fileNote')}</p>
    </div>
  );
}

/** Mark the W-9 as received on a date (or correct the date). */
export function W9Modal({ worker, onClose }: { worker: Worker; onClose: () => void }) {
  const { t } = useApp();
  const undo = worker.w9 ? (
    <button type="button" className="linkbtn small neg" style={{ marginTop: 12 }} onClick={() => { act(recordW9, worker.id, null); toast(t('team.w9Removed')); onClose(); }} data-testid="team-w9-remove">{t('team.w9Remove')}</button>
  ) : null;
  return (
    <FormModal title={t(worker.w9 ? 'team.w9Change' : 'team.w9Mark')} initial={{ w9Date: worker.w9Date || today() }} onClose={onClose}
      saveLabel={t(worker.w9 ? 'common.save' : 'team.w9Mark')} cancelLabel={t('common.cancel')} requiredMsg={t('common.required')}
      fields={[{ k: 'w9Date', label: t('team.w9Date'), type: 'date', req: true, full: true }]}
      validate={(v) => (v.w9Date > today() ? t('team.w9Future') : null)}
      extra={<><FilePick label={t('team.w9File')} />{undo}</>}
      onSave={(v) => { act(recordW9, worker.id, v.w9Date); toast(t('team.w9Saved', { name: worker.name })); }} />
  );
}

/** Record a new insurance certificate. `own` is the portal wording, when the worker sends their own. */
export function InsuranceModal({ worker, onClose, own }: { worker: Worker; onClose: () => void; own?: boolean }) {
  const { t } = useApp();
  return (
    <FormModal title={t(own ? 'portal.coiSend' : 'team.coiUpdate')} initial={{ coiExp: worker.coiExp || '', insurer: worker.insurer || '' }} onClose={onClose}
      saveLabel={t(own ? 'portal.coiSave' : 'common.save')} cancelLabel={t('common.cancel')} requiredMsg={t('common.required')}
      fields={[{ k: 'coiExp', label: t('team.coiExp'), type: 'date', req: true }, { k: 'insurer', label: t('team.insurer') }]}
      extra={<FilePick label={t('team.coiFile')} />}
      onSave={(v) => { act(recordInsurance, worker.id, v.coiExp, v.insurer || ''); toast(t(own ? 'portal.coiSaved' : 'team.coiSaved', { name: worker.name })); }} />
  );
}
