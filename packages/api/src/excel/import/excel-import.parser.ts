import {
  enumerateWorksheetCells,
  parseBoundSheets,
  readWorkbookStream,
} from '../biff-reader';
import {
  EMPLOYEES_COLUMNS,
  EMPLOYEES_DATA_END_ROW,
  EMPLOYEES_DATA_START_ROW,
  EMPLOYEES_SHEET_NAME,
  SCHEDULE_SHEET_NAME,
  TEMPLATE_DATA_END_ROW,
  TEMPLATE_DATA_START_ROW,
  WBS_COLUMNS,
} from '../column-map';
import { fromExcelSerialDate } from '../wbs-mapper';

export interface ParsedTask {
  index: number;
  level: 1 | 2 | 3;
  parentIndex: number | null;
  name: string;
  startDate: string | null;
  duration: number | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  actualHours: number | null;
  progress: number;
  status: string;
  assigneeName: string | null;
}

export interface ParsedEmployeeHint {
  name: string;
  employmentStart: string | null;
  employmentEnd: string | null;
  worksOnHolidays: boolean;
}

export interface ParsedImport {
  schedule: ParsedTask[];
  employeeHints: ParsedEmployeeHint[];
}

// Reads a BIFF8 .xls Buffer (the same template format we export to) and
// reconstructs the WBS hierarchy plus a list of distinct assignee names seen
// in both the schedule and the dedicated 担当者一覧 sheet.
export function parseExcelImport(fileBuffer: Buffer): ParsedImport {
  const workbook = readWorkbookStream(fileBuffer).data;
  const sheets = parseBoundSheets(workbook).map((s) => s.name);

  const schedule = sheets.includes(SCHEDULE_SHEET_NAME)
    ? parseScheduleSheet(workbook)
    : [];

  const employeeHints = sheets.includes(EMPLOYEES_SHEET_NAME)
    ? parseEmployeesSheet(workbook)
    : [];

  return { schedule, employeeHints };
}

function parseScheduleSheet(workbook: Buffer): ParsedTask[] {
  const cells = enumerateWorksheetCells(
    workbook,
    SCHEDULE_SHEET_NAME,
    TEMPLATE_DATA_START_ROW,
    TEMPLATE_DATA_END_ROW,
  );

  // Group cells by row → col → value for ergonomic access.
  const rowMap = new Map<number, Map<number, string | number | boolean | null>>();
  for (const cell of cells) {
    let row = rowMap.get(cell.row);
    if (!row) {
      row = new Map();
      rowMap.set(cell.row, row);
    }
    row.set(cell.col, cell.value);
  }

  const tasks: ParsedTask[] = [];
  let currentMajor: ParsedTask | null = null;
  let currentMiddle: ParsedTask | null = null;

  const sortedRows = Array.from(rowMap.keys()).sort((a, b) => a - b);
  for (const rowIdx of sortedRows) {
    const row = rowMap.get(rowIdx)!;
    const majorName = readString(row.get(WBS_COLUMNS.majorItem));
    const middleName = readString(row.get(WBS_COLUMNS.middleItem));
    const itemName = readString(row.get(WBS_COLUMNS.itemName));

    // Row 5/6/7... can legitimately have only a leaf name (col 4) on it,
    // because the exporter writes 大/中 names only on the first leaf row of
    // each group. Track currentMajor/currentMiddle across rows so subsequent
    // bare-leaf rows attach correctly.
    if (majorName !== null && (!currentMajor || currentMajor.name !== majorName)) {
      currentMajor = pushTask(tasks, {
        level: 1,
        parentIndex: null,
        name: majorName,
        startDate: null,
        duration: null,
        actualStartDate: null,
        actualEndDate: null,
        actualHours: null,
        progress: 0,
        status: '',
        assigneeName: null,
      });
      currentMiddle = null;
    }

    if (middleName !== null && (!currentMiddle || currentMiddle.name !== middleName)) {
      currentMiddle = pushTask(tasks, {
        level: 2,
        parentIndex: currentMajor ? currentMajor.index : null,
        name: middleName,
        startDate: null,
        duration: null,
        actualStartDate: null,
        actualEndDate: null,
        actualHours: null,
        progress: 0,
        status: '',
        assigneeName: null,
      });
    }

    if (itemName !== null) {
      const parent = currentMiddle ?? currentMajor;
      pushTask(tasks, {
        level: 3,
        parentIndex: parent ? parent.index : null,
        name: itemName,
        startDate: fromExcelSerialDate(readNumber(row.get(WBS_COLUMNS.startDate))),
        duration: readInteger(row.get(WBS_COLUMNS.duration)),
        actualStartDate: fromExcelSerialDate(readNumber(row.get(WBS_COLUMNS.actualStartDate))),
        actualEndDate: fromExcelSerialDate(readNumber(row.get(WBS_COLUMNS.actualEndDate))),
        actualHours: readNumber(row.get(WBS_COLUMNS.actualHours)),
        progress: clampProgress(readNumber(row.get(WBS_COLUMNS.progress))),
        status: readString(row.get(WBS_COLUMNS.status)) ?? '',
        assigneeName: readString(row.get(WBS_COLUMNS.assignee)),
      });
    }
  }

  return tasks;
}

function parseEmployeesSheet(workbook: Buffer): ParsedEmployeeHint[] {
  const cells = enumerateWorksheetCells(
    workbook,
    EMPLOYEES_SHEET_NAME,
    EMPLOYEES_DATA_START_ROW,
    EMPLOYEES_DATA_END_ROW,
  );

  const rowMap = new Map<number, Map<number, string | number | boolean | null>>();
  for (const cell of cells) {
    let row = rowMap.get(cell.row);
    if (!row) {
      row = new Map();
      rowMap.set(cell.row, row);
    }
    row.set(cell.col, cell.value);
  }

  const hints: ParsedEmployeeHint[] = [];
  const seen = new Set<string>();
  const sortedRows = Array.from(rowMap.keys()).sort((a, b) => a - b);
  for (const rowIdx of sortedRows) {
    const row = rowMap.get(rowIdx)!;
    const name =
      readString(row.get(EMPLOYEES_COLUMNS.name)) ??
      readString(row.get(EMPLOYEES_COLUMNS.role));
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const worksOnHolidays = readString(row.get(EMPLOYEES_COLUMNS.worksOnHolidays)) !== null;
    hints.push({
      name,
      employmentStart: fromExcelSerialDate(
        readNumber(row.get(EMPLOYEES_COLUMNS.employmentStart)),
      ),
      employmentEnd: fromExcelSerialDate(
        readNumber(row.get(EMPLOYEES_COLUMNS.employmentEnd)),
      ),
      worksOnHolidays,
    });
  }

  return hints;
}

function pushTask(tasks: ParsedTask[], partial: Omit<ParsedTask, 'index'>): ParsedTask {
  const task: ParsedTask = { index: tasks.length, ...partial };
  tasks.push(task);
  return task;
}

function readString(value: string | number | boolean | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function readNumber(value: string | number | boolean | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value)) return null;
  return value;
}

function readInteger(value: string | number | boolean | null | undefined): number | null {
  const n = readNumber(value);
  if (n === null) return null;
  return Math.round(n);
}

// Excel stores progress as 0.0–1.0 (we write task.progress/100). Convert back
// to integer 0–100 and clamp out-of-range / typed-as-percent values.
function clampProgress(value: number | null): number {
  if (value === null) return 0;
  const pct = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(pct)));
}
