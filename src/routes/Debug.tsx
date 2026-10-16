import { Camera, ClipboardCopy, Images, Share2, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Page } from '../components/Page';
import { Group, Row, buttonBase, buttonKinds } from '../components/primitives';
import { useToast } from '../components/Toast';
import { useReceiptReader, type ReadScan } from '../hooks/useReceiptReader';
import { clearDebugLog, debugLog, debugLogEntries, subscribeDebugLog, type LogEntry } from '../lib/debug-log';
import { describeError } from '../lib/describe-error';
import { formatMoney } from '../lib/format';
import { careLevel, resetCareLevel } from '../pipeline/care';
import type { OcrEngineInfo } from '../pipeline/ocr-client';

// The problem report (#/debug): what this phone can do, photos read here with every detail, and
// the log of what the app and the reader did (lib/debug-log.ts), as text to copy and send.

type Facts = Array<[label: string, value: string]>;

/** What this phone and browser can do, as far as reading receipts goes. */
async function phoneFacts(): Promise<Facts> {
  const nav = navigator as Navigator & { deviceMemory?: number; standalone?: boolean };
  let gpu = 'no';
  if ('gpu' in navigator && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      const info = adapter?.info;
      gpu = adapter ? `yes, ${[info?.vendor, info?.architecture, info?.device, info?.description].filter(Boolean).join(' ') || 'no details'}` : 'yes, but no graphics chip offered';
    } catch (err) {
      gpu = `failed: ${describeError(err)}`;
    }
  }
  let storage = 'unknown';
  try {
    const [persisted, estimate] = await Promise.all([navigator.storage.persisted(), navigator.storage.estimate()]);
    const mb = (bytes = 0) => `${Math.round(bytes / 1e6)} MB`;
    storage = `${persisted ? 'kept safe' : 'may be cleared'}, ${mb(estimate.usage)} used of ${mb(estimate.quota)}`;
  } catch (err) {
    storage = `unknown: ${describeError(err)}`;
  }
  let offline = 'not available';
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    offline = navigator.serviceWorker?.controller ? 'running' : registration ? 'installed, starts next time' : 'not running';
  } catch (err) {
    offline = `unknown: ${describeError(err)}`;
  }
  return [
    ['Version', __APP_VERSION__],
    ['Offline helper', offline],
    ['Browser', navigator.userAgent],
    ['Screen', `${screen.width}×${screen.height} at ${devicePixelRatio}×, window ${innerWidth}×${innerHeight}`],
    ['Memory', nav.deviceMemory ? `about ${nav.deviceMemory} GB` : 'not told'],
    ['Processor cores', String(navigator.hardwareConcurrency ?? 'not told')],
    ['Graphics chip (WebGPU)', gpu],
    ['Background canvas', typeof OffscreenCanvas === 'function' ? 'yes' : 'no'],
    ['On the home screen', matchMedia('(display-mode: standalone)').matches || nav.standalone ? 'yes' : 'no'],
    ['Online', navigator.onLine ? 'yes' : 'no'],
    ['Storage', storage],
  ];
}

function readerState(engine: OcrEngineInfo | null, engineError: string | null): string {
  if (engineError) return `couldn't start: ${engineError}`;
  if (!engine) return 'starting';
  return `ready on the ${engine.backend === 'webgpu' ? 'graphics chip' : 'processor'}, started in ${(engine.loadMs / 1000).toFixed(1)} s`;
}

/** One photo tried on this page, in full: how it was read, what was found and every line of text. */
function photoDetails(scan: ReadScan, n: number): string[] {
  const out = [`Photo ${n}: ${scan.status}${scan.error ? `, ${scan.error}` : ''}`];
  for (const photo of scan.photos) out.push(`  file: ${(photo.file.size / 1e6).toFixed(1)} MB, ${photo.file.type || 'unknown type'}`);
  for (const reading of Object.values(scan.readings ?? {})) {
    const r = reading.report;
    out.push(
      `  read at ${r.photoWidth}×${r.photoHeight} in ${(reading.ms / 1000).toFixed(1)} s on the ${scan.backend === 'webgpu' ? 'graphics chip' : 'processor'}: ` +
        `writing ${r.lineHeight} px tall, tilt ${r.tilt}°, zoom ${r.zoom}, ${r.parts} parts, ${r.closerLooks} closer looks (${r.improved} clearer), ` +
        `${r.unclearLeft} lines still unclear${r.leftOut ? ', part of another receipt left out' : ''}`,
    );
  }
  const p = scan.parsed;
  if (p) {
    out.push(
      `  found: shop ${p.storeName ?? '(none)'}, date ${p.date ?? '(none)'}, total ${p.total === null ? '(none)' : formatMoney(p.total)}, ` +
        `${p.items.length} items${p.items.length ? (p.itemsAddUp ? ' adding up' : ' not adding up') : ''}; warnings: ${p.warnings.join(', ') || 'none'}`,
    );
  }
  if (scan.lines) out.push(`  text read (${scan.lines.length} lines):`, ...scan.lines.map((l) => `    ${l.text}   [${Math.round(l.confidence * 100)}%]`));
  return out;
}

