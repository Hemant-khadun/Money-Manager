import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { formatCompactMoney, formatDayMonth, formatMoney } from '../../lib/format';
import { monthName, shiftMonth } from '../../kpi/monthly';
import { ChartFrame, LineKey, niceStep, smoothPath } from './Frame';

// This month's spending added up day by day, against the month before (docs/PLAN.md §7b, dataviz
// mark specs): the month in the brand colour over a faint wash, last month in grey, and for the
// current month a dashed line from today to where the pace leads. Touch or drag across the chart
// (or use the arrow keys) to read both months on any day; the table gives every value.

const WIDTH = 320;
const HEIGHT = 168;
const TOP = 12;
const BOTTOM = 22; // day numbers
const RIGHT = 44; // value labels

const pad = (n: number) => String(n).padStart(2, '0');

export function PaceChart({
  month,
  current,
  previous,
  upTo,
  projected,
}: {
  month: string;
  /** Running totals for every day of `month` (see runningTotals). */
  current: readonly number[];
  /** The same for the month before. */
  previous: readonly number[];
  /** Days of `month` so far: the line stops there. */
  upTo: number;
  /** Month-end estimate at the current pace, for the current month. */
  projected: number | null;
}) {
  const [asTable, setAsTable] = useState(false);
  const [day, setDay] = useState<number | null>(null);
  const wash = useId();

  const before = shiftMonth(month, -1);
  const nowName = monthName(month);
  const beforeName = monthName(before);
  const days = Math.max(current.length, previous.length);
  const drawn = current.slice(0, upTo);
  const projecting = projected !== null && upTo > 0 && upTo < current.length;

  const peak = Math.max(1, ...drawn, ...previous, projecting ? projected : 0);
  const step = niceStep(peak / 3);
  const top = Math.ceil(peak / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) }, (_, i) => (i + 1) * step);
  const x = (d: number) => (d / days) * (WIDTH - RIGHT);
  const y = (v: number) => HEIGHT - BOTTOM - (v / top) * (HEIGHT - BOTTOM - TOP);
  const base = y(0);
  const points = (series: readonly number[]) => [[x(0), base] as const, ...series.map((v, i) => [x(i + 1), y(v)] as const)];

  const line = smoothPath(points(drawn));
  const area = drawn.length ? `${line}L${x(drawn.length)},${base}L${x(0)},${base}Z` : '';
  const lineBefore = smoothPath(points(previous));
  const today = drawn.length ? drawn[drawn.length - 1] : 0;

  const valueOn = (series: readonly number[], d: number, limit = series.length) => (d >= 1 && d <= limit ? series[d - 1] : null);
  const read = (d: number) => {
    const now = valueOn(current, d, upTo);
    const then = valueOn(previous, d);
    return { now, then, date: formatDayMonth(`${month}-${pad(d)}`), dateBefore: formatDayMonth(`${before}-${pad(Math.min(d, previous.length))}`) };
  };
  const chosen = day === null ? null : read(day);
  const words = (d: number) => {
    const r = read(d);
    return `${r.date}: ${r.now === null ? 'not yet' : formatMoney(r.now)} so far; ${beforeName}: ${r.then === null ? 'no day' : formatMoney(r.then)} by ${r.dateBefore}`;
  };

  function chooseAt(e: PointerEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * WIDTH;
    setDay(Math.max(1, Math.min(days, Math.round((px / (WIDTH - RIGHT)) * days))));
  }

  function onKeyDown(e: KeyboardEvent) {
    const at = day ?? Math.max(upTo, 1);
    const next = ({ ArrowLeft: at - 1, ArrowRight: at + 1, Home: 1, End: days } as Record<string, number>)[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setDay(Math.max(1, Math.min(days, next)));
  }

  const rows = Array.from({ length: days }, (_, i) => i + 1).filter(
    (d) => (d <= upTo && current[d - 1] !== (current[d - 2] ?? 0)) || (d <= previous.length && previous[d - 1] !== (previous[d - 2] ?? 0)),
  );

  return (
    <ChartFrame
      title={`${nowName} against ${beforeName}`}
      subtitle="Spending added up day by day"
      asTable={asTable}
      onToggle={() => setAsTable((t) => !t)}
      legend={
        <>
          <LineKey color="var(--primary)">{nowName}</LineKey>
          <LineKey color="var(--track)">{beforeName}</LineKey>
          {projecting && (
            <LineKey color="var(--primary)" dashed>
              At this pace
            </LineKey>
          )}
        </>
      }
    >
      {asTable ? (
        <table className="w-full text-subhead">
          <caption className="sr-only">Spending added up day by day, {nowName} and {beforeName}</caption>
          <thead className="text-footnote text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-normal">Day</th>
              <th className="py-1 text-right font-normal">{nowName}</th>
              <th className="py-1 text-right font-normal">{beforeName}</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((d) => {
              const r = read(d);
              return (
                <tr key={d} className="border-t border-border">
                  <td className="py-1.5">{d}</td>
                  <td className="py-1.5 text-right">{r.now === null ? '–' : formatMoney(r.now)}</td>
                  <td className="py-1.5 text-right text-muted-foreground">{r.then === null ? '–' : formatMoney(r.then)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          {chosen && day !== null && (
            <div
              aria-hidden
              className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full rounded-xl border border-border bg-popover px-3 py-2 text-footnote shadow-float"
              style={{ left: `${Math.min(Math.max((x(day) / WIDTH) * 100, 20), 80)}%` }}
            >
              <p className="font-medium text-muted-foreground">{chosen.date}</p>
              <p className="mt-1 flex items-center gap-1.5 whitespace-nowrap">
                <LineKey color="var(--primary)">
                  <span className="font-semibold text-foreground tabular-nums">{chosen.now === null ? '–' : formatMoney(chosen.now)}</span>
                </LineKey>
              </p>
              <p className="flex items-center gap-1.5 whitespace-nowrap">
                <LineKey color="var(--track)">
                  <span className="font-semibold text-foreground tabular-nums">{chosen.then === null ? '–' : formatMoney(chosen.then)}</span>
                  <span>by {chosen.dateBefore}</span>
                </LineKey>
              </p>
            </div>
          )}
          <svg
            key={month}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="block w-full touch-pan-y overflow-visible rounded-md outline-none focus-visible:outline-2 focus-visible:outline-ring"
            role="slider"
            tabIndex={0}
            aria-label={`${nowName} spending added up day by day, against ${beforeName}`}
            aria-valuemin={1}
            aria-valuemax={days}
            aria-valuenow={day ?? Math.max(upTo, 1)}
            aria-valuetext={words(day ?? Math.max(upTo, 1))}
            onPointerDown={chooseAt}
            onPointerMove={chooseAt}
            onPointerLeave={() => setDay(null)}
            onKeyDown={onKeyDown}
            onBlur={() => setDay(null)}
          >
            <defs>
              <linearGradient id={wash} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="var(--primary)" stopOpacity="0.2" />
                <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
              </linearGradient>
            </defs>

            {ticks.map((v) => (
              <g key={v}>
                <line x1={0} x2={WIDTH - RIGHT} y1={y(v) + 0.5} y2={y(v) + 0.5} stroke="var(--border)" strokeWidth={1} />
                <text x={WIDTH - RIGHT + 6} y={y(v)} dominantBaseline="middle" className="fill-muted-foreground text-[10.5px] tabular-nums">
                  {formatCompactMoney(v)}
                </text>
              </g>
            ))}
            <line x1={0} x2={WIDTH - RIGHT} y1={base + 0.5} y2={base + 0.5} stroke="var(--border)" strokeWidth={1} />
            {[1, 15, days].map((d) => (
              <text key={d} x={x(d)} y={HEIGHT - 5} textAnchor={d === days ? 'end' : 'middle'} className="fill-muted-foreground text-[10.5px] tabular-nums">
                {d}
              </text>
            ))}

            <path d={lineBefore} fill="none" stroke="var(--track)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" pathLength={1} strokeDasharray="1" className="animate-draw" />
            {area && <path d={area} fill={`url(#${wash})`} className="animate-fade" style={{ animationDelay: '300ms' }} />}
            {line && (
              <path d={line} fill="none" stroke="var(--primary)" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" pathLength={1} strokeDasharray="1" className="animate-draw" />
            )}
            {projecting && (
              <g className="animate-fade" style={{ animationDelay: '900ms' }}>
                <line x1={x(upTo)} y1={y(today)} x2={x(current.length)} y2={y(projected)} stroke="var(--primary)" strokeOpacity={0.6} strokeWidth={2} strokeDasharray="2 5" strokeLinecap="round" />
                <circle cx={x(current.length)} cy={y(projected)} r={4} fill="var(--card)" stroke="var(--primary)" strokeWidth={2} />
              </g>
            )}
            {drawn.length > 0 && (
              <g className="animate-fade" style={{ animationDelay: '800ms' }}>
                {projecting && <circle cx={x(upTo)} cy={y(today)} r={5} className="origin-center animate-ping fill-primary/40 transform-fill" />}
                <circle cx={x(upTo)} cy={y(today)} r={4.5} fill="var(--primary)" stroke="var(--card)" strokeWidth={2} />
              </g>
            )}

            {day !== null && (
              <g pointerEvents="none">
                <line x1={x(day)} x2={x(day)} y1={TOP} y2={base} stroke="var(--muted-foreground)" strokeOpacity={0.5} strokeWidth={1} />
                {chosen?.then != null && <circle cx={x(day)} cy={y(chosen.then)} r={4} fill="var(--track)" stroke="var(--card)" strokeWidth={2} />}
                {chosen?.now != null && <circle cx={x(day)} cy={y(chosen.now)} r={4.5} fill="var(--primary)" stroke="var(--card)" strokeWidth={2} />}
              </g>
            )}
          </svg>
        </div>
      )}
    </ChartFrame>
  );
}
