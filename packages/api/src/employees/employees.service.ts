import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { AppDb, assignees, Employee } from '../db';
import { DB_TOKEN } from '../db/db.module';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

@Injectable()
export class EmployeesService {
  constructor(@Inject(DB_TOKEN) private readonly db: AppDb) {}

  list(): Employee[] {
    return this.db
      .select()
      .from(assignees)
      .orderBy(asc(assignees.sortOrder), asc(assignees.code), asc(assignees.id))
      .all();
  }

  findById(id: number): Employee {
    const row = this.db.select().from(assignees).where(eq(assignees.id, id)).get();
    if (!row) throw new NotFoundException(`Employee ${id} not found`);
    return row;
  }

  create(dto: CreateEmployeeDto): Employee {
    const code = dto.code?.trim() || this.nextCode();
    this.assertCodeUnique(code, null);
    return this.db
      .insert(assignees)
      .values({
        code,
        name: dto.name,
        nameKana: dto.nameKana ?? null,
        department: dto.department ?? null,
        role: dto.role ?? null,
        email: dto.email ?? null,
        employmentStart: dto.employmentStart ?? null,
        employmentEnd: dto.employmentEnd ?? null,
        worksOnHolidays: dto.worksOnHolidays ? 1 : 0,
        isActive: dto.isActive === false ? 0 : 1,
        note: dto.note ?? null,
        sortOrder: dto.sortOrder ?? 0,
      })
      .returning()
      .get();
  }

  update(id: number, dto: UpdateEmployeeDto): Employee {
    this.findById(id);
    const patch: Partial<typeof assignees.$inferInsert> = {};
    if (dto.code !== undefined) {
      const code = dto.code.trim() || null;
      if (code) this.assertCodeUnique(code, id);
      patch.code = code;
    }
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.nameKana !== undefined) patch.nameKana = dto.nameKana || null;
    if (dto.department !== undefined) patch.department = dto.department || null;
    if (dto.role !== undefined) patch.role = dto.role || null;
    if (dto.email !== undefined) patch.email = dto.email || null;
    if (dto.employmentStart !== undefined) patch.employmentStart = dto.employmentStart || null;
    if (dto.employmentEnd !== undefined) patch.employmentEnd = dto.employmentEnd || null;
    if (dto.worksOnHolidays !== undefined) patch.worksOnHolidays = dto.worksOnHolidays ? 1 : 0;
    if (dto.isActive !== undefined) patch.isActive = dto.isActive ? 1 : 0;
    if (dto.note !== undefined) patch.note = dto.note || null;
    if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;
    return this.db
      .update(assignees)
      .set(patch)
      .where(eq(assignees.id, id))
      .returning()
      .get();
  }

  remove(id: number): void {
    this.findById(id);
    this.db.delete(assignees).where(eq(assignees.id, id)).run();
  }

  private assertCodeUnique(code: string, excludeId: number | null): void {
    const existing = this.db.select().from(assignees).where(eq(assignees.code, code)).get();
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`社員コード "${code}" は既に登録されています`);
    }
  }

  private nextCode(): string {
    const rows = this.db.select({ code: assignees.code }).from(assignees).all();
    let max = 0;
    for (const r of rows) {
      const m = r.code?.match(/^E(\d{3,})$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
    return `E${String(max + 1).padStart(3, '0')}`;
  }
}
