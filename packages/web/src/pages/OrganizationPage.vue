<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useOrganizationsStore } from '@/stores/organizations';
import OrganizationEditDialog from '@/components/OrganizationEditDialog.vue';
import type { Organization, OrganizationInput } from '@/types';

const orgs = useOrganizationsStore();

const showActiveOnly = ref(true);
const searchText = ref('');
const parentFilter = ref<'all' | 'roots' | number>('all');
const dialogOpen = ref(false);
const editing = ref<Organization | null>(null);
const statusMessage = ref<string | null>(null);
const errorMessage = ref<string | null>(null);
const dialogRef = ref<InstanceType<typeof OrganizationEditDialog> | null>(null);

onMounted(() => {
  orgs.fetchAll(true);
});

const visible = computed(() => {
  const q = searchText.value.trim().toLowerCase();
  // code 昇順（NULL 末尾）の活性アイテムから絞り込み。
  return orgs.byCodeAsc
    .filter((o) => (showActiveOnly.value ? o.isActive === 1 : true))
    .filter((o) => {
      if (parentFilter.value === 'all') return true;
      if (parentFilter.value === 'roots') return o.parentId === null;
      return o.parentId === parentFilter.value;
    })
    .filter((o) => {
      if (!q) return true;
      return (
        (o.code ?? '').toLowerCase().includes(q) ||
        o.name.toLowerCase().includes(q) ||
        orgs.pathOf(o.id).toLowerCase().includes(q)
      );
    });
});

const parentChoices = computed(() => orgs.byCodeAsc);

function openCreate(): void {
  editing.value = null;
  dialogOpen.value = true;
}

function openEdit(o: Organization): void {
  editing.value = o;
  dialogOpen.value = true;
}

async function onSubmit(input: OrganizationInput): Promise<void> {
  errorMessage.value = null;
  try {
    if (editing.value) {
      await orgs.update(editing.value.id, input);
      flash('組織情報を更新しました');
    } else {
      await orgs.create(input);
      flash('組織を追加しました');
    }
    dialogOpen.value = false;
  } catch (e: unknown) {
    const msg = extractMessage(e) ?? '保存に失敗しました';
    dialogRef.value?.reportError(msg);
  }
}

async function onDelete(o: Organization): Promise<void> {
  if (
    !confirm(
      `「${o.name}」を削除します。よろしいですか？\n（紐づく顧客／担当者／プロジェクトの組織欄は空欄になります。子組織の親も外れます）`,
    )
  ) {
    return;
  }
  try {
    await orgs.remove(o.id);
    flash('組織を削除しました');
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
      <h1>組織マスタ</h1>
      <div class="actions">
        <input
          v-model="searchText"
          class="search"
          type="search"
          placeholder="検索（コード / 組織名 / 階層パス）"
        />
        <label class="check">
          <span>親で絞込み</span>
          <select v-model="parentFilter">
            <option value="all">すべて</option>
            <option value="roots">最上位のみ</option>
            <option v-for="o in parentChoices" :key="o.id" :value="o.id">
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

    <p v-if="orgs.loading && orgs.items.length === 0" class="muted">読込中…</p>
    <p v-else-if="orgs.items.length === 0" class="muted">
      組織はまだ登録されていません。「+ 新規追加」から登録してください。
    </p>
    <p v-else-if="visible.length === 0" class="muted">条件に一致する組織がありません。</p>

    <table v-else class="org-table">
      <thead>
        <tr>
          <th class="col-code">コード</th>
          <th class="col-name">組織名</th>
          <th class="col-parent">親組織（階層）</th>
          <th class="col-flag">有効</th>
          <th class="col-actions"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="o in visible" :key="o.id" :class="{ inactive: o.isActive !== 1 }">
          <td class="col-code">{{ o.code ?? '—' }}</td>
          <td class="col-name">{{ o.name }}</td>
          <td class="col-parent">
            <span v-if="o.parentId === null" class="muted">（最上位）</span>
            <span v-else>{{ orgs.pathOf(o.parentId) }}</span>
          </td>
          <td class="col-flag">{{ o.isActive === 1 ? '✓' : '×' }}</td>
          <td class="col-actions">
            <button class="btn small" type="button" @click="openEdit(o)" title="編集">✎</button>
            <button class="btn small danger" type="button" @click="onDelete(o)" title="削除">🗑</button>
          </td>
        </tr>
      </tbody>
    </table>

    <p class="muted footnote">登録: {{ orgs.items.length }} 件（表示: {{ visible.length }} 件）</p>

    <OrganizationEditDialog
      ref="dialogRef"
      :open="dialogOpen"
      :organization="editing"
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
.search { padding: 0.38rem 0.6rem; border: 1px solid var(--c-border-strong); border-radius: var(--r-sm); font: inherit; width: 260px; transition: border-color var(--t-base) var(--easing), box-shadow var(--t-base) var(--easing); }
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
.org-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 10px;
  overflow: hidden;
  font-size: 0.88rem;
  box-shadow: var(--shadow-sm);
}
.org-table th, .org-table td { padding: 0.55rem 0.7rem; text-align: left; border-bottom: 1px solid var(--c-border); }
.org-table th { background: var(--c-surface-2); font-weight: 600; color: var(--c-text-muted); letter-spacing: 0.02em; }
.org-table tbody tr { transition: background var(--t-fast) var(--easing); }
.org-table tbody tr:hover { background: var(--c-accent-weak); }
.org-table tr.inactive td { color: var(--c-text-faint); background: #f9fafb; }
.col-code { width: 100px; font-family: 'Cascadia Mono', 'Consolas', 'Menlo', monospace; font-size: 0.83rem; }
.col-name { font-weight: 600; color: var(--c-text); }
.col-parent { color: var(--c-text-muted); }
.col-flag { width: 56px; text-align: center; }
.col-actions { width: 92px; white-space: nowrap; }
.col-actions .btn + .btn { margin-left: 0.25rem; }
.muted { color: var(--c-text-faint); font-size: 0.88rem; }
.footnote { margin-top: 0.6rem; }
.status { color: #047857; background: #ecfdf5; border: 1px solid #a7f3d0; padding: 0.5rem 0.8rem; border-radius: var(--r); font-size: 0.88rem; margin: 0 0 0.7rem; }
.error { color: var(--c-danger-fg); background: #fef2f2; border: 1px solid #fecaca; padding: 0.5rem 0.8rem; border-radius: var(--r); font-size: 0.88rem; margin: 0 0 0.7rem; }
</style>
