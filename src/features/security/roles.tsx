// Roles and permissions: what each role may do in this company, as a matrix. Roles across, capabilities down, grouped and
// explained in plain words. The owner's column is locked (an owner holds everything, always), a read-only role can never
// be given the capabilities that change or delete records, and the role names are the company's to choose.
// Changes are kept as a draft until saved; saving writes the company's configuration (`config.roles`, `config.roleLabels`)
// and the audit trail records what was added and what was taken away. The server and the database enforce the saved matrix.
import { useEffect, useMemo, useState } from 'react';
import { LuCheck, LuLock, LuMinus, LuPencil, LuRotateCcw } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { act } from '@/store/store';
import { Badge, Button, Card, Field, Modal, Seg, cx, toast } from '@/ui';
import type { OfficeRole } from '@/domain/types';
import { OFFICE_ROLES, type Permission } from '@/domain/permissions';
import { permissionsOf, roleLabel } from '@/domain/config';
import { resetRole, setRoleLabel, setRolePermissions } from '@/domain/actions';
import { READONLY_NEVER } from '@/domain/actions/security';
import { capGroupsFor } from './caps';

type Editable = Exclude<OfficeRole, 'owner'>;
const EDITABLE: Editable[] = ['manager', 'staff', 'readonly'];
type Draft = Record<Editable, Permission[]>;
const same = (a: Permission[], b: Permission[]) => a.length === b.length && a.every((p) => b.includes(p));

