import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '@/api/client';
import type { WbsTask } from '@/types';

export interface CreateTaskInput {
  level: 1 | 2 | 3;
  parentId?: number | null;
  name: string;
  startDate?: string;
  duration?: number;
  actualStartDate?: string | null;
  actualEndDate?: string | null;
  plannedHours?: number | null;
  actualHours?: number | null;
  assigneeId?: number | null;
  status?: string;
  sortOrder?: number;
}

export interface UpdateTaskInput {
  name?: string;
  startDate?: string;
  duration?: number;
  actualStartDate?: string | null;
  actualEndDate?: string | null;
  plannedHours?: number | null;
  actualHours?: number | null;
  progress?: number;
  assigneeId?: number | null;
  status?: string;
}

export const useTasksStore = defineStore('tasks', () => {
  const items = ref<WbsTask[]>([]);
  const projectId = ref<number | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const sorted = computed(() =>
    [...items.value].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
  );

  async function fetchByProject(id: number): Promise<void> {
    projectId.value = id;
    loading.value = true;
    error.value = null;
    try {
      const res = await api.get<WbsTask[]>(`/projects/${id}/tasks`);
      items.value = res.data;
    } catch (e: any) {
      error.value = e?.message ?? 'failed to load tasks';
    } finally {
      loading.value = false;
    }
  }

  async function create(input: CreateTaskInput): Promise<WbsTask> {
    if (projectId.value === null) throw new Error('projectId not set');
    const res = await api.post<WbsTask>(
      `/projects/${projectId.value}/tasks`,
      input,
    );
    await refresh();
    return res.data;
  }

  async function update(id: number, patch: UpdateTaskInput): Promise<WbsTask> {
    const res = await api.patch<WbsTask>(`/tasks/${id}`, patch);
    await refresh();
    return res.data;
  }

  async function remove(id: number): Promise<void> {
    await api.delete(`/tasks/${id}`);
    await refresh();
  }

  async function reorder(reorderItems: Array<{ id: number; sortOrder: number }>): Promise<void> {
    await api.put('/tasks/reorder', { items: reorderItems });
    await refresh();
  }

  async function refresh(): Promise<void> {
    if (projectId.value !== null) {
      await fetchByProject(projectId.value);
    }
  }

  return {
    items,
    sorted,
    projectId,
    loading,
    error,
    fetchByProject,
    create,
    update,
    remove,
    reorder,
    refresh,
  };
});
