import { todayIso } from './dates';
import {
  findCurrency,
  findDate,
  findDiscountTotal,
  findPaymentMethod,
  findStoreName,
  findTaxId,
  findTotal,
  findVatTotal,
  type Line,
} from './essentials';
import { ITEMS_TOLERANCE, itemsAddUp, parseItems, sumItems } from './items';
import { fixCurrency, fixDigits, normalizeText } from './text';
import type { OcrLine, ParsedItem, ParsedReceipt, ParseWarning, StoreHints } from './types';

export interface ParseOptions {
  /** Learned hints for the store, when it is already known (e.g. matched by tax ID on a first pass). */
  hints?: StoreHints;
  /** ISO date used for the plausibility check; defaults to today. */
  today?: string;
}

/** Below this average OCR confidence the review screen asks the user to double-check. */
const LOW_OCR_CONFIDENCE = 0.75;

/** Top-to-bottom, digit fixes applied, normalised, empty lines dropped. */
export function prepareLines(ocr: OcrLine[]): Line[] {
  return [...ocr]
    .sort((a, b) => a.y - b.y)
    .map((l) => ({ raw: l.text.trim(), norm: fixCurrency(normalizeText(fixDigits(l.text))), height: l.height, confidence: l.confidence }))
    .filter((l) => l.norm.length > 0)
    .map((l, index) => ({ ...l, index }));
}

/**
 * When the items fall short of the total by exactly the printed "you saved" amount,
 * the discounts were only printed as a summary: add them as one discount line.
 */
function reconcileDiscounts(items: ParsedItem[], total: number | null, discountTotal: number | null): ParsedItem[] {
  if (total === null || !discountTotal || items.some((i) => i.kind === 'discount')) return items;
  const withDiscount = [...items, { name: 'Discounts', qty: 1, unitPrice: -discountTotal, lineTotal: -discountTotal, kind: 'discount' as const }];
  return Math.abs(sumItems(withDiscount) - total) <= ITEMS_TOLERANCE ? withDiscount : items;
}

export function parseReceipt(ocr: OcrLine[], options: ParseOptions = {}): ParsedReceipt {
  const lines = prepareLines(ocr);
  const today = options.today ?? todayIso();

  const store = findStoreName(lines);
  const date = findDate(lines, options.hints, today);
  const total = findTotal(lines, options.hints);
  const vatTotal = findVatTotal(lines, total.total);
  const discountTotal = findDiscountTotal(lines);

  let items = parseItems(lines, total.lineIndex);
  if (!itemsAddUp(items, total.total)) items = reconcileDiscounts(items, total.total, discountTotal);
  const addsUp = itemsAddUp(items, total.total);

  const warnings: ParseWarning[] = [];
  if (!store.name) warnings.push('no-store');
  if (total.total === null) warnings.push('no-total');
  if (!date.date) warnings.push('no-date');
  else if (!date.plausible) warnings.push('date-implausible');
  if (items.length && !addsUp) warnings.push('items-mismatch');
  const avgConfidence = lines.length ? lines.reduce((s, l) => s + l.confidence, 0) / lines.length : 0;
  if (total.confidence === 'low' || avgConfidence < LOW_OCR_CONFIDENCE) warnings.push('low-confidence');

  return {
    storeName: store.name,
    taxId: findTaxId(lines),
    date: date.date,
    dateOrder: date.order,
    total: total.total,
    totalConfidence: total.confidence,
    totalLabel: total.label,
    currency: findCurrency(lines),
    paymentMethod: findPaymentMethod(lines, total.lineIndex),
    vatTotal,
    discountTotal,
    items,
    itemsSum: sumItems(items),
    itemsAddUp: addsUp,
    warnings,
  };
}
