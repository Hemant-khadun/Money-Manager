/** Thumbnail width, in pixels; tall receipts are cut to the top (where the shop's name is). */
const WIDTH = 320;
const MAX_HEIGHT = 640;

/**
 * A small picture of a receipt photo to keep with the saved receipt (about 20–40 KB); the photo
 * itself is never stored. JPEG, because every browser can make one.
 */
export async function makeThumbnail(photo: Blob): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(photo);
    const scale = Math.min(1, WIDTH / bitmap.width);
    const width = Math.round(bitmap.width * scale);
    const height = Math.min(MAX_HEIGHT, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, bitmap.width * scale, bitmap.height * scale);
    bitmap.close();
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.72));
  } catch {
    return null;
  }
}
