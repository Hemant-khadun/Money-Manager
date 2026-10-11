// Phase 0 accuracy report: re-parses every hand-checked receipt in fixtures/receipts/ and
// reports essentials accuracy and the items-add-up rate against the plan's go/no-go gate.
// Fixtures are made with the OCR spike page ("Save fixture"). Run alone with `npm run eval`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { fixtureLines, GATE, scoreReceipt, type ReceiptFixture, type ReceiptScore } from '../src/eval/fixture';
import { parseReceipt } from '../src/parser/parse';

const DIR = fileURLToPath(new URL('../fixtures/receipts/', import.meta.url));
const fixtures: ReceiptFixture[] = existsSync(DIR)
  ? readdirSync(DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as ReceiptFixture)
  : [];
const checked = fixtures.filter((f) => f.expected.checked);
const results: Array<{ fixture: ReceiptFixture; score: ReceiptScore }> = [];

const pct = (n: number, d: number) => (d ? `${n}/${d} = ${Math.round((n / d) * 100)}%` : 'n/a');
const tick = (v: boolean | null) => (v === null ? '·' : v ? '✓' : '✗');

describe.skipIf(checked.length === 0)('Phase 0 eval fixtures', () => {
  for (const fixture of checked) {
    it(`${fixture.name} (${fixture.expected.kind})`, () => {
      const parsed = parseReceipt(fixtureLines(fixture), { today: fixture.capturedAt });
      const score = scoreReceipt(parsed, fixture.expected);
      results.push({ fixture, score });
      expect.soft(score.store, `store: read "${parsed.storeName}", expected "${fixture.expected.store}"`).toBe(true);
      expect.soft(parsed.date, 'date').toBe(fixture.expected.date);
      expect.soft(parsed.total, 'total (cents)').toBe(fixture.expected.total);
    });
  }

  afterAll(() => {
    const essentials = results.filter((r) => r.score.essentials).length;
    const itemized = results.filter((r) => r.score.itemsAddUp !== null);
    const addUp = itemized.filter((r) => r.score.itemsAddUp).length;
    const width = Math.max(12, ...results.map((r) => r.fixture.name.length));
    const rows = results.map(({ fixture, score }) =>
      [fixture.name.padEnd(width), fixture.expected.kind.padEnd(11), ...[score.store, score.date, score.total, score.payment, score.itemsAddUp].map((v) => tick(v).padEnd(6))].join(' '),
    );
    const kinds = [...new Set(results.map((r) => r.fixture.expected.kind))].map((kind) => {
      const ofKind = results.filter((r) => r.fixture.expected.kind === kind);
      return `${kind} ${ofKind.filter((r) => r.score.essentials).length}/${ofKind.length}`;
    });
    const gate = (rate: number, target: number) => (rate >= target ? 'PASS' : 'BELOW GATE');
    console.log(
      [
        `Phase 0 eval: ${results.length} checked receipts${fixtures.length > checked.length ? ` (${fixtures.length - checked.length} not checked yet, skipped)` : ''}`,
        `${''.padEnd(width)} ${'kind'.padEnd(11)} store  date   total  pay    items`,
        ...rows,
        '',
        `Essentials (store + date + total): ${pct(essentials, results.length)}  gate ${GATE.essentials * 100}% → ${gate(essentials / results.length, GATE.essentials)}`,
        `Items add up (itemized receipts):  ${pct(addUp, itemized.length)}  gate ${GATE.itemsAddUp * 100}% → ${itemized.length ? gate(addUp / itemized.length, GATE.itemsAddUp) : 'n/a'}`,
        `Essentials by kind: ${kinds.join(' · ')}`,
      ].join('\n'),
    );
  });
});
