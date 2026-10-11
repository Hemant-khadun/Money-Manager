import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CategoryIcon } from '../../components/CategoryIcon';
import { CategoryPicker, categoryIcon } from '../../components/CategoryPicker';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { Button, FieldRow, Group, Segmented, inputClass } from '../../components/primitives';
import { saveReceipt, type ReceiptDraft } from '../../db/receipts';
import { useCategories, useStores } from '../../hooks/data';
import { photosInOrder, type ReadScan } from '../../hooks/useReceiptReader';
import { centsToInput, formatMoney } from '../../lib/format';
import { askToKeepData } from '../../lib/storage';
import { makeThumbnail } from '../../lib/thumbnail';
import { monthName, todayIso } from '../../kpi/monthly';
import { parseMoneyInput } from '../../parser/money';
import type { PaymentMethod } from '../../parser/types';
import { draftFromScan, withItemCategory, withMainCategory } from '../../scan/draft';
import { joinNotes } from '../../scan/notes';
import { PAYMENT_OPTIONS } from '../AddExpenseSheet';

// Checking a scanned receipt before it's saved: shop, total, date, category and how it was paid
// up front; the items (each in its category) folded away underneath.

interface Props {
  scan: ReadScan | null;
  onClose: () => void;
  onSaved: (scan: ReadScan) => void;
  /** More photos of this receipt (the rest of a long one). */
  onAddPhotos: (scan: ReadScan, files: FileList | null) => void;
  /** Undo an automatic join. */
  onSplit: (scan: ReadScan) => void;
}

