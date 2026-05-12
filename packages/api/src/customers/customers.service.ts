import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { AppDb, customers, Customer } from '../db';
import { DB_TOKEN } from '../db/db.module';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  constructor(@Inject(DB_TOKEN) private readonly db: AppDb) {}

  list(): Customer[] {
    return this.db
      .select()
      .from(customers)
      .orderBy(asc(customers.sortOrder), asc(customers.code), asc(customers.id))
      .all();
  }

  findById(id: number): Customer {
    const row = this.db.select().from(customers).where(eq(customers.id, id)).get();
    if (!row) throw new NotFoundException(`Customer ${id} not found`);
    return row;
  }

  create(dto: CreateCustomerDto): Customer {
    const code = dto.code?.trim() || this.nextCode();
    this.assertCodeUnique(code, null);
    return this.db
      .insert(customers)
      .values({
        code,
        name: dto.name,
        contactName: dto.contactName ?? null,
        contactEmail: dto.contactEmail ?? null,
        contactPhone: dto.contactPhone ?? null,
        address: dto.address ?? null,
        isActive: dto.isActive === false ? 0 : 1,
        note: dto.note ?? null,
        sortOrder: dto.sortOrder ?? 0,
      })
      .returning()
      .get();
  }

  update(id: number, dto: UpdateCustomerDto): Customer {
    this.findById(id);
    const patch: Partial<typeof customers.$inferInsert> = {};
    if (dto.code !== undefined) {
      const code = dto.code.trim() || null;
      if (code) this.assertCodeUnique(code, id);
      patch.code = code;
    }
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.contactName !== undefined) patch.contactName = dto.contactName || null;
    if (dto.contactEmail !== undefined) patch.contactEmail = dto.contactEmail || null;
    if (dto.contactPhone !== undefined) patch.contactPhone = dto.contactPhone || null;
    if (dto.address !== undefined) patch.address = dto.address || null;
    if (dto.isActive !== undefined) patch.isActive = dto.isActive ? 1 : 0;
    if (dto.note !== undefined) patch.note = dto.note || null;
    if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;
    return this.db
      .update(customers)
      .set(patch)
      .where(eq(customers.id, id))
      .returning()
      .get();
  }

  remove(id: number): void {
    this.findById(id);
    this.db.delete(customers).where(eq(customers.id, id)).run();
  }

  private assertCodeUnique(code: string, excludeId: number | null): void {
    const existing = this.db.select().from(customers).where(eq(customers.code, code)).get();
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`顧客コード "${code}" は既に登録されています`);
    }
  }

  private nextCode(): string {
    const rows = this.db.select({ code: customers.code }).from(customers).all();
    let max = 0;
    for (const r of rows) {
      const m = r.code?.match(/^C(\d{3,})$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
    return `C${String(max + 1).padStart(3, '0')}`;
  }
}
