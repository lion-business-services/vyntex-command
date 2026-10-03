// Clients: everyone the business works for. A list with search and sort, and one page per client
// that gathers their jobs, documents, payments, notes and history.
import { useMemo, useState } from 'react';
import { LuPlus, LuPencil, LuTrash2, LuMail, LuPhone, LuMapPin, LuFileText, LuUsers } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, Link, go } from '@/app/router';
import { BackLink } from '@/app/Shell';
import type { PageProps } from '@/app/routes';
import { act } from '@/store/store';
import { Avatar, Badge, Button, Card, Empty, FormModal, IconButton, PageHeader, SearchBox, Stat, cx, confirmDialog, toast, type FieldDef } from '@/ui';
import { ActivityList, ContactLinks, DocStatusBadge, JobStatusBadge, LeadStageBadge, NotesPanel, PlanBadge } from '@/app/shared';
import { saveClient } from '@/domain/actions';
import { activityFor, byId, clientMoney, jobMoney, jobsOfClient } from '@/domain/selectors';
import type { Client } from '@/domain/types';
import { addOnViews } from '@/lib/pricing-view';
import { planName } from '@/lib/pricing';
import { money, money2, sum } from '@/lib/money';
import { deleteClient, setEmailOptOut } from './actions';
import '@/features/leads/work.css';
import './clients.css';

type Sort = 'name' | 'newest' | 'balance';
/** History entries that state an amount; roles without access to money do not see them. */
const MONEY_ACTIVITY = ['payment.received', 'worker.paid', 'expense.added', 'invoice.paid'];

export default function ClientsPage({ id }: PageProps) {
  return id ? <ClientDetail id={id} /> : <ClientList />;
}

/* ---------- list ---------- */
function ClientList() {
  const { t, data, can } = useApp();
  const showMoney = can('money');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('name');
  const [form, setForm] = useState(false);

  const all = useMemo(() => data.clients.map((c) => ({ c, m: clientMoney(data, c.id) })), [data]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const hit = all.filter(({ c }) => !s || [c.name, c.company, c.phone, c.email, ...c.addresses].some((v) => v && v.toLowerCase().includes(s)));
    const by = showMoney ? sort : sort === 'balance' ? 'name' : sort;
    return [...hit].sort((a, b) => (by === 'newest' ? b.c.since.localeCompare(a.c.since) : by === 'balance' ? b.m.owes - a.m.owes : 0) || a.c.name.localeCompare(b.c.name));
  }, [all, q, sort, showMoney]);
  const owed = sum(all, (r) => Math.max(0, r.m.owes));
  const owing = all.filter((r) => r.m.owes > 0.005).length;
  const cols = showMoney ? 6 : 3;

  return (
    <>
      <PageHeader title={t('nav.clients')} sub={t('clients.sub')} actions={<Button variant={data.clients.length ? 'primary' : 'default'} icon={<LuPlus />} onClick={() => setForm(true)} data-testid="clients-new">{t('clients.new')}</Button>} />

      {!data.clients.length ? (
        <Card className="work-none"><Empty title={t('clients.empty')} action={<Button variant="primary" icon={<LuPlus />} onClick={() => setForm(true)}>{t('clients.new')}</Button>}>{t('clients.emptyHint')}</Empty></Card>
      ) : (
        <>
          <div className="filters clients-filters">
            <SearchBox value={q} onChange={setQ} placeholder={t('clients.search')} />
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t('clients.sort')} data-testid="clients-sort">
              <option value="name">{t('clients.sort.name')}</option>
              <option value="newest">{t('clients.sort.newest')}</option>
              {showMoney && <option value="balance">{t('clients.sort.balance')}</option>}
            </select>
            {q && <button type="button" className="linkbtn small" onClick={() => setQ('')}>{t('common.clearFilters')}</button>}
          </div>
          <p className="small muted clients-sum">
            {t('clients.count', { n: data.clients.length })}
            {showMoney && <> · {t('clients.owed')}: <b>{money(owed)}</b> · {t('clients.withBalance', { n: owing })}</>}
          </p>

          {!rows.length ? (
            <Card className="work-none"><Empty title={t('common.noResults')} action={<Button onClick={() => setQ('')}>{t('common.clearFilters')}</Button>} /></Card>
          ) : (
            <Card flush>
              <div className="table-wrap">
                <table className="tbl stackable" data-testid="clients-table">
                  <thead>
                    <tr>
                      <th>{t('client')}</th><th>{t('clients.col.contact')}</th><th className="num">{t('nav.jobs')}</th>
                      {showMoney && <><th className="num">{t('clients.col.billed')}</th><th className="num">{t('clients.col.received')}</th><th className="num">{t('clients.col.balance')}</th></>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ c, m }) => (
                      <tr key={c.id} className="click" onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button')) go(`/clients/${c.id}`); }}>
                        <td className="t1">
                          <span className="clients-who">
                            <Avatar name={c.name} size="sm" />
                            <span className="grow"><A to={`/clients/${c.id}`} className="clients-name">{c.name}</A>{c.company && <span className="xs dim clients-co">{c.company}</span>}</span>
                          </span>
                        </td>
                        <td data-label={t('clients.col.contact')}>
                          {c.phone || c.email ? <span className="clients-contact">{c.phone && <span className="nowrap">{c.phone}</span>}{c.email && <span className="xs dim clients-mail">{c.email}</span>}</span> : <span className="dim small">{t('clients.noContact')}</span>}
                        </td>
                        <td data-label={t('nav.jobs')} className="num">{m.jobs}</td>
                        {showMoney && <>
                          <td data-label={t('clients.col.billed')} className="num">{money(m.billed)}</td>
                          <td data-label={t('clients.col.received')} className="num">{money(m.received)}</td>
                          <td data-label={t('clients.col.balance')} className={cx('num', m.owes > 0.005 ? 'strong' : 'dim')}>{money(m.owes)}</td>
                        </>}
                      </tr>
                    ))}
                  </tbody>
                  {showMoney && (
                    <tfoot><tr>
                      <td colSpan={2}>{t('common.total')} ({rows.length})</td><td className="num">{sum(rows, (r) => r.m.jobs)}</td>
                      <td className="num">{money(sum(rows, (r) => r.m.billed))}</td><td className="num">{money(sum(rows, (r) => r.m.received))}</td><td className="num">{money(sum(rows, (r) => r.m.owes))}</td>
                    </tr></tfoot>
                  )}
                  {!showMoney && <tfoot><tr><td colSpan={cols - 1}>{t('common.total')} ({rows.length})</td><td className="num">{sum(rows, (r) => r.m.jobs)}</td></tr></tfoot>}
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {form && <ClientForm onClose={() => setForm(false)} />}
    </>
  );
}

