<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Organization, OrganizationInput } from '@/types';
import { useOrganizationsStore } from '@/stores/organizations';

const props = defineProps<{
  open: boolean;
  organization: Organization | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'submit', value: OrganizationInput): void;
}>();

const orgStore = useOrganizationsStore();

const form = ref<OrganizationInput>(emptyForm());
const errorMessage = ref<string | null>(null);

const title = computed(() => (props.organization ? '組織を編集' : '組織を新規追加'));

// 親の候補は「自分自身と子孫を除く」全組織（循環防止）。code 昇順。
const parentOptions = computed(() => {
  const all = orgStore.byCodeAsc;
  const editingId = props.organization?.id ?? null;
  if (editingId === null) return all;
  const descendants = new Set<number>([editingId]);
  // 子孫を BFS で集める
  const queue = [editingId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const o of orgStore.items) {
      if (o.parentId === cur && !descendants.has(o.id)) {
        descendants.add(o.id);
        queue.push(o.id);
      }
    }
  }
  return all.filter((o) => !descendants.has(o.id));
});

watch(
  () => [props.open, props.organization],
  ([open]) => {
    if (!open) return;
    errorMessage.value = null;
    form.value = props.organization
      ? {
          code: props.organization.code ?? '',
          name: props.organization.name,
          parentId: props.organization.parentId,
          isActive: props.organization.isActive === 1,
          sortOrder: props.organization.sortOrder,
          note: props.organization.note ?? '',
        }
      : emptyForm();
  },
  { immediate: true },
);

function emptyForm(): OrganizationInput {
  return {
    code: '',
    name: '',
    parentId: null,
    isActive: true,
    sortOrder: 0,
    note: '',
  };
}

function onSubmit(): void {
  errorMessage.value = null;
  if (!form.value.name || !form.value.name.trim()) {
    errorMessage.value = '組織名は必須です';
    return;
  }
  emit('submit', { ...form.value });
}

function reportError(msg: string): void {
  errorMessage.value = msg;
}

defineExpose({ reportError });
</script>

<template>
  <div v-if="open" class="modal-backdrop" @mousedown.self="emit('close')">
    <div class="modal" role="dialog" :aria-label="title">
      <header class="modal-header">
        <h2>{{ title }}</h2>
        <button class="icon-btn" type="button" @click="emit('close')" aria-label="閉じる">×</button>
      </header>
      <form class="modal-body" @submit.prevent="onSubmit">
        <div class="grid">
          <label>
            <span>組織コード</span>
            <input v-model="form.code" type="text" placeholder="空欄で自動採番 (O001…)" maxlength="32" />
          </label>
          <label>
            <span>組織名 <em>*</em></span>
            <input v-model="form.name" type="text" maxlength="200" required />
          </label>
          <label class="full">
            <span>親組織</span>
            <select v-model="form.parentId">
              <option :value="null">（なし／最上位）</option>
              <option v-for="o in parentOptions" :key="o.id" :value="o.id">
                {{ orgStore.pathOf(o.id) }}
              </option>
            </select>
          </label>
          <label>
            <span>並び順</span>
            <input v-model.number="form.sortOrder" type="number" step="1" />
          </label>
        </div>
        <div class="check-row">
          <label class="check">
            <input v-model="form.isActive" type="checkbox" />
            <span>有効（選択肢に出す）</span>
          </label>
        </div>
        <label class="full">
          <span>備考</span>
          <textarea v-model="form.note" rows="2" maxlength="500"></textarea>
        </label>
        <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
        <footer class="modal-footer">
          <button class="btn" type="button" @click="emit('close')">キャンセル</button>
          <button class="btn primary" type="submit">保存</button>
        </footer>
      </form>
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
  width: min(680px, 92vw);
  max-height: 92vh;
  overflow: auto;
  display: flex;
  flex-direction: column;
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #e5e7eb;
}
.modal-header h2 {
  margin: 0;
  font-size: 1.05rem;
}
.icon-btn {
  border: none;
  background: none;
  font-size: 1.4rem;
  cursor: pointer;
  color: #6b7280;
}
.modal-body {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.7rem 1rem;
}
.grid label,
.full {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.85rem;
}
.full {
  grid-column: 1 / -1;
}
.grid label span,
.full span {
  color: #374151;
}
.grid label em {
  color: #dc2626;
  font-style: normal;
  margin-left: 0.15rem;
}
.grid input,
.grid select,
.full textarea,
.full select {
  padding: 0.35rem 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font: inherit;
}
.full textarea {
  resize: vertical;
}
.check-row {
  display: flex;
  gap: 1.5rem;
  flex-wrap: wrap;
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.9rem;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid #f3f4f6;
}
.btn {
  border: 1px solid #d1d5db;
  background: #fff;
  border-radius: 4px;
  padding: 0.4rem 0.9rem;
  cursor: pointer;
  font-size: 0.88rem;
}
.btn.primary {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.btn:hover {
  background: #f9fafb;
}
.btn.primary:hover {
  background: #1d4ed8;
}
.error {
  color: #dc2626;
  margin: 0;
  font-size: 0.85rem;
}
</style>
