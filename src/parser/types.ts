/** One line of text as read by OCR, top-to-bottom order. */
export interface OcrLine {
  text: string;
  /** 0..1 */
  confidence: number;
  /** Top of the line in image pixels. */
  y: number;
  /** Text height in pixels — a proxy for font size (store names are usually printed biggest). */
  height: number;
}

export type PaymentMethod = 'cash' | 'card' | 'mobile' | 'other';
export type Confidence = 'high' | 'medium' | 'low';
export type DateOrder = 'DMY' | 'MDY' | 'YMD';

export interface ParsedItem {
  name: string;
  qty: number;
  /** cents */
  unitPrice: number;
  /** cents; negative for discounts / voids / rounding */
  lineTotal: number;
  vatCode?: string;
  kind: 'item' | 'discount';
  /** The reader wasn't sure of the line it came from: worth checking by eye. */
  unclear?: boolean;
}

/** Per-store knowledge learned from the user's confirmed receipts. */
export interface StoreHints {
  /** Normalised label of the line that held the confirmed total, e.g. "NET A PAYER". */
  totalLabel?: string;
  dateOrder?: DateOrder;
}

export interface ParsedReceipt {
  storeName: string | null;
  taxId: string | null;
  /** ISO YYYY-MM-DD */
  date: string | null;
  dateOrder: DateOrder | null;
  /** cents */
  total: number | null;
  totalConfidence: Confidence;
  /** Normalised label text of the total line (for learning store hints). */
  totalLabel: string | null;
  currency: string;
  paymentMethod: PaymentMethod | null;
  vatTotal: number | null;
  discountTotal: number | null;
  items: ParsedItem[];
  /** Σ item lineTotals, cents */
  itemsSum: number;
  /** True when the items add up to the total (within tolerance) — only then are items kept. */
  itemsAddUp: boolean;
  warnings: ParseWarning[];
}

export type ParseWarning = 'no-store' | 'no-total' | 'no-date' | 'date-implausible' | 'items-mismatch' | 'low-confidence';
