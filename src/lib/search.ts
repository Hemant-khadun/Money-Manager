import type { LineItem } from '../db/schema';
import { normalizeText } from '../parser/text';

// Finding receipts by what was on them: "nappies" finds the receipt the nappies were on.

/** Whether `text` has `query` in it, ignoring case, accents and extra spaces. */
export function hasText(text: string, query: string): boolean {
  const q = normalizeText(query);
  return !!q && normalizeText(text).includes(q);
}

/** The receipts with an item matching `query`, each with the first such item's name, by receipt id. Discount lines don't count. */
export function itemMatches(items: readonly LineItem[], query: string): Map<number, string> {
  const found = new Map<number, string>();
  for (const item of items) {
    if (item.kind === 'item' && !found.has(item.receiptId) && hasText(item.name, query)) found.set(item.receiptId, item.name);
  }
  return found;
}
