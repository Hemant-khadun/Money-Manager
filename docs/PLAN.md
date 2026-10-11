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
- **Charts: small hand-built SVG components** (bars, meters, sparkline, price line) using `d3-scale`/`d3-shape` for the maths. No heavy chart library: full control over the Apple-style look and a far smaller bundle than ECharts.
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

**Colour tokens** (`src/styles/tokens.css`). The names follow **shadcn/ui** (`--background`, `--card`, `--primary`, `--muted-foreground`…), so components pasted from ui.shadcn.com or 21st.dev take on Spent's colours. Dark values under `prefers-color-scheme`, and again under `[data-theme='dark']` for the Light/Dark choice in Settings. Contrast checked: text ≥ 4.5:1, icons and marks ≥ 3:1.

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
- `dark:` in Tailwind follows Spent's theme (the phone's setting unless Settings chose Light or Dark), so pasted components' dark styles work.

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
- Pasted components land in `src/components/ui/`. Spent's own building blocks are in `src/components/primitives.tsx`, so the two never clash.
- They pick up Spent's colours and dark mode as they are; restyle only what clashes with the principles above.
- Check the weight before using one at startup: many use `framer-motion` or `recharts`, and `cn()` brings `tailwind-merge` (~7 KB). Fine on screens that load later; on Overview, compare with the budget.
- Check each component's licence on its page before shipping it. The CLI may also add CSS variables to `src/index.css`; keep Spent's tokens.

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
- **Name:** **Spent**. Tagline: "Snap your receipts. See where your money goes." All wording people see stays plain and everyday, never technical.
- **Long receipts:** one receipt can have several photos, taken top to bottom with each repeating a few lines of the one before. Each photo is read on its own, then they are joined where they overlap (`src/pipeline/stitch.ts`); shared lines are kept once, in the clearer reading, and photos picked out of order are put back in order. No separate "long receipt" mode: photos added together are sorted automatically (`groupPhotos`): a photo continues another only when the shared lines sit at the very bottom of one and the very top of the other and both add lines of their own, so separate receipts from the same shop (same header and footer) stay apart. The scan screen offers "Keep them as separate receipts" to undo a join, and "Add another photo of this receipt" for photos taken later.
- **Receipts:** any store, no per-store setup. Always save the essentials (store, date, total, category, payment method). Save items only when they add up to the total. Keep a ~30 KB thumbnail of the photo. Discard everything else after review.
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
    components/primitives.tsx   Spent's own building blocks (cards, rows, buttons, segmented control)
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

**Not yet:** Excel export (Phase 4); PWA icons, install prompt, update toast and GitHub Pages deploy (Phase 5); cloud fallback (Phase 2b); personal inflation (basket index); joining one product's different names by hand; editing category names; backup reminder after 30 days; Phase 0 accuracy measurement on 30+ real receipts.
