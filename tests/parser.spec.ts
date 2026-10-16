import { describe, expect, it } from 'vitest';
import { findDateInText } from '../src/parser/dates';
import { learnHints } from '../src/parser/hints';
import { extractAmounts, parseMoneyInput } from '../src/parser/money';
import { parseReceipt } from '../src/parser/parse';
import { parseForShop } from '../src/parser/read-for-shop';
import { matchStore, storeKey } from '../src/parser/store-match';
import { fixCurrency, fixDigits, normalizeText } from '../src/parser/text';
import type { OcrLine } from '../src/parser/types';

const TODAY = '2026-10-08';

/** One OCR line per text line; "# " marks a line printed big (store names). */
function ocr(receipt: string): OcrLine[] {
  return receipt
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .map((l, i) => {
      const big = l.startsWith('# ');
      return { text: big ? l.slice(2) : l, confidence: 0.95, y: i * 30, height: big ? 40 : 20 };
    });
}

const SUPERMARKET = ocr(`
  # SUPER U FLACQ
  Flacq Shopping Mall
  VAT No: VAT20123456
  BRN: C07012345
  Tel: 413 1234
  Date: 08/10/2026 14:32  Till 3
  6001234567890 LAIT UHT 1L     45.00 V
  PAIN MAISON                   25.00 Z
  COCA COLA 1.5L
  2 X 65.00                    130.00 V
  BANANES
  0.856 KG @ 120.00/KG         102.72 Z
  PROMO COCA                   -10.00
  SUBTOTAL                     292.72
  TOTAL                        292.72
  CASH                         300.00
  CHANGE                         7.28
  VAT 15%                       22.83
  Thank you!
`);

const RESTAURANT = ocr(`
  # LE CAFE DES ARTS
  Rue du Vieux Conseil, Port Louis
  08 OCT 26  12:45
  Table 4
  1 SALADE CESAR        350.00
  1 STEAK FRITES        650.00
  2 JUS ORANGE          240.00
  SOUS-TOTAL          1,240.00
  TVA 15%               161.74
  NET A PAYER         1,240.00
  CARTE VISA          1,240.00
  ************1234
  MERCI
`);

const FUEL = ocr(`
  # INDIAN OIL
  Station Ebene
  2026-10-07 08:15
  UNLEADED 25.10 L @ 59.76
  TOTAL MUR 1,500.00
  JUICE 1,500.00
`);

const HARDWARE = ocr(`
  # QUINCAILLERIE ABC
  03/10/2026
  VIS 6MM X100     150.00
  COLLE BOIS       300.00
  A REGLER         450.00
  ESPECES          500.00
  RENDU             50.00
`);

// A real receipt: the "NET TOTAL" is before tax, what was paid is the "TAX. INCL." line, by SBM card.
const INTERMART = ocr(`
  # INTERMART
  Partenaire Intermarché
  BEAU PLAN DISTRIBUTION LTD
  Mahogany Shopping Promenade
  Beau Plan Pamplemousses
  BRN:C18161270 / VAT:27670358
  TEL:260 7788 / FAX:245 8989
  VAT INVOICE
  9101400600200017031 8
  07/10/2025 13:07:29Sales Ticket No. 170318
  Cashier 104 104 104
  E0075sKmJ 00148925 3.0.16-23.27 Pos 006
  1 Qt Description UP TTL
  A 1x VARTA MAXI TECH 470 Rs229.00 Rs229.00
  1 LINE 1 PRODUCT
  V.A.T. Rate Am.NET Am.VAT Am.TTL
  A 15% Rs199.13 Rs29.87 Rs229.00
  NET TOTAL Rs199.13
  NET ALL TAX. INCL. Rs229.00
  SBM Rs229.00
  Print receipt: 1x
  MERCI DE VOTRE VISITE ET A BIENTOT!
  PRESENTER TICKET ORIGINAL POUR TOUTES
  RECLAMATIONS DANS UN DELAI DE 5 JOURS
  Voir conditions à l'accueil
  Fiscalisé
`);

