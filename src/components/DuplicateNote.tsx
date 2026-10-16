import { useNavigate } from '@tanstack/react-router';
import { Copy } from 'lucide-react';
import type { Category, Receipt } from '../db/schema';
import { formatDayMonth, formatMoney } from '../lib/format';
import { categoryName } from './CategoryPicker';

/**
 * "You already saved this receipt (Winners, 12 Oct, Rs 1,234.00)", with a way to see it: the same
 * photo chosen twice, or an expense added twice, would count twice.
 */
export function DuplicateNote({ receipt, categories, done = 'saved this receipt', onLeave }: { receipt: Receipt; categories: readonly Category[]; done?: string; onLeave: () => void }) {
  const navigate = useNavigate();
  const name = receipt.storeName || categoryName(receipt.categoryId, categories);
  return (
    <div role="status" className="mt-3 flex gap-2 rounded-2xl border border-warn/30 bg-warn/8 px-4 py-3 text-subhead">
      <Copy aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={2.25} />
      <p className="min-w-0 flex-1">
        You already {done} ({name}, {formatDayMonth(receipt.date)}, {formatMoney(receipt.total)}).{' '}
        <button
          type="button"
          className="font-semibold text-primary"
          onClick={() => {
            onLeave();
            void navigate({ to: '/receipt/$id', params: { id: String(receipt.id) } });
          }}
        >
          See it
        </button>
      </p>
    </div>
  );
}
