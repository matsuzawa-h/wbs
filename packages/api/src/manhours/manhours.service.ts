import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  AppDb,
  assignees,
  customers,
  manhourCapacities,
  manhourEntries,
  manhourImportBatches,
  projects,
} from '../db';
import { DB_TOKEN } from '../db/db.module';
import { ManualEntryDto } from './dto/manual-entry.dto';
import { ManualProjectDto } from './dto/manual-project.dto';

export interface SourceFilter {
  imported: boolean;
  manual: boolean;
}

export interface SummaryProjectBreak {
  projectId: number | null;
  projectName: string;
  isProvisional: boolean;
  source: 'imported' | 'manual';
  workType: string;
  hours: number;
}

export interface SummaryCell {
  imported: number;
  manual: number;
  total: number;
  base: number | null;
  utilization: number | null;
  byProject: SummaryProjectBreak[];
}

export interface SummaryRow {
  assigneeId: number;
  assigneeName: string;
  cells: Record<string, SummaryCell>;
  totalHours: number;
}

export interface CapacitySummary {
  fiscalYear: number | null;
  batchId: number | null;
  months: string[];
  rows: SummaryRow[];
}

export interface MatrixCell {
  imported: number;
  manual: number;
  total: number;
}

export interface MatrixRow {
  assigneeId: number;
  assigneeName: string;
  cells: Record<string, MatrixCell>;
  total: number;
}

export interface ProjectMatrix {
  projectId: number;
  projectName: string;
  projectCode: string | null;
  isProvisional: boolean;
  batchId: number | null;
  months: string[];
  rows: MatrixRow[];
  monthTotals: Record<string, number>;
  grandTotal: number;
}

interface JoinedEntry {
  assigneeId: number;
  assigneeName: string;
  projectId: number | null;
  projectName: string | null;
  isProvisional: number | null;
  workType: string;
  yearMonth: string;
  hours: number;
  source: string;
}

@Injectable()
export class ManhoursService {
  constructor(@Inject(DB_TOKEN) private readonly db: AppDb) {}

  // ---- batches -----------------------------------------------------------

  listBatches(fiscalYear?: number) {
    const rows = this.db
      .select()
      .from(manhourImportBatches)
      .orderBy(desc(manhourImportBatches.importedAt))
      .all();
    return fiscalYear === undefined
      ? rows
      : rows.filter((r) => r.fiscalYear === fiscalYear);
  }

  /** 明示 batchId 優先。無ければ年度（または全体）の最新バッチ。 */
  resolveImportedBatchId(
    fiscalYear?: number,
    batchId?: number,
  ): number | null {
    if (batchId !== undefined) {
      const b = this.db
        .select({ id: manhourImportBatches.id })
        .from(manhourImportBatches)
        .where(eq(manhourImportBatches.id, batchId))
        .get();
      return b ? b.id : null;
    }
    const list = this.listBatches(fiscalYear);
    return list.length > 0 ? list[0].id : null;
  }

  deleteBatch(id: number): void {
    const b = this.db
      .select({ id: manhourImportBatches.id })
      .from(manhourImportBatches)
      .where(eq(manhourImportBatches.id, id))
      .get();
    if (!b) throw new NotFoundException(`batch ${id} not found`);
    // entries / capacities は FK cascade で削除。仮案件は他バッチや手入力が
    // 参照しうるため意図的に残す。
    this.db
      .delete(manhourImportBatches)
      .where(eq(manhourImportBatches.id, id))
      .run();
  }

  // ---- shared loaders ----------------------------------------------------

  private loadEntries(
    resolvedBatchId: number | null,
    filter: SourceFilter,
    projectId?: number,
  ): JoinedEntry[] {
    const all = this.db
      .select({
        assigneeId: manhourEntries.assigneeId,
        assigneeName: assignees.name,
        projectId: manhourEntries.projectId,
        projectName: projects.name,
        isProvisional: projects.isProvisional,
        workType: manhourEntries.workType,
        yearMonth: manhourEntries.yearMonth,
        hours: manhourEntries.hours,
        source: manhourEntries.source,
        batchId: manhourEntries.batchId,
      })
      .from(manhourEntries)
      .leftJoin(assignees, eq(manhourEntries.assigneeId, assignees.id))
      .leftJoin(projects, eq(manhourEntries.projectId, projects.id))
      .all();

    return all
      .filter((r) => {
        if (projectId !== undefined && r.projectId !== projectId) return false;
        const isManual = r.source === 'manual' || r.batchId === null;
        if (isManual) return filter.manual;
        if (!filter.imported) return false;
        return resolvedBatchId !== null && r.batchId === resolvedBatchId;
      })
      .map((r) => ({
        assigneeId: r.assigneeId,
        assigneeName: r.assigneeName ?? '(不明)',
        projectId: r.projectId,
        projectName: r.projectName,
        isProvisional: r.isProvisional,
        workType: r.workType,
        yearMonth: r.yearMonth,
        hours: r.hours,
        source: r.source === 'manual' || r.batchId === null ? 'manual' : 'imported',
      }));
  }

