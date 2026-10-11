import { findDateInText } from './dates';
import { vatBreakdownRow, type Line } from './essentials';
import { extractAmounts, type Amount } from './money';
import { DISCOUNT_LINE, DISCOUNT_TOTAL, END_OF_ITEMS, ITEM_SKIP, NOT_ITEM, ROUNDING, TAX_ID, VAT_TABLE_HEADER } from './rules/keywords';
import { letterRatio } from './text';
import type { ParsedItem } from './types';

// Item names are taken from the normalised text (upper-case, accent-free), which is how
// thermal receipts print them anyway and what product matching compares against.

/** A number followed by a unit belongs to the product name ("COCA 1.25L"), it is not a price. */
const UNIT_AFTER = /^\s?(?:KGS?|GRS?|G|LTRS?|LT|L|ML|CL|CM|MM|M)\b/;
/** VAT code printed after the price: "45.00 V", "45.00(Z)", "45.00 *". */
const VAT_AFTER = /^\s*\(?([A-Z*])\)?\s*$/;
/** VAT code printed between name and price: only the common letters, so "VITAMIN C" keeps its C. */
const VAT_BEFORE = /\s\(?([VZE])\)?$/;
const AMOUNT = String.raw`(\d{1,3}(?:[,.]\d{3})*[.,]\d{2})`;
const CURRENCY = String.raw`(?:(?:RS|MUR)\.?\s?)?`;
/** Weighed goods: "0.856 KG @ 120.00/KG". The unit price may be missing. */
const WEIGHED = new RegExp(String.raw`(\d+[.,]\d{1,3})\s*KGS?\b\s*(?:[X*@]\s*)?${CURRENCY}${AMOUNT}?\s*(?:\/\s*KGS?)?\s*$`);
const PER_KG = /^\s*\/\s*KGS?\b/;
/** Multi-buy: "2 X 45.00" before the line total, or "2 X" with the unit price as the last amount. */
const MULTI = new RegExp(String.raw`(?:^|\s)(\d{1,3})\s*[X*@]\s*${CURRENCY}${AMOUNT}?\s*$`);
/**
 * Quantity before the name: "1x VARTA", or restaurant style "2 JUS ORANGE 240.00".
 * Without the x the word must be 3+ letters, so "3 IN 1 COFFEE" stays a name.
 */
