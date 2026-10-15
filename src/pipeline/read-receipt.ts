import type { OcrLine } from '../parser/types';
import { apply, chain, invert, rotate, scale, translate, type Affine } from './affine';
import { groupBounds, groupIntoLines, groupText, toOcrLines, type OcrWord } from './ocr-lines';
import type { OcrStrategy, ReadReport } from './ocr-protocol';
import { PART_MAX, centreY, closestGroup, isClearer, planParts, unclearLines, zoomFor } from './reading-plan';
import { findReceipt, type Rect } from './receipt-region';
import { estimateTilt, findInk, inkBand, inkInside, tiltFromInk, toGray, uprightLineHeight, type Ink } from './skew';

// Reads one receipt photo, step by step:
//   1. first look: find the receipt, measure its tilt and how big its writing is;
//   2. zoom so the writing is the size the reader handles best;
//   3. straighten and read it in overlapping parts (each part gets its own tilt, for curled paper);
//   4. re-read unclear lines up close, from the original photo.
// Every image is drawn straight from the original photo through one transform, so pixels are
// resampled only once. Runs in the browser worker and in Node (for testing on real photos).

/** Anything with a size: OffscreenCanvas in the browser, @napi-rs/canvas in Node. */
export interface Surface {
  width: number;
  height: number;
}

export interface Canvases<C extends Surface> {
  /** A blank white canvas. */
  create(width: number, height: number): C;
  /** Draws `source` onto `target` through `transform` (source pixels → target pixels), smoothly resampled. */
  paint(target: C, source: C, transform: Affine): void;
  /** The canvas's pixels, RGBA (as getImageData returns them). */
  pixels(canvas: C): ArrayLike<number>;
}

export interface OcrEngine<C> {
  detect(image: C, maxSideLength: number): Promise<{ boxes: Rect[] }>;
  recognize(image: C, strategy: OcrStrategy): Promise<{ lines: OcrWord[][] }>;
}

/** The first look runs at this size: enough to find the receipt and measure its writing. */
const FIRST_LOOK_MAX = 1920;
/** A part's own tilt may differ this much from the whole receipt's (curled paper), no more. */
const MAX_LOCAL_TURN = 8;
/** Where the stages start on the progress bar (0..1): the first look is quick, reading the parts takes the longest. */
const READING_STARTS = 0.1;
const CLOSER_LOOKS_START = 0.8;
/** Closer looks never enlarge the original photo more than this. */
const MAX_TOTAL_ZOOM = 4;
/** Tilt is measured on a small copy of the receipt where detected text boxes are about this tall… */
const INK_BOX_HEIGHT = 20;
/** …and at most this many pixels. */
const INK_MAX_PIXELS = 2_500_000;

interface ReadLine {
  words: OcrWord[];
  part: number;
}

interface PartView {
  /** Original photo → this straightened part. */
  transform: Affine;
  width: number;
  /** Where this part's centre sits along the receipt, for ordering lines across parts. */
  centre: number;
  height: number;
}

const centreOf = (b: Rect): [number, number] => [b.x + b.width / 2, b.y + b.height / 2];

/**
 * The print in the receipt area, found on a small copy (`inkScale` of the photo's size), inside
 * the text boxes only: the paper's edges or something lying next to the receipt don't count.
 */
function receiptInk<C extends Surface>(canvases: Canvases<C>, photo: C, area: Rect, boxes: readonly Rect[], inkScale: number): Ink {
  const width = Math.max(1, Math.round(area.width * inkScale));
  const height = Math.max(1, Math.round(area.height * inkScale));
  const toSmall = chain(translate(-area.x, -area.y), scale(inkScale));
  const small = canvases.create(width, height);
  canvases.paint(small, photo, toSmall);
  // Each pixel is compared with about one line of print around it.
  const ink = findInk(toGray(width, height, canvases.pixels(small)), INK_BOX_HEIGHT / 2);
  const inSmall = boxes.map((b) => {
    const [x, y] = apply(toSmall, b.x, b.y);
    return { x, y, width: b.width * inkScale, height: b.height * inkScale };
  });
  return inkInside(ink, inSmall, width, height);
}
const rad = (degrees: number) => (degrees * Math.PI) / 180;

/** Bounds of boxes after a transform (all four corners of each box). */
function extent(boxes: readonly Rect[], t: Affine) {
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const b of boxes) {
    for (const [cx, cy] of [
      [b.x, b.y],
      [b.x + b.width, b.y],
      [b.x, b.y + b.height],
      [b.x + b.width, b.y + b.height],
    ] as const) {
      const [x] = apply(t, cx, cy);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
    }
  }
  return { x0, x1 };
}

