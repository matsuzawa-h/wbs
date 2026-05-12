import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { AppDb, assignees, Employee, projectMembers, projects } from '../db';
import { DB_TOKEN } from '../db/db.module';

@Injectable()
export class ProjectMembersService {
  constructor(@Inject(DB_TOKEN) private readonly db: AppDb) {}

  listMembers(projectId: number): Employee[] {
    this.assertProjectExists(projectId);
    return this.db
      .select({
        id: assignees.id,
        code: assignees.code,
        name: assignees.name,
        nameKana: assignees.nameKana,
        department: assignees.department,
        role: assignees.role,
        email: assignees.email,
        employmentStart: assignees.employmentStart,
        employmentEnd: assignees.employmentEnd,
        worksOnHolidays: assignees.worksOnHolidays,
        isActive: assignees.isActive,
        note: assignees.note,
        sortOrder: assignees.sortOrder,
      })
      .from(projectMembers)
      .innerJoin(assignees, eq(projectMembers.employeeId, assignees.id))
      .where(eq(projectMembers.projectId, projectId))
      .orderBy(asc(projectMembers.sortOrder), asc(assignees.code), asc(assignees.id))
      .all();
  }

  setMembers(projectId: number, employeeIds: number[]): Employee[] {
    this.assertProjectExists(projectId);
    const ids = Array.from(new Set(employeeIds));
    if (ids.length > 0) {
      const existing = this.db
        .select({ id: assignees.id })
        .from(assignees)
        .where(inArray(assignees.id, ids))
        .all();
      const found = new Set(existing.map((e) => e.id));
      const missing = ids.filter((id) => !found.has(id));
      if (missing.length > 0) {
        throw new NotFoundException(`Employee not found: ${missing.join(', ')}`);
      }
    }

    this.db.transaction((tx) => {
      tx.delete(projectMembers).where(eq(projectMembers.projectId, projectId)).run();
      if (ids.length > 0) {
        tx.insert(projectMembers)
          .values(ids.map((employeeId, idx) => ({ projectId, employeeId, sortOrder: idx })))
          .run();
      }
    });
    return this.listMembers(projectId);
  }

  private assertProjectExists(projectId: number): void {
    const row = this.db.select().from(projects).where(eq(projects.id, projectId)).get();
    if (!row) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
  }
}
