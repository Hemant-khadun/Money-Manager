import { useEffect, useState } from 'react';
import { formatMoney } from '../lib/format';

// The screen's one big figure (docs/PLAN.md §7b): "Rs" and the cents quieter than the rupees.
// When the amount changes (another month, a new receipt), each digit rolls to its new value like
// an odometer. CSS transitions only; with reduced motion the digits simply change.

const ROW = 1.1; // em: the height of one digit

function Digit({ digit, delay }: { digit: number; delay: number }) {
  // Starts at 0 and rolls up to the digit on first show.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(digit));
    return () => cancelAnimationFrame(frame);
  }, [digit]);
  return (
    <span className="relative inline-block overflow-hidden align-bottom" style={{ height: `${ROW}em` }}>
      {/* Takes the width of the digit it lands on. */}
      <span className="invisible block" style={{ lineHeight: `${ROW}em` }}>
        {digit}
      </span>
      <span
        className="absolute inset-x-0 top-0 flex flex-col items-center transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ transform: `translateY(-${shown * ROW}em)`, transitionDelay: `${delay}ms` }}
      >
        {Array.from({ length: 10 }, (_, n) => (
          <span key={n} style={{ height: `${ROW}em`, lineHeight: `${ROW}em` }}>
            {n}
          </span>
        ))}
      </span>
    </span>
  );
}

/** Rolling digits for a formatted number ("18,420"). Keyed from the right, so units stay units. */
export function Odometer({ value }: { value: string }) {
  const chars = [...value];
  return (
    <span aria-hidden className="inline-flex">
      {chars.map((ch, i) => {
        const place = chars.length - i;
        return /\d/.test(ch) ? (
          <Digit key={`d${place}`} digit={Number(ch)} delay={i * 35} />
        ) : (
          <span key={`s${place}`} className="inline-block" style={{ lineHeight: `${ROW}em` }}>
            {ch}
          </span>
        );
      })}
    </span>
  );
}

/** "Rs 18,420.50" as the hero figure. */
export function MoneyHero({ cents, className = '' }: { cents: number; className?: string }) {
  const text = formatMoney(cents);
  const [, sign, whole, fraction] = /^(−?)Rs ([\d,]+)(\.\d+)?$/.exec(text) ?? ['', '', text, ''];
  return (
    <p className={`text-hero ${className}`}>
      <span className="sr-only">{text}</span>
      <span aria-hidden className="mr-1.5 align-[0.6em] text-[0.42em] font-semibold tracking-normal text-muted-foreground">
        Rs
      </span>
      {sign && <span aria-hidden>{sign}</span>}
      <Odometer value={whole} />
      {fraction && (
        <span aria-hidden className="text-[0.55em] text-muted-foreground">
          {fraction}
        </span>
      )}
    </p>
  );
}
