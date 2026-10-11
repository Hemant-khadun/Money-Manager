import { describe, expect, it } from 'vitest';
import type { OcrWord } from '../src/pipeline/ocr-lines';
import { PART_MAX, closestGroup, isClearer, planParts, unclearLines, zoomFor } from '../src/pipeline/reading-plan';

const word = (text: string, y: number, confidence = 0.9, x = 0): OcrWord => ({
  text,
  confidence,
  box: { x, y, width: text.length * 10, height: 20 },
});

describe('zoomFor', () => {
  it('enlarges small writing to the size the reader handles best', () => {
    expect(zoomFor(12, 300)).toBe(3); // capped: enlarging further adds no detail
    expect(zoomFor(18, 300)).toBe(2);
  });
  it('reduces big camera photos, which reads just as well and faster', () => {
    expect(zoomFor(72, 2000)).toBe(0.5);
  });
  it('never makes a part wider than the reader works at in full detail', () => {
    expect(zoomFor(12, 1000)).toBeCloseTo(PART_MAX / 1000);
  });
});

describe('planParts', () => {
  it('reads a short receipt in one go', () => {
    expect(planParts(900, 36)).toEqual([{ top: 0, bottom: 900, keepFrom: 0, keepTo: 900 }]);
  });

  it('splits a long receipt into overlapping parts that cover it all', () => {
    const parts = planParts(4000, 36);
    expect(parts.length).toBe(4);
    expect(parts[0].top).toBe(0);
    expect(parts.at(-1)!.bottom).toBe(4000);
    for (const p of parts) expect(p.bottom - p.top).toBeLessThanOrEqual(PART_MAX);
    // Keep-bands join up exactly, so every line is kept once…
    for (let i = 1; i < parts.length; i++) expect(parts[i].keepFrom).toBe(parts[i - 1].keepTo);
    // …and a line kept by a part lies whole inside it (two lines of room at each seam).
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i].keepFrom - parts[i].top).toBeGreaterThanOrEqual(36 * 2);
      expect(parts[i - 1].bottom - parts[i - 1].keepTo).toBeGreaterThanOrEqual(36 * 2);
    }
  });
});

describe('closer looks', () => {
  const lines = [[word('SUPER U', 0, 0.98)], [word('LAIT UHT 1L 45.0O', 40, 0.62)], [word('PAIN 25.00', 80, 0.8)], [word('TOTAL 70.00', 120, 0.97)]];

  it('picks the unclear lines, least sure first', () => {
    expect(unclearLines(lines)).toEqual([1, 2]);
  });

  it('finds the re-read line in the middle of the close-up', () => {
    const closeUp = [[word('PAIN', 2)], [word('LAIT UHT 1L 45.00', 50)], [word('TOTAL', 98)]];
    expect(closestGroup(closeUp, 55)?.[0].text).toBe('LAIT UHT 1L 45.00');
  });

  it('only takes a re-read that is surer and kept most of the text', () => {
    const before = [word('LAIT UHT 1L 45.0O', 40, 0.62)];
    expect(isClearer(before, [word('LAIT UHT 1L 45.00', 0, 0.94)])).toBe(true);
    expect(isClearer(before, [word('LAIT UHT 1L 45.00', 0, 0.63)])).toBe(false); // barely surer
    expect(isClearer(before, [word('45.00', 0, 0.99)])).toBe(false); // lost the name
  });
});
