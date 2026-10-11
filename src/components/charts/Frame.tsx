import type { ReactNode } from 'react';

// The card a chart sits in: its title, an optional legend, and the switch between the chart and a
// table of every value (so no value is only reachable by tapping).

export function ChartFrame({
  title,
  subtitle,
  legend,
  asTable,
  onToggle,
  children,
  className = '',
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  legend?: ReactNode;
  asTable: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <figure className={`panel px-4 pb-3 pt-4 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <figcaption className="min-w-0">
          <p className="text-subhead font-semibold">{title}</p>
          {subtitle && <p className="text-footnote text-muted-foreground">{subtitle}</p>}
        </figcaption>
        <button type="button" onClick={onToggle} className="-mr-2 -mt-2.5 min-h-11 shrink-0 rounded-full px-2 text-footnote font-medium text-primary">
          {asTable ? 'Show as chart' : 'Show as table'}
        </button>
      </div>
      {legend && !asTable && <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-footnote text-muted-foreground">{legend}</div>}
      <div className="mt-2">{children}</div>
    </figure>
  );
}

/** A legend entry: a short stroke of the series' colour, then its name. */
export function LineKey({ color, dashed = false, children }: { color: string; dashed?: boolean; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg aria-hidden width="14" height="4" className="shrink-0 overflow-visible">
        <line x1="1" x2="13" y1="2" y2="2" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={dashed ? '2 3' : undefined} />
      </svg>
      {children}
    </span>
  );
}

/** A round step for value gridlines: 1, 2, 2.5 or 5 × a power of ten. */
export function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/**
 * A smooth line through points that never overshoots them (monotone cubic, Fritsch–Carlson):
 * a running total that only goes up is drawn going only up.
 */
export function smoothPath(points: ReadonlyArray<readonly [number, number]>): string {
  const n = points.length;
  if (n === 0) return '';
  if (n < 3) return points.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join('');
  const dx = points.slice(1).map(([x], i) => x - points[i][0]);
  const slope = points.slice(1).map(([, y], i) => (y - points[i][1]) / (dx[i] || 1));
  const tangent = points.map((_, i) => {
    if (i === 0) return slope[0];
    if (i === n - 1) return slope[n - 2];
    const a = slope[i - 1];
    const b = slope[i];
    return a * b <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / a + (dx[i] + 2 * dx[i - 1]) / b);
  });
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const h = dx[i] / 3;
    d += `C${x0 + h},${y0 + tangent[i] * h} ${x1 - h},${y1 - tangent[i + 1] * h} ${x1},${y1}`;
  }
  return d;
}
