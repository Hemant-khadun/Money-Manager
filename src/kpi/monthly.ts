import { topLevelOf } from '../db/categories';
import type { Category, Receipt } from '../db/schema';

// The dashboard's numbers, worked out from saved receipts. Every receipt counts towards totals,
// categories and shops (its `split` shares the total over categories); nothing here needs items.

/** "2026-10" for a date. */
export function monthOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function todayIso(now = new Date()): string {
  return `${monthOf(now)}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Said when a date can't be saved: a receipt is never from the future (Overview couldn't show it). */
export const FUTURE_DATE = 'That date is in the future: check it.';

/** "2026-10" moved by `delta` months. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The `count` months ending with `month`, oldest first. */
export function monthsEnding(month: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftMonth(month, i - count + 1));
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const longMonth = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' });
const shortMonth = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });

/** "October", or "October 2025" when it isn't this year. */
export function monthName(month: string, thisYear = new Date().getFullYear(), style: 'long' | 'short' = 'long'): string {
  const [y, m] = month.split('-').map(Number);
  const name = (style === 'long' ? longMonth : shortMonth).format(new Date(Date.UTC(y, m - 1, 1)));
  return y === thisYear ? name : `${name} ${y}`;
}

export interface CategoryTotal {
  /** Top-level category. */
  categoryId: string;
  amount: number;
  /** Of the month's total, 0..1 */
  share: number;
  /** Same category, the month before. */
  previous: number;
  budget: number | null;
}

export interface ShopTotal {
  key: string;
  name: string;
  amount: number;
  receipts: number;
}

export interface MonthSummary {
  month: string;
  total: number;
  receipts: number;
  /** Average spent per receipt. */
  average: number;
  /** VAT, where receipts print it. */
  vat: number;
  previousTotal: number;
  /** Month-end estimate at the current pace; only for the current month, from its 7th day
   *  (before that, one big shop would be forecast several times over). */
  projected: number | null;
  byCategory: CategoryTotal[];
  byShop: ShopTotal[];
}

/** Spending per top-level category in a set of receipts. */
export function totalsByCategory(receipts: readonly Receipt[], categories: readonly Category[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const r of receipts) {
    for (const part of r.split) {
      const top = topLevelOf(part.categoryId, categories);
      totals.set(top, (totals.get(top) ?? 0) + part.amount);
    }
  }
  return totals;
}

/** The month-end forecast starts on this day of the month. */
const FORECAST_FROM_DAY = 7;

export function summarizeMonth(receipts: readonly Receipt[], categories: readonly Category[], month: string, today: string): MonthSummary {
  const now = receipts.filter((r) => r.month === month);
  const before = receipts.filter((r) => r.month === shiftMonth(month, -1));
  const total = now.reduce((s, r) => s + r.total, 0);
  const previousTotal = before.reduce((s, r) => s + r.total, 0);

  const current = totalsByCategory(now, categories);
  const previous = totalsByCategory(before, categories);
  const byCategory = [...current]
    .filter(([, amount]) => amount !== 0)
    .map(([categoryId, amount]) => ({
      categoryId,
      amount,
      share: total ? amount / total : 0,
      previous: previous.get(categoryId) ?? 0,
      budget: categories.find((c) => c.id === categoryId)?.monthlyBudget ?? null,
    }))
    .sort((a, b) => b.amount - a.amount);

  const shops = new Map<string, ShopTotal>();
  for (const r of now) {
    if (!r.storeName) continue;
    const key = r.storeId !== null ? `id:${r.storeId}` : `name:${r.storeName.toLowerCase()}`;
    const shop = shops.get(key) ?? { key, name: r.storeName, amount: 0, receipts: 0 };
    shop.amount += r.total;
    shop.receipts++;
    shops.set(key, shop);
  }

  const day = Number(today.slice(8, 10));
  const projected = today.slice(0, 7) === month && day >= FORECAST_FROM_DAY ? Math.round((total / day) * daysInMonth(month)) : null;

  return {
    month,
    total,
    receipts: now.length,
    average: now.length ? Math.round(total / now.length) : 0,
    vat: now.reduce((s, r) => s + (r.vatTotal ?? 0), 0),
    previousTotal,
    projected,
    byCategory,
    byShop: [...shops.values()].sort((a, b) => b.amount - a.amount),
  };
}

/** Total per month, for the month-by-month chart; optionally only one top-level category. */
export function monthlyTotals(
  receipts: readonly Receipt[],
  categories: readonly Category[],
  months: readonly string[],
  categoryId?: string,
): Array<{ month: string; total: number }> {
  return months.map((month) => {
    const inMonth = receipts.filter((r) => r.month === month);
    const total = categoryId
      ? (totalsByCategory(inMonth, categories).get(categoryId) ?? 0)
      : inMonth.reduce((s, r) => s + r.total, 0);
    return { month, total };
  });
}

/** Within one top-level category: how much went to each of its sub-categories. */
export function subcategoryTotals(receipts: readonly Receipt[], categories: readonly Category[], categoryId: string): Map<string, number> {
  const totals = new Map<string, number>();
  for (const r of receipts) {
    for (const part of r.split) {
      if (topLevelOf(part.categoryId, categories) !== categoryId) continue;
      totals.set(part.categoryId, (totals.get(part.categoryId) ?? 0) + part.amount);
    }
  }
  return totals;
}

/** How many days of `month` have begun by `today`: all of them for a past month, none for a future one. */
export function daysSoFar(month: string, today: string): number {
  const current = today.slice(0, 7);
  if (month < current) return daysInMonth(month);
  if (month > current) return 0;
  return Number(today.slice(8, 10));
}

/** Spending added up through a month, day by day: entry d − 1 is everything spent from the 1st to day d. */
export function runningTotals(receipts: readonly Receipt[], month: string): number[] {
  const perDay = new Array<number>(daysInMonth(month)).fill(0);
  for (const r of receipts) if (r.month === month) perDay[Number(r.date.slice(8, 10)) - 1] += r.total;
  let sum = 0;
  return perDay.map((amount) => (sum += amount));
}

/** Days so far this month with nothing spent, out of the days so far. */
export function daysWithoutSpending(receipts: readonly Receipt[], month: string, today: string): { quiet: number; days: number } {
  const days = daysSoFar(month, today);
  const spent = new Set(receipts.filter((r) => r.month === month && r.total > 0 && Number(r.date.slice(8, 10)) <= days).map((r) => r.date));
  return { quiet: days - spent.size, days };
}
