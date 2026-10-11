import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Purchase } from '../../kpi/prices';
import { formatMoney, formatShortDate } from '../../lib/format';
import { formatPrice } from '../PriceRow';

// What one product cost each time it was bought (docs/PLAN.md §7b, dataviz mark specs): a 2 px
// accent line through a dot per purchase, spaced by date. Prices don't start from zero, so two
// hairlines mark the lowest and highest price paid. The chosen purchase (the last one at first) is
// read out above the chart; tap or drag across it, or use the arrow keys, to choose another. The
// list under the chart gives every price without tapping.

const WIDTH = 320;
const HEIGHT = 120;
const TOP = 10;
const BOTTOM = 22; // dates
const LEFT = 4;
const RIGHT = 64; // price labels
const DAY = 86_400_000;

/** Maps [d0, d1] onto [r0, r1]. */
const linear = (d0: number, d1: number, r0: number, r1: number) => (v: number) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);

export function PriceLine({ purchases, label }: { purchases: readonly Purchase[]; label: string }) {
  const [chosen, setChosen] = useState(purchases.length - 1);
  const wash = useId();
  const at = Math.min(chosen, purchases.length - 1);
  const times = purchases.map((p) => Date.parse(`${p.date}T00:00:00Z`));
  const first = times[0];
  const last = times[times.length - 1];
  const x = first === last ? linear(first - DAY, last + DAY, LEFT + 6, WIDTH - RIGHT - 6) : linear(first, last, LEFT + 6, WIDTH - RIGHT - 6);
  const prices = purchases.map((p) => p.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const pad = Math.max((hi - lo) * 0.2, hi * 0.05);
  const y = linear(lo - pad, hi + pad, HEIGHT - BOTTOM, TOP);
  const path = purchases.map((q, i) => `${i ? 'L' : 'M'}${x(times[i])},${y(q.price)}`).join('');

  const p = purchases[at];
  const where = `${formatShortDate(p.date)}${p.storeName ? ` at ${p.storeName}` : ''}`;

  function chooseAt(e: PointerEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * WIDTH;
    let best = 0;
    times.forEach((t, i) => {
      if (Math.abs(x(t) - px) <= Math.abs(x(times[best]) - px)) best = i;
    });
    setChosen(best);
  }

  function onKeyDown(e: KeyboardEvent) {
    const next = ({ ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: purchases.length - 1 } as Record<string, number>)[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setChosen(Math.max(0, Math.min(purchases.length - 1, next)));
  }

  return (
    <figure className="panel mt-5 px-4 pb-3 pt-4">
      <figcaption className="text-subhead font-semibold">{label}</figcaption>
      <p className="mt-0.5 text-subhead">
        <span className="font-semibold">{formatPrice(p)}</span>
        <span className="text-muted-foreground"> · {where}</span>
      </p>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="mt-1 block w-full touch-pan-y rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-primary"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={1}
        aria-valuemax={purchases.length}
        aria-valuenow={at + 1}
        aria-valuetext={`${formatPrice(p)}, ${where}`}
        onPointerDown={chooseAt}
        onPointerMove={chooseAt}
        onKeyDown={onKeyDown}
      >
        <defs>
          <linearGradient id={wash} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--primary)" stopOpacity="0.18" />
            <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[...new Set([lo, hi])].map((v) => (
          <g key={v}>
            <line x1={LEFT} x2={WIDTH - RIGHT} y1={y(v) + 0.5} y2={y(v) + 0.5} stroke="var(--border)" strokeWidth={1} />
            <text x={WIDTH - RIGHT + 6} y={y(v)} dominantBaseline="middle" className="fill-muted-foreground text-[11px] tabular-nums">
              {formatMoney(v)}
            </text>
          </g>
        ))}
        <line x1={x(times[at])} x2={x(times[at])} y1={TOP} y2={HEIGHT - BOTTOM} stroke="var(--muted-foreground)" strokeOpacity={0.5} strokeWidth={1} />
        <path d={`${path}L${x(last)},${HEIGHT - BOTTOM}L${x(first)},${HEIGHT - BOTTOM}Z`} fill={`url(#${wash})`} className="animate-fade" />
        <path d={path} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" pathLength={1} strokeDasharray="1" className="animate-draw" />
        {purchases.map((q, i) => (
          <circle key={q.receiptId} cx={x(times[i])} cy={y(q.price)} r={i === at ? 5 : 4} fill="var(--primary)" stroke="var(--card)" strokeWidth={2} />
        ))}
        <text x={x(first)} y={HEIGHT - 6} textAnchor="start" className="fill-muted-foreground text-[11px]">
          {formatShortDate(purchases[0].date)}
        </text>
        {last !== first && (
          <text x={x(last)} y={HEIGHT - 6} textAnchor="end" className="fill-muted-foreground text-[11px]">
            {formatShortDate(purchases[purchases.length - 1].date)}
          </text>
        )}
      </svg>
    </figure>
  );
}
