<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useEmployeesStore } from '@/stores/employees';
import { useOrganizationsStore } from '@/stores/organizations';
import { useCurrentUserStore } from '@/stores/currentUser';
import type { Employee } from '@/types';

const router = useRouter();
const route = useRoute();
const employees = useEmployeesStore();
const orgs = useOrganizationsStore();
const currentUser = useCurrentUserStore();

const searchText = ref('');
const orgFilter = ref<'all' | 'none' | number>('all');

onMounted(async () => {
  await Promise.all([employees.fetchAll(true), orgs.fetchAll()]);
  // 既にログイン済なら戻り先または / にリダイレクトする
  if (currentUser.isLoggedIn) {
    const back = route.query.redirect;
    router.replace(typeof back === 'string' && back ? back : '/');
  }
});

const visible = computed<Employee[]>(() => {
  const q = searchText.value.trim().toLowerCase();
  return employees.byCodeAsc.filter((e) => {
    if (orgFilter.value === 'none' && e.organizationId !== null) return false;
    if (typeof orgFilter.value === 'number' && e.organizationId !== orgFilter.value) {
      return false;
    }
    if (!q) return true;
    return (
      (e.code ?? '').toLowerCase().includes(q) ||
      e.name.toLowerCase().includes(q) ||
      (e.nameKana ?? '').toLowerCase().includes(q) ||
      (e.department ?? '').toLowerCase().includes(q)
    );
  });
});

function selectAndLogin(emp: Employee): void {
  currentUser.login(emp.id);
  const back = route.query.redirect;
  router.replace(typeof back === 'string' && back ? back : '/');
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <h1>WBS Web へようこそ</h1>
      <p class="muted">
        ご自分の社員レコードを選んでください。次回からはブラウザに記憶され自動で
        ログインされます（社内 LAN クローズド運用のため、パスワードはありません）。
      </p>

      <div class="filter-row">
        <input
          v-model="searchText"
          type="search"
          class="search"
          placeholder="検索（コード / 氏名 / フリガナ / 所属）"
          autofocus
        />
        <label class="check">
          <span>組織</span>
          <select v-model="orgFilter" class="org-select">
            <option value="all">すべて</option>
            <option value="none">未設定</option>
            <option v-for="o in orgs.byCodeAsc" :key="o.id" :value="o.id">
              {{ orgs.pathOf(o.id) }}
            </option>
          </select>
        </label>
      </div>

      <p v-if="employees.loading && employees.items.length === 0" class="muted">
        読込中…
      </p>
      <p v-else-if="visible.length === 0" class="muted">
        該当する社員がいません。
        <RouterLink to="/employees" class="link">社員マスタ</RouterLink>
        で先に登録してください。
      </p>

      <ul v-else class="list">
        <li
          v-for="e in visible"
          :key="e.id"
          class="row"
          :class="{ inactive: e.isActive !== 1 }"
        >
          <button class="row-btn" type="button" @click="selectAndLogin(e)">
            <span class="code">{{ e.code ?? '—' }}</span>
            <span class="name">{{ e.name }}</span>
            <span v-if="e.nameKana" class="kana">{{ e.nameKana }}</span>
            <span v-if="e.organizationId !== null" class="org">
              🏢 {{ orgs.pathOf(e.organizationId) }}
            </span>
            <span v-if="e.isActive !== 1" class="tag inactive-tag">無効</span>
          </button>
        </li>
      </ul>

      <p class="footnote muted">
        登録: {{ employees.items.length }} 名（表示: {{ visible.length }} 名）
      </p>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 3rem 1rem;
  background: var(--c-bg);
}
.login-card {
  width: min(720px, 100%);
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.1);
  padding: 1.5rem 1.75rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}
h1 {
  margin: 0;
  font-size: 1.25rem;
  color: #1e3a8a;
}
.muted { color: #6b7280; font-size: 0.85rem; margin: 0; }
.filter-row {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  flex-wrap: wrap;
}
.search {
  flex: 1;
  min-width: 12rem;
  padding: 0.45rem 0.6rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font: inherit;
}
.check { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.88rem; color: #374151; }
.org-select {
  padding: 0.35rem 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font: inherit;
  max-width: 16rem;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  overflow: hidden;
  max-height: 60vh;
  overflow-y: auto;
}
.row { border-bottom: 1px solid #f1f5f9; }
.row:last-child { border-bottom: none; }
.row-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.55rem 0.9rem;
  background: #fff;
  border: none;
  cursor: pointer;
  text-align: left;
  font: inherit;
}
.row-btn:hover { background: #eef2ff; }
.row.inactive .row-btn { color: #94a3b8; background: #f9fafb; }
.code { font-family: 'Menlo', 'Consolas', monospace; font-size: 0.82rem; width: 64px; color: #4b5563; }
.name { font-weight: 600; min-width: 6em; }
.kana { color: #94a3b8; font-size: 0.78rem; }
.org { margin-left: auto; font-size: 0.78rem; color: #3730a3; background: #e0e7ff; padding: 0.1rem 0.45rem; border-radius: 999px; }
.tag { font-size: 0.72rem; padding: 0.1rem 0.4rem; border-radius: 3px; }
.tag.inactive-tag { background: #f3f4f6; color: #6b7280; }
.footnote { margin: 0; }
.link { color: #2563eb; text-decoration: none; }
.link:hover { text-decoration: underline; }
</style>
