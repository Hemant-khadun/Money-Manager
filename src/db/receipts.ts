import { productKey } from '../categorize/categorize';
import { splitTotal } from '../categorize/split';
import { learnHints } from '../parser/hints';
import { matchStore, storeKey } from '../parser/store-match';
import type { OcrLine, PaymentMethod } from '../parser/types';
export { ensureSeeded } from './seed';
import { db, type CategorySource, type LineItem, type Receipt, type Store, type Thumb } from './schema';

// Saving and changing receipts. Every change keeps the receipt's split (its total shared over
// categories) up to date, and teaches the app: a shop's category, a product's category.

export interface DraftItem {
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  kind: 'item' | 'discount';
  vatCode: string | null;
  categoryId: string;
  categorySource: CategorySource;
  /** The reader wasn't sure of it (shown on the review screen, not saved). */
  unclear?: boolean;
}

/** A receipt as checked on the review screen (or typed in), ready to save. */
export interface ReceiptDraft {
  /** The known shop it was matched to, if any. */
  storeId: number | null;
  /** Shop name; for an expense without a receipt, what it was (may be empty). */
  storeName: string;
  taxId: string | null;
  date: string;
  total: number;
  paymentMethod: PaymentMethod | null;
  vatTotal: number | null;
  discountTotal: number | null;
  categoryId: string;
  /** As checked by the person; they may not add up to the total (the receipt then says so). */
  items: DraftItem[];
  source: 'scan' | 'manual';
  note: string;
}

/** The known shop a receipt's name / VAT number belongs to. */
export async function findStore(name: string | null, taxId: string | null): Promise<Store | null> {
  return matchStore({ name, taxId }, await db.stores.toArray())?.store ?? null;
}

/**
 * A saved receipt that looks like this one (the same photo chosen twice, or an expense added
 * twice): the same date and total, and the same shop when both say which.
 */
export async function findDuplicate(draft: Pick<ReceiptDraft, 'storeId' | 'storeName' | 'date' | 'total'>): Promise<Receipt | null> {
  if (!draft.date || !draft.total) return null;
  const name = storeKey(draft.storeName);
  const sameShop = (r: Receipt) => {
    if (draft.storeId !== null && r.storeId !== null) return draft.storeId === r.storeId;
    const saved = storeKey(r.storeName);
    return !name || !saved || name === saved;
  };
  return (await db.receipts.where('date').equals(draft.date).filter((r) => r.total === draft.total && sameShop(r)).first()) ?? null;
}

/**
 * Saves a checked receipt. The shop is created or updated (its category is the one just
 * confirmed, its receipt layout is learned from the OCR text), products the person put in a
 * category are remembered, and only a small picture is kept, never the photo or OCR text.
 */
export async function saveReceipt(draft: ReceiptDraft, extras: { ocrLines?: OcrLine[]; thumb?: Blob | null } = {}): Promise<number> {
  return db.transaction('rw', [db.stores, db.receipts, db.items, db.products, db.thumbs], async () => {
    const storeId = await rememberStore(draft, extras.ocrLines);
    for (const item of draft.items) {
      if (item.categorySource === 'you') await db.products.put({ key: productKey(item.name), name: item.name, categoryId: item.categoryId });
    }
    const month = draft.date.slice(0, 7);
    // Auto-increment keys: a saved row always has one.
    const receiptId = (await db.receipts.add({
      date: draft.date,
      month,
      storeId,
      storeName: draft.storeName.trim(),
      categoryId: draft.categoryId,
      total: draft.total,
      paymentMethod: draft.paymentMethod,
      vatTotal: draft.vatTotal,
      discountTotal: draft.discountTotal,
      itemized: draft.items.length > 0,
      source: draft.source,
      note: draft.note,
      split: splitTotal(draft.total, draft.items, draft.categoryId),
      createdAt: Date.now(),
    })) as number;
    await db.items.bulkAdd(
      draft.items.map(({ unclear: _, ...item }) => ({ ...item, receiptId, month, name: item.name.trim(), productKey: productKey(item.name) })),
    );
    if (extras.thumb) await db.thumbs.put({ receiptId, image: extras.thumb });
    return receiptId;
  });
}

