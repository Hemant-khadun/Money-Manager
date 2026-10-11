import { CircleAlert, TriangleAlert } from 'lucide-react';
import { formatMoney } from '../../lib/format';

// A thin meter whose track is a light step of its own colour. The brand colour by default; budget
// state is the only place the status colours appear, and always with an icon and words (never
// colour alone). The fill slides in from the left the first time it is shown.

type Tone = 'accent' | 'warn' | 'bad';

const TONE: Record<Tone, string> = { accent: 'text-primary', warn: 'text-warn', bad: 'text-bad' };

export function Meter({ value, tone = 'accent', label, delay = 0 }: { value: number; tone?: Tone; label: string; delay?: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={`mt-2 h-1.5 overflow-hidden rounded-full bg-current/15 ${TONE[tone]}`}
    >
      <div className="h-full origin-left animate-fill rounded-full bg-current" style={{ width: `${pct}%`, animationDelay: `${delay}ms` }} />
    </div>
  );
}

export interface BudgetState {
  tone: Tone;
  text: string;
  warning: boolean;
}

/** How a category stands against its budget, in words, for this month (and its projection). */
export function budgetState(spent: number, budget: number, projected: number | null): BudgetState {
  if (spent > budget) return { tone: 'bad', text: `Over by ${formatMoney(spent - budget)}`, warning: true };
  if (projected !== null && projected > budget) return { tone: 'warn', text: `${formatMoney(spent)} of ${formatMoney(budget)}, on pace to go over`, warning: true };
  return { tone: spent / budget >= 0.85 ? 'warn' : 'accent', text: `${formatMoney(spent)} of ${formatMoney(budget)}`, warning: false };
}

export function BudgetCaption({ state }: { state: BudgetState }) {
  const Icon = state.tone === 'bad' ? CircleAlert : TriangleAlert;
  return (
    <p className="mt-1.5 flex items-center gap-1 text-footnote text-muted-foreground">
      {state.warning && <Icon aria-hidden className={`size-3.5 ${state.tone === 'bad' ? 'text-bad' : 'text-warn'}`} strokeWidth={2.25} />}
      {state.text}
    </p>
  );
}
