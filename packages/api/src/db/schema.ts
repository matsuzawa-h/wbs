import { sql } from 'drizzle-orm';
import {
  integer,
  real,
  sqliteTable,
  text,
  index,
  primaryKey,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/sqlite-core';

// 組織マスタ（部門/部/課 等）。任意深さの自己参照階層。プロジェクト・
// 担当者・顧客はそれぞれ単一の組織に属し（nullable）、稼働管理表 CSV
// 取込時は組織コードから自動解決して取込元組織に新規エンティティを紐付ける。
export const organizations = sqliteTable(
  'organizations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    code: text('code'),
    name: text('name').notNull(),
    // 親組織（自己参照）。任意深さ。親削除時は子は NULL（=ルート化）。
    // 自己参照はテーブル customizer の foreignKey で定義（TS の循環参照回避）。
    parentId: integer('parent_id'),
    isActive: integer('is_active').notNull().default(1),
    sortOrder: integer('sort_order').notNull().default(0),
    note: text('note'),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    sortIdx: index('idx_organizations_sort').on(table.sortOrder),
    parentIdx: index('idx_organizations_parent').on(table.parentId),
    parentFk: foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: 'fk_organizations_parent',
    }).onDelete('set null'),
  }),
);

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

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
    organizationId: integer('organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    sortIdx: index('idx_customers_sort').on(table.sortOrder),
    organizationIdx: index('idx_customers_organization').on(table.organizationId),
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
    // External project code (別システムの「プロジェクトCD」). Used to match
    // imported man-hour rows to a project. Deliberately NOT unique: the same
    // CD legitimately spans multiple 件名 / provisional rows.
    projectCode: text('project_code'),
    // 1 = 仮プロジェクト (auto-created from a man-hour import that matched no
    // existing project, or hand-entered for capacity planning). The WBS side
    // treats it like any project; only the 稼働見通し screen separates 確定/仮.
    isProvisional: integer('is_provisional').notNull().default(0),
    organizationId: integer('organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    customerIdx: index('idx_projects_customer').on(table.customerId),
    codeIdx: index('idx_projects_code').on(table.projectCode),
    organizationIdx: index('idx_projects_organization').on(table.organizationId),
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
    organizationId: integer('organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
  },
  (table) => ({
    codeIdx: index('idx_assignees_code').on(table.code),
    sortIdx: index('idx_assignees_sort').on(table.sortOrder),
    organizationIdx: index('idx_assignees_organization').on(table.organizationId),
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

// 1 プロジェクトに複数のプロジェクトCD（外部システムは工程ごとにCDが分かれる）。
// 稼働取込はこのコードで案件→プロジェクトを突合する。code はグローバル一意
// （1つのCDは必ず1プロジェクトに属する）。projects.project_code は代表コード
// （表示用）として併存。
export const projectCodes = sqliteTable(
  'project_codes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    codeIdx: uniqueIndex('uniq_project_codes_code').on(table.code),
    projectIdx: index('idx_project_codes_project').on(table.projectId),
  }),
);

export type ProjectCode = typeof projectCodes.$inferSelect;
export type NewProjectCode = typeof projectCodes.$inferInsert;

// ---------------------------------------------------------------------------
// 月次工数管理 / 稼働見通し (monthly man-hours & capacity planning).
//
// Imported periodically from an external "稼働管理表（明細）" CSV. Each import
// is a snapshot batch (履歴保持) — re-importing never mutates older batches.
// Manual provisional entries use batch_id = NULL / source = 'manual' so they
// survive re-imports. These tables are independent of the WBS tree.
// ---------------------------------------------------------------------------

export const manhourImportBatches = sqliteTable(
  'manhour_import_batches',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    fileName: text('file_name').notNull(),
    fiscalYear: integer('fiscal_year').notNull(),
    orgCode: text('org_code'),
    rowCount: integer('row_count').notNull().default(0),
    importedAt: integer('imported_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    fyIdx: index('idx_mh_batches_fy').on(table.fiscalYear),
  }),
);

export const manhourEntries = sqliteTable(
  'manhour_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    // NULL = manual entry (not tied to any import snapshot).
    batchId: integer('batch_id').references(() => manhourImportBatches.id, {
      onDelete: 'cascade',
    }),
    source: text('source').notNull().default('imported'),
    assigneeId: integer('assignee_id')
      .notNull()
      .references(() => assignees.id, { onDelete: 'cascade' }),
    // NULL for zz (非稼働: 休暇/会議/事務) rows that have no project.
    projectId: integer('project_id').references(() => projects.id, {
      onDelete: 'cascade',
    }),
    workType: text('work_type').notNull().default(''),
    yearMonth: text('year_month').notNull(),
    hours: real('hours').notNull().default(0),
    // project_id が NULL の明細（CD無しのフリー作業 / zz 非稼働）の件名。
    // 稼働見通しの内訳表示に使う。projects マスタは作らずラベルだけ保持。
    label: text('label'),
    // CSV「顧客名」(E列) の生値。MNT 等の非プロジェクト行でも顧客名を
    // 担当者別明細に出すため、顧客マスタに依存せず明細に保持する。
    customerLabel: text('customer_label'),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    batchIdx: index('idx_mh_entries_batch').on(table.batchId),
    ymIdx: index('idx_mh_entries_ym').on(table.yearMonth),
    assigneeIdx: index('idx_mh_entries_assignee').on(table.assigneeId),
    projectIdx: index('idx_mh_entries_project').on(table.projectId),
  }),
);

// Per-assignee monthly capacity (CSV 合計 内「月基準時間」). 稼働率 is always
// recomputed as Σhours / base_hours — the CSV 稼働率 row is never imported.
export const manhourCapacities = sqliteTable(
  'manhour_capacities',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    batchId: integer('batch_id').references(() => manhourImportBatches.id, {
      onDelete: 'cascade',
    }),
    source: text('source').notNull().default('imported'),
    assigneeId: integer('assignee_id')
      .notNull()
      .references(() => assignees.id, { onDelete: 'cascade' }),
    yearMonth: text('year_month').notNull(),
    baseHours: real('base_hours').notNull(),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    batchIdx: index('idx_mh_capacities_batch').on(table.batchId),
    keyIdx: index('idx_mh_capacities_key').on(
      table.assigneeId,
      table.yearMonth,
    ),
  }),
);

export type ManhourImportBatch = typeof manhourImportBatches.$inferSelect;
export type NewManhourImportBatch = typeof manhourImportBatches.$inferInsert;
export type ManhourEntry = typeof manhourEntries.$inferSelect;
export type NewManhourEntry = typeof manhourEntries.$inferInsert;
export type ManhourCapacity = typeof manhourCapacities.$inferSelect;
export type NewManhourCapacity = typeof manhourCapacities.$inferInsert;
