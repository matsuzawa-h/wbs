export interface Project {
  id: number;
  name: string;
  createdAt: number;
}

export interface Assignee {
  id: number;
  name: string;
  isActive: number;
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
