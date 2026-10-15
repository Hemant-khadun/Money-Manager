import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OcrClient, ReaderStopped } from '../src/pipeline/ocr-client';

/** Stands in for the reading worker: gets ready at once, then never answers (or crashes when told to). */
class QuietWorker {
  static made: QuietWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  terminated = false;
  constructor() {
    QuietWorker.made.push(this);
  }
  postMessage(msg: { type: string }) {
    if (msg.type === 'init') queueMicrotask(() => this.onmessage?.({ data: { type: 'ready', backend: 'wasm', loadMs: 1 } }));
  }
  terminate() {
    this.terminated = true;
  }
}

describe('OcrClient when the reader fails', () => {
  beforeEach(() => {
    QuietWorker.made = [];
    vi.useFakeTimers();
    vi.stubGlobal('Worker', QuietWorker);
    vi.stubGlobal('location', { href: 'http://localhost/' });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('gives up on a photo when the reader goes quiet, and starts a new reader for the next one', async () => {
    const client = new OcrClient();
    const reading = client.recognize(new Blob(['photo']));
    const failed = expect(reading).rejects.toBeInstanceOf(ReaderStopped);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(QuietWorker.made[0].terminated).toBe(false); // still within its time
    await vi.advanceTimersByTimeAsync(70_000);
    await failed;
    expect(QuietWorker.made[0].terminated).toBe(true);

    void client.recognize(new Blob(['next photo'])).catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(QuietWorker.made).toHaveLength(2);
  });

  it('fails the photo being read when the reader crashes', async () => {
    const client = new OcrClient();
    const reading = client.recognize(new Blob(['photo']));
    const failed = expect(reading).rejects.toBeInstanceOf(ReaderStopped);
    await vi.advanceTimersByTimeAsync(0);
    QuietWorker.made[0].onerror?.({ message: 'out of memory' });
    await failed;
    expect(QuietWorker.made[0].terminated).toBe(true);
  });
});
