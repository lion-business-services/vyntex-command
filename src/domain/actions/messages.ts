// Everything a business writes to a lead or a client goes through here: email, text, WhatsApp, Facebook and Instagram.
// One function, `queueMessage`, decides whether a message may be prepared or sent at all (is the channel switched on for
// the company, is there an address, did the person opt out, did they agree to texts) and which state it ends in.
//
//   sample workspace   nothing leaves the browser. A message that was "sent" is marked `demo` and every screen says so.
//   live workspace     the browser marks it `queued`; the server delivers it and records what the provider answered.
//                      The browser never writes `sent`, `delivered`, `failed` or `received`.
//
// That difference lives in one place, `deliveryStatus()`.
// Also here: incoming messages (matching the sender to a client or a lead), a call somebody writes down, who looks after a
// conversation, and the consent a person gave for texts and WhatsApp.
import type { Client, DemoState, FileRef, ISODateTime, Job, Lang, Lead, Message, MessageChannel, Note, ProviderId, Ref } from '../types';
import { type Ctx, logActivity } from '../context';
import { emit } from '../rules/engine';
import type { IndustryPack } from '@/packs/types';
import { isLive } from '@/platform/session';
import { nowIso } from '@/lib/dates';
import { uid } from '@/lib/id';

/* ---------- what this module keeps on existing records ---------- */

/**
 * Fields the communications center keeps on a lead or a client until src/domain/types.ts lists them. The database stores a
 * field it has no column for in `extra` and returns it with the row, so nothing is lost.
 */
export interface ContactComms {
  /** Who looks after the conversation, and when it was last marked as done. A newer incoming message opens it again. */
  comms?: { assignee?: string; doneAt?: ISODateTime };
  lastContact?: ISODateTime;
  whatsappOptIn?: boolean;
}
/** A call somebody wrote down is a note of kind `call` on the lead or the client, with how long it lasted and who called whom. */
export type CallNote = Note & { seconds?: number; dir?: 'in' | 'out' };
/** An automatic text that was due during quiet hours waits as a draft, and says why. */
export type HeldMessage = Message & { held?: 'quiet_hours' };

/* ---------- company settings (data.settings.messages) ---------- */

/** Channels a person or a rule can write on. Calls are logged, system notices are written by the platform. */
export type SendChannel = 'email' | 'text' | 'whatsapp' | 'facebook' | 'instagram';
export const SEND_CHANNELS: SendChannel[] = ['email', 'text', 'whatsapp', 'facebook', 'instagram'];
export const isSendChannel = (c: MessageChannel): c is SendChannel => (SEND_CHANNELS as MessageChannel[]).includes(c);
/** The connection each channel is delivered through in a live workspace. Text messages may also go through the phone provider. */
export const CHANNEL_PROVIDER: Record<SendChannel | 'call', ProviderId> = { email: 'gmail', text: 'sms', whatsapp: 'whatsapp', facebook: 'meta', instagram: 'meta', call: 'dialpad' };

/** A message the company wrote once to reuse. Merge fields look like {{client.first}} and are filled when it is used. */
export interface MessageTemplate {
  id: string;
  name: string;
  channel: 'email' | 'text' | 'whatsapp';
  /** A service message answers or confirms something the client asked for. A marketing message promotes: providers review those. */
  purpose: 'service' | 'marketing';
  subject: { en: string; es: string };
  body: { en: string; es: string };
  active: boolean;
}
export interface CommsSettings {
  /** The two-way inbox. Off: the screen lists the emails prepared for review, as the field editions always have. */
  inbox: boolean;
  channels: Record<SendChannel | 'call', boolean>;
  /** Hours during which an automatic text or WhatsApp message waits for a person instead of going out. */
  quiet: { on: boolean; from: string; to: string };
  /** Closing lines added to an email a person writes, per language. Merge fields allowed. */
  signature: Partial<Record<Lang, string>>;
  templates: MessageTemplate[];
}
const DEFAULT_SIGNATURE = '{{user.name}}\n{{company.name}}\n{{company.phone}}';
/**
 * How the company set up its communications, with the edition's starting point underneath: an office edition starts with
 * the inbox and every channel on; a field edition starts with email alone, which is what it has always had.
 */
