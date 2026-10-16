import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES } from '../src/db/categories';
import type { Receipt } from '../src/db/schema';
import { daysSoFar, daysWithoutSpending, monthlyTotals, monthName, monthsEnding, runningTotals, shiftMonth, subcategoryTotals, summarizeMonth } from '../src/kpi/monthly';

let id = 1;
function receipt(date: string, total: number, split: Array<[string, number]>, store = 'Intermart', storeId: number | null = 1): Receipt {
  return {
    id: id++,
    date,
    month: date.slice(0, 7),
    storeId,
    storeName: store,
    categoryId: split[0][0],
    total,
    paymentMethod: 'card',
    vatTotal: null,
    discountTotal: null,
    itemized: split.length > 1,
    source: 'scan',
    note: '',
    split: split.map(([categoryId, amount]) => ({ categoryId, amount })),
    createdAt: 0,
  };
}

const RECEIPTS = [
  receipt('2026-09-27', 1344874, [['groceries.meat', 300000], ['groceries.pantry', 600000], ['household', 300000], ['personal', 144874]]),
  receipt('2026-10-07', 22900, [['electronics', 22900]]),
  receipt('2026-10-08', 150000, [['transport', 150000]], 'Indian Oil', 2),
  receipt('2026-10-09', 80000, [['groceries.dairy', 30000], ['groceries', 20000], ['household', 30000]]),
  receipt('2026-10-09', 5000, [['transport', 5000]], 'Bus fare', null),
];
const CATEGORIES = DEFAULT_CATEGORIES.map((c) => (c.id === 'household' ? { ...c, monthlyBudget: 50000 } : c));

describe('months', () => {
  it('steps across years', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(monthsEnding('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02']);
  });
  it('names months plainly, adding the year only when it is not this year', () => {
    expect(monthName('2026-10', 2026)).toBe('October');
    expect(monthName('2025-10', 2026)).toBe('October 2025');
    expect(monthName('2026-10', 2026, 'short')).toBe('Oct');
  });
});

describe('summarizeMonth', () => {
  const s = summarizeMonth(RECEIPTS, CATEGORIES, '2026-10', '2026-10-10');

  it('totals the month and compares it with the month before', () => {
    expect(s.total).toBe(257900);
    expect(s.receipts).toBe(4);
    expect(s.average).toBe(64475);
    expect(s.previousTotal).toBe(1344874);
  });

  it('rolls sub-categories up into their main category, biggest first', () => {
    expect(s.byCategory.map((c) => [c.categoryId, c.amount])).toEqual([
      ['transport', 155000],
      ['groceries', 50000],
      ['household', 30000],
      ['electronics', 22900],
    ]);
    expect(s.byCategory.reduce((sum, c) => sum + c.amount, 0)).toBe(s.total);
    expect(s.byCategory.find((c) => c.categoryId === 'household')).toMatchObject({ previous: 300000, budget: 50000 });
  });

  it('lists shops by spend, joining receipts from the same shop', () => {
    expect(s.byShop.map((x) => [x.name, x.amount, x.receipts])).toEqual([
      ['Indian Oil', 150000, 1],
      ['Intermart', 102900, 2],
      ['Bus fare', 5000, 1],
    ]);
  });

  it('projects the month-end total at the current pace, for the current month only', () => {
    expect(s.projected).toBe(Math.round((257900 / 10) * 31));
    expect(summarizeMonth(RECEIPTS, CATEGORIES, '2026-09', '2026-10-10').projected).toBeNull();
    expect(summarizeMonth(RECEIPTS, CATEGORIES, '2026-10', '2026-10-06').projected).toBeNull();
    expect(summarizeMonth(RECEIPTS, CATEGORIES, '2026-10', '2026-10-07').projected).not.toBeNull();
  });
});

describe('monthly totals', () => {
  it('gives each month its total, or one category per month', () => {
    const months = ['2026-08', '2026-09', '2026-10'];
    expect(monthlyTotals(RECEIPTS, CATEGORIES, months)).toEqual([
      { month: '2026-08', total: 0 },
      { month: '2026-09', total: 1344874 },
      { month: '2026-10', total: 257900 },
    ]);
    expect(monthlyTotals(RECEIPTS, CATEGORIES, months, 'groceries').map((m) => m.total)).toEqual([0, 900000, 50000]);
  });

  it('breaks a category down into its sub-categories', () => {
    const october = RECEIPTS.filter((r) => r.month === '2026-10');
    expect([...subcategoryTotals(october, CATEGORIES, 'groceries')]).toEqual([
      ['groceries.dairy', 30000],
      ['groceries', 20000],
    ]);
  });
});

describe('day by day', () => {
  it('counts the days of a month that have begun', () => {
    expect(daysSoFar('2026-10', '2026-10-11')).toBe(11);
    expect(daysSoFar('2026-09', '2026-10-11')).toBe(30);
    expect(daysSoFar('2026-11', '2026-10-11')).toBe(0);
  });

  it('adds spending up through the month, one entry per day', () => {
    const running = runningTotals(RECEIPTS, '2026-10');
    expect(running).toHaveLength(31);
    expect(running.slice(5, 10)).toEqual([0, 22900, 172900, 257900, 257900]);
    expect(running[30]).toBe(257900);
  });

  it('counts days so far with nothing spent', () => {
    expect(daysWithoutSpending(RECEIPTS, '2026-10', '2026-10-11')).toEqual({ quiet: 8, days: 11 });
    expect(daysWithoutSpending(RECEIPTS, '2026-10', '2026-10-08')).toEqual({ quiet: 6, days: 8 });
  });
});
