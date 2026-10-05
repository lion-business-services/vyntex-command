// VYNTEX AI: the model behind the assistant. One place that talks to the model provider (Anthropic's Messages API),
// so the assistant endpoint and any later feature send requests the same way and under the same rules:
//   redaction   anything shaped like a tax ID, a card number or a bank number is masked before the request leaves.
//               The model never receives those digits, whatever the caller put in the conversation or the data.
//   metering    the token counts the provider reports come back with every answer, for the caller to record.
//   failures    a time limit on every call, one more try when the provider answers with a server error or says it
//               is overloaded, and a code for everything else. The provider's own text is never passed on.
//   silence     nothing here writes a prompt, an answer or a key to a log.
// The assistant only ever proposes: what the model returns is text and tool calls for a person to confirm.
//
// Settings: ANTHROPIC_API_KEY, ASSISTANT_MODEL (the model id; the default below applies when it is not set),
//           AI_TIMEOUT_MS (optional).
// Not proven against the live service: no key exists in this build. Tested with mocked responses.
import { ProviderError } from '../oauth.js';

const API = 'https://api.anthropic.com/v1';
const API_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-haiku-4-5';
const MODEL_ID = /^[A-Za-z0-9._:@-]{1,100}$/;

export const modelId = (ctx) => (MODEL_ID.test(ctx.env('ASSISTANT_MODEL')) ? ctx.env('ASSISTANT_MODEL') : DEFAULT_MODEL);
const timeoutMs = (ctx) => (/^\d{4,6}$/.test(ctx.env('AI_TIMEOUT_MS')) ? Number(ctx.env('AI_TIMEOUT_MS')) : 25000);
const headers = (ctx, body) => ({ 'x-api-key': ctx.env('ANTHROPIC_API_KEY'), 'anthropic-version': API_VERSION, ...(body ? { 'content-type': 'application/json' } : {}) });

