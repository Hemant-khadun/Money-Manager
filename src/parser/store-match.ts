import { STORE_NOISE } from './rules/keywords';
import { normalizeText, similarity } from './text';

/** The parts of a saved store that matching needs. */
export interface KnownStore {
  name: string;
  /** Other spellings seen on this store's receipts (OCR variants, branch names). */
  aliases: readonly string[];
  taxId?: string | null;
}

export interface StoreMatch<S> {
  store: S;
  /** 0..1 */
  score: number;
  by: 'taxId' | 'name';
}

/** Below this, the user is asked "New store: is this right?". */
export const STORE_MATCH_THRESHOLD = 0.8;

/** "Super U Flacq Ltd." → "SUPER U FLACQ": the form store names are compared in. */
export function storeKey(name: string): string {
  return normalizeText(name)
    .replace(STORE_NOISE, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function taxKey(id: string): string {
  return id.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function nameScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  // A chain name inside a branch name ("SUPER U" / "SUPER U FLACQ") is the same shop.
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 5 && long.startsWith(`${short} `)) return 0.85;
  return similarity(a.replace(/ /g, ''), b.replace(/ /g, ''));
}

/** Finds the saved store a parsed receipt belongs to: tax ID first, then fuzzy name. */
export function matchStore<S extends KnownStore>(
  guess: { name: string | null; taxId: string | null },
  stores: readonly S[],
): StoreMatch<S> | null {
  if (guess.taxId) {
    const id = taxKey(guess.taxId);
    const byTax = stores.find((s) => s.taxId && taxKey(s.taxId) === id);
    if (byTax) return { store: byTax, score: 1, by: 'taxId' };
  }
  if (!guess.name) return null;

  const key = storeKey(guess.name);
  let best: StoreMatch<S> | null = null;
  for (const store of stores) {
    for (const candidate of [store.name, ...store.aliases]) {
      const score = nameScore(key, storeKey(candidate));
      if (!best || score > best.score) best = { store, score, by: 'name' };
    }
  }
  return best && best.score >= STORE_MATCH_THRESHOLD ? best : null;
}
