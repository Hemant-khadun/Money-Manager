import * as ort from 'onnxruntime-web';
// The default onnxruntime-web bundle (WebGPU + WASM) fetches only this binary; Vite emits it with a content hash.
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';
import { PaddleOcrService, getDefaultWebExecutionProviders } from 'ppu-paddle-ocr/web';
import type { OcrRequest, OcrResponse } from './ocr-protocol';
import { applyTextThreshold } from './ocr-tuning';
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

/** Decodes the photo (honouring its EXIF rotation) onto a canvas. */
async function toCanvas(bytes: ArrayBuffer): Promise<OffscreenCanvas> {
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  context(canvas).drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

async function init(modelsUrl: string) {
  const started = performance.now();
  // Self-hosted runtime instead of the library's jsDelivr default: no third-party requests.
  ort.env.wasm.wasmPaths = { wasm: ortWasmUrl };
  const providers = (await getDefaultWebExecutionProviders()) ?? ['wasm'];
  let fellBack = false;
  service = new PaddleOcrService({
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
  await service.initialize();
  if (!applyTextThreshold(service)) console.warn('[ocr] could not apply the text threshold; closely printed lines may merge');
  const backend = providers.includes('webgpu') && !fellBack ? 'webgpu' : 'wasm';
  post({ type: 'ready', backend, loadMs: Math.round(performance.now() - started) });
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
    const ocr = service;
    if (!ocr) throw new Error('OCR models failed to load');
    const engine: OcrEngine<OffscreenCanvas> = {
      detect: (image, maxSideLength) => ocr.detect(image, { maxSideLength }),
      recognize: (image, strategy) => ocr.recognize(image, { strategy, noCache: true }),
    };
    const started = performance.now();
    const photo = await toCanvas(msg.image);
    const { lines, report } = await readReceipt(engine, canvases, photo, msg.strategy, (step, done, next) =>
      post({ type: 'progress', id: msg.id, step, done, next }),
    );
    post({ type: 'result', id: msg.id, lines, ms: Math.round(performance.now() - started), report });
  } catch (err) {
    post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
