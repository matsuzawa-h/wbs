import { readFileSync } from 'fs';
import { resolve } from 'path';
import { applyCellUpdates } from '../biff-writer';
import { EMPLOYEES_SHEET_NAME } from '../column-map';
import { buildEmployeeCellUpdates } from '../employees-mapper';
import { buildWbsCellUpdates, WbsExportTask } from '../wbs-mapper';
import { parseExcelImport } from './excel-import.parser';

const templatePath = resolve(__dirname, '..', '..', '..', '..', '..', '..', 'テンプレートファイル.xls');

// Build a synthetic export buffer in-memory, then parse it back. This
// exercises the export → import round-trip without touching the live DB.
function buildExportedBuffer(tasks: WbsExportTask[]): Buffer {
  const template = readFileSync(templatePath);
  const updates = buildWbsCellUpdates(tasks, 'テスト工程');
  return applyCellUpdates(template, updates);
}

function buildExportedBufferWithEmployees(
  tasks: WbsExportTask[],
  employees: Array<{
    id: number;
    code: string | null;
    name: string;
    employmentStart: string | null;
    employmentEnd: string | null;
    worksOnHolidays: number;
    isActive: number;
  }>,
): Buffer {
  const template = readFileSync(templatePath);
  const scheduleUpdates = buildWbsCellUpdates(tasks, 'テスト工程');
  const employeeUpdates = buildEmployeeCellUpdates(employees);
  const afterSchedule = applyCellUpdates(template, scheduleUpdates);
  return applyCellUpdates(afterSchedule, employeeUpdates, EMPLOYEES_SHEET_NAME);
}

