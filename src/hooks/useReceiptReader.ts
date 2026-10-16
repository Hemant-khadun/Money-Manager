import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from '../lib/describe-error';
import { debugLog } from '../lib/debug-log';
import type { OcrLine, ParsedReceipt } from '../parser/types';
import type { OcrClient, OcrEngineInfo } from '../pipeline/ocr-client';
import type { OcrStrategy, ReadReport } from '../pipeline/ocr-protocol';
import { forgetPending, highestId, keepPending, loadPending, pendingKey, photoFile, toPending } from '../scan/pending';

// Reading receipt photos, for the Scan screen and the reading test page. Photos are read one at a
// time in the OCR worker. Photos added together are sorted once all are read: the parts of a long
// receipt (photos that overlap) are joined into one receipt, the rest stay receipts of their own.
// A photo added on its own is checked the same way against the receipt added just before it, so
// the parts of a long receipt can be taken one after another without waiting.
// With `keep`, receipts not saved yet are kept on the phone and come back when the page opens
// again (scan/pending.ts).

/** The OCR client loads with the first photo (or the Scan screen), not with the app. */
let started: Promise<OcrClient> | undefined;
const ocr = {
  module: () => import('../pipeline/ocr-client'),
  get: () => (started ??= ocr.module().then((m) => new m.OcrClient())),
  ready: () => ocr.get().then((c) => c.ready()),
};

/** Parsing and joining load with the first photo, not with the app. */
const tools = () => Promise.all([import('../parser/parse'), import('../pipeline/stitch')]).then(([parse, stitch]) => ({ ...parse, ...stitch }));

export interface Photo {
  id: number;
  file: File;
  url: string;
}

/** What the reader got from one photo. */
export interface Reading {
  strategy: OcrStrategy;
  lines: OcrLine[];
  report: ReadReport;
  ms: number;
}

/** One receipt being read: a single photo, or several photos of a long receipt joined into one. */
export interface ReadScan {
  id: number;
  /** In the order they were added; `order` gives them top to bottom once read. */
  photos: Photo[];
  status: 'queued' | 'reading' | 'done' | 'error';
  error?: string;
  /** Why it failed, in plain words, when that is known. */
  problem?: string;
  strategy?: OcrStrategy;
  backend?: OcrEngineInfo['backend'];
  /** By photo id. */
  readings?: Record<number, Reading>;
  /** Photo ids top to bottom, as the overlaps between them show. */
  order?: number[];
  /** Between each photo and the next (in `order`): lines they share, or null when no overlap was found. */
  joins?: Array<{ shared: number } | null>;
  /** The receipt's lines, all photos joined. */
  lines?: OcrLine[];
  /** Total reading time for all its photos. */
  ms?: number;
  /** What the reader is doing right now ("Photo 2 of 3: Reading part 1 of 2"). */
  step?: string;
  /** How far along reading all its photos is, and where the current step ends (0..1). Unset until the first step starts. */
  progress?: { done: number; next: number };
  parsed?: ParsedReceipt;
  /** Photos added together were found to continue each other and joined into this one receipt. */
  joinedAutomatically?: boolean;
  /** When its latest photo was added (ms). */
  addedAt: number;
}

export interface ReaderOptions {
  /** Reading style for photos read from now on. */
  strategy?: OcrStrategy;
  /** Whether these receipts may still be joined automatically (the person hasn't worked on them yet). */
  canJoin?: (scanIds: number[]) => boolean;
  /** Keep receipts not saved yet on the phone, and bring them back when the page opens again. */
  keep?: boolean;
}

/** Photos added together, waiting until all are read to see which belong to the same receipt. */
type Batch = Array<{ scanId: number; photo: Photo }>;

/** A photo added on its own may continue the receipt added just before it, if that was this recent. */
const CONTINUE_WITHIN_MS = 10 * 60_000;

/** How long a thrown-away receipt can still be brought back (a little longer than the "Undo" shows). */
const UNDO_MS = 10_000;

interface Job {
  scanId: number;
  photos: Photo[];
  strategy: OcrStrategy;
}

let nextId = 1;

