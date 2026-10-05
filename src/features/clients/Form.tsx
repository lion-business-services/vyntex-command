// Add or edit a client. The record is fuller in an edition that keeps client types (a professional-services office):
// individual or business, type, owners and officers with their share, other contacts, language, office, who looks after
// the client, what they agreed to receive. A field business keeps the short record it needs: no tax or ownership fields.
// The tax ID is not here on purpose: it is set and seen on the Secure tab only.
// While the person types, the form looks for someone already on file with the same email, phone, or name and address.
import { useMemo, useState } from 'react';
import { LuCopy, LuPlus, LuTrash2 } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { appPath, go } from '@/app/router';
import { act } from '@/store/store';
import { Button, Field, IconButton, Modal, Seg, toast } from '@/ui';
import { saveClient } from '@/domain/actions';
import { clientIndex, findClientMatches, isLikelyDuplicate, type ClientMatch } from '@/domain/actions/clients';
import { canSeeClient, officesFor } from '@/domain/access';
import { clientTypesOf } from '@/domain/config';
import { byId } from '@/domain/selectors';
import type { Client, ClientPerson, Lang } from '@/domain/types';
import { uid } from '@/lib/id';
import { useDebounced } from '@/features/data/list';
import { kindOf } from './model';

const LANGS: Lang[] = ['en', 'es', 'zh'];
type Consent = '' | 'yes' | 'no';
const toConsent = (v: boolean | undefined): Consent => (v === true ? 'yes' : v === false ? 'no' : '');
const fromConsent = (v: Consent): boolean | undefined => (v === 'yes' ? true : v === 'no' ? false : undefined);
type Person = ClientPerson & { pctText: string };
const toPerson = (p: ClientPerson): Person => ({ ...p, pctText: typeof p.pct === 'number' ? String(p.pct) : '' });

