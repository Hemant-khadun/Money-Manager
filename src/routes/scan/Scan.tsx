import { Camera, Images, Layers, PenLine, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { Page } from '../../components/Page';
import { Group, Row, buttonBase, buttonKinds } from '../../components/primitives';
import { photosInOrder, type ReadScan } from '../../hooks/useReceiptReader';
import { formatMoney } from '../../lib/format';
import { ReviewSheet } from './ReviewSheet';

// Scan: take or pick photos, watch them being read, then check each receipt and save it.

function status(scan: ReadScan): string {
  const photos = scan.photos.length > 1 ? `${scan.photos.length} photos · ` : '';
  if (scan.status === 'queued') return `${photos}Waiting its turn`;
  if (scan.status === 'reading') return `${scan.step ?? 'Getting started'}…`;
  if (scan.status === 'error') return "Couldn't read this photo";
  const total = scan.parsed?.total;
  return `${photos}Ready to check${total ? ` · ${formatMoney(total)}` : ''}`;
}

// The two quieter ways in, as small tiles: icon above the words, so both fit side by side.
const tileButton =
  'flex min-h-18 flex-col items-center justify-center gap-1.5 rounded-2xl border border-border bg-card px-2 py-2.5 text-subhead font-semibold shadow-card transition-transform active:scale-[0.97]';

/** A receipt with a soft light sweeping down it, while the camera waits. */
function ScanPicture() {
  return (
    <div aria-hidden className="relative mx-auto h-36 w-28 overflow-hidden rounded-xl border border-border bg-background shadow-card">
      <div className="space-y-2 px-3 pt-4">
        <div className="mx-auto h-2 w-12 rounded-full bg-track" />
        {[80, 65, 72, 50, 68, 58].map((w, i) => (
          <div key={i} className="flex justify-between gap-2">
            <div className="h-1.5 rounded-full bg-track/70" style={{ width: `${w}%` }} />
            <div className="h-1.5 w-4 rounded-full bg-track/70" />
          </div>
        ))}
        <div className="flex justify-between border-t border-dashed border-track pt-2">
          <div className="h-2 w-8 rounded-full bg-track" />
          <div className="h-2 w-6 rounded-full bg-primary/60" />
        </div>
      </div>
      <div className="absolute inset-x-0 top-1 animate-sweep [--sweep:118px]">
        <div className="h-8 -translate-y-full bg-linear-to-b from-transparent to-primary/25" />
        <div className="mx-1 h-0.5 rounded-full bg-primary shadow-[0_0_12px_2px_var(--primary)]" />
      </div>
    </div>
  );
}

export function Scan() {
  const { reader, setAddExpenseOpen } = useApp();
  const [openId, setOpenId] = useState<number | null>(null);
  const { engine, engineError, warmUp, scans } = reader;
  const open = scans.find((s) => s.id === openId && s.status === 'done') ?? null;

  // Start the reader as soon as the person is here: the first photo then reads without waiting.
  useEffect(warmUp, [warmUp]);

  const picker = (multiple: boolean, capture: boolean) => (
    <input
      type="file"
      accept="image/*"
      multiple={multiple}
      capture={capture ? 'environment' : undefined}
      className="sr-only"
      onChange={(e) => {
        reader.add(e.target.files);
        e.target.value = '';
      }}
    />
  );

  return (
    <Page title="Scan" glow>
      <div className="panel relative mt-3 overflow-hidden px-5 pb-5 pt-6">
        <div aria-hidden className="dot-grid absolute inset-0" />
        <ScanPicture />
        <p className="relative mt-5 text-center text-headline">Snap a receipt</p>
        <p className="relative mx-auto mt-1 max-w-72 text-center text-subhead text-muted-foreground">Spent finds the shop, the date, the total and each thing you bought.</p>
        <label className={`${buttonBase} ${buttonKinds.primary} relative mt-5 min-h-14 cursor-pointer text-headline`}>
          <Camera aria-hidden className="size-6" strokeWidth={1.9} />
          Take a photo
          {picker(false, true)}
        </label>
        <div className="relative mt-2.5 grid grid-cols-2 gap-2.5">
          <label className={`${tileButton} cursor-pointer`}>
            <Images aria-hidden className="size-5 text-primary" strokeWidth={2} />
            Choose photos
            {picker(true, false)}
          </label>
          <button type="button" className={tileButton} onClick={() => setAddExpenseOpen(true)}>
            <PenLine aria-hidden className="size-5 text-primary" strokeWidth={2} />
            No receipt
          </button>
        </div>
      </div>

      <div className="panel mt-3 flex gap-3 p-4">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
          <Layers className="size-5" strokeWidth={2} />
        </span>
        <p className="text-footnote text-muted-foreground">
          <strong className="block text-subhead font-semibold text-foreground">Long receipt?</strong>
          Take a few photos from top to bottom, each one repeating two or three lines of the one before, and choose them together: Spent joins them into one
          receipt.
        </p>
      </div>
      <p className="mt-3 flex items-start gap-2 px-1 text-footnote text-muted-foreground" role="status">
        <ShieldCheck aria-hidden className="mt-px size-4 shrink-0" strokeWidth={2} />
        {engineError
          ? `The receipt reader couldn't start: ${engineError}`
          : engine
            ? 'Photos are read on this phone. Nothing is sent anywhere.'
            : 'Getting the receipt reader ready… the first time takes a moment.'}
      </p>

      {scans.length > 0 && (
        <Group title="Receipts">
          {scans.map((scan) => {
            const top = photosInOrder(scan)[0];
            const words = status(scan);
            return (
              <Row
                key={scan.id}
                onClick={scan.status === 'done' ? () => setOpenId(scan.id) : undefined}
                icon={<img src={top?.url} alt="" className="size-12 shrink-0 rounded-xl border border-border object-cover" />}
                title={scan.parsed?.storeName ?? (scan.status === 'done' ? 'Receipt' : 'Reading…')}
                subtitle={
                  scan.status === 'reading' ? (
                    <span className="animate-shimmer bg-[linear-gradient(90deg,var(--muted-foreground)_35%,var(--foreground)_50%,var(--muted-foreground)_65%)] bg-size-[200%_100%] bg-clip-text text-transparent">
                      {words}
                    </span>
                  ) : (
                    words
                  )
                }
                value={
                  scan.status === 'done' ? (
                    <span className="rounded-full bg-primary px-3 py-1.5 text-footnote font-semibold text-primary-foreground">Check</span>
                  ) : scan.status === 'error' ? (
                    <span className="flex gap-3 text-subhead">
                      <button type="button" className="min-h-11 text-primary" onClick={() => reader.reread(scan.id)}>
                        Try again
                      </button>
                      <button type="button" className="min-h-11 text-bad" onClick={() => reader.remove(scan.id)}>
                        Remove
                      </button>
                    </span>
                  ) : undefined
                }
              />
            );
          })}
        </Group>
      )}

      <ReviewSheet
        scan={open}
        onClose={() => setOpenId(null)}
        onSaved={(scan) => {
          setOpenId(null);
          reader.remove(scan.id);
        }}
        onAddPhotos={(scan, files) => {
          setOpenId(null);
          reader.addPhotosTo(scan.id, files);
        }}
        onSplit={(scan) => {
          setOpenId(null);
          reader.split(scan.id);
        }}
      />
    </Page>
  );
}
