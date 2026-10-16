import { describeError } from './describe-error';
import { debugLog } from './debug-log';

// Saving, changing and deleting the person's data. The phone is the only copy, so a change that
// didn't happen must never look as if it did: a failure goes to the problem report (#/debug) and is
// said in plain words.

export type Outcome<T> = { ok: true; value: T } | { ok: false };

/** The phone's storage is full (IndexedDB says so directly, or inside Dexie's own error). */
function outOfSpace(err: unknown): boolean {
  const names = [err, (err as { inner?: unknown } | null)?.inner].map((e) => (e as { name?: string } | null)?.name);
  return names.includes('QuotaExceededError');
}

/** "Couldn't save this receipt. Your phone is out of space." */
export function problemWords(what: string, err: unknown): string {
  return `${what}. ${outOfSpace(err) ? 'Your phone is out of space: free some up, then try again.' : 'Please try again. Your phone may be out of space.'}`;
}

/** Runs a change; when it fails, writes why to the problem report and tells the person (`what` is what couldn't be done). */
export async function attempt<T>(what: string, run: () => Promise<T>, tell: (words: string) => void): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (err) {
    debugLog('app', `${what}: ${describeError(err)}`);
    tell(problemWords(what, err));
    return { ok: false };
  }
}
