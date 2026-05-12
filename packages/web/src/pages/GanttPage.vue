<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
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
const collapsedIds = ref<Set<number>>(new Set());

const STORAGE_KEY_WIDTH = 'wbs.gantt.leftWidth';
const STORAGE_KEY_VIS = 'wbs.gantt.visibility';
type ColumnVisibility = { hours: boolean; actual: boolean; status: boolean };

const initialVisibility = (() => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_VIS);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ColumnVisibility>;
      return {
        hours: Boolean(parsed.hours),
        actual: Boolean(parsed.actual),
        status: Boolean(parsed.status),
      };
    }
  } catch {
    /* fall through */
  }
  return { hours: false, actual: false, status: false };
})();
const visibility = ref<ColumnVisibility>(initialVisibility);

const STORAGE_KEY_CASCADE = 'wbs.gantt.cascade';
// Default ON — preserves "edit one task, schedule shifts" behaviour out of the box.
const cascadeEnabled = ref<boolean>(
  window.localStorage.getItem(STORAGE_KEY_CASCADE) !== '0',
);
function toggleCascade(): void {
  cascadeEnabled.value = !cascadeEnabled.value;
  window.localStorage.setItem(STORAGE_KEY_CASCADE, cascadeEnabled.value ? '1' : '0');
}

// --- Vertical scroll sync between the left task table and the right gantt ---
const splitRef = ref<HTMLElement | null>(null);
const leftPaneRef = ref<HTMLElement | null>(null);
const rightPaneRef = ref<HTMLElement | null>(null);
let scrollSyncing = false;
let scrollSyncDetach: (() => void) | null = null;

function collectScrollables(): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (leftPaneRef.value) out.push(leftPaneRef.value);
  if (rightPaneRef.value) {
    out.push(rightPaneRef.value);
    // Frappe Gantt creates an inner .gantt-container element that has its
    // own overflow:auto. Include every nested .gantt-container so vertical
    // scroll stays in lockstep across all of them.
    rightPaneRef.value
      .querySelectorAll<HTMLElement>('.gantt-container, .gantt-wrapper')
      .forEach((el) => out.push(el));
  }
  return out;
}

function setupScrollSync(): void {
  if (scrollSyncDetach) scrollSyncDetach();
  const split = splitRef.value;
  if (!split) return;
  const handler = (e: Event): void => {
    if (scrollSyncing) return;
    const target = e.target as HTMLElement | null;
    if (!target || typeof target.scrollTop !== 'number') return;
    if (!split.contains(target)) return;
    scrollSyncing = true;
    const newTop = target.scrollTop;
    for (const el of collectScrollables()) {
      if (el !== target && Math.abs(el.scrollTop - newTop) > 0.5) {
        el.scrollTop = newTop;
      }
    }
    requestAnimationFrame(() => {
      scrollSyncing = false;
    });
  };
  split.addEventListener('scroll', handler, { capture: true, passive: true });
  scrollSyncDetach = () => split.removeEventListener('scroll', handler, true as unknown as EventListenerOptions);
}

onMounted(() => {
  nextTick(setupScrollSync);
});
onBeforeUnmount(() => {
  if (scrollSyncDetach) scrollSyncDetach();
});

// Re-bind after the split mounts/un-mounts (e.g. when project has tasks/no tasks).
watch(
  () => tasks.items.length > 0,
  () => nextTick(setupScrollSync),
);

const initialWidth = (() => {
  const stored = Number(window.localStorage.getItem(STORAGE_KEY_WIDTH));
  const needed = (() => {
    let w = 20 + 22 + 30 + 160 + 115 + 42 + 115 + 72 + 84 + 108 + 28;
    if (initialVisibility.hours) w += 56;
    if (initialVisibility.actual) {
      w += 115 + 115;
      if (initialVisibility.hours) w += 56;
    }
    if (initialVisibility.status) w += 84;
    return w;
  })();
  const fromStorage = Number.isFinite(stored) && stored >= 400 ? stored : 700;
  return Math.max(fromStorage, needed);
})();
const leftWidth = ref<number>(initialWidth);

