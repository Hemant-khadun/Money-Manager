import { db, type Category, type LineItem, type Product, type Receipt, type Setting, type Store } from './schema';

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

/** Replaces everything on this phone with the backup's contents. */
export async function restoreBackup(data: unknown): Promise<{ receipts: number }> {
  const backup = data as Partial<Backup>;
  if (!backup || backup.app !== APP || !Array.isArray(backup.receipts)) {
    throw new BackupError("This file isn't a Money Manager backup.");
  }
  if ((backup.version ?? 0) > VERSION) throw new BackupError('This backup was made by a newer version of Money Manager. Update the app first.');
  const thumbs = await Promise.all((backup.thumbs ?? []).map(async (t) => ({ receiptId: t.receiptId, image: await dataUrlToBlob(t.image) })));
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    await db.categories.bulkAdd(backup.categories ?? []);
    await db.stores.bulkAdd(backup.stores ?? []);
    await db.receipts.bulkAdd(backup.receipts ?? []);
    await db.items.bulkAdd(backup.items ?? []);
    await db.products.bulkAdd(backup.products ?? []);
    await db.thumbs.bulkAdd(thumbs);
    await db.settings.bulkAdd(backup.settings ?? []);
  });
  return { receipts: backup.receipts.length };
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await db.settings.get(key))?.value as T | undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}