export function ReviewSheet({ scan, onClose, onSaved, onAddPhotos, onSplit }: Props) {
  const categories = useCategories() ?? [];
  const stores = useStores() ?? [];
  const toast = useToast();
  const [draft, setDraft] = useState<ReceiptDraft | null>(null);
  const [totalText, setTotalText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(null);
    if (!scan?.parsed) return;
    let live = true;
    void draftFromScan(scan.parsed, todayIso()).then((d) => {
      if (!live) return;
      setDraft(d);
      setTotalText(d.total ? centsToInput(d.total) : '');
    });
    return () => {
      live = false;
    };
  }, [scan?.id, scan?.parsed]);

  const parsed = scan?.parsed;
  const total = parseMoneyInput(totalText);
  const items = draft?.items.filter((i) => i.kind === 'item') ?? [];
  const notes: string[] = [];
  if (parsed) {
    if (parsed.items.length && !parsed.itemsAddUp) notes.push("The items didn't add up to the total, so only the total will be saved.");
    if (parsed.total === null) notes.push("Couldn't find the total: type it in.");
    else if (parsed.totalConfidence === 'low') notes.push('Check the total: it was hard to find on this receipt.');
    if (!parsed.date) notes.push("Couldn't find the date: check it.");
    if (!parsed.storeName) notes.push("Couldn't find the shop's name: type it in.");
  }
  if (scan) notes.push(...joinNotes(scan));

  async function save() {
    if (!scan || !draft || !total || total <= 0) return;
    setBusy(true);
    try {
      const top = photosInOrder(scan)[0];
      const thumb = top ? await makeThumbnail(top.file) : null;
      // A changed total no longer matches the items: keep the total only.
      const items = total === parsed?.total ? draft.items : [];
      await saveReceipt({ ...draft, total, items }, { ocrLines: scan.lines, thumb });
      void askToKeepData();
      toast(`Saved to ${monthName(draft.date.slice(0, 7))}`);
      onSaved(scan);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={!!scan}
      onOpenChange={(open) => !open && onClose()}
      title="Check the receipt"
      footer={
        <Button className="w-full" disabled={!draft || !total || total <= 0 || busy} onClick={save}>
          Save receipt
        </Button>
      }
    >
      {scan && (
        <>
          <div className="flex gap-2 overflow-x-auto py-2">
            {photosInOrder(scan).map((p, k) => (
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="shrink-0">
                <img src={p.url} alt={`Receipt photo ${k + 1}`} className="h-28 rounded-xl border border-border object-cover shadow-card" />
              </a>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-subhead">
            <label className="flex min-h-11 cursor-pointer items-center text-primary">
              + Add another photo of this receipt
              <input
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(e) => {
                  onAddPhotos(scan, e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
            {scan.joinedAutomatically && scan.photos.length > 1 && (
              <button type="button" className="min-h-11 text-primary" onClick={() => onSplit(scan)}>
                These are separate receipts
              </button>
            )}
          </div>
          {scan.joinedAutomatically && scan.photos.length > 1 && (
            <p className="text-footnote text-muted-foreground">These {scan.photos.length} photos overlap, so they were joined into one long receipt.</p>
          )}
        </>
      )}

      {notes.length > 0 && (
        <ul className="mt-3 space-y-2 rounded-2xl border border-warn/30 bg-warn/8 px-4 py-3 text-subhead">
          {notes.map((n) => (
            <li key={n} className="flex gap-2">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={2.25} />
              {n}
            </li>
          ))}
        </ul>
      )}

      {draft && (
        <>
          <Group>
            <FieldRow label="Shop" htmlFor="review-shop">
              <input
                id="review-shop"
                value={draft.storeName}
                placeholder="Shop name"
                list="review-shops"
                onChange={(e) => setDraft({ ...draft, storeName: e.target.value, storeId: null })}
                className={inputClass}
              />
              <datalist id="review-shops">
                {stores.map((s) => (
                  <option key={s.id} value={s.name} />
                ))}
              </datalist>
            </FieldRow>
            <FieldRow label="Total" htmlFor="review-total">
              <input id="review-total" inputMode="decimal" value={totalText} placeholder="0.00" onChange={(e) => setTotalText(e.target.value)} className={`${inputClass} font-semibold`} />
            </FieldRow>
            <FieldRow label="Date" htmlFor="review-date">
              <input id="review-date" type="date" value={draft.date} onChange={(e) => e.target.value && setDraft({ ...draft, date: e.target.value })} className={inputClass} />
            </FieldRow>
            <FieldRow label="Category">
              <div className="flex items-center justify-end gap-2 py-1.5">
                <CategoryIcon icon={categoryIcon(draft.categoryId, categories)} size="sm" />
                <CategoryPicker label="Category" value={draft.categoryId} categories={categories} onChange={(id) => setDraft(withMainCategory(draft, id))} className="text-right text-body" />
              </div>
            </FieldRow>
          </Group>

          <Group title="Paid by">
            <div className="p-1.5">
              <Segmented<PaymentMethod>
                label="Paid by"
                value={draft.paymentMethod ?? 'other'}
                options={PAYMENT_OPTIONS}
                onChange={(paymentMethod) => setDraft({ ...draft, paymentMethod })}
              />
            </div>
          </Group>

          {items.length > 0 && (
            <Group
              title={`${items.length === 1 ? '1 item' : `${items.length} items`}, adding up to the total`}
              footer="Change an item's category and Spent remembers it for that product from now on."
            >
              {draft.items.map((item, k) => (
                <div key={k} className="flex min-h-11 items-center gap-3 border-b border-border py-2 pl-4 pr-4 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-subhead">{item.name}</p>
                    {item.kind === 'item' ? (
                      <CategoryPicker
                        label={`Category for ${item.name}`}
                        value={item.categoryId}
                        categories={categories}
                        onChange={(id) => setDraft(withItemCategory(draft, k, id))}
                        className="text-footnote"
                      />
                    ) : (
                      <p className="text-footnote text-muted-foreground">Discount</p>
                    )}
                  </div>
                  <p className="shrink-0 text-subhead tabular-nums">{formatMoney(item.lineTotal)}</p>
                </div>
              ))}
            </Group>
          )}
        </>
      )}
      {!draft && scan && <p className="mt-6 text-center text-subhead text-muted-foreground">Getting it ready…</p>}
    </Sheet>
  );
}
