<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useProjectsStore } from '@/stores/projects';

const projects = useProjectsStore();
const router = useRouter();
const newName = ref('');
const submitting = ref(false);

onMounted(() => {
  projects.fetchAll();
});

async function onCreate(): Promise<void> {
  const name = newName.value.trim();
  if (!name) return;
  submitting.value = true;
  try {
    const created = await projects.create(name);
    newName.value = '';
    router.push({ name: 'gantt', params: { projectId: created.id } });
  } finally {
    submitting.value = false;
  }
}

function open(id: number): void {
  router.push({ name: 'gantt', params: { projectId: id } });
}

async function onRename(id: number, currentName: string): Promise<void> {
  const next = window.prompt('プロジェクト名を変更', currentName);
  if (next === null) return;
  const trimmed = next.trim();
  if (!trimmed || trimmed === currentName) return;
  await projects.rename(id, trimmed);
}

async function onDelete(id: number, name: string): Promise<void> {
  if (!window.confirm(`プロジェクト「${name}」を削除します。よろしいですか？`)) return;
  await projects.remove(id);
}

function formatCreatedAt(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleString('ja-JP');
}
</script>

<template>
  <div class="project-list">
    <section class="card">
      <h2>新規プロジェクト</h2>
      <form class="create-form" @submit.prevent="onCreate">
        <input
          v-model="newName"
          type="text"
          placeholder="プロジェクト名"
          :disabled="submitting"
          required
        />
        <button class="btn primary" type="submit" :disabled="submitting || !newName.trim()">
          作成して開く
        </button>
      </form>
    </section>

    <section class="card">
      <h2>プロジェクト一覧</h2>
      <p v-if="projects.loading" class="muted">読込中…</p>
      <p v-else-if="projects.error" class="error">{{ projects.error }}</p>
      <p v-else-if="projects.items.length === 0" class="muted">
        まだプロジェクトがありません。上のフォームから作成してください。
      </p>
      <ul v-else class="rows">
        <li v-for="p in projects.items" :key="p.id">
          <button class="row-main" type="button" @click="open(p.id)">
            <span class="row-name">{{ p.name }}</span>
            <span class="row-meta">作成: {{ formatCreatedAt(p.createdAt) }}</span>
          </button>
          <span class="row-actions">
            <button class="btn" type="button" @click="onRename(p.id, p.name)">名前変更</button>
            <button class="btn danger" type="button" @click="onDelete(p.id, p.name)">削除</button>
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.project-list {
  max-width: 720px;
  margin: 0 auto;
  display: grid;
  gap: 1rem;
}
.card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1rem 1.25rem;
}
.card h2 {
  margin: 0 0 0.75rem;
  font-size: 1rem;
}
.create-form {
  display: flex;
  gap: 0.5rem;
}
.create-form input {
  flex: 1;
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}
.rows li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #fff;
}
.row-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  background: none;
  border: none;
  padding: 0;
  text-align: left;
  cursor: pointer;
}
.row-name {
  font-weight: 600;
}
.row-meta {
  font-size: 0.8rem;
  color: #6b7280;
}
.row-actions {
  display: flex;
  gap: 0.4rem;
}
.muted {
  color: #6b7280;
}
.error {
  color: #b91c1c;
}
</style>
