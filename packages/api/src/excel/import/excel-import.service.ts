import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { AppDb, assignees, customers, projectMembers, projects, wbsTasks } from '../../db';
import { DB_TOKEN } from '../../db/db.module';
import { HolidaysService } from '../../holidays/holidays.service';
import { computeEndDate } from '../../tasks/business-day.util';
import { DateCascadeService } from '../../tasks/date-cascade.service';
import {
  parseExcelImport,
  ParsedImport,
  ParsedTask,
} from './excel-import.parser';

export interface AssigneeMatch {
  name: string;
  suggestedEmployeeId: number | null;
  employmentStart: string | null;
  employmentEnd: string | null;
  worksOnHolidays: boolean;
}

export interface PreviewResult {
  schedule: ParsedTask[];
  matches: AssigneeMatch[];
}

// Action chosen by the user in the reconciliation UI.
export interface AssigneeResolution {
  name: string;
  action: 'link' | 'create' | 'skip';
  employeeId?: number;
  newEmployee?: {
    code?: string | null;
    name: string;
    nameKana?: string | null;
    department?: string | null;
    employmentStart?: string | null;
    employmentEnd?: string | null;
    worksOnHolidays?: boolean;
  };
}

export interface CommitInput {
  customerId: number | null;
  projectName: string;
  schedule: ParsedTask[];
  assigneeResolution: AssigneeResolution[];
}

