<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch, nextTick } from 'vue';
import Gantt from 'frappe-gantt';
import type { WbsTask } from '@/types';

const props = defineProps<{
  tasks: WbsTask[];
}>();

const emit = defineEmits<{
  (e: 'date-change', taskId: number, startDate: string, endDate: string): void;
  (e: 'progress-change', taskId: number, progress: number): void;
}>();

const containerRef = ref<HTMLElement | null>(null);
let chart: Gantt | null = null;

interface FrappeTask {
  id: string;
  name: string;
  start: string;
  end: string;
  progress: number;
  custom_class?: string;
}

function toFrappeTasks(rows: WbsTask[]): FrappeTask[] {
  return rows
    .filter((t) => t.startDate && t.endDate)
    .map((t) => ({
      id: String(t.id),
      name: t.name,
      start: t.startDate as string,
      end: t.endDate as string,
      progress: t.progress,
      custom_class: `lvl-${t.level}`,
    }));
}

function render(): void {
  if (!containerRef.value) return;
  const data = toFrappeTasks(props.tasks);
  if (data.length === 0) {
    containerRef.value.innerHTML =
      '<p class="empty">タスクに開始日と日数を設定するとチャートが表示されます。</p>';
    chart = null;
    return;
  }

  containerRef.value.innerHTML = '';
  chart = new Gantt(containerRef.value, data, {
    view_mode: 'Day',
    date_format: 'YYYY-MM-DD',
    language: 'ja',
    bar_height: 22,
    padding: 18,
    on_date_change: (task: FrappeTask, start: Date, end: Date) => {
      const id = Number(task.id);
      if (!Number.isFinite(id)) return;
      emit('date-change', id, toIso(start), toIso(end));
    },
    on_progress_change: (task: FrappeTask, progress: number) => {
      const id = Number(task.id);
      if (!Number.isFinite(id)) return;
      emit('progress-change', id, progress);
    },
  });
}

function toIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

onMounted(async () => {
  await nextTick();
  render();
});

watch(() => props.tasks, () => render(), { deep: true });

onBeforeUnmount(() => {
  if (containerRef.value) containerRef.value.innerHTML = '';
  chart = null;
});
</script>

<template>
  <div class="gantt-wrapper">
    <div ref="containerRef" class="gantt-container"></div>
  </div>
</template>

<style scoped>
.gantt-wrapper {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 0.75rem;
  overflow-x: auto;
}
.gantt-container :deep(.empty) {
  color: #6b7280;
  font-size: 0.9rem;
  margin: 0.5rem 0;
}
.gantt-container :deep(.bar-wrapper.lvl-1 .bar) {
  fill: #1d4ed8;
}
.gantt-container :deep(.bar-wrapper.lvl-2 .bar) {
  fill: #7c3aed;
}
.gantt-container :deep(.bar-wrapper.lvl-3 .bar) {
  fill: #059669;
}
.gantt-container :deep(.bar-progress) {
  fill: rgba(0, 0, 0, 0.25);
}
</style>
