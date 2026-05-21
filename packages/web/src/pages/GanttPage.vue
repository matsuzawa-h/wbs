<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { computeStatus, STATUS_BUCKETS, todayUtc } from '@/utils/status';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useTasksStore } from '@/stores/tasks';
import { useEmployeesStore } from '@/stores/employees';
import { useProjectsStore } from '@/stores/projects';
import { useHolidaysStore } from '@/stores/holidays';
import { useProjectMembersStore } from '@/stores/projectMembers';
import TaskTable from '@/components/TaskTable.vue';
import GanttChart from '@/components/GanttChart.vue';
import ProjectMembersDialog from '@/components/ProjectMembersDialog.vue';
import TaskNoteDialog from '@/components/TaskNoteDialog.vue';
import type { Employee, WbsTask } from '@/types';

const props = defineProps<{ projectId: number }>();

const tasks = useTasksStore();
const assignees = useEmployeesStore();
const projects = useProjectsStore();
const holidays = useHolidaysStore();
const projectMembersStore = useProjectMembersStore();
const router = useRouter();
const route = useRoute();

const collapsedIds = ref<Set<number>>(new Set());
const membersDialogOpen = ref(false);
// The level-3 task whose 備考 popup is open (null = closed).
const noteTask = ref<WbsTask | null>(null);
// Task to keep centered after a gantt-driven date change (one-shot;
// GanttChart clears it via @focus-applied once it has scrolled there).
const ganttFocusTaskId = ref<number | null>(null);

function openNote(task: WbsTask): void {
  noteTask.value = task;
}
async function onSaveNote(note: string | null): Promise<void> {
  const t = noteTask.value;
  if (!t) return;
  await onUpdate(t.id, { note });
  noteTask.value = null;
}

// Members live in projectMembersStore keyed by projectId; resolved per render.
const projectMembers = computed<Employee[]>(() =>
  projectMembersStore.membersOf(props.projectId),
);
const projectMemberIds = computed<Set<number>>(
  () => new Set(projectMembers.value.map((m) => m.id)),
);

// Every employee referenced by at least one task in this project. Used by the
// members dialog to warn when an assigned employee is being deselected.
const assignedEmployeeIds = computed<number[]>(() => {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const t of tasks.items) {
    if (t.assigneeId !== null && t.assigneeId !== undefined && !seen.has(t.assigneeId)) {
      seen.add(t.assigneeId);
      out.push(t.assigneeId);
    }
  }
  return out;
});

// Subset that are NOT currently members — these get the "（メンバー外）" tag in
// the chip row and dropdown.
const assignedNonMemberIds = computed<number[]>(() =>
  assignedEmployeeIds.value.filter((id) => !projectMemberIds.value.has(id)),
);

// Combined list passed to TaskTable: members first, then orphaned assignees.
const projectAssignees = computed<Employee[]>(() => {
  const empById = new Map(assignees.items.map((e) => [e.id, e]));
  const result: Employee[] = [];
  for (const m of projectMembers.value) result.push(m);
  for (const id of assignedNonMemberIds.value) {
    const e = empById.get(id);
    if (e) result.push(e);
  }
  return result;
});

// --- Column filters (Excel-style) ---
type FilterValue = string | number | null;
interface ColumnFilters {
  name: string;
  levels: Set<number> | null;
  assigneeIds: Set<FilterValue> | null;
  statuses: Set<FilterValue> | null;
}
const filters = ref<ColumnFilters>({
  name: '',
  levels: null,
  assigneeIds: null,
  statuses: null,
});

