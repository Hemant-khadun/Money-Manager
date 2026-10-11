import { useState } from 'react';
import { scoreReceipt, SHOP_KINDS, type ExpectedReceipt, type ReceiptFixture, type ShopKind } from '../eval/fixture';
import { centsToInput, formatDate, formatMoney } from '../lib/format';
import { todayIso } from '../parser/dates';
import { parseMoneyInput } from '../parser/money';
import type { Confidence, ParseWarning, PaymentMethod } from '../parser/types';
import type { ReadReport } from '../pipeline/ocr-protocol';
import { photosInOrder } from '../hooks/useReceiptReader';
import { joinNotes } from '../scan/notes';
import type { Photo, Scan } from './SpikePage';

// Everything on this card is worded for people, not programmers.

const PAYMENTS: Array<PaymentMethod | null> = ['cash', 'card', 'mobile', 'other', null];

const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  mobile: 'Mobile money (Juice, Blink…)',
  other: 'Other',
};

const KIND_LABEL: Record<ShopKind, string> = {
  supermarket: 'Supermarket',
  pharmacy: 'Pharmacy',
  fuel: 'Fuel station',
  restaurant: 'Restaurant or takeaway',
  hardware: 'Hardware',
  clothing: 'Clothing',
  'card-slip': 'Card machine slip',
  other: 'Other',
};

const CONFIDENCE_LABEL: Record<Confidence, string> = { high: 'sure', medium: 'fairly sure', low: 'a guess' };

const WARNING_LABEL: Record<ParseWarning, string> = {
  'no-store': "couldn't find the shop name",
  'no-total': "couldn't find the total",
  'no-date': "couldn't find the date",
  'date-implausible': 'the date looks wrong',
  'items-mismatch': "the items don't add up to the total",
  'low-confidence': 'parts were hard to read',
};

/** "zoomed in 2.4× · read in 3 parts · looked again at 5 unclear lines, 3 came out clearer" */
function describeReading(r: ReadReport): string[] {
  const done: string[] = [];
  if (r.leftOut) done.push('ignored text outside the main receipt');
  if (Math.abs(r.tilt) >= 1) done.push(`straightened a ${Math.abs(r.tilt).toFixed(0)}° tilt`);
  if (r.zoom >= 1.1) done.push(`zoomed in ${r.zoom}×`);
  if (r.parts > 1) done.push(`read in ${r.parts} parts`);
  if (r.closerLooks > 0) {
    const lines = r.closerLooks === 1 ? '1 unclear line' : `${r.closerLooks} unclear lines`;
    done.push(`looked again at ${lines}, ${r.improved} came out clearer`);
  }
  return done;
}

/** Advice about the photo itself, when it is what limits the reading. */
function photoAdvice(r: ReadReport, fileName: string): string | null {
  if (/whatsapp/i.test(fileName) && Math.max(r.photoWidth, r.photoHeight) <= 1600) {
    return "This photo came through WhatsApp, which makes pictures smaller. The original photo from the phone's camera will read more reliably.";
  }
  // Writing that had to be enlarged 2× or more to be readable.
  if (r.lineHeight > 0 && r.lineHeight < 18) {
    return 'The writing is small in this photo. Taking the photo a little closer will read more reliably.';
  }
  // Many lines still unclear after looking again up close: the paper itself (creases, folds, fading).
  if (r.unclearLeft >= 5) {
    return `${r.unclearLeft} lines were still hard to read, usually because the receipt is creased or folded there. Flatten it and take the photo again to capture every item.`;
  }
  return null;
}

