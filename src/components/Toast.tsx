import { CircleCheck, TriangleAlert } from 'lucide-react';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { attempt, type Outcome } from '../lib/safely';

// Short confirmations with an optional action ("Receipt deleted · Undo"), instead of "Are you
// sure?" dialogs (docs/PLAN.md §7b). A problem (something couldn't be saved) has its own look, and
// stays longer.

type Look = 'done' | 'problem';

interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
  look: Look;
}

type Show = (message: string, action?: Toast['action'], look?: Look) => void;

const ToastContext = createContext<Show>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

/**
 * Runs a change to the person's data; when it fails, says so (`what` is what couldn't be done:
 * "Couldn't save this receipt") and gives { ok: false }.
 */
export function useSafely() {
  const toast = useToast();
  return useCallback(<T,>(what: string, run: () => Promise<T>): Promise<Outcome<T>> => attempt(what, run, (words) => toast(words, undefined, 'problem')), [toast]);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback<Show>((message, action, look = 'done') => {
    clearTimeout(timer.current);
    const id = Date.now();
    setToast({ id, message, action, look });
    timer.current = setTimeout(() => setToast((t) => (t?.id === id ? null : t)), look === 'problem' ? 8000 : action ? 6000 : 3000);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live={toast?.look === 'problem' ? 'assertive' : 'polite'} className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 100px)' }}>
        {toast && (
          <div
            key={toast.id}
            className={`pointer-events-auto flex animate-toast items-center gap-3 border bg-popover py-2.5 pl-3 pr-5 text-subhead font-medium text-popover-foreground shadow-float ${
              toast.look === 'problem' ? 'rounded-2xl border-bad/40' : 'rounded-full border-border'
            }`}
          >
            {toast.look === 'problem' ? (
              <TriangleAlert aria-hidden className="size-5 shrink-0 text-bad" strokeWidth={2.25} />
            ) : (
              <CircleCheck aria-hidden className="size-5 shrink-0 text-good" strokeWidth={2.25} />
            )}
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
