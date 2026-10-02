// Team and roles: who has an office login, what each role can do, and how many users the previewed plan includes.
import { useState } from 'react';
import { LuCheck, LuMinus, LuTrash2, LuUserPlus } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { PlanBadge } from '@/app/shared';
import { mutate } from '@/store/store';
import { Avatar, Button, Card, FormModal, IconButton, Note, confirmDialog, toast } from '@/ui';
import { can as roleCan, type Permission } from '@/domain/permissions';
import type { OfficeRole, ViewAs } from '@/domain/types';
import { planByTier, planName, type Plan, type PlanTier } from '@/lib/pricing';
import { addOnViews } from '@/lib/pricing-view';
import { uid } from '@/lib/id';

const ROLES: OfficeRole[] = ['owner', 'manager', 'staff'];
const COLUMNS: { view: ViewAs; label: string }[] = [{ view: 'owner', label: 'role.owner' }, { view: 'manager', label: 'role.manager' }, { view: 'staff', label: 'role.staff' }, { view: 'worker:any', label: 'role.worker' }];
const PERMISSIONS: Permission[] = ['leads', 'clients', 'jobs', 'tasks', 'calendar', 'documents', 'team', 'money', 'reports', 'compliance', 'automations', 'assistant', 'profit', 'delete', 'settings'];

