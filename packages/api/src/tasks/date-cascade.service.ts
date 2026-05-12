import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt } from 'drizzle-orm';
import { AppDb, wbsTasks, WbsTask } from '../db';
import { DB_TOKEN } from '../db/db.module';
import {
  businessDaysBetween,
  computeEndDate,
  formatDate,
  nextBusinessDay,
  parseDate,
} from './business-day.util';

@Injectable()
export class DateCascadeService {
  constructor(@Inject(DB_TOKEN) private readonly db: AppDb) {}

  /**
   * Chain-style cascade for level-3 tasks under the SAME parent (中項目).
   * Walks siblings in sortOrder ASC and only shifts each one when it would
   * either overlap with the running chain end OR was originally contiguous
   * (連日) to the previous task in the chain. The walk stops as soon as a
   * gap is detected — independent tasks downstream stay put.
   *
   *   A:  [-----]            (prevEnd=Thu)
   *   B:           [---]      starts Fri → consecutive → shift with A
   *   C:                  [--] starts 1 week later → gap → STOP, C untouched
   *
   * If the user really wants to drag every successor unconditionally, they
   * can do per-task edits; if they want NO cascade at all, the 連動 toggle
   * on the page passes cascade=false and we never get here.
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
    // Cascade only kicks in for level-3 tasks (which always have a parent).
    if (sourceTask.parentId === null || !sourceTask.endDate) {
      this.recomputeAllAncestors(projectId);
      return;
    }

    const siblings = this.db
      .select()
      .from(wbsTasks)
      .where(
        and(
          eq(wbsTasks.projectId, projectId),
          eq(wbsTasks.parentId, sourceTask.parentId),
          gt(wbsTasks.sortOrder, sourceTask.sortOrder),
        ),
      )
      .orderBy(asc(wbsTasks.sortOrder), asc(wbsTasks.id))
      .all()
      .filter((t) => t.level === 3 && t.id !== sourceTask.id);

    // Chain state: prevOriginalEnd is the original end of the most recent
    // task we processed (start with the source's original end); refEndNew
    // is its post-shift end (start with the source's new end).
    let prevOriginalEnd = parseDate(prevEndDate);
    let refEndNew = parseDate(sourceTask.endDate);

    for (const b of siblings) {
      if (!b.startDate || !b.duration) continue;
      const bStart = parseDate(b.startDate);

      // 連日 (back-to-back): b's original start lands on or before the next
      // business day after the previous task's original end.
      const consecutiveBoundary = nextBusinessDay(prevOriginalEnd);
      const wasContiguous = bStart.getTime() <= consecutiveBoundary.getTime();
      // 重なり (overlap): b would now start before / on the chain's new end.
      const wouldOverlap = bStart.getTime() <= refEndNew.getTime();

      if (!wasContiguous && !wouldOverlap) {
        // A gap exists and the new schedule does not consume it — stop here.
        break;
      }

      // Shift b to start the next business day after the chain's new end.
      const newStart = nextBusinessDay(refEndNew);
      const newStartStr = formatDate(newStart);
      const newEndStr = computeEndDate(newStartStr, b.duration);

      this.db
        .update(wbsTasks)
        .set({ startDate: newStartStr, endDate: newEndStr })
        .where(eq(wbsTasks.id, b.id))
        .run();

      // Advance the chain. Use the task's ORIGINAL end for the next
      // contiguity check, and its NEW end for the next overlap check.
      prevOriginalEnd = b.endDate ? parseDate(b.endDate) : prevOriginalEnd;
      refEndNew = parseDate(newEndStr);
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
