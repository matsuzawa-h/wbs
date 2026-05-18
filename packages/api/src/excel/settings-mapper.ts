import { CellUpdate } from './biff-writer';
import {
  SETTINGS_BASE_DATE_ROW,
  SETTINGS_CHART_START_ROW,
  SETTINGS_VALUE_COL,
} from './column-map';
import { toExcelSerialDate, WbsExportTask } from './wbs-mapper';

/**
 * Updates the 設定 sheet to reflect the current project:
 *   - チャート表示開始日 = earliest level-3 startDate minus 7 days
 *     (falls back to today - 7 days when there are no scheduled tasks)
 *   - 表示基準日 (現在日) = today
 */
export function buildSettingsCellUpdates(
  tasks: WbsExportTask[],
  now: Date,
): CellUpdate[] {
  const updates: CellUpdate[] = [];

  const earliest = findEarliestStartDate(tasks);
  const chartStartSerial = earliest === null
    ? subtractDays(toSerial(now), 7)
    : earliest - 7;
  updates.push({
    row: SETTINGS_CHART_START_ROW,
    col: SETTINGS_VALUE_COL,
    value: chartStartSerial,
  });

  updates.push({
    row: SETTINGS_BASE_DATE_ROW,
    col: SETTINGS_VALUE_COL,
    value: toSerial(now),
  });

  return updates;
}

function findEarliestStartDate(tasks: WbsExportTask[]): number | null {
  let min: number | null = null;
  for (const t of tasks) {
    if (t.level !== 3) continue;
    const serial = toExcelSerialDate(t.startDate);
    if (serial === null) continue;
    if (min === null || serial < min) min = serial;
  }
  return min;
}

function toSerial(d: Date): number {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const ymd = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const serial = toExcelSerialDate(ymd);
  if (serial === null) {
    throw new Error(`Failed to convert ${ymd} to Excel serial date`);
  }
  return serial;
}

function subtractDays(serial: number, days: number): number {
  return serial - days;
}
