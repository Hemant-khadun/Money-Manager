import { useMemo } from 'react';
import { CategoryIcon } from '../components/CategoryIcon';
import { categoryIcon, categoryName } from '../components/CategoryPicker';
import { BudgetCaption, Meter, budgetState } from '../components/charts/Meter';
import { PriceCard } from '../components/PriceRow';
import { Group, GroupLink, Row } from '../components/primitives';
import { ShopAvatar } from '../components/ShopAvatar';
import type { Category } from '../db/schema';
import { usePrices } from '../hooks/usePrices';
import { formatMoney } from '../lib/format';
import { monthName, type MonthSummary } from '../kpi/monthly';
import { filterChanges, priceChanges } from '../kpi/prices';

// The lower half of the dashboard: where the money went by category (and against budgets), what
// cost more than last time, and spending by shop. Below the fold on a phone, so it loads next to
// the first screen rather than with it, keeping the app quick to open (docs/PLAN.md §7b).

export function OverviewDetails({ summary: s, categories, month }: { summary: MonthSummary; categories: readonly Category[]; month: string }) {
  const prices = usePrices();
  // Things bought this month that cost more than the time before.
  const rises = useMemo(() => (prices ? filterChanges(priceChanges(prices.products, month), 'more') : []), [prices, month]);

  return (
    <>
      {s.byCategory.length > 0 && (
        <Group title="Where it went">
          {s.byCategory.map((c, i) => {
            const name = categoryName(c.categoryId, categories);
            const budget = c.budget ? budgetState(c.amount, c.budget, s.projected === null ? null : Math.round(c.amount * (s.projected / Math.max(s.total, 1)))) : null;
            return (
              <Row
                key={c.categoryId}
                to="/category/$id"
                params={{ id: c.categoryId }}
                icon={<CategoryIcon icon={categoryIcon(c.categoryId, categories)} />}
                title={name}
                value={formatMoney(c.amount)}
                below={
                  budget ? (
                    <>
                      <Meter value={c.amount / c.budget!} tone={budget.tone} label={`${name} against its budget`} delay={i * 60} />
                      <BudgetCaption state={budget} />
                    </>
                  ) : (
                    <>
                      <Meter value={c.share} label={`${name}: share of the month`} delay={i * 60} />
                      <p className="mt-1.5 text-footnote text-muted-foreground">{Math.round(c.share * 100)}% of spending</p>
                    </>
                  )
                }
              />
            );
          })}
        </Group>
      )}

      {prices && prices.itemized > 0 && rises.length > 0 && (
        <section className="mt-7">
          <div className="mb-2 flex items-end justify-between gap-3 px-1">
            <h2 className="text-headline">Cost more than last time</h2>
            <GroupLink to="/prices">All prices</GroupLink>
          </div>
          <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1">
            {rises.slice(0, 8).map((c) => (
              <PriceCard key={c.product.keys[0]} change={c} />
            ))}
          </div>
        </section>
      )}
      {prices && prices.itemized > 0 && rises.length === 0 && (
        <Group title="Prices">
          <Row to="/prices" title="All prices" subtitle={`Nothing you bought in ${monthName(month)} cost more than last time`} />
        </Group>
      )}

      {s.byShop.length > 0 && (
        <Group title="Shops">
          {s.byShop.slice(0, 6).map((shop, i) => (
            <Row
              key={shop.key}
              icon={<ShopAvatar name={shop.name} />}
              title={shop.name}
              subtitle={shop.receipts === 1 ? '1 receipt' : `${shop.receipts} receipts`}
              value={formatMoney(shop.amount)}
              below={<Meter value={shop.amount / s.byShop[0].amount} label={`${shop.name}: spending compared with the top shop`} delay={i * 60} />}
            />
          ))}
        </Group>
      )}
    </>
  );
}
