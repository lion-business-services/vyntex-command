// GET /api/health: a small "is it up" answer for the deployment checklist and for uptime monitors.
// It says which parts have their settings in place (yes or no only) and which deployment this is.
// It never returns a setting's value or its name, never shows a secret, and by default contacts nothing.
//
// GET /api/health?deep=1 with "Authorization: Bearer <CRON_SECRET>" also asks the database for the state of the job
// queue (how much is waiting, how much is stuck). Without that header the deep part is left out.
import { json, isSet } from './_lib/request.js';
import { deployId, runtimeEnv, problems, env } from './_lib/env.js';
import { sameString } from './_lib/crypto.js';
import { serviceRpc } from './_lib/supabase.js';

export async function GET(request) {
  const issues = problems();
  const body = {
    ok: true,
    service: 'vyntex-platform',
    deployment: deployId(),
    time: new Date().toISOString(),
    environment: process.env.VERCEL_ENV || runtimeEnv(),
    commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
    configured: {
      database: isSet('SUPABASE_URL') && isSet('SUPABASE_SERVICE_ROLE_KEY'),
      demoRequestEmail: isSet('RESEND_API_KEY') && isSet('DEMO_REQUEST_TO'),
      assistant: isSet('ANTHROPIC_API_KEY'),
      // sign-in and the live workspace: every core setting present, and no rule against mixing test and production broken
      workspace: issues.length === 0,
      sessions: isSet('SESSION_SECRET'),
      tokenSealing: isSet('TOKEN_ENC_KEY'),
      scheduledJobs: isSet('CRON_SECRET'),
      systemEmail: isSet('RESEND_API_KEY') && isSet('SYSTEM_EMAIL_FROM'),
    },
    // how many core settings are missing or wrong. Which ones is in the server log, not here.
    problems: issues.length,
  };
  const url = request ? new URL(request.url) : null;
  const secret = env('CRON_SECRET');
  if (url && url.searchParams.get('deep') === '1' && secret.length >= 16 && sameString(request.headers.get('authorization') || '', 'Bearer ' + secret)) {
    const stats = body.configured.database && isSet('SUPABASE_ANON_KEY') ? await serviceRpc('job_stats', {}) : { ok: false };
    body.database = { reachable: !!stats.ok };
    if (stats.ok) body.jobs = stats.data;
  }
  return json(200, body);
}

export function HEAD() {
  return new Response(null, { status: 200, headers: { 'cache-control': 'no-store' } });
}

const notAllowed = () => json(405, { ok: false, error: 'method_not_allowed' }, { allow: 'GET, HEAD' });
export const POST = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
