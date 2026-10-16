import { useLiveQuery } from 'dexie-react-hooks';
import { findDuplicate, type ReceiptDraft } from '../db/receipts';

// Apart from hooks/data: saving code (db/receipts) loads with the screens that save, not at start-up.

/** A saved receipt that looks like this one; null when there is none. */
export function useDuplicate({ storeId, storeName, date, total }: Pick<ReceiptDraft, 'storeId' | 'storeName' | 'date' | 'total'>) {
  return useLiveQuery(() => findDuplicate({ storeId, storeName, date, total }), [storeId, storeName, date, total]);
}