async function rememberStore(draft: ReceiptDraft, ocrLines: OcrLine[] | undefined): Promise<number | null> {
  const name = draft.storeName.trim();
  if (!name) return null;
  const store = draft.storeId !== null ? await db.stores.get(draft.storeId) : await findStore(name, draft.taxId);
  const hints = ocrLines?.length ? learnHints(ocrLines, { total: draft.total, date: draft.date }, store?.hints) : (store?.hints ?? {});
  if (!store?.id) {
    return (await db.stores.add({ name, aliases: [], taxId: draft.taxId, defaultCategoryId: draft.categoryId, hints })) as number;
  }
  const spellings = [store.name, ...store.aliases].map(storeKey);
  await db.stores.update(store.id, {
    aliases: spellings.includes(storeKey(name)) ? store.aliases : [...store.aliases, name],
    taxId: store.taxId ?? draft.taxId,
    defaultCategoryId: draft.categoryId,
    hints,
  });
  return store.id;
}

/** Recomputes a receipt's split from its items (after any change to them or to the total). */
async function resplit(receiptId: number): Promise<void> {
  const receipt = await db.receipts.get(receiptId);
  if (!receipt) return;
  const items = await db.items.where('receiptId').equals(receiptId).toArray();
  await db.receipts.update(receiptId, { split: splitTotal(receipt.total, receipt.itemized ? items : [], receipt.categoryId) });
}

export type ReceiptChanges = Partial<Pick<Receipt, 'storeName' | 'date' | 'total' | 'paymentMethod' | 'categoryId' | 'note'>>;

/**
 * Changes a saved receipt. A new main category also moves the items that were only following
 * the shop, and becomes the shop's category from now on.
 */
export async function updateReceipt(id: number, changes: ReceiptChanges): Promise<void> {
  await db.transaction('rw', [db.receipts, db.items, db.stores], async () => {
    const receipt = await db.receipts.get(id);
    if (!receipt) return;
    const patch: Partial<Receipt> = { ...changes };
    if (changes.date) patch.month = changes.date.slice(0, 7);
    if (changes.storeName !== undefined) patch.storeName = changes.storeName.trim();
    await db.receipts.update(id, patch);
    const items = () => db.items.where('receiptId').equals(id);
    if (patch.month && patch.month !== receipt.month) await items().modify({ month: patch.month });
    if (changes.categoryId && changes.categoryId !== receipt.categoryId) {
      await items()
        .filter((i) => i.categorySource === 'shop')
        .modify({ categoryId: changes.categoryId });
      if (receipt.storeId !== null) await db.stores.update(receipt.storeId, { defaultCategoryId: changes.categoryId });
    }
    await resplit(id);
  });
}

/**
 * Puts an item in a category. The product is remembered, and the same product on other receipts
 * follows (unless the person set those by hand).
 */
export async function setItemCategory(itemId: number, categoryId: string): Promise<void> {
  await db.transaction('rw', [db.items, db.receipts, db.products], async () => {
    const item = await db.items.get(itemId);
    if (!item) return;
    await db.items.update(itemId, { categoryId, categorySource: 'you' });
    await db.products.put({ key: item.productKey, name: item.name, categoryId });
    const same = await db.items
      .where('productKey')
      .equals(item.productKey)
      .filter((i) => i.id !== itemId && i.categorySource !== 'you')
      .toArray();
    await db.items.bulkUpdate(same.map((i) => ({ key: i.id!, changes: { categoryId, categorySource: 'learned' as const } })));
    for (const receiptId of new Set([item.receiptId, ...same.map((i) => i.receiptId)])) await resplit(receiptId);
  });
}

export type ItemChanges = Partial<Pick<LineItem, 'name' | 'qty' | 'lineTotal'>>;

/**
 * Corrects an item that was read wrongly: its name, how many, what it cost (the price for one
 * follows). A new name is a new product: it takes the category known for that name, unless the
 * person chose this item's category themselves, which then goes with the new name.
 */
