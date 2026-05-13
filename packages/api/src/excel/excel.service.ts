import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { AppDb, assignees, projects, wbsTasks } from '../db';
import { DB_TOKEN } from '../db/db.module';
import { applyCellUpdates } from './biff-writer';
import { buildWbsCellUpdates, WbsExportTask } from './wbs-mapper';

@Injectable()
export class ExcelService {
  constructor(@Inject(DB_TOKEN) private readonly db: AppDb) {}

  exportProject(projectId: number): Buffer {
    const project = this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .get();
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    const tasks = this.loadTasks(projectId);
    let updates;
    try {
      updates = buildWbsCellUpdates(tasks);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const template = readFileSync(this.templatePath());
    return applyCellUpdates(template, updates);
  }

  private loadTasks(projectId: number): WbsExportTask[] {
    return this.db
      .select({
        id: wbsTasks.id,
        level: wbsTasks.level,
        parentId: wbsTasks.parentId,
        name: wbsTasks.name,
        startDate: wbsTasks.startDate,
        duration: wbsTasks.duration,
        endDate: wbsTasks.endDate,
        actualStartDate: wbsTasks.actualStartDate,
        actualEndDate: wbsTasks.actualEndDate,
        plannedHours: wbsTasks.plannedHours,
        actualHours: wbsTasks.actualHours,
        progress: wbsTasks.progress,
        assigneeName: assignees.name,
        status: wbsTasks.status,
        sortOrder: wbsTasks.sortOrder,
      })
      .from(wbsTasks)
      .leftJoin(assignees, eq(wbsTasks.assigneeId, assignees.id))
      .where(eq(wbsTasks.projectId, projectId))
      .orderBy(asc(wbsTasks.sortOrder), asc(wbsTasks.id))
      .all();
  }

  private templatePath(): string {
    const candidates = [
      process.env.XLS_TEMPLATE_PATH,
      resolve(process.cwd(), 'テンプレートファイル.xls'),
      resolve(process.cwd(), '..', 'テンプレートファイル.xls'),
      resolve(process.cwd(), '..', '..', 'テンプレートファイル.xls'),
      resolve(process.cwd(), '..', '..', '..', 'テンプレートファイル.xls'),
      resolve(__dirname, '..', '..', '..', '..', '..', 'テンプレートファイル.xls'),
    ].filter((value): value is string => Boolean(value));

    const found = candidates.find((candidate) => existsSync(candidate));
    if (!found) {
      throw new Error(`Template file not found. Tried: ${candidates.join(', ')}`);
    }
    return found;
  }
}