  /** key `${assigneeId} ${ym}` → baseHours。手動上書きが取込値に優先。 */
  private loadCapacityMap(
    resolvedBatchId: number | null,
    filter: SourceFilter,
  ): Map<string, number> {
    const rows = this.db.select().from(manhourCapacities).all();
    const map = new Map<string, number>();
    if (filter.imported && resolvedBatchId !== null) {
      for (const r of rows) {
        if (r.source !== 'manual' && r.batchId === resolvedBatchId) {
          map.set(`${r.assigneeId} ${r.yearMonth}`, r.baseHours);
        }
      }
    }
    if (filter.manual) {
      for (const r of rows) {
        if (r.source === 'manual' || r.batchId === null) {
          map.set(`${r.assigneeId} ${r.yearMonth}`, r.baseHours);
        }
      }
    }
    return map;
  }

  private fiscalMonths(fy: number): string[] {
    const out: string[] = [];
    for (let m = 4; m <= 12; m += 1)
      out.push(`${fy}-${String(m).padStart(2, '0')}`);
    for (let m = 1; m <= 3; m += 1)
      out.push(`${fy + 1}-${String(m).padStart(2, '0')}`);
    return out;
  }

  // ---- screen (b): cross-assignee capacity / 見通し ----------------------

  getSummary(opts: {
    fiscalYear?: number;
    batchId?: number;
    filter: SourceFilter;
  }): CapacitySummary {
    const batchId = this.resolveImportedBatchId(opts.fiscalYear, opts.batchId);
    const entries = this.loadEntries(batchId, opts.filter);
    const capMap = this.loadCapacityMap(batchId, opts.filter);

    const monthSet = new Set<string>(
      opts.fiscalYear !== undefined ? this.fiscalMonths(opts.fiscalYear) : [],
    );
    for (const e of entries) monthSet.add(e.yearMonth);
    for (const k of capMap.keys()) monthSet.add(k.split(' ')[1]);
    const months = [...monthSet].sort();

    const rowMap = new Map<number, SummaryRow>();
    const ensureRow = (id: number, name: string): SummaryRow => {
      let row = rowMap.get(id);
      if (!row) {
        row = { assigneeId: id, assigneeName: name, cells: {}, totalHours: 0 };
        rowMap.set(id, row);
      }
      return row;
    };
    const ensureCell = (row: SummaryRow, ym: string): SummaryCell => {
      let cell = row.cells[ym];
      if (!cell) {
        cell = {
          imported: 0,
          manual: 0,
          total: 0,
          base: null,
          utilization: null,
          byProject: [],
        };
        row.cells[ym] = cell;
      }
      return cell;
    };

    for (const e of entries) {
      const row = ensureRow(e.assigneeId, e.assigneeName);
      const cell = ensureCell(row, e.yearMonth);
      if (e.source === 'manual') cell.manual += e.hours;
      else cell.imported += e.hours;
      cell.total += e.hours;
      row.totalHours += e.hours;
      cell.byProject.push({
        projectId: e.projectId,
        projectName: e.projectName ?? (e.workType === 'zz' ? '非稼働' : '(未割当)'),
        isProvisional: e.isProvisional === 1,
        source: e.source as 'imported' | 'manual',
        workType: e.workType,
        hours: e.hours,
      });
    }

    // capacity / utilization を全行×全月に展開（工数ゼロでもキャパは見せる）。
    for (const [key, base] of capMap) {
      const [idStr, ym] = key.split(' ');
      const id = Number(idStr);
      const a = this.db
        .select({ name: assignees.name })
        .from(assignees)
        .where(eq(assignees.id, id))
        .get();
      const row = ensureRow(id, a?.name ?? '(不明)');
      const cell = ensureCell(row, ym);
      cell.base = base;
    }
    for (const row of rowMap.values()) {
      for (const ym of Object.keys(row.cells)) {
        const cell = row.cells[ym];
        cell.utilization =
          cell.base && cell.base > 0 ? cell.total / cell.base : null;
      }
    }

    const rows = [...rowMap.values()].sort((a, b) =>
      a.assigneeName.localeCompare(b.assigneeName, 'ja'),
    );
    return { fiscalYear: opts.fiscalYear ?? null, batchId, months, rows };
  }

  // ---- screen (a): per-project assignee × month -------------------------

