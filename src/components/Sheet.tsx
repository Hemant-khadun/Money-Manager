import type { ReactNode } from 'react';
import { Drawer } from 'vaul';

// A bottom sheet for editing (docs/PLAN.md §7b): drag down to close, the page scales back behind it.

export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  /** Stays visible under the scrolling content (the main button). */
  footer?: ReactNode;
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px]" />
        <Drawer.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[94dvh] max-w-2xl flex-col rounded-t-3xl border-t border-border bg-background shadow-float outline-none"
        >
          <div aria-hidden className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-track" />
          <Drawer.Title className="px-4 pb-1 pt-3 text-center text-headline">{title}</Drawer.Title>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">{children}</div>
          {footer && <div className="shrink-0 border-t border-border px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3">{footer}</div>}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
