// Sample-data check: builds every industry's sample business in both languages and verifies it is consistent.
// Usage: node scripts/check-seeds.mjs [packId ...]
import { buildSync } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'vx-seed-')), 'seeds.mjs');
buildSync({
  stdin: { contents: `import { PACK_LIST } from '@/packs'; globalThis.__packs = PACK_LIST;`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', outfile: out, alias: { '@': path.join(root, 'src') }, loader: { '.json': 'json' }, logLevel: 'error', platform: 'node',
});
await import(pathToFileURL(out).href);
const only = process.argv.slice(2);
let bad = 0;
const fail = (m) => { bad++; console.error('  ✗ ' + m); };
const warn = (m) => console.warn('  ! ' + m);
for (const pack of globalThis.__packs) {
  if (only.length && !only.includes(pack.id)) continue;
  for (const lang of ['en', 'es']) {
    let s;
    try { s = pack.seed(lang); } catch (e) { console.log(`${pack.id} (${lang})`); fail(String(e.message || e)); continue; }
    const ids = (l) => new Set(l.map((x) => x.id));
    const c = ids(s.clients), w = ids(s.workers), j = ids(s.jobs), u = ids(s.users), types = new Set(pack.serviceTypes.map((t) => t.id));
    console.log(`${pack.id} (${lang}): ${s.leads.length} leads, ${s.clients.length} clients, ${s.jobs.length} jobs, ${s.tasks.length} tasks, ${s.workers.length} workers, ${s.workerPays.length} worker payments, ${s.docs.length} documents, ${s.activity.length} activity`);
    for (const [name, list] of Object.entries({ leads: s.leads, clients: s.clients, jobs: s.jobs, tasks: s.tasks, workers: s.workers, workerPays: s.workerPays, docs: s.docs })) if (ids(list).size !== list.length) fail(`duplicate ids in ${name}`);
    for (const l of s.leads) {
      if (!types.has(l.type)) fail(`lead ${l.id}: unknown service type "${l.type}"`);
      if (!u.has(l.ownerId)) fail(`lead ${l.id}: unknown owner`);
      if (l.clientId && !c.has(l.clientId)) fail(`lead ${l.id}: unknown client`);
      if (l.jobId && !j.has(l.jobId)) fail(`lead ${l.id}: unknown job`);
      if (l.status === 'won' && !l.jobId) warn(`lead ${l.id} is won but not linked to a job`);
    }
    for (const job of s.jobs) {
      if (!types.has(job.type)) fail(`job ${job.id}: unknown service type "${job.type}"`);
      if (!c.has(job.clientId)) fail(`job ${job.id}: unknown client`);
      if (!u.has(job.managerId)) fail(`job ${job.id}: unknown manager`);
      for (const a of job.assign) if (!w.has(a.workerId)) fail(`job ${job.id}: unknown worker ${a.workerId}`);
      for (const g of job.log) if (!w.has(g.workerId)) fail(`job ${job.id}: log by unknown worker ${g.workerId}`);
      const received = job.received.reduce((n, r) => n + r.amount, 0);
      const labor = job.assign.reduce((n, a) => n + a.price, 0), exp = job.expenses.reduce((n, e) => n + e.amount, 0);
      if (received > job.price + 0.005) fail(`job ${job.id}: received ${received} is more than the price ${job.price}`);
      if (labor + exp > job.price) warn(`job ${job.id}: costs ${labor + exp} exceed the price ${job.price} (loss)`);
      if (job.status === 'estimate' && received > 0) fail(`job ${job.id}: estimate with payments`);
      if (job.start && job.end && job.end < job.start) fail(`job ${job.id}: ends before it starts`);
      for (const a of job.assign) {
        const paid = s.workerPays.filter((p) => p.jobId === job.id && p.workerId === a.workerId).reduce((n, p) => n + p.amount, 0);
        const agreed = job.assign.filter((x) => x.workerId === a.workerId).reduce((n, x) => n + x.price, 0);
        if (paid > agreed + 0.005) fail(`job ${job.id}: worker ${a.workerId} paid ${paid}, agreed ${agreed}`);
      }
    }
    for (const p of s.workerPays) { if (!w.has(p.workerId)) fail(`worker payment ${p.id}: unknown worker`); if (p.jobId && !j.has(p.jobId)) fail(`worker payment ${p.id}: unknown job`); if (p.jobId && !s.jobs.find((x) => x.id === p.jobId).assign.some((a) => a.workerId === p.workerId)) fail(`worker payment ${p.id}: worker is not assigned to that job`); }
    for (const t of s.tasks) {
      if (t.jobId && !j.has(t.jobId)) fail(`task ${t.id}: unknown job`);
      const [kind, id] = t.assignee.split(':');
      if (kind === 'u' ? !u.has(id) : !w.has(id)) fail(`task ${t.id}: unknown assignee ${t.assignee}`);
    }
    const text = JSON.stringify(s);
    if (/[—–]/.test(text)) fail('sample text contains an em dash or en dash');
    for (const m of text.matchAll(/\b(\d{3})-(\d{3})-(\d{4})\b/g)) if (m[2] !== '555') fail(`phone ${m[0]} is not a 555 number`);
    for (const m of text.matchAll(/[A-Za-z0-9._-]+@([A-Za-z0-9.-]+)/g)) if (!/example\.(com|org|net)$/.test(m[1]) && !/sample/.test(m[1])) fail(`email domain ${m[1]} is not example.com`);
    const st = (k) => new Set(s[k].map((x) => x.status));
    for (const need of ['estimate', 'contract', 'progress', 'done']) if (!st('jobs').has(need)) warn(`no job in status ${need}`);
    for (const need of ['new', 'contacted', 'scheduled', 'sent', 'won', 'lost']) if (!st('leads').has(need)) warn(`no lead in stage ${need}`);
    for (const need of ['todo', 'doing', 'waiting', 'review', 'done']) if (!st('tasks').has(need)) warn(`no task in status ${need}`);
  }
  for (const k of ['kickoffTasks', 'closeoutTasks']) if (!pack[k].length) warn(`${pack.id}: ${k} is empty`);
}
if (bad) { console.error(`\n${bad} problem(s)`); process.exit(1); }
console.log('\nsample data check passed');