function toPhotos(files: FileList | File[]): Photo[] {
  return [...files].map((file) => ({ id: nextId++, file, url: URL.createObjectURL(file) }));
}

/** The receipt's photos top to bottom (as read), any added since at the end. */
export function photosInOrder(scan: ReadScan): Photo[] {
  const byId = new Map(scan.photos.map((p) => [p.id, p]));
  const ordered = (scan.order ?? []).map((id) => byId.get(id)).filter((p): p is Photo => !!p);
  return [...ordered, ...scan.photos.filter((p) => !ordered.includes(p))];
}

export function useReceiptReader(options: ReaderOptions = {}) {
  const [engine, setEngine] = useState<OcrEngineInfo | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [scans, setScans] = useState<ReadScan[]>([]);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const scansRef = useRef(scans);
  scansRef.current = scans;
  const queue = useRef<Job[]>([]);
  const busy = useRef(false);
  /** Readings by photo id, so adding a photo to a receipt only reads the new one. */
  const cache = useRef(new Map<number, Reading>());
  const batches = useRef(new Map<number, Batch>());
  const batchOf = useRef(new Map<number, number>());
  /** What's kept on the phone of each receipt (pendingKey), by receipt id. */
  const kept = useRef(new Map<number, string>());
  /** Thrown away, but still kept on the phone until its Undo runs out. */
  const discarded = useRef(new Set<number>());
  /** How many receipts came back from last time; null until looked for. */
  const [restored, setRestored] = useState<number | null>(options.keep ? null : 0);
  const keep = !!options.keep;

  // Brings back the receipts not saved last time. Already read: ready to check without reading again.
  useEffect(() => {
    if (!keep) return;
    let cancelled = false;
    loadPending().then(
      (records) => {
        if (cancelled) return;
        nextId = Math.max(nextId, highestId(records) + 1);
        const back = records.map((r): ReadScan => {
          for (const [id, reading] of Object.entries(r.readings)) cache.current.set(Number(id), reading);
          kept.current.set(r.id, pendingKey(r));
          const photos = r.photos.map((p) => {
            const file = photoFile(p);
            return { id: p.id, file, url: URL.createObjectURL(file) };
          });
          return { id: r.id, photos, status: 'queued', addedAt: r.addedAt, joinedAutomatically: r.joinedAutomatically };
        });
        if (back.length) debugLog('app', `Brought back ${back.length === 1 ? 'a receipt' : `${back.length} receipts`} not saved last time`);
        setScans((all) => [...all, ...back].sort((a, b) => b.addedAt - a.addedAt));
        setRestored(back.length);
        for (const scan of back) enqueue(scan.id, scan.photos);
      },
      (err) => {
        debugLog('app', `Couldn't bring back the receipts not saved: ${describeError(err)}`);
        if (!cancelled) setRestored(0);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [keep]);

  // Keeps each receipt on the phone as it changes (photos added, joined, split, taken out, read).
  useEffect(() => {
    if (!keep || restored === null) return;
    const now = new Map(scans.map((s) => [s.id, toPending(s, (id) => cache.current.get(id))]));
    const changed = [...now.values()].filter((p) => kept.current.get(p.id) !== pendingKey(p));
    const gone = [...kept.current.keys()].filter((id) => !now.has(id) && !discarded.current.has(id));
    for (const p of changed) kept.current.set(p.id, pendingKey(p));
    for (const id of gone) kept.current.delete(id);
    keepPending(changed, gone).catch((err) => debugLog('app', `Couldn't keep the receipts not saved yet: ${describeError(err)}`));
  }, [keep, restored, scans]);

  const update = (id: number, patch: (s: ReadScan) => Partial<ReadScan>) =>
    setScans((all) => all.map((s) => (s.id === id ? { ...s, ...patch(s) } : s)));

  /** Starts the reader (loads the models) ahead of the first photo. */
  const warmUp = useCallback(() => {
    ocr.ready().then(
      (info) => {
        setEngine(info);
        setEngineError(null);
      },
      (err: Error) => setEngineError(err.message),
    );
  }, []);

  // One photo at a time: the OCR sessions in the worker don't run concurrently.
  async function pump() {
    if (busy.current) return;
    busy.current = true;
    while (queue.current.length) {
      const job = queue.current.shift()!;
      // The photos changed again since: the newer request covers this one.
      if (queue.current.some((j) => j.scanId === job.scanId)) continue;
      update(job.scanId, () => ({ status: 'reading', error: undefined, problem: undefined, step: undefined, progress: undefined }));
      try {
        // Photos already read (brought back from last time, or added to) aren't read again.
        const toRead = job.photos.some((p) => cache.current.get(p.id)?.strategy !== job.strategy);
        const backend = toRead ? (await ocr.ready()).backend : undefined;
        for (const [k, photo] of job.photos.entries()) {
          if (cache.current.get(photo.id)?.strategy === job.strategy) continue;
          const prefix = job.photos.length > 1 ? `Photo ${k + 1} of ${job.photos.length}: ` : '';
          const run = await (await ocr.get()).recognize(photo.file, job.strategy, (step, done, next) =>
            update(job.scanId, () => ({ step: prefix + step, progress: { done: (k + done) / job.photos.length, next: (k + next) / job.photos.length } })),
          );
          cache.current.set(photo.id, { strategy: job.strategy, lines: run.lines, report: run.report, ms: run.ms });
        }
        const { parseReceipt, stitchPhotos } = await tools();
        const readings = job.photos.map((p) => cache.current.get(p.id)!);
        const joined = stitchPhotos(readings.map((r) => r.lines));
        const parsed = parseReceipt(joined.lines);
        const found = (what: string, value: unknown) => `${what} ${value == null ? 'not found' : 'found'}`;
        debugLog(
          'app',
          `Receipt read: ${joined.lines.length} lines; ${[found('shop', parsed.storeName), found('date', parsed.date), found('total', parsed.total)].join(', ')}; ${parsed.items.length} items`,
        );
        update(job.scanId, () => ({
          status: 'done',
          step: undefined,
          progress: undefined,
          strategy: job.strategy,
          ...(backend && { backend }),
          readings: Object.fromEntries(job.photos.map((p, i) => [p.id, readings[i]])),
          order: joined.order.map((i) => job.photos[i].id),
          joins: joined.joins,
          lines: joined.lines,
          ms: readings.reduce((t, r) => t + r.ms, 0),
          parsed,
        }));
        const batchId = batchOf.current.get(job.scanId);
        if (batchId !== undefined) await sortBatch(batchId);
      } catch (err) {
        debugLog('app', `Receipt failed: ${describeError(err)}`);
        const { ReaderStopped } = await ocr.module();
        update(job.scanId, () => ({
          status: 'error',
          step: undefined,
          progress: undefined,
          error: err instanceof Error ? err.message : String(err),
          problem: err instanceof ReaderStopped ? err.message : undefined,
        }));
        await leaveBatch(job.scanId);
      }
    }
    busy.current = false;
  }

  function enqueue(scanId: number, photos: Photo[]) {
    queue.current.push({ scanId, photos, strategy: optionsRef.current.strategy ?? 'per-box' });
    void pump();
  }

  /**
   * Once every photo added together is read, joins the ones that continue each other (the parts
   * of a long receipt) into one receipt. The rest stay receipts of their own.
   */
  async function sortBatch(batchId: number) {
    const members = batches.current.get(batchId);
    if (!members || !members.every((m) => cache.current.has(m.photo.id))) return;
    batches.current.delete(batchId);
    for (const m of members) batchOf.current.delete(m.scanId);

    const { groupPhotos } = await tools();
    for (const group of groupPhotos(members.map((m) => cache.current.get(m.photo.id)!.lines))) {
      const parts = group.map((i) => members[i]);
      const merged = new Set(parts.map((m) => m.scanId));
      if (merged.size < 2) continue;
      // A receipt already made of several photos joins whole or not at all: never split one up here.
      if (members.some((m) => merged.has(m.scanId) && !parts.includes(m))) continue;
      if (optionsRef.current.canJoin && !optionsRef.current.canJoin([...merged])) continue;
      const keepId = members[Math.min(...group)].scanId;
      const photos = parts.map((m) => m.photo);
      debugLog('app', `Photos continue each other: joined ${photos.length} photos into one receipt`);
      setScans((all) =>
        all.flatMap((s) => {
          if (s.id === keepId) return [{ ...s, photos, status: 'queued' as const, joinedAutomatically: true, addedAt: Date.now() }];
          return merged.has(s.id) ? [] : [s];
        }),
      );
      enqueue(keepId, photos);
    }
  }

  /**
   * A photo added on its own: once it and the receipt added just before it are read, they are
   * joined if the photo continues that receipt (the next part of a long receipt).
   */
  function tryContinuing(photoScan: ReadScan) {
    const previous = scansRef.current.filter((s) => s.status !== 'error').sort((a, b) => b.addedAt - a.addedAt)[0];
    if (!previous || photoScan.addedAt - previous.addedAt > CONTINUE_WITHIN_MS) return;
    if (optionsRef.current.canJoin && !optionsRef.current.canJoin([previous.id])) return;
    const sorting = batchOf.current.get(previous.id);
    if (sorting !== undefined) {
      // The photos before it are still being sorted (taken quickly one after another): it joins them.
      batches.current.get(sorting)!.push({ scanId: photoScan.id, photo: photoScan.photos[0] });
      batchOf.current.set(photoScan.id, sorting);
      return;
    }
    const batchId = nextId++;
    batches.current.set(batchId, [
      ...photosInOrder(previous).map((photo) => ({ scanId: previous.id, photo })),
      { scanId: photoScan.id, photo: photoScan.photos[0] },
    ]);
    batchOf.current.set(previous.id, batchId);
    batchOf.current.set(photoScan.id, batchId);
    // Already read: the check runs as soon as the new photo is.
    void sortBatch(batchId);
  }

  /** A photo that can't take part in sorting its batch any more (it failed, or was removed or changed). */
  async function leaveBatch(scanId: number) {
    const batchId = batchOf.current.get(scanId);
    if (batchId === undefined) return;
    batchOf.current.delete(scanId);
    batches.current.set(batchId, batches.current.get(batchId)!.filter((m) => m.scanId !== scanId));
    await sortBatch(batchId);
  }

  /** New photos: each starts as its own receipt; photos added together are sorted once read. Returns their ids. */
  function add(files: FileList | File[] | null): number[] {
    if (!files?.length) {
      debugLog('app', 'No photo came back from the picker');
      return [];
    }
    for (const file of files) debugLog('app', `Photo chosen: ${(file.size / 1e6).toFixed(1)} MB, ${file.type || 'unknown type'}`);
    const added = toPhotos(files).map((photo): ReadScan => ({ id: nextId++, photos: [photo], status: 'queued', addedAt: Date.now() }));
    if (added.length === 1) tryContinuing(added[0]);
    if (added.length > 1) {
      const batchId = nextId++;
      batches.current.set(batchId, added.map((s) => ({ scanId: s.id, photo: s.photos[0] })));
      for (const s of added) batchOf.current.set(s.id, batchId);
    }
    setScans((all) => [...added, ...all]);
    for (const scan of added) enqueue(scan.id, scan.photos);
    return added.map((s) => s.id);
  }

  /** More photos of the same receipt (taken later, or that didn't overlap enough to be matched). */
  function addPhotosTo(scanId: number, files: FileList | File[] | null) {
    const scan = scansRef.current.find((s) => s.id === scanId);
    if (!files?.length) {
      debugLog('app', 'No photo came back from the picker');
      return;
    }
    if (!scan) return;
    debugLog('app', `Added ${files.length === 1 ? 'a photo' : `${files.length} photos`} to a receipt`);
    void leaveBatch(scanId);
    const photos = [...scan.photos, ...toPhotos(files)];
    update(scanId, () => ({ photos, addedAt: Date.now() }));
    enqueue(scanId, photos);
  }

  /**
   * The person says one receipt is the rest of another (the next part of a long one, which wasn't
   * joined by itself): its photos go to that receipt, after its own. Nothing is read again.
   */
  function joinInto(scanId: number, intoId: number) {
    const from = scansRef.current.find((s) => s.id === scanId);
    const into = scansRef.current.find((s) => s.id === intoId);
    if (!from || !into || scanId === intoId) return;
    void leaveBatch(scanId);
    void leaveBatch(intoId);
    queue.current = queue.current.filter((j) => j.scanId !== scanId);
    const photos = [...photosInOrder(into), ...photosInOrder(from)];
    debugLog('app', `Joined two receipts into one, as asked (${photos.length} photos)`);
    setScans((all) => all.filter((s) => s.id !== scanId).map((s) => (s.id === intoId ? { ...s, photos, joinedAutomatically: false, addedAt: Date.now() } : s)));
    enqueue(intoId, photos);
  }

  function removePhoto(scanId: number, photoId: number) {
    const scan = scansRef.current.find((s) => s.id === scanId);
    const photo = scan?.photos.find((p) => p.id === photoId);
    if (!scan || !photo || scan.photos.length < 2) return;
    URL.revokeObjectURL(photo.url);
    cache.current.delete(photoId);
    const photos = scan.photos.filter((p) => p.id !== photoId);
    update(scanId, () => ({ photos }));
    enqueue(scanId, photos);
  }

  /** Undo an automatic join: one receipt per photo again. Returns the new receipts' ids. */
  function split(scanId: number): number[] {
    const scan = scansRef.current.find((s) => s.id === scanId);
    if (!scan) return [];
    const separate = scan.photos.map((photo, k): ReadScan => ({ id: k === 0 ? scan.id : nextId++, photos: [photo], status: 'queued', addedAt: scan.addedAt }));
    setScans((all) => all.flatMap((s) => (s.id === scanId ? separate : [s])));
    for (const s of separate) enqueue(s.id, s.photos);
    return separate.map((s) => s.id);
  }

  function reread(scanId: number) {
    const scan = scansRef.current.find((s) => s.id === scanId);
    if (!scan) return;
    for (const p of scan.photos) cache.current.delete(p.id);
    enqueue(scanId, scan.photos);
  }

  /** Takes a receipt off the list; its photos are kept until `free`. */
  function takeOff(scanId: number) {
    void leaveBatch(scanId);
    queue.current = queue.current.filter((j) => j.scanId !== scanId);
    setScans((all) => all.filter((s) => s.id !== scanId));
  }

  function free(scan: ReadScan | undefined) {
    for (const p of scan?.photos ?? []) {
      URL.revokeObjectURL(p.url);
      cache.current.delete(p.id);
    }
  }

  /** Forgets a receipt (saved, or thrown away), freeing its photos. */
  function remove(scanId: number) {
    const scan = scansRef.current.find((s) => s.id === scanId);
    takeOff(scanId);
    free(scan);
  }

  /**
   * Throws a receipt away, but keeps its photos for a little while: the returned function puts it
   * back as it was (the "Undo" after deleting). Photos taken with the camera exist nowhere else.
   */
  function discard(scanId: number): () => void {
    const scan = scansRef.current.find((s) => s.id === scanId);
    if (!scan) return () => {};
    discarded.current.add(scanId);
    takeOff(scanId);
    const later = setTimeout(() => {
      free(scan);
      discarded.current.delete(scanId);
      if (kept.current.delete(scanId)) void forgetPending(scanId).catch((err) => debugLog('app', `Couldn't forget a receipt thrown away: ${describeError(err)}`));
    }, UNDO_MS);
    return () => {
      clearTimeout(later);
      discarded.current.delete(scanId);
      setScans((all) => (all.some((s) => s.id === scanId) ? all : [scan, ...all]));
      if (scan.status === 'queued' || scan.status === 'reading') enqueue(scan.id, scan.photos);
    };
  }

  return { engine, engineError, scans, restored, warmUp, add, addPhotosTo, joinInto, removePhoto, split, reread, remove, discard };
}

export type ReceiptReader = ReturnType<typeof useReceiptReader>;
