import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '@/api/client';
import type { Holiday } from '@/types';

export const useHolidaysStore = defineStore('holidays', () => {
  const items = ref<Holiday[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let loadedOnce = false;

  /** Set of YYYY-MM-DD strings for fast membership checks. */
  const dateSet = computed<Set<string>>(() => new Set(items.value.map((h) => h.date)));
  /** Map keyed by date for quick name lookup. */
  const dateNameMap = computed<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const h of items.value) {
      if (h.name) m.set(h.date, h.name);
    }
    return m;
  });

  async function fetchAll(force = false): Promise<void> {
    if (loadedOnce && !force) return;
    loading.value = true;
    error.value = null;
    try {
      const res = await api.get<Holiday[]>('/holidays');
      items.value = res.data.sort((a, b) => a.date.localeCompare(b.date));
      loadedOnce = true;
    } catch (e: unknown) {
      error.value = (e as { message?: string })?.message ?? 'failed to load holidays';
    } finally {
      loading.value = false;
    }
  }

  async function add(date: string, name?: string | null): Promise<Holiday> {
    const res = await api.post<Holiday>('/holidays', { date, name: name ?? undefined });
    items.value = [...items.value, res.data].sort((a, b) => a.date.localeCompare(b.date));
    return res.data;
  }

  async function bulkAdd(
    holidays: Array<{ date: string; name?: string | null }>,
  ): Promise<{ inserted: number; skipped: number }> {
    const res = await api.post<{ inserted: number; skipped: number }>('/holidays/bulk', {
      items: holidays,
    });
    await fetchAll(true);
    return res.data;
  }

  async function update(id: number, patch: { date?: string; name?: string | null }): Promise<Holiday> {
    const res = await api.patch<Holiday>(`/holidays/${id}`, patch);
    items.value = items.value
      .map((h) => (h.id === id ? res.data : h))
      .sort((a, b) => a.date.localeCompare(b.date));
    return res.data;
  }

  async function remove(id: number): Promise<void> {
    await api.delete(`/holidays/${id}`);
    items.value = items.value.filter((h) => h.id !== id);
  }

  return {
    items,
    loading,
    error,
    dateSet,
    dateNameMap,
    fetchAll,
    add,
    bulkAdd,
    update,
    remove,
  };
});
