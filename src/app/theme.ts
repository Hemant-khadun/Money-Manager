// System / Light / Dark (docs/PLAN.md §7b). A per-phone preference, so browser storage is enough;
// if it's unavailable the app simply follows the system.

export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'spent-theme';

export function savedTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Private browsing: the choice lasts until the page closes.
  }
}
