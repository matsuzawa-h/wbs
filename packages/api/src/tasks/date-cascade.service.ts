import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt } from 'drizzle-orm';
import { AppDb, wbsTasks, WbsTask } from '../db';
import { DB_TOKEN } from '../db/db.module';
import {
  addBusinessDays,
  businessDaysBetween,
  computeEndDate,
  formatDate,
  parseDate,
  snapToBusinessDay,
} from './business-day.util';

@Injectable()
export class DateCascadeService {
  constructor(@Inject(DB_TOKEN) private readonly db: AppDb) {}

  /**
   * Shift subsequent leaf tasks (level=3) that share the SAME parent (= same
   * 中項目) and come after `sourceTask` by `deltaBusinessDays` business days,
   * but only those whose startDate is on or after `prevEndDate`. Then recompute
   * aggregate dates for ancestors. Must run inside the originating transaction.
   *
   * Scoping the cascade to siblings keeps unrelated work (other 中項目) from
   * jumping around when a single item is adjusted.
   */
  cascadeAfterChange(
    projectId: number,
    sourceTask: WbsTask,
    prevEndDate: string | null,
    deltaBusinessDays: number,
  ): void {
    if (deltaBusinessDays === 0 || prevEndDate === null) {
      this.recomputeAncestors(projectId, sourceTask.parentId ?? null);
      return;
    }

    // Cascade only kicks in for level-3 tasks, which always have a parent.
    // Guard against unexpected callers anyway.
    if (sourceTask.parentId === null) {
      this.recomputeAllAncestors(projectId);
      return;
    }

    const successors = this.db
      .select()
      .from(wbsTasks)
      .where(
        and(
          eq(wbsTasks.projectId, projectId),
          eq(wbsTasks.parentId, sourceTask.parentId),
          gt(wbsTasks.sortOrder, sourceTask.sortOrder),
        ),
      )
      .all()
      .filter((t) => t.level === 3 && t.id !== sourceTask.id);

    const prevEnd = parseDate(prevEndDate);

    for (const task of successors) {
      if (!task.startDate || !task.duration) continue;
      const start = parseDate(task.startDate);
      if (start.getTime() < prevEnd.getTime()) continue;

      const newStart = snapToBusinessDay(addBusinessDays(start, deltaBusinessDays));
      const newStartStr = formatDate(newStart);
      const newEndStr = computeEndDate(newStartStr, task.duration);

      this.db
        .update(wbsTasks)
        .set({ startDate: newStartStr, endDate: newEndStr })
        .where(eq(wbsTasks.id, task.id))
        .run();
    }

    this.recomputeAllAncestors(projectId);
  }

  /**
   * Recompute startDate/endDate for all aggregate (level 1, 2) rows in this project.
   * Aggregate.start = min(child.start), Aggregate.end = max(child.end).
   *
   * Two-pass: level=2 first, then level=1. The in-memory byParent map is
   * patched after each level-2 update so the level-1 pass sees fresh values.
   */
  recomputeAllAncestors(projectId: number): void {
    const all = this.db
      .select()
      .from(wbsTasks)
      .where(eq(wbsTasks.projectId, projectId))
      .all();

    const byParent = new Map<number, WbsTask[]>();
    for (const t of all) {
      const key = t.parentId ?? 0;
      const arr = byParent.get(key) ?? [];
      arr.push(t);
      byParent.set(key, arr);
    }

    const mid = all.filter((t) => t.level === 2);
    for (const m of mid) {
      const updated = this.applyAggregate(m, byParent.get(m.id) ?? []);
      this.patchSibling(byParent, updated);
    }

    const top = all.filter((t) => t.level === 1);
    for (const tnode of top) {
      this.applyAggregate(tnode, byParent.get(tnode.id) ?? []);
    }
  }

