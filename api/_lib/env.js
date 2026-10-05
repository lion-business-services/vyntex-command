// Environment variables, in one place.
// Every server file reads its settings through here, so there is one list of what a deployment needs, one set of
// parsing rules, and one promise: a value is never logged and never put in an answer. Only names are.
//
// VYNTEX Command and LBS Command are separate Vercel projects with separate values for everything below, and
// separate Supabase projects behind them. Nothing here is shared between the two.

/** What each variable is for. `need`: 'core' = the workspace cannot run without it, 'feature' = one feature stays off, 'optional'. */
export const VARIABLES = {
  VX_DEPLOY: { need: 'core', secret: false, about: 'Which deployment this is: vyntex or lbs.' },
  VX_ENV: { need: 'optional', secret: false, about: 'local, development, preview, staging, production or test. Defaults from VERCEL_ENV.' },
  APP_ORIGIN: { need: 'core', secret: false, about: 'The one public address of this deployment, for example https://command.vyntexusa.com. Used for the same-origin check and for links in emails.' },
  SUPABASE_URL: { need: 'core', secret: false, about: 'Project address of this deployment\'s own Supabase project.' },
  SUPABASE_ANON_KEY: { need: 'core', secret: false, about: 'Public key of that project. Sent as the api key with every call made on a person\'s behalf.' },
  SUPABASE_SERVICE_ROLE_KEY: { need: 'core', secret: true, about: 'Server key of that project. Bypasses row level security. Used only where a person\'s token cannot do the job.' },
  SESSION_SECRET: { need: 'core', secret: true, about: '32 or more random characters. Seals the session cookie.' },
  SESSION_SECRET_PREVIOUS: { need: 'optional', secret: true, about: 'The secret used before the last change, so open sessions survive a rotation. Remove after a day.' },
  SESSION_MAX_HOURS: { need: 'optional', secret: false, about: 'Longest life of a session whatever the activity. Default 12.' },
  TOKEN_ENC_KEY: { need: 'core', secret: true, about: '32 random bytes, base64. Seals provider tokens before they are stored.' },
  TOKEN_ENC_KEY_PREVIOUS: { need: 'optional', secret: true, about: 'The key used before the last change. Kept until every stored token was sealed again.' },
  IP_HASH_SALT: { need: 'core', secret: true, about: '32 or more random characters. Turns a network address into a keyed hash for rate limits and the audit trail.' },
  CRON_SECRET: { need: 'core', secret: true, about: 'Random value Vercel sends with scheduled calls to /api/cron/*.' },
  RESEND_API_KEY: { need: 'feature', secret: true, about: 'System email (invitations, password resets, notices) and the demo request form.' },
  RESEND_WEBHOOK_SECRET: { need: 'feature', secret: true, about: 'Signing secret of the Resend webhook (starts with whsec_).' },
  SYSTEM_EMAIL_FROM: { need: 'feature', secret: false, about: 'Sender of system email, on a domain verified in Resend.' },
  DEMO_REQUEST_TO: { need: 'feature', secret: false, about: 'Where demo requests are sent (vyntex only).' },
  DEMO_REQUEST_FROM: { need: 'feature', secret: false, about: 'Sender of the demo request email (vyntex only).' },
  ANTHROPIC_API_KEY: { need: 'feature', secret: true, about: 'Assistant, connected mode.' },
  ASSISTANT_MODEL: { need: 'optional', secret: false, about: 'Model id for the assistant.' },
  AI_TIMEOUT_MS: { need: 'optional', secret: false, about: 'Time limit of one model call in milliseconds. Default 25000.' },
  // Providers. `provider` names the adapter in api/_lib/integrations/providers that reads the setting. None of these
  // is needed to sign in or to use the workspace: a provider whose settings are missing shows as "not configured".
  // Google: Gmail, Calendar, Meet, Business Profile (docs/integrations/google.md)
  GOOGLE_CLIENT_ID: { need: 'feature', secret: false, provider: 'google', about: 'OAuth client of this deployment\'s Google Cloud project (Gmail, Calendar, Meet, Business Profile).' },
  GOOGLE_CLIENT_SECRET: { need: 'feature', secret: true, provider: 'google', about: 'The secret of that OAuth client.' },
  GOOGLE_GMAIL_APPROVED: { need: 'feature', secret: false, provider: 'google', about: 'true once Google verified the app for the Gmail scopes. Until then Gmail shows "pending approval".' },
  GOOGLE_CALENDAR_APPROVED: { need: 'feature', secret: false, provider: 'google', about: 'true once Google verified the app for the Calendar scope. Also unlocks Meet.' },
  GOOGLE_GBP_APPROVED: { need: 'feature', secret: false, provider: 'google', about: 'true once Google granted this project access to the Business Profile APIs.' },
  GOOGLE_ALLOWED_DOMAINS: { need: 'optional', secret: false, provider: 'google', about: 'Optional. Comma separated domains: only Google accounts in them may be connected.' },
  GOOGLE_PUBSUB_TOPIC: { need: 'optional', secret: false, provider: 'google', about: 'Optional. projects/<id>/topics/<name>, where Gmail publishes change notices. Without it the mailbox is polled.' },
  GOOGLE_PUBSUB_AUDIENCE: { need: 'optional', secret: false, provider: 'google', about: 'Audience set on the Pub/Sub push subscription (the Gmail webhook address). Without it Gmail notices are refused.' },
  GOOGLE_PUBSUB_SERVICE_ACCOUNT: { need: 'optional', secret: false, provider: 'google', about: 'Email of the service account the push subscription signs with. Without it Gmail notices are refused.' },
  GOOGLE_PUBSUB_SUBSCRIPTION: { need: 'optional', secret: false, provider: 'google', about: 'Optional. Full name of the subscription: when set, notices from any other are refused.' },
  GOOGLE_CHANNEL_SECRET: { need: 'optional', secret: true, provider: 'google', about: '32 or more random characters. Signs the token of Calendar watch channels. Without it the calendar is polled and notices are refused.' },
  GOOGLE_CALENDAR_NAME: { need: 'optional', secret: false, provider: 'google', about: 'Optional. Name of the calendar created in the connected account. Default: the product name of the deployment.' },
  // Google Maps (docs/integrations/google.md)
  GOOGLE_MAPS_API_KEY: { need: 'feature', secret: true, provider: 'gmaps', about: 'Server-side key restricted to the Geocoding API.' },
  GOOGLE_MAPS_DAILY_CAP: { need: 'optional', secret: false, provider: 'gmaps', about: 'Optional. Geocoding requests per company per day. Default 200.' },
  // Square (docs/integrations/square-quickbooks.md). Start in sandbox.
  SQUARE_APPLICATION_ID: { need: 'feature', secret: false, provider: 'square', about: 'The Square application id (the sandbox one starts with sandbox-).' },
  SQUARE_APPLICATION_SECRET: { need: 'feature', secret: true, provider: 'square', about: 'The application secret: the code exchange, the refresh and the revoke call.' },
  SQUARE_ENVIRONMENT: { need: 'feature', secret: false, provider: 'square', about: 'sandbox or production. No default: any other value stops every Square call.' },
  SQUARE_WEBHOOK_SIGNATURE_KEY: { need: 'feature', secret: true, provider: 'square', about: 'The signature key of the webhook subscription.' },
  SQUARE_WEBHOOK_URL: { need: 'optional', secret: false, provider: 'square', about: 'Optional. The notification address exactly as registered at Square, when it is not APP_ORIGIN + /api/webhooks/square.' },
  SQUARE_OAUTH_FLOW: { need: 'optional', secret: false, provider: 'square', about: 'Optional. code (default, the exchange is authenticated with the secret) or pkce.' },
  SQUARE_API_VERSION: { need: 'optional', secret: false, provider: 'square', about: 'Optional. The Square-Version date sent with every call. The default is set in the adapter.' },
  SQUARE_EXPECTED_MERCHANT_ID: { need: 'optional', secret: false, provider: 'square', about: 'Optional. A deployment that serves one company can name the only Square merchant it accepts.' },
  // QuickBooks Online (docs/integrations/square-quickbooks.md). Start in sandbox.
  QUICKBOOKS_CLIENT_ID: { need: 'feature', secret: false, provider: 'quickbooks', about: 'The Intuit app\'s client id (development or production keys).' },
  QUICKBOOKS_CLIENT_SECRET: { need: 'feature', secret: true, provider: 'quickbooks', about: 'The client secret.' },
  QUICKBOOKS_ENVIRONMENT: { need: 'feature', secret: false, provider: 'quickbooks', about: 'sandbox or production. No default.' },
  QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN: { need: 'feature', secret: true, provider: 'quickbooks', about: 'The verifier token of the app\'s webhooks.' },
  QUICKBOOKS_APPROVED: { need: 'feature', secret: false, provider: 'quickbooks', about: 'true once the app may be used with the keys in place. Until then nobody can connect.' },
  QUICKBOOKS_MINOR_VERSION: { need: 'optional', secret: false, provider: 'quickbooks', about: 'Optional. The minorversion sent with every call. The default is set in the adapter.' },
  // Meta: Facebook Pages and Instagram (docs/integrations/messaging.md)
  META_APP_ID: { need: 'feature', secret: false, provider: 'meta', about: 'Meta app id.' },
  META_APP_SECRET: { need: 'feature', secret: true, provider: 'meta', about: 'Meta app secret: the token exchange, and the signature of Meta and WhatsApp webhooks.' },
  META_WEBHOOK_VERIFY_TOKEN: { need: 'feature', secret: true, provider: 'meta', about: 'The value typed into Meta\'s webhook form for Page and Instagram.' },
  META_APPROVED: { need: 'feature', secret: false, provider: 'meta', about: 'true once App Review and Business Verification are done.' },
  META_LOGIN_CONFIG_ID: { need: 'optional', secret: false, provider: 'meta', about: 'Optional. Facebook Login for Business configuration id.' },
  META_GRAPH_VERSION: { need: 'optional', secret: false, provider: 'meta', about: 'Optional. Graph API version. The default is set in the adapter.' },
  META_WEBHOOK_MAX_AGE_S: { need: 'optional', secret: false, provider: 'meta', about: 'Optional. Oldest accepted Meta webhook body, in seconds. Default 129600.' },
  // WhatsApp Business (docs/integrations/messaging.md)
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: { need: 'feature', secret: true, provider: 'whatsapp', about: 'The value typed into the WhatsApp webhook form.' },
  WHATSAPP_SYSTEM_USER_TOKEN: { need: 'feature', secret: true, provider: 'whatsapp', about: 'Token of the system user.' },
  WHATSAPP_PHONE_NUMBER_ID: { need: 'feature', secret: false, provider: 'whatsapp', about: 'The number messages are sent from.' },
  WHATSAPP_BUSINESS_ACCOUNT_ID: { need: 'feature', secret: false, provider: 'whatsapp', about: 'The WhatsApp Business account that owns the number and the templates.' },
  WHATSAPP_APPROVED: { need: 'feature', secret: false, provider: 'whatsapp', about: 'true once the business is verified and the number is live.' },
  WHATSAPP_WEBHOOK_MAX_AGE_S: { need: 'optional', secret: false, provider: 'whatsapp', about: 'Optional. Oldest accepted WhatsApp webhook body, in seconds. Default 604800.' },
  // Dialpad (docs/integrations/messaging.md)
  DIALPAD_AUTH_MODE: { need: 'optional', secret: false, provider: 'dialpad', about: 'oauth (default) or api_key.' },
  DIALPAD_CLIENT_ID: { need: 'feature', secret: false, provider: 'dialpad', about: 'OAuth mode: the client id.' },
  DIALPAD_CLIENT_SECRET: { need: 'feature', secret: true, provider: 'dialpad', about: 'OAuth mode: the client secret.' },
  DIALPAD_API_KEY: { need: 'feature', secret: true, provider: 'dialpad', about: 'API key mode: the key.' },
  DIALPAD_WEBHOOK_SECRET: { need: 'feature', secret: true, provider: 'dialpad', about: 'The value each company\'s webhook secret is made from.' },
  DIALPAD_APPROVED: { need: 'feature', secret: false, provider: 'dialpad', about: 'OAuth mode: true once Dialpad approved the app.' },
  DIALPAD_ENVIRONMENT: { need: 'optional', secret: false, provider: 'dialpad', about: 'Optional. sandbox to use sandbox.dialpad.com.' },
  DIALPAD_SMS_ENABLED: { need: 'optional', secret: false, provider: 'dialpad', about: 'Optional. true to ask for text events and the text content scope.' },
  DIALPAD_WEBHOOK_MAX_AGE_S: { need: 'optional', secret: false, provider: 'dialpad', about: 'Optional. Oldest accepted Dialpad event, in seconds. Default 300.' },
  // Text messages (docs/integrations/messaging.md)
  SMS_PROVIDER: { need: 'feature', secret: false, provider: 'sms', about: 'twilio or dialpad: which carrier sends text messages.' },
  SMS_FROM_NUMBER: { need: 'feature', secret: false, provider: 'sms', about: 'The sending number, in E.164 form.' },
  SMS_APPROVED: { need: 'feature', secret: false, provider: 'sms', about: 'true once the sender registration is approved.' },
  TWILIO_ACCOUNT_SID: { need: 'feature', secret: false, provider: 'sms', about: 'Twilio account id (when SMS_PROVIDER is twilio).' },
  TWILIO_AUTH_TOKEN: { need: 'feature', secret: true, provider: 'sms', about: 'Twilio auth token: API calls and the webhook signature.' },
  TWILIO_MESSAGING_SERVICE_SID: { need: 'optional', secret: false, provider: 'sms', about: 'Optional. Send through a messaging service instead of one number.' },
};

