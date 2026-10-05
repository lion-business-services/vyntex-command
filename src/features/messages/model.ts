// How the inbox reads the records: one conversation per person (a client, a lead, or an address nobody has on file yet),
// with everything said to and from them on every channel, in time order. Nothing is copied: the conversations are worked
// out from the messages and from the notes on the lead or client each time the data changes. Pure functions, no React.
import type { Client, DemoState, FileRef, ISODateTime, Lang, Lead, Message, MessageChannel, Ref, TeamUser } from '@/domain/types';
import type { Permission } from '@/domain/permissions';
import type { IndustryPack } from '@/packs/types';
import { canSeeClient, canSeeLead } from '@/domain/access';
import {
  CHANNEL_PROVIDER, SEND_CHANNELS, addressFor, checkOutgoing, commsSettings, consentFor,
  type CallNote, type Contact, type ContactComms, type Refusal, type SendChannel,
} from '@/domain/actions/messages';
import { fmtDate, fmtTime, today } from '@/lib/dates';

/** `c_<client id>`, `l_<lead id>` or `a_<address>`. */
export type ConvKey = string;
export interface Conversation {
  key: ConvKey;
  client?: Client & ContactComms;
  lead?: Lead & ContactComms;
  /** The address, for someone who is not on file. */
  address?: string;
  name: string;
  sub: string;
  /** The record the conversation belongs to. Null for an address nobody has on file. */
  ref: Ref | null;
  channels: MessageChannel[];
  lastAt: ISODateTime;
  last?: Message | CallNote;
  unread: number;
  /** The last word is theirs and nobody has marked the conversation as done since. */
  needsReply: boolean;
  drafts: number;
  /** Who looks after it: whoever it was given to, or whoever looks after the record. */
  assignee?: string;
  done: boolean;
  /** Messages and calls, on any channel. System notices are counted apart: they are about the person, not said to or by them. */
  total: number;
  notices: number;
  /** Every message of the conversation, system notices included, as found. Kept here so opening it does not search the whole list again. */
  messages: Message[];
}
/** One thing in a conversation: a message or call on a channel, or a note on the record (never sent). */
export interface Entry { id: string; at: ISODateTime; message?: Message; note?: CallNote }

const lower = (s: string | undefined) => (s ?? '').trim().toLowerCase();
const digits = (s: string | undefined) => { const n = (s ?? '').replace(/\D/g, ''); return n.length === 11 && n[0] === '1' ? n.slice(1) : n; };
const isPhoneChannel = (c: MessageChannel) => c === 'text' || c === 'whatsapp' || c === 'call';

interface Index {
  client: Map<string, Client>; lead: Map<string, Lead>; jobClient: Map<string, string>;
  byEmail: Map<string, ConvKey>; byPhone: Map<string, ConvKey>;
}
/** Lookups built once per pass, so thousands of messages are placed without searching the lists again for each one. */
function index(d: DemoState): Index {
  const ix: Index = { client: new Map(), lead: new Map(), jobClient: new Map(), byEmail: new Map(), byPhone: new Map() };
  const put = (m: Map<string, ConvKey>, k: string, key: ConvKey) => { if (k && !m.has(k)) m.set(k, key); };
  for (const c of d.clients) {
    ix.client.set(c.id, c);
    put(ix.byEmail, lower(c.email), 'c_' + c.id); put(ix.byPhone, digits(c.phone), 'c_' + c.id); put(ix.byPhone, digits(c.whatsapp), 'c_' + c.id);
  }
  for (const l of d.leads) {
    ix.lead.set(l.id, l);
    const key = l.clientId && ix.client.has(l.clientId) ? 'c_' + l.clientId : 'l_' + l.id;
    put(ix.byEmail, lower(l.email), key); put(ix.byPhone, digits(l.phone), key);
  }
  for (const j of d.jobs) ix.jobClient.set(j.id, j.clientId);
  return ix;
}
/** Which conversation a message belongs to: the record it names, else whoever has that address, else the address itself. */
function keyOf(ix: Index, m: Message): ConvKey {
  if (m.clientId && ix.client.has(m.clientId)) return 'c_' + m.clientId;
  const r = m.ref;
  if (r && r.id) {
    if (r.type === 'client' && ix.client.has(r.id)) return 'c_' + r.id;
    if (r.type === 'job') { const c = ix.jobClient.get(r.id); if (c) return 'c_' + c; }
    if (r.type === 'lead') { const l = ix.lead.get(r.id); if (l) return l.clientId && ix.client.has(l.clientId) ? 'c_' + l.clientId : 'l_' + l.id; }
  }
  const address = m.dir === 'in' ? m.from : m.to;
  const hit = isPhoneChannel(m.channel) ? ix.byPhone.get(digits(address)) : ix.byEmail.get(lower(address));
  return hit ?? 'a_' + lower(address);
}

