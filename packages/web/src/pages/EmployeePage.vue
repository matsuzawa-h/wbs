<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useEmployeesStore } from '@/stores/employees';
import { useOrganizationsStore } from '@/stores/organizations';
import { useCurrentUserStore } from '@/stores/currentUser';
import EmployeeEditDialog from '@/components/EmployeeEditDialog.vue';
import type { Employee, EmployeeInput } from '@/types';

const employees = useEmployeesStore();
const orgs = useOrganizationsStore();
const currentUser = useCurrentUserStore();

const showActiveOnly = ref(true);
const searchText = ref('');
const orgFilter = ref<'all' | 'none' | number>('all');
const dialogOpen = ref(false);
const editing = ref<Employee | null>(null);
const statusMessage = ref<string | null>(null);
const errorMessage = ref<string | null>(null);
const dialogRef = ref<InstanceType<typeof EmployeeEditDialog> | null>(null);

onMounted(async () => {
  await Promise.all([employees.fetchAll(true), orgs.fetchAll()]);
  // 初期表示はログイン中の社員の所属組織で絞り込み（あれば）。
  const myOrg = currentUser.current?.organizationId ?? null;
  if (orgFilter.value === 'all' && myOrg !== null && orgs.byCodeAsc.some((o) => o.id === myOrg)) {
    orgFilter.value = myOrg;
  }
});

const visible = computed(() => {
  const q = searchText.value.trim().toLowerCase();
  return employees.items.filter((e) => {
    if (showActiveOnly.value && e.isActive !== 1) return false;
    if (orgFilter.value === 'none' && e.organizationId !== null) return false;
    if (typeof orgFilter.value === 'number' && e.organizationId !== orgFilter.value) return false;
    if (!q) return true;
    return (
      (e.code ?? '').toLowerCase().includes(q) ||
      e.name.toLowerCase().includes(q) ||
      (e.nameKana ?? '').toLowerCase().includes(q) ||
      (e.department ?? '').toLowerCase().includes(q)
    );
  });
});

function openCreate(): void {
  editing.value = null;
  dialogOpen.value = true;
}

function openEdit(emp: Employee): void {
  editing.value = emp;
  dialogOpen.value = true;
}

async function onSubmit(input: EmployeeInput): Promise<void> {
  errorMessage.value = null;
  try {
    if (editing.value) {
      await employees.update(editing.value.id, input);
      flash('社員情報を更新しました');
    } else {
      await employees.create(input);
      flash('社員を追加しました');
    }
    dialogOpen.value = false;
  } catch (e: unknown) {
    const msg = extractMessage(e) ?? '保存に失敗しました';
    dialogRef.value?.reportError(msg);
  }
}

async function onDelete(emp: Employee): Promise<void> {
  if (!confirm(`「${emp.name}」を削除します。よろしいですか？\n（割当中タスクの担当は空欄になります）`)) {
    return;
  }
  try {
    await employees.remove(emp.id);
    flash('社員を削除しました');
  } catch (e: unknown) {
    errorMessage.value = extractMessage(e) ?? '削除に失敗しました';
  }
}

function flash(msg: string): void {
  statusMessage.value = msg;
  setTimeout(() => (statusMessage.value = null), 2500);
}

