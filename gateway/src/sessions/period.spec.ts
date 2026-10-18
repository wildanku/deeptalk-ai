import { periodMonth } from './period';

describe('periodMonth', () => {
  it('uses the Jakarta calendar month, not UTC', () => {
    // 2026-10-31 18:30 UTC is already 1 November 01:30 in Jakarta (UTC+7).
    expect(periodMonth(new Date('2026-10-31T18:30:00Z'), 'Asia/Jakarta')).toBe(
      '2026-11',
    );
    expect(periodMonth(new Date('2026-10-31T16:59:59Z'), 'Asia/Jakarta')).toBe(
      '2026-10',
    );
  });
});
