// When to remind the person to back up (docs/PLAN.md §10). Apart from backup.ts, so Overview can
// check without loading the backup code.

/** The setting holding when the last backup was made (ISO time). */
export const LAST_BACKUP = 'lastBackupAt';

const DAY = 86_400_000;

/**
 * Whether to remind the person to back up: they have receipts, and the last backup is over 30 days
 * old, or there was never one and the first receipt was saved over a week ago.
 */
export function backupDue({ now, lastBackupAt, firstReceiptAt }: { now: number; lastBackupAt: string | undefined; firstReceiptAt: number | undefined }): boolean {
  if (firstReceiptAt === undefined) return false;
  return lastBackupAt ? now - Date.parse(lastBackupAt) > 30 * DAY : now - firstReceiptAt > 7 * DAY;
}
