import { findDateInText } from './dates';
import { labelOf } from './essentials';
import { lastAmount } from './money';
import { prepareLines } from './parse';
import { NOT_TOTAL, TENDERED } from './rules/keywords';
import type { DateOrder, OcrLine, StoreHints } from './types';

export interface ConfirmedReceipt {
  /** cents, as saved by the user */
  total: number;
  /** ISO date, as saved by the user */
  date: string | null;
}

/**
 * Learns from a receipt the user confirmed (corrections included), so the next receipt
 * from the same shop parses better. Runs at save time, before the OCR text is discarded.
 */
export function learnHints(ocr: OcrLine[], confirmed: ConfirmedReceipt, previous: StoreHints = {}): StoreHints {
  const lines = prepareLines(ocr);
  const hints: StoreHints = { ...previous };

  // Total label: the lowest labelled line carrying the confirmed total (payment lines excluded).
  for (const line of [...lines].reverse()) {
    if (NOT_TOTAL.test(line.norm) || TENDERED.test(line.norm)) continue;
    if (lastAmount(line.norm)?.value !== confirmed.total) continue;
    const label = labelOf(line.norm);
    if (label.replace(/ /g, '').length >= 3) {
      hints.totalLabel = label;
      break;
    }
  }

  // Date order: only learnable when day-first and month-first read the printed date differently.
  if (confirmed.date) {
    for (const line of lines) {
      const readings = (['DMY', 'MDY'] as DateOrder[]).filter((order) => findDateInText(line.norm, order)?.iso === confirmed.date);
      if (readings.length === 1) {
        hints.dateOrder = readings[0];
        break;
      }
      if (readings.length === 2) break; // unambiguous date such as 25/10: nothing to learn
    }
  }
  return hints;
}
