<script setup lang="ts">
import { computed } from 'vue';
import { renderMarkdown } from '@/utils/markdown';

const props = defineProps<{
  /** Markdown 原文。null/空のときは空文字レンダリング。 */
  source: string | null | undefined;
}>();

// renderMarkdown は XSS 対策済み HTML を返すため v-html で安全。
const html = computed(() => renderMarkdown(props.source ?? ''));
</script>

<template>
  <div class="md-view" v-html="html" />
</template>

<style scoped>
.md-view {
  font-size: 0.95rem;
  line-height: 1.7;
  color: #1f2937;
  word-wrap: break-word;
}
.md-view :deep(h1),
.md-view :deep(h2),
.md-view :deep(h3),
.md-view :deep(h4),
.md-view :deep(h5),
.md-view :deep(h6) {
  margin: 1.2rem 0 0.5rem;
  font-weight: 700;
  line-height: 1.3;
  color: #0f172a;
}
.md-view :deep(h1) {
  font-size: 1.6rem;
  border-bottom: 1px solid #e5e7eb;
  padding-bottom: 0.3rem;
  margin-top: 0;
}
.md-view :deep(h2) {
  font-size: 1.3rem;
  border-bottom: 1px solid #e5e7eb;
  padding-bottom: 0.2rem;
}
.md-view :deep(h3) {
  font-size: 1.1rem;
}
.md-view :deep(h4) {
  font-size: 1rem;
}
.md-view :deep(h5),
.md-view :deep(h6) {
  font-size: 0.92rem;
  color: #475569;
}
.md-view :deep(p) {
  margin: 0.55rem 0;
}
.md-view :deep(ul),
.md-view :deep(ol) {
  margin: 0.45rem 0;
  padding-left: 1.7rem;
}
.md-view :deep(li) {
  margin: 0.18rem 0;
}
.md-view :deep(a) {
  color: #2563eb;
  text-decoration: none;
}
.md-view :deep(a:hover) {
  text-decoration: underline;
}
.md-view :deep(code) {
  font-family: 'Cascadia Mono', 'Consolas', 'Menlo', monospace;
  background: #f1f5f9;
  color: #b45309;
  padding: 0.08em 0.35em;
  border-radius: 4px;
  font-size: 0.88em;
}
.md-view :deep(pre) {
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 8px;
  padding: 0.8rem 1rem;
  overflow: auto;
  font-size: 0.85rem;
  line-height: 1.45;
  margin: 0.6rem 0;
}
.md-view :deep(pre) :deep(code),
.md-view :deep(pre code) {
  background: none;
  color: inherit;
  padding: 0;
  font-size: inherit;
}
.md-view :deep(blockquote) {
  margin: 0.6rem 0;
  padding: 0.4rem 0.9rem;
  border-left: 4px solid #cbd5e1;
  color: #475569;
  background: #f8fafc;
  border-radius: 0 6px 6px 0;
}
.md-view :deep(hr) {
  border: 0;
  border-top: 1px solid #e5e7eb;
  margin: 1rem 0;
}
.md-view :deep(strong) {
  color: #0f172a;
}
</style>
