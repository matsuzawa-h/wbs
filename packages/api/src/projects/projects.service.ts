import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, SQL } from 'drizzle-orm';
import {
  AppDb,
  assignees,
  customers,
  projectMembers,
  projects,
  Project,
  wbsTasks,
} from '../db';
import { DB_TOKEN } from '../db/db.module';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

// Project response shape exposed by the API. The customer fields are joined
// in for the list / detail responses so the frontend doesn't need a second
// fetch to render the customer name.
export interface ProjectWithCustomer extends Project {
  customerName: string | null;
  customerIsActive: number | null;
}

export interface UpcomingTask {
  id: number;
  name: string;
  endDate: string | null;
  progress: number;
  status: string;
  assigneeName: string | null;
}

/** プロジェクト概要画面のダッシュボード KPI（wbs_tasks ベース）。 */
export interface ProjectDashboard {
  projectId: number;
  // タスク数 — level=3（葉）のみカウント。level=1/2 はラベル扱い。
  taskCounts: {
    total: number;
    completed: number;
    inProgress: number;
    late: number;
    notStarted: number;
  };
  /** 葉タスクの進捗率の平均 (0–100、整数) */
  averageProgress: number;
  hours: {
    planned: number;
    actual: number;
    /** planned - actual (負値なら超過) */
    remaining: number;
  };
  /** WBS 葉タスクから集計した期間。タスクが無ければ null。 */
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  /** project_members の人数 */
  memberCount: number;
  /** 期限が迫っているタスク (top 5)。完了していないもの。 */
  upcomingTasks: UpcomingTask[];
}

@Injectable()
export class ProjectsService {
  constructor(@Inject(DB_TOKEN) private readonly db: AppDb) {}

  /**
   * @param organizationId undefined=絞り込み無し / null=未設定 / number=該当組織
   * @param memberEmployeeId 指定時はその社員が project_members に居る案件のみ
   *   （ログインユーザの「自分の担当のみ」表示用）
   */
  list(opts: {
    organizationId?: number | null;
    memberEmployeeId?: number;
  } = {}): ProjectWithCustomer[] {
    let memberProjectIds: number[] | null = null;
    if (opts.memberEmployeeId !== undefined) {
      const ids = this.db
        .select({ projectId: projectMembers.projectId })
        .from(projectMembers)
        .where(eq(projectMembers.employeeId, opts.memberEmployeeId))
        .all()
        .map((r) => r.projectId);
      if (ids.length === 0) return [];
      memberProjectIds = ids;
    }
    const conds: SQL[] = [];
    if (opts.organizationId === null) {
      conds.push(isNull(projects.organizationId));
    } else if (typeof opts.organizationId === 'number') {
      conds.push(eq(projects.organizationId, opts.organizationId));
    }
    if (memberProjectIds !== null) {
      conds.push(inArray(projects.id, memberProjectIds));
    }
    const base = this.db
      .select({
        id: projects.id,
        customerId: projects.customerId,
        name: projects.name,
        projectCode: projects.projectCode,
        isProvisional: projects.isProvisional,
        organizationId: projects.organizationId,
        description: projects.description,
        status: projects.status,
        createdAt: projects.createdAt,
        customerName: customers.name,
        customerIsActive: customers.isActive,
      })
      .from(projects)
      .leftJoin(customers, eq(projects.customerId, customers.id));
    const filtered = conds.length > 0 ? base.where(and(...conds)) : base;
    return filtered
      .orderBy(asc(customers.sortOrder), asc(customers.id), asc(projects.id))
      .all();
  }

  findById(id: number): ProjectWithCustomer {
    const row = this.db
      .select({
        id: projects.id,
        customerId: projects.customerId,
        name: projects.name,
        projectCode: projects.projectCode,
        isProvisional: projects.isProvisional,
        organizationId: projects.organizationId,
        description: projects.description,
        status: projects.status,
        createdAt: projects.createdAt,
        customerName: customers.name,
        customerIsActive: customers.isActive,
      })
      .from(projects)
      .leftJoin(customers, eq(projects.customerId, customers.id))
      .where(eq(projects.id, id))
      .get();
    if (!row) {
      throw new NotFoundException(`Project ${id} not found`);
    }
    return row;
  }

  create(dto: CreateProjectDto): ProjectWithCustomer {
    if (dto.customerId !== undefined && dto.customerId !== null) {
      this.assertCustomerExists(dto.customerId);
    }
    const inserted = this.db
      .insert(projects)
      .values({
        name: dto.name,
        customerId: dto.customerId ?? null,
        organizationId: dto.organizationId ?? null,
        description: dto.description ?? null,
        status: dto.status ?? 'active',
      })
      .returning()
      .get();
    return this.findById(inserted.id);
  }

