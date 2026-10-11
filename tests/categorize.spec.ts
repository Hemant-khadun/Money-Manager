import { describe, expect, it } from 'vitest';
import { categorizeItem, guessShopCategory, productKey, ruleCategory } from '../src/categorize/categorize';
import { splitTotal } from '../src/categorize/split';

describe('ruleCategory: item names as read from the long Intermart receipt', () => {
  const cases: Array<[string, string]> = [
    ['LAYS PAPRIKA 1300', 'groceries.snacks'],
    ['TETLEY TEA B BLK TE', 'groceries.drinks'],
    ['MAREMER ORED F1SH F', 'groceries.meat'],
    ['C/CHOICE LAMB SHLD FZ AUS', 'groceries.meat'],
    ['I/SEAFOOD LUNE DOREE SLIC', 'groceries.meat'],
    ['0LD EL PAS0 6 WRAPS', 'groceries.bakery'],
    ['INT P1ZZA BASE X2', 'groceries.bakery'],
    ['SAMYANG CHKN DMPLNG', 'groceries.pantry'],
    ['365JR EDC NATURELLE', 'personal'],
    ['APTA PAPIER CUISSON', 'household'],
    ['GF BURGER X6 345GM', 'groceries.meat'],
    ['GF HOT D0G ROLLS 200G', 'groceries.bakery'],
    ['APOLLO CHICKEN 85G', 'groceries.pantry'],
    ['BEST F00D LENTILLE BL', 'groceries.pantry'],
    ['ORIENT DHOLL GRAMME 5', 'groceries.pantry'],
    ['BEST FOOD POP CORN 50', 'groceries.snacks'],
    ['BOKOMO N S MORNING', 'groceries.pantry'],
    ['PANZANI TORTI 500G', 'groceries.pantry'],
    ['F/STEAD MINI CHK FRA', 'groceries.meat'],
    ['MELBOURNE CHEDDAR CHE', 'groceries.dairy'],
    ['FREEDENT MENTHE VER', 'groceries.snacks'],
    ['MAGGI SOUP POULE VRMC', 'groceries.pantry'],
    ['JULIE SUGAR CRACKER', 'groceries.snacks'],
    ['C LEGER SAUCE BECHAME', 'groceries.pantry'],
    ['GLENRYCK PILCHARD TO', 'groceries.pantry'],
    ['BIO LAB DCHE ABRICO', 'personal'],
    ['PAP WET WIPES X100 RO', 'personal'],
    ['TROPICAL TUNA FLAKES', 'groceries.pantry'],
    ['EB BAKING SODA FLACON', 'groceries.pantry'],
    ['REGAL PEAS & CARROTS', 'groceries.pantry'],
    ['EB ESSENCE CULINAIRE', 'groceries.pantry'],
    ['YEOS DARK SOY SAUCE 1', 'groceries.pantry'],
    ['SUMO DISH WASH PST LE', 'household'],
    ['CHAB VERMICELLE MUL', 'groceries.pantry'],
    ['MAGGI CHICKEN CUBE 60', 'groceries.pantry'],
    ['SENSODYNE TP COMP P', 'personal'],
    ['COCON PUDDNG STRAWBER', 'groceries.snacks'],
    ['KO STORAGE JAR PP TW', 'household'],
    ['HAPPY SPICY PEANUT 15', 'groceries.snacks'],
    ['COLGATE TP JR MENTH', 'personal'],
    ['LENOR JASMIN ROSE 1', 'household'],
    ['ST ELOI MAIS DOU SANS', 'groceries.pantry'],
    ['LU PRINCE TOUT CHOC', 'groceries.snacks'],
    ['JEWEL BLOC WC R EAU', 'household'],
    ['TOP BGT DESO MARINE 3', 'personal'],
    ['KO SIAKI UTILITY KN', 'household'],
    ['AQ CABLE TIES (WHIT', 'home'],
    ['EH SCISSORS SS SET', 'household'],
    ['KO UTILITY KNIFE SS', 'household'],
    ['CBON VSL POMME 5L', 'household'],
    ['VARTA MAXI TECH 470', 'electronics'],
  ];
  for (const [name, category] of cases) {
    it(`${name} → ${category}`, () => expect(ruleCategory(name)).toBe(category));
  }

  it('leaves names it has no clue about to the shop', () => {
    expect(ruleCategory('PERETTE VANILLE 250')).toBeNull();
  });
});

