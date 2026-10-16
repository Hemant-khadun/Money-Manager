import { useEffect, useState } from 'react';
import { applyTheme, savedTheme, type ThemeChoice } from '../app/theme';
import { CategoryIcon } from '../components/CategoryIcon';
import { Page } from '../components/Page';
import { useSafely, useToast } from '../components/Toast';
import { Group, Row, Segmented } from '../components/primitives';
import { BackupError, readBackup, receiptsOnPhone, restoreBackup, restoreQuestion, undoRestore, type Backup } from '../db/backup';
import { setBudget } from '../db/receipts';
import type { Category } from '../db/schema';
import { useCategories } from '../hooks/data';
import { useBackUp, useLastBackup } from '../hooks/useBackUp';
import { centsToInput, formatDate } from '../lib/format';
import { isDataKept } from '../lib/storage';
import { parseMoneyInput } from '../parser/money';

// Budgets, appearance, and the person's data: backup and restore (the phone is the only copy).

const THEMES: ReadonlyArray<{ value: ThemeChoice; label: string }> = [
  { value: 'system', label: 'Automatic' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function BudgetRow({ category }: { category: Category }) {
  const safely = useSafely();
  const [text, setText] = useState(category.monthlyBudget ? centsToInput(category.monthlyBudget) : '');
  const save = () => {
    const cents = text.trim() ? parseMoneyInput(text) : null;
    if (cents === category.monthlyBudget) return;
    void safely("Couldn't save this budget", () => setBudget(category.id, cents && cents > 0 ? cents : null));
  };
  return (
    <div className="group/row flex items-center gap-3 pl-4">
      <CategoryIcon icon={category.icon} size="sm" />
      <div className="flex min-h-13 flex-1 items-center gap-3 border-b border-border pr-4 group-last/row:border-b-0">
        <label htmlFor={`budget-${category.id}`} className="flex-1 text-body font-medium">
          {category.name}
        </label>
        <input
          id={`budget-${category.id}`}
          inputMode="decimal"
          placeholder="No budget"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          className="w-28 bg-transparent py-3 text-right text-body font-medium tabular-nums outline-none placeholder:font-normal placeholder:text-muted-foreground focus-visible:text-primary"
        />
      </div>
    </div>
  );
}

export function Settings() {
  const categories = useCategories() ?? [];
  const lastBackup = useLastBackup();
  const backUp = useBackUp();
  const toast = useToast();
  const safely = useSafely();
  const [theme, setTheme] = useState<ThemeChoice>(savedTheme);
  const [kept, setKept] = useState<boolean | null>(null);

  useEffect(() => {
    void isDataKept().then(setKept);
  }, []);

  /** Says what's in the file and on the phone before replacing; what was on the phone can be brought back. */
  async function restore(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    let backup: Backup;
    try {
      backup = readBackup(JSON.parse(await file.text()));
    } catch (err) {
      toast(err instanceof BackupError ? err.message : "That file couldn't be read as a backup.", undefined, 'problem');
      return;
    }
    if (!window.confirm(restoreQuestion(backup, await receiptsOnPhone()))) return;
    const restored = await safely("Couldn't restore the backup. Nothing on this phone was changed", () => restoreBackup(backup));
    if (!restored.ok) return;
    const { receipts, before } = restored.value;
    toast(`Restored ${receipts} receipt${receipts === 1 ? '' : 's'}`, { label: 'Undo', run: () => void safely("Couldn't undo the restore", () => undoRestore(before)) });
  }

  return (
    <Page title="Settings" back="Back">
      <Group title="Monthly budgets" footer="Set a budget and the dashboard shows how much of it you've used, and warns you before you go over.">
        {categories
          .filter((c) => !c.parentId)
          .map((c) => (
            <BudgetRow key={c.id} category={c} />
          ))}
      </Group>

      <Group title="Appearance">
        <div className="p-1.5">
          <Segmented
            label="Appearance"
            value={theme}
            options={THEMES}
            onChange={(choice) => {
              setTheme(choice);
              applyTheme(choice);
            }}
          />
        </div>
      </Group>

      <Group
        title="Your data"
        footer="Your receipts are kept only on this phone and never sent anywhere. Back up now and then (to Drive, email or files), so you can restore them on a new phone."
      >
        <Row onClick={() => void backUp()} title={<span className="text-primary">Back up now</span>} subtitle={lastBackup ? `Last backup ${formatDate(lastBackup.slice(0, 10))}` : 'Not backed up yet'} />
        <label className="group/row block cursor-pointer pl-4 hover:bg-muted/50 active:bg-muted">
          <span className="flex min-h-14 items-center border-b border-border py-3 pr-4 text-body font-medium text-primary group-last/row:border-b-0">Restore from a backup…</span>
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(e) => {
              void restore(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        {kept !== null && (
          <Row
            title="Kept safe by the browser"
            value={<span className="text-muted-foreground">{kept ? 'Yes' : 'Not yet'}</span>}
            subtitle={kept ? undefined : 'Add Money Manager to your home screen so the phone keeps its data.'}
          />
        )}
      </Group>

      <Group title="Help">
        <Row to="/debug" title="Problem report" subtitle="Scanning not working? Try a photo and send the report" />
      </Group>
    </Page>
  );
}
