// The audit trail: who did what, to which record, when. Read only by construction: there is no control here that edits or
// removes an entry, because the trail is evidence. In a live workspace the entries come from the database's own log, which
// nobody can change (people with the `audit` capability can read it). In a sample workspace they are sample entries: what
// the sample operations wrote plus the business history of the sample company.
// The file download goes through the protected export, which is itself written to the trail.
import { useMemo, useState } from 'react';
import { LuDownload } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, refPath } from '@/app/router';
import type { PageProps } from '@/app/routes';
import { Avatar, Badge, Button, Card, Empty, PageHeader, SearchBox, toast, type Tone } from '@/ui';
import type { TFn } from '@/i18n';
import type { DemoState, RefType } from '@/domain/types';
import { auditRows, type AuditRow } from '@/domain/actions/security';
import { roleLabel } from '@/domain/config';
import { isOfficeRole } from '@/domain/permissions';
import { money2 } from '@/lib/money';
import { ops, saveFile } from '@/features/security/ops';
import { SampleNote, reasonText, sampleWord, whoName } from '@/features/security/parts';
import { StepUpHost } from '@/features/security/stepup';
import '@/features/security/security.css';
import './audit.css';

const PAGE = 80;
/** Turns a code the screen has no wording for into readable words: "member.status_changed" reads "Member status changed". */
const readable = (code: string) => { const s = code.replace(/[._]+/g, ' ').trim(); return s.charAt(0).toUpperCase() + s.slice(1); };
const worded = (t: TFn, key: string, fallback: string, params?: Record<string, string | number>) => { const out = t(key, params); return out === key ? fallback : out; };

/** The database names a table, the sample names a kind of record: both read as the same word. */
const ENTITY: Record<string, string> = {
  clients: 'client', leads: 'lead', jobs: 'job', tasks: 'task', documents: 'doc', docs: 'doc', appointments: 'appointment', tenant_members: 'user', users: 'user', tenants: 'company',
  offices: 'office', messages: 'message', client_secrets: 'secure', catalog_services: 'service', security: 'signin', job_payments: 'payment', payments: 'payment', workers: 'worker',
};
const entityKind = (e: string | undefined) => (e ? ENTITY[e] ?? e : '');

/** What happened, in words. */
function actionLabel(t: TFn, row: AuditRow): string {
  if (row.activity) {
    const p: Record<string, string | number> = { ...(row.activity.params ?? {}) };
    if (typeof p.amount === 'number') p.amount = money2(p.amount);
    if (typeof p.source === 'string' && t('src_' + p.source) !== 'src_' + p.source) p.source = t('src_' + p.source);
    return worded(t, 'act.' + row.activity.kind, readable(row.activity.kind), p);
  }
  if (row.action.startsWith('export.')) return t('audit.a.export', { kind: worded(t, 'audit.kind.' + row.action.slice(7), row.action.slice(7)) });
  return worded(t, 'audit.a.' + row.action, readable(row.action));
}
const TONES: [RegExp, Tone][] = [[/^vault\./, 'accent'], [/^(export|access)\./, 'violet'], [/^(member|invite|config|office)\./, 'info'], [/(failed|locked|denied|refused|deny)$/, 'bad'], [/^(signin|mfa|stepup|session|password)\./, 'neutral'], [/^delete$/, 'bad']];
const toneOf = (action: string): Tone => TONES.find(([re]) => re.test(action))?.[1] ?? 'neutral';

