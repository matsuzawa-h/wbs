import { CellUpdate } from './biff-writer';
import {
  DATA_COLUMNS_TO_CLEAR,
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
  progress: number;
  assigneeName?: string | null;
  status: string | null;
  sortOrder: number;
}

export function buildWbsCellUpdates(tasks: WbsExportTask[]): CellUpdate[] {
  const flatRows = flattenTasks(tasks);
  const capacity = TEMPLATE_DATA_END_ROW - TEMPLATE_DATA_START_ROW + 1;
  if (flatRows.length > capacity) {
    throw new Error(
      `Template capacity exceeded: ${flatRows.length} WBS rows for ${capacity} template rows`,
    );
  }

  const updates: CellUpdate[] = [];
  let leafSequence = 1;

  flatRows.forEach((task, index) => {
    const row = TEMPLATE_DATA_START_ROW + index;
    updates.push(...clearRow(row));

    if (task.level === 1) {
      updates.push({ row, col: WBS_COLUMNS.majorItem, value: task.name });
      return;
    }

    if (task.level === 2) {
      updates.push({ row, col: WBS_COLUMNS.middleItem, value: task.name });
      return;
    }

    updates.push(
      { row, col: WBS_COLUMNS.itemNumber, value: formatItemNumber(leafSequence) },
      { row, col: WBS_COLUMNS.itemName, value: task.name },
      { row, col: WBS_COLUMNS.startDate, value: toExcelSerialDate(task.startDate) },
      { row, col: WBS_COLUMNS.duration, value: task.duration },
      { row, col: WBS_COLUMNS.endDate, value: toExcelSerialDate(task.endDate) },
      { row, col: WBS_COLUMNS.actualStartDate, value: toExcelSerialDate(task.actualStartDate) },
      { row, col: WBS_COLUMNS.actualDuration, value: actualDuration(task) },
      { row, col: WBS_COLUMNS.actualEndDate, value: toExcelSerialDate(task.actualEndDate) },
      { row, col: WBS_COLUMNS.delay, value: delayDays(task) },
      { row, col: WBS_COLUMNS.progress, value: task.progress / 100 },
      { row, col: WBS_COLUMNS.plannedHours, value: task.plannedHours },
      { row, col: WBS_COLUMNS.assignee, value: task.assigneeName ?? null },
      { row, col: WBS_COLUMNS.status, value: emptyToNull(task.status) },
    );
    leafSequence += 1;
  });

  for (
    let row = TEMPLATE_DATA_START_ROW + flatRows.length;
    row <= TEMPLATE_DATA_END_ROW;
    row += 1
  ) {
    updates.push(...clearRow(row));
  }

  return updates;
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
