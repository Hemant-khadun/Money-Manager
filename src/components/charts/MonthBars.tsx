import { useState } from 'react';
import { formatCompactMoney, formatMoney } from '../../lib/format';
import { monthName } from '../../kpi/monthly';
import { ChartFrame } from './Frame';

// Month-by-month spending (docs/PLAN.md §7b, dataviz mark specs): grey columns with the selected
// month in the brand colour, at most 24 px wide, 4 px rounded tops on a hairline baseline. Only
// the selected column carries its value; tap any column to select it. Columns grow from the
// baseline the first time they're shown.

const HEIGHT = 132;
const TOP = 22; // room for the selected column's value
const BOTTOM = 22; // month labels
const WIDTH = 320;

function column(x: number, w: number, h: number, base: number): string {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  const top = base - h;
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`;
}

export function MonthBars({
  data,
  selected,
  onSelect,
  title,
  label,
}: {
  data: ReadonlyArray<{ month: string; total: number }>;
  selected: string;
  onSelect?: (month: string) => void;
  title: string;
  /** What is plotted, for screen readers ("Spending per month"). */
  label: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const max = Math.max(...data.map((d) => d.total), 1);
  const band = WIDTH / data.length;
  const barWidth = Math.min(24, band * 0.55);
  const base = HEIGHT - BOTTOM;
  const scale = (base - TOP) / max;
  const average = data.reduce((s, d) => s + d.total, 0) / data.length;

  return (
    <ChartFrame
      title={title}
      subtitle={`${formatMoney(Math.round(average))} a month on average`}
      asTable={asTable}
      onToggle={() => setAsTable((t) => !t)}
    >
      {asTable ? (
        <table className="w-full text-subhead">
          <caption className="sr-only">{label}</caption>
          <thead className="text-footnote text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-normal">Month</th>
              <th className="py-1 text-right font-normal">Spent</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {data.map((d) => (
              <tr key={d.month} className={`border-t border-border ${d.month === selected ? 'font-semibold' : ''}`}>
                <td className="py-1.5">{monthName(d.month)}</td>
                <td className="py-1.5 text-right">{formatMoney(d.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block w-full overflow-visible" role="group" aria-label={label}>
          <line x1={0} x2={WIDTH} y1={base + 0.5} y2={base + 0.5} stroke="var(--border)" strokeWidth={1} />
          {data.map((d, i) => {
            const x = i * band + (band - barWidth) / 2;
            const h = Math.max(d.total > 0 ? 2 : 0, d.total * scale);
            const isSelected = d.month === selected;
            const name = monthName(d.month, undefined, 'short');
            return (
              <g
                key={d.month}
                role="button"
                tabIndex={onSelect ? 0 : -1}
                aria-pressed={isSelected}
                aria-label={`${monthName(d.month)}: ${formatMoney(d.total)}`}
                onClick={() => onSelect?.(d.month)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect?.(d.month);
                  }
                }}
                className="group cursor-pointer outline-none"
              >
                {/* The whole column is the tap target, not just the painted bar. */}
                <rect x={i * band + 2} y={0} width={band - 4} height={HEIGHT} rx={10} className="fill-transparent group-hover:fill-muted/60 group-focus-visible:stroke-ring" strokeWidth={1.5} />
                <path
                  d={column(x, barWidth, h, base)}
                  className={`origin-bottom animate-grow transform-fill ${isSelected ? 'fill-primary' : 'fill-track'}`}
                  style={{ animationDelay: `${i * 40}ms` }}
                />
                {isSelected && (
                  <text x={x + barWidth / 2} y={Math.max(base - h - 7, 12)} textAnchor="middle" className="animate-fade fill-foreground text-[11px] font-semibold">
                    {formatCompactMoney(d.total)}
                  </text>
                )}
                <text x={x + barWidth / 2} y={HEIGHT - 5} textAnchor="middle" className={`text-[11px] ${isSelected ? 'fill-foreground font-semibold' : 'fill-muted-foreground'}`}>
                  {name.split(' ')[0]}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </ChartFrame>
  );
}
