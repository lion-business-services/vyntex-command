// GET /api/health: a small "is it up" answer for the deployment checklist and for uptime monitors.
// It says which integrations have their settings in place (yes or no only). It never returns a setting's value,
// never contacts the database or another service, and never shows a secret.
import { json, isSet } from './_lib/request.js';

export function GET() {
  return json(200, {
    ok: true,
    service: 'vyntex-platform',
    time: new Date().toISOString(),
    environment: process.env.VERCEL_ENV || 'local',
    commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
    configured: {
      database: isSet('SUPABASE_URL') && isSet('SUPABASE_SERVICE_ROLE_KEY'),
      demoRequestEmail: isSet('RESEND_API_KEY') && isSet('DEMO_REQUEST_TO'),
      assistant: isSet('ANTHROPIC_API_KEY'),
    },
  });
}

export function HEAD() {
  return new Response(null, { status: 200, headers: { 'cache-control': 'no-store' } });
}

const notAllowed = () => json(405, { ok: false, error: 'method_not_allowed' }, { allow: 'GET, HEAD' });
export const POST = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
