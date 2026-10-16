import { CloudUpload } from 'lucide-react';
import { useBackUp, useLastBackup } from '../hooks/useBackUp';
import { Button } from './primitives';

/** On Overview when the last backup is over 30 days old, or there was never one (docs/PLAN.md §10). */
export default function BackupReminder() {
  const last = useLastBackup();
  const backUp = useBackUp();
  if (last === undefined) return null;
  const days = last ? Math.floor((Date.now() - Date.parse(last)) / 86_400_000) : 0;
  return (
    <section className="panel mt-5 flex gap-3 p-4" aria-label="Back up your receipts">
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
        <CloudUpload className="size-5" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-subhead font-semibold">Time to back up</p>
        <p className="mt-0.5 text-footnote text-muted-foreground">
          {last ? `Your last backup was ${days} days ago.` : "You haven't backed up yet."} Your receipts are only on this phone: a backup keeps them safe if
          it's lost or replaced.
        </p>
        <Button className="mt-3 w-fit" onClick={() => void backUp()}>
          Back up now
        </Button>
      </div>
    </section>
  );
}
