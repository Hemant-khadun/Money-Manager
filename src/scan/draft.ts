import { categorizeItem, guessShopCategory } from '../categorize/categorize';
import { findStore, type DraftItem, type ReceiptDraft } from '../db/receipts';
import { db } from '../db/schema';
import { monthName } from '../kpi/monthly';
import { daysBetween } from '../parser/dates';
import type { ParsedReceipt } from '../parser/types';

// From what the reader found on a receipt to a draft the person checks before saving.

/** A receipt dated further back than this is likely a misread or misprinted year, so the date is to be checked. */
const OLD_AFTER_DAYS = 60;

/**
 * The date a scanned receipt starts with, and a note when it needs checking. A date in the future
 * is a misreading (and would put the receipt in a month Overview can't show): today is filled in.
 * One from long ago is kept, as it may be an old receipt; but receipts are mostly scanned soon
 * after shopping, and some tills print the wrong year, so a date months back is pointed out.
 */
export function dateFromScan(parsed: Pick<ParsedReceipt, 'date' | 'warnings'>, today: string): { date: string; note: string | null } {
  if (!parsed.date || parsed.date > today) return { date: today, note: "Couldn't read the date: check it." };
  if (parsed.warnings.includes('date-implausible')) return { date: parsed.date, note: 'This date looks wrong: check it.' };
  if (daysBetween(parsed.date, today) > OLD_AFTER_DAYS) {
    return { date: parsed.date, note: `This receipt says ${monthName(parsed.date.slice(0, 7), Number(today.slice(0, 4)))}. If it's recent, change the date.` };
  }
  return { date: parsed.date, note: null };
}

/**
 * The draft for a scanned receipt: the known shop (by VAT number or name) and its category, or a
 * guess for a new shop; every item read put in a category. The person corrects the items on the
 * review screen, where they see whether they add up to the total; they are saved as shown there.
 */
export async function draftFromScan(parsed: ParsedReceipt, today: string): Promise<ReceiptDraft> {
  const store = await findStore(parsed.storeName, parsed.taxId);
  const products = await db.products.toArray();
  const shopCategory = store?.defaultCategoryId ?? guessShopCategory(parsed.storeName, parsed.items);
  const items = parsed.items;
  return {
    storeId: store?.id ?? null,
    storeName: store?.name ?? parsed.storeName ?? '',
    taxId: parsed.taxId,
    date: dateFromScan(parsed, today).date,
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
        unclear: item.unclear,
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

/** What the person can change about an item. */
export type ItemFields = Pick<DraftItem, 'name' | 'qty' | 'lineTotal' | 'categoryId'>;

/**
 * The person corrects item `index`, or adds one the reader missed (`index` null). It counts as
 * checked; a category they chose is remembered for that product when saved.
 */
export function withItem(draft: ReceiptDraft, index: number | null, fields: ItemFields): ReceiptDraft {
  const before = index === null ? null : draft.items[index];
  const priceChanged = !before || fields.qty !== before.qty || fields.lineTotal !== before.lineTotal;
  const item: DraftItem = {
    ...(before ?? { kind: 'item', vatCode: null, unitPrice: 0, categorySource: 'you' }),
    name: fields.name.trim(),
    qty: fields.qty,
    lineTotal: fields.lineTotal,
    unitPrice: priceChanged ? Math.round(fields.lineTotal / fields.qty) : before.unitPrice,
    categoryId: fields.categoryId,
    categorySource: before && fields.categoryId === before.categoryId ? before.categorySource : 'you',
    unclear: false,
  };
  return { ...draft, items: index === null ? [...draft.items, item] : draft.items.map((i, k) => (k === index ? item : i)) };
}

/** The person takes off a line that isn't an item (read by mistake, or counted twice). */
export function withoutItem(draft: ReceiptDraft, index: number): ReceiptDraft {
  return { ...draft, items: draft.items.filter((_, k) => k !== index) };
}
