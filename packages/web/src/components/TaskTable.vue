<script setup lang="ts">
import { computed, ref } from 'vue';
import draggable from 'vuedraggable';
import type { WbsTask, Assignee } from '@/types';
import ColumnFilter, { type FilterOption } from './ColumnFilter.vue';
import { computeStatus } from '@/utils/status';

interface ColumnVisibility {
  hours: boolean;
  actual: boolean;
  status: boolean;
}

type FilterValue = string | number | null;
interface ColumnFilters {
  name: string;
  levels: Set<number> | null;
  assigneeIds: Set<FilterValue> | null;
  statuses: Set<FilterValue> | null;
}
interface FilterOptions {
  levels: FilterOption[];
  assigneeIds: FilterOption[];
  statuses: FilterOption[];
}

const props = defineProps<{
  tasks: WbsTask[];
  assignees: Assignee[];
  // Employees assigned to tasks but no longer in the project's members list.
  // Their id remains valid (soft removal), but the dropdown labels them
  // "(メンバー外)" and shows them at the bottom.
  nonMemberIds?: Set<number>;
  collapsedIds: Set<number>;
  childCountByParent: Map<number, number>;
  visibility: ColumnVisibility;
  filters: ColumnFilters;
  filterOptions: FilterOptions;
}>();

const assigneeOptions = computed(() => {
  const nonMembers = props.nonMemberIds ?? new Set<number>();
  const members = props.assignees.filter((a) => !nonMembers.has(a.id));
  const orphans = props.assignees.filter((a) => nonMembers.has(a.id));
  return [
    ...members.map((a) => ({ a, suffix: '' })),
    ...orphans.map((a) => ({ a, suffix: '（メンバー外）' })),
  ];
});

const emit = defineEmits<{
  (e: 'reorder', payload: WbsTask[]): void;
  (e: 'update', id: number, patch: Partial<WbsTask>): void;
  (e: 'add-child', parent: WbsTask | null, level: 1 | 2 | 3): void;
  (e: 'remove', id: number): void;
  (e: 'duplicate', id: number): void;
  (e: 'open-note', task: WbsTask): void;
  (e: 'toggle-collapse', id: number): void;
  (e: 'filter-name', value: string): void;
  (e: 'filter-levels', value: Set<FilterValue> | null): void;
  (e: 'filter-assignees', value: Set<FilterValue> | null): void;
  (e: 'filter-statuses', value: Set<FilterValue> | null): void;
}>();

type FilterKey = 'name' | 'levels' | 'assigneeIds' | 'statuses';
const openFilter = ref<FilterKey | null>(null);
function toggleFilterPopover(key: FilterKey): void {
  openFilter.value = openFilter.value === key ? null : key;
}
function closeFilter(): void {
  openFilter.value = null;
}
function isFilterActive(key: FilterKey): boolean {
  if (key === 'name') return props.filters.name !== '';
  return props.filters[key] !== null;
}

const draggableModel = computed({
  get: () => props.tasks,
  set: (next: WbsTask[]) => emit('reorder', next),
});

const gridTemplate = computed<string>(() => {
  // Date columns wide enough to show full 'YYYY/MM/DD' input including the
  // calendar icon (~115px) without truncation.
  const DATE_COL = '115px';
  // handle / toggle / 階層 / row-ops (＋中・備考・複製) / 項目名
  const parts: string[] = ['20px', '22px', '46px', '112px', 'minmax(150px, 1.4fr)'];
  // Planned columns (always: start / dur / end)
  parts.push(DATE_COL, '42px', DATE_COL);
  if (props.visibility.hours) parts.push('56px'); // planned hours
  if (props.visibility.actual) {
    parts.push(DATE_COL, DATE_COL); // actual start / end
    if (props.visibility.hours) parts.push('56px'); // actual hours
  }
  parts.push('72px', '84px'); // progress / assignee
  // 状態 (status) absorbs leftover space when shown so the status input
  // can stretch to fill the row instead of leaving a dead gap before actions.
  if (props.visibility.status) parts.push('minmax(84px, 1fr)');
  parts.push('62px'); // actions (削除 only)
  return parts.join(' ');
});

