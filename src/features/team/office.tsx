// The office team, for an edition without field workers: who works here, what each person does, where and in which
// languages, who is away, and how much each one is carrying right now. Every number is counted from the records (open
// leads, open tasks, appointments this week, active work), never typed.
// A person edits their own profile; whoever manages people also sets the offices and the lead rotation. Role, sign-in and
// switching a person off are in the security center.
import { useMemo, useState } from 'react';
import { LuCalendarOff, LuImage, LuMail, LuPencil, LuPhone, LuTrash2, LuUpload } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, refPath } from '@/app/router';
import { BackLink } from '@/app/Shell';
import { ActivityList, DemoTag } from '@/app/shared';
import { Avatar, Badge, Button, Card, Empty, Field, Modal, PageHeader, SearchBox, Seg, Stat, cx, toast } from '@/ui';
import type { DemoState, Lang, TeamUser } from '@/domain/types';
import type { ProfilePatch } from '@/domain/actions/team';
import { leadIsOpen, permissionsOf, roleLabel, routingOf } from '@/domain/config';
import { isActiveJob, isOpenTask, isOverdue } from '@/domain/selectors';
import { visibleClientIds, visibleLeads } from '@/domain/access';
import { memberState } from '@/domain/actions/security';
import { addDays, today } from '@/lib/dates';
import { ops } from '@/features/security/ops';
import { reasonText } from '@/features/security/parts';
import { StepUpHost } from '@/features/security/stepup';
import { MAX_LOGO_BYTES, readLogo, type LogoProblem } from '@/features/settings/helpers';
import { storeImage, useStoredImage } from '@/features/settings/image';

/* ---------- what a person is carrying ---------- */
/** Monday and Sunday of the current week. */
function thisWeek(): [string, string] { const dow = (new Date().getDay() + 6) % 7; return [addDays(-dow), addDays(6 - dow)]; }
export interface Workload { leads: number; tasks: number; overdue: number; appts: number; jobs: number }
export function workloadOf(d: DemoState, userId: string): Workload {
  const [from, to] = thisWeek();
  const tasks = d.tasks.filter((x) => x.assignee === 'u:' + userId && isOpenTask(x));
  return {
    leads: d.leads.filter((l) => l.ownerId === userId && leadIsOpen(d, l)).length,
    tasks: tasks.length, overdue: tasks.filter(isOverdue).length,
    appts: d.appointments.filter((a) => a.staffId === userId && a.date >= from && a.date <= to && !a.status.startsWith('cancelled')).length,
    jobs: d.jobs.filter((j) => j.managerId === userId && isActiveJob(j)).length,
  };
}
type AwayState = 'now' | 'soon' | null;
/** Away today, or due to be away within the next two weeks. */
function awayState(u: TeamUser): AwayState {
  if (!u.away) return null;
  const now = today();
  if (u.away.from <= now && now <= u.away.to) return 'now';
  return u.away.from > now && u.away.from <= addDays(14) ? 'soon' : null;
}

/* ---------- photo ---------- */
/** A person's photo, or their initials. A live workspace stores a path and reads it through a short-lived address. */
export function ProfilePhoto({ user, size = 'md' }: { user: TeamUser; size?: 'md' | 'lg' }) {
  const src = useStoredImage(user.photo);
  const initials = user.name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
  return <span className={cx('team-photo', size)} aria-hidden="true">{src ? <img src={src} alt="" /> : initials}</span>;
}

