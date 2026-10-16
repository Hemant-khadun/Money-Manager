# Receipt Expense Tracker — Critique & Revised Plan

## Context
The original plan builds a browser-only app that reads Mauritian supermarket receipts with a small
vision-language model (VLM) and exports each receipt to Excel. The real goal is bigger: **track
spending at any shop over time, in a tidy table you can compare month to month, with KPIs.**
The original plan only covers "photo → one spreadsheet" and has no storage, history,
categories or KPIs. Its AI approach also rests on assumptions that are outdated or wrong.
This plan fixes both problems. Greenfield project: no existing code to reuse.

**Scope:** **any receipt from any store**: supermarkets, pharmacies, fuel, restaurants, hardware,
clothing, printed invoices. No setup per store. Only the **necessary info** is saved:
- Always: store, date, total, category, payment method.
- Line items only when they read cleanly (they add up to the total).
- A small thumbnail of the photo.
- Everything else (raw OCR text, full photo, card numbers, cashier lines) is discarded after review.

---

## 1. Flaws in the original plan

| # | Flaw | Why it matters | Fix |
|---|------|----------------|-----|
| 1 | **Florence-2 can't take a system prompt or few-shot examples.** It only accepts fixed task tokens (`<OCR>`, `<OCR_WITH_REGION>`). | Phase 2 can't work with the Phase 1 model. | Use a dedicated OCR model for reading. Do the parsing in code. |
| 2 | **"Transformers.js v3 + JSON schema in generation config"** doesn't exist in v3. v4.3 (Oct 2026) added it as an *experimental* separate package (`@huggingface/transformers-structured-output`). | The "prevents crashes" assumption is false on v3. | If an LLM is used at all, use v4.3+ and treat schema support as experimental. |
| 3 | **Valid JSON is mistaken for correct data.** A schema only guarantees the *shape*. The model can still invent items or misread 45.00 as 46.00. | Wrong numbers end up in your monthly totals and nobody notices. | Check totals against the receipt (sum of lines = TOTAL) and add a review screen. |
| 4 | **Few-shot examples in a tiny VLM** use up context and tend to *leak*: example items show up in the real output. | Fake rows appear in your data. | Put generic receipt rules in tested code, plus store hints the app learns from your corrections. |
| 5 | **"Resize the image" hurts accuracy.** Small VLMs work at about 384–768 px, so a 40 cm receipt shrunk to that size can't be read. | Long Winners/Super U receipts come out unreadable. | Crop and deskew, but keep full resolution. The OCR detector handles tall images itself. |
| 6 | **Contrast boost alone** doesn't rescue faded thermal paper. | Faded receipts still fail. | Grayscale + adaptive threshold (Sauvola) + deskew. |
| 7 | **No storage or history.** One xlsx per receipt. | You can't compare months, which was the main goal. | Keep a local database (IndexedDB) as the source of truth. Excel becomes a report built from it. |
| 8 | **No review or correction step.** | Every OCR engine makes errors. Without a fix step, errors pile up silently. | Show the photo next to an editable table, with rows that failed checks highlighted. |
| 9 | **No categories and no item normalization.** | "Spend by category" isn't possible. "LAIT UHT 1L" and "LAIT UHT FERME 1L" count as different products, so price trends break. | Add a category list, a product alias table, and learning from your corrections. |
| 10 | **VAT letters are thrown away.** | You lose VAT paid and zero-rated vs taxable spend, which is useful data. | Strip the letters from name/price, but save them in a `vat_code` column. |
| 11 | **Multi-buy, weighed, discount and void lines are ignored.** | Totals come out wrong. | Handle these line types explicitly in the parser (§4). |
| 12 | **Blur check happens after the AI returns nothing.** | Slow, and the user waits for nothing. | Check blur *before* OCR (Laplacian variance) and also use OCR confidence scores. |
| 13 | **PWA marked "optional".** | iOS Safari can delete website storage after about 7 days without a visit unless the app is installed. With IndexedDB as the only copy, that means **data loss**. | PWA install + `navigator.storage.persist()` + JSON backup/restore are **required**. |
| 14 | **A 200–300 MB model download on mobile data**, plus WebGPU memory pressure on cheaper phones. The WASM fallback for a VLM takes minutes. | First-run drop-off and crashes. | PP-OCRv5 mobile models are a few MB and fall back cleanly to WASM. |
| 15 | **Excel export is too thin** (Date, Store, Item, Price). SheetJS stopped publishing to npm, and its free edition can't style cells or create Excel Tables. | Not "ready to compare every month". | Use ExcelJS to build a multi-sheet workbook with Excel Tables, number formats and SUMIFS summaries (§6). |
| 16 | **Only a few supermarkets are covered.** | Every other shop is unsupported. Bazaar and market purchases have no receipt at all. | A universal parser that gets the essentials from any receipt, with items only when they add up. Plus a manual quick-add. |
| 17 | **Order of work is risky.** It builds the UI on an unproven engine and has no accuracy measurement. | You only find out it doesn't work on day 10. | Phase 0: collect 20–30 real receipts with hand-typed answers, then measure accuracy before building on the engine. |
| 18 | **DD/MM/YYYY dates** parsed with `new Date()` get read as MM/DD. | Dates and months come out wrong. | Parse dates explicitly, day-first by default. The app remembers each store's format. |

---

## 2. Revised architecture (local-first)

```
 Photo/camera
    │
 [1] Pre-process (canvas, worker)
     crop + perspective/deskew → grayscale → adaptive threshold
     blur check (Laplacian variance) → "retake" BEFORE OCR
    │
 [2] OCR: PaddleOCR PP-OCRv5 mobile (ppu-paddle-ocr/web, onnxruntime-web,
     WebGPU → WASM fallback). Output: text lines + boxes + confidence.
     Fallback engine: Tesseract.js (eng+fra).
    │
 [3] Universal parser (pure TS, unit-tested, works on any receipt with no setup)
     A. ESSENTIALS (always): store · date · total · payment method · VAT if printed
        • store: biggest text in the top lines + VAT/BRN number → match a known store
          (fuzzy) → else "New store: is this right?" (asked once, then remembered)
        • total: keyword list (§4) + biggest amount in the bottom half,
          cross-checked with the payment line (tendered − change)
        • date: any common format, day-first by default
     B. ITEMS (best effort): rows rebuilt by y-coordinate between header and total,
        right-most amount = price; multi-buy / weighed / discount lines handled
     • learned store hints (total label, date format, item layout) improve the next scan
    │
 [4] Categorize
     receipt → the store's default category (chosen once, remembered)
     items   → product alias table → else inherit the receipt's category
    │
 [5] Validate
     essentials: total + date found, date plausible, not a duplicate (store+date+total)
     items: Σ items − discounts ≈ TOTAL (±Rs 1)?  ✓ keep items
                                                 ✗ save essentials only (items dropped)
    │
    ├─ essentials OK ───────────────────────────┐
    └─ essentials missing / unsure, or you      │
       want the items that didn't add up        │
         [5b] "Try cloud AI" button (opt-in,    │ per receipt)
              image + local OCR text → Claude   │ → same validation [5]
    │                                           │
 [6] Review sheet: 4 big fields (store · date · total · category)
     items folded away: "12 items ✓ add up" or "Items didn't add up, saving total
     only · Fix items · Try cloud AI"   (corrections teach store hints + product names)
    │
 [7] Save essentials (+ items if valid, + ~30 KB thumbnail) → IndexedDB
     raw OCR text, full photo, card/cashier lines are discarded
     ──►  Dashboard / KPIs  ──►  Excel export
```

