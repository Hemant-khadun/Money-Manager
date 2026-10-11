import { CircleCheck } from 'lucide-react';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

// Short confirmations with an optional action ("Receipt deleted · Undo"), instead of "Are you
// sure?" dialogs (docs/PLAN.md §7b).

interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

const ToastContext = createContext<(message: string, action?: Toast['action']) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback((message: string, action?: Toast['action']) => {
    clearTimeout(timer.current);
    const id = Date.now();
    setToast({ id, message, action });
    timer.current = setTimeout(() => setToast((t) => (t?.id === id ? null : t)), action ? 6000 : 3000);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 100px)' }}>
        {toast && (
          <div key={toast.id} className="pointer-events-auto flex animate-toast items-center gap-3 rounded-full border border-border bg-popover py-2.5 pl-3 pr-5 text-subhead font-medium text-popover-foreground shadow-float">
            <CircleCheck aria-hidden className="size-5 shrink-0 text-good" strokeWidth={2.25} />
            <span>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="-my-2 min-h-11 pl-1 font-semibold text-primary"
                onClick={() => {
                  toast.action!.run();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
