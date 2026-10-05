// /api/cron/<job>: scheduled work. Vercel Cron calls these addresses on the schedule in vercel.json and sends
// "Authorization: Bearer <CRON_SECRET>". Anything without that exact header is refused, so nobody on the internet
// can start a job.
//
//   tick    every few minutes: queue token refreshes that are due and the hourly security notice, then run due jobs
//           until the time budget is used
//   daily   once a day: queue housekeeping and a sync of every connected provider, then run
//
// The work itself is in the job queue (api/_lib/jobs.js): each job is locked, retried with a growing wait, and
// moved to a dead letter state after its last attempt. Calling a cron address twice at once is safe: two runners
// never get the same job.
import { entry, ok, fail, methodNotAllowed } from './_lib/respond.js';
import { env } from './_lib/env.js';
import { assertConfigured } from './_lib/guard.js';
import { sameString } from './_lib/crypto.js';
import { runDue } from './_lib/jobs.js';
import { onTick, onDaily } from './_lib/jobs/handlers.js';

function authorised(request) {
  const secret = env('CRON_SECRET');
  if (secret.length < 16) return false;
  const header = request.headers.get('authorization') || '';
  return sameString(header, 'Bearer ' + secret);
}

const handle = entry('cron', async (request, path) => {
  if (request.method !== 'GET' && request.method !== 'POST') return methodNotAllowed('GET, POST');
  // Checked before anything else, and answered the same way for every address: no hint about which jobs exist.
  if (!authorised(request)) return fail(401, 'unauthorised');
  assertConfigured();
  if (path === 'tick') {
    const queued = await onTick();
    const ran = await runDue({ max: 25, budgetMs: 20000 });
    return ok({ job: 'tick', ...queued, ...ran });
  }
  if (path === 'daily') {
    const queued = await onDaily();
    const ran = await runDue({ max: 50, budgetMs: 40000 });
    return ok({ job: 'daily', ...queued, ...ran });
  }
  return fail(404, 'not_found');
});

export const GET = handle;
export const POST = handle;
