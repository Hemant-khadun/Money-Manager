import type { OcrLine } from '../parser/types';

export type OcrStrategy = 'per-line' | 'per-box';

export type OcrRequest =
  | {
      type: 'init';
      /** Absolute URL: the worker can't resolve public/ paths against the page (GitHub Pages serves under /<repo>/). */
      modelsUrl: string;
    }
  | { type: 'recognize'; id: number; image: ArrayBuffer; strategy: OcrStrategy };

/** What the reader did with one photo, for the person to see (and to judge photo quality). */
export interface ReadReport {
  photoWidth: number;
  photoHeight: number;
  /** Typical height of a line of writing in the photo, in pixels (small = hard to read). */
  lineHeight: number;
  /** How tilted the receipt was, in degrees; it is straightened before reading. */
  tilt: number;
  /** How much the receipt was enlarged (> 1) or reduced (< 1) before reading. */
  zoom: number;
  /** Number of overlapping parts a long receipt was read in. */
  parts: number;
  /** Unclear lines re-read up close, and how many of those came out clearer. */
  closerLooks: number;
  improved: number;
  /** Lines still unclear at the end (creases, folds, smudges). */
  unclearLeft: number;
  /** Part of another receipt at the photo's edge was left out. */
  leftOut: boolean;
}

export type OcrResponse =
  | { type: 'ready'; backend: 'webgpu' | 'wasm'; loadMs: number }
  /** A plain-language step, shown while the receipt is being read; how far along it is as the step starts, and where the step ends (0..1). */
  | { type: 'progress'; id: number; step: string; done: number; next: number }
  | { type: 'result'; id: number; lines: OcrLine[]; ms: number; report: ReadReport }
  | { type: 'error'; id: number | null; message: string };