/* ---------- the team ---------- */
export function OfficeTeam() {
  const { t, data, pack, lang, date } = useApp();
  const [q, setQ] = useState('');
  const [office, setOffice] = useState('');
  const people = data.users.filter((u) => memberState(u) === 'member');
  const s = q.trim().toLowerCase();
  const shown = people.filter((u) => (!office || u.officeIds?.includes(office)) && (!s || [u.name, u.title ?? '', u.email, u.phone ?? ''].some((v) => v.toLowerCase().includes(s))));
  const loads = useMemo(() => new Map(people.map((u) => [u.id, workloadOf(data, u.id)])), [data]);
  const clear = () => { setQ(''); setOffice(''); };
  return (
    <>
      <PageHeader title={t('nav.team')} sub={t('team.office.sub')} />
      {people.length > 0 && (
        <div className="filters">
          <SearchBox value={q} onChange={setQ} placeholder={t('team.office.search')} />
          {data.offices.length > 1 && <Seg label={t('team.office.offices')} value={office} onChange={setOffice} options={[{ value: '', label: t('common.all') }, ...data.offices.map((o) => ({ value: o.id, label: o.name, count: people.filter((u) => u.officeIds?.includes(o.id)).length }))]} />}
          {(s || office) && <button type="button" className="linkbtn small" onClick={clear}>{t('common.clearFilters')}</button>}
        </div>
      )}
      {!people.length ? <Card><Empty title={t('team.office.empty')}>{t('team.office.emptyHint')}</Empty></Card>
        : !shown.length ? <Card><Empty title={t('common.noResults')} action={<Button onClick={clear}>{t('common.clearFilters')}</Button>} /></Card>
        : (
          <div className="team-people" data-testid="team-office">
            {shown.map((u) => {
              const w = loads.get(u.id) ?? workloadOf(data, u.id); const away = awayState(u);
              return (
                <A key={u.id} to={`/team/${u.id}`} className="card team-person" data-user={u.id} data-testid="team-person">
                  <div className="team-person-h">
                    <ProfilePhoto user={u} />
                    <div className="grow">
                      <b className="team-person-n">{u.name}</b>
                      {u.title && <span className="small muted">{u.title}</span>}
                      <span className="row tight team-person-b"><Badge outline>{roleLabel(data, pack, u.role, lang)}</Badge>
                        {away === 'now' && <Badge tone="warn">{t('team.office.away')}</Badge>}
                        {away === 'soon' && u.away && <Badge tone="info">{t('team.office.awayFrom', { date: date(u.away.from) })}</Badge>}
                      </span>
                    </div>
                  </div>
                  <div className="xs dim team-person-m">{[(u.officeIds ?? []).map((id) => data.offices.find((o) => o.id === id)?.name).filter(Boolean).join(', '), (u.languages ?? []).map((code) => t('lang.' + code)).join(', ')].filter(Boolean).join(' · ')}</div>
                  <dl className="team-load" aria-label={t('team.load.title')}>
                    <div><dt>{t('team.load.leads')}</dt><dd>{w.leads}</dd></div>
                    <div><dt>{t('team.load.tasks')}</dt><dd className={cx(w.overdue > 0 && 'neg')}>{w.tasks}</dd></div>
                    <div><dt>{t('team.load.appts')}</dt><dd>{w.appts}</dd></div>
                    <div><dt>{t('team.load.jobs')}</dt><dd>{w.jobs}</dd></div>
                  </dl>
                </A>
              );
            })}
          </div>
        )}
      <p className="xs dim team-foot">{t('team.load.note')}</p>
    </>
  );
}