function formatEmployment(e: Employee): string {
  if (!e.employmentStart && !e.employmentEnd) return '—';
  const s = e.employmentStart ?? '';
  const t = e.employmentEnd ?? '';
  return `${s}〜${t}`;
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
      <h1>社員マスタ</h1>
      <div class="actions">
        <input
          v-model="searchText"
          class="search"
          type="search"
          placeholder="検索（コード / 氏名 / フリガナ / 所属）"
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

    <p v-if="employees.loading && employees.items.length === 0" class="muted">読込中…</p>
    <p v-else-if="employees.items.length === 0" class="muted">
      社員はまだ登録されていません。「+ 新規追加」から登録してください。
    </p>
    <p v-else-if="visible.length === 0" class="muted">条件に一致する社員がいません。</p>

    <table v-else class="emp-table">
      <thead>
        <tr>
          <th class="col-code">コード</th>
          <th class="col-name">氏名</th>
          <th class="col-org">組織</th>
          <th class="col-kana">フリガナ</th>
          <th class="col-dept">所属</th>
          <th class="col-role">役職</th>
          <th class="col-employment">在籍期間</th>
          <th class="col-flag">休出</th>
          <th class="col-flag">有効</th>
          <th class="col-actions"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in visible" :key="e.id" :class="{ inactive: e.isActive !== 1 }">
          <td class="col-code">{{ e.code ?? '—' }}</td>
          <td class="col-name">{{ e.name }}</td>
          <td class="col-org">
            <span v-if="e.organizationId !== null">{{ orgs.pathOf(e.organizationId) }}</span>
            <span v-else class="muted">—</span>
          </td>
          <td class="col-kana">{{ e.nameKana ?? '' }}</td>
          <td class="col-dept">{{ e.department ?? '' }}</td>
          <td class="col-role">{{ e.role ?? '' }}</td>
          <td class="col-employment">{{ formatEmployment(e) }}</td>
          <td class="col-flag">{{ e.worksOnHolidays === 1 ? '✓' : '' }}</td>
          <td class="col-flag">{{ e.isActive === 1 ? '✓' : '×' }}</td>
          <td class="col-actions">
            <button class="btn small" type="button" @click="openEdit(e)" title="編集">✎</button>
            <button class="btn small danger" type="button" @click="onDelete(e)" title="削除">🗑</button>
          </td>
        </tr>
      </tbody>
    </table>

    <p class="muted footnote">登録: {{ employees.items.length }} 件（表示: {{ visible.length }} 件）</p>

    <EmployeeEditDialog
      ref="dialogRef"
      :open="dialogOpen"
      :employee="editing"
      @close="dialogOpen = false"
      @submit="onSubmit"
    />
  </div>
</template>

<style scoped>
.page {
  max-width: 1100px;
  margin: 0 auto;
}
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
  gap: 1rem;
  flex-wrap: wrap;
}
.page-header h1 {
  margin: 0;
  font-size: 1.2rem;
}
.actions {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  flex-wrap: wrap;
}
.search {
  padding: 0.35rem 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font: inherit;
  width: 280px;
}
.check {
  display: inline-flex;
  gap: 0.35rem;
  align-items: center;
  font-size: 0.88rem;
}
.check select {
  padding: 0.3rem 0.4rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font: inherit;
}
.btn {
  border: 1px solid #d1d5db;
  background: #fff;
  border-radius: 4px;
  padding: 0.35rem 0.8rem;
  cursor: pointer;
  font-size: 0.88rem;
}
.btn:hover {
  background: #f9fafb;
}
.btn.primary {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.btn.primary:hover {
  background: #1d4ed8;
}
.btn.small {
  padding: 0.2rem 0.45rem;
  font-size: 0.95rem;
  line-height: 1;
}
.btn.small.danger:hover {
  background: #fef2f2;
  border-color: #fecaca;
  color: #b91c1c;
}
.emp-table {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  overflow: hidden;
  font-size: 0.88rem;
}
.emp-table th,
.emp-table td {
  padding: 0.45rem 0.6rem;
  text-align: left;
  border-bottom: 1px solid #f1f5f9;
}
.emp-table th {
  background: #f8fafc;
  font-weight: 600;
  color: #475569;
}
.emp-table tr.inactive td {
  color: #94a3b8;
  background: #f9fafb;
}
.col-code {
  width: 80px;
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 0.83rem;
}
.col-name {
  font-weight: 600;
}
.col-org {
  width: 180px;
  color: #475569;
}
.col-flag {
  width: 56px;
  text-align: center;
}
.col-actions {
  width: 92px;
  white-space: nowrap;
}
.col-actions .btn + .btn {
  margin-left: 0.25rem;
}
.col-employment {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.muted {
  color: #94a3b8;
  font-size: 0.88rem;
}
.footnote {
  margin-top: 0.6rem;
}
.status {
  color: #047857;
  background: #ecfdf5;
  padding: 0.45rem 0.7rem;
  border-radius: 4px;
  font-size: 0.88rem;
  margin: 0 0 0.7rem;
}
.error {
  color: #dc2626;
  background: #fef2f2;
  padding: 0.45rem 0.7rem;
  border-radius: 4px;
  font-size: 0.88rem;
  margin: 0 0 0.7rem;
}
</style>
