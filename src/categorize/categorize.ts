import { DINING, GROCERIES, OTHER } from '../db/categories';
import type { CategorySource, Product } from '../db/schema';
import { SAME_PRODUCT, normalizeText, similarity } from '../parser/text';
import { ITEM_RULES, SHOP_RULES } from './rules';

/**
 * How a product is recognised again: letters and digits only, with OCR's usual mix-ups inside
 * words repaired ("BEST F00D" and "BEST FOOD" are the same product).
 */
export function productKey(name: string): string {
  return normalizeText(name)
    .replace(/(?<=[A-Z])0|0(?=[A-Z])/g, 'O')
    .replace(/(?<=[A-Z])1(?=[A-Z])/g, 'I')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/** The category the word rules give an item name, or null. */
export function ruleCategory(name: string): string | null {
  const key = productKey(name);
  for (const [categoryId, pattern] of ITEM_RULES) if (pattern.test(key)) return categoryId;
  return null;
}

/** A product the person categorised before, matched by name (allowing for OCR spelling). */
export function learnedProduct(name: string, products: readonly Product[]): Product | null {
  const key = productKey(name);
  let best: Product | null = null;
  let bestScore = SAME_PRODUCT;
  for (const p of products) {
    if (p.key === key) return p;
    const score = similarity(p.key, key);
    if (score >= bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

export interface Categorised {
  categoryId: string;
  source: CategorySource;
}

/**
 * Where a receipt line's money goes: what the person taught it, else the word rules, else the
 * shop's category. At restaurants everything is the meal ("STEAK FRITES" is not groceries).
 */
export function categorizeItem(name: string, shopCategoryId: string, products: readonly Product[]): Categorised {
  const learned = learnedProduct(name, products);
  if (learned) return { categoryId: learned.categoryId, source: 'learned' };
  if (shopCategoryId === DINING) return { categoryId: DINING, source: 'shop' };
  const rule = ruleCategory(name);
  if (rule) return { categoryId: rule, source: 'rule' };
  return { categoryId: shopCategoryId, source: 'shop' };
}

/**
 * A new shop's category: from its name ("PHARMACIE…", "…SUPERMARKET", known chains), else from
 * what it sold: mostly groceries makes it a grocery shop, otherwise its biggest category.
 */
export function guessShopCategory(storeName: string | null, items: ReadonlyArray<{ name: string; lineTotal: number }>): string {
  if (storeName) {
    const key = productKey(storeName);
    for (const [categoryId, pattern] of SHOP_RULES) if (pattern.test(key)) return categoryId;
  }
  const byTop = new Map<string, number>();
  for (const item of items) {
    if (item.lineTotal <= 0) continue;
    const rule = ruleCategory(item.name);
    const top = rule ? rule.split('.')[0] : null;
    if (top) byTop.set(top, (byTop.get(top) ?? 0) + item.lineTotal);
  }
  const ranked = [...byTop].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return OTHER;
  const groceries = byTop.get(GROCERIES) ?? 0;
  const all = ranked.reduce((s, [, v]) => s + v, 0);
  return groceries * 2 >= all ? GROCERIES : ranked[0][0];
}
