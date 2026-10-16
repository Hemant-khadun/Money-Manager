import { extractAmounts } from '../parser/money';
import { fixCurrency, fixDigits, normalizeText, similarity } from '../parser/text';
import type { OcrLine } from '../parser/types';

// Joins several photos of one long receipt into a single list of lines. Each photo is expected to
// repeat a few lines of the one before it. Where two photos overlap, every shared line is kept
// once, in whichever photo read it more clearly.
//
// The overlap is found by lining up the end of one photo with the start of the next, line by line
// (a local sequence alignment, as used to compare DNA). It needs a run of consecutive matching
// lines, so a receipt that repeats an item ("C/CHOICE LAMB SHLD FZ AUS" four times) can't fool it.

/** Lines compared at the end of one photo and at the start of the next. */
const WINDOW = 60;
/** Two readings at least this similar are the same line (OCR rarely reads a line identically twice). */
const SAME_LINE = 0.72;
const MATCH_BONUS = 1;
/** Two readings with the same price and at least this similar are probably the same line, one misread. */
const PARTIAL_LINE = 0.45;
/** Below MATCH_BONUS: not a clear match, so it never decides on its own that two photos belong together. */
const PARTIAL = 0.9;
const MISMATCH = -1;
const GAP = -0.6;
/** Cost of each line dropped at a photo's cut edge (half-cut lines, or lines the other photo also has). */
const EDGE = 0.25;
/** A join needs at least this score: about two clearly matching lines. */
const MIN_JOIN = 3;
/** Photos are put in order automatically only for up to this many (every order is tried). */
const MAX_REORDER = 6;

interface Key {
  text: string;
  amounts: number[];
}

/** What is compared: letters and digits only (spacing and punctuation vary between readings), plus the prices. */
function keyOf(line: OcrLine): Key {
  const norm = fixCurrency(normalizeText(fixDigits(line.text)));
  return { text: norm.replace(/[^A-Z0-9]/g, ''), amounts: extractAmounts(norm).map((a) => a.value) };
}

function pairScore(a: Key, b: Key): number {
  // Very short lines ("A", "TL") say little about where they are.
  if (a.text.length < 4 || b.text.length < 4) return a.text && a.text === b.text ? 0.2 : -0.3;
  const priced = a.amounts.length > 0 && b.amounts.length > 0;
  const samePrice = priced && a.amounts.some((v) => b.amounts.includes(v));
  // Same words but different prices are different lines: "0.714 KG … 399.53" vs "0.676 KG … 378.49".
  if (priced && !samePrice) return MISMATCH;
  const sim = similarity(a.text, b.text);
  if (sim >= SAME_LINE) return MATCH_BONUS + sim;
  // The same price and some of the same words: one photo lost or misread a word ("HUILE 165.00" for
  // "HUILE TOURNESOL 165.00"; the line at a photo's edge is often blurred). Digits read reliably, so
  // this is likely the same line; it helps a join along but never counts as a clear match.
  if (samePrice && sim >= PARTIAL_LINE) return PARTIAL;
  return MISMATCH;
}

type Step = 'both' | 'first' | 'second';

interface Join {
  /** How well the photos line up; higher is surer. */
  score: number;
  /** Index in the first photo of its first shared line. */
  firstFrom: number;
  /** Index in the second photo just after its last shared line. */
  secondTo: number;
  /** The shared stretch, top to bottom: which photo each line comes from. */
  steps: Array<{ step: Step; a: number; b: number }>;
  /** Lines in the shared stretch that clearly read the same in both photos. */
  matched: number;
}

/** Finds where `second` continues `first`, or null when they don't overlap. */
function findJoin(first: OcrLine[], second: OcrLine[]): Join | null {
  const aOff = Math.max(0, first.length - WINDOW);
  const A = first.slice(aOff).map(keyOf);
  const B = second.slice(0, WINDOW).map(keyOf);
  const n = A.length;
  const m = B.length;
  if (!n || !m) return null;

  const width = m + 1;
  const H = new Float64Array((n + 1) * width);
  const dir = new Uint8Array((n + 1) * width); // 0 stop · 1 both · 2 first only · 3 second only
  const startJ = new Int32Array((n + 1) * width);
  let best: { i: number; j: number; eff: number } | null = null;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const k = i * width + j;
      const diag = H[k - width - 1] + pairScore(A[i - 1], B[j - 1]);
      const up = H[k - width] + GAP;
      const left = H[k - 1] + GAP;
      const h = Math.max(0, diag, up, left);
      H[k] = h;
      if (h === 0) continue;
      if (h === diag) {
        dir[k] = 1;
        startJ[k] = dir[k - width - 1] ? startJ[k - width - 1] : j;
      } else if (h === up) {
        dir[k] = 2;
        startJ[k] = startJ[k - width];
      } else {
        dir[k] = 3;
        startJ[k] = startJ[k - 1];
      }
      // Lines left over after the shared stretch at the end of the first photo, or before it at the
      // start of the second, are at a cut edge; a good join leaves few of them.
      const eff = h - EDGE * (n - i) - EDGE * (startJ[k] - 1);
      if (h >= MIN_JOIN && eff > 0 && (!best || eff > best.eff)) best = { i, j, eff };
    }
  }
  if (!best) return null;

  const steps: Join['steps'] = [];
  let matched = 0;
  let { i, j } = best;
  while (i > 0 && j > 0 && dir[i * width + j]) {
    const d = dir[i * width + j];
    if (d === 1) {
      if (pairScore(A[i - 1], B[j - 1]) >= MATCH_BONUS) matched++;
      steps.push({ step: 'both', a: aOff + --i, b: --j });
    } else if (d === 2) steps.push({ step: 'first', a: aOff + --i, b: j });
    else steps.push({ step: 'second', a: aOff + i, b: --j });
  }
  steps.reverse();
  return { score: best.eff, firstFrom: steps[0].a, secondTo: best.j, steps, matched };
}

