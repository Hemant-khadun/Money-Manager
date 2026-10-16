import { useEffect, useState } from 'react';
import { CategoryIcon } from '../components/CategoryIcon';
import { CategoryPicker, categoryIcon } from '../components/CategoryPicker';
import { Sheet } from '../components/Sheet';
import { Button, FieldRow, Group, inputClass } from '../components/primitives';
import type { Category } from '../db/schema';
import { centsToInput, formatMoney } from '../lib/format';
import { parseMoneyInput } from '../parser/money';
import type { ItemFields } from '../scan/draft';

// Changing one line of a receipt (a name or price read wrongly), taking it off, or adding one the
// reader missed. Used for saved receipts and on the review screen before saving.

/** "2", or a weight such as "0.856" or "0,856"; null when it isn't a quantity. */
function parseQty(text: string): number | null {
  const n = Number(text.trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : null;
}

export function ItemSheet({
  item,
  itemKey,
  isNew = false,
  nested = false,
  categories,
  onSave,
  onDelete,
  onClose,
}: {
  /** The item being changed; null when the sheet is closed. */
  item: (ItemFields & { kind: 'item' | 'discount' }) | null;
  /** Which item is open: the fields start again from the item whenever it changes. */
  itemKey: string | number | null;
  /** Adding an item the reader missed. */
  isNew?: boolean;
  /** Opened from the review sheet. */
  nested?: boolean;
  categories: Category[];
  /** false: it couldn't be saved (and the person was told); the sheet stays open. */
  onSave: (fields: ItemFields) => void | boolean | Promise<void | boolean>;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!item) return;
    setName(item.name);
    setQty(String(item.qty));
    setPrice(item.lineTotal ? centsToInput(Math.abs(item.lineTotal)) : '');
    setCategoryId(item.categoryId);
  }, [itemKey]);

  const discount = item?.kind === 'discount';
  const cents = parseMoneyInput(price);
  const count = discount ? 1 : parseQty(qty);
  const valid = !!name.trim() && count !== null && cents !== null && (discount ? cents !== 0 : cents >= 0);
  const each = !discount && count && count !== 1 && cents ? `${formatMoney(Math.round(cents / count))} ${Number.isInteger(count) ? 'each' : 'a kg'}` : null;

  async function save() {
    if (!item || !valid || count === null || cents === null) return;
    setBusy(true);
    try {
      if ((await onSave({ name, qty: count, lineTotal: discount ? -Math.abs(cents) : cents, categoryId })) === false) return;
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      nested={nested}
      open={!!item}
      onOpenChange={(open) => !open && onClose()}
      title={isNew ? 'Add an item' : discount ? 'Change the discount' : 'Change the item'}
      footer={
        <Button className="w-full" disabled={!valid || busy} onClick={save}>
          {isNew ? 'Add item' : 'Save changes'}
        </Button>
      }
    >
      {item && (
        <>
          <Group footer={discount ? undefined : `${each ? `${each}. ` : ''}For something weighed, "How many" is its weight in kg.`}>
            <FieldRow label="Name" htmlFor="item-name">
              <input id="item-name" value={name} placeholder="What it was" onChange={(e) => setName(e.target.value)} className={inputClass} />
            </FieldRow>
            {!discount && (
              <FieldRow label="How many" htmlFor="item-qty">
                <input id="item-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className={inputClass} />
              </FieldRow>
            )}
            <FieldRow label={discount ? 'Amount off' : 'Paid'} htmlFor="item-price">
              <input id="item-price" inputMode="decimal" value={price} placeholder="0.00" onChange={(e) => setPrice(e.target.value)} className={`${inputClass} font-semibold`} />
            </FieldRow>
            {!discount && (
              <FieldRow label="Category">
                <div className="flex items-center justify-end gap-2 py-1.5">
                  <CategoryIcon icon={categoryIcon(categoryId, categories)} size="sm" />
                  <CategoryPicker label="Category" value={categoryId} categories={categories} onChange={setCategoryId} className="text-right text-body" />
                </div>
              </FieldRow>
            )}
          </Group>
          {onDelete && !isNew && (
            <Button kind="destructive" className="mt-7 w-full" onClick={onDelete}>
              {discount ? 'Delete this discount' : 'Delete this item'}
            </Button>
          )}
        </>
      )}
    </Sheet>
  );
}