**Why this beats "VLM outputs JSON":** OCR models are built to read text, and they're small and
fast. Code can parse receipts predictably and you can test that code. The total checksum catches
most errors automatically, and the AI is never asked to do arithmetic or remember formats.

**Why essentials first:** the store, date and total can be found on almost any receipt with
generic rules. Line items vary a lot between shops. Separating the two means every receipt counts
towards your monthly totals, even when its items can't be read, and wrong item data never gets in.

### 2b. Cloud fallback (opt-in, one receipt at a time)
- **When it appears:** when the store, date or total couldn't be found confidently, or when the items didn't add up and you want them anyway. The button says the photo will be sent to Anthropic. Nothing is ever sent automatically.
- **Key handling:** you paste your own Anthropic API key in Settings. It is stored only on the phone (IndexedDB) and never in the code. Set a monthly spend limit on that key in the Anthropic Console. The page loads no third-party scripts, so nothing else running on it can read the key.
- **Call:** `@anthropic-ai/sdk` with `dangerouslyAllowBrowser: true` (required to run it in a browser) → `client.messages.parse()` with `output_config: { format: zodOutputFormat(ReceiptSchema), effort: "low" }`. Model `claude-opus-5-5` by default. The model is a Settings field, so you can switch to a cheaper one yourself.
- **Input:** the cropped and deskewed photo as a natural colour/grayscale JPEG, *not* the thresholded version. Very long receipts are split into 2–3 overlapping tiles sent in the same message. The local OCR text goes along as a hint, plus the receipt rules (§4) as plain instructions.
- **Output is not trusted blindly:** it goes through the same validation [5] and review screen [6]. Handle `stop_reason` `refusal`/`max_tokens` and a null `parsed_output` with a "couldn't read, enter manually" path.
- **Cost:** only failed receipts use it. Measure cost per receipt on the Phase 0 fixtures. Opus 5.5 is $4 / $20 per million input/output tokens, so expect a few cents per receipt.
- The Zod `ReceiptSchema` also serves as the TypeScript type for the local parser's output, so both paths produce identical objects.

---

## 3. Data model (IndexedDB via Dexie)

Only what the KPIs and monthly comparison need:

- **receipts** (every receipt, essentials only): `id, date (ISO), month (YYYY-MM), storeId, categoryId, total, currency (default MUR), paymentMethod (cash|card|mobile|other), vatTotal?, discountTotal?, itemized (bool), source (scan|cloud|manual), thumb (~30 KB WebP), note?, createdAt`
- **lineItems** (only for receipts whose items add up): `id, receiptId, name (cleaned), productId, categoryId, qty, unitPrice, lineTotal, vatCode?`
- **stores**: `id, name, aliases[], taxId? (VAT/BRN number, a reliable fingerprint), defaultCategoryId, hints {totalLabel, dateFormat, itemLayout}`
- **categories**: `id, name, parentId, monthlyBudget`. Defaults cover any shop: Groceries (› Fresh, Dairy, Meat & Fish, Bakery, Drinks, Pantry) · Household · Personal care · Pharmacy & health · Fuel & transport · Restaurants & takeaway · Clothing · Electronics · Home & hardware · Bills & services · Leisure · Other. All editable.
- **products**: `id, canonicalName, categoryId, aliases[]` (the item names seen so far, so "LAIT UHT 1L" and "LAIT UHT FERME 1L" count as one product)

**Never saved:** raw OCR text, the full-size photo, card numbers, cashier/till IDs, loyalty numbers, addresses.

All money is stored as integer cents to avoid floating-point errors. The `month` field is stored
directly so monthly lookups are fast. A receipt in a foreign currency asks for the amount in Rs
(or a rate), so KPIs always stay in one currency.

---

## 4. Universal receipt rules (any store, no setup)
Generic rules live in code (`src/parser/rules/`, unit-tested). Store-specific knowledge is **learned and stored on the phone**, never hand-written per shop.
- **Total keywords** (English + French, ranked): `GRAND TOTAL`, `TOTAL TTC`, `TOTAL`, `NET A PAYER`, `MONTANT`, `AMOUNT DUE`, `BALANCE DUE`, `TO PAY`. Skip `SUBTOTAL` / `SOUS-TOTAL` / `TOTAL VAT`.
  - Fallback: the biggest amount in the bottom half.
  - Cross-check: tendered (`CASH`/`CARD`/`JUICE`…) − `CHANGE`/`RENDU` = total.
- **Store:** biggest text in the first lines, plus any `VAT No` / `BRN` / `TAN` number (the strongest fingerprint). Fuzzy-matched against known stores. If new, you confirm it once.
- **Dates:** `DD/MM/YYYY`, `DD-MM-YY`, `DD.MM.YYYY`, `YYYY-MM-DD`, `08 Oct 2026` / `08 OCT 26`. Day-first by default. Never `new Date(string)`.
- **Money:** optional `Rs`/`MUR`/`€`/`$`, thousands comma, 2 decimals, so `1,234.50` → 123450 cents. A trailing VAT code token (`V`/`Z`/`E`…) goes into `vatCode` and is removed from the name.
- **Payment method:** keywords `CASH`, `CARD`/`VISA`/`MASTERCARD`, `JUICE`/`MY.T MONEY`/`BLINK` (→ mobile).
- **Item lines:**
  - Normal: name + right-aligned amount.
  - Multi-buy: `2 x 45.00   90.00`.
  - Weighed: `0.856 kg @ 120.00/kg  102.72`.
  - Negative/`-` lines count as discount or void.
- **Skip-list:** loyalty, points, change, card digits, auth codes, cashier/till, phone/address, thank-you lines.
- **Learned store hints:** after you save a receipt, the store remembers its total label, date format and item layout. The next receipt from that shop parses more reliably.
- The OCR uses a Latin-script model that covers French and English item names.

---

## 5. KPIs & monthly comparison (in-app dashboard)
**Headline tiles (selected month):** total spend · vs last month (Rs, %) · vs 3-month average ·
trips · average basket (Rs/trip) · projected month-end (spend so far ÷ day of month × days in month) · discounts saved · VAT paid

**Breakdowns:**
- Category × month table (last 6–12 months) with month-on-month % and colour-coded changes
- Budget vs actual per category (% used, projected overspend warning)
- Spend by store (share %), and *where the same product is cheapest*
- Top 10 products by spend this month
- **Personal inflation:** price per unit over time for products bought often (basket index vs the first 3 months)
- Groceries vs non-groceries split

