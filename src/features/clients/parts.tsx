// The pieces of a client's page. Each one is a card built from the same records, so the overview and the tabs of the
// client page (./tabs.ts) show the same thing wherever a piece appears.
import { LuBellOff, LuFileText, LuLink2, LuLock, LuMail, LuMapPin, LuPhone, LuPlus, LuUsers } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, Link, go } from '@/app/router';
import { act } from '@/store/store';
import { Badge, Card, Stat, cx, toast } from '@/ui';
import { ActivityList, ContactLinks, DocStatusBadge, JobStatusBadge, LeadStageBadge, PlanBadge } from '@/app/shared';
import { activityFor, byId, clientMoney, jobMoney, jobsOfClient } from '@/domain/selectors';
import type { Client } from '@/domain/types';
import { addOnViews } from '@/lib/pricing-view';
import { planName } from '@/lib/pricing';
import { money, money2, sum } from '@/lib/money';
import { setChannelConsent, setEmailOptOut } from './actions';
import { kindOf, optOuts } from './model';

/** History entries that state an amount; roles without access to money do not see them. */
export const MONEY_ACTIVITY = ['payment.received', 'worker.paid', 'expense.added', 'invoice.paid'];
export const newJobPath = (client: Client) => `/jobs?new=1&client=${client.id}`;

export function ClientMoney({ client }: { client: Client }) {
  const { t, data } = useApp();
  const m = clientMoney(data, client.id);
  return (
    <section aria-label={t('clients.money')}>
      <div className="kpis clients-kpis" data-testid="clients-money">
        <Stat label={t('clients.col.billed')} value={money(m.billed)} />
        <Stat label={t('clients.col.received')} value={money(m.received)} />
        <Stat label={t('clients.col.balance')} value={money(m.owes)} attention={m.owes > 0.005} hint={m.owes > 0.005 ? undefined : m.billed > m.received + 0.005 ? t('clients.notDue') : m.billed > 0 ? t('clients.paidUp') : undefined} />
      </div>
      <p className="xs muted clients-note">{t('clients.moneyNote')}</p>
    </section>
  );
}