const logLine = (e: LogEntry) => `${e.at.slice(5, 23).replace('T', ' ')}  ${e.source === 'reader' ? '  reader' : 'app'}  ${e.message}`;

function buildReport(facts: Facts, reader: string, scans: ReadScan[], log: readonly LogEntry[]): string {
  return [
    'Money Manager problem report',
    `Made ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`,
    '',
    ...facts.map(([label, value]) => `${label}: ${value}`),
    `Receipt reader: ${reader}`,
    `Reading mode: level ${careLevel()} of 2 (higher is gentler on memory)`,
    ...[...scans].reverse().flatMap((scan, i) => ['', ...photoDetails(scan, i + 1)]),
    '',
    `Log, oldest first (${log.length} entries):`,
    ...log.map(logLine),
  ].join('\n');
}

function status(scan: ReadScan): string {
  if (scan.status === 'queued') return 'Waiting';
  if (scan.status === 'reading') return `${scan.step ?? 'Getting started'}…`;
  if (scan.status === 'error') return scan.problem ?? scan.error ?? 'Failed';
  const p = scan.parsed;
  return `${scan.lines?.length ?? 0} lines read · total ${p?.total == null ? 'not found' : formatMoney(p.total)}`;
}

export function Debug() {
  const reader = useReceiptReader();
  const { engine, engineError, warmUp, scans } = reader;
  const log = useSyncExternalStore(subscribeDebugLog, debugLogEntries);
  const [facts, setFacts] = useState<Facts>([]);
  const box = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();

  useEffect(warmUp, [warmUp]);
  useEffect(() => {
    void phoneFacts().then(setFacts);
  }, []);

  const report = buildReport(facts, readerState(engine, engineError), scans, log);

  async function copy() {
    try {
      await navigator.clipboard.writeText(report);
      toast('Report copied');
    } catch {
      // Older phones: copy from the selected text instead.
      box.current?.select();
      toast(document.execCommand('copy') ? 'Report copied' : 'Select the report below and copy it');
    }
  }

  async function share() {
    try {
      await navigator.share({ title: 'Money Manager problem report', text: report });
    } catch {
      // Closed without sharing.
    }
  }

  const picker = (capture: boolean) => (
    <input
      type="file"
      accept="image/*"
      capture={capture ? 'environment' : undefined}
      className="sr-only"
      onClick={() => debugLog('app', `Opened the ${capture ? 'camera' : 'photo picker'}`)}
      onChange={(e) => {
        reader.add(e.target.files);
        e.target.value = '';
      }}
    />
  );

  return (
    <Page title="Problem report" back="Settings">
      <p className="mt-2 text-subhead text-muted-foreground">
        Scanning not working? Try a photo here, then copy the report and send it. It shows what this phone can do and what Money Manager did, step by step. It
        includes the text read from your photo, so look through it first. Nothing leaves your phone unless you send it.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-2.5">
        <label className={`${buttonBase} ${buttonKinds.primary} cursor-pointer`}>
          <Camera aria-hidden className="size-5" strokeWidth={2} />
          Take a photo
          {picker(true)}
        </label>
        <label className={`${buttonBase} ${buttonKinds.secondary} cursor-pointer`}>
          <Images aria-hidden className="size-5" strokeWidth={2} />
          Pick a photo
          {picker(false)}
        </label>
      </div>

      <Group title="Receipt reader">
        <Row
          title={engineError ? "Couldn't start" : engine ? 'Ready' : 'Starting…'}
          subtitle={`${readerState(engine, engineError)}. Reading mode ${careLevel()} of 2.`}
        />
        {scans.map((scan, i) => (
          <Row key={scan.id} title={`Photo ${scans.length - i}`} subtitle={status(scan)} />
        ))}
      </Group>

      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <button type="button" className={`${buttonBase} ${buttonKinds.primary}`} onClick={() => void copy()}>
          <ClipboardCopy aria-hidden className="size-5" strokeWidth={2} />
          Copy report
        </button>
        {'share' in navigator ? (
          <button type="button" className={`${buttonBase} ${buttonKinds.secondary}`} onClick={() => void share()}>
            <Share2 aria-hidden className="size-5" strokeWidth={2} />
            Share
          </button>
        ) : (
          <span />
        )}
      </div>

      <Group title="Report" footer={`${log.length} steps logged. The log keeps the last 300, even if the page reloads.`}>
        <textarea
          ref={box}
          readOnly
          value={report}
          aria-label="Problem report"
          className="block h-72 w-full resize-none bg-transparent p-4 font-mono text-[11px] leading-snug text-foreground outline-none"
        />
      </Group>
      <button
        type="button"
        className={`${buttonBase} ${buttonKinds.plain} mx-auto mt-2`}
        onClick={() => {
          clearDebugLog();
          toast('Log cleared');
        }}
      >
        <Trash2 aria-hidden className="size-4" strokeWidth={2} />
        Clear the log
      </button>
      <button
        type="button"
        className={`${buttonBase} ${buttonKinds.plain} mx-auto`}
        onClick={() => {
          resetCareLevel();
          toast('Reading mode reset. Reload the page to use it');
        }}
      >
        Reset the reading mode
      </button>
    </Page>
  );
}
