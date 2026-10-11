import type { OcrLine } from '../parser/types';
import type { OcrRequest, OcrResponse, OcrStrategy, ReadReport } from './ocr-protocol';

export interface OcrEngineInfo {
  backend: 'webgpu' | 'wasm';
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
  onStep?: (step: string) => void;
}

/** Promise wrapper around the OCR worker. One worker, created on first use, models loaded once. */
export class OcrClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private readyPromise: Promise<OcrEngineInfo> | null = null;

  /** Starts the worker and loads the models (a few MB, cached by the service worker after the first time). */
  ready(): Promise<OcrEngineInfo> {
    this.readyPromise ??= new Promise<OcrEngineInfo>((resolve, reject) => {
      const worker = new Worker(new URL('./ocr.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<OcrResponse>) => {
        const msg = event.data;
        if (msg.type === 'ready') resolve({ backend: msg.backend, loadMs: msg.loadMs });
        else if (msg.type === 'progress') this.pending.get(msg.id)?.onStep?.(msg.step);
        else if (msg.type === 'result') this.settle(msg.id)?.resolve({ lines: msg.lines, ms: msg.ms, report: msg.report });
        else if (msg.id === null) {
          this.readyPromise = null;
          reject(new Error(msg.message));
        } else this.settle(msg.id)?.reject(new Error(msg.message));
      };
      worker.onerror = (event) => reject(new Error(event.message || 'OCR worker failed to start'));
      // Resolved against the page, so it works under GitHub Pages' /<repo>/ prefix.
      const base = new URL(import.meta.env.BASE_URL, location.href);
      const init: OcrRequest = { type: 'init', modelsUrl: new URL('models/', base).href };
      worker.postMessage(init);
    });
    return this.readyPromise;
  }

  /** Reads one receipt photo. `onStep` receives plain-language progress ("Reading part 2 of 3"). */
  async recognize(image: Blob, strategy: OcrStrategy = 'per-box', onStep?: (step: string) => void): Promise<OcrRun> {
    await this.ready();
    const bytes = await image.arrayBuffer();
    const id = this.nextId++;
    return new Promise<OcrRun>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onStep });
      const msg: OcrRequest = { type: 'recognize', id, image: bytes, strategy };
      this.worker!.postMessage(msg, [bytes]);
    });
  }

  private settle(id: number) {
    const entry = this.pending.get(id);
    this.pending.delete(id);
    return entry;
  }
}