function setNameFilter(v: string): void {
  filters.value = { ...filters.value, name: v };
}
function setLevelsFilter(v: Set<FilterValue> | null): void {
  filters.value = {
    ...filters.value,
    levels: v ? (new Set(Array.from(v).map((x) => Number(x))) as Set<number>) : null,
  };
}
function setAssigneesFilter(v: Set<FilterValue> | null): void {
  filters.value = { ...filters.value, assigneeIds: v };
}
function setStatusesFilter(v: Set<FilterValue> | null): void {
  filters.value = { ...filters.value, statuses: v };
}
function clearAllFilters(): void {
  filters.value = { name: '', levels: null, assigneeIds: null, statuses: null };
}
const hasActiveFilters = computed(
  () =>
    filters.value.name !== '' ||
    filters.value.levels !== null ||
    filters.value.assigneeIds !== null ||
    filters.value.statuses !== null,
);

// Filter option lists for the popovers
const filterOptions = computed(() => ({
  levels: [
    { value: 1, label: '大項目' },
    { value: 2, label: '中項目' },
    { value: 3, label: '項目' },
  ],
  assigneeIds: [
    { value: null as FilterValue, label: '未割当' },
    ...projectAssignees.value.map((a) => ({ value: a.id as FilterValue, label: a.name })),
  ],
  // Fixed set of computed status buckets, not free-text values.
  statuses: STATUS_BUCKETS.map((b) => ({ value: b.bucket as FilterValue, label: b.label })),
}));

// Compute matched task ids (those that pass every active filter)
const matchedTaskIds = computed<Set<number> | null>(() => {
  if (!hasActiveFilters.value) return null;
  const f = filters.value;
  const needle = f.name.trim().toLowerCase();
  const todayD = todayUtc();
  const matched = new Set<number>();
  for (const t of tasks.items) {
    if (needle && !t.name.toLowerCase().includes(needle)) continue;
    if (f.levels !== null && !f.levels.has(t.level)) continue;
    if (f.assigneeIds !== null && !f.assigneeIds.has(t.assigneeId)) continue;
    if (f.statuses !== null) {
      const bucket = computeStatus(t, todayD).bucket as FilterValue;
      if (!f.statuses.has(bucket)) continue;
    }
    matched.add(t.id);
  }
  return matched;
});

// Matched + their ancestors so the tree context survives the filter
const visibleAfterFilter = computed<Set<number> | null>(() => {
  const m = matchedTaskIds.value;
  if (m === null) return null;
  const byId = new Map<number, WbsTask>();
  for (const t of tasks.items) byId.set(t.id, t);
  const result = new Set(m);
  for (const id of m) {
    let cur = byId.get(id);
    while (cur && cur.parentId !== null && cur.parentId !== undefined) {
      result.add(cur.parentId);
      cur = byId.get(cur.parentId);
    }
  }
  return result;
});

