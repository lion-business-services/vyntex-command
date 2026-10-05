// The pieces of a deadline that several screens show: the row with its actions, the form, and the "mark as met" dialog.
// Used by the deadlines screen, the licensing screen, the service-line screens and the client page.
import { useState } from 'react';
import { LuCheck, LuEllipsis, LuRepeat } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { act } from '@/store/store';
import { Badge, Button, FormModal, IconButton, Menu, Modal, confirmDialog, cx, toast, type FieldDef, type Tone } from '@/ui';
import { completeDeadline, deleteDeadline, saveDeadline, setDeadlineStatus } from '@/domain/actions';
import { DEADLINE_KINDS, REPEATS, type Deadline, type DeadlineInput } from '@/domain/actions/ops';
import { byId, deadlineState, type DeadlineState } from '@/domain/selectors';
import { visibleClients } from '@/domain/access';
import type { ComplianceItem, FileRef, Repeat } from '@/domain/types';
import { relDay, today } from '@/lib/dates';
import { FileLink, FilePick } from '@/features/cash/parts';
import './deadlines.css';

export const STATE_TONE: Record<DeadlineState, Tone> = { overdue: 'bad', soon: 'warn', upcoming: 'neutral', done: 'ok', waived: 'neutral' };
/** "30, 7" typed by a person, as numbers of days. */
export const parseRemind = (v: string): number[] => v.split(/[^0-9]+/).filter(Boolean).map(Number).filter((n) => n >= 0 && n <= 365);

/** One deadline in a list: what it is, who it is for, when it is due, and what can be done with it. */
export function DeadlineRow({ item, showClient = true, onEdit }: { item: ComplianceItem; showClient?: boolean; onEdit: (i: ComplianceItem) => void }) {
  const { t, data, lang, can, date } = useApp();
  const [done, setDone] = useState(false);
  const it = item as Deadline;
  const st = deadlineState(item); const open = item.status === 'open';
  const client = byId(data.clients, item.clientId); const who = byId(data.users, item.assignee);
  const write = can('write');
  const remove = async () => { if (await confirmDialog(t('deadlines.deleteConfirm', { title: item.title }), t('common.delete'), t('common.cancel'))) { act(deleteDeadline, item.id); toast(t('common.deleted')); } };
  return (
    <div className={cx('item deadlines-row', !open && 'done')} data-deadline={item.id} data-state={st}>
      <div className="grow">
        <div className="t">{write ? <button type="button" className="linkbtn deadlines-title" onClick={() => onEdit(item)}>{item.title}</button> : item.title} <Badge outline>{t('deadlines.kind.' + item.kind)}</Badge>{item.repeat && item.repeat !== 'once' && <span className="deadlines-rep" title={t('deadlines.rp.' + item.repeat)}><LuRepeat aria-hidden="true" />{t('deadlines.rp.' + item.repeat)}</span>}</div>
        <div className="small muted">
          {showClient && (client ? <><A to={`/clients/${client.id}`}>{client.company || client.name}</A> · </> : <>{t('deadlines.firm')} · </>)}
          {item.authority && <>{item.authority} · </>}
          {who ? who.name : t('common.unassigned')}
          {it.evidence && <> · <FileLink file={it.evidence} title={t('deadlines.evidence')}>{t('deadlines.evidence')}</FileLink></>}
        </div>
        {item.note && <div className="xs dim deadlines-note">{item.note}</div>}
      </div>
      <div className="deadlines-when">
        <span className={cx('small nowrap', st === 'overdue' ? 'neg strong' : 'strong')}>{date(item.due)}</span>
        <span className="xs nowrap">{item.status === 'done' ? <Badge tone="ok">{t('deadlines.st.done')}{item.doneAt ? ` · ${date(item.doneAt)}` : ''}</Badge> : item.status === 'waived' ? <Badge>{t('deadlines.st.waived')}</Badge> : <Badge tone={STATE_TONE[st]}>{st === 'overdue' ? t('common.overdue') : item.due === today() ? t('common.today') : relDay(item.due, lang)}</Badge>}</span>
      </div>
      {write && (
        <div className="row tight nowrap deadlines-act">
          {open && <Button size="sm" icon={<LuCheck aria-hidden="true" />} onClick={() => setDone(true)} data-testid="deadlines-complete">{t('deadlines.complete')}</Button>}
          <Menu label={`${t('common.actions')}: ${item.title}`} button={<IconButton size="sm" label={`${t('common.actions')}: ${item.title}`}><LuEllipsis /></IconButton>}>
            <button type="button" role="menuitem" onClick={() => onEdit(item)}>{t('common.edit')}</button>
            {open && <button type="button" role="menuitem" onClick={() => { act(setDeadlineStatus, item.id, 'waived'); toast(t('deadlines.waived')); }}>{t('deadlines.waive')}</button>}
            {!open && <button type="button" role="menuitem" onClick={() => { act(setDeadlineStatus, item.id, 'open'); toast(t('deadlines.reopened')); }}>{t('deadlines.reopen')}</button>}
            {can('delete') && <button type="button" role="menuitem" className="danger" onClick={() => { void remove(); }}>{t('common.delete')}</button>}
          </Menu>
        </div>
      )}
      {done && <CompleteModal item={item} onClose={() => setDone(false)} />}
    </div>
  );
}

