<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Customer, CustomerInput } from '@/types';

const props = defineProps<{
  open: boolean;
  customer: Customer | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'submit', value: CustomerInput): void;
}>();

const form = ref<CustomerInput>(emptyForm());
const errorMessage = ref<string | null>(null);

const title = computed(() => (props.customer ? '顧客を編集' : '顧客を新規追加'));

watch(
  () => [props.open, props.customer],
  ([open]) => {
    if (!open) return;
    errorMessage.value = null;
    form.value = props.customer
      ? {
          code: props.customer.code ?? '',
          name: props.customer.name,
          contactName: props.customer.contactName ?? '',
          contactEmail: props.customer.contactEmail ?? '',
          contactPhone: props.customer.contactPhone ?? '',
          address: props.customer.address ?? '',
          isActive: props.customer.isActive === 1,
          note: props.customer.note ?? '',
          sortOrder: props.customer.sortOrder,
        }
      : emptyForm();
  },
  { immediate: true },
);

function emptyForm(): CustomerInput {
  return {
    code: '',
    name: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    address: '',
    isActive: true,
    note: '',
    sortOrder: 0,
  };
}

function onSubmit(): void {
  errorMessage.value = null;
  if (!form.value.name || !form.value.name.trim()) {
    errorMessage.value = '顧客名は必須です';
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
            <span>顧客コード</span>
            <input v-model="form.code" type="text" placeholder="空欄で自動採番 (C001…)" maxlength="32" />
          </label>
          <label>
            <span>顧客名 <em>*</em></span>
            <input v-model="form.name" type="text" maxlength="150" required />
          </label>
          <label>
            <span>担当者氏名</span>
            <input v-model="form.contactName" type="text" maxlength="100" />
          </label>
          <label>
            <span>担当者メール</span>
            <input v-model="form.contactEmail" type="email" maxlength="200" />
          </label>
          <label>
            <span>電話番号</span>
            <input v-model="form.contactPhone" type="text" maxlength="50" />
          </label>
          <label>
            <span>並び順</span>
            <input v-model.number="form.sortOrder" type="number" step="1" />
          </label>
        </div>
        <label class="full">
          <span>住所</span>
          <input v-model="form.address" type="text" maxlength="300" />
        </label>
        <div class="check-row">
          <label class="check">
            <input v-model="form.isActive" type="checkbox" />
            <span>有効（取引中）</span>
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
  width: min(640px, 92vw);
  max-height: 92vh;
  overflow: auto;
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
.grid label span,
.full > span {
  color: #374151;
}
.grid label em {
  color: #dc2626;
  font-style: normal;
  margin-left: 0.15rem;
}
.grid input,
.full input,
.full textarea {
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
