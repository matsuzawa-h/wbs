/**
 * Generate a list of common Japanese national holidays for a given year.
 *
 * Covers the recurring set (元日, 建国記念の日, ...) plus 'Happy Monday' style
 * holidays computed as the nth Monday of the month, and astronomical holidays
 * (春分の日, 秋分の日) using the well-known approximation valid roughly
 * 1980-2099. Substitute holidays (振替休日) and 国民の休日 are not generated
 * — users can add them manually.
 */
export interface JpHoliday {
  date: string; // YYYY-MM-DD
  name: string;
}

function fmt(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function nthMondayOfMonth(year: number, month: number, n: number): string {
  // month is 1-indexed
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstDow = first.getUTCDay(); // 0=Sun ... 1=Mon
  const offset = (1 - firstDow + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  return fmt(year, month, day);
}

function shunbun(year: number): string {
  // Vernal equinox day, approximation valid 1980..2099
  const day = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  return fmt(year, 3, day);
}

function shubun(year: number): string {
  // Autumnal equinox day, approximation valid 1980..2099
  const day = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  return fmt(year, 9, day);
}

export function japaneseHolidaysForYear(year: number): JpHoliday[] {
  return [
    { date: fmt(year, 1, 1), name: '元日' },
    { date: nthMondayOfMonth(year, 1, 2), name: '成人の日' },
    { date: fmt(year, 2, 11), name: '建国記念の日' },
    { date: fmt(year, 2, 23), name: '天皇誕生日' },
    { date: shunbun(year), name: '春分の日' },
    { date: fmt(year, 4, 29), name: '昭和の日' },
    { date: fmt(year, 5, 3), name: '憲法記念日' },
    { date: fmt(year, 5, 4), name: 'みどりの日' },
    { date: fmt(year, 5, 5), name: 'こどもの日' },
    { date: nthMondayOfMonth(year, 7, 3), name: '海の日' },
    { date: fmt(year, 8, 11), name: '山の日' },
    { date: nthMondayOfMonth(year, 9, 3), name: '敬老の日' },
    { date: shubun(year), name: '秋分の日' },
    { date: nthMondayOfMonth(year, 10, 2), name: 'スポーツの日' },
    { date: fmt(year, 11, 3), name: '文化の日' },
    { date: fmt(year, 11, 23), name: '勤労感謝の日' },
  ];
}
