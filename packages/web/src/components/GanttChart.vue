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

const SVG_NS = 'http://www.w3.org/2000/svg';
const MONTH_NAMES_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_NAMES_JA = [
  '1月', '2月', '3月', '4月', '5月', '6月',
  '7月', '8月', '9月', '10月', '11月', '12月',
];
const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];

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

function toIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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
  // To align bars vertically with the table rows, choose:
  //   row height (= bar_height + padding) = table row min-height (= 40px)
  //   header_height = table-header-height - padding/2 (table header = 56, padding = 16) => 48
  // That puts the bar center at the table row center for every row.
  chart = new Gantt(containerRef.value, data, {
    view_mode: 'Day',
    date_format: 'YYYY-MM-DD',
    bar_height: 24,
    padding: 16,
    header_height: 48,
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

  // Frappe Gantt does some async layout; defer customizations a tick.
  requestAnimationFrame(() => {
    applyJapaneseLabels();
    highlightWeekends();
  });
}

function applyJapaneseLabels(): void {
  const svg = containerRef.value?.querySelector('svg');
  if (!svg || !chart) return;

  // Replace English month names in upper-text with Japanese (e.g. "1 May" -> "5月")
  svg.querySelectorAll<SVGTextElement>('.upper-text').forEach((t) => {
    const txt = (t.textContent ?? '').trim();
    for (let i = 0; i < MONTH_NAMES_EN.length; i++) {
      if (txt.includes(MONTH_NAMES_EN[i])) {
        t.textContent = MONTH_NAMES_JA[i];
        return;
      }
    }
  });

  // Append weekday char in parens to each day number in lower-text:
  //   "12" -> "12(火)"   ←  parens disambiguate from month labels like "12月"
  const ganttStart = getGanttStart();
  if (!ganttStart) return;
  const cw = getColumnWidth();
  svg.querySelectorAll<SVGTextElement>('.lower-text').forEach((t) => {
    const orig = (t.textContent ?? '').trim();
    const dow = inferDow(t, ganttStart, cw);
    if (dow === null) return;
    // Strip any previously-applied label so re-renders don't double up.
    const dayNumber = orig.replace(/[\s()日月火水木金土]+$/g, '');
    t.textContent = `${dayNumber}(${DOW_JA[dow]})`;
    // Color the weekday label for weekends
    if (dow === 0) t.setAttribute('fill', '#b91c1c');
    else if (dow === 6) t.setAttribute('fill', '#1d4ed8');
    else t.removeAttribute('fill');
  });
}

function highlightWeekends(): void {
  const svg = containerRef.value?.querySelector('svg');
  if (!svg || !chart) return;

  const ganttStart = getGanttStart();
  const ganttEnd = getGanttEnd();
  if (!ganttStart || !ganttEnd) return;

  const cw = getColumnWidth();
  const headerHeight = (chart as unknown as { options: { header_height: number } }).options
    .header_height;

  // Total height of the chart body (excluding header) - use grid-background as reference
  const gridBg = svg.querySelector<SVGRectElement>('.grid-background');
  const totalHeight = gridBg ? Number(gridBg.getAttribute('height')) : 400;
  const bodyHeight = Math.max(0, totalHeight - headerHeight);

  // Inclusive number of day cells from ganttStart to ganttEnd.
  const ONE_DAY = 86_400_000;
  const totalDays = Math.round((ganttEnd.getTime() - ganttStart.getTime()) / ONE_DAY) + 1;

  // Remove old overlay before re-creating
  svg.querySelectorAll('.weekend-overlay').forEach((el) => el.remove());

  const overlayGroup = document.createElementNS(SVG_NS, 'g');
  overlayGroup.setAttribute('class', 'weekend-overlay');
  overlayGroup.setAttribute('pointer-events', 'none');

  for (let i = 0; i < totalDays; i++) {
    const date = new Date(ganttStart.getTime() + i * ONE_DAY);
    const dow = date.getDay();
    if (dow === 0 || dow === 6) {
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', String(i * cw));
      rect.setAttribute('y', String(headerHeight));
      rect.setAttribute('width', String(cw));
      rect.setAttribute('height', String(bodyHeight));
      // Sunday tinted red-pink, Saturday blue
      rect.setAttribute('fill', dow === 0 ? '#fecaca' : '#bfdbfe');
      rect.setAttribute('opacity', '0.35');
      overlayGroup.appendChild(rect);
    }
  }

  // Insert just after the grid-background so bars / today-highlight render on top.
  const gridGroup = svg.querySelector('g.grid');
  if (gridGroup) {
    gridGroup.appendChild(overlayGroup);
  } else {
    svg.insertBefore(overlayGroup, svg.firstChild);
  }
}

function getGanttStart(): Date | null {
  const internals = chart as unknown as { gantt_start?: Date };
  return internals?.gantt_start ?? null;
}

function getGanttEnd(): Date | null {
  const internals = chart as unknown as { gantt_end?: Date };
  return internals?.gantt_end ?? null;
}

function getColumnWidth(): number {
  const internals = chart as unknown as { options: { column_width: number } };
  return internals?.options?.column_width ?? 38;
}

/**
 * Infer the day-of-week for a .lower-text element based on its X position
 * relative to ganttStart and the column width. More robust than relying on
 * SVG text order alone.
 */
function inferDow(text: SVGTextElement, ganttStart: Date, cw: number): number | null {
  const xAttr = text.getAttribute('x');
  if (!xAttr) return null;
  const x = Number(xAttr);
  if (!Number.isFinite(x)) return null;
  // Lower-text x is the center of the column. Round to nearest column index.
  const idx = Math.max(0, Math.round((x - cw / 2) / cw));
  const date = new Date(ganttStart.getTime() + idx * 86_400_000);
  return date.getDay();
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
  padding: 0.5rem;
  height: 100%;
  overflow: auto;
}
.gantt-container {
  height: 100%;
  min-height: 200px;
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
.gantt-container :deep(.upper-text) {
  font-size: 0.8rem;
  font-weight: 600;
  fill: #1f2937;
}
.gantt-container :deep(.lower-text) {
  font-size: 0.7rem;
  fill: #4b5563;
}
</style>