**Two levels of KPI:**
- Totals, categories, stores, trips, basket size and budgets use **every receipt**.
- Product-level KPIs (top products, price changes, cheapest store) use **only itemized receipts**, and say so ("based on 14 of 20 receipts"). VAT paid and discounts saved count only where printed.

---

## 6. Excel workbook (cumulative, one file for all months)
Built with ExcelJS. Every sheet uses real Excel dates, `"Rs "#,##0.00` number format and Excel Tables with filters:
1. **Receipts**: one row per receipt (Date, Month, Store, Category, Total, Payment, Itemized ✓/–, VAT, Source)
2. **Transactions**: one row per line item (Date, Month, Store, Receipt #, Product, Category, Qty, Unit price, Line total, VAT code). A receipt without items appears as **one row, "(not itemized)", for its full total**, so Transactions always adds up to the same money as Receipts. This "tidy" layout works directly with pivot tables.
3. **Monthly Summary**: Category × Month grid using `SUMIFS` on the Transactions table, MoM % columns, colour scales
4. **KPIs**: monthly tiles as rows (total, trips, basket, VAT, savings, budget variance)
5. **Price Tracker**: product × month average unit price

Because the summaries use formulas, they stay correct if you edit rows by hand in Excel.

---

## 7. Tech stack
- **Vite + React 19 + TypeScript + Tailwind**, built as a client-only single-page app.
  - Not Next.js or Remix-style server rendering: there is no backend, and SSR breaks code that needs `window`/IndexedDB/WebGPU (workers, onnxruntime-web, Dexie).
- **TanStack Router** (type-safe routes: Scan, Review, Receipts, Dashboard, Settings) · **shadcn/ui** (Radix-based components, mobile-friendly)
- **TanStack Table** for the editable review grid and the receipts/transactions list (sorting, filtering, inline edits)
- **react-hook-form + zod** for receipt editing, reusing the same `ReceiptSchema`
- **Dexie + dexie-react-hooks** (`useLiveQuery`): the dashboard and lists update automatically when a receipt is saved, so no extra state library is needed
- **vite-plugin-pwa** (install + offline + model caching)
- **ppu-paddle-ocr** (PP-OCRv5, onnxruntime-web, WebGPU/WASM). Its "99% on receipts" figure is the author's own claim, so verify it in Phase 0. **Tesseract.js** as fallback.
- **cropperjs** for manual crop (auto edge detection with OpenCV.js later; it's about 8 MB)
- **Charts: small hand-built SVG components** (bars, meters, sparkline, price line), their maths written by hand (no d3). No chart library: full control over the Apple-style look and a far smaller bundle than ECharts.
- Animations in plain CSS (see §7b; the `motion` package is installed but unused, to keep startup small) · **vaul** for iOS-style bottom sheets · **@tanstack/react-virtual** for long lists
- **ExcelJS** for export · **Vitest + React Testing Library** for tests
- **zod** (shared `ReceiptSchema`) · **@anthropic-ai/sdk** (cloud fallback only, lazy-loaded)
- Run OCR in a **Web Worker** so the UI doesn't freeze

---

## 7b. Design: clean cards, one accent, quiet motion
*Redesigned 2026-10-11, from the earlier iOS-list look to cards in the style of modern money apps and the components on [21st.dev](https://21st.dev).*

**Principles:** content first, one primary action per screen, generous whitespace, one accent colour (indigo), motion that feels physical but never shows off. Cards on a quiet background; a soft colour wash and a faint dot grid behind the top of the main screens; numbers that roll into place.

**Navigation (3 tabs, floating translucent dock):** `Overview` · `Scan` (filled accent circle in the centre, with a soft glow) · `History`. Settings is a gear button at the top right of Overview. Drill-downs (category, product, receipt) have a round back button. Editing happens in bottom sheets.

```
 ┌─────────────────────────────┐
 │                   ‹  ›  ⚙   │  ← round buttons: previous / next month, settings
 │ October                     │  ← large title, shrinks into a blurred bar on scroll
 │ Spent so far                │
 │ Rs 4,711.00                 │  ← hero: digits roll like an odometer; "Rs" and cents quieter
 │ (↓ 7% less than this time   │  ← badge: arrow in status colour, words carry the meaning;
 │    in September)            │     mid-month it compares with the same day last month
 │ On track for Rs 13,276      │
 │ ┌ October against Sept. ──┐ │  ← spending added up day by day: this month (accent + wash),
 │ │      ___——°             │ │     last month (grey), dashed line to the month-end pace;
 │ │  __/  ⋰                 │ │     touch for both values, "Show as table"
 │ └─────────────────────────┘ │
 │ ┌ A day ──┐┌ Receipts ────┐ │  ← 2×2 tiles: a day, receipts, biggest receipt, no-spend days
 │ └─────────┘└──────────────┘ │
 │ ┌ Last six months ────────┐ │  ← grey columns, selected month in accent; tap to switch
 │ Where it went               │  ← tinted category icons, meters (budget state if set)
 │ Cost more than last time ›  │  ← cards scrolling sideways
 │ Shops                       │  ← initials avatars, meters
 │   ╭─────────────────────╮   │
 │   │  Overview  ◉  History│   │  ← floating dock, safe-area aware
 │   ╰─────────────────────╯   │
 └─────────────────────────────┘
```

**Typography:** `"Inter Variable", -apple-system, system-ui, sans-serif` (Inter is self-hosted and precached, so it looks the same on every phone), with Inter's `cv11` and `ss03` alternates.
- Sizes: Large Title 32 bold · Title 2 22 · Headline 17 semibold · Body 17 · Subhead 15 · Footnote 13 · Caption 12. Hero figure 52 semibold, tracking −0.035em.
- Sizes are set in `rem`, so the phone's text-size setting still works.
- Proportional digits for the hero and stat tiles; `tabular-nums` only in lists and tables where numbers must line up.

**Colour tokens** (`src/styles/tokens.css`). The names follow **shadcn/ui** (`--background`, `--card`, `--primary`, `--muted-foreground`…), so components pasted from ui.shadcn.com or 21st.dev take on Money Manager's colours. Dark values under `prefers-color-scheme`, and again under `[data-theme='dark']` for the Light/Dark choice in Settings. Contrast checked: text ≥ 4.5:1, icons and marks ≥ 3:1.

| Token | Light | Dark |
|---|---|---|
| `background` | `#F6F6F8` | `#0A0A0C` |
| `card` (with a 1 px `border` and a soft shadow in light) | `#FFFFFF` | `#141417` |
| `foreground` / `muted-foreground` | `#0B0B0F` / `#6B6B76` | `#F4F4F6` / `#A1A1AA` |
| `border` (hairline) | `#E6E6EC` | `#25252B` |
| `primary` (the one accent) / `primary-foreground` | `#5B4CF0` / white | `#A99FFF` / `#0C0A24` |
| `muted` (quiet fills) / `raised` (segmented thumb) | `#EFEFF3` / white | `#1E1E23` / `#2C2C33` |
| `track` (de-emphasised marks, last month's line) | `#D4D4DC` | `#45454F` |
| status `good` / `warn` / `bad` | `#16A34A` / `#D97706` / `#DC2626` | `#34D399` / `#FBBF24` / `#F87171` |

- shadcn's own `accent` token is a quiet hover background, not the brand colour; the brand colour is `primary`.
- Status colours are **only** used for budget state, price and spending changes, and checksum results. They always come with an icon and a word ("Over by Rs 500"), never colour alone.
- Categories each have a hue (`--hue-*`) for their icon tile, and shops get one from their name for the initials avatar. These are decoration only: the name and icon always identify the category, and no chart uses them.
- `dark:` in Tailwind follows Money Manager's theme (the phone's setting unless Settings chose Light or Dark), so pasted components' dark styles work.

**Chart rules:**
- Bars at most 24 px thick, with 4 px rounded tops and square bottoms. Lines 2 px; dots at least 8 px with a 2 px ring in the card colour; area under a line is a faint wash of its colour.
- Hairline gridlines, solid, few. Label selectively (the selected month, the gridline values).
- Two series always have a legend (line keys). A dashed line means "at this pace", never a gridline.
- Every chart supports touch for a readout and has a "Show as table" option.
- Charts are hand-built SVG (`src/components/charts/`), no chart library: Recharts and similar would not fit the bundle budget.

**Shape & spacing:** 4-pt grid; 16 px screen margins; radius `10 / 12 / 16 / 20 / 24 / 28 / pill` (cards 24, buttons pill). Cards have a hairline border; in light mode also a very soft shadow. Hairline separators inset from the left inside cards. Icons: **Lucide**, stroke 2.

**Motion (CSS only):**
- No animation library (the `motion` package would cost 20–30 KB at startup). Transitions and keyframes live in `src/index.css`.
- The hero amount rolls digit by digit (odometer). Sections rise in with a short stagger. Columns grow from the baseline, meters fill from the left, lines draw in.
- The segmented control's highlight slides. Buttons and tiles press to scale 0.97.
- Sheets via **vaul**: drag to dismiss, the page scales back behind them.
- Scanning: a light sweeps down a drawn receipt; rows being read shimmer. No spinners.
- `prefers-reduced-motion`: movement is switched off (things simply appear). `prefers-reduced-transparency`: solid bars instead of blur.

**Smoothness budget (what "smooth" means, measurable):**
- 60 fps scrolling and animations on a mid-range Android. Only `transform`/`opacity` are animated. Blur is limited to the tab bar and nav bar; the colour wash is plain gradients.
- App-shell JS ≤ 150 KB gzip (2026-10-11: 148.7 KB). OCR, ExcelJS and the Anthropic SDK are lazy-loaded only when used. Route-level code splitting; the lower half of Overview (categories, prices, shops) loads alongside the first screen.
- Long lists virtualized. Receipt thumbnails are small WebP files generated in a worker.
- Previous render held at reduced opacity while data loads. Optimistic saves with an "Undo" toast instead of confirm dialogs. No layout shift.
- Safe areas: `viewport-fit=cover` + `env(safe-area-inset-*)`. `overscroll-behavior: none` on the app shell. `-webkit-tap-highlight-color: transparent`. Touch targets at least 44×44 px.

**Copy tone:** short, sentence case, friendly, everyday words. "Totals match ✓" / "Off by Rs 12.50: check the highlighted items" / "Receipt too blurry, try again in better light".

**Adding components from 21st.dev or shadcn/ui.** The project is set up for their CLI (`components.json`, the `@/` import path, `cn()` in `src/lib/utils.ts`):
```
npx shadcn@latest add "https://21st.dev/r/<author>/<component>"
```
- Pasted components land in `src/components/ui/`. Money Manager's own building blocks are in `src/components/primitives.tsx`, so the two never clash.
- They pick up Money Manager's colours and dark mode as they are; restyle only what clashes with the principles above.
- Check the weight before using one at startup: many use `framer-motion` or `recharts`, and `cn()` brings `tailwind-merge` (~7 KB). Fine on screens that load later; on Overview, compare with the budget.
- Check each component's licence on its page before shipping it. The CLI may also add CSS variables to `src/index.css`; keep Money Manager's tokens.

## 8. Revised phases (most risky first, most useful first)

**Phase 0: Eval set & engine spike (2–3 days)**
- Collect 30+ real receipts from **as many different kinds of shop as possible**: supermarkets, pharmacy, fuel, restaurant/takeaway, hardware, clothing, a card-terminal slip, a long receipt, faded and crumpled ones. Hand-type the correct values into `fixtures/*.json` (store, date, total, payment; items where present).
- Spike page: run PP-OCRv5 vs Tesseract.js (and the Claude fallback, for comparison and cost per receipt). Measure (a) **essentials accuracy**: store, date and total all correct; (b) % of itemized receipts whose items add up to the total.
- Go/no-go: essentials correct on about 90% or more of receipts, and items add up on about 60% or more of itemized ones. If local is much worse, spend more time on preprocessing and the generic rules before building the UI.

**Phase 0.5: Design prototype (2 days)**
- Clickable static mockup of Overview, Scan/processing, Review sheet, History and Settings, filled with realistic sample data.
- Built with the real tokens, typography, tab bar, sheets and springs, but no logic. You sign off on the look and feel on your phone before any feature work.
- The tokens and components (`ui/`, `charts/`) become the real ones, so none of this work is thrown away.

**Phase 1: Data core without AI (2–3 days)**
- Dexie schema, categories seed, manual receipt entry, receipt list, JSON backup/restore, `storage.persist()`.
- The app is already useful at this point (manual entry for bazaar purchases), so the data model gets tested before any OCR exists.

**Phase 2: Scan pipeline (4–5 days)**
- Pre-process worker → OCR worker → universal parser (essentials, then items) → validation → review sheet.
- Corrections teach store hints and product names. Thumbnail generated, raw data discarded on save. Parser unit tests run against the Phase 0 fixtures.

**Phase 2b: Cloud fallback (1 day)**: Settings (API key, model, on/off), the "Try cloud AI" button on failed receipts, tiling, error and refusal handling (§2b).

**Phase 3: Dashboard & KPIs (3 days)**: tiles, category × month grid, budgets, store split, price tracker.

**Phase 4: Excel export (1–2 days)**: 5-sheet workbook from §6, filtered by date range.

**Phase 5: PWA, hosting & hardening (2–3 days)**:
- Install prompt, offline, iOS testing, duplicate detection, big-history performance.
- GitHub Pages deploy workflow, onboarding screen, update toast.
- Test on friends' phones.

(Set up the GitHub Pages deploy at the **start of Phase 1** so every phase is tested on a real phone over HTTPS. The camera and service worker don't work over plain-HTTP LAN addresses.)

**Phase 6 (optional)**: small local text LLM (Transformers.js v4.3+ with structured output) only for categorizing unknown items or repairing lines that fail the checksum. Auto edge detection.

---

## 9. Verification
- `vitest`: parser tests against every Phase 0 fixture (store, date and total extraction, line types, items-add-up check, VAT codes, payment method)
- Accuracy script: run the full pipeline on the fixtures and report essentials accuracy and the items-add-up rate. Re-run whenever the rules change.
- Learning: scan two receipts from a new store. After confirming the first, the second should recognise the store and its category without asking.
- Data minimisation: after saving, check in IndexedDB (DevTools → Application) that no raw OCR text or full-size image is stored, only the essentials, valid items and a thumbnail under about 40 KB.
- Excel: the Transactions total equals the Receipts total, including the "(not itemized)" rows.
- Manual end-to-end on a real phone (Android Chrome + iOS Safari 26): install the PWA, scan in poor light, fix one row, check the alias gets learned on the next scan
- Excel: open the export in Excel, change one Transactions row, check that Monthly Summary updates
- Data safety: back up → clear site data → restore → KPIs match
- Design QA:
  - Chrome DevTools performance trace at 4× CPU throttle shows no dropped frames on scroll, sheet drag or tab switch.
  - Lighthouse on mobile scores ≥ 95 for Performance and Accessibility. App-shell bundle ≤ 150 KB gzip (`vite build` report).
  - Check light and dark mode side by side, with reduced motion and the largest text size. WCAG AA contrast for all text.
  - Install the PWA on a real iPhone and an Android phone and compare the feel against a native iOS app (Health / Wallet).
- Hosting: on the deployed GitHub Pages URL, refresh on a deep link (works via hash routing), install the PWA, go offline (airplane mode), scan a receipt, and confirm OCR still runs from cache. Deploy a new version and confirm the update toast appears and existing data survives.
- Cloud fallback: with no key the button is hidden. With a key, run it on a failed fixture, check the result passes through validation and review, and confirm a bad key shows a clear error. Check in the network tab that nothing goes out unless the button is tapped.

---

## 10. Decisions (confirmed)
- **Name:** **Money Manager** (first called Spent). Tagline: "Snap your receipts. See where your money goes." All wording people see stays plain and everyday, never technical.
- **Long receipts:** one receipt can have several photos, taken top to bottom with each repeating a few lines of the one before. Each photo is read on its own, then they are joined where they overlap (`src/pipeline/stitch.ts`); shared lines are kept once, in the clearer reading, and photos picked out of order are put back in order. No separate "long receipt" mode: photos added together are sorted automatically (`groupPhotos`): a photo continues another only when the shared lines sit at the very bottom of one and the very top of the other and both add lines of their own, so separate receipts from the same shop (same header and footer) stay apart. The scan screen offers "These are separate receipts" to undo a join, and "Take the next part" (the camera) under every receipt, plus "Choose from your photos" on the check screen, for photos taken later; any photo can be taken back out. A receipt with no line saying it is the total (only a guessed one) is flagged as possibly cut off (`looksCutOff` in `src/scan/notes.ts`), and the button stands out. An unsaved receipt can be deleted, with Undo.
- **Managing saved receipts:** every detail of a saved receipt changes in place (saved straight away); each item can be corrected (name, how many, price, category) or deleted, and once items no longer add up to the total the receipt says so, with "Make the total …". History has "Select" to delete several receipts at once. Every delete has Undo.
- **Checking items before saving:** the review screen shows every item read, even when they don't add up, each with a pencil to correct it (name, how many, price, category) or take it off, and "Add a missing item". Lines the reader was unsure of (confidence below 0.85, as for its closer looks) are marked "Check". The items are saved as shown, whether or not they come to the total (±Rs 1): dropping items the person had just seen lost them (the user's call, 2026-10-16). When they don't add up, the review screen and the saved receipt both say what they come to, with "Make the total …" (on the review screen, unless the receipt seems cut off). The total always stays as confirmed, so monthly totals are unaffected.
- **Joining a long receipt's photos:** a shared line with the same price but a word lost or misread counts as a partial match (`PARTIAL` in `src/pipeline/stitch.ts`): it helps a join along but never on its own decides that two photos belong together. A receipt taken right after one that seems cut off, and not joined to it by itself, asks "Is this the rest of the receipt below?" (`joinInto`).
- **Receipts:** any store, no per-store setup. Always save the essentials (store, date, total, category, payment method). Save items as checked, even when they don't add up (2026-10-16); price changes only use receipts whose items do. Keep a ~30 KB thumbnail of the photo. Discard everything else after review.
- **AI engine:** local-first (PP-OCRv5 + parser). Cloud Claude only when you tap the button for a receipt that failed (§2b).
- **Users/devices:** one person per phone. You, colleagues and friends all use the same public website, and **each person's data stays only on their own phone**. Nobody can see anyone else's receipts, and no accounts or backend are needed. All data lives in the phone's IndexedDB, so:
  - `navigator.storage.persist()` on first run, and install as a PWA (protects against iOS storage clean-up)
  - **Backup:** one-tap export of all data to a JSON file, saved via the Web Share API to Drive/OneDrive. A reminder shows if no backup was made in 30 days. Restore from file.
  - The Excel export is a report, not a backup. Restore only reads the JSON.
- **Output:** in-app dashboard (§5) is the main view. The Excel workbook (§6) is exported whenever you want it.

## 11. Hosting & sharing (GitHub Pages)
GitHub Pages works because the app is a static site served over HTTPS. HTTPS is required for the camera, service worker, WebGPU and persistent storage. Design for GitHub Pages' limits from day one:

| GitHub Pages limit | Fix in this plan |
|---|---|
| No URL rewrites, so refreshing `/receipts` returns 404 | TanStack Router **hash history** (`/#/receipts`). Works on any static host. |
| Project sites live under `/<repo>/` | Vite `base: './'` (or `'/<repo>/'`). PWA manifest `start_url`/`scope` and the service worker scope match it. |
| **No custom HTTP headers**, so no COOP/COEP and no `SharedArrayBuffer` | onnxruntime-web WASM runs **single-threaded** on phones without WebGPU, which is slower but works. WebGPU phones are unaffected. If Phase 0 shows WASM is too slow, add the cross-origin-isolation headers inside the PWA service worker (the `coi-serviceworker` technique, merged into the Workbox SW). Or move to **Cloudflare Pages**, which is also free and supports a `_headers` file; the build is the same. |
| 100 MB max per file in git; 1 GB site; ~100 GB/month soft bandwidth | Self-host the OCR model and onnxruntime WASM files in `public/` (a few MB to about 25 MB each). About 30 MB per new user means roughly 3,000 first-time installs a month. |
| Free Pages needs a **public repo** | The source being public is fine because it contains **no secrets**. Never commit an API key. |
| Workbox only precaches files up to 2 MiB by default | Raise `maximumFileSizeToCacheInBytes`, or runtime-cache `/models/*` and `*.wasm` (CacheFirst), so OCR works offline after the first scan. |

**Deploy:** a GitHub Actions workflow (`.github/workflows/deploy.yml`): on push to `main`, `npm ci && npm run build`, then `actions/upload-pages-artifact` → `actions/deploy-pages`.

**What changes when friends use it:**
- **Cloud fallback = bring your own key.** Each person pastes their own Anthropic API key, and the button is hidden for anyone without one. Your key must never ship in the site: everything in a public site's JS can be read. (Later, if friends want cloud without their own key: a small Cloudflare Worker proxy holding your key, with per-person passcodes and a monthly cap. That's a backend, so it's out of scope for v1.)
- **Updates without breaking anyone's data:**
  - Dexie schema changes always go through `db.version(n).upgrade()`, only adding fields and never deleting any. You can't fix a friend's database by hand.
  - vite-plugin-pwa uses `registerType: 'prompt'`, which shows a "New version, tap to reload" toast so nobody is stuck on an old cached build.
- **Onboarding screen on first run:** "Your data stays only on this phone. Back up monthly." It then asks for persistent storage and suggests installing the app.
- **Generic rules help everyone.** Improvements to the receipt rules ship with each update. Each person's learned stores, hints and product names stay on their own phone. Optional later: export/import of a "stores & products" file to share them between friends.
- **No analytics or trackers.** An About page explains what is stored where and when anything leaves the device.
- **Test devices:** at least one low-end Android phone and one iPhone. Pre-iOS-26 iPhones run WASM only.

## 12. Project layout (to create)
```
receipt-tracker/
  src/
    db/            schema.ts (Dexie), seed-categories.ts, backup.ts
    pipeline/      preprocess.worker.ts, ocr.worker.ts, validate.ts
    parser/        parse.ts (essentials → items), essentials.ts, items.ts, money.ts, dates.ts,
                   store-match.ts, hints.ts (learned per-store hints), rules/ (keywords, skip-list)
    cloud/         claude-extract.ts (lazy), receipt-schema.ts (zod, shared)
    kpi/           monthly.ts, budgets.ts, price-index.ts
    export/        excel.ts (ExcelJS)
    routes/        scan.tsx, review.$id.tsx, receipts.tsx, dashboard.tsx, settings.tsx
    styles/        tokens.css (colour/type/radius/motion variables, light + dark)
    components/    ReviewTable.tsx, KpiTile.tsx, CategoryMonthGrid.tsx, LargeTitleHeader.tsx, TabBar.tsx, Sheet.tsx
      charts/      MonthBars.tsx, BudgetMeter.tsx, Sparkline.tsx, PriceLine.tsx, StoreBars.tsx
      ui/          components added from shadcn/ui or 21st.dev (CLI target, see §7b)
    components/primitives.tsx   Money Manager's own building blocks (cards, rows, buttons, segmented control)
    hooks/         useOcrWorker.ts, useMonthlyKpis.ts (useLiveQuery wrappers)
  fixtures/        receipts/*.jpg + *.expected.json (Phase 0 eval set)
  tests/           parser.spec.ts, kpi.spec.ts, eval.ts (accuracy report)
```

## 13. Progress (2026-10-10)
**Built and tested** (`npm test`: parser, reading steps, joining photos, categorising, KPIs, database):
- **Reading (Phase 0/2):** PP-OCRv5 in a worker; tilt measured from the print, zoom to the writing size, overlapping parts, closer looks at unclear lines; several photos per receipt, joined where they overlap and sorted automatically (§10). Reading test page at Settings → Receipt reading test (`/#/test`), fixtures + `npm run eval`.
- **Data core (Phase 1):** Dexie schema (`src/db/schema.ts`), default categories plus a *Snacks & sweets* sub-category, save / edit / delete with undo, JSON backup & restore, `storage.persist()` on first save. Manual entry ("Add an expense").
- **Categorising:** learned products → word rules (`src/categorize/rules.ts`, English/French/abbreviations/local brands) → the shop's category; restaurants keep every line as the meal. A shop's category is learned when confirmed; changing an item's category is remembered for that product on every receipt. Each receipt stores its `split` (total shared over categories, exact to the cent).
- **App + dashboard (Phase 3, part):** Overview (month total, vs last month, month-end projection, 6-month bars, categories with share or budget meters, shops), category detail (breakdown, what was bought, receipts), Scan with review sheet, History with search, receipt detail, Settings (budgets, appearance, backup). One accent colour + grey in charts; categories told apart by name and icon (13 categories exceed a colour-blind-safe palette).
- **Prices (Phase 3, part):** Overview lists what cost more this month than the time before (top 3, then *All prices*). The Prices screen shows *Cost more* / *Cost less* / *All*, with search; each product has its own page with every price paid, a price line, and links to the receipts (`src/kpi/prices.ts`). The latest price is compared with the previous purchase at any shop, naming the shop when it differs. A kg price is only compared with a kg price, and a difference of a cent or less counts as the same price. Names the OCR read slightly differently count as one product only when their sizes and counts match. Based on itemized receipts only, and the screen says how many.
- Checked end to end in headless Chrome at phone size: sample data across six months, every screen in light and dark, and a real photo scanned (7 s), checked and saved. App-shell JS ≈ 142 KB gzip; other screens load on first visit.

**Redesign (2026-10-11):** new look (§7b): shadcn-named colour tokens with an indigo accent, cards, odometer hero figure, a day-by-day "this month against last month" chart with month-end pace, 2×2 stat tiles, sideways price cards, tinted category icons, receipt items laid out as torn paper, a new Scan screen. Mid-month, the change badge now compares with the same day of last month. Set up for adding 21st.dev/shadcn components (`components.json`, `@/` path, `cn()`). Checked in headless Chrome at phone size in light and dark; app-shell JS 148.7 KB gzip.

**Not yet:** Excel export (Phase 4); PWA icons, install prompt, update toast and GitHub Pages deploy (Phase 5); cloud fallback (Phase 2b); personal inflation (basket index); joining one product's different names by hand; editing category names; Phase 0 accuracy measurement on 30+ real receipts. (The backup reminder and the update bar came with §14, 2026-10-16.)

## 14. Fixes and improvements (review of 2026-10-16)
A review of the whole app (208 tests passing, type check clean) found gaps that can lose receipts or show wrong numbers, and a few promises the app doesn't keep yet. The order: first finish the change in progress safely, then protect people's data and numbers, then offline use (which needs step 2a first, see step 4), then the rest. Step 6 is the one only you can do, and can start now, alongside the others. Every step ends with tests; the whole list is checked on real phones at the end.

### Step 1. Finish "save every item" safely, before committing it (small)
- **Problem:** price comparisons (`productPrices` in `src/kpi/prices.ts`) use every saved item. "The items add up to the total" was their only guard against misread prices. Now that items are saved even when they don't add up, one misread price (45.00 read as 145.00) shows on Overview as "costs 222% more".
- **Change:** `productPrices` leaves out receipts whose items don't come to their total, worked out when it runs, so a receipt counts again as soon as it is fixed. `itemsAddUp` moves out of `src/db/receipts.ts` into a file with no database code, so the price code stays pure. The "based on X of Y receipts" count in `usePrices` (`src/hooks/data.ts`) counts the same receipts. The §10 "Receipts" line ("Save items only when they add up") is updated to match the 2026-10-16 decision above it. Then commit.
- **Check:** `tests/prices.spec.ts`: a receipt with one misread price isn't compared; once its price is fixed, it is.

### Step 2. Never lose a receipt (the biggest step)
**2a. Keep photos until the receipt is saved.**
- **Problem:** receipts being read or waiting to be checked live only in memory (`src/hooks/useReceiptReader.ts`). When the phone closes the page, which the app expects on iPhones (`src/pipeline/care.ts`), every unsaved photo is lost, and photos taken with the app's camera button usually aren't in the gallery. The message then asks to "add the photo again".
- **Change:** a new `pending` table (`db.version(2)`, only adding): each unsaved receipt with its photos (Blobs) and, once read, its readings. Written whenever photos are added, joined, split or taken out; deleted when the receipt is saved, or thrown away and its Undo has run out. At start-up the reader loads them back; receipts already read go straight to "Ready to check" without reading the photos again (their readings fill the reader's cache), the rest are read again. Photo ids carry on from the highest one loaded. The "had to start again" message says the photos are back. Readings are still never kept with a saved receipt (§3); they are held only until the receipt is saved or thrown away. Backup leaves this table out, and restore doesn't clear it.
- **Check:** tests for saving, loading and deleting pending receipts (fake-indexeddb). On a phone: take two photos, close the app while it reads, open it again: both are there.

**2b. Say when saving fails.**
- **Problem:** saving a checked receipt or an added expense has no error handling (`ReviewSheet.tsx`, `AddExpenseSheet.tsx`), changes on a saved receipt are fire-and-forget (`void updateReceipt(...)` in `ReceiptDetail.tsx`), and every message shows a green tick, even "That file couldn't be read as a backup".
- **Change:** the toast gets a "problem" look (warning icon in the `bad` colour, shown longer). Every save, change, delete and restore goes through one small helper that catches the error, writes it to the problem report (`debugLog` + `describeError`) and says so in plain words: "Couldn't save this receipt. Your phone may be out of space."
- **Check:** the helper has its own test; the problem look is checked in light and dark.

**2c. Make the backup safe.**
- **Problem:** restore wipes everything first (`src/db/backup.ts`), so choosing last month's file by mistake erases a month. The 30-day reminder (§10) was never built.
- **Change:** before replacing, the question says what's in the file and on the phone: "This backup is from 12 September, with 84 receipts. This phone has 120. Replace them?" The phone's data is copied to memory first, and "Restored 84 receipts" has Undo. The reminder: a card on Overview when there are receipts and the last backup is over 30 days old (or there was never one, a week after the first receipt), with "Back up now". The backup code moves out of `Settings.tsx` so both places use it.
- **Check:** restore + Undo round trip in `tests/db.spec.ts`; when the reminder shows, as a tested function.

### Step 3. Right numbers (small to medium)
**3a. Dates that can't be right.**
- **Problem:** when no believable date is found, `findDate` (`src/parser/essentials.ts`) still fills in an unbelievable one (in the future, or over 3 years ago), and the review screen only warns when there's no date at all. A future date puts the receipt in a month Overview can't reach ("next month" stops at this month), so it drops out of the dashboard.
- **Change:** the review screen shows "This date looks wrong: check it" for `date-implausible`. A future date isn't filled in: today is, with "Couldn't read the date: check it". The review and receipt-detail date fields get `max` set to today, like Add expense, and saving refuses a future date. Receipts already saved with a future date get a "Check the date" mark in History.
- **Check:** a new `tests/draft.spec.ts`: a future date becomes today, with the note; an old one is kept, with the note.

**3b. The same receipt saved twice.**
- **Problem:** nothing checks for duplicates; the same photo chosen twice counts twice.
- **Change:** `findDuplicate(draft)` in `src/db/receipts.ts` looks for a saved receipt with the same date and total (and the same shop, when known), using the `date` index. The review screen then says "You already saved this receipt (Winners, 12 Oct, Rs 1,234)" with "See it", and the button reads "Save it again". Add expense does the same. On the Scan list, two receipts with the same shop, date and total are marked "Same as another receipt in this list".
- **Check:** tests in `tests/db.spec.ts`.

### Step 4. Offline use and updates (medium; after 2a)
- **Problem:** the build makes the service worker, but `vite.config.ts` sets `injectRegister: false` and nothing registers it, so it never runs: no offline use, the reader (~13 MB of models plus a ~28 MB engine) is kept only in the browser's ordinary cache, and there's no "new version" prompt.
- **Change:** register it with `useRegisterSW` from `virtual:pwa-register/react` (its types are already in `tsconfig.json`), keeping `workbox-window` out of the start-up files. When a new version is ready, a bar says "A new version is ready" with "Reload", and stays until tapped; it waits while a receipt is being read. This comes after 2a because reloading would otherwise wipe unsaved receipts. Only the Latin Inter font files are precached (the Cyrillic, Greek and Vietnamese ones are never used). The problem report shows whether the offline helper is running.
- **Check:** the §9 hosting check: install on a phone, scan once, switch to airplane mode, scan again; deploy a new version, see the bar, and check the data survives.

### Step 5. Keep the app's promises (small each)
- **5a. Use what's learned about each shop.** Saving learns each shop's total label and date order (`learnHints`), but the reader never uses them: `useReceiptReader.ts` calls `parseReceipt(joined.lines)` without hints. It will read once, find the shop (`findStore`, by VAT number or name), and read again with the shop's hints when it has any. This code loads with the parser, not at start-up. Test: a receipt the general rules get wrong is read right once the shop's total label is known.
- **5b. Take the test page out of Settings.** "Receipt reading test" tells everyone to "run `npm run eval`". Its row moves from Settings to the bottom of the problem report page (`#/debug`); the `#/test` address stays.
- **5c. Remove unused packages:** `exceljs`, `@anthropic-ai/sdk`, `motion`, `zod`, `d3-scale`, `d3-shape` and their `@types`. They come back with the Excel export (Phase 4) and the cloud fallback (Phase 2b). §7 is updated: the charts don't use d3.
- **5d. Guard the start-up budget.** Start-up JS is ~150 KB gzip, right at the §7b limit. First trim 5–10 KB (look at what the ~96 KB main file holds), then add `scripts/check-size.mjs` to the deploy workflow after the build: it fails when the files `index.html` loads go over 150 KB gzip.

### Step 6. Measure reading on real receipts (your part; start now)
- `fixtures/receipts/` is empty, so `npm run eval` is skipped and nobody knows how often a real receipt is read right. That's the app's biggest unknown, and Phase 0's go/no-go was never run.
- Collect 30+ receipts from as many kinds of shop as §8 lists. On a computer: `npm run dev`, open `#/test`, add a photo, correct the answers, save. Read each JSON before committing: the repo is public, so remove card digits, names and addresses. Run `npm run eval` and write the result in §13.
- Below the gate (essentials right on 90%, items adding up on 60% of itemized receipts)? Then parser work comes before step 7 and any new feature.

### Step 7. Smaller improvements (after the above)
- History search also finds items: "nappies" finds the receipt they were on.
- The month-end forecast starts on day 7 instead of day 3, so one big shop early in the month doesn't forecast ten times as much.
- Categories can be renamed and added.
- Price matching reruns over the whole history whenever a receipt changes. Test with a year of sample data (~600 receipts, ~5,000 items); if Overview takes over 100 ms on a mid-range phone, keep the product groups between runs.

**Still to build from the original plan (separate from this list):** Excel export (Phase 4), cloud fallback (Phase 2b), first-run screen and install prompt (Phase 5), personal inflation, joining a product's different names by hand.

**Final check, iPhone and Android:** close the app while it reads two photos, then open it again: both are back. Choose the same photo twice: warned. A receipt with a date in the future: caught. A failed save: says so. Restore an older backup, then Undo. Airplane mode: scanning still works. Deploy a new version: the bar shows, and nothing is lost.

### Progress (2026-10-16)
**Done: steps 1 to 5**, one commit each (5d with step 4). 231 tests pass, type check clean.
- **1.** Price changes only use receipts whose items add up (`src/kpi/adds-up.ts`: `itemsAddUp`, `receiptsAddingUp`); the "based on X of Y" count matches. §10 updated.
- **2a.** `pending` table (`db.version(2)`); `src/scan/pending.ts`; the app's reader (`useReceiptReader({ keep: true })`) writes each unsaved receipt as it changes and brings them back at start-up, already-read ones without reading again (and without starting the reader). The test page's reader doesn't keep anything. Backup leaves the table out; restore leaves it alone.
- **2b.** `src/lib/safely.ts` (`attempt`, `problemWords`) and `useSafely()` in `Toast.tsx`; the toast's problem look (warning icon, `bad` border, 8 s). Every save, change, delete, Undo and restore goes through it; the item sheet stays open when saving fails.
- **2c.** `readBackup`, `restoreQuestion`, `restoreBackup` (gives back what was on the phone) and `undoRestore` in `src/db/backup.ts`; a restored phone counts as backed up at the backup's date. `backupDue` in `src/db/backup-due.ts`; the card is `src/components/BackupReminder.tsx`, loaded only when due; backing up is `useBackUp()` (`src/hooks/useBackUp.ts`), used by Settings too.
- **3a.** `dateFromScan` in `src/scan/draft.ts`; `FUTURE_DATE` in `src/kpi/monthly.ts`; `max` = today on the review and receipt date fields; saving refuses a future date (review, add expense, receipt detail); "Check the date" in History.
- **3b.** `findDuplicate` in `src/db/receipts.ts` (same date and total; same shop by id, or by name when both have one), `useDuplicate` (`src/hooks/useDuplicate.ts`), `DuplicateNote`; "Save it again" / "Add it again"; `sameAsAnother` (`src/scan/notes.ts`) marks the Scan list.
- **4.** `src/components/UpdateBar.tsx` registers the offline helper (`useRegisterSW`, loaded after start-up, checks for a new version hourly); the bar waits while a receipt is read. Latin Inter only in the precache. "Offline helper" line in the problem report.
- **5a.** `parseForShop` (`src/parser/read-for-shop.ts`): read, find the shop, read again with its hints. **5b.** Reading test row at the bottom of `#/debug` ("For developers"); Settings' group is now "Help". **5c.** Packages removed, §7 updated. **5d.** Start-up JS 147.2 KB gzip (it had reached 161 KB while building these steps): `usePrices` and `useDuplicate` moved out of `hooks/data.ts`, the OCR client loads on first use, the backup reminder only when due. `npm run check-size` (`scripts/check-size.mjs`, JS only, CSS listed) runs in the deploy workflow after the build.

**Checked in headless Chrome at phone size (built app, `vite preview`), all passing:** backup reminder; "Check the date" in History; duplicate warning in Add expense; the problem toast in light and dark; restore question, "Restored 1 receipt", Undo; two photos kept while read and back after a reload; look-alike receipts marked; offline helper running and reported; the app opens offline; a new build shows the bar, and Reload takes it.

**Next:**
- **Step 6 (yours):** 30+ real receipts in `fixtures/receipts/`, `npm run eval`, result in §13.
- **Step 7:** after step 6's result (parser work first if below the gate). Nothing started.
- **Final check on real phones** (above), not yet done: the iPhone reload-while-reading case especially.
- 5d asked for 5–10 KB of headroom; it is 2.8 KB. More would mean loading the reader hook later, or the charts; not done.

## 15. Later idea: a gentle reminder of expenses that often go together (not yet; after §14)
**The idea:** a shop trip often comes with spending the app never sees, because there's no receipt or the person forgot: petrol on a supermarket run, lunch out at the mall, parking. If the app could, now and then, quietly ask "you often buy petrol around now too — add it?", it would feel like it understands the person's week, and catch spending that would otherwise be missed.

**Why it's a later idea, not a §14 fix:** §14 is about not losing data and showing right numbers, which has to be solid first. And §6 (real receipts, measured reading) tells us whether the reading is reliable enough to learn habits from. A "smart" feature built on shaky data only amplifies the shakiness.

**The one rule it must not break:** a tracker lives on trust in its numbers. A reminder that *states* spending the person didn't make ("you spent Rs 400 on lunch") is both wrong and annoying, and one wrong number makes every number suspect. So the feature **asks, from the person's own history; it never assumes, never fills in an amount, and never gives generic advice** ("people who shop at malls eat out" is a stranger guessing, not understanding *them*).

**What it does, concretely:**
- After a receipt is saved, it may show **one** quiet card: "You often buy petrol around this time too. Add it?" with **Add** (opens the normal Add-expense sheet, blank, category pre-chosen) and **Not this time**. No amount, ever. It never blocks saving and is never a popup.
- The pattern is learned only from **this person's own receipts**: "a receipt at shop/category X is usually followed within a day or two by an expense of category Y". A pairing counts only after it has repeated (at least 3–4 times). Worked out from saved receipts (`src/kpi/`), nothing sent anywhere.
- It stays **silent until there's enough history** (roughly 6–8 weeks of regular receipts). Silence is the default; a suggestion is the exception.

**The guardrails against nagging (these *are* the spec, not nice-to-haves):**
- **Backs off when ignored.** Dismiss a given suggestion (e.g. petrol) 2–3 times and that one stops for good — "no" is taken as an answer. Counts kept per pattern in `settings`.
- **A hard ceiling on frequency:** at most one suggestion a day, and never two in a row for the same pairing.
- **An easy off switch:** one Settings toggle, "Suggest expenses I might have missed" (and "Don't suggest this again" on the card itself). Off turns the whole thing silent.
- **Off by default at first.** Ship it off, live with it on your own receipts for a few weeks, and only turn it on for everyone once it has never once made you roll your eyes.

**The test to hold it to:** if the feature vanished, would anyone feel nagged by its absence? No. It should feel like the app being occasionally thoughtful — mildly welcome, never irritating. When in doubt about showing a given reminder, don't.

**Check:** the "is this a real pattern / should it show now" logic is a pure, tested function (how many repeats, the day limit, the back-off, the history threshold) with no UI. The card itself is checked in light and dark, and that dismissing it records the back-off.
