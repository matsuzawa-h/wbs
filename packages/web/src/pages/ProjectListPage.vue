<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useProjectsStore } from '@/stores/projects';
import { useCustomersStore } from '@/stores/customers';
import type { Project } from '@/types';

const projects = useProjectsStore();
const customers = useCustomersStore();
const router = useRouter();
const newName = ref('');
const newCustomerId = ref<number | null>(null);
const submitting = ref(false);
const collapsedCustomers = ref<Set<string>>(new Set());

onMounted(async () => {
  await Promise.all([projects.fetchAll(), customers.fetchAll()]);
});

// Groups projects by customer, preserving customers list order then putting
// the "未紐付" bucket at the end.
const grouped = computed<Array<{ key: string; label: string; customerId: number | null; isInactive: boolean; projects: Project[] }>>(() => {
  const byCustomer = new Map<string, Project[]>();
  for (const p of projects.items) {
    const key = p.customerId === null ? '__none' : String(p.customerId);
    const arr = byCustomer.get(key) ?? [];
    arr.push(p);
    byCustomer.set(key, arr);
  }
  const result: Array<{ key: string; label: string; customerId: number | null; isInactive: boolean; projects: Project[] }> = [];
  for (const c of customers.items) {
    const list = byCustomer.get(String(c.id));
    if (!list) continue;
    result.push({
      key: String(c.id),
      label: c.code ? `${c.code}  ${c.name}` : c.name,
      customerId: c.id,
      isInactive: c.isActive !== 1,
      projects: list,
    });
  }
  // Projects with a customer_id pointing to a now-deleted customer would have
  // customerId set but no match in customers.items. Surface them as "顧客不明".
  // (Shouldn't happen due to FK ON DELETE SET NULL, but defensively.)
  for (const [key, list] of byCustomer.entries()) {
    if (key === '__none') continue;
    if (!result.some((r) => r.key === key)) {
      result.push({
        key,
        label: '（顧客不明）',
        customerId: Number(key),
        isInactive: true,
        projects: list,
      });
    }
  }
  const noneList = byCustomer.get('__none');
  if (noneList) {
    result.push({
      key: '__none',
      label: '（顧客未紐付）',
      customerId: null,
      isInactive: false,
      projects: noneList,
    });
  }
  return result;
});