/* ---------- add / edit ---------- */
function ClientForm({ client, onClose }: { client?: Client; onClose: () => void }) {
  const { t } = useApp();
  const fields: FieldDef[] = [
    { k: 'name', label: t('clients.f.name'), req: true },
    { k: 'company', label: `${t('clients.f.company')} (${t('common.optional')})` },
    { k: 'phone', label: t('common.phone'), type: 'tel' },
    { k: 'email', label: t('common.email'), type: 'email' },
    { k: 'addresses', label: t('clients.f.addresses'), type: 'textarea', hint: t('clients.f.addressesHint') },
  ];
  const initial = client ? { name: client.name, company: client.company ?? '', phone: client.phone, email: client.email, addresses: client.addresses.join('\n') } : {};
  return (
    <FormModal title={t(client ? 'clients.edit' : 'clients.new')} fields={fields} initial={initial} onClose={onClose} saveLabel={t('common.save')} cancelLabel={t('common.cancel')} requiredMsg={t('common.required')}
      onSave={(v) => {
        const addresses = String(v.addresses || '').split('\n').map((a) => a.trim()).filter(Boolean);
        const input = { name: v.name, company: v.company || undefined, phone: v.phone, email: v.email, addresses };
        if (client) { act(saveClient, input, client.id); toast(t('clients.saved')); }
        else { const c = act(saveClient, input); toast(t('clients.created')); go(`/clients/${c.id}`); }
      }} />
  );
}

