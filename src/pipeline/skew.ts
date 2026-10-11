import type { Rect } from './receipt-region';

// How tilted is the receipt? Two kinds of evidence vote on the angle, over many pairs of boxes:
//  - words on the same printed line (a name and its price) sit at the tilt;
//  - lines that start at the paper's left margin (or end at the right, like prices) stack along a
//    margin that leans by the same angle, even when every line is one single box.
// Pairs that don't share a line or a margin scatter; the real angle collects the votes.

const MAX_TILT = 20;
const BIN = 0.25;

interface Vote {
  angle: number;
  weight: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * Tilt of the text in degrees (positive: lines run down to the right), or null when there isn't
 * enough evidence. Applying rotate(tilt) (see affine.ts) makes the lines level.
 */
export function estimateTilt(boxes: readonly Rect[]): number | null {
  if (boxes.length < 3) return null;
  const h = median(boxes.map((b) => b.height));
  const centres = boxes.map((b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2, h: b.height }));
  const maxSlope = Math.tan((MAX_TILT * Math.PI) / 180);
  const sameLine: Vote[] = [];
  const margins: Vote[] = [];

  for (let i = 0; i < centres.length; i++) {
    for (let j = i + 1; j < centres.length; j++) {
      const a = centres[i];
      const b = centres[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      // Side by side, similar height, and not too steep to be on one line.
      if (Math.abs(dx) >= h * 2 && Math.abs(dy) <= Math.abs(dx) * maxSlope && Math.max(a.h, b.h) <= Math.min(a.h, b.h) * 1.8) {
        // Far-apart pairs measure the angle more precisely.
        sameLine.push({ angle: (Math.atan(dy / dx) * 180) / Math.PI, weight: Math.min(Math.abs(dx) / h, 20) });
      }
      // One above the other: their left edges (and right edges) follow the paper's margins, which
      // lean back by the tilt (lines running down to the right make the margin run down to the left).
      if (Math.abs(dy) >= h * 3) {
        const [p, q] = [boxes[i], boxes[j]];
        for (const run of [q.x - p.x, q.x + q.width - (p.x + p.width)]) {
          if (Math.abs(run) <= Math.abs(dy) * maxSlope) {
            margins.push({ angle: (-Math.atan(run / dy) * 180) / Math.PI, weight: Math.min(Math.abs(dy) / h, 20) });
          }
        }
      }
    }
  }
  // Same-line pairs are the sharper evidence; margins bend on curled paper, so they only fill in
  // when lines were read as single boxes.
  const votes = sameLine.length >= 5 ? sameLine : [...sameLine, ...margins];
  if (votes.length < 3) return null;
  const bins = new Float64Array(Math.round((2 * MAX_TILT) / BIN) + 1);
  for (const v of votes) bins[Math.round((v.angle + MAX_TILT) / BIN)] += v.weight;

  // Peak of the lightly smoothed histogram, refined by the votes near it.
  let peak = 0;
  let best = -1;
  for (let i = 1; i < bins.length - 1; i++) {
    const s = bins[i - 1] + 2 * bins[i] + bins[i + 1];
    if (s > best) {
      best = s;
      peak = i;
    }
  }
  const centre = peak * BIN - MAX_TILT;
  let sum = 0;
  let total = 0;
  for (const v of votes) {
    if (Math.abs(v.angle - centre) <= BIN * 2) {
      sum += v.angle * v.weight;
      total += v.weight;
    }
  }
  return total ? sum / total : centre;
}

/** A picture as one brightness byte per pixel (0 black … 255 white). */
export interface Gray {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Ink positions: pixels clearly darker than their surroundings. */
export interface Ink {
  x: Float32Array;
  y: Float32Array;
  count: number;
}

/** RGBA pixels (as canvas getImageData returns them) → brightness. */
export function toGray(width: number, height: number, rgba: ArrayLike<number>): Gray {
  const data = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i++, p += 4) data[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
  return { width, height, data };
}

/**
 * Finds the ink: pixels much darker than the area around them (`radius` pixels each way).
 * Printing on paper counts; a dark desk or shadow doesn't, because it is dark all around.
 */
export function findInk(gray: Gray, radius: number): Ink {
  const { width: w, height: h, data } = gray;
  // Summed-area table, so each pixel's neighbourhood average costs four lookups.
  const sums = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += data[y * w + x];
      sums[(y + 1) * (w + 1) + x + 1] = sums[y * (w + 1) + x + 1] + row;
    }
  }
  const xs: number[] = [];
  const ys: number[] = [];
  const r = Math.max(1, Math.round(radius));
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const total = sums[y1 * (w + 1) + x1] - sums[y0 * (w + 1) + x1] - sums[y1 * (w + 1) + x0] + sums[y0 * (w + 1) + x0];
      const mean = total / ((x1 - x0) * (y1 - y0));
      const v = data[y * w + x];
      if (v < mean - Math.max(18, mean * 0.12)) {
        xs.push(x);
        ys.push(y);
      }
    }
  }
  return { x: Float32Array.from(xs), y: Float32Array.from(ys), count: xs.length };
}

