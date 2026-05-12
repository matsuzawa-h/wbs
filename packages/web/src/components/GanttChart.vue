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
    drawMonthBands();
    highlightWeekends();
    drawMonthBoundaries();
    drawOverrunBars();
    attachBarTooltips();
    applyJapaneseLabels();
  });
}

function parseDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

function businessDaysBetween(a: Date, b: Date): number {
  if (a.getTime() > b.getTime()) return 0;
  let count = 0;
  const cursor = new Date(a.getTime());
  while (cursor.getTime() <= b.getTime()) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

/**
 * Draws red rectangles to the right of the planned bar for tasks that are
 * delayed. Covers two cases:
 *   (1) Finished late — actualEndDate > plannedEndDate.
 *       Solid red from (plannedEnd + 1) to actualEnd.
 *   (2) Currently overdue — task is still in progress past plannedEnd.
 *       Conditions: actualEndDate is null AND today > plannedEndDate AND
 *       (actualStartDate set OR plannedStartDate <= today).
 *       Semi-transparent red from (plannedEnd + 1) to today.
 */
function drawOverrunBars(): void {
  const svg = containerRef.value?.querySelector('svg');
  if (!svg || !chart) return;
  const ganttStart = getGanttStart();
  if (!ganttStart) return;
  const cw = getColumnWidth();
  const ONE_DAY = 86_400_000;
  const today = todayUtc();

  let group = svg.querySelector<SVGGElement>('.overrun-bars-group');
  if (!group) {
    group = document.createElementNS(SVG_NS, 'g') as SVGGElement;
    group.setAttribute('class', 'overrun-bars-group');
    svg.appendChild(group);
  }
  while (group.firstChild) group.removeChild(group.firstChild);

  const renderedTasks = props.tasks.filter((t) => t.startDate && t.endDate);
  const wrappers = svg.querySelectorAll<SVGGElement>('.bar-wrapper');
  wrappers.forEach((wrapper, idx) => {
    const task = renderedTasks[idx];
    if (!task || !task.endDate) return;

    const plannedEnd = parseDate(task.endDate);
    const bar = wrapper.querySelector<SVGRectElement>('.bar');
    if (!bar) return;
    const barY = Number(bar.getAttribute('y') ?? '0');
    const barH = Number(bar.getAttribute('height') ?? '0');

    // Case 1: finished late (historical) — lighter red to recede visually
    if (task.actualEndDate) {
      const actualEnd = parseDate(task.actualEndDate);
      if (actualEnd.getTime() <= plannedEnd.getTime()) return;

      appendOverrunRect(group!, {
        ganttStart,
        cw,
        ONE_DAY,
        plannedEnd,
        endDate: actualEnd,
        barY,
        barH,
        fill: '#ef4444',
        opacity: '0.55',
        title:
          `${task.name}\n遅延: ${Math.max(0, businessDaysBetween(plannedEnd, actualEnd) - 1)} 営業日\n` +
          `予定終了: ${task.endDate}\n実績終了: ${task.actualEndDate}`,
      });
      return;
    }

    // Case 2: currently overdue (in progress past planned end) — solid deep red
    const isOverdue = today.getTime() > plannedEnd.getTime();
    if (!isOverdue) return;
    // Require either explicit actualStart or that planned start has arrived
    const plannedStart = task.startDate ? parseDate(task.startDate) : null;
    const started =
      Boolean(task.actualStartDate) ||
      (plannedStart !== null && plannedStart.getTime() <= today.getTime());
    if (!started) return;

    appendOverrunRect(group!, {
      ganttStart,
      cw,
      ONE_DAY,
      plannedEnd,
      endDate: today,
      barY,
      barH,
      fill: '#dc2626',
      opacity: '0.92',
      title:
        `${task.name}\n進行中（遅延中）\n予定終了: ${task.endDate}（本日: ${formatDateUtc(today)}）\n` +
        `遅延: ${Math.max(0, businessDaysBetween(plannedEnd, today) - 1)} 営業日`,
    });
  });
}

function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function formatDateUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface OverrunRectArgs {
  ganttStart: Date;
  cw: number;
  ONE_DAY: number;
  plannedEnd: Date;
  endDate: Date;
  barY: number;
  barH: number;
  fill: string;
  opacity: string;
  title: string;
}

function appendOverrunRect(group: SVGGElement, args: OverrunRectArgs): void {
  const plannedEndOffset = Math.round(
    (args.plannedEnd.getTime() - args.ganttStart.getTime()) / args.ONE_DAY,
  );
  const endOffset = Math.round(
    (args.endDate.getTime() - args.ganttStart.getTime()) / args.ONE_DAY,
  );
  const startX = (plannedEndOffset + 1) * args.cw;
  const width = (endOffset - plannedEndOffset) * args.cw;
  if (width <= 0) return;

  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('class', 'overrun-bar');
  rect.setAttribute('x', String(startX));
  rect.setAttribute('y', String(args.barY));
  rect.setAttribute('width', String(width));
  rect.setAttribute('height', String(args.barH));
  rect.setAttribute('fill', args.fill);
  rect.setAttribute('opacity', args.opacity);
  rect.setAttribute('rx', '3');
  const title = document.createElementNS(SVG_NS, 'title');
  title.textContent = args.title;
  rect.appendChild(title);
  group.appendChild(rect);
}

/**
 * Adds an SVG <title> child to each bar-wrapper so the browser shows a native
 * tooltip on hover summarising planned vs actual dates, hours, progress, etc.
 */
function attachBarTooltips(): void {
  const svg = containerRef.value?.querySelector('svg');
  if (!svg) return;
  const renderedTasks = props.tasks.filter((t) => t.startDate && t.endDate);
  const wrappers = svg.querySelectorAll<SVGGElement>('.bar-wrapper');
  wrappers.forEach((wrapper, idx) => {
    const task = renderedTasks[idx];
    if (!task) return;
    wrapper.querySelectorAll(':scope > title').forEach((t) => t.remove());
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = buildBarTooltip(task);
    wrapper.appendChild(title);
  });
}

function buildBarTooltip(task: WbsTask): string {
  const lines: string[] = [task.name];
  if (task.startDate && task.endDate) {
    const dur = task.duration ?? businessDaysBetween(parseDate(task.startDate), parseDate(task.endDate));
    lines.push(`予定: ${task.startDate} 〜 ${task.endDate} (${dur} 営業日)`);
  }
  if (task.actualStartDate && task.actualEndDate) {
    const actDur = businessDaysBetween(parseDate(task.actualStartDate), parseDate(task.actualEndDate));
    lines.push(`実績: ${task.actualStartDate} 〜 ${task.actualEndDate} (${actDur} 営業日)`);
    if (task.endDate) {
      const plannedEnd = parseDate(task.endDate);
      const actualEnd = parseDate(task.actualEndDate);
      if (actualEnd.getTime() > plannedEnd.getTime()) {
        const delay = Math.max(0, businessDaysBetween(plannedEnd, actualEnd) - 1);
        lines.push(`遅延: ${delay} 営業日`);
      } else if (actualEnd.getTime() < plannedEnd.getTime()) {
        const early = Math.max(0, businessDaysBetween(actualEnd, plannedEnd) - 1);
        if (early > 0) lines.push(`前倒し: ${early} 営業日`);
      }
    }
  } else if (task.actualStartDate) {
    // Started but not finished
    lines.push(`実績: ${task.actualStartDate} 〜 (進行中)`);
    if (task.endDate) {
      const plannedEnd = parseDate(task.endDate);
      const today = todayUtc();
      if (today.getTime() > plannedEnd.getTime()) {
        const delay = Math.max(0, businessDaysBetween(plannedEnd, today) - 1);
        lines.push(`遅延中: ${delay} 営業日`);
      }
    }
  }
  if (task.plannedHours !== null || task.actualHours !== null) {
    const ph = task.plannedHours ?? '—';
    const ah = task.actualHours ?? '—';
    lines.push(`工数 予/実: ${ph} / ${ah} h`);
  }
  lines.push(`進捗: ${task.progress}%`);
  return lines.join('\n');
}

function drawMonthBands(): void {
  const svg = containerRef.value?.querySelector('svg');
  if (!svg || !chart) return;
  const ganttStart = getGanttStart();
  const ganttEnd = getGanttEnd();
  if (!ganttStart || !ganttEnd) return;

  const cw = getColumnWidth();
  const gridBg = svg.querySelector<SVGRectElement>('.grid-background');
  const totalHeight = gridBg ? Number(gridBg.getAttribute('height')) : 400;
  const ONE_DAY = 86_400_000;
  const totalDays = Math.round((ganttEnd.getTime() - ganttStart.getTime()) / ONE_DAY) + 1;

  svg.querySelectorAll('.month-band').forEach((el) => el.remove());

  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('class', 'month-band');
  group.setAttribute('pointer-events', 'none');

  let segStart = 0;
  let currentMonth = ganttStart.getMonth();
  let bandIndex = 0;

  const flushBand = (endIdx: number): void => {
    // Tint every other month so adjacent months read as distinct stripes.
    const fill = bandIndex % 2 === 0 ? '#ffffff' : '#e0e7ff';
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(segStart * cw));
    rect.setAttribute('y', '0');
    rect.setAttribute('width', String((endIdx - segStart) * cw));
    rect.setAttribute('height', String(totalHeight));
    rect.setAttribute('fill', fill);
    rect.setAttribute('opacity', '0.55');
    group.appendChild(rect);
  };

  for (let i = 1; i < totalDays; i++) {
    const date = new Date(ganttStart.getTime() + i * ONE_DAY);
    if (date.getMonth() !== currentMonth) {
      flushBand(i);
      segStart = i;
      currentMonth = date.getMonth();
      bandIndex++;
    }
  }
  flushBand(totalDays);

  const gridGroup = svg.querySelector('g.grid');
  if (gridGroup) {
    // Insert at the start of grid so weekend / today / bars sit on top.
    gridGroup.insertBefore(group, gridGroup.firstChild?.nextSibling ?? null);
  } else {
    svg.insertBefore(group, svg.firstChild);
  }
}

