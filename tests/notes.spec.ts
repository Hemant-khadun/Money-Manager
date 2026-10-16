import { describe, expect, it } from 'vitest';
import type { ReadScan } from '../src/hooks/useReceiptReader';
import type { ParsedReceipt } from '../src/parser/types';
import { sameAsAnother } from '../src/scan/notes';

const scan = (id: number, parsed: Partial<ParsedReceipt> | null, status: ReadScan['status'] = 'done'): ReadScan => ({
  id,
  photos: [],
  status,
  addedAt: id,
  parsed: parsed ? ({ storeName: 'Winners', date: '2026-10-12', total: 123400, ...parsed } as ParsedReceipt) : undefined,
});

describe('sameAsAnother', () => {
  it('marks receipts in the list with the same shop, date and total', () => {
    const twins = sameAsAnother([scan(1, {}), scan(2, { storeName: 'WINNERS LTD' }), scan(3, { total: 123500 }), scan(4, { date: '2026-10-11' })]);
    expect([...twins]).toEqual([1, 2]);
  });

  it('leaves out receipts still being read, or missing the shop, date or total', () => {
    expect(sameAsAnother([scan(1, {}), scan(2, {}, 'reading')]).size).toBe(0);
    expect(sameAsAnother([scan(1, { storeName: null }), scan(2, { storeName: null })]).size).toBe(0);
    expect(sameAsAnother([scan(1, { total: null }), scan(2, { total: null })]).size).toBe(0);
  });
});
