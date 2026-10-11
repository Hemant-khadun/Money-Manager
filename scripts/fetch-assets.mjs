// Downloads the OCR model files into public/models so the app can serve them itself
// (offline-capable, no third-party requests at runtime). Runs before every build.
// The ONNX Runtime WASM binary needs no download: Vite bundles it (see src/pipeline/ocr.worker.ts).
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/main';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models');

// PP-OCRv5 mobile detection + Latin-script recognition (covers English and French).
const FILES = [
  ['det.onnx', `${BASE}/detection/PP-OCRv5_mobile_det_infer.onnx`],
  ['rec-latin.onnx', `${BASE}/recognition/multi/latin/v5/latin_PP-OCRv5_mobile_rec_infer.onnx`],
  ['dict-latin.txt', `${BASE}/recognition/multi/latin/v5/ppocrv5_latin_dict.txt`],
];

async function exists(path) {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

await mkdir(OUT, { recursive: true });
for (const [name, url] of FILES) {
  const dest = join(OUT, name);
  if (await exists(dest)) {
    console.log(`✓ ${name} (cached)`);
    continue;
  }
  process.stdout.write(`↓ ${name} … `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  console.log(`${(buf.length / 1024 / 1024).toFixed(1)} MB`);
}
