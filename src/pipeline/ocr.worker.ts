import * as ort from 'onnxruntime-web';
// The default onnxruntime-web bundle (WebGPU + WASM) fetches only this binary; Vite emits it with a content hash.
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';
import { PaddleOcrService, getDefaultWebExecutionProviders } from 'ppu-paddle-ocr/web';
import { describeError } from '../lib/describe-error';
import type { CareLevel, OcrBackend, OcrRequest, OcrResponse } from './ocr-protocol';
import { applyTextThreshold } from './ocr-tuning';
import { MAX_PIXELS, ORIENTATION_TEST_JPEG, jpegOrientation, shrinkFor, uprightFrame } from './photo';
import { FULL_SIZES, readReceipt, type Canvases, type OcrEngine, type ReadingSizes } from './read-receipt';

// Runs PP-OCRv5 off the main thread so the UI never freezes during a scan.
// The project compiles against the DOM lib; seen from inside, a dedicated worker's scope has a Worker's shape.
const scope = self as unknown as Worker;

let service: PaddleOcrService | null = null;
let ready: Promise<void> | null = null;

function post(msg: OcrResponse) {
  scope.postMessage(msg);
}

/** A line for the problem report's log. */
const note = (message: string) => post({ type: 'log', message });

scope.addEventListener('error', (event) => note(`Uncaught: ${event.message}`));
scope.addEventListener('unhandledrejection', (event) => note(`Unhandled: ${describeError((event as PromiseRejectionEvent).reason)}`));

/** The phone's graphics chip as WebGPU describes it, for the log. */
async function graphicsChip(): Promise<string> {
  if (!('gpu' in navigator) || !navigator.gpu) return 'no WebGPU';
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return 'WebGPU, but no graphics chip offered';
    const info = adapter.info;
    return `WebGPU: ${[info?.vendor, info?.architecture, info?.device, info?.description].filter(Boolean).join(' ') || 'no details'}`;
  } catch (err) {
    return `WebGPU failed: ${describeError(err)}`;
  }
}

// The OCR library reads pixels back from canvases once per line of text. Without
// willReadFrequently the browser keeps a canvas on the GPU and every read-back is slow
// (a 1 s read took 14 s). The flag only takes effect on a canvas's first getContext call.
const context = (canvas: OffscreenCanvas) => canvas.getContext('2d', { willReadFrequently: true })!;

