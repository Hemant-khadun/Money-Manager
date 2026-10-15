import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// care.ts checks for a page closed mid-read once per start-up, so each "start" loads it afresh.
const start = async () => {
  vi.resetModules();
  return import('../src/pipeline/care');
};

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36';

describe('reading mode (care level)', () => {
  let stored: Map<string, string>;
  beforeEach(() => {
    stored = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => void stored.set(k, v),
      removeItem: (k: string) => void stored.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('starts gentler on iPhones, where Safari closes the page when the graphics chip runs out of memory', async () => {
    vi.stubGlobal('navigator', { userAgent: IPHONE, maxTouchPoints: 5 });
    expect((await start()).careLevel()).toBe(1);
    vi.stubGlobal('navigator', { userAgent: ANDROID, maxTouchPoints: 5 });
    expect((await start()).careLevel()).toBe(0);
  });

  it('reads more gently after the page was closed mid-read, up to the gentlest level', async () => {
    vi.stubGlobal('navigator', { userAgent: IPHONE, maxTouchPoints: 5 });
    let care = await start();
    care.readingStarted(care.careLevel());
    // The phone closes the page; the next start notices.
    care = await start();
    expect(care.restartedWhileReading()).toBe(true);
    expect(care.careLevel()).toBe(2);
    care.readingStarted(2);
    care = await start();
    expect(care.restartedWhileReading()).toBe(true);
    expect(care.careLevel()).toBe(2);
  });

  it('does not count a photo that finished, or a page the person left while it was reading', async () => {
    vi.stubGlobal('navigator', { userAgent: ANDROID, maxTouchPoints: 5 });
    let care = await start();
    care.readingStarted(0);
    care.readingEnded();
    care = await start();
    expect(care.restartedWhileReading()).toBe(false);

    stored.set('spent-reading', JSON.stringify({ level: 0, left: true }));
    care = await start();
    expect(care.restartedWhileReading()).toBe(false);
    expect(care.careLevel()).toBe(0);
  });

  it('reads more gently after the reader crashes, and can be reset', async () => {
    vi.stubGlobal('navigator', { userAgent: ANDROID, maxTouchPoints: 5 });
    const care = await start();
    care.readMoreGently(0);
    expect(care.careLevel()).toBe(1);
    care.resetCareLevel();
    expect(care.careLevel()).toBe(0);
  });
});
