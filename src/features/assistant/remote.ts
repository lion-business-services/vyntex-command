// Connected mode: the server function api/assistant.js talks to an AI model when one is set up for the workspace.
// The browser sends a compact summary of the business (only what an answer needs, see context.ts) and gets back text plus,
// at most, one proposed action, which goes through the same confirmation card as the built-in assistant. Nothing is executed on the server.
import { PREVIEW } from '@/app/router';
import { type Env, type Proposal } from './engine';
import { maskTaxIds } from './records';
import { buildContext, toProposal } from './context';
export { buildContext, toProposal } from './context';

const ENDPOINT = '/api/assistant';


/** Asks once, on page load, whether an AI model is connected. Any failure means "no": the page stays on the built-in assistant. */
export async function checkConfigured(): Promise<boolean> {
  if (PREVIEW) return false; // an embedded preview has no server behind it
  try {
    const res = await fetch(ENDPOINT, { method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('application/json')) return false;
    const body = await res.json();
    return body?.configured === true;
  } catch { return false; }
}

export interface Turn { role: 'user' | 'assistant'; content: string }
export interface ModelReply { text: string; proposal?: Proposal; /** Why the change the model asked for cannot be prepared. */ problem?: string }

/** One round trip to the server function. Returns null when the model could not answer, so the caller can fall back to the built-in assistant. */
export async function askModel(turns: Turn[], env: Env): Promise<ModelReply | null> {
  try {
    // a tax ID someone typed into the conversation is masked before the conversation leaves the browser
    const messages = turns.slice(-12).map((m) => ({ role: m.role, content: maskTaxIds(m.content).slice(0, 1900) }));
    while (messages.length && messages[0].role !== 'user') messages.shift();
    if (!messages.length) return null;
    // the server function answers in English or Spanish; any other interface language asks in English
    const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ lang: env.lang === 'es' ? 'es' : 'en', messages, context: buildContext(env) }) });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body || body.ok !== true || typeof body.text !== 'string') return null;
    const action = body.action;
    if (action && typeof action.tool === 'string' && action.input && typeof action.input === 'object') {
      const proposal = toProposal(action.tool, action.input as Record<string, unknown>, env);
      if (proposal && typeof proposal === 'object') return { text: maskTaxIds(body.text), proposal };
      return { text: maskTaxIds(body.text), problem: proposal ?? env.t('asst.model.badAction') };
    }
    return body.text.trim() ? { text: maskTaxIds(body.text) } : null;
  } catch { return null; }
}
