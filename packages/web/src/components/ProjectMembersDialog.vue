<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { Employee } from '@/types';
import { useOrganizationsStore } from '@/stores/organizations';

const props = defineProps<{
  open: boolean;
  projectName: string;
  allEmployees: Employee[];
  currentMemberIds: number[];
  // All employees referenced by any task in this project — used to warn
  // when an assigned employee is being unchecked.
  assignedEmployeeIds: number[];
  /** プロジェクトの組織。指定時は初期表示でその組織にフィルタを合わせる。 */
  projectOrganizationId?: number | null;
}>();

const orgs = useOrganizationsStore();
onMounted(() => orgs.fetchAll());

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save', employeeIds: number[]): void;
}>();

const selected = ref<Set<number>>(new Set());
const searchText = ref('');
const showActiveOnly = ref(true);
const orgFilter = ref<'all' | 'none' | number>('all');
const saving = ref(false);
const errorMessage = ref<string | null>(null);

watch(
  () => [props.open, props.currentMemberIds, props.projectOrganizationId],
  ([open]) => {
    if (!open) return;
    selected.value = new Set(props.currentMemberIds);
    searchText.value = '';
    showActiveOnly.value = true;
    // プロジェクトに組織がある場合は初期表示でその組織に絞る。
    // 無い場合は「すべて」のまま。
    orgFilter.value =
      props.projectOrganizationId !== undefined &&
      props.projectOrganizationId !== null
        ? props.projectOrganizationId
        : 'all';
    errorMessage.value = null;
  },
  { immediate: true },
);

const visible = computed(() => {
  const q = searchText.value.trim().toLowerCase();
  return props.allEmployees.filter((e) => {
    if (showActiveOnly.value && e.isActive !== 1) {
      // Keep inactive employees visible if they are already selected,
      // so the user can see and uncheck them.
      if (!selected.value.has(e.id)) return false;
    }
    // 組織フィルタ。選択中の社員は常に表示（外せるように）。
    if (!selected.value.has(e.id)) {
      if (orgFilter.value === 'none' && e.organizationId !== null) return false;
      if (
        typeof orgFilter.value === 'number' &&
        e.organizationId !== orgFilter.value
      )
        return false;
    }
    if (!q) return true;
    return (
      (e.code ?? '').toLowerCase().includes(q) ||
      e.name.toLowerCase().includes(q) ||
      (e.nameKana ?? '').toLowerCase().includes(q) ||
      (e.department ?? '').toLowerCase().includes(q)
    );
  });
});

function isOrphanedAssignment(id: number): boolean {
  // Warn when an employee is assigned to a task in this project but the user
  // is proposing to deselect them — they'll be tagged "(メンバー外)" after save.
  return props.assignedEmployeeIds.includes(id) && !selected.value.has(id);
}