const DEV_SECRETS = new Set(['local-dev-session-secret-0123456789abcdef', 'changeme', 'secret']);

/** The trimmed value, or '' when it is not set. */
export function env(name) {
  const v = process.env[name];
  return typeof v === 'string' ? v.trim() : '';
}
export const has = (name) => env(name).length > 0;

export class ConfigError extends Error {
  /** `name` is the variable that is missing or wrong. The message never contains a value. */
  constructor(name, why = 'missing') {
    super(`configuration: ${name} ${why}`);
    this.code = 'not_configured';
    this.variable = name;
  }
}

export function need(name) {
  const v = env(name);
  if (!v) throw new ConfigError(name);
  return v;
}

export function envInt(name, fallback, min, max) {
  const v = env(name);
  if (!/^\d{1,9}$/.test(v)) return fallback;
  return Math.max(min, Math.min(max, Number(v)));
}

export function envBool(name) {
  return /^(1|true|yes|on)$/i.test(env(name));
}

/** A base64 (or base64url) value that must decode to exactly `bytes` bytes. */
export function envKey(name, bytes = 32) {
  const raw = need(name);
  const buf = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (buf.length !== bytes) throw new ConfigError(name, `must be ${bytes} bytes, base64 encoded`);
  return buf;
}

export function deployId() {
  return env('VX_DEPLOY') === 'lbs' ? 'lbs' : 'vyntex';
}

