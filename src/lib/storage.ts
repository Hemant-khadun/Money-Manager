import { getSetting, setSetting } from '../db/backup';

/**
 * Asks the browser to keep Spent's data (iPhones can otherwise clear a website's storage after
 * a week without visits). Asked once, when the first receipt is saved.
 */
export async function askToKeepData(): Promise<void> {
  if (await getSetting<boolean>('persistAsked')) return;
  await setSetting('persistAsked', true);
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Not supported: the backup reminder is the safety net.
  }
}

export async function isDataKept(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    return false;
  }
}
