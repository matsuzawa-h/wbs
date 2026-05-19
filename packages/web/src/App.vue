<script setup lang="ts">
import { RouterView, RouterLink } from 'vue-router';
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <h1>
        <RouterLink to="/"><span class="brand-mark">W</span>WBS Web</RouterLink>
      </h1>
      <nav class="app-nav">
        <RouterLink to="/" class="nav-link" exact-active-class="active">プロジェクト</RouterLink>
        <RouterLink to="/assignments" class="nav-link" active-class="active">担当別予定</RouterLink>
        <RouterLink to="/manhours" class="nav-link" active-class="active">稼働見通し</RouterLink>
        <RouterLink to="/customers" class="nav-link" active-class="active">顧客マスタ</RouterLink>
        <RouterLink to="/employees" class="nav-link" active-class="active">社員マスタ</RouterLink>
        <RouterLink to="/holidays" class="nav-link" active-class="active">休日設定</RouterLink>
        <RouterLink to="/downloads" class="nav-link" active-class="active">ダウンロード</RouterLink>
        <RouterLink to="/manual" class="nav-link" active-class="active">操作手順</RouterLink>
      </nav>
    </header>
    <main class="app-main">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.app-header {
  background: linear-gradient(180deg, #232f3f 0%, #1b2533 100%);
  color: #f1f5f9;
  padding: 0.7rem 1.4rem;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04),
    0 2px 8px rgba(15, 23, 42, 0.18);
  display: flex;
  align-items: center;
  gap: 1.5rem;
}
.app-header h1 {
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  margin: 0;
}
.app-header h1 a {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
}
.brand-mark {
  display: inline-grid;
  place-items: center;
  width: 1.55rem;
  height: 1.55rem;
  border-radius: var(--r);
  background: var(--c-accent);
  color: #fff;
  font-size: 0.92rem;
  font-weight: 800;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
}
.app-header a {
  color: inherit;
  text-decoration: none;
}
.app-nav {
  display: flex;
  gap: 0.3rem;
  font-size: 0.88rem;
}
.app-nav .nav-link {
  color: #b6c2d3;
  padding: 0.32rem 0.7rem;
  border-radius: var(--r);
  font-weight: 500;
  transition: color 0.15s, background 0.15s;
}
.app-nav .nav-link:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.07);
}
.app-nav .nav-link.active {
  color: #fff;
  background: rgba(37, 99, 235, 0.32);
  box-shadow: inset 0 0 0 1px rgba(96, 165, 250, 0.4);
}
.app-main {
  flex: 1;
  padding: 1.25rem;
  background: var(--c-bg);
}
</style>