export async function readReceipt<C extends Surface>(
  engine: OcrEngine<C>,
  canvases: Canvases<C>,
  photo: C,
  strategy: OcrStrategy,
  /** A plain-language step, how far along the reading is as it starts, and where it ends (0..1). */
  onStep: (step: string, done: number, next: number) => void = () => {},
): Promise<{ lines: OcrLine[]; report: ReadReport }> {
  onStep('Looking at the photo', 0, READING_STARTS);
  const { boxes } = await engine.detect(photo, FIRST_LOOK_MAX);
  const found = findReceipt(boxes, photo.width, photo.height);
  const report: ReadReport = {
    photoWidth: photo.width,
    photoHeight: photo.height,
    lineHeight: 0,
    tilt: 0,
    zoom: 1,
    parts: 0,
    closerLooks: 0,
    improved: 0,
    unclearLeft: 0,
    leftOut: found?.leftOut ?? false,
  };
  if (!found) return { lines: [], report };

  const area = found.rect;
  const receiptBoxes = found.boxes;
  // Tilt from the print itself; the text boxes are the fallback (too little print to tell).
  const inkScale = Math.min(1, INK_BOX_HEIGHT / Math.max(found.lineHeight, 1), Math.sqrt(INK_MAX_PIXELS / (area.width * area.height)));
  const ink = receiptInk(canvases, photo, area, receiptBoxes, inkScale);
  const tilt = tiltFromInk(ink) ?? estimateTilt(receiptBoxes) ?? 0;
  const lineHeight = uprightLineHeight(receiptBoxes, tilt);
  const margin = lineHeight * 3;
  // Zoom for the writing, limited by how wide the receipt is once straightened
  // (not by the photo, and not by the slant of a tilted receipt).
  const level = extent(receiptBoxes, rotate(tilt));
  const zoom = zoomFor(lineHeight, level.x1 - level.x0 + margin * 2);
  report.lineHeight = Math.round(lineHeight);
  report.tilt = Math.round(tilt * 10) / 10;
  report.zoom = Math.round(zoom * 10) / 10;

  // The receipt area, zoomed (not yet straightened). Parts are planned in this view.
  const toView = chain(translate(-area.x, -area.y), scale(zoom));
  const viewWidth = area.width * zoom;
  const viewHeight = area.height * zoom;
  const receiptWidth = (level.x1 - level.x0 + margin * 2) * zoom;
  // Leave room for the extra height a part gains when it is turned level.
  const sin = Math.abs(Math.sin(rad(Math.abs(tilt) + 2)));
  const maxPart = Math.max(PART_MAX / 2, Math.floor((PART_MAX - receiptWidth * sin) / Math.cos(rad(tilt))));
  const parts = planParts(viewHeight, lineHeight * zoom, maxPart);
  report.parts = parts.length;
  const partDone = (i: number) => READING_STARTS + ((CLOSER_LOOKS_START - READING_STARTS) * i) / parts.length;

  const views: PartView[] = [];
  const lines: ReadLine[] = [];
  for (const [i, part] of parts.entries()) {
    onStep(parts.length > 1 ? `Reading part ${i + 1} of ${parts.length}` : 'Reading the receipt', partDone(i), partDone(i + 1));
    // This part's own tilt (paper curls), from its own print (or the first look's boxes inside it).
    const partBoxes = receiptBoxes.filter((b) => {
      const y = apply(toView, ...centreOf(b))[1];
      return y >= part.top - lineHeight * zoom && y < part.bottom + lineHeight * zoom;
    });
    const local = tiltFromInk(inkBand(ink, (part.top * inkScale) / zoom, (part.bottom * inkScale) / zoom)) ?? estimateTilt(partBoxes);
    const turn = local !== null && Math.abs(local - tilt) <= MAX_LOCAL_TURN ? local : tilt;

    // Straighten around the part's centre, then frame just the receipt's width (from its boxes).
    const height = part.bottom - part.top;
    const toLevel = chain(translate(-viewWidth / 2, -(part.top + height / 2)), rotate(turn));
    const marginInView = margin * zoom;
    const x = partBoxes.length
      ? extent(partBoxes, chain(toView, toLevel))
      : { x0: -viewWidth / 2, x1: viewWidth / 2 };
    const reach = Math.max(Math.abs(x.x0), Math.abs(x.x1)) + marginInView;
    const s = Math.abs(Math.sin(rad(turn)));
    const width = Math.ceil(x.x1 - x.x0 + marginInView * 2);
    const levelHeight = Math.ceil(height * Math.abs(Math.cos(rad(turn))) + reach * s * 2);
    const viewToPart = chain(toLevel, translate(-(x.x0 - marginInView), levelHeight / 2));
    const transform = chain(toView, viewToPart);
    const image = canvases.create(width, levelHeight);
    canvases.paint(image, photo, transform);
    views.push({ transform, width, centre: part.top + height / 2, height: levelHeight });

    const partToView = invert(viewToPart);
    const result = await engine.recognize(image, strategy);
    for (const group of groupIntoLines(result.lines.flat())) {
      // Keep each line from exactly one part: the one whose keep-band holds its centre (in the unturned view).
      const y = apply(partToView, ...centreOf(groupBounds(group)))[1];
      if (y >= part.keepFrom && y < part.keepTo) lines.push({ words: group, part: i });
    }
  }

  // Lines it wasn't sure about: look again, closer, from the original photo.
  const unclear = unclearLines(lines.map((l) => l.words));
  report.closerLooks = unclear.length;
  const lookDone = (n: number) => CLOSER_LOOKS_START + ((1 - CLOSER_LOOKS_START) * n) / unclear.length;
  const reread = new Set<ReadLine>();
  for (const [n, index] of unclear.entries()) {
    onStep(`Taking a closer look at unclear lines (${n + 1} of ${unclear.length})`, lookDone(n), lookDone(n + 1));
    const line = lines[index];
    const clearer = await closerLook(engine, canvases, photo, views[line.part], line.words, zoom, strategy);
    if (clearer) {
      line.words = clearer;
      reread.add(line);
      report.improved++;
    }
  }

  const ordered = withoutRereadTwins(inReadingOrder(lines, views), reread);
  report.unclearLeft = unclearLines(ordered.map((l) => l.words), Infinity).length;
  return { lines: toOcrLines(ordered.map((l) => l.words)), report };
}

