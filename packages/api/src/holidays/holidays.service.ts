import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { AppDb, holidays, Holiday } from '../db';
import { DB_TOKEN } from '../db/db.module';
import { CreateHolidayDto } from './dto/create-holiday.dto';
import { UpdateHolidayDto } from './dto/update-holiday.dto';

@Injectable()
export class HolidaysService {
  constructor(@Inject(DB_TOKEN) private readonly db: AppDb) {}

  /** Cached YYYY-MM-DD set with a short TTL so heavy cascade ops don't re-query each step. */
  private cache: { set: Set<string>; expires: number } | null = null;
  private readonly cacheTtlMs = 3_000;

  list(): Holiday[] {
    return this.db.select().from(holidays).orderBy(asc(holidays.date)).all();
  }

  create(dto: CreateHolidayDto): Holiday {
    try {
      const row = this.db
        .insert(holidays)
        .values({ date: dto.date, name: dto.name ?? null })
        .returning()
        .get();
      this.invalidate();
      return row;
    } catch (err: unknown) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException(`Holiday for ${dto.date} already exists`);
      }
      throw err;
    }
  }

  bulkCreate(items: CreateHolidayDto[]): { inserted: number; skipped: number } {
    let inserted = 0;
    let skipped = 0;
    this.db.transaction((tx) => {
      for (const item of items) {
        try {
          tx.insert(holidays)
            .values({ date: item.date, name: item.name ?? null })
            .run();
          inserted += 1;
        } catch (err: unknown) {
          if (this.isUniqueViolation(err)) {
            skipped += 1;
            continue;
          }
          throw err;
        }
      }
    });
    if (inserted > 0) this.invalidate();
    return { inserted, skipped };
  }

  update(id: number, dto: UpdateHolidayDto): Holiday {
    const existing = this.db.select().from(holidays).where(eq(holidays.id, id)).get();
    if (!existing) throw new NotFoundException(`Holiday ${id} not found`);
    const patch: Partial<typeof holidays.$inferInsert> = {};
    if (dto.date !== undefined) patch.date = dto.date;
    if (dto.name !== undefined) patch.name = dto.name;
    if (Object.keys(patch).length === 0) return existing;
    try {
      const row = this.db.update(holidays).set(patch).where(eq(holidays.id, id)).returning().get();
      this.invalidate();
      return row;
    } catch (err: unknown) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException(`Another holiday already exists for that date`);
      }
      throw err;
    }
  }

  remove(id: number): void {
    const existing = this.db.select().from(holidays).where(eq(holidays.id, id)).get();
    if (!existing) throw new NotFoundException(`Holiday ${id} not found`);
    this.db.delete(holidays).where(eq(holidays.id, id)).run();
    this.invalidate();
  }

  /**
   * Returns a Set<YYYY-MM-DD> of every registered holiday date. Used by
   * business-day calculations to treat holidays the same as weekends.
   */
  getHolidaySet(): Set<string> {
    const now = Date.now();
    if (this.cache && this.cache.expires > now) return this.cache.set;
    const rows = this.db.select({ date: holidays.date }).from(holidays).all();
    const set = new Set<string>(rows.map((r) => r.date));
    this.cache = { set, expires: now + this.cacheTtlMs };
    return set;
  }

  private invalidate(): void {
    this.cache = null;
  }

  private isUniqueViolation(err: unknown): boolean {
    if (typeof err !== 'object' || err === null) return false;
    const msg = (err as { message?: string }).message ?? '';
    const code = (err as { code?: string }).code ?? '';
    return code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/i.test(msg);
  }
}
