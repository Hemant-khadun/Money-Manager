import { Link } from '@tanstack/react-router';
import { CalendarDays, ChevronLeft, ChevronRight, Leaf, ReceiptText, ScanLine, Settings, Trophy, type LucideIcon } from 'lucide-react';
import { lazy, Suspense, useMemo, type ReactNode } from 'react';
import { useApp } from '../app/AppContext';
import { categoryName } from '../components/CategoryPicker';
import { MonthBars } from '../components/charts/MonthBars';
import { PaceChart } from '../components/charts/PaceChart';
import { MoneyHero } from '../components/Money';
import { Page } from '../components/Page';
import { Button, ChangeBadge, EmptyState, IconButton, buttonBase, buttonKinds, rise } from '../components/primitives';
import type { Receipt } from '../db/schema';
import { useCategories, useReceiptCount, useReceiptsBetween } from '../hooks/data';
import { formatMoney, formatShortDate, formatWholeMoney } from '../lib/format';
import {
  daysSoFar,
  daysWithoutSpending,
  monthName,
  monthOf,
  monthlyTotals,
  monthsEnding,
  runningTotals,
  shiftMonth,
  summarizeMonth,
  todayIso,
} from '../kpi/monthly';

// The dashboard (docs/PLAN.md §5): the month's total against the month before and where the pace
// leads, the month day by day against the last one, a few numbers about it, six months side by
// side, where the money went by category (and against budgets), what cost more than last time,
// and spending by shop.

// Starts loading with this screen, alongside the first look at the database.
const details = import('./OverviewDetails');
const OverviewDetails = lazy(() => details.then((m) => ({ default: m.OverviewDetails })));

export function Overview() {
  const { month, setMonth, setAddExpenseOpen } = useApp();
  const categories = useCategories();
  const count = useReceiptCount();
  const receipts = useReceiptsBetween(monthsEnding(month, 6)[0], month);
  const thisMonth = monthOf(new Date());
  const today = todayIso();

  const data = useMemo(() => {
    if (!receipts || !categories) return null;
    const biggest = receipts.filter((r) => r.month === month).reduce<Receipt | null>((b, r) => (!b || r.total > b.total ? r : b), null);
    return {
      summary: summarizeMonth(receipts, categories, month, today),
      trend: monthlyTotals(receipts, categories, monthsEnding(month, 6)),
      current: runningTotals(receipts, month),
      previous: runningTotals(receipts, shiftMonth(month, -1)),
      days: daysSoFar(month, today),
      quiet: daysWithoutSpending(receipts, month, today),
      biggest,
    };
  }, [receipts, categories, month, today]);

  const switcher = (
    <div className="flex items-center">
      <IconButton label="Previous month" icon={ChevronLeft} onClick={() => setMonth(shiftMonth(month, -1))} />
      <IconButton label="Next month" icon={ChevronRight} disabled={month >= thisMonth} onClick={() => setMonth(shiftMonth(month, 1))} />
      <Link to="/settings" aria-label="Settings" className="group grid size-11 place-items-center">
        <span className="grid size-9 place-items-center rounded-full border border-border bg-card shadow-card transition-transform group-active:scale-90">
          <Settings aria-hidden className="size-4.5" strokeWidth={2} />
        </span>
      </Link>
    </div>
  );

  if (count === 0) {
    return (
      <Page title="Money Manager" actions={switcher} glow>
        <EmptyState title="Nothing here yet" icon={ScanLine}>
          <p>Scan a receipt, or add something you paid for, and you'll see where your money goes, month by month.</p>
          <div className="mt-6 flex flex-col gap-2">
            <Link to="/scan" className={`${buttonBase} ${buttonKinds.primary}`}>
              Scan a receipt
            </Link>
            <Button kind="plain" onClick={() => setAddExpenseOpen(true)}>
              Add an expense without a receipt
            </Button>
          </div>
        </EmptyState>
      </Page>
    );
  }

  const s = data?.summary;
  const previousName = monthName(shiftMonth(month, -1));
  let section = 0;
  // Each block rises in a little after the one above it.
  const enter = (className: string) => {
    const r = rise(section++);
    return { className: `${className} ${r.className}`, style: r.style };
  };

  return (
    <Page title={monthName(month)} actions={switcher} glow>
      {/* Keep the frame while numbers load: no jump. */}
      <section className={`mt-3 transition-opacity ${s ? '' : 'opacity-40'}`} aria-live="polite">
        <p className="text-subhead font-medium text-muted-foreground">{month === thisMonth ? 'Spent so far' : 'Spent'}</p>
        <MoneyHero cents={s?.total ?? 0} className="mt-1" />
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          {s && data && (month === thisMonth ? (
            // Part of a month against part of a month: what was spent by this day last month.
            <Delta now={s.total} before={data.previous[Math.min(data.days, data.previous.length) - 1] ?? 0} beforeName={previousName} sameTime />
          ) : (
            <Delta now={s.total} before={s.previousTotal} beforeName={previousName} />
          ))}
          {s?.projected != null && <span className="text-subhead text-muted-foreground">On track for {formatMoney(s.projected)}</span>}
        </div>
      </section>

      {data && s && (s.total > 0 || s.previousTotal > 0) && (
        <div {...enter('mt-6')}>
          <PaceChart month={month} current={data.current} previous={data.previous} upTo={data.days} projected={s.projected} />
        </div>
      )}

      {data && s && s.receipts > 0 && (
        <div {...enter('mt-3 grid grid-cols-2 gap-3')}>
          <Stat icon={CalendarDays} label="A day" value={formatWholeMoney(s.total / Math.max(data.days, 1))} note={`Over ${data.days} ${data.days === 1 ? 'day' : 'days'}`} />
          <Stat icon={ReceiptText} label="Receipts" value={String(s.receipts)} note={`${formatWholeMoney(s.average)} on average`} />
          {data.biggest && (
            <Stat
              icon={Trophy}
              label="Biggest receipt"
              value={formatWholeMoney(data.biggest.total)}
              note={`${data.biggest.storeName || categoryName(data.biggest.categoryId, categories)}, ${formatShortDate(data.biggest.date)}`}
              to={String(data.biggest.id)}
            />
          )}
          <Stat icon={Leaf} label="No-spend days" value={String(data.quiet.quiet)} note={`Out of ${data.quiet.days} so far`} />
        </div>
      )}

      {data && (
        <div {...enter('mt-3')}>
          <MonthBars data={data.trend} selected={month} onSelect={setMonth} title="Last six months" label="Spending per month, last six months" />
        </div>
      )}

      {s && s.receipts === 0 && (
        <EmptyState title={`No spending in ${monthName(month)}`} icon={ReceiptText}>
          Receipts you scan or add for this month show up here.
        </EmptyState>
      )}

      {s && categories && (
        <Suspense fallback={null}>
          <OverviewDetails summary={s} categories={categories} month={month} />
        </Suspense>
      )}
    </Page>
  );
}

