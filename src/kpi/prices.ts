import type { LineItem, Receipt } from '../db/schema';
import { SAME_PRODUCT, normalizeText, similarity } from '../parser/text';
import { receiptsAddingUp } from './adds-up';

// What the same product cost each time it was bought (docs/PLAN.md §5, price changes). Only
// receipts whose items come to their total count: one with a misread price would show a rise that
// never happened. A product is recognised by its name on the receipt: the
// same spelling, or one OCR read slightly differently as long as the numbers in it match, so
// "KETCHUP 500G" is never compared with "KETCHUP 300G".

export interface Purchase {
  receiptId: number;
  /** YYYY-MM-DD */
  date: string;
  month: string;
  storeName: string;
  /** As printed on that receipt. */
  name: string;
  /** cents, for one; for a kg when weighed at the till */
  price: number;
  perKg: boolean;
}

export interface ProductPrices {
  /** Every name key it was seen under; a link can use any of them. */
  keys: string[];
  /** As printed the last time, in its usual spelling (not one OCR misread). */
  name: string;
  /** One per receipt, oldest first. */
  purchases: Purchase[];
}

export interface PriceChange {
  product: ProductPrices;
  /** The last time it was bought (in the month asked for). */
  latest: Purchase;
  /** The time before, sold the same way (by weight or not); null when there is none. */
  previous: Purchase | null;
  /** cents, latest − previous; 0 for the same price or nothing to compare with */
  change: number;
  /** The change as a share of the previous price: 0.16 = 16% more. */
  ratio: number;
}

const byDate = (a: Purchase, b: Purchase) => a.date.localeCompare(b.date) || a.receiptId - b.receiptId;

/** Sizes and counts: "TOMATO SCE HEIN2 500G 2X" → "500 2". A digit inside a word is OCR misreading a letter. */
const numbersIn = (name: string) => normalizeText(name).match(/(?<![A-Z])\d+/g)?.join(' ') ?? '';

/** Every product bought on a receipt whose items add up, with what it cost each time. */
export function productPrices(items: readonly LineItem[], receipts: readonly Receipt[]): ProductPrices[] {
  const addingUp = receiptsAddingUp(items, receipts);
  const receiptsById = new Map(receipts.filter((r) => addingUp.has(r.id!)).map((r) => [r.id, r]));
  const byKey = new Map<string, Purchase[]>();
  for (const item of items) {
    const receipt = receiptsById.get(item.receiptId);
    if (!receipt || item.kind !== 'item' || item.unitPrice <= 0 || !item.productKey) continue;
    const list = byKey.get(item.productKey) ?? [];
    // The same product on two lines of one receipt is one purchase.
    if (list.some((p) => p.receiptId === item.receiptId)) continue;
    list.push({
      receiptId: item.receiptId,
      date: receipt.date,
      month: receipt.month,
      storeName: receipt.storeName,
      name: item.name,
      price: item.unitPrice,
      perKg: !Number.isInteger(item.qty),
    });
    byKey.set(item.productKey, list);
  }

  // The usual spelling first, so OCR's odd readings join it rather than the other way round.
  const products: Array<ProductPrices & { key: string; numbers: string }> = [];
  for (const [key, purchases] of [...byKey].sort((a, b) => b[1].length - a[1].length)) {
    const numbers = numbersIn(purchases[0].name);
    const same = products.find((p) => p.numbers === numbers && sameName(p.key, key));
    if (!same) {
      purchases.sort(byDate);
      products.push({ key, numbers, keys: [key], name: purchases.at(-1)!.name, purchases });
      continue;
    }
    same.keys.push(key);
    const seen = new Set(same.purchases.map((p) => p.receiptId));
    same.purchases.push(...purchases.filter((p) => !seen.has(p.receiptId)));
  }
  return products.map(({ keys, name, purchases }) => ({ keys, name, purchases: purchases.sort(byDate) }));
}

/** One product's name read two ways. The length check skips pairs too different to be close enough. */
function sameName(a: string, b: string): boolean {
  const [na, nb] = [a.length - 1, b.length - 1];
  return 2 * Math.min(na, nb) >= SAME_PRODUCT * (na + nb) && similarity(a, b) >= SAME_PRODUCT;
}

/**
 * The last price paid against the time before. With `month`: the last time it was bought in that
 * month, or null when it wasn't bought then.
 */
export function priceChange(product: ProductPrices, month?: string): PriceChange | null {
  const { purchases } = product;
  const at = month ? purchases.findLastIndex((p) => p.month === month) : purchases.length - 1;
  if (at < 0) return null;
  const latest = purchases[at];
  // A price for a kg is only compared with another price for a kg.
  const previous = purchases.slice(0, at).findLast((p) => p.perKg === latest.perKg) ?? null;
  const diff = previous ? latest.price - previous.price : 0;
  // Within a cent is the same price: one worked out from a multi-buy or a weight can round either way.
  const change = Math.abs(diff) <= 1 ? 0 : diff;
  return { product, latest, previous, change, ratio: previous ? change / previous.price : 0 };
}

/** Every product's last price against the time before (the last time in `month`, when given). */
export function priceChanges(products: readonly ProductPrices[], month?: string): PriceChange[] {
  return products.flatMap((p) => priceChange(p, month) ?? []);
}

export type PriceFilter = 'more' | 'less' | 'all';

/** What costs more (biggest rise first), less (biggest drop first), or everything (last bought first). */
export function filterChanges(changes: readonly PriceChange[], filter: PriceFilter): PriceChange[] {
  if (filter === 'more') return changes.filter((c) => c.change > 0).sort((a, b) => b.ratio - a.ratio);
  if (filter === 'less') return changes.filter((c) => c.change < 0).sort((a, b) => a.ratio - b.ratio);
  return [...changes].sort((a, b) => byDate(b.latest, a.latest));
}
