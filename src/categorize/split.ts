/** A receipt total shared out over categories, in cents. */
export type Split = Array<{ categoryId: string; amount: number }>;

/**
 * Shares a receipt's total over its items' categories, in proportion to what was spent in each.
 * Discounts, rounding and the odd cent the items miss by are spread the same way, so the parts
 * always add up to the total exactly (largest-remainder rounding). A receipt without items puts
 * its whole total in `fallback`.
 */
export function splitTotal(
  total: number,
  items: ReadonlyArray<{ categoryId: string; lineTotal: number; kind: 'item' | 'discount' }>,
  fallback: string,
): Split {
  const spent = new Map<string, number>();
  for (const item of items) {
    if (item.kind !== 'item' || item.lineTotal <= 0) continue;
    spent.set(item.categoryId, (spent.get(item.categoryId) ?? 0) + item.lineTotal);
  }
  const base = [...spent.values()].reduce((s, v) => s + v, 0);
  if (!base) return [{ categoryId: fallback, amount: total }];

  const shares = [...spent].map(([categoryId, v]) => {
    const exact = (total * v) / base;
    return { categoryId, amount: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let left = total - shares.reduce((s, x) => s + x.amount, 0);
  for (const s of [...shares].sort((a, b) => b.rest - a.rest)) {
    if (left <= 0) break;
    s.amount++;
    left--;
  }
  return shares.map(({ categoryId, amount }) => ({ categoryId, amount })).sort((a, b) => b.amount - a.amount);
}
