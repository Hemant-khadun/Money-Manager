import { describe, expect, it } from 'vitest';
import { dateFromScan } from '../src/scan/draft';

const TODAY = '2026-10-16';

describe('dateFromScan', () => {
  it('keeps a believable date, with nothing to check', () => {
    expect(dateFromScan({ date: '2026-10-12', warnings: [] }, TODAY)).toEqual({ date: '2026-10-12', note: null });
  });

  it("fills in today for a date in the future, asking to check it", () => {
    for (const date of ['2026-10-17', '2027-03-01']) {
      expect(dateFromScan({ date, warnings: date > '2026-10-17' ? ['date-implausible'] : [] }, TODAY)).toEqual({ date: TODAY, note: "Couldn't read the date: check it." });
    }
  });

  it('keeps a date from long ago (it may be an old receipt), asking to check it', () => {
    expect(dateFromScan({ date: '2021-05-02', warnings: ['date-implausible'] }, TODAY)).toEqual({ date: '2021-05-02', note: 'This date looks wrong: check it.' });
  });

  it('fills in today when no date was found', () => {
    expect(dateFromScan({ date: null, warnings: ['no-date'] }, TODAY)).toEqual({ date: TODAY, note: "Couldn't read the date: check it." });
  });
});
