import { describe, expect, it } from 'vitest';
import { fixtureLines } from '../src/eval/fixture';
import { parseReceipt } from '../src/parser/parse';
import type { OcrLine } from '../src/parser/types';
import { continues, groupPhotos, stitchPhotos } from '../src/pipeline/stitch';

const TODAY = '2026-10-10';

/** A long receipt whose 24 items add up to the total. Repeated items make the joins harder. */
const ITEMS: Array<[string, number]> = [
  ['B 12x PERETTE VANILLE 250 Rs34.50', 41400],
  ['A 1x LAYS PAPRIKA 130G', 10995],
  ['B 1x TETLEY TEA B BLK TE', 31930],
  ['A 1x MIK CLASSIC CHOCOLA', 23995],
  ['B 1x MAREMER ORED FISH F', 25995],
  ['A 2x OLD EL PASO 6 WRAPS Rs229.95', 45990],
  ['B 1x INT PIZZA BASE X2', 4500],
  ['A 1x SAMYANG CHKN DMPLNG', 37495],
  ['A 2x 365JR EDC NATURELLE Rs67.00', 13400],
  ['A 2x APTA PAPIER CUISSON Rs69.95', 13990],
  ['B 1x GF BURGER X6 345GM', 6390],
  ['A 1x CINDERELLA S.CRUNCHY', 4400],
  ['B 8x APOLLO CURRY 85G Rs7.95', 6360],
  ['C 1x KING BRAND LENTILLE B', 3495],
  ['C 1x BEST FOOD LENTILLE BL', 3850],
  ['C 1x BEST FOOD POP CORN 50', 3850],
  ['A 1x C LEGER SAUCE BECHAME', 5495],
  ['A 1x C LEGER SAUCE HOLLAND', 5495],
  ['A 1x JULIE SUGAR CRACKER', 11995],
  ['B 1x COLGATE TP JR MENTH', 11000],
  ['A 1x KO UTILITY KNIFE SS', 14995],
  ['A 1x CBON VSL POMME 5L', 24995],
  ['A 1x C LEGER SAUCE BECHAME', 5495], // bought twice: the same line appears again
  ['A 1x JULIES WHEAT CRACKE', 12300],
];
const money = (c: number) => `Rs${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
const TOTAL = ITEMS.reduce((s, [, c]) => s + c, 0);

const RECEIPT: string[] = [
  'INTERMART',
  'BEAU PLAN DISTRIBUTION LTD',
  'BRN:C18161270 / VAT:27670358',
  '27/09/2026 17:41:14 Sales Ticket No. 85483',
  '1 Qt Description UP TTL',
  ...ITEMS.map(([name, c]) => `${name.includes(' Rs') ? name : `${name} ${money(c)}`} ${money(c)}`),
  `${ITEMS.length} LINES`,
  `NET ALL TAX. INCL. ${money(TOTAL)}`,
  `MY.T ${money(TOTAL)}`,
  'MERCI DE VOTRE VISITE ET A BIENTOT!',
];

const line = (text: string, i: number, confidence = 0.95): OcrLine => ({ text, confidence, y: i * 40, height: 30 });

/** One photo of receipt lines [from, to), as OCR might read it, with half-cut lines at the cut edges. */
function photo(from: number, to: number, opts: { garbleTop?: boolean; garbleBottom?: boolean; misread?: Record<number, string> } = {}): OcrLine[] {
  const lines = RECEIPT.slice(from, to).map((text, k) => {
    const i = from + k;
    const misread = opts.misread?.[i];
    return line(misread ?? text, k, misread ? 0.62 : 0.95);
  });
  if (opts.garbleTop) lines.unshift(line('A1x r .9 R', -1, 0.4));
  if (opts.garbleBottom) lines.push(line('C 1 BES F', lines.length, 0.45));
  return lines;
}

describe('stitchPhotos', () => {
  it('joins three overlapping photos into the receipt, every line once and in order', () => {
    const photos = [photo(0, 14, { garbleBottom: true }), photo(10, 24, { garbleTop: true, garbleBottom: true }), photo(20, RECEIPT.length, { garbleTop: true })];
    const { lines, order, joins } = stitchPhotos(photos);
    expect(order).toEqual([0, 1, 2]);
    expect(joins).toEqual([{ shared: 4 }, { shared: 4 }]);
    expect(lines.map((l) => l.text)).toEqual(RECEIPT);
  });

  it('keeps the clearer reading of a line both photos show', () => {
    // Line 12 is smudged in the first photo, clear in the second; line 20 the other way round.
    const photos = [
      photo(0, 14, { misread: { 12: 'A 1x SAMYANG CHKN DMPLNG Rs374.95 R374,95' } }),
      photo(10, 24, { misread: { 20: 'C 1x BES FOOD POP CORN 50 Rs38.50 Rs38.5O' } }),
      photo(20, RECEIPT.length),
    ];
    const { lines } = stitchPhotos(photos);
    expect(lines.map((l) => l.text)).toEqual(RECEIPT);
  });

  it('joins photos that share only three lines, though the second photo lost a word from one of them', () => {
    // The two halves of a test receipt as the reader read them: "HUILE TOURNESOL" came out as
    // "HUILE", and "SUCRE ROUX 1KG" gained a "1". Only the prices read the same.
    const top = ['INTERMART', 'Ebene,', 'No: 27670358', 'Date: 08/10/2026 14:32', 'LAIT UHT 1L 45.00', 'PAIN MAISON 25.00', 'COLGATE TP JR 110.00', 'PERETTE VANILLE 190.00'];
    const shared = ['RIZ BASMATI 1KG 120.00', 'HUILE TOURNESOL 165.00', 'SUCRE ROUX 1 1KG 60.00'];
    const sharedAgain = ['RIZ BASMATI 1KG 120.00', 'HUILE 165.00', 'SUCRE ROUX 1KG 60.00'];
    const rest = ['CAFE MOULU 250G 145.00', 'BEURRE 250G 140.00', 'TOTAL 1000.00', 'CASH 1000.00', 'CHANGE 0.00'];
    const read = (texts: string[]) => texts.map((t, i) => line(t, i));
    const { lines, joins } = stitchPhotos([read([...top, ...shared]), read([...sharedAgain, ...rest])]);
    expect(joins).toEqual([{ shared: 3 }]);
    expect(lines).toHaveLength(top.length + 3 + rest.length);
    expect(parseReceipt(lines, { today: TODAY })).toMatchObject({ total: 100000, itemsAddUp: true });
  });

  it('puts photos picked in the wrong order back in order', () => {
    const top = photo(0, 14);
    const middle = photo(10, 24);
    const bottom = photo(20, RECEIPT.length);
    const { lines, order } = stitchPhotos([bottom, top, middle]);
    expect(order).toEqual([1, 2, 0]);
    expect(lines.map((l) => l.text)).toEqual(RECEIPT);
  });

  it('is not fooled by an item that appears twice', () => {
    // The second photo starts right at the repeated "C LEGER SAUCE BECHAME" near the bottom.
    const repeat = RECEIPT.lastIndexOf(RECEIPT.find((t) => t.startsWith('A 1x C LEGER SAUCE BECHAME'))!);
    const photos = [photo(0, repeat + 3), photo(repeat, RECEIPT.length)];
    expect(stitchPhotos(photos).lines.map((l) => l.text)).toEqual(RECEIPT);
  });

  it('keeps photos that share no lines, one after the other, and says so', () => {
    const { lines, joins } = stitchPhotos([photo(0, 12), photo(12, RECEIPT.length)]);
    expect(joins).toEqual([null]);
    expect(lines.map((l) => l.text)).toEqual(RECEIPT);
  });

  it('gives line positions that follow the joined order', () => {
    const { lines } = stitchPhotos([photo(0, 14), photo(10, RECEIPT.length)]);
    for (let i = 1; i < lines.length; i++) expect(lines[i].y).toBeGreaterThan(lines[i - 1].y);
  });

  it('re-joins a saved long receipt from its photos when scoring it', () => {
    const photos = [photo(0, 14), photo(10, RECEIPT.length)];
    const fixture = {
      version: 1 as const,
      name: 'long',
      capturedAt: TODAY,
      ocr: { strategy: 'per-box', backend: 'wasm', ms: 0, lines: [], photos: photos.map((lines, i) => ({ name: `p${i}.jpg`, lines })) },
      expected: { checked: true, kind: 'supermarket' as const, store: 'Intermart', date: '2026-09-27', total: TOTAL, payment: 'mobile' as const, itemized: true },
    };
    expect(fixtureLines(fixture).map((l) => l.text)).toEqual(RECEIPT);
  });

  it('reads the joined receipt like one photo: shop, date, total and every item', () => {
    const photos = [photo(0, 14, { garbleBottom: true }), photo(10, 24, { garbleTop: true }), photo(20, RECEIPT.length)];
    const parsed = parseReceipt(stitchPhotos(photos).lines, { today: TODAY });
    expect(parsed.storeName).toBe('Intermart');
    expect(parsed.date).toBe('2026-09-27');
    expect(parsed.total).toBe(TOTAL);
    expect(parsed.items.filter((i) => i.kind === 'item')).toHaveLength(ITEMS.length);
    expect(parsed.itemsAddUp).toBe(true);
  });
});

describe('groupPhotos (which photos added together are one receipt)', () => {
  /** A short receipt from the same shop: same top and bottom lines as the long one, its own items. */
  const shortReceipt = (ticket: number, time: string, items: string[]) =>
    [
      'INTERMART',
      'BEAU PLAN DISTRIBUTION LTD',
      'BRN:C18161270 / VAT:27670358',
      `27/09/2026 ${time} Sales Ticket No. ${ticket}`,
      '1 Qt Description UP TTL',
      ...items,
      `${items.length} LINES`,
      'NET ALL TAX. INCL. Rs229.00',
      'SBM Rs229.00',
      'MERCI DE VOTRE VISITE ET A BIENTOT!',
    ].map((text, i) => line(text, i));

  const top = photo(0, 14, { garbleBottom: true });
  const middle = photo(10, 24, { garbleTop: true });
  const bottom = photo(20, RECEIPT.length);
  const battery = shortReceipt(170318, '13:07:29', ['A 1x VARTA MAXI TECH 470 Rs229.00 Rs229.00']);
  const coffee = shortReceipt(170401, '15:20:02', ['A 2x NESCAFE CLASSIC 50G Rs114.50 Rs229.00']);

  it('finds the three photos of the long receipt among separate receipts from the same shop', () => {
    // Added as: battery receipt, bottom of the long one, coffee receipt, top, middle.
    expect(groupPhotos([battery, bottom, coffee, top, middle])).toEqual([[0], [3, 4, 1], [2]]);
  });

  it('keeps separate receipts from the same shop apart, though they share their top and bottom lines', () => {
    expect(groupPhotos([battery, coffee])).toEqual([[0], [1]]);
    expect(continues(battery, coffee)).toBeNull();
  });

  it('keeps two receipts for the same purchase apart (only the time differs)', () => {
    const again = shortReceipt(170319, '13:09:51', ['A 1x VARTA MAXI TECH 470 Rs229.00 Rs229.00']);
    expect(groupPhotos([battery, again])).toEqual([[0], [1]]);
  });

  it('does not join a photo to one that adds nothing new (the same photo twice)', () => {
    expect(groupPhotos([top, top])).toEqual([[0], [1]]);
  });

  it('leaves photos that do not overlap as separate receipts', () => {
    expect(groupPhotos([photo(0, 12), photo(12, RECEIPT.length)])).toEqual([[0], [1]]);
  });
});
