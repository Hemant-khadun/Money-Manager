import { describe, expect, it } from 'vitest';
import { productKey } from '../src/categorize/categorize';
import type { LineItem, Receipt } from '../src/db/schema';
import { filterChanges, priceChange, priceChanges, productPrices } from '../src/kpi/prices';

const receipts: Receipt[] = [];
const items: LineItem[] = [];

function receipt(date: string, storeName: string, lines: Array<[name: string, unitPrice: number, qty?: number]>): void {
  const id = receipts.length + 1;
  receipts.push({
    id,
    date,
    month: date.slice(0, 7),
    storeId: null,
    storeName,
    categoryId: 'groceries',
    total: 0,
    paymentMethod: 'card',
    vatTotal: null,
    discountTotal: null,
    itemized: true,
    source: 'scan',
    note: '',
    split: [],
    createdAt: id,
  });
  for (const [name, unitPrice, qty = 1] of lines) {
    items.push({
      id: items.length + 1,
      receiptId: id,
      month: date.slice(0, 7),
      name,
      productKey: productKey(name),
      categoryId: 'groceries',
      categorySource: 'rule',
      qty,
      unitPrice,
      lineTotal: Math.round(unitPrice * qty),
      kind: unitPrice < 0 ? 'discount' : 'item',
      vatCode: null,
    });
  }
}

receipt('2026-08-30', 'Intermart', [
  ['TOMATO SCE HEINZ 500G', 4500],
  ['KETCHUP HEINZ TOP DOWN 300G', 6000],
  ['BANANES', 8000, 0.75], // weighed: Rs 80 a kg
]);
receipt('2026-09-14', 'Winners', [
  ['TOMATO SCE HEINZ 500G', 4200],
  ['LAIT UHT 1L', 3800],
  ['KETCHUP HEINZ TOP DOWN 500G', 9000], // a close name, but a different size
]);
receipt('2026-09-20', 'Intermart', [['BANANES', 9500]]); // a bunch, not weighed
receipt('2026-10-03', 'Intermart', [
  ['TOMATO SCE HEIN2 500G', 5200], // OCR misreading the same product
  ['LAIT UHT 1L', 3500],
  ['LAIT UHT 1L', 3500], // bought on two lines
  ['BANANES', 9000, 1.2],
  ['KETCHUP HEINZ TOP DOWN 300G', 6001], // a cent of rounding is the same price
]);
receipt('2026-10-06', 'Intermart', [
  ['RIZ BASMATI 1KG', 9900],
  ['PROMO RIZ', -500],
]);

const products = productPrices(items, receipts);
const named = (name: string) => products.find((p) => p.name.startsWith(name))!;

describe('productPrices', () => {
  it('joins OCR misreadings of one name, but never different sizes', () => {
    expect(named('TOMATO').keys).toHaveLength(2);
    expect(named('TOMATO').purchases.map((p) => p.price)).toEqual([4500, 4200, 5200]);
    expect(products.filter((p) => p.name.startsWith('KETCHUP')).map((p) => p.name)).toEqual(['KETCHUP HEINZ TOP DOWN 300G', 'KETCHUP HEINZ TOP DOWN 500G']);
  });

  it('counts a product once per receipt, oldest first, named as usually printed', () => {
    expect(named('LAIT').purchases.map((p) => [p.date, p.price])).toEqual([
      ['2026-09-14', 3800],
      ['2026-10-03', 3500],
    ]);
    expect(named('TOMATO').name).toBe('TOMATO SCE HEINZ 500G');
  });

  it('leaves out discounts', () => {
    expect(products.map((p) => p.name)).not.toContain('PROMO RIZ');
  });
});

describe('priceChange', () => {
  it('compares the last price with the time before, at whichever shop', () => {
    const c = priceChange(named('TOMATO'))!;
    expect([c.previous?.storeName, c.previous?.price, c.latest.price, c.change]).toEqual(['Winners', 4200, 5200, 1000]);
    expect(c.ratio).toBeCloseTo(1000 / 4200);
  });

  it('compares a price for a kg only with another price for a kg', () => {
    expect(priceChange(named('BANANES'))).toMatchObject({ latest: { perKg: true, price: 9000 }, previous: { date: '2026-08-30', price: 8000 }, change: 1000 });
    expect(priceChange(named('BANANES'), '2026-09')).toMatchObject({ latest: { perKg: false }, previous: null, change: 0 });
  });

  it('treats a cent of rounding as the same price', () => {
    expect(priceChange(named('KETCHUP HEINZ TOP DOWN 300G'))).toMatchObject({ change: 0, ratio: 0 });
  });

  it('with a month, uses the last time it was bought that month', () => {
    expect(priceChange(named('TOMATO'), '2026-09')).toMatchObject({ change: -300, latest: { date: '2026-09-14' } });
    expect(priceChange(named('LAIT'), '2026-08')).toBeNull();
    expect(priceChange(named('RIZ'))).toMatchObject({ previous: null, change: 0 });
  });
});

describe('filterChanges', () => {
  const changes = priceChanges(products);

  it('lists what costs more, biggest rise first', () => {
    expect(filterChanges(changes, 'more').map((c) => c.product.name)).toEqual(['TOMATO SCE HEINZ 500G', 'BANANES']);
  });

  it('lists what costs less, biggest drop first', () => {
    expect(filterChanges(changes, 'less').map((c) => c.product.name)).toEqual(['LAIT UHT 1L']);
  });

  it('lists everything, last bought first', () => {
    expect(filterChanges(changes, 'all').map((c) => c.latest.date)).toEqual(['2026-10-06', '2026-10-03', '2026-10-03', '2026-10-03', '2026-10-03', '2026-09-14']);
  });

  it('only counts products bought in the month when given one', () => {
    expect(priceChanges(products, '2026-09').map((c) => c.product.name).sort()).toEqual(['BANANES', 'KETCHUP HEINZ TOP DOWN 500G', 'LAIT UHT 1L', 'TOMATO SCE HEINZ 500G']);
  });
});
