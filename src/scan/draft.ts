import { categorizeItem, guessShopCategory } from '../categorize/categorize';
import { findStore, type ReceiptDraft } from '../db/receipts';
import { db } from '../db/schema';
import type { ParsedReceipt } from '../parser/types';

// From what the reader found on a receipt to a draft the person checks before saving.

/**
 * The draft for a scanned receipt: the known shop (by VAT number or name) and its category, or a
 * guess for a new shop; every item put in a category. Items are only kept when they add up to the
 * total, so wrong item data never gets in.
 */
export async function draftFromScan(parsed: ParsedReceipt, today: string): Promise<ReceiptDraft> {
  const store = await findStore(parsed.storeName, parsed.taxId);
  const products = await db.products.toArray();
  const shopCategory = store?.defaultCategoryId ?? guessShopCategory(parsed.storeName, parsed.items);
  const items = parsed.itemsAddUp ? parsed.items : [];
  return {
    storeId: store?.id ?? null,
    storeName: store?.name ?? parsed.storeName ?? '',
    taxId: parsed.taxId,
    date: parsed.date ?? today,
    total: parsed.total ?? 0,
    paymentMethod: parsed.paymentMethod,
    vatTotal: parsed.vatTotal,
    discountTotal: parsed.discountTotal,
    categoryId: shopCategory,
    items: items.map((item) => {
      const placed =
        item.kind === 'discount' ? { categoryId: shopCategory, source: 'shop' as const } : categorizeItem(item.name, shopCategory, products);
      return {
        name: item.name,
        qty: item.qty,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
        kind: item.kind,
        vatCode: item.vatCode ?? null,
        categoryId: placed.categoryId,
        categorySource: placed.source,
      };
    }),
    source: 'scan',
    note: '',
  };
}

/** A new main category: items that were only following the shop come along. */
export function withMainCategory(draft: ReceiptDraft, categoryId: string): ReceiptDraft {
  return {
    ...draft,
    categoryId,
    items: draft.items.map((i) => (i.categorySource === 'shop' ? { ...i, categoryId } : i)),
  };
}

/** The person puts one item in a category (remembered for that product when saved). */
export function withItemCategory(draft: ReceiptDraft, index: number, categoryId: string): ReceiptDraft {
  return { ...draft, items: draft.items.map((i, k) => (k === index ? { ...i, categoryId, categorySource: 'you' as const } : i)) };
}
