<script setup lang="ts">
import { computed } from 'vue';
import draggable from 'vuedraggable';
import type { WbsTask, Assignee } from '@/types';

const props = defineProps<{
  tasks: WbsTask[];
  assignees: Assignee[];
  collapsedIds: Set<number>;
  childCountByParent: Map<number, number>;
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
  <div class="task-table">
    <header class="row head">
      <div class="col-handle"></div>
      <div class="col-toggle"></div>
      <div class="col-level">階層</div>
      <div class="col-name">項目名</div>
      <div class="col-date">開始日</div>
      <div class="col-num">日数</div>
      <div class="col-date">終了日</div>
      <div class="col-num">進捗</div>
      <div class="col-assignee">担当</div>
      <div class="col-status">状態</div>
      <div class="col-actions"></div>
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
          <div class="col-date">
            <input
              v-if="element.level === 3"
              type="date"
              :value="element.startDate ?? ''"
              @change="(e) => onStartChange(element, e)"
            />
            <span v-else class="readonly">{{ element.startDate ?? '—' }}</span>
          </div>
          <div class="col-num">
            <input
              v-if="element.level === 3"
              type="number"
              min="1"
              :value="element.duration ?? ''"
              @change="(e) => onDurationChange(element, e)"
            />
            <span v-else class="readonly">{{ element.duration ?? '—' }}</span>
          </div>
          <div class="col-date">
            <span class="readonly">{{ element.endDate ?? '—' }}</span>
          </div>
          <div class="col-num">
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
          <div class="col-status">
            <input
              type="text"
              :value="element.status"
              @change="(e) => onStatusChange(element, e)"
            />
          </div>
          <div class="col-actions">
            <button
              v-if="element.level < 3"
              class="btn"
              type="button"
              @click="emit('add-child', element, (element.level + 1) as 1 | 2 | 3)"
            >
              + {{ levelLabel(element.level + 1) }}
            </button>
            <button class="btn danger" type="button" @click="emit('remove', element.id)">
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
  font-size: 0.88rem;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}
.row {
  display: grid;
  grid-template-columns:
    24px 28px 40px minmax(160px, 2fr) 120px 60px 120px 60px 110px 120px 130px;
  align-items: center;
  gap: 0.3rem;
  padding: 0.35rem 0.45rem;
  border-bottom: 1px solid #f3f4f6;
  min-height: 40px;
}
.row.head {
  background: #f9fafb;
  font-weight: 600;
  color: #374151;
  font-size: 0.8rem;
  min-height: 32px;
}
.row.body input[type='text'],
.row.body input[type='number'],
.row.body input[type='date'],
.row.body select {
  width: 100%;
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
  font-size: 0.72rem;
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
.readonly {
  color: #6b7280;
}
.col-actions {
  display: flex;
  gap: 0.3rem;
  justify-content: flex-end;
}
.col-actions .btn {
  padding: 0.2rem 0.5rem;
  font-size: 0.75rem;
}
.drag-ghost {
  opacity: 0.4;
  background: #dbeafe;
}
</style>
