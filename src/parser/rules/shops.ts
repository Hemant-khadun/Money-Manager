// Big supermarket chains in Mauritius, as their names print on receipts. A receipt from one of
// them gets the chain's name even when its name line is misread ("W1NNERS", "CARREF0UR") or only
// printed in a logo (see known-shops.ts).

export interface KnownShop {
  /** How Money Manager writes the name. */
  name: string;
  /** How it prints on receipts, upper case. Spaces may be missing on the receipt ("DREAM PRICE" / "DREAMPRICE"). */
  spellings: readonly string[];
}

export const KNOWN_SHOPS: readonly KnownShop[] = [
  { name: 'Intermart', spellings: ['INTERMART'] },
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
