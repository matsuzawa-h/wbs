import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '@/api/client';
import type { Project, ProjectDashboard, ProjectStatus } from '@/types';

export const useProjectsStore = defineStore('projects', () => {
  const items = ref<Project[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchAll(
    opts: { memberEmployeeId?: number | null } = {},
  ): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const params: Record<string, unknown> = {};
      if (opts.memberEmployeeId !== undefined && opts.memberEmployeeId !== null) {
        params.memberEmployeeId = opts.memberEmployeeId;
      }
      const res = await api.get<Project[]>('/projects', { params });
      items.value = res.data;
    } catch (e: any) {
      error.value = e?.message ?? 'failed to load projects';
    } finally {
      loading.value = false;
    }
  }

  async function create(
    name: string,
    customerId: number | null = null,
    organizationId: number | null = null,
  ): Promise<Project> {
    const res = await api.post<Project>('/projects', { name, customerId, organizationId });
    items.value = [...items.value, res.data];
    return res.data;
  }

  async function remove(id: number): Promise<void> {
    await api.delete(`/projects/${id}`);
    items.value = items.value.filter((p) => p.id !== id);
  }

  async function rename(id: number, name: string): Promise<Project> {
    const res = await api.patch<Project>(`/projects/${id}`, { name });
    items.value = items.value.map((p) => (p.id === id ? res.data : p));
    return res.data;
  }

  async function setCustomer(id: number, customerId: number | null): Promise<Project> {
    const res = await api.patch<Project>(`/projects/${id}`, { customerId });
    items.value = items.value.map((p) => (p.id === id ? res.data : p));
    return res.data;
  }

  async function setOrganization(id: number, organizationId: number | null): Promise<Project> {
    const res = await api.patch<Project>(`/projects/${id}`, { organizationId });
    items.value = items.value.map((p) => (p.id === id ? res.data : p));
    return res.data;
  }

  async function fetchById(id: number): Promise<Project> {
    const res = await api.get<Project>(`/projects/${id}`);
    items.value = items.value.some((p) => p.id === id)
      ? items.value.map((p) => (p.id === id ? res.data : p))
      : [...items.value, res.data];
    return res.data;
  }

  async function updateOverview(
    id: number,
    payload: { description?: string | null; status?: ProjectStatus },
  ): Promise<Project> {
    const res = await api.patch<Project>(`/projects/${id}`, payload);
    items.value = items.value.map((p) => (p.id === id ? res.data : p));
    return res.data;
  }

  async function fetchDashboard(id: number): Promise<ProjectDashboard> {
    const res = await api.get<ProjectDashboard>(`/projects/${id}/dashboard`);
    return res.data;
  }

  return {
    items,
    loading,
    error,
    fetchAll,
    create,
    remove,
    rename,
    setCustomer,
    setOrganization,
    fetchById,
    updateOverview,
    fetchDashboard,
  };
});
