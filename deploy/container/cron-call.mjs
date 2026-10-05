// Makes one scheduled call, the way Vercel Cron does on Vercel: GET /api/cron/<job> with the cron secret.
// A container platform has no Vercel Cron, so its own scheduler runs this file on the schedule written in
// vercel.json ("crons"). deploy/k8s/base/cronjobs.yaml is the Kubernetes form.
//
//   node deploy/container/cron-call.mjs tick
//   node deploy/container/cron-call.mjs daily
//
// Settings (environment variables):
//   CRON_SECRET   the same value the application has. Sent as "Authorization: Bearer <value>". Never printed.
//   CRON_TARGET   where the application listens inside the cluster         default http://command
//
// Exit code: 0 the application answered 200. Anything else: 1, so the scheduler records a failed run.
const job = process.argv[2] || '';
if (!/^[a-z][a-z0-9-]{0,30}$/.test(job)) { console.error('usage: node deploy/container/cron-call.mjs <job>   (tick or daily)'); process.exit(1); }
const secret = process.env.CRON_SECRET || '';
if (secret.length < 16) { console.error('CRON_SECRET is not set'); process.exit(1); }
const target = (process.env.CRON_TARGET || 'http://command').replace(/\/+$/, '');
const started = Date.now();
try {
  const r = await fetch(`${target}/api/cron/${job}`, { headers: { authorization: 'Bearer ' + secret }, signal: AbortSignal.timeout(90_000) });
  await r.arrayBuffer();
  console.log(JSON.stringify({ t: new Date().toISOString(), job, status: r.status, ms: Date.now() - started }));
  process.exit(r.status === 200 ? 0 : 1);
} catch (e) {
  console.log(JSON.stringify({ t: new Date().toISOString(), job, status: 0, error: e?.name || 'Error', ms: Date.now() - started }));
  process.exit(1);
}
