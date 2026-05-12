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

export interface WbsTask {
  id: number;
  projectId: number;
  level: number;
  parentId: number | null;
  name: string;
  startDate: string | null;
  duration: number | null;
  endDate: string | null;
  progress: number;
  assigneeId: number | null;
  status: string;
  sortOrder: number;
}
