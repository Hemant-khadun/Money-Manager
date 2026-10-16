import Dexie, { type EntityTable } from 'dexie';
import type { PaymentMethod, StoreHints } from '../parser/types';

// Everything Money Manager knows lives here, in the phone's own storage (IndexedDB). Nothing is sent
// anywhere. Money is always whole cents. Schema changes only ever add (db.version(n + 1)):
// people's data can't be fixed by hand.

export interface Category {
  /** Stable slug: 'groceries', 'groceries.meat', 'household'… */
  id: string;
  name: string;
  /** Sub-categories roll up into their parent on the dashboard. */
  parentId: string | null;
  /** Icon name, see components/CategoryIcon. */
  icon: string;
  /** cents per month; null = no budget */
  monthlyBudget: number | null;
  order: number;
}

export interface Store {
  id?: number;
  /** As the person confirmed it. */
  name: string;
  /** Other spellings seen on this shop's receipts (OCR variants), for matching. */
  aliases: string[];
  /** VAT / BRN number: the surest way to recognise the shop again. */
  taxId: string | null;
  /** Where this shop's spending goes unless its items say otherwise. */
  defaultCategoryId: string;
  /** Learned from confirmed receipts: total label, date order. */
  hints: StoreHints;
}

/** How an item's category was decided. Items the person set are never changed automatically. */
export type CategorySource = 'you' | 'learned' | 'rule' | 'shop';

export interface Receipt {
  id?: number;
  /** YYYY-MM-DD */
  date: string;
  /** YYYY-MM, for monthly lookups. */
  month: string;
  storeId: number | null;
  /** Shown in lists; for an expense without a receipt, what it was. */
  storeName: string;
  /** The receipt's main category (where unrecognised items go). */
  categoryId: string;
  /** cents */
  total: number;
  paymentMethod: PaymentMethod | null;
  vatTotal: number | null;
  discountTotal: number | null;
  /** Its items are kept (they added up to the total). */
  itemized: boolean;
  source: 'scan' | 'manual';
  note: string;
  /** The total shared out over categories, in cents, always adding up to `total` exactly. */
  split: Array<{ categoryId: string; amount: number }>;
  createdAt: number;
}

export interface LineItem {
  id?: number;
  receiptId: number;
  /** Copied from the receipt, for monthly lookups. */
  month: string;
  name: string;
  /** Normalised name: how the same product is recognised again. */
  productKey: string;
  categoryId: string;
  categorySource: CategorySource;
  qty: number;
  /** cents */
  unitPrice: number;
  /** cents; negative for discounts */
  lineTotal: number;
  kind: 'item' | 'discount';
  vatCode: string | null;
}

/** A product the person put in a category themselves; used for it from then on. */
export interface Product {
  key: string;
  name: string;
  categoryId: string;
}

/** A small picture of the receipt (the full photo is never kept). */
export interface Thumb {
  receiptId: number;
  image: Blob;
}

export interface Setting {
  key: string;
  value: unknown;
}

export const db = new Dexie('spent') as Dexie & {
  categories: EntityTable<Category, 'id'>;
  stores: EntityTable<Store, 'id'>;
  receipts: EntityTable<Receipt, 'id'>;
  items: EntityTable<LineItem, 'id'>;
  products: EntityTable<Product, 'key'>;
  thumbs: EntityTable<Thumb, 'receiptId'>;
  settings: EntityTable<Setting, 'key'>;
};

db.version(1).stores({
  categories: 'id, parentId, order',
  stores: '++id, name, taxId',
  receipts: '++id, month, date, storeId, categoryId, createdAt',
  items: '++id, receiptId, month, productKey, categoryId',
  products: 'key',
  thumbs: 'receiptId',
  settings: 'key',
});