function requiredTableWidth(v: ColumnVisibility): number {
  // Mirrors the column widths defined in TaskTable.gridTemplate, plus gaps + pane padding.
  let w = 20 + 22 + 30 + 160; // meta block (name has minmax(150,1.4fr) - reserve 160)
  w += 115 + 42 + 115; // planned start / dur / end
  if (v.hours) w += 56;
  if (v.actual) {
    w += 115 + 115;
    if (v.hours) w += 56;
  }
  w += 72 + 84; // progress / assignee
  if (v.status) w += 84; // min status width
  w += 108; // actions
  // Account for grid gaps (~0.2rem each) + pane padding / border.
  return w + 28;
}

function toggleVisibility(key: keyof ColumnVisibility): void {
  visibility.value = { ...visibility.value, [key]: !visibility.value[key] };
  window.localStorage.setItem(STORAGE_KEY_VIS, JSON.stringify(visibility.value));
  // Auto-widen the left pane if the new column set won't fit.
  const needed = requiredTableWidth(visibility.value);
  const maxX = window.innerWidth - 320;
  const target = Math.min(needed, maxX);
  if (leftWidth.value < target) {
    leftWidth.value = target;
    window.localStorage.setItem(STORAGE_KEY_WIDTH, String(target));
  }
}

function onSplitterMouseDown(event: MouseEvent): void {
  event.preventDefault();
  const startX = event.clientX;
  const startWidth = leftWidth.value;
  const maxX = window.innerWidth - 320;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';

  const onMove = (ev: MouseEvent): void => {
    const delta = ev.clientX - startX;
    const next = Math.max(400, Math.min(maxX, startWidth + delta));
    leftWidth.value = next;
  };
  const onUp = (): void => {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    window.localStorage.setItem(STORAGE_KEY_WIDTH, String(leftWidth.value));
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

const project = computed(() =>
  projects.items.find((p) => p.id === props.projectId),
);

const treeOrderedTasks = computed<WbsTask[]>(() => {
  const byParent = new Map<number, WbsTask[]>();
  for (const t of tasks.items) {
    const key = t.parentId ?? 0;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(t);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }
  const out: WbsTask[] = [];
  const walk = (parentId: number): void => {
    for (const t of byParent.get(parentId) ?? []) {
      out.push(t);
      walk(t.id);
    }
  };
  walk(0);
  return out;
});

const childCountByParent = computed<Map<number, number>>(() => {
  const m = new Map<number, number>();
  for (const t of tasks.items) {
    if (t.parentId !== null) {
      m.set(t.parentId, (m.get(t.parentId) ?? 0) + 1);
    }
  }
  return m;
});

const visibleTasks = computed<WbsTask[]>(() => {
  const collapsed = collapsedIds.value;
  if (collapsed.size === 0) return treeOrderedTasks.value;
  const result: WbsTask[] = [];
  const hiddenAncestors = new Set<number>();
  for (const t of treeOrderedTasks.value) {
    if (t.parentId !== null && hiddenAncestors.has(t.parentId)) {
      hiddenAncestors.add(t.id);
      continue;
    }
    result.push(t);
    if (collapsed.has(t.id)) {
      hiddenAncestors.add(t.id);
    }
  }
  return result;
});

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

function toggleCollapse(id: number): void {
  const next = new Set(collapsedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsedIds.value = next;
}

function expandAll(): void {
  collapsedIds.value = new Set();
}

function collapseAll(): void {
  const next = new Set<number>();
  for (const t of tasks.items) {
    if (t.level < 3 && (childCountByParent.value.get(t.id) ?? 0) > 0) {
      next.add(t.id);
    }
  }
  collapsedIds.value = next;
}

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
  // Auto-expand parent when adding a child to it.
  if (collapsedIds.value.has(parent.id)) {
    const next = new Set(collapsedIds.value);
    next.delete(parent.id);
    collapsedIds.value = next;
  }
}

async function onUpdate(id: number, patch: Partial<WbsTask>): Promise<void> {
  const allowed: Record<string, unknown> = {};
  if (patch.name !== undefined) allowed.name = patch.name;
  if (patch.startDate !== undefined && patch.startDate !== null) allowed.startDate = patch.startDate;
  if (patch.duration !== undefined && patch.duration !== null) allowed.duration = patch.duration;
  if (patch.actualStartDate !== undefined) allowed.actualStartDate = patch.actualStartDate;
  if (patch.actualEndDate !== undefined) allowed.actualEndDate = patch.actualEndDate;
  if (patch.plannedHours !== undefined) allowed.plannedHours = patch.plannedHours;
  if (patch.actualHours !== undefined) allowed.actualHours = patch.actualHours;
  if (patch.progress !== undefined) allowed.progress = patch.progress;
  if (patch.assigneeId !== undefined) allowed.assigneeId = patch.assigneeId;
  if (patch.status !== undefined) allowed.status = patch.status;
  if (!cascadeEnabled.value) allowed.cascade = false;
  await tasks.update(id, allowed);
}

async function onRemove(id: number): Promise<void> {
  if (!window.confirm('このタスクを削除します。よろしいですか？（配下のタスクも削除されます）')) {
    return;
  }
  await tasks.remove(id);
}

/**
 * When DnD reorders the *visible* rows, rebuild the full sortOrder for the project
 * such that any hidden descendants stay grouped under their (visible) ancestor.
 */
async function onReorder(visibleNext: WbsTask[]): Promise<void> {
  const visibleIds = new Set(visibleNext.map((t) => t.id));
  const all = tasks.items;
  const taskById = new Map<number, WbsTask>();
  for (const t of all) taskById.set(t.id, t);

  const findVisibleAncestor = (taskId: number): number | null => {
    const t = taskById.get(taskId);
    if (!t || t.parentId === null) return null;
    if (visibleIds.has(t.parentId)) return t.parentId;
    return findVisibleAncestor(t.parentId);
  };

  const hiddenUnder = new Map<number, WbsTask[]>();
  for (const t of all) {
    if (visibleIds.has(t.id)) continue;
    const ancId = findVisibleAncestor(t.id);
    if (ancId === null) continue;
    const arr = hiddenUnder.get(ancId) ?? [];
    arr.push(t);
    hiddenUnder.set(ancId, arr);
  }
  for (const arr of hiddenUnder.values()) {
    arr.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  const fullOrder: WbsTask[] = [];
  for (const v of visibleNext) {
    fullOrder.push(v);
    const kids = hiddenUnder.get(v.id) ?? [];
    fullOrder.push(...kids);
  }

  const items = fullOrder.map((t, idx) => ({ id: t.id, sortOrder: idx }));
  await tasks.reorder(items);
}

async function onAddAssignee(): Promise<void> {
  const name = newAssigneeName.value.trim();
  if (!name) return;
  await assignees.create(name);
  newAssigneeName.value = '';
}

async function onChartDateChange(taskId: number, start: string, end: string): Promise<void> {
  const task = tasks.items.find((t) => t.id === taskId);
  if (!task || task.level !== 3) return;
  const startDate = start;
  const duration = businessDaysBetween(start, end);
  if (duration < 1) return;
  const patch: { startDate: string; duration: number; cascade?: boolean } = {
    startDate,
    duration,
  };
  if (!cascadeEnabled.value) patch.cascade = false;
  await tasks.update(taskId, patch);
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
        <button
          class="btn pill cascade"
          :class="{ active: cascadeEnabled }"
          type="button"
          :title="cascadeEnabled
            ? '連動 ON: 予定日を変えると同じ中項目の後続タスクも自動でシフトします。クリックで OFF。'
            : '連動 OFF: 予定日を変えてもこのタスクだけ更新されます。クリックで ON。'"
          @click="toggleCascade"
        >{{ cascadeEnabled ? '🔗 連動 ON' : '🔓 連動 OFF' }}</button>
        <span class="action-sep" aria-hidden="true">│</span>
        <span class="action-sep">列:</span>
        <button
          class="btn pill"
          :class="{ active: visibility.hours }"
          type="button"
          :title="visibility.hours ? '工数列を隠す' : '工数列を表示'"
          @click="toggleVisibility('hours')"
        >工数</button>
        <button
          class="btn pill"
          :class="{ active: visibility.actual }"
          type="button"
          :title="visibility.actual ? '実績日付列を隠す' : '実績日付列を表示'"
          @click="toggleVisibility('actual')"
        >実績</button>
        <button
          class="btn pill"
          :class="{ active: visibility.status }"
          type="button"
          :title="visibility.status ? '状態列を隠す' : '状態列を表示'"
          @click="toggleVisibility('status')"
        >状態</button>
        <span class="action-sep" aria-hidden="true">│</span>
        <button class="btn" type="button" @click="expandAll" title="すべて展開">展開</button>
        <button class="btn" type="button" @click="collapseAll" title="すべて折りたたみ">折畳</button>
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
    <div v-else class="split-viewport" ref="splitRef">
      <div
        class="split"
        :style="{ gridTemplateColumns: `${leftWidth}px 6px minmax(280px, 1fr)` }"
      >
        <div class="pane left" ref="leftPaneRef" aria-label="task list">
          <TaskTable
            :tasks="visibleTasks"
            :assignees="assignees.items"
            :collapsed-ids="collapsedIds"
            :child-count-by-parent="childCountByParent"
            :visibility="visibility"
            @reorder="onReorder"
            @update="onUpdate"
            @add-child="onAddChild"
            @remove="onRemove"
            @toggle-collapse="toggleCollapse"
          />
        </div>
        <div
          class="splitter"
          role="separator"
          aria-orientation="vertical"
          :aria-valuenow="leftWidth"
          title="ドラッグして左右の幅を変更"
          @mousedown="onSplitterMouseDown"
        ></div>
        <div class="pane right" ref="rightPaneRef" aria-label="gantt chart">
          <GanttChart
            :tasks="visibleTasks"
            @date-change="onChartDateChange"
            @progress-change="onChartProgressChange"
          />
        </div>
      </div>
    </div>
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
.actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}
.action-sep {
  color: #9ca3af;
  font-size: 0.78rem;
  padding: 0 0.1rem;
}
.btn.pill {
  padding: 0.2rem 0.55rem;
  font-size: 0.78rem;
  border-radius: 999px;
}
.btn.pill.active {
  background: #1e3a8a;
  color: #fff;
  border-color: #1e3a8a;
}
.btn.pill.cascade.active {
  background: #166534;
  border-color: #166534;
}
.btn.pill.cascade:not(.active) {
  background: #fef2f2;
  border-color: #fecaca;
  color: #991b1b;
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
/* Single viewport that owns vertical scroll for both panes. The .split
   inside grows to whatever its tallest pane needs, so scrolling here
   moves the table and the gantt together. */
.split-viewport {
  height: calc(100vh - 220px);
  min-height: 360px;
  overflow-y: auto;
  overflow-x: hidden;
}
.split {
  display: grid;
  /* grid-template-columns is set inline by leftWidth ref */
  gap: 0;
  /* stretch so the splitter (which has no own height) fills the row height
     defined by the taller pane and stays grab-able along the full edge */
  align-items: stretch;
}
.pane {
  min-width: 0;
  overflow-x: auto;
  overflow-y: visible;
}
.splitter {
  width: 6px;
  background: transparent;
  cursor: col-resize;
  position: relative;
  user-select: none;
}
.splitter::before {
  content: '';
  position: absolute;
  inset: 0 2px;
  background: #cbd5e1;
  border-radius: 2px;
  transition: background 0.15s;
}
.splitter:hover::before,
.splitter:active::before {
  background: #2563eb;
}
@media (max-width: 1100px) {
  .split {
    display: block;
    height: auto;
  }
  .pane { height: auto; max-height: 60vh; }
  .splitter { display: none; }
}
.muted {
  color: #6b7280;
}
.error {
  color: #b91c1c;
}
</style>
