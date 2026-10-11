import { describe, expect, it } from 'vitest';
import { apply, chain, identity, invert, rotate, scale, translate, type Affine } from '../src/pipeline/affine';
import { groupIntoLines, type OcrWord } from '../src/pipeline/ocr-lines';
import { applyTextThreshold } from '../src/pipeline/ocr-tuning';
import { readReceipt, type Canvases, type OcrEngine } from '../src/pipeline/read-receipt';
import type { Rect } from '../src/pipeline/receipt-region';
import { estimateTilt, findInk, inkBand, tiltFromInk, uprightLineHeight, type Gray } from '../src/pipeline/skew';

const word = (text: string, x: number, y: number, width: number, height = 36, confidence = 0.95): OcrWord => ({
  text,
  confidence,
  box: { x, y, width, height },
});

describe('affine transforms', () => {
  it('apply steps in the order they are listed, and invert exactly', () => {
    const t = chain(translate(10, 0), scale(2), rotate(30));
    const [x, y] = apply(t, 5, 7);
    const [bx, by] = apply(invert(t), x, y);
    expect(bx).toBeCloseTo(5);
    expect(by).toBeCloseTo(7);
    expect(apply(chain(translate(10, 0), scale(2)), 0, 0)).toEqual([20, 0]);
    expect(apply(identity, 3, 4)).toEqual([3, 4]);
  });
});

describe('estimateTilt', () => {
  /** Two upright boxes per printed line (a name and a price), on lines tilted by `degrees`. */
  const tiltedLines = (degrees: number) =>
    Array.from({ length: 20 }, (_, i) => {
      const slope = Math.tan((degrees * Math.PI) / 180);
      const y = 100 + i * 40;
      // The paper turns too, so each line starts further left (or right) the lower it is.
      const shift = -i * 40 * slope;
      const box = (cx: number, width: number) => {
        const height = 20 + width * Math.abs(slope);
        return { x: shift + cx - width / 2, y: y + cx * slope - height / 2, width, height };
      };
      return [box(200, 300), box(660, 120)];
    }).flat();

  it('measures how tilted the lines are', () => {
    expect(estimateTilt(tiltedLines(4))).toBeCloseTo(4, 0);
    expect(estimateTilt(tiltedLines(-6))).toBeCloseTo(-6, 0);
    expect(estimateTilt(tiltedLines(0))).toBeCloseTo(0, 0);
  });

  it('says so when there is not enough to go on', () => {
    expect(estimateTilt([{ x: 0, y: 0, width: 100, height: 20 }])).toBeNull();
  });

  it('measures writing height without the extra height a tilt adds to each box', () => {
    expect(uprightLineHeight(tiltedLines(4), 4)).toBeCloseTo(20, 0);
  });
});

describe('tiltFromInk', () => {
  /**
   * A grey picture of printed lines tilted by `degrees`: words made of letter strokes on light
   * paper, with a dark desk down the left side. Each line is one long run of print, like the lines
   * the detector boxes whole, where the text boxes alone can't show the tilt.
   */
  function printedPage(degrees: number): Gray {
    const width = 700;
    const height = 900;
    const data = new Uint8Array(width * height).fill(225);
    const slope = Math.tan((degrees * Math.PI) / 180);
    for (let y = 0; y < height; y++) for (let x = 0; x < 80; x++) data[y * width + x] = 40; // desk
    for (let line = 0; line < 30; line++) {
      for (let x = 130; x < 640; x++) {
        if (x % 60 >= 46 || x % 7 >= 5) continue; // gaps between words and between letters
        const top = Math.round(60 + line * 26 + (x - 130) * slope);
        for (let y = top; y < top + 9; y++) if (y >= 0 && y < height) data[y * width + x] = 55;
      }
    }
    return { width, height, data };
  }

  it('measures the tilt from the print, to a fraction of a degree', () => {
    for (const degrees of [4, -6, 0, 9.5]) {
      expect(Math.abs(tiltFromInk(findInk(printedPage(degrees), 10))! - degrees)).toBeLessThanOrEqual(0.2);
    }
  });

  it('counts print as ink, not a dark desk', () => {
    const ink = findInk(printedPage(0), 10);
    let onDesk = 0;
    for (let i = 0; i < ink.count; i++) if (ink.x[i] < 70) onDesk++;
    expect(onDesk).toBe(0);
  });

  it('can measure one band of a long receipt on its own (curled paper)', () => {
    const ink = findInk(printedPage(3), 10);
    expect(Math.abs(tiltFromInk(inkBand(ink, 300, 600))! - 3)).toBeLessThanOrEqual(0.3);
  });

  it('says so when there is no print', () => {
    const blank = { width: 300, height: 300, data: new Uint8Array(300 * 300).fill(225) };
    expect(tiltFromInk(findInk(blank, 10))).toBeNull();
  });
});

