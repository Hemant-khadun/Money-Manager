export interface Amount {
  /** cents (negative when printed with a minus sign) */
  value: number;
  /** index of the match in the source string */
  index: number;
  /** end index of the match */
  end: number;
}

// An amount has exactly two decimals: 45.00 · 1,234.50 · 1.234,50 · Rs45.00 · -12.00 · 12.00-
// Not preceded/followed by digits or date separators, not a percentage, and not the end of a
// dashed code like a till version "3.0.16-23.27".
const AMOUNT_RE =
  /(?<![\d.,/:])(?<!\d-)(-\s?)?(?:(?:RS|MUR)\.?\s?|[€$£]\s?)?(\d{1,3}(?:[,.]\d{3})+|\d+)([.,])(\d{2})(?![\d])(?![.,/:]\d)(?!\s?%)(\s?-(?!\d))?/gi;

export function extractAmounts(text: string): Amount[] {
  const out: Amount[] = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    const [, leadMinus, intPart, decSep, dec, trailMinus] = m;
    // Thousands separators must differ from the decimal separator ("1,234,50" is not an amount).
    const thousandSeps = intPart.match(/[,.]/g);
    if (thousandSeps && thousandSeps.some((s) => s === decSep)) continue;
    const units = Number(intPart.replace(/[,.]/g, ''));
    let value = units * 100 + Number(dec);
    if (leadMinus || trailMinus) value = -value;
    out.push({ value, index: m.index, end: m.index + m[0].length });
  }
  return out;
}

export function lastAmount(text: string): Amount | null {
  const all = extractAmounts(text);
  return all.length ? all[all.length - 1] : null;
}

/** "12.5" / "12,50" / "12" → cents. Returns null for unparseable input. */
export function parseMoneyInput(s: string): number | null {
  const cleaned = s.replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}(\D|$))/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
