/** A 2D affine transform [a, b, c, d, e, f], the same layout as canvas setTransform(). */
export type Affine = readonly [number, number, number, number, number, number];

export const identity: Affine = [1, 0, 0, 1, 0, 0];

/** m · n: apply n first, then m. */
export function multiply(m: Affine, n: Affine): Affine {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** Composes transforms written in the order they apply: chain(first, second, …). */
export function chain(...steps: Affine[]): Affine {
  return steps.reduce((acc, step) => multiply(step, acc), identity);
}

export const translate = (x: number, y: number): Affine => [1, 0, 0, 1, x, y];
export const scale = (k: number): Affine => [k, 0, 0, k, 0, 0];
/** Counter-clockwise on screen for positive degrees (y points down). */
export function rotate(degrees: number): Affine {
  const r = (degrees * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [cos, -sin, sin, cos, 0, 0];
}

export function invert(m: Affine): Affine {
  const det = m[0] * m[3] - m[1] * m[2];
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export function apply(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