describe('categorizeItem', () => {
  it('uses what the person taught it first, despite OCR spelling', () => {
    const products = [{ key: productKey('PERETTE VANILLE 250'), name: 'PERETTE VANILLE 250', categoryId: 'groceries.dairy' }];
    expect(categorizeItem('PERETTE VANILLE 25O', 'groceries', products)).toEqual({ categoryId: 'groceries.dairy', source: 'learned' });
  });

  it('falls back to the shop for unknown items', () => {
    expect(categorizeItem('PERETTE VANILLE 250', 'groceries', [])).toEqual({ categoryId: 'groceries', source: 'shop' });
  });

  it('counts everything at a restaurant as the meal', () => {
    expect(categorizeItem('STEAK FRITES', 'dining', [])).toEqual({ categoryId: 'dining', source: 'shop' });
    expect(categorizeItem('JUS ORANGE', 'dining', [])).toEqual({ categoryId: 'dining', source: 'shop' });
  });

  it('still sorts a pharmacy or fuel station shop by item', () => {
    expect(categorizeItem('COLGATE TOTAL', 'health', []).categoryId).toBe('personal');
    expect(categorizeItem('PANADOL 24 TABLETS', 'health', []).categoryId).toBe('health');
    expect(categorizeItem('COCA COLA 500ML', 'transport', []).categoryId).toBe('groceries.drinks');
    expect(categorizeItem('UNLEADED 25.10 L', 'transport', []).categoryId).toBe('transport');
  });
});

describe('guessShopCategory', () => {
  it('reads the kind of shop from its name', () => {
    expect(guessShopCategory('Intermart', [])).toBe('groceries');
    expect(guessShopCategory('Pardenaire Intermarche', [])).toBe('groceries');
    expect(guessShopCategory('Pharmacie Nouvelle', [])).toBe('health');
    expect(guessShopCategory('Indian Oil', [])).toBe('transport');
    expect(guessShopCategory('Le Cafe Des Arts', [])).toBe('dining');
    expect(guessShopCategory('Quincaillerie ABC', [])).toBe('home');
  });

  it('otherwise goes by what it sold', () => {
    const groceries = [
      { name: 'LAIT UHT 1L', lineTotal: 4500 },
      { name: 'PAIN MAISON', lineTotal: 2500 },
      { name: 'COLGATE TP', lineTotal: 6000 },
    ];
    expect(guessShopCategory('ABC Ltd', groceries)).toBe('groceries');
    expect(guessShopCategory('XYZ', [{ name: 'VARTA AA', lineTotal: 22900 }])).toBe('electronics');
    expect(guessShopCategory(null, [])).toBe('other');
  });
});

describe('splitTotal', () => {
  it('shares the total by category, spreading discounts, adding up to the cent', () => {
    const items = [
      { categoryId: 'groceries.meat', lineTotal: 39953, kind: 'item' as const },
      { categoryId: 'personal', lineTotal: 11000, kind: 'item' as const },
      { categoryId: 'groceries.meat', lineTotal: 37849, kind: 'item' as const },
      { categoryId: 'household', lineTotal: 19495, kind: 'item' as const },
      { categoryId: 'household', lineTotal: -1000, kind: 'discount' as const },
    ];
    const split = splitTotal(107297, items, 'groceries');
    expect(split.reduce((s, x) => s + x.amount, 0)).toBe(107297);
    expect(split.map((s) => s.categoryId)).toEqual(['groceries.meat', 'household', 'personal']);
    expect(split[0].amount).toBeGreaterThan(77802 - 1000); // its share of the discount, no more
  });

  it('puts a receipt without items in its own category', () => {
    expect(splitTotal(150000, [], 'transport')).toEqual([{ categoryId: 'transport', amount: 150000 }]);
  });
});
