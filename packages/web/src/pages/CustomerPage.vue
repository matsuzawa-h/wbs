<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useCustomersStore } from '@/stores/customers';
import { useOrganizationsStore } from '@/stores/organizations';
import { useEmployeesStore } from '@/stores/employees';
import { useCurrentUserStore } from '@/stores/currentUser';
import CustomerEditDialog from '@/components/CustomerEditDialog.vue';
import type { Customer, CustomerInput } from '@/types';

const customers = useCustomersStore();
const orgs = useOrganizationsStore();
const employees = useEmployeesStore();
const currentUser = useCurrentUserStore();

const showActiveOnly = ref(true);
const searchText = ref('');
// 組織で絞込み。'all' / 'none' / 組織ID。
const orgFilter = ref<'all' | 'none' | number>('all');
const dialogOpen = ref(false);
const editing = ref<Customer | null>(null);
const statusMessage = ref<string | null>(null);
const errorMessage = ref<string | null>(null);
const dialogRef = ref<InstanceType<typeof CustomerEditDialog> | null>(null);

onMounted(async () => {
  await Promise.all([customers.fetchAll(true), orgs.fetchAll(), employees.fetchAll()]);
  // 初期表示はログイン中の社員の所属組織で絞り込み（あれば）。
  const myOrg = currentUser.current?.organizationId ?? null;
  if (orgFilter.value === 'all' && myOrg !== null && orgs.byCodeAsc.some((o) => o.id === myOrg)) {
    orgFilter.value = myOrg;
  }
});

const visible = computed(() => {
  const q = searchText.value.trim().toLowerCase();
  return customers.items.filter((c) => {
    if (showActiveOnly.value && c.isActive !== 1) return false;
    if (orgFilter.value === 'none' && c.organizationId !== null) return false;
    if (typeof orgFilter.value === 'number' && c.organizationId !== orgFilter.value) return false;
    if (!q) return true;
    return (
      (c.code ?? '').toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      (c.contactName ?? '').toLowerCase().includes(q)
    );
  });
});

function openCreate(): void {
  editing.value = null;
  dialogOpen.value = true;
}

function openEdit(c: Customer): void {
  editing.value = c;
  dialogOpen.value = true;
}

async function onSubmit(input: CustomerInput): Promise<void> {
  errorMessage.value = null;
  try {
    if (editing.value) {
      await customers.update(editing.value.id, input);
      flash('顧客情報を更新しました');
    } else {
      await customers.create(input);
      flash('顧客を追加しました');
    }
    dialogOpen.value = false;
  } catch (e: unknown) {
    const msg = extractMessage(e) ?? '保存に失敗しました';
    dialogRef.value?.reportError(msg);
  }
}

async function onDelete(c: Customer): Promise<void> {
  if (!confirm(`「${c.name}」を削除します。よろしいですか？\n（紐づくプロジェクトの顧客欄は空欄になります）`)) {
    return;
  }
  try {
    await customers.remove(c.id);
    flash('顧客を削除しました');
  } catch (e: unknown) {
    errorMessage.value = extractMessage(e) ?? '削除に失敗しました';
  }
}

function flash(msg: string): void {
  statusMessage.value = msg;
  setTimeout(() => (statusMessage.value = null), 2500);
}

