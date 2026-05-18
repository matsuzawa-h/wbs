import { CellUpdate } from './biff-writer';
import {
  DATA_COLUMNS_TO_CLEAR,
  SCHEDULE_TITLE_COL,
  SCHEDULE_TITLE_ROW,
  TEMPLATE_DATA_END_ROW,
  TEMPLATE_DATA_START_ROW,
  WBS_COLUMNS,
} from './column-map';

export interface WbsExportTask {
  id: number;
  level: number;
  parentId: number | null;
  name: string;
  startDate: string | null;
  duration: number | null;
  endDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  plannedHours: number | null;
  actualHours: number | null;
  progress: number;
  assigneeName?: string | null;
  status: string | null;
  sortOrder: number;
}

export function buildWbsCellUpdates(
  tasks: WbsExportTask[],
  projectTitle?: string,
): CellUpdate[] {
  // Only leaf (level=3) tasks consume rows. 大項目 / 中項目 names piggy-back on
  // the first leaf row under them; subsequent leaves under the same parent
  // leave those columns blank. This matches the legacy Excel template's
  // visual format where the leftmost two columns are vertically merged.
  const leafRows = collectLeafRowsWithAncestry(tasks);
  const capacity = TEMPLATE_DATA_END_ROW - TEMPLATE_DATA_START_ROW + 1;
  if (leafRows.length > capacity) {
    throw new Error(
      `Template capacity exceeded: ${leafRows.length} leaf rows for ${capacity} template rows`,
    );
  }

  const updates: CellUpdate[] = [];
  if (projectTitle !== undefined) {
    // DEFW_DspGp_Title → スケジュール!B1; drives the gantt header title.
    updates.push({ row: SCHEDULE_TITLE_ROW, col: SCHEDULE_TITLE_COL, value: projectTitle });
  }
  let lastMajorId: number | null = null;
  let lastMiddleId: number | null = null;

  leafRows.forEach(({ task, majorItem, middleItem }, index) => {
    const row = TEMPLATE_DATA_START_ROW + index;
    updates.push(...clearRow(row));

    if (majorItem && majorItem.id !== lastMajorId) {
      updates.push({ row, col: WBS_COLUMNS.majorItem, value: majorItem.name });
      lastMajorId = majorItem.id;
      // A new 大項目 also restarts the 中項目 sequence so the first 中項目
      // under it always gets its name written.
      lastMiddleId = null;
    }
    if (middleItem && middleItem.id !== lastMiddleId) {
      updates.push({ row, col: WBS_COLUMNS.middleItem, value: middleItem.name });
      lastMiddleId = middleItem.id;
    }

    updates.push(
      { row, col: WBS_COLUMNS.itemNumber, value: formatItemNumber(index + 1) },
      { row, col: WBS_COLUMNS.itemName, value: task.name },
      { row, col: WBS_COLUMNS.startDate, value: toExcelSerialDate(task.startDate) },
      { row, col: WBS_COLUMNS.duration, value: task.duration },
      { row, col: WBS_COLUMNS.endDate, value: toExcelSerialDate(task.endDate) },
      { row, col: WBS_COLUMNS.actualStartDate, value: toExcelSerialDate(task.actualStartDate) },
      { row, col: WBS_COLUMNS.actualDuration, value: actualDuration(task) },
      { row, col: WBS_COLUMNS.actualEndDate, value: toExcelSerialDate(task.actualEndDate) },
      { row, col: WBS_COLUMNS.delay, value: delayDays(task) },
      { row, col: WBS_COLUMNS.progress, value: task.progress / 100 },
      // Template column N is 実績工数 (actual hours logged), not plan.
      { row, col: WBS_COLUMNS.actualHours, value: task.actualHours },
      { row, col: WBS_COLUMNS.assignee, value: task.assigneeName ?? null },
      { row, col: WBS_COLUMNS.status, value: emptyToNull(task.status) },
    );
  });

  for (
    let row = TEMPLATE_DATA_START_ROW + leafRows.length;
    row <= TEMPLATE_DATA_END_ROW;
    row += 1
  ) {
    updates.push(...clearRow(row));
  }

  return updates;
}

