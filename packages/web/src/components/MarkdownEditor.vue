<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import MarkdownView from './MarkdownView.vue';

const props = defineProps<{
  modelValue: string;
  /** textarea の最大文字数。 */
  maxlength?: number;
  /** textarea の placeholder。 */
  placeholder?: string;
  /** textarea の表示行数。 */
  rows?: number;
}>();
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>();

type Tab = 'edit' | 'preview';
const tab = ref<Tab>('edit');

const value = computed({
  get: () => props.modelValue,
  set: (v: string) => emit('update:modelValue', v),
});

// edit タブから preview タブに切り替わると Markdown を再評価。
// 親がモーダル等で開閉する場合に備え、modelValue が空に戻ったら edit に戻す。
watch(
  () => props.modelValue,
  (v) => {
    if (v === '' && tab.value !== 'edit') tab.value = 'edit';
  },
);
</script>

<template>
  <div class="md-edit">
    <div class="tabs" role="tablist">
      <button
        type="button"
        role="tab"
        class="tab-btn"
        :class="{ active: tab === 'edit' }"
        :aria-selected="tab === 'edit'"
        @click="tab = 'edit'"
      >
        ✎ 編集
      </button>
      <button
        type="button"
        role="tab"
        class="tab-btn"
        :class="{ active: tab === 'preview' }"
        :aria-selected="tab === 'preview'"
        @click="tab = 'preview'"
      >
        👁 プレビュー
      </button>
      <span class="hint">
        Markdown 対応（見出し # / リスト - / `code` / **太字** / *斜体* / [リンク](url) / &gt; 引用 / ```code block```）
      </span>
    </div>
    <textarea
      v-if="tab === 'edit'"
      v-model="value"
      class="md-textarea"
      :maxlength="maxlength"
      :placeholder="placeholder"
      :rows="rows ?? 12"
    />
    <div v-else class="md-preview">
      <MarkdownView v-if="value.trim()" :source="value" />
      <p v-else class="muted">プレビューする内容がありません。</p>
    </div>
  </div>
</template>

<style scoped>
.md-edit {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.tabs {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  padding: 0.25rem 0.5rem;
}
.tab-btn {
  background: transparent;
  border: 1px solid transparent;
  padding: 0.32rem 0.85rem;
  font-size: 0.86rem;
  cursor: pointer;
  border-radius: 5px;
  color: #475569;
  font-weight: 500;
}
.tab-btn:hover {
  background: #eef2ff;
}
.tab-btn.active {
  background: #fff;
  border-color: #e5e7eb;
  border-bottom-color: #fff;
  color: #0f172a;
  position: relative;
  z-index: 1;
  margin-bottom: -1px;
}
.hint {
  margin-left: auto;
  color: #64748b;
  font-size: 0.75rem;
}
.md-textarea {
  width: 100%;
  font-family: 'Cascadia Mono', 'Consolas', 'Menlo', monospace;
  font-size: 0.92rem;
  line-height: 1.55;
  padding: 0.7rem 0.9rem;
  border: 1px solid #e5e7eb;
  border-top: 1px solid #e5e7eb;
  border-radius: 0 0 6px 6px;
  resize: vertical;
  min-height: 9rem;
  color: #1f2937;
  background: #fff;
}
.md-textarea:focus {
  outline: none;
  border-color: #93c5fd;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.18);
}
.md-preview {
  border: 1px solid #e5e7eb;
  border-radius: 0 0 6px 6px;
  padding: 0.9rem 1rem;
  background: #fff;
  min-height: 9rem;
}
.muted {
  color: #94a3b8;
  font-size: 0.88rem;
  margin: 0.3rem 0;
  font-style: italic;
}
</style>
