import { useState } from 'react';
import { useApp } from '../app/AppContext';
import { CategoryIcon } from '../components/CategoryIcon';
import { Sheet } from '../components/Sheet';
import { useSafely, useToast } from '../components/Toast';
import { Button, FieldRow, Group, Segmented, inputClass } from '../components/primitives';
import { OTHER } from '../db/categories';
import { saveReceipt } from '../db/receipts';
import { useCategories, useDuplicate, useStores } from '../hooks/data';
import { DuplicateNote } from '../components/DuplicateNote';
import { FUTURE_DATE, monthName, todayIso } from '../kpi/monthly';
import { matchStore } from '../parser/store-match';
import { parseMoneyInput } from '../parser/money';
import type { PaymentMethod } from '../parser/types';
import { askToKeepData } from '../lib/storage';

// Spending without a receipt (market, bus fare, a friend paid back): amount, what, category.

export const PAYMENT_OPTIONS: ReadonlyArray<{ value: PaymentMethod; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'mobile', label: 'Mobile' },
  { value: 'other', label: 'Other' },
];

export function AddExpenseSheet() {
  const { addExpenseOpen, setAddExpenseOpen } = useApp();
  const categories = useCategories() ?? [];
  const stores = useStores() ?? [];
  const toast = useToast();
  const safely = useSafely();
  const [amount, setAmount] = useState('');
  const [what, setWhat] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [date, setDate] = useState(() => todayIso());
  const [payment, setPayment] = useState<PaymentMethod>('cash');
  const [busy, setBusy] = useState(false);

  const cents = parseMoneyInput(amount);
  const duplicate = useDuplicate({ storeId: null, storeName: what, date, total: cents ?? 0 });
  const tops = categories.filter((c) => !c.parentId);

  function reset() {
    setAmount('');
    setWhat('');
    setCategoryId(null);
    setDate(todayIso());
    setPayment('cash');
  }

  /** A name seen before brings its category along, unless one was already picked. */
  function recall(name: string) {
    if (categoryId) return;
    const known = matchStore({ name, taxId: null }, stores);
    if (known) setCategoryId(known.store.defaultCategoryId);
  }

  async function save() {
    if (!cents || cents <= 0) return;
    if (date > todayIso()) return toast(FUTURE_DATE, undefined, 'problem');
    setBusy(true);
    try {
      const saved = await safely("Couldn't add this expense", () =>
        saveReceipt({
        storeId: null,
        storeName: what,
        taxId: null,
        date,
        total: cents,
        paymentMethod: payment,
        vatTotal: null,
        discountTotal: null,
        categoryId: categoryId ?? OTHER,
        items: [],
        source: 'manual',
        note: '',
      }),
      );
      if (!saved.ok) return;
      void askToKeepData();
      toast(`Added to ${monthName(date.slice(0, 7))}`);
      reset();
      setAddExpenseOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={addExpenseOpen}
      onOpenChange={setAddExpenseOpen}
      title="Add an expense"
      footer={
        <Button className="w-full" disabled={!cents || cents <= 0 || busy} onClick={save}>
          {duplicate ? 'Add it again' : 'Add expense'}
        </Button>
      }
    >
      <div className="pb-2 pt-4 text-center">
        <label htmlFor="add-amount" className="text-subhead font-medium text-muted-foreground">
          How much?
        </label>
        <div className="mt-1 flex items-baseline justify-center gap-2">
          <span aria-hidden className="text-title2 text-muted-foreground">
            Rs
          </span>
          <input
            id="add-amount"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            // As wide as what's typed, so "Rs" stays beside the number.
            style={{ width: `${Math.max(amount.length, 4) + 0.4}ch` }}
            className="max-w-[70vw] bg-transparent text-hero tabular-nums caret-primary outline-none placeholder:text-track"
          />
        </div>
      </div>

      <Group className="mt-4">
        <FieldRow label="What" htmlFor="add-what">
          <input
            id="add-what"
            placeholder="Shop, or what it was"
            value={what}
            onChange={(e) => setWhat(e.target.value)}
            onBlur={(e) => recall(e.target.value)}
            list="known-shops"
            className={inputClass}
          />
          <datalist id="known-shops">
            {stores.map((s) => (
              <option key={s.id} value={s.name} />
            ))}
          </datalist>
        </FieldRow>
        <FieldRow label="Date" htmlFor="add-date">
          <input id="add-date" type="date" value={date} max={todayIso()} onChange={(e) => e.target.value && setDate(e.target.value)} className={inputClass} />
        </FieldRow>
      </Group>

      {duplicate && <DuplicateNote receipt={duplicate} categories={categories} done="added this expense" onLeave={() => setAddExpenseOpen(false)} />}

      <section className="mt-7">
        <h2 className="mb-2 px-1 text-headline">Category</h2>
        <div role="radiogroup" aria-label="Category" className="grid grid-cols-3 gap-2">
          {tops.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={categoryId === c.id}
              onClick={() => setCategoryId(c.id)}
              className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border px-1 py-3 text-center text-footnote font-medium transition-[transform,background-color,border-color] active:scale-[0.96] ${categoryId === c.id ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'border-border bg-card shadow-card'}`}
            >
              <CategoryIcon icon={c.icon} />
              {c.name}
            </button>
          ))}
        </div>
      </section>

      <Group title="Paid by">
        <div className="p-1.5">
          <Segmented label="Paid by" value={payment} options={PAYMENT_OPTIONS} onChange={setPayment} />
        </div>
      </Group>
    </Sheet>
  );
}
