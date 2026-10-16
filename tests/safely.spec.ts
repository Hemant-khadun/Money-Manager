import { describe, expect, it } from 'vitest';
import { clearDebugLog, debugLogEntries } from '../src/lib/debug-log';
import { attempt, problemWords } from '../src/lib/safely';

describe('attempt', () => {
  it('gives back what the change returned, saying nothing', async () => {
    const told: string[] = [];
    expect(await attempt("Couldn't save this receipt", async () => 42, (w) => told.push(w))).toEqual({ ok: true, value: 42 });
    expect(told).toEqual([]);
  });

  it('when the change fails, says so in plain words and writes why to the problem report', async () => {
    clearDebugLog();
    const told: string[] = [];
    const result = await attempt("Couldn't save this receipt", () => Promise.reject(new Error('Transaction aborted')), (w) => told.push(w));
    expect(result).toEqual({ ok: false });
    expect(told).toEqual(["Couldn't save this receipt. Please try again. Your phone may be out of space."]);
    expect(debugLogEntries().at(-1)?.message).toMatch(/^Couldn't save this receipt: Error: Transaction aborted/);
  });
});

describe('problemWords', () => {
  it('says when the phone is out of space, directly or inside a storage error', () => {
    const full = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    const wrapped = Object.assign(new Error('AbortError'), { name: 'AbortError', inner: full });
    for (const err of [full, wrapped]) expect(problemWords("Couldn't save that change", err)).toBe("Couldn't save that change. Your phone is out of space: free some up, then try again.");
  });
});
