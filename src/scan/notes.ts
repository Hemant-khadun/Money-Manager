import type { ReadScan } from '../hooks/useReceiptReader';

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
