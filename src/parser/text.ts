/** Upper-case, strip accents, collapse whitespace — the form every rule matches against. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/×/g, 'x') // "2× APTA": OCR often reads the x of a quantity as a multiplication sign
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Repairs common OCR digit confusions inside number-like tokens only
 * ("45.0O" → "45.00", "1l2,50" → "112,50", "13,44B.74" → "13,448.74"), leaving words untouched.
 * A token must start with a real digit, so the S of "RS229.00" stays a letter, and a B is only
 * an 8 when more digits follow (a trailing B is a VAT code: "45.00B").
 */
export function fixDigits(s: string): string {
  return s.replace(/\d[0-9OoIlSB|]*(?:[.,][0-9OoIlSB|]+)+/g, (tok) => {
    const trailingB = tok.endsWith('B') ? 'B' : '';
    return (
      tok
        .slice(0, tok.length - trailingB.length)
        .replace(/[Oo]/g, '0')
        .replace(/[Il|]/g, '1')
        .replace(/S/g, '5')
        .replace(/B/g, '8') + trailingB
    );
  });
}

/**
 * Repairs the "Rs" in front of a price in normalised text, which OCR often misreads:
 * "R8319.30" / "RB259.95" / "RR144.95" → "RS…", and a misplaced point: "RS109 95", "RS44 . 00" → "RS109.95".
 * Without this, "R8319.30" reads as Rs 8,319.30.
 */
export function fixCurrency(norm: string): string {
  return norm
    .replace(/\bR[856BR](?=\d{1,3}(?:[,.]\d{3})*[.,]\d{2}(?!\d))/g, 'RS')
    .replace(/\bRS\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\s*[.,:]\s+|\s+[.,:]?\s*)(\d{2})(?![\d.,])/g, 'RS$1.$2');
}

/** Share of characters that are letters. */
export function letterRatio(s: string): number {
  const compact = s.replace(/\s/g, '');
  if (!compact) return 0;
  const letters = compact.match(/\p{L}/gu)?.length ?? 0;
  return letters / compact.length;
}

/** "SUPER U FLACQ" → "Super U Flacq"; leaves mixed-case input alone. */
export function toDisplayCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .replace(/(^|[\s\-(/&.])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** Two product names at least this similar are the same product (OCR spells the same item slightly differently). */
export const SAME_PRODUCT = 0.88;

/** Sørensen–Dice similarity on character bigrams (0..1). */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const n = grams.get(g) ?? 0;
    if (n > 0) {
      grams.set(g, n - 1);
      hits++;
    }
  }
  return (2 * hits) / (a.length + b.length - 2);
}