describe('money', () => {
  it('reads amounts in either decimal style, as cents', () => {
    expect(extractAmounts('1,234.50').map((a) => a.value)).toEqual([123450]);
    expect(extractAmounts('1.234,50').map((a) => a.value)).toEqual([123450]);
    expect(extractAmounts('Rs45.00').map((a) => a.value)).toEqual([4500]);
  });
  it('reads leading and trailing minus signs', () => {
    expect(extractAmounts('-12.00').map((a) => a.value)).toEqual([-1200]);
    expect(extractAmounts('VOID 12.00-').map((a) => a.value)).toEqual([-1200]);
  });
  it('ignores dates, percentages and 3-decimal weights', () => {
    expect(extractAmounts('08.10.26 15% 0.856')).toEqual([]);
  });
  it('repairs OCR letter/digit confusion inside numbers only', () => {
    expect(fixDigits('LAIT 45.0O')).toBe('LAIT 45.00');
    expect(fixDigits('SOLO 1l2,50')).toBe('SOLO 112,50');
    expect(fixDigits('RS229.00')).toBe('RS229.00'); // the S of "Rs" is not a 5
    expect(fixDigits('RS13,44B.74')).toBe('RS13,448.74');
    expect(fixDigits('45.00B')).toBe('45.00B'); // a trailing B is a VAT code
  });
  it('repairs a misread "Rs" and a misplaced decimal point', () => {
    expect(fixCurrency('R8319.30 RB259.95 RR144.95')).toBe('RS319.30 RS259.95 RS144.95');
    expect(fixCurrency('RS109 95')).toBe('RS109.95');
    expect(fixCurrency('RS44 . 00')).toBe('RS44.00');
    expect(fixCurrency('RS229.00 R138.00')).toBe('RS229.00 R138.00');
  });
  it('reads "2×" as a quantity', () => {
    expect(normalizeText('A 2× APTA')).toBe('A 2X APTA');
  });
  it('does not take the end of a dashed code for a price', () => {
    expect(extractAmounts('B00751HK7 00069818 3.0.16-23.27 Pos 008')).toEqual([]);
  });
  it('parses typed amounts', () => {
    expect(parseMoneyInput('12.5')).toBe(1250);
    expect(parseMoneyInput('1,234.50')).toBe(123450);
    expect(parseMoneyInput('abc')).toBeNull();
  });
});

describe('dates', () => {
  it('is day-first by default', () => {
    expect(findDateInText('08/10/2026')).toEqual({ iso: '2026-10-08', order: 'DMY' });
  });
  it('switches to month-first only when day-first is impossible or preferred', () => {
    expect(findDateInText('10/13/2026')?.iso).toBe('2026-10-13');
    expect(findDateInText('10/03/2026', 'MDY')?.iso).toBe('2026-10-03');
  });
  it('reads ISO and month-name dates', () => {
    expect(findDateInText('2026-10-08 08:15')?.iso).toBe('2026-10-08');
    expect(findDateInText('08 OCT 26')?.iso).toBe('2026-10-08');
    expect(findDateInText('8 OCTOBRE 2026')?.iso).toBe('2026-10-08');
  });
  it('rejects impossible dates', () => {
    expect(findDateInText('31/02/2026')).toBeNull();
  });
});

describe('parseReceipt: supermarket', () => {
  const r = parseReceipt(SUPERMARKET, { today: TODAY });

  it('finds the essentials', () => {
    expect(r.storeName).toBe('Super U Flacq');
    expect(r.taxId).toBe('VAT20123456');
    expect(r.date).toBe('2026-10-08');
    expect(r.total).toBe(29272);
    expect(r.totalConfidence).toBe('high'); // cash − change = total
    expect(r.paymentMethod).toBe('cash');
    expect(r.vatTotal).toBe(2283);
    expect(r.currency).toBe('MUR');
    expect(r.warnings).toEqual([]);
  });

  it('reads normal, multi-buy, weighed and discount lines', () => {
    expect(r.items).toEqual([
      { name: 'LAIT UHT 1L', qty: 1, unitPrice: 4500, lineTotal: 4500, vatCode: 'V', kind: 'item' },
      { name: 'PAIN MAISON', qty: 1, unitPrice: 2500, lineTotal: 2500, vatCode: 'Z', kind: 'item' },
      { name: 'COCA COLA 1.5L', qty: 2, unitPrice: 6500, lineTotal: 13000, vatCode: 'V', kind: 'item' },
      { name: 'BANANES', qty: 0.856, unitPrice: 12000, lineTotal: 10272, vatCode: 'Z', kind: 'item' },
      { name: 'PROMO COCA', qty: 1, unitPrice: -1000, lineTotal: -1000, vatCode: undefined, kind: 'discount' },
    ]);
    expect(r.itemsSum).toBe(29272);
    expect(r.itemsAddUp).toBe(true);
  });

  it('marks the items the reader was unsure of, so the person can check them', () => {
    // Blurred: the name line of a two-line item, and a discount.
    const blurred = (text: string) => (/^COCA COLA|^PROMO/.test(text) ? 0.6 : 0.95);
    const read = parseReceipt(
      SUPERMARKET.map((l) => ({ ...l, confidence: blurred(l.text) })),
      { today: TODAY },
    );
    expect(read.items.filter((i) => i.unclear).map((i) => i.name)).toEqual(['COCA COLA 1.5L', 'PROMO COCA']);
  });
});