function extractMessage(e: unknown): string | null {
  if (typeof e === 'object' && e !== null) {
    const anyE = e as { response?: { data?: { message?: string | string[] } }; message?: string };
    const m = anyE.response?.data?.message;
    if (Array.isArray(m)) return m.join(' / ');
    if (typeof m === 'string') return m;
    if (typeof anyE.message === 'string') return anyE.message;
  }
  return null;
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1>顧客マスタ</h1>
      <div class="actions">
        <input
          v-model="searchText"
          class="search"
          type="search"
          placeholder="検索（コード / 顧客名 / 担当者）"
        />
        <label class="check">
          <span>組織</span>
          <select v-model="orgFilter">
            <option value="all">すべて</option>
            <option value="none">未設定</option>
            <option v-for="o in orgs.byCodeAsc" :key="o.id" :value="o.id">
              {{ orgs.pathOf(o.id) }}
            </option>
          </select>
        </label>
        <label class="check">
          <input v-model="showActiveOnly" type="checkbox" />
          <span>有効のみ</span>
        </label>
        <button class="btn primary" type="button" @click="openCreate">+ 新規追加</button>
      </div>
    </header>

    <p v-if="statusMessage" class="status">{{ statusMessage }}</p>
    <p v-if="errorMessage" class="error">{{ errorMessage }}</p>

    <p v-if="customers.loading && customers.items.length === 0" class="muted">読込中…</p>
    <p v-else-if="customers.items.length === 0" class="muted">
      顧客はまだ登録されていません。「+ 新規追加」から登録してください。
    </p>
    <p v-else-if="visible.length === 0" class="muted">条件に一致する顧客がいません。</p>

    <table v-else class="cust-table">
      <thead>
        <tr>
          <th class="col-code">コード</th>
          <th class="col-name">顧客名</th>
          <th class="col-org">組織</th>
          <th class="col-contact">担当者</th>
          <th class="col-phone">電話</th>
          <th class="col-email">メール</th>
          <th class="col-flag">有効</th>
          <th class="col-actions"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in visible" :key="c.id" :class="{ inactive: c.isActive !== 1 }">
          <td class="col-code">{{ c.code ?? '—' }}</td>
          <td class="col-name">{{ c.name }}</td>
          <td class="col-org">
            <span v-if="c.organizationId !== null">{{ orgs.pathOf(c.organizationId) }}</span>
            <span v-else class="muted">—</span>
          </td>
          <td class="col-contact">{{ c.contactName ?? '' }}</td>
          <td class="col-phone">{{ c.contactPhone ?? '' }}</td>
          <td class="col-email">{{ c.contactEmail ?? '' }}</td>
          <td class="col-flag">{{ c.isActive === 1 ? '✓' : '×' }}</td>
          <td class="col-actions">
            <button class="btn small" type="button" @click="openEdit(c)" title="編集">✎</button>
            <button class="btn small danger" type="button" @click="onDelete(c)" title="削除">🗑</button>
          </td>
        </tr>
      </tbody>
    </table>

    <p class="muted footnote">登録: {{ customers.items.length }} 件（表示: {{ visible.length }} 件）</p>

    <CustomerEditDialog
      ref="dialogRef"
      :open="dialogOpen"
      :customer="editing"
      @close="dialogOpen = false"
      @submit="onSubmit"
    />
  </div>
</template>

<style scoped>
.page { max-width: 1100px; margin: 0 auto; }
.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; gap: 1rem; flex-wrap: wrap; }
.page-header h1 { margin: 0; font-size: 1.35rem; font-weight: 700; color: var(--c-text); letter-spacing: 0.005em; }
.actions { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; }
.search { padding: 0.38rem 0.6rem; border: 1px solid var(--c-border-strong); border-radius: var(--r-sm); font: inherit; width: 280px; transition: border-color var(--t-base) var(--easing), box-shadow var(--t-base) var(--easing); }
.search:focus { outline: none; border-color: var(--c-accent); box-shadow: 0 0 0 3px var(--c-accent-ring); }
.check { display: inline-flex; gap: 0.35rem; align-items: center; font-size: 0.88rem; }
.check select { padding: 0.32rem 0.5rem; border: 1px solid var(--c-border-strong); border-radius: var(--r-sm); font: inherit; }
.btn {
  border: 1px solid var(--c-border-strong);
  background: var(--c-surface);
  border-radius: var(--r-sm);
  padding: 0.4rem 0.85rem;
  cursor: pointer;
  font-size: 0.88rem;
  box-shadow: var(--shadow-sm);
  transition: background var(--t-base) var(--easing),
    border-color var(--t-base) var(--easing),
    box-shadow var(--t-base) var(--easing);
}
.btn:hover { background: var(--c-surface-2); box-shadow: var(--shadow); }
.btn.primary { background: var(--c-accent); color: #fff; border-color: var(--c-accent); }
.btn.primary:hover { background: var(--c-accent-strong); border-color: var(--c-accent-strong); box-shadow: 0 2px 8px rgba(37, 99, 235, 0.28); }
.btn.small { padding: 0.22rem 0.55rem; font-size: 0.95rem; line-height: 1; }
.btn.small.danger:hover { background: #fef2f2; border-color: #fecaca; color: var(--c-danger-fg); }
.cust-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 10px;
  overflow: hidden;
  font-size: 0.88rem;
  box-shadow: var(--shadow-sm);
}
.cust-table th, .cust-table td { padding: 0.55rem 0.7rem; text-align: left; border-bottom: 1px solid var(--c-border); }
.cust-table th { background: var(--c-surface-2); font-weight: 600; color: var(--c-text-muted); letter-spacing: 0.02em; }
.cust-table tbody tr { transition: background var(--t-fast) var(--easing); }
.cust-table tbody tr:hover { background: var(--c-accent-weak); }
.cust-table tr.inactive td { color: var(--c-text-faint); background: #f9fafb; }
.col-code { width: 80px; font-family: 'Cascadia Mono', 'Consolas', 'Menlo', monospace; font-size: 0.83rem; }
.col-name { font-weight: 600; color: var(--c-text); }
.col-org { width: 180px; color: var(--c-text-muted); }
.col-contact { width: 130px; }
.col-phone { width: 120px; }
.col-email { width: 180px; }
.col-flag { width: 56px; text-align: center; }
.col-actions { width: 92px; white-space: nowrap; }
.col-actions .btn + .btn { margin-left: 0.25rem; }
.muted { color: var(--c-text-faint); font-size: 0.88rem; }
.footnote { margin-top: 0.6rem; }
.status { color: #047857; background: #ecfdf5; border: 1px solid #a7f3d0; padding: 0.5rem 0.8rem; border-radius: var(--r); font-size: 0.88rem; margin: 0 0 0.7rem; }
.error { color: var(--c-danger-fg); background: #fef2f2; border: 1px solid #fecaca; padding: 0.5rem 0.8rem; border-radius: var(--r); font-size: 0.88rem; margin: 0 0 0.7rem; }
</style>