const spans = computed(() => {
  let plannedSpan = 3; // p start / dur / end
  if (props.visibility.hours) plannedSpan += 1;

  let actualSpan = 0;
  if (props.visibility.actual) {
    actualSpan = 2; // a start / end
    if (props.visibility.hours) actualSpan += 1; // a hours
  }

  let otherSpan = 2; // progress / assignee
  if (props.visibility.status) otherSpan += 1;

  return { plannedSpan, actualSpan, otherSpan };
});

function hasChildren(taskId: number): boolean {
  return (props.childCountByParent.get(taskId) ?? 0) > 0;
}

function isCollapsed(taskId: number): boolean {
  return props.collapsedIds.has(taskId);
}

function levelLabel(level: number): string {
  return level === 1 ? '大' : level === 2 ? '中' : '項';
}

function levelClass(level: number): string {
  return `lvl lvl-${level}`;
}

function indentStyle(level: number): { paddingLeft: string; borderLeft?: string } {
  if (level === 1) return { paddingLeft: '0' };
  return {
    paddingLeft: `${(level - 1) * 22}px`,
    borderLeft: `2px solid ${level === 2 ? 'var(--c-lvl1-bar)' : 'var(--c-lvl2-bar)'}`,
  };
}

function fmtHours(value: number | null): string {
  if (value === null || value === undefined) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function fmtDateOrDash(value: string | null): string {
  return value ?? '—';
}

function onNameInput(task: WbsTask, e: Event): void {
  const value = (e.target as HTMLInputElement).value;
  if (value !== task.name) emit('update', task.id, { name: value });
}

function onStartChange(task: WbsTask, e: Event): void {
  if (task.level !== 3) return;
  const value = (e.target as HTMLInputElement).value;
  if (value && value !== task.startDate) emit('update', task.id, { startDate: value });
}

function onDurationChange(task: WbsTask, e: Event): void {
  if (task.level !== 3) return;
  const value = Number((e.target as HTMLInputElement).value);
  if (Number.isFinite(value) && value > 0 && value !== task.duration) {
    emit('update', task.id, { duration: value });
  }
}

function onActualStartChange(task: WbsTask, e: Event): void {
  if (task.level !== 3) return;
  const raw = (e.target as HTMLInputElement).value;
  const value: string | null = raw === '' ? null : raw;
  if (value !== task.actualStartDate) emit('update', task.id, { actualStartDate: value });
}

function onActualEndChange(task: WbsTask, e: Event): void {
  if (task.level !== 3) return;
  const raw = (e.target as HTMLInputElement).value;
  const value: string | null = raw === '' ? null : raw;
  if (value !== task.actualEndDate) emit('update', task.id, { actualEndDate: value });
}

// --- Date copy / paste (Excel-style) -------------------------------------
type DateField = 'startDate' | 'actualStartDate' | 'actualEndDate';

/** ISO "2026-05-18" -> clipboard text "2026/05/18". */
function dateForClipboard(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? `${m[1]}/${m[2]}/${m[3]}` : (iso ?? '');
}

/**
 * Parse a pasted date in many shapes — 2026-05-18, 2026/5/18, 2026.05.18,
 * 2026年5月18日, 20260518, or an Excel cell that brings a trailing time /
 * tab / newline — into ISO "YYYY-MM-DD". Returns null if not a valid date.
 */
function parsePastedDate(text: string): string | null {
  const first = (text ?? '').split(/[\t\r\n]/)[0].trim();
  const m = /(\d{4})\D{0,2}(\d{1,2})\D{0,2}(\d{1,2})/.exec(first);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // Reject impossible dates (e.g. 2026/02/30 rolled over by Date).
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  const mm = String(mo).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

function onDateCopy(value: string | null | undefined, e: ClipboardEvent): void {
  if (!value || !e.clipboardData) return;
  e.preventDefault();
  e.clipboardData.setData('text/plain', dateForClipboard(value));
}

// Select the read-only date cell's text on click so a following Ctrl+C
// fires the copy handler (which reformats it to YYYY/MM/DD).
function selectDateText(e: MouseEvent): void {
  const el = e.currentTarget as HTMLElement;
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(range);
}

function onDatePaste(task: WbsTask, field: DateField, e: ClipboardEvent): void {
  if (task.level !== 3) return;
  const text = e.clipboardData?.getData('text') ?? '';
  const iso = parsePastedDate(text);
  if (!iso) return; // not a date — leave the field as-is
  e.preventDefault();
  const input = e.target as HTMLInputElement;
  input.value = iso;
  const current =
    field === 'startDate'
      ? task.startDate
      : field === 'actualStartDate'
        ? task.actualStartDate
        : task.actualEndDate;
  if (iso !== current) emit('update', task.id, { [field]: iso });
}

function onPlannedHoursChange(task: WbsTask, e: Event): void {
  if (task.level !== 3) return;
  const raw = (e.target as HTMLInputElement).value;
  if (raw === '') {
    if (task.plannedHours !== null) emit('update', task.id, { plannedHours: null });
    return;
  }
  const value = Number(raw);
  if (Number.isFinite(value) && value >= 0 && value !== task.plannedHours) {
    emit('update', task.id, { plannedHours: value });
  }
}

function onActualHoursChange(task: WbsTask, e: Event): void {
  if (task.level !== 3) return;
  const raw = (e.target as HTMLInputElement).value;
  if (raw === '') {
    if (task.actualHours !== null) emit('update', task.id, { actualHours: null });
    return;
  }
  const value = Number(raw);
  if (Number.isFinite(value) && value >= 0 && value !== task.actualHours) {
    emit('update', task.id, { actualHours: value });
  }
}

function onProgressChange(task: WbsTask, e: Event): void {
  const value = Number((e.target as HTMLInputElement).value);
  if (Number.isFinite(value) && value >= 0 && value <= 100) {
    emit('update', task.id, { progress: value });
  }
}

function onAssigneeChange(task: WbsTask, e: Event): void {
  const raw = (e.target as HTMLSelectElement).value;
  const value = raw === '' ? null : Number(raw);
  emit('update', task.id, { assigneeId: value });
}

function onStatusChange(task: WbsTask, e: Event): void {
  const value = (e.target as HTMLInputElement).value;
  if (value !== task.status) emit('update', task.id, { status: value });
}
</script>

<template>
  <div class="task-table" :style="{ '--grid-cols': gridTemplate }">
   <div class="thead">
    <!-- Group header: visibility-aware column spans -->
    <header class="row group-head">
      <div class="grp grp-meta" :style="{ gridColumn: 'span 5' }"></div>
      <div class="grp grp-planned" :style="{ gridColumn: `span ${spans.plannedSpan}` }">予定</div>
      <div
        v-if="visibility.actual"
        class="grp grp-actual"
        :style="{ gridColumn: `span ${spans.actualSpan}` }"
      >実績</div>
      <div class="grp grp-other" :style="{ gridColumn: `span ${spans.otherSpan}` }"></div>
      <div class="grp grp-actions" :style="{ gridColumn: 'span 1' }"></div>
    </header>
    <!-- Column header -->
    <header class="row head">
      <div class="col-handle"></div>
      <div class="col-toggle"></div>
      <div class="col-level filterable">
        <span class="head-label">階層</span>
        <button
          class="filter-trigger"
          :class="{ active: isFilterActive('levels') }"
          type="button"
          :title="isFilterActive('levels') ? '階層フィルタ（適用中）' : '階層で絞り込み'"
          @click.stop="toggleFilterPopover('levels')"
        >▾</button>
        <ColumnFilter
          :open="openFilter === 'levels'"
          type="enum"
          title="階層で絞り込み"
          :options="filterOptions.levels"
          :selected="filters.levels as Set<FilterValue> | null"
          @close="closeFilter"
          @update-enum="(v) => emit('filter-levels', v)"
        />
      </div>
      <div class="col-rowops"></div>
      <div class="col-name filterable">
        <span class="head-label">項目名</span>
        <button
          class="filter-trigger"
          :class="{ active: isFilterActive('name') }"
          type="button"
          :title="isFilterActive('name') ? '項目名フィルタ（適用中）' : '項目名で検索'"
          @click.stop="toggleFilterPopover('name')"
        >▾</button>
        <ColumnFilter
          :open="openFilter === 'name'"
          type="text"
          title="項目名で検索"
          :text="filters.name"
          text-placeholder="部分一致で検索"
          @close="closeFilter"
          @update-text="(v) => emit('filter-name', v)"
        />
      </div>
      <div class="col-date planned grp-start">開始</div>
      <div class="col-num planned">日数</div>
      <div class="col-date planned">終了</div>
      <div v-if="visibility.hours" class="col-hours planned">工数</div>
      <template v-if="visibility.actual">
        <div class="col-date actual grp-start">開始</div>
        <div class="col-date actual">終了</div>
        <div v-if="visibility.hours" class="col-hours actual">工数</div>
      </template>
      <div class="col-num grp-start">進捗</div>
      <div class="col-assignee filterable">
        <span class="head-label">担当</span>
        <button
          class="filter-trigger"
          :class="{ active: isFilterActive('assigneeIds') }"
          type="button"
          :title="isFilterActive('assigneeIds') ? '担当フィルタ（適用中）' : '担当で絞り込み'"
          @click.stop="toggleFilterPopover('assigneeIds')"
        >▾</button>
        <ColumnFilter
          :open="openFilter === 'assigneeIds'"
          type="enum"
          title="担当で絞り込み"
          :options="filterOptions.assigneeIds"
          :selected="filters.assigneeIds"
          @close="closeFilter"
          @update-enum="(v) => emit('filter-assignees', v)"
        />
      </div>
      <div v-if="visibility.status" class="col-status filterable">
        <span class="head-label">状態</span>
        <button
          class="filter-trigger"
          :class="{ active: isFilterActive('statuses') }"
          type="button"
          :title="isFilterActive('statuses') ? '状態フィルタ（適用中）' : '状態で絞り込み'"
          @click.stop="toggleFilterPopover('statuses')"
        >▾</button>
        <ColumnFilter
          :open="openFilter === 'statuses'"
          type="enum"
          title="状態で絞り込み"
          :options="filterOptions.statuses"
          :selected="filters.statuses"
          @close="closeFilter"
          @update-enum="(v) => emit('filter-statuses', v)"
        />
      </div>
      <div class="col-actions grp-start"></div>
    </header>
   </div>

    <draggable
      v-model="draggableModel"
      :item-key="'id'"
      handle=".handle"
      animation="150"
      ghost-class="drag-ghost"
      tag="div"
    >
      <template #item="{ element }">
        <div class="row body" :class="levelClass(element.level)">
          <div class="col-handle"><span class="handle" aria-label="drag">⋮⋮</span></div>
          <div class="col-toggle">
            <button
              v-if="element.level < 3 && hasChildren(element.id)"
              class="toggle"
              type="button"
              :aria-expanded="!isCollapsed(element.id)"
              :title="isCollapsed(element.id) ? '展開' : '折りたたむ'"
              @click="emit('toggle-collapse', element.id)"
            >
              {{ isCollapsed(element.id) ? '▶' : '▼' }}
            </button>
          </div>
          <div class="col-level">
            <span class="lvl-badge" :class="`lvl-badge-${element.level}`">{{
              levelLabel(element.level)
            }}</span>
          </div>
          <div class="col-rowops">
            <button
              v-if="element.level < 3"
              class="btn"
              type="button"
              :title="`${levelLabel(element.level + 1)}項目を追加`"
              @click="emit('add-child', element, (element.level + 1) as 1 | 2 | 3)"
            >
              ＋{{ levelLabel(element.level + 1) }}
            </button>
            <button
              v-if="element.level === 3"
              class="btn note-btn"
              :class="{ 'has-note': !!(element.note && element.note.trim()) }"
              type="button"
              :title="element.note && element.note.trim()
                ? '備考を編集（登録済み）'
                : '備考を追加'"
              @click="emit('open-note', element)"
            >
              備考<span v-if="element.note && element.note.trim()" class="note-dot" aria-hidden="true"></span>
            </button>
            <button
              class="btn"
              type="button"
              title="この行（配下も含む）を複製"
              @click="emit('duplicate', element.id)"
            >
              複製
            </button>
          </div>
          <div class="col-name" :style="indentStyle(element.level)">
            <input
              type="text"
              :value="element.name"
              :data-task-name="element.id"
              placeholder="（名称未入力）"
              @change="(e) => onNameInput(element, e)"
            />
          </div>

          <!-- 予定 -->
          <div class="col-date planned grp-start">
            <input
              v-if="element.level === 3"
              type="date"
              :value="element.startDate ?? ''"
              @change="(e) => onStartChange(element, e)"
              @copy="(e) => onDateCopy(element.startDate, e as ClipboardEvent)"
              @paste="(e) => onDatePaste(element, 'startDate', e as ClipboardEvent)"
            />
            <span
              v-else
              class="readonly date-copyable"
              tabindex="0"
              title="クリックして Ctrl+C でコピー"
              @click="selectDateText"
              @copy="(e) => onDateCopy(element.startDate, e as ClipboardEvent)"
            >{{ fmtDateOrDash(element.startDate) }}</span>
          </div>
          <div class="col-num planned">
            <input
              v-if="element.level === 3"
              type="number"
              min="1"
              :value="element.duration ?? ''"
              @change="(e) => onDurationChange(element, e)"
            />
            <span v-else class="readonly">{{ element.duration ?? '—' }}</span>
          </div>
          <div class="col-date planned">
            <span
              class="readonly date-copyable"
              tabindex="0"
              title="クリックして Ctrl+C でコピー"
              @click="selectDateText"
              @copy="(e) => onDateCopy(element.endDate, e as ClipboardEvent)"
            >{{ fmtDateOrDash(element.endDate) }}</span>
          </div>
          <div v-if="visibility.hours" class="col-hours planned">
            <input
              v-if="element.level === 3"
              type="number"
              min="0"
              step="0.5"
              :value="element.plannedHours ?? ''"
              @change="(e) => onPlannedHoursChange(element, e)"
            />
            <span v-else class="readonly">{{ fmtHours(element.plannedHours) }}</span>
          </div>

          <!-- 実績 -->
          <template v-if="visibility.actual">
            <div class="col-date actual grp-start">
              <input
                v-if="element.level === 3"
                type="date"
                :value="element.actualStartDate ?? ''"
                @change="(e) => onActualStartChange(element, e)"
                @copy="(e) => onDateCopy(element.actualStartDate, e as ClipboardEvent)"
                @paste="(e) => onDatePaste(element, 'actualStartDate', e as ClipboardEvent)"
              />
              <span
                v-else
                class="readonly date-copyable"
                tabindex="0"
                title="クリックして Ctrl+C でコピー"
                @click="selectDateText"
                @copy="(e) => onDateCopy(element.actualStartDate, e as ClipboardEvent)"
              >{{ fmtDateOrDash(element.actualStartDate) }}</span>
            </div>
            <div class="col-date actual">
              <input
                v-if="element.level === 3"
                type="date"
                :value="element.actualEndDate ?? ''"
                @change="(e) => onActualEndChange(element, e)"
                @copy="(e) => onDateCopy(element.actualEndDate, e as ClipboardEvent)"
                @paste="(e) => onDatePaste(element, 'actualEndDate', e as ClipboardEvent)"
              />
              <span
                v-else
                class="readonly date-copyable"
                tabindex="0"
                title="クリックして Ctrl+C でコピー"
                @click="selectDateText"
                @copy="(e) => onDateCopy(element.actualEndDate, e as ClipboardEvent)"
              >{{ fmtDateOrDash(element.actualEndDate) }}</span>
            </div>
            <div v-if="visibility.hours" class="col-hours actual">
              <input
                v-if="element.level === 3"
                type="number"
                min="0"
                step="0.5"
                :value="element.actualHours ?? ''"
                @change="(e) => onActualHoursChange(element, e)"
              />
              <span v-else class="readonly">{{ fmtHours(element.actualHours) }}</span>
            </div>
          </template>

          <div class="col-num grp-start">
            <input
              type="number"
              min="0"
              max="100"
              :value="element.progress"
              @change="(e) => onProgressChange(element, e)"
            />
          </div>
          <div class="col-assignee">
            <select
              :value="element.assigneeId ?? ''"
              @change="(e) => onAssigneeChange(element, e)"
            >
              <option value="">未割当</option>
              <option v-for="opt in assigneeOptions" :key="opt.a.id" :value="opt.a.id">
                {{ opt.a.name }}{{ opt.suffix }}
              </option>
            </select>
          </div>
          <div v-if="visibility.status" class="col-status">
            <span
              :class="['status-badge', computeStatus(element).className]"
              :title="`${computeStatus(element).label}${
                computeStatus(element).extended ? ` (${computeStatus(element).extended})` : ''
              }`"
            >
              <span class="status-label">{{ computeStatus(element).label }}</span>
              <span v-if="computeStatus(element).extended" class="status-extended">
                {{ computeStatus(element).extended }}
              </span>
            </span>
          </div>
          <div class="col-actions grp-start">
            <button
              class="btn danger"
              type="button"
              title="削除"
              @click="emit('remove', element.id)"
            >
              削除
            </button>
          </div>
        </div>
      </template>
    </draggable>
  </div>
</template>

<style scoped>
.task-table {
  font-size: 0.86rem;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  /* overflow:visible so the column filter popovers can extend past the
     table's rounded corners */
  overflow: visible;
}
/* Sticky two-row header. The scroll container is each pane (see GanttPage),
   so the header stays pinned while the long task list scrolls underneath. */
.thead {
  position: sticky;
  top: 0;
  z-index: 30;
  height: var(--wbs-gantt-table-header-height);
  background: var(--c-surface);
  border-top-left-radius: var(--r-lg);
  border-top-right-radius: var(--r-lg);
  box-shadow: 0 1px 0 var(--c-border), 0 6px 10px -8px rgba(15, 23, 42, 0.25);
}
.row {
  display: grid;
  grid-template-columns: var(--grid-cols);
  align-items: center;
  gap: 0.2rem;
  padding: 0.3rem 0.45rem;
  border-bottom: 1px solid var(--c-border);
  height: var(--wbs-gantt-row-height);
  min-height: var(--wbs-gantt-row-height);
  white-space: nowrap;
}
.row.group-head {
  padding: 0.25rem 0.45rem;
  background: var(--c-surface-2);
  height: var(--wbs-gantt-group-header-height);
  min-height: var(--wbs-gantt-group-header-height);
  border-bottom: 1px solid var(--c-border);
  font-size: 0.72rem;
  color: var(--c-text-muted);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-align: center;
}
.grp {
  align-self: stretch;
  display: flex;
  align-items: center;
  justify-content: center;
}
/* Group label backgrounds. Column spans are set inline via :style based on
   visibility (see template). */
.grp-planned {
  background: var(--c-info-bg);
  border-radius: var(--r-sm);
  color: var(--c-info-fg);
}
.grp-actual {
  background: var(--c-ok-bg);
  border-radius: var(--r-sm);
  color: var(--c-ok-fg);
}
.row.head {
  background: var(--c-surface-2);
  font-weight: 700;
  color: var(--c-text);
  font-size: 0.76rem;
  height: var(--wbs-gantt-column-header-height);
  min-height: var(--wbs-gantt-column-header-height);
  border-bottom: 1px solid var(--c-border-strong);
}
.filterable {
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;
}
.filterable .head-label {
  white-space: nowrap;
}
.filter-trigger {
  border: none;
  background: transparent;
  color: var(--c-text-faint);
  font-size: 0.7rem;
  cursor: pointer;
  padding: 1px 4px;
  border-radius: var(--r-sm);
  line-height: 1;
  transition: background 0.12s, color 0.12s;
}
.filter-trigger:hover {
  background: var(--c-border);
  color: var(--c-text);
}
.filter-trigger.active {
  background: var(--c-accent);
  color: #fff;
}
.row.body {
  background: var(--c-surface);
  transition: background 0.1s;
}
/* Leaf rows (項目 / lvl-3) stay plain white — no per-row zebra. */
/* Hierarchy emphasis: 大項目 = section band, 中項目 = lighter band, 項目 = leaf */
.row.body.lvl-1 {
  background: var(--c-surface-3);
  box-shadow: inset 3px 0 0 var(--c-lvl1-bar);
  border-bottom-color: var(--c-border-strong);
}
.row.body.lvl-2 {
  background: #f2f5f9;
  box-shadow: inset 3px 0 0 var(--c-lvl2-bar);
}
.row.body.lvl-1 .col-name input {
  font-weight: 700;
  font-size: 0.95rem;
  color: var(--c-text);
}
.row.body.lvl-2 .col-name input {
  font-weight: 600;
}
.row.body.lvl-1 .col-name input,
.row.body.lvl-2 .col-name input,
.row.body .readonly {
  background: transparent;
}
.row.body.lvl-1 .col-name input:not(:focus),
.row.body.lvl-2 .col-name input:not(:focus) {
  border-color: transparent;
}
/* Hover wins over zebra/band so the active row is unmistakable. */
.row.body:hover {
  background: var(--c-accent-weak) !important;
  box-shadow: inset 3px 0 0 var(--c-accent);
}
.col-handle .handle {
  cursor: grab;
  color: var(--c-text-faint);
  user-select: none;
}
.col-handle .handle:active {
  cursor: grabbing;
}
.col-toggle {
  display: flex;
  justify-content: center;
}
.col-toggle .toggle {
  border: none;
  background: transparent;
  color: var(--c-text-muted);
  font-size: 0.75rem;
  padding: 0 0.2rem;
  cursor: pointer;
  line-height: 1;
  border-radius: var(--r-sm);
  transition: color 0.12s, background 0.12s;
}
.col-toggle .toggle:hover {
  color: var(--c-text);
  background: var(--c-border);
}
.col-level {
  display: flex;
  justify-content: center;
}
.lvl-badge {
  display: inline-grid;
  place-items: center;
  min-width: 1.5rem;
  height: 1.25rem;
  padding: 0 0.3rem;
  border-radius: var(--r-sm);
  font-size: 0.68rem;
  font-weight: 700;
  line-height: 1;
}
.lvl-badge-1 {
  background: var(--c-accent);
  color: #fff;
}
.lvl-badge-2 {
  background: var(--c-accent-weak);
  color: var(--c-accent-strong);
  box-shadow: inset 0 0 0 1px #c7d7f5;
}
.lvl-badge-3 {
  background: var(--c-neutral-bg);
  color: var(--c-text-muted);
}
.row.body input[type='text'],
.row.body input[type='number'],
.row.body input[type='date'],
.row.body select {
  width: 100%;
  padding: 0.22rem 0.4rem;
  font-size: 0.85rem;
}
/* Right-align numeric figures so they line up column-wise. */
.col-num input,
.col-num .readonly,
.col-hours input,
.col-hours .readonly {
  text-align: right;
}
/* Group separators (subtle vertical guides). */
.grp-start {
  border-left: 1px solid var(--c-border);
  padding-left: 0.3rem;
  margin-left: 0.15rem;
}
.readonly {
  color: var(--c-text-muted);
  display: inline-block;
  padding: 0 0.2rem;
  width: 100%;
}
.date-copyable {
  cursor: pointer;
  border-radius: var(--r-sm);
}
.date-copyable:focus,
.date-copyable:focus-visible {
  outline: 2px solid var(--c-accent);
  outline-offset: -2px;
}
.date-copyable::selection {
  background: var(--c-accent-weak);
}
/* Status badge (computed: 完了 / 実行中 / 遅延中 / 着手遅れ / 未着手) */
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.12rem 0.5rem;
  border-radius: var(--r-pill);
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1.5;
  white-space: nowrap;
  max-width: 100%;
}
.status-badge .status-label {
  flex-shrink: 0;
}
.status-badge .status-extended {
  font-weight: 500;
  opacity: 0.85;
  overflow: hidden;
  text-overflow: ellipsis;
}
.status-completed {
  background: var(--c-ok-bg);
  color: var(--c-ok-fg);
}
.status-completed-late {
  background: var(--c-late-bg);
  color: var(--c-late-fg);
}
.status-in-progress {
  background: var(--c-info-bg);
  color: var(--c-info-fg);
}
.status-overdue {
  background: var(--c-danger-bg);
  color: var(--c-danger-fg);
}
.status-late-start {
  background: var(--c-warn-bg);
  color: var(--c-warn-fg);
}
.status-not-started {
  background: var(--c-neutral-bg);
  color: var(--c-neutral-fg);
}
.col-actions,
.col-rowops {
  display: flex;
  gap: 0.3rem;
  align-items: center;
  justify-content: flex-start;
}
.col-actions .btn,
.col-rowops .btn {
  padding: 0.2rem 0.45rem;
  font-size: 0.74rem;
  white-space: nowrap;
}
.note-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
}
.note-btn.has-note {
  border-color: var(--c-accent);
  color: var(--c-accent-strong);
  background: var(--c-accent-weak);
}
.note-dot {
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 50%;
  background: var(--c-accent);
}
.drag-ghost {
  opacity: 0.5;
  background: var(--c-accent-weak);
  box-shadow: inset 0 0 0 1px var(--c-accent);
}
/* Applied transiently when navigated from the cross-project assignments view */
.row.body.focus-highlight {
  animation: focus-pulse 2.5s ease-out;
}
@keyframes focus-pulse {
  0%, 50% { background: #fef3c7; box-shadow: inset 4px 0 0 #f59e0b; }
  100% { background: transparent; box-shadow: none; }
}
</style>
