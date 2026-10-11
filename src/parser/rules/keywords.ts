// Generic receipt vocabulary (English + French). All patterns run against upper-cased,
// accent-stripped text — see normalizeText().

/** "NET ALL TAX. INCL.", "TOTAL TTC", "VAT INCL": the amount with tax, which is what was paid. */
export const TAX_INCLUSIVE = /\b(?:ALL\s*)?TAX(?:ES)?[.,]?\s*INCL|\bINCL\w*[.,]?\s*(?:ALL\s*)?(?:VAT|TAX)|\bVAT\s*INCL|\bTTC\b|\bTOUTES\s*TAXES/;

/** Total labels, strongest first. */
export const TOTAL_LABELS: ReadonlyArray<readonly [RegExp, number]> = [
  [/\bGRAND\s*TOTAL\b/, 100],
  [TAX_INCLUSIVE, 98],
  [/\bTOTAL\s*(?:TTC|DUE|A\s*PAYER|TO\s*PAY|AMOUNT|MUR|RS)\b/, 95],
  [/\bNET\s*A?\s*PAYER\b/, 95],
  [/\b(?:AMOUNT|BALANCE)\s*DUE\b/, 90],
  [/\bTO\s*PAY\b/, 85],
  [/\bNET\s*TOTAL\b/, 85],
  [/\bTOTAL\b/, 80],
  [/\bMONTANT\b/, 60],
];

/** Lines that mention "total" but are not the amount paid (including totals before tax). */
export const NOT_TOTAL =
  /\b(?:SUB|SOUS)[\s-]*TOTAL|TOTAL\s*(?:VAT|TVA|TAX|HT|EXCL|ITEMS?|ARTICLES?|QTY|QUANTITY|SAVINGS?|DISCOUNTS?|REMISES?|POINTS?|PTS|QTE)\b|\b(?:VAT|TVA|TAX)\s*TOTAL|\b(?:HT|H\.T|EXCL\w*|HORS\s*TAXES?|BEFORE\s*(?:VAT|TAX)|PRE[-\s]?TAX)\b|TENDER|CHANGE|RENDU|MONNAIE|SAVED|ECONOMI|NO\.?\s*OF\s*ITEMS/;

/** Mauritian banks print their name on the card payment line ("SBM Rs229.00"). */
const BANKS = String.raw`MCB|SBM|ABSA|MAUBANK|AFRASIA|BANK\s*ONE|HSBC|BCP`;

/** my.t money prints as just "MY.T" on the payment line. */
const MY_T = String.raw`MY\.?\s?T(?:\s*MONEY)?`;

export const TENDERED = new RegExp(
  String.raw`\b(?:CASH|ESPECES|TENDERED|TENDER|PAID|PAYE|CARD|VISA|MASTER\s*CARD|MASTERCARD|AMEX|JUICE|BLINK|${MY_T}|${BANKS})\b`,
);
export const CHANGE = /\b(?:CHANGE|RENDU|MONNAIE)\b/;

export const PAYMENT_MOBILE = new RegExp(String.raw`\b(?:JUICE|BLINK|${MY_T}|MOBILE\s*MONEY|MAUCAS|POP)\b`);
export const PAYMENT_CARD = new RegExp(String.raw`\b(?:CARD|CARTE|VISA|MASTER\s*CARD|MASTERCARD|AMEX|DEBIT|CREDIT|EFT|CB|${BANKS})\b`);
export const PAYMENT_CASH = /\b(?:CASH|ESPECES|LIQUIDE)\b/;