export function RolesCard({ ids = 'security' }: { ids?: 'security' | 'settings' }) {
  const app = useApp();
  const { t, data, pack, lang, can, user } = app;
  // the database lets only an owner change what roles may do
  const mayEdit = can('config') && can('write') && user?.role === 'owner';
  const groups = useMemo(() => capGroupsFor(app), [app]);
  const saved = useMemo<Draft>(() => ({ manager: permissionsOf(data, pack, 'manager'), staff: permissionsOf(data, pack, 'staff'), readonly: permissionsOf(data, pack, 'readonly') }), [data.config, pack]);
  const [draft, setDraft] = useState<Draft>(saved);
  useEffect(() => { setDraft(saved); }, [saved]);
  const [naming, setNaming] = useState(false);
  const [about, setAbout] = useState<OfficeRole>('manager');

  const dirtyRoles = EDITABLE.filter((r) => !same(draft[r], saved[r]));
  const holds = (role: OfficeRole, p: Permission) => (role === 'owner' ? true : draft[role].includes(p));
  const never = (role: OfficeRole, p: Permission) => role === 'readonly' && READONLY_NEVER.includes(p);
  const toggle = (role: Editable, p: Permission) => setDraft((d) => ({ ...d, [role]: d[role].includes(p) ? d[role].filter((x) => x !== p) : [...d[role], p] }));
  const save = () => {
    for (const r of dirtyRoles) act(setRolePermissions, r, draft[r]);
    toast(t('security.roles.saved'));
  };
  const changed = (role: Editable) => !same(saved[role], pack.rolePermissions[role]);
  const backToEdition = (role: Editable) => { act(resetRole, role); toast(t('security.roles.resetDone', { role: roleLabel(data, pack, role, lang) })); };

  const aboutPerms = about === 'owner' ? pack.rolePermissions.owner : draft[about];
  return (
    <>
      <Card title={t('security.roles.title')} actions={mayEdit ? <Button size="sm" icon={<LuPencil aria-hidden="true" />} onClick={() => setNaming(true)} data-testid="security-roles-rename">{t('security.roles.rename')}</Button> : undefined}>
        <p className="muted security-lead">{t(mayEdit ? 'security.roles.intro' : 'security.roles.introView')}</p>
        <div className="table-wrap security-flush">
          <table className={cx('tbl security-matrix', mayEdit && 'editable')} data-testid={`${ids}-roles`}>
            <thead><tr>
              <th>{t('security.roles.cap')}</th>
              {OFFICE_ROLES.map((r) => (
                <th key={r} scope="col">
                  <span className="security-rolehead">{roleLabel(data, pack, r, lang)}{r === 'owner' && <LuLock aria-hidden="true" />}</span>
                  {r !== 'owner' && mayEdit && changed(r) && <button type="button" className="linkbtn xs" onClick={() => backToEdition(r)} title={t('security.roles.reset')} data-testid={`security-roles-reset-${r}`}><LuRotateCcw aria-hidden="true" /><span className="sr">{t('security.roles.reset')}: {roleLabel(data, pack, r, lang)}</span></button>}
                </th>
              ))}
            </tr></thead>
            {groups.map((g) => (
              <tbody key={g.id}>
                <tr className="security-group"><th colSpan={OFFICE_ROLES.length + 1} scope="colgroup">{t('security.capg.' + g.id)}</th></tr>
                {g.caps.map((p) => (
                  <tr key={p} data-cap={p}>
                    <th scope="row"><span className="security-capname">{t('security.cap.' + p)}</span><span className="security-capdesc">{t('security.cap.' + p + '.d')}</span></th>
                    {OFFICE_ROLES.map((r) => {
                      const on = holds(r, p); const fixed = r === 'owner' || never(r, p);
                      const label = `${roleLabel(data, pack, r, lang)}: ${t('security.cap.' + p)}`;
                      return (
                        <td key={r} data-yes={on} data-role={r}>
                          {mayEdit && !fixed
                            ? <input type="checkbox" checked={on} onChange={() => toggle(r as Editable, p)} aria-label={label} data-testid={`security-cap-${r}-${p}`} />
                            : <>{on ? <LuCheck aria-hidden="true" className="yes" /> : <LuMinus aria-hidden="true" className="no" />}<span className="sr">{label}: {t(on ? 'common.yes' : 'common.no')}</span></>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
        <p className="xs dim security-foot">{t('security.roles.locked')}{pack.usesWorkers ? ' ' + t('settings.team.portalNote') : ''}</p>
        {mayEdit && (
          <div className={cx('card-foot', dirtyRoles.length > 0 && 'security-savebar')}>
            <span className={cx('small', dirtyRoles.length ? 'strong' : 'muted')} data-testid="security-roles-dirty">{t(dirtyRoles.length ? 'settings.biz.unsaved' : 'settings.biz.upToDate')}</span>
            <div className="row">
              {dirtyRoles.length > 0 && <Button variant="ghost" onClick={() => setDraft(saved)}>{t('settings.biz.discard')}</Button>}
              <Button variant="primary" onClick={save} disabled={!dirtyRoles.length} data-testid="security-roles-save">{t('settings.biz.save')}</Button>
            </div>
          </div>
        )}
      </Card>

      <Card title={t('security.roles.aboutTitle')}>
        <Seg<OfficeRole> label={t('security.people.role')} value={about} onChange={setAbout} options={OFFICE_ROLES.map((r) => ({ value: r, label: <span data-testid={`security-about-${r}`}>{roleLabel(data, pack, r, lang)}</span> }))} />
        <div className="security-about" data-testid="security-about">
          {groups.map((g) => {
            const yes = g.caps.filter((p) => aboutPerms.includes(p)); const no = g.caps.filter((p) => !aboutPerms.includes(p));
            return (
              <div key={g.id}>
                <h3>{t('security.capg.' + g.id)}</h3>
                {yes.length > 0 && <p><Badge tone="ok">{t('security.roles.can')}</Badge> {yes.map((p) => t('security.cap.' + p)).join(', ')}</p>}
                {no.length > 0 && <p className="muted"><Badge>{t('security.roles.cannot')}</Badge> {no.map((p) => t('security.cap.' + p)).join(', ')}</p>}
              </div>
            );
          })}
        </div>
        <p className="xs dim security-foot">{t('security.roles.people', { n: data.users.filter((u) => u.role === about && u.active !== false).length })}</p>
      </Card>

      {naming && <RenameRoles onClose={() => setNaming(false)} />}
    </>
  );
}

/** What the company calls each role, in English and Spanish. An empty name puts the edition's name back. */
function RenameRoles({ onClose }: { onClose: () => void }) {
  const { t, data, pack } = useApp();
  const current = (r: OfficeRole) => data.config.roleLabels?.[r] ?? pack.roleLabels[r];
  const [v, setV] = useState(() => Object.fromEntries(OFFICE_ROLES.map((r) => [r, { en: current(r).en, es: current(r).es }])) as Record<OfficeRole, { en: string; es: string }>);
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    for (const r of OFFICE_ROLES) {
      const cur = current(r);
      if (v[r].en.trim() !== cur.en || v[r].es.trim() !== cur.es) act(setRoleLabel, r, v[r].en.trim() ? { en: v[r].en, es: v[r].es } : null);
    }
    toast(t('security.roles.renamed'));
    onClose();
  };
  return (
    <Modal title={t('security.roles.rename')} onClose={onClose} labelClose={t('common.cancel')}>
      <form onSubmit={save} noValidate data-testid="security-rename-form">
        <p className="muted small" style={{ marginBottom: 12 }}>{t('security.roles.renameHint')}</p>
        <div className="stack tight">
          {OFFICE_ROLES.map((r) => (
            <div className="fgrid" key={r}>
              <Field label={`${pack.roleLabels[r].en} (${t('lang.en')})`} htmlFor={`security-rl-en-${r}`}><input id={`security-rl-en-${r}`} value={v[r].en} onChange={(e) => setV({ ...v, [r]: { ...v[r], en: e.target.value } })} maxLength={40} placeholder={pack.roleLabels[r].en} data-testid={`security-rolelabel-en-${r}`} /></Field>
              <Field label={`${pack.roleLabels[r].es} (${t('lang.es')})`} htmlFor={`security-rl-es-${r}`}><input id={`security-rl-es-${r}`} value={v[r].es} onChange={(e) => setV({ ...v, [r]: { ...v[r], es: e.target.value } })} maxLength={40} placeholder={pack.roleLabels[r].es} /></Field>
            </div>
          ))}
        </div>
        <div className="modal-f" style={{ margin: '18px -18px -18px' }}>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" data-testid="security-rename-save">{t('common.save')}</Button>
        </div>
      </form>
    </Modal>
  );
}
