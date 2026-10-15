// Errors in a line of plain text, for the problem report's log (lib/debug-log.ts).

/** "TypeError: x is null (at read-receipt.ts:120)": an error's message and where it happened, short. */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const where = err.stack
    ?.split('\n')
    .map((line) => line.trim())
    .find((line) => line !== err.message && /\d:\d/.test(line));
  return `${err.name}: ${err.message}${where ? ` (${where.replace(/^at\s+/, '').slice(0, 160)})` : ''}`;
}
