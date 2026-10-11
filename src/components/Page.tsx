import { useRouter } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconButton } from './primitives';

// A screen: a large title that hands over to a small centred title in a blurred bar once the page
// scrolls under it (docs/PLAN.md §7b). `glow` puts the soft colour wash behind the top of the screen.

export function Page({
  title,
  back,
  actions,
  glow = false,
  children,
}: {
  title: ReactNode;
  /** Name of the screen "Back" returns to; shows a back button. */
  back?: string;
  actions?: ReactNode;
  glow?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const sentinel = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative isolate">
      {glow && (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-104 overflow-hidden">
          <div className="aurora absolute inset-0" />
          <div className="dot-grid absolute inset-0 opacity-70" />
        </div>
      )}
      <div className="mx-auto max-w-2xl px-4 pb-36">
        <header
          className={`sticky top-0 z-20 -mx-4 px-2 pt-[env(safe-area-inset-top)] transition-[background-color,border-color] duration-300 ${scrolled ? 'glass border-b border-border' : 'border-b border-transparent'}`}
        >
          <div className="grid h-13 grid-cols-[1fr_auto_1fr] items-center">
            <div>{back && <IconButton label={`Back to ${back}`} icon={ChevronLeft} onClick={() => router.history.back()} />}</div>
            <div aria-hidden className={`truncate text-headline transition-[opacity,transform] duration-300 ${scrolled ? 'opacity-100' : 'translate-y-1 opacity-0'}`}>
              {title}
            </div>
            <div className="flex justify-end">{actions}</div>
          </div>
        </header>
        <h1 className="mt-1 text-large-title">{title}</h1>
        <div ref={sentinel} className="h-px" />
        {children}
      </div>
    </div>
  );
}
