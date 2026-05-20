import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { AppDb, organizations, Organization } from '../db';
import { DB_TOKEN } from '../db/db.module';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

@Injectable()
export class OrganizationsService {
  constructor(@Inject(DB_TOKEN) private readonly db: AppDb) {}

  list(): Organization[] {
    return this.db
      .select()
      .from(organizations)
      .orderBy(
        asc(organizations.sortOrder),
        asc(organizations.code),
        asc(organizations.id),
      )
      .all();
  }

  findById(id: number): Organization {
    const row = this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, id))
      .get();
    if (!row) throw new NotFoundException(`Organization ${id} not found`);
    return row;
  }

  create(dto: CreateOrganizationDto): Organization {
    const code = dto.code?.trim() || this.nextCode();
    this.assertCodeUnique(code, null);
    const parentId = dto.parentId ?? null;
    if (parentId !== null) this.assertParentExists(parentId);
    return this.db
      .insert(organizations)
      .values({
        code,
        name: dto.name,
        parentId,
        isActive: dto.isActive === false ? 0 : 1,
        sortOrder: dto.sortOrder ?? 0,
        note: dto.note ?? null,
      })
      .returning()
      .get();
  }

  update(id: number, dto: UpdateOrganizationDto): Organization {
    this.findById(id);
    const patch: Partial<typeof organizations.$inferInsert> = {};
    if (dto.code !== undefined) {
      const code = dto.code.trim() || null;
      if (code) this.assertCodeUnique(code, id);
      patch.code = code;
    }
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.parentId !== undefined) {
      if (dto.parentId === null) {
        patch.parentId = null;
      } else {
        if (dto.parentId === id)
          throw new ConflictException('組織の親に自分自身は指定できません');
        this.assertParentExists(dto.parentId);
        this.assertNotCyclic(id, dto.parentId);
        patch.parentId = dto.parentId;
      }
    }
    if (dto.isActive !== undefined) patch.isActive = dto.isActive ? 1 : 0;
    if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;
    if (dto.note !== undefined) patch.note = dto.note || null;
    return this.db
      .update(organizations)
      .set(patch)
      .where(eq(organizations.id, id))
      .returning()
      .get();
  }

  remove(id: number): void {
    this.findById(id);
    this.db.delete(organizations).where(eq(organizations.id, id)).run();
  }

  /** code が指定組織以外で既に使われていないか確認。 */
  private assertCodeUnique(code: string, excludeId: number | null): void {
    const existing = this.db
      .select()
      .from(organizations)
      .where(eq(organizations.code, code))
      .get();
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`組織コード "${code}" は既に登録されています`);
    }
  }

  private assertParentExists(parentId: number): void {
    const row = this.db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, parentId))
      .get();
    if (!row) throw new NotFoundException(`Parent organization ${parentId} not found`);
  }

  /** newParentId の祖先チェーンに自分自身(selfId)が現れたら循環。 */
  private assertNotCyclic(selfId: number, newParentId: number): void {
    let cur: number | null = newParentId;
    const seen = new Set<number>();
    while (cur !== null) {
      if (cur === selfId)
        throw new BadRequestException('組織の親子関係が循環します');
      if (seen.has(cur)) return; // 既存に既に循環があってもループはここで止める
      seen.add(cur);
      const row: { parentId: number | null } | undefined = this.db
        .select({ parentId: organizations.parentId })
        .from(organizations)
        .where(eq(organizations.id, cur))
        .get();
      cur = row?.parentId ?? null;
    }
  }

  /** O### 連番（既存最大値の次）。 */
  private nextCode(): string {
    const rows = this.db
      .select({ code: organizations.code })
      .from(organizations)
      .all();
    let max = 0;
    for (const r of rows) {
      const m = r.code?.match(/^O(\d{3,})$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
    return `O${String(max + 1).padStart(3, '0')}`;
  }
}