export function TeamSection() {
  const { t, data, pack, plan, planLabel, lang } = useApp();
  const [adding, setAdding] = useState(false);
  const owners = data.users.filter((u) => u.role === 'owner');
  const lastOwner = (id: string) => owners.length === 1 && owners[0].id === id;
  const limit = plan.users;
  const over = limit !== 'unlimited' && data.users.length > limit;
  // the first plan above this one whose allowance covers the team
  const roomier: Plan | undefined = ([0, 1, 2] as PlanTier[]).map((tier) => planByTier(pack.id, tier)).find((p) => p.tier > plan.tier && (p.users === 'unlimited' || p.users >= data.users.length));
  // price and billing of the extra-user add-on, worded in the viewer's language by the pricing library
  const extra = addOnViews(pack.id, lang, t).find((a) => a.id === 'extra_user_foundation');
  const allowance = (p: Plan) => (p.users === 'unlimited' ? t('settings.team.unlimited') : String(p.users));

  const setRole = (id: string, role: OfficeRole) => { mutate((d) => { const u = d.users.find((x) => x.id === id); if (u) u.role = role; }); toast(t('settings.team.roleSaved')); };
  const remove = async (id: string) => {
    const u = data.users.find((x) => x.id === id); if (!u || lastOwner(id)) return;
    const heir = owners.find((o) => o.id !== id) ?? data.users.find((x) => x.id !== id); if (!heir) return;
    if (!(await confirmDialog(t('settings.team.removeConfirm', { name: u.name, heir: heir.name }), t('settings.team.remove'), t('common.cancel')))) return;
    mutate((d) => {
      // their open work moves to an owner so nothing is left without a person
      for (const x of d.tasks) if (x.assignee === 'u:' + id) x.assignee = 'u:' + heir.id;
      for (const l of d.leads) if (l.ownerId === id) l.ownerId = heir.id;
      for (const j of d.jobs) if (j.managerId === id) j.managerId = heir.id;
      d.users = d.users.filter((x) => x.id !== id);
    });
    toast(t('settings.team.removed', { name: u.name }));
  };

  return (
    <>
      <Card title={t('settings.team.title')} actions={<Button variant="primary" size="sm" icon={<LuUserPlus aria-hidden="true" />} onClick={() => setAdding(true)} data-testid="settings-user-add">{t('settings.team.add')}</Button>}>
        <p className="muted settings-lead">{t('settings.team.intro')}</p>
        <div className="table-wrap settings-flush">
          <table className="tbl stackable settings-users" data-testid="settings-users">
            <thead><tr><th>{t('common.name')}</th><th>{t('common.email')}</th><th>{t('settings.team.role')}</th><th><span className="sr">{t('common.actions')}</span></th></tr></thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id} data-user={u.id}>
                  <td className="t1"><span className="row tight nowrap"><Avatar name={u.name} size="sm" /><span className="settings-wrap">{u.name}</span></span></td>
                  <td data-label={t('common.email')} className="small muted settings-wrap">{u.email}</td>
                  <td data-label={t('settings.team.role')}>
                    <select className="input settings-role" value={u.role} onChange={(e) => setRole(u.id, e.target.value as OfficeRole)} disabled={lastOwner(u.id)} aria-label={`${t('settings.team.role')}: ${u.name}`} title={lastOwner(u.id) ? t('settings.team.lastOwner') : undefined} data-testid="settings-user-role">
                      {ROLES.map((r) => <option key={r} value={r}>{t('role.' + r)}</option>)}
                    </select>
                  </td>
                  <td className="num">{lastOwner(u.id) ? <span className="xs dim">{t('settings.team.lastOwner')}</span> : <IconButton size="sm" label={`${t('settings.team.remove')}: ${u.name}`} onClick={() => remove(u.id)} data-testid="settings-user-remove"><LuTrash2 /></IconButton>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="settings-allow" data-testid="settings-allowance">
          <span>{t('settings.team.allowance', { plan: planLabel, allowance: allowance(plan), n: data.users.length })}</span>
        </div>
        {over && (
          <Note tone="warn">
            <div className="row" data-testid="settings-over">
              <span>{plan.tier === 0 ? t('settings.team.overEntry', { n: data.users.length - Number(limit) }) : roomier ? t('settings.team.overUp', { plan: planName(roomier, lang), allowance: allowance(roomier) }) : t('settings.team.overPlain')}</span>
              {plan.tier === 0 && <PlanBadge feature="extraUser" />}
              {plan.tier === 0 && extra?.price && <b className="small nowrap">{extra.price}{extra.billing ? ` ${extra.billing}` : ''}</b>}
            </div>
            <div className="xs muted" style={{ marginTop: 4 }}>{t('settings.team.overDemo')}</div>
          </Note>
        )}
      </Card>

      <Card title={t('settings.team.rolesTitle')}>
        <p className="muted settings-lead">{t('settings.team.rolesIntro')}</p>
        <div className="table-wrap settings-flush">
          <table className="tbl settings-matrix" data-testid="settings-roles">
            <thead><tr><th>{t('settings.team.canUse')}</th>{COLUMNS.map((c) => <th key={c.view}>{c.view.startsWith('worker') ? <><span className="settings-full">{t(c.label)}</span><span className="settings-short" aria-hidden="true">{t('settings.team.portalShort')}</span></> : t(c.label)}</th>)}</tr></thead>
            <tbody>
              {PERMISSIONS.filter((p) => p !== 'compliance' || pack.compliance).map((p) => (
                <tr key={p}>
                  <th scope="row">{t('settings.perm.' + p)}</th>
                  {COLUMNS.map((c) => {
                    const yes = roleCan(c.view, p);
                    return <td key={c.view} data-yes={yes}>{yes ? <LuCheck aria-hidden="true" className="yes" /> : <LuMinus aria-hidden="true" className="no" />}<span className="sr">{t(yes ? 'common.yes' : 'common.no')}</span></td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginTop: 12 }}>{t('settings.team.portalNote')}</p>
      </Card>

      {adding && (
        <FormModal title={t('settings.team.add')} onClose={() => setAdding(false)} saveLabel={t('settings.team.add')} cancelLabel={t('common.cancel')} requiredMsg={t('common.required')}
          initial={{ role: 'staff' }}
          fields={[{ k: 'name', label: t('common.name'), req: true }, { k: 'email', label: t('common.email'), type: 'email' }, { k: 'role', label: t('settings.team.role'), type: 'select', options: ROLES.map((r) => [r, t('role.' + r)]), full: true }]}
          validate={(v) => (v.email && !/^\S+@\S+\.\S+$/.test(v.email) ? t('settings.biz.badEmail') : null)}
          onSave={(v) => { mutate((d) => { d.users.push({ id: uid('u'), name: v.name, email: v.email || '', role: v.role as OfficeRole }); }); toast(t('settings.team.added', { name: v.name })); }} />
      )}
    </>
  );
}