// When a filter activates, auto-expand any collapsed ancestors of matches
// so the user actually sees their matches.
watch(matchedTaskIds, (matched) => {
  if (!matched || matched.size === 0) return;
  if (collapsedIds.value.size === 0) return;
  const byId = new Map<number, WbsTask>();
  for (const t of tasks.items) byId.set(t.id, t);
  const ancestors = new Set<number>();
  for (const id of matched) {
    let cur = byId.get(id);
    while (cur && cur.parentId !== null && cur.parentId !== undefined) {
      ancestors.add(cur.parentId);
      cur = byId.get(cur.parentId);
    }
  }
  const next = new Set(collapsedIds.value);
  let changed = false;
  for (const id of ancestors) {
    if (next.delete(id)) changed = true;
  }
  if (changed) collapsedIds.value = next;
});

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
  // Mirror every scroll event immediately. `scrollSyncing` only guards
  // re-entrancy within the *same* synchronous call; it is cleared before
  // returning, so the asynchronous echo (from assigning scrollTop) is still
  // processed — but becomes a no-op because the panes are already within
  // 1px. Crucially no event is dropped, so the final position can never be
  // left out of sync (the cause of the gradual scroll drift).
  const handler = (e: Event): void => {
    if (scrollSyncing) return;
    const target = e.target as HTMLElement | null;
    if (!target || typeof target.scrollTop !== 'number') return;
    if (!split.contains(target)) return;
    // Only the two real panes may DRIVE the vertical sync. frappe's inner
    // gantt scroller fires 'scroll' for horizontal movement too — notably
    // the init scrollLeft on every rebuild and the focus scrollLeft after a
    // date edit, both with scrollTop 0. If those were treated as a vertical
    // source the 0 would be mirrored onto the panes, snapping them to the
    // top. The panes are persistent elements; the gantt body still scrolls
    // vertically *through* .pane.right, so wheel scrolling keeps working.
    if (target !== leftPaneRef.value && target !== rightPaneRef.value) return;
    scrollSyncing = true;
    const newTop = Math.round(target.scrollTop);
    for (const el of collectScrollables()) {
      if (el !== target && Math.abs(el.scrollTop - newTop) > 1) {
        el.scrollTop = newTop;
      }
    }
    scrollSyncing = false;
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

// Bind when .split-viewport first mounts (and on the rare full remount, e.g.
// initial load / first-ever task). It intentionally does NOT remount on
// create/update/remove anymore — the loading placeholder is gated on
// `items.length === 0`, so the element (and its scroll position) survives an
// edit. The listener follows the *element*, so a one-time bind is enough.
watch(splitRef, () => nextTick(setupScrollSync));

const initialWidth = (() => {
  const stored = Number(window.localStorage.getItem(STORAGE_KEY_WIDTH));
  const needed = (() => {
    let w = 20 + 22 + 46 + 112 + 160 + 115 + 42 + 115 + 72 + 84 + 62 + 28;
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
  let w = 20 + 22 + 46 + 112 + 160; // meta block: handle/toggle/階層/行操作/名称
  w += 115 + 42 + 115; // planned start / dur / end
  if (v.hours) w += 56;
  if (v.actual) {
    w += 115 + 115;
    if (v.hours) w += 56;
  }
  w += 72 + 84; // progress / assignee
  if (v.status) w += 84; // min status width
  w += 62; // actions (削除 only)
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
  // Apply column filter (matched + ancestors). If no filter is active, pass through.
  const allowed = visibleAfterFilter.value;
  if (allowed === null) return out;
  return out.filter((t) => allowed.has(t.id));
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
    holidays.fetchAll(),
    projectMembersStore.fetchMembers(props.projectId),
  ]);
  applyFocusFromQuery();
});

// When the user lands on this page from the cross-project assignments view
// (URL `?focus=<taskId>`), expand the task's ancestors so it's visible,
// scroll to it, and briefly highlight the row.
function applyFocusFromQuery(): void {
  const raw = route.query.focus;
  const focusId = typeof raw === 'string' ? Number(raw) : null;
  if (!focusId || Number.isNaN(focusId)) return;
  const task = tasks.items.find((t) => t.id === focusId);
  if (!task) return;
  // Walk up the ancestor chain and remove them from the collapsed set.
  const byId = new Map(tasks.items.map((t) => [t.id, t]));
  const next = new Set(collapsedIds.value);
  let cursor: WbsTask | undefined = task;
  while (cursor && cursor.parentId !== null && cursor.parentId !== undefined) {
    next.delete(cursor.parentId);
    cursor = byId.get(cursor.parentId);
  }
  collapsedIds.value = next;
  nextTick(() => {
    const input = document.querySelector<HTMLElement>(`input[data-task-name="${focusId}"]`);
    if (input) {
      input.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const target = input.closest<HTMLElement>('.row.body') ?? input;
      target.classList.add('focus-highlight');
      setTimeout(() => target.classList.remove('focus-highlight'), 2500);
    }
  });
}

watch(
  () => props.projectId,
  (id) => {
    tasks.fetchByProject(id);
    projectMembersStore.fetchMembers(id);
  },
);

async function onSaveMembers(employeeIds: number[]): Promise<void> {
  await projectMembersStore.setMembers(props.projectId, employeeIds);
  membersDialogOpen.value = false;
}

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

// Show down to 中項目: keep 大項目 expanded (so 中項目 is visible) but
// collapse every 中項目 that has children (so 項目 is hidden).
function collapseToMid(): void {
  const next = new Set<number>();
  for (const t of tasks.items) {
    if (t.level === 2 && (childCountByParent.value.get(t.id) ?? 0) > 0) {
      next.add(t.id);
    }
  }
  collapsedIds.value = next;
}

async function addTopLevel(): Promise<void> {
  const created = await tasks.create({ level: 1, name: '' });
  focusNameAfterCreate(created?.id);
}

async function onAddChild(parent: WbsTask | null, level: 1 | 2 | 3): Promise<void> {
  if (!parent) return;
  let created;
  if (level === 3) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    created = await tasks.create({
      level: 3,
      parentId: parent.id,
      name: '',
      startDate: `${yyyy}-${mm}-${dd}`,
      duration: 1,
    });
  } else {
    created = await tasks.create({ level: 2, parentId: parent.id, name: '' });
  }
  // Auto-expand parent when adding a child to it.
  if (collapsedIds.value.has(parent.id)) {
    const next = new Set(collapsedIds.value);
    next.delete(parent.id);
    collapsedIds.value = next;
  }
  focusNameAfterCreate(created?.id);
}

