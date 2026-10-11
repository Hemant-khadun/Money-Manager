import { describe, expect, it } from 'vitest';
import { toOcrLines, type OcrWord } from '../src/pipeline/ocr-lines';

const word = (text: string, x: number, y: number, height = 20, confidence = 0.9): OcrWord => ({
  text,
  confidence,
  box: { x, y, width: text.length * 10, height },
});

describe('toOcrLines', () => {
  it('joins boxes left to right with a space so name and price stay apart', () => {
    const lines = toOcrLines([[word('45.00', 400, 102), word('LAIT UHT 1L', 10, 100)]]);
    expect(lines).toEqual([{ text: 'LAIT UHT 1L 45.00', confidence: expect.closeTo(0.9), y: 100, height: 20 }]);
  });

  it('orders lines top to bottom and drops empty boxes', () => {
    const lines = toOcrLines([[word('TOTAL', 10, 300)], [word(' ', 10, 200)], [word('SUPER U', 10, 0, 40)]]);
    expect(lines.map((l) => [l.text, l.height])).toEqual([
      ['SUPER U', 40],
      ['TOTAL', 20],
    ]);
  });

  it('weights confidence by text length', () => {
    const [line] = toOcrLines([[word('BANANES', 10, 0, 20, 1), word('i', 200, 0, 20, 0.2)]]);
    expect(line.confidence).toBeCloseTo((7 * 1 + 1 * 0.2) / 8);
  });
});