  update(id: number, dto: UpdateProjectDto): ProjectWithCustomer {
    this.findById(id);
    const patch: Partial<typeof projects.$inferInsert> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.customerId !== undefined) {
      if (dto.customerId !== null) this.assertCustomerExists(dto.customerId);
      patch.customerId = dto.customerId;
    }
    if (dto.organizationId !== undefined) patch.organizationId = dto.organizationId;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.status !== undefined) patch.status = dto.status;
    this.db.update(projects).set(patch).where(eq(projects.id, id)).run();
    return this.findById(id);
  }

  remove(id: number): void {
    this.findById(id);
    this.db.delete(projects).where(eq(projects.id, id)).run();
  }

  /**
   * 概要画面の KPI ダッシュボード。葉タスク (level=3) を集計する。
   * status 判定: completed > late > inProgress > notStarted。
   */
  getProjectDashboard(id: number): ProjectDashboard {
    this.findById(id); // 404 保証
    const tasks = this.db
      .select({
        id: wbsTasks.id,
        level: wbsTasks.level,
        name: wbsTasks.name,
        startDate: wbsTasks.startDate,
        endDate: wbsTasks.endDate,
        actualStartDate: wbsTasks.actualStartDate,
        actualEndDate: wbsTasks.actualEndDate,
        plannedHours: wbsTasks.plannedHours,
        actualHours: wbsTasks.actualHours,
        progress: wbsTasks.progress,
        status: wbsTasks.status,
        assigneeId: wbsTasks.assigneeId,
        assigneeName: assignees.name,
      })
      .from(wbsTasks)
      .leftJoin(assignees, eq(wbsTasks.assigneeId, assignees.id))
      .where(eq(wbsTasks.projectId, id))
      .all();

    const leaves = tasks.filter((t) => t.level === 3);
    const today = todayUtc();

    let completed = 0;
    let inProgress = 0;
    let late = 0;
    let notStarted = 0;
    let progressSum = 0;
    let planned = 0;
    let actual = 0;
    let minStart: string | null = null;
    let maxEnd: string | null = null;

    for (const t of leaves) {
      progressSum += t.progress;
      planned += t.plannedHours ?? 0;
      actual += t.actualHours ?? 0;
      if (t.startDate && (minStart === null || t.startDate < minStart)) {
        minStart = t.startDate;
      }
      if (t.endDate && (maxEnd === null || t.endDate > maxEnd)) {
        maxEnd = t.endDate;
      }
      const isCompleted = t.actualEndDate !== null;
      const isLate =
        !isCompleted && t.endDate !== null && t.endDate < today;
      const isInProgress =
        !isCompleted && !isLate && t.actualStartDate !== null;
      if (isCompleted) completed += 1;
      else if (isLate) late += 1;
      else if (isInProgress) inProgress += 1;
      else notStarted += 1;
    }

    const memberCount = this.db
      .select({ id: projectMembers.employeeId })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, id))
      .all().length;

    // 期限近いタスク: 完了していない＋endDate を持つ。endDate asc で 5 件。
    const upcoming = leaves
      .filter((t) => t.actualEndDate === null && t.endDate !== null)
      .sort((a, b) => (a.endDate ?? '').localeCompare(b.endDate ?? ''))
      .slice(0, 5)
      .map<UpcomingTask>((t) => ({
        id: t.id,
        name: t.name,
        endDate: t.endDate,
        progress: t.progress,
        status: t.endDate !== null && t.endDate < today ? 'late' : 'pending',
        assigneeName: t.assigneeName,
      }));

    return {
      projectId: id,
      taskCounts: {
        total: leaves.length,
        completed,
        inProgress,
        late,
        notStarted,
      },
      averageProgress:
        leaves.length > 0 ? Math.round(progressSum / leaves.length) : 0,
      hours: {
        planned,
        actual,
        remaining: planned - actual,
      },
      plannedStartDate: minStart,
      plannedEndDate: maxEnd,
      memberCount,
      upcomingTasks: upcoming,
    };
  }

  private assertCustomerExists(customerId: number): void {
    const row = this.db.select().from(customers).where(eq(customers.id, customerId)).get();
    if (!row) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }
  }
}

/** 今日の日付を YYYY-MM-DD (UTC)。日付比較用。 */
function todayUtc(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const dd = d.getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}
