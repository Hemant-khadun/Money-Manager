import * as ort from 'onnxruntime-web';
// The default onnxruntime-web bundle (WebGPU + WASM) fetches only this binary; Vite emits it with a content hash.
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';
import { PaddleOcrService, getDefaultWebExecutionProviders } from 'ppu-paddle-ocr/web';
import type { OcrBackend, OcrRequest, OcrResponse } from './ocr-protocol';
import { applyTextThreshold } from './ocr-tuning';
import { ORIENTATION_TEST_JPEG, jpegOrientation, shrinkFor, uprightFrame } from './photo';
import { readReceipt, type Canvases, type OcrEngine } from './read-receipt';
import { PART_MAX } from './reading-plan';

// Runs PP-OCRv5 off the main thread so the UI never freezes during a scan.
// The project compiles against the DOM lib; seen from inside, a dedicated worker's scope has a Worker's shape.
const scope = self as unknown as Worker;

let service: PaddleOcrService | null = null;
let ready: Promise<void> | null = null;

function post(msg: OcrResponse) {
  scope.postMessage(msg);
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
  const bitmap = await createImageBitmap(new Blob([bytes]));
  try {
    // Phones save most photos sideways, marked "turn right to view"; turn it here if the browser didn't.
    const orientation = (await turnsPhotos) ? 1 : jpegOrientation(bytes);
    const frame = uprightFrame(orientation, bitmap.width, bitmap.height, shrinkFor(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(frame.width, frame.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error(`Couldn't make a ${frame.width} × ${frame.height} canvas`);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(...frame.transform);
    ctx.drawImage(bitmap, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return canvas;
  } finally {
    bitmap.close();
  }
}

type Providers = NonNullable<Awaited<ReturnType<typeof getDefaultWebExecutionProviders>>>;

let modelsUrl = '';
let backend: OcrBackend = 'wasm';

/** Loads the models into a reader that runs on the graphics chip (WebGPU) or the processor (WASM). */
async function start(providers: Providers): Promise<{ ocr: PaddleOcrService; fellBack: boolean }> {
  let fellBack = false;
  const ocr = new PaddleOcrService({
    model: {
      detection: `${modelsUrl}det.onnx`,
      recognition: `${modelsUrl}rec-latin.onnx`,
      charactersDictionary: `${modelsUrl}dict-latin.txt`,
    },
    // Parts are at most PART_MAX on their longest side and are read at full detail.
    // (The library's "auto" default would shrink anything over ~960 px.)
    detection: { maxSideLength: PART_MAX },
    session: {
      executionProviders: providers,
      graphOptimizationLevel: 'all',
      onSessionFallback: () => {
        fellBack = true;
      },
    },
  });
  await ocr.initialize();
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
    return text.replace(/\s/g, '').includes('123.45');
  } catch {
    return false;
  }
}

/** Leaves the graphics chip for the processor: slower, but it works on every phone. */
async function useProcessor(reason: unknown) {
  console.warn('[ocr] reading on the processor instead of the graphics chip:', reason);
  const old = service;
  service = null;
  await old?.destroy().catch(() => {});
  service = (await start(['wasm'])).ocr;
  backend = 'wasm';
}

async function init(url: string) {
  const started = performance.now();
  modelsUrl = url;
  // Self-hosted runtime instead of the library's jsDelivr default: no third-party requests.
  ort.env.wasm.wasmPaths = { wasm: ortWasmUrl };
  const providers = (await getDefaultWebExecutionProviders()) ?? ['wasm'];
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
  return readReceipt(engine, canvases, photo, msg.strategy, (step, done, next) => post({ type: 'progress', id: msg.id, step, done, next }));
}

scope.onmessage = async (event: MessageEvent<OcrRequest>) => {
  const msg = event.data;
  if (msg.type === 'init') {
    ready ??= init(msg.modelsUrl).catch((err: unknown) => {
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
    post({ type: 'result', id: msg.id, lines: result.lines, ms: Math.round(performance.now() - started), report: result.report });
  } catch (err) {
    post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
