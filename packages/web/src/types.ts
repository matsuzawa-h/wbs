// 組織マスタ（自己参照階層）。`parentId` で任意深さの親子。表示用の組織名は
// organizations ストアの byId() から解決する（join せず単一ソースから引く）。
export interface Organization {
  id: number;
  code: string | null;
  name: string;
  parentId: number | null;
  isActive: number;
  sortOrder: number;
  note: string | null;
  createdAt: number;
}

export interface OrganizationInput {
  code?: string | null;
  name: string;
  parentId?: number | null;
  isActive?: boolean;
  sortOrder?: number;
  note?: string | null;
}

export interface Customer {
  id: number;
  code: string | null;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  isActive: number;
  note: string | null;
  sortOrder: number;
  organizationId: number | null;
  createdAt: number;
}

export interface CustomerInput {
  code?: string | null;
  name: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  address?: string | null;
  isActive?: boolean;
  note?: string | null;
  sortOrder?: number;
  organizationId?: number | null;
}

export interface Project {
  id: number;
  customerId: number | null;
  customerName: string | null;
  customerIsActive: number | null;
  organizationId: number | null;
  name: string;
  projectCode: string | null;
  isProvisional: number;
  createdAt: number;
}

export interface Employee {
  id: number;
  code: string | null;
  name: string;
  nameKana: string | null;
  department: string | null;
  role: string | null;
  email: string | null;
  employmentStart: string | null;
  employmentEnd: string | null;
  worksOnHolidays: number;
  isActive: number;
  note: string | null;
  sortOrder: number;
  organizationId: number | null;
}

// Legacy alias retained while call sites still reference "Assignee".
export type Assignee = Employee;

export interface EmployeeInput {
  code?: string | null;
  name: string;
  nameKana?: string | null;
  department?: string | null;
  role?: string | null;
  email?: string | null;
  employmentStart?: string | null;
  employmentEnd?: string | null;
  worksOnHolidays?: boolean;
  isActive?: boolean;
  note?: string | null;
  sortOrder?: number;
  organizationId?: number | null;
}

export interface Holiday {
  id: number;
  date: string; // YYYY-MM-DD
  name: string | null;
  createdAt: number;
}

// Cross-project task row used by the "担当別予定" page. Carries breadcrumb
// fields (project / 大項目 / 中項目 names) so the list is self-explanatory
// without a follow-up fetch.
export interface AssignmentRow {
  id: number;
  projectId: number;
  projectName: string;
  level: number;
  parentId: number | null;
  name: string;
  startDate: string | null;
  duration: number | null;
  endDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  plannedHours: number | null;
  actualHours: number | null;
  progress: number;
  assigneeId: number | null;
  status: string;
  note: string | null;
  parentName: string | null;
  grandparentName: string | null;
}

// Individual (personal) task — owned by an employee, optional project link,
// never shown in the project gantt / Excel export. Listed only in 担当別予定.
export interface PersonalTask {
  id: number;
  employeeId: number;
  projectId: number | null;
  projectName: string | null;
  name: string;
  startDate: string | null;
  duration: number | null;
  endDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  plannedHours: number | null;
  actualHours: number | null;
  progress: number;
  note: string | null;
  sortOrder: number;
  createdAt: number;
}

// ---- 月次工数管理 / 稼働見通し --------------------------------------------

export interface ManhourBatch {
  id: number;
  fileName: string;
  fiscalYear: number;
  orgCode: string | null;
  organizationId: number | null;
  rowCount: number;
  importedAt: number;
}

export interface SummaryProjectBreak {
  projectId: number | null;
  projectName: string;
  isProvisional: boolean;
  source: 'imported' | 'manual';
  workType: string;
  hours: number;
}

export interface SummaryCell {
  imported: number;
  manual: number;
  total: number;
  base: number | null;
  utilization: number | null;
  byProject: SummaryProjectBreak[];
}

export interface SummaryRow {
  assigneeId: number;
  assigneeName: string;
  cells: Record<string, SummaryCell>;
  totalHours: number;
}

export interface CapacitySummary {
  fiscalYear: number | null;
  batchId: number | null;
  months: string[];
  rows: SummaryRow[];
}

export interface MatrixCell {
  imported: number;
  manual: number;
  total: number;
}

export interface MatrixRow {
  assigneeId: number;
  assigneeName: string;
  cells: Record<string, MatrixCell>;
  total: number;
}

export interface ProjectMatrix {
  projectId: number;
  projectName: string;
  projectCode: string | null;
  isProvisional: boolean;
  batchId: number | null;
  months: string[];
  rows: MatrixRow[];
  monthTotals: Record<string, number>;
  grandTotal: number;
}

export interface AssigneeDetailRow {
  workType: string;
  customerName: string | null;
  subject: string;
  projectCode: string | null;
  projectId: number | null;
  source: 'imported' | 'manual';
  cells: Record<string, number>;
  total: number;
}

export interface AssigneeDetail {
  assigneeId: number;
  assigneeName: string;
  fiscalYear: number | null;
  batchId: number | null;
  months: string[];
  rows: AssigneeDetailRow[];
}

export interface ManualEntryInput {
  assigneeId: number;
  projectId?: number | null;
  workType?: string;
  yearMonth: string;
  hours: number;
}

export interface WbsTask {
  id: number;
  projectId: number;
  level: number;
  parentId: number | null;
  name: string;
  startDate: string | null;
  duration: number | null;
  endDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  plannedHours: number | null;
  actualHours: number | null;
  progress: number;
  assigneeId: number | null;
  status: string;
  note: string | null;
  sortOrder: number;
}
