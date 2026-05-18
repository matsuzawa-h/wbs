import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { AppDb, personalTasks, projects } from '../db';
import { DB_TOKEN } from '../db/db.module';
import { HolidaysService } from '../holidays/holidays.service';
import { computeEndDate } from '../tasks/business-day.util';
import { CreatePersonalTaskDto } from './dto/create-personal-task.dto';
import { UpdatePersonalTaskDto } from './dto/update-personal-task.dto';

export interface PersonalTaskRow {
  id: number;
  employeeId: number;
  projectId: number | null;
  projectName: string | null;
  name: string;
  startDate: string | null;
  duration: number | null;
  endDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  plannedHours: number | null;
  actualHours: number | null;
  progress: number;
  note: string | null;
  sortOrder: number;
  createdAt: number;
}

@Injectable()
export class PersonalTasksService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: AppDb,
    private readonly holidaysService: HolidaysService,
  ) {}

  private endDateFor(
    startDate: string | null,
    duration: number | null,
  ): string | null {
    if (!startDate || !duration || duration < 1) return null;
    return computeEndDate(
      startDate,
      duration,
      this.holidaysService.getHolidaySet(),
    );
  }

  listByEmployee(employeeId: number): PersonalTaskRow[] {
    return this.db
      .select({
        id: personalTasks.id,
        employeeId: personalTasks.employeeId,
        projectId: personalTasks.projectId,
        projectName: projects.name,
        name: personalTasks.name,
        startDate: personalTasks.startDate,
        duration: personalTasks.duration,
        endDate: personalTasks.endDate,
        actualStartDate: personalTasks.actualStartDate,
        actualEndDate: personalTasks.actualEndDate,
        plannedHours: personalTasks.plannedHours,
        actualHours: personalTasks.actualHours,
        progress: personalTasks.progress,
        note: personalTasks.note,
        sortOrder: personalTasks.sortOrder,
        createdAt: personalTasks.createdAt,
      })
      .from(personalTasks)
      .leftJoin(projects, eq(personalTasks.projectId, projects.id))
      .where(eq(personalTasks.employeeId, employeeId))
      .orderBy(asc(personalTasks.startDate), asc(personalTasks.id))
      .all();
  }

  private findRow(id: number): PersonalTaskRow {
    const rows = this.db
      .select({
        id: personalTasks.id,
        employeeId: personalTasks.employeeId,
        projectId: personalTasks.projectId,
        projectName: projects.name,
        name: personalTasks.name,
        startDate: personalTasks.startDate,
        duration: personalTasks.duration,
        endDate: personalTasks.endDate,
        actualStartDate: personalTasks.actualStartDate,
        actualEndDate: personalTasks.actualEndDate,
        plannedHours: personalTasks.plannedHours,
        actualHours: personalTasks.actualHours,
        progress: personalTasks.progress,
        note: personalTasks.note,
        sortOrder: personalTasks.sortOrder,
        createdAt: personalTasks.createdAt,
      })
      .from(personalTasks)
      .leftJoin(projects, eq(personalTasks.projectId, projects.id))
      .where(eq(personalTasks.id, id))
      .all();
    if (rows.length === 0) {
      throw new NotFoundException(`personal task ${id} not found`);
    }
    return rows[0];
  }

  create(employeeId: number, dto: CreatePersonalTaskDto): PersonalTaskRow {
    const startDate = dto.startDate ?? null;
    const duration = dto.duration ?? null;
    const nextSort =
      (this.db
        .select({ s: personalTasks.sortOrder })
        .from(personalTasks)
        .where(eq(personalTasks.employeeId, employeeId))
        .orderBy(asc(personalTasks.sortOrder))
        .all()
        .at(-1)?.s ?? -1) + 1;
    const row = this.db
      .insert(personalTasks)
      .values({
        employeeId,
        projectId: dto.projectId ?? null,
        name: dto.name ?? '',
        startDate,
        duration,
        endDate: this.endDateFor(startDate, duration),
        actualStartDate: dto.actualStartDate ?? null,
        actualEndDate: dto.actualEndDate ?? null,
        plannedHours: dto.plannedHours ?? null,
        actualHours: dto.actualHours ?? null,
        progress: dto.progress ?? 0,
        note: dto.note ?? null,
        sortOrder: nextSort,
      })
      .returning()
      .get();
    return this.findRow(row.id);
  }

  update(id: number, dto: UpdatePersonalTaskDto): PersonalTaskRow {
    const current = this.findRow(id);
    const startDate =
      dto.startDate === undefined ? current.startDate : dto.startDate;
    const duration =
      dto.duration === undefined ? current.duration : dto.duration;
    this.db
      .update(personalTasks)
      .set({
        projectId:
          dto.projectId === undefined ? current.projectId : dto.projectId,
        name: dto.name ?? current.name,
        startDate,
        duration,
        endDate: this.endDateFor(startDate, duration),
        actualStartDate:
          dto.actualStartDate === undefined
            ? current.actualStartDate
            : dto.actualStartDate,
        actualEndDate:
          dto.actualEndDate === undefined
            ? current.actualEndDate
            : dto.actualEndDate,
        plannedHours:
          dto.plannedHours === undefined
            ? current.plannedHours
            : dto.plannedHours,
        actualHours:
          dto.actualHours === undefined ? current.actualHours : dto.actualHours,
        progress: dto.progress ?? current.progress,
        note: dto.note === undefined ? current.note : dto.note,
      })
      .where(eq(personalTasks.id, id))
      .run();
    return this.findRow(id);
  }

  remove(id: number): void {
    const res = this.db
      .delete(personalTasks)
      .where(and(eq(personalTasks.id, id)))
      .run();
    if (res.changes === 0) {
      throw new NotFoundException(`personal task ${id} not found`);
    }
  }
}