describe('groupIntoLines', () => {
  it('joins a name and its price on one line, and keeps stacked lines apart', () => {
    const lines = groupIntoLines([word('LAIT', 0, 0, 200), word('45.00', 400, 4, 100), word('PAIN', 0, 30, 200), word('25.00', 400, 31, 100)]);
    expect(lines.map((l) => l.map((w) => w.text).join(' '))).toEqual(['LAIT 45.00', 'PAIN 25.00']);
  });

  it('never merges boxes that sit on top of each other, even when tall boxes overlap', () => {
    // Creased paper: each line's box is taller than the line spacing.
    const lines = groupIntoLines([word('A 1x YEOS', 0, 0, 600, 70), word('A 1x HUP', 0, 30, 600, 70), word('B 2x SUNBRIDGE', 0, 60, 600, 70)]);
    expect(lines).toHaveLength(3);
  });

  it('follows a sloping line by comparing neighbouring words', () => {
    const lines = groupIntoLines([word('A', 0, 0, 40), word('1x', 60, 6, 40), word('CHAB', 120, 12, 80), word('109.95', 220, 18, 100), word('NEXT', 0, 48, 80)]);
    expect(lines.map((l) => l.map((w) => w.text).join(' '))).toEqual(['A 1x CHAB 109.95', 'NEXT']);
  });
});

describe('applyTextThreshold', () => {
  it("drops faint text probabilities before the library traces boxes", () => {
    let seen: number[] = [];
    const service = { detector: { postprocessDetection: (d: ArrayLike<number>) => (seen = Array.from(d)) } };
    expect(applyTextThreshold(service)).toBe(true);
    service.detector.postprocessDetection([0.05, 0.29, 0.3, 0.9]);
    expect(seen.map((p) => Math.round(p * 100) / 100)).toEqual([0, 0, 0.3, 0.9]);
  });

  it('reports when the library has changed and it cannot apply', () => {
    expect(applyTextThreshold({})).toBe(false);
  });
});

describe('readReceipt (simulated photo)', () => {
  // A long receipt photographed at a tilt. The fake OCR "reads" each printed line that lies whole
  // inside the image it is given, wherever the reading steps have moved, zoomed and turned it.
  interface FakeCanvas {
    width: number;
    height: number;
    transform: Affine;
  }
  const LINES = 80;
  const TILT = 4;
  const turn = chain(translate(-400, -1350), rotate(-TILT), translate(400, 1350)); // the photo's tilt
  const printed = Array.from({ length: LINES }, (_, i) => ({ text: `LINE ${i} ITEM RS${i}.00`, x: 150, y: 120 + i * 30, width: 500, height: 16 }));
  const corners = (r: Rect, t: Affine) =>
    [
      [r.x, r.y],
      [r.x + r.width, r.y],
      [r.x, r.y + r.height],
      [r.x + r.width, r.y + r.height],
    ].map(([x, y]) => apply(t, x, y));
  /** Upright box around a printed line as seen through `t`, padded like the real detector. */
  const boxThrough = (r: Rect, t: Affine): Rect => {
    const pts = corners(r, t);
    const x0 = Math.min(...pts.map((p) => p[0]));
    const x1 = Math.max(...pts.map((p) => p[0]));
    const y0 = Math.min(...pts.map((p) => p[1]));
    const y1 = Math.max(...pts.map((p) => p[1]));
    const h = (y1 - y0) / 1.0;
    return { x: x0, y: y0 - h * 0.4, width: x1 - x0, height: h * 1.8 };
  };

  const photo: FakeCanvas = { width: 800, height: 2700, transform: identity };
  const canvases: Canvases<FakeCanvas> = {
    create: (width, height) => ({ width, height, transform: identity }),
    paint: (target, _source, transform) => {
      target.transform = transform;
    },
    // Blank pixels: no print to measure the tilt from, so the text boxes are used instead.
    pixels: (c) => new Uint8ClampedArray(c.width * c.height * 4).fill(255),
  };
  const engine: OcrEngine<FakeCanvas> = {
    detect: async (image) => ({ boxes: printed.map((p) => boxThrough(p, chain(turn, image.transform))) }),
    recognize: async (image) => {
      const t = chain(turn, image.transform);
      const whole = printed.filter((p) => corners(p, t).every(([x, y]) => x >= 0 && y >= 0 && x <= image.width && y <= image.height));
      return { lines: whole.map((p) => [{ text: p.text, confidence: 0.95, box: boxThrough(p, t) }]) };
    },
  };

  it('reads every line exactly once, in order, across straightened overlapping parts', async () => {
    const steps: string[] = [];
    const { lines, report } = await readReceipt(engine, canvases, photo, 'per-box', (s) => steps.push(s));
    expect(report.parts).toBeGreaterThan(1);
    expect(report.tilt).toBeCloseTo(TILT, 0);
    expect(lines.map((l) => l.text)).toEqual(printed.map((p) => p.text));
    expect(steps[0]).toBe('Looking at the photo');
    expect(steps).toContain(`Reading part 2 of ${report.parts}`);
  });
});
