import { parseReceipt, type ParseOptions } from './parse';
import { matchStore, type KnownStore } from './store-match';
import type { OcrLine, ParsedReceipt, StoreHints } from './types';

/**
 * Reads a receipt's lines. When the shop is one seen before (by VAT number or name) and saving its
 * receipts taught something about them (which line holds the total, the order of the date), they
 * are read again with that.
 */
export function parseForShop(lines: OcrLine[], stores: ReadonlyArray<KnownStore & { hints: StoreHints }>, options: Omit<ParseOptions, 'hints'> = {}): ParsedReceipt {
  const first = parseReceipt(lines, options);
  const hints = matchStore({ name: first.storeName, taxId: first.taxId }, stores)?.store.hints;
  if (!hints?.totalLabel && !hints?.dateOrder) return first;
  return parseReceipt(lines, { ...options, hints });
}