/** The record an entry is about: its name when the record is still there, and where to open it. */
function recordOf(d: DemoState, t: TFn, row: AuditRow, roleName: (r: string) => string): { name: string; to?: string } | null {
  const kind = entityKind(row.entity); const id = row.entityId;
  if (!kind || !id) return null;
  const named = (name: string | undefined, type?: RefType) => (name ? { name, to: type ? refPath({ type, id }) : undefined } : { name: t('audit.gone') });
  switch (kind) {
    case 'client': return named(d.clients.find((x) => x.id === id)?.name, 'client');
    case 'lead': return named(d.leads.find((x) => x.id === id)?.name, 'lead');
    case 'job': return named(d.jobs.find((x) => x.id === id)?.name, 'job');
    case 'task': return named(d.tasks.find((x) => x.id === id)?.title, 'task');
    case 'doc': { const doc = d.docs.find((x) => x.id === id); return named(doc ? `${doc.number} ${doc.title}`.trim() : undefined, 'doc'); }
    case 'user': return named(d.users.find((x) => x.id === id)?.name);
    case 'worker': return named(d.workers.find((x) => x.id === id)?.name, 'worker');
    case 'office': return named(d.offices.find((x) => x.id === id)?.name);
    case 'appointment': { const a = d.appointments.find((x) => x.id === id); return named(a ? d.clients.find((c) => c.id === a.clientId)?.name ?? a.date : undefined, 'appointment'); }
    case 'role': return { name: roleName(id) };
    default: return null;
  }
}

/** The detail of an entry in words: role and capability names instead of their codes. */
function detailOf(t: TFn, row: AuditRow, roleName: (r: string) => string): string {
  const s = row.summary ?? '';
  if (!s) return '';
  if (row.action === 'member.role_changed') { const m = /^(\w+) > (\w+)$/.exec(s); if (m) return `${roleName(m[1])} → ${roleName(m[2])}`; }
  if (row.action === 'config.roles') return s.split(' ').filter(Boolean).map((x) => x[0] + ' ' + worded(t, 'security.cap.' + x.slice(1), x.slice(1))).join(', ');
  if (row.action === 'invite.created') { const [email, role] = s.split(' · '); return role ? `${email} · ${roleName(role)}` : s; }
  if (row.action === 'config.modules') return s[0] + ' ' + worded(t, 'nav.' + s.slice(1), s.slice(1));
  if (row.action === 'vault.set' || row.action === 'vault.clear') return worded(t, 'security.tax.type.' + s, s);
  return s;
}

