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
}

export interface Project {
  id: number;
  customerId: number | null;
  customerName: string | null;
  customerIsActive: number | null;
  name: string;
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
