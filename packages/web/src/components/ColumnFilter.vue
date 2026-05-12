<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

type FilterValue = string | number | null;

export interface FilterOption {
  value: FilterValue;
  label: string;
}

const props = defineProps<{
  open: boolean;
  type: 'text' | 'enum';
  title: string;
  // text mode
  text?: string;
  textPlaceholder?: string;
  // enum mode (null = filter inactive, Set = "only these values pass")
  options?: FilterOption[];
  selected?: Set<FilterValue> | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'update-text', value: string): void;
  (e: 'update-enum', selected: Set<FilterValue> | null): void;
}>();

const rootRef = ref<HTMLElement | null>(null);
const localText = ref(props.text ?? '');

watch(
  () => props.text,
  (v) => {
    if ((v ?? '') !== localText.value) localText.value = v ?? '';
  },
);

const allValues = computed<FilterValue[]>(() => (props.options ?? []).map((o) => o.value));

function isChecked(value: FilterValue): boolean {
  // null filter = nothing excluded → all checked
  if (!props.selected) return true;
  return props.selected.has(value);
}

function toggleOption(value: FilterValue): void {
  let next: Set<FilterValue>;
  if (!props.selected) {
    // Currently "no filter" (all checked). Unchecking means filter starts as
    // "everything except this".
    next = new Set(allValues.value.filter((v) => v !== value));
  } else {
    next = new Set(props.selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
  }
  if (next.size === allValues.value.length) {
    // All checked → revert to "no filter".
    emit('update-enum', null);
  } else {
    emit('update-enum', next);
  }
}

function selectAll(): void {
  emit('update-enum', null);
}
function clearAll(): void {
  emit('update-enum', new Set<FilterValue>());
}

function onTextInput(): void {
  emit('update-text', localText.value);
}
function clearText(): void {
  localText.value = '';
  emit('update-text', '');
}

function handleDocClick(e: MouseEvent): void {
  if (!props.open) return;
  if (rootRef.value && !rootRef.value.contains(e.target as Node)) {
    emit('close');
  }
}
function handleKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.open) emit('close');
}

onMounted(() => {
  document.addEventListener('mousedown', handleDocClick);
  document.addEventListener('keydown', handleKey);
});
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleDocClick);
  document.removeEventListener('keydown', handleKey);
});
</script>

<template>
  <div v-if="open" ref="rootRef" class="popover" @click.stop>
    <header class="title">{{ title }}</header>
    <div class="body">
      <div v-if="type === 'text'" class="text-wrap">
        <input
          v-model="localText"
          type="text"
          class="text-input"
          :placeholder="textPlaceholder ?? '検索…'"
          autofocus
          @input="onTextInput"
        />
        <button v-if="localText" class="btn-link clear-text" type="button" @click="clearText">
          クリア
        </button>
      </div>
      <ul v-else class="options">
        <li class="option-controls">
          <button type="button" class="btn-link" @click="selectAll">全て</button>
          <span class="sep">/</span>
          <button type="button" class="btn-link" @click="clearAll">なし</button>
        </li>
        <li v-for="opt in options" :key="String(opt.value)" class="option">
          <label>
            <input
              type="checkbox"
              :checked="isChecked(opt.value)"
              @change="() => toggleOption(opt.value)"
            />
            <span class="opt-label">{{ opt.label }}</span>
          </label>
        </li>
        <li v-if="!options || options.length === 0" class="option-empty">該当なし</li>
      </ul>
    </div>
    <footer class="footer">
      <button class="btn close-btn" type="button" @click="emit('close')">閉じる</button>
    </footer>
  </div>
</template>

<style scoped>
.popover {
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  min-width: 200px;
  max-width: 280px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
  padding: 0.5rem;
  z-index: 100;
  font-size: 0.85rem;
  color: #1f2937;
  text-align: left;
  font-weight: 400;
}
.title {
  font-weight: 600;
  font-size: 0.78rem;
  color: #475569;
  padding-bottom: 0.3rem;
  border-bottom: 1px solid #f1f5f9;
}
.body {
  margin: 0.4rem 0;
  max-height: 280px;
  overflow-y: auto;
}
.text-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.text-input {
  width: 100%;
  padding: 0.3rem 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 0.85rem;
}
.options {
  list-style: none;
  margin: 0;
  padding: 0;
}
.option-controls {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0 0.2rem 0.4rem;
  border-bottom: 1px solid #f1f5f9;
  margin-bottom: 0.3rem;
}
.option-controls .sep {
  color: #cbd5e1;
}
.btn-link {
  background: none;
  border: none;
  color: #2563eb;
  font-size: 0.78rem;
  cursor: pointer;
  padding: 0;
}
.btn-link:hover {
  text-decoration: underline;
}
.option {
  padding: 0.15rem 0.2rem;
}
.option label {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  cursor: pointer;
  padding: 0.1rem 0.2rem;
  border-radius: 3px;
}
.option label:hover {
  background: #f3f4f6;
}
.opt-label {
  flex: 1;
}
.option-empty {
  color: #9ca3af;
  font-size: 0.8rem;
  padding: 0.4rem 0.2rem;
}
.footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 0.3rem;
  border-top: 1px solid #f1f5f9;
}
.close-btn {
  padding: 0.2rem 0.55rem;
  font-size: 0.78rem;
}
</style>
