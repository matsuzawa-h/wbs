import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '@/api/client';
import type { Organization, OrganizationInput } from '@/types';

export const useOrganizationsStore = defineStore('organizations', () => {
  const items = ref<Organization[]>([]);
  const loading = ref(false);
  const lastFetchedAt = ref(0);

  const activeItems = computed(() => items.value.filter((o) => o.isActive === 1));

  // フィルタ・選択用の既定並び＝コード昇順（NULL は末尾）。
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

  // id → org の参照表。一覧表示の組織名解決に使う。
  const byId = computed(() => {
    const m = new Map<number, Organization>();
    for (const o of items.value) m.set(o.id, o);
    return m;
  });

  /** id から `親 > 子` のパス表記を作る（最大 8 階層まで遡る）。 */
  function pathOf(id: number | null | undefined): string {
    if (id == null) return '';
    const seen = new Set<number>();
    const parts: string[] = [];
    let cur: number | null = id;
    let guard = 0;
    while (cur !== null && guard < 8) {
      if (seen.has(cur)) break;
      seen.add(cur);
      const o = byId.value.get(cur);
      if (!o) break;
      parts.unshift(o.name);
      cur = o.parentId;
      guard += 1;
    }
    return parts.join(' > ');
  }

  async function fetchAll(force = false): Promise<void> {
    if (!force && items.value.length > 0 && Date.now() - lastFetchedAt.value < 3000) return;
    loading.value = true;
    try {
      const res = await api.get<Organization[]>('/organizations');
      items.value = res.data;
      lastFetchedAt.value = Date.now();
    } finally {
      loading.value = false;
    }
  }

  async function create(input: OrganizationInput): Promise<Organization> {
    const res = await api.post<Organization>('/organizations', toBody(input));
    items.value = [...items.value, res.data].sort(sorter);
    return res.data;
  }

  async function update(id: number, input: Partial<OrganizationInput>): Promise<Organization> {
    const res = await api.patch<Organization>(`/organizations/${id}`, toBody(input));
    items.value = items.value.map((o) => (o.id === id ? res.data : o)).sort(sorter);
    return res.data;
  }

  async function remove(id: number): Promise<void> {
    await api.delete(`/organizations/${id}`);
    items.value = items.value.filter((o) => o.id !== id);
  }

  return {
    items,
    activeItems,
    byCodeAsc,
    byId,
    pathOf,
    loading,
    fetchAll,
    create,
    update,
    remove,
  };
});

function sorter(a: Organization, b: Organization): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  if (a.code && b.code) return a.code.localeCompare(b.code);
  return a.id - b.id;
}

// 空文字 → null（name 以外）。createBody/updateBody を一本化。
function toBody(input: Partial<OrganizationInput>): Record<string, unknown> {
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
