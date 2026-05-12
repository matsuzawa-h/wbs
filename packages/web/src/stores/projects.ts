import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '@/api/client';
import type { Project } from '@/types';

export const useProjectsStore = defineStore('projects', () => {
  const items = ref<Project[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchAll(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const res = await api.get<Project[]>('/projects');
      items.value = res.data;
    } catch (e: any) {
      error.value = e?.message ?? 'failed to load projects';
    } finally {
      loading.value = false;
    }
  }

  async function create(name: string): Promise<Project> {
    const res = await api.post<Project>('/projects', { name });
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

  return { items, loading, error, fetchAll, create, remove, rename };
});
