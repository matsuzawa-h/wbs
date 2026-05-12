<script setup lang="ts">
import { RouterView, RouterLink } from 'vue-router';
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <h1>
        <RouterLink to="/">WBS Web</RouterLink>
      </h1>
      <nav class="app-nav">
        <RouterLink to="/" class="nav-link" exact-active-class="active">プロジェクト</RouterLink>
        <RouterLink to="/assignments" class="nav-link" active-class="active">担当別予定</RouterLink>
        <RouterLink to="/customers" class="nav-link" active-class="active">顧客マスタ</RouterLink>
        <RouterLink to="/employees" class="nav-link" active-class="active">社員マスタ</RouterLink>
        <RouterLink to="/holidays" class="nav-link" active-class="active">休日設定</RouterLink>
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
  background: #1f2937;
  color: #f9fafb;
  padding: 0.75rem 1.25rem;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: center;
  gap: 1.25rem;
}
.app-header h1 {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0;
}
.app-header a {
  color: inherit;
  text-decoration: none;
}
.app-nav {
  display: flex;
  gap: 0.75rem;
  font-size: 0.88rem;
}
.app-nav .nav-link {
  color: #cbd5e1;
  padding: 0.25rem 0.6rem;
  border-radius: 4px;
}
.app-nav .nav-link:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.06);
}
.app-nav .nav-link.active {
  color: #fff;
  background: rgba(255, 255, 255, 0.15);
}
.app-main {
  flex: 1;
  padding: 1.25rem;
  background: #f3f4f6;
}
</style>
