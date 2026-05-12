import type { WbsTask } from '@/types';

export type StatusBucket =
  | 'completed'
  | 'in-progress'
  | 'overdue'
  | 'late-start'
  | 'not-started';

export interface ComputedStatus {
  bucket: StatusBucket;
  label: string;       // 完了 / 実行中 / 遅延中 / 着手遅れ / 未着手
  extended: string;    // 2日前倒し / あと3日 / 5日経過 / etc.
  className: string;   // CSS modifier for badge styling
  icon: string;        // unicode dot
}

export const STATUS_BUCKETS: ReadonlyArray<{ bucket: StatusBucket; label: string }> = [
  { bucket: 'completed', label: '完了' },
  { bucket: 'in-progress', label: '実行中' },
  { bucket: 'overdue', label: '遅延中' },
  { bucket: 'late-start', label: '着手遅れ' },
  { bucket: 'not-started', label: '未着手' },
];

function parseDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

export function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function businessDaysBetween(a: Date, b: Date): number {
  if (a.getTime() > b.getTime()) return 0;
  let count = 0;
  const cursor = new Date(a.getTime());
  while (cursor.getTime() <= b.getTime()) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

/**
 * Pure function: maps a task into one of five status buckets plus a short
 * extended-info string based on today's date. Same logic applies to leaf
 * (level=3) and aggregate (level=1/2) rows — the server-side aggregation
 * already rolls up actualStart / actualEnd correctly, so this just reads
 * those rolled-up values.
 */
export function computeStatus(task: WbsTask, today: Date = todayUtc()): ComputedStatus {
  // 1) Completed — actual end is set.
  if (task.actualEndDate) {
    const ae = parseDate(task.actualEndDate);
    const pe = task.endDate ? parseDate(task.endDate) : null;
    if (pe && ae.getTime() <= pe.getTime()) {
      const earlyDays = Math.max(0, businessDaysBetween(ae, pe) - 1);
      return {
        bucket: 'completed',
        label: '完了',
        extended: earlyDays > 0 ? `${earlyDays}日前倒し` : '予定通り',
        className: 'status-completed',
        icon: '●',
      };
    }
    if (pe && ae.getTime() > pe.getTime()) {
      const lateDays = Math.max(0, businessDaysBetween(pe, ae) - 1);
      return {
        bucket: 'completed',
        label: '完了',
        extended: `${lateDays}日遅れ`,
        className: 'status-completed-late',
        icon: '●',
      };
    }
    return {
      bucket: 'completed',
      label: '完了',
      extended: '',
      className: 'status-completed',
      icon: '●',
    };
  }

  // 2) In progress — actual start set, actual end not set.
  if (task.actualStartDate) {
    if (task.endDate) {
      const pe = parseDate(task.endDate);
      if (today.getTime() <= pe.getTime()) {
        const remaining = Math.max(0, businessDaysBetween(today, pe) - 1);
        return {
          bucket: 'in-progress',
          label: '実行中',
          extended: remaining > 0 ? `あと${remaining}日` : '本日終了予定',
          className: 'status-in-progress',
          icon: '●',
        };
      }
      const overdueDays = Math.max(0, businessDaysBetween(pe, today) - 1);
      return {
        bucket: 'overdue',
        label: '遅延中',
        extended: `${overdueDays}日経過`,
        className: 'status-overdue',
        icon: '●',
      };
    }
    return {
      bucket: 'in-progress',
      label: '実行中',
      extended: '',
      className: 'status-in-progress',
      icon: '●',
    };
  }

  // 3) Not yet started — actual start not set.
  if (task.startDate) {
    const ps = parseDate(task.startDate);
    if (today.getTime() < ps.getTime()) {
      const daysUntil = Math.max(0, businessDaysBetween(today, ps) - 1);
      return {
        bucket: 'not-started',
        label: '未着手',
        extended: daysUntil > 0 ? `${daysUntil}日後に開始` : '本日開始',
        className: 'status-not-started',
        icon: '○',
      };
    }
    const lateDays = Math.max(0, businessDaysBetween(ps, today) - 1);
    return {
      bucket: 'late-start',
      label: '着手遅れ',
      extended: `${lateDays}日経過`,
      className: 'status-late-start',
      icon: '●',
    };
  }

  // 4) Empty — no dates yet.
  return {
    bucket: 'not-started',
    label: '未着手',
    extended: '',
    className: 'status-not-started',
    icon: '○',
  };
}
