import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { exportBackup, restoreBackup } from '../src/db/backup';
import { db } from '../src/db/schema';
import type { Reading, ReadScan } from '../src/hooks/useReceiptReader';
import { forgetPending, highestId, keepPending, loadPending, pendingKey, photoFile, toPending } from '../src/scan/pending';

const photo = (id: number, text = `photo ${id}`) => ({ id, file: new File([text], `IMG_${id}.jpg`, { type: 'image/jpeg' }), url: '' });

const reading: Reading = {
  strategy: 'per-box',
  lines: [{ text: 'TOTAL 100.00', confidence: 0.98, y: 0, height: 20 }],
  report: { photoWidth: 1000, photoHeight: 2000, lineHeight: 20, tilt: 0, zoom: 1, parts: 1, closerLooks: 0, improved: 0, unclearLeft: 0, leftOut: false },
  ms: 1200,
};

const scan = (id: number, photos: ReturnType<typeof photo>[], addedAt = 1000): ReadScan => ({ id, photos, status: 'reading', addedAt });

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('receipts not saved yet', () => {
  it('keeps the photos and the readings so far, and gives them back as they were', async () => {
    const two = scan(5, [photo(3), photo(4, 'second')], 2000);
    await keepPending([toPending(two, (id) => (id === 3 ? reading : undefined)), toPending(scan(1, [photo(2)]), () => undefined)], []);

    const back = await loadPending();
    expect(back.map((p) => p.id)).toEqual([5, 1]); // newest first
    expect(back[0].readings).toEqual({ 3: reading });
    const file = photoFile(back[0].photos[1]);
    expect([file.name, file.type, await file.text()]).toEqual(['IMG_4.jpg', 'image/jpeg', 'second']);
    expect(highestId(back)).toBe(5);
  });

  it('writes a receipt again only when its photos or readings change', () => {
    const one = scan(1, [photo(2)]);
    const before = pendingKey(toPending(one, () => undefined));
    expect(pendingKey(toPending({ ...one, status: 'queued' }, () => undefined))).toBe(before);
    expect(pendingKey(toPending(one, () => reading))).not.toBe(before);
    expect(pendingKey(toPending({ ...one, photos: [photo(2), photo(3)] }, () => undefined))).not.toBe(before);
  });

  it('forgets a receipt once it is saved or thrown away', async () => {
    await keepPending([toPending(scan(1, [photo(2)]), () => undefined), toPending(scan(3, [photo(4)]), () => undefined)], []);
    await keepPending([], [1]);
    expect((await loadPending()).map((p) => p.id)).toEqual([3]);
    await forgetPending(3);
    expect(await loadPending()).toEqual([]);
  });

  it('is left out of backups, and a restore leaves it alone', async () => {
    await keepPending([toPending(scan(1, [photo(2)]), () => undefined)], []);
    const backup = await exportBackup();
    expect(backup).not.toHaveProperty('pending');
    await restoreBackup(backup);
    expect((await loadPending()).map((p) => p.id)).toEqual([1]);
  });
});
