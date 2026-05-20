import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, isNull } from 'drizzle-orm';
import { AppDb, customers, projects, Project } from '../db';
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

  list(organizationId?: number | null): ProjectWithCustomer[] {
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
    const filtered =
      organizationId === null
        ? base.where(isNull(projects.organizationId))
        : typeof organizationId === 'number'
          ? base.where(eq(projects.organizationId, organizationId))
          : base;
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
