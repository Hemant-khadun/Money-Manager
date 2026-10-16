import { Camera, Images, Layers, PenLine, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { Page } from '../../components/Page';
import { useToast } from '../../components/Toast';
import { Group, Row, buttonBase, buttonKinds } from '../../components/primitives';
import { photosInOrder, type ReadScan } from '../../hooks/useReceiptReader';
import { restartedWhileReading } from '../../pipeline/care';
import { formatMoney } from '../../lib/format';
import { looksCutOff } from '../../scan/notes';
import { PhotoInput } from './PhotoInput';
import { ReviewSheet } from './ReviewSheet';

// Scan: take or pick photos, watch them being read, then check each receipt and save it.
// Receipts being read sit at the top of the screen, so a photo chosen on a phone shows up where
// the person is looking, not below the fold.

function status(scan: ReadScan, ready: boolean): string {
  const photos = scan.photos.length > 1 ? `${scan.photos.length} photos · ` : '';
  if (scan.status === 'queued') return `${photos}Waiting its turn`;
  if (scan.status === 'reading') return `${scan.step ?? (ready ? 'Getting started' : 'Getting ready, the first time takes a moment')}…`;
  if (scan.status === 'error') return scan.problem ?? "Couldn't read this photo";
  if (!scan.lines?.length) return `${photos}Couldn't find any writing. Try a closer photo in good light`;
  // A cut-off receipt's "total" is only a guess (an item's price): not shown as if it were the total.
  const total = looksCutOff(scan) ? null : scan.parsed?.total;
  return `${photos}Ready to check${total ? ` · ${formatMoney(total)}` : ''}`;
}

/** How far along reading a receipt is. Until the first step reports in, a bar that keeps moving. */
function ReadingBar({ percent }: { percent?: number }) {
  return (
    <div
      role="progressbar"
      aria-label="Reading the receipt"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary/15"
    >
      {percent === undefined ? (
        <div className="h-full w-1/3 animate-slide rounded-full bg-primary" />
      ) : (
        <div className="h-full rounded-full bg-primary transition-[width] duration-300 ease-linear" style={{ width: `${Math.max(percent, 4)}%` }} />
      )}
    </div>
  );
}

/** The receipt's photo. While it is being read, a light sweeps down it. */
function Thumb({ url, reading }: { url?: string; reading: boolean }) {
  return (
    <div className="relative size-12 shrink-0 overflow-hidden rounded-xl border border-border">
      <img src={url} alt="" className="size-full object-cover" />
      {reading && (
        <div aria-hidden className="absolute inset-x-0 top-0 animate-sweep [--sweep:44px]">
          <div className="h-0.5 bg-primary shadow-[0_0_8px_2px_var(--primary)]" />
        </div>
      )}
    </div>
  );
}

/**
 * Moves from `done` towards `next` while a step runs: the reader can't say how far into a step it
 * is, and a bar that stands still for a long step looks stuck. Slows down and stops short of `next`.
 */
function useCreep(progress: ReadScan['progress']): number | undefined {
  const [value, setValue] = useState(progress?.done);
  const done = progress?.done;
  const next = progress?.next;
  useEffect(() => {
    setValue(done);
    if (done === undefined || next === undefined) return;
    const start = Date.now();
    const timer = setInterval(() => setValue(done + (next - done) * 0.9 * (1 - Math.exp(-(Date.now() - start) / 8000))), 250);
    return () => clearInterval(timer);
  }, [done, next]);
  return value;
}

/**
 * Under a receipt in the list: take a photo of the rest of it. A plain link, or, when no total was
 * found at the bottom (the end of the receipt seems to be missing), a warning with a button.
 */
function NextPart({ scan, onPhotos }: { scan: ReadScan; onPhotos: (files: FileList | null) => void }) {
  if (looksCutOff(scan)) {
    return (
      <div className="pl-15">
        <p className="flex gap-2 text-subhead">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={2.25} />
          This receipt may be cut off: there's no total at the bottom.
        </p>
        <label className={`${buttonBase} ${buttonKinds.primary} mt-2 w-fit cursor-pointer`}>
          <Camera aria-hidden className="size-5" strokeWidth={2} />
          Take the next part
          <PhotoInput camera onPhotos={onPhotos} />
        </label>
      </div>
    );
  }
  return (
    <label className="-mt-2 ml-15 flex min-h-11 w-fit cursor-pointer items-center gap-1.5 text-subhead font-medium text-primary">
      <Camera aria-hidden className="size-4" strokeWidth={2} />
      Cut off? Take the next part
      <PhotoInput camera onPhotos={onPhotos} />
    </label>
  );
}

/** Under a receipt taken right after one that seems cut off, and not joined to it by itself. */
function JoinBelow({ onJoin }: { onJoin: () => void }) {
  return (
    <div className="pl-15">
      <p className="text-subhead">Is this the rest of the receipt below?</p>
      <button type="button" className={`${buttonBase} ${buttonKinds.primary} mt-2 w-fit`} onClick={onJoin}>
        Yes, join them
      </button>
    </div>
  );
}

/** One receipt in the list: being read (with how far along), ready to check, or failed. */
function ScanRow({
  scan,
  ready,
  onOpen,
  onRetry,
  onRemove,
  onMorePhotos,
  onJoinBelow,
}: {
  scan: ReadScan;
  ready: boolean;
  onOpen: () => void;
  onRetry: () => void;
  onRemove: () => void;
  onMorePhotos: (files: FileList | null) => void;
  /** It may be the rest of the receipt below it in the list: join them. */
  onJoinBelow?: () => void;
}) {
  const reading = scan.status === 'reading';
  const creep = useCreep(reading ? scan.progress : undefined);
  const percent = reading && creep !== undefined ? Math.round(creep * 100) : undefined;
  const words = status(scan, ready);
  return (
    <Row
      onClick={scan.status === 'done' ? onOpen : undefined}
      icon={<Thumb url={photosInOrder(scan)[0]?.url} reading={reading} />}
      title={scan.parsed?.storeName ?? (scan.status === 'done' || scan.status === 'error' ? 'Receipt' : 'Reading…')}
      subtitle={
        reading ? (
          <span className="animate-shimmer bg-[linear-gradient(90deg,var(--muted-foreground)_35%,var(--foreground)_50%,var(--muted-foreground)_65%)] bg-size-[200%_100%] bg-clip-text text-transparent">
            {words}
          </span>
        ) : (
          words
        )
      }
      below={reading && <ReadingBar percent={percent} />}
      extra={
        onJoinBelow ? (
          <JoinBelow onJoin={onJoinBelow} />
        ) : (
          scan.status !== 'error' && (scan.status !== 'done' || !!scan.lines?.length) && <NextPart scan={scan} onPhotos={onMorePhotos} />
        )
      }
      value={
        percent !== undefined ? (
          <span className="text-subhead text-muted-foreground">{percent}%</span>
        ) : scan.status === 'done' ? (
          <span className="rounded-full bg-primary px-3 py-1.5 text-footnote font-semibold text-primary-foreground">Check</span>
        ) : scan.status === 'error' ? (
          <span className="flex gap-3 text-subhead">
            <button type="button" className="min-h-11 text-primary" onClick={onRetry}>
              Try again
            </button>
            <button type="button" className="min-h-11 text-bad" onClick={onRemove}>
              Remove
            </button>
          </span>
        ) : undefined
      }
    />
  );
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
  const toast = useToast();
  const [openId, setOpenId] = useState<number | null>(null);
  const { engine, engineError, warmUp, scans } = reader;
  const open = scans.find((s) => s.id === openId && s.status === 'done') ?? null;
  const busy = scans.length > 0;
  const list = useRef<HTMLDivElement>(null);
  const justChosen = useRef(false);

  // Start the reader as soon as the person is here: the first photo then reads without waiting.
  useEffect(warmUp, [warmUp]);

  // Photos just chosen: make sure their row is on screen, even if the page was scrolled down.
  useEffect(() => {
    if (!justChosen.current) return;
    justChosen.current = false;
    list.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [scans.length]);

  const addPhotos = (files: FileList | null) => {
    justChosen.current = reader.add(files).length > 0;
  };

  return (
    <Page title="Scan" glow>
      {!busy && restartedWhileReading() && (
        <p className="panel mt-3 p-4 text-subhead" role="status">
          Money Manager had to start again while reading your last photo, probably because the phone ran short of memory. It now reads more gently, which takes
          a little longer. Please add the photo again.
        </p>
      )}
      {busy && (
        <div ref={list} className="scroll-mt-16">
          <Group title="Receipts">
            {scans.map((scan, k) => {
              // Newest first: the one below was taken just before. If it seems cut off, this may be its next part.
              const below = scans[k + 1];
              const joinable = scan.status === 'done' && !!scan.lines?.length && !!below && looksCutOff(below);
              return (
                <ScanRow
                  key={scan.id}
                  scan={scan}
                  ready={!!engine}
                  onOpen={() => setOpenId(scan.id)}
                  onRetry={() => reader.reread(scan.id)}
                  onRemove={() => reader.remove(scan.id)}
                  onMorePhotos={(files) => reader.addPhotosTo(scan.id, files)}
                  onJoinBelow={joinable ? () => reader.joinInto(scan.id, below.id) : undefined}
                />
              );
            })}
          </Group>
        </div>
      )}

      <div className={`panel relative overflow-hidden px-5 pb-5 ${busy ? 'mt-6 pt-5' : 'mt-3 pt-6'}`}>
        <div aria-hidden className="dot-grid absolute inset-0" />
        {busy ? (
          <p className="relative text-center text-headline">Another receipt?</p>
        ) : (
          <>
            <ScanPicture />
            <p className="relative mt-5 text-center text-headline">Snap a receipt</p>
            <p className="relative mx-auto mt-1 max-w-72 text-center text-subhead text-muted-foreground">
              Money Manager finds the shop, the date, the total and each thing you bought.
            </p>
          </>
        )}
        <label className={`${buttonBase} ${buttonKinds.primary} relative mt-5 min-h-14 cursor-pointer text-headline`}>
          <Camera aria-hidden className="size-6" strokeWidth={1.9} />
          Take a photo
          <PhotoInput camera onPhotos={addPhotos} />
        </label>
        <div className="relative mt-2.5 grid grid-cols-2 gap-2.5">
          <label className={`${tileButton} cursor-pointer`}>
            <Images aria-hidden className="size-5 text-primary" strokeWidth={2} />
            Choose photos
            <PhotoInput multiple onPhotos={addPhotos} />
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
          Photograph the top first, then tap <strong className="font-semibold text-foreground">Take the next part</strong> under it for the rest. Let each
          photo repeat two or three lines of the one before, and Money Manager joins them into one receipt. You can also choose several photos together.
        </p>
      </div>
      <p className="mt-3 flex items-start gap-2 px-1 text-footnote text-muted-foreground" role="status">
        <ShieldCheck aria-hidden className="mt-px size-4 shrink-0" strokeWidth={2} />
        {engineError
          ? "The receipt reader couldn't start. Check your internet connection, then reload the page."
          : engine
            ? 'Photos are read on this phone. Nothing is sent anywhere.'
            : 'Getting the receipt reader ready… the first time takes a moment.'}
      </p>

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
        onRemovePhoto={(scan, photoId) => {
          setOpenId(null);
          reader.removePhoto(scan.id, photoId);
        }}
        onDelete={(scan) => {
          setOpenId(null);
          toast('Receipt deleted', { label: 'Undo', run: reader.discard(scan.id) });
        }}
      />
    </Page>
  );
}