async function onCreate(): Promise<void> {
  const name = newName.value.trim();
  if (!name) return;
  submitting.value = true;
  try {
    const created = await projects.create(name, newCustomerId.value);
    newName.value = '';
    // keep newCustomerId so multiple projects for the same customer flow fast
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

async function onChangeCustomer(p: Project): Promise<void> {
  const options = customers.activeItems
    .map((c, i) => `${i + 1}: ${c.code ? `[${c.code}] ` : ''}${c.name}`)
    .concat([`${customers.activeItems.length + 1}: （顧客解除）`]);
  const choice = window.prompt(
    `プロジェクト「${p.name}」の顧客を選択してください (番号を入力)：\n` + options.join('\n'),
    '',
  );
  if (!choice) return;
  const n = parseInt(choice, 10);
  if (Number.isNaN(n) || n < 1 || n > customers.activeItems.length + 1) return;
  const customerId = n === customers.activeItems.length + 1 ? null : customers.activeItems[n - 1].id;
  await projects.setCustomer(p.id, customerId);
}

async function onDelete(id: number, name: string): Promise<void> {
  if (!window.confirm(`プロジェクト「${name}」を削除します。よろしいですか？`)) return;
  await projects.remove(id);
}

function toggleGroup(key: string): void {
  const next = new Set(collapsedCustomers.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  collapsedCustomers.value = next;
}

function isCollapsed(key: string): boolean {
  return collapsedCustomers.value.has(key);
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
        <select v-model.number="newCustomerId" class="customer-select">
          <option :value="null">（顧客未指定）</option>
          <option v-for="c in customers.activeItems" :key="c.id" :value="c.id">
            {{ c.code ? `[${c.code}] ` : '' }}{{ c.name }}
          </option>
        </select>
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
      <p v-if="customers.activeItems.length === 0" class="hint">
        まだ顧客が登録されていません。
        <RouterLink to="/customers" class="link">顧客マスタ</RouterLink>
        から先に登録すると一覧がグループ表示されます。
      </p>
    </section>

    <section class="card">
      <h2>プロジェクト一覧</h2>
      <p v-if="projects.loading" class="muted">読込中…</p>
      <p v-else-if="projects.error" class="error">{{ projects.error }}</p>
      <p v-else-if="projects.items.length === 0" class="muted">
        まだプロジェクトがありません。上のフォームから作成してください。
      </p>
      <div v-else class="groups">
        <section v-for="g in grouped" :key="g.key" class="group">
          <header class="group-header" @click="toggleGroup(g.key)">
            <button class="caret" type="button" :aria-expanded="!isCollapsed(g.key)">
              {{ isCollapsed(g.key) ? '▶' : '▼' }}
            </button>
            <span class="group-label" :class="{ none: g.customerId === null, inactive: g.isInactive }">
              {{ g.label }}
            </span>
            <span class="group-count">{{ g.projects.length }} 件</span>
          </header>
          <ul v-show="!isCollapsed(g.key)" class="rows">
            <li v-for="p in g.projects" :key="p.id">
              <button class="row-main" type="button" @click="open(p.id)">
                <span class="row-name">{{ p.name }}</span>
                <span class="row-meta">作成: {{ formatCreatedAt(p.createdAt) }}</span>
              </button>
              <span class="row-actions">
                <button class="btn small" type="button" @click="onRename(p.id, p.name)">名前変更</button>
                <button class="btn small" type="button" @click="onChangeCustomer(p)">顧客変更</button>
                <button class="btn small danger" type="button" @click="onDelete(p.id, p.name)">削除</button>
              </span>
            </li>
          </ul>
        </section>
      </div>
    </section>
  </div>
</template>

<style scoped>
.project-list {
  max-width: 820px;
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
.customer-select {
  padding: 0.4rem 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font: inherit;
  min-width: 200px;
}
.create-form input {
  flex: 1;
  padding: 0.4rem 0.55rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font: inherit;
}
.hint {
  margin-top: 0.5rem;
  color: #6b7280;
  font-size: 0.85rem;
}
.link {
  color: #2563eb;
  text-decoration: none;
}
.link:hover { text-decoration: underline; }
.groups {
  display: grid;
  gap: 0.6rem;
}
.group {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  overflow: hidden;
  background: #f9fafb;
}
.group-header {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.45rem 0.75rem;
  cursor: pointer;
  user-select: none;
  background: #eef2ff;
  border-bottom: 1px solid #e0e7ff;
}
.group-header:hover {
  background: #e0e7ff;
}
.caret {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 0.85rem;
  color: #475569;
  padding: 0 0.2rem;
}
.group-label {
  font-weight: 600;
  color: #1e3a8a;
}
.group-label.none {
  color: #6b7280;
  font-weight: 500;
  font-style: italic;
}
.group-label.inactive {
  color: #9ca3af;
}
.group-count {
  margin-left: auto;
  font-size: 0.78rem;
  color: #6b7280;
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0.5rem;
  display: grid;
  gap: 0.4rem;
  background: #fff;
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
  font-size: 0.78rem;
  color: #6b7280;
}
.row-actions {
  display: flex;
  gap: 0.3rem;
  flex-wrap: wrap;
}
.btn {
  border: 1px solid #d1d5db;
  background: #fff;
  border-radius: 4px;
  padding: 0.4rem 0.9rem;
  cursor: pointer;
  font-size: 0.85rem;
}
.btn:hover {
  background: #f9fafb;
}
.btn.small {
  padding: 0.25rem 0.55rem;
  font-size: 0.78rem;
}
.btn.primary {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.btn.primary:hover {
  background: #1d4ed8;
}
.btn.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn.danger:hover {
  background: #fef2f2;
  border-color: #fecaca;
  color: #b91c1c;
}
.muted {
  color: #6b7280;
}
.error {
  color: #b91c1c;
}
</style>