describe('parseReceipt: restaurant (French, card, leading quantities)', () => {
  const r = parseReceipt(RESTAURANT, { today: TODAY });

  it('finds the essentials', () => {
    expect(r.storeName).toBe('Le Cafe Des Arts');
    expect(r.date).toBe('2026-10-08');
    expect(r.total).toBe(124000);
    expect(r.totalConfidence).toBe('high');
    expect(r.totalLabel).toBe('NET A PAYER');
    expect(r.paymentMethod).toBe('card');
    expect(r.vatTotal).toBe(16174);
  });

  it('reads leading quantities and checks the items add up', () => {
    expect(r.items.map((i) => [i.name, i.qty, i.unitPrice])).toEqual([
      ['SALADE CESAR', 1, 35000],
      ['STEAK FRITES', 1, 65000],
      ['JUS ORANGE', 2, 12000],
    ]);
    expect(r.itemsAddUp).toBe(true);
  });
});

describe('parseReceipt: Intermart (total before tax printed above the amount paid)', () => {
  const r = parseReceipt(INTERMART, { today: TODAY });

  it('takes the amount paid with tax, never the total before tax', () => {
    expect(r.total).toBe(22900);
    expect(r.totalConfidence).toBe('high'); // the SBM card payment confirms it
    expect(r.vatTotal).toBe(2987);
  });

  it('finds the other essentials', () => {
    expect(r.storeName).toBe('Intermart');
    expect(r.taxId).toBe('C18161270');
    expect(r.date).toBe('2025-10-07');
    expect(r.paymentMethod).toBe('card');
    expect(r.warnings).toEqual([]);
  });

  it('reads the one product, not the VAT breakdown row', () => {
    expect(r.items).toEqual([{ name: 'VARTA MAXI TECH 470', qty: 1, unitPrice: 22900, lineTotal: 22900, vatCode: 'A', kind: 'item' }]);
    expect(r.itemsAddUp).toBe(true);
  });

  // What the OCR actually produced on the photo: the "Am.TTL" heading wrapped onto its own
  // line ("TL") and the "%" of "15%" misread, which made "TL — 15 × Rs 15.27" look like a product.
  const asRead = (heading: boolean) =>
    INTERMART.flatMap((line) => {
      if (line.text.startsWith('V.A.T.')) return heading ? [{ ...line, text: 'V.A.T. Rate Am.NET Am.VAT Am.T' }, { ...line, y: line.y + 1, text: 'TL' }] : [{ ...line, text: 'TL' }];
      if (line.text.startsWith('A 15%')) return [{ ...line, text: 'A 15x Rs199.13 Rs29.87 Rs229.00' }];
      return [line];
    });

  it('stops reading items at the VAT table heading', () => {
    const read = parseReceipt(asRead(true), { today: TODAY });
    expect(read.items.map((i) => i.name)).toEqual(['VARTA MAXI TECH 470']);
    expect(read.vatTotal).toBe(2987);
  });

  it('recognises a VAT row by its arithmetic even when the "%" is misread', () => {
    const read = parseReceipt(asRead(false), { today: TODAY });
    expect(read.items.map((i) => i.name)).toEqual(['VARTA MAXI TECH 470']);
    expect(read.itemsAddUp).toBe(true);
  });
});