/* ---------- one client ---------- */
function ClientDetail({ id }: { id: string }) {
  const { t, data, can, date, standing, pack, lang } = useApp();
  const client = byId(data.clients, id);
  const [edit, setEdit] = useState(false);
  if (!client) return <Empty title={t('clients.notFound')} action={<A to="/clients" className="btn">{t('clients.back')}</A>} />;

  const showMoney = can('money');
  const jobs = jobsOfClient(data, client.id);
  const m = clientMoney(data, client.id);
  const leads = data.leads.filter((l) => l.clientId === client.id);
  const jobIds = new Set(jobs.map((j) => j.id));
  const docs = data.docs.filter((d) => jobIds.has(d.jobId)).sort((a, b) => b.updated.localeCompare(a.updated));
  const payments = jobs.flatMap((j) => j.received.map((p) => ({ p, j }))).sort((a, b) => b.p.date.localeCompare(a.p.date));
  const emails = standing('clientEmails');
  const portal = addOnViews(pack.id, lang, t).find((a) => a.id === standing('clientPortal').addOnId);
  const newJob = `/jobs?new=1&client=${client.id}`;

  const remove = async () => {
    if (jobs.length) { toast(t('clients.deleteBlocked'), true); return; }
    if (await confirmDialog(t('common.confirmDelete'), t('common.delete'), t('common.cancel'))) { if (act(deleteClient, client.id)) { toast(t('clients.deleted')); go('/clients'); } }
  };
  const optOut = (off: boolean) => { act(setEmailOptOut, client.id, off); toast(t(off ? 'clients.emails.turnedOff' : 'clients.emails.turnedOn')); };

  return (
    <>
      <BackLink to="/clients">{t('clients.back')}</BackLink>
      <PageHeader title={client.name} sub={`${client.company ? client.company + ' · ' : ''}${t('clients.since', { date: date(client.since) })}`} actions={<>
        <A to={newJob} className="btn primary" data-testid="clients-new-job"><LuPlus aria-hidden="true" />{t('clients.newJob')}</A>
        <Button icon={<LuPencil />} onClick={() => setEdit(true)} data-testid="clients-edit">{t('common.edit')}</Button>
        {can('delete') && <IconButton label={t('common.delete')} onClick={remove} data-testid="clients-delete"><LuTrash2 /></IconButton>}
      </>} />

      <div className="split">
        <div className="stack">
          {showMoney && (
            <section aria-label={t('clients.money')}>
              <div className="kpis clients-kpis" data-testid="clients-money">
                <Stat label={t('clients.col.billed')} value={money(m.billed)} />
                <Stat label={t('clients.col.received')} value={money(m.received)} />
                <Stat label={t('clients.col.balance')} value={money(m.owes)} attention={m.owes > 0.005} hint={m.owes > 0.005 ? undefined : m.billed > m.received + 0.005 ? t('clients.notDue') : m.billed > 0 ? t('clients.paidUp') : undefined} />
              </div>
              <p className="xs muted clients-note">{t('clients.moneyNote')}</p>
            </section>
          )}

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
                          <td className="t1"><A to={`/jobs/${j.id}`} className="clients-name">{j.name}</A><div className="xs dim">{j.number}{j.address ? ` · ${j.address}` : ''}</div></td>
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
                <A to={newJob} className="btn sm clients-gap"><LuPlus aria-hidden="true" />{t('clients.newJob')}</A>
              </div>
            )}
          </Card>

          {can('documents') && (
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
          )}

          {showMoney && (
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
          )}

          <NotesPanel target={{ type: 'client', id: client.id }} notes={client.notes} />
        </div>

        <div className="stack">
          <Card title={t('clients.contact')}>
            <dl className="kv">
              {client.company && <><dt>{t('common.company')}</dt><dd>{client.company}</dd></>}
              <dt>{t('common.phone')}</dt><dd>{client.phone ? <a href={`tel:${client.phone.replace(/[^0-9+]/g, '')}`}><LuPhone aria-hidden="true" className="clients-inl" />{client.phone}</a> : <span className="dim">{t('common.none')}</span>}</dd>
              <dt>{t('common.email')}</dt><dd>{client.email ? <a href={`mailto:${client.email}`}><LuMail aria-hidden="true" className="clients-inl" />{client.email}</a> : <span className="dim">{t('common.none')}</span>}</dd>
            </dl>
            <div className="clients-links"><ContactLinks phone={client.phone} address={client.addresses[0]} /></div>
          </Card>

          <Card title={<>{t('clients.addresses')} {client.addresses.length > 1 && <span className="count">{client.addresses.length}</span>}</>}>
            {client.addresses.length ? (
              <ul className="clients-addr">
                {client.addresses.map((a, i) => (
                  <li key={i}><LuMapPin aria-hidden="true" /><span className="grow">{a}</span><ContactLinks address={a} /></li>
                ))}
              </ul>
            ) : <p className="muted small">{t('clients.noAddresses')}</p>}
          </Card>

          {can('leads') && (
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
          )}

          <Card title={t('clients.emails.title')} actions={<PlanBadge feature="clientEmails" />}>
            <label className="clients-switch">
              <input type="checkbox" role="switch" checked={!!client.emailOptOut} onChange={(e) => optOut(e.target.checked)} data-testid="clients-optout" />
              <span className="clients-track" aria-hidden="true" />
              <span className="strong">{t('clients.emails.optOut')}</span>
            </label>
            <p className="small muted clients-gap">{t(client.emailOptOut ? 'clients.emails.off' : 'clients.emails.on')}</p>
            <p className="xs dim clients-gap">{t('clients.emails.demo')}</p>
            {emails.state === 'upgrade' && emails.plan && <p className="xs dim clients-gap">{t('ent.upgradeHint', { plan: planName(emails.plan, lang) })}</p>}
          </Card>

          {portal && (
            <Card title={<><LuUsers aria-hidden="true" className="clients-ico" />{portal.name}</>} className="clients-portal">
              <div className="row tight"><Badge tone="warn">{t('clients.portal.status')}</Badge><PlanBadge feature="clientPortal" detail /></div>
              <p className="small clients-gap">{t('clients.portal.body')}</p>
              {portal.note && <p className="xs dim clients-gap">{portal.note}</p>}
              <div className="clients-gap"><Link to="/request-demo" className="btn sm" data-testid="clients-portal-ask">{t('clients.portal.ask')}</Link></div>
            </Card>
          )}

          <Card title={t('common.activity')}><ActivityList items={activityFor(data, { type: 'client', id: client.id }).filter((a) => showMoney || !MONEY_ACTIVITY.includes(a.kind))} limit={8} /></Card>
        </div>
      </div>

      {edit && <ClientForm client={client} onClose={() => setEdit(false)} />}
    </>
  );
}