export function ClientJobs({ client }: { client: Client }) {
  const { t, data, can } = useApp();
  const showMoney = can('money'); const jobs = jobsOfClient(data, client.id);
  return (
    <Card flush title={<>{t('clients.jobs')} <span className="count">{jobs.length}</span></>} >
      {jobs.length ? (
        <div className="table-wrap">
          <table className="tbl stackable" data-testid="clients-jobs">
            <thead><tr><th>{t('project')}</th><th>{t('common.status')}</th>{showMoney && <><th className="num">{t('clients.col.price')}</th><th className="num">{t('clients.col.balance')}</th></>}</tr></thead>
            <tbody>
              {jobs.map((j) => {
                const jm = jobMoney(data, j); const billable = j.status === 'progress' || j.status === 'done';
                return (
                  <tr key={j.id} className="click" onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button')) go(`/jobs/${j.id}`); }}>
                    <td className="t1"><A to={`/jobs/${j.id}`} className="clients-name">{j.name}</A><div className="xs dim">{j.number}{j.address ? ` · ${j.address}` : ''}{j.period ? ` · ${j.period}` : ''}</div></td>
                    <td data-label={t('common.status')}><JobStatusBadge status={j.status} /></td>
                    {showMoney && <>
                      <td data-label={t('clients.col.price')} className="num">{money(jm.price)}</td>
                      <td data-label={t('clients.col.balance')} className={cx('num', billable && jm.clientOwes > 0.005 ? 'strong' : 'dim')}>{billable ? money(jm.clientOwes) : null}</td>
                    </>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="clients-pad">
          <p className="muted small">{t('clients.noJobs')}</p>
          {can('write') && can('jobs') && <A to={newJobPath(client)} className="btn sm clients-gap"><LuPlus aria-hidden="true" />{t('clients.newJob')}</A>}
        </div>
      )}
    </Card>
  );
}

export function ClientDocs({ client }: { client: Client }) {
  const { t, data, date } = useApp();
  const jobIds = new Set(jobsOfClient(data, client.id).map((j) => j.id));
  const docs = data.docs.filter((d) => jobIds.has(d.jobId) || d.clientId === client.id).sort((a, b) => b.updated.localeCompare(a.updated));
  return (
    <Card title={<>{t('clients.docs')} {docs.length > 0 && <span className="count">{docs.length}</span>}</>}>
      {docs.length ? (
        <div className="list">
          {docs.map((d) => (
            <A key={d.id} to={`/documents/${d.id}`} className="item click clients-row">
              <LuFileText aria-hidden="true" className="clients-ico" />
              <span className="grow"><span className="t">{t('doc.kind.' + d.kind)} {d.number}</span><span className="xs dim clients-co">{d.title} · {date(d.updated)}</span></span>
              <DocStatusBadge status={d.status} />
            </A>
          ))}
        </div>
      ) : <p className="muted small">{t('clients.noDocs')}</p>}
    </Card>
  );
}

export function ClientPayments({ client }: { client: Client }) {
  const { t, data, date } = useApp();
  const payments = jobsOfClient(data, client.id).flatMap((j) => j.received.map((p) => ({ p, j }))).sort((a, b) => b.p.date.localeCompare(a.p.date));
  return (
    <Card flush title={t('clients.payments')}>
      {payments.length ? (
        <div className="table-wrap">
          <table className="tbl stackable" data-testid="clients-payments">
            <thead><tr><th>{t('common.date')}</th><th>{t('project')}</th><th>{t('common.method')}</th><th className="num">{t('common.amount')}</th></tr></thead>
            <tbody>
              {payments.map(({ p, j }) => (
                <tr key={p.id}>
                  <td className="t1 nowrap">{date(p.date)}</td>
                  <td data-label={t('project')}><A to={`/jobs/${j.id}`}>{j.name}</A></td>
                  <td data-label={t('common.method')}><span>{t('m_' + p.method)}{p.ref ? <span className="dim"> · {p.ref}</span> : null}</span></td>
                  <td data-label={t('common.amount')} className="num">{money2(p.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={3}>{t('common.total')}</td><td className="num">{money2(sum(payments, (x) => x.p.amount))}</td></tr></tfoot>
          </table>
        </div>
      ) : <p className="muted small clients-pad">{t('clients.noPayments')}</p>}
    </Card>
  );
}

export function ClientContact({ client }: { client: Client }) {
  const { t } = useApp();
  return (
    <Card title={t('clients.contact')}>
      <dl className="kv">
        {client.company && <><dt>{t('common.company')}</dt><dd>{client.company}</dd></>}
        <dt>{t('common.phone')}</dt><dd>{client.phone ? <a href={`tel:${client.phone.replace(/[^0-9+]/g, '')}`}><LuPhone aria-hidden="true" className="clients-inl" />{client.phone}</a> : <span className="dim">{t('common.none')}</span>}</dd>
        <dt>{t('common.email')}</dt><dd>{client.email ? <a href={`mailto:${client.email}`}><LuMail aria-hidden="true" className="clients-inl" />{client.email}</a> : <span className="dim">{t('common.none')}</span>}</dd>
      </dl>
      <div className="clients-links"><ContactLinks phone={client.phone} address={client.addresses[0]} /></div>
    </Card>
  );
}

export function ClientAddresses({ client }: { client: Client }) {
  const { t } = useApp();
  return (
    <Card title={<>{t('clients.addresses')} {client.addresses.length > 1 && <span className="count">{client.addresses.length}</span>}</>}>
      {client.addresses.length ? (
        <ul className="clients-addr">
          {client.addresses.map((a, i) => (
            <li key={i}><LuMapPin aria-hidden="true" /><span className="grow">{a}</span><ContactLinks address={a} /></li>
          ))}
        </ul>
      ) : <p className="muted small">{t('clients.noAddresses')}</p>}
    </Card>
  );
}

export function ClientLeads({ client }: { client: Client }) {
  const { t, data, date } = useApp();
  const leads = data.leads.filter((l) => l.clientId === client.id);
  return (
    <Card title={t('clients.leads')}>
      {leads.length ? (
        <div className="list">
          {leads.map((l) => (
            <A key={l.id} to={`/leads/${l.id}`} className="item click clients-row">
              <span className="grow"><span className="t">{l.ticket} · {t('ty_' + l.type)}</span><span className="xs dim clients-co">{t('src_' + l.source)} · {date(l.created)}</span></span>
              <LeadStageBadge stage={l.status} />
            </A>
          ))}
        </div>
      ) : <p className="muted small">{t('clients.noLeads')}</p>}
    </Card>
  );
}

export function ClientEmails({ client }: { client: Client }) {
  const { t, can, standing, lang, live } = useApp();
  const emails = standing('clientEmails');
  const optOut = (off: boolean) => { act(setEmailOptOut, client.id, off); toast(t(off ? 'clients.emails.turnedOff' : 'clients.emails.turnedOn')); };
  return (
    <Card title={t('clients.emails.title')} actions={<PlanBadge feature="clientEmails" />}>
      <label className="clients-switch">
        <input type="checkbox" role="switch" checked={!!client.emailOptOut} disabled={!can('write')} onChange={(e) => optOut(e.target.checked)} data-testid="clients-optout" />
        <span className="clients-track" aria-hidden="true" />
        <span className="strong">{t('clients.emails.optOut')}</span>
      </label>
      <p className="small muted clients-gap">{t(client.emailOptOut ? 'clients.emails.off' : 'clients.emails.on')}</p>
      {!live && <p className="xs dim clients-gap">{t('clients.emails.demo')}</p>}
      {emails.state === 'upgrade' && emails.plan && <p className="xs dim clients-gap">{t('ent.upgradeHint', { plan: planName(emails.plan, lang) })}</p>}
    </Card>
  );
}

/** The client portal is an add-on of the pricing file that does not exist yet. Shown only where plans and prices apply. */
export function ClientPortalCard() {
  const { t, pack, lang, standing, priced } = useApp();
  if (!priced) return null;
  const portal = addOnViews(pack.id, lang, t).find((a) => a.id === standing('clientPortal').addOnId);
  if (!portal) return null;
  return (
    <Card title={<><LuUsers aria-hidden="true" className="clients-ico" />{portal.name}</>} className="clients-portal">
      <div className="row tight"><Badge tone="warn">{t('clients.portal.status')}</Badge><PlanBadge feature="clientPortal" detail /></div>
      <p className="small clients-gap">{t('clients.portal.body')}</p>
      {portal.note && <p className="xs dim clients-gap">{portal.note}</p>}
      <div className="clients-gap"><Link to="/request-demo" className="btn sm" data-testid="clients-portal-ask">{t('clients.portal.ask')}</Link></div>
    </Card>
  );
}

/**
 * What kind of client this is and who looks after them: individual or business, type, language, office, lifecycle, tags,
 * and the tax ID marker. The marker is the type and the last four digits only, shown to roles that may see that one is on
 * file; the number itself is never part of the workspace data and is handled on the Secure tab.
 */
export function ClientProfile({ client }: { client: Client }) {
  const { t, data, pack, can, date } = useApp();
  const full = pack.family === 'practice';
  const office = byId(data.offices, client.officeId); const who = byId(data.users, client.assignedTo);
  const rows: [string, React.ReactNode][] = [];
  if (full) rows.push([t('clients.p.kind'), t('clients.kind.' + kindOf(client))]);
  if (client.clientType) rows.push([t('clients.p.type'), t('ct_' + client.clientType)]);
  if (client.lang) rows.push([t('clients.p.lang'), t('lang.' + client.lang)]);
  // the office and the person who looks after the client are in the header of the page in an edition that has them there
  if (!full && client.officeId && data.offices.length) rows.push([t('clients.p.office'), office ? office.name : t('clients.p.noOffice')]);
  if (!full && who) rows.push([t('clients.p.assigned'), who.name]);
  rows.push([t('clients.p.lifecycle'), <LifecycleBadge key="life" client={client} always />]);
  if (client.birthday) rows.push([t('clients.p.birthday'), date(client.birthday)]);
  if (client.referredBy) rows.push([t('clients.p.referredBy'), client.referredBy]);
  if (client.tags?.length) rows.push([t('clients.p.tags'), <span key="tags" className="clients-chips">{client.tags.map((x) => <Badge key={x} outline>{x}</Badge>)}</span>]);
  // tax fields exist only in an edition that keeps them, and only for a role that may know one is on file
  if (full && can('secureView')) rows.push([t('clients.p.taxId'), client.taxIdType
    ? <span key="tax" data-testid="clients-tax-marker"><LuLock aria-hidden="true" className="clients-inl" />{t('clients.p.taxType.' + client.taxIdType)}{client.taxIdLast4 ? ` · ${t('clients.p.last4', { last4: client.taxIdLast4 })}` : ''} · <A to={`/clients/${client.id}/secure`}>{t('clients.tab.secure')}</A></span>
    : <span key="tax" className="muted">{t('clients.p.taxNone')}</span>]);
  const systems = Object.entries(client.externalIds ?? {}).filter(([, id]) => !!id);
  if (systems.length) rows.push([t('clients.p.linked'), <span key="ext" className="clients-chips" data-testid="clients-external">{systems.map(([system]) => <Badge key={system} tone="info" outline><LuLink2 aria-hidden="true" />{systemName(system)}</Badge>)}</span>]);
  return (
    <Card title={t('clients.p.title')}>
      <dl className="kv" data-testid="clients-profile">{rows.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </Card>
  );
}
/** Connected systems by the name people know them by. An unknown one shows its own id, capitalised. */
const SYSTEMS: Record<string, string> = { square: 'Square', quickbooks: 'QuickBooks', gmail: 'Gmail', whatsapp: 'WhatsApp', meta: 'Meta', dialpad: 'Dialpad' };
const systemName = (id: string) => SYSTEMS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);

export function LifecycleBadge({ client, always }: { client: Client; always?: boolean }) {
  const { t } = useApp();
  const life = client.lifecycle ?? 'active';
  if (life === 'active' && !always) return null;
  return <Badge tone={life === 'active' ? 'ok' : life === 'inactive' ? 'warn' : 'neutral'} outline={life !== 'active'}>{t('clients.life.' + life)}</Badge>;
}

/** Owners and officers of a business with their share, and the other people to contact at this client. */
export function ClientPeople({ client }: { client: Client }) {
  const { t, pack } = useApp();
  // ownership is a professional-services field; a field business only keeps other contacts
  const owners = pack.family === 'practice' ? client.owners ?? [] : [];
  const people = [...owners.map((p) => ({ p, owner: true })), ...(client.contacts ?? []).map((p) => ({ p, owner: false }))];
  if (!people.length) return null;
  const known = owners.filter((p) => typeof p.pct === 'number');
  const total = known.reduce((a, p) => a + (p.pct ?? 0), 0);
  return (
    <Card title={<>{t(owners.length ? 'clients.people.title' : 'clients.people.contacts')} <span className="count">{people.length}</span></>}>
      <div className="list" data-testid="clients-people">
        {people.map(({ p, owner }) => (
          <div className="item" key={p.id}>
            <span className="grow"><span className="t">{p.name}{p.primary ? <span className="xs dim"> · {t('clients.people.primary')}</span> : null}</span>
              <span className="xs dim clients-co">{[p.title, p.phone, p.email].filter(Boolean).join(' · ')}</span></span>
            {owner ? <Badge tone="info" outline>{typeof p.pct === 'number' ? t('clients.p.ownerPct', { pct: p.pct }) : t('clients.p.owner')}</Badge> : <Badge outline>{t('clients.p.contact')}</Badge>}
          </div>
        ))}
      </div>
      {known.length > 1 && <p className="xs dim clients-gap">{t('clients.people.total', { pct: Math.round(total * 100) / 100 })}</p>}
    </Card>
  );
}

/**
 * What the client agreed to receive, and where else to reach them: automatic emails, text messages, WhatsApp, and their
 * social accounts. A text or a WhatsApp message needs the client's agreement, so "nobody asked yet" is its own state.
 */
export function ClientPrefs({ client }: { client: Client }) {
  const { t, pack, can, live } = useApp();
  const full = pack.family === 'practice';
  const canWrite = can('write');
  const optOut = (off: boolean) => { act(setEmailOptOut, client.id, off); toast(t(off ? 'clients.emails.turnedOff' : 'clients.emails.turnedOn')); };
  const consent = (channel: 'text' | 'whatsapp', v: string) => { act(setChannelConsent, client.id, channel, v === 'yes' ? true : v === 'no' ? false : undefined); toast(t('clients.saved')); };
  const state = (v: boolean | undefined) => (v === true ? 'yes' : v === false ? 'no' : '');
  const row = (channel: 'text' | 'whatsapp', v: boolean | undefined) => (
    <div className="clients-pref">
      <span className="strong">{t(channel === 'text' ? 'clients.prefs.text' : 'clients.prefs.whatsapp')}</span>
      {canWrite ? (
        <select className="input" value={state(v)} onChange={(e) => consent(channel, e.target.value)} aria-label={t(channel === 'text' ? 'clients.prefs.text' : 'clients.prefs.whatsapp')} data-testid={`clients-consent-${channel}`}>
          <option value="">{t('clients.consent.unset')}</option><option value="yes">{t('clients.consent.yes')}</option><option value="no">{t('clients.consent.no')}</option>
        </select>
      ) : <Badge tone={v === true ? 'ok' : v === false ? 'bad' : 'neutral'} outline>{t(v === true ? 'clients.consent.yes' : v === false ? 'clients.consent.no' : 'clients.consent.unset')}</Badge>}
    </div>
  );
  const handle = (v: string | undefined, site: string) => (v ? <a href={/^https?:/i.test(v) ? v : `https://${site}/${v.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer">{v}</a> : null);
  return (
    <Card title={t('clients.prefs.title')}>
      <label className="clients-switch">
        <input type="checkbox" role="switch" checked={!!client.emailOptOut} disabled={!canWrite} onChange={(e) => optOut(e.target.checked)} data-testid="clients-optout" />
        <span className="clients-track" aria-hidden="true" />
        <span className="strong">{t('clients.emails.optOut')}</span>
      </label>
      <p className="small muted clients-gap">{t(client.emailOptOut ? 'clients.emails.off' : 'clients.emails.on')}</p>
      <div className="clients-prefs">
        {row('text', client.smsOptIn)}
        {full && row('whatsapp', client.whatsappOptIn)}
      </div>
      {(client.whatsapp || client.social?.facebook || client.social?.instagram) && (
        <dl className="kv clients-gap">
          {client.whatsapp && <><dt>{t('clients.p.whatsapp')}</dt><dd>{client.whatsapp}</dd></>}
          {client.social?.facebook && <><dt>Facebook</dt><dd>{handle(client.social.facebook, 'facebook.com')}</dd></>}
          {client.social?.instagram && <><dt>Instagram</dt><dd>{handle(client.social.instagram, 'instagram.com')}</dd></>}
        </dl>
      )}
      {!live && <p className="xs dim clients-gap">{t('clients.prefs.demo')}</p>}
    </Card>
  );
}

/** Small marks for a client who asked not to be written to. Shown next to the name, so nobody has to open a tab to know. */
export function OptOutMarks({ client }: { client: Client }) {
  const { t } = useApp();
  const out = optOuts(client);
  if (!out.length) return null;
  return <span className="clients-marks" data-testid="clients-optouts">{out.map((ch) => <Badge key={ch} tone="warn" outline><LuBellOff aria-hidden="true" />{t('clients.no.' + ch)}</Badge>)}</span>;
}

export function ClientActivity({ client, limit = 8, linkRecords }: { client: Client; limit?: number; /** Name the engagement or lead an entry is about. */ linkRecords?: boolean }) {
  const { t, data, can } = useApp();
  const showMoney = can('money');
  const items = activityFor(data, { type: 'client', id: client.id }).filter((a) => showMoney || !MONEY_ACTIVITY.includes(a.kind));
  return <Card title={<>{t('common.activity')} {linkRecords && items.length > 0 && <span className="count">{items.length}</span>}</>}><ActivityList items={items} limit={limit} linkRecords={linkRecords} /></Card>;
}
