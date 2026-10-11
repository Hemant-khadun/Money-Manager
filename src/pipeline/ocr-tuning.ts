/** PaddleOCR's standard threshold on the text-probability map (det_db_thresh). */
export const TEXT_PROBABILITY = 0.3;

type Postprocess = (detection: ArrayLike<number>, ...rest: unknown[]) => unknown;

/**
 * ppu-paddle-ocr's canvas engine (the only one in its browser build) traces boxes around every
 * pixel with any text probability above zero. On a receipt, the faint halo between closely
 * printed lines joins them into one tall block, which is then read as a single letter and the
 * lines are lost (seen on a long Intermart receipt: 20 lines vanished). This applies PaddleOCR's
 * usual 0.3 threshold before the boxes are traced.
 *
 * Reaches into the library's detector, so it checks the method exists and reports whether it
 * could apply (pinned to ppu-paddle-ocr 6.x). Call after initialize().
 */
export function applyTextThreshold(service: unknown): boolean {
  const detector = (service as { detector?: { postprocessDetection?: Postprocess } } | null)?.detector;
  const original = detector?.postprocessDetection;
  if (!detector || typeof original !== 'function') return false;
  detector.postprocessDetection = function (this: unknown, detection, ...rest) {
    const sure = Float32Array.from(detection, (p) => (p >= TEXT_PROBABILITY ? p : 0));
    return original.call(this, sure, ...rest);
  };
  return true;
}