describe('parseReceipt: long Intermart receipt as OCR really reads it', () => {
  // Shortened from a real 84-line receipt, with the misreads the OCR actually made:
  // "R8"/"RB" for "Rs", "×" and "Ix" for "1x", "8" for the VAT letter B, "41x" for "A 1x",
  // a comma in "TAX, INCL.", payment by my.t, and a product called POP CORN.
  const r = parseReceipt(
    ocr(`
      # INTERMART
      27/09/2026 17:41:14 Sales Ticket No. 85483
      Cashier 103 103 103
      B00751HK7 00069818 3.0.16-23.27 Pos 008
      1 Qt Description UP TTL
      B 12× PERETTE VANILLE 250 R834.50 RS414.00
      8 1X TETLEY TEA B BLK TE R8319.30 R8319.30
      B C/CHOICE LAMB SHLD FZ AUS
      0.714 kg x Rs559.90/kg R8399.53
      C IX FLAMBOYANT EMBERIQUE RS46.00 RS46.00
      C 1x BEST FOOD POP CORN 50 Rs38.50 Rs38.50
      41x YEOS DARK SOY SAUCE 1 RS52.00 RS52.00
      6 LINES 17 PRODUCTS
      V.A.T. Rate Am.NET Am.VAT Am.T
      A 15%Rs1,103.77 Rs165.56 Rs1,269.33
      NET TOTAL Rs1,103.77
      NET ALL TAX, INCL. Rs1,269.33
      MY.T Rs1,269.33
    `),
    { today: TODAY },
  );

  it('gets the essentials, paid by my.t (not by the POP in "POP CORN")', () => {
    expect(r.date).toBe('2026-09-27');
    expect(r.total).toBe(126933);
    expect(r.totalConfidence).toBe('high');
    expect(r.paymentMethod).toBe('mobile');
    expect(r.vatTotal).toBe(16556);
  });

  it('reads every item with its VAT letter, quantity and price, and they add up', () => {
    expect(r.items.map((i) => [i.name, i.qty, i.unitPrice, i.lineTotal, i.vatCode])).toEqual([
      ['PERETTE VANILLE 250', 12, 3450, 41400, 'B'],
      ['TETLEY TEA B BLK TE', 1, 31930, 31930, 'B'],
      ['C/CHOICE LAMB SHLD FZ AUS', 0.714, 55990, 39953, 'B'],
      ['FLAMBOYANT EMBERIQUE', 1, 4600, 4600, 'C'],
      ['BEST FOOD POP CORN 50', 1, 3850, 3850, 'C'],
      ['YEOS DARK SOY SAUCE 1', 1, 5200, 5200, undefined],
    ]);
    expect(r.itemsAddUp).toBe(true);
  });
});

describe('parseReceipt: total before tax with no payment line', () => {
  it('adds the printed VAT when the amount with tax appears on the receipt', () => {
    const r = parseReceipt(ocr(`
      # SHOP
      LAMPE LED          100.00
      NET TOTAL          100.00
      VAT 15%             15.00
      AMOUNT             115.00
    `), { today: TODAY });
    expect(r.total).toBe(11500);
  });

  it('never takes a total marked as excluding tax', () => {
    const r = parseReceipt(ocr(`
      # SHOP
      TOTAL HT           100.00
      TVA 15%             15.00
      TOTAL TTC          115.00
    `), { today: TODAY });
    expect(r.total).toBe(11500);
  });
});

describe('parseReceipt: fuel (no readable items)', () => {
  const r = parseReceipt(FUEL, { today: TODAY });

  it('still gets every essential', () => {
    expect(r.storeName).toBe('Indian Oil');
    expect(r.date).toBe('2026-10-07');
    expect(r.total).toBe(150000);
    expect(r.totalConfidence).toBe('high');
    expect(r.paymentMethod).toBe('mobile');
  });

  it('flags items that do not add up instead of keeping them', () => {
    expect(r.itemsAddUp).toBe(false);
    expect(r.warnings).toContain('items-mismatch');
  });
});

