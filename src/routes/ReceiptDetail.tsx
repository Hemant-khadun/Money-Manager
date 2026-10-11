import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { CategoryIcon } from '../components/CategoryIcon';
import { CategoryPicker, categoryIcon, categoryName } from '../components/CategoryPicker';
import { Meter } from '../components/charts/Meter';
import { MoneyHero } from '../components/Money';
import { Page } from '../components/Page';
import { useToast } from '../components/Toast';
import { Button, EmptyState, FieldRow, Group, Row, Segmented, inputClass } from '../components/primitives';
import { deleteReceipt, restoreReceipt, setItemCategory, updateReceipt } from '../db/receipts';
import { useCategories, useReceipt, useReceiptItems, useThumbUrl } from '../hooks/data';
import { centsToInput, formatDate, formatMoney } from '../lib/format';
import { parseMoneyInput } from '../parser/money';
import type { PaymentMethod } from '../parser/types';
import { PAYMENT_OPTIONS } from './AddExpenseSheet';

// One saved receipt: everything can be changed. Changes save as you make them.

const route = getRouteApi('/receipt/$id');

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

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

  useEffect(() => {
    if (!receipt) return;
    setName(receipt.storeName);
    setTotal(centsToInput(receipt.total));
    setNote(receipt.note);
  }, [receipt?.id]);

  if (receipt === undefined) return <Page title="" back="Back">{null}</Page>;
  if (receipt === null) {
    return (
      <Page title="Receipt" back="Back">
        <EmptyState title="This receipt isn't here any more" />
      </Page>
    );
  }

  const title = receipt.storeName || categoryName(receipt.categoryId, categories);

  async function remove() {
    const deleted = await deleteReceipt(id);
    if (!deleted) return;
    void navigate({ to: '/history' });
    toast('Receipt deleted', { label: 'Undo', run: () => void restoreReceipt(deleted) });
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

      <Group>
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

      {receipt.split.length > 1 && (
        <Group title="Where the money went">
          {receipt.split.map((part) => (
            <Row
              key={part.categoryId}
              icon={<CategoryIcon icon={categoryIcon(part.categoryId, categories)} size="sm" />}
              title={categoryName(part.categoryId, categories)}
              value={formatMoney(part.amount)}
              below={<Meter value={part.amount / receipt.total} label={`${categoryName(part.categoryId, categories)}: share of this receipt`} />}
            />
          ))}
        </Group>
      )}

      {receipt.itemized && items && items.length > 0 && (
        <section className="mt-7">
          <h2 className="mb-2 px-1 text-headline">{plural(items.filter((i) => i.kind === 'item').length, 'item')}</h2>
          {/* Laid out like the paper it came from, torn edge and all. */}
          <div className="paper bg-card pb-6 pt-1">
            <div>
              {items.map((item) => (
                <div key={item.id} className="group/row pl-4">
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
                  </div>
                </div>
              ))}
            </div>
            <div className="mx-4 mt-1 flex items-baseline justify-between border-t-2 border-dashed border-border pt-3 text-headline">
              <span>Total</span>
              <span className="tabular-nums">{formatMoney(receipt.total)}</span>
            </div>
          </div>
          <p className="mt-2 px-1 text-footnote text-muted-foreground">Change an item's category and Spent remembers it for that product, on every receipt.</p>
        </section>
      )}
      {receipt.source === 'scan' && !receipt.itemized && (
        <p className="mt-3 px-4 text-footnote text-muted-foreground">The items on this receipt couldn't be read reliably, so only its total was kept.</p>
      )}

      <div className="mt-7">
        <Button kind="destructive" className="w-full" onClick={remove}>
          Delete receipt
        </Button>
      </div>
    </Page>
  );
}
