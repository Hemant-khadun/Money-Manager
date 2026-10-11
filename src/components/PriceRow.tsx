import { Link } from '@tanstack/react-router';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { PriceChange, Purchase } from '../kpi/prices';
import { formatMoney, formatPercent, formatShortDate } from '../lib/format';
import { Row } from './primitives';

// A product's last price against the time before, in words: "Was Rs 45.00 on 7 Sep", and
// "↑ 16% more". The arrow is coloured, but the words carry the meaning (docs/PLAN.md §7b).

/** "Rs 52.00", or "Rs 120.00 a kg" for something weighed at the till. */
export function formatPrice(p: Purchase): string {
  return `${formatMoney(p.price)}${p.perKg ? ' a kg' : ''}`;
}

/** "on 7 Sep", or "at Winners on 7 Sep" when it was bought at another shop. */
export function previousWhen({ latest, previous }: PriceChange): string {
  if (!previous) return '';
  const otherShop = previous.storeName && previous.storeName.toLowerCase() !== latest.storeName.toLowerCase();
  return `${otherShop ? `at ${previous.storeName} ` : ''}on ${formatShortDate(previous.date)}`;
}

function comparison(c: PriceChange): string {
  if (!c.previous) return c.product.purchases.length === 1 ? `Bought once, on ${formatShortDate(c.latest.date)}` : `Bought on ${formatShortDate(c.latest.date)}`;
  if (c.change === 0) return `Same price as ${previousWhen(c)}`;
  return `Was ${formatPrice(c.previous)} ${previousWhen(c)}`;
}

/** "↑ 16% more" / "↓ 8% less" */
export function ChangeWords({ change, className = '' }: { change: PriceChange; className?: string }) {
  if (change.change === 0) return null;
  const up = change.change > 0;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span className={`flex items-center gap-0.5 ${className}`}>
      <Icon aria-hidden className={`size-3.5 shrink-0 ${up ? 'text-warn' : 'text-good'}`} strokeWidth={2.25} />
      {formatPercent(change.ratio)} {up ? 'more' : 'less'}
    </span>
  );
}

export function PriceRow({ change }: { change: PriceChange }) {
  return (
    <Row
      to="/product/$key"
      params={{ key: change.product.keys[0] }}
      title={change.product.name}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-1.5">
          <ChangeWords change={change} className="font-medium text-foreground" />
          {comparison(change)}
        </span>
      }
      value={formatPrice(change.latest)}
    />
  );
}

/** The same, as a card for a sideways-scrolling row. */
export function PriceCard({ change }: { change: PriceChange }) {
  return (
    <Link
      to="/product/$key"
      params={{ key: change.product.keys[0] }}
      className="panel flex w-44 shrink-0 snap-start flex-col p-4 transition-transform active:scale-[0.97]"
    >
      <p className="line-clamp-2 min-h-[2.8em] text-subhead font-medium">{change.product.name}</p>
      <p className="mt-3 text-title2">{formatPrice(change.latest)}</p>
      <ChangeWords change={change} className="mt-1 text-footnote text-muted-foreground" />
      {change.previous && <p className="mt-0.5 text-footnote text-muted-foreground">Was {formatPrice(change.previous)}</p>}
    </Link>
  );
}
