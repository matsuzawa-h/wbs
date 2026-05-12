import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '@/api/client';
import type { Customer, CustomerInput } from '@/types';

export const useCustomersStore = defineStore('customers', () => {
  const items = ref<Customer[]>([]);
  const loading = ref(false);
  const lastFetchedAt = ref(0);

  const activeItems = computed(() => items.value.filter((c) => c.isActive === 1));

  async function fetchAll(force = false): Promise<void> {
    if (!force && items.value.length > 0 && Date.now() - lastFetchedAt.value < 3000) return;
    loading.value = true;
    try {
      const res = await api.get<Customer[]>('/customers');
      items.value = res.data;
      lastFetchedAt.value = Date.now();
    } finally {
      loading.value = false;
    }
  }

  async function create(input: CustomerInput): Promise<Customer> {
    const res = await api.post<Customer>('/customers', toBody(input));
    items.value = [...items.value, res.data].sort(sorter);
    return res.data;
  }

  async function update(id: number, input: Partial<CustomerInput>): Promise<Customer> {
    const res = await api.patch<Customer>(`/customers/${id}`, toBody(input));
    items.value = items.value.map((c) => (c.id === id ? res.data : c)).sort(sorter);
    return res.data;
  }

  async function remove(id: number): Promise<void> {
    await api.delete(`/customers/${id}`);
    items.value = items.value.filter((c) => c.id !== id);
  }

  return { items, activeItems, loading, fetchAll, create, update, remove };
});

function sorter(a: Customer, b: Customer): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  if (a.code && b.code) return a.code.localeCompare(b.code);
  return a.id - b.id;
}

function toBody(input: Partial<CustomerInput>): Record<string, unknown> {
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
