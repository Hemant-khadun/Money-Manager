import { matchStore } from '../parser/store-match';
import type { OcrLine, ParsedReceipt, PaymentMethod } from '../parser/types';
import type { ReadReport } from '../pipeline/ocr-protocol';
import { stitchPhotos } from '../pipeline/stitch';

/**
 * One Phase 0 eval receipt: fixtures/receipts/<name>.json. Holds the OCR output (so the parser
 * can be re-scored without re-running OCR) and the hand-checked correct answers.
 * The photo itself stays out of git: it shows addresses and card digits, and the repo is public.
 */
export interface ReceiptFixture {
  version: 1;
  name: string;
  /** ISO date the photo was read; parsing uses it as "today" for the date plausibility check. */
  capturedAt: string;
  ocr: {
    strategy: string;
    backend: string;
    ms: number;
    report?: ReadReport;
    /** The receipt's lines (for a long receipt, all its photos joined). */
    lines: OcrLine[];
    /** A long receipt photographed in several parts: each photo's own reading, top to bottom. */
    photos?: Array<{ name: string; lines: OcrLine[]; report?: ReadReport }>;
  };
  expected: ExpectedReceipt;
}

/** The lines to score: re-joined from the photos when there are several, so changes to joining are measured too. */
export function fixtureLines(fixture: ReceiptFixture): OcrLine[] {
  const photos = fixture.ocr.photos;
  return photos && photos.length > 1 ? stitchPhotos(photos.map((p) => p.lines)).lines : fixture.ocr.lines;
}

export const SHOP_KINDS = ['supermarket', 'pharmacy', 'fuel', 'restaurant', 'hardware', 'clothing', 'card-slip', 'other'] as const;
export type ShopKind = (typeof SHOP_KINDS)[number];

export interface ExpectedReceipt {
  /** False until a person has checked every field against the paper receipt. */
  checked: boolean;
  kind: ShopKind;
  store: string;
  /** YYYY-MM-DD */
  date: string;
  /** cents */
  total: number;
  payment: PaymentMethod | null;
  /** The receipt prints line items (whether or not the parser reads them). */
  itemized: boolean;
}

/** Pre-fills the answers from the parser, for a person to correct. */
export function draftExpected(parsed: ParsedReceipt): ExpectedReceipt {
  return {
    checked: false,
    kind: 'other',
    store: parsed.storeName ?? '',
    date: parsed.date ?? '',
    total: parsed.total ?? 0,
    payment: parsed.paymentMethod,
    itemized: parsed.items.some((i) => i.kind === 'item'),
  };
}

export interface ReceiptScore {
  store: boolean;
  date: boolean;
  total: boolean;
  payment: boolean;
  /** store, date and total all correct: the Phase 0 go/no-go measure */
  essentials: boolean;
  /** null when the receipt has no items to read */
  itemsAddUp: boolean | null;
}

export function scoreReceipt(parsed: ParsedReceipt, expected: ExpectedReceipt): ReceiptScore {
  const store = !!expected.store && matchStore({ name: parsed.storeName, taxId: null }, [{ name: expected.store, aliases: [] }]) !== null;
  const date = parsed.date === expected.date;
  const total = parsed.total === expected.total;
  return {
    store,
    date,
    total,
    payment: parsed.paymentMethod === expected.payment,
    essentials: store && date && total,
    itemsAddUp: expected.itemized ? parsed.itemsAddUp : null,
  };
}

/** Phase 0 go/no-go thresholds from the plan. */
export const GATE = { essentials: 0.9, itemsAddUp: 0.6 };