function drawMonthBoundaries(): void {
  const svg = containerRef.value?.querySelector('svg');
  if (!svg || !chart) return;
  const ganttStart = getGanttStart();
  const ganttEnd = getGanttEnd();
  if (!ganttStart || !ganttEnd) return;

  const cw = getColumnWidth();
  const gridBg = svg.querySelector<SVGRectElement>('.grid-background');
  const totalHeight = gridBg ? Number(gridBg.getAttribute('height')) : 400;
  const ONE_DAY = 86_400_000;
  const totalDays = Math.round((ganttEnd.getTime() - ganttStart.getTime()) / ONE_DAY) + 1;

  svg.querySelectorAll('.month-boundary').forEach((el) => el.remove());

  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('class', 'month-boundary');
  group.setAttribute('pointer-events', 'none');

  for (let i = 1; i < totalDays; i++) {
    const date = new Date(ganttStart.getTime() + i * ONE_DAY);
    if (date.getDate() === 1) {
      const x = i * cw;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', String(x));
      line.setAttribute('x2', String(x));
      line.setAttribute('y1', '0');
      line.setAttribute('y2', String(totalHeight));
      line.setAttribute('stroke', '#1e293b');
      line.setAttribute('stroke-width', '2.5');
      group.appendChild(line);

      // Place a duplicate month-label badge just to the right of the line so users
      // see which month they're entering even when the chart-level upper-text is
      // scrolled off-screen.
      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', String(x + 6));
      label.setAttribute('y', '18');
      label.setAttribute('font-size', '12');
      label.setAttribute('font-weight', '700');
      label.setAttribute('fill', '#1e293b');
      label.textContent = `${date.getMonth() + 1}月`;
      group.appendChild(label);
    }
  }

  const gridGroup = svg.querySelector('g.grid');
  if (gridGroup) {
    gridGroup.appendChild(group);
  } else {
    svg.appendChild(group);
  }
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
  /* No top padding so the SVG header lines up exactly with the table's
     group-head + col-head stack. Side / bottom padding kept for breathing room. */
  padding: 0 0.5rem 0.5rem 0.5rem;
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
