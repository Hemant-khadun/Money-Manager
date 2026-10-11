import { Plus, ReceiptText, SearchX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useApp } from '../app/AppContext';
import { CategoryIcon } from '../components/CategoryIcon';
import { categoryIcon, categoryName } from '../components/CategoryPicker';
import { Page } from '../components/Page';
import { EmptyState, Group, IconButton, Row, SearchField } from '../components/primitives';
import type { Receipt } from '../db/schema';
import { useAllReceipts, useCategories } from '../hooks/data';
import { formatDayMonth, formatMoney } from '../lib/format';
import { monthName } from '../kpi/monthly';

// Every receipt, newest first, a section per month with its total.

/** Where most of a receipt's money went (its split is biggest first). */
const mainCategory = (r: Receipt) => r.split[0]?.categoryId ?? r.categoryId;

export function History() {
  const { setAddExpenseOpen } = useApp();
  const receipts = useAllReceipts();
  const categories = useCategories();
  const [query, setQuery] = useState('');

  const months = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = (receipts ?? []).filter(
      (r) => !q || r.storeName.toLowerCase().includes(q) || categoryName(r.categoryId, categories).toLowerCase().includes(q) || r.note.toLowerCase().includes(q),
    );
    const byMonth = new Map<string, Receipt[]>();
    for (const r of shown) byMonth.set(r.month, [...(byMonth.get(r.month) ?? []), r]);
    return [...byMonth];
  }, [receipts, categories, query]);

  const add = <IconButton label="Add an expense" icon={Plus} onClick={() => setAddExpenseOpen(true)} />;

  return (
    <Page title="History" actions={add}>
      <SearchField value={query} onChange={setQuery} placeholder="Search shops and categories" label="Search receipts" />

      {receipts && receipts.length === 0 && <EmptyState title="No receipts yet" icon={ReceiptText}>Scanned receipts and expenses you add are listed here.</EmptyState>}
      {receipts && receipts.length > 0 && months.length === 0 && <EmptyState title={`Nothing matches "${query}"`} icon={SearchX} />}

      {months.map(([month, list]) => (
        <Group
          key={month}
          title={monthName(month)}
          action={<span className="text-subhead font-medium text-muted-foreground tabular-nums">{formatMoney(list.reduce((s, r) => s + r.total, 0))}</span>}
        >
          {list.map((r) => (
            <Row
              key={r.id}
              to="/receipt/$id"
              params={{ id: String(r.id) }}
              icon={<CategoryIcon icon={categoryIcon(mainCategory(r), categories)} />}
              title={r.storeName || categoryName(mainCategory(r), categories)}
              subtitle={`${formatDayMonth(r.date)} · ${r.split.length > 1 ? `${r.split.length} categories` : categoryName(mainCategory(r), categories)}`}
              value={formatMoney(r.total)}
            />
          ))}
        </Group>
      ))}
    </Page>
  );
}
