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
   * Shift subsequent leaf tasks (level=3) whose startDate is on or after `prevEndDate`,
   * by `deltaBusinessDays` business days. Then recompute aggregate dates for ancestors.
   * Must be invoked inside the same transaction as the originating update.
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

    const successors = this.db
      .select()
      .from(wbsTasks)
      .where(and(eq(wbsTasks.projectId, projectId), gt(wbsTasks.sortOrder, sourceTask.sortOrder)))
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
      this.applyAggregate(m, byParent.get(m.id) ?? []);
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
      this.applyAggregate(node, byParent.get(node.id) ?? []);
      currentId = node.parentId ?? null;
    }
  }

  private applyAggregate(node: WbsTask, children: WbsTask[]): void {
    if (children.length === 0) {
      this.db
        .update(wbsTasks)
        .set({ startDate: null, endDate: null, duration: null })
        .where(eq(wbsTasks.id, node.id))
        .run();
      return;
    }
    const starts = children.map((c) => c.startDate).filter((s): s is string => !!s);
    const ends = children.map((c) => c.endDate).filter((e): e is string => !!e);
    if (starts.length === 0 || ends.length === 0) {
      this.db
        .update(wbsTasks)
        .set({ startDate: null, endDate: null, duration: null })
        .where(eq(wbsTasks.id, node.id))
        .run();
      return;
    }
    const minStart = starts.reduce((a, b) => (a < b ? a : b));
    const maxEnd = ends.reduce((a, b) => (a > b ? a : b));
    const duration = businessDaysBetween(parseDate(minStart), parseDate(maxEnd));

    this.db
      .update(wbsTasks)
      .set({ startDate: minStart, endDate: maxEnd, duration })
      .where(eq(wbsTasks.id, node.id))
      .run();
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
