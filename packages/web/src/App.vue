<script setup lang="ts">
import { RouterView, RouterLink } from 'vue-router';
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <h1>
        <RouterLink to="/">WBS Web</RouterLink>
      </h1>
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
.app-main {
  flex: 1;
  padding: 1.25rem;
  background: #f3f4f6;
}
</style>
