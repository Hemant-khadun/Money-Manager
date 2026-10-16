import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { LAST_BACKUP, backupDue, exportBackup, getSetting, readBackup, restoreBackup, restoreQuestion, undoRestore } from '../src/db/backup';
import {
  deleteItem,
  deleteReceipt,
  deleteReceipts,
  ensureSeeded,
  findDuplicate,
  findStore,
  restoreItems,
  restoreReceipt,
  restoreReceipts,
  saveReceipt,
  setItemCategory,
  updateItem,
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

  it('does not save which items the reader was unsure of (that is only for checking)', async () => {
    const id = await saveReceipt(draft({ items: [{ ...item('COLGATE TP JR MENTH', 11000, 'personal'), unclear: true }, item('PERETTE VANILLE 250', 19000, 'groceries')] }));
    expect((await db.items.where('receiptId').equals(id).toArray()).some((i) => 'unclear' in i)).toBe(false);
  });

  it('puts the whole total of a receipt without items in its category', async () => {
    const id = await saveReceipt(draft({ items: [] }));
    expect((await db.receipts.get(id))!).toMatchObject({ itemized: false, split: [{ categoryId: 'groceries', amount: 30000 }] });
  });

  it('keeps the items the person saw even when they do not add up, the total shared out over them', async () => {
    // One price read wrongly: the items come to Rs 310.00, the receipt says Rs 300.00.
    const id = await saveReceipt(draft({ items: [item('COLGATE TP JR MENTH', 12000, 'personal'), item('PERETTE VANILLE 250', 19000, 'groceries', 'shop')] }));
    const receipt = (await db.receipts.get(id))!;
    expect(receipt).toMatchObject({ itemized: true, total: 30000 });
    expect(await db.items.where('receiptId').equals(id).count()).toBe(2);
    expect(receipt.split.reduce((sum, s) => sum + s.amount, 0)).toBe(30000);
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

describe('changing an item', () => {
  const itemsOf = (id: number) => db.items.where('receiptId').equals(id).sortBy('name');

  it('corrects a price: the price for one follows, and the split with it', async () => {
    const id = await saveReceipt(draft());
    const colgate = (await itemsOf(id))[0];
    await updateItem(colgate.id!, { qty: 2, lineTotal: 22000 });
    expect(await db.items.get(colgate.id!)).toMatchObject({ qty: 2, unitPrice: 11000, lineTotal: 22000 });
    // The total stays as it was, shared out by what each category's items now cost.
    expect((await db.receipts.get(id))!.split).toEqual([
      { categoryId: 'personal', amount: 16098 },
      { categoryId: 'groceries', amount: 13902 },
    ]);
  });

  it('a corrected name is the product from then on, with the category known for it', async () => {
    await db.products.put({ key: 'PERRETTE VANILLE 250', name: 'PERRETTE VANILLE 250', categoryId: 'groceries.dairy' });
    const id = await saveReceipt(draft());
    const perette = (await itemsOf(id))[1];
    await updateItem(perette.id!, { name: ' PERRETTE VANILLE 250 ' });
    expect(await db.items.get(perette.id!)).toMatchObject({
      name: 'PERRETTE VANILLE 250',
      productKey: 'PERRETTE VANILLE 250',
      categoryId: 'groceries.dairy',
      categorySource: 'learned',
    });
  });

  it('a category the person chose goes with the corrected name', async () => {
    const id = await saveReceipt(draft());
    const colgate = (await itemsOf(id))[0];
    await setItemCategory(colgate.id!, 'pharmacy');
    await updateItem(colgate.id!, { name: 'COLGATE TP JR MINT' });
    expect(await db.products.get('COLGATE TP JR MINT')).toMatchObject({ categoryId: 'pharmacy' });
    expect(await db.items.get(colgate.id!)).toMatchObject({ categoryId: 'pharmacy', categorySource: 'you' });
  });

  it('deleting the last item keeps the total only, and can be undone', async () => {
    const id = await saveReceipt(draft({ items: [item('COLGATE TP JR MENTH', 30500, 'personal'), { ...item('Discounts', -500, 'groceries'), kind: 'discount' }] }));
    const colgate = (await itemsOf(id))[0];
    const deleted = (await deleteItem(colgate.id!))!;
    expect(await db.items.where('receiptId').equals(id).count()).toBe(0); // the discount line went too
    expect(await db.receipts.get(id)).toMatchObject({ itemized: false, split: [{ categoryId: 'groceries', amount: 30000 }] });
    await restoreItems(deleted);
    expect(await db.items.where('receiptId').equals(id).count()).toBe(2);
    expect(await db.receipts.get(id)).toMatchObject({ itemized: true, split: [{ categoryId: 'personal', amount: 30000 }] });
  });
});

describe('deleting several receipts', () => {
  it('deletes them all, and brings them all back on undo', async () => {
    const ids = [await saveReceipt(draft()), await saveReceipt(draft({ date: '2026-10-09' })), await saveReceipt(draft({ date: '2026-10-10' }))];
    const deleted = await deleteReceipts([ids[0], ids[2], 999]);
    expect(deleted).toHaveLength(2);
    expect((await db.receipts.toArray()).map((r) => r.id)).toEqual([ids[1]]);
    expect(await db.items.count()).toBe(2);
    await restoreReceipts(deleted);
    expect(await db.receipts.count()).toBe(3);
    expect(await db.items.count()).toBe(6);
  });
});

describe('backup', () => {
  it('restores exactly what was backed up', async () => {
    await saveReceipt(draft(), { thumb: new Blob(['jpeg-bytes'], { type: 'image/jpeg' }) });
    const backup = JSON.parse(JSON.stringify(await exportBackup()));
    await Promise.all(db.tables.map((t) => t.clear()));
    expect(await restoreBackup(backup)).toMatchObject({ receipts: 1 });
    expect(await db.receipts.count()).toBe(1);
    expect(await db.categories.count()).toBeGreaterThan(10);
    const thumb = (await db.thumbs.toArray())[0];
    expect(await thumb.image.text()).toBe('jpeg-bytes');
  });

  it('refuses a file that is not a backup, in plain words', async () => {
    await expect(restoreBackup({ hello: 1 })).rejects.toThrow("This file isn't a Money Manager backup.");
  });

  it('says what is in the file and on the phone before replacing', async () => {
    await saveReceipt(draft());
    const backup = readBackup(JSON.parse(JSON.stringify({ ...(await exportBackup()), exportedAt: '2026-09-12T08:00:00.000Z' })));
    expect(restoreQuestion(backup, 120)).toBe('This backup is from 12 Sept 2026, with 1 receipt. This phone has 120. Replace them?');
    expect(restoreQuestion(backup, 0)).toBe('This backup is from 12 Sept 2026, with 1 receipt. Restore it?');
  });

  it('can undo a restore: everything on the phone comes back as it was', async () => {
    await saveReceipt(draft({ storeName: 'Winners' }));
    const older = JSON.parse(JSON.stringify(await exportBackup()));
    await saveReceipt(draft({ storeName: 'Intermart' }), { thumb: new Blob(['jpeg-bytes'], { type: 'image/jpeg' }) });
    await saveReceipt(draft({ storeName: 'Jumbo' }));

    const { receipts, before } = await restoreBackup(older);
    expect(receipts).toBe(1);
    expect((await db.receipts.toArray()).map((r) => r.storeName)).toEqual(['Winners']);
    // The phone now holds that backup: it counts as backed up then.
    expect(await getSetting(LAST_BACKUP)).toBe(older.exportedAt);

    await undoRestore(before);
    expect((await db.receipts.toArray()).map((r) => r.storeName)).toEqual(['Winners', 'Intermart', 'Jumbo']);
    expect(await db.items.count()).toBe(before.items.length);
    expect(await (await db.thumbs.toArray())[0].image.text()).toBe('jpeg-bytes');
    expect(await getSetting(LAST_BACKUP)).toBeUndefined();
  });
});

describe('findDuplicate', () => {
  it('finds a saved receipt with the same date, total and shop', async () => {
    const id = await saveReceipt(draft());
    expect((await findDuplicate(draft()))?.id).toBe(id);
    // The shop as typed on the review screen, with a different spelling of the same name.
    expect((await findDuplicate({ ...draft(), storeName: 'INTERMART LTD' }))?.id).toBe(id);
  });

  it('a different day, total or shop is a different receipt', async () => {
    await saveReceipt(draft());
    expect(await findDuplicate(draft({ date: '2026-10-08' }))).toBeNull();
    expect(await findDuplicate(draft({ total: 30100 }))).toBeNull();
    expect(await findDuplicate(draft({ storeName: 'Winners' }))).toBeNull();
  });

  it('an expense without a shop name matches on date and total alone', async () => {
    const id = await saveReceipt(draft({ storeName: '', taxId: null, source: 'manual', items: [] }));
    expect((await findDuplicate({ storeId: null, storeName: '', date: '2026-10-07', total: 30000 }))?.id).toBe(id);
    expect((await findDuplicate({ storeId: null, storeName: 'Bus fare', date: '2026-10-07', total: 30000 }))?.id).toBe(id);
  });
});

describe('backupDue', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  const day = 86_400_000;

  it('stays quiet with no receipts', () => {
    expect(backupDue({ now, lastBackupAt: undefined, firstReceiptAt: undefined })).toBe(false);
  });

  it('reminds when the last backup is over 30 days old', () => {
    expect(backupDue({ now, lastBackupAt: new Date(now - 29 * day).toISOString(), firstReceiptAt: now - 90 * day })).toBe(false);
    expect(backupDue({ now, lastBackupAt: new Date(now - 31 * day).toISOString(), firstReceiptAt: now - 90 * day })).toBe(true);
  });

  it('never backed up: reminds a week after the first receipt', () => {
    expect(backupDue({ now, lastBackupAt: undefined, firstReceiptAt: now - 6 * day })).toBe(false);
    expect(backupDue({ now, lastBackupAt: undefined, firstReceiptAt: now - 8 * day })).toBe(true);
  });
});