interface LeafRow {
  task: WbsExportTask;
  majorItem: WbsExportTask | null;
  middleItem: WbsExportTask | null;
}

function collectLeafRowsWithAncestry(tasks: WbsExportTask[]): LeafRow[] {
  const flat = flattenTasks(tasks);
  const byId = new Map(flat.map((t) => [t.id, t]));
  const result: LeafRow[] = [];
  for (const task of flat) {
    if (task.level !== 3) continue;
    const middleItem = task.parentId !== null ? byId.get(task.parentId) ?? null : null;
    const majorItem =
      middleItem && middleItem.parentId !== null
        ? byId.get(middleItem.parentId) ?? null
        : null;
    result.push({ task, majorItem, middleItem });
  }
  return result;
}

export function flattenTasks(tasks: WbsExportTask[]): WbsExportTask[] {
  const sorted = [...tasks].sort(compareTasks);
  const childrenByParent = new Map<number | null, WbsExportTask[]>();
  for (const task of sorted) {
    const key = task.parentId ?? null;
    const children = childrenByParent.get(key) ?? [];
    children.push(task);
    childrenByParent.set(key, children);
  }

  const result: WbsExportTask[] = [];
  const seen = new Set<number>();

  function visit(task: WbsExportTask): void {
    if (seen.has(task.id)) return;
    seen.add(task.id);
    result.push(task);
    for (const child of childrenByParent.get(task.id) ?? []) {
      visit(child);
    }
  }

  for (const root of childrenByParent.get(null) ?? []) {
    visit(root);
  }

  for (const task of sorted) {
    if (!seen.has(task.id)) visit(task);
  }

  return result;
}

export function toExcelSerialDate(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const serial = Math.floor(
    (Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 31)) / 86_400_000,
  );
  return serial >= 60 ? serial + 1 : serial;
}

// Inverse of toExcelSerialDate. Returns YYYY-MM-DD, or null for nullish/NaN.
// Handles Excel's 1900-leap-year bug (serial 60 = fictitious 1900-02-29) by
// shifting back for serials > 60.
export function fromExcelSerialDate(serial: number | null | undefined): string | null {
  if (serial === null || serial === undefined) return null;
  if (typeof serial !== 'number' || !Number.isFinite(serial)) return null;
  const intSerial = Math.floor(serial);
  const adjusted = intSerial >= 61 ? intSerial - 1 : intSerial;
  const utcMs = Date.UTC(1899, 11, 31) + adjusted * 86_400_000;
  const d = new Date(utcMs);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function clearRow(row: number): CellUpdate[] {
  return DATA_COLUMNS_TO_CLEAR.map((col) => ({ row, col, value: null }));
}

function formatItemNumber(sequence: number): string {
  return `A-${String(sequence).padStart(2, '0')}`;
}

function compareTasks(a: WbsExportTask, b: WbsExportTask): number {
  return a.sortOrder - b.sortOrder || a.id - b.id;
}

function emptyToNull(value: string | null): string | null {
  return value && value.length > 0 ? value : null;
}

function actualDuration(task: WbsExportTask): number | null {
  if (!task.actualStartDate || !task.actualEndDate) return null;
  const days = calendarDayDiff(task.actualStartDate, task.actualEndDate);
  return days === null ? null : days + 1;
}

function delayDays(task: WbsExportTask): number | null {
  if (!task.endDate || !task.actualEndDate) return null;
  const days = calendarDayDiff(task.endDate, task.actualEndDate);
  return days !== null && days > 0 ? days : null;
}

function calendarDayDiff(start: string, end: string): number | null {
  const startSerial = toExcelSerialDate(start);
  const endSerial = toExcelSerialDate(end);
  if (startSerial === null || endSerial === null) return null;
  return endSerial - startSerial;
}
