import { RefreshCw } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { describeError } from '../lib/describe-error';
import { debugLog } from '../lib/debug-log';

// The offline helper (service worker, docs/PLAN.md §14 step 4): keeps the app and the receipt
// reader on the phone so scanning works without internet, and fetches new versions in the
// background. When one is ready, a bar offers to reload; it waits while a receipt is being read,
// and stays until tapped. Receipts not saved yet are kept on the phone, so reloading loses nothing.
// Loaded after the app has started, keeping its code out of the first screen.

const CHECK_EVERY_MS = 60 * 60_000;

export default function UpdateBar({ reading }: { reading: boolean }) {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      debugLog('app', 'Offline helper started');
      // An app left open for days still hears about new versions.
      if (registration) setInterval(() => void registration.update().catch(() => {}), CHECK_EVERY_MS);
    },
    onRegisterError(err) {
      debugLog('app', `Offline helper couldn't start: ${describeError(err)}`);
    },
  });

  if (!needRefresh || reading) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4" style={{ top: 'calc(env(safe-area-inset-top) + 8px)' }}>
      <div role="status" className="pointer-events-auto flex animate-toast items-center gap-3 rounded-full border border-border bg-popover py-1.5 pl-4 pr-1.5 text-subhead font-medium text-popover-foreground shadow-float">
        <RefreshCw aria-hidden className="size-4.5 shrink-0 text-primary" strokeWidth={2.25} />
        A new version is ready
        <button type="button" className="min-h-11 rounded-full bg-primary px-4 font-semibold text-primary-foreground" onClick={() => void updateServiceWorker(true)}>
          Reload
        </button>
      </div>
    </div>
  );
}
