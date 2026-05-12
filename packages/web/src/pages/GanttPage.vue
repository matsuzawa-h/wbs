<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useTasksStore } from '@/stores/tasks';
import { useAssigneesStore } from '@/stores/assignees';
import { useProjectsStore } from '@/stores/projects';
import TaskTable from '@/components/TaskTable.vue';
import GanttChart from '@/components/GanttChart.vue';
import type { WbsTask } from '@/types';

const props = defineProps<{ projectId: number }>();

const tasks = useTasksStore();
const assignees = useAssigneesStore();
const projects = useProjectsStore();
const router = useRouter();

const newAssigneeName = ref('');

const project = computed(() =>
  projects.items.find((p) => p.id === props.projectId),
);

onMounted(async () => {
  await Promise.all([
    tasks.fetchByProject(props.projectId),
    assignees.fetchAll(),
    projects.fetchAll(),
  ]);
});

watch(
  () => props.projectId,
  (id) => tasks.fetchByProject(id),
);

async function addTopLevel(): Promise<void> {
  const name = window.prompt('大項目名を入力してください');
  if (!name) return;
  await tasks.create({ level: 1, name: name.trim() });
}

async function onAddChild(parent: WbsTask | null, level: 1 | 2 | 3): Promise<void> {
  if (!parent) return;
  const label = level === 2 ? '中項目' : '項目';
  const name = window.prompt(`${label}名を入力してください`);
  if (!name) return;
  if (level === 3) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    await tasks.create({
      level: 3,
      parentId: parent.id,
      name: name.trim(),
      startDate: `${yyyy}-${mm}-${dd}`,
      duration: 1,
    });
  } else {
    await tasks.create({ level: 2, parentId: parent.id, name: name.trim() });
  }
}

async function onUpdate(id: number, patch: Partial<WbsTask>): Promise<void> {
  const allowed: Record<string, unknown> = {};
  if (patch.name !== undefined) allowed.name = patch.name;
  if (patch.startDate !== undefined && patch.startDate !== null) allowed.startDate = patch.startDate;
  if (patch.duration !== undefined && patch.duration !== null) allowed.duration = patch.duration;
  if (patch.progress !== undefined) allowed.progress = patch.progress;
  if (patch.assigneeId !== undefined) allowed.assigneeId = patch.assigneeId;
  if (patch.status !== undefined) allowed.status = patch.status;
  await tasks.update(id, allowed);
}

async function onRemove(id: number): Promise<void> {
  if (!window.confirm('このタスクを削除します。よろしいですか？（配下のタスクも削除されます）')) {
    return;
  }
  await tasks.remove(id);
}

async function onReorder(next: WbsTask[]): Promise<void> {
  const items = next.map((t, idx) => ({ id: t.id, sortOrder: idx }));
  await tasks.reorder(items);
}

async function onAddAssignee(): Promise<void> {
  const name = newAssigneeName.value.trim();
  if (!name) return;
  await assignees.create(name);
  newAssigneeName.value = '';
}

// Frappe Gantt drag/resize -> compute duration from start+end and update server.
// Only level-3 tasks accept date edits; the API will return 400 for aggregates.
async function onChartDateChange(taskId: number, start: string, end: string): Promise<void> {
  const task = tasks.items.find((t) => t.id === taskId);
  if (!task || task.level !== 3) return;
  const startDate = start;
  const duration = businessDaysBetween(start, end);
  if (duration < 1) return;
  await tasks.update(taskId, { startDate, duration });
}

async function onChartProgressChange(taskId: number, progress: number): Promise<void> {
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));
  await tasks.update(taskId, { progress: clamped });
}

function businessDaysBetween(startISO: string, endISO: string): number {
  const start = parseIso(startISO);
  const end = parseIso(endISO);
  if (start > end) return 0;
  let count = 0;
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

function parseIso(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

function back(): void {
  router.push({ name: 'projects' });
}
</script>

<template>
  <div class="gantt-page">
    <header class="page-header">
      <button class="btn" type="button" @click="back">← プロジェクト一覧</button>
      <h2 class="title">
        <span v-if="project">{{ project.name }}</span>
        <span v-else class="muted">プロジェクト #{{ projectId }}</span>
      </h2>
      <div class="actions">
        <button class="btn primary" type="button" @click="addTopLevel">+ 大項目</button>
      </div>
    </header>

    <section class="assignee-row">
      <strong>担当者：</strong>
      <span v-for="a in assignees.items" :key="a.id" class="chip">{{ a.name }}</span>
      <input
        v-model="newAssigneeName"
        type="text"
        placeholder="新規担当者"
        @keydown.enter.prevent="onAddAssignee"
      />
      <button class="btn" type="button" @click="onAddAssignee">追加</button>
    </section>

    <p v-if="tasks.loading" class="muted">読込中…</p>
    <p v-else-if="tasks.error" class="error">{{ tasks.error }}</p>
    <p v-else-if="tasks.items.length === 0" class="muted">
      まだタスクがありません。右上の「+ 大項目」から追加してください。
    </p>
    <template v-else>
      <GanttChart
        :tasks="tasks.items"
        @date-change="onChartDateChange"
        @progress-change="onChartProgressChange"
      />
      <TaskTable
        :tasks="tasks.items"
        :assignees="assignees.items"
        @reorder="onReorder"
        @update="onUpdate"
        @add-child="onAddChild"
        @remove="onRemove"
      />
    </template>
  </div>
</template>

<style scoped>
.gantt-page {
  display: grid;
  gap: 0.75rem;
}
.page-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.title {
  margin: 0;
  flex: 1;
  font-size: 1.1rem;
}
.assignee-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.75rem;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
}
.chip {
  display: inline-block;
  padding: 0.15rem 0.6rem;
  background: #eef2ff;
  border: 1px solid #c7d2fe;
  border-radius: 999px;
  font-size: 0.8rem;
}
.muted {
  color: #6b7280;
}
.error {
  color: #b91c1c;
}
</style>
