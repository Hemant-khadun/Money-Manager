import { Camera, Images, Pencil, Plus, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CategoryIcon } from '../../components/CategoryIcon';
import { CategoryPicker, categoryIcon } from '../../components/CategoryPicker';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { Button, FieldRow, Group, Segmented, buttonBase, buttonKinds, inputClass } from '../../components/primitives';
import { saveReceipt, type ReceiptDraft } from '../../db/receipts';
import { itemsAddUp } from '../../kpi/adds-up';
import type { Category } from '../../db/schema';
import { useCategories, useStores } from '../../hooks/data';
import { photosInOrder, type ReadScan } from '../../hooks/useReceiptReader';
import { centsToInput, formatMoney } from '../../lib/format';
import { askToKeepData } from '../../lib/storage';
import { makeThumbnail } from '../../lib/thumbnail';
import { monthName, todayIso } from '../../kpi/monthly';
import { parseMoneyInput } from '../../parser/money';
import type { PaymentMethod } from '../../parser/types';
import { draftFromScan, withItem, withItemCategory, withMainCategory, withoutItem } from '../../scan/draft';
import { joinNotes, looksCutOff } from '../../scan/notes';
import { PAYMENT_OPTIONS } from '../AddExpenseSheet';
import { ItemSheet } from '../ItemSheet';
import { PhotoInput } from './PhotoInput';

// Checking a scanned receipt before it's saved: shop, total, date, category and how it was paid
// up front; underneath, every item read, each in its category, to correct before saving.

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

interface Props {
  scan: ReadScan | null;
  onClose: () => void;
  onSaved: (scan: ReadScan) => void;
  /** More photos of this receipt (the rest of a long one). */
  onAddPhotos: (scan: ReadScan, files: FileList | null) => void;
  /** Undo an automatic join. */
  onSplit: (scan: ReadScan) => void;
  /** Take one photo out of a receipt made of several (a bad one, or one of another receipt). */
  onRemovePhoto: (scan: ReadScan, photoId: number) => void;
  /** Don't save it: throw the receipt away. */
  onDelete: (scan: ReadScan) => void;
}

/**
 * Taking a photo of the rest of a receipt that is cut off or too long for one photo. Stands out
 * when no total was found at the bottom, as the end of the receipt then seems to be missing.
 * `guessed`: a total was still filled in (the biggest amount), to be checked if nothing is missing.
 */
function MorePhotos({ cutOff, guessed, onPhotos }: { cutOff: boolean; guessed: boolean; onPhotos: (files: FileList | null) => void }) {
  const choose = (
    <label className="flex min-h-11 cursor-pointer items-center gap-1.5 text-subhead font-medium text-primary">
      <Images aria-hidden className="size-4" strokeWidth={2} />
      Choose from your photos
      <PhotoInput multiple onPhotos={onPhotos} />
    </label>
  );
  if (!cutOff) {
    return (
      <div className="flex flex-wrap gap-x-5">
        <label className="flex min-h-11 cursor-pointer items-center gap-1.5 text-subhead font-medium text-primary">
          <Camera aria-hidden className="size-4" strokeWidth={2} />
          Receipt cut off? Take the next part
          <PhotoInput camera onPhotos={onPhotos} />
        </label>
        {choose}
      </div>
    );
  }
  return (
    <div className="mt-2 rounded-2xl border border-warn/30 bg-warn/8 px-4 pb-2 pt-3">
      <p className="flex gap-2 text-subhead">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={2.25} />
        <span>
          <strong className="font-semibold">This receipt may be cut off:</strong> there's no total at the bottom of this photo. Take a photo of the rest,
          starting with the last two or three lines of this one. If nothing is missing, {guessed ? 'check the total below' : 'type the total below'}.
        </span>
      </p>
      <label className={`${buttonBase} ${buttonKinds.primary} mt-3 w-full cursor-pointer`}>
        <Camera aria-hidden className="size-5" strokeWidth={2} />
        Take the next part
        <PhotoInput camera onPhotos={onPhotos} />
      </label>
      <div className="flex justify-center">{choose}</div>
    </div>
  );
}

