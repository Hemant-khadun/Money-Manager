import { formatDate } from '../lib/format';
import { LAST_BACKUP } from './backup-due';
import { db, type Category, type LineItem, type Product, type Receipt, type Setting, type Store, type Thumb } from './schema';

// Backup and restore: everything in one JSON file the person keeps (Drive, email, files).
// The phone is the only copy of their data, so this is the safety net (docs/PLAN.md §10).
// The Excel export is a report; only this file can be restored.

// Kept as "spent" (the app's first name) so backups made before the rename still restore.
const APP = 'spent';
const VERSION = 1;

export interface Backup {
  app: typeof APP;
  version: number;
  exportedAt: string;
  categories: Category[];
  stores: Store[];
  receipts: Receipt[];
  items: LineItem[];
  products: Product[];
  /** Receipt pictures as data URLs. */
  thumbs: Array<{ receiptId: number; image: string }>;
  settings: Setting[];
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

async function dataUrlToBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob();
}

export async function exportBackup(): Promise<Backup> {
  const thumbs = await db.thumbs.toArray();
  return {
    app: APP,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    categories: await db.categories.toArray(),
    stores: await db.stores.toArray(),
    receipts: await db.receipts.toArray(),
    items: await db.items.toArray(),
    products: await db.products.toArray(),
    thumbs: await Promise.all(thumbs.map(async (t) => ({ receiptId: t.receiptId, image: await blobToDataUrl(t.image) }))),
    settings: await db.settings.toArray(),
  };
}

/** Plain words for the person when a file can't be restored. */
export class BackupError extends Error {}

/** Checks that a file's contents are a backup this version can restore. */
export function readBackup(data: unknown): Backup {
  const backup = data as Partial<Backup> | null;
  if (!backup || backup.app !== APP || !Array.isArray(backup.receipts)) {
    throw new BackupError("This file isn't a Money Manager backup.");
  }
  if ((backup.version ?? 0) > VERSION) throw new BackupError('This backup was made by a newer version of Money Manager. Update the app first.');
  return backup as Backup;
}

const receiptsWord = (n: number) => `${n} receipt${n === 1 ? '' : 's'}`;

/** "This backup is from 12 Sep 2026, with 84 receipts. This phone has 120. Replace them?" */
export function restoreQuestion(backup: Backup, onPhone: number): string {
  const from = `This backup is from ${formatDate(backup.exportedAt.slice(0, 10))}, with ${receiptsWord(backup.receipts.length)}.`;
  return onPhone ? `${from} This phone has ${onPhone}. Replace them?` : `${from} Restore it?`;
}

export const receiptsOnPhone = () => db.receipts.count();

/** Everything a backup holds, as it is on the phone: kept in memory while a restore can be undone. */
export interface PhoneData {
  categories: Category[];
  stores: Store[];
  receipts: Receipt[];
  items: LineItem[];
  products: Product[];
  thumbs: Thumb[];
  settings: Setting[];
}

// Receipts not saved yet (being read) aren't part of it: a restore leaves them as they are.
const dataTables = () => [db.categories, db.stores, db.receipts, db.items, db.products, db.thumbs, db.settings];

async function phoneData(): Promise<PhoneData> {
  const [categories, stores, receipts, items, products, thumbs, settings] = await Promise.all([
    db.categories.toArray(),
    db.stores.toArray(),
    db.receipts.toArray(),
    db.items.toArray(),
    db.products.toArray(),
    db.thumbs.toArray(),
    db.settings.toArray(),
  ]);
  return { categories, stores, receipts, items, products, thumbs, settings };
}

async function replaceAll(data: PhoneData): Promise<void> {
  await db.transaction('rw', dataTables(), async () => {
    await Promise.all(dataTables().map((t) => t.clear()));
    await db.categories.bulkAdd(data.categories);
    await db.stores.bulkAdd(data.stores);
    await db.receipts.bulkAdd(data.receipts);
    await db.items.bulkAdd(data.items);
    await db.products.bulkAdd(data.products);
    await db.thumbs.bulkAdd(data.thumbs);
    await db.settings.bulkAdd(data.settings);
  });
}

/**
 * Replaces everything on this phone with the backup's contents (all or nothing). Gives back what
 * was on the phone before, for `undoRestore`.
 */
export async function restoreBackup(data: unknown): Promise<{ receipts: number; before: PhoneData }> {
  const backup = readBackup(data);
  const thumbs = await Promise.all((backup.thumbs ?? []).map(async (t) => ({ receiptId: t.receiptId, image: await dataUrlToBlob(t.image) })));
  const before = await phoneData();
  // The phone now holds what that backup holds: it counts as backed up then, at the latest.
  const settings = (backup.settings ?? []).filter((s) => s.key !== LAST_BACKUP);
  const last = (backup.settings ?? []).find((s) => s.key === LAST_BACKUP)?.value;
  settings.push({ key: LAST_BACKUP, value: typeof last === 'string' && last > backup.exportedAt ? last : backup.exportedAt });
  await replaceAll({
    categories: backup.categories ?? [],
    stores: backup.stores ?? [],
    receipts: backup.receipts,
    items: backup.items ?? [],
    products: backup.products ?? [],
    thumbs,
    settings,
  });
  return { receipts: backup.receipts.length, before };
}

/** Puts back what was on the phone before a restore. */
export async function undoRestore(before: PhoneData): Promise<void> {
  await replaceAll(before);
}

export { LAST_BACKUP, backupDue } from './backup-due';

export async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await db.settings.get(key))?.value as T | undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}
