export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReceiptArea {
  /** Where to read, in photo pixels. */
  rect: Rect;
  /** The text boxes that belong to the receipt (first look). */
  boxes: Rect[];
  /** Other text in the photo (another receipt, a keyboard, packaging) was left out. */
  leftOut: boolean;
  /** Typical height of a detected text box, in photo pixels. */
  lineHeight: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const area = (b: Rect) => b.width * b.height;

/** Overlap of two spans [a0, a1] and [b0, b1]; negative is the gap between them. */
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0);

/**
 * First look at a photo: from the detected text boxes, finds the receipt and how big its writing
 * is. Returns null when no text was found.
 *
 * A receipt is a tall block of lines stacked closely on top of each other, so boxes are linked to
 * the ones just above/below them (overlapping left–right) and to their neighbours on the same line.
 * The biggest linked block is the receipt; stray words elsewhere in the photo (keyboard keys, a
 * logo, the edge of another receipt) are not linked to it and are left out.
 */
export function findReceipt(boxes: readonly Rect[], width: number, height: number): ReceiptArea | null {
  if (!boxes.length) return null;
  const lh = median(boxes.map((b) => b.height));

  // Columns: boxes stacked closely on top of each other, overlapping left–right.
  const parent = boxes.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const sameLine: Array<[number, number]> = [];
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j];
      const across = overlap(a.x, a.x + a.width, b.x, b.x + b.width);
      const down = overlap(a.y, a.y + a.height, b.y, b.y + b.height);
      // Gaps measured against the boxes' own size: small, widely spaced labels (keyboard keys) don't stack.
      if (across > 0 && down > -Math.min(a.height, b.height) * 2) parent[root(i)] = root(j);
      // Level with each other and not further apart than the words are wide (a name and its price).
      else if (down > Math.min(a.height, b.height) * 0.3 && -across <= Math.min(lh * 8, 2 * Math.max(a.width, b.width))) {
        sameLine.push([i, j]);
      }
    }
  }
  // Side-by-side columns join when they line up on several lines (names and their prices),
  // not on one line by chance (a keyboard key, the edge of another receipt).
  const columnOf = boxes.map((_, i) => root(i));
  const size = new Map<number, number>();
  for (const c of columnOf) size.set(c, (size.get(c) ?? 0) + 1);
  const pairs = new Map<string, number>();
  for (const [i, j] of sameLine) {
    const [a, b] = [columnOf[i], columnOf[j]].sort((x, y) => x - y);
    if (a !== b) pairs.set(`${a}:${b}`, (pairs.get(`${a}:${b}`) ?? 0) + 1);
  }
  for (const [key, count] of pairs) {
    const [a, b] = key.split(':').map(Number);
    if (count >= 2 && count >= Math.min(size.get(a)!, size.get(b)!) * 0.5) parent[root(a)] = root(b);
  }

  const blocks = new Map<number, Rect[]>();
  boxes.forEach((b, i) => blocks.set(root(i), [...(blocks.get(root(i)) ?? []), b]));
  const all = [...blocks.values()].map((bs) => ({ boxes: bs, area: bs.reduce((s, b) => s + area(b), 0), ...bounds(bs) }));
  all.sort((a, b) => b.area - a.area);

  // The biggest block, plus blocks that belong with it:
  //  - lined up a little above or below (a header or footer separated by a logo or barcode);
  //  - a column of several lines running alongside it (prices printed far from the names),
  //    unless it is cut off by the photo's edge (part of another receipt).
  const main = all[0];
  const rest = all.slice(1);
  const atEdge = (c: { x0: number; x1: number }) => c.x0 <= width * 0.02 || c.x1 >= width * 0.98;
  // A column of prices is spaced like the receipt's lines; scattered labels are not.
  const pitch = linePitch(main.boxes);
  let absorbed = true;
  while (absorbed) {
    absorbed = false;
    for (let i = rest.length - 1; i >= 0; i--) {
      const c = rest[i];
      const lined = overlap(c.x0, c.x1, main.x0, main.x1) >= (c.x1 - c.x0) * 0.6;
      const near = overlap(c.y0, c.y1, main.y0, main.y1) > -lh * 12;
      const alongside =
        c.boxes.length >= 3 &&
        linePitch(c.boxes) <= pitch * 2.5 &&
        overlap(c.y0, c.y1, main.y0, main.y1) >= (c.y1 - c.y0) * 0.5 &&
        overlap(c.x0, c.x1, main.x0, main.x1) > -lh * 25 &&
        (!atEdge(c) || atEdge(main));
      if ((lined && near) || alongside) {
        main.boxes.push(...c.boxes);
        main.area += c.area;
        Object.assign(main, bounds(main.boxes));
        rest.splice(i, 1);
        absorbed = true;
      }
    }
  }

  // Generous margins, so faint text the first look missed is still inside…
  let x0 = main.x0 - lh * 3;
  let x1 = main.x1 + lh * 3;
  const y0 = main.y0 - lh * 5;
  const y1 = main.y1 + lh * 5;
  // …but stopping short of text that was left out beside the receipt.
  for (const b of rest.flatMap((c) => c.boxes)) {
    if (overlap(b.y, b.y + b.height, y0, y1) <= 0) continue;
    if (b.x + b.width <= main.x0) x0 = Math.max(x0, b.x + b.width + 1);
    else if (b.x >= main.x1) x1 = Math.min(x1, b.x - 1);
  }

  const rect = { x: Math.max(0, Math.floor(x0)), y: Math.max(0, Math.floor(y0)), width: 0, height: 0 };
  rect.width = Math.min(width, Math.ceil(x1)) - rect.x;
  rect.height = Math.min(height, Math.ceil(y1)) - rect.y;
  const leftOutArea = rest.reduce((s, c) => s + c.area, 0);
  return { rect, boxes: main.boxes, leftOut: leftOutArea >= main.area * 0.03, lineHeight: lh };
}

/** Typical distance between successive lines of a block (median gap between box centres). */
function linePitch(bs: readonly Rect[]): number {
  const ys = bs.map((b) => b.y + b.height / 2).sort((a, b) => a - b);
  const minGap = median(bs.map((b) => b.height)) * 0.2; // boxes on the same line aren't a gap
  const gaps = ys.slice(1).map((y, i) => y - ys[i]).filter((g) => g > minGap);
  return gaps.length ? median(gaps) : Infinity;
}

function bounds(bs: readonly Rect[]) {
  return {
    x0: Math.min(...bs.map((b) => b.x)),
    x1: Math.max(...bs.map((b) => b.x + b.width)),
    y0: Math.min(...bs.map((b) => b.y)),
    y1: Math.max(...bs.map((b) => b.y + b.height)),
  };
}
