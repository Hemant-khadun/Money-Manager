// What the app and the receipt reader did, step by step, for the problem report (#/debug).
// Kept on the phone (localStorage) so it survives the page being reloaded mid-scan, which is what
// phones do when they run short of memory. Nothing is sent anywhere: the person copies the report.

export interface LogEntry {
  /** ISO time. */
  at: string;
  source: 'app' | 'reader';
  message: string;
}

const KEY = 'spent-debug-log';
const MAX_ENTRIES = 300;

function load(): LogEntry[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(saved) ? (saved as LogEntry[]) : [];
  } catch {
    return [];
  }
}

let entries: readonly LogEntry[] = load();
const listeners = new Set<() => void>();

function changed() {
  // Saved at once, not later: the next moment the page may be gone.
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Storage full or blocked: the log still works until the page closes.
  }
  for (const listener of listeners) listener();
}

export function debugLog(source: LogEntry['source'], message: string) {
  entries = [...entries.slice(-(MAX_ENTRIES - 1)), { at: new Date().toISOString(), source, message }];
  changed();
}

export function clearDebugLog() {
  entries = [];
  changed();
}

/** For useSyncExternalStore. */
export const debugLogEntries = () => entries;
export function subscribeDebugLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