/** The ink in a band of rows only (for one part of a long receipt). At most `limit` points, evenly spread. */
export function inkBand(ink: Ink, from: number, to: number, limit = 120_000): Ink {
  let n = 0;
  for (let i = 0; i < ink.count; i++) if (ink.y[i] >= from && ink.y[i] < to) n++;
  const step = Math.max(1, n / limit);
  const x = new Float32Array(Math.min(n, limit));
  const y = new Float32Array(x.length);
  let k = 0;
  let next = 0;
  for (let i = 0, seen = 0; i < ink.count && k < x.length; i++) {
    if (ink.y[i] < from || ink.y[i] >= to) continue;
    if (seen++ >= next) {
      x[k] = ink.x[i];
      y[k++] = ink.y[i];
      next += step;
    }
  }
  return { x, y, count: k };
}

/** How sharply the ink piles into rows when looked at with lines running at `degrees`. */
function rowSharpness(ink: Ink, degrees: number, rows: Int32Array, offset: number): number {
  const t = (degrees * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  rows.fill(0);
  for (let i = 0; i < ink.count; i++) rows[Math.round(ink.y[i] * cos - ink.x[i] * sin) + offset]++;
  let score = 0;
  for (let r = 0; r < rows.length; r++) score += rows[r] * rows[r];
  return score;
}

/** Only the ink inside the given boxes (where the detector found writing): no paper edges or other objects. */
export function inkInside(ink: Ink, boxes: ReadonlyArray<{ x: number; y: number; width: number; height: number }>, width: number, height: number): Ink {
  const mask = new Uint8Array(width * height);
  for (const b of boxes) {
    const x0 = Math.max(0, Math.floor(b.x));
    const x1 = Math.min(width, Math.ceil(b.x + b.width));
    const y0 = Math.max(0, Math.floor(b.y));
    const y1 = Math.min(height, Math.ceil(b.y + b.height));
    for (let y = y0; y < y1; y++) mask.fill(1, y * width + x0, y * width + x1);
  }
  const keep: number[] = [];
  for (let i = 0; i < ink.count; i++) if (mask[ink.y[i] * width + ink.x[i]]) keep.push(i);
  return { x: Float32Array.from(keep, (i) => ink.x[i]), y: Float32Array.from(keep, (i) => ink.y[i]), count: keep.length };
}

/**
 * Tilt from the picture itself (positive: lines run down to the right). Turned to the right angle,
 * lines of print stack the ink into narrow rows with clean gaps between them; at any other angle
 * the rows smear. Works however the lines were boxed. Returns null when there is too little print
 * to tell, or no angle clearly stands out (not lines of print).
 */
export function tiltFromInk(ink: Ink, range = 15): number | null {
  if (ink.count < 300) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < ink.count; i++) {
    minX = Math.min(minX, ink.x[i]);
    maxX = Math.max(maxX, ink.x[i]);
    minY = Math.min(minY, ink.y[i]);
    maxY = Math.max(maxY, ink.y[i]);
  }
  // Every projected row fits: |y·cos − x·sin| ≤ |y| + |x|.
  const span = Math.max(Math.abs(minX), Math.abs(maxX)) + Math.max(Math.abs(minY), Math.abs(maxY));
  const rows = new Int32Array(Math.ceil(span) * 2 + 3);
  const offset = Math.ceil(span) + 1;
  const score = (a: number) => rowSharpness(ink, a, rows, offset);

  const coarse: Array<[number, number]> = [];
  for (let a = -range; a <= range + 1e-9; a += 0.5) coarse.push([a, score(a)]);
  const [rough, roughScore] = coarse.reduce((m, s) => (s[1] > m[1] ? s : m));
  const sorted = coarse.map((s) => s[1]).sort((a, b) => a - b);
  if (roughScore < sorted[Math.floor(sorted.length / 2)] * 1.15) return null;

  let best = rough;
  let bestScore = roughScore;
  for (let a = rough - 0.45; a <= rough + 0.45 + 1e-9; a += 0.05) {
    const s = score(a);
    if (s > bestScore) [best, bestScore] = [a, s];
  }
  return Math.round(best * 100) / 100;
}

/**
 * Typical height of a line of writing once straightened. A tilted line's upright box is taller
 * than its writing by about width × tan(tilt), which would otherwise make the text look bigger
 * than it is.
 */
export function uprightLineHeight(boxes: readonly Rect[], tilt: number): number {
  const t = Math.abs(Math.tan((tilt * Math.PI) / 180));
  return median(boxes.map((b) => Math.max(b.height - b.width * t, b.height * 0.25)));
}
