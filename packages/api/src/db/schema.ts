import { sql } from 'drizzle-orm';
import { integer, real, sqliteTable, text, index, primaryKey } from 'drizzle-orm/sqlite-core';

export const customers = sqliteTable(
  'customers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    code: text('code'),
    name: text('name').notNull(),
    contactName: text('contact_name'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    address: text('address'),
    isActive: integer('is_active').notNull().default(1),
    note: text('note'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    sortIdx: index('idx_customers_sort').on(table.sortOrder),
  }),
);

export const projects = sqliteTable(
  'projects',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    customerId: integer('customer_id').references(() => customers.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    customerIdx: index('idx_projects_customer').on(table.customerId),
  }),
);

// Employee master. Table name remains `assignees` so the existing
// wbs_tasks.assignee_id FK continues to work.
export const assignees = sqliteTable(
  'assignees',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    code: text('code'),
    name: text('name').notNull(),
    nameKana: text('name_kana'),
    department: text('department'),
    role: text('role'),
    email: text('email'),
    employmentStart: text('employment_start'),
    employmentEnd: text('employment_end'),
    worksOnHolidays: integer('works_on_holidays').notNull().default(0),
    isActive: integer('is_active').notNull().default(1),
    note: text('note'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => ({
    codeIdx: index('idx_assignees_code').on(table.code),
    sortIdx: index('idx_assignees_sort').on(table.sortOrder),
  }),
);

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
    actualStartDate: text('actual_start_date'),
    actualEndDate: text('actual_end_date'),
    plannedHours: real('planned_hours'),
    actualHours: real('actual_hours'),
    progress: integer('progress').notNull().default(0),
    assigneeId: integer('assignee_id').references(() => assignees.id, {
      onDelete: 'set null',
    }),
    status: text('status').notNull().default(''),
    note: text('note'),
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

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;

export type Assignee = typeof assignees.$inferSelect;
export type NewAssignee = typeof assignees.$inferInsert;
export type Employee = Assignee;
export type NewEmployee = NewAssignee;

export type WbsTask = typeof wbsTasks.$inferSelect;
export type NewWbsTask = typeof wbsTasks.$inferInsert;

export const holidays = sqliteTable(
  'holidays',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    date: text('date').notNull().unique(),
    name: text('name'),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    dateIdx: index('idx_holidays_date').on(table.date),
  }),
);

export type Holiday = typeof holidays.$inferSelect;
export type NewHoliday = typeof holidays.$inferInsert;

// Which employees should appear in each project's picker. Tasks already
// assigned to a now-removed member keep their assignee_id (soft removal);
// the UI shows them tagged "(メンバー外)" and disables new assignments.
export const projectMembers = sqliteTable(
  'project_members',
  {
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    employeeId: integer('employee_id')
      .notNull()
      .references(() => assignees.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.projectId, table.employeeId] }),
    projectIdx: index('idx_project_members_project').on(table.projectId),
  }),
);

export type ProjectMember = typeof projectMembers.$inferSelect;
export type NewProjectMember = typeof projectMembers.$inferInsert;

// Personal (individual) tasks. Owned by an employee, optionally linked to a
// project for reporting context, but intentionally NOT part of the WBS tree
// — they never appear in the project gantt or the Excel export. Only the
// "担当別予定" view lists them alongside the employee's WBS assignments.
export const personalTasks = sqliteTable(
  'personal_tasks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    employeeId: integer('employee_id')
      .notNull()
      .references(() => assignees.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull().default(''),
    startDate: text('start_date'),
    duration: integer('duration'),
    endDate: text('end_date'),
    actualStartDate: text('actual_start_date'),
    actualEndDate: text('actual_end_date'),
    plannedHours: real('planned_hours'),
    actualHours: real('actual_hours'),
    progress: integer('progress').notNull().default(0),
    note: text('note'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    employeeIdx: index('idx_personal_tasks_employee').on(table.employeeId),
    projectIdx: index('idx_personal_tasks_project').on(table.projectId),
  }),
);

export type PersonalTask = typeof personalTasks.$inferSelect;
export type NewPersonalTask = typeof personalTasks.$inferInsert;