export function commsSettings(d: Pick<DemoState, 'settings'>, pack: Pick<IndustryPack, 'family'>): CommsSettings {
  const own = (d.settings?.messages ?? {}) as Partial<CommsSettings>;
  const office = pack.family === 'practice';
  return {
    inbox: own.inbox ?? office,
    channels: { email: true, text: office, whatsapp: office, facebook: office, instagram: office, call: office, ...own.channels },
    quiet: { on: true, from: '21:00', to: '08:00', ...own.quiet },
    signature: { en: DEFAULT_SIGNATURE, es: DEFAULT_SIGNATURE, ...own.signature },
    templates: own.templates ?? [],
  };
}
/** Changes the company's communications settings. Only what is passed changes. */
export function saveCommsSettings(d: DemoState, _ctx: Ctx, patch: Partial<CommsSettings>): void {
  const cur = (d.settings.messages ?? {}) as Partial<CommsSettings>;
  d.settings = { ...d.settings, messages: { ...cur, ...patch, ...(patch.channels ? { channels: { ...cur.channels, ...patch.channels } } : {}) } };
}

/** `HH:MM` right now, in the company's time zone when it has one. */
function clock(now: Date, zone?: string): string {
  try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, ...(zone ? { timeZone: zone } : {}) }).format(now).replace(/^24/, '00'); }
  catch { return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`; }
}
/** True when `hhmm` falls inside the quiet period. The period may run past midnight (21:00 to 08:00). */
export function isQuiet(hhmm: string, quiet: CommsSettings['quiet']): boolean {
  if (!quiet.on || quiet.from === quiet.to) return false;
  return quiet.from < quiet.to ? hhmm >= quiet.from && hhmm < quiet.to : hhmm >= quiet.from || hhmm < quiet.to;
}
export const quietNow = (d: DemoState, pack: Pick<IndustryPack, 'family'>, now = new Date()): boolean => isQuiet(clock(now, d.company.timezone), commsSettings(d, pack).quiet);

/* ---------- who a message is for ---------- */

export interface Contact { client?: Client & ContactComms; lead?: Lead & ContactComms }
const job = (d: DemoState, id: string | undefined): Job | undefined => (id ? d.jobs.find((j) => j.id === id) : undefined);

/** The client or the lead a record belongs to. A won lead answers with its client. */
export function contactOf(d: DemoState, ref: Ref | undefined | null, clientId?: string): Contact {
  const client = (id: string | undefined) => (id ? d.clients.find((c) => c.id === id) : undefined);
  const lead = (id: string | undefined) => (id ? d.leads.find((l) => l.id === id) : undefined);
  const of = (c?: string, l?: string): Contact => { const ld = lead(l); const cl = client(c) ?? client(ld?.clientId); return cl ? { client: cl } : ld ? { lead: ld } : {}; };
  if (clientId && client(clientId)) return { client: client(clientId) };
  if (!ref || !ref.id) return {};
  switch (ref.type) {
    case 'client': return of(ref.id);
    case 'lead': return of(undefined, ref.id);
    case 'job': return of(job(d, ref.id)?.clientId);
    case 'doc': { const x = d.docs.find((y) => y.id === ref.id); return of(x?.clientId, x?.leadId); }
    case 'appointment': { const x = d.appointments.find((y) => y.id === ref.id); return of(x?.clientId, x?.leadId); }
    case 'task': { const x = d.tasks.find((y) => y.id === ref.id); return of(x?.clientId ?? job(d, x?.jobId)?.clientId, x?.leadId); }
    case 'opportunity': return of(d.opportunities.find((y) => y.id === ref.id)?.clientId);
    case 'review': return of(d.reviews.find((y) => y.id === ref.id)?.clientId);
    case 'envelope': { const x = d.docs.find((y) => y.id === d.envelopes.find((e) => e.id === ref.id)?.docId); return of(x?.clientId, x?.leadId); }
    case 'compliance': { const x = d.complianceItems.find((y) => y.id === ref.id); return of(x?.clientId ?? job(d, x?.jobId)?.clientId); }
    default: return {};
  }
}
const digits = (s: string | undefined) => { const n = (s ?? '').replace(/\D/g, ''); return n.length === 11 && n[0] === '1' ? n.slice(1) : n; };
const isEmail = (s: string) => /^\S+@\S+\.\S+$/.test(s.trim());

/** Where a channel reaches this person, from their record. Empty when the record has nothing for that channel. */
export function addressFor(channel: MessageChannel, who: Contact): string {
  const c = who.client; const l = who.lead;
  switch (channel) {
    case 'email': return (c?.email ?? l?.email ?? '').trim();
    case 'text': case 'call': return (c?.phone ?? l?.phone ?? '').trim();
    case 'whatsapp': return (c?.whatsapp || c?.phone || l?.phone || '').trim();
    case 'facebook': return (c?.social?.facebook ?? '').trim();
    case 'instagram': return (c?.social?.instagram ?? '').trim();
    default: return '';
  }
}
const validAddress = (channel: MessageChannel, to: string): boolean =>
  (channel === 'email' ? isEmail(to) : channel === 'text' || channel === 'whatsapp' ? digits(to).length >= 7 : !!to.trim());

/** What the person agreed to for a channel: `yes`, `no` (they said stop) or `unknown` (nobody asked yet). */
export function consentFor(channel: SendChannel, who: Contact): 'yes' | 'no' | 'unknown' {
  const flag = (v: boolean | undefined) => (v === true ? 'yes' : v === false ? 'no' : 'unknown');
  if (channel === 'email') return who.client?.emailOptOut ? 'no' : 'yes';
  if (channel === 'text') return flag(who.client ? who.client.smsOptIn : who.lead?.smsOptIn);
  if (channel === 'whatsapp') return flag(who.client ? who.client.whatsappOptIn : who.lead?.whatsappOptIn);
  return 'unknown';
}

/* ---------- may this message be written? ---------- */

export type Refusal = 'opted_out' | 'no_consent' | 'no_address' | 'channel_off';
export interface CheckOptions {
  to?: string;
  /** A person is writing this one themselves, to one client. See OutgoingMessage.personal. */
  personal?: boolean;
  draft?: boolean;
}
/**
 * The one set of rules for writing to someone. Returns why not, or null when the message may be written.
 *   channel_off   the company does not use this channel (or it is not a channel one writes on: calls, system notices)
 *   no_address    the record has no address for the channel and none was given
 *   opted_out     the person said no: no automatic emails, or STOP to texts
 *   no_consent    texts and WhatsApp need the person's agreement on record first; Facebook and Instagram only allow
 *                 answering someone who wrote first
 */
export function checkOutgoing(d: DemoState, pack: Pick<IndustryPack, 'family'>, channel: MessageChannel, who: Contact, o: CheckOptions = {}): Refusal | null {
  if (!isSendChannel(channel) || !commsSettings(d, pack).channels[channel]) return 'channel_off';
  const to = (o.to ?? addressFor(channel, who)).trim();
  // someone writing by hand may save a draft before the address is known; it is asked for again when they send
  if (!validAddress(channel, to) && !(o.personal && o.draft)) return 'no_address';
  if (channel === 'email') return who.client?.emailOptOut && !o.personal ? 'opted_out' : null;
  if (channel === 'text' || channel === 'whatsapp') {
    const consent = consentFor(channel, who);
    return consent === 'no' ? 'opted_out' : consent === 'unknown' ? 'no_consent' : null;
  }
  // Facebook and Instagram: a business page answers people, it does not start conversations
  const wroteFirst = d.messages.some((m) => m.channel === channel && m.dir === 'in' && sameContact(d, m, who, to));
  return wroteFirst ? null : 'no_consent';
}
function sameContact(d: DemoState, m: Message, who: Contact, address: string): boolean {
  const other = contactOf(d, m.ref, m.clientId);
  if (who.client) return other.client?.id === who.client.id;
  if (who.lead) return other.lead?.id === who.lead.id;
  return !!address && (m.from ?? '').trim().toLowerCase() === address.toLowerCase();
}

/* ---------- writing ---------- */

export interface OutgoingMessage {
  channel: MessageChannel; to: string; subject?: string; body: string; ref: Ref;
  clientId?: string;
  /** Rule id when an automation wrote it. The same id never produces a second message. */
  auto?: string;
  /** `draft` waits for a person to review and send; `send` goes out as soon as the channel allows (sample mode: marked `demo`, nothing leaves the browser). */
  mode?: 'draft' | 'send';
  /**
   * A person is writing this one themselves, to one client (the composer sets it; a rule or another module never does).
   * Two things follow: an opt-out of automatic emails does not stop it, and a draft may be saved before the address is
   * known. Consent for texts and WhatsApp applies either way.
   */
  personal?: boolean;
  /** The message being answered: the reply joins its conversation. */
  replyTo?: string;
  attachments?: FileRef[];
}
export type QueueResult = { ok: true; message: Message } | { ok: false; reason: Refusal };

/**
 * The state of a message that was just sent. The one place that knows the difference between a sample workspace, where
 * nothing is delivered and the message says so, and a live one, where the server takes it from `queued`.
 */
export const deliveryStatus = (): Message['status'] => (isLive() ? 'queued' : 'demo');

/** Messages to the same person on the same channel are one conversation. */
export function threadOf(channel: MessageChannel, who: Contact, address: string): string {
  return (who.client ? 'c:' + who.client.id : who.lead ? 'l:' + who.lead.id : 'a:' + address.trim().toLowerCase()) + ':' + channel;
}
const also = (d: DemoState, ref: Ref, who: Contact): Ref[] | undefined =>
  (ref.type !== 'client' && who.client ? [{ type: 'client', id: who.client.id }] : ref.type !== 'lead' && !who.client && who.lead ? [{ type: 'lead', id: who.lead.id }] : undefined);
const preview = (m: Pick<Message, 'subject' | 'body'>) => (m.subject || m.body).replace(/\s+/g, ' ').trim().slice(0, 80);

/** One line of history for a message. Emails keep the lines they always had; other channels name themselves. */
function logMessage(d: DemoState, ctx: Ctx, m: Message, what: 'drafted' | 'demoSent' | 'queued', who: Contact) {
  const ref = m.ref?.id ? m.ref : who.client ? { type: 'client' as const, id: who.client.id } : who.lead ? { type: 'lead' as const, id: who.lead.id } : null;
  if (!ref) return;
  if (m.channel === 'email') logActivity(d, ctx.actor, 'message.' + what, ref, { subject: preview(m) }, also(d, ref, who));
  else logActivity(d, ctx.actor, 'message.other.' + what, ref, { channel: ctx.t('messages.ch.' + m.channel), subject: preview(m) }, also(d, ref, who));
}
/** A message went out (or, in a sample, was marked as sent): the lead or client was contacted now. */
function touch(who: Contact, at: ISODateTime) { if (who.lead) who.lead.lastContact = at; if (who.client) who.client.lastContact = at; }

/**
 * Prepares or sends a message. Refuses, with the reason, when the channel is off, there is no address, the person opted
 * out, or (texts and WhatsApp) they have not agreed. An automatic text due during quiet hours is kept as a draft for a person.
 */
export function queueMessage(d: DemoState, ctx: Ctx, m: OutgoingMessage): QueueResult {
  const who = contactOf(d, m.ref, m.clientId);
  const mode = m.mode ?? 'draft';
  const to = (m.to || addressFor(m.channel, who)).trim();
  const no = checkOutgoing(d, ctx.pack, m.channel, who, { to, personal: m.personal, draft: mode === 'draft' });
  if (no) return { ok: false, reason: no };
  if (m.auto) { const had = d.messages.find((x) => x.auto === m.auto); if (had) return { ok: true, message: had }; }
  const held = mode === 'send' && !!m.auto && (m.channel === 'text' || m.channel === 'whatsapp') && quietNow(d, ctx.pack);
  const sent = mode === 'send' && !held;
  const at = nowIso();
  const msg: HeldMessage = {
    id: uid('m'), at, channel: m.channel, to, subject: (m.subject ?? '').trim(), body: m.body.trim(), status: sent ? deliveryStatus() : 'draft', ref: m.ref,
    threadId: d.messages.find((x) => x.id === m.replyTo)?.threadId ?? threadOf(m.channel, who, to),
    ...(who.client ? { clientId: who.client.id } : {}), ...(m.auto ? { auto: m.auto } : { by: ctx.actor }),
    ...(m.attachments?.length ? { attachments: m.attachments } : {}), ...(held ? { held: 'quiet_hours' as const } : {}),
  };
  d.messages.unshift(msg);
  if (sent) touch(who, at);
  logMessage(d, ctx, msg, sent ? (msg.status === 'demo' ? 'demoSent' : 'queued') : 'drafted', who);
  return { ok: true, message: msg };
}

/** Changes a draft. A message that already left is a record and stays as it is. */
export function updateDraft(d: DemoState, _ctx: Ctx, id: string, patch: Partial<Pick<Message, 'to' | 'subject' | 'body' | 'attachments'>>): Message | null {
  const m = d.messages.find((x) => x.id === id); if (!m || m.status !== 'draft') return null;
  if (patch.to !== undefined) m.to = patch.to.trim();
  if (patch.subject !== undefined) m.subject = patch.subject.trim();
  if (patch.body !== undefined) m.body = patch.body.trim();
  if (patch.attachments !== undefined) m.attachments = patch.attachments.length ? patch.attachments : undefined;
  return m;
}
/**
 * A person reviewed a draft and sends it. The same rules are checked again, because the record may have changed since the
 * draft was written. Sending is that person's decision, so it counts as written by them (see OutgoingMessage.personal).
 */
export function sendDraft(d: DemoState, ctx: Ctx, id: string): QueueResult | { ok: false; reason: 'not_found' } {
  const m = d.messages.find((x) => x.id === id) as HeldMessage | undefined;
  if (!m) return { ok: false, reason: 'not_found' };
  if (m.status !== 'draft') return { ok: true, message: m };
  const who = contactOf(d, m.ref, m.clientId);
  const no = checkOutgoing(d, ctx.pack, m.channel, who, { to: m.to, personal: true });
  if (no) return { ok: false, reason: no };
  m.status = deliveryStatus(); m.at = nowIso(); m.by = m.by ?? ctx.actor; delete m.held;
  touch(who, m.at);
  logMessage(d, ctx, m, m.status === 'demo' ? 'demoSent' : 'queued', who);
  return { ok: true, message: m };
}
/** Removes a draft, or a message that was only ever marked as sent in a sample workspace. Real records stay. */
export function discardDraft(d: DemoState, _ctx: Ctx, id: string): boolean {
  const m = d.messages.find((x) => x.id === id);
  if (!m || (m.status !== 'draft' && m.status !== 'demo')) return false;
  d.messages = d.messages.filter((x) => x.id !== id);
  return true;
}

/* ---------- incoming ---------- */

export interface IncomingMessage {
  channel: MessageChannel; from: string; to?: string; subject?: string; body: string; at?: ISODateTime;
  provider?: ProviderId; externalId?: string; seconds?: number; attachments?: FileRef[];
}
/** Stands where a record would be for a sender nobody has on file yet. The screens offer to create a lead from it. */
export const NO_RECORD: Ref = { type: 'lead', id: '' };

/** Finds who wrote: a client first (their own address, then the people listed on their record), then a lead that is still open. */
export function matchSender(d: DemoState, channel: MessageChannel, from: string): Contact {
  const raw = from.trim().toLowerCase();
  if (!raw) return {};
  const phone = channel === 'text' || channel === 'whatsapp' || channel === 'call';
  const same = (v: string | undefined) => !!v && (phone ? digits(v).length >= 7 && digits(v) === digits(raw) : v.trim().toLowerCase() === raw);
  const client = d.clients.find((c) => (channel === 'facebook' ? same(c.social?.facebook) : channel === 'instagram' ? same(c.social?.instagram) : phone ? same(c.phone) || same(c.whatsapp) : same(c.email)))
    ?? (channel === 'facebook' || channel === 'instagram' ? undefined : d.clients.find((c) => [...(c.owners ?? []), ...(c.contacts ?? [])].some((p) => (phone ? same(p.phone) : same(p.email)))));
  if (client) return { client };
  if (channel === 'facebook' || channel === 'instagram') return {};
  // newest lead first; a lead that became a client was already found above
  const lead = d.leads.find((l) => !l.clientId && (phone ? same(l.phone) : same(l.email)));
  return lead ? { lead } : {};
}
/**
 * Records a message or a call that came in. In a live workspace the server does this when a provider reports it; a sample
 * workspace only ever holds sample records. The sender is matched to a client or a lead, the message joins their
 * conversation, and the rules hear about it.
 */
export function receiveMessage(d: DemoState, ctx: Ctx, m: IncomingMessage): Message {
  if (m.provider && m.externalId) { const had = d.messages.find((x) => x.provider === m.provider && x.externalId === m.externalId); if (had) return had; }
  const who = matchSender(d, m.channel, m.from);
  const ref: Ref = who.client ? { type: 'client', id: who.client.id } : who.lead ? { type: 'lead', id: who.lead.id } : NO_RECORD;
  const msg: Message = {
    id: uid('m'), at: m.at ?? nowIso(), channel: m.channel, to: (m.to ?? '').trim(), from: m.from.trim(), subject: (m.subject ?? '').trim(), body: m.body.trim(),
    status: 'received', dir: 'in', read: false, ref, threadId: threadOf(m.channel, who, m.from),
    ...(who.client ? { clientId: who.client.id } : {}), ...(m.provider ? { provider: m.provider } : {}), ...(m.externalId ? { externalId: m.externalId } : {}),
    ...(m.seconds !== undefined ? { seconds: m.seconds } : {}), ...(m.attachments?.length ? { attachments: m.attachments } : {}),
  };
  d.messages.unshift(msg);
  touch(who, msg.at);
  if (ref.id) logActivity(d, 'system', 'message.received', ref, { channel: ctx.t('messages.ch.' + m.channel), subject: preview(msg) });
  emit(d, ctx, 'message.received', { ref: ref.id ? ref : undefined, message: msg, client: who.client, lead: who.lead });
  return msg;
}
/** Marks incoming messages as opened. */
export function markRead(d: DemoState, _ctx: Ctx, ids: string[]): void {
  const set = new Set(ids);
  for (const m of d.messages) if (set.has(m.id) && m.dir === 'in' && m.read === false) m.read = true;
}

/* ---------- calls, conversations, consent ---------- */

const holder = (d: DemoState, ref: Ref): ((Client | Lead) & ContactComms) | undefined =>
  (ref.type === 'client' ? d.clients.find((c) => c.id === ref.id) : ref.type === 'lead' ? d.leads.find((l) => l.id === ref.id) : undefined);

/**
 * Writes down a call somebody had: a note of kind `call` on the lead or the client, with the length and who called whom.
 * A call reported by a connected phone system arrives as a message on the `call` channel instead (receiveMessage).
 */
export function logCall(d: DemoState, ctx: Ctx, ref: Ref, call: { dir: 'in' | 'out'; seconds: number; text: string }): CallNote | null {
  const rec = holder(d, ref); if (!rec) return null;
  const at = nowIso();
  const text = call.text.trim() || ctx.t(call.dir === 'in' ? 'messages.call.in' : 'messages.call.out');
  const note: CallNote = { id: uid('n'), at, kind: 'call', text, by: ctx.actor, dir: call.dir, ...(call.seconds > 0 ? { seconds: Math.round(call.seconds) } : {}) };
  rec.notes.unshift(note);
  rec.lastContact = at;
  logActivity(d, ctx.actor, 'call.logged', ref, { text: text.slice(0, 80) });
  return note;
}
/** Who looks after a conversation, and whether it is done. `assignee: null` hands it back to whoever looks after the record. */
export function setConversation(d: DemoState, ctx: Ctx, ref: Ref, patch: { assignee?: string | null; done?: boolean }): void {
  const rec = holder(d, ref); if (!rec) return;
  const next = { ...rec.comms };
  if (patch.assignee !== undefined) {
    if (patch.assignee) next.assignee = patch.assignee; else delete next.assignee;
    logActivity(d, ctx.actor, 'conversation.assigned', ref, { name: d.users.find((u) => u.id === patch.assignee)?.name ?? ctx.t('common.unassigned') });
  }
  if (patch.done !== undefined) {
    if (patch.done) next.doneAt = nowIso(); else delete next.doneAt;
    logActivity(d, ctx.actor, patch.done ? 'conversation.done' : 'conversation.reopened', ref);
  }
  rec.comms = Object.keys(next).length ? next : undefined;
}
/**
 * Records what a person said about being contacted on a channel: they agreed (texts, WhatsApp), or they said stop.
 * For email the choice is about automatic emails, which is how the record has always kept it.
 */
export function recordConsent(d: DemoState, ctx: Ctx, ref: Ref, channel: 'email' | 'text' | 'whatsapp', agreed: boolean): void {
  const rec = holder(d, ref); if (!rec) return;
  if (channel === 'email') { if (ref.type !== 'client') return; (rec as Client).emailOptOut = agreed ? undefined : true; }
  else if (channel === 'text') rec.smsOptIn = agreed;
  else rec.whatsappOptIn = agreed;
  logActivity(d, ctx.actor, agreed ? 'consent.on' : 'consent.off', ref, { channel: ctx.t('messages.ch.' + channel) });
}