/* ---------- one person ---------- */
export function Profile({ id }: { id: string }) {
  const { t, data, pack, lang, can, user, perms, date, day, time, live } = useApp();
  const [editing, setEditing] = useState(false);
  const u = data.users.find((x) => x.id === id);
  if (!u) return <Empty title={t('team.notFound')} action={<A to="/team" className="btn">{t('team.office.back')}</A>} />;

  const self = user?.id === u.id;
  const mayEdit = can('write') && (self || can('users'));
  const w = workloadOf(data, u.id);
  const away = awayState(u);
  const routing = routingOf(data);
  const inPool = routing.mode === 'round_robin' && routing.pool.includes(u.id) && !routing.exclude.includes(u.id);
  const takesLeads = inPool && u.inLeadPool !== false;
  // the lists only name records the viewer may open; the numbers above count everything the person carries
  const seen = visibleClientIds(data, user, perms);
  const [from, to] = thisWeek();
  const leads = visibleLeads(data, user, perms).filter((l) => l.ownerId === u.id && leadIsOpen(data, l)).slice(0, 5);
  const tasks = data.tasks.filter((x) => x.assignee === 'u:' + u.id && isOpenTask(x) && (!x.clientId || seen.has(x.clientId))).sort((a, b) => (a.due ?? '9').localeCompare(b.due ?? '9')).slice(0, 5);
  const appts = data.appointments.filter((a) => a.staffId === u.id && a.date >= from && a.date <= to && !a.status.startsWith('cancelled') && (!a.clientId || seen.has(a.clientId))).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 5);
  const jobs = data.jobs.filter((j) => j.managerId === u.id && isActiveJob(j) && seen.has(j.clientId)).slice(0, 5);
  const clientName = (cid?: string) => data.clients.find((c) => c.id === cid)?.name ?? '';
  const activity = data.activity.filter((a) => a.by === u.id).slice(0, 30);
  const granted = permissionsOf(data, pack, u.role).length; const all = pack.rolePermissions.owner.length;
  const conns = (['gmail', 'gcal', 'dialpad'] as const).map((pid) => ({ id: pid, state: data.connections.find((c) => c.id === pid)?.state ?? 'not_connected' }));

  return (
    <>
      <BackLink to="/team">{t('team.office.back')}</BackLink>
      <div className="team-profile-h">
        <ProfilePhoto user={u} size="lg" />
        <div className="grow">
          <PageHeader title={u.name} sub={u.title || undefined} actions={mayEdit ? <Button icon={<LuPencil aria-hidden="true" />} onClick={() => setEditing(true)} data-testid="team-profile-edit">{t(self ? 'team.profile.editMine' : 'team.profile.edit')}</Button> : undefined} />
          <div className="row tight team-profile-b">
            <Badge outline>{roleLabel(data, pack, u.role, lang)}</Badge>
            {self && <Badge tone="accent" outline>{t('security.people.you')}</Badge>}
            {away === 'now' && u.away && <Badge tone="warn"><LuCalendarOff aria-hidden="true" />{t('team.office.awayUntil', { date: date(u.away.to) })}</Badge>}
            {away === 'soon' && u.away && <Badge tone="info"><LuCalendarOff aria-hidden="true" />{t('team.office.awayFrom', { date: date(u.away.from) })}</Badge>}
          </div>
        </div>
      </div>

      <div className="kpis team-kpis" data-testid="team-workload">
        <Stat label={t('team.load.leads')} value={w.leads} />
        <Stat label={t('team.load.tasks')} value={w.tasks} hint={w.overdue ? t('team.load.overdue', { n: w.overdue }) : undefined} attention={w.overdue > 0} />
        <Stat label={t('team.load.appts')} value={w.appts} />
        <Stat label={t('team.load.jobs')} value={w.jobs} />
      </div>

      <div className="split">
        <div className="stack">
          {u.bio && <Card title={t('team.profile.about')}><p className="team-bio">{u.bio}</p></Card>}
          <Card title={t('team.profile.plate')}>
            <div className="team-plate">
              <WorkList title={t('team.load.leads')} empty={t('team.profile.noLeads')} show={can('leads')} rows={leads.map((l) => ({ id: l.id, to: refPath({ type: 'lead', id: l.id }), name: l.name, meta: t('ls_' + l.status) }))} />
              <WorkList title={t('team.load.tasks')} empty={t('team.profile.noTasks')} show={can('tasks')} rows={tasks.map((x) => ({ id: x.id, to: refPath({ type: 'task', id: x.id }), name: x.title, meta: x.due ? date(x.due) : '', bad: isOverdue(x) }))} />
              <WorkList title={t('team.load.appts')} empty={t('team.profile.noAppts')} show={can('appointments')} rows={appts.map((a) => ({ id: a.id, to: refPath({ type: 'appointment', id: a.id }), name: clientName(a.clientId) || data.leads.find((l) => l.id === a.leadId)?.name || t('nav.appointments'), meta: `${day(a.date)} · ${time(a.time)}` }))} />
              <WorkList title={t('team.load.jobs')} empty={t('team.profile.noJobs')} show={can('jobs')} rows={jobs.map((j) => ({ id: j.id, to: refPath({ type: 'job', id: j.id }), name: j.name, meta: clientName(j.clientId) }))} />
            </div>
            <p className="xs dim" style={{ marginTop: 12 }}>{t('team.profile.plateNote')}</p>
          </Card>
          <Card title={t('common.activity')}>{activity.length ? <ActivityList items={activity} limit={8} linkRecords /> : <p className="muted small">{t('common.noActivity')}</p>}</Card>
        </div>

        <div className="stack">
          <Card title={t('team.profile.contact')}>
            <dl className="kv team-kv">
              <dt>{t('common.email')}</dt><dd><a href={`mailto:${u.email}`}><LuMail aria-hidden="true" className="team-kv-ic" />{u.email}</a></dd>
              <dt>{t('common.phone')}</dt><dd>{u.phone ? <a href={`tel:${u.phone.replace(/[^0-9+]/g, '')}`}><LuPhone aria-hidden="true" className="team-kv-ic" />{u.phone}</a> : <span className="dim">{t('team.none')}</span>}</dd>
              <dt>{t('team.office.offices')}</dt><dd>{(u.officeIds ?? []).map((oid) => data.offices.find((o) => o.id === oid)?.name).filter(Boolean).join(', ') || <span className="dim">{t('team.none')}</span>}</dd>
              <dt>{t('team.office.languages')}</dt><dd>{(u.languages ?? []).map((code) => t('lang.' + code)).join(', ') || <span className="dim">{t('team.none')}</span>}</dd>
            </dl>
          </Card>

          <Card title={t('team.profile.rotation')}>
            <dl className="kv team-kv">
              <dt>{t('team.profile.leadPool')}</dt>
              <dd>{routing.mode !== 'round_robin' ? <span className="dim">{t('team.profile.poolManual')}</span> : takesLeads ? <Badge tone="ok">{t('team.profile.poolIn')}</Badge> : <Badge>{t(inPool ? 'team.profile.poolPaused' : 'team.profile.poolOut')}</Badge>}</dd>
              <dt>{t('team.profile.awayDates')}</dt>
              <dd>{u.away ? <>{t('team.period', { from: date(u.away.from), to: date(u.away.to) })}{u.away.note && <span className="small muted team-away-note">{u.away.note}</span>}</> : <span className="dim">{t('team.profile.noAway')}</span>}</dd>
            </dl>
            <p className="xs dim" style={{ marginTop: 10 }}>{t(routing.skipAway ? 'team.profile.awaySkips' : 'team.profile.awayKeeps')}</p>
          </Card>

          <Card title={t('team.profile.access')}>
            <p className="small">{t('team.profile.accessLine', { role: roleLabel(data, pack, u.role, lang), n: granted, total: all })}</p>
            {can('users') && pack.modules.includes('security') && <div className="row" style={{ marginTop: 10 }}><A to="/security" className="btn sm">{t('team.profile.openSecurity')}</A>{can('config') && <A to="/security/roles" className="btn sm ghost">{t('team.profile.openRoles')}</A>}</div>}
          </Card>

          <Card title={t('team.profile.connections')} actions={!live ? <DemoTag kind="connect" /> : undefined}>
            <dl className="kv team-kv" data-testid="team-connections">
              {conns.map((c) => <div key={c.id} className="team-conn"><dt>{t('team.conn.' + c.id)}</dt><dd><Badge tone={c.state === 'connected' ? 'ok' : c.state === 'not_connected' || c.state === 'setup' ? 'neutral' : 'warn'}>{t('team.conn.s.' + c.state)}</Badge></dd></div>)}
            </dl>
            <p className="xs dim" style={{ marginTop: 10 }}>{t(live ? 'team.profile.connNote' : 'team.profile.connSample')}</p>
            {can('integrations') && pack.modules.includes('integrations') && <A to="/integrations" className="btn sm" style={{ marginTop: 10 }}>{t('nav.integrations')}</A>}
          </Card>
        </div>
      </div>

      {editing && <ProfileModal user={u} onClose={() => setEditing(false)} />}
      <StepUpHost />
    </>
  );
}