export default function AuditPage(_props: PageProps) {
  const { t, data, pack, lang, can, live, date, dateTime } = useApp();
  const [q, setQ] = useState('');
  const [who, setWho] = useState('');
  const [what, setWhat] = useState('');
  const [kind, setKind] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState(false);

  const roleName = (r: string) => (isOfficeRole(r) ? roleLabel(data, pack, r, lang) : r);
  const rows = useMemo(() => auditRows(data).map((row) => ({
    row, label: actionLabel(t, row), person: whoName(data, t, row.by), kind: entityKind(row.entity), record: recordOf(data, t, row, roleName), detail: detailOf(t, row, roleName),
    // an action group for the filter: everything before the first dot ("vault", "member", "export"), or the business history
    group: row.activity ? 'activity' : row.action.split('.')[0],
  })), [data, t, lang]);
  const people = useMemo(() => [...new Map(rows.map((r) => [r.row.by, r.person])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const groups = useMemo(() => [...new Set(rows.map((r) => r.group))].sort(), [rows]);
  const kinds = useMemo(() => [...new Set(rows.map((r) => r.kind).filter(Boolean))].sort(), [rows]);
  const s = q.trim().toLowerCase();
  const filtered = rows.filter((r) => (!who || r.row.by === who) && (!what || r.group === what) && (!kind || r.kind === kind)
    && (!from || r.row.at.slice(0, 10) >= from) && (!to || r.row.at.slice(0, 10) <= to)
    && (!s || [r.label, r.person, r.record?.name ?? '', r.detail].some((v) => v.toLowerCase().includes(s))));
  const filtering = !!(s || who || what || kind || from || to);
  const clear = () => { setQ(''); setWho(''); setWhat(''); setKind(''); setFrom(''); setTo(''); setShown(PAGE); };

  const download = async () => {
    setBusy(true);
    const res = await ops.exportFile('audit');
    setBusy(false);
    if (!res.ok) { toast(reasonText(t, res.reason), true); return; }
    saveFile(res.data);
    toast(t(res.sample ? 'audit.downloadedSample' : 'audit.downloaded'));
  };
  // an entry of an earlier year shows its year; this year's show the time
  const thisYear = String(new Date().getFullYear());
  const when = (at: string) => (at.startsWith(thisYear) ? dateTime(at) : date(at.slice(0, 10)));
  const groupLabel = (g: string) => worded(t, 'audit.g.' + g, readable(g));
  const kindLabel = (k: string) => worded(t, 'audit.e.' + k, readable(k));

  return (
    <>
      <PageHeader title={t('nav.audit')} sub={t('audit.sub')} actions={can('export') ? <Button icon={<LuDownload aria-hidden="true" />} onClick={download} disabled={busy} data-testid="audit-export">{t('audit.download')}</Button> : undefined} />
      {!live && <SampleNote>{t('audit.sample', { sample: sampleWord(t) })}</SampleNote>}
      <div className="filters audit-filters" data-testid="audit-filters">
        <SearchBox value={q} onChange={(v) => { setQ(v); setShown(PAGE); }} placeholder={t('audit.search')} />
        <select value={who} onChange={(e) => { setWho(e.target.value); setShown(PAGE); }} aria-label={t('audit.f.person')} data-testid="audit-filter-person">
          <option value="">{t('audit.f.anyone')}</option>
          {people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select value={what} onChange={(e) => { setWhat(e.target.value); setShown(PAGE); }} aria-label={t('audit.f.action')} data-testid="audit-filter-action">
          <option value="">{t('audit.f.anyAction')}</option>
          {groups.map((g) => <option key={g} value={g}>{groupLabel(g)}</option>)}
        </select>
        <select value={kind} onChange={(e) => { setKind(e.target.value); setShown(PAGE); }} aria-label={t('audit.f.record')} data-testid="audit-filter-record">
          <option value="">{t('audit.f.anyRecord')}</option>
          {kinds.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
        </select>
        <label className="audit-date small muted">{t('common.from')} <input className="input" type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setShown(PAGE); }} data-testid="audit-from" /></label>
        <label className="audit-date small muted">{t('common.to')} <input className="input" type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setShown(PAGE); }} data-testid="audit-to" /></label>
        {filtering && <button type="button" className="linkbtn small" onClick={clear} data-testid="audit-clear">{t('common.clearFilters')}</button>}
      </div>

      <Card flush>
        {!rows.length ? <Empty title={t('audit.empty')}>{t('audit.emptyHint')}</Empty>
          : !filtered.length ? <Empty title={t('common.noResults')} action={<Button onClick={clear}>{t('common.clearFilters')}</Button>} />
          : (
            <div className="table-wrap">
              <table className="tbl stackable audit-tbl" data-testid="audit-table">
                <thead><tr><th>{t('audit.c.when')}</th><th>{t('audit.c.who')}</th><th>{t('audit.c.what')}</th><th>{t('audit.c.record')}</th><th>{t('audit.c.detail')}</th></tr></thead>
                <tbody>
                  {filtered.slice(0, shown).map(({ row, label, person, kind: k, record, detail }) => (
                    <tr key={row.id} data-action={row.action}>
                      <td className="t1 nowrap audit-when">{when(row.at)}</td>
                      <td data-label={t('audit.c.who')}><span className="security-person">{data.users.some((u) => u.id === row.by) && <Avatar name={person} size="sm" />}<span>{person}</span></span></td>
                      <td data-label={t('audit.c.what')}>{row.activity ? <span className="audit-what">{label}</span> : <Badge tone={toneOf(row.action)}>{label}</Badge>}</td>
                      <td data-label={t('audit.c.record')}>
                        {k ? <span className="audit-record"><span className="xs dim">{kindLabel(k)}</span>{record ? (record.to ? <A to={record.to}>{record.name}</A> : <span>{record.name}</span>) : null}</span> : null}
                      </td>
                      <td data-label={t('audit.c.detail')} className="small muted audit-detail">{detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        <div className="audit-foot">
          <span className="small muted" data-testid="audit-count">{t('audit.count', { n: Math.min(shown, filtered.length), total: filtered.length })}</span>
          {filtered.length > shown && <Button size="sm" onClick={() => setShown((n) => n + PAGE)} data-testid="audit-more">{t('audit.more')}</Button>}
        </div>
      </Card>
      <p className="xs dim audit-fixed">{t(live ? 'audit.fixed' : 'audit.fixedSample')}</p>
      <StepUpHost />
    </>
  );
}
