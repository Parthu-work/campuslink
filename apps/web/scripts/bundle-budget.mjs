#!/usr/bin/env node
/**
 * Bundle budget (master prompt §7d). Fails when the JS a member downloads before the first screen
 * renders, or the extra JS any screen adds on top of it, grows past its budget.
 *
 * - Initial: the HTML entry and every chunk it imports statically (what index.html loads).
 * - Per screen: each lazily loaded chunk plus the static imports it brings that are not already
 *   loaded: the initial load, and for a part a screen loads on demand (a form below the fold,
 *   animation features), that screen's own code too.
 *
 * Sizes are gzip (zlib level 6, a typical server setting) of the built files in dist/, read from
 * Vite's manifest. Run after `vite build`; `--json <file>` also writes the measurements.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const KB = 1024;
const INITIAL_BUDGET = 170 * KB;
/** First visit to any screen on top of the initial load (initial + screen ≤ 240 KB gzip). */
const SCREEN_BUDGET = 70 * KB;
/** Screens allowed more than SCREEN_BUDGET, with the reason. Keep this list short. */
const SCREEN_EXCEPTIONS = {
  // pdf.js (Mozilla's renderer, ~120 KB gzip on its own) for the in-app PDF viewer. It loads only
  // when a member opens a PDF, after the material page has rendered; no PDF renderer fits 70 KB,
  // and rendering pages on the server would mean storing page images (spec §14.7: lazy-loaded).
  'src/features/study/pdf-viewer.tsx': {
    budget: 140 * KB,
    reason: 'pdf.js, loaded only when a PDF is opened',
  },
  // KaTeX (~75 KB gzip) for maths in study assistant answers (spec §6, §14.7: self-hosted, lazily
  // loaded). It loads only when an answer contains maths; MathML output needs no fonts or CSS.
  'src/lib/katex.ts': {
    budget: 85 * KB,
    reason: 'KaTeX, loaded only when an answer contains maths',
  },
};

const dist = new URL('../dist/', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(dist, '.vite/manifest.json'), 'utf8'));
const gz = new Map();
const size = (file) => {
  if (!gz.has(file)) gz.set(file, gzipSync(readFileSync(join(dist, file)), { level: 6 }).length);
  return gz.get(file);
};

/** Every chunk reachable through static imports, starting from `key`. */
const closure = (key, seen = new Set()) => {
  if (seen.has(key)) return seen;
  seen.add(key);
  for (const dep of manifest[key]?.imports ?? []) closure(dep, seen);
  return seen;
};
const jsOf = (keys) => [...keys].map((k) => manifest[k]?.file).filter((f) => f?.endsWith('.js'));

const entry = Object.keys(manifest).find((k) => manifest[k].isEntry);
if (!entry) throw new Error('No entry in the Vite manifest; build with build.manifest enabled.');
const initialKeys = closure(entry);
const initialFiles = jsOf(initialKeys);
const initial = initialFiles.reduce((n, f) => n + size(f), 0);

/** What is already loaded when `key` is requested: the initial load, plus its importers' code. */
const loadedBefore = (key) => {
  const importers = Object.keys(manifest).filter((k) => manifest[k].dynamicImports?.includes(key));
  const fromInitial = importers.some((k) => initialKeys.has(k));
  if (fromInitial || !importers.length) return initialKeys;
  // Loaded on demand by a screen: everything every importer brings is there already.
  const shared = importers.map((k) => closure(k)).reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
  return new Set([...initialKeys, ...shared]);
};

const screens = Object.keys(manifest)
  .filter((k) => manifest[k].isDynamicEntry && manifest[k].file.endsWith('.js'))
  .map((k) => {
    const before = loadedBefore(k);
    const extra = jsOf([...closure(k)].filter((d) => !before.has(d)));
    const bytes = extra.reduce((n, f) => n + size(f), 0);
    const name = manifest[k].src ?? k;
    const budget = SCREEN_EXCEPTIONS[name]?.budget ?? SCREEN_BUDGET;
    return { name, bytes, budget, files: extra.length };
  })
  .sort((a, b) => b.bytes - a.bytes);

const fmt = (b) => `${(b / KB).toFixed(1)} KB`;
const failures = [];
console.log(
  `Initial JS: ${fmt(initial)} gzip in ${initialFiles.length} files (budget ${fmt(INITIAL_BUDGET)})`,
);
if (initial > INITIAL_BUDGET) failures.push(`initial JS ${fmt(initial)} > ${fmt(INITIAL_BUDGET)}`);
console.log('Largest screens (JS each adds on top of what is already loaded):');
for (const s of screens.slice(0, 12)) console.log(`  ${fmt(s.bytes).padStart(9)}  ${s.name}`);
for (const s of screens)
  if (s.bytes > s.budget) failures.push(`${s.name} adds ${fmt(s.bytes)} > ${fmt(s.budget)}`);

const jsonAt = process.argv.indexOf('--json');
if (jsonAt > 0) {
  writeFileSync(
    process.argv[jsonAt + 1],
    `${JSON.stringify({ initial: { bytes: initial, files: initialFiles }, budget: INITIAL_BUDGET, screens }, null, 2)}\n`,
  );
}
if (failures.length) {
  console.error(`\nBundle budget exceeded:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nBundle budget: OK');
