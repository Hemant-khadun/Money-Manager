import { groupBounds, groupConfidence, groupText, type OcrWord } from './ocr-lines';

// How the OCR reads a receipt: zoom so the writing is the size it reads best, split long
// receipts into overlapping parts read at full detail, then re-read unclear lines up close.

/** Height of a detected text line (writing plus the detector's padding) that PP-OCR reads best. */
export const TARGET_LINE_HEIGHT = 36;
/** Longest side of one part. The detector is configured to work at full detail up to this size. */
export const PART_MAX = 1280;
/** Lines read with less confidence than this get a closer look. */
export const UNCLEAR_BELOW = 0.85;
/** At most this many closer looks per receipt, to keep reading time bounded. */
export const MAX_CLOSER_LOOKS = 12;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Zoom factor that brings the writing to TARGET_LINE_HEIGHT: above 1 for small writing,
 * below 1 for big camera photos (faster, no loss). Never so wide that one part exceeds `partMax`.
 */
export function zoomFor(lineHeight: number, areaWidth: number, partMax = PART_MAX): number {
  const zoom = clamp(TARGET_LINE_HEIGHT / Math.max(lineHeight, 1), 0.5, 3);
  return Math.min(zoom, partMax / Math.max(areaWidth, 1));
}

export interface Part {
  top: number;
  bottom: number;
  /** Lines whose centre falls in [keepFrom, keepTo) are taken from this part; the overlap is read twice but kept once. */
  keepFrom: number;
  keepTo: number;
}

/** Splits a tall image into overlapping parts no taller than `maxPart`. */
export function planParts(height: number, lineHeight: number, maxPart = PART_MAX): Part[] {
  if (height <= maxPart) return [{ top: 0, bottom: height, keepFrom: 0, keepTo: height }];
  // Two lines' worth of overlap on each side, so every line is whole in the part that keeps it.
  const overlap = Math.min(Math.ceil(lineHeight * 4), maxPart / 2);
  const step = maxPart - overlap;
  const count = Math.ceil((height - overlap) / step);
  const parts: Part[] = [];
  for (let i = 0; i < count; i++) {
    const top = i * step;
    parts.push({
      top,
      bottom: Math.min(height, top + maxPart),
      keepFrom: i === 0 ? 0 : top + overlap / 2,
      keepTo: i === count - 1 ? height : top + step + overlap / 2,
    });
  }
  return parts;
}

export function centreY(group: readonly OcrWord[]): number {
  const b = groupBounds(group);
  return b.y + b.height / 2;
}

/** Indices of the lines worth a closer look, least sure first. */
export function unclearLines(groups: readonly OcrWord[][], max = MAX_CLOSER_LOOKS): number[] {
  return groups
    .map((g, i) => ({ i, confidence: groupConfidence(g) }))
    .filter((g) => g.confidence < UNCLEAR_BELOW)
    .sort((a, b) => a.confidence - b.confidence)
    .slice(0, max)
    .map((g) => g.i);
}

/** The line read nearest a given height (the one a closer-look crop is centred on). */
export function closestGroup(groups: readonly OcrWord[][], y: number): OcrWord[] | null {
  let best: OcrWord[] | null = null;
  for (const g of groups) {
    if (!groupText(g)) continue;
    if (!best || Math.abs(centreY(g) - y) < Math.abs(centreY(best) - y)) best = g;
  }
  return best;
}

/**
 * A closer look replaces a line when it recovered clearly more text with good confidence, or is
 * clearly surer without losing much of the text.
 */
export function isClearer(before: readonly OcrWord[], after: readonly OcrWord[]): boolean {
  const [was, now] = [groupText(before).length, groupText(after).length];
  if (now >= was * 1.5 && groupConfidence(after) >= 0.8) return true;
  return groupConfidence(after) >= groupConfidence(before) + 0.03 && now >= was * 0.6;
}
