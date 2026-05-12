<script setup lang="ts">
import { computed } from 'vue';
import draggable from 'vuedraggable';
import type { WbsTask, Assignee } from '@/types';

interface ColumnVisibility {
  hours: boolean;
  actual: boolean;
  status: boolean;
}

const props = defineProps<{
  tasks: WbsTask[];
  assignees: Assignee[];
  collapsedIds: Set<number>;
  childCountByParent: Map<number, number>;
  visibility: ColumnVisibility;
}>();

const emit = defineEmits<{
  (e: 'reorder', payload: WbsTask[]): void;
  (e: 'update', id: number, patch: Partial<WbsTask>): void;
  (e: 'add-child', parent: WbsTask | null, level: 1 | 2 | 3): void;
  (e: 'remove', id: number): void;
  (e: 'toggle-collapse', id: number): void;
}>();

const draggableModel = computed({
  get: () => props.tasks,
  set: (next: WbsTask[]) => emit('reorder', next),
});

const gridTemplate = computed<string>(() => {
  const parts: string[] = ['20px', '22px', '30px', 'minmax(150px, 1.4fr)'];
  // Planned columns (always: start / dur / end)
  parts.push('92px', '42px', '92px');
  if (props.visibility.hours) parts.push('56px'); // planned hours
  if (props.visibility.actual) {
    parts.push('92px', '92px'); // actual start / end
    if (props.visibility.hours) parts.push('56px'); // actual hours
  }
  parts.push('50px', '84px'); // progress / assignee
  if (props.visibility.status) parts.push('84px');
  parts.push('122px'); // actions
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
    paddingLeft: `${(level - 1) * 24}px`,
    borderLeft: `3px solid ${level === 2 ? '#c7d2fe' : '#a7f3d0'}`,
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
    <!-- Group header: visibility-aware column spans -->
    <header class="row group-head">
      <div class="grp grp-meta" :style="{ gridColumn: 'span 4' }"></div>
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
      <div class="col-level">階層</div>
      <div class="col-name">項目名</div>
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
      <div class="col-assignee">担当</div>
      <div v-if="visibility.status" class="col-status">状態</div>
      <div class="col-actions grp-start"></div>
    </header>

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
          <div class="col-level">{{ levelLabel(element.level) }}</div>
          <div class="col-name" :style="indentStyle(element.level)">
            <input
              type="text"
              :value="element.name"
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
            />
            <span v-else class="readonly">{{ fmtDateOrDash(element.startDate) }}</span>
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
            <span class="readonly">{{ fmtDateOrDash(element.endDate) }}</span>
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
              />
              <span v-else class="readonly">{{ fmtDateOrDash(element.actualStartDate) }}</span>
            </div>
            <div class="col-date actual">
              <input
                v-if="element.level === 3"
                type="date"
                :value="element.actualEndDate ?? ''"
                @change="(e) => onActualEndChange(element, e)"
              />
              <span v-else class="readonly">{{ fmtDateOrDash(element.actualEndDate) }}</span>
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
              <option v-for="a in assignees" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
          </div>
          <div v-if="visibility.status" class="col-status">
            <input
              type="text"
              :value="element.status"
              @change="(e) => onStatusChange(element, e)"
            />
          </div>
          <div class="col-actions grp-start">
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
  font-size: 0.84rem;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}
.row {
  display: grid;
  grid-template-columns: var(--grid-cols);
  align-items: center;
  gap: 0.2rem;
  padding: 0.3rem 0.4rem;
  border-bottom: 1px solid #f3f4f6;
  min-height: 40px;
  white-space: nowrap;
}
.row.group-head {
  padding: 0.25rem 0.4rem;
  background: #f9fafb;
  min-height: 26px;
  border-bottom: 1px solid #e5e7eb;
  font-size: 0.72rem;
  color: #475569;
  font-weight: 600;
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
  background: #dbeafe;
  border-radius: 4px;
  color: #1e3a8a;
}
.grp-actual {
  background: #dcfce7;
  border-radius: 4px;
  color: #14532d;
}
.row.head {
  background: #f9fafb;
  font-weight: 600;
  color: #374151;
  font-size: 0.74rem;
  min-height: 30px;
}
.row.body input[type='text'],
.row.body input[type='number'],
.row.body input[type='date'],
.row.body select {
  width: 100%;
  padding: 0.2rem 0.35rem;
  font-size: 0.84rem;
}
.col-handle .handle {
  cursor: grab;
  color: #9ca3af;
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
  color: #4b5563;
  font-size: 0.75rem;
  padding: 0 0.2rem;
  cursor: pointer;
  line-height: 1;
}
.col-toggle .toggle:hover {
  color: #1f2937;
}
.col-level {
  text-align: center;
  font-weight: 600;
  font-size: 0.7rem;
  color: #4b5563;
}
.lvl-1 {
  background: #eff6ff;
}
.lvl-2 {
  background: #f5f3ff;
}
.lvl-3 {
  background: #fff;
}
/* Group separators (subtle vertical guides) - drop the cell tinting
   that was producing muddy blends with the row hierarchy colors. */
.grp-start {
  border-left: 1px solid #e5e7eb;
  padding-left: 0.3rem;
  margin-left: 0.15rem;
}
.readonly {
  color: #6b7280;
  display: inline-block;
  padding: 0 0.2rem;
}
.col-actions {
  display: flex;
  gap: 0.3rem;
  justify-content: flex-end;
}
.col-actions .btn {
  padding: 0.2rem 0.45rem;
  font-size: 0.74rem;
}
.drag-ghost {
  opacity: 0.4;
  background: #dbeafe;
}
</style>
