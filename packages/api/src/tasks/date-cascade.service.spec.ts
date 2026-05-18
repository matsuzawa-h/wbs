import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { and, asc, eq } from 'drizzle-orm';

import * as schema from '../db/schema';
import { wbsTasks } from '../db';
import type { AppDb } from '../db';
import { DateCascadeService } from './date-cascade.service';
import type { HolidaysService } from '../holidays/holidays.service';
import { computeEndDate } from './business-day.util';

/**
 * Regression: 連動 (cascade) must move linked level-3 siblings by the SAME
 * number of business days the source moved — preserving their relative
 * position — instead of re-chaining them one after another.
 *
 *   三つとも 5/18 開始(1日) で先頭を 5/19 へ手動変更
 *     旧挙動: 5/19 / 5/20 / 5/21   (直列に並べ替え)
 *     新挙動: 5/19 / 5/19 / 5/19   (同じ +1 日だけ平行シフト)
 *
 * 余裕がある(間にギャップがある)独立タスクは動かさない。
 */

const CREATE_WBS_TASKS = `
CREATE TABLE wbs_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  level INTEGER NOT NULL,
  parent_id INTEGER,
  name TEXT NOT NULL,
  start_date TEXT,
  duration INTEGER,
  end_date TEXT,
  actual_start_date TEXT,
  actual_end_date TEXT,
  planned_hours REAL,
  actual_hours REAL,
  progress INTEGER NOT NULL DEFAULT 0,
  assignee_id INTEGER,
  status TEXT NOT NULL DEFAULT '',
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);`;

function makeService(): {
  db: AppDb;
  svc: DateCascadeService;
  close: () => void;
} {
  const sqlite = new Database(':memory:');
  sqlite.exec(CREATE_WBS_TASKS);
  const db = drizzle(sqlite, { schema }) as unknown as AppDb;
  // No holidays in these scenarios — weekday-only dates are used.
  const holidaysStub = {
    getHolidaySet: () => new Set<string>(),
  } as unknown as HolidaysService;
  const svc = new DateCascadeService(db, holidaysStub);
  return { db, svc, close: () => sqlite.close() };
}

function seedLevel3Trio(db: AppDb, startDate: string): void {
  // 大項目(1) > 中項目(2) > A(3) B(4) C(5), all same start, duration 1.
  db.insert(wbsTasks)
    .values([
      { projectId: 1, level: 1, parentId: null, name: '大項目', sortOrder: 0 },
      { projectId: 1, level: 2, parentId: 1, name: '中項目', sortOrder: 1 },
      {
        projectId: 1,
        level: 3,
        parentId: 2,
        name: 'A',
        startDate,
        duration: 1,
        endDate: startDate,
        sortOrder: 2,
      },
      {
        projectId: 1,
        level: 3,
        parentId: 2,
        name: 'B',
        startDate,
        duration: 1,
        endDate: startDate,
        sortOrder: 3,
      },
      {
        projectId: 1,
        level: 3,
        parentId: 2,
        name: 'C',
        startDate,
        duration: 1,
        endDate: startDate,
        sortOrder: 4,
      },
    ])
    .run();
}

/** Mimic TasksService.update(): write the source's new dates, then cascade. */
function moveSourceAndCascade(
  db: AppDb,
  svc: DateCascadeService,
  sourceName: string,
  newStart: string,
): void {
  const src = db
    .select()
    .from(wbsTasks)
    .where(and(eq(wbsTasks.projectId, 1), eq(wbsTasks.name, sourceName)))
    .get();
  if (!src) throw new Error(`source ${sourceName} not found`);
  const prevEndDate = src.endDate;
  const newEnd = computeEndDate(newStart, src.duration ?? 1);
  db.update(wbsTasks)
    .set({ startDate: newStart, endDate: newEnd })
    .where(eq(wbsTasks.id, src.id))
    .run();
  const updated = db
    .select()
    .from(wbsTasks)
    .where(eq(wbsTasks.id, src.id))
    .get()!;
  const delta = svc.computeDelta(prevEndDate, newEnd);
  svc.cascadeAfterChange(1, updated, prevEndDate, delta);
}

function level3ByName(db: AppDb): Record<string, { start: string | null; end: string | null }> {
  const rows = db
    .select()
    .from(wbsTasks)
    .where(and(eq(wbsTasks.projectId, 1), eq(wbsTasks.level, 3)))
    .orderBy(asc(wbsTasks.sortOrder))
    .all();
  const out: Record<string, { start: string | null; end: string | null }> = {};
  for (const r of rows) out[r.name] = { start: r.startDate, end: r.endDate };
  return out;
}

describe('DateCascadeService — parallel-shift cascade', () => {
  it('三つ平行(同日)のタスクは先頭を+1日すると残りも+1日', () => {
    const { db, svc, close } = makeService();
    try {
      // 2026-05-18 は月曜 / 19 は火曜 — どちらも営業日
      seedLevel3Trio(db, '2026-05-18');
      moveSourceAndCascade(db, svc, 'A', '2026-05-19');

      const got = level3ByName(db);
      expect(got.A).toEqual({ start: '2026-05-19', end: '2026-05-19' });
      expect(got.B).toEqual({ start: '2026-05-19', end: '2026-05-19' });
      expect(got.C).toEqual({ start: '2026-05-19', end: '2026-05-19' });
    } finally {
      close();
    }
  });

  it('間に余裕がある独立タスク(ギャップ後)は動かさない', () => {
    const { db, svc, close } = makeService();
    try {
      // A,B 連続 / D は1週間以上後ろで単独開始
      db.insert(wbsTasks)
        .values([
          { projectId: 1, level: 1, parentId: null, name: '大項目', sortOrder: 0 },
          { projectId: 1, level: 2, parentId: 1, name: '中項目', sortOrder: 1 },
          {
            projectId: 1,
            level: 3,
            parentId: 2,
            name: 'A',
            startDate: '2026-05-18',
            duration: 1,
            endDate: '2026-05-18',
            sortOrder: 2,
          },
          {
            projectId: 1,
            level: 3,
            parentId: 2,
            name: 'B',
            startDate: '2026-05-19',
            duration: 1,
            endDate: '2026-05-19',
            sortOrder: 3,
          },
          {
            projectId: 1,
            level: 3,
            parentId: 2,
            name: 'D',
            startDate: '2026-06-01',
            duration: 1,
            endDate: '2026-06-01',
            sortOrder: 4,
          },
        ])
        .run();

      moveSourceAndCascade(db, svc, 'A', '2026-05-19');

      const got = level3ByName(db);
      expect(got.A).toEqual({ start: '2026-05-19', end: '2026-05-19' });
      // B was contiguous → shifts by the same +1 business day (→ 5/20).
      expect(got.B).toEqual({ start: '2026-05-20', end: '2026-05-20' });
      // D had slack (gap) → untouched.
      expect(got.D).toEqual({ start: '2026-06-01', end: '2026-06-01' });
    } finally {
      close();
    }
  });
});
