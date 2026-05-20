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
  /** 月内の zz 休暇合計（label に「休」を含む）。36(残業) 算出用。 */
  vacation: number;
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
  label: string | null;
  isProvisional: number | null;
  workType: string;
  yearMonth: string;
  hours: number;
  source: string;
}

// 原本「稼働管理表（明細）」と同じ形：作業区分/顧客名/件名/CD × 12ヶ月。
export interface AssigneeDetailRow {
  workType: string;
  customerName: string | null;
  subject: string;
  projectCode: string | null;
  projectId: number | null;
  source: 'imported' | 'manual';
  cells: Record<string, number>;
  total: number;
}

export interface AssigneeDetail {
  assigneeId: number;
  assigneeName: string;
  fiscalYear: number | null;
  batchId: number | null;
  months: string[];
  rows: AssigneeDetailRow[];
  /** 月別の基準時間（標準時間）。36(残業) = 全体の工数 − 標準時間 − 休暇。 */
  capacity: Record<string, number>;
}

@Injectable()
export class ManhoursService {
  constructor(@Inject(DB_TOKEN) private readonly db: AppDb) {}

  // ---- batches -----------------------------------------------------------

  /**
   * 取込バッチ一覧。年度／組織で絞り込み可能。
   * organizationId: undefined=全組織 / null=組織未紐付け / number=その組織のバッチ。
   */
  listBatches(fiscalYear?: number, organizationId?: number | null) {
    const rows = this.db
      .select()
      .from(manhourImportBatches)
      .orderBy(desc(manhourImportBatches.importedAt))
      .all();
    return rows.filter((r) => {
      if (fiscalYear !== undefined && r.fiscalYear !== fiscalYear) return false;
      if (organizationId === undefined) return true;
      if (organizationId === null) return r.organizationId === null;
      return r.organizationId === organizationId;
    });
  }

  /**
   * 明示 batchId 優先。無ければ年度＋組織の最新バッチ（履歴＝組織別）。
   * 「組織未指定」と「組織NULL指定」は別物として扱う。
   * （単一値版・後方互換用）
   */
  resolveImportedBatchId(
    fiscalYear?: number,
    batchId?: number,
    organizationId?: number | null,
  ): number | null {
    if (batchId !== undefined) {
      const b = this.db
        .select({ id: manhourImportBatches.id })
        .from(manhourImportBatches)
        .where(eq(manhourImportBatches.id, batchId))
        .get();
      return b ? b.id : null;
    }
    const list = this.listBatches(fiscalYear, organizationId);
    return list.length > 0 ? list[0].id : null;
  }

  /**
   * 集計用のバッチ ID 集合を決定する:
   * - batchId 明示  → 単一
   * - organizationId 明示 → その組織の最新（1件）
   * - 両方 undefined → **組織ごとの最新バッチを集約**（複数組織混在の運用に対応）
   */
  resolveImportedBatchIds(
    fiscalYear?: number,
    batchId?: number,
    organizationId?: number | null,
  ): Set<number> {
    if (batchId !== undefined) {
      const id = this.resolveImportedBatchId(fiscalYear, batchId, organizationId);
      return id !== null ? new Set([id]) : new Set();
    }
    if (organizationId !== undefined) {
      const id = this.resolveImportedBatchId(fiscalYear, undefined, organizationId);
      return id !== null ? new Set([id]) : new Set();
    }
    return this.latestBatchIdsPerOrg(fiscalYear);
  }