const LEADING_QTY = /^(?:([1-9]\d?)(?:\s*X\s+|\s+(?=[A-Z]{3}))|[IL]\s*X\s+)/;
/** VAT class letter before the quantity: "A 1x VARTA MAXI TECH" ("Ix" is a misread 1x). */
const LEADING_VAT_CODE = /^([A-Z])\s+(?=(?:\d{1,3}|[IL])\s*X\s)/;
/** A misread "Rs" left at the end of a name, before the unit price was taken off: "LENTILLE BL RS38.50 R". */
const TRAILING_R = /\s+RS?\.?$/;
/** Barcodes / article codes printed before the name. */
const LEADING_CODE = /^\d{5,}\s*/;
const EDGE_JUNK = /^[\s*#=_~.:\-]+|[\s*#=_~.:\-]+$/g;
const TRAILING_CURRENCY = /\s(?:RS|MUR)\.?$/;

/** Amounts on the line that can be prices (not pack sizes like "1.25L"). */
function priceAmounts(text: string): Amount[] {
  return extractAmounts(text).filter((a) => !UNIT_AFTER.test(text.slice(a.end)));
}

function cents(s: string | undefined): number | null {
  if (!s) return null;
  return extractAmounts(s)[0]?.value ?? null;
}

function cleanName(s: string): string {
  return s.replace(LEADING_CODE, '').replace(TRAILING_CURRENCY, '').replace(EDGE_JUNK, '').replace(/\s+/g, ' ').trim();
}

function isNameLike(s: string): boolean {
  return (s.match(/[A-Z]/g)?.length ?? 0) >= 2 && letterRatio(s) >= 0.4;
}

/** What one priced line says, before it is attached to a name. */
interface PricedLine {
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  vatCode?: string;
  /** The line only carried a quantity × unit price, no product name. */
  qtyOnly: boolean;
  /** False for "2 X 45.00" alone: the line total was computed, so it is printed on a neighbouring line. */
  totalPrinted: boolean;
  /** The line started with a VAT letter before the quantity ("A 1x …"). */
  codeFirst: boolean;
}

function readPricedLine(text: string, amounts: Amount[]): PricedLine {
  const last = amounts[amounts.length - 1];
  let vatCode = text.slice(last.end).match(VAT_AFTER)?.[1];
  let head = text.slice(0, last.index).trim();
  let lineTotal = last.value;
  let qty = 1;
  let unitPrice = lineTotal;
  let qtyOnly = false;
  let totalPrinted = true;
  let codeFirst = false;

  // "0.856 KG @ 120.00/KG" with the line total printed elsewhere: the last amount is the unit price.
  const perKg = PER_KG.test(text.slice(last.end));
  const weighed = head.match(WEIGHED);
  const multi = weighed ? null : head.match(MULTI);
  if (weighed && weighed.index !== undefined) {
    const decimals = weighed[1].split(/[.,]/)[1].length;
    const unit = cents(weighed[2]);
    // "1.00KG" with no unit price is a pack size, not something weighed at the till.
    if (unit !== null || decimals === 3 || perKg) {
      qty = Number(weighed[1].replace(',', '.'));
      if (perKg) {
        unitPrice = lineTotal;
        lineTotal = Math.round(qty * unitPrice);
        totalPrinted = false;
      } else {
        unitPrice = unit ?? Math.round(lineTotal / qty);
      }
      head = head.slice(0, weighed.index);
      qtyOnly = !isNameLike(head);
    }
  } else if (multi && multi.index !== undefined) {
    const unit = cents(multi[2]);
    qty = Number(multi[1]);
    if (unit === null) {
      // "2 X 45.00": the last amount is the unit price and the line total isn't printed.
      unitPrice = lineTotal;
      lineTotal = qty * unitPrice;
      totalPrinted = false;
    } else {
      unitPrice = unit;
    }
    head = head.slice(0, multi.index);
    qtyOnly = !isNameLike(head);
  }

  const before = head.match(VAT_BEFORE);
  if (before && before.index !== undefined) {
    vatCode ??= before[1];
    head = head.slice(0, before.index);
  }

  if (!weighed && !multi) {
    // "A 1x VARTA …": the VAT class letter printed before the quantity.
    const code = head.match(LEADING_VAT_CODE);
    if (code) {
      vatCode ??= code[1];
      head = head.slice(code[0].length);
      codeFirst = true;
    }
    const leading = head.match(LEADING_QTY);
    if (leading) {
      qty = leading[1] ? Number(leading[1]) : 1;
      unitPrice = Math.round(lineTotal / qty);
      head = head.slice(leading[0].length);
    }
    // "… Rs229.00 Rs229.00": the unit price printed before the line total.
    head = head.replace(TRAILING_R, '');
    const up = priceAmounts(head).at(-1);
    if (up && up.value > 0 && !head.slice(up.end).trim()) {
      // "41x … 52.00 52.00" for "A 1x": when the quantity disagrees with the prices, the prices win.
      const n = lineTotal / up.value;
      const misread = leading && Math.abs(qty * up.value - lineTotal) > 1 && Number.isInteger(n) && n >= 1 && n <= 99;
      if (misread) qty = n;
      if (Math.abs(qty * up.value - lineTotal) <= 1) {
        unitPrice = up.value;
        head = head.slice(0, up.index);
      }
    }
  }
  return { name: cleanName(head), qty, unitPrice, lineTotal, vatCode, qtyOnly, totalPrinted, codeFirst };
}

function discountKind(text: string, item: PricedLine): ParsedItem {
  // Rounding keeps its printed sign; everything else in this branch reduces the bill.
  const lineTotal = ROUNDING.test(text) ? item.lineTotal : -Math.abs(item.lineTotal);
  return { name: item.name || 'Discount', qty: 1, unitPrice: lineTotal, lineTotal, vatCode: item.vatCode, kind: 'discount' };
}

/**
 * Reads line items between the header and the first total-like line.
 * Best effort: the caller keeps them only if they add up to the receipt total.
 */
export function parseItems(lines: Line[], totalIndex: number | null): ParsedItem[] {
  let end = lines.findIndex((l) => END_OF_ITEMS.test(l.norm) || (VAT_TABLE_HEADER.test(l.norm) && !extractAmounts(l.norm).length));
  if (end < 0) end = lines.length;
  if (totalIndex !== null) end = Math.min(end, totalIndex);

  const items: ParsedItem[] = [];
  let pendingName: string | null = null;
  /** A "2 X 45.00" line waiting to see whether the item below carries its total. */
  let pendingQty: PricedLine | null = null;
  /** Lines that started with a VAT letter before the quantity ("A 1x …"): evidence of a VAT-code column. */
  let codeColumn = 0;

  const push = (name: string, p: Pick<PricedLine, 'qty' | 'unitPrice' | 'lineTotal' | 'vatCode'>) =>
    items.push({ name, qty: p.qty, unitPrice: p.unitPrice, lineTotal: p.lineTotal, vatCode: p.vatCode, kind: 'item' });
  // Nothing below claimed the quantity line: it was an item of its own, named by the line above it.
  const flushQty = () => {
    if (pendingQty && isNameLike(pendingQty.name)) push(pendingQty.name, pendingQty);
    pendingQty = null;
  };

  for (const line of lines.slice(0, end)) {
    const text = line.norm;
    if (NOT_ITEM.test(text) || ITEM_SKIP.test(text) || TAX_ID.test(text) || DISCOUNT_TOTAL.test(text) || findDateInText(text)) {
      pendingName = null;
      continue;
    }
    const amounts = priceAmounts(text);
    // "A 15% 199.13 29.87 229.00": a row of the VAT breakdown, never a product.
    if (vatBreakdownRow(text) !== null) {
      pendingName = null;
      continue;
    }

    if (!amounts.length) {
      const name = cleanName(text);
      // Only the line directly above a nameless price can lend it a name, so header lines rarely leak in.
      pendingName = isNameLike(name) ? name : null;
      continue;
    }

    const priced = readPricedLine(text, amounts);
    if (priced.codeFirst) codeColumn++;
    const negative = amounts[amounts.length - 1].value < 0;
    if (negative || (DISCOUNT_LINE.test(text) && (text.search(DISCOUNT_LINE) === 0 || ROUNDING.test(text)))) {
      flushQty();
      items.push(discountKind(text, priced));
      pendingName = null;
      continue;
    }

    if (priced.qtyOnly && (!priced.totalPrinted || !pendingName)) {
      const prev = items.at(-1);
      if (prev?.kind === 'item' && prev.qty === 1 && sameTotal(prev.lineTotal, priced.lineTotal)) {
        // "YAOURT 90.00" then "3 X 30.00": the quantity explains the item above.
        prev.qty = priced.qty;
        prev.unitPrice = priced.unitPrice;
      } else if (!priced.totalPrinted) {
        // "2 X 45.00" then "SAVON 90.00": wait for the next priced line.
        flushQty();
        pendingQty = { ...priced, name: pendingName ?? '' };
      }
      pendingName = null;
      continue;
    }

    if (pendingQty && priced.qty === 1 && isNameLike(priced.name) && sameTotal(pendingQty.lineTotal, priced.lineTotal)) {
      push(priced.name, { ...priced, qty: pendingQty.qty, unitPrice: pendingQty.unitPrice });
      pendingQty = null;
      pendingName = null;
      continue;
    }
    flushQty();

    const name = isNameLike(priced.name) ? priced.name : pendingName;
    pendingName = null;
    if (name) push(name, priced); // a bare amount with no product name is never turned into an item
  }
  flushQty();
  return codeColumn >= 2 ? stripVatColumn(items) : items;
}

/**
 * The till prints each item's VAT class as a first column ("A 1x …", "B C/CHOICE LAMB"):
 * a single letter at the start of a name is that code, not part of the name. ("8" is a misread B.)
 */
function stripVatColumn(items: ParsedItem[]): ParsedItem[] {
  for (const item of items) {
    const m = item.kind === 'item' ? item.name.match(/^([A-Z8])\s+(.+)$/) : null;
    if (!m) continue;
    item.vatCode ??= m[1] === '8' ? 'B' : m[1];
    item.name = m[2];
    // "IX FLAMBOYANT": the quantity came after the code.
    const qty = item.qty === 1 ? item.name.match(LEADING_QTY) : null;
    if (qty) {
      item.qty = qty[1] ? Number(qty[1]) : 1;
      item.unitPrice = Math.round(item.lineTotal / item.qty);
      item.name = item.name.slice(qty[0].length);
    }
  }
  return items;
}

function sameTotal(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1;
}

/** Items count only when they reproduce the total, within Rs 1. */
export const ITEMS_TOLERANCE = 100;

export function itemsAddUp(items: ParsedItem[], total: number | null): boolean {
  if (total === null || !items.some((i) => i.kind === 'item')) return false;
  return Math.abs(sumItems(items) - total) <= ITEMS_TOLERANCE;
}

export function sumItems(items: ParsedItem[]): number {
  return items.reduce((sum, i) => sum + i.lineTotal, 0);
}
