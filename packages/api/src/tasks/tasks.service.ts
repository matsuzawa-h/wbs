import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, max } from 'drizzle-orm';
import { AppDb, wbsTasks, WbsTask, projects } from '../db';
import { DB_TOKEN } from '../db/db.module';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ReorderTasksDto } from './dto/reorder-tasks.dto';
import { DateCascadeService } from './date-cascade.service';
import { computeEndDate } from './business-day.util';
import { HolidaysService } from '../holidays/holidays.service';

@Injectable()
export class TasksService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: AppDb,
    private readonly cascade: DateCascadeService,
    private readonly holidaysService: HolidaysService,
  ) {}

  private holidays(): Set<string> {
    return this.holidaysService.getHolidaySet();
  }

  listByProject(projectId: number): WbsTask[] {
    this.ensureProjectExists(projectId);
    return this.db
      .select()
      .from(wbsTasks)
      .where(eq(wbsTasks.projectId, projectId))
      .orderBy(asc(wbsTasks.sortOrder), asc(wbsTasks.id))
      .all();
  }

  findById(id: number): WbsTask {
    const row = this.db.select().from(wbsTasks).where(eq(wbsTasks.id, id)).get();
    if (!row) throw new NotFoundException(`Task ${id} not found`);
    return row;
  }

  create(projectId: number, dto: CreateTaskDto): WbsTask {
    this.ensureProjectExists(projectId);
    this.validateHierarchy(projectId, dto.level, dto.parentId ?? null);

    const sortOrder =
      dto.sortOrder ??
      ((this.db
        .select({ max: max(wbsTasks.sortOrder) })
        .from(wbsTasks)
        .where(eq(wbsTasks.projectId, projectId))
        .get()?.max ?? -1) +
        1);

    let endDate: string | null = null;
    if (dto.level === 3 && dto.startDate && dto.duration) {
      endDate = computeEndDate(dto.startDate, dto.duration, this.holidays());
    }

    const inserted = this.db.transaction((tx) => {
      const row = tx
        .insert(wbsTasks)
        .values({
          projectId,
          level: dto.level,
          parentId: dto.parentId ?? null,
          name: dto.name,
          startDate: dto.startDate ?? null,
          duration: dto.duration ?? null,
          endDate,
          actualStartDate: dto.actualStartDate ?? null,
          actualEndDate: dto.actualEndDate ?? null,
          plannedHours: dto.plannedHours ?? null,
          actualHours: dto.actualHours ?? null,
          progress: dto.progress ?? 0,
          assigneeId: dto.assigneeId ?? null,
          status: dto.status ?? '',
          sortOrder,
        })
        .returning()
        .get();
      this.cascade.recomputeAllAncestors(projectId);
      return row;
    });

    return inserted;
  }

  update(id: number, dto: UpdateTaskDto): WbsTask {
    const current = this.findById(id);
    if (current.level !== 3) {
      const aggregateFields = [
        dto.startDate,
        dto.duration,
        dto.actualStartDate,
        dto.actualEndDate,
        dto.plannedHours,
        dto.actualHours,
      ];
      const tryingToSetAggregateField = aggregateFields.some((v) => v !== undefined);
      if (tryingToSetAggregateField) {
        throw new BadRequestException(
          'Aggregate rows (level 1/2) compute these values from children; do not set them directly',
        );
      }
    }

    const updated = this.db.transaction((tx) => {
      const newStart = dto.startDate ?? current.startDate;
      const newDuration = dto.duration ?? current.duration;
      const prevEndDate = current.endDate;
      const newEndDate =
        current.level === 3 && newStart && newDuration
          ? computeEndDate(newStart, newDuration, this.holidays())
          : current.endDate;

      const row = tx
        .update(wbsTasks)
        .set({
          name: dto.name ?? current.name,
          startDate: newStart,
          duration: newDuration,
          endDate: newEndDate,
          actualStartDate:
            dto.actualStartDate === undefined ? current.actualStartDate : dto.actualStartDate,
          actualEndDate:
            dto.actualEndDate === undefined ? current.actualEndDate : dto.actualEndDate,
          plannedHours:
            dto.plannedHours === undefined ? current.plannedHours : dto.plannedHours,
          actualHours:
            dto.actualHours === undefined ? current.actualHours : dto.actualHours,
          progress: dto.progress ?? current.progress,
          assigneeId:
            dto.assigneeId === undefined ? current.assigneeId : dto.assigneeId,
          status: dto.status ?? current.status,
          note: dto.note === undefined ? current.note : dto.note,
        })
        .where(eq(wbsTasks.id, id))
        .returning()
        .get();

      // Date cascade fires only when:
      //   - the planned end date changes on a level-3 task, AND
      //   - the caller did NOT pass cascade=false (default = true).
      // When cascade is disabled we still recompute ancestors, but sibling
      // tasks under the same 中項目 are left alone.
      const plannedEndChanged =
        current.level === 3 && prevEndDate && newEndDate && prevEndDate !== newEndDate;
      const cascadeRequested = dto.cascade !== false;
      if (plannedEndChanged && cascadeRequested) {
        const delta = this.cascade.computeDelta(prevEndDate, newEndDate);
        this.cascade.cascadeAfterChange(current.projectId, row, prevEndDate, delta);
      } else {
        this.cascade.recomputeAllAncestors(current.projectId);
      }

      return row;
    });

    return updated;
  }

  remove(id: number): void {
    const task = this.findById(id);
    this.db.transaction((tx) => {
      tx.delete(wbsTasks).where(eq(wbsTasks.id, id)).run();
      this.cascade.recomputeAllAncestors(task.projectId);
    });
  }

  /**
   * Deep-duplicate a task and its whole subtree within the same project.
   * The copy is inserted right after the original's subtree as a sibling
   * (same parent / level). All fields — including progress and actuals —
   * are carried over verbatim. sortOrder is renumbered project-wide in the
   * resulting pre-order so the new block sits immediately after the source.
   */
  duplicate(id: number): WbsTask {
    const original = this.findById(id);
    const projectId = original.projectId;

    return this.db.transaction((tx) => {
      const all = tx
        .select()
        .from(wbsTasks)
        .where(eq(wbsTasks.projectId, projectId))
        .all();

      // children keyed by parentId (0 = roots), each sorted like the UI.
      const byParent = new Map<number, WbsTask[]>();
      for (const t of all) {
        const key = t.parentId ?? 0;
        const arr = byParent.get(key) ?? [];
        arr.push(t);
        byParent.set(key, arr);
      }
      for (const arr of byParent.values()) {
        arr.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
      }

      const preorder = (rootId: number): WbsTask[] => {
        const out: WbsTask[] = [];
        const walk = (pid: number): void => {
          for (const t of byParent.get(pid) ?? []) {
            out.push(t);
            walk(t.id);
          }
        };
        walk(rootId);
        return out;
      };

      // Whole project flatten + the original's subtree (contiguous in it).
      const flat = preorder(0);
      const subtree = [original, ...preorder(original.id)];
      const subIds = new Set(subtree.map((t) => t.id));

      // Copy each subtree node; remap parentId via old→new id map.
      const idMap = new Map<number, number>();
      const newRows: WbsTask[] = [];
      for (const node of subtree) {
        const newParent =
          node.id === original.id
            ? original.parentId
            : (idMap.get(node.parentId as number) ?? null);
        const endDate =
          node.level === 3 && node.startDate && node.duration
            ? computeEndDate(node.startDate, node.duration, this.holidays())
            : node.endDate;
        const row = tx
          .insert(wbsTasks)
          .values({
            projectId,
            level: node.level,
            parentId: newParent,
            name: node.name,
            startDate: node.startDate,
            duration: node.duration,
            endDate,
            actualStartDate: node.actualStartDate,
            actualEndDate: node.actualEndDate,
            plannedHours: node.plannedHours,
            actualHours: node.actualHours,
            progress: node.progress,
            assigneeId: node.assigneeId,
            status: node.status,
            sortOrder: node.sortOrder,
          })
          .returning()
          .get();
        idMap.set(node.id, row.id);
        newRows.push(row);
      }

      // New flat order: original block, then the copies, then the rest.
      let lastIdx = -1;
      flat.forEach((t, i) => {
        if (subIds.has(t.id)) lastIdx = i;
      });
      const ordered: WbsTask[] = [
        ...flat.slice(0, lastIdx + 1),
        ...newRows,
        ...flat.slice(lastIdx + 1),
      ];
      ordered.forEach((t, i) => {
        if (t.sortOrder !== i) {
          tx.update(wbsTasks)
            .set({ sortOrder: i })
            .where(eq(wbsTasks.id, t.id))
            .run();
        }
      });

      this.cascade.recomputeAllAncestors(projectId);
      const newRootId = idMap.get(original.id) as number;
      return tx
        .select()
        .from(wbsTasks)
        .where(eq(wbsTasks.id, newRootId))
        .get() as WbsTask;
    });
  }

  reorder(dto: ReorderTasksDto): { updated: number } {
    let projectId: number | null = null;
    this.db.transaction((tx) => {
      for (const item of dto.items) {
        const existing = tx
          .select()
          .from(wbsTasks)
          .where(eq(wbsTasks.id, item.id))
          .get();
        if (!existing) continue;
        if (projectId === null) projectId = existing.projectId;
        tx.update(wbsTasks)
          .set({ sortOrder: item.sortOrder })
          .where(eq(wbsTasks.id, item.id))
          .run();
      }
      if (projectId !== null) {
        this.cascade.recomputeAllAncestors(projectId);
      }
    });
    return { updated: dto.items.length };
  }

  private ensureProjectExists(projectId: number): void {
    const row = this.db.select().from(projects).where(eq(projects.id, projectId)).get();
    if (!row) throw new NotFoundException(`Project ${projectId} not found`);
  }

  private validateHierarchy(
    projectId: number,
    level: number,
    parentId: number | null,
  ): void {
    if (level === 1) {
      if (parentId !== null) {
        throw new BadRequestException('level=1 (top) must not have a parent');
      }
      return;
    }
    if (parentId === null) {
      throw new BadRequestException(`level=${level} must have a parent`);
    }
    const parent = this.db
      .select()
      .from(wbsTasks)
      .where(and(eq(wbsTasks.id, parentId), eq(wbsTasks.projectId, projectId)))
      .get();
    if (!parent) throw new BadRequestException(`Parent ${parentId} not found in project ${projectId}`);
    if (parent.level !== level - 1) {
      throw new BadRequestException(
        `level=${level} must have a parent of level=${level - 1}`,
      );
    }
  }
}