// ---------------------------------------------------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------------------------------------------------
const UUID_SPLIT = /([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/;
const MASK = { tax: '[tax ID removed]', card: '[card number removed]', bank: '[bank number removed]' };
const luhn = (digits) => { let sum = 0; let dbl = false; for (let i = digits.length - 1; i >= 0; i -= 1) { let d = digits.charCodeAt(i) - 48; if (dbl) { d *= 2; if (d > 9) d -= 9; } sum += d; dbl = !dbl; } return sum % 10 === 0; };
const RULES = [
  // Card numbers: 13 to 19 digits, written together or in groups, that pass the check digit every card number has.
  [/(?<![\w-])(?:\d{13,19}|\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{1,7}|\d{4}[ -]\d{6}[ -]\d{5})(?![\w-])/g, (m) => (luhn(m.replace(/\D/g, '')) ? 'card' : null)],
  // IBAN: two letters, two check digits, then the account.
  [/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g, (m) => (m.replace(/\s/g, '').length >= 15 && /\d{6}/.test(m.replace(/\s/g, '')) ? 'bank' : null)],
  // Social Security and ITIN numbers as people write them (123-45-6789, 123 45 6789), and EINs (12-3456789).
  [/(?<![\w-])\d{3}[- ]\d{2}[- ]\d{4}(?![\w-])/g, () => 'tax'],
  [/(?<![\w-])\d{2}-\d{7}(?![\w-])/g, () => 'tax'],
  // A number after a word that says what it is: SSN, EIN, ITIN, tax ID, account, routing, and the Spanish words.
  [/((?:\b(?:ssn|itin|ein|tin|tax ?id|social security(?: number)?|seguro social|n[uú]mero de identificaci[oó]n)\b)[^\d\n]{0,20})(\d[\d -]{6,14}\d)/gi, () => 'tax', 2],
  [/((?:\b(?:account|acct|routing|aba|iban|swift|checking|savings|bank|cuenta|ruta|clabe)\b)[^\d\n]{0,25})(\d[\d -]{4,20}\d)/gi, () => 'bank', 2],
  // Nine digits on their own are the shape of a Social Security number, an EIN and a bank routing number alike.
  [/(?<![\w.-])\d{9}(?![\w.-])/g, () => 'tax'],
  // Twelve or more digits in a row that are not a card: a bank account number is the likely thing.
  [/(?<![\w.-])\d{12,19}(?![\w.-])/g, () => 'bank'],
];

/** Masks one text. Returns { text, counts }. Record ids in the UUID form are left alone so the model can still name records. */
export function redactText(input, counts = { tax: 0, card: 0, bank: 0 }) {
  const parts = String(input).split(UUID_SPLIT);
  for (let i = 0; i < parts.length; i += 2) {
    let s = parts[i];
    for (const [re, kindOf, group] of RULES) {
      s = s.replace(re, (...a) => {
        const whole = a[0]; const target = group ? a[group] : whole;
        const kind = kindOf(target);
        if (!kind) return whole;
        counts[kind] += 1;
        return group ? a[1] + MASK[kind] : MASK[kind];
      });
    }
    parts[i] = s;
  }
  return { text: parts.join(''), counts };
}

/** Masks every string inside a value (the system text, each message, tool results, tool inputs). Keys are left as they are. */
export function redactDeep(value, counts = { tax: 0, card: 0, bank: 0 }, depth = 0) {
  if (typeof value === 'string') return redactText(value, counts).text;
  if (depth > 12 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, counts, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    // What a block is (its type, its ids, a tool's name) is structure, not content.
    out[k] = k === 'type' || k === 'id' || k === 'tool_use_id' || k === 'name' || k === 'role' || k === 'media_type' ? v : redactDeep(v, counts, depth + 1);
  }
  return out;
}

async function call(ctx, method, path, body) {
  let res;
  try {
    res = await ctx.fetch(API + path, { method, headers: headers(ctx, body), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs(ctx)) });
  } catch (e) {
    throw new ProviderError(e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'provider_timeout' : 'provider_unreachable');
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, ok: res.ok, data };
}

function failure(status) {
  if (status === 401) return new ProviderError('invalid_key', { reauth: true, status });
  if (status === 403) return new ProviderError('permission_denied', { status });
  if (status === 404) return new ProviderError('model_not_found', { status });
  if (status === 413) return new ProviderError('request_too_large', { status });
  if (status === 429) return new ProviderError('rate_limited', { status });
  if (status === 529) return new ProviderError('overloaded', { status });
  if (status === 400 || status === 422) return new ProviderError('request_rejected', { status });
  return new ProviderError('provider_error', { status });
}

const count = (n) => (Number.isFinite(Number(n)) && Number(n) >= 0 ? Number(n) : 0);

export default {
  id: 'ai',
  name: 'VYNTEX AI',
  kind: 'platform',
  env: ['ANTHROPIC_API_KEY'],
  scopes: [],
  approval: null,

  /**
   * The verified call behind "connected": asks the provider for the configured model. It proves the key works and
   * that this key may use this model, and it costs no tokens.
   */
  async status(ctx) {
    const model = modelId(ctx);
    const r = await call(ctx, 'GET', '/models/' + encodeURIComponent(model));
    if (r.ok && r.data && typeof r.data.id === 'string') return { ok: true, account: { label: String(r.data.display_name || r.data.id).slice(0, 120), ref: r.data.id.slice(0, 120) }, scopes: [] };
    if (r.ok) return { ok: false, reason: 'provider_error' };
    return { ok: false, reason: failure(r.status).code };
  },

  async health(ctx) {
    try { const s = await this.status(ctx); return s.ok ? { ok: true, health: 'ok' } : { ok: false, reason: s.reason, reauth: s.reason === 'invalid_key' }; } catch (e) {
      if (e instanceof ProviderError) return { ok: false, reason: e.code };
      throw e;
    }
  },

  authUrl() { throw new ProviderError('not_oauth'); },
  async exchange() { throw new ProviderError('not_oauth'); },
  async refresh(ctx, tokens) { return tokens; },
  async revoke() { /* the key belongs to the deployment: disconnecting only removes the row */ },
  async sync() { return { ok: true, skipped: 'nothing_to_sync' }; },

  actions: {
    /**
     * One request to the model. req: { system?, messages, tools?, toolChoice?, maxTokens?, temperature? }.
     * `tools` are passed through as given (name, description, input_schema). Everything else is masked first.
     * Returns { text, toolCalls: [{ id, name, input }], stopReason, model, usage: { inputTokens, outputTokens,
     * cacheReadTokens, cacheWriteTokens }, redactions: { tax, card, bank }, attempts }.
     */
    async complete(ctx, req) {
      if (!req || !Array.isArray(req.messages) || !req.messages.length) throw new ProviderError('request_rejected');
      const redactions = { tax: 0, card: 0, bank: 0 };
      const body = { model: modelId(ctx), max_tokens: Math.max(1, Math.min(8192, Math.round(Number(req.maxTokens) || 700))), messages: redactDeep(req.messages, redactions) };
      if (req.system) body.system = redactDeep(req.system, redactions);
      if (Array.isArray(req.tools) && req.tools.length) body.tools = req.tools;
      if (req.toolChoice) body.tool_choice = req.toolChoice;
      if (Number.isFinite(req.temperature)) body.temperature = Math.max(0, Math.min(1, req.temperature));
      const sleep = ctx.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
      let r; let attempts = 0;
      for (;;) {
        attempts += 1;
        r = await call(ctx, 'POST', '/messages', body);
        // One more try, and only for the failures that are the provider's own and likely to pass.
        if (r.ok || attempts >= 2 || !(r.status >= 500)) break;
        await sleep(600);
      }
      if (!r.ok) throw failure(r.status);
      const blocks = r.data && Array.isArray(r.data.content) ? r.data.content.filter((b) => b && typeof b === 'object') : null;
      if (!blocks) throw new ProviderError('provider_error');
      const u = (r.data && r.data.usage) || {};
      return {
        text: blocks.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').trim(),
        toolCalls: blocks.filter((b) => b.type === 'tool_use' && typeof b.name === 'string' && b.input && typeof b.input === 'object').map((b) => ({ id: String(b.id || ''), name: b.name, input: b.input })),
        stopReason: typeof r.data.stop_reason === 'string' ? r.data.stop_reason : '',
        model: typeof r.data.model === 'string' ? r.data.model : body.model,
        usage: { inputTokens: count(u.input_tokens), outputTokens: count(u.output_tokens), cacheReadTokens: count(u.cache_read_input_tokens), cacheWriteTokens: count(u.cache_creation_input_tokens) },
        redactions, attempts,
      };
    },
  },
};