describe('Excel import parser', () => {
  it('reconstructs a 3-level WBS from a round-trip', () => {
    const tasks: WbsExportTask[] = [
      // 大項目 1
      { id: 1, level: 1, parentId: null, name: '大1', startDate: null, duration: null, endDate: null, actualStartDate: null, actualEndDate: null, plannedHours: null, actualHours: null, progress: 0, assigneeName: null, status: '', sortOrder: 0 },
      // 中項目 1-1
      { id: 2, level: 2, parentId: 1, name: '中1-1', startDate: null, duration: null, endDate: null, actualStartDate: null, actualEndDate: null, plannedHours: null, actualHours: null, progress: 0, assigneeName: null, status: '', sortOrder: 1 },
      // 項目 1-1-A
      { id: 3, level: 3, parentId: 2, name: '項1-1-A', startDate: '2026-05-01', duration: 5, endDate: '2026-05-07', actualStartDate: '2026-05-01', actualEndDate: '2026-05-05', plannedHours: null, actualHours: 8, progress: 80, assigneeName: '山田 太郎', status: '', sortOrder: 2 },
      // 項目 1-1-B (under same 中)
      { id: 4, level: 3, parentId: 2, name: '項1-1-B', startDate: '2026-05-08', duration: 3, endDate: '2026-05-12', actualStartDate: null, actualEndDate: null, plannedHours: null, actualHours: null, progress: 0, assigneeName: '鈴木 花子', status: '', sortOrder: 3 },
      // 中項目 1-2
      { id: 5, level: 2, parentId: 1, name: '中1-2', startDate: null, duration: null, endDate: null, actualStartDate: null, actualEndDate: null, plannedHours: null, actualHours: null, progress: 0, assigneeName: null, status: '', sortOrder: 4 },
      // 項目 1-2-A
      { id: 6, level: 3, parentId: 5, name: '項1-2-A', startDate: '2026-05-15', duration: 2, endDate: '2026-05-18', actualStartDate: null, actualEndDate: null, plannedHours: null, actualHours: null, progress: 0, assigneeName: '山田 太郎', status: '', sortOrder: 5 },
    ];

    const buffer = buildExportedBuffer(tasks);
    const parsed = parseExcelImport(buffer);

    // Should reconstruct 1 大 + 2 中 + 3 項 = 6 nodes
    expect(parsed.schedule).toHaveLength(6);
    expect(parsed.schedule[0].level).toBe(1);
    expect(parsed.schedule[0].name).toBe('大1');
    expect(parsed.schedule[1].level).toBe(2);
    expect(parsed.schedule[1].name).toBe('中1-1');
    expect(parsed.schedule[1].parentIndex).toBe(0);
    expect(parsed.schedule[2].level).toBe(3);
    expect(parsed.schedule[2].name).toBe('項1-1-A');
    expect(parsed.schedule[2].parentIndex).toBe(1);
    expect(parsed.schedule[2].startDate).toBe('2026-05-01');
    expect(parsed.schedule[2].duration).toBe(5);
    expect(parsed.schedule[2].actualStartDate).toBe('2026-05-01');
    expect(parsed.schedule[2].actualEndDate).toBe('2026-05-05');
    expect(parsed.schedule[2].actualHours).toBe(8);
    expect(parsed.schedule[2].progress).toBe(80);
    expect(parsed.schedule[2].assigneeName).toBe('山田 太郎');

    // Last leaf goes under the second 中
    const lastLeaf = parsed.schedule[parsed.schedule.length - 1];
    expect(lastLeaf.level).toBe(3);
    expect(lastLeaf.name).toBe('項1-2-A');
    // its parentIndex should reference 中1-2 (the second level-2 task)
    const middle = parsed.schedule[lastLeaf.parentIndex!];
    expect(middle.level).toBe(2);
    expect(middle.name).toBe('中1-2');
  });

  it('collects distinct assignee names from schedule + employees sheet', () => {
    const tasks: WbsExportTask[] = [
      { id: 1, level: 1, parentId: null, name: '大1', startDate: null, duration: null, endDate: null, actualStartDate: null, actualEndDate: null, plannedHours: null, actualHours: null, progress: 0, assigneeName: null, status: '', sortOrder: 0 },
      { id: 2, level: 2, parentId: 1, name: '中1', startDate: null, duration: null, endDate: null, actualStartDate: null, actualEndDate: null, plannedHours: null, actualHours: null, progress: 0, assigneeName: null, status: '', sortOrder: 1 },
      { id: 3, level: 3, parentId: 2, name: '項A', startDate: '2026-05-01', duration: 1, endDate: '2026-05-01', actualStartDate: null, actualEndDate: null, plannedHours: null, actualHours: null, progress: 0, assigneeName: 'TanakaTaro', status: '', sortOrder: 2 },
      { id: 4, level: 3, parentId: 2, name: '項B', startDate: '2026-05-02', duration: 1, endDate: '2026-05-02', actualStartDate: null, actualEndDate: null, plannedHours: null, actualHours: null, progress: 0, assigneeName: 'TanakaTaro', status: '', sortOrder: 3 },
    ];

    const employees = [
      { id: 10, code: 'E010', name: 'TanakaTaro', employmentStart: null, employmentEnd: null, worksOnHolidays: 0, isActive: 1 },
      { id: 11, code: 'E011', name: 'YamadaJiro', employmentStart: '2024-04-01', employmentEnd: null, worksOnHolidays: 1, isActive: 1 },
    ];

    const buffer = buildExportedBufferWithEmployees(tasks, employees);
    const parsed = parseExcelImport(buffer);

    const tasksAssignees = parsed.schedule
      .map((t) => t.assigneeName)
      .filter((n) => n !== null);
    expect(tasksAssignees).toEqual(['TanakaTaro', 'TanakaTaro']);

    // 担当者一覧 sheet should yield both employees as hints
    const hintNames = parsed.employeeHints.map((h) => h.name);
    expect(hintNames).toContain('TanakaTaro');
    expect(hintNames).toContain('YamadaJiro');
    const yamada = parsed.employeeHints.find((h) => h.name === 'YamadaJiro')!;
    expect(yamada.employmentStart).toBe('2024-04-01');
    expect(yamada.worksOnHolidays).toBe(true);
  });
});
