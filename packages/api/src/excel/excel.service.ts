import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { AppDb, assignees, customers, projects, wbsTasks } from '../db';
import { DB_TOKEN } from '../db/db.module';
import { applyCellUpdates } from './biff-writer';
import { EMPLOYEES_SHEET_NAME } from './column-map';
import { buildEmployeeCellUpdates, EmployeeExportRow } from './employees-mapper';
import { buildWbsCellUpdates, WbsExportTask } from './wbs-mapper';

export interface ExcelExportResult {
  buffer: Buffer;
  filename: string;
}

@Injectable()
export class ExcelService {
  constructor(@Inject(DB_TOKEN) private readonly db: AppDb) {}

  exportProject(projectId: number): ExcelExportResult {
    const project = this.db
      .select({ id: projects.id, name: projects.name, customerName: customers.name })
      .from(projects)
      .leftJoin(customers, eq(projects.customerId, customers.id))
      .where(eq(projects.id, projectId))
      .get();
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    const tasks = this.loadTasks(projectId);
    const employees = this.loadEmployees();
    let scheduleUpdates;
    let employeeUpdates;
    try {
      scheduleUpdates = buildWbsCellUpdates(tasks);
      employeeUpdates = buildEmployeeCellUpdates(employees);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    // Pipeline the surgical edits: schedule first, then employees on the
    // already-modified buffer so the second pass sees and reuses any strings
    // added to the SST by the first pass.
    const template = readFileSync(this.templatePath());
    const afterSchedule = applyCellUpdates(template, scheduleUpdates);
    const buffer = applyCellUpdates(afterSchedule, employeeUpdates, EMPLOYEES_SHEET_NAME);
    return {
      buffer,
      filename: buildExportFilename(project.customerName, project.name, new Date()),
    };
  }

  private loadEmployees(): EmployeeExportRow[] {
    return this.db
      .select({
        id: assignees.id,
        code: assignees.code,
        name: assignees.name,
        employmentStart: assignees.employmentStart,
        employmentEnd: assignees.employmentEnd,
        worksOnHolidays: assignees.worksOnHolidays,
        isActive: assignees.isActive,
      })
      .from(assignees)
      .orderBy(asc(assignees.sortOrder), asc(assignees.code), asc(assignees.id))
      .all();
  }

  private loadTasks(projectId: number): WbsExportTask[] {
    return this.db
      .select({
        id: wbsTasks.id,
        level: wbsTasks.level,
        parentId: wbsTasks.parentId,
        name: wbsTasks.name,
        startDate: wbsTasks.startDate,
        duration: wbsTasks.duration,
        endDate: wbsTasks.endDate,
        actualStartDate: wbsTasks.actualStartDate,
        actualEndDate: wbsTasks.actualEndDate,
        plannedHours: wbsTasks.plannedHours,
        actualHours: wbsTasks.actualHours,
        progress: wbsTasks.progress,
        assigneeName: assignees.name,
        status: wbsTasks.status,
        sortOrder: wbsTasks.sortOrder,
      })
      .from(wbsTasks)
      .leftJoin(assignees, eq(wbsTasks.assigneeId, assignees.id))
      .where(eq(wbsTasks.projectId, projectId))
      .orderBy(asc(wbsTasks.sortOrder), asc(wbsTasks.id))
      .all();
  }

  private templatePath(): string {
    const candidates = [
      process.env.XLS_TEMPLATE_PATH,
      resolve(process.cwd(), 'テンプレートファイル.xls'),
      resolve(process.cwd(), '..', 'テンプレートファイル.xls'),
      resolve(process.cwd(), '..', '..', 'テンプレートファイル.xls'),
      resolve(process.cwd(), '..', '..', '..', 'テンプレートファイル.xls'),
      resolve(__dirname, '..', '..', '..', '..', '..', 'テンプレートファイル.xls'),
    ].filter((value): value is string => Boolean(value));

    const found = candidates.find((candidate) => existsSync(candidate));
    if (!found) {
      throw new Error(`Template file not found. Tried: ${candidates.join(', ')}`);
    }
    return found;
  }
}

// Builds the export filename: 顧客名_プロジェクト名_YYYYMMDD-HHmmss.xls
// Characters that are illegal in Windows filenames are replaced with `_`.
// Empty customer falls back to no customer prefix (just the project name).
export function buildExportFilename(
  customerName: string | null | undefined,
  projectName: string,
  now: Date,
): string {
  const stamp = formatTimestamp(now);
  const proj = sanitizeFilenamePart(projectName) || `project`;
  const cust = customerName ? sanitizeFilenamePart(customerName) : '';
  const stem = cust ? `${cust}_${proj}_${stamp}` : `${proj}_${stamp}`;
  return `${stem}.xls`;
}

function sanitizeFilenamePart(value: string): string {
  // Replace characters disallowed in Windows + path separators + control chars.
  return value
    .replace(/[\\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/^[. ]+|[. ]+$/g, '')
    .trim();
}

function formatTimestamp(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