function slug(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function download(fileName: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Mark({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="text-good" aria-label="right">✓</span>
  ) : (
    <span className="text-bad" aria-label="wrong">✗</span>
  );
}

interface Props {
  scan: Scan;
  onExpectedChange: (expected: ExpectedReceipt) => void;
  onSaved: () => void;
  onAddPhotos: (files: FileList | null) => void;
  onRemovePhoto: (photo: Photo) => void;
  /** Undo an automatic join: one receipt per photo. */
  onSplit: () => void;
  onReread: () => void;
  onRemove: () => void;
}

export function ScanCard({ scan, onExpectedChange, onSaved, onAddPhotos, onRemovePhoto, onSplit, onReread, onRemove }: Props) {
  const first = scan.photos[0];
  const [name, setName] = useState(() => slug(first.file.name));
  const [totalText, setTotalText] = useState<string | null>(null);
  const { parsed, expected } = scan;
  const score = parsed && expected ? scoreReceipt(parsed, expected) : null;
  const set = (patch: Partial<ExpectedReceipt>) => expected && onExpectedChange({ ...expected, ...patch });
  const itemCount = parsed?.items.filter((i) => i.kind === 'item').length ?? 0;
  const photos = photosInOrder(scan);
  const several = photos.length > 1;
  const reading = (p: Photo) => scan.readings?.[p.id];
  const label = (k: number) => (several ? `Photo ${k + 1}: ` : '');
  const tips = photos.flatMap((p, k) => {
    const r = reading(p)?.report;
    const tip = r && photoAdvice(r, p.file.name);
    return tip ? [label(k) + tip] : [];
  });

  function save() {
    if (!parsed || !expected || !scan.lines) return;
    const fileName = slug(name) || slug(first.file.name) || `receipt-${scan.id}`;
    const fixture: ReceiptFixture = {
      version: 1,
      name: fileName,
      capturedAt: todayIso(),
      ocr: {
        strategy: scan.strategy ?? 'per-box',
        backend: scan.backend ?? 'unknown',
        ms: scan.ms ?? 0,
        report: several ? undefined : reading(first)?.report,
        lines: scan.lines,
        photos: several
          ? photos.map((p) => ({ name: p.file.name, lines: reading(p)?.lines ?? [], report: reading(p)?.report }))
          : undefined,
      },
      expected: { ...expected, checked: true },
    };
    download(`${fileName}.json`, fixture);
    onSaved();
  }

  const inputClass = 'w-full rounded-sm border border-border bg-card px-2 py-1.5 text-[15px]';

  return (
    <article className="grid gap-4 rounded-lg bg-card p-4 md:grid-cols-[220px_1fr]">
      <div className="space-y-3">
        <div className={several ? 'grid grid-cols-3 gap-2 md:grid-cols-2' : undefined}>
          {photos.map((p, k) => (
            <figure key={p.id} className="relative">
              <a href={p.url} target="_blank" rel="noreferrer" className="block">
                <img
                  src={p.url}
                  alt={several ? `Photo ${k + 1} of the receipt` : `Receipt photo ${p.file.name}`}
                  className={`w-full rounded-sm object-contain ${several ? 'max-h-40' : 'max-h-80'}`}
                />
              </a>
              {several && (
                <figcaption className="mt-1 flex items-center justify-between text-[13px] text-muted-foreground">
                  Photo {k + 1}
                  <button type="button" className="px-1 text-bad" aria-label={`Remove photo ${k + 1}`} onClick={() => onRemovePhoto(p)}>
                    Remove
                  </button>
                </figcaption>
              )}
            </figure>
          ))}
        </div>
        <label className="block cursor-pointer text-[15px] text-primary">
          + Add another photo of this receipt
          <input
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(e) => {
              onAddPhotos(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="truncate text-[17px] font-semibold">
            {several ? `Long receipt, ${photos.length} photos` : first.file.name}
          </h2>
          <div className="flex gap-3 text-[15px]">
            {scan.status === 'done' || scan.status === 'error' ? (
              <button type="button" className="text-primary" onClick={onReread}>
                Read again
              </button>
            ) : null}
            <button type="button" className="text-bad" onClick={onRemove}>
              Remove
            </button>
          </div>
        </div>

        {scan.joinedAutomatically && several && (
          <p className="text-[15px]">
            These {photos.length} photos overlap, so they were joined into one long receipt.{' '}
            <button type="button" className="text-primary" onClick={onSplit}>
              Keep them as separate receipts
            </button>
          </p>
        )}

        {scan.status === 'queued' && <p className="text-muted-foreground">Waiting its turn…</p>}
        {scan.status === 'reading' && <p className="text-muted-foreground" role="status">{scan.step ?? 'Getting started'}…</p>}
        {scan.status === 'error' && <p className="text-bad">Couldn't read {several ? 'these photos' : 'this photo'}: {scan.error}</p>}

        {parsed && expected && score && (
          <>
            <div className="space-y-1 text-[13px] text-muted-foreground">
              <p>
                Read in {((scan.ms ?? 0) / 1000).toFixed(1)} s
                {several && scan.joins && scan.joins.some(Boolean) && ' · joined the photos where they overlap'}
              </p>
              {photos.map((p, k) => {
                const r = reading(p)?.report;
                return (
                  r && (
                    <p key={p.id}>
                      {several ? `Photo ${k + 1}: ` : 'Photo '}
                      {r.photoWidth} × {r.photoHeight}
                      {describeReading(r).map((d) => ` · ${d}`)}
                    </p>
                  )
                );
              })}
              {parsed.warnings.length > 0 && <p>Heads up: {parsed.warnings.map((w) => WARNING_LABEL[w]).join(', ')}</p>}
              {joinNotes(scan).map((note) => (
                <p key={note} className="text-warn">
                  {note}
                </p>
              ))}
              {tips.map((tip) => (
                <p key={tip} className="text-warn">
                  Tip: {tip}
                </p>
              ))}
            </div>

            <table className="w-full text-left text-[15px] tabular-nums">
              <thead className="text-[13px] text-muted-foreground">
                <tr>
                  <th className="w-24 font-normal" />
                  <th className="font-normal">What it read</th>
                  <th className="font-normal">Correct answer</th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody className="align-middle [&_td]:py-1 [&_td]:pr-2">
                <tr>
                  <td className="text-muted-foreground">Shop</td>
                  <td className="truncate">{parsed.storeName ?? '—'}</td>
                  <td>
                    <input aria-label="Correct shop name" className={inputClass} value={expected.store} onChange={(e) => set({ store: e.target.value })} />
                  </td>
                  <td><Mark ok={score.store} /></td>
                </tr>
                <tr>
                  <td className="text-muted-foreground">Date</td>
                  <td>{parsed.date ? formatDate(parsed.date) : '—'}</td>
                  <td>
                    <input aria-label="Correct date" type="date" className={inputClass} value={expected.date} onChange={(e) => set({ date: e.target.value })} />
                  </td>
                  <td><Mark ok={score.date} /></td>
                </tr>
                <tr>
                  <td className="text-muted-foreground">Total</td>
                  <td>
                    {parsed.total === null ? '—' : formatMoney(parsed.total, parsed.currency)}{' '}
                    <span className="text-[13px] text-muted-foreground">({CONFIDENCE_LABEL[parsed.totalConfidence]})</span>
                  </td>
                  <td>
                    <input
                      aria-label="Correct total in rupees"
                      inputMode="decimal"
                      className={inputClass}
                      value={totalText ?? centsToInput(expected.total)}
                      onChange={(e) => {
                        setTotalText(e.target.value);
                        const cents = parseMoneyInput(e.target.value);
                        if (cents !== null) set({ total: cents });
                      }}
                      onBlur={() => setTotalText(null)}
                    />
                  </td>
                  <td><Mark ok={score.total} /></td>
                </tr>
                <tr>
                  <td className="text-muted-foreground">Paid by</td>
                  <td>{parsed.paymentMethod ? PAYMENT_LABEL[parsed.paymentMethod] : '—'}</td>
                  <td>
                    <select
                      aria-label="Correct payment method"
                      className={inputClass}
                      value={expected.payment ?? ''}
                      onChange={(e) => set({ payment: (e.target.value || null) as PaymentMethod | null })}
                    >
                      {PAYMENTS.map((p) => (
                        <option key={p ?? 'none'} value={p ?? ''}>
                          {p ? PAYMENT_LABEL[p] : 'Not shown on receipt'}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td><Mark ok={score.payment} /></td>
                </tr>
                <tr>
                  <td className="text-muted-foreground">Tax</td>
                  <td colSpan={3}>
                    {parsed.vatTotal === null ? 'not shown' : `${formatMoney(parsed.vatTotal)} VAT, included in the total`}
                  </td>
                </tr>
                <tr>
                  <td className="text-muted-foreground">Items</td>
                  <td>
                    {itemCount === 0
                      ? 'none found'
                      : parsed.itemsAddUp
                        ? `${itemCount} items, add up to the total`
                        : `${itemCount} items, but they come to ${formatMoney(parsed.itemsSum)}`}
                  </td>
                  <td>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={expected.itemized} onChange={(e) => set({ itemized: e.target.checked })} />
                      Receipt lists what was bought
                    </label>
                  </td>
                  <td>{score.itemsAddUp !== null && <Mark ok={score.itemsAddUp} />}</td>
                </tr>
              </tbody>
            </table>

            <div className="flex flex-wrap items-end gap-3">
              <label className="text-[13px] text-muted-foreground">
                Type of shop
                <select className={inputClass} value={expected.kind} onChange={(e) => set({ kind: e.target.value as ShopKind })}>
                  {SHOP_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-40 flex-1 text-[13px] text-muted-foreground">
                File name
                <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <button
                type="button"
                onClick={save}
                disabled={!expected.store || !expected.date || !expected.total}
                className="rounded-full bg-primary px-5 py-2 text-[15px] font-semibold text-primary-foreground disabled:opacity-40"
              >
                {scan.saved ? 'Saved ✓ (save again)' : 'All correct, save'}
              </button>
            </div>

            <details className="text-[15px]">
              <summary className="cursor-pointer text-primary">What it read as items ({parsed.items.length})</summary>
              <table className="mt-2 w-full text-left tabular-nums">
                <tbody className="[&_td]:py-0.5 [&_td]:pr-3">
                  {parsed.items.map((item, i) => (
                    <tr key={i} className={item.kind === 'discount' ? 'text-good' : undefined}>
                      <td className="w-full">{item.name}</td>
                      <td className="whitespace-nowrap text-right">{item.kind === 'item' && `${item.qty} × ${formatMoney(item.unitPrice)}`}</td>
                      <td className="whitespace-nowrap text-right">{formatMoney(item.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>

            <details className="text-[13px]">
              <summary className="cursor-pointer text-[15px] text-primary">
                {several ? 'All the text it read, photos joined' : 'All the text it read on the photo'}
              </summary>
              <p className="mt-2 text-muted-foreground">Lines in orange were hard to read.</p>
              <ol className="mt-1 space-y-0.5 font-mono">
                {scan.lines?.map((line, i) => (
                  <li key={i} className={line.confidence < 0.75 ? 'text-warn' : undefined}>
                    {line.text}
                  </li>
                ))}
              </ol>
            </details>
          </>
        )}
      </div>
    </article>
  );
}
