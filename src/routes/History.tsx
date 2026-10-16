import { Check, Plus, ReceiptText, SearchX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useApp } from '../app/AppContext';
import { CategoryIcon } from '../components/CategoryIcon';
import { categoryIcon, categoryName } from '../components/CategoryPicker';
import { Page } from '../components/Page';
import { useSafely, useToast } from '../components/Toast';
import { EmptyState, Group, IconButton, Row, SearchField, buttonBase } from '../components/primitives';
import { deleteReceipts, restoreReceipts } from '../db/receipts';
import type { Receipt } from '../db/schema';
import { useAllReceipts, useCategories } from '../hooks/data';
import { formatDayMonth, formatMoney } from '../lib/format';
import { monthName } from '../kpi/monthly';

// Every receipt, newest first, a section per month with its total. Tap one to see it, change it
// or delete it; "Select" deletes several at once.

/** Where most of a receipt's money went (its split is biggest first). */
const mainCategory = (r: Receipt) => r.split[0]?.categoryId ?? r.categoryId;

const receiptsWord = (n: number) => `${n} receipt${n === 1 ? '' : 's'}`;

/** The round tick in front of a receipt while choosing. */
function Tick({ on }: { on: boolean }) {
  return on ? (
    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
      <Check aria-hidden className="size-4" strokeWidth={3} />
    </span>
  ) : (
    <span className="size-6 shrink-0 rounded-full border-2 border-muted-foreground/40" />
  );
}

export function History() {
  const { setAddExpenseOpen } = useApp();
  const receipts = useAllReceipts();
  const categories = useCategories();
  const toast = useToast();
  const safely = useSafely();
  const [query, setQuery] = useState('');
  /** While choosing receipts to delete, the ones chosen; null otherwise. */
  const [chosen, setChosen] = useState<Set<number> | null>(null);

  const months = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = (receipts ?? []).filter(
      (r) => !q || r.storeName.toLowerCase().includes(q) || categoryName(r.categoryId, categories).toLowerCase().includes(q) || r.note.toLowerCase().includes(q),
    );
    const byMonth = new Map<string, Receipt[]>();
    for (const r of shown) byMonth.set(r.month, [...(byMonth.get(r.month) ?? []), r]);
    return [...byMonth];
  }, [receipts, categories, query]);

  const shownIds = months.flatMap(([, list]) => list.map((r) => r.id!));
  // Only receipts on screen are deleted, even if the search changed after they were chosen.
  const picked = chosen ? shownIds.filter((id) => chosen.has(id)) : [];
  const allPicked = shownIds.length > 0 && picked.length === shownIds.length;

  function toggle(id: number) {
    setChosen((c) => {
      const next = new Set(c);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function deletePicked() {
    const deleted = await safely(`Couldn't delete ${picked.length === 1 ? 'this receipt' : 'these receipts'}`, () => deleteReceipts(picked));
    if (!deleted.ok) return;
    setChosen(null);
    if (deleted.value.length) {
      toast(`${receiptsWord(deleted.value.length)} deleted`, { label: 'Undo', run: () => void safely("Couldn't bring them back", () => restoreReceipts(deleted.value)) });
    }
  }

  const actions = chosen ? (
    <button type="button" className="min-h-11 px-2 text-body font-semibold text-primary" onClick={() => setChosen(null)}>
      Done
    </button>
  ) : (
    <>
      {!!receipts?.length && (
        <button type="button" className="min-h-11 px-2 text-body font-medium text-primary" onClick={() => setChosen(new Set())}>
          Select
        </button>
      )}
      <IconButton label="Add an expense" icon={Plus} onClick={() => setAddExpenseOpen(true)} />
    </>
  );

  return (
    <Page title="History" actions={actions}>
      <SearchField value={query} onChange={setQuery} placeholder="Search shops and categories" label="Search receipts" />

      {receipts && receipts.length > 0 &&
        (chosen ? (
          <div className="mt-2 flex min-h-11 items-center justify-between gap-3 px-1">
            <p className="text-subhead text-muted-foreground" role="status">
              {picked.length ? `${receiptsWord(picked.length)} chosen` : 'Tap the receipts you want to delete'}
            </p>
            {shownIds.length > 0 && (
              <button type="button" className="min-h-11 shrink-0 text-subhead font-medium text-primary" onClick={() => setChosen(new Set(allPicked ? [] : shownIds))}>
                {allPicked ? 'Choose none' : 'Choose all'}
              </button>
            )}
          </div>
        ) : (
          <p className="mt-3 px-1 text-footnote text-muted-foreground">Tap a receipt to see it, change it or delete it.</p>
        ))}

      {receipts && receipts.length === 0 && <EmptyState title="No receipts yet" icon={ReceiptText}>Scanned receipts and expenses you add are listed here.</EmptyState>}
      {receipts && receipts.length > 0 && months.length === 0 && <EmptyState title={`Nothing matches "${query}"`} icon={SearchX} />}

      {months.map(([month, list]) => (
        <Group
          key={month}
          title={monthName(month)}
          action={<span className="text-subhead font-medium text-muted-foreground tabular-nums">{formatMoney(list.reduce((s, r) => s + r.total, 0))}</span>}
        >
          {list.map((r) => {
            const icon = <CategoryIcon icon={categoryIcon(mainCategory(r), categories)} />;
            const title = r.storeName || categoryName(mainCategory(r), categories);
            const subtitle = `${formatDayMonth(r.date)} · ${r.split.length > 1 ? `${r.split.length} categories` : categoryName(mainCategory(r), categories)}`;
            if (chosen) {
              const on = chosen.has(r.id!);
              return (
                <Row
                  key={r.id}
                  onClick={() => toggle(r.id!)}
                  pressed={on}
                  icon={
                    <span className="flex items-center gap-3">
                      <Tick on={on} />
                      {icon}
                    </span>
                  }
                  title={title}
                  subtitle={subtitle}
                  value={formatMoney(r.total)}
                />
              );
            }
            return <Row key={r.id} to="/receipt/$id" params={{ id: String(r.id) }} icon={icon} title={title} subtitle={subtitle} value={formatMoney(r.total)} />;
          })}
        </Group>
      ))}

      {chosen && (
        <>
          {/* Room to scroll the last receipt out from under the button. */}
          <div aria-hidden className="h-16" />
          <div className="fixed inset-x-0 z-30 mx-auto max-w-2xl px-4" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 96px)' }}>
            <button type="button" disabled={!picked.length} onClick={deletePicked} className={`${buttonBase} w-full bg-bad font-semibold text-background shadow-float`}>
              {picked.length ? `Delete ${receiptsWord(picked.length)}` : 'Delete'}
            </button>
          </div>
        </>
      )}
    </Page>
  );
}
