import { createContext, useContext, useState, type ReactNode } from 'react';
import { useReceiptReader, type ReceiptReader } from '../hooks/useReceiptReader';
import { monthOf } from '../kpi/monthly';

// State shared by the screens: the month the dashboard shows, the receipts being read (so scanning
// carries on while you look at other tabs), and the "add an expense" sheet.

interface App {
  month: string;
  setMonth: (month: string) => void;
  reader: ReceiptReader;
  addExpenseOpen: boolean;
  setAddExpenseOpen: (open: boolean) => void;
}

const AppContext = createContext<App | null>(null);

export function useApp(): App {
  const app = useContext(AppContext);
  if (!app) throw new Error('useApp outside AppProvider');
  return app;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [month, setMonth] = useState(() => monthOf(new Date()));
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const reader = useReceiptReader({ keep: true });
  return <AppContext.Provider value={{ month, setMonth, reader, addExpenseOpen, setAddExpenseOpen }}>{children}</AppContext.Provider>;
}