  getProjectMatrix(
    projectId: number,
    opts: { fiscalYear?: number; batchId?: number; filter: SourceFilter },
  ): ProjectMatrix {
    const project = this.db
      .select({
        id: projects.id,
        name: projects.name,
        projectCode: projects.projectCode,
        isProvisional: projects.isProvisional,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .get();
    if (!project) throw new NotFoundException(`project ${projectId} not found`);

    const batchId = this.resolveImportedBatchId(opts.fiscalYear, opts.batchId);
    const entries = this.loadEntries(batchId, opts.filter, projectId);

    const monthSet = new Set<string>(
      opts.fiscalYear !== undefined ? this.fiscalMonths(opts.fiscalYear) : [],
    );
    for (const e of entries) monthSet.add(e.yearMonth);
    const months = [...monthSet].sort();

    const rowMap = new Map<number, MatrixRow>();
    const monthTotals: Record<string, number> = {};
    let grandTotal = 0;

    for (const e of entries) {
      let row = rowMap.get(e.assigneeId);
      if (!row) {
        row = {
          assigneeId: e.assigneeId,
          assigneeName: e.assigneeName,
          cells: {},
          total: 0,
        };
        rowMap.set(e.assigneeId, row);
      }
      let cell = row.cells[e.yearMonth];
      if (!cell) {
        cell = { imported: 0, manual: 0, total: 0 };
        row.cells[e.yearMonth] = cell;
      }
      if (e.source === 'manual') cell.manual += e.hours;
      else cell.imported += e.hours;
      cell.total += e.hours;
      row.total += e.hours;
      monthTotals[e.yearMonth] = (monthTotals[e.yearMonth] ?? 0) + e.hours;
      grandTotal += e.hours;
    }

    const rows = [...rowMap.values()].sort((a, b) =>
      a.assigneeName.localeCompare(b.assigneeName, 'ja'),
    );
    return {
      projectId: project.id,
      projectName: project.name,
      projectCode: project.projectCode,
      isProvisional: project.isProvisional === 1,
      batchId,
      months,
      rows,
      monthTotals,
      grandTotal,
    };
  }

  // ---- manual entry / project -------------------------------------------

  upsertManualEntry(dto: ManualEntryDto) {
    const a = this.db
      .select({ id: assignees.id })
      .from(assignees)
      .where(eq(assignees.id, dto.assigneeId))
      .get();
    if (!a) throw new NotFoundException(`assignee ${dto.assigneeId} not found`);
    const projectId = dto.projectId ?? null;
    if (projectId !== null) {
      const p = this.db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, projectId))
        .get();
      if (!p) throw new NotFoundException(`project ${projectId} not found`);
    }
    const workType = dto.workType ?? '';

    return this.db.transaction((tx) => {
      const projectCond =
        projectId === null
          ? isNull(manhourEntries.projectId)
          : eq(manhourEntries.projectId, projectId);
      tx.delete(manhourEntries)
        .where(
          and(
            isNull(manhourEntries.batchId),
            eq(manhourEntries.source, 'manual'),
            eq(manhourEntries.assigneeId, dto.assigneeId),
            projectCond,
            eq(manhourEntries.workType, workType),
            eq(manhourEntries.yearMonth, dto.yearMonth),
          ),
        )
        .run();
      if (dto.hours <= 0) {
        return { assigneeId: dto.assigneeId, deleted: true };
      }
      const row = tx
        .insert(manhourEntries)
        .values({
          batchId: null,
          source: 'manual',
          assigneeId: dto.assigneeId,
          projectId,
          workType,
          yearMonth: dto.yearMonth,
          hours: dto.hours,
        })
        .returning()
        .get();
      return row;
    });
  }

  deleteManualEntry(id: number): void {
    const row = this.db
      .select({ id: manhourEntries.id, source: manhourEntries.source })
      .from(manhourEntries)
      .where(eq(manhourEntries.id, id))
      .get();
    if (!row) throw new NotFoundException(`manhour entry ${id} not found`);
    if (row.source !== 'manual') {
      throw new NotFoundException(
        `entry ${id} は取込データのため削除できません（手入力のみ削除可）`,
      );
    }
    this.db.delete(manhourEntries).where(eq(manhourEntries.id, id)).run();
  }

  createManualProject(dto: ManualProjectDto) {
    if (dto.customerId !== undefined && dto.customerId !== null) {
      const c = this.db
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.id, dto.customerId))
        .get();
      if (!c) throw new NotFoundException(`customer ${dto.customerId} not found`);
    }
    const created = this.db
      .insert(projects)
      .values({
        name: dto.name.trim(),
        customerId: dto.customerId ?? null,
        projectCode: dto.projectCode?.trim() || null,
        isProvisional: 1,
      })
      .returning()
      .get();
    return created;
  }
}
