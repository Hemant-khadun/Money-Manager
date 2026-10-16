import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { Pencil, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CategoryIcon } from '../components/CategoryIcon';
import { CategoryPicker, categoryIcon, categoryName } from '../components/CategoryPicker';
import { Meter } from '../components/charts/Meter';
import { MoneyHero } from '../components/Money';
import { Page } from '../components/Page';
import { useToast } from '../components/Toast';
import { Button, EmptyState, FieldRow, Group, Row, Segmented, inputClass } from '../components/primitives';
import { groupByCategory } from '../categorize/group';
import { itemsAddUp } from '../kpi/adds-up';
import { deleteItem, deleteReceipt, restoreItems, restoreReceipt, setItemCategory, updateItem, updateReceipt } from '../db/receipts';
import type { Category, LineItem, Receipt } from '../db/schema';
import { useCategories, useReceipt, useReceiptItems, useThumbUrl } from '../hooks/data';
import { centsToInput, formatDate, formatMoney, formatPercent } from '../lib/format';
import { parseMoneyInput } from '../parser/money';
import type { PaymentMethod } from '../parser/types';
import { PAYMENT_OPTIONS } from './AddExpenseSheet';
import type { ItemFields } from '../scan/draft';
import { ItemSheet } from './ItemSheet';

// One saved receipt, in full: everything it holds, its items grouped by category, and everything
// can be changed. Changes save as you make them.

const route = getRouteApi('/receipt/$id');

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const timeOfDay = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

