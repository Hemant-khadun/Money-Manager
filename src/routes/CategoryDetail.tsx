import { getRouteApi } from '@tanstack/react-router';
import { ReceiptText } from 'lucide-react';
import { useMemo } from 'react';
import { useApp } from '../app/AppContext';
import { CategoryIcon } from '../components/CategoryIcon';
import { categoryIcon, categoryName } from '../components/CategoryPicker';
import { BudgetCaption, Meter, budgetState } from '../components/charts/Meter';
import { MonthBars } from '../components/charts/MonthBars';
import { MoneyHero } from '../components/Money';
import { Page } from '../components/Page';
import { EmptyState, Group, Row } from '../components/primitives';
import { topLevelOf } from '../db/categories';
import { useCategories, useItemsInMonth, useReceiptsBetween } from '../hooks/data';
import { formatDayMonth, formatMoney } from '../lib/format';
import { monthName, monthlyTotals, monthsEnding, shiftMonth, subcategoryTotals, totalsByCategory } from '../kpi/monthly';
import { Delta } from './Overview';

// One category for the selected month: how it compares, its sub-categories, what was bought and
// on which receipts.

const route = getRouteApi('/category/$id');

export function CategoryDetail() {
  const { id } = route.useParams();
  const { month, setMonth } = useApp();
  const categories = useCategories();
  const receipts = useReceiptsBetween(monthsEnding(month, 6)[0], month);
  const items = useItemsInMonth(month);
  const category = categories?.find((c) => c.id === id);

  const data = useMemo(() => {
    if (!receipts || !categories) return null;
    const now = receipts.filter((r) => r.month === month);
    const before = receipts.filter((r) => r.month === shiftMonth(month, -1));
    const inCategory = (categoryId: string) => topLevelOf(categoryId, categories) === id;
    return {
      total: totalsByCategory(now, categories).get(id) ?? 0,
      previous: totalsByCategory(before, categories).get(id) ?? 0,
      trend: monthlyTotals(receipts, categories, monthsEnding(month, 6), id),
      subs: [...subcategoryTotals(now, categories, id)].sort((a, b) => b[1] - a[1]),
      receipts: now
        .map((r) => ({ receipt: r, amount: r.split.filter((p) => inCategory(p.categoryId)).reduce((s, p) => s + p.amount, 0) }))
        .filter((x) => x.amount !== 0)
        .sort((a, b) => b.receipt.date.localeCompare(a.receipt.date)),
      inCategory,
    };
  }, [receipts, categories, month, id]);

  // What was bought: items in this category, the same product added up across receipts.
  const products = useMemo(() => {
    if (!items || !data) return [];
    const byProduct = new Map<string, { name: string; amount: number; count: number }>();
    for (const item of items) {
      if (item.kind !== 'item' || !data.inCategory(item.categoryId)) continue;
      const p = byProduct.get(item.productKey) ?? { name: item.name, amount: 0, count: 0 };
      p.amount += item.lineTotal;
      p.count += 1;
      byProduct.set(item.productKey, p);
    }
    return [...byProduct.values()].sort((a, b) => b.amount - a.amount);
  }, [items, data]);

  const name = category?.name ?? categoryName(id, categories);
  const budget = category?.monthlyBudget ? budgetState(data?.total ?? 0, category.monthlyBudget, null) : null;

  return (
    <Page title={name} back="Overview" glow>
      <div className="mt-2 flex items-center gap-3">
        <CategoryIcon icon={category?.icon ?? categoryIcon(id, categories)} size="lg" />
        <p className="text-subhead font-medium text-muted-foreground">Spent in {monthName(month)}</p>
      </div>
      <section className={`mt-3 transition-opacity ${data ? '' : 'opacity-40'}`}>
        <MoneyHero cents={data?.total ?? 0} />
        {data && (
          <div className="mt-3">
            <Delta now={data.total} before={data.previous} beforeName={monthName(shiftMonth(month, -1))} />
          </div>
        )}
        {budget && category?.monthlyBudget && (
          <div className="mt-3 max-w-sm">
            <Meter value={(data?.total ?? 0) / category.monthlyBudget} tone={budget.tone} label={`${name} against its budget`} />
            <BudgetCaption state={budget} />
          </div>
        )}
      </section>

      {data && (
        <div className="mt-5">
          <MonthBars data={data.trend} selected={month} onSelect={setMonth} title="Last six months" label={`${name} per month, last six months`} />
        </div>
      )}

      {data && data.total === 0 && <EmptyState title={`Nothing in ${name} for ${monthName(month)}`} icon={ReceiptText} />}

      {data && data.subs.length > 1 && (
        <Group title="Breakdown">
          {data.subs.map(([subId, amount]) => (
            <Row
              key={subId}
              icon={<CategoryIcon icon={categoryIcon(subId, categories)} size="sm" />}
              title={subId === id ? `Other ${name.toLowerCase()}` : categoryName(subId, categories)}
              value={formatMoney(amount)}
              below={<Meter value={data.total ? amount / data.total : 0} label={`${categoryName(subId, categories)}: share of ${name}`} />}
            />
          ))}
        </Group>
      )}

      {products.length > 0 && (
        <Group title="What you bought" footer="From receipts whose items were read.">
          {products.slice(0, 40).map((p) => (
            <Row key={p.name} title={p.name} subtitle={p.count > 1 ? `${p.count} times` : undefined} value={formatMoney(p.amount)} />
          ))}
        </Group>
      )}

      {data && data.receipts.length > 0 && (
        <Group title="Receipts">
          {data.receipts.map(({ receipt, amount }) => (
            <Row
              key={receipt.id}
              to="/receipt/$id"
              params={{ id: String(receipt.id) }}
              title={receipt.storeName || categoryName(receipt.categoryId, categories)}
              subtitle={amount !== receipt.total ? `${formatDayMonth(receipt.date)} · part of ${formatMoney(receipt.total)}` : formatDayMonth(receipt.date)}
              value={formatMoney(amount)}
            />
          ))}
        </Group>
      )}
    </Page>
  );
}