const canvases: Canvases<OffscreenCanvas> = {
  create(width, height) {
    const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
    const ctx = context(canvas);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
  },
  paint(target, source, [a, b, c, d, e, f]) {
    const ctx = context(target);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(a, b, c, d, e, f);
    ctx.drawImage(source, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  },
  pixels: (canvas) => context(canvas).getImageData(0, 0, canvas.width, canvas.height).data,
};

/** Whether this browser turns photos upright itself (by their EXIF orientation) when decoding them. */
const turnsPhotos: Promise<boolean> = (async () => {
  const test = Uint8Array.from(atob(ORIENTATION_TEST_JPEG), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([test], { type: 'image/jpeg' }));
  const turned = bitmap.height > bitmap.width;
  bitmap.close();
  return turned;
})().catch(() => true);

/** Decodes the photo onto a canvas: upright, and shrunk if it is bigger than a phone can handle (photo.ts). */
async function toCanvas(bytes: ArrayBuffer): Promise<OffscreenCanvas> {
  const started = performance.now();
  const bitmap = await createImageBitmap(new Blob([bytes]));
  try {
    // Phones save most photos sideways, marked "turn right to view"; turn it here if the browser didn't.
    const orientation = (await turnsPhotos) ? 1 : jpegOrientation(bytes);
    const frame = uprightFrame(orientation, bitmap.width, bitmap.height, shrinkFor(bitmap.width, bitmap.height, SIZES[care].maxPixels));
    const canvas = new OffscreenCanvas(frame.width, frame.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error(`Couldn't make a ${frame.width} × ${frame.height} canvas`);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(...frame.transform);
    ctx.drawImage(bitmap, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    note(
      `Photo ${(bytes.byteLength / 1e6).toFixed(1)} MB, ${bitmap.width}×${bitmap.height}; browser turns photos: ${(await turnsPhotos) ? 'yes' : 'no'}; ` +
        `orientation mark ${jpegOrientation(bytes)}; reading it at ${frame.width}×${frame.height} (ready in ${Math.round(performance.now() - started)} ms)`,
    );
    return canvas;
  } finally {
    bitmap.close();
  }
}

type Providers = NonNullable<Awaited<ReturnType<typeof getDefaultWebExecutionProviders>>>;

let modelsUrl = '';
let backend: OcrBackend = 'wasm';

/** Image sizes for each level of care (care.ts): smaller ones use less memory. */
const SIZES: Record<CareLevel, ReadingSizes & { maxPixels: number }> = {
  0: { ...FULL_SIZES, maxPixels: MAX_PIXELS },
  1: { firstLook: 1280, partMax: FULL_SIZES.partMax, maxPixels: MAX_PIXELS },
  2: { firstLook: 960, partMax: 960, maxPixels: 8_000_000 },
};
let care: CareLevel = 0;

/** Loads the models into a reader that runs on the graphics chip (WebGPU) or the processor (WASM). */
async function start(providers: Providers): Promise<{ ocr: PaddleOcrService; fellBack: boolean }> {
  let fellBack = false;
  const ocr = new PaddleOcrService({
    model: {
      detection: `${modelsUrl}det.onnx`,
      recognition: `${modelsUrl}rec-latin.onnx`,
      charactersDictionary: `${modelsUrl}dict-latin.txt`,
    },
    // Parts are at most partMax on their longest side and are read at full detail.
    // (The library's "auto" default would shrink anything over ~960 px.)
    detection: { maxSideLength: SIZES[care].partMax },
    session: {
      executionProviders: providers,
      graphOptimizationLevel: 'all',
      onSessionFallback: (err) => {
        fellBack = true;
        note(`The graphics chip couldn't load the models: ${describeError(err)}`);
      },
    },
  });
  const started = performance.now();
  await ocr.initialize();
  note(`Models loaded for ${providers.join(' + ')} in ${Math.round(performance.now() - started)} ms${fellBack ? ', on the processor after all' : ''}`);
  if (!applyTextThreshold(ocr)) console.warn('[ocr] could not apply the text threshold; closely printed lines may merge');
  return { ocr, fellBack };
}

/**
 * Whether the reader gets a printed test line right. Some phone graphics chips run the models but
 * get the sums wrong, and then every receipt reads as nothing or as nonsense.
 */
async function readsTestLine(ocr: PaddleOcrService): Promise<boolean> {
  try {
    const canvas = new OffscreenCanvas(520, 96);
    const ctx = context(canvas);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 44px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('TOTAL 123.45', 24, 48);
    const { text } = await ocr.recognize(canvas, { noCache: true });
    const right = text.replace(/\s/g, '').includes('123.45');
    note(`Test line "TOTAL 123.45" read as "${text}": ${right ? 'right' : 'wrong'}`);
    return right;
  } catch (err) {
    note(`Test line failed: ${describeError(err)}`);
    return false;
  }
}

/** Leaves the graphics chip for the processor: slower, but it works on every phone. */
async function useProcessor(reason: unknown) {
  console.warn('[ocr] reading on the processor instead of the graphics chip:', reason);
  note(`Switching to the processor: ${describeError(reason)}`);
  const old = service;
  service = null;
  await old?.destroy().catch(() => {});
  service = (await start(['wasm'])).ocr;
  backend = 'wasm';
}

async function init(url: string, level: CareLevel) {
  const started = performance.now();
  modelsUrl = url;
  care = level;
  note(`Reader starting. ${await graphicsChip()}; ${navigator.hardwareConcurrency ?? '?'} cores`);
  // Self-hosted runtime instead of the library's jsDelivr default: no third-party requests.
  ort.env.wasm.wasmPaths = { wasm: ortWasmUrl };
  // From level 1 on, the processor only: the graphics chip is what runs out of memory on iPhones.
  const providers: Providers = care === 0 ? ((await getDefaultWebExecutionProviders()) ?? ['wasm']) : ['wasm'];
  note(`Reading mode: level ${care} (first look ${SIZES[care].firstLook} px, parts ${SIZES[care].partMax} px, photos up to ${SIZES[care].maxPixels / 1e6} MP)`);
  const { ocr, fellBack } = await start(providers);
  service = ocr;
  backend = providers.includes('webgpu') && !fellBack ? 'webgpu' : 'wasm';
  if (backend === 'webgpu' && !(await readsTestLine(ocr))) await useProcessor('the test line read wrong');
  post({ type: 'ready', backend, loadMs: Math.round(performance.now() - started) });
}

async function read(photo: OffscreenCanvas, msg: Extract<OcrRequest, { type: 'recognize' }>) {
  const ocr = service;
  if (!ocr) throw new Error('OCR models failed to load');
  const engine: OcrEngine<OffscreenCanvas> = {
    detect: (image, maxSideLength) => ocr.detect(image, { maxSideLength }),
    recognize: (image, strategy) => ocr.recognize(image, { strategy, noCache: true }),
  };
  return readReceipt(engine, canvases, photo, msg.strategy, (step, done, next) => post({ type: 'progress', id: msg.id, step, done, next }), SIZES[care]);
}

scope.onmessage = async (event: MessageEvent<OcrRequest>) => {
  const msg = event.data;
  if (msg.type === 'init') {
    ready ??= init(msg.modelsUrl, msg.care).catch((err: unknown) => {
      note(`Reader couldn't start: ${describeError(err)}`);
      ready = null;
      post({ type: 'error', id: null, message: err instanceof Error ? err.message : String(err) });
    });
    return;
  }
  try {
    if (!ready) throw new Error('OCR worker used before init');
    await ready;
    const started = performance.now();
    const photo = await toCanvas(msg.image);
    let result;
    try {
      result = await read(photo, msg);
      // On a phone the graphics chip can drop out (the camera opening is enough) or misread everything.
      if (backend === 'webgpu' && !result.lines.length) throw new Error('nothing read');
    } catch (err) {
      if (backend !== 'webgpu') throw err;
      await useProcessor(err);
      result = await read(photo, msg);
    }
    note(`Read ${result.lines.length} lines in ${((performance.now() - started) / 1000).toFixed(1)} s on the ${backend === 'webgpu' ? 'graphics chip' : 'processor'}`);
    post({ type: 'result', id: msg.id, lines: result.lines, ms: Math.round(performance.now() - started), report: result.report });
  } catch (err) {
    note(`Reading failed: ${describeError(err)}`);
    post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