describe('parseReceipt: discounts printed only as a summary', () => {
  const r = parseReceipt(
    ocr(`
      # WINNERS
      Date 05/10/2026
      RIZ BASMATI 1KG   95.00
      HUILE 1L         120.00
      TOTAL            205.00
      CASH             205.00
      YOU SAVED         10.00
    `),
    { today: TODAY },
  );

  it('adds the savings as one discount line so the items add up', () => {
    expect(r.discountTotal).toBe(1000);
    expect(r.items.at(-1)).toMatchObject({ name: 'Discounts', lineTotal: -1000, kind: 'discount' });
    expect(r.itemsAddUp).toBe(true);
  });

  it('keeps pack sizes in the name rather than reading them as weights', () => {
    expect(r.items[0]).toMatchObject({ name: 'RIZ BASMATI 1KG', qty: 1, lineTotal: 9500 });
  });
});

describe('parseReceipt: quantity lines next to the item', () => {
  it('attaches a quantity printed under the item', () => {
    const r = parseReceipt(ocr(`
      # SHOP
      YAOURT NATURE      90.00
      3 X 30.00
      TOTAL              90.00
    `), { today: TODAY });
    expect(r.items).toEqual([{ name: 'YAOURT NATURE', qty: 3, unitPrice: 3000, lineTotal: 9000, vatCode: undefined, kind: 'item' }]);
  });

  it('attaches a quantity printed above the item', () => {
    const r = parseReceipt(ocr(`
      # SHOP
      2 X 45.00
      SAVON              90.00
      TOTAL              90.00
    `), { today: TODAY });
    expect(r.items).toEqual([{ name: 'SAVON', qty: 2, unitPrice: 4500, lineTotal: 9000, vatCode: undefined, kind: 'item' }]);
  });

  it('attaches a per-kg weight line printed under the item', () => {
    const r = parseReceipt(ocr(`
      # SHOP
      TOMATES           102.72
      0.856 KG @ 120.00/KG
      TOTAL             102.72
    `), { today: TODAY });
    expect(r.items).toEqual([{ name: 'TOMATES', qty: 0.856, unitPrice: 12000, lineTotal: 10272, vatCode: undefined, kind: 'item' }]);
    expect(r.itemsAddUp).toBe(true);
  });

  it('keeps a quantity line as its own item when no neighbour carries its total', () => {
    const r = parseReceipt(ocr(`
      # SHOP
      Port Louis
      COLGATE
      2 X 45.00
      SAVON              30.00
      TOTAL             120.00
    `), { today: TODAY });
    expect(r.items.map((i) => [i.name, i.qty, i.lineTotal])).toEqual([
      ['COLGATE', 2, 9000],
      ['SAVON', 1, 3000],
    ]);
    expect(r.itemsAddUp).toBe(true);
  });
});

describe('learned store hints', () => {
  it('falls back to the largest amount, with low confidence, when the total label is unknown', () => {
    const r = parseReceipt(HARDWARE, { today: TODAY });
    expect(r.total).toBe(45000);
    expect(r.totalConfidence).toBe('low');
    expect(r.warnings).toContain('low-confidence');
  });

  it('learns the total label from a confirmed receipt and uses it next time', () => {
    const hints = learnHints(HARDWARE, { total: 45000, date: '2026-10-03' });
    expect(hints.totalLabel).toBe('A REGLER');
    const r = parseReceipt(HARDWARE, { today: TODAY, hints });
    expect(r.total).toBe(45000);
    expect(r.totalConfidence).toBe('high');
    expect(r.warnings).toEqual([]);
  });

  it("reads a known shop's receipt with what was learned about it", () => {
    // No usual total label, and a bigger amount below it: the general rules pick the wrong one.
    const lines = ocr(`
      # QUINCAILLERIE ABC
      03/10/2026
      VIS 6MM X100     150.00
      COLLE BOIS       300.00
      A REGLER         450.00
      CUMUL ANNUEL    5200.00
    `);
    expect(parseForShop(lines, [], { today: TODAY }).total).toBe(520000);
    const shop = { name: 'Quincaillerie ABC', aliases: [], taxId: null, hints: learnHints(HARDWARE, { total: 45000, date: '2026-10-03' }) };
    expect(parseForShop(lines, [shop], { today: TODAY }).total).toBe(45000);
    // Another shop's hints don't apply.
    expect(parseForShop(lines, [{ ...shop, name: 'Winners' }], { today: TODAY }).total).toBe(520000);
  });

  it('learns month-first dates only when the confirmed date proves it', () => {
    const lines = ocr(`
      # US STORE
      10/03/2026
      TOTAL 20.00
    `);
    expect(parseReceipt(lines, { today: TODAY }).date).toBe('2026-03-10');
    const hints = learnHints(lines, { total: 2000, date: '2026-10-03' });
    expect(hints.dateOrder).toBe('MDY');
    expect(parseReceipt(lines, { today: TODAY, hints }).date).toBe('2026-10-03');
    // 03/10 confirmed as 3 October proves day-first.
    expect(learnHints(HARDWARE, { total: 45000, date: '2026-10-03' }).dateOrder).toBe('DMY');
  });

  it('learns nothing from a date only one order can read', () => {
    const lines = ocr(`
      # SHOP
      25/09/2026
      TOTAL 20.00
    `);
    expect(learnHints(lines, { total: 2000, date: '2026-09-25' }).dateOrder).toBeUndefined();
  });
});