// Move keyboard focus to the freshly-created row's name field so the user
// can start typing immediately — supports the "add many rows quickly" flow.
function focusNameAfterCreate(taskId: number | undefined): void {
  if (!taskId) return;
  nextTick(() => {
    const el = document.querySelector<HTMLInputElement>(
      `input[data-task-name="${taskId}"]`,
    );
    if (el) {
      el.focus();
      el.select();
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
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
  if (patch.note !== undefined) allowed.note = patch.note;
  if (!cascadeEnabled.value) allowed.cascade = false;
  // Entering a planned start date (or duration, which moves the bar) should
  // bring that task into view on the gantt — same focus as a bar drag.
  if (patch.startDate !== undefined || patch.duration !== undefined) {
    ganttFocusTaskId.value = id;
  }
  await tasks.update(id, allowed);
}

async function onRemove(id: number): Promise<void> {
  const task = tasks.items.find((t) => t.id === id);
  const name = task?.name?.trim() ? task.name.trim() : '（名称未入力）';
  const hasChildren = (childCountByParent.value.get(id) ?? 0) > 0;
  const message = hasChildren
    ? `「${name}」とその配下のタスクをすべて削除します。よろしいですか？`
    : `「${name}」を削除します。よろしいですか？`;
  if (!window.confirm(message)) {
    return;
  }
  await tasks.remove(id);
}

async function onDuplicate(id: number): Promise<void> {
  const created = await tasks.duplicate(id);
  // Jump focus to the duplicated row's name field for quick editing.
  focusNameAfterCreate(created?.id);
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
  // Keep the edited bar in view after the gantt re-renders. GanttChart
  // remounts on every update, so this lives in the parent and is cleared
  // by the chart's `focus-applied` event once consumed.
  ganttFocusTaskId.value = taskId;
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

// Triggers a download of the project as the legacy .xls. The endpoint
// surgically edits c:/Git/WBS/テンプレートファイル.xls so the file opens
// in Excel with macros still rendering the gantt area. We don't set
// `a.download` — the server returns Content-Disposition with the
// customer_project_timestamp filename, which the browser uses.
function exportXls(): void {
  const url = `/api/projects/${props.projectId}/export.xls`;
  const a = document.createElement('a');
  a.href = url;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
</script>

<template>
  <div class="gantt-page">
    <header class="page-header">
      <button class="btn" type="button" @click="back">← プロジェクト一覧</button>
      <h2 class="title">
        <template v-if="project">
          <span v-if="project.customerName" class="customer-tag">{{ project.customerName }}</span>
          <span>{{ project.name }}</span>
        </template>
        <span v-else class="muted">プロジェクト #{{ projectId }}</span>
      </h2>
      <div class="actions">
        <button
          class="toggle-pill cascade"
          :class="{ active: cascadeEnabled }"
          type="button"
          :title="cascadeEnabled
            ? '連動 ON: 予定日を変えると同じ中項目の後続タスクも自動でシフトします。クリックで OFF。'
            : '連動 OFF: 予定日を変えてもこのタスクだけ更新されます。クリックで ON。'"
          @click="toggleCascade"
        >
          <span class="dot" aria-hidden="true"></span>
          連動 {{ cascadeEnabled ? 'ON' : 'OFF' }}
        </button>

        <div class="seg" role="group" aria-label="列表示">
          <span class="seg-label">列</span>
          <button
            class="seg-btn"
            :class="{ active: visibility.hours }"
            type="button"
            :title="visibility.hours ? '工数列を隠す' : '工数列を表示'"
            @click="toggleVisibility('hours')"
          >工数</button>
          <button
            class="seg-btn"
            :class="{ active: visibility.actual }"
            type="button"
            :title="visibility.actual ? '実績日付列を隠す' : '実績日付列を表示'"
            @click="toggleVisibility('actual')"
          >実績</button>
          <button
            class="seg-btn"
            :class="{ active: visibility.status }"
            type="button"
            :title="visibility.status ? '状態列を隠す' : '状態列を表示'"
            @click="toggleVisibility('status')"
          >状態</button>
        </div>

        <div class="seg" role="group" aria-label="階層の開閉">
          <button class="seg-btn" type="button" @click="expandAll" title="すべて展開（項目まで表示）">展開</button>
          <button class="seg-btn" type="button" @click="collapseToMid" title="中項目まで表示（項目を折りたたむ）">中まで</button>
          <button class="seg-btn" type="button" @click="collapseAll" title="すべて折りたたみ（大項目のみ表示）">折畳</button>
        </div>

        <button
          v-if="hasActiveFilters"
          class="btn"
          type="button"
          title="すべてのフィルタを解除"
          @click="clearAllFilters"
        >フィルタ解除</button>
        <button
          class="btn"
          type="button"
          title="この案件の担当者ごとの月次工数（稼働見通し）を開きます"
          @click="router.push({ name: 'project-manhours', params: { projectId } })"
        >工数</button>
        <button
          class="btn"
          type="button"
          title="このプロジェクトの工程表を、旧 Excel テンプレートに流し込んでダウンロードします"
          @click="exportXls"
        >Excel 出力</button>
        <button class="btn primary" type="button" @click="addTopLevel">＋ 大項目</button>
      </div>
    </header>

    <section class="assignee-row">
      <strong>メンバー：</strong>
      <span v-if="assignees.activeItems.length === 0" class="muted">
        社員が未登録です。
        <RouterLink to="/employees" class="link">社員マスタ</RouterLink>
        から登録してください。
      </span>
      <template v-else>
        <span v-if="projectMembers.length === 0" class="muted">
          このプロジェクトのメンバーは未設定です。「メンバー管理」から選択してください。
        </span>
        <span v-for="a in projectMembers" :key="a.id" class="chip">{{ a.name }}</span>
        <span
          v-for="id in assignedNonMemberIds"
          :key="`orphan-${id}`"
          class="chip orphan"
          title="メンバー外（既存タスクに割当中）"
        >{{ (assignees.items.find((e) => e.id === id) || { name: '?' }).name }}（メンバー外）</span>
        <button class="btn small" type="button" @click="membersDialogOpen = true">メンバー管理</button>
      </template>
    </section>

    <!-- Show the loading placeholder ONLY on the genuine first load (no rows
         yet). create/update/remove also flip tasks.loading, but items are not
         cleared until the new GET resolves — so keeping the split mounted here
         preserves both panes' scroll position instead of jumping to the top. -->
    <p v-if="tasks.loading && tasks.items.length === 0" class="muted">読込中…</p>
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
            :assignees="projectAssignees"
            :non-member-ids="new Set(assignedNonMemberIds)"
            :collapsed-ids="collapsedIds"
            :child-count-by-parent="childCountByParent"
            :visibility="visibility"
            :filters="filters"
            :filter-options="filterOptions"
            @reorder="onReorder"
            @update="onUpdate"
            @add-child="onAddChild"
            @remove="onRemove"
            @duplicate="onDuplicate"
            @open-note="openNote"
            @toggle-collapse="toggleCollapse"
            @filter-name="setNameFilter"
            @filter-levels="setLevelsFilter"
            @filter-assignees="setAssigneesFilter"
            @filter-statuses="setStatusesFilter"
          />
          <!-- Sticky blank strip mirroring the gantt's always-visible
               horizontal scrollbar strip, so both panes reserve the same
               fixed bottom band and the last row never gets clipped. -->
          <div class="pane-bottom-strip" aria-hidden="true"></div>
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
            :holiday-dates="holidays.dateSet"
            :holiday-names="holidays.dateNameMap"
            :focus-task-id="ganttFocusTaskId"
            @date-change="onChartDateChange"
            @progress-change="onChartProgressChange"
            @focus-applied="ganttFocusTaskId = null"
          />
        </div>
      </div>
    </div>

    <ProjectMembersDialog
      :open="membersDialogOpen"
      :project-name="(projects.items.find((p) => p.id === projectId) || { name: '' }).name"
      :project-organization-id="projects.items.find((p) => p.id === projectId)?.organizationId ?? null"
      :all-employees="assignees.items"
      :current-member-ids="projectMembers.map((m) => m.id)"
      :assigned-employee-ids="assignedEmployeeIds"
      @close="membersDialogOpen = false"
      @save="onSaveMembers"
    />

    <TaskNoteDialog
      :open="noteTask !== null"
      :task-name="noteTask?.name ?? ''"
      :note="noteTask?.note ?? null"
      @close="noteTask = null"
      @save="onSaveNote"
    />
  </div>
</template>

<style scoped>
.gantt-page {
  display: grid;
  gap: 0.7rem;
}
.page-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  padding: 0.55rem 0.75rem;
  box-shadow: var(--shadow-sm);
}
.title {
  margin: 0;
  flex: 1;
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: 0.005em;
  color: var(--c-text);
  display: flex;
  align-items: center;
  gap: 0.55rem;
}
.customer-tag {
  display: inline-block;
  background: var(--c-accent-weak);
  color: var(--c-accent-strong);
  padding: 0.12rem 0.55rem;
  border-radius: var(--r-sm);
  font-size: 0.76rem;
  font-weight: 700;
  box-shadow: inset 0 0 0 1px #cdddf7;
}
.actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}
/* Segmented control group: one bordered pill holding related toggles. */
.seg {
  display: inline-flex;
  align-items: stretch;
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r);
  background: var(--c-surface);
  overflow: hidden;
}
.seg-label {
  display: inline-flex;
  align-items: center;
  padding: 0 0.55rem;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--c-text-muted);
  background: var(--c-surface-2);
  border-right: 1px solid var(--c-border);
}
.seg-btn {
  border: none;
  background: transparent;
  color: var(--c-text);
  padding: 0.34rem 0.7rem;
  font-size: 0.8rem;
  font-weight: 500;
  border-left: 1px solid var(--c-border);
  transition: background 0.13s, color 0.13s;
}
.seg-btn:first-of-type,
.seg-label + .seg-btn {
  border-left: none;
}
.seg-btn:hover {
  background: var(--c-surface-2);
}
.seg-btn.active {
  background: var(--c-accent);
  color: #fff;
}
.seg-btn:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--c-accent-ring);
}
/* Cascade ON/OFF — a single status pill with a colour dot. */
.toggle-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-pill);
  background: var(--c-surface);
  color: var(--c-text-muted);
  padding: 0.32rem 0.75rem;
  font-size: 0.8rem;
  font-weight: 600;
  transition: background 0.13s, border-color 0.13s, color 0.13s;
}
.toggle-pill .dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: #cbd5e1;
  box-shadow: 0 0 0 3px rgba(203, 213, 225, 0.35);
}
.toggle-pill.active {
  background: #ecfdf5;
  border-color: #a7d8c3;
  color: #166534;
}
.toggle-pill.active .dot {
  background: #16a34a;
  box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.22);
}
.toggle-pill:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--c-accent-ring);
}
.assignee-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
  padding: 0.5rem 0.75rem;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-sm);
  font-size: 0.86rem;
}
.chip {
  display: inline-flex;
  align-items: center;
  padding: 0.18rem 0.65rem;
  background: var(--c-accent-weak);
  border: 1px solid #cdddf7;
  color: var(--c-accent-strong);
  border-radius: var(--r-pill);
  font-size: 0.8rem;
  font-weight: 500;
}
.chip.orphan {
  background: var(--c-warn-bg);
  border-color: #f0c89a;
  color: var(--c-warn-fg);
}
.link {
  font-weight: 600;
}
/* Fixed-height frame. Each pane scrolls internally so the sticky table
   header (.thead) stays pinned; setupScrollSync keeps the panes in
   lockstep vertically. */
