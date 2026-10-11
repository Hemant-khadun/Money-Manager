import { findDateInText, isPlausibleDate } from './dates';
import { extractAmounts, lastAmount } from './money';
import {
  CHANGE,
  DISCOUNT_TOTAL,
  META,
  NOT_TOTAL,
  PAYMENT_CARD,
  PAYMENT_CASH,
  PAYMENT_MOBILE,
  TAX_ID,
  TAX_INCLUSIVE,
  TENDERED,
  TOTAL_LABELS,
  VAT_LINE,
  VAT_TOTAL_PREFERRED,
} from './rules/keywords';
import { letterRatio, toDisplayCase } from './text';
import type { Confidence, DateOrder, PaymentMethod, StoreHints } from './types';

/** A line prepared for parsing: original text plus its normalised form. */
export interface Line {
  raw: string;
  norm: string;
  height: number;
  confidence: number;
  index: number;
}

export interface StoreGuess {
  name: string | null;
  lineIndex: number | null;
}

/** Biggest, earliest, mostly-letters line near the top that is not an address/phone/etc. */
export function findStoreName(lines: Line[]): StoreGuess {
  const top = lines.slice(0, Math.min(8, lines.length));
  if (!top.length) return { name: null, lineIndex: null };
  const heights = lines.map((l) => l.height).filter((h) => h > 0).sort((a, b) => a - b);
  const median = heights.length ? heights[Math.floor(heights.length / 2)] : 1;

  let best: { line: Line; score: number } | null = null;
  for (const line of top) {
    const text = line.norm;
    if (text.length < 2 || text.length > 42) continue;
    if (letterRatio(text) < 0.6) continue;
    if (META.test(text) || TAX_ID.test(text) || lastAmount(text)) continue;
    if (findDateInText(text)) continue;
    const sizeScore = median > 0 ? line.height / median : 1;
    const positionScore = 1 - line.index / 10;
    const score = sizeScore * 2 + positionScore + line.confidence * 0.5;
    if (!best || score > best.score) best = { line, score };
  }
  if (!best) return { name: null, lineIndex: null };
  const name = toDisplayCase(best.line.raw.replace(/[*=_~#]+/g, ' ').replace(/\s+/g, ' ').trim());
  return { name, lineIndex: best.line.index };
}

export function findTaxId(lines: Line[]): string | null {
  for (const line of lines) {
    const m = line.norm.match(TAX_ID);
    if (m) return m[1];
  }
  return null;
}

export interface DateGuess {
  date: string | null;
  order: DateOrder | null;
  plausible: boolean;
  lineIndex: number | null;
}

export function findDate(lines: Line[], hints: StoreHints | undefined, today: string): DateGuess {
  const preferred = hints?.dateOrder ?? 'DMY';
  let fallback: DateGuess | null = null;
  // Prefer lines that say DATE; otherwise the first plausible date on the receipt.
  const ordered = [...lines].sort((a, b) => Number(/\bDATE\b/.test(b.norm)) - Number(/\bDATE\b/.test(a.norm)) || a.index - b.index);
  for (const line of ordered) {
    const found = findDateInText(line.norm, preferred);
    if (!found) continue;
    const guess = { date: found.iso, order: found.order, plausible: isPlausibleDate(found.iso, today), lineIndex: line.index };
    if (guess.plausible) return guess;
    fallback ??= guess;
  }
  return fallback ?? { date: null, order: null, plausible: false, lineIndex: null };
}

export interface TotalGuess {
  total: number | null;
  confidence: Confidence;
  label: string | null;
  lineIndex: number | null;
}

/** Amount on this line, or on the next line when the label and amount are split. */
function amountNear(lines: Line[], i: number) {
  const here = lastAmount(lines[i].norm);
  if (here) return here;
  const next = lines[i + 1];
  if (next && letterRatio(next.norm) < 0.3) return lastAmount(next.norm);
  return null;
}

/** The words of a line with its amounts removed: "TOTAL MUR 1,240.00" → "TOTAL". */
export function labelOf(norm: string): string {
  return norm
    .replace(/(?:RS|MUR)?\.?\s?-?\d[\d,.\s]*\d?/g, ' ')
    .replace(/[^A-Z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findTotal(lines: Line[], hints: StoreHints | undefined): TotalGuess {
  const candidates: Array<{ value: number; score: number; index: number; label: string }> = [];

  for (const line of lines) {
    const text = line.norm;
    if (NOT_TOTAL.test(text)) continue;
    let score = 0;
    if (hints?.totalLabel && labelOf(text) === hints.totalLabel) score = 110;
    else {
      for (const [re, s] of TOTAL_LABELS) {
        if (re.test(text)) {
          score = s;
          break;
        }
      }
    }
    if (!score) continue;
    const amt = amountNear(lines, line.index);
    if (!amt || amt.value <= 0) continue;
    candidates.push({ value: amt.value, score, index: line.index, label: labelOf(text) });
  }

  if (candidates.length) {
    // What the customer actually paid beats any label ("NET TOTAL" is the amount before tax on some receipts).
    const paid = paidAmounts(lines);
    const confirmed = candidates.filter((c) => paid.has(c.value));
    // Ties go to the later line — the amount paid sits at the bottom.
    const best = (confirmed.length ? confirmed : candidates).reduce((a, c) => (c.score >= a.score ? c : a));
    if (confirmed.length) return { total: best.value, confidence: 'high', label: best.label, lineIndex: best.index };

    const withTax = taxInclusiveAmount(lines, best.value);
    if (withTax) {
      const label = labelOf(lines[withTax.index].norm);
      return { total: withTax.value, confidence: 'medium', label: label.length >= 3 ? label : null, lineIndex: withTax.index };
    }
    return { total: best.value, confidence: 'medium', label: best.label, lineIndex: best.index };
  }

  // No label: largest amount in the lower two-thirds, ignoring tendered/change lines.
  let max: { value: number; index: number } | null = null;
  for (const line of lines.slice(Math.floor(lines.length / 3))) {
    if (TENDERED.test(line.norm) || CHANGE.test(line.norm) || VAT_LINE.test(line.norm)) continue;
    const amt = lastAmount(line.norm);
    if (amt && amt.value > 0 && (!max || amt.value > max.value)) max = { value: amt.value, index: line.index };
  }
  return max
    ? { total: max.value, confidence: 'low', label: null, lineIndex: max.index }
    : { total: null, confidence: 'low', label: null, lineIndex: null };
}

/** Amounts the customer handed over: each tendered amount, and tendered − change. */
function paidAmounts(lines: Line[]): Set<number> {
  const tendered: number[] = [];
  let change = 0;
  for (const line of lines) {
    const amt = lastAmount(line.norm);
    if (!amt) continue;
    if (CHANGE.test(line.norm)) change = Math.abs(amt.value);
    else if (TENDERED.test(line.norm) && !/\bTOTAL\b/.test(line.norm)) tendered.push(amt.value);
  }
  return new Set(tendered.flatMap((t) => [t, t - change]));
}

/**
 * Never report the amount before tax: when the chosen total plus the printed VAT
 * appears elsewhere on the receipt ("NET TOTAL 199.13", VAT 29.87, "229.00"), that is what was paid.
 */
function taxInclusiveAmount(lines: Line[], total: number): { value: number; index: number } | null {
  const vat = findVatTotal(lines, null);
  if (!vat) return null;
  for (const line of lines) {
    if (VAT_LINE.test(line.norm) && !TAX_INCLUSIVE.test(line.norm)) continue;
    const hit = extractAmounts(line.norm).find((a) => Math.abs(a.value - (total + vat)) <= 1);
    if (hit) return { value: hit.value, index: line.index };
  }
  return null;
}

export function findPaymentMethod(lines: Line[], totalIndex: number | null): PaymentMethod | null {
  const after = totalIndex === null ? lines : lines.slice(totalIndex);
  // Elsewhere, only lines without prices: "BEST FOOD POP CORN 38.50" is not a payment by POP.
  const elsewhere = lines.filter((l) => !lastAmount(l.norm));
  for (const pool of [after, elsewhere]) {
    for (const line of pool) {
      if (PAYMENT_MOBILE.test(line.norm)) return 'mobile';
      if (PAYMENT_CARD.test(line.norm) && !/\bLOYALTY|FIDELITE|MEMBER\b/.test(line.norm)) return 'card';
      if (PAYMENT_CASH.test(line.norm)) return 'cash';
    }
  }
  return null;
}

export function findVatTotal(lines: Line[], total: number | null): number | null {
  let preferred: number | null = null;
  let breakdown = 0;
  let any: number | null = null;
  for (const line of lines) {
    // "NET ALL TAX. INCL. 229.00" is the total, not the tax.
    if (TAX_INCLUSIVE.test(line.norm)) continue;
    const row = vatBreakdownRow(line.norm);
    if (row !== null) {
      breakdown += row;
      continue;
    }
    if (!VAT_LINE.test(line.norm)) continue;
    const amt = lastAmount(line.norm);
    if (!amt || amt.value <= 0) continue;
    if (total !== null && amt.value >= total) continue;
    if (VAT_TOTAL_PREFERRED.test(line.norm)) preferred = amt.value;
    else any = amt.value;
  }
  return preferred ?? (breakdown > 0 ? breakdown : any);
}

/**
 * A row of a VAT breakdown, "A 15% 199.13 29.87 229.00": net + VAT = total, so the middle one is
 * the VAT. Found by the arithmetic alone (VAT between 1% and 30% of net), because OCR often
 * misreads the "%" sign.
 */
export function vatBreakdownRow(norm: string): number | null {
  const a = extractAmounts(norm).map((x) => x.value);
  for (let i = 0; i + 2 < a.length; i++) {
    const [net, vat, gross] = [a[i], a[i + 1], a[i + 2]];
    if (vat >= net * 0.01 && vat <= net * 0.3 && Math.abs(net + vat - gross) <= 1) return vat;
  }
  return null;
}

export function findDiscountTotal(lines: Line[]): number | null {
  for (const line of lines) {
    if (!DISCOUNT_TOTAL.test(line.norm)) continue;
    const amt = lastAmount(line.norm);
    if (amt) return Math.abs(amt.value);
  }
  return null;
}

export function findCurrency(lines: Line[]): string {
  const all = lines.map((l) => l.norm).join(' ');
  if (/€|\bEUR\b/.test(all)) return 'EUR';
  if (/\bUSD\b|US\$/.test(all)) return 'USD';
  if (/£|\bGBP\b/.test(all)) return 'GBP';
  if (/\bZAR\b/.test(all)) return 'ZAR';
  return 'MUR';
}