/**
 * Everything read as an item, each with a pencil to correct it or take it off, and a way to add one
 * the reader missed. Items the reader was unsure of are marked "Check". Says whether they come to
 * the total, with a fix for when the total is what's wrong. They are saved as they are shown.
 */
function ReviewItems({
  draft,
  total,
  cutOff,
  categories,
  onCategory,
  onEdit,
  onAdd,
  onUseItemsTotal,
}: {
  draft: ReceiptDraft;
  total: number | null;
  cutOff: boolean;
  categories: Category[];
  onCategory: (index: number, categoryId: string) => void;
  onEdit: (index: number) => void;
  onAdd: () => void;
  onUseItemsTotal: (cents: number) => void;
}) {
  const count = draft.items.filter((i) => i.kind === 'item').length;
  const itemsTotal = draft.items.reduce((sum, i) => sum + i.lineTotal, 0);
  const addsUp = !!total && itemsAddUp(draft.items, total);
  const unclear = draft.items.some((i) => i.unclear);
  return (
    <section className="mt-7">
      <h2 className="mb-2 px-1 text-headline">
        {plural(count, 'item')}
        {addsUp && <span className="font-normal text-muted-foreground">, adding up to the total</span>}
      </h2>
      {!addsUp && (
        <div className="mb-3 rounded-2xl border border-warn/30 bg-warn/8 px-4 pb-1 pt-3 text-subhead">
          <p className="flex gap-2 pb-2">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={2.25} />
            <span>
              The items come to {formatMoney(itemsTotal)}
              {total ? `, but the total is ${formatMoney(total)}` : ''}. {cutOff ? 'Take the next part of the receipt, or check' : 'Check'} the items
              {unclear ? ' (start with the ones marked "Check")' : ''}: one may have been read wrongly. They are saved as you see them here.
            </span>
          </p>
          {!cutOff && itemsTotal > 0 && (
            <button type="button" className="-mt-1 min-h-11 pl-6 font-semibold text-primary" onClick={() => onUseItemsTotal(itemsTotal)}>
              Make the total {formatMoney(itemsTotal)}
            </button>
          )}
        </div>
      )}
      <div className="panel overflow-hidden">
        {draft.items.map((item, k) => (
          <div key={k} className="group/row pl-4">
            <div className="flex min-h-12 items-center gap-3 border-b border-border py-2 pr-4 group-last/row:border-b-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-subhead">
                  {item.name}
                  {item.qty !== 1 && (
                    <span className="text-muted-foreground">
                      {' '}
                      · {item.qty} × {formatMoney(item.unitPrice)}
                    </span>
                  )}
                </p>
                {item.kind === 'item' ? (
                  <CategoryPicker label={`Category for ${item.name}`} value={item.categoryId} categories={categories} onChange={(id) => onCategory(k, id)} className="text-footnote" />
                ) : (
                  <p className="text-footnote text-muted-foreground">Discount</p>
                )}
              </div>
              {item.unclear && (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-warn/15 px-2 py-0.5 text-caption font-semibold">
                  <TriangleAlert aria-hidden className="size-3.5 text-warn" strokeWidth={2.5} />
                  Check
                </span>
              )}
              <p className="shrink-0 text-subhead tabular-nums">{formatMoney(item.lineTotal)}</p>
              <button
                type="button"
                aria-label={`Change ${item.name}`}
                onClick={() => onEdit(k)}
                className="-my-1 -mr-3 grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground active:bg-muted"
              >
                <Pencil aria-hidden className="size-4" strokeWidth={2} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="mt-1 flex min-h-11 items-center gap-1.5 px-1 text-subhead font-medium text-primary" onClick={onAdd}>
        <Plus aria-hidden className="size-4" strokeWidth={2.25} />
        Add a missing item
      </button>
      <p className="px-1 text-footnote text-muted-foreground">
        Tap the pencil to fix an item's name or price, or to take off a line that isn't an item. Change an item's category and Money Manager remembers it
        for that product from now on.
      </p>
    </section>
  );
}

export function ReviewSheet({ scan, onClose, onSaved, onAddPhotos, onSplit, onRemovePhoto, onDelete }: Props) {
  const categories = useCategories() ?? [];
  const stores = useStores() ?? [];
  const toast = useToast();
  const [draft, setDraft] = useState<ReceiptDraft | null>(null);
  const [totalText, setTotalText] = useState('');
  const [busy, setBusy] = useState(false);
  /** The item being changed: its place in the draft, or 'new' for one being added. */
  const [editing, setEditing] = useState<number | 'new' | null>(null);

  useEffect(() => {
    setDraft(null);
    setEditing(null);
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
  const cutOff = !!scan && looksCutOff(scan);
  const notes: string[] = [];
  if (parsed) {
    // Whether the items add up is shown with the items.
    // A receipt that seems cut off says so on its own, with a way to take the rest of it.
    if (!cutOff && parsed.total === null) notes.push("Couldn't find the total: type it in.");
    else if (!cutOff && parsed.totalConfidence === 'low') notes.push('Check the total: it was hard to find on this receipt.');
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
      // The items are saved as the person saw them on this screen, adding up or not: the receipt
      // keeps its total either way, and says when its items don't add up to it.
      await saveReceipt({ ...draft, total }, { ocrLines: scan.lines, thumb });
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
              <div key={p.id} className="relative shrink-0">
                <a href={p.url} target="_blank" rel="noreferrer" className="block">
                  <img src={p.url} alt={`Receipt photo ${k + 1}`} className="h-28 rounded-xl border border-border object-cover shadow-card" />
                </a>
                {scan.photos.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Take photo ${k + 1} out of this receipt`}
                    onClick={() => onRemovePhoto(scan, p.id)}
                    className="group absolute -right-1.5 -top-1.5 grid size-11 place-items-center"
                  >
                    <span className="grid size-7 place-items-center rounded-full border border-border bg-card text-foreground shadow-card transition-transform group-active:scale-90">
                      <X aria-hidden className="size-4" strokeWidth={2.25} />
                    </span>
                  </button>
                )}
              </div>
            ))}
          </div>
          <MorePhotos cutOff={cutOff} guessed={parsed?.total != null} onPhotos={(files) => onAddPhotos(scan, files)} />
          {scan.joinedAutomatically && scan.photos.length > 1 && (
            <button type="button" className="min-h-11 text-subhead font-medium text-primary" onClick={() => onSplit(scan)}>
              These are separate receipts
            </button>
          )}
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

          {draft.items.length > 0 && (
            <ReviewItems
              draft={draft}
              total={total}
              cutOff={cutOff}
              categories={categories}
              onCategory={(k, id) => setDraft(withItemCategory(draft, k, id))}
              onEdit={setEditing}
              onAdd={() => setEditing('new')}
              onUseItemsTotal={(cents) => setTotalText(centsToInput(cents))}
            />
          )}
        </>
      )}
      {!draft && scan && <p className="mt-6 text-center text-subhead text-muted-foreground">Getting it ready…</p>}
      {scan && (
        <Button kind="destructive" className="mt-7 w-full" onClick={() => onDelete(scan)}>
          Delete this receipt
        </Button>
      )}

      <ItemSheet
        nested
        item={!draft || editing === null ? null : editing === 'new' ? { name: '', qty: 1, lineTotal: 0, kind: 'item', categoryId: draft.categoryId } : (draft.items[editing] ?? null)}
        itemKey={editing}
        isNew={editing === 'new'}
        categories={categories}
        onSave={(fields) => setDraft((d) => d && withItem(d, editing === 'new' ? null : editing, fields))}
        onDelete={() => {
          if (typeof editing === 'number') setDraft((d) => d && withoutItem(d, editing));
          setEditing(null);
        }}
        onClose={() => setEditing(null)}
      />
    </Sheet>
  );
}
