import { db, type PendingReceipt } from '../db/schema';
import type { Reading, ReadScan } from '../hooks/useReceiptReader';

// Receipts being read or waiting to be checked, kept on the phone until they are saved or thrown
// away (docs/PLAN.md §14, step 2a). A phone short of memory closes the page while it reads, and
// photos taken with the app's camera button are usually nowhere else. Readings are kept too, so a
// receipt already read comes back ready to check without being read again.

/** What's kept of a receipt: its photos, and the readings of those read so far. */
export function toPending(scan: ReadScan, readingOf: (photoId: number) => Reading | undefined): PendingReceipt {
  const readings: PendingReceipt['readings'] = {};
  for (const p of scan.photos) {
    const reading = readingOf(p.id);
    if (reading) readings[p.id] = reading;
  }
  return {
    id: scan.id,
    photos: scan.photos.map((p) => ({ id: p.id, image: p.file, name: p.file.name })),
    readings,
    addedAt: scan.addedAt,
    joinedAutomatically: scan.joinedAutomatically,
  };
}

/** Changes when what's kept of a receipt does: it is only written again then (photos are big). */
export function pendingKey(p: PendingReceipt): string {
  return `${p.photos.map((ph) => ph.id).join()}|${Object.keys(p.readings).join()}|${p.joinedAutomatically ? 1 : 0}`;
}

/** Writes the receipts that changed and forgets the ones gone, together. */
export async function keepPending(changed: readonly PendingReceipt[], gone: readonly number[]): Promise<void> {
  if (!changed.length && !gone.length) return;
  await db.transaction('rw', db.pending, async () => {
    if (gone.length) await db.pending.bulkDelete([...gone]);
    if (changed.length) await db.pending.bulkPut([...changed]);
  });
}

export async function forgetPending(id: number): Promise<void> {
  await db.pending.delete(id);
}

/** Every receipt kept, newest first. */
export async function loadPending(): Promise<PendingReceipt[]> {
  return (await db.pending.toArray()).sort((a, b) => b.addedAt - a.addedAt);
}

/** A kept photo as the file it was (storage may give back a plain Blob). */
export function photoFile(photo: PendingReceipt['photos'][number]): File {
  return photo.image instanceof File ? photo.image : new File([photo.image], photo.name, { type: photo.image.type });
}

/** The highest id among kept receipts and their photos: new ids carry on from it. */
export function highestId(kept: readonly PendingReceipt[]): number {
  return Math.max(0, ...kept.flatMap((p) => [p.id, ...p.photos.map((ph) => ph.id)]));
}
