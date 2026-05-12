export function parseDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

export function formatDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isWeekend(date: Date): boolean {
  const dow = date.getUTCDay();
  return dow === 0 || dow === 6;
}

export function nextBusinessDay(date: Date): Date {
  const next = new Date(date.getTime());
  do {
    next.setUTCDate(next.getUTCDate() + 1);
  } while (isWeekend(next));
  return next;
}

export function previousBusinessDay(date: Date): Date {
  const prev = new Date(date.getTime());
  do {
    prev.setUTCDate(prev.getUTCDate() - 1);
  } while (isWeekend(prev));
  return prev;
}

export function snapToBusinessDay(date: Date): Date {
  if (!isWeekend(date)) return date;
  return nextBusinessDay(date);
}

/**
 * Add N business days (weekends skipped). days=0 returns the input (snapped onto a weekday).
 * Positive = forward, Negative = backward.
 */
export function addBusinessDays(start: Date, days: number): Date {
  let current = snapToBusinessDay(start);
  if (days === 0) return current;
  const step = days > 0 ? 1 : -1;
  let remaining = Math.abs(days);
  while (remaining > 0) {
    current = new Date(current.getTime());
    do {
      current.setUTCDate(current.getUTCDate() + step);
    } while (isWeekend(current));
    remaining -= 1;
  }
  return current;
}

/**
 * Count business days between a and b (inclusive of both endpoints if both are weekdays).
 * Returns 0 if a > b.
 */
export function businessDaysBetween(a: Date, b: Date): number {
  if (a.getTime() > b.getTime()) return 0;
  let count = 0;
  const cursor = new Date(a.getTime());
  while (cursor.getTime() <= b.getTime()) {
    if (!isWeekend(cursor)) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

/**
 * Compute endDate (inclusive) given startDate and duration in business days.
 * duration=1 means same-day finish (1 business day).
 */
export function computeEndDate(startDate: string, duration: number): string {
  const start = snapToBusinessDay(parseDate(startDate));
  const end = addBusinessDays(start, Math.max(0, duration - 1));
  return formatDate(end);
}