/**
 * "↑ 6% more than September", or with `sameTime` (a month still under way) "↓ 12% less than this
 * time in September"; a plain sentence when there's nothing to compare with.
 */
export function Delta({ now, before, beforeName, sameTime = false }: { now: number; before: number; beforeName: string; sameTime?: boolean }) {
  const than = sameTime ? `this time in ${beforeName}` : beforeName;
  if (!before) return <ChangeBadge up={null}>{sameTime ? `Nothing spent by this time in ${beforeName}` : `Nothing recorded in ${beforeName}`}</ChangeBadge>;
  const change = (now - before) / before;
  const pct = Math.round(Math.abs(change) * 100);
  if (pct === 0) return <ChangeBadge up={null}>Same as {than}</ChangeBadge>;
  return (
    <ChangeBadge up={change > 0}>
      {pct}% {change > 0 ? 'more' : 'less'} than {than}
    </ChangeBadge>
  );
}

function Stat({ icon: Icon, label, value, note, to }: { icon: LucideIcon; label: string; value: string; note: ReactNode; to?: string }) {
  const body = (
    <>
      <div className="flex items-center gap-2 text-footnote font-medium text-muted-foreground">
        <span className="grid size-7 place-items-center rounded-lg bg-muted">
          <Icon aria-hidden className="size-4" strokeWidth={2} />
        </span>
        {label}
      </div>
      <p className="mt-3 truncate text-title2">{value}</p>
      <p className="mt-0.5 truncate text-footnote text-muted-foreground">{note}</p>
    </>
  );
  const box = 'panel block min-w-0 p-4';
  return to ? (
    <Link to="/receipt/$id" params={{ id: to }} className={`${box} transition-transform active:scale-[0.97]`}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}
