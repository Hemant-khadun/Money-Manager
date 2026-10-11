import { Link, useLocation } from '@tanstack/react-router';
import { ChartColumn, List, ScanLine, type LucideIcon } from 'lucide-react';

// Three tabs in a floating translucent dock (docs/PLAN.md §7b): Overview · Scan · History.
// Scan is the one main action: a filled circle in the middle, with a soft glow.

function Tab({ to, label, icon: Icon, on }: { to: '/' | '/history'; label: string; icon: LucideIcon; on: boolean }) {
  return (
    <Link
      to={to}
      aria-current={on ? 'page' : undefined}
      className={`flex min-h-12 min-w-20 flex-col items-center justify-center gap-0.5 rounded-full px-3 text-caption font-medium transition-colors duration-200 ${on ? 'bg-foreground/[0.07] text-foreground' : 'text-muted-foreground'}`}
    >
      <Icon aria-hidden className="size-5.5" strokeWidth={on ? 2.25 : 1.75} />
      {label}
    </Link>
  );
}

export function TabBar({ readyCount }: { readyCount: number }) {
  const path = useLocation({ select: (l) => l.pathname });
  const active = path.startsWith('/scan') ? 'scan' : path.startsWith('/history') || path.startsWith('/receipt') ? 'history' : 'overview';

  return (
    <nav
      aria-label="Main"
      className="glass fixed inset-x-0 z-30 mx-auto flex w-fit items-center gap-1 rounded-full border border-border p-1.5 shadow-float"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 14px)' }}
    >
      <Tab to="/" label="Overview" icon={ChartColumn} on={active === 'overview'} />
      <Link
        to="/scan"
        aria-label={readyCount ? `Scan, ${readyCount} ready to check` : 'Scan'}
        aria-current={active === 'scan' ? 'page' : undefined}
        className="relative mx-1 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_8px_22px_-6px_var(--primary)] transition-transform active:scale-90"
      >
        <ScanLine aria-hidden className="size-7" strokeWidth={1.9} />
        {readyCount > 0 && (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full border-2 border-card bg-bad px-1 text-caption font-semibold text-background">
            {readyCount}
          </span>
        )}
      </Link>
      <Tab to="/history" label="History" icon={List} on={active === 'history'} />
    </nav>
  );
}