export interface Viewer { user: TeamUser | undefined; perms: Permission[] }
const stateOf = (rec: ContactComms | undefined) => rec?.comms ?? {};
const isOut = (m: Message) => m.dir !== 'in';

/**
 * Every conversation the viewer may see, newest first. A client of another office is left out, as on the client list.
 * A person with only notes on file is not a conversation; one with a message or a logged call is.
 */
export function conversations(d: DemoState, viewer: Viewer): Conversation[] {
  const ix = index(d);
  const map = new Map<ConvKey, Conversation>();
  const open = (key: ConvKey): Conversation | null => {
    const had = map.get(key); if (had) return had;
    const id = key.slice(2);
    let c: Conversation;
    if (key[0] === 'c') {
      const client = ix.client.get(id); if (!client || !canSeeClient(d, viewer.user, viewer.perms, client)) return null;
      c = { key, client, name: client.name, sub: client.company ?? '', ref: { type: 'client', id }, channels: [], lastAt: '', unread: 0, needsReply: false, drafts: 0, assignee: stateOf(client).assignee ?? client.assignedTo, done: false, total: 0, notices: 0, messages: [] as Message[] };
    } else if (key[0] === 'l') {
      const lead = ix.lead.get(id); if (!lead || !canSeeLead(viewer.user, viewer.perms, lead)) return null;
      c = { key, lead, name: lead.name, sub: lead.company ?? lead.ticket, ref: { type: 'lead', id }, channels: [], lastAt: '', unread: 0, needsReply: false, drafts: 0, assignee: stateOf(lead).assignee ?? (lead.ownerId || undefined), done: false, total: 0, notices: 0, messages: [] as Message[] };
    } else {
      c = { key, address: id, name: id, sub: '', ref: null, channels: [], lastAt: '', unread: 0, needsReply: false, drafts: 0, done: false, total: 0, notices: 0, messages: [] as Message[] };
    }
    map.set(key, c);
    return c;
  };
  // the last thing said to or by the person (drafts, system notices and notes do not count as a word in the conversation)
  const spoken = new Map<ConvKey, { at: ISODateTime; incoming: boolean }>();
  const see = (c: Conversation, at: ISODateTime, channel: MessageChannel, item: Message | CallNote) => {
    c.total++;
    if (!c.channels.includes(channel)) c.channels.push(channel);
    if (at > c.lastAt) { c.lastAt = at; c.last = item; }
  };
  // a notice from the platform is shown inside the conversation; it does not make the conversation unread, move it up the
  // list or stand as its last line, unless there is nothing else in it
  const noticed = new Map<ConvKey, Message>();
  for (const m of d.messages) {
    const key = keyOf(ix, m);
    // a notice about something that is not a person (an overdue task) is no conversation: the Notices view lists it
    if (m.channel === 'system' && key[0] === 'a') continue;
    const c = open(key); if (!c) continue;
    c.messages.push(m);
    if (m.channel === 'system') { c.notices++; const n = noticed.get(c.key); if (!n || m.at > n.at) noticed.set(c.key, m); continue; }
    see(c, m.at, m.channel, m);
    if (m.status === 'draft') { c.drafts++; continue; }
    if (m.dir === 'in' && m.read === false) c.unread++;
    // a call that was answered is a conversation that took place; only one nobody picked up waits for a call back
    const waits = !isOut(m) && !(m.channel === 'call' && (m.seconds ?? 0) > 0);
    const s = spoken.get(c.key); if (!s || m.at > s.at) spoken.set(c.key, { at: m.at, incoming: waits });
  }
  // a call somebody wrote down: the two sides spoke, so nothing is left waiting for an answer
  const calls = (key: ConvKey, notes: CallNote[]) => {
    for (const n of notes) {
      if (n.kind !== 'call') continue;
      const c = open(key); if (!c) return;
      see(c, n.at, 'call', n);
      const s = spoken.get(key); if (!s || n.at > s.at) spoken.set(key, { at: n.at, incoming: false });
    }
  };
  for (const c of d.clients) if (c.notes.length) calls('c_' + c.id, c.notes);
  for (const l of d.leads) if (l.notes.length && !(l.clientId && ix.client.has(l.clientId))) calls('l_' + l.id, l.notes);
  for (const c of map.values()) {
    const s = spoken.get(c.key); const doneAt = stateOf(c.client ?? c.lead).doneAt;
    c.done = !!doneAt && (!s || !s.incoming || s.at <= doneAt);
    c.needsReply = !!s && s.incoming && !c.done;
    c.channels.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
    if (!c.total) { const n = noticed.get(c.key); if (n) { c.lastAt = n.at; c.last = n; } }
  }
  return [...map.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}
export const ORDER: MessageChannel[] = ['email', 'text', 'whatsapp', 'facebook', 'instagram', 'call', 'system'];

/* ---------- notices: what the platform wrote for people in the office ---------- */

/** One notice (a rule's "notify" step, a reminder that was held back), with who or what it is about and where a click leads. */
export interface Notice { message: Message; /** The client or lead it is about. Empty when it is about something else. */ about: string; /** The kind of record it is about. */ kind: Ref['type'] | null; /** App path it opens, or null. */ path: string | null; unread: boolean }
/**
 * Every notice the viewer may see, newest first. A notice about a client of another office is left out, as that client's
 * conversation is. `pathOf` turns a record into its page (the router's `refPath`), kept as a parameter so this file stays pure.
 */
export function notices(d: DemoState, viewer: Viewer, pathOf: (ref: Ref) => string): Notice[] {
  const ix = index(d); const out: Notice[] = [];
  for (const m of d.messages) {
    if (m.channel !== 'system') continue;
    const key = keyOf(ix, m); const r = m.ref;
    let about = ''; let kind: Notice['kind'] = null; let path: string | null = null;
    if (key[0] === 'c') { const c = ix.client.get(key.slice(2)); if (!c || !canSeeClient(d, viewer.user, viewer.perms, c)) continue; about = c.name; kind = 'client'; path = `/messages?c=${encodeURIComponent(key)}`; }
    else if (key[0] === 'l') { const l = ix.lead.get(key.slice(2)); if (!l || !canSeeLead(viewer.user, viewer.perms, l)) continue; about = l.name; kind = 'lead'; path = `/messages?c=${encodeURIComponent(key)}`; }
    // a person inside the company is not a record to open; anything else on file is
    else if (r?.id && r.type !== 'user') { kind = r.type; path = pathOf(r); }
    out.push({ message: m, about, kind, path, unread: m.read === false });
  }
  return out.sort((a, b) => b.message.at.localeCompare(a.message.at));
}

/** A conversation for someone with nothing said yet, so "New message" can open on an empty thread. */
export function conversationFor(d: DemoState, viewer: Viewer, key: ConvKey): Conversation | null {
  const hit = conversations(d, viewer).find((c) => c.key === key); if (hit) return hit;
  const id = key.slice(2);
  const blank = { channels: [] as MessageChannel[], lastAt: '', unread: 0, needsReply: false, drafts: 0, done: false, total: 0, notices: 0, messages: [] as Message[] };
  if (key[0] === 'c') { const client = d.clients.find((x) => x.id === id); return client && canSeeClient(d, viewer.user, viewer.perms, client) ? { key, client, name: client.name, sub: client.company ?? '', ref: { type: 'client', id }, assignee: client.assignedTo, ...blank } : null; }
  if (key[0] === 'l') { const lead = d.leads.find((x) => x.id === id); return lead && canSeeLead(viewer.user, viewer.perms, lead) ? { key, lead, name: lead.name, sub: lead.company ?? lead.ticket, ref: { type: 'lead', id }, assignee: lead.ownerId || undefined, ...blank } : null; }
  return null;
}
/** The conversation a message is part of. */
export const keyOfMessage = (d: DemoState, m: Message): ConvKey => keyOf(index(d), m);

/** Everything in one conversation, oldest first: messages and calls on every channel, and the notes on the record. */
export function timeline(c: Conversation): Entry[] {
  const out: Entry[] = c.messages.map((m) => ({ id: m.id, at: m.at, message: m }));
  for (const n of (c.client ?? c.lead)?.notes ?? []) out.push({ id: n.id, at: n.at, note: n });
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
export const contactOfConv = (c: Conversation): Contact => (c.client ? { client: c.client } : c.lead ? { lead: c.lead } : {});

/* ---------- which channels can reach this person right now ---------- */

export interface ChannelState {
  channel: SendChannel;
  address: string;
  /** Why the channel cannot be used, or null when it can. `not_connected`: a live workspace whose provider is not connected yet. */
  blocked: Refusal | 'not_connected' | null;
  consent: 'yes' | 'no' | 'unknown';
}
/** The channels the company has switched on, each with the person's address and whether it may be used. */
export function channelStates(d: DemoState, pack: Pick<IndustryPack, 'family'>, c: Conversation, live: boolean): ChannelState[] {
  const who = contactOfConv(c); const on = commsSettings(d, pack).channels;
  return SEND_CHANNELS.filter((ch) => on[ch]).map((channel) => {
    // someone who is not on file is reached at the address they wrote from: an email address by email, a number by text or WhatsApp
    const loose = c.ref ? '' : c.address ?? '';
    // on Facebook and Instagram the address is whoever wrote: the record seldom carries it, the last message from them does
    const social = channel === 'facebook' || channel === 'instagram';
    const address = addressFor(channel, who) || (social ? wroteFrom(c, channel) : (loose.includes('@') ? channel === 'email' : channel === 'text' || channel === 'whatsapp') ? loose : '');
    let blocked: ChannelState['blocked'] = checkOutgoing(d, pack, channel, who, { to: address, personal: true });
    // a live workspace delivers through a connection; without one there is nothing to send with (email may also go out as system mail)
    if (!blocked && live && !connected(d, channel)) blocked = 'not_connected';
    return { channel, address, blocked, consent: consentFor(channel, who) };
  });
}
/** The sender of the newest message this person wrote on a channel. */
function wroteFrom(c: Conversation, channel: MessageChannel): string {
  let best: Message | undefined;
  for (const m of c.messages) if (m.channel === channel && m.dir === 'in' && m.from && (!best || m.at > best.at)) best = m;
  return best?.from ?? '';
}
export function connected(d: DemoState, channel: SendChannel | 'call'): boolean {
  const is = (id: string) => d.connections.some((x) => x.id === id && x.state === 'connected');
  return channel === 'email' ? is('gmail') || is('resend') : channel === 'text' ? is('sms') || is('dialpad') : is(CHANNEL_PROVIDER[channel]);
}

/* ---------- merge fields ---------- */

export const MERGE_FIELDS = ['client.first', 'client.name', 'company.name', 'company.phone', 'user.name', 'user.title', 'job.name', 'appointment.date', 'appointment.time'] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];
const ORG = /\b(family|familia|llc|inc|corp|co|group|grupo|company|properties|property|dental|plaza|hoa|association|restaurant|office|center|shop|store|cafe|coffee|club|management|realty|services?|builders|church|school)\b|[&0-9]/i;
const first = (name: string) => { const n = name.trim(); return ORG.test(n) ? n : n.split(/\s+/)[0] || n; };

/** What each merge field reads for this person, in the language of the message. A field with nothing to say is left out. */
export function mergeValues(d: DemoState, lang: Lang, c: Conversation | null, user: TeamUser | undefined, jobId?: string): Partial<Record<MergeField, string>> {
  const name = c?.client?.name ?? c?.lead?.name ?? '';
  const job = d.jobs.find((j) => j.id === jobId);
  const who = c?.client ? (a: { clientId?: string; leadId?: string }) => a.clientId === c.client!.id : c?.lead ? (a: { clientId?: string; leadId?: string }) => a.leadId === c.lead!.id : () => false;
  const next = d.appointments.filter((a) => who(a) && a.date >= today() && !a.status.startsWith('cancelled') && a.status !== 'no_show').sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
  const out: Partial<Record<MergeField, string>> = {
    'client.first': first(name), 'client.name': name, 'company.name': d.company.name, 'company.phone': d.company.phone,
    'user.name': user?.name, 'user.title': user?.title, 'job.name': job?.name,
    'appointment.date': next ? fmtDate(next.date, lang, { weekday: 'long', month: 'long', day: 'numeric' }) : undefined, 'appointment.time': next ? fmtTime(next.time, lang) : undefined,
  };
  for (const k of MERGE_FIELDS) if (!out[k]) delete out[k];
  return out;
}
/** Fills {{fields}}. A field with no value stays as written, so the person sees what is still missing before sending. */
export const fillMerge = (text: string, values: Partial<Record<string, string>>): string => text.replace(/\{\{\s*([a-z.]+)\s*\}\}/g, (m, k: string) => values[k] ?? m);
/** Lines made only of fields that had nothing to say are dropped (a signature without a job title). */
export const fillLines = (text: string, values: Partial<Record<string, string>>): string =>
  text.split('\n').map((line) => (/\{\{/.test(line) && fillMerge(line, values) === line && line.replace(/\{\{[^}]*\}\}/g, '').trim() === '' ? null : fillMerge(line, values))).filter((l) => l !== null).join('\n');
export const hasOpenFields = (text: string): boolean => /\{\{\s*[a-z.]+\s*\}\}/.test(text);

/* ---------- small helpers the screens share ---------- */

/** Files of this client that can be attached: uploaded or signed copies as they are, a generated document by reference. */
export type Attachment = FileRef & { /** A generated document: the server attaches its current PDF when it sends. */ docId?: string };
export function attachable(d: DemoState, c: Conversation): Attachment[] {
  if (!c.client) return [];
  return d.docs.filter((x) => x.clientId === c.client!.id && x.status !== 'void').map((x) => (x.file ? { ...x.file, docId: x.id } : { name: `${x.number} ${x.title}`.trim() + '.pdf', size: 0, mime: 'application/pdf', docId: x.id }));
}
/** "4 min", "1 h 5 min", "40 s". */
export function duration(seconds: number | undefined): string {
  if (!seconds) return '';
  if (seconds < 60) return `${seconds} s`;
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
/** One line for the conversation list. */
export const lineOf = (item: Message | CallNote | undefined): string => (!item ? '' : 'kind' in item ? item.text : (item.subject || item.body)).replace(/\s+/g, ' ').trim();
