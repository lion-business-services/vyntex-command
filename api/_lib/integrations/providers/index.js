// The list of providers. One file per adapter, registered here by id.
//
// To add a provider: write providers/<id>.js with the adapter shape (docs/SERVER.md, "Writing an adapter"), import it
// below and add it to BUILT. Nothing else changes: the list, connect, callback, disconnect, sync, test, webhook and
// scheduled refresh all work from the adapter.
//
// Every provider of the data model has an adapter now. PLACEHOLDERS stays as the honest "not built yet" form for a
// provider added to the data model before its adapter exists: the Integrations screen shows it as not connected
// with the reason "not_built".
import { isTest } from '../../env.js';
import resend from './resend.js';
import gmail from './gmail.js';
import gcal from './gcal.js';
import gmeet from './gmeet.js';
import gbp from './gbp.js';
import gmaps from './gmaps.js';
import square from './square.js';
import quickbooks from './quickbooks.js';
import whatsapp from './whatsapp.js';
import meta from './meta.js';
import dialpad from './dialpad.js';
import sms from './sms.js';
import ai from './ai.js';

const BUILT = { gmail, resend, gcal, gmeet, gbp, gmaps, square, quickbooks, whatsapp, meta, dialpad, sms, ai };

const PLACEHOLDERS = [];

/** The order the Integrations screen lists providers in (ProviderId in src/domain/types.ts). */
const ORDER = ['gmail', 'resend', 'gcal', 'gmeet', 'gbp', 'gmaps', 'square', 'quickbooks', 'whatsapp', 'meta', 'dialpad', 'sms', 'ai'];

let mock = null;
/** The OAuth test provider exists only in a test run. It is never loaded, listed or reachable anywhere else. */
async function testAdapter() {
  if (!isTest()) return null;
  if (!mock) mock = (await import('./mock.js')).default;
  return mock;
}

/** The adapter for an id, or null when there is none (unknown id, placeholder, or the test provider outside a test run). */
export async function getAdapter(id) {
  if (Object.hasOwn(BUILT, id)) return { ...BUILT[id], built: true };
  if (id === 'mock') { const m = await testAdapter(); return m ? { ...m, built: true, approval: m.approval } : null; }
  return null;
}

/** Every provider, built or not, in screen order. */
export async function catalog() {
  const placeholders = new Map(PLACEHOLDERS.map((p) => [p.id, { ...p, built: false, scopes: [] }]));
  const list = ORDER.map((id) => (Object.hasOwn(BUILT, id) ? { ...BUILT[id], built: true } : placeholders.get(id))).filter(Boolean);
  const m = await testAdapter();
  if (m) list.push({ ...m, built: true, approval: m.approval });
  return list;
}

/** Ids that have an adapter with a webhook receiver. */
export async function webhookAdapter(id) {
  const a = await getAdapter(id);
  return a && a.webhook && typeof a.webhook.verify === 'function' ? a : null;
}

/** Every setting name any provider needs, for the environment checklist. */
export const providerEnvNames = () => [...new Set([
  ...Object.values(BUILT).flatMap((a) => [...(a.env || []), ...(a.approval?.flag ? [a.approval.flag] : [])]),
  ...PLACEHOLDERS.flatMap((p) => [...p.env, ...(p.approval ? [p.approval.flag] : [])]),
])];
