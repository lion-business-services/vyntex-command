// Bundles a few TypeScript modules of the app into one file a Node test can import. No browser, no store: the domain
// actions and the platform helpers are plain functions over a workspace object.
import { buildSync } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** `entry` is the body of a small module, e.g. `export * from '@/domain/actions'`. Returns what it exports. */
export async function load(entry) {
  const out = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'vx-unit-')), 'bundle.mjs');
  buildSync({
    stdin: { contents: entry, resolveDir: root, loader: 'ts' },
    bundle: true, format: 'esm', outfile: out, platform: 'node', logLevel: 'error',
    alias: { '@': path.join(root, 'src') }, loader: { '.json': 'json', '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"test"', __VX_DEPLOY__: '"vyntex"', __VX_SAMPLE_PREVIEW__: 'false' },
  });
  return import(pathToFileURL(out).href);
}

/** A workspace with no records, for an edition. The same lists the store creates. */
export function blank(pack) {
  const lists = ['users', 'leads', 'clients', 'jobs', 'tasks', 'workers', 'workerPays', 'docs', 'activity', 'messages', 'offices', 'grants', 'accessRequests', 'catalog', 'playbooks', 'apptTypes',
    'appointments', 'credits', 'crossSell', 'opportunities', 'reviews', 'templates', 'envelopes', 'connections', 'posts', 'cash', 'cashCloses', 'complianceItems', 'rules', 'reveals', 'secureLog', 'audit'];
  return {
    v: 7, pack: pack.id, seededOn: '2026-01-01', seedLang: 'en', touched: false,
    company: { name: 'Sample Test Co', initials: 'ST', license: '', phone: '', email: '' },
    ...Object.fromEntries(lists.map((k) => [k, []])),
    config: {}, automation: { enabled: {}, runs: [] }, readNotifications: [], settings: {},
  };
}
