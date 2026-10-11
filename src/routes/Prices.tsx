import { SearchX, Tags } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Page } from '../components/Page';
import { PriceRow } from '../components/PriceRow';
import { EmptyState, Group, SearchField, Segmented } from '../components/primitives';
import { usePrices } from '../hooks/data';
import { filterChanges, priceChanges, type PriceChange, type PriceFilter } from '../kpi/prices';
import { normalizeText } from '../parser/text';

// What things cost the last time you bought them, against the time before (docs/PLAN.md §5):
// what costs more, what costs less, or everything. Searching looks through everything.

const FILTERS: ReadonlyArray<{ value: PriceFilter; label: string }> = [
  { value: 'more', label: 'Cost more' },
  { value: 'less', label: 'Cost less' },
  { value: 'all', label: 'All' },
];

const things = (n: number) => (n === 1 ? '1 thing' : `${n} things`);

function heading(filter: PriceFilter, n: number): string {
  if (filter === 'more') return `${things(n)} ${n === 1 ? 'costs' : 'cost'} more than last time`;
  if (filter === 'less') return `${things(n)} ${n === 1 ? 'costs' : 'cost'} less than last time`;
  return `${things(n)} you've bought`;
}

/** Every word of the search is in a name it was bought under, in any order. */
function matches(change: PriceChange, words: string[]): boolean {
  return change.product.purchases.some((p) => {
    const name = normalizeText(p.name);
    return words.every((w) => name.includes(w));
  });
}

export function Prices() {
  const data = usePrices();
  const [filter, setFilter] = useState<PriceFilter>('more');
  const [query, setQuery] = useState('');

  const changes = useMemo(() => (data ? priceChanges(data.products) : []), [data]);
  const searching = query.trim() !== '';
  const shown = useMemo(() => {
    const words = normalizeText(query).split(' ').filter(Boolean);
    return words.length ? filterChanges(changes, 'all').filter((c) => matches(c, words)) : filterChanges(changes, filter);
  }, [changes, filter, query]);
  const compared = changes.some((c) => c.previous);

  if (data && data.itemized === 0) {
    return (
      <Page title="Prices" back="Overview">
        <EmptyState title="No prices yet" icon={Tags}>Scan a receipt whose items can be read, and what you paid for each thing shows up here.</EmptyState>
      </Page>
    );
  }

  return (
    <Page title="Prices" back="Overview">
      <p className="text-subhead text-muted-foreground">What you paid the last time you bought something, against the time before.</p>

      <SearchField value={query} onChange={setQuery} placeholder="Search things you've bought" label="Search things you've bought" />

      {!searching && (
        <div className="mt-3">
          <Segmented label="Show" value={filter} options={FILTERS} onChange={setFilter} />
        </div>
      )}

      {data && searching && shown.length === 0 && <EmptyState title={`Nothing matches "${query.trim()}"`} icon={SearchX} />}
      {data && !searching && shown.length === 0 && filter !== 'all' && (
        <EmptyState title={compared ? `Nothing costs ${filter} than last time` : 'Nothing to compare yet'} icon={Tags}>
          {!compared && "Once you buy the same thing again, you'll see here whether it cost more or less."}
        </EmptyState>
      )}

      {shown.length > 0 && (
        <Group
          title={searching ? `Matching "${query.trim()}"` : heading(filter, shown.length)}
          footer={data && `Based on ${data.itemized} of ${data.receipts} receipts: the ones whose items could be read. Prices are for one, or for a kg, before discounts.`}
        >
          {shown.map((c) => (
            <PriceRow key={c.product.keys[0]} change={c} />
          ))}
        </Group>
      )}
    </Page>
  );
}
