import type { Line, StoreGuess } from './essentials';
import { lastAmount } from './money';
import { META, TAX_ID } from './rules/keywords';
import { KNOWN_SHOPS, type KnownShop } from './rules/shops';
import { editDistance } from './text';

// Recognises the big supermarket chains (rules/shops.ts) on a receipt even when the name is
// misread. Characters the reader often mistakes for each other count as the same ("W1NNERS" is
// WINNERS, "SUPER V" is SUPER U), and longer names may be off by a letter or two ("INTERMAR").

/** Look-alikes, each mapped to one letter. Applied to both sides of a comparison, so it never changes a match between real names. */
const LOOK_ALIKES: Record<string, string> = { '0': 'O', '1': 'I', L: 'I', '2': 'Z', '3': 'E', '4': 'A', '5': 'S', '6': 'G', '7': 'T', '8': 'B', V: 'U' };

/** "W1NNERS, GRAND-BAIE" → ["WINNERS", "GRAND", "BAIE"] (with look-alikes mapped). */
function looseWords(norm: string): string[] {
  return norm
    .replace(/[|!]/g, 'I')
    .replace(/\$/g, 'S')
    .replace(/[0-8LV]/g, (c) => LOOK_ALIKES[c])
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

const NAMES = KNOWN_SHOPS.flatMap((shop) =>
  shop.spellings.map((spelling) => ({
    shop,
    key: looseWords(spelling).join(''),
    words: spelling.split(' ').length,
    printed: new RegExp(`\\b${spelling.replace(/ /g, '\\s*')}\\b`),
  })),
);

/** Letters a name may be off by. None for short names: too many ordinary words are one letter away ("SUPER" / "SUPER U"). */
const slack = (length: number) => (length >= 9 ? 2 : length >= 7 ? 1 : 0);

/** The known shop a line names, and whether it is printed exactly as the shop spells it. */
function shopOn(line: Line): { shop: KnownShop; exact: boolean } | null {
  const words = looseWords(line.norm);
  for (const { shop, key, words: count, printed } of NAMES) {
    if (printed.test(line.norm)) return { shop, exact: true };
    const allowed = slack(key.length);
    for (let i = 0; i < words.length; i++) {
      // The reader may split a name ("WIN NERS") or run it into the next word ("WINNERSGRANDBAIE").
      for (let size = 1; size <= count + 1 && i + size <= words.length; size++) {
        const joined = words.slice(i, i + size).join('');
        if (joined === key || (allowed > 0 && (editDistance(joined, key) <= allowed || joined.startsWith(key)))) return { shop, exact: false };
      }
    }
  }
  return null;
}

/** The name line usually sits in these top lines. */
const HEADER_LINES = 8;

/** "Flacq Shopping Mall", "Partenaire Intermarché": where the shop is, or a partner, not the shop itself. */
const NOT_THE_SHOP = /,|\b(?:MALL|COMPLEX|CENTRE|CENTER|BUILDING|GALLER\w*|PROMENADE|ARCADE|PLAZA|LEVEL|FLOOR|NEAR|OPPOSITE|PARTENAIRE|PARTNER)\b/;

/** Web and e-mail addresses, thank-you lines: they name the shop, anywhere on the receipt. */
const SIGN_OFF = /\b(?:WWW|HTTPS?|THANK|THANKS|MERCI|WELCOME|BIENVENUE|SHOPPING\s+(?:AT|WITH))\b|@|\.(?:MU|COM)\b/;

/**
 * The receipt's shop when it is one of the known chains, even when its name was misread or is
 * only in a logo. Null when the name line already reads right ("Super U Flacq" is kept, branch and
 * all) or no known chain is named.
 */
export function knownShopName(lines: Line[], guess: StoreGuess): StoreGuess | null {
  const named = guess.lineIndex !== null ? lines[guess.lineIndex] : undefined;
  if (named) {
    const found = shopOn(named);
    if (found) return found.exact ? null : { name: found.shop.name, lineIndex: named.index };
  }
  const header = lines
    .slice(0, HEADER_LINES)
    .filter((l) => l !== named && !META.test(l.norm) && !TAX_ID.test(l.norm) && !NOT_THE_SHOP.test(l.norm) && !lastAmount(l.norm));
  const signOff = lines.filter((l) => l !== named && SIGN_OFF.test(l.norm));
  for (const line of [...header, ...signOff]) {
    const found = shopOn(line);
    if (found) return { name: found.shop.name, lineIndex: line.index };
  }
  return null;
}
