import type { CSSProperties } from 'react';

// A shop's initials in a tinted circle, standing in for a logo. The hue comes from the name, so
// a shop keeps its colour; it is decoration only, the name is always beside it.

const HUES = ['violet', 'sky', 'pink', 'teal', 'amber', 'blue', 'orange', 'green', 'fuchsia', 'rose'];

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(' ').filter(Boolean);
  if (words.length === 0) return '?';
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

export function ShopAvatar({ name }: { name: string }) {
  let hash = 0;
  for (const ch of name.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const hue = HUES[Math.abs(hash) % HUES.length];
  return (
    <span aria-hidden className="tile grid size-10 shrink-0 place-items-center rounded-full text-footnote font-bold tracking-tight" style={{ '--tile': `var(--hue-${hue})` } as CSSProperties}>
      {initials(name)}
    </span>
  );
}
