import { describe, expect, it } from 'vitest';
import { groupByCategory } from '../src/categorize/group';
import { splitTotal } from '../src/categorize/split';

const item = (name: string, categoryId: string, lineTotal: number) => ({ name, categoryId, lineTotal, kind: 'item' as const });

describe('groupByCategory', () => {
  const items = [
    item('LAIT UHT 1L', 'groceries.dairy', 4500),
    item('BANANES', 'groceries.fresh', 10272),
    item('YAOURT', 'groceries.dairy', 3000),
    { name: 'PROMO', categoryId: 'groceries', lineTotal: -1000, kind: 'discount' as const },
  ];
  const split = splitTotal(16772, items, 'groceries');
  const groups = groupByCategory(items, split);

  it('puts the biggest share of the money first, items in printed order', () => {
    expect(groups.map((g) => [g.categoryId, g.items.map((i) => i.name)])).toEqual([
      ['groceries.fresh', ['BANANES']],
      ['groceries.dairy', ['LAIT UHT 1L', 'YAOURT']],
    ]);
  });
  it('counts what was paid (discounts spread out) as well as the printed prices', () => {
    expect(groups.map((g) => g.itemsTotal)).toEqual([10272, 7500]);
    expect(groups.reduce((sum, g) => sum + g.amount, 0)).toBe(16772);
    expect(groups[0].amount).toBeLessThan(10272);
  });
  it('leaves discount lines out of the groups', () => {
    expect(groups.flatMap((g) => g.items).some((i) => i.kind === 'discount')).toBe(false);
  });
});
