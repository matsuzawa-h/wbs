import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '@/api/client';
import type { Employee, EmployeeInput } from '@/types';

export const useEmployeesStore = defineStore('employees', () => {
  const items = ref<Employee[]>([]);
  const loading = ref(false);
  const lastFetchedAt = ref(0);

  const activeItems = computed(() => items.value.filter((e) => e.isActive === 1));
  // 稼働見通し関連で社員を出すときの既定並び＝コード昇順（NULL/空は末尾）。
  const byCodeAsc = computed(() =>
    [...activeItems.value].sort((a, b) => {
      const ae = !a.code;
      const be = !b.code;
      if (ae && be) return a.id - b.id;
      if (ae) return 1;
      if (be) return -1;
      return a.code!.localeCompare(b.code!, 'en', { numeric: true });
    }),
  );

  async function fetchAll(force = false): Promise<void> {
    if (!force && items.value.length > 0 && Date.now() - lastFetchedAt.value < 3000) return;
    loading.value = true;
    try {
      const res = await api.get<Employee[]>('/employees');
      items.value = res.data;
      lastFetchedAt.value = Date.now();
    } finally {
      loading.value = false;
    }
  }

  async function create(input: EmployeeInput): Promise<Employee> {
    const res = await api.post<Employee>('/employees', toBody(input));
    items.value = [...items.value, res.data].sort(sorter);
    return res.data;
  }

  async function update(id: number, input: Partial<EmployeeInput>): Promise<Employee> {
    const res = await api.patch<Employee>(`/employees/${id}`, toBody(input));
    items.value = items.value.map((e) => (e.id === id ? res.data : e)).sort(sorter);
    return res.data;
  }

  async function remove(id: number): Promise<void> {
    await api.delete(`/employees/${id}`);
    items.value = items.value.filter((e) => e.id !== id);
  }

  return { items, activeItems, byCodeAsc, loading, fetchAll, create, update, remove };
});

function sorter(a: Employee, b: Employee): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  if (a.code && b.code) return a.code.localeCompare(b.code);
  return a.id - b.id;
}

// Trims empty strings to null so the API doesn't store blanks alongside nulls.
function toBody(input: Partial<EmployeeInput>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '' && k !== 'name') {
      out[k] = null;
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Backwards-compatible alias for existing call sites.
export const useAssigneesStore = useEmployeesStore;
