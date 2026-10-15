import type { OcrLine } from '../parser/types';
import { debugLog } from '../lib/debug-log';
import type { OcrBackend, OcrRequest, OcrResponse, OcrStrategy, ReadReport } from './ocr-protocol';

export interface OcrEngineInfo {
  backend: OcrBackend;
  loadMs: number;
}

export interface OcrRun {
  lines: OcrLine[];
  ms: number;
  report: ReadReport;
}

interface Pending {
  resolve: (r: OcrRun) => void;
  reject: (e: Error) => void;
  onStep?: (step: string, done: number, next: number) => void;
}

/** The reader stopped: it crashed, or went quiet for too long (on a phone, usually out of memory). Its message is for people. */
export class ReaderStopped extends Error {}

/** A photo being read that hasn't reported anything for this long has stalled. Each step reports in, and none takes this long. */
const STALL_MS = 120_000;

/**
 * Promise wrapper around the OCR worker. One worker, created on first use, models loaded once.
 * If it crashes or stalls, the photos being read fail, and the next one starts a fresh worker.
 */
export class OcrClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private readyPromise: Promise<OcrEngineInfo> | null = null;
  private heardAt = 0;
  private watchdog: ReturnType<typeof setInterval> | undefined;

  /** Starts the worker and loads the models (a few MB, cached by the service worker after the first time). */
  ready(): Promise<OcrEngineInfo> {
    this.readyPromise ??= new Promise<OcrEngineInfo>((resolve, reject) => {
      debugLog('app', 'Starting the reader');
      const worker = new Worker(new URL('./ocr.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<OcrResponse>) => {
        this.heardAt = Date.now();
        const msg = event.data;
        if (msg.type === 'log') debugLog('reader', msg.message);
        else if (msg.type === 'ready') {
          debugLog('app', `Reader ready on the ${msg.backend === 'webgpu' ? 'graphics chip' : 'processor'} in ${(msg.loadMs / 1000).toFixed(1)} s`);
          resolve({ backend: msg.backend, loadMs: msg.loadMs });
        } else if (msg.type === 'progress') {
          debugLog('reader', `Step: ${msg.step}`);
          this.pending.get(msg.id)?.onStep?.(msg.step, msg.done, msg.next);
        } else if (msg.type === 'result') this.settle(msg.id)?.resolve({ lines: msg.lines, ms: msg.ms, report: msg.report });
        else if (msg.id === null) {
          const err = new Error(msg.message);
          reject(err);
          this.stop(err);
        } else this.settle(msg.id)?.reject(new Error(msg.message));
      };
      worker.onerror = (event) => {
        console.error('[ocr] the worker crashed:', event.message);
        debugLog('app', `Reader crashed: ${event.message || 'no message'}${event.filename ? ` (${event.filename.split('/').pop()}:${event.lineno})` : ''}`);
        const err = new ReaderStopped('The receipt reader stopped, maybe because the phone ran short of memory.');
        reject(err);
        this.stop(err);
      };
      // Resolved against the page, so it works under GitHub Pages' /<repo>/ prefix.
      const base = new URL(import.meta.env.BASE_URL, location.href);
      const init: OcrRequest = { type: 'init', modelsUrl: new URL('models/', base).href };
      worker.postMessage(init);
    });
    return this.readyPromise;
  }

  /** Reads one receipt photo. `onStep` receives plain-language progress ("Reading part 2 of 3") and how far along it is (0..1). */
  async recognize(image: Blob, strategy: OcrStrategy = 'per-box', onStep?: (step: string, done: number, next: number) => void): Promise<OcrRun> {
    await this.ready();
    const bytes = await image.arrayBuffer();
    const id = this.nextId++;
    debugLog('app', `Sending a ${(bytes.byteLength / 1e6).toFixed(1)} MB photo to the reader`);
    return new Promise<OcrRun>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onStep });
      const msg: OcrRequest = { type: 'recognize', id, image: bytes, strategy };
      this.worker!.postMessage(msg, [bytes]);
      this.heardAt = Date.now();
      this.watchdog ??= setInterval(() => {
        if (!this.pending.size) {
          clearInterval(this.watchdog);
          this.watchdog = undefined;
        } else if (Date.now() - this.heardAt > STALL_MS) {
          debugLog('app', `Reader silent for ${STALL_MS / 1000} s: stopping it`);
          this.stop(new ReaderStopped('The receipt reader stopped responding, maybe because the phone ran short of memory.'));
        }
      }, 5000);
    });
  }

  /** Ends a crashed or stalled worker: the photos it was reading fail, and the next photo starts a new one. */
  private stop(err: Error) {
    this.worker?.terminate();
    this.worker = null;
    this.readyPromise = null;
    clearInterval(this.watchdog);
    this.watchdog = undefined;
    for (const entry of this.pending.values()) entry.reject(err);
    this.pending.clear();
  }

  private settle(id: number) {
    const entry = this.pending.get(id);
    this.pending.delete(id);
    return entry;
  }
}