/**
 * Two broken pieces of one creased line can each be re-read up close as the same whole line;
 * keep it once. (Identical lines that were read clearly the first time, like an item scanned
 * twice, are left alone.)
 */
function withoutRereadTwins(lines: ReadLine[], reread: Set<ReadLine>): ReadLine[] {
  return lines.filter((line, i) => {
    if (!reread.has(line)) return true;
    const text = groupText(line.words);
    return !lines.slice(Math.max(0, i - 2), i).some((before) => reread.has(before) && groupText(before.words) === text);
  });
}

/**
 * Re-reads one line at twice the zoom, straightened like its part, straight from the photo.
 * Returns the clearer reading (in the part's coordinates), or null.
 */
async function closerLook<C extends Surface>(
  engine: OcrEngine<C>,
  canvases: Canvases<C>,
  photo: C,
  view: PartView,
  words: OcrWord[],
  zoom: number,
  strategy: OcrStrategy,
): Promise<OcrWord[] | null> {
  const b = groupBounds(words);
  const pad = b.height * 0.8;
  const y = b.y - pad;
  const height = b.height + pad * 2;
  const wanted = Math.min(2, MAX_TOTAL_ZOOM / zoom);
  // The line's band across the full width also catches a price the first read missed…
  let crop = { x: 0, y, width: view.width, height };
  // …unless that is too wide to enlarge, then just the line itself.
  if (PART_MAX / crop.width < wanted) {
    const x = Math.max(0, b.x - pad * 2);
    crop = { x, y, width: Math.min(view.width - x, b.width + pad * 4), height };
  }
  const k = Math.min(wanted, PART_MAX / crop.width);
  if (k < 1.25) return null; // no real zoom available: nothing new to see

  const image = canvases.create(Math.ceil(crop.width * k), Math.ceil(crop.height * k));
  canvases.paint(image, photo, chain(view.transform, translate(-crop.x, -crop.y), scale(k)));
  const result = await engine.recognize(image, strategy);
  const reread = closestGroup(groupIntoLines(result.lines.flat()), image.height / 2);
  // It must be the same line, not the neighbour above or below.
  if (!reread || Math.abs(centreY(reread) - image.height / 2) > b.height * k * 0.4) return null;
  if (!isClearer(words, reread)) return null;
  // Back into the part's coordinates, on the line's original height.
  return reread.map((w) => ({
    ...w,
    box: { x: crop.x + w.box.x / k, y: b.y, width: w.box.width / k, height: b.height },
  }));
}

/**
 * Lines top to bottom along the straightened receipt. Within a part, its own level coordinates
 * give the order; parts follow each other, and a line never sorts above one from an earlier part.
 */
function inReadingOrder(lines: ReadLine[], views: PartView[]): ReadLine[] {
  const placed = lines
    .map((line) => {
      const view = views[line.part];
      const [, y] = centreOf(groupBounds(line.words));
      return { line, at: view.centre + (y - view.height / 2) };
    })
    .sort((a, b) => a.line.part - b.line.part || a.at - b.at);

  let previous = -Infinity;
  return placed.map(({ line, at }) => {
    const y = Math.max(at, previous + 1);
    previous = y;
    const [, centre] = centreOf(groupBounds(line.words));
    line.words = line.words.map((w) => ({ ...w, box: { ...w.box, y: w.box.y + (y - centre) } }));
    return line;
  });
}
