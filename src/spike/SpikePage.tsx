import { useEffect, useState } from 'react';
import { draftExpected, type ExpectedReceipt } from '../eval/fixture';
import { useReceiptReader, type ReadScan } from '../hooks/useReceiptReader';
import type { OcrStrategy } from '../pipeline/ocr-protocol';
import { ScanCard } from './ScanCard';

// Phase 0 engine spike (docs/PLAN.md §8): read real receipts with PP-OCRv5, see what the parser
// makes of them, correct the answers and save each one as an eval fixture.

export type { Photo } from '../hooks/useReceiptReader';

/** A receipt being read, with the hand-checked answers for the eval. */
export interface Scan extends ReadScan {
  /** The correct answers, pre-filled from the parser and corrected by hand. */
  expected?: ExpectedReceipt;
  saved?: boolean;
}

interface Checked {
  /** Set once the person changes an answer; until then the answers follow the latest reading. */
  expected?: ExpectedReceipt;
  saved?: boolean;
}

export function SpikePage() {
  const [strategy, setStrategy] = useState<OcrStrategy>('per-box');
  const [checked, setChecked] = useState<Record<number, Checked>>({});
  const reader = useReceiptReader({
    strategy,
    // Receipts whose answers were checked or saved are left as they are.
    canJoin: (ids) => ids.every((id) => !checked[id]?.expected && !checked[id]?.saved),
  });
  const { engine, engineError, warmUp } = reader;

  useEffect(warmUp, [warmUp]);

  const check = (id: number, patch: Checked) => setChecked((all) => ({ ...all, [id]: { ...all[id], ...patch } }));
  const scans: Scan[] = reader.scans.map((s) => ({
    ...s,
    expected: checked[s.id]?.expected ?? (s.parsed && draftExpected(s.parsed)),
    saved: checked[s.id]?.saved,
  }));
  const saved = scans.filter((s) => s.saved && s.parsed && s.expected);

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 pt-6">
      <header className="mb-6">
        <p className="text-[15px] font-semibold text-primary">Spent</p>
        <h1 className="text-[34px] font-bold tracking-[-0.02em]">Receipt reading test</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          Before building the rest of the app, let's see how well it reads real receipts. Add photos, fix anything it got
          wrong, and save each one.
        </p>
        <p className="mt-3 text-[15px]" role="status">
          {engineError ? (
            <span className="text-bad">The receipt reader couldn't start: {engineError}</span>
          ) : engine ? (
            <>
              <span className="text-good">●</span> Ready{' '}
              <span className="text-muted-foreground">
                ({engine.backend === 'webgpu' ? 'fast mode' : 'standard mode'}, started in {(engine.loadMs / 1000).toFixed(1)} s)
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">Getting ready… the first time takes a moment.</span>
          )}
        </p>
      </header>

      <section className="mb-6 flex flex-wrap items-center gap-3 rounded-lg bg-card p-4">
        <label className="cursor-pointer rounded-full bg-primary px-5 py-2.5 text-[17px] font-semibold text-primary-foreground active:scale-[0.97]">
          Add receipts
          <input
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(e) => {
              reader.add(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        <label className="flex items-center gap-2 text-[15px]">
          Reading style
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as OcrStrategy)}
            className="min-w-0 flex-1 rounded-sm border border-border bg-card px-2 py-1.5"
          >
            <option value="per-box">Standard</option>
            <option value="per-line">Alternative (try if a receipt reads badly)</option>
          </select>
        </label>
        <p className="w-full text-[13px] text-muted-foreground">
          <strong className="font-semibold text-foreground">Long receipt?</strong> Take a few photos from top to bottom, close
          enough to read the small print, with each photo repeating two or three lines from the one before. Add them along
          with your other photos: photos that overlap are recognised as one receipt and joined. You can also add more photos
          to any receipt below.
        </p>
        <p className="w-full text-[13px] text-muted-foreground">
          Each saved receipt downloads as a small file. Put those files in the project's <code>fixtures/receipts</code> folder,
          then run <code>npm run eval</code> to see the score.
          {saved.length > 0 && ` ${saved.length} saved so far.`}
        </p>
      </section>

      <div className="space-y-4">
        {scans.map((scan) => (
          <ScanCard
            key={scan.id}
            scan={scan}
            onExpectedChange={(expected) => check(scan.id, { expected, saved: false })}
            onSaved={() => check(scan.id, { saved: true })}
            onAddPhotos={(files) => {
              check(scan.id, { saved: false });
              reader.addPhotosTo(scan.id, files);
            }}
            onRemovePhoto={(photo) => {
              check(scan.id, { saved: false });
              reader.removePhoto(scan.id, photo.id);
            }}
            onSplit={() => reader.split(scan.id)}
            onReread={() => reader.reread(scan.id)}
            onRemove={() => reader.remove(scan.id)}
          />
        ))}
      </div>
    </main>
  );
}
