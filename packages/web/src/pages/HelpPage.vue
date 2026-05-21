<script setup lang="ts">
// The manual is the single in-repo source (docs/manual.html), served by the
// API at /api/help/manual.html and embedded here so it stays inside the app.
const SRC = '/api/help/manual.html';
</script>

<template>
  <div class="manual-page">
    <div class="manual-bar">
      <h1>操作手順</h1>
      <a class="ext" :href="SRC" target="_blank" rel="noopener">別タブで開く ↗</a>
    </div>
    <iframe class="manual-frame" :src="SRC" title="操作手順書"></iframe>
  </div>
</template>

<style scoped>
.manual-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 130px);
  min-height: 420px;
}
.manual-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.6rem;
}
.manual-bar h1 {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
  color: var(--c-text);
  letter-spacing: 0.005em;
}
.ext {
  font-size: 0.85rem;
  color: var(--c-accent);
  text-decoration: none;
}
.ext:hover {
  text-decoration: underline;
}
.manual-frame {
  flex: 1;
  width: 100%;
  border: 1px solid var(--c-border);
  border-radius: 10px;
  background: var(--c-surface);
  box-shadow: var(--shadow-sm);
}
</style>
