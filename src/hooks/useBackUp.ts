import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback } from 'react';
import { useSafely, useToast } from '../components/Toast';
import { LAST_BACKUP, backupDue, exportBackup, getSetting, setSetting } from '../db/backup';
import { db } from '../db/schema';

// Backing up, from Settings or from the reminder on Overview: the file goes wherever the person
// shares it to (Drive, email, files), or is downloaded where sharing files isn't possible.

async function shareOrDownload(file: File): Promise<void> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Money Manager backup' });
      return;
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function useBackUp() {
  const toast = useToast();
  const safely = useSafely();
  return useCallback(async () => {
    const made = await safely("Couldn't make the backup", exportBackup);
    if (!made.ok) return;
    const backup = made.value;
    const file = new File([JSON.stringify(backup)], `money-manager-backup-${backup.exportedAt.slice(0, 10)}.json`, { type: 'application/json' });
    try {
      await shareOrDownload(file);
    } catch {
      return; // Cancelled.
    }
    await safely("Couldn't note when you backed up", () => setSetting(LAST_BACKUP, backup.exportedAt));
    toast(`Backed up ${backup.receipts.length} receipts`);
  }, [safely, toast]);
}

/** When the last backup was made (ISO time); null when never, undefined while loading. */
export function useLastBackup() {
  return useLiveQuery(async () => (await getSetting<string>(LAST_BACKUP)) ?? null, []);
}

/** Whether Overview reminds the person to back up (see backupDue). */
export function useBackupDue(): boolean {
  return (
    useLiveQuery(async () => {
      const [lastBackupAt, first] = await Promise.all([getSetting<string>(LAST_BACKUP), db.receipts.orderBy('createdAt').first()]);
      return backupDue({ now: Date.now(), lastBackupAt, firstReceiptAt: first?.createdAt });
    }, []) ?? false
  );
}
