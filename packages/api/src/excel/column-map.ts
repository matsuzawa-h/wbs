// Findings from packages/api/scripts/inspect-xls.js against
// C:\Git\WBS\テンプレートファイル.xls:
// - Workbook sheets and BOF offsets:
//   スケジュール=88688, 担当者一覧=155848, 標準工程=210183, 設定=269106.
// - スケジュール row 3 is the header row; row 5 is the first task data row.
// - Last populated sample data row is row 45. Row 46 exists as a formatted
//   blank row with MulBlank records, and rows 47-60 are absent.
// - Template data cells are stored as LabelSST/RK/MulRK/MulBlank records.
//   Unused formatted cells are Blank/MulBlank records rather than missing
//   records through row 46.
// - 0-indexed data columns from the decoded header:
//   大項目=1, 中項目=2, 項番=3, 項目(項目名)=4, 開始日=5, 日数=6,
//   終了日=7, 開始(実績)=8, 実績日数=9, 終了(実績)=10, 遅れ=11,
//   進捗=12, 工数=13, 先行関係=14, 先行関係補助=15, 担当=16, 状態=17.
// - "工数" (col 13, Excel column N) represents 実績工数 — actual hours
//   logged after the work was performed. Plan hours have no place in
//   this template.

export const SCHEDULE_SHEET_NAME = 'スケジュール';
export const EMPLOYEES_SHEET_NAME = '担当者一覧';

export const TEMPLATE_DATA_START_ROW = 5;
export const TEMPLATE_DATA_END_ROW = 45;
export const TEMPLATE_FORMATTED_BLANK_ROW = 46;

// 担当者一覧 sheet (0-indexed) — row 2 is the header, data starts at row 3.
// Capacity confirmed up to row 45 (43 data rows) after the user expanded the
// template. col 8 ("サンプル") is intentionally left blank by the exporter.
export const EMPLOYEES_DATA_START_ROW = 3;
export const EMPLOYEES_DATA_END_ROW = 45;
export const EMPLOYEES_COLUMNS = {
  // The legacy template separates "担当" (the identifier used in
  // スケジュール col Q) from "メンバ" (the person's display name). The Web
  // app writes the same employee name in both places to keep
  // スケジュール sheet's existing 担当 value matched without changing it.
  role: 2,
  name: 3,
  employmentStart: 4,
  employmentEnd: 5,
  worksOnHolidays: 6,
} as const;

export const EMPLOYEES_COLUMNS_TO_CLEAR = [
  EMPLOYEES_COLUMNS.role,
  EMPLOYEES_COLUMNS.name,
  EMPLOYEES_COLUMNS.employmentStart,
  EMPLOYEES_COLUMNS.employmentEnd,
  EMPLOYEES_COLUMNS.worksOnHolidays,
] as const;

export const WBS_COLUMNS = {
  majorItem: 1,
  middleItem: 2,
  itemNumber: 3,
  itemName: 4,
  startDate: 5,
  duration: 6,
  endDate: 7,
  actualStartDate: 8,
  actualDuration: 9,
  actualEndDate: 10,
  delay: 11,
  progress: 12,
  actualHours: 13,
  predecessor: 14,
  predecessorLink: 15,
  assignee: 16,
  status: 17,
} as const;

export const DATA_COLUMNS_TO_CLEAR = [
  WBS_COLUMNS.majorItem,
  WBS_COLUMNS.middleItem,
  WBS_COLUMNS.itemNumber,
  WBS_COLUMNS.itemName,
  WBS_COLUMNS.startDate,
  WBS_COLUMNS.duration,
  WBS_COLUMNS.endDate,
  WBS_COLUMNS.actualStartDate,
  WBS_COLUMNS.actualDuration,
  WBS_COLUMNS.actualEndDate,
  WBS_COLUMNS.delay,
  WBS_COLUMNS.progress,
  WBS_COLUMNS.actualHours,
  WBS_COLUMNS.predecessor,
  WBS_COLUMNS.predecessorLink,
  WBS_COLUMNS.assignee,
  WBS_COLUMNS.status,
] as const;