export async function updateItem(itemId: number, changes: ItemChanges): Promise<void> {
  await db.transaction('rw', [db.items, db.receipts, db.products], async () => {
    const item = await db.items.get(itemId);
    if (!item) return;
    const patch: Partial<LineItem> = {};
    const name = changes.name?.trim();
    if (name && name !== item.name) {
      patch.name = name;
      patch.productKey = productKey(name);
      const known = await db.products.get(patch.productKey);
      if (item.categorySource === 'you') {
        await db.products.put({ key: patch.productKey, name, categoryId: item.categoryId });
      } else if (known) {
        patch.categoryId = known.categoryId;
        patch.categorySource = 'learned';
      }
    }
    const qty = changes.qty ?? item.qty;
    const lineTotal = changes.lineTotal ?? item.lineTotal;
    if (qty > 0 && (qty !== item.qty || lineTotal !== item.lineTotal)) {
      patch.qty = qty;
      patch.lineTotal = lineTotal;
      patch.unitPrice = Math.round(lineTotal / qty);
    }
    if (!Object.keys(patch).length) return;
    await db.items.update(itemId, patch);
    await resplit(item.receiptId);
  });
}

export interface DeletedItems {
  receiptId: number;
  items: LineItem[];
  /** Whether the receipt kept its items before. */
  itemized: boolean;
}

/**
 * Takes a line off a receipt (one read by mistake). Once its last item is gone, the receipt keeps
 * its total only (discount lines on their own mean nothing). Returns what's needed to undo it.
 */
export async function deleteItem(itemId: number): Promise<DeletedItems | null> {
  return db.transaction('rw', [db.items, db.receipts], async () => {
    const item = await db.items.get(itemId);
    const receipt = item && (await db.receipts.get(item.receiptId));
    if (!item || !receipt) return null;
    await db.items.delete(itemId);
    const removed = [item];
    const left = await db.items.where('receiptId').equals(item.receiptId).toArray();
    if (!left.some((i) => i.kind === 'item')) {
      await db.items.bulkDelete(left.map((i) => i.id!));
      removed.push(...left);
      await db.receipts.update(item.receiptId, { itemized: false });
    }
    await resplit(item.receiptId);
    return { receiptId: item.receiptId, items: removed, itemized: receipt.itemized };
  });
}

export async function restoreItems(deleted: DeletedItems): Promise<void> {
  await db.transaction('rw', [db.items, db.receipts], async () => {
    if (!(await db.receipts.get(deleted.receiptId))) return;
    await db.items.bulkPut(deleted.items);
    await db.receipts.update(deleted.receiptId, { itemized: deleted.itemized });
    await resplit(deleted.receiptId);
  });
}

export interface DeletedReceipt {
  receipt: Receipt;
  items: LineItem[];
  thumb: Thumb | undefined;
}

/** Deletes a receipt; returns everything needed to undo it. */
export async function deleteReceipt(id: number): Promise<DeletedReceipt | null> {
  return db.transaction('rw', [db.receipts, db.items, db.thumbs], async () => {
    const receipt = await db.receipts.get(id);
    if (!receipt) return null;
    const items = await db.items.where('receiptId').equals(id).toArray();
    const thumb = await db.thumbs.get(id);
    await db.items.where('receiptId').equals(id).delete();
    await db.thumbs.delete(id);
    await db.receipts.delete(id);
    return { receipt, items, thumb };
  });
}

export async function restoreReceipt(deleted: DeletedReceipt): Promise<void> {
  await db.transaction('rw', [db.receipts, db.items, db.thumbs], async () => {
    await db.receipts.put(deleted.receipt);
    await db.items.bulkPut(deleted.items);
    if (deleted.thumb) await db.thumbs.put(deleted.thumb);
  });
}

/** Deletes several receipts at once (all or none); returns everything needed to undo it. */
export async function deleteReceipts(ids: readonly number[]): Promise<DeletedReceipt[]> {
  return db.transaction('rw', [db.receipts, db.items, db.thumbs], async () => {
    const deleted: DeletedReceipt[] = [];
    for (const id of ids) {
      const one = await deleteReceipt(id);
      if (one) deleted.push(one);
    }
    return deleted;
  });
}

export async function restoreReceipts(deleted: readonly DeletedReceipt[]): Promise<void> {
  await db.transaction('rw', [db.receipts, db.items, db.thumbs], async () => {
    for (const one of deleted) await restoreReceipt(one);
  });
}

export async function setBudget(categoryId: string, monthlyBudget: number | null): Promise<void> {
  await db.categories.update(categoryId, { monthlyBudget });
}
