// Fails the build when the app-shell JS (what dist/index.html loads: its script and the scripts it
// preloads) comes to more than the start-up budget, gzipped (docs/PLAN.md §7b). Styles are listed
// but not counted. Run after `vite build`.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 150;
const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const html = await readFile(join(DIST, 'index.html'), 'utf8');
const files = [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)="\.\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);

let total = 0;
const rows = [];
for (const file of new Set(files)) {
  const size = gzipSync(await readFile(join(DIST, file)), { level: 9 }).length;
  if (file.endsWith('.js')) total += size;
  rows.push([file, size]);
}
rows.sort((a, b) => b[1] - a[1]);
for (const [file, size] of rows) console.log(`${(size / 1024).toFixed(1).padStart(7)} KB  ${file}`);
console.log(`${(total / 1024).toFixed(1).padStart(7)} KB  start-up JS, gzip (budget ${BUDGET_KB} KB)`);

if (total > BUDGET_KB * 1024) {
  console.error(`Start-up JS is over budget by ${((total - BUDGET_KB * 1024) / 1024).toFixed(1)} KB.`);
  process.exit(1);
}
