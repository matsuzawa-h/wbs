<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';

const props = defineProps<{
  open: boolean;
  taskName: string;
  note: string | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save', note: string | null): void;
}>();

const text = ref('');
const areaRef = ref<HTMLTextAreaElement | null>(null);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    text.value = props.note ?? '';
    nextTick(() => areaRef.value?.focus());
  },
  { immediate: true },
);

function onSave(): void {
  const trimmed = text.value.trim();
  emit('save', trimmed === '' ? null : trimmed);
}

function onKeydown(e: KeyboardEvent): void {
  // Ctrl/Cmd + Enter saves; Esc closes.
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    onSave();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
  }
}
</script>

<template>
  <div v-if="open" class="modal-backdrop" @mousedown.self="emit('close')">
    <div class="modal" role="dialog" aria-label="備考の編集">
      <header class="modal-header">
        <h2>備考 <small>― {{ taskName || '（名称未入力）' }}</small></h2>
        <button class="icon-btn" type="button" @click="emit('close')" aria-label="閉じる">×</button>
      </header>
      <div class="modal-body">
        <textarea
          ref="areaRef"
          v-model="text"
          class="note-area"
          rows="8"
          maxlength="2000"
          placeholder="この項目の備考・メモを入力（Ctrl+Enter で保存）"
          @keydown="onKeydown"
        ></textarea>
        <div class="counter">{{ text.length }} / 2000</div>
      </div>
      <footer class="modal-footer">
        <span class="spacer"></span>
        <button class="btn" type="button" @click="emit('close')">キャンセル</button>
        <button class="btn primary" type="button" @click="onSave">保存</button>
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
  background: var(--c-surface);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-pop);
  width: min(560px, 92vw);
  max-height: 92vh;
  display: flex;
  flex-direction: column;
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.7rem 1rem;
  border-bottom: 1px solid var(--c-border);
}
.modal-header h2 {
  margin: 0;
  font-size: 1.05rem;
}
.modal-header h2 small {
  color: var(--c-text-muted);
  font-weight: 500;
  margin-left: 0.4rem;
  font-size: 0.85rem;
}
.icon-btn {
  border: none;
  background: none;
  font-size: 1.4rem;
  cursor: pointer;
  color: var(--c-text-muted);
  line-height: 1;
}
.modal-body {
  padding: 0.9rem 1rem 0.4rem;
}
.note-area {
  width: 100%;
  resize: vertical;
  font: inherit;
  color: var(--c-text);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r);
  padding: 0.55rem 0.65rem;
  background: var(--c-surface);
  line-height: 1.55;
}
.note-area:focus {
  outline: none;
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px var(--c-accent-ring);
}
.counter {
  text-align: right;
  font-size: 0.75rem;
  color: var(--c-text-faint);
  margin-top: 0.25rem;
}
.modal-footer {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.7rem 1rem;
  border-top: 1px solid var(--c-border);
}
.spacer {
  flex: 1;
}
</style>
