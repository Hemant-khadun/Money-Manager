import type { ReadScan } from '../hooks/useReceiptReader';
import { storeKey } from '../parser/store-match';

/**
 * The receipt seems to go on past the photo: writing was read, but no line saying it is the total
 * (printed near the end). Any total found is then only a guess, the biggest amount: on the top of
 * a long receipt, an item's price. (The photo may also just be hard to read there.)
 */
export function looksCutOff(scan: ReadScan): boolean {
  return scan.status === 'done' && !!scan.lines?.length && scan.parsed?.totalConfidence === 'low';
}

/**
 * Receipts in the list that look like another one in it (the same photo chosen twice): the same
 * shop, date and total. Returns their ids.
 */
export function sameAsAnother(scans: readonly ReadScan[]): Set<number> {
  const byKey = new Map<string, number[]>();
  for (const s of scans) {
    const p = s.parsed;
    if (s.status !== 'done' || !p?.storeName || !p.date || !p.total) continue;
    const key = `${storeKey(p.storeName)}|${p.date}|${p.total}`;
    byKey.set(key, [...(byKey.get(key) ?? []), s.id]);
  }
  return new Set([...byKey.values()].filter((ids) => ids.length > 1).flat());
}

/** Problems joining the photos of a long receipt, in plain words. */
export function joinNotes(scan: ReadScan): string[] {
  if (!scan.joins || scan.photos.length < 2) return [];
  const notes = scan.joins.flatMap((join, k) =>
    join
      ? []
      : [
          `Couldn't find where photo ${k + 2} continues from photo ${k + 1}, so some lines may be missing or counted twice. Take them again so that photo ${k + 2} starts with the last two or three lines of photo ${k + 1}.`,
        ],
  );
  const added = scan.photos.map((p) => p.id).join();
  if (scan.order && scan.order.join() !== added && scan.joins.every(Boolean)) {
    notes.push('The photos were out of order, so they were put in order from top to bottom.');
  }
  return notes;
}