.split-viewport {
  height: calc(100vh - 198px);
  min-height: 360px;
  overflow: hidden;
}
.split {
  display: grid;
  /* grid-template-columns is set inline by leftWidth ref */
  gap: 0;
  height: 100%;
  align-items: stretch;
}
.pane {
  min-width: 0;
  height: 100%;
  overflow: auto;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
}
.pane.left {
  border-right: none;
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  /* One shared vertical scrollbar only (on the right pane, screen edge).
     The left pane still scrolls via wheel and the JS scroll-sync, but its
     own scrollbar is hidden so the two panes read as a single surface. */
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.pane.left::-webkit-scrollbar {
  display: none;
}
/* Always-present blank band pinned to the bottom of the left pane — the
   counterpart of the gantt's sticky horizontal scrollbar strip. Being
   sticky + in-flow it (a) reserves the same 14px so the two panes' scroll
   ranges stay identical, and (b) always covers the bottom 14px of the
   viewport just like the scrollbar does on the right, so the last row is
   never half-clipped when scrolling. */
.pane-bottom-strip {
  position: sticky;
  bottom: 0;
  z-index: 40;
  height: 14px;
  background: var(--c-surface);
  box-shadow: 0 -1px 0 var(--c-border);
}
.pane.right {
  border-left: none;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}
/* The component cards inside each pane shouldn't double up the border. */
.pane :deep(.task-table),
.pane :deep(.gantt-wrapper) {
  border: none;
  border-radius: 0;
}
.splitter {
  width: 6px;
  background: transparent;
  cursor: col-resize;
  position: relative;
  user-select: none;
  z-index: 40;
}
.splitter::before {
  content: '';
  position: absolute;
  inset: 0 2px;
  background: var(--c-border-strong);
  border-radius: var(--r-pill);
  transition: background 0.15s;
}
.splitter:hover::before,
.splitter:active::before {
  background: var(--c-accent);
}
@media (max-width: 1100px) {
  .split {
    display: block;
    height: auto;
  }
  .pane {
    height: auto;
    max-height: 60vh;
    border-radius: var(--r-lg);
    border: 1px solid var(--c-border);
  }
  .splitter { display: none; }
}
.muted {
  color: var(--c-text-muted);
}
.error {
  color: var(--c-danger-fg);
  font-weight: 600;
}
</style>
