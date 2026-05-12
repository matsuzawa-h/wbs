import {
  addBusinessDays,
  businessDaysBetween,
  computeEndDate,
  formatDate,
  isWeekend,
  parseDate,
  snapToBusinessDay,
} from './business-day.util';

describe('business-day utilities', () => {
  it('parses and formats a date round-trip', () => {
    expect(formatDate(parseDate('2026-05-12'))).toBe('2026-05-12');
  });

  it('detects weekends correctly', () => {
    expect(isWeekend(parseDate('2026-05-09'))).toBe(true);
    expect(isWeekend(parseDate('2026-05-10'))).toBe(true);
    expect(isWeekend(parseDate('2026-05-11'))).toBe(false);
  });

  it('snaps a weekend date to the next Monday', () => {
    expect(formatDate(snapToBusinessDay(parseDate('2026-05-09')))).toBe('2026-05-11');
    expect(formatDate(snapToBusinessDay(parseDate('2026-05-10')))).toBe('2026-05-11');
  });

  it('addBusinessDays skips weekends', () => {
    expect(formatDate(addBusinessDays(parseDate('2026-05-15'), 1))).toBe('2026-05-18');
    expect(formatDate(addBusinessDays(parseDate('2026-05-15'), 3))).toBe('2026-05-20');
  });

  it('addBusinessDays supports negative deltas', () => {
    expect(formatDate(addBusinessDays(parseDate('2026-05-18'), -1))).toBe('2026-05-15');
    expect(formatDate(addBusinessDays(parseDate('2026-05-20'), -3))).toBe('2026-05-15');
  });

  it('computeEndDate is inclusive (Friday + 3 business days = Tuesday)', () => {
    expect(computeEndDate('2026-05-15', 3)).toBe('2026-05-19');
  });

  it('computeEndDate handles duration=1 (same business day)', () => {
    expect(computeEndDate('2026-05-15', 1)).toBe('2026-05-15');
  });

  it('businessDaysBetween counts inclusive weekdays', () => {
    expect(businessDaysBetween(parseDate('2026-05-15'), parseDate('2026-05-19'))).toBe(3);
    expect(businessDaysBetween(parseDate('2026-05-15'), parseDate('2026-05-15'))).toBe(1);
  });
});
