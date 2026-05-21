<script setup lang="ts">
import { ref, watch } from 'vue';
import { useCustomersStore } from '@/stores/customers';
import { useManhoursStore } from '@/stores/manhours';
import type { Customer, Project } from '@/types';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'created', project: Project): void;
}>();

const customers = useCustomersStore();
const manhours = useManhoursStore();

const name = ref('');
const projectCode = ref('');
const customerId = ref<number | null>(null);
const submitting = ref(false);
const errorMessage = ref<string | null>(null);

watch(
  () => props.open,
  (v) => {
    if (!v) return;
    name.value = '';
    projectCode.value = '';
    customerId.value = null;
    submitting.value = false;
    errorMessage.value = null;
    customers.fetchAll();
  },
);

async function onSubmit(): Promise<void> {
  errorMessage.value = null;
  if (!name.value.trim()) {
    errorMessage.value = '仮プロジェクト名を入力してください';
    return;
  }
  submitting.value = true;
  try {
    const project = await manhours.createManualProject({
      name: name.value.trim(),
      projectCode: projectCode.value.trim() || null,
      customerId: customerId.value,
    });
    emit('created', project);
    emit('close');
  } catch (e: unknown) {
    const anyE = e as { response?: { data?: { message?: string | string[] } } };
    const m = anyE?.response?.data?.message;
    errorMessage.value = Array.isArray(m)
      ? m.join(' / ')
      : (m ?? '作成に失敗しました');
  } finally {
    submitting.value = false;
  }
}

function customerLabel(c: Customer): string {
  return `${c.code ? `[${c.code}] ` : ''}${c.name}`;
}
</script>

<template>
  <div v-if="open" class="modal-backdrop" @mousedown.self="emit('close')">
    <div class="modal" role="dialog" aria-label="仮プロジェクト作成">
      <header class="modal-header">
        <h2>仮プロジェクトを作成</h2>
        <button class="icon-btn" type="button" @click="emit('close')" aria-label="閉じる">×</button>
      </header>
      <form class="modal-body" @submit.prevent="onSubmit">
        <p class="muted">
          受注前の見込み案件などを稼働見通しに載せるための仮プロジェクトです（仮フラグ付き）。
        </p>
        <label class="row-field">
          <span>仮プロジェクト名 <em>*</em></span>
          <input v-model="name" type="text" maxlength="200" required />
        </label>
        <label class="row-field">
          <span>プロジェクトCD</span>
          <input v-model="projectCode" type="text" maxlength="64" placeholder="任意" />
        </label>
        <label class="row-field">
          <span>顧客</span>
          <select v-model.number="customerId">
            <option :value="null">（顧客未指定）</option>
            <option v-for="c in customers.activeItems" :key="c.id" :value="c.id">
              {{ customerLabel(c) }}
            </option>
          </select>
        </label>
        <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
        <footer class="modal-footer">
          <button class="btn" type="button" @click="emit('close')">キャンセル</button>
          <button class="btn primary" type="submit" :disabled="submitting">
            {{ submitting ? '作成中…' : '作成' }}
          </button>
        </footer>
      </form>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.modal {
  background: var(--c-surface); border-radius: var(--r-lg);
  box-shadow: var(--shadow-pop); width: min(520px, 95vw);
  display: flex; flex-direction: column;
}
.modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.75rem 1rem; border-bottom: 1px solid var(--c-border);
}
.modal-header h2 { margin: 0; font-size: 1.05rem; }
.icon-btn { border: none; background: none; font-size: 1.4rem; cursor: pointer; color: var(--c-text-muted); }
.modal-body { padding: 1rem; display: flex; flex-direction: column; gap: 0.9rem; }
.row-field {
  display: grid; grid-template-columns: 11rem 1fr; align-items: center;
  gap: 0.5rem; font-size: 0.9rem;
}
.row-field em { color: var(--c-danger-fg); font-style: normal; }
.muted { color: var(--c-text-muted); font-size: 0.85rem; }
.modal-footer {
  display: flex; justify-content: flex-end; gap: 0.5rem;
  padding-top: 0.5rem; border-top: 1px solid var(--c-border); margin-top: 0.5rem;
}
.error {
  color: var(--c-danger-fg); background: var(--c-danger-bg);
  padding: 0.45rem 0.7rem; border-radius: var(--r-sm); font-size: 0.85rem; margin: 0;
}
</style>
