// Guards the commercial source of truth: every plan-based capability in src/domain/entitlements.ts must quote a line
// that exists in config/vyntex-build-pricing.json for that plan, and no price may be typed anywhere in src/.
// An edition may be missing from the pricing file only when its pack says so (`priced: false`): then it shows no plan and no
// price anywhere and is quoted on request. A pack that says it is priced must be in the file, and the other way round.
import { buildSync } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pricing = JSON.parse(fs.readFileSync(path.join(root, 'config/vyntex-build-pricing.json'), 'utf8'));
const ent = fs.readFileSync(path.join(root, 'src/domain/entitlements.ts'), 'utf8');
let bad = 0;
for (const m of ent.matchAll(/(\w+): \{ kind: 'plan', tier: (\d), source: '((?:[^'\\]|\\.)*)' \}/g)) {
  const [, id, tier, source] = m; const plan = pricing.plans[Number(tier)];
  if (!plan.features.includes(source)) { console.error(`✗ ${id}: "${source}" is not a feature of ${plan.name}`); bad++; }
}
for (const m of ent.matchAll(/addOnId: '([^']+)'/g)) if (!pricing.add_ons.some((a) => a.id === m[1])) { console.error(`✗ add-on "${m[1]}" is not in the pricing file`); bad++; }
// plan prices must not be typed in source files
const prices = new Set(pricing.plans.flatMap((p) => [p.monthly_usd, p.yearly_usd, p.setup_usd]).map(String));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const f of walk(path.join(root, 'src')).filter((f) => /\.(tsx?|css)$/.test(f) && !/packs\/|entitlements\.ts|pricing-copy\.ts/.test(f))) {
  const text = fs.readFileSync(f, 'utf8');
  for (const m of text.matchAll(/\$\s?(\d{2,4})(?![\d,.])/g)) if (prices.has(m[1])) { console.error(`✗ ${path.relative(root, f)}: plan price "$${m[1]}" is typed in the file; read it from lib/pricing.ts`); bad++; }
}

// every line of the pricing file must have customer wording in src/lib/pricing-copy.ts, quoted exactly
const copy = fs.readFileSync(path.join(root, 'src/lib/pricing-copy.ts'), 'utf8');
const quoted = new Set([...copy.matchAll(/source: (?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)].map((m) => (m[1] ?? m[2]).replace(/\\'/g, "'")));
const lines = [...pricing.plans.flatMap((p) => [...p.features, p.support]), ...pricing.add_ons.map((a) => a.name), ...pricing.rules];
for (const l of lines) if (!quoted.has(l)) { console.error(`✗ pricing file line has no wording in pricing-copy.ts: "${l}"`); bad++; }
for (const q of quoted) if (!lines.includes(q)) { console.error(`✗ pricing-copy.ts quotes a line that is not in the pricing file: "${q}"`); bad++; }
for (const m of copy.matchAll(/id: '([^']+)', source:/g)) if (!pricing.add_ons.some((a) => a.id === m[1])) { console.error(`✗ pricing-copy.ts: unknown add-on id "${m[1]}"`); bad++; }
// amounts written inside feature lines must match the add-on prices they refer to
const price = (id) => pricing.add_ons.find((a) => a.id === id)?.price_usd;
for (const f of pricing.plans.flatMap((p) => p.features)) {
  if (/1099 preparation/.test(f) && !f.includes('$' + price('1099_prep'))) { console.error(`✗ feature "${f}" does not match the 1099_prep add-on price`); bad++; }
  if (/1099 e-file/.test(f) && !f.includes('$' + price('1099_efile_mail'))) { console.error(`✗ feature "${f}" does not match the 1099_efile_mail add-on price`); bad++; }
}
// the other editions must mirror the base plans, as the pricing file states
for (const o of pricing.other_industries.plans) {
  const twin = pricing.plans.find((p) => p.id === o.same_features_as);
  if (!twin) { console.error(`✗ ${o.id}: same_features_as "${o.same_features_as}" does not exist`); bad++; continue; }
  for (const k of ['monthly_usd', 'yearly_usd', 'setup_usd']) if (o[k] !== twin[k]) { console.error(`! notice: ${o.name} ${k} (${o[k]}) differs from ${twin.name} (${twin[k]})`); }
}

// welcome-credit conditions are worded on the pricing page; every condition in the pricing file must be quoted there exactly
const pricingPage = fs.readFileSync(path.join(root, 'src/features/marketing/pricing.tsx'), 'utf8');
for (const p of pricing.plans) for (const k of ['applies_to', 'excludes', 'yearly_plan_condition']) {
  const line = p.welcome_credit?.[k];
  if (line && !pricingPage.includes(line.replace(/'/g, "\\'")) && !pricingPage.includes(line)) { console.error(`✗ welcome credit condition of ${p.name} has no wording on the pricing page: "${line}"`); bad++; }
}

// editions against the pricing file
const packsOut = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'vx-pricing-')), 'packs.mjs');
buildSync({
  stdin: { contents: `import { PACK_LIST } from '@/packs'; import { PRICED_EDITIONS, plansFor, planByTier } from '@/lib/pricing'; import { standing } from '@/domain/entitlements';
    globalThis.__pricing = { packs: PACK_LIST.map((p) => ({ id: p.id, product: p.product, priced: p.priced, plans: plansFor(p.id).length, tier0: !!planByTier(p.id, 0), standing: standing('core', p.id, 0).state })), inFile: PRICED_EDITIONS };`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', outfile: packsOut, alias: { '@': path.join(root, 'src') }, loader: { '.json': 'json', '.css': 'empty' }, logLevel: 'error', platform: 'node',
  define: { 'process.env.NODE_ENV': '"production"', __VX_DEPLOY__: '"vyntex"', __VX_SAMPLE_PREVIEW__: 'false' },
});
await import(pathToFileURL(packsOut).href);
const products = new Set([pricing.product, ...pricing.other_industries.products]);
let unpriced = 0;
for (const p of globalThis.__pricing.packs) {
  const listed = products.has(p.product);
  if (p.priced && !listed) { console.error(`✗ edition ${p.id} (${p.product}) says it is priced but is not in the pricing file`); bad++; }
  if (!p.priced && listed) { console.error(`✗ edition ${p.id} (${p.product}) is in the pricing file but its pack says it is not priced`); bad++; }
  if (p.priced && p.plans !== 3) { console.error(`✗ edition ${p.id}: expected 3 plans, the pricing library returns ${p.plans}`); bad++; }
  if (!p.priced) {
    unpriced++;
    // an edition that is quoted must get nothing from the pricing library: no plan list, no plan by tier, no plan standing
    if (p.plans !== 0 || p.tier0 || p.standing !== 'none') { console.error(`✗ edition ${p.id} is not priced, yet the pricing library still answers with a plan for it`); bad++; }
  }
}
for (const name of products) if (!globalThis.__pricing.packs.some((p) => p.product === name)) { console.error(`✗ the pricing file lists "${name}" but no edition has that product name`); bad++; }
if (bad) { console.error(`${bad} pricing problem(s)`); process.exit(1); }
console.log(`pricing check passed (version ${pricing.version}, ${globalThis.__pricing.packs.length - unpriced} priced editions, ${unpriced} quoted on request)`);
