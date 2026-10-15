import { describe, expect, it } from 'vitest';
import { apply } from '../src/pipeline/affine';
import { MAX_PIXELS, ORIENTATION_TEST_JPEG, jpegOrientation, shrinkFor, uprightFrame } from '../src/pipeline/photo';

const bytes = (base64: string) => Uint8Array.from(Buffer.from(base64, 'base64')).buffer;

describe('jpegOrientation', () => {
  it('reads the "turn right to view" mark phones put on portrait photos', () => {
    expect(jpegOrientation(bytes(ORIENTATION_TEST_JPEG))).toBe(6);
  });
  it('is upright for anything without the mark, or that is not a JPEG', () => {
    expect(jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2, 0, 0, 0, 0, 0, 0]).buffer)).toBe(1);
    expect(jpegOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toBe(1);
    expect(jpegOrientation(new ArrayBuffer(0))).toBe(1);
  });
});

describe('uprightFrame', () => {
  // A 40 × 30 photo as stored, drawn at half size: where do its corners land?
  const corners = (orientation: number) => {
    const frame = uprightFrame(orientation, 40, 30, 0.5);
    const at = (x: number, y: number) => apply(frame.transform, x, y).map((v) => Math.round(v) + 0);
    return { size: [frame.width, frame.height], topLeft: at(0, 0), topRight: at(40, 0), bottomLeft: at(0, 30) };
  };

  it('keeps an upright photo as it is, only smaller', () => {
    expect(corners(1)).toEqual({ size: [20, 15], topLeft: [0, 0], topRight: [20, 0], bottomLeft: [0, 15] });
  });
  it('turns a sideways photo a quarter to the right (6) or left (8)', () => {
    // Turned right, the stored top-left corner ends up top-right, and width and height swap.
    expect(corners(6)).toEqual({ size: [15, 20], topLeft: [15, 0], topRight: [15, 20], bottomLeft: [0, 0] });
    expect(corners(8)).toEqual({ size: [15, 20], topLeft: [0, 20], topRight: [0, 0], bottomLeft: [15, 20] });
  });
  it('turns an upside-down photo half way (3)', () => {
    expect(corners(3)).toEqual({ size: [20, 15], topLeft: [20, 15], topRight: [0, 15], bottomLeft: [20, 0] });
  });
  it('keeps every corner of every orientation inside the frame', () => {
    for (let o = 1; o <= 8; o++) {
      const { size, topLeft, topRight, bottomLeft } = corners(o);
      for (const [x, y] of [topLeft, topRight, bottomLeft]) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(size[0]);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(size[1]);
      }
    }
  });
});

describe('shrinkFor', () => {
  it('leaves usual 12 MP photos alone', () => {
    expect(shrinkFor(4032, 3024)).toBe(1);
  });
  it('shrinks bigger photos to what a phone browser can handle', () => {
    for (const [w, h] of [[5712, 4284], [8160, 6120], [16320, 12240]]) {
      const k = shrinkFor(w, h);
      expect(Math.round(w * k) * Math.round(h * k)).toBeLessThanOrEqual(MAX_PIXELS + 10_000);
      expect(Math.round(w * k) * Math.round(h * k)).toBeLessThan(16_777_216); // Safari on iPhone's canvas limit
    }
  });
});
