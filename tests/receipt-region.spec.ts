import { describe, expect, it } from 'vitest';
import { findReceipt, type Rect } from '../src/pipeline/receipt-region';

const W = 720;
const H = 1280;
const box = (x: number, y: number, width: number, height = 20): Rect => ({ x, y, width, height });

/** Text boxes of a receipt lying in the middle of the photo, x 170–480, y 300–1045. */
const MAIN = Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? box(200, 300 + i * 25, 250) : box(170 + (i % 2) * 230, 300 + i * 25, 80)));

describe('findReceipt', () => {
  it('leaves out part of another receipt cut off by the edge of the photo', () => {
    // Like the Intermart photo: a strip of a long receipt runs down the left edge.
    const strip = Array.from({ length: 12 }, (_, i) => box(0, 20 + i * 30, 70));
    const found = findReceipt([...strip, ...MAIN], W, H)!;
    expect(found.leftOut).toBe(true);
    expect(found.rect.x).toBeGreaterThan(70); // never reaches back into the strip
    expect(found.rect.x).toBeLessThan(170);
    expect(found.rect.x + found.rect.width).toBeGreaterThan(480);
  });

  it('frames one receipt with room to spare and measures its writing', () => {
    const found = findReceipt(MAIN, W, H)!;
    expect(found.leftOut).toBe(false);
    expect(found.lineHeight).toBe(20);
    expect(found.rect).toEqual({ x: 110, y: 200, width: 430, height: 945 });
  });

  it('keeps a price column that sits apart from the names', () => {
    const names = Array.from({ length: 10 }, (_, i) => box(100, 300 + i * 25, 200));
    const prices = Array.from({ length: 10 }, (_, i) => box(500, 300 + i * 25, 80));
    const found = findReceipt([...names, ...prices], W, H)!;
    expect(found.leftOut).toBe(false);
    expect(found.rect.x + found.rect.width).toBeGreaterThan(580);
  });

  it('leaves nothing out when the receipt itself fills the photo edge to edge', () => {
    const tight = Array.from({ length: 10 }, (_, i) => box(5, 100 + i * 25, 400));
    const prices = Array.from({ length: 10 }, (_, i) => box(640, 100 + i * 25, 78));
    const found = findReceipt([...tight, ...prices], W, H)!;
    expect(found.leftOut).toBe(false);
    expect(found.rect).toMatchObject({ x: 0, width: W });
  });

  it('leaves out stray words elsewhere in the photo, like keyboard keys', () => {
    // Like the long Intermart photo: key labels on a keyboard to the left, a mouse logo to the right.
    const receipt = MAIN.map((b) => ({ ...b, x: b.x + 500 })); // x 670–980
    const keys = [box(20, 200, 60), box(20, 480, 70), box(160, 480, 60), box(20, 760, 60)];
    const logo = box(1300, 900, 50);
    const found = findReceipt([...keys, logo, ...receipt], 1600, H)!;
    expect(found.leftOut).toBe(true);
    expect(found.boxes).toHaveLength(receipt.length);
    expect(found.rect.x).toBeGreaterThan(220);
    expect(found.rect.x + found.rect.width).toBeLessThan(1300);
  });

  it('returns null when the photo has no writing', () => {
    expect(findReceipt([], W, H)).toBeNull();
  });
});