/** Lines at a photo's cut edge that may be left over when one photo continues another: half-cut lines. */
const MAX_CUT_EDGE = 4;
/** Each photo must add at least this many lines of its own to be a continuation rather than the same view. */
const MIN_NEW_LINES = 2;

/**
 * How surely `second` continues `first` on the same receipt, or null if it doesn't. Stricter than
 * the joining itself, because it decides whether photos belong together at all: different receipts
 * from one shop share their top and bottom lines (name, address, "thank you"), so the shared lines
 * must sit at the very bottom of `first` and the very top of `second`, and each photo must add
 * lines of its own (two photos of the same thing, or two identical receipts, are not one receipt).
 */
export function continues(first: OcrLine[], second: OcrLine[]): number | null {
  const join = findJoin(first, second);
  if (!join || join.matched < 2) return null;
  const firstAfter = first.length - 1 - join.steps[join.steps.length - 1].a;
  const secondBefore = join.steps[0].b;
  if (firstAfter > MAX_CUT_EDGE || secondBefore > MAX_CUT_EDGE) return null;
  if (join.firstFrom < MIN_NEW_LINES || second.length - join.secondTo < MIN_NEW_LINES) return null;
  return join.score;
}

/**
 * Sorts photos added together into receipts: photos that continue each other form one long
 * receipt (top to bottom); every other photo is a receipt of its own. Groups come in the order
 * their first photo was added.
 */
export function groupPhotos(photos: OcrLine[][]): number[][] {
  const links: Array<{ from: number; to: number; score: number }> = [];
  for (let i = 0; i < photos.length; i++) {
    for (let j = 0; j < photos.length; j++) {
      const score = i === j ? null : continues(photos[i], photos[j]);
      if (score !== null) links.push({ from: i, to: j, score });
    }
  }
  // Surest links first; each photo has at most one photo above it and one below, and no loops.
  links.sort((a, b) => b.score - a.score);
  const below = new Map<number, number>();
  const above = new Map<number, number>();
  const top = (i: number) => {
    while (above.has(i)) i = above.get(i)!;
    return i;
  };
  for (const { from, to } of links) {
    if (below.has(from) || above.has(to) || top(from) === to) continue;
    below.set(from, to);
    above.set(to, from);
  }
  const groups: number[][] = [];
  for (let i = 0; i < photos.length; i++) {
    if (above.has(i)) continue;
    const group = [i];
    while (below.has(group[group.length - 1])) group.push(below.get(group[group.length - 1])!);
    groups.push(group);
  }
  return groups.sort((a, b) => Math.min(...a) - Math.min(...b));
}

function joinTwo(first: OcrLine[], second: OcrLine[], join: Join): OcrLine[] {
  const shared = join.steps.map(({ step, a, b }) => {
    if (step === 'first') return first[a];
    if (step === 'second') return second[b];
    return first[a].confidence >= second[b].confidence ? first[a] : second[b];
  });
  return [...first.slice(0, join.firstFrom), ...shared, ...second.slice(join.secondTo)];
}

/** The order with the strongest joins, trying every order; the order given wins ties. */
function bestOrder(photos: OcrLine[][]): number[] {
  const given = photos.map((_, i) => i);
  if (photos.length < 2 || photos.length > MAX_REORDER) return given;
  const score = photos.map((a, i) => photos.map((b, j) => (i === j ? 0 : (findJoin(a, b)?.score ?? 0))));
  const total = (order: number[]) => order.slice(1).reduce((s, to, k) => s + score[order[k]][to], 0);

  let best = given;
  let bestTotal = total(given);
  const permute = (order: number[], rest: number[]) => {
    if (!rest.length) {
      const t = total(order);
      // A clearly better order only: photos picked in the right order stay as they are.
      if (t > bestTotal + 1) {
        best = order;
        bestTotal = t;
      }
      return;
    }
    for (const r of rest) permute([...order, r], rest.filter((x) => x !== r));
  };
  permute([], given);
  return best;
}

export interface Stitched {
  lines: OcrLine[];
  /** The photos' order top to bottom, as indices into the input. */
  order: number[];
  /** Between each photo and the next (in `order`): how many lines they shared, or null if no overlap was found. */
  joins: Array<{ shared: number } | null>;
}

/**
 * Joins photos of one receipt, taken top to bottom with some overlap, into one list of lines.
 * Photos given in the wrong order are put right when their overlaps show the order.
 */
export function stitchPhotos(photos: OcrLine[][]): Stitched {
  const order = bestOrder(photos);
  let lines = [...photos[order[0]]];
  const joins: Stitched['joins'] = [];
  for (const index of order.slice(1)) {
    const next = photos[index];
    const join = findJoin(lines, next);
    if (join) {
      lines = joinTwo(lines, next, join);
      joins.push({ shared: join.steps.filter((s) => s.step === 'both').length });
    } else {
      // No overlap found: put the photo after the others and let the person know.
      lines = [...lines, ...next];
      joins.push(null);
    }
  }
  // One continuous receipt: positions now just follow the joined order.
  return { lines: lines.map((l, i) => ({ ...l, y: i * 100 })), order, joins };
}
