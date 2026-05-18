import { CellUpdate } from './biff-writer';
import {
  EMPLOYEES_COLUMNS,
  EMPLOYEES_COLUMNS_TO_CLEAR,
  EMPLOYEES_DATA_END_ROW,
  EMPLOYEES_DATA_START_ROW,
} from './column-map';
import { toExcelSerialDate } from './wbs-mapper';

export interface EmployeeExportRow {
  id: number;
  code: string | null;
  name: string;
  employmentStart: string | null;
  employmentEnd: string | null;
  worksOnHolidays: number;
  isActive: number;
}

// Builds cell updates for the 担当者一覧 sheet. Only active employees are
// included so the master sheet mirrors what the picker shows; inactive
// employees stay invisible.
export function buildEmployeeCellUpdates(employees: EmployeeExportRow[]): CellUpdate[] {
  const visible = employees.filter((e) => e.isActive === 1);
  const capacity = EMPLOYEES_DATA_END_ROW - EMPLOYEES_DATA_START_ROW + 1;
  if (visible.length > capacity) {
    throw new Error(
      `Template capacity exceeded: ${visible.length} active employees for ${capacity} rows in 担当者一覧`,
    );
  }

  const updates: CellUpdate[] = [];

  visible.forEach((emp, index) => {
    const row = EMPLOYEES_DATA_START_ROW + index;
    updates.push(...clearRow(row));
    updates.push(
      { row, col: EMPLOYEES_COLUMNS.role, value: emp.name },
      { row, col: EMPLOYEES_COLUMNS.name, value: emp.name },
      { row, col: EMPLOYEES_COLUMNS.employmentStart, value: toExcelSerialDate(emp.employmentStart) },
      { row, col: EMPLOYEES_COLUMNS.employmentEnd, value: toExcelSerialDate(emp.employmentEnd) },
      { row, col: EMPLOYEES_COLUMNS.worksOnHolidays, value: emp.worksOnHolidays === 1 ? '○' : null },
    );
  });

  for (
    let row = EMPLOYEES_DATA_START_ROW + visible.length;
    row <= EMPLOYEES_DATA_END_ROW;
    row += 1
  ) {
    updates.push(...clearRow(row));
  }

  return updates;
}

function clearRow(row: number): CellUpdate[] {
  return EMPLOYEES_COLUMNS_TO_CLEAR.map((col) => ({ row, col, value: null }));
}
