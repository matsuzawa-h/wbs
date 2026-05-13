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

export const SCHEDULE_SHEET_NAME = 'スケジュール';

export const TEMPLATE_DATA_START_ROW = 5;
export const TEMPLATE_DATA_END_ROW = 45;
export const TEMPLATE_FORMATTED_BLANK_ROW = 46;

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
  plannedHours: 13,
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
  WBS_COLUMNS.plannedHours,
  WBS_COLUMNS.predecessor,
  WBS_COLUMNS.predecessorLink,
  WBS_COLUMNS.assignee,
  WBS_COLUMNS.status,
] as const;
