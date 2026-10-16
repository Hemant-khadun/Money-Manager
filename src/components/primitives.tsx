import { Link } from '@tanstack/react-router';
import { ArrowDown, ArrowUp, ChevronRight, Search, type LucideIcon } from 'lucide-react';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';

// Money Manager's own building blocks (docs/PLAN.md §7b): cards on a quiet background, list rows with
// hairlines inset from the left, 44 px touch targets. Components pasted from shadcn/21st.dev go in
// components/ui/ instead, and share the same colours.

/** A titled card of rows. */
export function Group({
  title,
  action,
  footer,
  children,
  className = '',
}: {
  title?: ReactNode;
  /** Top right of the title: a link such as "See all". */
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mt-7 ${className}`}>
      {(title || action) && (
        <div className="mb-2 flex min-h-6 items-end justify-between gap-3 px-1">
          {title && <h2 className="text-headline">{title}</h2>}
          {action}
        </div>
      )}
      <div className="panel overflow-hidden">{children}</div>
      {footer && <p className="mt-2 px-1 text-footnote text-muted-foreground">{footer}</p>}
    </section>
  );
}

/** "See all ›" beside a group's title. */
export function GroupLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="-my-2 flex min-h-11 items-center gap-0.5 text-subhead font-medium text-primary">
      {children}
      <ChevronRight aria-hidden className="size-4" strokeWidth={2.25} />
    </Link>
  );
}

interface RowProps {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  /** Shown under the text, full width (a meter). */
  below?: ReactNode;
  chevron?: boolean;
}

function RowBody({ icon, title, subtitle, value, below, chevron, divider = true }: RowProps & { divider?: boolean }) {
  return (
    <div className={`flex min-h-14 items-center gap-3 py-3 pr-4 ${divider ? 'border-b border-border group-last/row:border-b-0' : ''}`}>
      {icon}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0 wrap-break-word text-body font-medium">{title}</div>
          {value !== undefined && <div className="shrink-0 text-right text-body font-medium tabular-nums">{value}</div>}
        </div>
        {/* Full width under the title and value, so it rarely needs a second line. */}
        {subtitle && <div className="mt-0.5 wrap-break-word text-subhead text-muted-foreground">{subtitle}</div>}
        {below}
      </div>
      {chevron && <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground/70" strokeWidth={2.25} />}
    </div>
  );
}

const rowClass = 'group/row block pl-4 transition-colors';
const pressable = 'hover:bg-muted/50 active:bg-muted';

/**
 * A list row; a link when `to` is given. `extra` goes under it, outside what tapping the row does,
 * for buttons of its own.
 */
export function Row(props: RowProps & { to?: string; params?: Record<string, string>; onClick?: () => void; pressed?: boolean; extra?: ReactNode }) {
  const { to, params, onClick, pressed, extra, ...body } = props;
  const divider = !extra;
  let row: ReactNode;
  if (to) {
    row = (
      <Link to={to} params={params} className={`${rowClass} ${pressable}`}>
        <RowBody chevron divider={divider} {...body} />
      </Link>
    );
  } else if (onClick) {
    row = (
      <button type="button" onClick={onClick} aria-pressed={pressed} className={`${rowClass} ${pressable} w-full text-left`}>
        <RowBody divider={divider} {...body} />
      </button>
    );
  } else {
    row = (
      <div className={rowClass}>
        <RowBody divider={divider} {...body} />
      </div>
    );
  }
  if (!extra) return row;
  return (
    <div className="group/row">
      {row}
      <div className="ml-4 border-b border-border pb-3 pr-4 group-last/row:border-b-0">{extra}</div>
    </div>
  );
}

/** A row holding a form control, label on the left. */
export function FieldRow({ label, children, htmlFor }: { label: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="group/row pl-4">
      <div className="flex min-h-13 items-center gap-3 border-b border-border pr-4 group-last/row:border-b-0">
        <label htmlFor={htmlFor} className="w-28 shrink-0 text-body text-muted-foreground">
          {label}
        </label>
        <div className="min-w-0 flex-1 text-right">{children}</div>
      </div>
    </div>
  );
}

export const inputClass =
  'w-full bg-transparent py-3 text-right text-body font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground focus-visible:text-primary';

type ButtonKind = 'primary' | 'secondary' | 'plain' | 'destructive';

export const buttonKinds: Record<ButtonKind, string> = {
  primary: 'bg-primary text-primary-foreground font-semibold shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_8px_20px_-8px_var(--primary)]',
  secondary: 'border border-border bg-card text-foreground font-semibold shadow-card',
  plain: 'text-primary font-medium',
  destructive: 'bg-bad/10 text-bad font-semibold',
};

export const buttonBase =
  'flex min-h-12 items-center justify-center gap-2 rounded-full px-5 text-body transition-[transform,opacity] duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40';

export function Button({ kind = 'primary', className = '', ...props }: ComponentProps<'button'> & { kind?: ButtonKind }) {
  return <button type="button" className={`${buttonBase} ${buttonKinds[kind]} ${className}`} {...props} />;
}

/** A round icon button for the top bar. */
export function IconButton({ label, icon: Icon, className = '', ...props }: ComponentProps<'button'> & { label: string; icon: LucideIcon }) {
  return (
    <button type="button" aria-label={label} className={`group grid size-11 place-items-center ${className}`} {...props}>
      <span className="grid size-9 place-items-center rounded-full border border-border bg-card text-foreground shadow-card transition-transform group-active:scale-90 group-disabled:opacity-35">
        <Icon aria-hidden className="size-4.5" strokeWidth={2} />
      </span>
    </button>
  );
}

/** Choose one of a few options; the highlight slides to the chosen one. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  const index = options.findIndex((o) => o.value === value);
  const n = options.length;
  return (
    <div role="radiogroup" aria-label={label} className="relative grid rounded-full bg-muted p-1" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
      {index >= 0 && (
        <span
          aria-hidden
          className="absolute inset-y-1 left-1 rounded-full bg-raised shadow-[0_1px_3px_rgb(0_0_0/0.12)] transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
          style={{ width: `calc((100% - 0.5rem) / ${n})`, transform: `translateX(${index * 100}%)` }}
        />
      )}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`relative min-h-9 rounded-full px-2 text-subhead transition-colors ${value === o.value ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** "↑ 6% more than September": the arrow carries the colour, the words carry the meaning. */
export function ChangeBadge({ up, children, className = '' }: { up: boolean | null; children: ReactNode; className?: string }) {
  const tone = up === null ? '' : up ? 'bg-warn/12 [--tone:var(--warn)]' : 'bg-good/12 [--tone:var(--good)]';
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-footnote font-medium ${up === null ? 'bg-muted text-muted-foreground' : `${tone} text-foreground`} ${className}`}>
      {up !== null && <Icon aria-hidden className="size-3.5 shrink-0 text-(--tone)" strokeWidth={2.5} />}
      {children}
    </span>
  );
}

export function EmptyState({ title, icon: Icon, children }: { title: string; icon?: LucideIcon; children?: ReactNode }) {
  return (
    <div className="panel relative mt-8 overflow-hidden px-6 py-10 text-center">
      <div aria-hidden className="dot-grid absolute inset-0" />
      {Icon && (
        <span className="relative mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-primary/12 text-primary shadow-[0_0_0_6px_color-mix(in_srgb,var(--primary)_6%,transparent)]">
          <Icon aria-hidden className="size-7" strokeWidth={1.75} />
        </span>
      )}
      <p className="relative text-headline">{title}</p>
      <div className="relative mt-2 text-subhead text-muted-foreground">{children}</div>
    </div>
  );
}

/** Staggers a list's entrance: each child rises in a little after the one before. */
export function rise(index: number): { className: string; style: CSSProperties } {
  return { className: 'animate-rise', style: { animationDelay: `${Math.min(index, 10) * 45}ms` } };
}

export function SearchField({ value, onChange, placeholder, label }: { value: string; onChange: (value: string) => void; placeholder: string; label: string }) {
  return (
    <label className="mt-3 flex min-h-11 items-center gap-2.5 rounded-full border border-border bg-card px-4 text-muted-foreground shadow-card focus-within:border-ring">
      <Search aria-hidden className="size-4.5 shrink-0" strokeWidth={2} />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="w-full bg-transparent py-2.5 text-body text-foreground outline-none placeholder:text-muted-foreground"
      />
    </label>
  );
}