  private recomputeAncestors(projectId: number, parentId: number | null): void {
    if (parentId === null) {
      this.recomputeAllAncestors(projectId);
      return;
    }
    const all = this.db
      .select()
      .from(wbsTasks)
      .where(eq(wbsTasks.projectId, projectId))
      .all();
    const byParent = new Map<number, WbsTask[]>();
    for (const t of all) {
      const key = t.parentId ?? 0;
      const arr = byParent.get(key) ?? [];
      arr.push(t);
      byParent.set(key, arr);
    }
    let currentId: number | null = parentId;
    while (currentId !== null) {
      const node = all.find((t) => t.id === currentId);
      if (!node) break;
      const updated = this.applyAggregate(node, byParent.get(node.id) ?? []);
      this.patchSibling(byParent, updated);
      currentId = node.parentId ?? null;
    }
  }

  private patchSibling(byParent: Map<number, WbsTask[]>, updated: WbsTask): void {
    const key = updated.parentId ?? 0;
    const siblings = byParent.get(key);
    if (!siblings) return;
    const idx = siblings.findIndex((s) => s.id === updated.id);
    if (idx >= 0) siblings[idx] = updated;
  }

  private applyAggregate(node: WbsTask, children: WbsTask[]): WbsTask {
    // Aggregate planned start/end + duration (skip if any child has no planned dates).
    const starts = children.map((c) => c.startDate).filter((s): s is string => !!s);
    const ends = children.map((c) => c.endDate).filter((e): e is string => !!e);

    let plannedStart: string | null = null;
    let plannedEnd: string | null = null;
    let plannedDuration: number | null = null;
    if (children.length > 0 && starts.length > 0 && ends.length > 0) {
      plannedStart = starts.reduce((a, b) => (a < b ? a : b));
      plannedEnd = ends.reduce((a, b) => (a > b ? a : b));
      plannedDuration = businessDaysBetween(parseDate(plannedStart), parseDate(plannedEnd));
    }

    // Aggregate actual start/end (independent: any child with values contributes).
    const actualStarts = children
      .map((c) => c.actualStartDate)
      .filter((s): s is string => !!s);
    const actualEnds = children
      .map((c) => c.actualEndDate)
      .filter((e): e is string => !!e);
    const actualStart =
      actualStarts.length > 0 ? actualStarts.reduce((a, b) => (a < b ? a : b)) : null;
    const actualEnd =
      actualEnds.length > 0 ? actualEnds.reduce((a, b) => (a > b ? a : b)) : null;

    // Aggregate hours: sum non-null children. If no child has a value, leave null.
    const plannedHourValues = children
      .map((c) => c.plannedHours)
      .filter((h): h is number => h !== null && h !== undefined);
    const actualHourValues = children
      .map((c) => c.actualHours)
      .filter((h): h is number => h !== null && h !== undefined);
    const plannedHours =
      plannedHourValues.length > 0 ? plannedHourValues.reduce((a, b) => a + b, 0) : null;
    const actualHours =
      actualHourValues.length > 0 ? actualHourValues.reduce((a, b) => a + b, 0) : null;

    this.db
      .update(wbsTasks)
      .set({
        startDate: plannedStart,
        endDate: plannedEnd,
        duration: plannedDuration,
        actualStartDate: actualStart,
        actualEndDate: actualEnd,
        plannedHours,
        actualHours,
      })
      .where(eq(wbsTasks.id, node.id))
      .run();

    return {
      ...node,
      startDate: plannedStart,
      endDate: plannedEnd,
      duration: plannedDuration,
      actualStartDate: actualStart,
      actualEndDate: actualEnd,
      plannedHours,
      actualHours,
    };
  }

  /**
   * Compute the delta in business days between two endDates.
   * Returns positive if newEnd is later, negative if earlier.
   */
  computeDelta(prevEndDate: string | null, newEndDate: string | null): number {
    if (!prevEndDate || !newEndDate) return 0;
    const prev = parseDate(prevEndDate);
    const next = parseDate(newEndDate);
    if (prev.getTime() === next.getTime()) return 0;
    if (next.getTime() > prev.getTime()) {
      return businessDaysBetween(prev, next) - 1;
    }
    return -(businessDaysBetween(next, prev) - 1);
  }
}