/** Marks a deadline as met, with the proof when there is one. A repeating item rolls forward to its next date. */
export function CompleteModal({ item, onClose }: { item: ComplianceItem; onClose: () => void }) {
  const { t, date, live } = useApp();
  const [proof, setProof] = useState<FileRef | undefined>();
  const repeats = !!item.repeat && item.repeat !== 'once';
  const save = () => {
    const next = act(completeDeadline, item.id, proof);
    toast(next ? t('deadlines.completedNext', { date: date(next.due) }) : t('deadlines.completed'));
    onClose();
  };
  return (
    <Modal title={t('deadlines.complete.title')} onClose={onClose} size="narrow" labelClose={t('common.close')} footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={save} data-testid="deadlines-complete-save" data-autofocus>{t('deadlines.complete')}</Button></>}>
      <p><b>{item.title}</b> · {date(item.due)}</p>
      <p className="small muted" style={{ margin: '6px 0 14px' }}>{repeats ? t('deadlines.complete.repeat', { repeat: t('deadlines.rp.' + item.repeat).toLowerCase() }) : t('deadlines.complete.once')}</p>
      <div className="field"><span className="label">{t('deadlines.evidence')} ({t('common.optional')})</span><FilePick file={proof} onChange={setProof} where={{ clientId: item.clientId, folder: 'deadlines' }} label={t('deadlines.evidence')} testId="deadlines-evidence" />{!live && <span className="hint">{t('cash.form.receiptSample')}</span>}</div>
    </Modal>
  );
}

/** Add or change a deadline. `defaults` pre-fill a new one (a client, a kind). `kinds` limits the choice (the licensing screen offers two). */
export function DeadlineFormModal({ item, defaults, kinds = DEADLINE_KINDS, onClose }: { item?: ComplianceItem; defaults?: Partial<DeadlineInput>; kinds?: ComplianceItem['kind'][]; onClose: () => void }) {
  const { t, data, user, perms } = useApp();
  const clients = visibleClients(data, user, perms);
  const clientId = item?.clientId ?? defaults?.clientId ?? '';
  const fields: FieldDef[] = [
    { k: 'title', label: t('deadlines.f.title'), req: true, full: true, placeholder: t('deadlines.f.titlePh') },
    { k: 'kind', label: t('common.type'), type: 'select', options: kinds.map((k) => [k, t('deadlines.kind.' + k)]) },
    { k: 'due', label: t('deadlines.f.due'), type: 'date', req: true },
    { k: 'repeat', label: t('deadlines.f.repeat'), type: 'select', options: REPEATS.map((r) => [r, t('deadlines.rp.' + r)]) },
    { k: 'assignee', label: t('common.assignedTo'), type: 'select', options: [['', t('common.unassigned')], ...data.users.filter((u) => u.active !== false).map((u) => [u.id, u.name] as [string, string])] },
    { k: 'clientId', label: t('deadlines.f.client'), type: 'select', options: [['', t('deadlines.firm')], ...clients.map((c) => [c.id, c.company ? `${c.company} · ${c.name}` : c.name] as [string, string])], full: true },
    { k: 'authority', label: t('deadlines.f.authority'), placeholder: t('deadlines.f.authorityPh') },
    { k: 'remind', label: t('deadlines.f.remind'), placeholder: '30, 7', hint: t('deadlines.f.remindHint') },
    { k: 'note', label: t('common.notes'), type: 'textarea' },
  ];
  const initial = item
    ? { ...item, repeat: item.repeat ?? 'once', assignee: item.assignee ?? '', clientId, authority: item.authority ?? '', remind: (item.remind ?? []).join(', '), note: item.note ?? '' }
    : { kind: kinds.includes('deadline') ? 'deadline' : kinds[0], repeat: 'once', assignee: user?.id ?? '', clientId, remind: '', ...defaults };
  return (
    <FormModal title={t(item ? 'deadlines.edit' : 'deadlines.new')} fields={fields} initial={initial} onClose={onClose} saveLabel={t('common.save')} cancelLabel={t('common.cancel')} requiredMsg={t('common.required')}
      onSave={(v) => {
        const saved = act(saveDeadline, { title: v.title, kind: v.kind, due: v.due, repeat: v.repeat as Repeat, assignee: v.assignee || undefined, clientId: v.clientId || undefined, jobId: v.clientId && v.clientId === item?.clientId ? item?.jobId : defaults?.jobId, authority: v.authority, note: v.note, remind: parseRemind(String(v.remind ?? '')) }, item?.id);
        toast(saved ? t('common.saved') : t('deadlines.err.invalid'), !saved);
      }} />
  );
}