/** "15 Oct 2026 at 14:32", in the phone's own time. */
function addedOn(ms: number): string {
  const d = new Date(ms);
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${formatDate(local)} at ${timeOfDay.format(d)}`;
}

/** One line of the receipt: name, how many at what price, its category (changeable) and what it cost; the pencil changes the rest. */
function ItemRow({ item, categories, onEdit }: { item: LineItem; categories: Category[]; onEdit: (item: LineItem) => void }) {
  return (
    <div className="group/row pl-4">
      <div className="flex min-h-12 items-center gap-3 border-b border-dashed border-border py-2 pr-4 group-last/row:border-b-0">
        <div className="min-w-0 flex-1">
          <p className="truncate text-subhead font-medium">
            {item.name}
            {item.qty !== 1 && <span className="font-normal text-muted-foreground"> · {item.qty} × {formatMoney(item.unitPrice)}</span>}
          </p>
          {item.kind === 'item' ? (
            <CategoryPicker label={`Category for ${item.name}`} value={item.categoryId} categories={categories} onChange={(c) => void setItemCategory(item.id!, c)} className="text-footnote" />
          ) : (
            <p className="text-footnote text-muted-foreground">Discount</p>
          )}
        </div>
        <p className="shrink-0 text-subhead tabular-nums">{formatMoney(item.lineTotal)}</p>
        <button
          type="button"
          aria-label={`Change ${item.name}`}
          onClick={() => onEdit(item)}
          className="-my-1 -mr-3 grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground active:bg-muted"
        >
          <Pencil aria-hidden className="size-4" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

/**
 * The items grouped by category, the biggest share of the money first; discounts after; then the
 * total. Once items are changed so they no longer add up to the total, says so, with a fix.
 */
function ItemsByCategory({
  receipt,
  items,
  categories,
  onEdit,
  onUseItemsTotal,
}: {
  receipt: Receipt;
  items: LineItem[];
  categories: Category[];
  onEdit: (item: LineItem) => void;
  onUseItemsTotal: (cents: number) => void;
}) {
  const groups = groupByCategory(items, receipt.split);
  const discounts = items.filter((i) => i.kind === 'discount');
  const count = items.length - discounts.length;
  const itemsTotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
  const addsUp = itemsAddUp(items, receipt.total);
  // A group's share differs from what its items cost by the discounts spread over it; when the
  // items don't add up, also by the gap, so it isn't called a discount then.
  const discounted = addsUp && discounts.length > 0;
  return (
    <section className="mt-7">
      <h2 className="mb-2 px-1 text-headline">
        {plural(count, 'item')}
        {groups.length > 1 && <span className="font-normal text-muted-foreground"> in {groups.length} categories</span>}
      </h2>
      {itemsTotal > 0 && !addsUp && (
        <div className="mb-3 rounded-2xl border border-warn/30 bg-warn/8 px-4 pb-1 pt-3 text-subhead">
          <p className="flex gap-2">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={2.25} />
            The items add up to {formatMoney(itemsTotal)}, but the total is {formatMoney(receipt.total)}.
          </p>
          <button type="button" className="min-h-11 pl-6 font-semibold text-primary" onClick={() => onUseItemsTotal(itemsTotal)}>
            Make the total {formatMoney(itemsTotal)}
          </button>
        </div>
      )}
      {/* Laid out like the paper it came from, torn edge and all. */}
      <div className="paper bg-card pb-6 pt-1">
        {groups.map((group) => {
          const name = categoryName(group.categoryId, categories);
          return (
            <div key={group.categoryId} className="border-b-2 border-border pb-1 last:border-b-0">
              <div className="px-4 pb-1 pt-4">
                <div className="flex items-center gap-3">
                  <CategoryIcon icon={categoryIcon(group.categoryId, categories)} size="sm" />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-subhead font-semibold">{name}</h3>
                    <p className="text-footnote text-muted-foreground">
                      {plural(group.items.length, 'item')}
                      {discounted && group.amount !== group.itemsTotal && ` · ${formatMoney(group.itemsTotal)} before discounts`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-subhead font-semibold tabular-nums">{formatMoney(group.amount)}</p>
                    <p className="text-footnote tabular-nums text-muted-foreground">{formatPercent(group.amount / receipt.total)}</p>
                  </div>
                </div>
                <Meter value={group.amount / receipt.total} label={`${name}: share of this receipt`} />
              </div>
              {group.items.map((item) => (
                <ItemRow key={item.id} item={item} categories={categories} onEdit={onEdit} />
              ))}
            </div>
          );
        })}
        {discounts.length > 0 && (
          <div className="pt-3">
            <h3 className="px-4 text-subhead font-semibold">Discounts</h3>
            {discounts.map((item) => (
              <ItemRow key={item.id} item={item} categories={categories} onEdit={onEdit} />
            ))}
          </div>
        )}
        <div className="mx-4 mt-1 flex items-baseline justify-between border-t-2 border-dashed border-border pt-3 text-headline">
          <span>Total</span>
          <span className="tabular-nums">{formatMoney(receipt.total)}</span>
        </div>
      </div>
      <p className="mt-2 px-1 text-footnote text-muted-foreground">
        Change an item's category and it moves to that group. Money Manager remembers it for that product, on every receipt. Tap the pencil to fix an
        item's name or price, or to delete it.
      </p>
    </section>
  );
}

export function ReceiptDetail() {
  const id = Number(route.useParams().id);
  const receipt = useReceipt(id);
  const items = useReceiptItems(id);
  const categories = useCategories() ?? [];
  const thumb = useThumbUrl(id);
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [total, setTotal] = useState('');
  const [note, setNote] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const editing = items?.find((i) => i.id === editingId) ?? null;

  // Also when saved from elsewhere on the page ("Make the total…").
  useEffect(() => {
    if (!receipt) return;
    setName(receipt.storeName);
    setTotal(centsToInput(receipt.total));
    setNote(receipt.note);
  }, [receipt?.id, receipt?.storeName, receipt?.total, receipt?.note]);

  if (receipt === undefined) return <Page title="" back="Back">{null}</Page>;
  if (receipt === null) {
    return (
      <Page title="Receipt" back="Back">
        <EmptyState title="This receipt isn't here any more" />
      </Page>
    );
  }

  const title = receipt.storeName || categoryName(receipt.categoryId, categories);
  const kept = receipt.itemized ? (items ?? []) : [];
  const itemCount = kept.filter((i) => i.kind === 'item').length;
  // What the receipt says was saved, or else what its discount lines add up to.
  const saved = receipt.discountTotal ?? -kept.filter((i) => i.kind === 'discount').reduce((sum, i) => sum + i.lineTotal, 0);

  async function remove() {
    const deleted = await deleteReceipt(id);
    if (!deleted) return;
    void navigate({ to: '/history' });
    toast('Receipt deleted', { label: 'Undo', run: () => void restoreReceipt(deleted) });
  }

  async function saveItem(item: LineItem, { categoryId, ...changes }: ItemFields) {
    await updateItem(item.id!, changes);
    if (item.kind === 'item' && categoryId !== item.categoryId) await setItemCategory(item.id!, categoryId);
  }

  async function removeItem(item: LineItem) {
    setEditingId(null);
    const deleted = await deleteItem(item.id!);
    if (deleted) toast(`${item.kind === 'discount' ? 'Discount' : 'Item'} deleted`, { label: 'Undo', run: () => void restoreItems(deleted) });
  }

  function saveTotal() {
    const cents = parseMoneyInput(total);
    if (cents && cents > 0 && cents !== receipt!.total) void updateReceipt(id, { total: cents });
    else setTotal(centsToInput(receipt!.total));
  }

  return (
    <Page title={title} back="Back" glow>
      <div className="mt-2 flex items-center gap-3">
        <CategoryIcon icon={categoryIcon(receipt.categoryId, categories)} size="lg" />
        <p className="text-subhead font-medium text-muted-foreground">
          {formatDate(receipt.date)}
          {receipt.source === 'manual' && ' · added by hand'}
        </p>
      </div>
      <MoneyHero cents={receipt.total} className="mt-3" />

      {thumb && (
        <a href={thumb} target="_blank" rel="noreferrer" className="mt-5 block w-fit">
          <img src={thumb} alt={`Receipt from ${title}`} className="max-h-60 rounded-2xl border border-border shadow-card" />
        </a>
      )}

      <Group footer="Tap a detail to change it. Changes are saved straight away.">
        <FieldRow label="Shop" htmlFor="r-shop">
          <input id="r-shop" value={name} placeholder="Shop name" onChange={(e) => setName(e.target.value)} onBlur={() => name !== receipt.storeName && void updateReceipt(id, { storeName: name })} className={inputClass} />
        </FieldRow>
        <FieldRow label="Total" htmlFor="r-total">
          <input id="r-total" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} onBlur={saveTotal} className={inputClass} />
        </FieldRow>
        <FieldRow label="Date" htmlFor="r-date">
          <input id="r-date" type="date" value={receipt.date} onChange={(e) => e.target.value && void updateReceipt(id, { date: e.target.value })} className={inputClass} />
        </FieldRow>
        <FieldRow label="Category">
          <div className="flex items-center justify-end gap-2 py-1.5">
            <CategoryIcon icon={categoryIcon(receipt.categoryId, categories)} size="sm" />
            <CategoryPicker label="Category" value={receipt.categoryId} categories={categories} onChange={(categoryId) => void updateReceipt(id, { categoryId })} className="text-right text-body" />
          </div>
        </FieldRow>
        <FieldRow label="Note" htmlFor="r-note">
          <input id="r-note" value={note} placeholder="Optional" onChange={(e) => setNote(e.target.value)} onBlur={() => note !== receipt.note && void updateReceipt(id, { note })} className={inputClass} />
        </FieldRow>
      </Group>

      <Group title="Paid by">
        <div className="p-1.5">
          <Segmented<PaymentMethod> label="Paid by" value={receipt.paymentMethod ?? 'other'} options={PAYMENT_OPTIONS} onChange={(paymentMethod) => void updateReceipt(id, { paymentMethod })} />
        </div>
      </Group>

      <Group title="Details">
        <Row
          title="Added"
          subtitle={receipt.source === 'scan' ? 'Scanned from a photo' : 'Added by hand'}
          value={<span className="text-subhead font-normal text-muted-foreground">{addedOn(receipt.createdAt)}</span>}
        />
        {receipt.vatTotal !== null && <Row title="Tax included (VAT)" value={formatMoney(receipt.vatTotal)} />}
        {saved > 0 && <Row title="You saved" value={formatMoney(saved)} />}
        <Row title="Items" value={<span className="text-subhead font-normal text-muted-foreground">{itemCount ? plural(itemCount, 'item') : 'Not kept'}</span>} />
      </Group>

      {receipt.itemized && items && items.length > 0 && (
        <ItemsByCategory
          receipt={receipt}
          items={items}
          categories={categories}
          onEdit={(item) => setEditingId(item.id!)}
          onUseItemsTotal={(cents) => void updateReceipt(id, { total: cents })}
        />
      )}
      {receipt.source === 'scan' && !receipt.itemized && (
        <p className="mt-3 px-4 text-footnote text-muted-foreground">The items on this receipt couldn't be read reliably, so only its total was kept.</p>
      )}

      <div className="mt-7">
        <Button kind="destructive" className="w-full" onClick={remove}>
          Delete receipt
        </Button>
      </div>

      <ItemSheet
        item={editing}
        itemKey={editingId}
        categories={categories}
        onSave={async (fields) => {
          if (editing) await saveItem(editing, fields);
        }}
        onDelete={() => editing && void removeItem(editing)}
        onClose={() => setEditingId(null)}
      />
    </Page>
  );
}
