import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, SQL } from 'drizzle-orm';
import { AppDb, customers, projectMembers, projects, Project } from '../db';
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
    this.db.update(projects).set(patch).where(eq(projects.id, id)).run();
    return this.findById(id);
  }

  remove(id: number): void {
    this.findById(id);
    this.db.delete(projects).where(eq(projects.id, id)).run();
  }

  private assertCustomerExists(customerId: number): void {
    const row = this.db.select().from(customers).where(eq(customers.id, customerId)).get();
    if (!row) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }
  }
}
