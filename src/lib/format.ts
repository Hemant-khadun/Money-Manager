const rupees = new Intl.NumberFormat('en-MU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 123450 → "Rs 1,234.50" */
export function formatMoney(cents: number, currency = 'MUR'): string {
  const prefix = currency === 'MUR' ? 'Rs' : currency;
  const sign = cents < 0 ? '−' : '';
  return `${sign}${prefix} ${rupees.format(Math.abs(cents) / 100)}`;
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** 1344874 → "Rs 13.4K": for chart labels where space is short. */
export function formatCompactMoney(cents: number): string {
  const rupees = cents / 100;
  return `Rs ${Math.abs(rupees) < 1000 ? Math.round(rupees) : compact.format(rupees)}`;
}

const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "2026-10-07" → "7 Oct" */
export function formatDayMonth(iso: string): string {
  return dayMonth.format(Date.parse(`${iso}T00:00:00Z`));
}

const dayMonthYear =new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "2025-10-07" → "7 Oct 2025": the month as a word, so day and month can't be mixed up. */
export function formatDate(iso: string): string {
  return dayMonthYear.format(Date.parse(`${iso}T00:00:00Z`));
}

/** "7 Oct" this year, "7 Oct 2025" before: short, but never unclear about the year. */
export function formatShortDate(iso: string, thisYear = new Date().getFullYear()): string {
  return iso.startsWith(`${thisYear}-`) ? formatDayMonth(iso) : formatDate(iso);
}

/** 0.16 → "16%"; under 1%, to one decimal: 0.004 → "0.4%". */
export function formatPercent(share: number): string {
  const pct = Math.abs(share) * 100;
  return `${pct >= 0.95 ? Math.round(pct) : Math.max(pct, 0.1).toFixed(1)}%`;
}

/** 123450 → "1234.50", for editable inputs. */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

const wholeRupees = new Intl.NumberFormat('en-MU', { maximumFractionDigits: 0 });

/** 1234567 → "Rs 12,346": to the nearest rupee, for tiles where space is short. */
export function formatWholeMoney(cents: number): string {
  const sign = cents < 0 ? '−' : '';
  return `${sign}Rs ${wholeRupees.format(Math.abs(Math.round(cents / 100)))}`;
}
