import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { exportBackup, restoreBackup } from '../src/db/backup';
import {
  deleteReceipt,
  ensureSeeded,
  findStore,
  restoreReceipt,
  saveReceipt,
  setItemCategory,
  updateReceipt,
  type DraftItem,
  type ReceiptDraft,
} from '../src/db/receipts';
import { db } from '../src/db/schema';

const item = (name: string, lineTotal: number, categoryId: string, source: DraftItem['categorySource'] = 'rule'): DraftItem => ({
  name,
  qty: 1,
  unitPrice: lineTotal,
  lineTotal,
  kind: 'item',
  vatCode: null,
  categoryId,
  categorySource: source,
});

function draft(overrides: Partial<ReceiptDraft> = {}): ReceiptDraft {
  return {
    storeId: null,
    storeName: 'Intermart',
    taxId: 'VAT27670358',
    date: '2026-10-07',
    total: 30000,
    paymentMethod: 'card',
    vatTotal: null,
    discountTotal: null,
    categoryId: 'groceries',
    items: [item('COLGATE TP JR MENTH', 11000, 'personal'), item('PERETTE VANILLE 250', 19000, 'groceries', 'shop')],
    source: 'scan',
    note: '',
    ...overrides,
  };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await ensureSeeded();
});

describe('saving a receipt', () => {
  it('stores the receipt, its items and how its total splits over categories', async () => {
    const id = await saveReceipt(draft());
    const receipt = (await db.receipts.get(id))!;
    expect(receipt).toMatchObject({ month: '2026-10', itemized: true, total: 30000 });
    expect(receipt.split).toEqual([
      { categoryId: 'groceries', amount: 19000 },
      { categoryId: 'personal', amount: 11000 },
    ]);
    expect(await db.items.where('receiptId').equals(id).count()).toBe(2);
  });

  it('remembers the shop and recognises it next time by its VAT number, whatever the OCR made of the name', async () => {
    await saveReceipt(draft());
    const store = await findStore('Pardenaire Intermarche', 'VAT 27670358');
    expect(store).toMatchObject({ name: 'Intermart', defaultCategoryId: 'groceries' });
    await saveReceipt(draft({ storeId: store!.id!, storeName: 'Pardenaire Intermarche' }));
    expect(await db.stores.count()).toBe(1);
    expect((await db.stores.get(store!.id!))!.aliases).toEqual(['Pardenaire Intermarche']);
  });

  it('remembers products the person put in a category themselves', async () => {
    await saveReceipt(draft({ items: [item('PERETTE VANILLE 250', 30000, 'groceries.dairy', 'you')] }));
    expect(await db.products.get('PERETTE VANILLE 250')).toMatchObject({ categoryId: 'groceries.dairy' });
  });

  it('keeps no items for a receipt whose items did not add up', async () => {
    const id = await saveReceipt(draft({ items: [] }));
    expect((await db.receipts.get(id))!).toMatchObject({ itemized: false, split: [{ categoryId: 'groceries', amount: 30000 }] });
  });
});

describe('changing a receipt', () => {
  it('moves the items that followed the shop with a new main category, and the shop learns it', async () => {
    const id = await saveReceipt(draft());
    await updateReceipt(id, { categoryId: 'household' });
    const items = await db.items.where('receiptId').equals(id).sortBy('name');
    expect(items.map((i) => [i.name, i.categoryId])).toEqual([
      ['COLGATE TP JR MENTH', 'personal'], // recognised by the rules: stays
      ['PERETTE VANILLE 250', 'household'], // only followed the shop: moves
    ]);
    expect((await db.receipts.get(id))!.split.map((s) => s.categoryId).sort()).toEqual(['household', 'personal']);
    expect((await findStore('Intermart', null))!.defaultCategoryId).toBe('household');
  });

  it('moves a product on every receipt once the person sets its category', async () => {
    const first = await saveReceipt(draft());
    const second = await saveReceipt(draft({ date: '2026-10-09' }));
    const item = (await db.items.where('receiptId').equals(first).toArray()).find((i) => i.name.startsWith('PERETTE'))!;
    await setItemCategory(item.id!, 'groceries.dairy');
    for (const id of [first, second]) {
      expect((await db.receipts.get(id))!.split).toContainEqual({ categoryId: 'groceries.dairy', amount: 19000 });
    }
  });

  it('can undo a delete', async () => {
    const id = await saveReceipt(draft(), { thumb: new Blob(['jpeg'], { type: 'image/jpeg' }) });
    const deleted = (await deleteReceipt(id))!;
    expect(await db.receipts.count()).toBe(0);
    expect(await db.items.count()).toBe(0);
    await restoreReceipt(deleted);
    expect((await db.receipts.get(id))!.total).toBe(30000);
    expect(await db.items.where('receiptId').equals(id).count()).toBe(2);
    expect(await db.thumbs.get(id)).toBeDefined();
  });

  it('changing the date moves the receipt and its items to the new month', async () => {
    const id = await saveReceipt(draft());
    await updateReceipt(id, { date: '2026-09-30' });
    expect((await db.receipts.get(id))!.month).toBe('2026-09');
    expect((await db.items.where('receiptId').equals(id).toArray()).every((i) => i.month === '2026-09')).toBe(true);
  });
});

describe('backup', () => {
  it('restores exactly what was backed up', async () => {
    await saveReceipt(draft(), { thumb: new Blob(['jpeg-bytes'], { type: 'image/jpeg' }) });
    const backup = JSON.parse(JSON.stringify(await exportBackup()));
    await Promise.all(db.tables.map((t) => t.clear()));
    expect(await restoreBackup(backup)).toEqual({ receipts: 1 });
    expect(await db.receipts.count()).toBe(1);
    expect(await db.categories.count()).toBeGreaterThan(10);
    const thumb = (await db.thumbs.toArray())[0];
    expect(await thumb.image.text()).toBe('jpeg-bytes');
  });

  it('refuses a file that is not a backup, in plain words', async () => {
    await expect(restoreBackup({ hello: 1 })).rejects.toThrow("This file isn't a Spent backup.");
  });
});
