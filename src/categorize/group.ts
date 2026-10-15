import type { Split } from './split';

export interface CategoryGroup<I> {
  categoryId: string;
  /** As printed on the receipt. */
  items: I[];
  /** What its items cost as printed, before discounts. */
  itemsTotal: number;
  /** Its share of what was paid (discounts spread over the categories): what the dashboard counts. */
  amount: number;
}

/**
 * A receipt's items grouped by category, the biggest share of the money first. Discount lines
 * are left out: they are shown apart, and already spread over the categories' amounts.
 */
export function groupByCategory<I extends { categoryId: string; lineTotal: number; kind: 'item' | 'discount' }>(
  items: readonly I[],
  split: Split,
): CategoryGroup<I>[] {
  const groups = new Map<string, CategoryGroup<I>>();
  for (const item of items) {
    if (item.kind !== 'item') continue;
    const group = groups.get(item.categoryId) ?? { categoryId: item.categoryId, items: [], itemsTotal: 0, amount: 0 };
    group.items.push(item);
    group.itemsTotal += item.lineTotal;
    groups.set(item.categoryId, group);
  }
  const share = new Map(split.map((part) => [part.categoryId, part.amount]));
  for (const group of groups.values()) group.amount = share.get(group.categoryId) ?? group.itemsTotal;
  return [...groups.values()].sort((a, b) => b.amount - a.amount || b.itemsTotal - a.itemsTotal);
}
