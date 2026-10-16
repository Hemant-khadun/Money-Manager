import type { LineItem, Receipt } from '../db/schema';

// Whether a receipt's items come to its total. Items are saved as the person checked them, even
// when they don't (docs/PLAN.md §10), so anything that trusts single prices (price changes) only
// uses receipts that do: one misread price would otherwise show as a big rise. Worked out each
// time, so a receipt counts again as soon as it is fixed.

/** Items and a total that differ by no more than this (cents) add up: Rs 1, as when a receipt is read (parser/items). */
export const ADDS_UP = 100;

/** Whether a receipt's items (discounts included) come to its total. */
export function itemsAddUp(items: ReadonlyArray<{ lineTotal: number }>, total: number): boolean {
  return items.length > 0 && Math.abs(items.reduce((sum, i) => sum + i.lineTotal, 0) - total) <= ADDS_UP;
}

/** The ids of the receipts whose items were kept and come to their total. */
export function receiptsAddingUp(items: readonly LineItem[], receipts: readonly Receipt[]): Set<number> {
  const sums = new Map<number, number>();
  for (const item of items) sums.set(item.receiptId, (sums.get(item.receiptId) ?? 0) + item.lineTotal);
  const ids = new Set<number>();
  for (const r of receipts) {
    const sum = sums.get(r.id!);
    if (r.itemized && sum !== undefined && Math.abs(sum - r.total) <= ADDS_UP) ids.add(r.id!);
  }
  return ids;
}
