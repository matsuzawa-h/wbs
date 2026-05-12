import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, index } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  createdAt: integer('created_at')
    .notNull()
    .default(sql`(unixepoch())`),
});

export const assignees = sqliteTable('assignees', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  isActive: integer('is_active').notNull().default(1),
});

export const wbsTasks = sqliteTable(
  'wbs_tasks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    level: integer('level').notNull(),
    parentId: integer('parent_id'),
    name: text('name').notNull(),
    startDate: text('start_date'),
    duration: integer('duration'),
    endDate: text('end_date'),
    progress: integer('progress').notNull().default(0),
    assigneeId: integer('assignee_id').references(() => assignees.id, {
      onDelete: 'set null',
    }),
    status: text('status').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => ({
    projectIdx: index('idx_wbs_tasks_project').on(table.projectId),
    parentIdx: index('idx_wbs_tasks_parent').on(table.parentId),
    sortIdx: index('idx_wbs_tasks_sort').on(table.projectId, table.sortOrder),
  }),
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export type Assignee = typeof assignees.$inferSelect;
export type NewAssignee = typeof assignees.$inferInsert;

export type WbsTask = typeof wbsTasks.$inferSelect;
export type NewWbsTask = typeof wbsTasks.$inferInsert;
