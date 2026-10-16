// Big supermarket chains in Mauritius, as their names print on receipts. A receipt from one of
// them gets the chain's name even when its name line is misread ("W1NNERS", "CARREF0UR") or only
// printed in a logo (see known-shops.ts).

export interface KnownShop {
  /** How Money Manager writes the name. */
  name: string;
  /** How it prints on receipts, upper case. Spaces may be missing on the receipt ("DREAM PRICE" / "DREAMPRICE"). */
  spellings: readonly string[];
  /** Other lines only this chain prints (upper case, no accents): they name it when the logo can't be read. */
  taglines?: readonly string[];
}

export const KNOWN_SHOPS: readonly KnownShop[] = [
  // Its logo is white on black and often unreadable; every receipt says "Partenaire Intermarché" under it.
  { name: 'Intermart', spellings: ['INTERMART'], taglines: ['PARTENAIRE INTERMARCHE'] },
  { name: 'Winners', spellings: ['WINNERS'] },
  { name: 'Carrefour', spellings: ['CARREFOUR'] },
  { name: 'Super U', spellings: ['SUPER U'] },
  { name: 'Jumbo', spellings: ['JUMBO'] },
  { name: 'Dreamprice', spellings: ['DREAM PRICE'] },
  { name: 'London Way', spellings: ['LONDON WAY'] },
  { name: 'Spar', spellings: ['SPAR'] },
  { name: 'Monoprix', spellings: ['MONOPRIX'] },
  { name: 'King Savers', spellings: ['KING SAVERS'] },
  { name: 'Shoprite', spellings: ['SHOPRITE'] },
  { name: '8 Til Late', spellings: ['8 TIL LATE'] },
];
