import type { Category } from './schema';

// The categories every new phone starts with (docs/PLAN.md §3). They cover any shop; names and
// budgets can be changed in Settings. Ids are stable: the categorising rules refer to them.

export const OTHER = 'other';
export const GROCERIES = 'groceries';
export const DINING = 'dining';

type Seed = Omit<Category, 'order' | 'monthlyBudget'>;

const SEEDS: Seed[] = [
  { id: GROCERIES, name: 'Groceries', parentId: null, icon: 'ShoppingBasket' },
  { id: 'groceries.fresh', name: 'Fruit & veg', parentId: GROCERIES, icon: 'Apple' },
  { id: 'groceries.meat', name: 'Meat & fish', parentId: GROCERIES, icon: 'Beef' },
  { id: 'groceries.dairy', name: 'Dairy & eggs', parentId: GROCERIES, icon: 'Milk' },
  { id: 'groceries.bakery', name: 'Bread & bakery', parentId: GROCERIES, icon: 'Croissant' },
  { id: 'groceries.drinks', name: 'Drinks', parentId: GROCERIES, icon: 'CupSoda' },
  { id: 'groceries.snacks', name: 'Snacks & sweets', parentId: GROCERIES, icon: 'Cookie' },
  { id: 'groceries.pantry', name: 'Pantry', parentId: GROCERIES, icon: 'Wheat' },
  { id: 'household', name: 'Household', parentId: null, icon: 'SprayCan' },
  { id: 'personal', name: 'Personal care', parentId: null, icon: 'Bath' },
  { id: 'health', name: 'Pharmacy & health', parentId: null, icon: 'Pill' },
  { id: 'transport', name: 'Fuel & transport', parentId: null, icon: 'Fuel' },
  { id: DINING, name: 'Restaurants & takeaway', parentId: null, icon: 'UtensilsCrossed' },
  { id: 'clothing', name: 'Clothing', parentId: null, icon: 'Shirt' },
  { id: 'electronics', name: 'Electronics', parentId: null, icon: 'Smartphone' },
  { id: 'home', name: 'Home & hardware', parentId: null, icon: 'Hammer' },
  { id: 'bills', name: 'Bills & services', parentId: null, icon: 'ReceiptText' },
  { id: 'leisure', name: 'Leisure', parentId: null, icon: 'Ticket' },
  { id: OTHER, name: 'Other', parentId: null, icon: 'Tag' },
];

export const DEFAULT_CATEGORIES: Category[] = SEEDS.map((c, order) => ({ ...c, order, monthlyBudget: null }));

/** The top-level category a category rolls up into on the dashboard. */
export function topLevelOf(id: string, categories: readonly Pick<Category, 'id' | 'parentId'>[]): string {
  const c = categories.find((x) => x.id === id);
  return c?.parentId ?? (c ? c.id : OTHER);
}
