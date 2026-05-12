import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '@/api/client';
import type { Assignee } from '@/types';

export const useAssigneesStore = defineStore('assignees', () => {
  const items = ref<Assignee[]>([]);
  const loading = ref(false);

  async function fetchAll(): Promise<void> {
    loading.value = true;
    try {
      const res = await api.get<Assignee[]>('/assignees');
      items.value = res.data;
    } finally {
      loading.value = false;
    }
  }

  async function create(name: string): Promise<Assignee> {
    const res = await api.post<Assignee>('/assignees', { name });
    items.value = [...items.value, res.data];
    return res.data;
  }

  return { items, loading, fetchAll, create };
});