export function ClientForm({ client, onClose }: { client?: Client; onClose: () => void }) {
  const { t, data, pack, user, perms, can } = useApp();
  const types = clientTypesOf(data, pack);
  const full = pack.family === 'practice';
  const offices = officesFor(data, user, perms);
  const people = data.users.filter((u) => u.active !== false);

  const [kind, setKind] = useState<'individual' | 'business'>(() => (client ? kindOf(client) : 'individual'));
  const [v, setV] = useState(() => ({
    name: client?.name ?? '', company: client?.company ?? '', phone: client?.phone ?? '', email: client?.email ?? '', addresses: (client?.addresses ?? []).join('\n'),
    clientType: client?.clientType ?? (types.find((x) => x.id === 'individual') ?? types[0])?.id ?? '', lang: (client?.lang ?? (full ? 'en' : '')) as Lang | '', birthday: client?.birthday ?? '',
    officeId: client ? client.officeId ?? '' : user?.officeIds?.[0] ?? '', assignedTo: client ? client.assignedTo ?? '' : user?.id ?? '', lifecycle: client?.lifecycle ?? 'active',
    tags: (client?.tags ?? []).join(', '), referredBy: client?.referredBy ?? '', whatsapp: client?.whatsapp ?? '', facebook: client?.social?.facebook ?? '', instagram: client?.social?.instagram ?? '',
    emailOptOut: !!client?.emailOptOut, sms: toConsent(client?.smsOptIn), wa: toConsent(client?.whatsappOptIn),
  }));
  const [owners, setOwners] = useState<Person[]>(() => (client?.owners ?? []).map(toPerson));
  const [contacts, setContacts] = useState<Person[]>(() => (client?.contacts ?? []).map(toPerson));
  const [error, setError] = useState('');
  const [sure, setSure] = useState(false);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));

  const pickKind = (k: 'individual' | 'business') => {
    setKind(k);
    // the type follows: a person is an individual, a business is the first business type unless one was already chosen
    const person = types.find((x) => x.id === 'individual');
    if (k === 'individual' && person) set('clientType', person.id);
    if (k === 'business' && v.clientType === person?.id) set('clientType', types.find((x) => x.id !== person?.id)?.id ?? v.clientType);
  };

  // is this person already on file? Looked up a moment after the typing stops, against every client of the company
  const probe = useDebounced(useMemo(() => ({ name: v.name, email: v.email, phone: v.phone, address: v.addresses.split('\n')[0] }), [v.name, v.email, v.phone, v.addresses]), 250);
  const index = useMemo(() => clientIndex(data.clients), [data]);
  const matches: ClientMatch[] = useMemo(() => (probe.name.trim() || probe.email.trim() || probe.phone.trim() ? findClientMatches(data, probe, { excludeId: client?.id, index }).filter(isLikelyDuplicate).slice(0, 3) : []), [data, probe, client?.id, index]);

  const pctTotal = owners.reduce((a, p) => a + (Number(p.pctText) || 0), 0);
  const cleanPeople = (list: Person[], withPct: boolean): ClientPerson[] | undefined => {
    const out = list.filter((p) => p.name.trim()).map(({ pctText, ...p }) => ({
      id: p.id, name: p.name.trim(), ...(p.title?.trim() ? { title: p.title.trim() } : {}), ...(p.phone?.trim() ? { phone: p.phone.trim() } : {}), ...(p.email?.trim() ? { email: p.email.trim() } : {}),
      ...(withPct && pctText.trim() !== '' && isFinite(Number(pctText)) ? { pct: Math.max(0, Math.min(100, Number(pctText))) } : {}), ...(p.primary ? { primary: true } : {}),
    }));
    return out.length ? out : undefined;
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.name.trim()) { setError(t('common.required')); return; }
    if (v.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) { setError(t('clients.f.badEmail')); return; }
    if (full && kind === 'business' && pctTotal > 100.001) { setError(t('clients.f.pctOver', { pct: pctTotal })); return; }
    // someone who looks like a client already on file: the person has to say this is a different one
    if (!client && matches.length && !sure) { setError(t('clients.dup.decide')); return; }
    const addresses = v.addresses.split('\n').map((a) => a.trim()).filter(Boolean);
    const tags = [...new Set(v.tags.split(',').map((x) => x.trim()).filter(Boolean))];
    const input: Partial<Client> & { name: string } = {
      name: v.name.trim(), company: v.company.trim() || undefined, phone: v.phone.trim(), email: v.email.trim(), addresses,
      lang: v.lang || undefined, lifecycle: v.lifecycle as Client['lifecycle'], tags: tags.length ? tags : undefined, referredBy: v.referredBy.trim() || undefined,
      contacts: cleanPeople(contacts, false), emailOptOut: v.emailOptOut || undefined, smsOptIn: fromConsent(v.sms),
    };
    if (full) Object.assign(input, {
      kind, clientType: v.clientType || undefined, birthday: kind === 'individual' ? v.birthday || undefined : undefined, officeId: v.officeId || undefined, assignedTo: v.assignedTo || undefined,
      owners: kind === 'business' ? cleanPeople(owners, true) : undefined, whatsapp: v.whatsapp.trim() || undefined, whatsappOptIn: fromConsent(v.wa),
      social: v.facebook.trim() || v.instagram.trim() ? { ...(v.facebook.trim() ? { facebook: v.facebook.trim() } : {}), ...(v.instagram.trim() ? { instagram: v.instagram.trim() } : {}) } : undefined,
    } satisfies Partial<Client>);
    if (client) { act(saveClient, input, client.id); toast(t('clients.saved')); onClose(); return; }
    const c = act(saveClient, input); toast(t('clients.created')); onClose(); go(`/clients/${c.id}`);
  };

  const personRows = (list: Person[], setList: (fn: (l: Person[]) => Person[]) => void, withPct: boolean, addKey: string, testId: string) => (
    <div className="clients-people" data-testid={testId}>
      {list.map((p, i) => {
        const patch = (more: Partial<Person>) => setList((l) => l.map((x) => (x.id === p.id ? { ...x, ...more } : x)));
        const who = p.name || `${i + 1}`;
        return (
          <div className="clients-person" key={p.id}>
            <input className="input" value={p.name} onChange={(e) => patch({ name: e.target.value })} placeholder={t('clients.f.personName')} aria-label={`${t('clients.f.personName')} ${i + 1}`} />
            <input className="input" value={p.title ?? ''} onChange={(e) => patch({ title: e.target.value })} placeholder={t(withPct ? 'clients.f.personTitle' : 'clients.f.personRelation')} aria-label={`${t(withPct ? 'clients.f.personTitle' : 'clients.f.personRelation')}: ${who}`} />
            {withPct && <span className="clients-pct"><input className="input" type="number" min={0} max={100} step="0.01" inputMode="decimal" value={p.pctText} onChange={(e) => patch({ pctText: e.target.value })} aria-label={`${t('clients.f.personPct')}: ${who}`} /><span aria-hidden="true">%</span></span>}
            <input className="input" type="tel" value={p.phone ?? ''} onChange={(e) => patch({ phone: e.target.value })} placeholder={t('common.phone')} aria-label={`${t('common.phone')}: ${who}`} />
            <input className="input" type="email" value={p.email ?? ''} onChange={(e) => patch({ email: e.target.value })} placeholder={t('common.email')} aria-label={`${t('common.email')}: ${who}`} />
            <IconButton size="sm" label={t('clients.f.personRemove', { name: who })} onClick={() => setList((l) => l.filter((x) => x.id !== p.id))}><LuTrash2 /></IconButton>
          </div>
        );
      })}
      <Button size="sm" icon={<LuPlus />} onClick={() => setList((l) => [...l, { id: uid('cp'), name: '', pctText: '' }])} data-testid={testId + '-add'}>{t(addKey)}</Button>
    </div>
  );

  return (
    <Modal title={t(client ? 'clients.edit' : 'clients.new')} onClose={onClose} size={full ? 'wide' : undefined} labelClose={t('common.cancel')}>
      <form onSubmit={save} noValidate className="clients-form" data-testid="clients-form">
        {full && <Seg label={t('clients.p.kind')} value={kind} onChange={pickKind} options={[{ value: 'individual', label: t('clients.kind.individual') }, { value: 'business', label: t('clients.kind.business') }]} />}
        <div className="fgrid">
          <Field label={<>{t(full && kind === 'business' ? 'clients.f.contactName' : 'clients.f.name')}<span aria-hidden="true"> *</span></>} htmlFor="cf-name" error={!!error && !v.name.trim()}><input id="cf-name" className="input" value={v.name} onChange={(e) => set('name', e.target.value)} aria-required="true" data-autofocus /></Field>
          <Field label={full && kind === 'business' ? t('clients.f.business') : `${t('clients.f.company')} (${t('common.optional')})`} htmlFor="cf-company"><input id="cf-company" className="input" value={v.company} onChange={(e) => set('company', e.target.value)} /></Field>
          <Field label={t('common.phone')} htmlFor="cf-phone"><input id="cf-phone" className="input" type="tel" value={v.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label={t('common.email')} htmlFor="cf-email"><input id="cf-email" className="input" type="email" value={v.email} onChange={(e) => set('email', e.target.value)} /></Field>
          {full && types.length > 0 && <Field label={t('clients.p.type')} htmlFor="cf-type"><select id="cf-type" className="input" value={v.clientType} onChange={(e) => { set('clientType', e.target.value); setKind(e.target.value === 'individual' ? 'individual' : 'business'); }}>{types.map((x) => <option key={x.id} value={x.id}>{t('ct_' + x.id)}</option>)}</select></Field>}
          <Field label={t('clients.p.lang')} htmlFor="cf-lang"><select id="cf-lang" className="input" value={v.lang} onChange={(e) => set('lang', e.target.value as Lang | '')}>{!full && <option value="">{t('clients.p.langUnset')}</option>}{LANGS.map((x) => <option key={x} value={x}>{t('lang.' + x)}</option>)}</select></Field>
          {full && kind === 'individual' && <Field label={`${t('clients.p.birthday')} (${t('common.optional')})`} htmlFor="cf-bday"><input id="cf-bday" className="input" type="date" value={v.birthday} onChange={(e) => set('birthday', e.target.value)} /></Field>}
          <Field label={t('clients.f.addresses')} htmlFor="cf-addr" full hint={t('clients.f.addressesHint')}><textarea id="cf-addr" className="input" rows={2} value={v.addresses} onChange={(e) => set('addresses', e.target.value)} /></Field>
        </div>

        {matches.length > 0 && (
          <div className="note warn clients-dup" role="status" data-testid="clients-dup">
            <p className="strong"><LuCopy aria-hidden="true" /> {t(client ? 'clients.dup.titleEdit' : 'clients.dup.title')}</p>
            <ul>
              {matches.map(({ client: c, by }) => {
                const mine = canSeeClient(data, user, perms, c); const how = by.map((b) => t('data.by.' + b)).join(', ');
                return <li key={c.id}>{mine
                  ? <><a href={appPath(`/clients/${c.id}`)} target="_blank" rel="noopener noreferrer">{c.name}</a>{c.company ? ` · ${c.company}` : ''} · {t('clients.dup.same', { by: how })}</>
                  : <>{c.name} · {t('clients.dup.restricted', { office: byId(data.offices, c.officeId)?.name ?? '' })}</>}</li>;
              })}
            </ul>
            {!client && <label className="check"><input type="checkbox" checked={sure} onChange={(e) => { setSure(e.target.checked); setError(''); }} data-testid="clients-dup-sure" /><span>{t('clients.dup.sure')}</span></label>}
            {client && can('delete') && <p className="xs">{t('clients.dup.mergeHint')}</p>}
          </div>
        )}

        {full && kind === 'business' && (
          <fieldset className="clients-set">
            <legend>{t('clients.f.owners')}</legend>
            <p className="xs dim">{t('clients.f.ownersHint')}</p>
            {personRows(owners, setOwners, true, 'clients.f.ownerAdd', 'clients-owners')}
            {owners.length > 0 && <p className={pctTotal > 100.001 ? 'small neg' : 'xs dim'}>{t('clients.f.pctTotal', { pct: Math.round(pctTotal * 100) / 100 })}</p>}
          </fieldset>
        )}
        <fieldset className="clients-set">
          <legend>{t('clients.f.contacts')}</legend>
          <p className="xs dim">{t('clients.f.contactsHint')}</p>
          {personRows(contacts, setContacts, false, 'clients.f.contactAdd', 'clients-contacts')}
        </fieldset>

        <fieldset className="clients-set">
          <legend>{t('clients.f.relationship')}</legend>
          <div className="fgrid">
            {full && data.offices.length > 0 && <Field label={t('clients.p.office')} htmlFor="cf-office" hint={t('clients.f.officeHint')}><select id="cf-office" className="input" value={v.officeId} onChange={(e) => set('officeId', e.target.value)}>
              {/* someone who sees one office files the client there; taking the office away would hide nothing and is the owner's call */}
              {(perms.includes('allClients') || !v.officeId) && <option value="">{t('clients.p.noOffice')}</option>}
              {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              {v.officeId && !offices.some((o) => o.id === v.officeId) && <option value={v.officeId}>{byId(data.offices, v.officeId)?.name ?? v.officeId}</option>}
            </select></Field>}
            {full && <Field label={t('clients.p.assigned')} htmlFor="cf-who"><select id="cf-who" className="input" value={v.assignedTo} onChange={(e) => set('assignedTo', e.target.value)}><option value="">{t('common.unassigned')}</option>{people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>}
            <Field label={t('clients.p.lifecycle')} htmlFor="cf-life"><select id="cf-life" className="input" value={v.lifecycle} onChange={(e) => set('lifecycle', e.target.value as NonNullable<Client['lifecycle']>)}>{(['active', 'inactive', 'former'] as const).map((x) => <option key={x} value={x}>{t('clients.life.' + x)}</option>)}</select></Field>
            <Field label={`${t('clients.p.referredBy')} (${t('common.optional')})`} htmlFor="cf-ref"><input id="cf-ref" className="input" value={v.referredBy} onChange={(e) => set('referredBy', e.target.value)} /></Field>
            <Field label={`${t('clients.p.tags')} (${t('common.optional')})`} htmlFor="cf-tags" full hint={t('clients.f.tagsHint')}><input id="cf-tags" className="input" value={v.tags} onChange={(e) => set('tags', e.target.value)} /></Field>
          </div>
        </fieldset>

        <fieldset className="clients-set">
          <legend>{t('clients.prefs.title')}</legend>
          <div className="fgrid">
            <label className="check full"><input type="checkbox" checked={v.emailOptOut} onChange={(e) => set('emailOptOut', e.target.checked)} /><span>{t('clients.emails.optOut')}</span></label>
            <Field label={t('clients.prefs.text')} htmlFor="cf-sms"><select id="cf-sms" className="input" value={v.sms} onChange={(e) => set('sms', e.target.value as Consent)}><option value="">{t('clients.consent.unset')}</option><option value="yes">{t('clients.consent.yes')}</option><option value="no">{t('clients.consent.no')}</option></select></Field>
            {full && <Field label={t('clients.prefs.whatsapp')} htmlFor="cf-wa"><select id="cf-wa" className="input" value={v.wa} onChange={(e) => set('wa', e.target.value as Consent)}><option value="">{t('clients.consent.unset')}</option><option value="yes">{t('clients.consent.yes')}</option><option value="no">{t('clients.consent.no')}</option></select></Field>}
            {full && <Field label={`${t('clients.p.whatsapp')} (${t('common.optional')})`} htmlFor="cf-wan"><input id="cf-wan" className="input" type="tel" value={v.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} /></Field>}
            {full && <Field label={`Facebook (${t('common.optional')})`} htmlFor="cf-fb"><input id="cf-fb" className="input" value={v.facebook} onChange={(e) => set('facebook', e.target.value)} placeholder={t('clients.f.handlePh')} /></Field>}
            {full && <Field label={`Instagram (${t('common.optional')})`} htmlFor="cf-ig"><input id="cf-ig" className="input" value={v.instagram} onChange={(e) => set('instagram', e.target.value)} placeholder={t('clients.f.handlePh')} /></Field>}
          </div>
        </fieldset>
        {full && <p className="xs dim clients-gap">{t('clients.f.taxNote')}</p>}

        {error && <p className="small neg" role="alert" style={{ marginTop: 10 }}>{error}</p>}
        <div className="modal-f" style={{ margin: '18px -18px -18px' }}>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" data-testid="clients-save">{t('common.save')}</Button>
        </div>
      </form>
    </Modal>
  );
}
