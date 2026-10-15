import { describe, expect, it } from 'vitest';
import { clearDebugLog, debugLog, debugLogEntries, subscribeDebugLog } from '../src/lib/debug-log';
import { describeError } from '../src/lib/describe-error';

describe('debug log', () => {
  it('keeps the latest 300 entries, oldest first, and tells listeners', () => {
    clearDebugLog();
    let calls = 0;
    const stop = subscribeDebugLog(() => calls++);
    for (let i = 1; i <= 305; i++) debugLog('app', `step ${i}`);
    stop();
    const entries = debugLogEntries();
    expect(entries).toHaveLength(300);
    expect(entries[0].message).toBe('step 6');
    expect(entries.at(-1)).toMatchObject({ source: 'app', message: 'step 305' });
    expect(calls).toBe(305);
  });

  it('describes errors in one line', () => {
    expect(describeError(new TypeError('x is null'))).toMatch(/^TypeError: x is null/);
    expect(describeError('plain text')).toBe('plain text');
  });
});
