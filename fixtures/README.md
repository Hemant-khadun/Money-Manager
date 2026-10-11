# Phase 0 eval fixtures

`receipts/<name>.json`: one real receipt each, made with Spent's receipt reading test page (`npm run dev`, then "All correct, save").
Each file holds the OCR lines plus the hand-checked answers (store, date, total in cents, payment, whether it lists items).

- `npm run eval` re-parses every fixture with `"checked": true` and prints essentials accuracy and the items-add-up rate against the go/no-go gate in [docs/PLAN.md](../docs/PLAN.md) §8.
- The fixtures also run with `npm test`, so a parser change that breaks a real receipt shows up as a failing test.
- Keep photos next to their JSON if useful. Image files here are gitignored because receipts show addresses and card digits, and the repo is public. The JSON does contain the receipt's text, so look through it before committing.
- A long receipt saved from several photos keeps each photo's reading under `ocr.photos`; the eval re-joins them, so changes to the joining are measured too.
- Aim for 30+ receipts from as many kinds of shop as possible: supermarket, pharmacy, fuel, restaurant, hardware, clothing, card-terminal slips, long, faded and crumpled ones.
