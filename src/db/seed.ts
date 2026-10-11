import { DEFAULT_CATEGORIES } from './categories';
import { db } from './schema';

/** First run: the default categories. (Kept apart from receipts.ts so start-up loads little.) */
export async function ensureSeeded(): Promise<void> {
  if ((await db.categories.count()) === 0) await db.categories.bulkAdd(DEFAULT_CATEGORIES);
}
