import { debugLog } from '../lib/debug-log';
import type { CareLevel } from './ocr-protocol';

// How gently the receipt reader works, to stay within the phone's memory. When a phone runs out
// of memory while reading, the browser closes the page and opens it again (Safari on iPhone does
// this when reading on the graphics chip). Spent notices on the way back and reads more gently
// on this phone from then on.

const LEVEL_KEY = 'spent-reader-care';
/** Set while a photo is being read, cleared when it is done: still there at start-up means the page was closed mid-read. */
const READING_KEY = 'spent-reading';

interface Reading {
  level: CareLevel;
  /** The person left the page while it was reading: the phone may have closed it for other reasons. */
  left?: boolean;
}

function load<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}

function save(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: the reader just starts at its usual level each time.
  }
}

/** iPhones and iPads (iPads say they are Macs, but have touch screens). */
function isApple(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

/** Safari on iPhone closes the page when reading on the graphics chip, so iPhones start gentler. */
const startingLevel = (): CareLevel => (isApple() ? 1 : 0);

export function careLevel(): CareLevel {
  const saved = load<number>(LEVEL_KEY);
  return saved === 0 || saved === 1 || saved === 2 ? saved : startingLevel();
}

/** Back to the usual level for this phone (the problem report's reset). */
export function resetCareLevel() {
  save(LEVEL_KEY, null);
  debugLog('app', `Reading mode reset to level ${careLevel()}`);
}

let restarted: boolean | undefined;

/** Whether the page was closed while it was reading a photo last time; if so, Spent now reads more gently. Checked once, at start-up. */
export function restartedWhileReading(): boolean {
  if (restarted !== undefined) return restarted;
  const last = load<Reading>(READING_KEY);
  save(READING_KEY, null);
  restarted = !!last && !last.left;
  if (last && !last.left) {
    const level = Math.min(2, Math.max(careLevel(), last.level + 1)) as CareLevel;
    save(LEVEL_KEY, level);
    debugLog('app', `The page was closed while reading a photo (level ${last.level}): reading more gently from now on (level ${level})`);
  }
  return restarted;
}

/** The reader crashed or went quiet while reading (the page stayed open): read more gently from the next start. */
export function readMoreGently(from: CareLevel) {
  const level = Math.min(2, Math.max(careLevel(), from + 1)) as CareLevel;
  save(LEVEL_KEY, level);
  debugLog('app', `Reading more gently from now on (level ${level})`);
}

export function readingStarted(level: CareLevel) {
  save(READING_KEY, { level } satisfies Reading);
}

export function readingEnded() {
  save(READING_KEY, null);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    const reading = load<Reading>(READING_KEY);
    if (document.hidden && reading) save(READING_KEY, { ...reading, left: true });
  });
}