/** Which kind of environment this is. An explicit VX_ENV wins; otherwise Vercel's own word; otherwise local. */
export function runtimeEnv() {
  const explicit = env('VX_ENV').toLowerCase();
  if (['local', 'development', 'preview', 'staging', 'production', 'test'].includes(explicit)) return explicit;
  const vercel = env('VERCEL_ENV').toLowerCase();
  if (vercel === 'production' || vercel === 'preview' || vercel === 'development') return vercel;
  return 'local';
}
export const isProduction = () => runtimeEnv() === 'production' || env('VERCEL_ENV') === 'production';
export const isTest = () => runtimeEnv() === 'test' && env('VERCEL_ENV') !== 'production';
/** Cookies carry Secure (and the __Host- prefix) everywhere except a local or test run over plain http. */
export const secureCookies = () => !['local', 'test'].includes(runtimeEnv());

/** The public address of this deployment, without a trailing slash. In production it must be set; locally it is derived. */
export function appOrigin(request) {
  const fixed = env('APP_ORIGIN').replace(/\/+$/, '');
  if (fixed) return fixed;
  if (isProduction()) throw new ConfigError('APP_ORIGIN');
  if (!request) return 'http://localhost';
  const host = (request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost').split(',')[0].trim();
  const proto = (request.headers.get('x-forwarded-proto') || new URL(request.url).protocol.replace(':', '')).split(',')[0].trim();
  return `${proto}://${host}`;
}

/** Which listed variables are set (yes or no only), for the deployment checklist and the health answer. */
export function checklist(extraNames = []) {
  const names = [...Object.keys(VARIABLES), ...extraNames.filter((n) => !(n in VARIABLES))];
  return names.map((name) => ({ name, set: has(name), need: VARIABLES[name]?.need || 'feature', secret: VARIABLES[name]?.secret ?? true }));
}

/**
 * Things that must never be true in production. "No development key should silently become production":
 * a production deployment that carries a test flag, a local database address, a weak or sample secret, or two
 * secrets with the same value refuses to serve the workspace and says which rule was broken (by code, not by value).
 */
export function problems() {
  const out = [];
  const prod = isProduction();
  for (const [name, spec] of Object.entries(VARIABLES)) if (spec.need === 'core' && !has(name)) out.push(`missing:${name}`);
  if (has('SESSION_SECRET') && env('SESSION_SECRET').length < 32) out.push('weak:SESSION_SECRET');
  if (has('IP_HASH_SALT') && env('IP_HASH_SALT').length < 16) out.push('weak:IP_HASH_SALT');
  if (has('TOKEN_ENC_KEY')) { try { envKey('TOKEN_ENC_KEY'); } catch { out.push('invalid:TOKEN_ENC_KEY'); } }
  if (has('VX_DEPLOY') && !['vyntex', 'lbs'].includes(env('VX_DEPLOY'))) out.push('invalid:VX_DEPLOY');
  if (prod) {
    if (env('VX_ENV') && env('VX_ENV').toLowerCase() !== 'production') out.push('mismatch:VX_ENV');
    if (/localhost|127\.0\.0\.1|^http:/i.test(env('SUPABASE_URL'))) out.push('unsafe:SUPABASE_URL');
    if (has('APP_ORIGIN') && !/^https:\/\//i.test(env('APP_ORIGIN'))) out.push('unsafe:APP_ORIGIN');
    if (DEV_SECRETS.has(env('SESSION_SECRET'))) out.push('sample:SESSION_SECRET');
    if (has('SESSION_SECRET') && env('SESSION_SECRET') === env('IP_HASH_SALT')) out.push('reused:SESSION_SECRET');
    if (has('SESSION_SECRET') && env('SESSION_SECRET') === env('CRON_SECRET')) out.push('reused:CRON_SECRET');
    if (has('MOCK_OAUTH_BASE')) out.push('unsafe:MOCK_OAUTH_BASE');
  }
  return out;
}

/** True when sign-in and the workspace can run. Feature variables do not count. */
export const coreReady = () => problems().length === 0;

/**
 * Every secret value currently set, for the test that greps answers and logs for leaks. Only used by tests.
 * Short values are left out: a three-letter value would match by accident.
 */
export function secretValuesForTests() {
  if (!isTest()) return [];
  return Object.keys(process.env)
    .filter((k) => /(SECRET|KEY|SALT|TOKEN|PASSWORD)/.test(k) && !/ANON_KEY$/.test(k))
    .map((k) => env(k)).filter((v) => v.length >= 12);
}