function toggle(id: number): void {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

function selectAll(): void {
  selected.value = new Set(visible.value.map((e) => e.id));
}

function selectNone(): void {
  selected.value = new Set();
}

async function onSave(): Promise<void> {
  saving.value = true;
  errorMessage.value = null;
  try {
    emit('save', Array.from(selected.value));
  } finally {
    saving.value = false;
  }
}

const selectedCount = computed(() => selected.value.size);
</script>

<template>
  <div v-if="open" class="modal-backdrop" @mousedown.self="emit('close')">
    <div class="modal" role="dialog" aria-label="プロジェクトメンバー管理">
      <header class="modal-header">
        <h2>メンバー管理 <small>― {{ projectName }}</small></h2>
        <button class="icon-btn" type="button" @click="emit('close')" aria-label="閉じる">×</button>
      </header>
      <div class="filter-bar">
        <input
          v-model="searchText"
          class="search"
          type="search"
          placeholder="検索（コード / 氏名 / フリガナ / 所属）"
        />
        <label class="check">
          <span>組織</span>
          <select v-model="orgFilter" class="org-select">
            <option value="all">すべて</option>
            <option value="none">未設定</option>
            <option v-for="o in orgs.byCodeAsc" :key="o.id" :value="o.id">
              {{ orgs.pathOf(o.id) }}
            </option>
          </select>
        </label>
        <label class="check">
          <input v-model="showActiveOnly" type="checkbox" />
          <span>有効社員のみ</span>
        </label>
        <span class="spacer"></span>
        <button class="btn small" type="button" @click="selectAll">表示中を全選択</button>
        <button class="btn small" type="button" @click="selectNone">全解除</button>
      </div>
      <div class="list-wrap">
        <p v-if="visible.length === 0" class="muted">該当する社員がいません。</p>
        <ul v-else class="list">
          <li
            v-for="e in visible"
            :key="e.id"
            class="row"
            :class="{ inactive: e.isActive !== 1, orphan: isOrphanedAssignment(e.id) }"
          >
            <label>
              <input
                type="checkbox"
                :checked="selected.has(e.id)"
                @change="toggle(e.id)"
              />
              <span class="code">{{ e.code ?? '—' }}</span>
              <span class="name">{{ e.name }}</span>
              <span v-if="e.nameKana" class="kana">{{ e.nameKana }}</span>
              <span v-if="e.department" class="dept">{{ e.department }}</span>
              <span v-if="e.isActive !== 1" class="tag inactive-tag">無効</span>
              <span v-if="isOrphanedAssignment(e.id)" class="tag warn-tag" title="このプロジェクトのタスクに割当中です。外すとタスク上は「(メンバー外)」表記になります。">
                ⚠ 割当中
              </span>
            </label>
          </li>
        </ul>
      </div>
      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
      <footer class="modal-footer">
        <span class="muted">選択中: {{ selectedCount }} 名</span>
        <span class="spacer"></span>
        <button class="btn" type="button" @click="emit('close')">キャンセル</button>
        <button class="btn primary" type="button" :disabled="saving" @click="onSave">保存</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  width: min(640px, 92vw);
  max-height: 92vh;
  display: flex;
  flex-direction: column;
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.7rem 1rem;
  border-bottom: 1px solid #e5e7eb;
}
.modal-header h2 {
  margin: 0;
  font-size: 1.05rem;
}
.modal-header h2 small {
  color: #6b7280;
  font-weight: 500;
  margin-left: 0.4rem;
  font-size: 0.85rem;
}
.icon-btn {
  border: none;
  background: none;
  font-size: 1.4rem;
  cursor: pointer;
  color: #6b7280;
}
.filter-bar {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  padding: 0.6rem 1rem;
  border-bottom: 1px solid #f1f5f9;
  flex-wrap: wrap;
}
.search {
  flex: 1;
  min-width: 200px;
  padding: 0.35rem 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font: inherit;
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.85rem;
}
.org-select {
  padding: 0.3rem 0.4rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font: inherit;
  max-width: 16rem;
}
.spacer {
  flex: 1;
}
.list-wrap {
  flex: 1;
  overflow-y: auto;
  padding: 0.4rem 0;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.row {
  border-bottom: 1px solid #f3f4f6;
}
.row label {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.45rem 1rem;
  cursor: pointer;
  font-size: 0.88rem;
}
.row label:hover {
  background: #f8fafc;
}
.row.inactive label {
  color: #94a3b8;
}
.row.orphan label {
  background: #fffbeb;
}
.code {
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 0.82rem;
  width: 56px;
  color: #4b5563;
}
.name {
  font-weight: 600;
  min-width: 6em;
}
.kana {
  color: #94a3b8;
  font-size: 0.8rem;
}
.dept {
  color: #6b7280;
  font-size: 0.82rem;
}
.tag {
  font-size: 0.72rem;
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  margin-left: 0.2rem;
}
.tag.inactive-tag {
  background: #f3f4f6;
  color: #6b7280;
}
.tag.warn-tag {
  background: #fef3c7;
  color: #92400e;
}
.modal-footer {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1rem;
  border-top: 1px solid #f1f5f9;
}
.btn {
  border: 1px solid #d1d5db;
  background: #fff;
  border-radius: 4px;
  padding: 0.4rem 0.9rem;
  cursor: pointer;
  font-size: 0.88rem;
}
.btn:hover {
  background: #f9fafb;
}
.btn.small {
  padding: 0.25rem 0.55rem;
  font-size: 0.82rem;
}
.btn.primary {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.btn.primary:hover {
  background: #1d4ed8;
}
.btn.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.muted {
  color: #94a3b8;
  font-size: 0.85rem;
  padding: 0 1rem;
}
.error {
  color: #dc2626;
  margin: 0;
  font-size: 0.85rem;
  padding: 0 1rem 0.5rem;
}
</style>
