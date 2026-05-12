export interface Project {
  id: number;
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
  sortOrder: number;
}