@Injectable()
export class ExcelImportService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: AppDb,
    private readonly holidaysService: HolidaysService,
    private readonly cascade: DateCascadeService,
  ) {}

  preview(fileBuffer: Buffer): PreviewResult {
    let parsed: ParsedImport;
    try {
      parsed = parseExcelImport(fileBuffer);
    } catch (e) {
      throw new BadRequestException(`.xls 形式として読み取れません: ${(e as Error).message}`);
    }

    // Collect every distinct assignee name referenced by the schedule plus
    // any extra names from 担当者一覧 (Excel-side master). Order: schedule
    // first to keep the most-visible names at the top of the reconciliation
    // table, then any extra master-only names.
    const namesInOrder: string[] = [];
    const seen = new Set<string>();
    for (const task of parsed.schedule) {
      const n = task.assigneeName?.trim();
      if (n && !seen.has(n)) {
        seen.add(n);
        namesInOrder.push(n);
      }
    }
    for (const hint of parsed.employeeHints) {
      const n = hint.name.trim();
      if (n && !seen.has(n)) {
        seen.add(n);
        namesInOrder.push(n);
      }
    }

    const hintByName = new Map(parsed.employeeHints.map((h) => [h.name, h]));
    const existingEmployees = this.db
      .select({ id: assignees.id, name: assignees.name })
      .from(assignees)
      .all();
    const existingByName = new Map(existingEmployees.map((e) => [e.name, e.id]));

    const matches: AssigneeMatch[] = namesInOrder.map((name) => {
      const hint = hintByName.get(name);
      return {
        name,
        suggestedEmployeeId: existingByName.get(name) ?? null,
        employmentStart: hint?.employmentStart ?? null,
        employmentEnd: hint?.employmentEnd ?? null,
        worksOnHolidays: hint?.worksOnHolidays ?? false,
      };
    });

    return { schedule: parsed.schedule, matches };
  }

  commit(input: CommitInput): { projectId: number } {
    if (!input.projectName.trim()) {
      throw new BadRequestException('プロジェクト名は必須です');
    }

    if (input.customerId !== null && input.customerId !== undefined) {
      const customer = this.db
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.id, input.customerId))
        .get();
      if (!customer) {
        throw new NotFoundException(`Customer ${input.customerId} not found`);
      }
    }

    // Pre-validate task tree shape so partial work is never persisted.
    validateTaskTree(input.schedule);

    const holidays = this.holidaysService.getHolidaySet();

    return this.db.transaction((tx) => {
      // 1) Create new employees from the reconciliation choices.
      // Build a name -> employeeId map for both linked and newly created.
      const nameToEmployeeId = new Map<string, number>();
      for (const r of input.assigneeResolution) {
        if (r.action === 'link' && r.employeeId !== undefined) {
          nameToEmployeeId.set(r.name, r.employeeId);
        } else if (r.action === 'create' && r.newEmployee) {
          const created = tx
            .insert(assignees)
            .values({
              code: r.newEmployee.code?.trim() || nextEmployeeCode(tx),
              name: r.newEmployee.name,
              nameKana: r.newEmployee.nameKana ?? null,
              department: r.newEmployee.department ?? null,
              role: null,
              email: null,
              employmentStart: r.newEmployee.employmentStart ?? null,
              employmentEnd: r.newEmployee.employmentEnd ?? null,
              worksOnHolidays: r.newEmployee.worksOnHolidays ? 1 : 0,
              isActive: 1,
              note: null,
              sortOrder: 0,
            })
            .returning()
            .get();
          nameToEmployeeId.set(r.name, created.id);
        }
        // action='skip' → no entry; assigneeId stays null for that name.
      }

      // 2) Create the project.
      const project = tx
        .insert(projects)
        .values({
          name: input.projectName.trim(),
          customerId: input.customerId ?? null,
        })
        .returning()
        .get();

      // 3) Insert tasks in order, resolving parentIndex → real DB id.
      const indexToTaskId = new Map<number, number>();
      const referencedEmployeeIds = new Set<number>();
      for (let i = 0; i < input.schedule.length; i += 1) {
        const t = input.schedule[i];
        const parentDbId =
          t.parentIndex !== null && indexToTaskId.has(t.parentIndex)
            ? indexToTaskId.get(t.parentIndex)!
            : null;

        const assigneeId =
          t.level === 3 && t.assigneeName
            ? nameToEmployeeId.get(t.assigneeName) ?? null
            : null;
        if (assigneeId !== null) referencedEmployeeIds.add(assigneeId);

        let endDate: string | null = null;
        if (t.level === 3 && t.startDate && t.duration && t.duration > 0) {
          endDate = computeEndDate(t.startDate, t.duration, holidays);
        }

        const row = tx
          .insert(wbsTasks)
          .values({
            projectId: project.id,
            level: t.level,
            parentId: parentDbId,
            name: t.name,
            startDate: t.level === 3 ? t.startDate : null,
            duration: t.level === 3 ? t.duration : null,
            endDate: t.level === 3 ? endDate : null,
            actualStartDate: t.level === 3 ? t.actualStartDate : null,
            actualEndDate: t.level === 3 ? t.actualEndDate : null,
            plannedHours: null,
            actualHours: t.level === 3 ? t.actualHours : null,
            progress: t.level === 3 ? t.progress : 0,
            assigneeId,
            status: t.level === 3 ? t.status : '',
            sortOrder: i,
          })
          .returning()
          .get();
        indexToTaskId.set(t.index, row.id);
      }

      // 4) Recompute aggregate (level 1/2) start/end/duration from the leaves.
      // Reuses the production cascade logic so behaviour matches normal task
      // creation. better-sqlite3 transactions are synchronous and see their
      // own uncommitted inserts via this.db, so calling the service here is
      // safe.
      this.cascade.recomputeAllAncestors(project.id);

      // 5) Register every assignee referenced by a task as a project member,
      // so the gantt picker shows them. setMembers() pattern inlined here
      // because we're inside a transaction and need atomicity.
      const memberIds = Array.from(referencedEmployeeIds);
      memberIds.forEach((employeeId, idx) => {
        tx.insert(projectMembers)
          .values({ projectId: project.id, employeeId, sortOrder: idx })
          .run();
      });

      return { projectId: project.id };
    });
  }
}

function validateTaskTree(schedule: ParsedTask[]): void {
  for (const t of schedule) {
    if (t.parentIndex !== null) {
      const parent = schedule.find((p) => p.index === t.parentIndex);
      if (!parent) {
        throw new BadRequestException(
          `タスク ${t.name} の親 index=${t.parentIndex} が見つかりません`,
        );
      }
      if (parent.level + 1 !== t.level) {
        throw new BadRequestException(
          `タスク ${t.name} の階層 (${t.level}) が親 ${parent.name} (${parent.level}) と整合しません`,
        );
      }
    } else if (t.level !== 1) {
      throw new BadRequestException(
        `タスク ${t.name} の階層が ${t.level} ですが親が指定されていません`,
      );
    }
  }
}

function nextEmployeeCode(tx: any): string {
  const rows = tx.select({ code: assignees.code }).from(assignees).all();
  let max = 0;
  for (const r of rows) {
    const m = r.code?.match(/^E(\d{3,})$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return `E${String(max + 1).padStart(3, '0')}`;
}

