import { getRouteApi } from '@tanstack/react-router';
import { PriceLine } from '../components/charts/PriceLine';
import { MoneyHero } from '../components/Money';
import { Page } from '../components/Page';
import { formatPrice, previousWhen } from '../components/PriceRow';
import { ChangeBadge, EmptyState, Group, Row } from '../components/primitives';
import { usePrices } from '../hooks/usePrices';
import { priceChange, type PriceChange } from '../kpi/prices';
import { formatMoney, formatPercent, formatShortDate } from '../lib/format';

// One product: what it cost the last time against the time before, every price paid on a line,
// and each receipt it was on.

const route = getRouteApi('/product/$key');

export function ProductDetail() {
  const { key } = route.useParams();
  const data = usePrices();
  const product = data?.products.find((p) => p.keys.includes(key));

  if (data === undefined) return <Page title="" back="Back">{null}</Page>;
  if (!product) {
    return (
      <Page title="Prices" back="Back">
        <EmptyState title="It isn't on any receipt any more" />
      </Page>
    );
  }

  const change = priceChange(product)!;
  const { latest } = change;
  // A price for a kg and a price for one don't share a line.
  const comparable = product.purchases.filter((p) => p.perKg === latest.perKg);

  return (
    <Page title={product.name} back="Back" glow>
      <p className="mt-2 text-subhead font-medium text-muted-foreground">Last paid</p>
      <div className="mt-1 flex items-baseline gap-2">
        <MoneyHero cents={latest.price} />
        {latest.perKg && <span className="text-title2 text-muted-foreground">a kg</span>}
      </div>
      <p className="mt-1 text-subhead text-muted-foreground">
        Paid on {formatShortDate(latest.date)}
        {latest.storeName && ` at ${latest.storeName}`}
      </p>
      <div className="mt-3">
        <Comparison change={change} />
      </div>

      {comparable.length >= 3 && (
        <PriceLine key={comparable.length} purchases={comparable} label={latest.perKg ? 'What you paid for a kg each time' : 'What you paid each time'} />
      )}

      <Group title="Every time you bought it" footer="Prices are for one, or for a kg, before discounts.">
        {[...product.purchases].reverse().map((p) => (
          <Row
            key={p.receiptId}
            to="/receipt/$id"
            params={{ id: String(p.receiptId) }}
            title={formatShortDate(p.date)}
            subtitle={[p.storeName, p.name !== product.name && `as "${p.name}"`].filter(Boolean).join(' · ') || undefined}
            value={formatPrice(p)}
          />
        ))}
      </Group>
    </Page>
  );
}

/** "↑ Rs 7.00 (16%) more than on 7 Sep" */
function Comparison({ change }: { change: PriceChange }) {
  if (!change.previous) {
    return <ChangeBadge up={null}>{change.product.purchases.length === 1 ? 'Bought once so far' : 'Nothing to compare it with yet'}</ChangeBadge>;
  }
  if (change.change === 0) return <ChangeBadge up={null}>Same price as {previousWhen(change)}</ChangeBadge>;
  const up = change.change > 0;
  return (
    <ChangeBadge up={up}>
      {formatMoney(Math.abs(change.change))} ({formatPercent(change.ratio)}) {up ? 'more' : 'less'} than {previousWhen(change)}
    </ChangeBadge>
  );
}
