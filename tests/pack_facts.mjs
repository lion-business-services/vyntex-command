// Writes tests/.pack-facts.json: per edition, the product, sample company, whether it is priced, its screens and stages, and which
// BUILD words the pack itself legitimately uses.
import { buildSync } from 'esbuild'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'vx-facts-')), 'f.mjs');
buildSync({ stdin: { contents: `import { PACK_LIST } from '@/packs'; import { loadAllSeeds, seedOf } from '@/packs/seeds'; globalThis.__seeds = { loadAllSeeds, seedOf }; import { makeT } from '@/i18n'; import { plansFor } from '@/lib/pricing'; globalThis.__f = { PACK_LIST, makeT, plansFor };`, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', outfile: out, alias: { '@': path.join(root, 'src') }, loader: { '.json': 'json' }, logLevel: 'error', platform: 'node', define: { __VX_DEPLOY__: '"vyntex"', __VX_SAMPLE_PREVIEW__: 'false' } });
await import(pathToFileURL(out).href);
await globalThis.__seeds.loadAllSeeds();
const { PACK_LIST, makeT, plansFor } = globalThis.__f;
const BANNED = { en: ['project', 'subcontractor', 'contract'], es: ['proyecto', 'subcontratista', 'contrato'] };
const facts = PACK_LIST.map((p) => {
  const o = { id: p.id, product: p.product, company: p.sampleCompany.name, recurring: p.recurring, kpis: p.kpis, family: p.family, priced: p.priced, usesWorkers: p.usesWorkers, compliance: p.compliance,
    modules: p.modules, stages: p.leadStages.map((s) => ({ id: s.id, kind: s.kind, role: s.role ?? null })), plans: plansFor(p.id).map((x) => ({ id: x.id, name: x.name, nameEs: x.nameEs, monthly: x.monthly, yearly: x.yearly, setup: x.setup })), allowed: {}, words: {} };
  for (const lang of ['en', 'es']) {
    const t = makeT(lang, p);
    const texts = [];
    const walk = (v) => { if (typeof v === 'string') texts.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
    walk([Object.values(p.terms[lang]), p.serviceTypes.map((s) => s[lang]), Object.values(p.agreement[lang]), globalThis.__seeds.seedOf(p.id)(lang), p.kickoffTasks.map((x) => x[lang]), p.closeoutTasks.map((x) => x[lang]), p.blurb[lang]]);
    const own = texts.filter((x) => !/^(project|contract|milestone|progress)$/.test(x)).join(' \n ').toLowerCase();
    o.allowed[lang] = BANNED[lang].filter((w) => new RegExp(`(?<![\\p{L}])${w}(s|es)?(?![\\p{L}])`, 'u').test(own));
    o.where = o.where || {}; o.where[lang] = Object.fromEntries(o.allowed[lang].map((w) => [w, (own.match(new RegExp(`.{0,40}(?<![\\p{L}])${w}(s|es)?(?![\\p{L}]).{0,30}`, 'u')) || [''])[0].replace(/\n/g, ' ')]));
    o.words[lang] = { job: t('project'), jobs: t('projects'), worker: t('sub'), team: t('subs'), client: t('client'), dashboard: t('nav.dashboard'), leads: t('nav.leads') };
  }
  return o;
});
fs.writeFileSync(path.join(root, 'tests/.pack-facts.json'), JSON.stringify(facts, null, 1));
for (const f of facts) console.log(f.id.padEnd(10), 'allowed en:', f.allowed.en.join(',') || '-', '| es:', f.allowed.es.join(',') || '-');
