import type { DateOrder } from './types';

const MONTHS: Record<string, number> = {
  JAN: 1, JANV: 1, JANVIER: 1, JANUARY: 1,
  FEB: 2, FEV: 2, FEVR: 2, FEVRIER: 2, FEBRUARY: 2,
  MAR: 3, MARS: 3, MARCH: 3,
  APR: 4, AVR: 4, AVRIL: 4, APRIL: 4,
  MAY: 5, MAI: 5,
  JUN: 6, JUIN: 6, JUNE: 6,
  JUL: 7, JUIL: 7, JUILLET: 7, JULY: 7,
  AUG: 8, AOU: 8, AOUT: 8, AUGUST: 8,
  SEP: 9, SEPT: 9, SEPTEMBRE: 9, SEPTEMBER: 9,
  OCT: 10, OCTOBRE: 10, OCTOBER: 10,
  NOV: 11, NOVEMBRE: 11, NOVEMBER: 11,
  DEC: 12, DECEMBRE: 12, DECEMBER: 12,
};

export interface FoundDate {
  iso: string;
  order: DateOrder;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function fullYear(y: number) {
  return y < 100 ? 2000 + y : y;
}

/** Builds an ISO date if (y, m, d) is a real calendar date in 2000–2099. */
export function toIso(y: number, m: number, d: number): string | null {
  const year = fullYear(y);
  if (year < 2000 || year > 2099 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(year, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${year}-${pad(m)}-${pad(d)}`;
}

/** Finds the first date in a normalised (upper-case, accent-free) line. */
export function findDateInText(text: string, preferred: DateOrder = 'DMY'): FoundDate | null {
  // 2026-10-08
  let m = text.match(/(?<!\d)(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/);
  if (m) {
    const iso = toIso(+m[1], +m[2], +m[3]);
    if (iso) return { iso, order: 'YMD' };
  }

  // 08/10/2026 · 08-10-26 · 08.10.2026  (day-first unless impossible or the store says otherwise)
  m = text.match(/(?<![\d.,])(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?![\d.,])/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const y = +m[3];
    let order: DateOrder = preferred === 'MDY' ? 'MDY' : 'DMY';
    if (a > 12 && b <= 12) order = 'DMY';
    else if (b > 12 && a <= 12) order = 'MDY';
    const iso = order === 'DMY' ? toIso(y, b, a) : toIso(y, a, b);
    if (iso) return { iso, order };
  }

  // 08 OCT 2026 · 8-OCT-26 · 08 OCTOBRE 2026
  m = text.match(/(?<!\d)(\d{1,2})\s*[- ]?\s*([A-Z]{3,9})\.?\s*[- ,]?\s*(\d{4}|\d{2})(?!\d)/);
  if (m && MONTHS[m[2]]) {
    const iso = toIso(+m[3], MONTHS[m[2]], +m[1]);
    if (iso) return { iso, order: 'DMY' };
  }

  // OCT 08, 2026
  m = text.match(/\b([A-Z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?!\d)/);
  if (m && MONTHS[m[1]]) {
    const iso = toIso(+m[3], MONTHS[m[1]], +m[2]);
    if (iso) return { iso, order: 'MDY' };
  }
  return null;
}

/** Days between two ISO dates (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Today's date in the user's local time zone, ISO. */
export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A receipt date is plausible if it is not in the future and not older than ~3 years. */
export function isPlausibleDate(iso: string, today: string): boolean {
  const diff = daysBetween(iso, today);
  return diff >= -1 && diff <= 3 * 366;
}
