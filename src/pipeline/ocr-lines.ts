import type { OcrLine } from '../parser/types';

/** One recognised text box, as ppu-paddle-ocr returns it (structural, so tests need no OCR). */
export interface OcrWord {
  text: string;
  confidence: number;
  box: { x: number; y: number; width: number; height: number };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function words(group: readonly OcrWord[]): OcrWord[] {
  return group.filter((w) => w.text.trim()).sort((a, b) => a.box.x - b.box.x);
}

/** The line's text, boxes joined left to right with a space (keeps name and price columns apart). */
export function groupText(group: readonly OcrWord[]): string {
  return words(group)
    .map((w) => w.text.trim())
    .join(' ');
}

/** Confidence weighted by text length, so a stray one-letter box doesn't sink a long line. */
export function groupConfidence(group: readonly OcrWord[]): number {
  const ws = words(group);
  const chars = ws.reduce((n, w) => n + w.text.length, 0);
  return chars ? ws.reduce((s, w) => s + w.confidence * w.text.length, 0) / chars : 0;
}

export function groupBounds(group: readonly OcrWord[]): OcrWord['box'] {
  const x = Math.min(...group.map((w) => w.box.x));
  const y = Math.min(...group.map((w) => w.box.y));
  const x1 = Math.max(...group.map((w) => w.box.x + w.box.width));
  const y1 = Math.max(...group.map((w) => w.box.y + w.box.height));
  return { x, y, width: x1 - x, height: y1 - y };
}

/** The detector pads each box by 40% of the writing's height above and below (ppu-paddle-ocr's default). */
const BOX_PADDING = 0.4;

/**
 * Groups separately read text boxes into printed lines. Two boxes share a line only when they are
 * level with each other and side by side; boxes stacked one above the other are always different
 * lines. (The library's own grouping only compares heights, and on creased paper, where boxes come
 * out taller than the line spacing, it glued neighbouring lines together.)
 */
export function groupIntoLines(boxes: readonly OcrWord[]): OcrWord[][] {
  const writing = (w: OcrWord) => w.box.height / (1 + 2 * BOX_PADDING);
  const centre = (w: OcrWord) => w.box.y + w.box.height / 2;
  const middle = (w: OcrWord) => w.box.x + w.box.width / 2;
  const sideBySide = (a: OcrWord, b: OcrWord) =>
    Math.min(a.box.x + a.box.width, b.box.x + b.box.width) - Math.max(a.box.x, b.box.x) <= Math.min(a.box.width, b.box.width) * 0.3;
  const verticalOverlap = (a: OcrWord, b: OcrWord) =>
    Math.min(a.box.y + a.box.height, b.box.y + b.box.height) - Math.max(a.box.y, b.box.y);

  const lines: OcrWord[][] = [];
  for (const word of [...boxes].filter((w) => w.text.trim()).sort((a, b) => centre(a) - centre(b))) {
    let best: OcrWord[] | null = null;
    let bestDistance = Infinity;
    for (const line of lines.slice(-6)) {
      if (!line.every((w) => sideBySide(w, word))) continue;
      // Compare with the nearest word along the line, so a slope on creased paper doesn't matter.
      const near = line.reduce((a, w) => (Math.abs(middle(w) - middle(word)) < Math.abs(middle(a) - middle(word)) ? w : a));
      // Padded boxes on one line overlap by most of their height; boxes of neighbouring lines by under half.
      if (verticalOverlap(near, word) < Math.min(writing(near), writing(word))) continue;
      const distance = Math.abs(centre(near) - centre(word));
      if (distance < bestDistance) {
        best = line;
        bestDistance = distance;
      }
    }
    if (best) best.push(word);
    else lines.push([word]);
  }
  const lineY = (l: OcrWord[]) => l.reduce((s, w) => s + centre(w), 0) / l.length;
  return lines.sort((a, b) => lineY(a) - lineY(b)).map((l) => l.sort((a, b) => a.box.x - b.box.x));
}

/** Line-grouped OCR output → one OcrLine per printed row, top to bottom. */
export function toOcrLines(groups: readonly OcrWord[][]): OcrLine[] {
  const lines: OcrLine[] = [];
  for (const group of groups) {
    const ws = words(group);
    if (!ws.length) continue;
    lines.push({
      text: groupText(ws),
      confidence: groupConfidence(ws),
      y: Math.min(...ws.map((w) => w.box.y)),
      height: median(ws.map((w) => w.box.height)),
    });
  }
  return lines.sort((a, b) => a.y - b.y);
}
