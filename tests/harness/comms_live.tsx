// A page for one test only (tests/qa_comms_live.py): the Integrations, Messages and Social screens running as a LIVE
// workspace against a stand-in for the server. There is no server and no provider behind it: the stand-in below answers
// the calls of the gateway contract (src/platform/gateway.ts) with the shapes docs/SERVER.md describes, so the test can see
// what the screens do with every state a real server can report. It is never part of a build of the product.
import '@/ui/styles.css';
import { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import '@/platform/live';   // the real gateway registers itself; the stand-in registered below takes its place for this page
import { registerGateway, type Outcome, type WorkspaceData, type WorkspaceGateway, type WorkspaceSession } from '@/platform/gateway';
import type { Connection, ProviderId } from '@/domain/types';
import { applyServer, boot, bootLive, getSnapshot } from '@/store/store';
import { Overlays } from '@/ui';
import IntegrationsPage from '@/features/integrations';
import MessagesPage from '@/features/messages';
import SocialPage from '@/features/social';

type Card = Connection & { reason?: string; missing?: string[]; approval?: { needed: boolean; note: string } | null; mode?: 'sandbox' | 'production' };
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
const START: Card[] = [
  { id: 'gmail', state: 'setup', reason: 'ready_to_connect' },
  { id: 'resend', state: 'connected', reason: 'verified', account: 'notices@harness.example.com', scopes: ['emails.send'], connectedAt: ago(5000), lastSyncAt: ago(12), by: 'u1' },
  { id: 'gcal', state: 'pending_approval', reason: 'provider_review', approval: { needed: true, note: 'The provider reviews and approves an app before it may be used with real accounts.' } },
  { id: 'gmeet', state: 'not_connected', reason: 'not_configured', missing: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] },
  { id: 'gbp', state: 'not_connected', reason: 'not_built' },
  { id: 'gmaps', state: 'not_connected', reason: 'not_built' },
  { id: 'square', state: 'connected', reason: 'verified', account: 'Harness Test Location', scopes: ['PAYMENTS_READ', 'PAYMENTS_WRITE'], connectedAt: ago(900), lastSyncAt: ago(3), mode: 'sandbox', by: 'u1' },
  { id: 'quickbooks', state: 'reauth', reason: 'token_expired', lastError: 'token_expired' },
  { id: 'whatsapp', state: 'attention', reason: 'health_failed', lastError: 'provider_unreachable', account: '609-555-0100' },
  { id: 'meta', state: 'error', reason: 'verify_failed', lastError: 'verify_failed' },
  { id: 'dialpad', state: 'not_connected', reason: 'made_up_code' },
  { id: 'sms', state: 'setup', reason: 'ready_to_connect' },
  { id: 'ai', state: 'connected', reason: 'verified', account: 'Model key held by the server' },
];
// what the stand-in "server" holds, kept across the reload that a return from the provider is
const KEY = 'harness.cards';
const cards = (): Card[] => { try { return JSON.parse(sessionStorage.getItem(KEY) || '') as Card[]; } catch { return START; } };
const keep = (list: Card[]) => sessionStorage.setItem(KEY, JSON.stringify(list));
const patch = (id: ProviderId, next: Partial<Card>) => keep(cards().map((c) => (c.id === id ? { id, ...next } as Card : c)));
const calls: string[] = [];
const log = (what: string) => { calls.push(what); (window as unknown as { __calls: string[] }).__calls = calls; };
let fresh = false;   // the identity check, good until the page is loaded again
const ok = <T,>(data: T): Outcome<T> => ({ ok: true, data, sample: false });
const no = <T,>(reason: string): Outcome<T> => ({ ok: false, reason, sample: false });
const none = <T extends object>(): T => new Proxy({}, { get: () => () => Promise.reject(new Error('not part of this test')) }) as T;