  /** 年度内・組織別の最新バッチ ID（取込時刻 desc の各組織で初出）。 */
  private latestBatchIdsPerOrg(fiscalYear?: number): Set<number> {
    const all = this.listBatches(fiscalYear); // importedAt desc
    const seenOrgs = new Set<number | null>();
    const ids = new Set<number>();
    for (const b of all) {
      const k = b.organizationId; // null も「未紐付」グループとして1件採用
      if (!seenOrgs.has(k)) {
        seenOrgs.add(k);
        ids.add(b.id);
      }
    }
    return ids;
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

  /**
   * @param resolvedBatchIds 取込分の絞り込みに使うバッチ ID 集合
   *   - 空 Set → imported は 0 件（manual だけ）
   *   - 1+    → そのバッチに属する imported を返す
   * @param manualOrgAssigneeIds manual 行は「その組織所属の社員」だけに絞る用
   *   - null → 絞り込み無し（手入力もすべて）
   *   - Set  → assignee.id がこの集合にある手入力のみ
   */
  private loadEntries(
    resolvedBatchIds: Set<number>,
    filter: SourceFilter,
    manualOrgAssigneeIds: Set<number> | null,
    projectId?: number,
  ): JoinedEntry[] {
    const all = this.db
      .select({
        assigneeId: manhourEntries.assigneeId,
        assigneeName: assignees.name,
        projectId: manhourEntries.projectId,
        projectName: projects.name,
        label: manhourEntries.label,
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
        if (isManual) {
          if (!filter.manual) return false;
          // manual はバッチに属さないので assignee.org で絞る（漏れ防止）
          if (
            manualOrgAssigneeIds !== null &&
            !manualOrgAssigneeIds.has(r.assigneeId)
          ) {
            return false;
          }
          return true;
        }
        if (!filter.imported) return false;
        return r.batchId !== null && resolvedBatchIds.has(r.batchId);
      })
      .map((r) => ({
        assigneeId: r.assigneeId,
        assigneeName: r.assigneeName ?? '(不明)',
        projectId: r.projectId,
        projectName: r.projectName,
        label: r.label,
        isProvisional: r.isProvisional,
        workType: r.workType,
        yearMonth: r.yearMonth,
        hours: r.hours,
        source: r.source === 'manual' || r.batchId === null ? 'manual' : 'imported',
      }));
  }

  /**
   * key `${assigneeId} ${ym}` → baseHours。手動上書きが取込値に優先。
   * 取込分は resolvedBatchIds（Set）に含まれるバッチのみ。
   * manual は manualOrgAssigneeIds が指定されていればその社員に限定。
   */
  private loadCapacityMap(
    resolvedBatchIds: Set<number>,
    filter: SourceFilter,
    manualOrgAssigneeIds: Set<number> | null,
  ): Map<string, number> {
    const rows = this.db.select().from(manhourCapacities).all();
    const map = new Map<string, number>();
    if (filter.imported && resolvedBatchIds.size > 0) {
      for (const r of rows) {
        if (
          r.source !== 'manual' &&
          r.batchId !== null &&
          resolvedBatchIds.has(r.batchId)
        ) {
          map.set(`${r.assigneeId} ${r.yearMonth}`, r.baseHours);
        }
      }
    }
    if (filter.manual) {
      for (const r of rows) {
        if (r.source === 'manual' || r.batchId === null) {
          if (
            manualOrgAssigneeIds !== null &&
            !manualOrgAssigneeIds.has(r.assigneeId)
          ) {
            continue;
          }
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

  /**
   * 組織絞り込み用に、organization_id が一致する担当者 ID 集合を返す。
   * `undefined` → 絞り込み無し（戻り値 null）
   * `null`      → organization_id IS NULL の担当者
   * `number`    → その組織に所属する担当者
   */
  private assigneeIdsByOrg(
    organizationId: number | null | undefined,
  ): Set<number> | null {
    if (organizationId === undefined) return null;
    const rows = this.db
      .select({ id: assignees.id, orgId: assignees.organizationId })
      .from(assignees)
      .all();
    const ids = new Set<number>();
    for (const r of rows) {
      if (organizationId === null) {
        if (r.orgId === null) ids.add(r.id);
      } else if (r.orgId === organizationId) {
        ids.add(r.id);
      }
    }
    return ids;
  }

  // 担当者を「コード昇順（NULL/空は末尾）」で並べるための比較器を返す。
  private codeAscSorter(): (a: number, b: number) => number {
    const idToCode = new Map<number, string | null>();
    for (const a of this.db
      .select({ id: assignees.id, code: assignees.code })
      .from(assignees)
      .all()) {
      idToCode.set(a.id, a.code);
    }
    return (a: number, b: number): number => {
      const ca = idToCode.get(a) ?? null;
      const cb = idToCode.get(b) ?? null;
      const ae = !ca;
      const be = !cb;
      if (ae && be) return a - b;
      if (ae) return 1;
      if (be) return -1;
      return (ca as string).localeCompare(cb as string, 'en', {
        numeric: true,
      });
    };
  }

  // ---- screen (b): cross-assignee capacity / 見通し ----------------------

  getSummary(opts: {
    fiscalYear?: number;
    batchId?: number;
    filter: SourceFilter;
    /**
     * 未指定 → 組織ごとの最新バッチを集約（複数組織混在運用に対応）
     * null   → 「組織未紐付」グループのみ
     * number → その組織の最新バッチのみ
     * 取込分は「バッチに属するか」で判定するので、リンクで別組織の社員が
     * 新組織のバッチに登場するケースも、新組織のビューに正しく出る。
     */
    organizationId?: number | null;
  }): CapacitySummary {
    const batchIds = this.resolveImportedBatchIds(
      opts.fiscalYear,
      opts.batchId,
      opts.organizationId,
    );
    // 単一バッチが解決されていればそれを response の batchId にして UI 互換性を保つ
    const batchId = batchIds.size === 1 ? [...batchIds][0]! : null;
    const manualOrgIds = this.assigneeIdsByOrg(opts.organizationId);
    const entries = this.loadEntries(batchIds, opts.filter, manualOrgIds);
    const capMap = this.loadCapacityMap(batchIds, opts.filter, manualOrgIds);

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
          vacation: 0,
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
      // zz の「休暇」（label に「休」を含む）は別途集計し、36(残業) 算出に使う。
      if (e.workType === 'zz' && /休/.test(e.label ?? '')) {
        cell.vacation += e.hours;
      }
      row.totalHours += e.hours;
      cell.byProject.push({
        projectId: e.projectId,
        projectName:
          e.projectName ??
          e.label ??
          (e.workType === 'zz' ? '非稼働' : '(未割当)'),
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

    // ※ 行レベルの assignee.org フィルタは行わない。
    //   組織絞り込みは「imported = そのバッチに属する」「manual = assignee.org 一致」
    //   で loadEntries / loadCapacityMap 内で適用済み。
    //   リンクで別組織の社員が新組織のバッチに登場する場合も、その社員が新組織の
    //   ビューに正しく出るようにするため。
    const sortByCode = this.codeAscSorter();
    const rows = [...rowMap.values()].sort((a, b) =>
      sortByCode(a.assigneeId, b.assigneeId),
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

    // 案件画面は組織絞り込みを持たないため、組織未指定（=組織別最新の和）として
    // バッチを解決する。明示 batchId はそのまま使う。
    const batchIds = this.resolveImportedBatchIds(opts.fiscalYear, opts.batchId);
    const batchId = batchIds.size === 1 ? [...batchIds][0]! : null;
    const entries = this.loadEntries(batchIds, opts.filter, null, projectId);

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

    const sortByCode = this.codeAscSorter();
    const rows = [...rowMap.values()].sort((a, b) =>
      sortByCode(a.assigneeId, b.assigneeId),
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

  // ---- 担当者別 明細（原本稼働表の形・仮は編集可） --------------------

  getAssigneeDetail(
    assigneeId: number,
    opts: { fiscalYear?: number; batchId?: number; filter: SourceFilter },
  ): AssigneeDetail {
    const a = this.db
      .select({ id: assignees.id, name: assignees.name })
      .from(assignees)
      .where(eq(assignees.id, assigneeId))
      .get();
    if (!a) throw new NotFoundException(`assignee ${assigneeId} not found`);

    // 担当者明細は assignee.id で絞るので、組織ベースのバッチ集合は使わず、
    // 該当担当者の取込分はすべて参照する（ただし最新バッチに限定）。
    const batchId = this.resolveImportedBatchId(opts.fiscalYear, opts.batchId);
    const all = this.db
      .select({
        projectId: manhourEntries.projectId,
        projectName: projects.name,
        projectCode: projects.projectCode,
        // CSV CD の生値。MNT/CD無AFT/zz など projects 化しない行のフォールバック。
        projectCodeLabel: manhourEntries.projectCodeLabel,
        // 顧客名は CSV顧客名(E列)の生値を使う（顧客マスタ非依存。MNT等も出る）
        customerLabel: manhourEntries.customerLabel,
        label: manhourEntries.label,
        workType: manhourEntries.workType,
        yearMonth: manhourEntries.yearMonth,
        hours: manhourEntries.hours,
        source: manhourEntries.source,
        batchId: manhourEntries.batchId,
      })
      .from(manhourEntries)
      .leftJoin(projects, eq(manhourEntries.projectId, projects.id))
      .where(eq(manhourEntries.assigneeId, assigneeId))
      .all();

    const monthSet = new Set<string>(
      opts.fiscalYear !== undefined ? this.fiscalMonths(opts.fiscalYear) : [],
    );
    const rowMap = new Map<string, AssigneeDetailRow>();
    for (const r of all) {
      const isManual = r.source === 'manual' || r.batchId === null;
      if (isManual) {
        if (!opts.filter.manual) continue;
      } else {
        if (!opts.filter.imported) continue;
        if (batchId === null || r.batchId !== batchId) continue;
      }
      const source: 'imported' | 'manual' = isManual ? 'manual' : 'imported';
      const isZz = r.workType === 'zz';
      // zz は「休暇」と「非稼働」を分けて 2 行（source 別）に集約。
      // 休暇判定は CSV件名(label) に「休」を含むかどうか（休暇/有給休暇/休日等）。
      const isVacation = isZz && /休/.test(r.label ?? '');
      const subject = isZz
        ? isVacation
          ? '休暇'
          : '非稼働'
        : (r.projectName ?? r.label ?? '(未割当)');
      const key = isZz
        ? `${source}|${isVacation ? 'vac' : 'zz'}`
        : [source, r.workType, r.projectId ?? `L:${subject}`].join('|');
      let row = rowMap.get(key);
      if (!row) {
        row = {
          workType: r.workType,
          customerName: isZz ? null : (r.customerLabel ?? null),
          subject,
          // projects 化された行は projects.project_code が正本。projects 化
          // されない MNT 等は entries.project_code_label をフォールバック表示。
          projectCode: isZz
            ? null
            : (r.projectCode ?? r.projectCodeLabel ?? null),
          projectId: isZz ? null : r.projectId,
          source,
          cells: {},
          total: 0,
        };
        rowMap.set(key, row);
      }
      row.cells[r.yearMonth] = (row.cells[r.yearMonth] ?? 0) + r.hours;
      row.total += r.hours;
      monthSet.add(r.yearMonth);
    }

    const months = [...monthSet].sort();
    // 行順: 作業区分ランク（AFT→その他(MNT等)→非稼働(zz)→休暇(zz)）、
    // 同ランク内は 顧客名 → プロジェクトCD（各 NULL/空 は末尾）→ 件名。
    const wtRank = (row: { workType: string; subject: string }): number => {
      if (row.workType === 'AFT') return 0;
      if (row.workType !== 'zz') return 1;
      // zz: 非稼働 → 休暇 の順で末尾に並べる
      return row.subject === '休暇' ? 3 : 2;
    };
    const nullLast = (
      a: string | null,
      b: string | null,
      cmp: (x: string, y: string) => number,
    ): number => {
      const ae = a === null || a === '';
      const be = b === null || b === '';
      if (ae && be) return 0;
      if (ae) return 1;
      if (be) return -1;
      return cmp(a as string, b as string);
    };
    const rows = [...rowMap.values()].sort(
      (x, y) =>
        wtRank(x) - wtRank(y) ||
        nullLast(x.customerName, y.customerName, (a, b) =>
          a.localeCompare(b, 'ja'),
        ) ||
        nullLast(x.projectCode, y.projectCode, (a, b) =>
          a.localeCompare(b, 'en', { numeric: true }),
        ) ||
        x.subject.localeCompare(y.subject, 'ja') ||
        x.source.localeCompare(y.source),
    );

    // 月別の基準時間（フッターの「標準時間」「36(残業)」算出に使う）。
    // この担当者の capacities を、選択バッチ＋手動上書きで揃える。
    const capMap = this.loadCapacityMap(
      batchId !== null ? new Set([batchId]) : new Set(),
      opts.filter,
      null,
    );
    const capacity: Record<string, number> = {};
    for (const [key, base] of capMap) {
      const [idStr, ym] = key.split(' ');
      if (Number(idStr) === a.id) capacity[ym] = base;
    }
    return {
      assigneeId: a.id,
      assigneeName: a.name,
      fiscalYear: opts.fiscalYear ?? null,
      batchId,
      months,
      rows,
      capacity,
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
      // hours === 0 は明示的な削除（manual を消す）。
      // 取込(imported)分の上書き用に**負の値**も受け付ける：
      // 確定プロジェクトの popup 編集で「total を下げる」を実現する。
      if (dto.hours === 0) {
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
