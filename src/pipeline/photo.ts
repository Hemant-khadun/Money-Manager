import type { Affine } from './affine';

// Getting a phone photo ready to read: upright and at a size phone browsers can handle.

/**
 * Photos are read at most this big. Phones take 24 to 200 megapixel photos, but phone browsers
 * refuse canvases that size (Safari on iPhone: over 16.7 million pixels) or run out of memory on
 * them, and receipt print reads fine at this size. Usual 12 MP photos (4032 × 3024) pass untouched.
 */
export const MAX_PIXELS = 12_500_000;

/** How much to shrink a photo of this size (1 = not at all). */
export function shrinkFor(width: number, height: number, maxPixels = MAX_PIXELS): number {
  return Math.min(1, Math.sqrt(maxPixels / (width * height)));
}

/**
 * The EXIF orientation of a JPEG: 1 is upright, 6 means "turn right to view" (how phones save most
 * portrait photos), and so on up to 8. 1 when the photo has none, or isn't a JPEG.
 */
export function jpegOrientation(bytes: ArrayBuffer): number {
  const view = new DataView(bytes);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1;
  let offset = 2;
  while (offset + 10 <= view.byteLength) {
    const marker = view.getUint16(offset);
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return 1; // the image data starts: no more headers
    // APP1 holding "Exif\0\0", then the TIFF header.
    if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966) return exifOrientation(view, offset + 10) ?? 1;
    offset += 2 + view.getUint16(offset + 2);
  }
  return 1;
}

function exifOrientation(view: DataView, tiff: number): number | null {
  if (tiff + 8 > view.byteLength) return null;
  const little = view.getUint16(tiff) === 0x4949;
  const ifd = tiff + view.getUint32(tiff + 4, little);
  if (ifd + 2 > view.byteLength) return null;
  for (let i = 0, count = view.getUint16(ifd, little); i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > view.byteLength) return null;
    if (view.getUint16(entry, little) === 0x0112) {
      const orientation = view.getUint16(entry + 8, little);
      return orientation >= 1 && orientation <= 8 ? orientation : null;
    }
  }
  return null;
}

/**
 * Where to draw a photo of `width` × `height` (as stored) so it ends up upright and scaled by
 * `scale`: the canvas size, and the transform for setTransform before drawImage(photo, 0, 0).
 */
export function uprightFrame(orientation: number, width: number, height: number, scale: number): { width: number; height: number; transform: Affine } {
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const s = scale;
  // 2–4 mirror or turn it half way; 5–8 turn it a quarter, so its width and height swap.
  const frames: Record<number, [number, number, Affine]> = {
    2: [w, h, [-s, 0, 0, s, w, 0]],
    3: [w, h, [-s, 0, 0, -s, w, h]],
    4: [w, h, [s, 0, 0, -s, 0, h]],
    5: [h, w, [0, s, s, 0, 0, 0]],
    6: [h, w, [0, s, -s, 0, h, 0]],
    7: [h, w, [0, -s, -s, 0, h, w]],
    8: [h, w, [0, -s, s, 0, 0, w]],
  };
  const [frameWidth, frameHeight, transform] = frames[orientation] ?? [w, h, [s, 0, 0, s, 0, 0]];
  return { width: frameWidth, height: frameHeight, transform };
}

/** A 2 × 1 pixel JPEG marked "turn right to view": a browser that honours the mark decodes it as 1 × 2. */
export const ORIENTATION_TEST_JPEG =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDAFA3PEY8MlBGQUZaVVBfeMiCeG5uePWvuZHI////////////////////////////////////////////////////2wBDAVVaWnhpeOuCguv/////////////////////////////////////////////////////////////////////////wAARCAABAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwC7RRRQB//Z';