const standIn: WorkspaceGateway = {
  mode: 'workspace', sample: false,
  load: () => Promise.reject(new Error('not part of this test')),
  apply: async (ops) => ({ ok: true, applied: ops.length, rejected: [] }),
  protected: none(), compliance: null,
  auth: { ...none<WorkspaceGateway['auth']>(), async stepUp(input) { log('stepUp:' + (input.code ? 'code' : 'password')); if (input.password !== 'harness-pass') return no('invalid'); fresh = true; return ok({ until: new Date(Date.now() + 300000).toISOString() }); } },
  files: {
    async upload(file) { log('upload:' + file.type); return ok({ name: file.name, size: file.size, mime: file.type, path: 'harness/social/' + file.name }); },
    async url(ref) { log('url:' + ref.path); return ok('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'); },
  },
  integrations: {
    async list() { log('list'); const list = cards(); applyServer({ connections: list as unknown as { id: string }[] }); return list; },
    async connect(id) {
      log('connect:' + id);
      if (!fresh) return no('stepup_required');
      if (id === 'sms') { patch(id, { state: 'connected', reason: 'verified', account: '609-555-0111', connectedAt: ago(0) }); return ok({}); }
      // the provider's consent screen is skipped: the "server" verifies and sends the browser back, as its callback does
      patch(id, { state: 'connected', reason: 'verified', account: 'office@harness.example.com', scopes: ['gmail.send', 'gmail.readonly'], connectedAt: ago(0), by: 'u1' });
      return ok({ redirect: location.pathname + '?page=integrations&integration=' + id + '&result=connected' });
    },
    async disconnect(id) { log('disconnect:' + id); if (!fresh) return no('stepup_required'); patch(id, { state: 'setup', reason: 'ready_to_connect' }); return ok({ id, state: 'setup' }); },
    async sync(id) { log('sync:' + id); patch(id, { ...cards().find((c) => c.id === id), lastSyncAt: ago(0) }); return ok(cards().find((c) => c.id === id) as Connection); },
    async test(id) { log('test:' + id); return id === 'whatsapp' ? ok({ healthy: false, detail: 'provider_unreachable' }) : ok({ healthy: true, detail: 'ok' }); },
  },
};
registerGateway('live', standIn);

const who: WorkspaceSession = { mode: 'workspace', slug: 'harness', tenantId: '00000000-0000-4000-8000-000000000001', industry: 'practice', planId: '', role: (new URLSearchParams(location.search).get('role') as 'owner' | 'staff') || 'owner', actorId: 'u1', aal: 'aal1' };
const records = {
  company: { name: 'Harness Test Co', initials: 'HT', license: '', phone: '609-555-0100', email: 'office@harness.example.com' },
  users: [{ id: 'u1', name: 'Test Owner', role: who.role, email: 'owner@harness.example.com', active: true }],
  clients: [{ id: 'c1', name: 'Dana Example', phone: '609-555-0142', email: 'dana@example.com', addresses: [], since: '2025-01-01', notes: [], smsOptIn: true }],
  messages: [
    { id: 'm1', at: ago(60), channel: 'email', to: 'office@harness.example.com', from: 'dana@example.com', subject: 'Question', body: 'Can I come by on Friday?', status: 'received', dir: 'in', read: false, ref: { type: 'client', id: 'c1' }, clientId: 'c1', provider: 'gmail', externalId: 'x1', threadId: 'c:c1:email' },
    { id: 'm2', at: ago(50), channel: 'email', to: 'dana@example.com', subject: 'Re: Question', body: 'Yes, until 5.', status: 'delivered', ref: { type: 'client', id: 'c1' }, clientId: 'c1', by: 'u1', provider: 'resend', externalId: 'x2', threadId: 'c:c1:email' },
    { id: 'm3', at: ago(40), channel: 'text', to: '609-555-0142', subject: '', body: 'Reminder for Friday.', status: 'failed', error: 'The carrier refused the number.', ref: { type: 'client', id: 'c1' }, clientId: 'c1', by: 'u1', provider: 'sms', threadId: 'c:c1:text' },
  ],
  posts: [
    { id: 'p1', text: 'A post the server published', channels: ['gbp'], status: 'published', publishedAt: ago(600), by: 'u1', approvedBy: 'u1', created: ago(700) },
    { id: 'p2', text: 'A post the network refused', channels: ['facebook'], status: 'failed', error: 'The Page token was refused.', scheduledFor: ago(100), by: 'u1', approvedBy: 'u1', created: ago(200) },
  ],
} as unknown as WorkspaceData;

const page = new URLSearchParams(location.search).get('page') || 'integrations';
const ops: unknown[] = []; (window as unknown as { __ops: unknown[] }).__ops = ops;
document.documentElement.dataset.brand = 'vyntex'; document.documentElement.dataset.theme = 'dark';
void boot(false).then(() => {
  bootLive(records, who, async (sent) => { ops.push(...sent); return { ok: true, applied: sent.length, rejected: [] }; });
  // what the workspace shows as connected is what the "server" said, as in a real one
  applyServer({ connections: cards() as unknown as { id: string }[] });
  (window as unknown as { __data: () => unknown }).__data = () => getSnapshot().data;
  const Page = page === 'messages' ? MessagesPage : page === 'social' ? SocialPage : IntegrationsPage;
  createRoot(document.getElementById('root') as HTMLElement).render(<><main id="main" style={{ padding: 24, maxWidth: 1240, margin: '0 auto' }}><Suspense fallback={null}><Page /></Suspense></main><Overlays /></>);
});