function WorkList({ title, rows, empty, show }: { title: string; empty: string; show: boolean; rows: { id: string; to: string; name: string; meta: string; bad?: boolean }[] }) {
  if (!show) return null;
  return (
    <div>
      <h3>{title}</h3>
      {rows.length ? <ul className="team-worklist">{rows.map((r) => <li key={r.id}><A to={r.to}>{r.name}</A>{r.meta && <span className={cx('xs', r.bad ? 'neg' : 'dim')}>{r.meta}</span>}</li>)}</ul> : <p className="small muted">{empty}</p>}
    </div>
  );
}

/* ---------- edit a profile ---------- */
const SPOKEN: Lang[] = ['en', 'es', 'zh'];

function ProfileModal({ user, onClose }: { user: TeamUser; onClose: () => void }) {
  const { t, data, can, live } = useApp();
  const manages = can('users');
  const [f, setF] = useState({ name: user.name, title: user.title ?? '', phone: user.phone ?? '', bio: user.bio ?? '', photo: user.photo ?? '', from: user.away?.from ?? '', to: user.away?.to ?? '', note: user.away?.note ?? '' });
  const [langs, setLangs] = useState<Lang[]>(user.languages ?? []);
  const [offices, setOffices] = useState<string[]>(user.officeIds ?? []);
  const [pool, setPool] = useState(user.inLeadPool !== false);
  const [picked, setPicked] = useState<string | null>(null);   // a new photo, as a small picture, until it is saved
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof f>) => { setErr(''); setF((cur) => ({ ...cur, ...patch })); };
  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    try { setPicked(await readLogo(file)); setErr(''); } catch (why) { setErr(t('settings.biz.logoErr.' + ((why as LogoProblem) || 'read'), { max: Math.round(MAX_LOGO_BYTES / 1024 / 1024) })); }
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) { setErr(t('team.profile.needName')); return; }
    if ((f.from || f.to) && (!f.from || !f.to || f.from > f.to)) { setErr(t('team.profile.badAway')); return; }
    setBusy(true);
    let photo: string | undefined = picked === '' ? '' : f.photo;
    if (picked) {
      // a sample workspace keeps the small picture itself; a live one stores the file privately and keeps its path
      const stored = await storeImage(picked, live, 'profiles');
      if (!stored) { setBusy(false); setErr(t('team.profile.photoFailed')); return; }
      photo = stored;
    }
    const patch: ProfilePatch = { name: f.name, title: f.title, phone: f.phone, bio: f.bio, photo, languages: langs, away: f.from && f.to ? { from: f.from, to: f.to, note: f.note || undefined } : undefined };
    if (manages) { patch.officeIds = offices; patch.inLeadPool = pool; }
    const res = await ops.memberUpdate(user.id, patch);
    setBusy(false);
    if (!res.ok) { setErr(reasonText(t, res.reason)); return; }
    toast(t('team.profile.saved'));
    onClose();
  };
  const shownPhoto = picked ?? (f.photo.startsWith('data:') ? f.photo : '');
  const hasPhoto = picked ? true : picked === '' ? false : !!f.photo;
  return (
    <Modal title={t('team.profile.edit')} onClose={onClose} labelClose={t('common.cancel')} size="wide">
      <form onSubmit={save} noValidate data-testid="team-profile-form">
        <div className="team-edit">
          <div className="team-edit-photo">
            <span className="team-photo lg" aria-hidden="true">{shownPhoto ? <img src={shownPhoto} alt="" /> : hasPhoto ? <LuImage /> : (f.name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?')}</span>
            <label className="btn sm team-file-btn"><LuUpload aria-hidden="true" />{t(hasPhoto ? 'team.profile.photoChange' : 'team.profile.photoAdd')}<input type="file" accept="image/*" className="sr" onChange={pick} data-testid="team-profile-photo" /></label>
            {hasPhoto && <Button size="sm" variant="ghost" icon={<LuTrash2 aria-hidden="true" />} onClick={() => setPicked('')}>{t('team.profile.photoRemove')}</Button>}
          </div>
          <div className="fgrid">
            <Field label={<>{t('common.name')}<span aria-hidden="true"> *</span></>} htmlFor="team-pf-name"><input id="team-pf-name" value={f.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} aria-required="true" data-testid="team-profile-name" /></Field>
            <Field label={t('team.profile.jobTitle')} htmlFor="team-pf-title"><input id="team-pf-title" value={f.title} onChange={(e) => set({ title: e.target.value })} maxLength={80} data-testid="team-profile-title" /></Field>
            <Field label={t('common.phone')} htmlFor="team-pf-phone"><input id="team-pf-phone" type="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} maxLength={40} /></Field>
            <fieldset className="team-checks">
              <legend className="label">{t('team.office.languages')}</legend>
              <div className="row">{SPOKEN.map((code) => <label className="check" key={code}><input type="checkbox" checked={langs.includes(code)} onChange={(e) => setLangs((cur) => (e.target.checked ? [...cur, code] : cur.filter((x) => x !== code)))} /><span>{t('lang.' + code)}</span></label>)}</div>
            </fieldset>
            <Field label={t('team.profile.about')} htmlFor="team-pf-bio" hint={t('team.profile.bioHint')} full><textarea id="team-pf-bio" rows={3} value={f.bio} onChange={(e) => set({ bio: e.target.value })} maxLength={600} data-testid="team-profile-bio" /></Field>
            <Field label={t('team.profile.awayFrom')} htmlFor="team-pf-from"><input id="team-pf-from" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} data-testid="team-profile-away-from" /></Field>
            <Field label={t('team.profile.awayTo')} htmlFor="team-pf-to"><input id="team-pf-to" type="date" value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} data-testid="team-profile-away-to" /></Field>
            <Field label={`${t('team.profile.awayNote')} (${t('common.optional')})`} htmlFor="team-pf-note" hint={t('team.profile.awayHint')} full><input id="team-pf-note" value={f.note} onChange={(e) => set({ note: e.target.value })} maxLength={120} /></Field>
            {manages && data.offices.length > 0 && (
              <fieldset className="team-checks full">
                <legend className="label">{t('team.office.offices')}</legend>
                <div className="row">{data.offices.map((o) => <label className="check" key={o.id}><input type="checkbox" checked={offices.includes(o.id)} onChange={(e) => setOffices((cur) => (e.target.checked ? [...cur, o.id] : cur.filter((x) => x !== o.id)))} /><span>{o.name}</span></label>)}</div>
              </fieldset>
            )}
            {manages && <label className="check full"><input type="checkbox" checked={pool} onChange={(e) => setPool(e.target.checked)} data-testid="team-profile-pool" /><span>{t('team.profile.poolCheck')}</span></label>}
          </div>
        </div>
        {err && <p className="small neg" role="alert" style={{ marginTop: 10 }}>{err}</p>}
        {!live && <p className="xs dim" style={{ marginTop: 10 }}>{t('team.profile.sample')}</p>}
        <div className="modal-f" style={{ margin: '18px -18px -18px' }}>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" disabled={busy} data-testid="team-profile-save">{t('common.save')}</Button>
        </div>
      </form>
    </Modal>
  );
}
