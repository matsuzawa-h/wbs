import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { AppDb, assignees, Assignee } from '../db';
import { DB_TOKEN } from '../db/db.module';
import { CreateAssigneeDto } from './dto/create-assignee.dto';
import { UpdateAssigneeDto } from './dto/update-assignee.dto';

@Injectable()
export class AssigneesService {
  constructor(@Inject(DB_TOKEN) private readonly db: AppDb) {}

  list(): Assignee[] {
    return this.db.select().from(assignees).all();
  }

  findById(id: number): Assignee {
    const row = this.db.select().from(assignees).where(eq(assignees.id, id)).get();
    if (!row) throw new NotFoundException(`Assignee ${id} not found`);
    return row;
  }

  create(dto: CreateAssigneeDto): Assignee {
    return this.db
      .insert(assignees)
      .values({
        name: dto.name,
        isActive: dto.isActive === false ? 0 : 1,
      })
      .returning()
      .get();
  }

  update(id: number, dto: UpdateAssigneeDto): Assignee {
    this.findById(id);
    const patch: Partial<typeof assignees.$inferInsert> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.isActive !== undefined) patch.isActive = dto.isActive ? 1 : 0;
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
}