/** VAT amount lines (not the VAT registration number). */
export const VAT_LINE = /\b(?:VAT|TVA|TAX)\b(?!\s*(?:NO|N°|NUM|REG|#|ID))/;
export const VAT_TOTAL_PREFERRED = /\b(?:TOTAL\s*(?:VAT|TVA|TAX)|(?:VAT|TVA|TAX)\s*(?:TOTAL|AMOUNT|AMT))\b/;

export const DISCOUNT_TOTAL = /\b(?:TOTAL\s*(?:DISCOUNTS?|SAVINGS?|REMISES?)|YOU\s*SAVED|VOUS\s*AVEZ\s*ECONOMISE|SAVINGS)\b/;
export const DISCOUNT_LINE = /\b(?:DISCOUNT|DISC|REMISE|PROMO|RABAIS|SAVING|OFFER|OFFRE|REDUCTION|VOID|ANNUL\w*|COUPON|ROUNDING|ARRONDI)\b/;

/** Registration numbers — the most reliable store fingerprint. Mauritian VAT numbers print as "VAT20123456". */
export const TAX_ID =
  /\b(?:VAT|TVA|BRN|TAN|TIN)\b[^A-Z0-9]{0,12}(?:REG(?:ISTRATION)?|NO|N°|NUM(?:BER)?|#)?[^A-Z0-9]{0,6}([A-Z]{0,3}\d{6,12})\b/;

/** Header / footer lines that are never items or store names. */
export const META =
  /\b(?:TEL|TEL\.|PHONE|FAX|MOBILE|WWW|HTTP|EMAIL|E-MAIL|CASHIER|CAISSIER|CAISSE|OPERATOR|OPERATEUR|TILL|RECEIPT|RECU|TICKET|INVOICE|FACTURE|TABLE|SERVER|SERVEUR|DATE|TIME|HEURE|THANK|THANKS|MERCI|WELCOME|BIENVENUE|LOYALTY|FIDELITE|POINTS?|MEMBER|AUTH|APPROVAL|APPROVED|TERMINAL|MID|TID|TRANS|TXN|REF|BATCH|ROAD|RD|STREET|ST|AVENUE|AVE|RUE|LANE|ALLEE|BRN|VAT\s*(?:NO|REG)|OPENING|HOURS|COPY|DUPLICATA|SIGNATURE|CUSTOMER|CLIENT)\b|@|\*{3,}|X{4,}\d/;

/** Lines that must never become items even though they carry an amount. */
export const NOT_ITEM =
  /\b(?:SUB|SOUS)[\s-]*TOTAL|\bTOTAL\b|\bNET\s*A?\s*PAYER\b|\bAMOUNT\s*DUE\b|\bBALANCE\b|\bTO\s*PAY\b|\bMONTANT\b|\b(?:VAT|TVA|TAX)\b|\bVATABLE\b|\bEXEMPT\b|\bZERO\s*RATED\b|TENDER|\bCHANGE\b|\bRENDU\b|\bCASH\b|\bESPECES\b|\bCARD\b|\bVISA\b|\bMASTERCARD\b|\bJUICE\b|\bPAID\b|\bITEMS?\b\s*[:#]?\s*\d+\s*$|\bARTICLES?\b\s*[:#]?\s*\d+\s*$|\bQTY\b\s*[:#]?\s*\d+\s*$/;

export const STORE_NOISE = /\b(?:LTD|LTEE|LIMITED|CO|COMPANY|SARL|PLC|INC|THE|MAURITIUS|MU)\b/g;

/** The first line like this closes the item list. */
export const END_OF_ITEMS = /\b(?:SUB|SOUS)[\s-]*TOTAL|\bTOTAL\b|\bNET\s*A?\s*PAYER\b|\b(?:AMOUNT|BALANCE)\s*DUE\b|\bTO\s*PAY\b/;

/** Column headings of a VAT breakdown, "V.A.T. Rate Am.NET Am.VAT": also closes the item list. */
const VAT_WORD = String.raw`\b(?:V\.?\s?A\.?\s?T|TVA|TAX)\b`;
const VAT_COLUMN = String.raw`\b(?:RATE|TAUX|NET|HT|AMT)\b`;
export const VAT_TABLE_HEADER = new RegExp(`${VAT_WORD}.*${VAT_COLUMN}|${VAT_COLUMN}.*${VAT_WORD}`);

/**
 * Lines inside the item list that are never items. Narrower than META: words like
 * "TABLE", "ST" or "REF" are common in product names.
 */
export const ITEM_SKIP =
  /\b(?:TEL|PHONE|FAX|CASHIER|CAISSIER|CAISSE|OPERATOR|OPERATEUR|TILL|LOYALTY|FIDELITE|POINTS?|PTS|MEMBER|AUTH|APPROVAL|APPROVED|TERMINAL|TID|MID|BATCH|THANK|THANKS|MERCI|WELCOME|BIENVENUE|BRN)\b|\b(?:RECEIPT|TICKET|INVOICE|FACTURE)\s*(?:NO|N°|#)|\bVAT\s*(?:NO|REG)|\b\d+\s*(?:LINES?|PRODUCTS?)\b|X{4,}\d|\*{4,}\d/;

export const ROUNDING = /\b(?:ROUNDING|ARRONDI)\b/;
