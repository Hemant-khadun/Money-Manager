import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { receiptsAddingUp } from '../kpi/adds-up';
import { productPrices } from '../kpi/prices';

// Apart from hooks/data: price matching loads with the screens that show prices, not at start-up.

/**
 * Everything bought on receipts whose items add up, by product, with what it cost each time;
 * plus how many receipts that is out of all of them.
 */
export function usePrices() {
  return useLiveQuery(async () => {
    const [receipts, items] = await Promise.all([db.receipts.toArray(), db.items.toArray()]);
    return { products: productPrices(items, receipts), itemized: receiptsAddingUp(items, receipts).size, receipts: receipts.length };
  }, []);
}