describe('store matching', () => {
  const stores = [
    { id: 1, name: 'Super U Flacq', aliases: [], taxId: 'VAT20123456' },
    { id: 2, name: 'Winners Ltd', aliases: ['WINNERS GOODLANDS'] },
    { id: 3, name: 'Intermart', aliases: [] },
  ];

  it('matches by tax ID first, whatever the OCR made of the name', () => {
    expect(matchStore({ name: 'SUP3R V FLAC', taxId: 'VAT 20123456' }, stores)).toMatchObject({ store: { id: 1 }, by: 'taxId' });
  });
  it('matches names fuzzily, ignoring company suffixes', () => {
    expect(storeKey('Winners Ltd.')).toBe('WINNERS');
    expect(matchStore({ name: 'WINNERS', taxId: null }, stores)?.store.id).toBe(2);
    expect(matchStore({ name: 'INTERMAR', taxId: null }, stores)?.store.id).toBe(3);
    expect(matchStore({ name: 'Super U', taxId: null }, stores)?.store.id).toBe(1);
  });
  it('returns null for a new shop', () => {
    expect(matchStore({ name: 'Pharmacie Nouvelle', taxId: null }, stores)).toBeNull();
  });
});

describe('known supermarket chains', () => {
  const name = (receipt: string) => parseReceipt(ocr(receipt), { today: TODAY }).storeName;
  const rest = `
    08/10/2026 14:32
    LAIT UHT 1L     45.00
    TOTAL           45.00
  `;

  it('spells a misread chain name properly', () => {
    expect(name(`# W1NNERS\n${rest}`)).toBe('Winners');
    expect(name(`# WIN NERS\n${rest}`)).toBe('Winners');
    expect(name(`# CARREF0UR\n${rest}`)).toBe('Carrefour');
    expect(name(`# lNTERMAR\n${rest}`)).toBe('Intermart');
    expect(name(`# SUP3R V FLAC\n${rest}`)).toBe('Super U');
  });
  it('finds the chain on another top line, or in its web address, when the name line is something else', () => {
    expect(name(`# TAYLOR SMITH RETAIL LTD\nWINNERS GRAND BAIE\n${rest}`)).toBe('Winners');
    expect(name(`# BEAU PLAN RETAIL LTD\n${rest}\nwww.winners.mu`)).toBe('Winners');
  });
  it('keeps a name that reads right, branch and all', () => {
    expect(name(`# SUPER U FLACQ\n${rest}`)).toBe('Super U Flacq');
  });
  it('leaves other shops alone', () => {
    expect(name(`# ANAND SUPER MARKET\n${rest}`)).toBe('Anand Super Market');
    expect(name(`# SPARKLE CLEANERS\n${rest}`)).toBe('Sparkle Cleaners');
    // A shop inside a supermarket's mall prints the supermarket in its address.
    expect(name(`# PHARMACIE DU CENTRE\nSuper U Complex, Grand Baie\n${rest}`)).toBe('Pharmacie Du Centre');
  });
});
