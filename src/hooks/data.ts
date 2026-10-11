import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../db/schema';
import { productPrices } from '../kpi/prices';

// Live views of the phone's data: screens update by themselves when a receipt is saved or changed.

export function useCategories() {
  return useLiveQuery(() => db.categories.orderBy('order').toArray(), []);
}

/** Receipts from month `from` to month `to` (YYYY-MM, both included). */
export function useReceiptsBetween(from: string, to: string) {
  return useLiveQuery(() => db.receipts.where('month').between(from, to, true, true).toArray(), [from, to]);
}

/** Every receipt, newest first. */
export function useAllReceipts() {
  return useLiveQuery(() => db.receipts.orderBy('date').reverse().toArray(), []);
}

export function useReceiptCount() {
  return useLiveQuery(() => db.receipts.count(), []);
}

/** undefined while loading, null when there is no such receipt (deleted). */
export function useReceipt(id: number) {
  return useLiveQuery(async () => (await db.receipts.get(id)) ?? null, [id]);
}

export function useReceiptItems(receiptId: number) {
  return useLiveQuery(() => db.items.where('receiptId').equals(receiptId).toArray(), [receiptId]);
}

/** Items bought in a month. */
export function useItemsInMonth(month: string) {
  return useLiveQuery(() => db.items.where('month').equals(month).toArray(), [month]);
}

/**
 * Everything bought on receipts whose items were read, by product, with what it cost each time;
 * plus how many receipts that is out of all of them.
 */
export function usePrices() {
  return useLiveQuery(async () => {
    const [receipts, items] = await Promise.all([db.receipts.toArray(), db.items.toArray()]);
    return { products: productPrices(items, receipts), itemized: receipts.filter((r) => r.itemized).length, receipts: receipts.length };
  }, []);
}

export function useStores() {
  return useLiveQuery(() => db.stores.toArray(), []);
}

/** A receipt's picture as an image URL (freed when no longer shown). */
export function useThumbUrl(receiptId: number | undefined) {
  const thumb = useLiveQuery(() => (receiptId === undefined ? undefined : db.thumbs.get(receiptId)), [receiptId]);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!thumb) return setUrl(null);
    const next = URL.createObjectURL(thumb.image);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [thumb]);
  return url;
}
