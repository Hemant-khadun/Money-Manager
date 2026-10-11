import type { Category } from '../db/schema';

/**
 * Choose a category: the phone's own picker (a wheel on iPhone), main categories with their
 * sub-categories under them.
 */
export function CategoryPicker({
  value,
  onChange,
  categories,
  label,
  className = '',
}: {
  value: string;
  onChange: (categoryId: string) => void;
  categories: readonly Category[];
  label: string;
  className?: string;
}) {
  const tops = categories.filter((c) => !c.parentId);
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={`max-w-full bg-transparent text-primary outline-none ${className}`}>
      {tops.map((top) => [
        <option key={top.id} value={top.id}>
          {top.name}
        </option>,
        ...categories
          .filter((c) => c.parentId === top.id)
          .map((sub) => (
            <option key={sub.id} value={sub.id}>
              {` ${sub.name}`}
            </option>
          )),
      ])}
    </select>
  );
}

export function categoryName(id: string, categories: readonly Category[] | undefined): string {
  return categories?.find((c) => c.id === id)?.name ?? 'Other';
}

export function categoryIcon(id: string, categories: readonly Category[] | undefined): string | undefined {
  const c = categories?.find((x) => x.id === id);
  return c?.icon;
}
