import {
  Apple,
  Bath,
  Beef,
  Cookie,
  Croissant,
  CupSoda,
  Fuel,
  Hammer,
  Milk,
  Pill,
  ReceiptText,
  Shirt,
  ShoppingBasket,
  Smartphone,
  SprayCan,
  Tag,
  Ticket,
  UtensilsCrossed,
  Wheat,
  type LucideIcon,
} from 'lucide-react';
import type { CSSProperties } from 'react';

// Categories are told apart by name and icon. Each icon also has a hue for its tile, but only as
// decoration: no chart and no meaning depends on it (13 categories is more than colour can keep
// apart for everyone).

const ICONS: Record<string, [LucideIcon, string]> = {
  ShoppingBasket: [ShoppingBasket, 'green'],
  Apple: [Apple, 'green'],
  Beef: [Beef, 'rose'],
  Milk: [Milk, 'sky'],
  Croissant: [Croissant, 'amber'],
  CupSoda: [CupSoda, 'teal'],
  Cookie: [Cookie, 'orange'],
  Wheat: [Wheat, 'amber'],
  SprayCan: [SprayCan, 'sky'],
  Bath: [Bath, 'pink'],
  Pill: [Pill, 'rose'],
  Fuel: [Fuel, 'amber'],
  UtensilsCrossed: [UtensilsCrossed, 'orange'],
  Shirt: [Shirt, 'violet'],
  Smartphone: [Smartphone, 'blue'],
  Hammer: [Hammer, 'stone'],
  ReceiptText: [ReceiptText, 'teal'],
  Ticket: [Ticket, 'fuchsia'],
  Tag: [Tag, 'slate'],
};

const SIZES = {
  sm: ['size-8 rounded-[10px]', 'size-4'],
  md: ['size-10 rounded-xl', 'size-5'],
  lg: ['size-14 rounded-2xl', 'size-7'],
} as const;

export function CategoryIcon({ icon, size = 'md' }: { icon: string | undefined; size?: keyof typeof SIZES }) {
  const [Icon, hue] = (icon && ICONS[icon]) || ICONS.Tag;
  const [box, glyph] = SIZES[size];
  return (
    <span aria-hidden className={`tile grid shrink-0 place-items-center ${box}`} style={{ '--tile': `var(--hue-${hue})` } as CSSProperties}>
      <Icon className={glyph} strokeWidth={2} />
    </span>
  );
}
