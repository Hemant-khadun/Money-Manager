import { describe, expect, it } from 'vitest';
import type { LineItem } from '../src/db/schema';
import { hasText, itemMatches } from '../src/lib/search';

const item = (receiptId: number, name: string, kind: LineItem['kind'] = 'item'): LineItem => ({
  receiptId,
  month: '2026-10',
  name,
  productKey: name.toLowerCase(),
  categoryId: 'groceries',
  categorySource: 'rule',
  qty: 1,
  unitPrice: 100,
  lineTotal: kind === 'item' ? 100 : -100,
  kind,
  vatCode: null,
});

describe('search', () => {
  it('ignores case, accents and extra spaces', () => {
    expect(hasText('CAFÉ  MOULU', 'cafe moulu')).toBe(true);
    expect(hasText('Pampers nappies', 'NAPPIES')).toBe(true);
    expect(hasText('Pampers nappies', 'wipes')).toBe(false);
    expect(hasText('anything', '   ')).toBe(false);
  });

  it("finds the receipts an item was on, naming the first match, and skips discounts", () => {
    const items = [item(1, 'BREAD'), item(2, 'NAPPIES PAMPERS 4'), item(2, 'NAPPIES HUGGIES'), item(3, 'NAPPIES OFFER', 'discount'), item(4, 'Milk')];
    expect(itemMatches(items, 'nappies')).toEqual(new Map([[2, 'NAPPIES PAMPERS 4']]));
    expect(itemMatches(items, '')).toEqual(new Map());
  });
});
