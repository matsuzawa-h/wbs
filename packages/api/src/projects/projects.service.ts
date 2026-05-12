import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { AppDb, projects, Project } from '../db';
import { DB_TOKEN } from '../db/db.module';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectsService {
  constructor(@Inject(DB_TOKEN) private readonly db: AppDb) {}

  list(): Project[] {
    return this.db.select().from(projects).all();
  }

  findById(id: number): Project {
    const row = this.db.select().from(projects).where(eq(projects.id, id)).get();
    if (!row) {
      throw new NotFoundException(`Project ${id} not found`);
    }
    return row;
  }

  create(dto: CreateProjectDto): Project {
    const inserted = this.db
      .insert(projects)
      .values({ name: dto.name })
      .returning()
      .get();
    return inserted;
  }

  update(id: number, dto: UpdateProjectDto): Project {
    this.findById(id);
    const updated = this.db
      .update(projects)
      .set({ ...dto })
      .where(eq(projects.id, id))
      .returning()
      .get();
    return updated;
  }

  remove(id: number): void {
    this.findById(id);
    this.db.delete(projects).where(eq(projects.id, id)).run();
  }
}
