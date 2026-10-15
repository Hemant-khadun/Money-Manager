import { useCallback, useRef, useState } from 'react';
import type { OcrLine, ParsedReceipt } from '../parser/types';
import { OcrClient, type OcrEngineInfo } from '../pipeline/ocr-client';
import type { OcrStrategy, ReadReport } from '../pipeline/ocr-protocol';

// Reading receipt photos, for the Scan screen and the reading test page. Photos are read one at a
// time in the OCR worker. Photos added together are sorted once all are read: the parts of a long
// receipt (photos that overlap) are joined into one receipt, the rest stay receipts of their own.

const ocr = new OcrClient();

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
}

export interface ReaderOptions {
  /** Reading style for photos read from now on. */
  strategy?: OcrStrategy;
  /** Whether these receipts may still be joined automatically (the person hasn't worked on them yet). */
  canJoin?: (scanIds: number[]) => boolean;
}

/** Photos added together, waiting until all are read to see which belong to the same receipt. */
type Batch = Array<{ scanId: number; photo: Photo }>;

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
      update(job.scanId, () => ({ status: 'reading', error: undefined, step: undefined, progress: undefined }));
      try {
        const { backend } = await ocr.ready();
        for (const [k, photo] of job.photos.entries()) {
          if (cache.current.get(photo.id)?.strategy === job.strategy) continue;
          const prefix = job.photos.length > 1 ? `Photo ${k + 1} of ${job.photos.length}: ` : '';
          const run = await ocr.recognize(photo.file, job.strategy, (step, done, next) =>
            update(job.scanId, () => ({ step: prefix + step, progress: { done: (k + done) / job.photos.length, next: (k + next) / job.photos.length } })),
          );
          cache.current.set(photo.id, { strategy: job.strategy, lines: run.lines, report: run.report, ms: run.ms });
        }
        const { parseReceipt, stitchPhotos } = await tools();
        const readings = job.photos.map((p) => cache.current.get(p.id)!);
        const joined = stitchPhotos(readings.map((r) => r.lines));
        update(job.scanId, () => ({
          status: 'done',
          step: undefined,
          progress: undefined,
          strategy: job.strategy,
          backend,
          readings: Object.fromEntries(job.photos.map((p, i) => [p.id, readings[i]])),
          order: joined.order.map((i) => job.photos[i].id),
          joins: joined.joins,
          lines: joined.lines,
          ms: readings.reduce((t, r) => t + r.ms, 0),
          parsed: parseReceipt(joined.lines),
        }));
        const batchId = batchOf.current.get(job.scanId);
        if (batchId !== undefined) await sortBatch(batchId);
      } catch (err) {
        update(job.scanId, () => ({ status: 'error', step: undefined, progress: undefined, error: err instanceof Error ? err.message : String(err) }));
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
      if (group.length < 2) continue;
      const parts = group.map((i) => members[i]);
      if (optionsRef.current.canJoin && !optionsRef.current.canJoin(parts.map((m) => m.scanId))) continue;
      const keepId = members[Math.min(...group)].scanId;
      const photos = parts.map((m) => m.photo);
      const merged = new Set(parts.map((m) => m.scanId));
      setScans((all) =>
        all.flatMap((s) => {
          if (s.id === keepId) return [{ ...s, photos, status: 'queued' as const, joinedAutomatically: true }];
          return merged.has(s.id) ? [] : [s];
        }),
      );
      enqueue(keepId, photos);
    }
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
    if (!files?.length) return [];
    const added = toPhotos(files).map((photo): ReadScan => ({ id: nextId++, photos: [photo], status: 'queued' }));
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
    if (!scan || !files?.length) return;
    void leaveBatch(scanId);
    const photos = [...scan.photos, ...toPhotos(files)];
    update(scanId, () => ({ photos }));
    enqueue(scanId, photos);
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
    const separate = scan.photos.map((photo, k): ReadScan => ({ id: k === 0 ? scan.id : nextId++, photos: [photo], status: 'queued' }));
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

  /** Forgets a receipt (saved, or thrown away), freeing its photos. */
  function remove(scanId: number) {
    const scan = scansRef.current.find((s) => s.id === scanId);
    void leaveBatch(scanId);
    for (const p of scan?.photos ?? []) {
      URL.revokeObjectURL(p.url);
      cache.current.delete(p.id);
    }
    queue.current = queue.current.filter((j) => j.scanId !== scanId);
    setScans((all) => all.filter((s) => s.id !== scanId));
  }

  return { engine, engineError, scans, warmUp, add, addPhotosTo, removePhoto, split, reread, remove };
}

export type ReceiptReader = ReturnType<typeof useReceiptReader>;
